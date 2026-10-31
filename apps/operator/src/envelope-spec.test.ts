// The envelope and content encryption as docs/api.md states them: the published test vectors come from core
// (@holdback/core/crypto), and a construction from the spec alone (tweetnacl + Web Crypto) matches them.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { ContentKey, encodePublicKey, encryptionKeyPairFromSecretKey, seal, unwrapKey, wrapKey } from '@holdback/core/crypto';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { ENVELOPE_SPEC } from './envelope-spec.js';

const fill = (n: number, b: number) => new Uint8Array(n).fill(b);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
/** A random source that hands out the given byte strings in order. */
const scripted = (...chunks: Uint8Array[]) => (length: number) => {
  const c = chunks.shift()!;
  if (c.length !== length) throw new Error(`asked for ${length} bytes, scripted ${c.length}`);
  return c;
};

const RECIPIENT_SECRET = fill(32, 0x01);
const EPHEMERAL_SECRET = fill(32, 0x02);
const NONCE = fill(24, 0x03);
const CONTENT_KEY = fill(32, 0x04);
const IV = fill(12, 0x05);
const PLAINTEXT = new TextEncoder().encode('hello, holdback');

export async function vectors() {
  const recipientPublicKey = encodePublicKey(encryptionKeyPairFromSecretKey(RECIPIENT_SECRET).publicKey);
  const envelope = wrapKey(ContentKey.fromBytes(CONTENT_KEY), recipientPublicKey, { random: scripted(EPHEMERAL_SECRET, NONCE) }).ciphertext;
  const sealed = await seal(PLAINTEXT, { random: scripted(CONTENT_KEY, IV) });
  return { recipientPublicKey, envelope, ciphertextHex: hex(sealed.ciphertext), plaintextSha256: sealed.plaintextSha256, ciphertextSha256: sealed.ciphertextSha256 };
}

describe('delivery encryption spec', () => {
  it('a spec-only construction (tweetnacl, Web Crypto) matches core byte for byte', async () => {
    const v = await vectors();
    const eph = nacl.box.keyPair.fromSecretKey(EPHEMERAL_SECRET);
    const box = nacl.box(CONTENT_KEY, NONCE, Buffer.from(v.recipientPublicKey, 'base64url'), eph.secretKey);
    expect(Buffer.from([...eph.publicKey, ...NONCE, ...box]).toString('base64url')).toBe(v.envelope);
    expect(v.envelope).toHaveLength(139);
    const aes = await webcrypto.subtle.importKey('raw', CONTENT_KEY, 'AES-GCM', false, ['encrypt']);
    const body = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: IV }, aes, PLAINTEXT));
    expect(hex(new Uint8Array([...IV, ...body]))).toBe(v.ciphertextHex);
    expect(hex(unwrapKey({ scheme: 'x25519-xsalsa20poly1305', ciphertext: v.envelope }, RECIPIENT_SECRET).exportBytes())).toBe(hex(CONTENT_KEY));
  });

  it('docs/api.md publishes these vectors and this spec', async () => {
    const v = await vectors();
    const doc = readFileSync(new URL('../../../docs/api.md', import.meta.url), 'utf8');
    for (const value of [v.recipientPublicKey, v.envelope, v.ciphertextHex, v.plaintextSha256, v.ciphertextSha256]) expect(doc).toContain(value);
    expect(doc).toContain(ENVELOPE_SPEC.envelope.layout);
    expect(doc).toContain(ENVELOPE_SPEC.content.layout);
  });
});
