import { demoRegistry } from '@holdback/demo/agents/bench.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BalanceRow, BeatTranscript, DemoEvent } from '../transcript/types.js';
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
  it('drives beats 1 to 5, the hidden-tags half of 6, and 10', () => {
    expect(simchainSource().beats()).toEqual([1, 2, 3, 4, 5, 6, 10]);
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

  it('beats 2 to 4 are one job', () => {
    expect(new Set([2, 3, 4].map((b) => beat(b).commitmentId)).size).toBe(1);
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
    expect(only(t, 'screen')[0]).toMatchObject({ flagged: true, signals: ['unicode_tags'] });
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

describe('demo source (SimChain plus labeled stand-in)', () => {
  it('offers beats 1 to 7 and 10; beat 7 is stand-in, beat 6 is mixed', async () => {
    const s = demoSource();
    expect(s.beats()).toEqual([1, 2, 3, 4, 5, 6, 7, 10]);
    expect((await s.run(7)).source.kind).toBe('stand-in');
    const six = await s.run(6);
    expect(six.source.kind).toBe('mixed');
    const flags = six.events.map((e) => e.standIn === true);
    const firstReal = flags.indexOf(false);
    expect(firstReal).toBeGreaterThan(0);
    expect(flags.slice(firstReal).every((f) => !f)).toBe(true);
    const times = six.events.map((e) => e.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(six.events.filter((e) => e.kind === 'balances' && e.standIn)).toEqual([]);
  }, 30_000);
});
