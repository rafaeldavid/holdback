// fast-check properties for SimChain (T-006): conservation, no negative balances, settle-once, reserved bond
// never counted twice, idempotent resubmission, dry runs with no effects, and random interleavings of
// messages and permissionless triggers. Seeds are fixed so the suite and the mutation sweep are reproducible.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Submission, TimeoutKind } from '../src/interface.js';
import { TIMEOUT_KINDS } from '../src/interface.js';
import { Deal, simActor, simCast, simClub, simGenesis, SIM_RULEBOOK, tusd, type Cast } from './actors.js';
import { account, SimChain, type Genesis } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const SEED = 20261031;
const TERMINAL = new Set(['Released', 'Refunded', 'Settled', 'Expired']);
const SETTLING = new Set(['settlement.released', 'settlement.refunded', 'settlement.reclaimed', 'commitment.settled']);

interface Params {
  prices: bigint[];
  compBps: number;
  bondBps: number;
  junior: bigint;
  senior: bigint;
}

async function build(p: Params): Promise<{ chain: SimChain; genesis: Genesis; deals: Deal[]; cast: Cast }> {
  const cast = simCast('prop');
  const rulebook = { ...SIM_RULEBOOK, appealBondRateBps: p.bondBps, defaultOutcome: { judged: { refundBuyer: true as const, sellerCompensationRateBps: p.compBps } } };
  const club = simClub(simActor('club-operator', 'prop').address, rulebook);
  const genesis = await simGenesis({
    cast,
    club,
    start: START,
    balances: { buyer: 30_000_000_000n, seller: 2_000_000_000n },
    bonds: { primary: p.junior, fallback: p.junior, appeal: p.junior },
    // Phase 1 has no deposit API; tests add senior stake so the loss waterfall runs (ADR-0014 §2a).
    seniorForTests: { primary: p.senior, fallback: p.senior, appeal: p.senior },
  });
  const chain = new SimChain(genesis);
  const deals = p.prices.map((price, i) => new Deal(chain, cast, { club, price: tusd(price), tag: `prop-${i}` }));
  return { chain, genesis, deals, cast };
}

/** Every invariant the postings table promises, checked against the whole ledger. */
function checkInvariants(chain: SimChain, cast: Cast): void {
  const ledger = chain.ledger();
  const total = Object.values(ledger).reduce((a, b) => a + b, 0n);
  expect(total, 'conservation').toBe(chain.minted());
  for (const [k, v] of Object.entries(ledger)) expect(v >= 0n, `negative balance ${k}`).toBe(true);
  const settlements = new Map<string, number>();
  for (const e of chain.log()) if (SETTLING.has(e.type)) settlements.set(e.commitmentId!, (settlements.get(e.commitmentId!) ?? 0) + 1);
  for (const [id, n] of settlements) expect(n, `settled more than once: ${id}`).toBe(1);
  const byAdjudicator = new Map<string, bigint>();
  for (const r of chain.reservations()) {
    expect(r.amount >= 0n).toBe(true);
    byAdjudicator.set(r.adjudicator, (byAdjudicator.get(r.adjudicator) ?? 0n) + r.amount);
  }
  for (const a of [cast.primary, cast.fallback, cast.appeal]) {
    const pool = chain.pool(a.address);
    expect(pool.reserved, `reserved counter equals the sum of reservations for ${a.name}`).toBe(byAdjudicator.get(a.address.toLowerCase()) ?? 0n);
    expect(pool.reserved <= pool.junior + pool.senior, `reserved bond is backed for ${a.name}`).toBe(true);
  }
}

