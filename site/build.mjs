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
 * index.html from llms.txt: only the tagline, as a title and a subtitle (Rafa, 2026-11-01: the page says
 * "escrow for agents" and a descriptive subtitle; every doc lives in llms.txt). Agents find the docs through
 * the <link rel="alternate"> in the head.
 */
export function page(md) {
  const tagline = /^> (.+)$/m.exec(strip(md))[1];
  const cut = tagline.indexOf('. ') + 1, title = tagline.slice(0, cut - 1), subtitle = tagline.slice(cut).trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Holdback</title>
<meta name="description" content="${esc(tagline)}">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="/escrow/llms.txt">
<style>
:root { color-scheme: light; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: #1d1d1f; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif; text-align: center; }
main { padding: 0 max(24px, env(safe-area-inset-left, 0px)); max-width: 760px; }
h1 { font-size: clamp(44px, 10vw, 80px); line-height: 1.05; letter-spacing: -0.035em; font-weight: 700; margin: 0 0 20px; }
p { font-size: clamp(19px, 3.6vw, 24px); line-height: 1.4; letter-spacing: -0.01em; color: #6e6e73; margin: 0; text-wrap: balance; }
</style>
</head>
<body>
<main>
<h1>${inline(title)}</h1>
<p>${inline(subtitle)}</p>
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
    console.log(`wrote ${join(out, 'llms.txt')} and ${join(out, 'index.html')}: publish both under ${SITE_URL}`);
  }
}
