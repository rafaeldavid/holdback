import { inspect } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ContentKey, CryptoError, open, seal, sha256, type RandomSource } from './index.js';

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Hands out the given chunks in order; fails the test if a call asks for a different length. */
function scripted(...chunks: Uint8Array[]): RandomSource {
  const queue = [...chunks];
  return (length) => {
    const next = queue.shift();
    if (!next || next.length !== length) throw new Error(`test random: unexpected request for ${length} bytes`);
    return next;
  };
}

/** Deterministic byte stream for property tests: a counter, never Math.random. */
function counter(start: number): RandomSource {
  let n = start;
  return (length) => Uint8Array.from({ length }, () => n++ & 0xff);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CryptoError);
    return (e as CryptoError).code;
  }
  throw new Error('expected a CryptoError, got a value');
}

// McGrew and Viega, "The Galois/Counter Mode of Operation", AES-256 test cases 13 and 14:
// all-zero key and IV. Independently confirmed with node:crypto createCipheriv (measured).
const ZERO_KEY = new Uint8Array(32);
const ZERO_IV = new Uint8Array(12);
const TC13_TAG = '530f8afbc74536b9a963b4f1c4cb738b';
const TC14_CT = 'cea7403d4d606b6e074ec5d3baf39d18';
const TC14_TAG = 'd0d1c8a799996bf0265b98b5d48ab919';

describe('seal (AES-256-GCM through Web Crypto)', () => {
  it('matches GCM test case 14: ciphertext is iv || ct || tag', async () => {
    const sealed = await seal(new Uint8Array(16), { random: scripted(ZERO_KEY, ZERO_IV) });
    expect(toHex(sealed.ciphertext)).toBe('00'.repeat(12) + TC14_CT + TC14_TAG);
    // Hashes cross-checked with `shasum -a 256` on the same bytes (measured).
    expect(sealed.plaintextSha256).toBe('sha256:374708fff7719dd5979ec875d56cd2286f6d3cf7ec317a3b25632aab28ec37bb');
    expect(sealed.ciphertextSha256).toBe('sha256:f44e1182bd03b30adafde623dad9ae19c6e316ad112c3792821bc477951dc5b9');
    expect(toHex(sealed.key.exportBytes())).toBe('00'.repeat(32));
  });

  it('matches GCM test case 13 for an empty plaintext', async () => {
    const sealed = await seal(new Uint8Array(0), { random: scripted(ZERO_KEY, ZERO_IV) });
    expect(toHex(sealed.ciphertext)).toBe('00'.repeat(12) + TC13_TAG);
    expect(await open(sealed.ciphertext, sealed.key)).toEqual(new Uint8Array(0));
  });

  it('opens the fixed vector', async () => {
    const ct = hex('00'.repeat(12) + TC14_CT + TC14_TAG);
    expect(toHex(await open(ct, ContentKey.fromBytes(ZERO_KEY)))).toBe('00'.repeat(16));
  });

  it('draws a fresh 32-byte key then a 12-byte IV from the injected source', async () => {
    const lengths: number[] = [];
    await seal(new Uint8Array([1, 2, 3]), { random: (n) => (lengths.push(n), new Uint8Array(n).fill(7)) });
    expect(lengths).toEqual([32, 12]);
  });

  it('copies the random bytes, so later mutation of the source buffer cannot change the key', async () => {
    const keyBuf = new Uint8Array(32).fill(9);
    const sealed = await seal(new Uint8Array([1]), { random: scripted(keyBuf, new Uint8Array(12)) });
    keyBuf.fill(0);
    expect(await open(sealed.ciphertext, sealed.key)).toEqual(new Uint8Array([1]));
  });

  it('round-trips arbitrary bytes (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 2048 }), fc.integer({ min: 0, max: 255 }), async (pt, start) => {
        const sealed = await seal(pt, { random: counter(start) });
        expect(sealed.plaintextSha256).toBe(sha256(pt));
        expect(sealed.ciphertextSha256).toBe(sha256(sealed.ciphertext));
        expect(sealed.ciphertext.length).toBe(12 + pt.length + 16);
        expect(await open(sealed.ciphertext, sealed.key)).toEqual(pt);
      }),
      { numRuns: 50, seed: 14 },
    );
  });

  it('rejects a wrong key with decrypt_failed', async () => {
    const sealed = await seal(new Uint8Array([1, 2, 3]), { random: counter(1) });
    const wrong = ContentKey.fromBytes(new Uint8Array(32).fill(0xaa));
    expect(await codeOf(open(sealed.ciphertext, wrong))).toBe('decrypt_failed');
  });

  it('rejects any single flipped bit with decrypt_failed (property)', async () => {
    const sealed = await seal(new TextEncoder().encode('deliverable bytes'), { random: counter(3) });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: sealed.ciphertext.length * 8 - 1 }), async (bit) => {
        const tampered = Uint8Array.from(sealed.ciphertext);
        tampered[bit >> 3]! ^= 1 << (bit & 7);
        expect(await codeOf(open(tampered, sealed.key))).toBe('decrypt_failed');
      }),
      { numRuns: 100, seed: 14 },
    );
  });

  it('rejects truncated and extended ciphertext', async () => {
    const sealed = await seal(new Uint8Array([5, 6, 7]), { random: counter(5) });
    expect(await codeOf(open(sealed.ciphertext.subarray(0, sealed.ciphertext.length - 1), sealed.key))).toBe('decrypt_failed');
    expect(await codeOf(open(Uint8Array.from([...sealed.ciphertext, 0]), sealed.key))).toBe('decrypt_failed');
    expect(await codeOf(open(new Uint8Array(27), sealed.key))).toBe('malformed_ciphertext');
  });

  it('checks the committed plaintext hash when asked', async () => {
    const pt = new Uint8Array([1, 2, 3]);
    const sealed = await seal(pt, { random: counter(9) });
    expect(await open(sealed.ciphertext, sealed.key, { expectPlaintextSha256: sha256(pt) })).toEqual(pt);
    const other = sha256(new Uint8Array([9]));
    expect(await codeOf(open(sealed.ciphertext, sealed.key, { expectPlaintextSha256: other }))).toBe('plaintext_hash_mismatch');
  });

  it('refuses random sources that return the wrong length', async () => {
    expect(await codeOf(seal(new Uint8Array([1]), { random: () => new Uint8Array(4) }))).toBe('invalid_random');
  });

  it('defaults to the platform CSPRNG: two seals of the same bytes differ', async () => {
    const pt = new Uint8Array([1, 2, 3]);
    const [a, b] = await Promise.all([seal(pt), seal(pt)]);
    expect(toHex(a.ciphertext)).not.toBe(toHex(b.ciphertext));
    expect(a.plaintextSha256).toBe(b.plaintextSha256);
  });
});