function checkCommitments(chain: SimChain, deals: Deal[]): void {
  const ledger = chain.ledger();
  for (const d of deals) {
    const s = chain.escrowState(d.id);
    if (!s) continue;
    const escrow = ledger[account.escrow(d.id)] ?? 0n;
    if (TERMINAL.has(s.kind)) expect(escrow, `escrow empty once ${s.kind}`).toBe(0n);
    if ('hold' in s) expect(escrow, `escrow holds the hold in ${s.kind}`).toBe(BigInt(s.hold.amount.amount));
    const appealOpen = (s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open';
    if (!appealOpen) {
      expect(ledger[account.appealBond(d.id)] ?? 0n).toBe(0n);
      expect(ledger[account.appealFee(d.id)] ?? 0n).toBe(0n);
    }
    // Nothing remains reserved once the commitment can no longer be appealed.
    const appealable = (s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && (s.via.appeal.kind === 'none' || s.via.appeal.kind === 'open');
    const live = !TERMINAL.has(s.kind) || appealable;
    if (!live) expect(chain.reservations().filter((r) => r.commitmentId === d.id && r.amount > 0n)).toEqual([]);
  }
}

type Action =
  | { a: 'next'; d: number }
  | { a: 'decide'; d: number; role: 'primary' | 'fallback' | 'appeal'; outcome: 'accept' | 'reject' | 'escalate' }
  | { a: 'early'; d: number }
  | { a: 'appeal'; d: number; who: 'buyer' | 'seller' }
  | { a: 'mutual'; d: number; sellerBps: number; releaseKey: boolean; over: boolean }
  | { a: 'trigger'; d: number; kind: TimeoutKind }
  | { a: 'advance'; seconds: number }
  /** Jumps to the deadline the deal's state waits on and fires the matching permissionless trigger. */
  | { a: 'timeout'; d: number }
  | { a: 'resubmit' }
  | { a: 'validate'; d: number };

const deal = fc.integer({ min: 0, max: 2 });
const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: deal.map((d) => ({ a: 'next' as const, d })) },
  { weight: 3, arbitrary: fc.record({ a: fc.constant('decide' as const), d: deal, role: fc.constantFrom('primary' as const, 'fallback' as const, 'appeal' as const), outcome: fc.constantFrom('accept' as const, 'reject' as const, 'escalate' as const) }) },
  { weight: 1, arbitrary: deal.map((d) => ({ a: 'early' as const, d })) },
  { weight: 2, arbitrary: fc.record({ a: fc.constant('appeal' as const), d: deal, who: fc.constantFrom('buyer' as const, 'seller' as const) }) },
  { weight: 1, arbitrary: fc.record({ a: fc.constant('mutual' as const), d: deal, sellerBps: fc.integer({ min: 0, max: 10000 }), releaseKey: fc.boolean(), over: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ a: fc.constant('trigger' as const), d: deal, kind: fc.constantFrom(...TIMEOUT_KINDS) }) },
  { weight: 3, arbitrary: fc.constantFrom(1, 5, 60, 300, 600, 1200, 3600).map((seconds) => ({ a: 'advance' as const, seconds })) },
  { weight: 3, arbitrary: deal.map((d) => ({ a: 'timeout' as const, d })) },
  { weight: 1, arbitrary: fc.constant({ a: 'resubmit' as const }) },
  { weight: 1, arbitrary: deal.map((d) => ({ a: 'validate' as const, d })) },
);

const params: fc.Arbitrary<Params> = fc.record({
  prices: fc.array(fc.bigInt({ min: 1n, max: 3_000_000_000n }), { minLength: 3, maxLength: 3 }),
  compBps: fc.integer({ min: 0, max: 10000 }),
  bondBps: fc.integer({ min: 0, max: 10000 }),
  junior: fc.constantFrom(500_000_000n, 3_000_000_000n, 8_000_000_000n),
  senior: fc.constantFrom(0n, 1_500_000_000n, 4_000_000_000n),
});

/** The happy-path step that would move a deal along from its current state. */
async function nextFor(chain: SimChain, d: Deal): Promise<Submission | null> {
  const s = chain.escrowState(d.id);
  if (!s) return d.offer();
  switch (s.kind) {
    case 'Offered':
      return d.accept();
    case 'AcceptedByAdjudicator':
      return d.agreeAndFund();
    case 'Held':
      return d.deliver();
    case 'Delivered':
      return d.decide('primary', 'accept');
    case 'FallbackJudging':
      return d.decide('fallback', 'reject');
    case 'Escalated':
      return d.decide('appeal', 'accept');
    case 'Defaulted':
      return d.trigger('apply_default');
    case 'Released':
    case 'Refunded':
      // An open appeal: overturn it, so the bond pays out.
      return s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' ? d.decide('appeal', s.kind === 'Released' ? 'reject' : 'accept') : null;
    default:
      return null;
  }
}

