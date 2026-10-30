import { inspect } from 'node:util';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '../types.js';
import {
  ContentKey,
  CryptoError,
  ENVELOPE_SCHEME,
  decodePublicKey,
  encodePublicKey,
  encryptionKeyPairFromSecretKey,
  generateEncryptionKeyPair,
  unwrapKey,
  unwrapKeyFor,
  wrapKey,
  wrapKeyForRecipients,
  type RandomSource,
} from './index.js';

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

function scripted(...chunks: Uint8Array[]): RandomSource {
  const queue = [...chunks];
  return (length) => {
    const next = queue.shift();
    if (!next || next.length !== length) throw new Error(`test random: unexpected request for ${length} bytes`);
    return next;
  };
}

function counter(start: number): RandomSource {
  let n = start;
  return (length) => Uint8Array.from({ length }, () => n++ & 0xff);
}

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(CryptoError);
    return (e as CryptoError).code;
  }
  throw new Error('expected a CryptoError, got a value');
}

// RFC 7748 section 6.1 (the same keys as Bernstein, "Cryptography in NaCl").
const ALICE_SK = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
const ALICE_PK = hex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
const BOB_SK = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
const BOB_PK = hex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
// "Cryptography in NaCl", section 7 nonce.
const NACL_NONCE = hex('69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37');
const CONTENT_KEY = hex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308');

// Envelope = base64url(ephemeralPublicKey(32) || nonce(24) || box(contentKey)(48)). The ephemeral key
// is ALICE_SK and the recipient is Bob. Computed directly with tweetnacl outside this module (measured).
const FIXED_ENVELOPE =
  'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmppaW7pVbYrc81ivah1_HPWghngA2t6CzeR0w0xCDCJyCcyU0M2Pcz2zmGNyPKMk7pg6Mw4vif5veTkAh_cSi5sYWOzyjK11J4';

describe('primitive known answers (tweetnacl)', () => {
  it('derives the RFC 7748 public keys', () => {
    expect(toHex(encryptionKeyPairFromSecretKey(ALICE_SK).publicKey)).toBe(toHex(ALICE_PK));
    expect(toHex(encryptionKeyPairFromSecretKey(BOB_SK).publicKey)).toBe(toHex(BOB_PK));
  });

  it('reproduces the box vector from "Cryptography in NaCl"', () => {
    const m = hex(
      'be075fc53c81f2d5cf141316ebeb0c7b5228c52a4c62cbd44b66849b64244ffce5ecbaaf33bd751a1ac728d45e6c61296cdc3c01233561f41db66cce314adb310e3be8250c46f06dceea3a7fa1348057e2f6556ad6b1318a024a838f21af1fde048977eb48f59ffd4924ca1c60902e52f0a089bc76897040e082f937763848645e0705',
    );
    const c =
      'f3ffc7703f9400e52a7dfb4b3d3305d98e993b9f48681273c29650ba32fc76ce48332ea7164d96a4476fb8c531a1186ac0dfc17c98dce87b4da7f011ec48c97271d2c20f9b928fe2270d6fb863d51738b48eeee314a7cc8ab932164548e526ae90224368517acfeabd6bb3732bc0e9da99832b61ca01b6de56244a9e88d5f9b37973f622a43d14a6599b1f654cb45a74e355a5';
    expect(toHex(nacl.box(m, NACL_NONCE, BOB_PK, ALICE_SK))).toBe(c);
  });
});

