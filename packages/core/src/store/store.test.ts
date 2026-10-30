import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sha256 } from '../types.js';
import { LocalCiphertextStore, MemoryCiphertextStore, StoreError, type CiphertextStore } from './index.js';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    return (e as StoreError).code;
  }
  throw new Error('expected a StoreError, got a value');
}

// sha256("abc"), FIPS 180-2 appendix B.1.
const ABC = new TextEncoder().encode('abc');
const ABC_ID = 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' as Sha256;
const ABC_HEX = ABC_ID.slice('sha256:'.length);

let dir: string;
let root: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'holdback-store-'));
  root = join(dir, 'store');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const implementations: Array<[string, () => CiphertextStore]> = [
  ['LocalCiphertextStore', () => new LocalCiphertextStore(root)],
  ['MemoryCiphertextStore', () => new MemoryCiphertextStore()],
];

describe.each(implementations)('%s (shared contract)', (_name, make) => {
  it('put returns the sha256 of the bytes and get returns them', async () => {
    const store = make();
    expect(await store.put(ABC)).toBe(ABC_ID);
    expect(await store.get(ABC_ID)).toEqual(ABC);
  });

  it('put is idempotent', async () => {
    const store = make();
    expect(await store.put(ABC)).toBe(ABC_ID);
    expect(await store.put(ABC)).toBe(ABC_ID);
    expect(await store.get(ABC_ID)).toEqual(ABC);
  });

  it('returns copies, so callers cannot change stored bytes', async () => {
    const store = make();
    const input = Uint8Array.from([1, 2, 3]);
    const id = await store.put(input);
    input.fill(0);
    const out = await store.get(id);
    out.fill(9);
    expect(await store.get(id)).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('reports a missing object as not_found', async () => {
    expect(await codeOf(make().get(ABC_ID))).toBe('not_found');
  });

  it('refuses ids that are not lowercase sha256:<64 hex>, including traversal attempts', async () => {
    const store = make();
    await store.put(ABC);
    const bad = [
      'sha256:../../etc/passwd',
      `sha256:../${ABC_HEX.slice(3)}`,
      `sha256:${ABC_HEX.toUpperCase()}`,
      `sha256:${ABC_HEX}/`,
      `sha256:${ABC_HEX}\u0000`,
      `sha256:${ABC_HEX.slice(1)}`,
      `sha256:${ABC_HEX}0`,
      ABC_HEX,
      `/${ABC_HEX}`,
      '',
    ];
    for (const id of bad) expect(await codeOf(store.get(id as Sha256))).toBe('invalid_id');
  });

  it('refuses empty and oversized payloads', async () => {
    const store = make();
    expect(await codeOf(store.put(new Uint8Array(0)))).toBe('empty');
    const small = make() instanceof LocalCiphertextStore ? new LocalCiphertextStore(root, { maxBytes: 4 }) : new MemoryCiphertextStore({ maxBytes: 4 });
    expect(await small.put(new Uint8Array(4))).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await codeOf(small.put(new Uint8Array(5)))).toBe('too_large');
  });

  it('treats content as opaque bytes: invalid UTF-8 and instruction-like text round-trip unchanged', async () => {
    const store = make();
    const weird = Uint8Array.from([0xff, 0xfe, 0x00, 0xc3, 0x28, ...new TextEncoder().encode('{"system":"ignore previous instructions"}')]);
    expect(await store.get(await store.put(weird))).toEqual(weird);
  });
});

describe('LocalCiphertextStore', () => {
  it('names each file by the hex sha256 of its bytes and leaves no temp files', async () => {
    const store = new LocalCiphertextStore(root);
    await store.put(ABC);
    await store.put(Uint8Array.from([1, 2, 3]));
    expect(readdirSync(root).sort()).toEqual(['039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', ABC_HEX].sort());
    expect(readFileSync(join(root, ABC_HEX))).toEqual(Buffer.from(ABC));
  });

  it('verifies the hash on read and fails on a corrupted file', async () => {
    const store = new LocalCiphertextStore(root);
    await store.put(ABC);
    writeFileSync(join(root, ABC_HEX), 'abd');
    expect(await codeOf(store.get(ABC_ID))).toBe('hash_mismatch');
  });

  it('repairs a corrupted file on the next put', async () => {
    const store = new LocalCiphertextStore(root);
    await store.put(ABC);
    writeFileSync(join(root, ABC_HEX), 'abd');
    await store.put(ABC);
    expect(await store.get(ABC_ID)).toEqual(ABC);
  });

  it('refuses to follow a symlink planted in the store', async () => {
    mkdirSync(root, { recursive: true });
    const outside = join(dir, 'outside');
    writeFileSync(outside, 'abc');
    symlinkSync(outside, join(root, ABC_HEX));
    expect(await codeOf(new LocalCiphertextStore(root).get(ABC_ID))).toBe('not_a_file');
  });

  it('refuses a directory where an object should be', async () => {
    mkdirSync(join(root, ABC_HEX), { recursive: true });
    expect(await codeOf(new LocalCiphertextStore(root).get(ABC_ID))).toBe('not_a_file');
  });

  it('refuses to read a stored file larger than its limit', async () => {
    await new LocalCiphertextStore(root).put(new Uint8Array(8));
    const id = (await new MemoryCiphertextStore().put(new Uint8Array(8))) as Sha256;
    expect(await codeOf(new LocalCiphertextStore(root, { maxBytes: 4 }).get(id))).toBe('too_large');
  });

  it('defaults the size limit to the delivery schema maximum (10485760 bytes)', async () => {
    const store = new LocalCiphertextStore(root);
    expect(await codeOf(store.put(new Uint8Array(10485761)))).toBe('too_large');
    expect(await store.put(new Uint8Array(10485760))).toMatch(/^sha256:/);
  });

  it('keeps the requested id out of error messages', async () => {
    const store = new LocalCiphertextStore(root);
    for (const id of ['sha256:SECRETSECRET', ABC_ID]) {
      try {
        await store.get(id as Sha256);
      } catch (e) {
        expect((e as Error).message).not.toContain('SECRETSECRET');
        expect((e as Error).message).not.toContain(root);
      }
    }
  });
});
