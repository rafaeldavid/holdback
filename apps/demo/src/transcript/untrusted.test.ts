// Deliverables are untrusted, output surfaces (docs/team.md, Rules and checks): text that can come from a
// deliverable or a party must not reach the terminal, Markdown or HTML as escapes, markup, links or invisible text.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../cli.js';
import { standInSource } from '../source/stand-in.js';
import { renderHtml } from './render-html.js';
import { renderJson } from './render-json.js';
import { renderMarkdown } from './render-md.js';
import type { BeatTranscript, DemoEvent, EventSource } from './types.js';
import { fenced, mdText, plain, safeJson } from './untrusted.js';
import { withAdjudicators } from './adjudicators.fixture.js';
import { judgePromptView } from './judge.js';

const HOSTILE = [
  'HOSTILE',
  '![x](https://evil.example/leak)',
  '[click](https://evil.example)',
  '<img src=x onerror=alert(1)>',
  '\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007',
  '\u001b[2J',
  '‮gnp.exe',
  '\u{E0041}\u{E0042}',
  '\n# pwned heading',
  '\r\n| injected | row |',
  '```',
  'www.evil.example',
].join(' ');

const BAD_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]|[\u{e0000}-\u{e007f}]/u;

async function hostileTranscript(): Promise<BeatTranscript> {
  const t = await standInSource().run(7);
  const extra: DemoEvent[] = [
    { kind: 'checks', atMs: 1, actor: 'benchA', results: [{ id: 'cols', type: 'csv_columns_exact', required: true, passed: false, detail: HOSTILE }] },
    { kind: 'screen', atMs: 2, actor: 'benchA', flagged: true, signals: ['encoded_run'], consequence: HOSTILE },
    { kind: 'panel', atMs: 3, actor: 'benchA', seed: '0xabc', seedSource: 'commit-reveal', rule: HOSTILE, judges: [{ seat: 1, model: 'placeholder-claude-a-20260601', family: 'claude', verdict: 'pass', score: 400 }], outcome: 'accept' },
    { kind: 'signed', atMs: 4, actor: 'seller', messageType: 'Offer', signer: '0x5969b88346862fcd013a8f1eee8a33e50335a684', body: { description: HOSTILE }, signature: '0xab' },
    // The judge prompt quotes the terms and the deliverable, and the verdict is model output over them (T-019).
    // The verdict is left raw here, so the renderers are shown safe without the source's ingestion pass.
    {
      kind: 'judge-prompt',
      atMs: 5,
      actor: 'benchA',
      seat: 1,
      model: 'placeholder-claude-a-20260601',
      family: 'claude',
      inputHash: `0x${'a7'.repeat(32)}`,
      scripted: true,
      prompt: judgePromptView(`You are one judge.\n${HOSTILE}`, ['intro', '<<<BEGIN UNTRUSTED DATA ab>>>', ...Array.from({ length: 40 }, (_, i) => `^ab^ row ${i} ${HOSTILE}`), '<<<END UNTRUSTED DATA ab>>>'].join('\n')),
      verdict: { overall: 'pass', criteria: [{ id: HOSTILE, score: 4, evidence: HOSTILE }], injectionSuspected: true, injectionEvidence: HOSTILE, rationale: HOSTILE },
    },
  ];
  // A registration name is party text too (x-holdback-untrusted): it reaches the proposal line and the profile (T-017).
  return withAdjudicators({ ...t, events: [...t.events.slice(0, 1), ...extra, ...t.events.slice(1)] }, HOSTILE);
}

