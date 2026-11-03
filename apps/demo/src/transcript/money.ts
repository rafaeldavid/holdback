// Display of token amounts for narration. Base units in, exact decimal text out; bigint only, no floats.
import type { Amount } from './types.js';

/** Decimals per test token. tUSD stands for US dollars in the demo. */
const DECIMALS: Readonly<Record<string, number>> = { tUSD: 6 };

const BASE_UNITS = /^(0|[1-9]\d*)$/;

function units(a: Amount): bigint {
  if (!BASE_UNITS.test(a.amount)) throw new RangeError(`amount must be base units as a decimal string, got "${a.amount}"`);
  return BigInt(a.amount);
}

function decimalsOf(token: string): number {
  const d = DECIMALS[token];
  if (d === undefined) throw new RangeError(`no decimals known for token ${token}`);
  return d;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "2,050 tUSD", "1,400.50 tUSD": exact, trailing zeros trimmed, at least two decimals when there are any. */
export function formatAmount(a: Amount): string {
  const decimals = decimalsOf(a.token);
  const value = units(a);
  const scale = 10n ** BigInt(decimals);
  const whole = group((value / scale).toString());
  let frac = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (frac === '') return `${whole} ${a.token}`;
  if (frac.length === 1) frac += '0';
  return `${whole}.${frac} ${a.token}`;
}

export function sumAmounts(amounts: readonly Amount[]): Amount {
  const token = amounts[0]?.token ?? 'tUSD';
  let total = 0n;
  for (const a of amounts) {
    if (a.token !== token) throw new RangeError(`cannot add token ${a.token} to ${token}`);
    total += units(a);
  }
  return { token, amount: total.toString() };
}
