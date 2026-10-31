import { describe, expect, it } from 'vitest';
import { standInSource } from '../source/stand-in.js';
import { closing } from './closing.js';
import { renderHtml } from './render-html.js';
import { renderClosingMarkdown, renderMarkdown } from './render-md.js';
import { renderJson } from './render-json.js';
import type { BeatTranscript } from './types.js';

async function all(): Promise<BeatTranscript[]> {
  const s = standInSource();
  return Promise.all(s.beats().map((b) => s.run(b)));
}

describe('renderMarkdown', () => {
  it('has a title, the recorded-mode header, a timeline and the balances', async () => {
    const t = await standInSource().run(1);
    const md = renderMarkdown(t);
    expect(md).toMatch(/^# Beat 1: Choose, agree and hold\n/);
    expect(md).toContain('recorded verdicts');
    expect(md).toContain('## Timeline');
    expect(md).toContain('## Balances');
    expect(md).toContain('| Ledger (Atlas Research) |');
    expect(md).toContain('## Signed message');
  });

  it('shows the panel as a table with pinned model IDs', async () => {
    const md = renderMarkdown(await standInSource().run(3));
    expect(md).toContain('## Panel');
    expect(md).toMatch(/\| 1 \| `[a-z0-9.-]+` \|/);
  });

  it('marks neutrality events', async () => {
    const md = renderMarkdown(await standInSource().run(7));
    expect(md).toContain('## Neutrality events');
    expect(md).toMatch(/op-1.*refused/);
  });
});

describe('renderJson', () => {
  it('round-trips the transcript exactly', async () => {
    for (const t of await all()) expect(JSON.parse(renderJson(t))).toEqual(t);
  });
});

describe('closing', () => {
  it('states finality per mode, residual risks and what an AI lab could add', () => {
    const c = closing();
    expect(c.finality.length).toBeGreaterThan(0);
    expect(c.residuals.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(c.asks.join(' ')).toMatch(/response attestation/i);
    expect(c.asks.join(' ')).toMatch(/hold primitive on API credit/i);
    expect(c.asks.join(' ')).toMatch(/model version disclosure/i);
    const md = renderClosingMarkdown();
    expect(md).toContain('## What remains centralized');
    expect(md).toContain('## What an AI lab could add');
  });
});

describe('renderHtml', () => {
  it('is static: no script, no external stylesheet, no network URL', async () => {
    const html = renderHtml(await all());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<iframe|<img|<object|<embed/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).toMatch(/^<!doctype html>/);
  });

  it('shows the timeline, balances, panel model IDs, neutrality events and the closing', async () => {
    const ts = await all();
    const html = renderHtml(ts);
    for (const t of ts) expect(html).toContain(`id="beat-${t.beat}"`);
    expect(html).toContain('class="timeline"');
    expect(html).toContain('class="balances"');
    const panel = ts.find((t) => t.beat === 3)!.events.find((e) => e.kind === 'panel');
    if (panel?.kind !== 'panel') throw new Error('beat 3 has no panel');
    for (const j of panel.judges) expect(html).toContain(j.model);
    expect(html).toContain('class="event neutrality"');
    expect(html).toContain('id="closing"');
    expect(html).toContain('What an AI lab could add');
  });

  it('collapses the signed message by default', async () => {
    const html = renderHtml(await all());
    expect(html).toMatch(/<details class="signed">/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it('escapes text, so a hostile string in a transcript cannot add markup', async () => {
    const t = await standInSource().run(1);
    const hostile: BeatTranscript = { ...t, title: '<script>alert(1)</script>', summary: '"><img src=x onerror=alert(1)>' };
    const html = renderHtml([hostile]);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
