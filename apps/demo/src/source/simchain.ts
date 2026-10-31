// The SimChain event source: runs T-012's beats (apps/demo/agents/beats.ts) on a fresh demo world each and
// turns the settlement log, ledger and Bench A's signed judgment record into transcript events.
// Times are measured: the world's SimChain is wrapped so each settlement event is stamped with the wall-clock
// milliseconds since the job's first call, and the ledger is snapshotted with it. Observation only: the wrapper
// passes every call through unchanged.
import type { Commitment, Hex32, Judgment, SettlementEvent } from '@holdback/core';
import { adjudicatorProfiles, type ProfileView, type Slate } from '@holdback/demo/agents/adjudicators.js';
import { beatBadWork, beatHappyPath, beatHiddenTags, beatHold, beatMutualSplit, type JobResult, type Negotiation, type NegotiationStep } from '@holdback/demo/agents/beats.js';
import { judgingTimeOf, type JudgingTime } from '@holdback/demo/agents/bench.js';
import { createDemoWorld, type ActorName, type DemoWorld } from '@holdback/demo/agents/world.js';
import { judgePromptView, verdictView } from '../transcript/judge.js';
import { formatAmount } from '../transcript/money.js';
import { fetchPartyView, sharedRecordEvent } from './record.js';
import { plain } from '../transcript/untrusted.js';
import type { AdjudicatorProfile, Amount, BalanceRow, BeatTranscript, CastKey, DemoEvent, EventSource, JudgeSeat, Json, SlateKeys, Via } from '../transcript/types.js';

export const SIMCHAIN_NOTE =
  "measured on SimChain in this run: scripted agents over the operator API; the adjudicator service with scripted judges, seated from config/judges.yaml's pinned placeholder model IDs. Times are wall-clock milliseconds on this machine.";

/** Each job runs on its own world (T-019): beats 1 to 4 are one job on seed 7; beat n's job uses seed 7 + n. */
export const seedOf = (beat: number): number => (beat <= 4 ? 7 : 7 + beat);

export interface BeatMeta {
  title: string;
  summary: string;
  litmus: string;
}

export const BEAT_META: Readonly<Record<number, BeatMeta>> = {
  1: {
    title: 'Choose, agree and hold',
    summary:
      'Ledger filters the published adjudicators by the club rulebook and proposes three; Tide-7 checks them against its own policy and agrees; Tide-7 offers terms naming exactly that slate; Clearfield accepts and reserves bond; Ledger agrees and holds price plus fee in one call.',
    litmus: 'the agents choose the adjudicator; the hold; machine speed',
  },
  2: { title: 'Deliver without revealing', summary: 'Tide-7 uploads the cleaned CSV encrypted. Ledger sees only hashes; the content key is sealed to Clearfield.', litmus: 'the two-sided hold: money and work' },
  3: {
    title: 'Defended judgment',
    summary: 'Deterministic checks pass; the panel seed is revealed; three pinned judges from two families give scripted verdicts; one judge\'s prompt and verdict are shown; Clearfield accepts.',
    litmus: 'defended multi-model judgment',
  },
  4: { title: 'Settle', summary: 'Funds go to Tide-7 and the content key to Ledger in the same step; Ledger checks the plaintext hash.', litmus: 'fair exchange' },
  5: {
    title: 'Bad work',
    summary: 'A second job: the deliverable drops 8% of rows. A required check fails and Ledger is refunded in one step; Tide-7 keeps the work.',
    litmus: 'the hold; delivery versus payment for data',
  },
  6: {
    title: 'Injection attempt (hidden tags)',
    summary: "A delivery hides tag characters aimed at Ledger itself under an empty rubric: it is accepted, the screen report records it, and Ledger's SDK strips the payload before Ledger reads the file.",
    litmus: 'the defenses',
  },
  10: {
    title: 'Agree without a judge',
    summary: 'A third job. Ledger finds a gap; both agents co-sign a 70/30 split. Ledger gets the key, Clearfield never judges and its reservation is released, and the fee returns to Ledger.',
    litmus: '2-of-3: consent first, adjudicator only on disagreement',
  },
};

