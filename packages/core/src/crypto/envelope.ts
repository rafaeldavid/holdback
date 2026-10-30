// Key envelopes for the two-sided hold (ADR-0012, ADR-0016 section 8): the content key sealed to each
// recipient with NaCl box (x25519-xsalsa20poly1305) through tweetnacl, from a fresh ephemeral sender key.
//
// Envelope bytes: ephemeralPublicKey (32) || nonce (24) || box(contentKey) (48), base64url without
// padding, which is the delivery schema's SealedKey.ciphertext. The delivery is signed by the seller,
// so the ephemeral sender key does not need to identify anyone.
import nacl from 'tweetnacl';
import type { Address, Base64Url, SealedKey } from '../types.js';
import { CONTENT_KEY_BYTES, ContentKey } from './content.js';
import { CryptoError } from './errors.js';
import { draw, systemRandom, type RandomSource } from './random.js';

export const ENVELOPE_SCHEME = 'x25519-xsalsa20poly1305' as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const ENVELOPE_BYTES = KEY_BYTES + NONCE_BYTES + CONTENT_KEY_BYTES + 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface EncryptionKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface WrapOptions {
  /** Draws the ephemeral secret key (32 bytes) and then the nonce (24 bytes), per envelope. */
  random?: RandomSource;
}

export interface Recipient {
  recipient: Address;
  /** Raw 32 bytes, or base64url as published in encryptionPublicKey / buyerEncryptionPublicKey. */
  publicKey: Uint8Array | Base64Url;
}

/** One entry of delivery.encryptedKeys. */
export type EncryptedKey = { recipient: Address } & SealedKey;

/** Strict base64url: no padding, no foreign characters, and canonical (re-encodes to the same text). */
function decodeBase64Url(text: unknown): Uint8Array | undefined {
  if (typeof text !== 'string' || !BASE64URL.test(text) || text.length % 4 === 1) return undefined;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? new Uint8Array(bytes) : undefined;
}

const encodeBase64Url = (bytes: Uint8Array): Base64Url => Buffer.from(bytes).toString('base64url');

// X25519 ignores the top bit of a u-coordinate, so a key with it set has a twin. Refuse it.
const canonicalPoint = (key: Uint8Array): boolean => key.length === KEY_BYTES && (key[KEY_BYTES - 1]! & 0x80) === 0;

const allZero = (bytes: Uint8Array): boolean => bytes.every((b) => b === 0);

export function encryptionKeyPairFromSecretKey(secretKey: Uint8Array): EncryptionKeyPair {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== KEY_BYTES) throw new CryptoError('invalid_secret_key');
  return nacl.box.keyPair.fromSecretKey(Uint8Array.from(secretKey));
}

export function generateEncryptionKeyPair(random: RandomSource = systemRandom): EncryptionKeyPair {
  return encryptionKeyPairFromSecretKey(draw(random, KEY_BYTES));
}

export const encodePublicKey = (publicKey: Uint8Array): Base64Url => {
  if (!canonicalPoint(publicKey)) throw new CryptoError('invalid_public_key');
  return encodeBase64Url(publicKey);
};

export function decodePublicKey(publicKey: Uint8Array | Base64Url): Uint8Array {
  const bytes = typeof publicKey === 'string' ? decodeBase64Url(publicKey) : publicKey instanceof Uint8Array ? Uint8Array.from(publicKey) : undefined;
  if (!bytes || !canonicalPoint(bytes)) throw new CryptoError('invalid_public_key');
  return bytes;
}

/** Seals the content key to one recipient public key. */
export function wrapKey(key: ContentKey, recipientPublicKey: Uint8Array | Base64Url, options: WrapOptions = {}): SealedKey {
  if (!(key instanceof ContentKey)) throw new CryptoError('invalid_key');
  const publicKey = decodePublicKey(recipientPublicKey);
  const random = options.random ?? systemRandom;
  const ephemeral = nacl.box.keyPair.fromSecretKey(draw(random, KEY_BYTES));
  const shared = nacl.box.before(publicKey, ephemeral.secretKey);
  // A low-order recipient point yields an all-zero X25519 output that anyone can compute.
  if (allZero(nacl.scalarMult(ephemeral.secretKey, publicKey))) throw new CryptoError('invalid_public_key');
  const nonce = draw(random, NONCE_BYTES);
  const box = nacl.box.after(key.exportBytes(), nonce, shared);
  const envelope = new Uint8Array(ENVELOPE_BYTES);
  envelope.set(ephemeral.publicKey, 0);
  envelope.set(nonce, KEY_BYTES);
  envelope.set(box, KEY_BYTES + NONCE_BYTES);
  return { scheme: ENVELOPE_SCHEME, ciphertext: encodeBase64Url(envelope) };
}

/** Opens a key envelope with the recipient's secret key. Never returns bytes that failed authentication. */
export function unwrapKey(sealed: SealedKey, recipientSecretKey: Uint8Array): ContentKey {
  if (sealed?.scheme !== ENVELOPE_SCHEME) throw new CryptoError('unsupported_scheme');
  if (!(recipientSecretKey instanceof Uint8Array) || recipientSecretKey.length !== KEY_BYTES) throw new CryptoError('invalid_secret_key');
  const envelope = decodeBase64Url(sealed.ciphertext);
  if (!envelope || envelope.length !== ENVELOPE_BYTES) throw new CryptoError('malformed_envelope');
  const ephemeralPublicKey = envelope.slice(0, KEY_BYTES);
  if (!canonicalPoint(ephemeralPublicKey)) throw new CryptoError('malformed_envelope');
  const nonce = envelope.slice(KEY_BYTES, KEY_BYTES + NONCE_BYTES);
  const box = envelope.slice(KEY_BYTES + NONCE_BYTES);
  const opened = nacl.box.open(box, nonce, ephemeralPublicKey, Uint8Array.from(recipientSecretKey));
  if (!opened || opened.length !== CONTENT_KEY_BYTES) throw new CryptoError('unwrap_failed');
  return ContentKey.fromBytes(opened);
}

const sameAddress = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Builds delivery.encryptedKeys: one envelope per recipient (primary, fallback and appeal adjudicators,
 * and the buyer for early acceptance), in the order given.
 */
export function wrapKeyForRecipients(key: ContentKey, recipients: readonly Recipient[], options: WrapOptions = {}): EncryptedKey[] {
  recipients.forEach((r, i) => {
    if (recipients.findIndex((o) => sameAddress(o.recipient, r.recipient)) !== i) throw new CryptoError('duplicate_recipient');
  });
  return recipients.map((r) => ({ recipient: r.recipient, ...wrapKey(key, r.publicKey, options) }));
}

/** Finds this recipient's envelope in delivery.encryptedKeys (or a decision's) and opens it. */
export function unwrapKeyFor(encryptedKeys: readonly EncryptedKey[], recipient: Address, recipientSecretKey: Uint8Array): ContentKey {
  const mine = encryptedKeys.filter((e) => sameAddress(e.recipient, recipient));
  if (mine.length === 0) throw new CryptoError('no_envelope_for_recipient');
  if (mine.length > 1) throw new CryptoError('duplicate_recipient');
  return unwrapKey(mine[0]!, recipientSecretKey);
}
