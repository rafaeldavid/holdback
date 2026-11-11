// T-327: which reference files an adjudicator asks its content store for.
import { sha256 } from '@holdback/core/crypto';
import { describe, expect, it } from 'vitest';
import { runChecks } from './checks/index.js';
import { MAX_CIPHERTEXT_BYTES as STORE_MAX } from '@holdback/core/crypto';
import { loadReferences, REFERENCE_MAX_BYTES as MAX_CIPHERTEXT_BYTES, referenceLookups } from './references.js';
import { UntrustedData } from './untrusted.js';
import type { JudgmentCheck } from './terms.js';

const bytes = new TextEncoder().encode('id,v\n1,a\n');
const H = sha256(bytes);
const ref = (id: string, uri: string, hash: string = H): JudgmentCheck =>
  ({ id, type: 'reference_row_match_min', required: true, reference: { uri, sha256: hash }, keyColumn: 'id', minBps: 10_000 }) as JudgmentCheck;

describe('referenceLookups', () => {
  it('asks only for a URI that ends in the committed hash, once per hash, in order', () => {
    const checks = [
      ref('a', `https://op.example/v1/ciphertext/${H}`),
      ref('b', `https://other.example/v1/ciphertext/${H}`),
      { id: 'rows', type: 'row_count_range', required: true, min: 0, max: 9 } as JudgmentCheck,
    ];
    expect(referenceLookups(checks)).toEqual([{ sha256: H, uri: `https://op.example/v1/ciphertext/${H}` }]);
  });

  it('leaves out a URI that names no hash, another hash, or a hash with text after it', () => {
    const other = `sha256:${'1'.repeat(64)}`;
    expect(referenceLookups([ref('a', 'https://buyer.example/reference.csv')])).toEqual([]);
    expect(referenceLookups([ref('a', `https://op.example/v1/ciphertext/${other}`)])).toEqual([]);
    expect(referenceLookups([ref('a', `https://op.example/v1/ciphertext/${H}?x=1`)])).toEqual([]);
  });

  it('leaves out a committed hash that is not a lowercase sha256 id', () => {
    const upper = `sha256:${'A'.repeat(64)}`;
    expect(referenceLookups([ref('a', `mem://ciphertext/${upper}`, upper)])).toEqual([]);
  });
});

// T-327 review, finding 3 (Medium): the loader had no size cap of its own and read every reference on every pass.
describe('loadReferences: the size cap and the first unavailable reference', () => {
  it('stops at the first reference the store does not return: the rest are not read', async () => {
    const other = `sha256:${'2'.repeat(64)}`;
    const asked: string[] = [];
    const { unavailable } = await loadReferences([ref('b', `mem://ciphertext/${other}`, other), ref('a', `mem://ciphertext/${H}`)], async (uri) => {
      asked.push(uri);
      if (uri.endsWith(H)) return bytes;
      throw new Error('not in the store');
    });
    expect(asked).toEqual([`mem://ciphertext/${other}`]);
    expect(unavailable.map((u) => u.reason)).toEqual(['not_returned']);
  });

  it('reports a reference above the store ceiling as too large, without hashing it', async () => {
    const big = new Uint8Array(MAX_CIPHERTEXT_BYTES + 1);
    const hash = sha256(big);
    const { references, unavailable } = await loadReferences([ref('a', `mem://ciphertext/${hash}`, hash)], async () => big);
    expect(references.size).toBe(0);
    expect(unavailable).toEqual([{ sha256: hash, uri: `mem://ciphertext/${hash}`, reason: 'too_large' }]);
  });

  it('the cap is the store ceiling, 10,485,760 bytes, the limit POST /v1/ciphertext enforces', () => {
    expect(MAX_CIPHERTEXT_BYTES).toBe(STORE_MAX);
    expect(MAX_CIPHERTEXT_BYTES).toBe(10_485_760);
  });

  it('takes a reference of exactly the store ceiling: it refuses nothing a store would have taken', async () => {
    const atCap = new Uint8Array(MAX_CIPHERTEXT_BYTES);
    const hash = sha256(atCap);
    const { references, unavailable } = await loadReferences([ref('a', `mem://ciphertext/${hash}`, hash)], async () => atCap);
    expect(unavailable).toEqual([]);
    expect(references.get(hash)?.length).toBe(MAX_CIPHERTEXT_BYTES);
  });
});

describe('the check fails closed on a reference above the cap, so the preflight agrees', () => {
  it('a seller handing the preflight an oversize reference sees the check fail with the cap', () => {
    const big = new Uint8Array(MAX_CIPHERTEXT_BYTES + 1).fill(0x61);
    const hash = sha256(big);
    const { outcomes } = runChecks([ref('a', `mem://ciphertext/${hash}`, hash)], { data: UntrustedData.wrap('id,v\n1,a\n'), mime: 'text/csv', references: new Map([[hash, big]]) });
    expect(outcomes[0]).toEqual({ checkId: 'a', required: true, passed: false, detail: `reference is ${MAX_CIPHERTEXT_BYTES + 1} bytes; the cap is ${MAX_CIPHERTEXT_BYTES}` });
  });
});

describe('loadReferences', () => {
  it('keys the bytes by the committed hash and reports what the reader cannot return or returns wrong', async () => {
    const other = `sha256:${'2'.repeat(64)}`;
    const wrong = `sha256:${'3'.repeat(64)}`;
    const asked: string[] = [];
    const { references, unavailable } = await loadReferences(
      [ref('a', `mem://ciphertext/${H}`), ref('b', `mem://ciphertext/${other}`, other), ref('c', `mem://ciphertext/${wrong}`, wrong)],
      async (uri) => {
        asked.push(uri);
        if (uri.endsWith(H) || uri.endsWith(wrong)) return bytes;
        throw new Error('not in the store');
      },
    );
    // It stops at the first reference it cannot use, so the third is never read.
    expect(asked).toEqual([`mem://ciphertext/${H}`, `mem://ciphertext/${other}`]);
    expect([...references.keys()]).toEqual([H]);
    expect(references.get(H)).toEqual(bytes);
    expect(unavailable).toEqual([{ sha256: other, uri: `mem://ciphertext/${other}`, reason: 'not_returned' }]);
    const mismatch = await loadReferences([ref('c', `mem://ciphertext/${wrong}`, wrong)], async () => bytes);
    expect(mismatch.unavailable).toEqual([{ sha256: wrong, uri: `mem://ciphertext/${wrong}`, reason: 'hash_mismatch' }]);
  });
});
