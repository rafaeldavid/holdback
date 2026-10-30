// In-memory store with the same contract as the local one, for tests and in-process SimChain runs.
import type { Sha256 } from '../types.js';
import { sha256 } from '../crypto/hash.js';
import { StoreError, checkPut, idHex, resolveMaxBytes, type CiphertextStore, type StoreOptions } from './store.js';

export class MemoryCiphertextStore implements CiphertextStore {
  readonly #objects = new Map<string, Uint8Array>();
  readonly #maxBytes: number;

  constructor(options: StoreOptions = {}) {
    this.#maxBytes = resolveMaxBytes(options);
  }

  async put(bytes: Uint8Array): Promise<Sha256> {
    checkPut(bytes, this.#maxBytes);
    const id = sha256(bytes);
    this.#objects.set(idHex(id), Uint8Array.from(bytes));
    return id;
  }

  async get(id: Sha256): Promise<Uint8Array> {
    const bytes = this.#objects.get(idHex(id));
    if (!bytes) throw new StoreError('not_found');
    if (bytes.length > this.#maxBytes) throw new StoreError('too_large');
    if (sha256(bytes) !== id) throw new StoreError('hash_mismatch');
    return Uint8Array.from(bytes);
  }
}
