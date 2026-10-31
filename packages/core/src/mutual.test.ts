import { describe, expect, it } from 'vitest';
import { mutualSettlementProblem } from './mutual.js';
import type { MutualSettlement } from './types.js';

// D23 amends ADR-0019: a co-signed settlement may pay any addresses, in any split that sums to the price.
const BUYER = '0x1111111111111111111111111111111111111111';
const SELLER = '0x2222222222222222222222222222222222222222';
const THIRD = '0x9999999999999999999999999999999999999999';
const terms = { buyer: BUYER, seller: SELLER, price: { token: 'tUSD', amount: '2000000000' } } as unknown as Parameters<typeof mutualSettlementProblem>[1];
const pay = (to: string, amount: string) => ({ to, amount: { token: 'tUSD', amount } });
const settlement = (payouts: ReturnType<typeof pay>[]): MutualSettlement =>
  ({
    type: 'MutualSettlement',
    commitmentId: `0x${'01'.repeat(32)}`,
    deliveryHash: `0x${'16'.repeat(32)}`,
    payouts,
    releaseKey: true,
    nonce: `0x${'17'.repeat(32)}`,
    expiresAt: '2026-11-01T10:02:00Z',
    buyerSignature: '0x',
    sellerSignature: '0x',
  }) as unknown as MutualSettlement;

describe('mutualSettlementProblem (D23)', () => {
  it('accepts a split between the parties that sums to the price', () => {
    expect(mutualSettlementProblem(settlement([pay(SELLER, '1400000000'), pay(BUYER, '600000000')]), terms, { allowed: true, payoutsTo: 'parties' })).toBeUndefined();
  });

  it('accepts the whole hold sent to a third address when the rulebook allows any recipient', () => {
    expect(mutualSettlementProblem(settlement([pay(THIRD, '2000000000')]), terms, { allowed: true, payoutsTo: 'any' })).toBeUndefined();
  });

  it('refuses a third-party payout when the rulebook restricts payouts to the parties', () => {
    expect(mutualSettlementProblem(settlement([pay(SELLER, '1000000000'), pay(THIRD, '1000000000')]), terms, { allowed: true, payoutsTo: 'parties' })).toContain('not a party');
  });

  it.each([
    ['short by one base unit', [pay(SELLER, '1999999999')]],
    ['over by one base unit', [pay(SELLER, '1000000000'), pay(BUYER, '1000000001')]],
  ])('refuses payouts %s', (_label, payouts) => {
    expect(mutualSettlementProblem(settlement(payouts), terms, { allowed: true, payoutsTo: 'any' })).toContain('must equal the price');
  });

  it('refuses payouts in a token other than the price token', () => {
    const p = settlement([{ to: SELLER, amount: { token: 'tEUR', amount: '2000000000' } }]);
    expect(mutualSettlementProblem(p, terms, { allowed: true, payoutsTo: 'any' })).toContain('price token');
  });

  it('refuses any settlement when the rulebook does not allow mutual settlement', () => {
    expect(mutualSettlementProblem(settlement([pay(SELLER, '2000000000')]), terms, { allowed: false, payoutsTo: 'any' })).toContain('not allowed');
  });

  it('matches party addresses in any letter case', () => {
    const upper = '0x' + SELLER.slice(2).toUpperCase();
    expect(mutualSettlementProblem(settlement([pay(upper, '2000000000')]), terms, { allowed: true, payoutsTo: 'parties' })).toBeUndefined();
  });
});