/** CommonMark fences: a block opens on a line of 3+ backticks and closes only on a line of at least as many. */
function splitFences(md: string): { outside: string; blocks: { fence: string; lang: string; lines: string[] }[]; open: boolean } {
  const outside: string[] = [];
  const blocks: { fence: string; lang: string; lines: string[] }[] = [];
  let cur: (typeof blocks)[number] | undefined;
  for (const line of md.split('\n')) {
    if (cur) {
      const close = /^(`{3,})\s*$/.exec(line);
      if (close && close[1]!.length >= cur.fence.length) cur = undefined;
      else cur.lines.push(line);
      continue;
    }
    const open = /^(`{3,})([^`]*)$/.exec(line);
    if (open) blocks.push((cur = { fence: open[1]!, lang: open[2]!.trim(), lines: [] }));
    else outside.push(line);
  }
  return { outside: outside.join('\n'), blocks, open: cur !== undefined };
}

describe('untrusted text helpers', () => {
  it('plain removes controls, bidi and tag characters and joins lines', () => {
    const p = plain(HOSTILE);
    expect(p).not.toMatch(BAD_CHARS);
    expect(p).not.toMatch(/[\r\n]/);
  });

  it('mdText escapes Markdown and HTML specials and breaks autolinks', () => {
    const m = mdText(HOSTILE);
    expect(m).not.toMatch(/(^|[^\\])!\[/);
    expect(m).not.toMatch(/(^|[^\\])\]\(/);
    expect(m).not.toMatch(/(^|[^\\])<img/);
    expect(m).not.toContain('https://');
    expect(m).not.toMatch(/(^|[^\\])`/);
    expect(m).not.toContain('www.');
  });

  it('safeJson writes invisible characters as escapes; fenced outgrows any backtick run', () => {
    expect(safeJson({ d: '‮\u{E0041}' })).toContain('\\u202e');
    expect(safeJson({ d: '\u{E0041}' })).toContain('\\udb40\\udc41');
    expect(fenced('json', 'a ```` b')).toMatch(/^`{5}json\n/);
  });
});

describe('hostile deliverable-derived text on every output surface', () => {
  it('terminal: no escape sequence, bidi or tag character, and no line break inside a narrated line', async () => {
    const t = await hostileTranscript();
    const source: EventSource = { name: 'hostile', beats: () => [7], run: async () => t };
    const out = mkdtempSync(join(tmpdir(), 't013-hostile-'));
    const logs: string[] = [];
    try {
      expect(await main([], { outDir: out, source, log: (s) => void logs.push(s), error: () => undefined })).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    const hostileLines = logs.filter((l) => l.includes('HOSTILE'));
    expect(hostileLines.length).toBeGreaterThanOrEqual(3);
    for (const l of hostileLines) {
      expect(l).not.toMatch(BAD_CHARS);
      expect(l).not.toMatch(/[\r\n]/);
    }
  });

  it('Markdown: no image, link, inline HTML, heading, table row or fence break', async () => {
    const md = renderMarkdown(await hostileTranscript());
    expect(md).not.toMatch(BAD_CHARS);
    // Outside the signed-message fence (where the payload is inert code text), nothing forms an image or link.
    const prose = md.slice(0, md.indexOf('## Signed message'));
    expect(prose).not.toMatch(/(^|[^\\])!\[/m);
    expect(prose).not.toMatch(/(^|[^\\])\]\(/m);
    // Outside the fenced signed message, '<' only ever appears backslash-escaped.
    expect(md.slice(0, md.indexOf('## Signed message'))).not.toMatch(/(^|[^\\])<img/m);
    // The judge prompt keeps the payload's own line breaks, but only inside fences (T-019): outside them no line
    // is a heading or table row from the payload, and every fence closes where the renderer closed it.
    const { outside, blocks, open: unclosed } = splitFences(md);
    expect(unclosed).toBe(false);
    expect(outside).not.toMatch(/^# pwned/m);
    expect(outside).not.toMatch(/^\| injected/m);
    // One signed message, then the judge's system message, the head and tail of its user message, and its verdict.
    expect(blocks.map((b) => b.lang)).toEqual(['json', 'text', 'text', 'text', 'json']);
    for (const b of blocks) expect(b.fence.length).toBeGreaterThan(3);
    const judge = md.slice(md.indexOf('## Judge prompt and verdict'));
    expect(judge.split('\n').filter((l) => l.includes('HOSTILE') && !blocks.some((b) => b.lines.includes(l)))).toEqual([]);
    // Every line that mentions the payload outside the signed-message fence has it escaped.
    const fenceAt = md.indexOf('## Signed message');
    for (const line of md.slice(0, fenceAt).split('\n').filter((l) => l.includes('HOSTILE'))) {
      expect(line).not.toContain('https://');
      // The renderer's own code spans hold identifiers only; any other backtick or '<' must be escaped.
      expect(line.replace(/`[0-9A-Za-z._:-]+`/g, '')).not.toMatch(/(^|[^\\])[`<]/);
    }
    // The signed body sits in a fence its own backticks cannot close.
    const signed = md.slice(fenceAt);
    const open = /^(`{3,})json$/m.exec(signed);
    expect(open?.[1]?.length).toBeGreaterThan(3);
  });

  it('HTML: no markup and no invisible characters from the payload', async () => {
    const html = renderHtml([await hostileTranscript()]);
    expect(html).not.toMatch(BAD_CHARS);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('JSON: invisible characters are escaped in the trace', async () => {
    expect(renderJson(await hostileTranscript())).not.toMatch(BAD_CHARS);
  });
});
