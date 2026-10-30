import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { build, collect } from '../scripts/design-map.mjs';

describe('design map', () => {
  const data = collect();

  it('reads every phase in docs/plan.md and marks exactly one as next or active', () => {
    expect(data.phases.map((p: { n: number }) => p.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(data.phases.filter((p: { status: string }) => p.status === 'next' || p.status === 'active')).toHaveLength(1);
  });

  it('reads every decision with a known status', () => {
    expect(data.decisions.length).toBeGreaterThanOrEqual(9);
    for (const d of data.decisions) expect(['decided', 'deferred', 'open']).toContain(d.status);
  });

  it('reads a status for every ADR and every task', () => {
    for (const a of data.adrs) expect(a.status).not.toBe('Unknown');
    for (const t of data.tasks) expect(t.status).not.toBe('');
  });

  it('extracts API endpoints and examples from docs/api.md', () => {
    expect(data.api.endpoints.length).toBeGreaterThan(10);
    expect(data.api.examples.map((e: { lang: string }) => e.lang)).toContain('http');
  });

  it('embeds the data in the template with no raw closing tags', () => {
    const html = build();
    expect(html).not.toContain('/*__MAP_DATA__*/null');
    const embedded = html.slice(html.indexOf('window.MAP = '), html.indexOf(';</script>'));
    expect(embedded).not.toContain('</');
  });
});