/** The deadline a state waits on and the trigger that fires at it. */
function timeoutFor(chain: SimChain, d: Deal): { at: string; kind: TimeoutKind } | null {
  const s = chain.escrowState(d.id);
  if (!s) return null;
  const t = d.terms.timing;
  switch (s.kind) {
    // Early expiry comes from plain clock advances; jumping here would expire every other deal at once.
    case 'Held':
      return { at: t.deliverBy, kind: 'reclaim' };
    case 'Delivered':
      return { at: t.judgeBy, kind: 'fallback' };
    case 'FallbackJudging':
      return { at: t.fallbackBy, kind: 'default' };
    case 'Escalated':
      return { at: s.escalation.appealDecideBy, kind: 'default' };
    case 'Defaulted':
      return { at: chain.now(), kind: 'apply_default' };
    case 'Released':
    case 'Refunded':
      if (s.via.kind !== 'first_instance') return null;
      if (s.via.appeal.kind === 'none') return { at: s.via.appeal.appealBy, kind: 'appeal_expiry' };
      if (s.via.appeal.kind === 'open') return { at: s.via.appeal.appealDecideBy, kind: 'appeal_expiry' };
      return null;
    default:
      return null;
  }
}

async function toSubmission(chain: SimChain, deals: Deal[], x: Action, bondBps: number): Promise<Submission | null> {
  if (x.a === 'advance' || x.a === 'resubmit') return null;
  const d = deals[x.d]!;
  switch (x.a) {
    case 'timeout': {
      const t = timeoutFor(chain, d);
      if (!t) return null;
      chain.advanceTo(t.at);
      return d.trigger(t.kind);
    }
    case 'next':
    case 'validate':
      return nextFor(chain, d);
    case 'decide':
      return x.role === 'appeal' && x.outcome === 'escalate' ? d.decide('appeal', 'accept') : d.decide(x.role, x.outcome);
    case 'early':
      return d.earlyAccept();
    case 'appeal':
      // The required bond rounded up (ADR-0022 rule 1), so honest appeals are not refused for the bond.
      return d.appealBy(x.who, tusd((BigInt(d.terms.price.amount) * BigInt(bondBps) + 9999n) / 10000n));
    case 'mutual': {
      const price = BigInt(d.terms.price.amount);
      const seller = x.over ? price + 1n : (price * BigInt(x.sellerBps)) / 10000n;
      return d.mutual({ sellerAmount: tusd(seller), releaseKey: x.releaseKey && d.delivery !== null });
    }
    case 'trigger':
      return d.trigger(x.kind);
  }
}

describe('random interleavings of messages and triggers', () => {
  it('keep every ledger invariant, settle each commitment once, and replay to the same state', async () => {
    let applied = 0;
    let refusedCount = 0;
    const kinds = new Set<string>();
    await fc.assert(
      fc.asyncProperty(params, fc.array(action, { minLength: 20, maxLength: 60 }), async (p, actions) => {
        const { chain, genesis, deals, cast } = await build(p);
        let last: { submission: Submission; key: string } | null = null;
        let n = 0;
        for (const x of actions) {
          if (x.a === 'advance') {
            chain.advance(x.seconds);
          } else if (x.a === 'resubmit') {
            if (last) {
              const before = chain.digest();
              const again = await chain.submit(last.submission, { idempotencyKey: last.key });
              expect(again.ok && again.replayed, 'same key and body replays').toBe(true);
              const bare = await chain.submit(last.submission);
              expect(bare.ok, 'a resubmitted message without a key is refused').toBe(false);
              expect(chain.digest(), 'resubmission has no effect').toBe(before);
            }
          } else if (x.a === 'validate') {
            const s = await toSubmission(chain, deals, x, p.bondBps);
            if (s) {
              const before = chain.digest();
              const log = chain.log().length;
              await chain.validate(s);
              expect(chain.digest(), 'a dry run has no effects').toBe(before);
              expect(chain.log().length).toBe(log);
            }
          } else {
            const s = await toSubmission(chain, deals, x, p.bondBps);
            if (s) {
              const key = `k${n++}`;
              const r = await chain.submit(s, { idempotencyKey: key });
              if (r.ok) {
                applied++;
                last = { submission: s, key };
                for (const e of r.events) kinds.add(e.type);
              } else refusedCount++;
            }
          }
          checkInvariants(chain, cast);
          checkCommitments(chain, deals);
        }
        expect(SimChain.verifyLog(chain.log())).toBe(true);
        const replayed = await SimChain.replay(genesis, chain.journal());
        expect(replayed.digest()).toBe(chain.digest());
      }),
      { numRuns: 120, seed: SEED },
    );
    // The generator reaches deep paths, not just refusals.
    // Measured at seed 20261031: 483 applied, 2187 refused. Bond payouts are exercised by the pool properties below.
    expect(applied).toBeGreaterThan(400);
    expect(refusedCount).toBeGreaterThan(1000);
    for (const k of ['settlement.released', 'settlement.refunded', 'settlement.reclaimed', 'offer.expired', 'appeal.filed', 'appeal.expired', 'fallback.triggered', 'default.triggered', 'commitment.settled']) expect(kinds, k).toContain(k);
  }, 300_000);
});

