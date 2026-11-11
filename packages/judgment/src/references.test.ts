// T-327: which reference files an adjudicator asks its content store for.
import { sha256 } from '@holdback/core/crypto';
import { describe, expect, it } from 'vitest';
import { loadReferences, referenceLookups } from './references.js';
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
    expect(asked).toEqual([`mem://ciphertext/${H}`, `mem://ciphertext/${other}`, `mem://ciphertext/${wrong}`]);
    expect([...references.keys()]).toEqual([H]);
    expect(references.get(H)).toEqual(bytes);
    expect(unavailable).toEqual([
      { sha256: other, uri: `mem://ciphertext/${other}`, reason: 'not_returned' },
      { sha256: wrong, uri: `mem://ciphertext/${wrong}`, reason: 'hash_mismatch' },
    ]);
  });
});
