// index.html: a static timeline viewer. One file, inline CSS, no scripts, no network, no build step.
// Every piece of text is escaped; backticked spans from narration become <code>.
import { CAST, labelOf } from './cast.js';
import { closing } from './closing.js';
import { formatAmount } from './money.js';
import { beatHeader, describeEvent, formatMs, formatScore, sharedHeader, type SharedHeader } from './narrate.js';
import { eventsOf, leanBalances, verdictJson } from './render-md.js';
import type { AdjudicatorProfile, BeatTranscript, CastKey, DemoEvent } from './types.js';
import { plain, safeJson } from '@holdback/testkit';

const escRaw = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
/** Every text node: one plain line (no controls, bidi or tag characters), then HTML-escaped. */
const esc = (s: string) => escRaw(plain(s));
const BADGE = ' <span class="badge standin">stand-in</span>';
const mark = (e: { standIn?: true }) => (e.standIn ? BADGE : '');

const CSS = `
:root{--bg:#f7f6f2;--panel:#ffffff;--ink:#1d1f23;--muted:#5d636d;--line:#e2e0d8;--accent:#1f5f8b;--warn-bg:#fff3d6;--warn-ink:#7a4b00;--ok:#1e6b3a;--bad:#a12d2d;--code-bg:#f0eee7}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15171a;--panel:#1d2024;--ink:#e7e5df;--muted:#a1a6ae;--line:#2e3238;--accent:#7cb7e0;--warn-bg:#3a2e12;--warn-ink:#f4cf7a;--ok:#7fd39a;--bad:#f08f8f;--code-bg:#262a30}}
:root[data-theme="dark"]{--bg:#15171a;--panel:#1d2024;--ink:#e7e5df;--muted:#a1a6ae;--line:#2e3238;--accent:#7cb7e0;--warn-bg:#3a2e12;--warn-ink:#f4cf7a;--ok:#7fd39a;--bad:#f08f8f;--code-bg:#262a30}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:20px;margin:0 0 4px}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 8px}
p{margin:6px 0}
.lede{color:var(--muted);max-width:70ch}
nav ol{list-style:none;padding:0;margin:16px 0 24px;display:flex;flex-wrap:wrap;gap:6px}
nav a{display:inline-block;padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;background:var(--panel);font-size:13px}
nav a:hover{border-color:var(--accent)}
.beat,.closing{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px;margin:0 0 20px}
.meta{font-size:13px;color:var(--muted);margin:8px 0 0;padding:0;list-style:none}
.badge{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin-right:6px}
.badge.standin{background:var(--warn-bg);color:var(--warn-ink);border-color:transparent}
.grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:20px;margin-top:8px}
@media (max-width:760px){.grid{grid-template-columns:minmax(0,1fr)}}
ol.timeline{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}
.event{position:relative;padding:4px 0 10px 16px}
.event::before{content:"";position:absolute;left:-6px;top:11px;width:10px;height:10px;border-radius:50%;background:var(--panel);border:2px solid var(--accent)}
.event .t{display:block;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.event .who{font-weight:600}
.event.neutrality{background:var(--warn-bg);color:var(--warn-ink);border-radius:6px;padding:6px 10px 8px 16px;margin:2px 0 8px}
.event.neutrality::before{border-color:var(--warn-ink)}
.event.record{border-top:1px dashed var(--line);margin-top:4px;padding-top:8px}
.event.record::before{border-color:var(--ok)}
details.judge h4{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:12px 0 4px}
details.judge pre{max-height:24em;overflow:auto}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code-bg);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.pass{color:var(--ok);font-weight:600}.fail{color:var(--bad);font-weight:600}.abstain{color:var(--muted)}
details.signed{margin-top:14px;border:1px solid var(--line);border-radius:8px;padding:8px 12px}
details.signed summary{cursor:pointer;font-weight:600}
details.signed pre{overflow-x:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:10px 0 0}
details.profile{margin-top:10px;border:1px solid var(--line);border-radius:8px;padding:8px 12px}
details.profile summary{cursor:pointer;font-weight:600}
details.profile h4{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:12px 0 4px}
details.profile ul{padding-left:18px;margin:4px 0}
.badge.declined{color:var(--bad);border-color:var(--bad)}
.closing ol,.closing ul{padding-left:20px}
.closing li{margin:4px 0}
`;

