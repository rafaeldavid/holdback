// T-394: every pointer into the agent guide in the operator's area names a file that exists under site/ and, where it
// names a heading, a heading that exists in that file. T-393 split the guide into a front door, one page per role and
// small reference files (https://crow.direct/ref/<name>); an agent that hits an error is sent to the smallest file that
// answers it, by URL and heading. A section that moves again fails this test until the pointer follows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const FILES = [
  'apps/operator/src/server.ts',
  'apps/operator/src/openapi/index.ts',
  'apps/test-agents/src/buyer.ts',
  'apps/test-agents/src/seller.ts',
  'apps/test-agents/src/sell-once.ts',
  'apps/test-agents/src/buyer.test.ts',
  'apps/test-agents/src/seller.test.ts',
  'apps/demo-cloud/src/world.ts',
  'spec/openapi/paths.json',
  'fixtures/terms/audit-report.yaml',
];
/** A guide file, by URL or by repository path, and the heading named right after it, quoted, if any. */
const POINTER = /(?:https:\/\/crow\.direct\/|site\/)((?:ref\/)?[a-z-]+\.txt)(?:[^"\n<]{0,6}"([A-Z][^"]+)")?/g;
const headings = (file: string) => readFileSync(join(root, 'site', file), 'utf8').split('\n').filter((l) => /^#+ /.test(l)).map((l) => l.replace(/^#+ /, ''));

describe('pointers into the agent guide (T-394)', () => {
  const found: Array<{ in: string; file: string; heading?: string }> = [];
  for (const f of FILES) {
    for (const m of readFileSync(join(root, f), 'utf8').matchAll(POINTER)) found.push({ in: f, file: m[1]!, ...(m[2] ? { heading: m[2] } : {}) });
  }

  it('finds the pointers it checks', () => {
    expect(found.map((p) => p.file)).toEqual(expect.arrayContaining(['ref/signing.txt', 'ref/http-seller.txt', 'ref/intake.txt', 'ref/checks.txt', 'llms.txt']));
  });

  it.each(found.map((p) => [`${p.in}: ${p.file}${p.heading ? ` "${p.heading}"` : ''}`, p] as const))('%s exists', (_name, p) => {
    const named = headings(p.file);
    expect(named.length, `site/${p.file} has headings`).toBeGreaterThan(0);
    if (p.heading) expect(named, `site/${p.file} has a heading "${p.heading}"`).toContain(p.heading);
  });

  it('the answers an agent receives name the smallest file and its heading', () => {
    const server = readFileSync(join(root, 'apps/operator/src/server.ts'), 'utf8');
    expect(server).toContain('see "Encodings" in https://crow.direct/ref/signing.txt');
    const buyer = readFileSync(join(root, 'apps/test-agents/src/buyer.ts'), 'utf8');
    expect(buyer).toContain('offer on Crow first (https://crow.direct/ref/http-seller.txt, "Offer")');
    expect(headings('ref/signing.txt')).toContain('Encodings');
    expect(headings('ref/http-seller.txt')).toContain('Offer');
  });
});
