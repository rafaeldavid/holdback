// The inline scripts and styles of the built pages, hashed for the site's content security policy (T-451).
// site/build.mjs calls writeInlineHashes(out) after a publish build has written every page; the site Worker reads the
// file it writes (apps/site/headers.js) and names each hash in script-src or style-src, so the pages' own inline code
// runs and nothing injected later does. site/check.mjs checks every built page against the policy the Worker sends.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

/**
 * The CSP source for one inline block: `sha256-` and the base64 SHA-256 of its text, as a browser hashes it: the HTML
 * parser turns CR LF and a lone CR into LF before the script or style text exists, so a CRLF checkout hashes the same.
 */
export const cspHash = (text) => `sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}`;

/**
 * The inline code one page carries. A <script> with a src is not inline; one whose type is not JavaScript (a JSON data
 * block) is not run, so it needs no hash.
 * @param {string} html
 * @returns {{ scripts: string[], styles: string[] }} the blocks' texts, in page order
 */
export function inlineBlocks(html) {
  const runs = (attrs) => {
    if (/\bsrc\s*=/i.test(attrs)) return false;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    // importmap and speculationrules are not run as code, but a policy still requires their hash.
    return type === undefined || ['module', 'text/javascript', 'application/javascript', 'importmap', 'speculationrules'].includes(type);
  };
  const scripts = [...html.matchAll(SCRIPT)].filter((m) => runs(m[1])).map((m) => m[2]);
  const styles = [...html.matchAll(STYLE)].map((m) => m[1]);
  return { scripts, styles };
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
    const b = inlineBlocks(readFileSync(join(dir, f), 'utf8'));
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
