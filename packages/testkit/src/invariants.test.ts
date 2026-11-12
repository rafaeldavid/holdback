import { describe, expect, it } from 'vitest';
import { checkInvariants, type LedgerView } from './stub-settlement.js';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const;
const GENESIS = H(0);
const ev = (seq: number, type: LedgerView['events'][number]['type'], step: number) => ({ seq, step, type, hash: H(seq + 1), prevHash: seq === 0 ? GENESIS : H(seq) });

/** A consistent ledger after a released commitment. */
const good = (): LedgerView => ({
  balances: { buyer: 7950n, escrow: 0n, seller: 2000n, adj: 25050n },
  faucetTotal: 35000n,
  events: [ev(0, 'commitment.offered', 1), ev(1, 'hold.funded', 2), ev(2, 'judgment.decided', 3), ev(3, 'settlement.released', 3), ev(4, 'key.released', 3)],
  finalState: 'Released',
  releasedByDecision: true,
  keyForBuyer: true,
  settledWithKey: false,
  replayOk: true,
});

/** A consistent ledger after a mutual settlement that releases the key (ADR-0019). */
const settled = (): LedgerView => ({
  ...good(),
  events: [ev(0, 'commitment.offered', 1), ev(1, 'hold.funded', 2), ev(2, 'commitment.settled', 3), ev(3, 'key.released', 3)],
  finalState: 'Settled',
  releasedByDecision: false,
  keyForBuyer: false,
  settledWithKey: true,
});
const broken = (v: LedgerView) => checkInvariants(v).filter((i) => !i.ok).map((i) => i.name);

describe('ledger invariants', () => {
  it('all hold on a consistent ledger', () => {
    expect(broken(good())).toEqual([]);
  });

  it('catches money created or destroyed', () => {
    expect(broken({ ...good(), balances: { ...good().balances, seller: 2001n } })).toEqual(['conservation']);
  });

  it('catches a negative balance even when the total is conserved', () => {
    expect(broken({ ...good(), balances: { buyer: -50n, escrow: 0n, seller: 10000n, adj: 25050n } })).toEqual(['no negative balances']);
  });

  it('catches a second settlement', () => {
    const v = good();
    v.events.push(ev(5, 'settlement.refunded', 4));
    expect(broken(v)).toEqual(['settled once']);
  });

  it('catches money left in escrow after settlement', () => {
    expect(broken({ ...good(), balances: { buyer: 7950n, escrow: 50n, seller: 2000n, adj: 25000n } })).toEqual(['escrow empty after settlement']);
  });

  it('catches a key released apart from the payment, or not at all', () => {
    const v = good();
    v.events[4] = { ...v.events[4]!, step: 4 };
    expect(broken(v)).toEqual(['key released atomically with payment']);
    expect(broken({ ...good(), keyForBuyer: false })).toEqual(['key released atomically with payment']);
    expect(broken({ ...good(), events: good().events.slice(0, 4) })).toEqual(['key released atomically with payment']);
  });

  it('holds for a mutual settlement that releases the key in its paying step (T-357 review, L4)', () => {
    expect(broken(settled())).toEqual([]);
    const inv = checkInvariants(settled()).find((i) => i.name === 'key released atomically with payment')!;
    expect(inv.note).toBeUndefined();
  });

  it('catches a mutual settlement whose key is released apart from it, or not at all', () => {
    const v = settled();
    v.events[3] = { ...v.events[3]!, step: 4 };
    expect(broken(v)).toEqual(['key released atomically with payment']);
    expect(broken({ ...settled(), events: settled().events.slice(0, 3) })).toEqual(['key released atomically with payment']);
  });

  it('marks the key invariant n/a for a mutual settlement that keeps the key held', () => {
    const v: LedgerView = { ...settled(), settledWithKey: false, events: settled().events.slice(0, 3) };
    expect(broken(v)).toEqual([]);
    expect(checkInvariants(v).find((i) => i.name === 'key released atomically with payment')!.note).toBe('n/a');
  });

  it('catches a broken hash chain', () => {
    const v = good();
    v.events[2] = { ...v.events[2]!, prevHash: H(99) };
    expect(broken(v)).toEqual(['event hash chain links']);
    const w = good();
    w.events[0] = { ...w.events[0]!, prevHash: H(7) };
    expect(broken(w)).toEqual(['event hash chain links']);
  });

  it('catches a replay that disagrees with the settlement state', () => {
    expect(broken({ ...good(), replayOk: false })).toEqual(['replay matches the settlement state']);
  });

  it('marks settlement-only invariants n/a before settlement', () => {
    const v: LedgerView = { ...good(), finalState: 'Held', releasedByDecision: false, keyForBuyer: false, settledWithKey: false, balances: { buyer: 7950n, escrow: 2050n, seller: 0n, adj: 25000n }, events: good().events.slice(0, 2) };
    const inv = checkInvariants(v);
    expect(inv.filter((i) => !i.ok)).toEqual([]);
    expect(inv.filter((i) => i.note === 'n/a').map((i) => i.name)).toEqual(['escrow empty after settlement', 'key released atomically with payment']);
  });
});
