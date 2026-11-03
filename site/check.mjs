// Checks the site before it is published. Exits 1 on the first group with a failure.
//
//   node site/check.mjs
//
// 1. site/index.html is what site/build.mjs renders from site/llms.txt (one source).
// 2. Placeholders: {{OP1}} and {{OP2}} appear exactly once, in the Configure block; no others.
//    A filled build leaves none, no editor note, and no local address. If a publish build exists in
//    reports/site-out/, it is checked the same way.
// 3. Every link in index.html is absolute https, an in-page anchor that exists, or a site-root path that names
//    a file in site/.
// 4. Content agrees with the repository: the EIP-712 types and domain with examples/verify.ts, the envelope test
//    vectors, the worked checks example and every route with docs/api.md.
// 5. Problem pages (D39): one page per problem type the operator answers, with its status and title.
// 6. The agent guide spells out every encoding an agent computes (D39): no knowledge hides in examples/.
// 7. try.mjs: site/try.mjs is the current bundle of examples/try.ts, importing only viem and tweetnacl;
//    the one command (pinned versions, its sha256) heads "Try it" in a filled llms.txt and sits in the page.
import { existsSync, readFileSync } from 'node:fs';
import { BASE, filled, page, pins, problemPages, SITE_URL, strip, tryBundle, tryCommand, TRY_URL } from './build.mjs';

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
const tryIt = md.slice(md.indexOf('## Try it'), md.indexOf('\n## ', md.indexOf('## Try it') + 3));
expect(count(md, '{{TRY_COMMAND}}') === 1 && tryIt.includes('```sh\n{{TRY_COMMAND}}\n```') && tryIt.indexOf('{{TRY_COMMAND}}') < tryIt.indexOf('\n1. '), '{{TRY_COMMAND}} must appear once in llms.txt, in an sh block at the top of "Try it", before the step-by-step list');
expect((md.match(/\{\{[^}]*\}\}/g) ?? []).every((p) => ['{{OP1}}', '{{OP2}}', '{{TRY_COMMAND}}'].includes(p)), 'llms.txt has an unknown {{placeholder}}');
expect(md.includes('https://github.com/rafaeldavid/holdback'), 'llms.txt links the public repo (optional reading)');
expect(!/\{\{/.test(html) && /<img class="mark"[^>]*>\s*<h1>[^<]+<\/h1>\s*<p class="sub">[^<]+<\/p>\s*<form class="join"[\s\S]*?<\/form>\s*<p class="intro">[^<]+<\/p>\s*<section class="try"[\s\S]*<\/section>\s*<figure[^>]*>[\s\S]*<\/script>\s*<\/main>/.test(html), 'index.html must be the title, the subtitle, early access, the intro, Try ’crow and the drawing');
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
  expect(existsSync(here('../reports/site-out/try.mjs')) && read('../reports/site-out/try.mjs') === read('try.mjs'), 'reports/site-out/try.mjs is missing or differs from site/try.mjs: build with --out again');
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
  const ok = resolved.origin === new URL(SITE_URL).origin && resolved.pathname.startsWith(BASE) && existsSync(here(resolved.pathname.slice(BASE.length) || 'index.html'));
  expect(ok, `link ${url} does not resolve to a site file under ${BASE}`);
  expect(!/^[a-z]/i.test(url) || url.startsWith('https://'), `link ${url} is page-relative; use ${BASE}… so it works without a trailing slash`);
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
  else expect(apiRoutes.includes(r), `route ${r} is not in docs/api.md`);
}
for (const r of ['/terms', '/recipients', '/events', '/judgment', '/key?recipient=']) expect(apiMd.includes(`/v1/commitments/{id}${r}`), `route /v1/commitments/{id}${r} is not in docs/api.md`);

// 5. Problem pages.
const { PROBLEMS, PROBLEM_BASE } = await import(here('../apps/operator/src/problems.ts'));
const problems = await problemPages();
expect(PROBLEM_BASE === `${SITE_URL}problems/`, `problem pages live at ${SITE_URL}problems/, the operator links ${PROBLEM_BASE}`);
expect(problems.has('problems/index.html'), 'no problems/index.html');
for (const [type, p] of Object.entries(PROBLEMS)) {
  const html = problems.get(`problems/${type}.html`);
  expect(html !== undefined && html.includes(`HTTP ${p.status}`) && html.includes(`<code>${type}</code>`), `no page for problem type ${type}`);
}
expect(md.includes(PROBLEM_BASE) && apiMd.includes(PROBLEM_BASE), 'llms.txt and docs/api.md must say where problem types are documented');
if (existsSync(here('../reports/site-out/llms.txt'))) for (const path of problems.keys()) expect(existsSync(here(`../reports/site-out/${path}`)), `reports/site-out/${path} is missing: build with --out again`);

// 6. Encodings: every client-side computation is on the page.
const encodings = md.slice(md.indexOf('## Encodings'), md.indexOf('## ', md.indexOf('## Encodings') + 3));
for (const fact of ['hasDelivery', 'hasAudience', 'hasCategories', '{"kind": "", "round": 0}','hashStruct("CommitmentTerms"', 'hashStruct("Delivery"', 'Nonces', '3600 seconds', '`attempt`']) expect(encodings.includes(fact), `llms.txt "Encodings" no longer says ${fact}`);
for (const t of ['EarlyAccept', 'MutualSettlement', 'Appeal', 'ReadToken', 'Delegation', 'Publish']) expect(t in types, `the EIP-712 types in llms.txt lack ${t}`);
expect(/"disclosure": "public"/.test(md) && /"operatorFeeNonce"/.test(md), 'llms.txt offer and agree requests must send disclosure and every nonce');
expect(!/Holdback-Notice|GET \$OP1\/` lists|examples\/verify\.ts/.test(md), 'llms.txt still points at a header, GET / list or example file that is gone');

// 7. try.mjs and the one command.
const bundle = read('try.mjs');
expect(bundle === (await tryBundle()), 'site/try.mjs is stale against examples/: run node site/build.mjs');
const imports = [...bundle.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
expect(JSON.stringify(imports) === JSON.stringify(['tweetnacl', 'viem', 'viem/accounts']) && !/@holdback\/|\bimport\(/.test(bundle), 'site/try.mjs must import only viem, viem/accounts and tweetnacl');
const { viem, tweetnacl } = pins();
const command = tryCommand();
expect(command.includes(` viem@${viem} tweetnacl@${tweetnacl} `) && command.includes(`curl -fsSLO ${TRY_URL} `), 'the try command does not pin the lockfile versions or fetch try.mjs from the site');
expect(bundle.includes(`npm install viem@${viem} tweetnacl@${tweetnacl}`), 'the try.mjs banner names other versions than the command');
const filledTry = sampleTxt.slice(sampleTxt.indexOf('## Try it'));
expect(filledTry.split('\n').find((l) => l.startsWith('mkdir ')) === command, 'a filled llms.txt does not carry the current try command at the top of "Try it"');
const escaped = command.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
expect(html.includes(`<div class="cmd-box"><code>${escaped}</code>`) && /<p class="sr-only">For AI agents[^<]*<\/p>\s*<div class="cmd-box"><code>/.test(html), "index.html does not show the current try command under the agent line");

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log(`site check PASS: one source, placeholders in place, links resolve under ${BASE}, content agrees with docs/api.md and examples/verify.ts, try.mjs current and its command in place`);
