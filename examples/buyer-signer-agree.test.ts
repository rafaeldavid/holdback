// The buyer's reads of what changes over time (T-399 Finding 5): read again while the operators disagree, for a short
// window, and stop when they still do. buy-with-signer.test.ts shows it end to end, through an operator that lags.
import { describe, expect, it } from 'vitest';
import { AGREE_PAUSES_MS, agreeing, FaucetLimited } from './buyer-signer.ts';

const disagree = () => new Error('operators disagree on /v1/commitments/0xab/events?limit=200; do not proceed');

describe('agreeing: a disagreement that clears is read again, one that stays stops', () => {
  it('returns the first answer the operators agree on, after reading again', async () => {
    let reads = 0;
    const got = await agreeing(async () => {
      if (++reads < 3) throw disagree();
      return 'Released';
    }, [1, 1, 1, 1]);
    expect(got).toBe('Released');
    expect(reads).toBe(3);
  });

  it('stops with the same error once every pause is spent: a lasting disagreement is never accepted', async () => {
    let reads = 0;
    await expect(agreeing(async () => {
      reads++;
      throw disagree();
    }, [1, 1, 1, 1])).rejects.toThrow(/^operators disagree on \/v1\/commitments\/0xab\/events\?limit=200; do not proceed$/);
    expect(reads).toBe(5);
  });

  it('reads again for no other error: an operator that answers nothing, or a refusal, stops at once', async () => {
    let reads = 0;
    await expect(agreeing(async () => {
      reads++;
      throw new Error('no operator answered GET /v1/commitments/0xab');
    }, [1, 1, 1, 1])).rejects.toThrow('no operator answered');
    expect(reads).toBe(1);
  });

  it('waits 15 s in all by default, about a Sepolia block and some', () => {
    expect(AGREE_PAUSES_MS.reduce((a, b) => a + b, 0)).toBe(15_000);
  });
});

describe('FaucetLimited', () => {
  it('keeps the message Agent.call gave a 429 before, and carries the seconds to wait', () => {
    const e = new FaucetLimited('too many faucet grants from this client; retry later', 2264);
    expect(e.message).toBe('POST /v1/faucet: rate_limited: too many faucet grants from this client; retry later');
    expect(e.retryAfterSec).toBe(2264);
    expect(e).toBeInstanceOf(Error);
  });
});