function balancesTable(t: BeatTranscript): string {
  const snaps = leanBalances(t);
  if (!snaps.length) return '';
  const who: CastKey[] = [];
  for (const s of snaps) for (const r of s.rows) if (!who.includes(r.who)) who.push(r.who);
  const cellFor = (s: (typeof snaps)[number], k: CastKey) => {
    const r = s.rows.find((x) => x.who === k);
    if (!r) return '<td class="num">-</td>';
    return `<td class="num">${esc(formatAmount(r.amount))}${r.reserved ? `<br><small>${esc(formatAmount(r.reserved))} reserved</small>` : ''}</td>`;
  };
  return [
    '<h3>Balances</h3>',
    '<div class="scroll"><table class="balances">',
    `<thead><tr><th>Party</th>${snaps.map((s) => `<th class="num">${esc(s.label)}<br><small>${esc(formatMs(s.atMs))}</small>${mark(s)}</th>`).join('')}</tr></thead>`,
    '<tbody>',
    ...who.map((k) => `<tr><td>${esc(labelOf(k))}</td>${snaps.map((s) => cellFor(s, k)).join('')}</tr>`),
    '</tbody></table></div>',
  ].join('\n');
}

function panelTables(t: BeatTranscript): string {
  return eventsOf(t, 'panel')
    .map((p) =>
      [
        `<h3>Panel, ${esc(CAST[p.actor].name)}${mark(p)}</h3>`,
        `<p class="meta">Seed <code>${esc(p.seed)}</code> (${esc(p.seedSource)}); ${esc(p.rule)}; outcome <strong>${esc(p.outcome)}</strong>.</p>`,
        '<div class="scroll"><table class="panel"><thead><tr><th>Seat</th><th>Pinned model ID</th><th>Family</th><th>Verdict</th><th class="num">Score</th></tr></thead><tbody>',
        ...p.judges.map(
          (j) =>
            `<tr><td>${j.seat}</td><td><code>${esc(j.model)}</code></td><td>${esc(j.family)}</td><td class="${j.verdict}">${j.verdict}</td><td class="num">${j.score === undefined ? '-' : esc(formatScore(j.score))}</td></tr>`,
        ),
        '</tbody></table></div>',
      ].join('\n'),
    )
    .join('\n');
}

function signed(t: BeatTranscript): string {
  return eventsOf(t, 'signed')
    .map(
      (s) =>
        `<details class="signed"><summary>Signed message: ${esc(s.messageType)} from ${esc(labelOf(s.actor))}${mark(s)}</summary><pre>${escRaw(safeJson({ ...s.body, signature: s.signature }))}</pre></details>`,
    )
    .join('\n');
}

const SELECTED: Readonly<Record<AdjudicatorProfile['selected'], string>> = { primary: 'chosen as primary', fallback: 'chosen as fallback', appeal: 'chosen as appeal', declined: 'considered and declined' };

