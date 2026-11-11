// tUSD, the test token on SimChain and testnets: 6 decimals, like USDC. Amounts travel as base units in a
// decimal string (hard rule: no floats), so 2,000 tUSD is { token: 'tUSD', amount: '2000000000' }.
import type { TokenAmount } from '@holdback/core';

export const TUSD_DECIMALS = 6;
/** One tUSD in base units. */
export const TUSD = 1_000_000n;

const DECIMAL = /^(\d{1,24})(?:\.(\d{1,6}))?$/;

/** Whole tUSD as a TokenAmount in base units: `wholeTusd('2000')`, `wholeTusd('0.5')` or `wholeTusd(25n)`. Never a float. The sim's `tusd` takes base units. */
export function wholeTusd(whole: string | bigint): TokenAmount {
  if (typeof whole === 'bigint') {
    if (whole < 0n) throw new RangeError(`tUSD amount must not be negative, got ${whole}`);
    return { token: 'tUSD', amount: (whole * TUSD).toString() } as TokenAmount;
  }
  const m = DECIMAL.exec(whole);
  if (!m) throw new RangeError(`tUSD amount must be a plain decimal with at most ${TUSD_DECIMALS} places, e.g. "2000" or "0.5"; got ${JSON.stringify(whole)}`);
  const base = BigInt(m[1]!) * TUSD + BigInt((m[2] ?? '').padEnd(TUSD_DECIMALS, '0'));
  return { token: 'tUSD', amount: base.toString() } as TokenAmount;
}

/**
 * "25,000 tUSD", "0.5 tUSD": base units as whole tUSD with thousands separators. Integer arithmetic only. Another
 * 6-decimal token reads the same with its own symbol ("4.71 tUSDC").
 */
export function formatTusd(base: bigint | string, symbol = 'tUSD'): string {
  const v = BigInt(base);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = (abs / TUSD).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = abs % TUSD;
  return `${sign}${whole}${frac === 0n ? '' : `.${frac.toString().padStart(TUSD_DECIMALS, '0').replace(/0+$/, '')}`} ${symbol}`;
}
