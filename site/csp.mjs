// The inline scripts and styles of the built pages, hashed for the site's content security policy (T-451).
// site/build.mjs calls writeInlineHashes(out) after a publish build has written every page; the site Worker reads the
// file it writes (apps/site/headers.js) and names each hash in script-src or style-src, so the pages' own inline code
// runs and nothing injected later does. site/check.mjs checks every built page against the policy the Worker sends.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The CSP source for one inline block: `sha256-` and the base64 SHA-256 of its text, as a browser hashes it: the HTML
 * parser turns CR LF and a lone CR into LF before the script or style text exists, so a CRLF checkout hashes the same.
 */
export const cspHash = (text) => `sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}`;

// A tokenizer for the part of HTML that decides where a script or a style ends (the WHATWG HTML standard, section
// 13.2.5: the data, tag, attribute, comment, RAWTEXT, RCDATA and script data states). A regular expression cannot do
// this: a browser ends a script at `</script` in any case followed by whitespace, `/` or `>`, skips comments and
// attribute values, and enters escaped states after `<!--` inside a script. So this reads the page the way the
// standard does, and refuses (throws) what it does not model, rather than hash text the browser would not run:
// a script or style that holds `<!--`, `<script` or `</script` (`</style`), one with no end tag, one inside <svg> or
// <math> (foreign content, parsed differently), an HTML integration point or CDATA inside them, a srcdoc attribute,
// a NUL character, and <plaintext>. Comments end at `-->` or `--!>`, as in a browser.
const SPACE = /[\t\n\f\r ]/;
const LETTER = /[A-Za-z]/;
const RAWTEXT = new Set(['style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'script']);
const RCDATA = new Set(['title', 'textarea']);
const FOREIGN = new Set(['svg', 'math']);
/** Elements inside <svg> or <math> where a browser parses HTML again (the standard's integration points). */
const INTEGRATION = new Set(['foreignobject', 'desc', 'title', 'annotation-xml', 'mi', 'mo', 'mn', 'ms', 'mtext']);

/** Reads one tag from `i` (just after `<` or `</`): its lowercase name, its attributes, and the index after its `>`. */
function readTag(html, i) {
  let j = i;
  while (j < html.length && !SPACE.test(html[j]) && html[j] !== '/' && html[j] !== '>') j++;
  const name = html.slice(i, j).toLowerCase();
  const attrs = new Map();
  let selfClosing = false;
  for (;;) {
    while (j < html.length && (SPACE.test(html[j]) || html[j] === '/')) selfClosing = html[j++] === '/';
    if (j >= html.length) throw new Error(`the <${name}> tag never ends`);
    if (html[j] === '>') return { name, attrs, selfClosing, end: j + 1 };
    selfClosing = false;
    const a = j;
    j++; // an attribute name may start with '='
    while (j < html.length && !SPACE.test(html[j]) && !'/>='.includes(html[j])) j++;
    const attr = html.slice(a, j).toLowerCase();
    while (j < html.length && SPACE.test(html[j])) j++;
    let value = '';
    if (html[j] === '=') {
      j++;
      while (j < html.length && SPACE.test(html[j])) j++;
      if (html[j] === '"' || html[j] === "'") {
        const close = html.indexOf(html[j], j + 1);
        if (close < 0) throw new Error(`an attribute of <${name}> is never closed`);
        value = html.slice(j + 1, close);
        j = close + 1;
      } else {
        const v = j;
        while (j < html.length && !SPACE.test(html[j]) && html[j] !== '>') j++;
        value = html.slice(v, j);
      }
    }
    if (!attrs.has(attr)) attrs.set(attr, value); // the first of two same-named attributes wins
  }
}

/** The index of the end tag `</name` (any case, then whitespace, `/` or `>`) at or after `from`, or -1. */
function endTagAt(html, name, from) {
  const lower = html.toLowerCase();
  for (let k = lower.indexOf(`</${name}`, from); k >= 0; k = lower.indexOf(`</${name}`, k + 1)) {
    const after = html[k + 2 + name.length];
    if (after === undefined || SPACE.test(after) || after === '/' || after === '>') return k;
  }
  return -1;
}

/**
 * Every <script> and <style> element of a page, as a browser's tokenizer finds them.
 * @param {string} html
 * @returns {{ scripts: { attrs: Map<string, string>, text: string }[], styles: string[] }} in page order
 */
export function elements(html) {
  // A browser turns NUL into U+FFFD inside a script or style, so a hash of the raw text would not match.
  if (html.includes('\u0000')) throw new Error('a page holds a NUL character, which a browser replaces before hashing');
  const scripts = [], styles = [];
  let foreign = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const next = html[lt + 1] ?? '';
    if (html.startsWith('<!--', lt)) {
      // A comment ends at the first '-->', or at once on '<!-->' or '<!--->'.
      if (html[lt + 4] === '>') i = lt + 5;
      else if (html.startsWith('->', lt + 4)) i = lt + 6;
      else {
        // It also ends at '--!>', whichever comes first.
        const ends = [html.indexOf('-->', lt + 4), html.indexOf('--!>', lt + 4)].filter((k) => k >= 0);
        if (ends.length === 0) throw new Error('a comment never ends');
        const close = Math.min(...ends);
        i = close + (html.startsWith('-->', close) ? 3 : 4);
      }
    } else if (html.startsWith('<![CDATA[', lt) && foreign > 0) {
      throw new Error('a page holds <![CDATA[ inside <svg> or <math>, which this reader does not model');
    } else if (next === '!' || next === '?') {
      const close = html.indexOf('>', lt);
      i = close < 0 ? html.length : close + 1; // a doctype or bogus comment
    } else if (next === '/' && LETTER.test(html[lt + 2] ?? '')) {
      const tag = readTag(html, lt + 2);
      if (FOREIGN.has(tag.name) && foreign > 0) foreign--;
      i = tag.end;
    } else if (next === '/') {
      // '</>' is dropped; '</' then anything but a letter opens a bogus comment that ends at the next '>'.
      const close = html.indexOf('>', lt);
      i = close < 0 ? html.length : close + 1;
    } else if (LETTER.test(next)) {
      const tag = readTag(html, lt + 1);
      i = tag.end;
      if (tag.name === 'plaintext') throw new Error('a page holds <plaintext>, which this reader does not model');
      if (tag.attrs.has('srcdoc')) throw new Error(`a <${tag.name}> carries srcdoc, a page inside an attribute that this reader does not read`);
      if (foreign > 0 && INTEGRATION.has(tag.name)) throw new Error(`a <${tag.name}> inside <svg> or <math> returns to HTML parsing, which this reader does not model`);
      if (FOREIGN.has(tag.name) && !tag.selfClosing) foreign++;
      if (!RAWTEXT.has(tag.name) && !RCDATA.has(tag.name)) continue;
      if (foreign > 0) {
        if (tag.name === 'script' || tag.name === 'style') throw new Error(`a <${tag.name}> sits inside <svg> or <math>, which this reader does not model`);
        continue;
      }
      const close = endTagAt(html, tag.name, i);
      if (close < 0) throw new Error(`a <${tag.name}> never ends`);
      const text = html.slice(i, close);
      if (tag.name === 'script' || tag.name === 'style') {
        if (/<!--|<\/?script|<\/?style/i.test(text)) throw new Error(`an inline <${tag.name}> holds "<!--", "<script" or "</script" ("<style", "</style"), which puts a browser in states this reader does not model: build the string from parts`);
        if (tag.name === 'script') scripts.push({ attrs: tag.attrs, text });
        else styles.push(text);
      }
      i = readTag(html, close + 2).end;
    } else i = lt + 1;
  }
  return { scripts, styles };
}

/**
 * The inline code one page carries: every <script> without a src (a script with a src runs that file and ignores its
 * text), whatever its type, and every <style>. Hashing a data block (JSON) as well costs nothing and leaves no type
 * to guess.
 * @param {string} html
 * @returns {{ scripts: string[], styles: string[] }} the blocks' texts, in page order
 */
export function inlineBlocks(html) {
  const { scripts, styles } = elements(html);
  return { scripts: scripts.filter((s) => !s.attrs.has('src')).map((s) => s.text), styles };
}

/**
 * What is wrong with a page's scripts as the build reads them, or null: the number of script elements the tokenizer
 * found must equal the number of `<script` openers in the page's bytes, in any case. A mismatch means a `<script`
 * sits somewhere the reader skipped (a comment, an attribute, a title), and the build refuses the page rather than
 * guess what a browser runs. The same holds for the `</script` end tags.
 */
export function scriptCountProblem(html) {
  const found = elements(html).scripts.length;
  const openers = (html.match(/<script(?=[\t\n\f\r />])/gi) ?? []).length;
  const closers = (html.match(/<\/script(?=[\t\n\f\r />])/gi) ?? []).length;
  if (found !== openers) return `the page has ${openers} "<script" openers but ${found} script elements as a browser reads it`;
  // A "</script>" inside a script's string ends the script there, and leaves a second end tag behind.
  if (found !== closers) return `the page has ${closers} "</script" end tags but ${found} script elements as a browser reads it`;
  return null;
}

/** Every .html file under `dir`, as site paths with forward slashes. */
export function htmlFiles(dir) {
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  return walk(dir).filter((p) => p.endsWith('.html')).map((p) => relative(dir, p).split(sep).join('/')).sort();
}

/** The sorted, distinct hashes of every inline script and style in the built pages under `dir`. */
export function inlineHashesOf(dir) {
  const scripts = new Set(), styles = new Set();
  for (const f of htmlFiles(dir)) {
    const html = readFileSync(join(dir, f), 'utf8');
    const problem = scriptCountProblem(html);
    if (problem) throw new Error(`${f}: ${problem}`);
    let b;
    try {
      b = inlineBlocks(html);
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
    for (const s of b.scripts) scripts.add(cspHash(s));
    for (const s of b.styles) styles.add(cspHash(s));
  }
  return { scripts: [...scripts].sort(), styles: [...styles].sort() };
}

/** Writes csp-hashes.json at the root of the publish build in `dir`, which the site Worker reads. */
export function writeInlineHashes(dir) {
  const hashes = inlineHashesOf(dir);
  writeFileSync(join(dir, 'csp-hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
  return hashes;
}