/** One collapsed profile per adjudicator the agents considered. Registration and profile text is escaped. */
function profiles(t: BeatTranscript): string {
  if (!t.adjudicators?.length) return '';
  const one = (a: AdjudicatorProfile) =>
    [
      `<details class="profile"><summary>${esc(a.name)}${a.who ? ` <small>(${esc(CAST[a.who].org ?? '')})</small>` : ''} <span class="badge${a.selected === 'declined' ? ' declined' : ''}">${esc(SELECTED[a.selected])}</span></summary>`,
      `<p><em>${esc(a.tagline)}</em> Roles offered: ${esc(a.roles.join(', '))}.</p>`,
      a.declinedBecause?.length ? `<p class="fail">Declined because:</p><ul>${a.declinedBecause.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '',
      a.sellerChecks?.length ? `<h4>Seller's checks (${esc(CAST.seller.name)})</h4><ul>${a.sellerChecks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '',
      '<h4>Judges</h4>',
      '<div class="scroll"><table><thead><tr><th>Registry ID</th><th>Pinned model ID</th><th>Family</th><th>Declared effort</th></tr></thead><tbody>',
      ...a.judges.map((j) => `<tr><td>${esc(j.id)}</td><td><code>${esc(j.model)}</code></td><td>${esc(j.family)}</td><td>${esc(j.effort)}</td></tr>`),
      '</tbody></table></div>',
      '<p class="meta">Effort is the reasoning setting the bench declares per judge; the v0.6 registration cannot carry it, and scripted judges apply none.</p>',
      '<h4>Harness</h4>',
      `<ul>${a.harness.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`,
      '<h4>Terms</h4>',
      `<table><tbody>${a.terms.map((x) => `<tr><th>${esc(x.label)}</th><td>${esc(x.value)}</td></tr>`).join('')}</tbody></table>`,
      '<h4>History <span class="badge standin">role-play</span></h4>',
      `<ul>${a.history.lines.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`,
      '<p class="meta">Role-play: invented for this demo, not a real firm or record.</p>',
      '</details>',
    ].join('\n');
  const rules = eventsOf(t, 'adjudicator-proposal')[0]?.rules ?? [];
  const applied = rules.length ? `<p class="meta">Rules applied by ${esc(CAST.buyer.name)} (${esc(CAST.club.name)} rulebook):</p><ul class="meta">${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '';
  return ['<h3>Adjudicators considered</h3>', applied, ...t.adjudicators.map(one)].join('\n');
}

/** Prompt or verdict lines inside <pre>: each made plain, then escaped. */
const preLines = (lines: readonly string[]) => lines.map(esc).join('\n');

/** One judge's prompt and verdict, collapsed like the signed message. Every line is untrusted. */
function judgePrompts(t: BeatTranscript): string {
  return eventsOf(t, 'judge-prompt')
    .map((j) => {
      const u = j.prompt.user;
      return [
        `<details class="signed judge"><summary>Judge prompt and verdict: seat ${j.seat}, <code>${esc(j.model)}</code> (${esc(j.family)})${mark(j)}</summary>`,
        `<p class="meta">On ${esc(labelOf(j.actor))}'s panel. Input hash <code>${esc(j.inputHash)}</code>. ${j.scripted ? 'The verdict is scripted: a fake provider wrote it, and no model read this prompt.' : "The verdict is the model's reply."} The deliverable and the terms are quoted as the judge received them.</p>`,
        `<h4>System message (${j.prompt.system.length} lines)</h4><pre>${preLines(j.prompt.system)}</pre>`,
        `<h4>User message (${esc(u.lines.toLocaleString('en-US'))} lines)</h4><pre>${preLines(u.head)}</pre>`,
        u.omitted ? `<p class="meta">${esc(u.omitted.toLocaleString('en-US'))} line${u.omitted === 1 ? '' : 's'} of the data section omitted here; the input hash covers them.</p><pre>${preLines(u.tail)}</pre>` : '',
        `<h4>Verdict</h4>${j.verdict ? `<pre>${escRaw(safeJson(verdictJson(j)))}</pre>` : '<p>No valid verdict.</p>'}`,
        '</details>',
      ].join('\n');
    })
    .join('\n');
}

const EVENT_CLASS: Partial<Record<DemoEvent['kind'], string>> = { neutrality: ' neutrality', 'shared-record': ' record' };

