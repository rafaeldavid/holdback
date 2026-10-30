// Local content-addressed store: one file per object in a single directory, named by the 64-hex
// SHA-256 of its bytes. Writes go to a temp file and are renamed into place. Reads refuse symlinks
// and non-regular files (without blocking on a FIFO), read at most maxBytes + 1 bytes, and verify the
// hash. Filesystem errors other than the ones with a meaning here become io_error, whose fixed message
// carries no path.
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { Sha256 } from '../types.js';
import { sha256 } from '../crypto/hash.js';
import { StoreError, checkPut, idHex, resolveMaxBytes, type CiphertextStore, type StoreOptions } from './store.js';

export class LocalCiphertextStore implements CiphertextStore {
  readonly #root: string;
  readonly #maxBytes: number;

  constructor(root: string, options: StoreOptions = {}) {
    this.#root = resolve(root);
    this.#maxBytes = resolveMaxBytes(options);
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
    // Always write a temp file and rename it over the object: rename is atomic, replaces a planted
    // symlink rather than writing through it, and repairs a corrupted copy. The temp name is not an output.
    const tmp = join(this.#root, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
      await mkdir(this.#root, { recursive: true });
      await writeFile(tmp, bytes, { flag: 'wx' });
      await rename(tmp, path);
    } catch {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw new StoreError('io_error');
    }
    return id;
  }

  async get(id: Sha256): Promise<Uint8Array> {
    const path = this.#path(idHex(id));
    let handle;
    try {
      // O_NONBLOCK: opening a FIFO with no writer would otherwise block forever.
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new StoreError('not_found');
      if (code === 'ELOOP' || code === 'EISDIR') throw new StoreError('not_a_file');
      throw new StoreError('io_error');
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new StoreError('not_a_file');
      if (stat.size > this.#maxBytes) throw new StoreError('too_large');
      // Read at most min(size, maxBytes) + 1 bytes, so a file that grows after stat cannot make us
      // buffer more than the limit. Filling the spare byte means it changed while we read.
      const buffer = new Uint8Array(Math.min(stat.size, this.#maxBytes) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > this.#maxBytes) throw new StoreError('too_large');
      if (length === buffer.length) throw new StoreError('io_error');
      const bytes = buffer.slice(0, length);
      if (sha256(bytes) !== id) throw new StoreError('hash_mismatch');
      return bytes;
    } catch (e) {
      throw e instanceof StoreError ? e : new StoreError('io_error');
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}
