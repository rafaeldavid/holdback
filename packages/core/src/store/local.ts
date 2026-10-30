// Local content-addressed store: one file per object in a single directory, named by the 64-hex
// SHA-256 of its bytes. Writes go to a temp file and are renamed into place. Reads refuse symlinks
// and non-regular files, cap the size, and verify the hash.
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { Sha256 } from '../types.js';
import { sha256 } from '../crypto/hash.js';
import { MAX_CIPHERTEXT_BYTES, StoreError, checkPut, idHex, type CiphertextStore, type StoreOptions } from './store.js';

export class LocalCiphertextStore implements CiphertextStore {
  readonly #root: string;
  readonly #maxBytes: number;

  constructor(root: string, options: StoreOptions = {}) {
    this.#root = resolve(root);
    this.#maxBytes = options.maxBytes ?? MAX_CIPHERTEXT_BYTES;
  }

  #path(hex: string): string {
    const path = join(this.#root, hex);
    // Defense in depth: idHex already admits only [0-9a-f]{64}.
    if (dirname(path) !== this.#root) throw new StoreError('invalid_id');
    return path;
  }

  async put(bytes: Uint8Array): Promise<Sha256> {
    checkPut(bytes, this.#maxBytes);
    const id = sha256(bytes);
    const path = this.#path(idHex(id));
    await mkdir(this.#root, { recursive: true });
    // Always rewrite: rename is atomic, and it repairs a corrupted copy. The temp name is not an output.
    const tmp = join(this.#root, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
      await writeFile(tmp, bytes, { flag: 'wx' });
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return id;
  }

  async get(id: Sha256): Promise<Uint8Array> {
    const path = this.#path(idHex(id));
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new StoreError('not_found');
      if (code === 'ELOOP' || code === 'EISDIR') throw new StoreError('not_a_file');
      throw e;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new StoreError('not_a_file');
      if (stat.size > this.#maxBytes) throw new StoreError('too_large');
      const bytes = new Uint8Array(await handle.readFile());
      if (bytes.length > this.#maxBytes) throw new StoreError('too_large');
      if (sha256(bytes) !== id) throw new StoreError('hash_mismatch');
      return bytes;
    } finally {
      await handle.close();
    }
  }
}
