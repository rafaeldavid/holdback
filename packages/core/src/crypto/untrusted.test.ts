// Deliverables are untrusted bytes (CLAUDE.md hard rules, T-014): the crypto and store modules may hash
// and encrypt them but never parse, decode or evaluate them. This scans the non-test sources for the
// constructs that would do so.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = new URL('.', import.meta.url).pathname;
const dirs = [here, join(here, '..', 'store')];

const FORBIDDEN: Array<[RegExp, string]> = [
  [/JSON\.parse/, 'JSON.parse'],
  [/TextDecoder/, 'TextDecoder'],
  [/\.toString\(\s*['"]utf-?8['"]/, 'utf8 decoding'],
  [/readFile\([^)]*['"]utf-?8['"]/, 'utf8 file read'],
  [/\beval\b|new Function|\bimport\(/, 'dynamic code'],
  [/from '\.\.\/parse\.js'/, 'schema parsing'],
  [/Math\.random|Date\.now/, 'nondeterminism'],
];

describe('crypto and store treat deliverables as opaque bytes', () => {
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(d, f)));

  it('finds the sources it scans', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(FORBIDDEN)('no source uses %s', (pattern) => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(pattern);
  });
});