describe('wrapKey / unwrapKey (x25519-xsalsa20poly1305)', () => {
  it('produces the fixed envelope from fixed randomness (ephemeral key, then nonce)', () => {
    const sealed = wrapKey(ContentKey.fromBytes(CONTENT_KEY), BOB_PK, { random: scripted(ALICE_SK, NACL_NONCE) });
    expect(sealed).toEqual({ scheme: ENVELOPE_SCHEME, ciphertext: FIXED_ENVELOPE });
    expect(ENVELOPE_SCHEME).toBe('x25519-xsalsa20poly1305');
  });

  it('unwraps the fixed envelope with the recipient secret key', () => {
    const key = unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: FIXED_ENVELOPE }, BOB_SK);
    expect(toHex(key.exportBytes())).toBe(toHex(CONTENT_KEY));
  });

  it('accepts the recipient public key as base64url', () => {
    const sealed = wrapKey(ContentKey.fromBytes(CONTENT_KEY), encodePublicKey(BOB_PK), { random: scripted(ALICE_SK, NACL_NONCE) });
    expect(sealed.ciphertext).toBe(FIXED_ENVELOPE);
    expect(encodePublicKey(BOB_PK)).toBe('3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08');
    expect(toHex(decodePublicKey('3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08'))).toBe(toHex(BOB_PK));
  });

  it('fails a wrong recipient key with unwrap_failed', () => {
    expect(codeOf(() => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: FIXED_ENVELOPE }, ALICE_SK))).toBe('unwrap_failed');
  });

  it('fails every single-bit tamper of the envelope loudly', () => {
    const bytes = Buffer.from(FIXED_ENVELOPE, 'base64url');
    for (let bit = 0; bit < bytes.length * 8; bit++) {
      const t = Buffer.from(bytes);
      t[bit >> 3]! ^= 1 << (bit & 7);
      // X25519 ignores the top bit of a public key, so setting it would leave the shared secret unchanged.
      // The envelope refuses that encoding as malformed instead of silently accepting it.
      const expected = bit === 255 ? 'malformed_envelope' : 'unwrap_failed';
      expect(codeOf(() => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: t.toString('base64url') }, BOB_SK))).toBe(expected);
    }
  });

  it('fails malformed envelopes loudly', () => {
    const scheme = 'x25519-xsalsa20poly1305' as const;
    expect(codeOf(() => unwrapKey({ scheme, ciphertext: FIXED_ENVELOPE.slice(0, -4) }, BOB_SK))).toBe('malformed_envelope');
    expect(codeOf(() => unwrapKey({ scheme, ciphertext: `${FIXED_ENVELOPE}AAAA` }, BOB_SK))).toBe('malformed_envelope');
    expect(codeOf(() => unwrapKey({ scheme, ciphertext: `${FIXED_ENVELOPE.slice(0, -1)}=` }, BOB_SK))).toBe('malformed_envelope');
    expect(codeOf(() => unwrapKey({ scheme, ciphertext: FIXED_ENVELOPE.replace('_', '/') }, BOB_SK))).toBe('malformed_envelope');
    expect(codeOf(() => unwrapKey({ scheme, ciphertext: '' }, BOB_SK))).toBe('malformed_envelope');
    // Non-canonical base64url: the last character carries unused bits that are not zero.
    const noncanon = FIXED_ENVELOPE.slice(0, -1) + (FIXED_ENVELOPE.endsWith('4') ? '5' : '4');
    expect(codeOf(() => unwrapKey({ scheme, ciphertext: noncanon }, BOB_SK))).toBe('malformed_envelope');
  });

  it('refuses an unknown scheme', () => {
    const sealed = { scheme: 'rsa-oaep', ciphertext: FIXED_ENVELOPE } as unknown as Parameters<typeof unwrapKey>[0];
    expect(codeOf(() => unwrapKey(sealed, BOB_SK))).toBe('unsupported_scheme');
  });

  it('refuses bad recipient keys', () => {
    const key = ContentKey.fromBytes(CONTENT_KEY);
    expect(codeOf(() => wrapKey(key, new Uint8Array(31), { random: counter(1) }))).toBe('invalid_public_key');
    expect(codeOf(() => wrapKey(key, 'not base64url!', { random: counter(1) }))).toBe('invalid_public_key');
    // A low-order point gives an all-zero shared secret, which anyone could compute.
    expect(codeOf(() => wrapKey(key, new Uint8Array(32), { random: counter(1) }))).toBe('invalid_public_key');
    const highBit = Uint8Array.from(BOB_PK);
    highBit[31]! |= 0x80;
    expect(codeOf(() => wrapKey(key, highBit, { random: counter(1) }))).toBe('invalid_public_key');
    expect(codeOf(() => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: FIXED_ENVELOPE }, new Uint8Array(16)))).toBe('invalid_secret_key');
  });

  it('uses a fresh ephemeral key and nonce per envelope by default', () => {
    const key = ContentKey.fromBytes(CONTENT_KEY);
    const a = wrapKey(key, BOB_PK);
    const b = wrapKey(key, BOB_PK);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(unwrapKey(a, BOB_SK).exportBytes()).toEqual(CONTENT_KEY);
    expect(unwrapKey(b, BOB_SK).exportBytes()).toEqual(CONTENT_KEY);
  });

  it('generates key pairs from the injected source', () => {
    const kp = generateEncryptionKeyPair(scripted(ALICE_SK));
    expect(toHex(kp.publicKey)).toBe(toHex(ALICE_PK));
  });
});

