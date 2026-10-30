// Content encryption for the two-sided hold (ADR-0012, ADR-0016 section 8): AES-256-GCM through
// Node's Web Crypto under a fresh 32-byte key per deliverable.
//
// Ciphertext layout: iv (12 bytes) || AES-GCM ciphertext || tag (16 bytes). The delivery schema has
// no IV field, so the IV travels with the ciphertext and is covered by ciphertext.sha256.
import { webcrypto } from 'node:crypto';
import type { Sha256 } from '../types.js';
import { CryptoError } from './errors.js';
import { isSha256, sha256 } from './hash.js';
import { draw, systemRandom, type RandomSource } from './random.js';

export const CONTENT_CIPHER = 'aes-256-gcm' as const;
export const CONTENT_KEY_BYTES = 32;
/** delivery.schema.json ciphertext.bytes maximum. */
export const MAX_CIPHERTEXT_BYTES = 10_485_760;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const REDACTED = 'ContentKey(redacted)';

/**
 * A 32-byte AES-256 content key. Its bytes are held in a private field and are never rendered by
 * inspect, JSON or string coercion; read them only with exportBytes(), for example to wrap them.
 */
export class ContentKey {
  readonly #bytes: Uint8Array<ArrayBuffer>;

  private constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.#bytes = bytes;
  }

  static fromBytes(bytes: Uint8Array): ContentKey {
    if (!(bytes instanceof Uint8Array) || bytes.length !== CONTENT_KEY_BYTES) throw new CryptoError('invalid_key');
    return new ContentKey(Uint8Array.from(bytes));
  }

  /** A copy of the raw key bytes. */
  exportBytes(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.#bytes);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

export interface SealedContent {
  ciphertext: Uint8Array;
  key: ContentKey;
  plaintextSha256: Sha256;
  ciphertextSha256: Sha256;
}

export interface SealOptions {
  /** Draws the key (32 bytes) and then the IV (12 bytes). Defaults to Web Crypto. */
  random?: RandomSource;
}

function importKey(key: ContentKey, usage: 'encrypt' | 'decrypt'): Promise<webcrypto.CryptoKey> {
  return webcrypto.subtle.importKey('raw', key.exportBytes(), { name: 'AES-GCM' }, false, [usage]);
}

/** Encrypts opaque bytes under a fresh content key. The plaintext is hashed, never parsed. */
export async function seal(plaintext: Uint8Array, options: SealOptions = {}): Promise<SealedContent> {
  if (!(plaintext instanceof Uint8Array)) throw new CryptoError('invalid_plaintext');
  if (plaintext.length > MAX_CIPHERTEXT_BYTES - IV_BYTES - TAG_BYTES) throw new CryptoError('plaintext_too_large');
  const random = options.random ?? systemRandom;
  const key = ContentKey.fromBytes(draw(random, CONTENT_KEY_BYTES));
  const iv = draw(random, IV_BYTES);
  const body = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, await importKey(key, 'encrypt'), Uint8Array.from(plaintext)),
  );
  const ciphertext = new Uint8Array(IV_BYTES + body.length);
  ciphertext.set(iv, 0);
  ciphertext.set(body, IV_BYTES);
  return { ciphertext, key, plaintextSha256: sha256(plaintext), ciphertextSha256: sha256(ciphertext) };
}

/**
 * Decrypts, authenticates and checks the result against the committed plaintext hash (the signed
 * delivery's plaintextSha256). The hash is required: AES-GCM is not key-committing, so one ciphertext
 * can authenticate under two keys to different plaintexts, and only the signed hash pins which
 * plaintext the seller committed to. A wrong key or changed byte throws decrypt_failed; a key that
 * authenticates but yields other bytes throws plaintext_hash_mismatch.
 */
export async function open(ciphertext: Uint8Array, key: ContentKey, expectedPlaintextSha256: Sha256): Promise<Uint8Array> {
  if (!isSha256(expectedPlaintextSha256)) throw new CryptoError('invalid_expected_hash');
  if (!(key instanceof ContentKey)) throw new CryptoError('invalid_key');
  if (!(ciphertext instanceof Uint8Array) || ciphertext.length < IV_BYTES + TAG_BYTES) throw new CryptoError('malformed_ciphertext');
  const iv = ciphertext.slice(0, IV_BYTES);
  const body = ciphertext.slice(IV_BYTES);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, await importKey(key, 'decrypt'), body));
  } catch {
    // Web Crypto's OperationError is dropped rather than attached as a cause, to keep errors uniform.
    throw new CryptoError('decrypt_failed');
  }
  if (sha256(plaintext) !== expectedPlaintextSha256) throw new CryptoError('plaintext_hash_mismatch');
  return plaintext;
}
