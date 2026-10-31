// The SimChain event source: runs T-012's beats (apps/demo/agents/beats.ts) on a fresh demo world each and
// turns the settlement log, ledger and Bench A's signed judgment record into transcript events.
// Times are measured: the world's SimChain is wrapped so each settlement event is stamped with the wall-clock
// milliseconds since the job's first call, and the ledger is snapshotted with it. Observation only: the wrapper
// passes every call through unchanged.
import type { Commitment, Hex32, Judgment, SettlementEvent } from '@holdback/core';
import { beatBadWork, beatHappyPath, beatHiddenTags, beatHold, beatMutualSplit, type JobResult } from '@holdback/demo/agents/beats.js';
import { createDemoWorld, type ActorName, type DemoWorld } from '@holdback/demo/agents/world.js';
import { plain } from '../transcript/untrusted.js';
import type { Amount, BalanceRow, BeatTranscript, CastKey, DemoEvent, EventSource, JudgeSeat, Json, Via } from '../transcript/types.js';

export const SIMCHAIN_NOTE =
  "measured on SimChain in this run, through T-012's scripted agents and T-009's adjudicator service. Judges are fake providers scripted to pass, seated from config/judges.yaml's pinned placeholder model IDs; times are wall-clock milliseconds on this machine.";

export interface BeatMeta {
  title: string;
  summary: string;
  litmus: string;
}

export const BEAT_META: Readonly<Record<number, BeatMeta>> = {
  1: {
    title: 'Choose, agree and hold',
    summary: 'Tide-7 offers terms naming three adjudicators the two agents chose; Clearfield accepts and reserves bond; Ledger agrees and holds price plus fee in one call.',
    litmus: 'the agents choose the adjudicator; the hold; machine speed',
  },
  2: { title: 'Deliver without revealing', summary: 'Tide-7 uploads the cleaned CSV encrypted. Ledger sees only hashes; the content key is sealed to Clearfield.', litmus: 'the two-sided hold: money and work' },
  3: {
    title: 'Defended judgment',
    summary: 'Deterministic checks pass; the panel seed is revealed; three pinned judges from two families give recorded verdicts; Clearfield accepts.',
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
    return Math.round(performance.now() - this.t0);
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
}

async function runJob(job: (world: DemoWorld) => Promise<JobResult | { commitment: Commitment }>): Promise<Run> {
  const world = await createDemoWorld();
  try {
    const recorder = new Recorder(world);
    recorder.start();
    const out = await job(world);
    const doneMs = recorder.elapsed();
    const events = world.chain.log().filter((e) => e.commitmentId === out.commitment.id);
    return { world, recorder, commitment: out.commitment, ...('vias' in out && Array.isArray(out.vias) ? { result: out as JobResult } : {}), doneMs, events };
  } finally {
    await world.close();
  }
}

/** Builds transcript events from a run. Each event carries the beat it belongs to in the 1-4 job. */
class Narrator {
  private readonly who = new Map<string, CastKey>();
  private readonly out: { phase: 1 | 2 | 3 | 4; e: DemoEvent }[] = [];

  constructor(private readonly run: Run) {
    for (const [name, key] of ACTORS) this.who.set(lc(run.world.addressOf(name)), key);
  }

  private key(address: string): CastKey {
    const k = this.who.get(lc(address));
    if (!k) throw new Error(`no cast member at ${address}`);
    return k;
  }

  /** A ledger account as a cast key: a party, its bond pool, or an escrow. */
  private account(acct: string): CastKey {
    if (acct.startsWith('escrow:')) return 'escrow';
    const bond = /^bond:(0x[0-9a-f]{40}):(junior|senior)$/.exec(acct);
    return this.key(bond ? bond[1]! : acct);
  }

  private balances(atMs: number, label: string, snap: Snapshot): DemoEvent {
    const sums = new Map<CastKey, bigint>();
    for (const [acct, v] of Object.entries(snap.ledger)) {
      const k = this.account(acct);
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
        case 'judgment.decided':
          // The decision and its settlement are one submission, so the ledger before it is the previous event's.
          this.push(3, this.balances(ms, 'before the decision', i > 0 ? stamp(events[i - 1]!).snap : recorder.initial));
          if (record) this.judgment(ms, record);
          this.push(3, { kind: 'decision', atMs: ms, actor: this.key(String(e.actor)), role: p.role as 'primary', outcome: p.outcome as 'accept' | 'reject', via: this.via(e) });
          break;
        case 'settlement.released':
        case 'settlement.refunded': {
          const postings = (p.postings as { from: string; to: string; amount: Amount; why: string }[]).filter((x) => x.from.startsWith('escrow:'));
          const keyTo = this.keyReleasedAt(i, ms);
          this.push(4, {
            kind: 'settlement',
            atMs: ms,
            actor: 'escrow',
            settlement: e.type === 'settlement.released' ? 'release' : 'refund',
            payouts: postings.map((x) => ({ to: this.account(x.to), amount: x.amount, reason: x.why })),
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
    return this.out;
  }

  /** The buyer, when a key was released to it by the same submission as the settlement at index i. */
  private keyReleasedAt(i: number, ms: number): CastKey | undefined {
    const { events, recorder } = this.run;
    const k = events.slice(i + 1).find((x) => x.type === 'key.released' && recorder.stamps.get(x.seq)!.ms === ms);
    return k ? this.key(String(k.payload.recipient)) : undefined;
  }

  private judgment(ms: number, record: Judgment): void {
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
      atMs: ms,
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
      atMs: ms,
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
      atMs: ms,
      actor,
      seed: r.panel.seed ?? '',
      seedSource: r.panel.seedSource,
      rule: r.aggregate.reasons[0] ?? '',
      judges,
      outcome: r.aggregate.decision,
    });
  }
}

const transcript = (beat: number, run: Run, events: DemoEvent[]): BeatTranscript => {
  const meta = BEAT_META[beat]!;
  return {
    format: 'holdback.demo.transcript/v0',
    beat,
    title: meta.title,
    summary: meta.summary,
    litmus: meta.litmus,
    mode: 'recorded',
    source: { kind: 'simchain', note: SIMCHAIN_NOTE },
    commitmentId: run.commitment.id as Hex32,
    events,
  };
};

/** Beats 1, 2-4 (one job, sliced), 5, 6 (hidden-tags half) and 10, each on a fresh world with seed 7. */
export function simchainSource(): EventSource {
  let happy: Promise<Run> | undefined;
  const beats = [1, 2, 3, 4, 5, 6, 10];
  return {
    name: 'simchain',
    beats: () => beats,
    run: async (beat) => {
      switch (beat) {
        case 1: {
          const run = await runJob((w) => beatHold(w));
          return transcript(1, run, new Narrator(run).build({ signed: true }).map((x) => x.e));
        }
        case 2:
        case 3:
        case 4: {
          happy ??= runJob((w) => beatHappyPath(w));
          const run = await happy;
          const all = new Narrator(run).build({ signed: false });
          return transcript(beat, run, all.filter((x) => x.phase === beat).map((x) => x.e));
        }
        case 5:
        case 6:
        case 10: {
          const job = beat === 5 ? beatBadWork : beat === 6 ? beatHiddenTags : (w: DemoWorld) => beatMutualSplit(w);
          const run = await runJob(job);
          return transcript(beat, run, new Narrator(run).build({ signed: false }).map((x) => x.e));
        }
        default:
          throw new RangeError(`the SimChain source has no beat ${beat}; available: ${beats.join(', ')}`);
      }
    },
  };
}