describe('wrapKeyForRecipients / unwrapKeyFor (delivery.encryptedKeys)', () => {
  const kp = (seed: number) => encryptionKeyPairFromSecretKey(new Uint8Array(32).fill(seed));
  const primary = kp(1);
  const fallback = kp(2);
  const appeal = kp(3);
  const buyer = kp(4);
  const outsider = kp(5);
  const addr = (n: number): Address => `0x${String(n).repeat(40)}`;
  const recipients = [
    { recipient: addr(1), publicKey: primary.publicKey },
    { recipient: addr(2), publicKey: encodePublicKey(fallback.publicKey) },
    { recipient: addr(3), publicKey: appeal.publicKey },
    { recipient: addr(4), publicKey: buyer.publicKey },
  ];
  const key = ContentKey.fromBytes(CONTENT_KEY);

  it('wraps for the primary, fallback and appeal adjudicators and the buyer, each able to unwrap', () => {
    const encryptedKeys = wrapKeyForRecipients(key, recipients, { random: counter(0) });
    expect(encryptedKeys.map((e) => e.recipient)).toEqual([addr(1), addr(2), addr(3), addr(4)]);
    for (const e of encryptedKeys) {
      expect(e.scheme).toBe('x25519-xsalsa20poly1305');
      expect(e.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Object.keys(e).sort()).toEqual(['ciphertext', 'recipient', 'scheme']);
    }
    for (const [i, pair] of [primary, fallback, appeal, buyer].entries()) {
      expect(unwrapKeyFor(encryptedKeys, addr(i + 1), pair.secretKey).exportBytes()).toEqual(CONTENT_KEY);
    }
  });

  it('is deterministic for a given random source', () => {
    expect(wrapKeyForRecipients(key, recipients, { random: counter(7) })).toEqual(wrapKeyForRecipients(key, recipients, { random: counter(7) }));
  });

  it('fails a recipient using another recipient\'s secret key, and an address with no envelope', () => {
    const encryptedKeys = wrapKeyForRecipients(key, recipients, { random: counter(0) });
    expect(codeOf(() => unwrapKeyFor(encryptedKeys, addr(1), fallback.secretKey))).toBe('unwrap_failed');
    expect(codeOf(() => unwrapKeyFor(encryptedKeys, addr(5), outsider.secretKey))).toBe('no_envelope_for_recipient');
  });

  it('matches recipient addresses case-insensitively', () => {
    const mixed: Address = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    const encryptedKeys = wrapKeyForRecipients(key, [{ recipient: mixed, publicKey: primary.publicKey }], { random: counter(0) });
    expect(unwrapKeyFor(encryptedKeys, mixed.toLowerCase() as Address, primary.secretKey).exportBytes()).toEqual(CONTENT_KEY);
  });

  it('refuses duplicate recipients when wrapping and ambiguous entries when unwrapping', () => {
    const dup = [recipients[0]!, { recipient: addr(1).toUpperCase().replace('0X', '0x') as Address, publicKey: buyer.publicKey }];
    expect(codeOf(() => wrapKeyForRecipients(key, dup, { random: counter(0) }))).toBe('duplicate_recipient');
    const one = wrapKeyForRecipients(key, [recipients[0]!], { random: counter(0) });
    expect(codeOf(() => unwrapKeyFor([...one, ...one], addr(1), primary.secretKey))).toBe('duplicate_recipient');
  });

  it('keeps secret keys and the content key out of error output', () => {
    const encryptedKeys = wrapKeyForRecipients(key, recipients, { random: counter(0) });
    const errors: unknown[] = [];
    for (const f of [
      () => unwrapKeyFor(encryptedKeys, addr(1), fallback.secretKey),
      () => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: FIXED_ENVELOPE }, ALICE_SK),
      () => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: FIXED_ENVELOPE }, new Uint8Array(16).fill(0x77)),
    ]) {
      try {
        f();
      } catch (e) {
        errors.push(e);
      }
    }
    expect(errors).toHaveLength(3);
    const secrets = [toHex(ALICE_SK).slice(0, 16), toHex(fallback.secretKey).slice(0, 16), toHex(CONTENT_KEY).slice(0, 16), '77'.repeat(8), '119,119,119'];
    for (const e of errors) {
      const text = [String(e), (e as Error).message, inspect(e, { showHidden: true, depth: 10 }), JSON.stringify(e)].join('\n');
      for (const s of secrets) expect(text).not.toContain(s);
    }
  });
});

