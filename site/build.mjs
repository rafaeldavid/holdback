// site/llms.txt is the one source. This renders it into site/index.html (placeholders kept), or, for
// publishing, writes both files with the operator URLs filled in.
//
//   node site/build.mjs                                   regenerate site/index.html
//   node site/build.mjs --op1 URL --op2 URL --out DIR
//                                                         filled llms.txt and index.html in DIR, ready to publish
//                                                         under /escrow/; refuses while a "%% CONFIRM" note remains
//
// Lines starting with "%% " in llms.txt are editor notes: they never reach a published file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SITE_URL = 'https://npc.here.now/escrow/';
const here = (p) => new URL(p, import.meta.url);

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = (s) =>
  esc(s)
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[^\s<)]+[^\s<).,;:])/g, '<a href="$1">$1</a>')))
    .join('');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The small Markdown subset llms.txt uses: headings, paragraphs, lists, tables, fenced code. */
export function render(md) {
  const lines = md.split('\n'), out = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^#{2,3} /.test(line)) {
      const level = line.startsWith('### ') ? 3 : 2, text = line.slice(level + 1);
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].slice(1, -1).split(' | ').map((c) => c.trim()));
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line), items = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() !== '' && !/^(```|#|\||- |\d+\. )/.test(lines[i]); i++) para.push(lines[i]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/** Removes editor notes ("%% " lines). */
export const strip = (md) => md.split('\n').filter((l) => !l.startsWith('%% ')).join('\n');

/**
 * One hairline drawing (Rafa, 2026-11-01): two agents, the escrow, one adjudicator GPU and the bond
 * capital behind it, cycling through four outcomes. Complete at rest (sheet 01 drawn); motion is extra.
 */
const GPU = (x, i, name) => `<g class="gpu" id="g${i}" transform="translate(${x} 214)">
<rect x="-22" y="-22" width="44" height="44"/><rect x="-11" y="-11" width="22" height="22"/>
<path d="M-14 -22v-6M-5 -22v-6M5 -22v-6M14 -22v-6M-14 22v6M-5 22v6M5 22v6M14 22v6M-22 -14h-6M-22 -5h-6M-22 5h-6M-22 14h-6M22 -14h6M22 -5h6M22 5h6M22 14h6"/>
<text y="44">${name}</text></g>`;
// an agent: a small line-drawn automaton head
const AGENT = (x) => `<g class="agent" transform="translate(${x} 100)">
<rect x="-22" y="-18" width="44" height="34" rx="7"/><rect x="-15" y="-11" width="30" height="16" rx="3"/>
<circle cx="-7" cy="-3" r="2.6"/><circle cx="7" cy="-3" r="2.6"/><path d="M-5 10h10M0 -18v-8"/><circle cx="0" cy="-29" r="2.6"/>
<path d="M-22 -6h-5v12h5M22 -6h5v12h-5M-12 16v6h24v-6"/></g>`;
// the escrow: a strongbox with a combination dial
const SAFE = `<g class="safe" transform="translate(320 100)">
<rect x="-38" y="-32" width="76" height="62" rx="3"/><rect x="-32" y="-26" width="64" height="50" rx="2" class="inner"/>
<circle cx="4" cy="-1" r="12"/><circle cx="4" cy="-1" r="3"/><path d="M4 -13v4M4 11v-4M-8 -1h4M16 -1h-4M-4.5 -9.5l2.8 2.8M12.5 7.5l-2.8 -2.8"/>
<path d="M24 -10v18"/><path d="M-36 -18h-4v8h4M-36 6h-4v8h4M-30 30v5h10v-5M20 30v5h10v-5"/></g>`;
const FIGURE = `<figure aria-label="Animated drawing: two agents, the escrow, an adjudicator and its bond capital, cycling through release, refund, default and appeal">
<svg viewBox="0 0 640 380" role="img">
<defs><filter id="pencil" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
<g filter="url(#pencil)">
<g class="frame"><rect x="6" y="6" width="628" height="368"/><rect x="11" y="11" width="618" height="358" class="inner"/></g>
<g class="ln"><path d="M116 100H280M360 100H524"/><path d="M320 134V182"/><path d="M320 300V258" stroke-dasharray="2 3"/></g>
${AGENT(86)}${AGENT(554)}${SAFE}
<g class="box"><rect x="250" y="300" width="140" height="34"/></g>
${GPU(320, 0, 'adjudicator')}
</g>
<g class="lbl"><text x="86" y="150">buyer agent</text><text x="554" y="150">seller agent</text><text x="320" y="58">escrow</text><text x="320" y="321">bond capital</text></g>
<text x="320" y="38" class="note" id="note">Checks pass: the price to the seller, the key to the buyer, in one step.</text>
<text x="24" y="358" class="cap k" id="sh">Plate I of IV</text><text x="616" y="358" class="cap" id="cap" style="text-anchor:end">Release</text>
<g id="tokens"></g>
</svg></figure>
<script>
(function () {
  // tokens leave and arrive at the agents' sides, where the lines meet them, not on their faces
  var P = { b: [116, 100], s: [524, 100], e: [320, 100], g0: [320, 214], k: [320, 317] };
  var S = [
    { cap: 'Release', note: 'Checks pass: the price to the seller, the key to the buyer, in one step.', on: 0, off: -1,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['w', 'e', 'g0', 1500], ['$', 'e', 's', 2900], ['k', 'e', 'b', 2900]] },
    { cap: 'Refund', note: 'A required check fails: the price goes back to the buyer.', on: 0, off: -1,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['w', 'e', 'g0', 1500], ['$', 'e', 'b', 2900]] },
    { cap: 'Default', note: 'The adjudicator stays silent past its deadline: the buyer is refunded, the seller paid from the bond.', on: -1, off: 0,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['$', 'e', 'b', 2600], ['$', 'k', 's', 2900]] },
    { cap: 'Appeal', note: 'An appeal overturns the decision: the bond pays the wronged party.', on: 0, off: -1,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['w', 'e', 'g0', 1500], ['$', 'e', 's', 2600], ['w', 'b', 'g0', 3300], ['$', 'k', 'b', 4300]] }
  ];
  var NS = 'http://www.w3.org/2000/svg', T = document.getElementById('tokens');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mk(kind) {
    var el = document.createElementNS(NS, kind === 'w' ? 'rect' : 'circle');
    if (kind === 'w') { el.setAttribute('width', 8); el.setAttribute('height', 8); el.setAttribute('x', -4); el.setAttribute('y', -4); el.setAttribute('class', 'tw'); }
    else { el.setAttribute('r', 4); el.setAttribute('class', kind === 'k' ? 'tk' : 'tm'); }
    T.appendChild(el); return el;
  }
  function show(i) {
    var s = S[i];
    document.getElementById('sh').textContent = 'Plate ' + ['I', 'II', 'III', 'IV'][i] + ' of IV';
    document.getElementById('cap').textContent = s.cap;
    document.getElementById('note').textContent = s.note;
    for (var g = 0; g < 1; g++) {
      var c = document.getElementById('g' + g).classList;
      c.toggle('on', g === s.on); c.toggle('off', g === s.off);
    }
    T.textContent = '';
    var items = s.m.map(function (m) { return { kind: m[0], a: P[m[1]], b: P[m[2]], t0: m[3], el: mk(m[0]) }; });
    if (reduce) { items.forEach(function (it) { it.el.setAttribute('transform', 'translate(' + it.b + ')'); }); return; }
    var start = performance.now();
    (function tick(now) {
      var live = false;
      items.forEach(function (it) {
        var t = (now - start - it.t0) / 900;
        if (t < 0) { it.el.style.opacity = 0; live = true; return; }
        t = Math.min(1, t); var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        it.el.style.opacity = 1;
        it.el.setAttribute('transform', 'translate(' + (it.a[0] + (it.b[0] - it.a[0]) * e) + ' ' + (it.a[1] + (it.b[1] - it.a[1]) * e) + ')');
        if (t < 1) live = true;
      });
      if (live) requestAnimationFrame(tick);
    })(start);
  }
  var i = 0; show(0);
  if (!reduce) setInterval(function () { i = (i + 1) % S.length; show(i); }, 6000);
})();
</script>`;

/**
 * index.html from llms.txt: the tagline as a title and a subtitle, and the drawing (Rafa, 2026-11-01: the
 * page says "escrow for agents" and a descriptive subtitle; every doc lives in llms.txt). Agents find the
 * docs through the <link rel="alternate"> in the head.
 */
export function page(md) {
  const tagline = /^> (.+)$/m.exec(strip(md))[1];
  const cut = tagline.indexOf('. ') + 1, title = tagline.slice(0, cut - 1), subtitle = tagline.slice(cut).trim();
  // the first paragraph after the tagline is the page's one paragraph
  const src = strip(md), after = src.slice(src.indexOf(tagline) + tagline.length).trim();
  const intro = after.slice(0, after.indexOf('\n\n')).trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/escrow/favicon.png">
<link rel="apple-touch-icon" href="/escrow/favicon.png">
<meta name="description" content="${esc(tagline)}">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="/escrow/llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
<style>
/* A naturalist's notebook, to sit with Thorburn's 1919 study: laid paper, graphite, a book face of the period, sepia for the one accent. */
:root { color-scheme: light; --paper: #faf7f0; --graphite: #2f2d2a; --pencil: #57534c; --faint: #8f897e; --sepia: #8a6237; --serif: "EB Garamond", Garamond, "Times New Roman", serif; }
body { margin: 0; background: var(--paper); color: var(--graphite); font-family: var(--serif); text-align: center; }
main { margin: 0 auto; padding: 9vh max(24px, env(safe-area-inset-left, 0px)) 72px; max-width: 720px; }
.mark { display: block; margin: 0 auto 12px; width: min(320px, 72vw); height: auto; }
h1 { font-family: var(--serif); font-size: clamp(56px, 12vw, 96px); line-height: 1; letter-spacing: -0.01em; font-weight: 500; margin: 0 0 10px; }
.sub { font-style: italic; font-size: clamp(20px, 4vw, 26px); color: var(--pencil); margin: 0 0 28px; }
.intro { font-size: clamp(18px, 2.6vw, 20px); line-height: 1.55; color: var(--graphite); max-width: 34em; margin: 0 auto; text-wrap: pretty; }
figure { margin: 56px auto 0; max-width: 640px; }
svg { width: 100%; height: auto; display: block; }
svg path, svg rect, .agent circle, .safe circle { fill: none; stroke: var(--pencil); stroke-width: 0.9; stroke-linecap: round; stroke-linejoin: round; }
.safe .inner { stroke: var(--faint); stroke-width: 0.6; }
.frame rect { stroke: var(--pencil); stroke-width: 0.8; } .frame .inner { stroke: var(--faint); stroke-width: 0.5; }
.ln path { stroke: var(--faint); stroke-width: 0.7; }
.box .inner { stroke: var(--faint); stroke-width: 0.5; }
svg text { font-family: var(--serif); font-size: 11px; font-variant: small-caps; letter-spacing: 0.06em; fill: var(--graphite); text-anchor: middle; }
.cap { font-style: italic; font-variant: normal; letter-spacing: 0; text-anchor: start; }
.cap.k { fill: var(--faint); font-size: 10.5px; }
text.note { text-anchor: middle; font-style: italic; font-variant: normal; letter-spacing: 0; fill: var(--pencil); font-size: 11.5px; }
.gpu { transition: opacity .4s; } .gpu text { fill: var(--pencil); font-size: 10.5px; }
.gpu.on rect, .gpu.on path { stroke: var(--sepia); stroke-width: 1.3; } .gpu.on text { fill: var(--sepia); }
.gpu.off { opacity: .3; } .gpu.off rect { stroke-dasharray: 2 3; }
.tm { fill: var(--graphite); stroke: none; } .tk { fill: var(--paper); stroke: var(--sepia); stroke-width: 1.4; } .tw { fill: var(--paper); stroke: var(--graphite); stroke-width: 1; }
</style>
</head>
<body>
<main>
<!-- Hooded crow: Archibald Thorburn, "A naturalist's sketch book" (1919), plate 18, public domain. -->
<img class="mark" src="/escrow/crow.png" alt="A pencil study of a hooded crow by Archibald Thorburn, 1919" width="640" height="406">
<h1>${inline(title)}</h1>
<p class="sub">${inline(subtitle)}</p>
<p class="intro">${inline(intro)}</p>
${FIGURE}
</main>
</body>
</html>
`;
}

