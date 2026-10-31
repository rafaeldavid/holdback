import { describe, expect, it } from 'vitest';
import { formatAmount, sumAmounts } from './money.js';

const t = (amount: string) => ({ token: 'tUSD', amount });

describe('formatAmount', () => {
  it('prints whole tUSD with thousands separators and no decimals', () => {
    expect(formatAmount(t('2050000000'))).toBe('2,050 tUSD');
    expect(formatAmount(t('0'))).toBe('0 tUSD');
    expect(formatAmount(t('25000000000'))).toBe('25,000 tUSD');
  });

  it('keeps the fractional part exactly, trimming trailing zeros', () => {
    expect(formatAmount(t('1400500000'))).toBe('1,400.50 tUSD');
    expect(formatAmount(t('1'))).toBe('0.000001 tUSD');
    expect(formatAmount(t('123456789'))).toBe('123.456789 tUSD');
  });

  it('refuses anything that is not a base-unit decimal string', () => {
    for (const bad of ['1.5', '-1', '1e6', '', ' 1', '0x10']) expect(() => formatAmount(t(bad))).toThrow(RangeError);
  });

  it('refuses a token it has no decimals for', () => {
    expect(() => formatAmount({ token: 'XYZ', amount: '1' })).toThrow(/decimals/);
  });
});

describe('sumAmounts', () => {
  it('adds base units as bigint and keeps the token', () => {
    expect(sumAmounts([t('2000000000'), t('50000000')])).toEqual(t('2050000000'));
  });

  it('refuses mixed tokens', () => {
    expect(() => sumAmounts([t('1'), { token: 'tEUR', amount: '1' }])).toThrow(/token/);
  });
});
