// Ciphertext store (ADR-0016 section 8, ADR-0011): content-addressed by the SHA-256 of the stored
// bytes. Any party can fetch an object and check it against the delivery's ciphertext.sha256; get()
// does that check itself and never returns bytes that do not hash to the requested id.
import type { Sha256 } from '../types.js';

/** delivery.schema.json ciphertext.bytes maximum. */
export const MAX_CIPHERTEXT_BYTES = 10_485_760;

export interface CiphertextStore {
  /** Stores opaque bytes and returns their `sha256:<hex>`. Idempotent. */
  put(bytes: Uint8Array): Promise<Sha256>;
  /** Returns the bytes whose SHA-256 is `id`, after verifying it. */
  get(id: Sha256): Promise<Uint8Array>;
}

export interface StoreOptions {
  /** Largest object accepted by put or returned by get. Defaults to MAX_CIPHERTEXT_BYTES. */
  maxBytes?: number;
}

export type StoreErrorCode = 'invalid_id' | 'not_found' | 'hash_mismatch' | 'not_a_file' | 'empty' | 'too_large';

// Fixed messages: neither the requested id nor a filesystem path is echoed.
const MESSAGES: Record<StoreErrorCode, string> = {
  invalid_id: 'object id must be sha256: followed by 64 lowercase hex digits',
  not_found: 'no object with this id',
  hash_mismatch: 'stored bytes do not match their id',
  not_a_file: 'stored object is not a regular file',
  empty: 'refusing to store zero bytes',
  too_large: 'object exceeds the store size limit',
};

export class StoreError extends Error {
  override readonly name = 'StoreError';
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

const ID = /^sha256:([0-9a-f]{64})$/;

/** The hex digest of a valid id. Anything else, including path tricks, is invalid_id. */
export function idHex(id: unknown): string {
  const match = typeof id === 'string' ? ID.exec(id) : null;
  if (!match) throw new StoreError('invalid_id');
  return match[1]!;
}

export function checkPut(bytes: Uint8Array, maxBytes: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new StoreError('empty');
  if (bytes.length > maxBytes) throw new StoreError('too_large');
}
