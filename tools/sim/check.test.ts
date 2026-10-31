// sim:check computes its invariants from the settlement log, the ledger and what the operators serve, and
// trusts no party's report. These tests drive every money path on a SimChain, check that an honest run
// passes, then forge or mutate the record in the ways a broken or dishonest world could, and expect the
// matching invariant to fail.
import { canonicalKeccak, type Hex32, type SettlementEvent } from '@holdback/core';
import { Deal, simActor, simCast, simClub, simGenesis, SIM_RULEBOOK, SimChain, tusd, type Cast } from '@holdback/settlement/sim';
import type { Submission } from '@holdback/settlement';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditOf, readsFromChain, type Audit, type OperatorRead } from './audit.ts';
import { checkRun, type CheckResult } from './check.ts';

const START = '2026-11-01T09:00:00Z';
const BOND = 25_000_000_000n;

interface Fixture {
  audit: Audit;
  reads: OperatorRead[];
  ids: Record<string, Hex32>;
  cast: Cast;
}

/** One deal per money path, all on one chain, then the clock moved past every window. */
async function run(): Promise<Fixture> {
  const cast = simCast('check');
  const club = simClub(simActor('club-operator', 'check').address, SIM_RULEBOOK);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 100_000_000_000n, seller: 10_000_000_000n }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } });
  const chain = new SimChain(genesis);
  const ok = async (s: Submission | Promise<Submission>) => {
    const r = await chain.submit(await s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
  };
  const deal = (tag: string) => new Deal(chain, cast, { club, tag, price: tusd('2000000000') });
  const delivered = async (d: Deal) => {
    await ok(d.offer());
    await ok(d.accept());
    await ok(d.agreeAndFund());
    await ok(d.deliver());
    chain.advance(5);
  };
  const ids: Record<string, Hex32> = {};

  const released = deal('released');
  await delivered(released);
  await ok(released.decide('primary', 'accept'));
  ids['released'] = released.id;

  const refunded = deal('refunded');
  await delivered(refunded);
  await ok(refunded.decide('primary', 'reject'));
  ids['refunded'] = refunded.id;

  const early = deal('early');
  await delivered(early);
  await ok(early.earlyAccept());
  ids['early'] = early.id;

  const settled = deal('settled');
  await delivered(settled);
  await ok(settled.mutual({ payouts: settled.split(1_400_000_000n), releaseKey: true }));
  ids['settled'] = settled.id;

  const overturned = deal('overturned');
  await delivered(overturned);
  await ok(overturned.decide('primary', 'reject'));
  await ok(overturned.appealBy('seller'));
  chain.advance(1);
  await ok(overturned.decide('appeal', 'accept'));
  ids['overturned'] = overturned.id;

  const upheld = deal('upheld');
  await delivered(upheld);
  await ok(upheld.decide('primary', 'accept'));
  await ok(upheld.appealBy('buyer'));
  chain.advance(1);
  await ok(upheld.decide('appeal', 'accept'));
  ids['upheld'] = upheld.id;

  const reclaimed = deal('reclaimed');
  await ok(reclaimed.offer());
  await ok(reclaimed.accept());
  await ok(reclaimed.agreeAndFund());
  ids['reclaimed'] = reclaimed.id;

  const defaulted = deal('defaulted');
  await delivered(defaulted);
  ids['defaulted'] = defaulted.id;

  const open = deal('open');
  await ok(open.offer());
  await ok(open.accept());
  ids['open'] = open.id;

  chain.advanceTo(reclaimed.terms.timing.deliverBy);
  await ok(reclaimed.trigger('reclaim'));
  chain.advanceTo(defaulted.terms.timing.judgeBy);
  await ok(defaulted.trigger('fallback'));
  chain.advanceTo(defaulted.terms.timing.fallbackBy);
  await ok(defaulted.trigger('default'));
  await ok(defaulted.trigger('apply_default'));
  chain.advance(3600); // every appeal window closes

  const audit = auditOf(chain, 'unit');
  const addresses = [cast.buyer.address, cast.seller.address];
  const reads = [await readsFromChain(chain, 'op-1', Object.values(ids), addresses), await readsFromChain(chain, 'op-2', Object.values(ids), addresses)];
  return { audit, reads, ids, cast };
}

const clone = <T>(v: T): T => structuredClone(v);
const failed = (r: CheckResult) => r.invariants.filter((i) => !i.ok).map((i) => i.id);
const check = (f: Fixture, over: Partial<Parameters<typeof checkRun>[0]> = {}) => checkRun({ audit: f.audit, reads: f.reads, requireJudgmentRecords: false, ...over });

/** Recomputes every hash from `from` on, as a forger who controls the whole log would. */
function rehash(log: SettlementEvent[], from = 0): void {
  for (let i = from; i < log.length; i++) {
    const e = log[i]!;
    const { hash: _drop, ...rest } = e;
    void _drop;
    const body = { ...rest, prevHash: i === 0 ? (`0x${'00'.repeat(32)}` as Hex32) : log[i - 1]!.hash };
    log[i] = { ...body, hash: canonicalKeccak(body) } as SettlementEvent;
  }
}

/** Moves `amount` base units between two ledger accounts of the audit. */
function move(a: Audit, from: string, to: string, amount: bigint): void {
  a.ledger[from] = (BigInt(a.ledger[from] ?? '0') - amount).toString();
  a.ledger[to] = (BigInt(a.ledger[to] ?? '0') + amount).toString();
}

let f: Fixture;
beforeAll(async () => {
  f = await run();
}, 60_000);

