import { describe, expect, it } from 'vitest';
import { standInSource } from '../source/stand-in.js';
import { closing } from './closing.js';
import { renderHtml } from './render-html.js';
import { renderClosingMarkdown, renderMarkdown } from './render-md.js';
import { renderJson } from './render-json.js';
import type { BeatTranscript } from './types.js';

/** Beat 7 plus a signed message, so one fast fixture exercises every section. */
async function withSigned(): Promise<BeatTranscript> {
  const t = await standInSource().run(7);
  return {
    ...t,
    events: [
      ...t.events.slice(0, 2),
      { kind: 'signed', atMs: 0, actor: 'seller', messageType: 'Offer', signer: '0x5969b88346862fcd013a8f1eee8a33e50335a684', body: { price: { token: 'tUSD', amount: '2000000000' } }, signature: `0x${'ab'.repeat(65)}` },
      ...t.events.slice(2),
    ],
  };
}

async function all(): Promise<BeatTranscript[]> {
  const s = standInSource();
  return [await withSigned(), ...(await Promise.all(s.beats().filter((b) => b !== 7).map((b) => s.run(b))))];
}

describe('renderMarkdown', () => {
  it('has a title, the recorded-mode header, a timeline and the balances', async () => {
    const md = renderMarkdown(await withSigned());
    expect(md).toMatch(/^# Beat 7: Nobody in control\n/);
    expect(md).toContain('recorded verdicts');
    expect(md).toContain('## Timeline');
    expect(md).toContain('## Balances');
    expect(md).toContain('| Ledger (Atlas Research) |');
    expect(md).toContain('## Signed message');
  });

  it('shows the panel as a table with pinned model IDs', async () => {
    const md = renderMarkdown(await standInSource().run(6));
    expect(md).toContain('## Panel');
    expect(md).toMatch(/\| 1 \| `placeholder-claude-a-20260601` \|/);
  });

  it('marks stand-in events in a mixed transcript', async () => {
    const t = await standInSource().run(6);
    const mixed: BeatTranscript = { ...t, source: { kind: 'mixed', note: 'part measured' }, events: t.events.map((e, i) => (i < 3 ? { ...e, standIn: true as const } : e)) };
    expect(renderMarkdown(mixed)).toContain('[stand-in]');
    expect(renderHtml([mixed])).toContain('<span class="badge standin">stand-in</span>');
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
    const panel = ts.find((t) => t.beat === 6)!.events.find((e) => e.kind === 'panel');
    if (panel?.kind !== 'panel') throw new Error('beat 6 has no panel');
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
    const t = await standInSource().run(7);
    const hostile: BeatTranscript = { ...t, title: '<script>alert(1)</script>', summary: '"><img src=x onerror=alert(1)>' };
    const html = renderHtml([hostile]);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
