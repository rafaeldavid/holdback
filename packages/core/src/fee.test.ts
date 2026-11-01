// The operator fee rule (ADR-0023, D33): max(min, ceil(price x bps / 10000)), capped at max, in the price token.
import { describe, expect, it } from 'vitest';
import { operatorFeeDue, type OperatorFeeSchedule } from './fee.js';
import type { TokenAmount } from './types.js';

const D33: OperatorFeeSchedule = { to: '0x7e3b0c55e1c0d1a2b3c4d5e6f708192a3b4c5d6e', token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false };
const tusd = (amount: string) => ({ token: 'tUSD', amount }) as TokenAmount;

describe('operatorFeeDue', () => {
  it('fee.min-applies-below-100: below 100 tUSD the 0.01 tUSD minimum applies', () => {
    expect(operatorFeeDue(tusd('25000000'), D33)).toEqual(tusd('10000'));
    expect(operatorFeeDue(tusd('99999999'), D33)).toEqual(tusd('10000'));
    expect(operatorFeeDue(tusd('100000000'), D33)).toEqual(tusd('10000'));
    expect(operatorFeeDue(tusd('0'), D33)).toEqual(tusd('10000'));
  });

  it('fee.bps-rounds-up: above the minimum, 1 bp of the price rounded up in base units', () => {
    expect(operatorFeeDue(tusd('100000001'), D33)).toEqual(tusd('10001'));
    expect(operatorFeeDue(tusd('2000000000'), D33)).toEqual(tusd('200000'));
    expect(operatorFeeDue(tusd('2000000001'), D33)).toEqual(tusd('200001'));
  });

  it('caps at max when one is published, and charges nothing at 0 / 0 or in another token', () => {
    expect(operatorFeeDue(tusd('10000000000000'), { ...D33, max: '500000' })).toEqual(tusd('500000'));
    expect(operatorFeeDue(tusd('2000000000'), { ...D33, bps: 0, min: '0' })).toEqual(tusd('0'));
    expect(operatorFeeDue({ token: 'tEUR', amount: '2000000000' } as TokenAmount, D33)).toEqual({ token: 'tEUR', amount: '0' });
  });

  it('never uses a float: a uint256-sized price stays exact', () => {
    const big = (10n ** 70n).toString();
    expect(operatorFeeDue(tusd(big), D33).amount).toBe((10n ** 66n).toString());
  });
});