const ACTORS: readonly [ActorName, CastKey][] = [
  ['atlas', 'buyer'],
  ['tidewater', 'seller'],
  ['bench-a', 'benchA'],
  ['bench-b', 'benchB'],
  ['bench-c', 'benchC'],
];
const BENCHES: readonly [ActorName, CastKey][] = ACTORS.slice(2);

const lc = (s: string) => s.toLowerCase();
const tusd = (v: bigint): Amount => ({ token: 'tUSD', amount: v.toString() });

interface Snapshot {
  ledger: Record<string, bigint>;
  reserved: Partial<Record<CastKey, bigint>>;
}

/** Stamps every settlement event with wall-clock ms since `start()` and the ledger after its submission. */
class Recorder {
  readonly stamps = new Map<number, { ms: number; snap: Snapshot }>();
  /** Off-chain steps (the adjudicator negotiation), stamped when the agents finish them. */
  readonly marks = new Map<NegotiationStep, number>();

  mark(step: NegotiationStep): void {
    this.marks.set(step, this.elapsed());
  }
  private t0 = 0;
  initial!: Snapshot;

  constructor(private readonly world: DemoWorld) {
    const chain = world.chain;
    const submit = chain.submit.bind(chain);
    const trigger = chain.trigger.bind(chain);
    chain.submit = async (...args) => this.after(await submit(...args));
    chain.trigger = async (...args) => this.after(await trigger(...args));
  }

  start(): void {
    this.t0 = performance.now();
    this.initial = this.snapshot();
  }

  elapsed(): number {
    return this.at(performance.now());
  }

  /** A performance.now() mark taken elsewhere (the adjudicator service), in ms since the job's first call. */
  at(mark: number): number {
    return Math.round(mark - this.t0);
  }

  private snapshot(): Snapshot {
    const reserved: Snapshot['reserved'] = {};
    for (const [name, key] of BENCHES) reserved[key] = this.world.chain.pool(this.world.addressOf(name)).reserved;
    return { ledger: this.world.chain.ledger(), reserved };
  }

  private after<T>(result: T): T {
    const ms = this.elapsed();
    const snap = this.snapshot();
    for (const e of this.world.chain.log()) if (!this.stamps.has(e.seq)) this.stamps.set(e.seq, { ms, snap });
    return result;
  }
}

/** One job run on its own world: the result, its settlement events and their stamps. */
interface Run {
  world: DemoWorld;
  recorder: Recorder;
  commitment: Commitment;
  result?: JobResult;
  /** When the beat call returned (Ledger has opened the work by then). */
  doneMs: number;
  events: SettlementEvent[];
  /** Beat 1: how the agents chose the adjudicators, and the profiles they read. */
  choice?: { negotiation: Negotiation; profiles: ProfileView[] };
  /** The adjudicator service's marks for the decision, when one was made (T-019). */
  judging?: JudgingTime;
  /** D26: both parties' copies of the record, compared after the job. */
  shared: DemoEvent;
}

type JobOut = JobResult | { commitment: Commitment; choice?: Run['choice'] };

async function runJob(seed: number, job: (world: DemoWorld, recorder: Recorder) => Promise<JobOut>): Promise<Run> {
  const world = await createDemoWorld({ seed });
  try {
    const recorder = new Recorder(world);
    recorder.start();
    const out = await job(world, recorder);
    const doneMs = recorder.elapsed();
    const events = world.chain.log().filter((e) => e.commitmentId === out.commitment.id);
    const choice = 'choice' in out && out.choice ? { choice: out.choice } : {};
    const result = 'vias' in out && Array.isArray(out.vias) ? (out as JobResult) : undefined;
    const judging = judgingTimeOf(out.commitment.id);
    // Each party reads its own copy through its own SDK client; the judgment record by the hash its decision names.
    const records = (hash: string) => (result?.record?.recordHash === hash ? result.record : undefined);
    const copies = await Promise.all(
      (['buyer', 'seller'] as const).map(async (who) => ({ who, view: await fetchPartyView(world.sdk(), out.commitment.id, records) })),
    );
    const shared = sharedRecordEvent(recorder.elapsed(), copies);
    return { world, recorder, commitment: out.commitment, ...(result ? { result } : {}), doneMs, events, ...choice, ...(judging ? { judging } : {}), shared };
  } finally {
    await world.close();
  }
}