/** The published files: placeholders filled, editor notes gone. */
export function filled(md, { op1, op2 }) {
  if (/^%% CONFIRM/m.test(md)) throw new Error('llms.txt still has "%% CONFIRM" notes: check each against the deployed API, fix the text, delete the note, then build again');
  const ok = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+$/.test(u);
  if (!ok(op1) || !ok(op2)) throw new Error('--op1 and --op2 are https origins with no path and no trailing slash, e.g. https://holdback-op1.example.workers.dev');
  const out = strip(md).replace('{{OP1}}', op1).replace('{{OP2}}', op2);
  if (/\{\{[A-Z0-9]+\}\}/.test(out)) throw new Error('a placeholder is left unfilled');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const md = readFileSync(here('llms.txt'), 'utf8');
  const out = arg('out');
  if (!out) {
    writeFileSync(here('index.html'), page(md));
    console.log('wrote site/index.html');
  } else {
    const txt = filled(md, { op1: arg('op1'), op2: arg('op2') });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'llms.txt'), txt);
    writeFileSync(join(out, 'index.html'), page(txt));
    for (const f of ['crow.png', 'favicon.png']) writeFileSync(join(out, f), readFileSync(here(f)));
    console.log(`wrote ${join(out, 'llms.txt')} and ${join(out, 'index.html')}: publish both under ${SITE_URL}`);
  }
}
