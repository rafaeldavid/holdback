// Checks the site before it is published (T-027). Exits 1 on the first group with a failure.
//
//   node site/check.mjs
//
// 1. site/index.html is what site/build.mjs renders from site/llms.txt (one source).
// 2. Placeholders: {{OP1}} and {{OP2}} appear exactly once, in the Configure block; no others.
//    A filled build leaves none, no editor note, and no local address. If a publish build exists in
//    reports/site-out/, it is checked the same way.
// 3. Every link in index.html is absolute https, an in-page anchor that exists, or a path under /escrow/ that
//    names a file in site/.
// 4. Content agrees with the repository: the EIP-712 types and domain with examples/verify.ts, the envelope test
//    vectors, the worked checks example and every route with docs/api.md.
import { existsSync, readFileSync } from 'node:fs';
import { filled, page, SITE_URL, strip } from './build.mjs';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');
const md = read('llms.txt'), html = read('index.html'), apiMd = read('../docs/api.md');
const failures = [];
const expect = (ok, what) => {
  if (!ok) failures.push(what);
};
const count = (s, needle) => s.split(needle).length - 1;
const jsonBlock = (src, after) => {
  const at = src.indexOf(after);
  if (at < 0) return undefined;
  const start = src.indexOf('```json\n', at) + 8;
  return JSON.parse(src.slice(start, src.indexOf('\n```', start)));
};

// 1. One source.
expect(html === page(md), 'site/index.html is stale: run node site/build.mjs');