/** Beat 1's job: negotiation (each step stamped), offer, acceptance and hold; profiles read before the world closes. */
const holdJob = async (world: DemoWorld, recorder: Recorder): Promise<JobOut> => {
  const hold = await beatHold(world, { observe: (step) => recorder.mark(step) });
  return { commitment: hold.commitment, choice: { negotiation: hold.negotiation, profiles: adjudicatorProfiles(hold) } };
};

/** Builds transcript events from a run. Each event carries the beat it belongs to in the 1-4 job. */
class Narrator {
  private readonly who = new Map<string, CastKey>();
  private readonly out: { phase: 1 | 2 | 3 | 4; e: DemoEvent }[] = [];

  /** Listed adjudicators no commitment names: their bonds sit on SimChain but are not a balance row. */
  private readonly offStage = new Set<string>();

  constructor(private readonly run: Run) {
    for (const [name, key] of ACTORS) this.who.set(lc(run.world.addressOf(name)), key);
    this.offStage.add(lc(run.world.addressOf('swiftline')));
  }

  private key(address: string): CastKey {
    const k = this.who.get(lc(address));
    if (!k) throw new Error(`no cast member at ${address}`);
    return k;
  }

  private maybeKey(address: string): CastKey | undefined {
    return this.who.get(lc(address));
  }

  /** A ledger account as a cast key: a party, its bond pool, or an escrow; null for an off-stage bond. */
  private account(acct: string): CastKey | null {
    if (acct.startsWith('escrow:')) return 'escrow';
    const bond = /^bond:(0x[0-9a-f]{40}):(junior|senior)$/.exec(acct);
    if (bond && this.offStage.has(bond[1]!)) return null;
    return this.key(bond ? bond[1]! : acct);
  }

  private balances(atMs: number, label: string, snap: Snapshot): DemoEvent {
    const sums = new Map<CastKey, bigint>();
    for (const [acct, v] of Object.entries(snap.ledger)) {
      const k = this.account(acct);
      if (k === null) continue;
      sums.set(k, (sums.get(k) ?? 0n) + v);
    }
    const order: CastKey[] = ['buyer', 'seller', 'escrow', 'benchA', 'benchB', 'benchC'];
    const rows: BalanceRow[] = order.map((k) => ({
      who: k,
      amount: tusd(sums.get(k) ?? 0n),
      ...(snap.reserved[k] === undefined ? {} : { reserved: tusd(snap.reserved[k]!) }),
    }));
    return { kind: 'balances', atMs, actor: 'chain', label, rows };
  }

  private via(e: SettlementEvent): Via {
    const v = e.submittedVia ?? 'direct';
    if (v === 'op-1') return 'op1';
    if (v === 'op-2') return 'op2';
    if (v === 'direct') return 'direct';
    throw new Error(`unknown relay ${v}`);
  }

  private push(phase: 1 | 2 | 3 | 4, e: DemoEvent): void {
    this.out.push({ phase, e });
  }

