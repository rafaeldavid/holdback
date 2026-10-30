// Money is a token amount in base units, carried as a decimal string and computed with bigint.
// The lint rule for this directory bans `number`, fractional literals and float helpers.
import { err, ok, type Result } from '../result.js';

declare const baseUnitsBrand: unique symbol;

/** Base units as a canonical decimal string (no sign, no leading zeros), at most uint256. */
export type BaseUnits = string & { readonly [baseUnitsBrand]: true };

/** The schema's TokenAmount: `{ token, amount }` with amount in base units. */
export interface TokenAmount {
  readonly token: string;
  readonly amount: BaseUnits;
}

export type MoneyError =
  | { kind: 'malformed'; input: string }
  | { kind: 'negative' }
  | { kind: 'overflow' }
  | { kind: 'token_mismatch'; left: string; right: string }
  | { kind: 'bps_out_of_range'; bps: bigint };

export type Ordering = -1 | 0 | 1;

// The EIP-712 encoding is uint256, so that is the ceiling everywhere.
const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;

function fromBigInt(token: string, value: bigint): Result<TokenAmount, MoneyError> {
  if (value < 0n) return err({ kind: 'negative' });
  if (value > UINT256_MAX) return err({ kind: 'overflow' });
  return ok({ token, amount: value.toString() as BaseUnits });
}

export function tokenAmount(token: string, amount: string | bigint): Result<TokenAmount, MoneyError> {
  if (token === '') return err({ kind: 'malformed', input: token });
  if (typeof amount === 'bigint') return fromBigInt(token, amount);
  if (!DECIMAL.test(amount)) return err({ kind: 'malformed', input: amount });
  return fromBigInt(token, BigInt(amount));
}

export const toBigInt = (a: TokenAmount): bigint => BigInt(a.amount);

function sameToken(a: TokenAmount, b: TokenAmount): Result<string, MoneyError> {
  return a.token === b.token ? ok(a.token) : err({ kind: 'token_mismatch', left: a.token, right: b.token });
}

export function add(a: TokenAmount, b: TokenAmount): Result<TokenAmount, MoneyError> {
  const token = sameToken(a, b);
  return token.ok ? fromBigInt(token.value, toBigInt(a) + toBigInt(b)) : token;
}

/** a - b; refuses a negative result. */
export function sub(a: TokenAmount, b: TokenAmount): Result<TokenAmount, MoneyError> {
  const token = sameToken(a, b);
  return token.ok ? fromBigInt(token.value, toBigInt(a) - toBigInt(b)) : token;
}

export function compare(a: TokenAmount, b: TokenAmount): Result<Ordering, MoneyError> {
  const token = sameToken(a, b);
  if (!token.ok) return token;
  const x = toBigInt(a);
  const y = toBigInt(b);
  return ok(x < y ? -1 : x > y ? 1 : 0);
}

export function gte(a: TokenAmount, b: TokenAmount): Result<boolean, MoneyError> {
  const c = compare(a, b);
  return c.ok ? ok(c.value >= 0) : c;
}

export function sum(token: string, amounts: readonly TokenAmount[]): Result<TokenAmount, MoneyError> {
  let total = fromBigInt(token, 0n);
  for (const a of amounts) {
    if (!total.ok) return total;
    total = add(total.value, a);
  }
  return total;
}

const BPS_ALL = 10000n;

/**
 * amount x bps / 10000 in base units (ADR-0022), rounded down or up. bps is an integer from 0 to 10000
 * (10000 = all). Callers pass schema Bps values through BigInt().
 */
export function mulBps(a: TokenAmount, bps: bigint, round: 'floor' | 'ceil'): Result<TokenAmount, MoneyError> {
  if (bps < 0n || bps > BPS_ALL) return err({ kind: 'bps_out_of_range', bps });
  const product = BigInt(a.amount) * bps;
  return fromBigInt(a.token, round === 'floor' ? product / BPS_ALL : (product + BPS_ALL - 1n) / BPS_ALL);
}

/** Splits a pot: share is pot x bps / 10000 rounded down, and remainder is the rest, so they always sum to the pot. */
export function splitBps(pot: TokenAmount, bps: bigint): Result<{ share: TokenAmount; remainder: TokenAmount }, MoneyError> {
  const share = mulBps(pot, bps, 'floor');
  if (!share.ok) return share;
  const remainder = sub(pot, share.value);
  if (!remainder.ok) return remainder;
  return ok({ share: share.value, remainder: remainder.value });
}