// ---- Ephemeral key validation on unwrap (review finding 7) ----
const P = (1n << 255n) - 19n;
const uBytes = (u: bigint): Uint8Array => Uint8Array.from(Buffer.from(u.toString(16).padStart(64, '0'), 'hex').reverse());
const envelopeWith = (ephemeralPublicKey: Uint8Array, box: Uint8Array): string =>
  Buffer.from([...ephemeralPublicKey, ...NACL_NONCE, ...box]).toString('base64url');

describe('unwrap refuses low-order and non-reduced ephemeral keys', () => {
  // For these points X25519 gives an all-zero shared secret with every scalar, so anyone can open the box.
  it.each([
    ['0', 0n],
    ['1', 1n],
    ['p - 1', P - 1n],
  ])('ephemeral u = %s: a box anyone can open is refused as malformed_envelope', (_label, u) => {
    const lowOrder = uBytes(u);
    // The "sender" uses an arbitrary secret key; the shared secret is zero either way.
    const box = nacl.box(CONTENT_KEY, NACL_NONCE, lowOrder, ALICE_SK);
    // Show the box really is openable by an unrelated key, so the refusal is what protects the recipient.
    expect(nacl.box.open(box, NACL_NONCE, lowOrder, BOB_SK)).not.toBeNull();
    expect(codeOf(() => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: envelopeWith(lowOrder, box) }, BOB_SK))).toBe('malformed_envelope');
  });

  it('refuses a non-reduced ephemeral key (u >= p)', () => {
    const box = nacl.box(CONTENT_KEY, NACL_NONCE, BOB_PK, ALICE_SK);
    for (const u of [P, P + 9n, (1n << 255n) - 1n]) {
      expect(codeOf(() => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: envelopeWith(uBytes(u), box) }, BOB_SK))).toBe('malformed_envelope');
    }
  });

  it('refuses a non-reduced recipient public key when wrapping', () => {
    const key = ContentKey.fromBytes(CONTENT_KEY);
    expect(codeOf(() => wrapKey(key, uBytes(P + 9n), { random: counter(1) }))).toBe('invalid_public_key');
    expect(codeOf(() => decodePublicKey(uBytes(P)))).toBe('invalid_public_key');
  });

  it('accepts a reduced, full-order key such as the base point u = 9', () => {
    // u = 9 is the base point: reduced, full order, accepted.
    const key = ContentKey.fromBytes(CONTENT_KEY);
    expect(wrapKey(key, uBytes(9n), { random: counter(1) }).scheme).toBe('x25519-xsalsa20poly1305');
  });
});

describe('no logging in envelopes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('wrap and unwrap, including failure paths, never write to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const sealed = wrapKey(ContentKey.fromBytes(CONTENT_KEY), BOB_PK, { random: counter(3) });
    unwrapKey(sealed, BOB_SK);
    codeOf(() => unwrapKey(sealed, ALICE_SK));
    codeOf(() => unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: 'AAAA' }, BOB_SK));
    codeOf(() => wrapKey(ContentKey.fromBytes(CONTENT_KEY), new Uint8Array(32), { random: counter(3) }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