  build(options: { signed: boolean }): { phase: 1 | 2 | 3 | 4; e: DemoEvent }[] {
    const { commitment: c, result, events, recorder } = this.run;
    const record = result?.record;
    this.push(1, this.balances(0, 'before', recorder.initial));
    if (this.run.choice) this.negotiation(this.run.choice.negotiation);
    const stamp = (e: SettlementEvent) => recorder.stamps.get(e.seq)!;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      const { ms, snap } = stamp(e);
      const p = e.payload;
      switch (e.type) {
        case 'commitment.offered':
          this.push(1, {
            kind: 'offer',
            atMs: ms,
            actor: 'seller',
            commitmentId: c.id,
            price: c.price,
            fee: c.adjudication.fee,
            primary: this.key(c.adjudication.adjudicator),
            fallback: this.key(c.adjudication.fallbackAdjudicator),
            appeal: this.key(c.adjudication.appealAdjudicator),
            disclosure: c.disclosure.level,
          });
          if (options.signed)
            this.push(1, {
              kind: 'signed',
              atMs: ms,
              actor: 'seller',
              messageType: 'Offer: the commitment terms Tide-7 signed',
              signer: c.seller,
              body: JSON.parse(JSON.stringify(p.terms)) as { [key: string]: Json },
              signature: String(p.sellerSignature),
            });
          break;
        case 'adjudicator.accepted':
          this.push(1, { kind: 'acceptance', atMs: ms, actor: this.key(String(e.actor)), bondReserved: p.bondReserved as Amount, seedCommitment: String(p.seedCommitment) });
          break;
        case 'hold.funded':
          this.push(1, { kind: 'hold', atMs: ms, actor: 'buyer', amount: (p.amount as Amount | null) ?? tusd(BigInt(c.price.amount) + BigInt(c.adjudication.fee.amount)), via: this.via(e) });
          this.push(1, this.balances(ms, 'after hold', snap));
          break;
        case 'delivery.submitted': {
          const recipients = events
            .slice(i + 1)
            .filter((x) => x.type === 'key.released' && stamp(x).ms === ms)
            .map((x) => this.key(String(x.payload.recipient)));
          const ct = p.ciphertext as { bytes: number };
          this.push(2, {
            kind: 'delivery',
            atMs: ms,
            actor: 'seller',
            deliveryHash: String(p.deliveryHash),
            plaintextSha256: String(p.plaintextSha256),
            ciphertextBytes: ct.bytes,
            keyRecipients: recipients,
            via: this.via(e),
          });
          this.push(2, this.balances(ms, 'after delivery', snap));
          break;
        }
        case 'judgment.decided': {
          // The decision and its settlement are one submission, so the ledger before it is the previous event's.
          const prevMs = i > 0 ? stamp(events[i - 1]!).ms : 0;
          this.push(3, this.balances(prevMs, 'before the decision', i > 0 ? stamp(events[i - 1]!).snap : recorder.initial));
          // Judging sub-steps are stamped from the adjudicator service's own marks (T-019), kept between the
          // previous settlement event and the decision.
          const j = this.run.judging;
          const clamp = (mark: number | undefined) => (mark === undefined ? ms : Math.min(ms, Math.max(prevMs, recorder.at(mark))));
          if (record) this.judgment({ checksMs: clamp(j?.startedAt), panelMs: clamp(j?.panel?.endedAt) }, record);
          const delivered = events.find((x) => x.type === 'delivery.submitted');
          const timing =
            j && delivered
              ? {
                  timing: {
                    afterDeliveryMs: ms - stamp(delivered).ms,
                    judgingMs: Math.max(0, ms - clamp(j.startedAt)),
                    ...(j.panel ? { panelMs: Math.round(j.panel.endedAt - j.panel.startedAt) } : {}),
                  },
                }
              : {};
          this.push(3, { kind: 'decision', atMs: ms, actor: this.key(String(e.actor)), role: p.role as 'primary', outcome: p.outcome as 'accept' | 'reject', via: this.via(e), ...timing });
          break;
        }
        case 'settlement.released':
        case 'settlement.refunded': {
          const postings = (p.postings as { from: string; to: string; amount: Amount; why: string }[]).filter((x) => x.from.startsWith('escrow:'));
          const keyTo = this.keyReleasedAt(i, ms);
          this.push(4, {
            kind: 'settlement',
            atMs: ms,
            actor: 'escrow',
            settlement: e.type === 'settlement.released' ? 'release' : 'refund',
            payouts: postings.map((x) => ({ to: this.account(x.to) ?? this.key(x.to), amount: x.amount, reason: x.why })),
            ...(keyTo ? { keyReleasedTo: keyTo } : {}),
            via: this.via(e),
          });
          const decider = this.key(String(e.actor));
          this.push(4, {
            kind: 'finality',
            atMs: ms,
            actor: 'chain',
            payee: e.type === 'settlement.released' ? 'seller' : 'buyer',
            appealWindowSec: c.timing.appealWindowSec,
            bondAtRisk: c.price,
            bondHolder: decider,
          });
          this.push(4, this.balances(ms, 'after settlement', snap));
          break;
        }
        case 'commitment.settled': {
          const payouts = (p.payouts as { to: string; amount: Amount }[]).map((x) => ({ to: this.key(x.to), amount: x.amount, reason: 'co-signed share of the price' }));
          const keyTo = this.keyReleasedAt(i, ms);
          this.push(4, {
            kind: 'settlement',
            atMs: ms,
            actor: 'escrow',
            settlement: 'mutual',
            // The fee goes back to the buyer when no adjudicator judged (ADR-0019, Phase 1); the balances confirm it.
            payouts: [...payouts, { to: 'buyer', amount: c.adjudication.fee, reason: 'fee returned; no adjudicator judged' }],
            ...(keyTo ? { keyReleasedTo: keyTo } : {}),
            via: this.via(e),
          });
          this.push(4, this.balances(ms, 'after settlement', snap));
          break;
        }
        default:
          break; // commitment.agreed, key.released: folded into hold, delivery and settlement above.
      }
    }
    const opened = result?.opened;
    if (opened) {
      const stripped = opened.removed.tagChars > 0 ? { stripped: { what: 'Unicode tag characters', count: opened.removed.tagChars } } : {};
      this.push(4, { kind: 'open', atMs: this.run.doneMs, actor: 'buyer', plaintextSha256: opened.plaintextSha256, matchesDelivery: opened.matchesDelivery, bytes: opened.bytes, ...stripped });
    }
    // D26: the job ends with both parties holding the same record (the last beat of a job shows it).
    this.push(4, this.run.shared);
    return this.out;
  }

  /**
   * The two off-chain steps before the offer (T-017). Registration names and reasons are party text, so they are
   * made plain at ingestion; the renderers escape again per surface.
   */
  private negotiation(n: Negotiation): void {
    const { proposal, review } = n;
    if (!review.agreed) throw new Error('beat 1 ran without an agreed slate');
    const slate = (s: Slate): SlateKeys => ({ primary: this.key(s.primary), fallback: this.key(s.fallback), appeal: this.key(s.appeal) });
    const marks = this.run.recorder.marks;
    this.push(1, {
      kind: 'adjudicator-proposal',
      atMs: marks.get('proposed') ?? 0,
      actor: 'buyer',
      registrations: proposal.considered.length,
      rules: proposal.rules.map(plain),
      considered: proposal.considered.map((c) => {
        const who = this.maybeKey(c.address);
        return { name: plain(c.name), ...(who ? { who } : {}), eligible: c.eligible, reasons: c.reasons.map(plain) };
      }),
      proposed: slate(proposal.slate),
    });
    this.push(1, {
      kind: 'adjudicator-agreement',
      atMs: marks.get('reviewed') ?? 0,
      actor: 'seller',
      agreed: slate(review.slate),
      policy: review.policy.map(plain),
      bondRequired: tusd(review.requiredFreeBond),
      bonds: review.checks.map((c) => ({ who: this.key(c.address), free: tusd(c.freeBond) })),
    });
  }

  /** The buyer, when a key was released to it by the same submission as the settlement at index i. */
  private keyReleasedAt(i: number, ms: number): CastKey | undefined {
    const { events, recorder } = this.run;
    const k = events.slice(i + 1).find((x) => x.type === 'key.released' && recorder.stamps.get(x.seq)!.ms === ms);
    return k ? this.key(String(k.payload.recipient)) : undefined;
  }

  /** `at`: checks and screen when the service's run began, the panel when its last verdict came back. */
  private judgment(at: { checksMs: number; panelMs: number }, record: Judgment): void {
    // Untrusted at ingestion: check details (csv_columns_exact quotes the seller's header), screen signal details
    // and aggregate reasons can carry deliverable text. The renderers escape again per surface.
    const r: Judgment = {
      ...record,
      deterministic: record.deterministic.map((d) => (d.detail === undefined ? d : { ...d, detail: plain(d.detail) })),
      screen: { ...record.screen, signals: record.screen.signals.map((s) => (s.detail === undefined ? s : { ...s, detail: plain(s.detail) })) },
      aggregate: { ...record.aggregate, reasons: record.aggregate.reasons.map(plain) },
    };
    const actor = this.key(r.adjudicator);
    const weights = this.run.commitment.acceptance.rubric.criteria.map((x) => x.weight);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    this.push(3, {
      kind: 'checks',
      atMs: at.checksMs,
      actor,
      results: r.deterministic.map((d) => ({
        id: d.checkId,
        type: this.run.commitment.acceptance.deterministicChecks.find((x) => x.id === d.checkId)?.type ?? 'check',
        required: d.required,
        passed: d.passed,
        detail: d.detail ?? (d.passed ? 'passed' : 'failed'),
      })),
    });
    const details = r.screen.signals.map((s) => s.detail ?? s.kind).join('; ');
    this.push(3, {
      kind: 'screen',
      atMs: at.checksMs,
      actor,
      flagged: r.screen.flagged,
      signals: r.screen.signals.map((s) => s.kind),
      consequence: r.screen.flagged
        ? `${details}; recorded in the signed judgment record, which says: ${r.aggregate.reasons.join('; ')}`
        : r.panel.ran
          ? 'the panel may decide'
          : `no panel sits, because ${r.aggregate.reasons.join('; ')}`,
    });
    if (!r.panel.ran) return;
    const judges: JudgeSeat[] = r.panel.members.map((m, n) => {
      const v = m.verdict;
      const score = v && totalWeight > 0 ? Math.trunc((v.criteria.reduce((s, x, j) => s + x.score * (weights[j] ?? 0), 0) * 100) / totalWeight) : undefined;
      return { seat: n + 1, model: m.model, family: m.family, verdict: v?.overall ?? 'abstain', ...(score === undefined ? {} : { score }) };
    });
    this.push(3, {
      kind: 'panel',
      atMs: at.panelMs,
      actor,
      seed: r.panel.seed ?? '',
      seedSource: r.panel.seedSource,
      rule: r.aggregate.reasons[0] ?? '',
      judges,
      outcome: r.aggregate.decision,
    });
    // One judge's prompt and verdict (T-019): seat 1, matched to the request the service sent it. Both are
    // untrusted (terms, deliverable sample, model output): made plain line by line here, escaped again per surface.
    const seat = r.panel.members[0];
    const request = seat && this.run.result?.requests.find((q) => q.judgeId === seat.judgeId && q.model === seat.model);
    if (seat && request)
      this.push(3, {
        kind: 'judge-prompt',
        atMs: at.panelMs,
        actor,
        seat: 1,
        model: seat.model,
        family: seat.family,
        inputHash: seat.inputHash,
        // The SimChain source runs config/judges.yaml's fake providers only (ServiceBench's default).
        scripted: true,
        prompt: judgePromptView(request.system, request.user),
        ...(seat.verdict ? { verdict: verdictView(seat.verdict) } : {}),
      });
  }
}

