// Stage 0, intake (docs/judgment-and-defenses.md): unwrap the escrowed content key, check the
// ciphertext hash, decrypt, verify the plaintext hash, enforce the MIME allowlist and the 10 MB cap,
// decode strict UTF-8 and normalize. Nothing here interprets the content.
import type { Address, Delivery, Judgment, MimeType } from '@holdback/core';
import { err, ok, type Result } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { normalizeText } from './normalize.js';
import { UntrustedData } from './untrusted.js';

export const MAX_PLAINTEXT_BYTES = 10 * 1024 * 1024;
/** AES-256-GCM adds a 12-byte IV and a 16-byte tag in the content layout (core crypto/content.ts). */
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 28;
export const ALLOWED_MIME: readonly MimeType[] = ['text/csv', 'application/json', 'text/plain', 'text/markdown'];

export type Envelope = Delivery['encryptedKeys'][number];
/** Unwraps the content key escrowed to this adjudicator (x25519-xsalsa20poly1305). */
export type KeyUnwrapper = (envelope: Envelope) => Promise<Uint8Array>;
/** Decrypts the ciphertext with the content key. Throws on authentication failure. */
export type ContentOpener = (ciphertext: Uint8Array, key: Uint8Array) => Promise<Uint8Array>;

export type IntakeErrorCode =
  | 'mime_not_allowed'
  | 'mime_mismatch'
  | 'payload_too_large'
  | 'ciphertext_hash_mismatch'
  | 'no_key_for_recipient'
  | 'key_unwrap_failed'
  | 'decrypt_failed'
  | 'plaintext_hash_mismatch'
  | 'not_utf8';

export interface IntakeError {
  code: IntakeErrorCode;
  detail: string;
}

export interface IntakeInput {
  delivery: Delivery;
  ciphertext: Uint8Array;
  /** This adjudicator's address; selects the envelope to unwrap. */
  recipient: Address;
  unwrapKey: KeyUnwrapper;
  open?: ContentOpener;
  /**
   * The commitment's agreed `deliverable.format`. When given, a delivery in another format is
   * refused. Optional only for callers that check it themselves; the adjudicator service should pass it.
   */
  format?: MimeType;
}

export interface Intaken {
  /** The decoded plaintext exactly as delivered (a leading BOM dropped). Deterministic checks run on this. */
  raw: UntrustedData;
  /** Normalized plaintext. The screen and the prompts use this. */
  data: UntrustedData;
  /** The ASCII that Unicode tag characters spelled before normalization removed them. */
  hiddenTagText: UntrustedData;
  removed: { tagChars: number; zeroWidth: number; nfkcChanged: number };
  mime: MimeType;
  /** judgment.schema.json `intake`. */
  record: Judgment['intake'];
}

const fail = (code: IntakeErrorCode, detail: string) => err<IntakeError>({ code, detail });

/** The default opener: AES-256-GCM through Web Crypto, layout iv(12) || ciphertext || tag(16), as in core's crypto/content.ts. */
export const openAes256Gcm: ContentOpener = async (ciphertext, key) => {
  if (key.length !== 32) throw new Error('content key must be 32 bytes');
  if (ciphertext.length < 28) throw new Error('ciphertext too short');
  // Copies give Web Crypto ArrayBuffer-backed views, as its types require.
  const k = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['decrypt']);
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(ciphertext.subarray(0, 12)) }, k, new Uint8Array(ciphertext.subarray(12)));
  return new Uint8Array(pt);
};

export async function intake(input: IntakeInput): Promise<Result<Intaken, IntakeError>> {
  const { delivery, ciphertext, recipient } = input;
  const mime = delivery.plaintextMime;
  if (!ALLOWED_MIME.includes(mime)) return fail('mime_not_allowed', `${String(mime).slice(0, 80)} is not in the allowlist`);
  if (input.format !== undefined && mime !== input.format) return fail('mime_mismatch', `delivered ${mime}; the commitment agreed ${input.format}`);
  if (ciphertext.length > MAX_CIPHERTEXT_BYTES) return fail('payload_too_large', `ciphertext is ${ciphertext.length} bytes`);
  if (sha256(ciphertext) !== delivery.ciphertext.sha256) return fail('ciphertext_hash_mismatch', 'ciphertext does not match delivery.ciphertext.sha256');

  const envelope = delivery.encryptedKeys.find((e) => e.recipient.toLowerCase() === recipient.toLowerCase());
  if (!envelope) return fail('no_key_for_recipient', `no content key escrowed to ${recipient}`);
  let key: Uint8Array;
  try {
    key = await input.unwrapKey(envelope);
  } catch {
    return fail('key_unwrap_failed', 'the escrowed key could not be unwrapped');
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await (input.open ?? openAes256Gcm)(ciphertext, key);
  } catch {
    return fail('decrypt_failed', 'the escrowed key does not decrypt the ciphertext');
  }
  if (plaintext.length > MAX_PLAINTEXT_BYTES) return fail('payload_too_large', `plaintext is ${plaintext.length} bytes; the cap is ${MAX_PLAINTEXT_BYTES}`);
  if (sha256(plaintext) !== delivery.plaintextSha256) return fail('plaintext_hash_mismatch', 'plaintext does not match delivery.plaintextSha256');

  let raw: string;
  try {
    // fatal: refuse invalid UTF-8 rather than substitute U+FFFD. A leading BOM is dropped.
    raw = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    return fail('not_utf8', 'plaintext is not valid UTF-8');
  }
  const n = normalizeText(raw);
  return ok({
    raw: UntrustedData.wrap(raw),
    data: UntrustedData.wrap(n.text),
    hiddenTagText: UntrustedData.wrap(n.hiddenTagText),
    removed: { tagChars: n.tagChars, zeroWidth: n.zeroWidth, nfkcChanged: n.nfkcChanged },
    mime,
    record: { plaintextHashVerified: true, mime, bytes: plaintext.length, normalized: true },
  });
}