describe('ContentKey', () => {
  it('accepts exactly 32 bytes', () => {
    expect(() => ContentKey.fromBytes(new Uint8Array(31))).toThrow(CryptoError);
    expect(() => ContentKey.fromBytes(new Uint8Array(33))).toThrow(CryptoError);
    try {
      ContentKey.fromBytes(new Uint8Array(31));
    } catch (e) {
      expect((e as CryptoError).code).toBe('invalid_key');
    }
  });

  it('never prints its bytes through inspect, JSON, string coercion or a sealed result', async () => {
    const keyBytes = new Uint8Array(32).fill(0xab);
    const sealed = await seal(new Uint8Array([1]), { random: scripted(keyBytes, new Uint8Array(12)) });
    const renderings = [
      inspect(sealed.key, { showHidden: true, depth: 10 }),
      inspect(sealed, { showHidden: true, depth: 10 }),
      JSON.stringify(sealed),
      String(sealed.key),
      `${sealed.key}`,
    ];
    for (const r of renderings) {
      expect(r).not.toContain('ab'.repeat(8));
      expect(r).not.toContain(Buffer.from(keyBytes).toString('base64').slice(0, 12));
      expect(r).not.toContain('171,171,171');
    }
  });

  it('returns a copy from exportBytes', () => {
    const key = ContentKey.fromBytes(new Uint8Array(32).fill(1));
    key.exportBytes().fill(0);
    expect(key.exportBytes()).toEqual(new Uint8Array(32).fill(1));
  });
});

describe('errors', () => {
  it('carry no key material in message, string or inspect output', async () => {
    const keyBytes = new Uint8Array(32).fill(0xcd);
    const sealed = await seal(new Uint8Array([1, 2]), { random: scripted(keyBytes, new Uint8Array(12)) });
    const wrongKey = ContentKey.fromBytes(new Uint8Array(32).fill(0xef));
    const errors: unknown[] = [];
    for (const attempt of [() => open(sealed.ciphertext, wrongKey), () => open(new Uint8Array(3), sealed.key)]) {
      try {
        await attempt();
      } catch (e) {
        errors.push(e);
      }
    }
    try {
      ContentKey.fromBytes(new Uint8Array(31).fill(0xcd));
    } catch (e) {
      errors.push(e);
    }
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      const text = [String(e), (e as Error).message, inspect(e, { showHidden: true, depth: 10 }), JSON.stringify(e)].join('\n');
      for (const secret of ['cd'.repeat(8), 'ef'.repeat(8), '205,205,205', '239,239,239', 'zc3Nzc3N', '7+/v7+/v']) {
        expect(text).not.toContain(secret);
      }
    }
  });
});