describe('settle-once race between a mutual settlement and a decision', () => {
  it('applies whichever arrives first and refuses the other, in either order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.integer({ min: 0, max: 10000 }), fc.constantFrom('accept' as const, 'reject' as const), async (settleFirst, bps, outcome) => {
        const { chain, deals, cast } = await build({ prices: [2_000_000_000n], compBps: 1000, bondBps: 500, junior: 3_000_000_000n, senior: 0n });
        const d = deals[0]!;
        for (const s of [d.offer(), d.accept(), d.agreeAndFund(), d.deliver()]) expect((await chain.submit(await s)).ok).toBe(true);
        const settle = await d.mutual({ sellerAmount: tusd((2_000_000_000n * BigInt(bps)) / 10000n) });
        const decide = await d.decide('primary', outcome);
        const [first, second] = settleFirst ? [settle, decide] : [decide, settle];
        // Submitted concurrently: the queue applies them in arrival order.
        const [a, b] = await Promise.all([chain.submit(first), chain.submit(second)]);
        expect(a.ok).toBe(true);
        expect(b.ok ? 'ok' : b.problem.type).toBe('invalid_state');
        expect(chain.escrowState(d.id)?.kind).toBe(settleFirst ? 'Settled' : outcome === 'accept' ? 'Released' : 'Refunded');
        checkInvariants(chain, cast);
      }),
      { numRuns: 20, seed: SEED },
    );
  }, 120_000);
});

describe('bond pools (ADR-0014 §2a)', () => {
  it('takes an overturn from junior first, then senior, and never beyond the commitment reservation', async () => {
    const { chain, deals, cast } = await build({ prices: [2_000_000_000n], compBps: 1000, bondBps: 500, junior: 500_000_000n, senior: 4_000_000_000n });
    const d = deals[0]!;
    for (const s of [d.offer(), d.accept(), d.agreeAndFund(), d.deliver()]) expect((await chain.submit(await s)).ok).toBe(true);
    expect((await chain.submit(await d.decide('primary', 'reject'))).ok).toBe(true);
    expect((await chain.submit(await d.appealBy('seller'))).ok).toBe(true);
    chain.advance(1);
    expect((await chain.submit(await d.decide('appeal', 'accept'))).ok).toBe(true);
    expect(chain.pool(cast.primary.address)).toEqual({ junior: 0n, senior: 2_500_000_000n, reserved: 0n });
  });

  it('pays a default from bonds rounded down, so the bonds keep the dust', async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 1n, max: 3_000_000_000n }), fc.integer({ min: 0, max: 10000 }), async (price, compBps) => {
        const { chain, deals, cast } = await build({ prices: [price], compBps, bondBps: 500, junior: 5_000_000_000n, senior: 0n });
        const d = deals[0]!;
        for (const s of [d.offer(), d.accept(), d.agreeAndFund(), d.deliver()]) expect((await chain.submit(await s)).ok).toBe(true);
        const sellerBefore = BigInt((await chain.balances([cast.seller.address]))[cast.seller.address]!.amount);
        chain.advanceTo(d.terms.timing.judgeBy);
        expect((await chain.submit(d.trigger('fallback'))).ok).toBe(true);
        chain.advanceTo(d.terms.timing.fallbackBy);
        expect((await chain.submit(d.trigger('default'))).ok).toBe(true);
        expect((await chain.submit(d.trigger('apply_default'))).ok).toBe(true);
        const sellerAfter = BigInt((await chain.balances([cast.seller.address]))[cast.seller.address]!.amount);
        expect(sellerAfter - sellerBefore).toBe((price * BigInt(compBps)) / 10000n);
        checkInvariants(chain, cast);
      }),
      { numRuns: 15, seed: SEED },
    );
  }, 120_000);
});