describe('sim:check on an honest run', () => {
  it('passes every invariant and explains each commitment', async () => {
    const r = await check(f);
    expect(failed(r), JSON.stringify(r.invariants, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    const status = Object.fromEntries(r.commitments.map((c) => [c.id, c.status]));
    for (const k of ['released', 'refunded', 'early', 'settled', 'overturned', 'upheld', 'reclaimed', 'defaulted']) expect(status[f.ids[k]!], k).toBe('final');
    const open = r.commitments.find((c) => c.id === f.ids['open'])!;
    expect(open.status).toBe('open');
    expect(open.explanation).toMatch(/expire-offer/);
    expect(r.totals[0]!.minted).toBe(r.totals[0]!.ledger);
  });

  it('reports a party whose report disagrees with the record as a finding, not a violation', async () => {
    const reports = [
      { party: 'buyer-1', address: f.cast.buyer.address, commitments: [{ id: f.ids['released']!, role: 'buyer' as const, finalState: 'Refunded' }] },
      { party: 'seller-1', address: f.cast.seller.address, commitments: [{ id: f.ids['released']!, role: 'seller' as const, finalState: 'Released' }] },
    ];
    const r = await check(f, { reports });
    expect(r.ok).toBe(true);
    expect(r.findings.join('\n')).toMatch(/buyer-1 reports .* Refunded; the record says Released/);
    expect(r.findings.join('\n')).toMatch(/buyer-1 and seller-1 disagree/);
  });
});

describe('sim:check catches a violation', () => {
  it('a mutated ledger: units moved between parties with no posting (conservation per account)', async () => {
    const audit = clone(f.audit);
    move(audit, f.cast.buyer.address, f.cast.seller.address, 1n);
    const r = await check(f, { audit });
    expect(r.ok).toBe(false);
    expect(failed(r)).toContain('conservation');
    expect(r.invariants.find((i) => i.id === 'conservation')!.violations.join('\n')).toMatch(/replayed from the log/);
  });

  it('a mutated ledger: units created from nothing (total conservation)', async () => {
    const audit = clone(f.audit);
    audit.ledger[f.cast.seller.address] = (BigInt(audit.ledger[f.cast.seller.address]!) + 1_000_000n).toString();
    const r = await check(f, { audit });
    expect(failed(r)).toContain('conservation');
    expect(r.invariants.find((i) => i.id === 'conservation')!.violations.join('\n')).toMatch(/ledger sums to .* minted/);
  });

  it('a forged posting with a valid hash chain and a matching ledger: the price paid to an outsider (within terms)', async () => {
    const audit = clone(f.audit);
    const outsider = simActor('outsider', 'check').address.toLowerCase();
    const i = audit.log.findIndex((e) => e.type === 'settlement.released' && e.commitmentId === f.ids['released']);
    const ev = audit.log[i]!;
    const postings = (ev.payload['postings'] as Array<{ from: string; to: string; amount: { amount: string } }>).map((p) => (p.to === f.cast.seller.address.toLowerCase() ? { ...p, to: outsider } : p));
    audit.log[i] = { ...ev, payload: { ...ev.payload, postings } };
    rehash(audit.log, i);
    move(audit, f.cast.seller.address.toLowerCase(), outsider, 2_000_000_000n);
    const reads = f.reads.map((o) => ({ ...o, commitments: Object.fromEntries(Object.entries(o.commitments).map(([id, c]) => [id, { ...c, events: audit.log.filter((e) => e.commitmentId === id) }])) }));
    const r = await check(f, { audit, reads });
    expect(failed(r)).toEqual(['within-terms']);
    expect(r.invariants.find((i) => i.id === 'within-terms')!.violations.join('\n')).toMatch(new RegExp(`${outsider}`));
  });

  it('a forged release with no signed decision behind it (within terms and conservation)', async () => {
    const audit = clone(f.audit);
    const id = f.ids['open']!;
    const last = audit.log.at(-1)!;
    const forged = {
      seq: last.seq + 1,
      type: 'settlement.released',
      commitmentId: id,
      at: last.at,
      actor: f.cast.primary.address,
      submittedVia: 'direct',
      payload: { postings: [{ from: `escrow:${id}`, to: f.cast.seller.address.toLowerCase(), amount: { token: 'tUSD', amount: '2000000000' }, why: 'price to the seller' }] },
      prevHash: last.hash,
    };
    audit.log.push({ ...forged, hash: canonicalKeccak(forged) } as SettlementEvent);
    const r = await check(f, { audit });
    expect(failed(r)).toEqual(expect.arrayContaining(['within-terms', 'conservation']));
    expect(r.invariants.find((i) => i.id === 'within-terms')!.violations.join('\n')).toMatch(/no judgment\.decided|no signed/);
  });

  it('an edited event without a rehash (log integrity)', async () => {
    const audit = clone(f.audit);
    const i = audit.log.findIndex((e) => e.type === 'hold.funded');
    audit.log[i] = { ...audit.log[i]!, actor: f.cast.seller.address };
    expect(failed(await check(f, { audit }))).toContain('log-integrity');
  });

  it('an operator that hides an event from a party (records match)', async () => {
    const reads = clone(f.reads);
    const c = reads[1]!.commitments[f.ids['overturned']!]!;
    c.events = c.events.filter((e) => e.type !== 'bond.slashed');
    const r = await check(f, { reads });
    expect(failed(r)).toEqual(['records-match']);
    expect(r.invariants.find((i) => i.id === 'records-match')!.violations.join('\n')).toMatch(/op-2/);
  });

  it('a commitment whose held money does not match its state (terminal or explained)', async () => {
    const reads = clone(f.reads);
    for (const o of reads) o.commitments[f.ids['open']!]!.view!.escrowState = 'Held';
    const r = await check(f, { reads });
    expect(failed(r)).toContain('terminal-or-explained');
  });
});
