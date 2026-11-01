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

/** index.html from llms.txt: the head of the file becomes the page's top, the rest the agent docs. */
export function page(md) {
  const src = strip(md);
  const tagline = /^> (.+)$/m.exec(src)[1];
  const cut = tagline.indexOf('. ') + 1, title = tagline.slice(0, cut), lede = tagline.slice(cut).trim();
  const docsAt = src.indexOf('\n## ');
  const intro = src.slice(0, docsAt).split('\n\n').map((p) => p.trim()).filter((p) => p && !p.startsWith('#') && !p.startsWith('>'));
  const [what, notice, ...rest] = intro;
  const llms = `${SITE_URL}llms.txt`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Holdback</title>
<meta name="description" content="${esc(tagline)}">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="/escrow/llms.txt">
<style>
:root { color-scheme: light; --ink: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --soft: #f5f5f7; --link: #0066cc; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: #fff; color: var(--ink); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 0 16px 96px; }
header { padding: 18vh 0 72px; }
h1 { font-size: clamp(44px, 10vw, 72px); line-height: 1.05; letter-spacing: -0.035em; font-weight: 700; margin: 0 0 16px; }
.lede { font-size: clamp(22px, 4.6vw, 28px); line-height: 1.3; letter-spacing: -0.015em; font-weight: 600; margin: 0 0 24px; }
.what { font-size: 19px; color: var(--muted); margin: 0 0 48px; max-width: 34em; }
.point { margin: 0 0 12px; font-size: 15px; color: var(--muted); }
.point a { display: block; margin-top: 6px; font-size: 19px; color: var(--ink); text-decoration: none; word-break: break-all; }
.point a:hover { color: var(--link); }
.notice { font-size: 15px; color: var(--muted); margin: 32px 0 0; }
.notice strong { color: var(--ink); }
.docs { border-top: 1px solid var(--line); padding-top: 48px; }
h2 { font-size: 28px; letter-spacing: -0.02em; line-height: 1.2; margin: 64px 0 16px; }
h3 { font-size: 20px; margin: 40px 0 12px; }
p, ul, ol { margin: 0 0 16px; }
ul, ol { padding-left: 1.3em; }
li { margin: 6px 0; }
a { color: var(--link); }
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.86em; background: var(--soft); border-radius: 5px; padding: 0.1em 0.35em; overflow-wrap: anywhere; }
pre { background: var(--soft); border-radius: 12px; padding: 16px 18px; overflow-x: auto; margin: 0 0 20px; }
pre code { background: none; padding: 0; font-size: 13.5px; line-height: 1.55; overflow-wrap: normal; white-space: pre; }
.table { overflow-x: auto; margin: 0 0 20px; }
table { border-collapse: collapse; font-size: 15px; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--line); }
th { font-weight: 600; }
td code { overflow-wrap: anywhere; }
footer { margin-top: 72px; font-size: 14px; color: var(--muted); }
</style>
</head>
<body>
<main>
<header>
<h1>${inline(title)}</h1>
<p class="lede">${inline(lede)}</p>
<p class="what">${inline(what)}</p>
<p class="point">Point your agent here<a href="/escrow/llms.txt">${esc(llms)}</a></p>
<p class="notice">${inline(notice)}</p>
</header>
<section class="docs">
${rest.map((p) => `<p>${inline(p)}</p>`).join('\n')}
${render(src.slice(docsAt + 1))}
</section>
<footer>The same docs as plain text: <a href="/escrow/llms.txt">llms.txt</a>.</footer>
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