const DEADLINE_FROM: Readonly<Record<ProfileView['terms']['deadline']['after'], string>> = {
  deliverBy: 'after the delivery deadline',
  judgeBy: "after the primary's judgeBy (fallback takeover)",
  appeal: 'after an appeal is filed',
};

/** A profile for the transcript: terms formatted, party text made plain at ingestion (renderers escape again). */
function profileOf(v: ProfileView, who: CastKey | undefined): AdjudicatorProfile {
  const t = v.terms;
  const terms: { label: string; value: string }[] = [
    { label: 'Fee', value: `${formatAmount(t.fee)} minimum (registration)${t.feeRateBps === undefined ? '' : `; priced at ${Math.trunc(t.feeRateBps / 100)}.${String(t.feeRateBps % 100).padStart(2, '0')}% of the price`}` },
    {
      label: 'Panel',
      value: `${t.panelSize ?? '?'} judges from at least ${t.minFamilies ?? '?'} families${t.threshold ? `; accept or reject by ${t.threshold.numerator}/${t.threshold.denominator} of valid verdicts` : ''}`,
    },
    { label: 'Appeal panel', value: `${t.appealPanelSize ?? '?'} judges from at least ${t.minFamiliesAppeal ?? '?'} families` },
    { label: 'Decides within', value: `${t.deadline.sec} s ${DEADLINE_FROM[t.deadline.after]} (terms file)` },
    { label: 'Appeal window', value: `${t.appealWindowSec} s (terms file)` },
    { label: 'Bond', value: `${formatAmount(t.bond)} on SimChain; ${formatAmount(t.freeBond)} free` },
  ];
  if (t.registryHash) terms.push({ label: 'Registry', value: `${t.registryHash.slice(0, 10)}… (config/judges.yaml)` });
  return {
    ...(who ? { who } : {}),
    name: plain(v.name),
    tagline: v.tagline,
    roles: [...v.roles],
    selected: v.selected,
    ...(v.declinedBecause ? { declinedBecause: v.declinedBecause.map(plain) } : {}),
    ...(v.sellerChecks ? { sellerChecks: v.sellerChecks.map(plain) } : {}),
    judges: v.judges,
    harness: [...v.harness],
    terms,
    history: { rolePlay: true, lines: [...v.history.lines] },
  };
}

