import { demoRegistry } from '@holdback/demo/agents/bench.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BalanceRow, BeatTranscript, DemoEvent } from '../transcript/types.js';
import { renderMarkdown } from '../transcript/render-md.js';
import { demoSource } from './demo.js';
import { simchainSource } from './simchain.js';

const total = (rows: BalanceRow[]) => rows.reduce((s, r) => s + BigInt(r.amount.amount) + 0n, 0n);
type Of<K extends DemoEvent['kind']> = Extract<DemoEvent, { kind: K }>;
const only = <K extends DemoEvent['kind']>(t: BeatTranscript, kind: K): Of<K>[] => t.events.filter((e): e is Of<K> => e.kind === kind);
const row = (t: BeatTranscript, label: string, who: BalanceRow['who']) => only(t, 'balances').find((b) => b.label === label)?.rows.find((r) => r.who === who);

const byBeat = new Map<number, BeatTranscript>();

beforeAll(async () => {
  const s = simchainSource();
  for (const b of s.beats()) byBeat.set(b, await s.run(b));
}, 60_000);

const beat = (n: number) => byBeat.get(n)!;

describe('SimChain source (T-012 beat runner)', () => {
  it('drives every beat: 1 to 7 and 10', () => {
    expect(simchainSource().beats()).toEqual([1, 2, 3, 4, 5, 6, 7, 10]);
  });

  it('labels every transcript as measured on SimChain', () => {
    for (const t of byBeat.values()) {
      expect(t.source.kind).toBe('simchain');
      expect(t.source.note).toMatch(/measured on SimChain/);
      expect(t.events.some((e) => e.standIn)).toBe(false);
    }
  });

  it('beat 1: the agents agree on adjudicators in two steps before the offer; Swiftline is excluded by the rulebook', () => {
    const t = beat(1);
    const proposal = only(t, 'adjudicator-proposal')[0]!;
    expect(proposal.actor).toBe('buyer');
    expect(proposal.proposed).toEqual({ primary: 'benchA', fallback: 'benchB', appeal: 'benchC' });
    const swift = proposal.considered.find((c) => c.name === 'Swiftline Verdicts')!;
    expect(swift.eligible).toBe(false);
    expect(swift.reasons.join(' ')).toMatch(/panelPolicyMin\.minFamilies/);
    const agreement = only(t, 'adjudicator-agreement')[0]!;
    expect(agreement).toMatchObject({ actor: 'seller', agreed: proposal.proposed });
    const offer = only(t, 'offer')[0]!;
    expect({ primary: offer.primary, fallback: offer.fallback, appeal: offer.appeal }).toEqual(agreement.agreed);
    expect(proposal.atMs).toBeLessThanOrEqual(agreement.atMs);
    expect(agreement.atMs).toBeLessThanOrEqual(offer.atMs);
    // Profiles for the viewer: the three benches and the declined listing, judges from the registry.
    const registered = new Set(demoRegistry().active.map((j) => j.model));
    expect(t.adjudicators?.map((a) => [a.name, a.selected])).toEqual([
      ['Clearfield Adjudication', 'primary'],
      ['Northgate Review', 'fallback'],
      ['Atrium Appeals', 'appeal'],
      ['Swiftline Verdicts', 'declined'],
    ]);
    for (const a of t.adjudicators!) for (const j of a.judges) expect(registered.has(j.model), j.model).toBe(true);
    expect(t.adjudicators!.every((a) => a.history.rolePlay)).toBe(true);
  });

  it('beat 1: offer, acceptance and a one-call hold through op-1, with the signed offer', () => {
    const t = beat(1);
    expect(t.events.map((e) => e.kind).filter((k) => k !== 'balances')).toEqual(['adjudicator-proposal', 'adjudicator-agreement', 'offer', 'signed', 'acceptance', 'hold']);
    expect(only(t, 'hold')[0]).toMatchObject({ amount: { token: 'tUSD', amount: '2050000000' }, via: 'op1' });
    expect(row(t, 'after hold', 'buyer')?.amount.amount).toBe('7950000000');
    expect(row(t, 'after hold', 'escrow')?.amount.amount).toBe('2050000000');
    expect(row(t, 'after hold', 'benchA')?.reserved?.amount).toBe('2000000000');
    expect(only(t, 'signed')[0]?.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('beats 1 to 4 are one job on one world, with one continuous timeline (T-019)', () => {
    expect(new Set([1, 2, 3, 4].map((b) => beat(b).commitmentId)).size).toBe(1);
    // Time never runs backwards from beat 1 into beat 4: the four beats are slices of one run.
    const times = [1, 2, 3, 4].flatMap((b) => beat(b).events.map((e) => e.atMs));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // The ledger beat 1 leaves is the ledger beat 2 starts from, and beat 4 ends where the job's record does.
    const after = (b: number, label: string) => only(beat(b), 'balances').find((x) => x.label === label)?.rows;
    expect(after(2, 'after delivery')).toEqual(after(1, 'after hold'));
    // The delivery is for the hold beat 1 funded: same escrow balance, and the decision stamps come after it.
    expect(only(beat(2), 'delivery')[0]!.atMs).toBeGreaterThanOrEqual(only(beat(1), 'hold')[0]!.atMs);
    // Only beat 1 carries the negotiation and the profiles.
    for (const b of [2, 3, 4]) {
      expect(beat(b).adjudicators).toBeUndefined();
      expect(only(beat(b), 'adjudicator-proposal')).toEqual([]);
    }
  });

  it('beat 3: every check passes and a panel of pinned config/judges.yaml models from two or more families accepts', () => {
    const t = beat(3);
    expect(only(t, 'checks')[0]?.results.every((r) => r.passed)).toBe(true);
    const panel = only(t, 'panel')[0]!;
    const registered = new Set(demoRegistry().active.map((j) => j.model));
    expect(panel.judges.length).toBe(3);
    for (const j of panel.judges) expect(registered.has(j.model), j.model).toBe(true);
    expect(new Set(panel.judges.map((j) => j.family)).size).toBeGreaterThanOrEqual(2);
    expect(panel.seedSource).toBe('commit-reveal');
    expect(only(t, 'decision')[0]).toMatchObject({ actor: 'benchA', role: 'primary', outcome: 'accept' });
  });

  it('beat 4: price to Tide-7, fee to Clearfield, key to Ledger, and the plaintext hash matches', () => {
    const t = beat(4);
    const s = only(t, 'settlement')[0]!;
    expect(s.settlement).toBe('release');
    expect(s.keyReleasedTo).toBe('buyer');
    expect(s.payouts.map((p) => [p.to, p.amount.amount])).toEqual([
      ['seller', '2000000000'],
      ['benchA', '50000000'],
    ]);
    expect(only(t, 'open')[0]).toMatchObject({ matchesDelivery: true, bytes: 511_912 });
    expect(row(t, 'after settlement', 'seller')?.amount.amount).toBe('2000000000');
  });

  it('beat 5: the rows check fails, Ledger is refunded, no key is released', () => {
    const t = beat(5);
    const failed = only(t, 'checks')[0]!.results.filter((r) => !r.passed).map((r) => r.id);
    expect(failed).toEqual(['rows']);
    const s = only(t, 'settlement')[0]!;
    expect(s.settlement).toBe('refund');
    expect(s.keyReleasedTo).toBeUndefined();
    expect(only(t, 'open')).toEqual([]);
    expect(row(t, 'after settlement', 'buyer')?.amount.amount).toBe('9950000000');
  });

  it('beat 6 (hidden tags): the screen flags tag characters and Ledger reads the file with 111 stripped', () => {
    const t = beat(6);
    // The second delivery in beat 6; the first is the base64 job (beat 6a).
    expect(only(t, 'screen').at(-1)).toMatchObject({ flagged: true, signals: ['unicode_tags'] });
    expect(only(t, 'open')[0]?.stripped).toEqual({ what: 'Unicode tag characters', count: 111 });
  });

  it('beat 10: a co-signed 70/30 split, fee back to Ledger, key released', () => {
    const t = beat(10);
    const s = only(t, 'settlement')[0]!;
    expect(s.settlement).toBe('mutual');
    expect(row(t, 'after settlement', 'buyer')?.amount.amount).toBe('8600000000');
    expect(row(t, 'after settlement', 'seller')?.amount.amount).toBe('1400000000');
    expect(row(t, 'after settlement', 'benchA')?.reserved?.amount).toBe('0');
  });

  it('labels scripted judges as scripted, with no task IDs in the source line (T-019)', () => {
    for (const t of byBeat.values()) {
      expect(t.mode).toBe('scripted');
      expect(t.source.note).not.toMatch(/\bT-\d+/);
      expect(t.source.note).toMatch(/scripted agents over the operator API; the adjudicator service with scripted judges/);
    }
  });

  it('gives each job its own commitment ID and seed commitment (T-019)', () => {
    const jobs = [1, 5, 6, 10].map((b) => beat(b));
    expect(new Set(jobs.map((t) => t.commitmentId)).size).toBe(4);
    expect(new Set(jobs.map((t) => only(t, 'acceptance')[0]?.seedCommitment)).size).toBe(4);
    // Beats 1 to 4 are one job: the hold in beat 1 is the hold judged in beat 3.
    expect(beat(1).commitmentId).toBe(beat(3).commitmentId);
  });

  it('beat 3: one judge prompt and its verdict, from the panel that sat (T-019)', () => {
    const t = beat(3);
    const [jp, ...more] = only(t, 'judge-prompt');
    expect(more).toEqual([]);
    const panel = only(t, 'panel')[0]!;
    expect(jp).toMatchObject({ actor: 'benchA', seat: 1, model: panel.judges[0]!.model, family: panel.judges[0]!.family, scripted: true });
    expect(jp!.inputHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(jp!.prompt.system[0]).toMatch(/You are one judge/);
    expect(jp!.prompt.user.head.some((l) => l.startsWith('<<<BEGIN UNTRUSTED DATA'))).toBe(true);
    expect(jp!.prompt.user.tail.at(-1)).toMatch(/^<<<END UNTRUSTED DATA/);
    expect(jp!.prompt.user.omitted).toBeGreaterThan(1000);
    expect(jp!.verdict?.overall).toBe('pass');
    expect(jp!.verdict?.criteria.map((c) => c.id)).toEqual(['no_fabrication', 'notes', 'dedupe_quality']);
  });

  it('beat 3: judging is stamped by the adjudicator service, and the decision says how long it took (T-019)', () => {
    const t = beat(3);
    const checks = only(t, 'checks')[0]!;
    const panel = only(t, 'panel')[0]!;
    const decision = only(t, 'decision')[0]!;
    expect(checks.atMs).toBeLessThanOrEqual(panel.atMs);
    expect(panel.atMs).toBeLessThanOrEqual(decision.atMs);
    const delivered = only(beat(2), 'delivery')[0]!;
    expect(checks.atMs).toBeGreaterThanOrEqual(delivered.atMs);
    expect(decision.timing?.afterDeliveryMs).toBe(decision.atMs - delivered.atMs);
    expect(decision.timing?.judgingMs).toBeGreaterThanOrEqual(0);
    expect(decision.timing?.judgingMs).toBeLessThanOrEqual(decision.timing!.afterDeliveryMs);
    expect(decision.timing?.panelMs).toBeGreaterThanOrEqual(0);
    // Checks and screen are stamped when they were done: when the first judge was called.
    expect(panel.atMs - checks.atMs).toBeLessThanOrEqual(decision.timing!.panelMs! + 1);
    // The parts are named and add up to the judging time.
    const parts = decision.timing!.parts!;
    expect(parts.map((p) => p.what)).toEqual([
      'reading the delivery and fetching its ciphertext',
      'decrypting, checks and screen',
      'panel of 3 scripted judges',
      'aggregating and publishing the signed record',
      'signing and submitting the decision',
    ]);
    expect(parts.reduce((s, p) => s + p.ms, 0)).toBe(decision.timing!.judgingMs);
    for (const p of parts) expect(p.ms).toBeGreaterThanOrEqual(0);
    // Beat 5 judged without a panel: the decision still carries its judging time, in named parts.
    const five = only(beat(5), 'decision')[0]!.timing!;
    expect(five.panelMs).toBeUndefined();
    expect(five.parts!.map((p) => p.what)).toEqual(['reading the delivery and fetching its ciphertext', 'decrypting, checks, screen and publishing the signed record', 'signing and submitting the decision']);
    expect(five.parts!.reduce((s, p) => s + p.ms, 0)).toBe(five.judgingMs);
  });

  it('ends every job with both parties holding the same record, each read through a different operator (D26)', () => {
    for (const b of [4, 5, 6, 10]) {
      const t = beat(b);
      const all = only(t, 'shared-record');
      // Beat 6 is two jobs, so two record lines; each job ends with its own.
      expect(all, `beat ${b}`).toHaveLength(b === 6 ? 2 : 1);
      expect(t.events.at(-1)?.kind, `beat ${b}`).toBe('shared-record');
      for (const r of all) {
        expect(r.match, `beat ${b}`).toBe(true);
        // Measured from the receipts each copy holds: Ledger's were signed by op-1, Tide-7's by op-2.
        expect(r.parties.map((p) => [p.who, p.via])).toEqual([
          ['buyer', 'op1'],
          ['seller', 'op2'],
        ]);
        expect(r.receipts).toBe(r.events);
      }
    }
    // Beat 6a's record is the one Atrium's appeal decision names.
    expect(only(beat(6), 'shared-record')[0]?.judgedBy).toBe('benchC');
    // Beat 7: op-2 is offline and op-1 refuses only writes, so both copies are read through op-1 (measured).
    const seven = only(beat(7), 'shared-record');
    expect(seven).toHaveLength(1);
    expect(seven[0]!.match).toBe(true);
    expect(seven[0]!.parties.map((p) => [p.who, p.via])).toEqual([
      ['buyer', 'op1'],
      ['seller', 'op1'],
    ]);
    expect(seven[0]!.judgedBy).toBe('benchB');
    // Beats 1 to 3 are the start of the job beat 4 ends; the record line comes once, at its end.
    for (const b of [1, 2, 3]) expect(only(beat(b), 'shared-record')).toEqual([]);
    expect(only(beat(4), 'shared-record')[0]?.judgedBy).toBe('benchA');
    expect(only(beat(4), 'shared-record')[0]?.judgmentRecord).toMatch(/^0x[0-9a-f]{64}$/);
    expect(only(beat(4), 'shared-record')[0]?.decision).toMatch(/^0x[0-9a-f]{64}$/);
    expect(only(beat(10), 'shared-record')[0]?.judgmentRecord).toBeUndefined();
  });

  it('conserves money and keeps measured times in order', () => {
    for (const t of byBeat.values()) {
      const sums = only(t, 'balances').map((b) => total(b.rows));
      expect(sums.length, `beat ${t.beat}`).toBeGreaterThan(0);
      expect(new Set(sums).size, `beat ${t.beat}`).toBe(1);
      const times = t.events.map((e) => e.atMs);
      expect(times, `beat ${t.beat}`).toEqual([...times].sort((a, b) => a - b));
      for (const ms of times) expect(Number.isInteger(ms) && ms >= 0).toBe(true);
    }
  });
});

describe('beat 6a on SimChain: base64 injection, escalation, appeal reject (T-018)', () => {
  it('the screen flags the first delivery, Clearfield escalates to Atrium, five scripted judges reject, Ledger is refunded and pays only the fee', () => {
    const t = beat(6);
    const screens = only(t, 'screen');
    expect(screens[0]!.flagged).toBe(true);
    expect(screens[0]!.actor).toBe('benchA');
    const [esc] = only(t, 'escalation');
    expect(esc).toMatchObject({ actor: 'benchA', to: 'benchC', panelSize: 5 });
    expect(esc!.families).toBeGreaterThanOrEqual(2);
    const panels = only(t, 'panel');
    expect(panels[1]).toMatchObject({ actor: 'benchC', seedSource: 'beacon', outcome: 'reject' });
    expect(panels[1]!.judges.map((j) => j.verdict)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail']);
    expect(screens[1]!.consequence).toMatch(/screen flagged; see screen\.signals/);
    const decisions = only(t, 'decision');
    expect(decisions[0]).toMatchObject({ actor: 'benchC', role: 'appeal', outcome: 'reject', via: 'direct' });
    const refund = only(t, 'settlement')[0]!;
    expect(refund.settlement).toBe('refund');
    expect(refund.keyReleasedTo).toBeUndefined();
    expect(row(t, 'after settlement', 'buyer')!.amount.amount).toBe((9_950n * 1_000_000n).toString());
    expect(row(t, 'after settlement', 'benchC')!.amount.amount).toBe((25_050n * 1_000_000n).toString());
    expect(row(t, 'after settlement', 'seller')!.amount.amount).toBe('0');
    expect(t.source.note).toMatch(/scripted verdicts/);
    // Both panels get a Markdown section, each named for its adjudicator.
    const md = renderMarkdown(t);
    expect(md).toMatch(/^## Panel: Clearfield Adjudication \(Bench A\)$/m);
    expect(md).toMatch(/^## Panel: Atrium Appeals \(Bench C\)$/m);
  });
});

describe('beat 7 on SimChain: nobody in control (T-018)', () => {
  it('op-1 refuses, op-2 relays then goes offline, the delivery goes direct, Clearfield is silent, Ledger triggers the fallback and Northgate releases', () => {
    const t = beat(7);
    const n = only(t, 'neutrality');
    expect(n.map((e) => [e.target, e.failure, e.via])).toEqual([
      ['op1', 'refused', 'op2'],
      ['op2', 'offline', 'direct'],
      ['benchA', 'offline', 'direct'],
    ]);
    expect(n[0]!.consequence).toMatch(/HTTP 403/);
    expect(n[0]!.consequence).toMatch(/4 write calls/);
    expect(only(t, 'hold')[0]!.via).toBe('op2');
    expect(only(t, 'delivery')[0]!.via).toBe('direct');
    expect(only(t, 'decision')).toEqual([expect.objectContaining({ actor: 'benchB', role: 'fallback', outcome: 'accept' })]);
    expect(only(t, 'panel')[0]!.seedSource).toBe('beacon');
    expect(only(t, 'settlement')[0]).toMatchObject({ settlement: 'release', keyReleasedTo: 'buyer' });
    expect(row(t, 'after settlement', 'seller')!.amount.amount).toBe((2_000n * 1_000_000n).toString());
    expect(row(t, 'after settlement', 'benchB')!.amount.amount).toBe((25_050n * 1_000_000n).toString());
    expect(row(t, 'after settlement', 'benchA')!.reserved!.amount).toBe('0');
    expect(only(t, 'open')[0]!.matchesDelivery).toBe(true);
    // The club operator is not in the flow: no revocation is narrated.
    expect(n.some((e) => e.failure === 'revoked')).toBe(false);
  });
});

describe('demo source', () => {
  it('is the SimChain source: beats 1 to 7 and 10, no stand-in events', async () => {
    const s = demoSource();
    expect(s.beats()).toEqual([1, 2, 3, 4, 5, 6, 7, 10]);
    expect(s.name).toBe('simchain');
  });
});