function beatSection(t: BeatTranscript, shared: SharedHeader): string {
  const items = t.events
    .filter((e) => e.kind !== 'balances')
    .map(
      (e) =>
        `<li class="event${EVENT_CLASS[e.kind] ?? ''}" data-kind="${e.kind}"><span class="t">${esc(formatMs(e.atMs))}${mark(e)}</span>${esc(describeEvent(e))}</li>`,
    );
  const standIn = t.source.kind !== 'simchain';
  return [
    `<section class="beat" id="beat-${t.beat}">`,
    `<h2>Beat ${t.beat}: ${esc(t.title)}</h2>`,
    `<p>${esc(t.summary)}</p>`,
    `<p><span class="badge${standIn ? ' standin' : ''}">${t.source.kind === 'stand-in' ? 'stand-in source' : t.source.kind === 'mixed' ? 'SimChain + stand-in' : 'SimChain'}</span><span class="badge">${esc(t.mode)}</span>${t.commitmentId ? `<span class="badge">commitment <code>${esc(t.commitmentId.slice(0, 10))}…</code></span>` : ''}</p>`,
    `<ul class="meta">${beatHeader(t, shared).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
    '<div class="grid">',
    `<div><h3>Timeline</h3><ol class="timeline">\n${items.join('\n')}\n</ol>${signed(t)}${judgePrompts(t)}${profiles(t)}</div>`,
    `<div>${balancesTable(t)}${panelTables(t)}</div>`,
    '</div>',
    '</section>',
  ].join('\n');
}

function closingSection(): string {
  const c = closing();
  return [
    '<section class="closing" id="closing">',
    '<h2>Closing</h2>',
    '<h3>Finality</h3>',
    `<ul>${c.finality.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
    '<h3>What remains centralized</h3>',
    `<p class="meta">${esc(c.residualsIntro)}</p>`,
    `<ul>${c.residuals.map((r) => `<li><strong>${esc(r.title)}</strong> (residual ${r.n}). ${esc(r.line)}</li>`).join('')}</ul>`,
    '<h3>What an AI lab could add</h3>',
    `<ul>${c.asks.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`,
    '</section>',
  ].join('\n');
}

export function renderHtml(transcripts: readonly BeatTranscript[]): string {
  const ts = [...transcripts].sort((a, b) => a.beat - b.beat);
  const anyStandIn = ts.some((t) => t.source.kind !== 'simchain');
  const shared = sharedHeader(ts);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Holdback demo timeline</title>',
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<h1>Two agents, one 2,000 tUSD job, nobody in control</h1>',
    `<p class="lede">${esc(CAST.buyer.name)}, ${esc(CAST.buyer.org ?? '')}'s buyer agent (principal ${esc(CAST.buyer.principal ?? '')}), hires ${esc(CAST.seller.name)}, ${esc(CAST.seller.org ?? '')}'s seller agent (principal ${esc(CAST.seller.principal ?? '')}), to clean a customer dataset. The two agents name ${esc(CAST.benchA.name)}, ${esc(CAST.benchB.name)} and ${esc(CAST.benchC.name)} as primary, fallback and appeal adjudicators. ${esc(CAST.backer.name)} backs bonds; ${esc(CAST.observer.name)} observes. Settlement runs on SimChain with a test token. SimChain keeps party appeals and bonds; the phase-one contracts on Sepolia have neither (ADR-0031).</p>`,
    anyStandIn ? '<p class="lede"><span class="badge standin">stand-in source</span>Beats and events marked stand-in are scripted with illustrative numbers, because no SimChain runner drives them yet. Everything else is measured on SimChain in this run.</p>' : '',
    `<ul class="meta header">${shared.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
    `<nav><ol>${ts.map((t) => `<li><a href="#beat-${t.beat}">${t.beat}. ${esc(t.title)}</a></li>`).join('')}<li><a href="#closing">Closing</a></li></ol></nav>`,
    ...ts.map((t) => beatSection(t, shared)),
    closingSection(),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