const transcript = (beat: number, run: Run, events: DemoEvent[]): BeatTranscript => {
  const meta = BEAT_META[beat]!;
  const who = new Map(ACTORS.map(([name, key]) => [lc(run.world.addressOf(name)), key]));
  const adjudicators = run.choice ? { adjudicators: run.choice.profiles.map((v) => profileOf(v, who.get(lc(v.address)))) } : {};
  return {
    ...adjudicators,
    format: 'holdback.demo.transcript/v0',
    beat,
    title: meta.title,
    summary: meta.summary,
    litmus: meta.litmus,
    mode: 'scripted',
    source: { kind: 'simchain', note: SIMCHAIN_NOTE },
    commitmentId: run.commitment.id as Hex32,
    events,
  };
};

/** Beats 1, 2-4 (one job, sliced), 5, 6 (hidden-tags half) and 10, each on a fresh world seeded by seedOf. */
export function simchainSource(): EventSource {
  let happy: Promise<Run> | undefined;
  const beats = [1, 2, 3, 4, 5, 6, 10];
  return {
    name: 'simchain',
    beats: () => beats,
    run: async (beat) => {
      switch (beat) {
        case 1: {
          const run = await runJob(seedOf(1), holdJob);
          return transcript(1, run, new Narrator(run).build({ signed: true }).map((x) => x.e));
        }
        case 2:
        case 3:
        case 4: {
          happy ??= runJob(seedOf(2), (w) => beatHappyPath(w));
          const run = await happy;
          const all = new Narrator(run).build({ signed: false });
          return transcript(beat, run, all.filter((x) => x.phase === beat).map((x) => x.e));
        }
        case 5:
        case 6:
        case 10: {
          const job = beat === 5 ? beatBadWork : beat === 6 ? beatHiddenTags : (w: DemoWorld) => beatMutualSplit(w);
          const run = await runJob(seedOf(beat), (w) => job(w));
          return transcript(beat, run, new Narrator(run).build({ signed: false }).map((x) => x.e));
        }
        default:
          throw new RangeError(`the SimChain source has no beat ${beat}; available: ${beats.join(', ')}`);
      }
    },
  };
}
