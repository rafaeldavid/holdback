import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, compare, gte, mulBps, splitBps, sub, sum, toBigInt, tokenAmount, type TokenAmount } from './index.js';

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

describe('basis points (ADR-0022)', () => {
  const amountArb = fc.bigInt({ min: 0n, max: (1n << 200n) - 1n });
  const bpsArb = fc.bigInt({ min: 0n, max: 10000n });
  const amt = (v: bigint) => {
    const r = tokenAmount('tUSD', v);
    if (!r.ok) throw new Error('bad amount');
    return r.value;
  };

  it('splits a pot into a share and a remainder that sum to the pot', () => {
    fc.assert(
      fc.property(amountArb, bpsArb, (pot, bps) => {
        const r = splitBps(amt(pot), bps);
        if (!r.ok) return false;
        return toBigInt(r.value.share) + toBigInt(r.value.remainder) === pot && r.value.share.token === 'tUSD';
      }),
      { seed: 22, numRuns: 500 },
    );
  });

  it('rounds ceil at least as high as floor, and never more than one unit apart', () => {
    fc.assert(
      fc.property(amountArb, bpsArb, (a, bps) => {
        const lo = mulBps(amt(a), bps, 'floor');
        const hi = mulBps(amt(a), bps, 'ceil');
        if (!lo.ok || !hi.ok) return false;
        const d = toBigInt(hi.value) - toBigInt(lo.value);
        return d >= 0n && d <= 1n;
      }),
      { seed: 22, numRuns: 500 },
    );
  });

  it.each([
    ['0 bps', 2050n, 0n, 'floor', 0n],
    ['all', 2050n, 10000n, 'floor', 2050n],
    ['5% floor', 2050n, 500n, 'floor', 102n],
    ['5% ceil', 2050n, 500n, 'ceil', 103n],
  ] as const)('computes %s exactly', (_label, a, bps, round, want) => {
    const r = mulBps(amt(a), bps, round);
    expect(r.ok && toBigInt(r.value)).toBe(want);
  });

  it('gives a share that is exactly pot x bps / 10000, rounded down', () => {
    fc.assert(
      fc.property(amountArb, bpsArb, (pot, bps) => {
        const r = splitBps(amt(pot), bps);
        return r.ok && toBigInt(r.value.share) === (pot * bps) / 10000n;
      }),
      { seed: 22, numRuns: 500 },
    );
  });

  it.each([
    ['ceil on an exact product stays exact', 2000n, 500n, 'ceil', 100n],
    ['ceil rounds a remainder up by one', 3n, 5000n, 'ceil', 2n],
    ['floor rounds a remainder down', 3n, 5000n, 'floor', 1n],
  ] as const)('%s', (_label, a, bps, round, want) => {
    const r = mulBps(amt(a), bps, round);
    expect(r.ok && toBigInt(r.value)).toBe(want);
  });

  it('splits an odd pot with the share rounded down and the remainder taking the dust', () => {
    const r = splitBps(amt(3n), 5000n);
    expect(r.ok && [toBigInt(r.value.share), toBigInt(r.value.remainder)]).toEqual([1n, 2n]);
  });

  it.each([-1n, 10001n])('refuses %s basis points', (bps) => {
    expect(mulBps(amt(100n), bps, 'floor').ok).toBe(false);
    expect(splitBps(amt(100n), bps).ok).toBe(false);
  });
});
