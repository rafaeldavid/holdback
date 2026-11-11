import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { NO_LOG_NOTE, build, collect } from '../scripts/design-map.mjs';

// The page's own "What's live" block (its helpers and the lines between its live and recipes comments), run on a
// stand-in document: what a reader sees for the Live and Waiting lists.
function drawLive(map: { live: unknown; waiting: unknown }): Record<string, string> {
  const template = readFileSync(new URL('../tools/design-map/template.html', import.meta.url), 'utf8');
  const helpers = template.slice(template.indexOf('  function $(id)'), template.indexOf("  $('gen')"));
  const block = template.slice(template.indexOf('  /* live */'), template.indexOf('  /* recipes */'));
  expect(helpers).toContain('function esc(');
  expect(block).toContain("$('waiting')");
  const elements: Record<string, { innerHTML: string }> = {};
  runInNewContext(helpers + block, { M: map, document: { getElementById: (id: string) => (elements[id] ??= { innerHTML: '' }) } });
  return Object.fromEntries(Object.entries(elements).map(([id, el]) => [id, el.innerHTML]));
}

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

// The daily log is kept privately (docs/private-materials.md). A caller that holds it passes its folder; a build
// without it shows a note instead of the Live and Waiting lists.
describe('design map: the daily log', () => {
  const entry = (lead: string, live: string[], waiting: string[]) =>
    `# A day\n\n${lead}\n\n## Waiting on Rafa\n\n${waiting.map((w) => `- ${w}`).join('\n')}\n\n## Done today\n\n- Not live, not waiting.\n\n## Live\n\n${live.map((l) => `- ${l}`).join('\n')}\n\n## Next steps (resume here)\n\n1. A step.\n`;
  const withFolder = (run: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'design-map-log-'));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('stays out of this repository', () => {
    expect(existsSync(new URL('../docs/log', import.meta.url))).toBe(false);
  });

  it('reads the newest entry, by file name, of the folder it is given: the same lists as when the log lived here', () => {
    withFolder((dir) => {
      writeFileSync(join(dir, '2026-01-01.md'), entry('**Older.**', ['Old live item.'], ['Old waiting item.']));
      writeFileSync(join(dir, '2026-01-02.md'), entry('**The lead.** More text.', ['**Site:** `abc123`.', 'A <img src=x onerror=alert(1)> item.'], ['Merge PR 7.', 'Decide D99.']));
      // not entries: any other name
      writeFileSync(join(dir, 'README.md'), entry('**No.**', ['Never read.'], ['Never read.']));
      writeFileSync(join(dir, '2026-01-03.md.bak'), entry('**No.**', ['Never read.'], ['Never read.']));
      const data = collect({ logDir: dir });
      // the shape from before the move, with no note
      expect(data.live).toEqual({ date: '2026-01-02', lead: '**The lead.** More text.', items: ['**Site:** `abc123`.', 'A <img src=x onerror=alert(1)> item.'] });
      expect(data.waiting).toEqual(['Merge PR 7.', 'Decide D99.']);
      const html = build({ logDir: dir });
      expect(html).toContain('"waiting":["Merge PR 7.","Decide D99."]');
      expect(html).not.toContain(NO_LOG_NOTE);
      const page = drawLive(data);
      expect(page['live-lead']).toBe('As of 2 January 2026. The lead. More text.');
      expect(page['live-list']).toBe('<li>Site: <code>abc123</code>.</li><li>A &lt;img src=x onerror=alert(1)&gt; item.</li>');
      expect(page.waiting).toBe('<li>Merge PR 7.</li><li>Decide D99.</li>');
    });
  });

  it('says "nothing is waiting" only when a log entry has an empty list', () => {
    withFolder((dir) => {
      writeFileSync(join(dir, '2026-01-02.md'), entry('**The lead.**', ['One live item.'], []));
      const data = collect({ logDir: dir });
      expect(data.waiting).toEqual([]);
      expect(data.live).not.toHaveProperty('note');
      expect(drawLive(data).waiting).toBe('<li>Nothing is waiting on Rafa.</li>');
    });
  });

  it('without a log, by default or in an empty or missing folder: empty lists, a plain note, and no throw', () => {
    withFolder((dir) => {
      for (const options of [undefined, {}, { logDir: dir }, { logDir: join(dir, 'absent') }]) {
        const data = collect(options);
        expect(data.live).toEqual({ date: '', lead: '', items: [], note: NO_LOG_NOTE });
        expect(data.waiting).toEqual([]);
        // every other section is still there
        expect(data.phases.map((p: { n: number }) => p.n)).toEqual([0, 1, 2]);
        expect(build(options)).toContain(JSON.stringify(NO_LOG_NOTE));
        const page = drawLive(data);
        expect(page['live-lead']).toBe(NO_LOG_NOTE);
        expect(page['live-list']).toBe('');
        expect(page.waiting).toBe('<li>Not shown: this list comes from the daily log.</li>');
      }
    });
  });

  it('names no folder of this repository as the log’s home on the page', () => {
    expect(readFileSync(new URL('../tools/design-map/template.html', import.meta.url), 'utf8')).not.toContain('docs/log');
    expect(NO_LOG_NOTE).toMatch(/^This build has no daily log/);
  });
});
