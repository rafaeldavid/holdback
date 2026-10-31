import { beforeAll, describe, expect, it } from 'vitest';
import { allMeasured, measured } from '../source/measured.fixture.js';
import { closing } from './closing.js';
import { renderHtml } from './render-html.js';
import { renderClosingMarkdown, renderMarkdown } from './render-md.js';
import { renderJson } from './render-json.js';
import type { BeatTranscript } from './types.js';
import { withAdjudicators } from './adjudicators.fixture.js';

/** Beat 7 plus a signed message, so one transcript exercises every section. */
async function withSigned(): Promise<BeatTranscript> {
  const t = await measured(7);
  return {
    ...t,
    events: [
      ...t.events.slice(0, 2),
      { kind: 'signed', atMs: 0, actor: 'seller', messageType: 'Offer', signer: '0x5969b88346862fcd013a8f1eee8a33e50335a684', body: { price: { token: 'tUSD', amount: '2000000000' } }, signature: `0x${'ab'.repeat(65)}` },
      ...t.events.slice(2),
    ],
  };
}

beforeAll(() => allMeasured(), 60_000);

async function all(): Promise<BeatTranscript[]> {
  return [await withSigned(), ...(await allMeasured()).filter((t) => t.beat !== 7)];
}

describe('renderMarkdown', () => {
  it('has a title, the mode header, a timeline and the balances', async () => {
    const md = renderMarkdown(await withSigned());
    expect(md).toMatch(/^# Beat 7: Nobody in control\n/);
    expect(md).toContain('> Mode: ');
    expect(md).toContain('## Timeline');
    expect(md).toContain('## Balances');
    expect(md).toContain('| Ledger (Atlas Research) |');
    expect(md).toContain('## Signed message');
  });

  it('shows the panel as a table with pinned model IDs', async () => {
    const md = renderMarkdown(await measured(6));
    expect(md).toContain('## Panel');
    expect(md).toMatch(/\| 1 \| `placeholder-[a-z0-9-]+-20260601` \|/);
  });

  it('marks every section built from a stand-in event: timeline, panel, neutrality, balances, signed message', async () => {
    const base = await withSigned();
    // No stand-in source writes judge prompts (none exists since T-018), so that section carries no mark.
    const t: BeatTranscript = { ...base, source: { kind: 'mixed', note: 'part measured' }, events: base.events.filter((e) => e.kind !== 'judge-prompt').map((e) => ({ ...e, standIn: true as const })) };
    const md = renderMarkdown(t);
    // Narrated lines are Markdown-escaped, so the mark reads \[stand-in\] in the source and [stand-in] rendered.
    for (const line of md.split('\n').filter((l) => l.startsWith('- +'))) expect(line).toContain('\\[stand-in\\]');
    expect(md).toMatch(/^## Panel \[stand-in\]$/m);
    expect(md).toMatch(/^## Signed message \[stand-in\]$/m);
    for (const line of md.split('\n').filter((l) => l.startsWith('**'))) expect(line).toContain('[stand-in]');
    const html = renderHtml([t]);
    const badge = '<span class="badge standin">stand-in</span>';
    for (const m of html.matchAll(/<h3>Panel[^\n]*<\/h3>/g)) expect(m[0]).toContain(badge);
    for (const m of html.matchAll(/<summary>Signed message[^\n]*<\/summary>/g)) expect(m[0]).toContain(badge);
    for (const m of html.matchAll(/<th class="num">[^<]*<br><small>[^<]*<\/small>[^\n]*?<\/th>/g)) expect(m[0]).toContain(badge);
    for (const m of html.matchAll(/<li class="event[^\n]*/g)) expect(m[0]).toContain(badge);
  });

  it('marks stand-in events in a mixed transcript', async () => {
    const t = await measured(6);
    const mixed: BeatTranscript = { ...t, source: { kind: 'mixed', note: 'part measured' }, events: t.events.map((e, i) => (i < 3 ? { ...e, standIn: true as const } : e)) };
    expect(renderMarkdown(mixed)).toContain('[stand-in]');
    expect(renderHtml([mixed])).toContain('<span class="badge standin">stand-in</span>');
  });

  it('marks neutrality events', async () => {
    const md = renderMarkdown(await measured(7));
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
    expect(c.residuals.map((r) => r.n)).toEqual([3, 5, 6, 8]);
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

  it('shows a collapsed profile per adjudicator, with judges, effort, harness, terms and history marked role-play (T-017)', async () => {
    const t = withAdjudicators(await measured(7));
    const html = renderHtml([t]);
    const profiles = [...html.matchAll(/<details class="profile">[\s\S]*?<\/details>/g)].map((m) => m[0]);
    expect(profiles).toHaveLength(4);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    for (const p of profiles) {
      expect(p).toContain('<code>placeholder-gpt-a-20260601</code>');
      expect(p).toMatch(/effort/);
      expect(p).toMatch(/harness/);
      expect(p).toMatch(/Fee/);
      expect(p).toMatch(/role-play/i);
    }
    expect(profiles[3]).toMatch(/declined/);
    expect(profiles[3]).toMatch(/panelPolicyMin\.panelSize/);
  });

  it('narrates the proposal and the agreement before the offer (T-017)', async () => {
    const t = withAdjudicators(await measured(7));
    const md = renderMarkdown(t);
    const lines = md.split('\n').filter((l) => l.startsWith('- +'));
    expect(lines[0]).toMatch(/Ledger \(Atlas Research\) reads 4 published adjudicators and proposes Clearfield Adjudication \(primary\), Northgate Review \(fallback\), Atrium Appeals \(appeal\)\./);
    expect(lines[0]).toMatch(/Excluded by the Data Services Club rulebook: Swiftline Verdicts, .*minFamilies.*\(1 more in the viewer\)\./);
    expect(lines[0]).toMatch(/Agent-to-agent; nothing on chain\.$/);
    expect(lines[0]).not.toMatch(/panelPolicyMin\)/); // the rules themselves are in the viewer, not the line
    expect(lines[1]).toMatch(/Tide-7 \(Tidewater Data\) checks all three against its own policy \(valid registration, policy hash matches its policy, free bond 25,000 tUSD covers 2,000 tUSD\) and agrees; the offer names exactly these\./);
    for (const l of lines.slice(0, 2)) expect(l.length).toBeLessThan(400);
    expect(md).toContain('## Adjudicators considered');
    expect(md).toMatch(/Rules applied by the buyer/);
    expect(md).toMatch(/- Harness: /);
    expect(md).toMatch(/- Seller check: offers the primary role/);
    expect(md).toMatch(/role-play/i);
  });

  it('the viewer lists the rules applied and each bench\'s seller checks (T-017)', async () => {
    const html = renderHtml([withAdjudicators(await measured(7))]);
    expect(html).toMatch(/Rules applied by Ledger \(Data Services Club rulebook\)/);
    expect(html).toContain('panels of at least 3 judges from at least 2 model families (panelPolicyMin)');
    expect(html).toMatch(/Seller's checks \(Tide-7\)<\/h4><ul><li>offers the primary role<\/li>/);
  });

  it('escapes text, so a hostile string in a transcript cannot add markup', async () => {
    const t = await measured(7);
    const hostile: BeatTranscript = { ...t, title: '<script>alert(1)</script>', summary: '"><img src=x onerror=alert(1)>' };
    const html = renderHtml([hostile]);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
