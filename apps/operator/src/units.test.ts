import { describe, expect, it } from 'vitest';
import { formatTusd, TUSD, TUSD_DECIMALS, tusd } from './units.js';

describe('tUSD units', () => {
  it('has 6 decimals', () => {
    expect(TUSD_DECIMALS).toBe(6);
    expect(TUSD).toBe(1_000_000n);
  });

  it('parses whole and fractional tUSD into base units, as a decimal string', () => {
    expect(tusd('2000')).toEqual({ token: 'tUSD', amount: '2000000000' });
    expect(tusd('0.5')).toEqual({ token: 'tUSD', amount: '500000' });
    expect(tusd('12.000001')).toEqual({ token: 'tUSD', amount: '12000001' });
    expect(tusd(25n)).toEqual({ token: 'tUSD', amount: '25000000' });
  });

  it('refuses anything that is not a plain non-negative decimal with at most 6 places', () => {
    for (const bad of ['1.0000001', '-1', '1e3', '', '.5', '1,000', ' 1', 'NaN']) expect(() => tusd(bad), bad).toThrow(/tUSD/);
  });

  it('formats base units with separators and no trailing zeros', () => {
    expect(formatTusd(2_050_000_000n)).toBe('2,050 tUSD');
    expect(formatTusd(500_000n)).toBe('0.5 tUSD');
    expect(formatTusd(25_000n * TUSD)).toBe('25,000 tUSD');
    expect(formatTusd('12000001')).toBe('12.000001 tUSD');
  });
});
