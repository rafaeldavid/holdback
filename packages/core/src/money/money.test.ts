import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, compare, gte, sub, sum, toBigInt, tokenAmount, type TokenAmount } from './index.js';

const UINT256_MAX = (1n << 256n) - 1n;

function amt(token: string, amount: string | bigint): TokenAmount {
  const r = tokenAmount(token, amount);
  if (!r.ok) throw new Error(`bad fixture ${String(amount)}`);
  return r.value;
}

describe('tokenAmount', () => {
  it.each(['0', '1', '2050000000', UINT256_MAX.toString()])('accepts %s', (s) => {
    expect(tokenAmount('tUSD', s)).toEqual({ ok: true, value: { token: 'tUSD', amount: s } });
  });

  it.each(['', '01', '-1', '1.5', '1e18', ' 1', '0x10', 'abc'])('refuses malformed %j', (s) => {
    expect(tokenAmount('tUSD', s)).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  });

  it('refuses amounts above uint256', () => {
    expect(tokenAmount('tUSD', UINT256_MAX + 1n)).toMatchObject({ ok: false, error: { kind: 'overflow' } });
  });

  it('refuses negative bigints', () => {
    expect(tokenAmount('tUSD', -1n)).toMatchObject({ ok: false, error: { kind: 'negative' } });
  });

  it('refuses an empty token id', () => {
    expect(tokenAmount('', '1')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  });
});

describe('arithmetic', () => {
  const price = amt('tUSD', '2000000000');
  const fee = amt('tUSD', '50000000');

  it('adds', () => {
    expect(add(price, fee)).toEqual({ ok: true, value: { token: 'tUSD', amount: '2050000000' } });
  });

  it('subtracts', () => {
    expect(sub(price, fee)).toEqual({ ok: true, value: { token: 'tUSD', amount: '1950000000' } });
  });

  it('refuses a negative result', () => {
    expect(sub(fee, price)).toMatchObject({ ok: false, error: { kind: 'negative' } });
  });

  it('refuses mixed tokens', () => {
    const other = amt('tEUR', '1');
    expect(add(price, other)).toMatchObject({ ok: false, error: { kind: 'token_mismatch' } });
    expect(sub(price, other)).toMatchObject({ ok: false, error: { kind: 'token_mismatch' } });
    expect(compare(price, other)).toMatchObject({ ok: false, error: { kind: 'token_mismatch' } });
    expect(sum('tUSD', [price, other])).toMatchObject({ ok: false, error: { kind: 'token_mismatch' } });
  });

  it('refuses overflow past uint256', () => {
    expect(add(amt('tUSD', UINT256_MAX), amt('tUSD', '1'))).toMatchObject({ ok: false, error: { kind: 'overflow' } });
  });

  it('compares', () => {
    expect(compare(price, fee)).toEqual({ ok: true, value: 1 });
    expect(compare(fee, price)).toEqual({ ok: true, value: -1 });
    expect(compare(price, amt('tUSD', '2000000000'))).toEqual({ ok: true, value: 0 });
    expect(gte(price, fee)).toEqual({ ok: true, value: true });
    expect(gte(fee, price)).toEqual({ ok: true, value: false });
  });

  it('sums, including the empty sum', () => {
    expect(sum('tUSD', [price, fee, fee])).toEqual({ ok: true, value: { token: 'tUSD', amount: '2100000000' } });
    expect(sum('tUSD', [])).toEqual({ ok: true, value: { token: 'tUSD', amount: '0' } });
  });
});

describe('properties', () => {
  const big = fc.bigInt({ min: 0n, max: UINT256_MAX / 2n });

  it('add then sub returns the original amount', () => {
    fc.assert(
      fc.property(big, big, (a, b) => {
        const x = amt('tUSD', a);
        const y = amt('tUSD', b);
        const s = add(x, y);
        if (!s.ok) return false;
        const back = sub(s.value, y);
        return back.ok && toBigInt(back.value) === a;
      }),
    );
  });

  it('sub succeeds exactly when the result is not negative', () => {
    fc.assert(
      fc.property(big, big, (a, b) => {
        const r = sub(amt('tUSD', a), amt('tUSD', b));
        return r.ok === a >= b;
      }),
    );
  });

  it('string form round-trips through bigint without loss', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: UINT256_MAX }), (a) => amt('tUSD', a).amount === a.toString()),
    );
  });
});