// 2. Placeholders.
const configure = md.slice(md.indexOf('## Configure'), md.indexOf('## ', md.indexOf('## Configure') + 3));
expect(count(md, '{{OP1}}') === 1 && configure.includes('OP1={{OP1}}'), '{{OP1}} must appear once in llms.txt, as OP1={{OP1}} under Configure');
expect(count(md, '{{OP2}}') === 1 && configure.includes('OP2={{OP2}}'), '{{OP2}} must appear once in llms.txt, as OP2={{OP2}} under Configure');
expect((md.match(/\{\{[^}]*\}\}/g) ?? []).every((p) => ['{{OP1}}', '{{OP2}}'].includes(p)), 'llms.txt has an unknown {{placeholder}}');
expect(md.includes('https://github.com/rafaeldavid/holdback'), 'llms.txt links the public repo (optional reading)');
expect(!/\{\{/.test(html) && /<img class="mark"[^>]*>\s*<h1>[^<]+<\/h1>\s*<p class="sub">[^<]+<\/p>\s*<p class="intro">[^<]+<\/p>\s*<figure[^>]*>[\s\S]*<\/script>\s*<\/main>/.test(html), 'index.html must be only the title, the subtitle and the drawing');
expect(!/%%|CONFIRM/.test(html) && !/^%% /m.test(strip(md)), 'an editor note reached index.html');
expect(!/127\.0\.0\.1|localhost/.test(md + html), 'a local address is in the site');
const sample = { op1: 'https://op1.example.workers.dev', op2: 'https://op2.example.workers.dev' };
const unconfirmed = md.split('\n').filter((l) => !l.startsWith('%% CONFIRM')).join('\n');
const sampleTxt = filled(unconfirmed, sample);
expect(!/\{\{|%%/.test(sampleTxt + page(sampleTxt)), 'a filled build leaves a placeholder or note');
expect(sampleTxt.includes(`OP1=${sample.op1}`) && sampleTxt.includes(`OP2=${sample.op2}`), 'a filled build does not set OP1 and OP2');
if (existsSync(here('../reports/site-out/llms.txt'))) {
  const outTxt = read('../reports/site-out/llms.txt'), outHtml = read('../reports/site-out/index.html');
  expect(outHtml === page(outTxt), 'reports/site-out/index.html is not the page of reports/site-out/llms.txt');
  expect(!/\{\{|%%|127\.0\.0\.1|localhost/.test(outTxt + outHtml), 'reports/site-out has a placeholder, editor note or local address');
  expect(/^OP1=https:\/\/[^\s/]+$/m.test(outTxt) && /^OP2=https:\/\/[^\s/]+$/m.test(outTxt), 'reports/site-out/llms.txt does not set OP1 and OP2 to https origins');
  expect(outTxt === filled(md, { op1: /^OP1=(.+)$/m.exec(outTxt)?.[1], op2: /^OP2=(.+)$/m.exec(outTxt)?.[1] }), 'reports/site-out is stale against site/llms.txt');
}
let refused = false;
try {
  filled(md, sample);
} catch {
  refused = true;
}
expect(refused === /^%% CONFIRM/m.test(md), 'a filled build must refuse exactly while a %% CONFIRM note remains');

// 3. Links.
const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
for (const [, url] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
  if (url.startsWith('https://')) continue;
  if (url.startsWith('#')) {
    expect(ids.has(url.slice(1)), `anchor ${url} has no target`);
    continue;
  }
  const resolved = new URL(url, `${SITE_URL}index.html`);
  const ok = resolved.origin === new URL(SITE_URL).origin && resolved.pathname.startsWith('/escrow/') && existsSync(here(resolved.pathname.slice('/escrow/'.length) || 'index.html'));
  expect(ok, `link ${url} does not resolve to a site file under /escrow/`);
  expect(!/^[a-z]/i.test(url) || url.startsWith('https://'), `link ${url} is page-relative; use /escrow/… so it works without a trailing slash`);
}

// 4. Content.
const { TYPES, SIMCHAIN_DOMAIN } = await import(here('../examples/verify.ts'));
const types = jsonBlock(md, '## EIP-712 types');
expect(JSON.stringify(Object.fromEntries(Object.keys(types).map((k) => [k, TYPES[k]]))) === JSON.stringify(types), 'the EIP-712 types differ from examples/verify.ts');
expect(JSON.stringify(jsonBlock(md, 'Pin this EIP-712 domain')) === JSON.stringify(SIMCHAIN_DOMAIN), 'the pinned domain differs from examples/verify.ts');
const vectors = (src) => [...src.slice(src.indexOf('| recipient secret key')).matchAll(/^\| ([^|]+) \| (.+) \|$/gm)].slice(0, 11).map((m) => `${m[1].trim()}=${m[2].trim()}`);
expect(vectors(md).length === 11 && JSON.stringify(vectors(md)) === JSON.stringify(vectors(apiMd)), 'the envelope test vectors differ from docs/api.md');
expect(JSON.stringify(jsonBlock(md, '## Writing checks that protect a buyer')) === JSON.stringify(jsonBlock(apiMd, 'A worked example for a customer list')), 'the worked checks example differs from docs/api.md');
for (const fact of ['x25519-xsalsa20poly1305', '139 characters', 'iv (12 random bytes) || AES-256-GCM ciphertext || tag (16 bytes); no associated data', 'checks-only']) expect(apiMd.includes(fact), `docs/api.md no longer says ${fact}`);
const endpoints = md.slice(md.indexOf('## Endpoints used here'));
const routes = [...endpoints.matchAll(/`(?:GET|POST) (\/[^`?]+)/g)].map((m) => m[1].replace(/<[^>]+>/g, '{x}'));
expect(routes.length >= 12, 'the endpoint list is shorter than expected');
const apiRoutes = apiMd.replace(/\{[a-zA-Z]+\}/g, '{x}');
for (const r of routes) {
  const kind = /^\/v1\/prepare\/([a-z-]+)$/.exec(r)?.[1];
  if (kind) expect(apiMd.includes('/v1/prepare/{kind}') && apiMd.includes(`| \`${kind}\` |`), `prepare kind ${kind} is not in docs/api.md`);
  else if (r !== '/v1/faucet') expect(apiRoutes.includes(r), `route ${r} is not in docs/api.md`);
}
for (const r of ['/terms', '/recipients', '/events', '/judgment', '/key?recipient=']) expect(apiMd.includes(`/v1/commitments/{id}${r}`), `route /v1/commitments/{id}${r} is not in docs/api.md`);

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('site check PASS: one source, placeholders in place, links resolve under /escrow/, content agrees with docs/api.md and examples/verify.ts');
