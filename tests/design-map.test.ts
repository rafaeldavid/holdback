import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { NO_LOG_NOTE, build, collect, decisionsFrom } from '../scripts/design-map.mjs';
import { TOKENS_CSS } from '../site/brand/kit.mjs';

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

  it('reads each entry of docs/decisions-today.md by its Status line', () => {
    const text = readFileSync(new URL('../docs/decisions-today.md', import.meta.url), 'utf8');
    const sections = text.split(/^## (D\d+)\. .+$/m);
    const want: Record<string, string> = { 'needs rafa': 'open', deferred: 'deferred', adopted: 'decided', decided: 'decided', superseded: 'decided' };
    for (let i = 1; i < sections.length; i += 2) {
      const state = sections[i + 1].match(/^\*\*Status:\*\* ([a-zA-Z ]+?), \d{4}-\d{2}-\d{2}\.$/m)?.[1].toLowerCase();
      expect(state, sections[i]).toBeDefined();
      expect(data.decisions.find((d: { id: string }) => d.id === sections[i]).status, sections[i]).toBe(want[state as string]);
    }
  });

  describe('decision status from fixtures', () => {
    const entry = (id: string, title: string, ...lines: string[]) => `## ${id}. ${title}\n\n${lines.join('\n\n')}\n`;
    const fixture = [
      '# Decisions\n',
      entry('D1', 'Needs Rafa (ADR-0001)', '**Status:** needs Rafa, 2026-11-14.', '**Proposed 2026-11-14 by T-407; Rafa picks before the build.** Today the seller runs on one Mac.'),
      entry('D2', 'Open state', '**Status:** open, 2026-11-14.', '**Open.** Which chain comes first.'),
      entry('D3', 'Deferred to Phase 3', '**Status:** deferred, 2026-11-11.', '**Proposed 2026-11-11 by T-351,** after a research pass.'),
      entry('D4', 'Adopted by the agents', '**Status:** adopted, 2026-11-12.', '**Proposed 2026-11-11 by T-348,** after a red-team pass.'),
      entry('D5', 'Private deals stay deferred through the pilots', '**Status:** decided, 2026-11-14.', '**Decided 2026-11-14 by Rafa:** "private deals stay deferred - yes".'),
      entry('D6', 'Superseded by a later entry', '**Status:** superseded, 2026-11-13.', '**Decided 2026-11-01.** A, the old way.'),
      entry('D7', 'Legacy entry with no Status line', '**Decided 2026-10-30.** Deferred to Phase 2.'),
      entry('D8', 'Legacy decided entry', '**Decided 2026-10-30.** The simple way.'),
      entry('D9', 'Legacy open entry', '**Open.** Who pays the gas.'),
      entry('D10', 'Status line not in the form', '**Status:** maybe, sometime.', '**Decided 2026-10-30.** The simple way.'),
    ].join('\n');
    const byId = Object.fromEntries(decisionsFrom(fixture).map((d: { id: string }) => [d.id, d]));

    it('counts "needs Rafa" and "open" as waiting', () => {
      expect(byId.D1).toMatchObject({ status: 'open', state: 'needs rafa', title: 'Needs Rafa', adr: ['ADR-0001'], choice: '' });
      expect(byId.D1.detail).toMatch(/^Proposed 2026-11-14 by T-407/);
      expect(byId.D2).toMatchObject({ status: 'open', detail: 'Which chain comes first.' });
    });

    it('reads "deferred" as deferred and "adopted", "decided" and "superseded" as decided', () => {
      expect(byId.D3.status).toBe('deferred');
      expect(byId.D4).toMatchObject({ status: 'decided', choice: 'Adopted by the agents' });
      expect(byId.D6.status).toBe('decided');
    });

    it('keeps a decided entry decided when its Decided line contains "deferred" (D70)', () => {
      expect(byId.D5.status).toBe('decided');
      expect(byId.D5.choice.length).toBeGreaterThan(8);
    });

    it('falls back to the Decided or Open lead when an entry has no Status line in the form', () => {
      expect(byId.D7.status).toBe('deferred');
      expect(byId.D8.status).toBe('decided');
      expect(byId.D9.status).toBe('open');
      expect(byId.D10.status).toBe('decided');
    });
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

  it('takes its colours and fonts from the brand kit: its tokens inlined, none written by the template (T-424)', () => {
    const template = readFileSync(new URL('../tools/design-map/template.html', import.meta.url), 'utf8');
    // the same rule as site/check.mjs group 15: a colour or a font stack is written only in site/brand/tokens.css
    expect(template.match(/(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(/g)).toBeNull();
    expect(template.match(/-apple-system|BlinkMacSystemFont|Helvetica|Arial|Garamond|Menlo|\bsans-serif\b|\bmonospace\b|"SF (?:Pro|Mono)|fonts\.googleapis/g)).toBeNull();
    const html = build();
    expect(html).toContain(TOKENS_CSS.trim());
    expect(html).toContain('<header class="ck-bar">');
    expect(html).toContain('url("data:image/svg+xml,');
    expect(html).not.toContain('__KIT_');
    expect(html).not.toMatch(/prefers-color-scheme/);
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

// T-364: a standing doc carries no hand-written ID range or test count (docs/writing.md, "Numbers that drift").
// Dated records keep their numbers, so plan.md, operations.md, decisions, tasks, reviews and audit docs are left out.
describe('standing docs: no running numbers', () => {
  const STANDING = ['CLAUDE.md', 'README.md', 'contracts/README.md', 'formal/README.md', 'docs/PRD.md', 'docs/api.md', 'docs/architecture.md',
    'docs/demo.md', 'docs/judgment-and-defenses.md', 'docs/neutrality.md', 'docs/private-materials.md', 'docs/quickstart.md',
    'docs/redeploy-contracts.md', 'docs/team.md', 'docs/testing.md', 'docs/writing.md'];
  const DRIFT = [/\b(?:D|T-|ADR-)\d+ (?:to|through) (?:D|T-|ADR-)?\d+\b/, /\b\d[\d,]* of \d[\d,]* tests\b/, /\b\d[\d,]* tests in \d+ suites\b/];
  const hits = (text: string) => text.split('\n').flatMap((line, i) => (DRIFT.some((p) => p.test(line)) ? [i + 1] : []));

  it('finds the plainest patterns and leaves a dated sentence about one decision alone', () => {
    expect(hits('Decisions D1 to D9 are in the log.\nT-10 to T-12 merged.\n7 of 9 tests passed.\n9 tests in 3 suites')).toEqual([1, 2, 3, 4]);
    expect(hits('D4 was settled by D41.\n2 of 16 mutants survived.')).toEqual([]);
  });

  it.each(STANDING)('%s has no ID range or test count', (path) => {
    expect(hits(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))).toEqual([]);
  });
});
