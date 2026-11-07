import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { build, collect } from '../scripts/design-map.mjs';

describe('design map', () => {
  const data = collect();

  it('reads the public plan: Phases 0 to 2, and any phase not done is shown as next or active', () => {
    expect(data.phases.map((p: { n: number }) => p.n)).toEqual([0, 1, 2]);
    // Phases may overlap, so more than one can be active; the first phase that is not done, if any, is next or active.
    const first = data.phases.find((p: { status: string }) => p.status !== 'done');
    if (first) expect(['next', 'active']).toContain(first.status);
  });

  it('shows the current build and its record only: no proposed rows and no backlog', () => {
    expect(data).not.toHaveProperty('backlog');
    for (const p of data.phases) for (const it of p.items) expect(it).not.toHaveProperty('proposal');
    const html = build();
    expect(html).not.toContain('id="backlog"');
    expect(html).not.toContain('id="proposed"');
  });

  it('links the engineering roadmap and says it is private', () => {
    const html = build();
    expect(html).toContain('https://claude.ai/artifact/8qoP6eBhJ9GTcfc9Doy26i');
    expect(html).toContain('private: founders only');
  });

  it('reads a task status by its leading keyword, so a note after it does not hide "done"', () => {
    const t010 = data.tasks.find((t: { id: string }) => t.id === 'T-010');
    expect(t010.status).toBe('done');
  });

  it('reads every decision with a known status', () => {
    expect(data.decisions.length).toBeGreaterThanOrEqual(9);
    for (const d of data.decisions) expect(['decided', 'deferred', 'open']).toContain(d.status);
  });

  it('reads every bold "Decided" lead as decided, whatever punctuation closes it', () => {
    const text = readFileSync(new URL('../docs/decisions-today.md', import.meta.url), 'utf8');
    const sections = text.split(/^## (D\d+)\. /m);
    for (let i = 1; i < sections.length; i += 2) {
      if (!/\*\*Decided /.test(sections[i + 1])) continue;
      expect(data.decisions.find((d: { id: string }) => d.id === sections[i]).status).not.toBe('open');
    }
  });

  it('names the chosen option for every decided decision instead of a bare letter', () => {
    for (const d of data.decisions.filter((x: { status: string }) => x.status === 'decided')) {
      expect(d.choice.length).toBeGreaterThan(8);
      expect(d.choice).not.toMatch(/^[A-D]([.,]|$)/);
    }
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
