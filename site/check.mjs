// Checks the site before it is published. Exits 1 on the first group with a failure.
//
//   node site/check.mjs
//
// The groups below are listed in the order they run: the budget (12) counts last, after 13 and 14, because it may
// call a counter over the network.
//
// 1. site/index.html is what site/build.mjs renders from site/llms.txt (one source).
// 2. Placeholders: {{OP1}} and {{OP2}} appear exactly once, in the Configure block; no others.
//    A filled build leaves none, no editor note, and no local address. If a publish build exists in
//    reports/site-out/, it is checked the same way.
// 3. Every link in index.html is absolute https, an in-page anchor that exists, or a site-root path that names
//    a file in site/.
// 4. Content agrees with the repository: the EIP-712 types and domain with examples/verify.ts, the envelope test
//    vectors, the worked checks example and every route with docs/api.md, wherever in the guides each now lives.
// 5. Problem pages (D39): one page per problem type the operator answers, with its status and title.
// 6. The guides spell out every encoding an agent computes (D39), in ref/signing.txt: no knowledge hides in examples/.
// 7. try.mjs: site/try.mjs is the current bundle of examples/try.ts, importing only viem and tweetnacl;
//    the one command (pinned versions, its sha256) heads "Try it" in a filled llms.txt, which asks for no fetch
//    before it. The Try line's copied prompt carries the same command and names llms.txt; the visible page does not
//    show the command (One-Click Escrow, D51). The clipboard fallback keeps the command's spaces (pre-wrap).
// 8. Crow's test seller (D47): the one command buys from it, and ref/intake.txt states its catalog, limits and windows
//    as apps/test-agents/src/catalog.ts runs them.
// 9. Crow's test buyer (T-239): "Sell to Crow's test buyer" (in ref/intake.txt since T-393) states its card, caps,
//    windows and limits as apps/test-agents/src/buyer-rules.ts runs them.
// 10. The role pages (T-359, T-393): site/buy.txt and site/sell.txt each open with a numbered first hour whose every
//    step says what it looks like when it worked, link the front door, and keep local addresses to sell.txt's first hour.
// 11. The guides together (T-393): the front door lists exactly the reference files in site/ref/, every reference a
//    guide names exists and so does every section it cites by name, every crow.direct link resolves, no sentence is in two guides, every call a guide names is a
//    route in docs/api.md, every file under examples/, fixtures/ or spec/ and every pnpm script a guide names exists,
//    and the deployment's addresses are in llms.txt alone (scripts/record-copies.mjs rewrites them there). A publish build writes every guide.
// 13. The buyer's one file (T-393): site/buy.mjs is the current bundle of the buyer's commands, imports only Node's
//    own modules, viem and tweetnacl, declares its commands in its banner, and buy.txt's first step installs it by its
//    sha256.
// 14. ASCII only (T-401): llms.txt, buy.txt, sell.txt and every ref/*.txt hold no byte above 127.
// 15. One brand kit (T-402): a colour or a font stack is written only in site/brand/tokens.css. The pages' sources
//    write none of their own, the kit's components read the tokens, and nothing in the kit is !important or dark.
// 12. The budget (T-393): each role's first-deal path, the front door plus its page, is within FIRST_DEAL_BUDGET
//    (site/guides.mjs). With HOLDBACK_AGENT_ANTHROPIC_API_KEY set it counts with Anthropic's count_tokens for the
//    pinned model; without it, bytes divided by four. It says which.
import { existsSync, readFileSync } from 'node:fs';
import { OG_IMAGE } from './footer.ts';
import { ASSETS, BASE, BUY_COMMANDS, HOME_CSS, HOME_JS, notFoundPage, visualdemoPage, BUY_MJS_URL, BUY_URL, buyBundle, buyInstall, buySha256, filled, page, pins, problemPages, publishedGuides, SELL_URL, SITE_URL, strip, TEST_SELLER_URL, tryBundle, tryCommand, trySha256, TRY_URL } from './build.mjs';
import { apiRoutes, citedSections, duplicateSentences, hasSection, FIRST_DEAL_BUDGET, guideFiles, guideSource, measurePaths, namedCalls, namedReferences, referenceFiles, nonAscii, routeKnown } from './guides.mjs';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');
const md = read('llms.txt'), sell = read('sell.txt'), buy = read('buy.txt'), html = read('index.html'), apiMd = read('../docs/api.md');
/** Every guide's source, by published path. */
const guides = new Map(guideFiles().map((p) => [p, guideSource(p)]));
const ref = (name) => guides.get(`ref/${name}`) ?? '';
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
expect(read('home.css') === HOME_CSS && read('home.js') === HOME_JS, 'site/home.css or site/home.js is stale: run node site/build.mjs');
// The home page's cost to an agent (Rafa, 2026-11-12, after the first direct-brief run): the document carries no
// styles, script or inline mark, so it stays small, and the pointer to the agents' guide comes first, plainly.
const HOME_MAX_BYTES = 8000, POINTER_WITHIN = 600;
const head600 = Buffer.from(html).subarray(0, POINTER_WITHIN).toString('utf8');
expect(Buffer.byteLength(html) <= HOME_MAX_BYTES, `site/index.html is ${Buffer.byteLength(html)} bytes: an agent reading the home page pays for every byte; keep it at or under ${HOME_MAX_BYTES} (styles in home.css, scripts in home.js)`);
expect(head600.includes(`<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${BASE}llms.txt">`) && /<!-- For AI agents: [^>]*llms\.txt[^>]*-->/.test(head600), `the first ${POINTER_WITHIN} bytes of index.html must carry the plain sentence for agents and the <link rel="alternate"> to llms.txt`);
expect(!/<style|<script(?![^>]*\bsrc=)/i.test(html), 'index.html carries inline styles or an inline script: they belong in home.css and home.js');
// The 404 page: an agent that guessed a wrong address is pointed to the guides first, for little more than a kilobyte.
const notFound = read('404.html');
expect(notFound === notFoundPage(), 'site/404.html is stale: run node site/build.mjs');
const nfHead = Buffer.from(notFound).subarray(0, POINTER_WITHIN).toString('utf8');
expect(Buffer.byteLength(notFound) <= 4000 && /<!-- Not found \(404\)\. For AI agents: [^>]*llms\.txt[^>]*buy\.txt[^>]*sell\.txt[^>]*-->/.test(nfHead) && nfHead.includes(`href="${BASE}llms.txt"`), `site/404.html must be at most 4,000 bytes and point to llms.txt, buy.txt and sell.txt in its first ${POINTER_WITHIN} bytes`);
for (const path of ['', 'llms.txt', 'buy.txt', 'sell.txt', 'demo/']) expect(notFound.includes(` href="${BASE}${path}">`), `site/404.html does not link ${BASE}${path}`);

// 2. Placeholders.
const configure = md.slice(md.indexOf('## Configure'), md.indexOf('## ', md.indexOf('## Configure') + 3));
expect(count(md, '{{OP1}}') === 1 && configure.includes('OP1={{OP1}}'), '{{OP1}} must appear once in llms.txt, as OP1={{OP1}} under Configure');
expect(count(md, '{{OP2}}') === 1 && configure.includes('OP2={{OP2}}'), '{{OP2}} must appear once in llms.txt, as OP2={{OP2}} under Configure');
const tryIt = md.slice(md.indexOf('## Try it'), md.indexOf('\n## ', md.indexOf('## Try it') + 3));
expect(count(md, '{{TRY_COMMAND}}') === 1 && tryIt.includes('```sh\n{{TRY_COMMAND}}\n```') && tryIt.indexOf('```') === tryIt.indexOf('```sh\n{{TRY_COMMAND}}'), '{{TRY_COMMAND}} must appear once in llms.txt, as the first code block of "Try it"');
expect((md.match(/\{\{[^}]*\}\}/g) ?? []).every((p) => ['{{OP1}}', '{{OP2}}', '{{TRY_COMMAND}}'].includes(p)), 'llms.txt has an unknown {{placeholder}}');
// A link as build.mjs renders one (https, trailing punctuation left out), parsed, so a look-alike host or a longer
// path does not count (CodeQL js/incomplete-url-substring-sanitization).
const mdLinks = (md.match(/https:\/\/[^\s<)]+[^\s<).,;:]/g) ?? []).filter((u) => URL.canParse(u)).map((u) => new URL(u));
expect(mdLinks.some((u) => u.host === 'github.com' && u.pathname === '/rafaeldavid/holdback'), 'llms.txt links the public repo (optional reading)');
// The home page (the enterprise look, Rafa 2026-11-12, as on the demo page): a slim header with Crow's mark and the
// links to the demo, the agent docs and early access; the hero (the tagline, the headline's three lines, the lede,
// early access, the demo link); the six value props, each with an icon; then the footer and the agent docs link.
expect(!/\{\{/.test(html) && /<header class="ck-bar"><div class="ck-bar-in">\s*<a class="ck-brand" href="\/"><span class="ck-mark" aria-hidden="true"><\/span>Crow<\/a>[\s\S]*?<a class="ck-nav" href="\/llms\.txt">[^<]+<\/a>\s*<a class="ck-btn ck-btn-out ck-btn-s" href="\/demo\/">[^<]+<\/a>\s*<\/div><\/header>\s*<main class="page">\s*<section class="hero">\s*<div id="stream-b" class="stream" aria-hidden="true"><\/div>\s*<div id="stream-s" class="stream" aria-hidden="true"><\/div>\s*<p class="ck-eyebrow">[^<]+<\/p>\s*<h1>\s*<span class="sr">[^<]+<\/span>\s*<span class="line" aria-hidden="true"><span class="verb">(<span class="v[^"]*">[^<]+<\/span>){3}<\/span><\/span>\s*<\/h1>\s*<p class="lede">[^<]+<\/p>\s*<form class="signup" id="join-form"[\s\S]*?<\/form>\s*<a class="demo-link" href="\/demo\/">[^<]+<\/a>\s*<\/section>\s*<section class="props"[^>]*>(\s*<div class="prop"><svg class="icon"[\s\S]*?<\/svg><h2>[\s\S]*?<\/h2><p>[^<]+<\/p><\/div>){6}\s*<\/section>\s*<\/main>\s*<footer class="ck-foot">\s*<div class="ck-foot-top">\s*<div class="ck-foot-brand">[\s\S]*?<p>Verifiable settlement for AI commerce<\/p><\/div>\s*<nav class="ck-foot-nav"[^>]*>[\s\S]*?<a href="\/llms\.txt">[^<]+<\/a>[\s\S]*?<button class="copy" id="copy"[\s\S]*?<\/nav>\s*<\/div>\s*<div class="ck-foot-bar"><span>© 2026 Crow<\/span><span class="ck-pill">Testing Now Live<\/span><\/div>[\s\S]*<\/footer>/.test(html), 'index.html must be the header with the mark, the agent docs link and the Watch Demo button, the hero with the code streams, the three headlines and early access, six value props each with an icon, and the footer with the brand block, the link groups with the agent docs link and the copy-the-prompt button, and the bottom bar');
expect(!/%%|CONFIRM/.test(html) && !/^%% /m.test(strip(md)), 'an editor note reached index.html');
expect(!/127\.0\.0\.1|localhost/.test(md + html), 'a local address is in the site');
for (const [p, text] of guides) if (!['llms.txt', 'sell.txt'].includes(p)) expect(!/127\.0\.0\.1|localhost/.test(text), `${p} has a local address`);
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
  expect(['home.css', 'home.js'].every((f) => existsSync(here(`../reports/site-out/${f}`)) && read(`../reports/site-out/${f}`) === read(f)), 'reports/site-out/home.css or home.js is missing or stale: build with --out again');
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
for (const [, url] of html.matchAll(/(?:href|src|srcset)="([^"]*)"/g)) {
  if (url.startsWith('https://')) continue;
  if (url.startsWith('#')) {
    expect(ids.has(url.slice(1)), `anchor ${url} has no target`);
    continue;
  }
  const resolved = new URL(url, `${SITE_URL}index.html`);
  const ok = resolved.origin === new URL(SITE_URL).origin && resolved.pathname.startsWith(BASE) && existsSync(here(resolved.pathname.slice(BASE.length) || 'index.html'));
  expect(ok || resolved.pathname === `${BASE}problems/`, `link ${url} does not resolve to a site file under ${BASE}`); // problems/ is written by a publish build (5.)
  expect(!/^[a-z]/i.test(url) || url.startsWith('https://'), `link ${url} is page-relative; use ${BASE}… so it works without a trailing slash`);
}

// 4. Content.
const { TYPES, ERC3009_TYPES, knownPins } = await import(here('../examples/verify.ts'));
// The page settles on Sepolia (D41): its domain and deployment are the Sepolia pin the examples sign for.
const sepolia = knownPins().find((p) => p.domain.chainId === 11155111);
expect(sepolia !== undefined, 'examples/deployments.ts pins no Sepolia deployment');
const deployment = Object.fromEntries(Object.entries(sepolia?.chain ?? {}).filter(([k]) => k !== 'explorer'));
const signing = ref('signing.txt');
const types = jsonBlock(signing, '## EIP-712 types');
expect(JSON.stringify(Object.fromEntries(Object.keys(types).map((k) => [k, TYPES[k]]))) === JSON.stringify(types), 'the EIP-712 types differ from examples/verify.ts');
expect(JSON.stringify(jsonBlock(md, 'Pin this EIP-712 domain')) === JSON.stringify(sepolia?.domain), 'the pinned domain in llms.txt differs from the Sepolia pin in examples/verify.ts');
expect(JSON.stringify(jsonBlock(md, 'Pin this deployment too')) === JSON.stringify(deployment), 'the pinned deployment in llms.txt differs from the Sepolia pin in examples/verify.ts');
expect(JSON.stringify(jsonBlock(signing, "USDC's ERC-3009 types")) === JSON.stringify(ERC3009_TYPES), 'the ERC-3009 types in ref/signing.txt differ from examples/verify.ts');
const vectors = (src) => [...src.slice(src.indexOf('| recipient secret key')).matchAll(/^\| ([^|]+) \| (.+) \|$/gm)].slice(0, 11).map((m) => `${m[1].trim()}=${m[2].trim()}`);
const seller = ref('http-seller.txt');
expect(vectors(seller).length === 11 && JSON.stringify(vectors(seller)) === JSON.stringify(vectors(apiMd)), 'the envelope test vectors in ref/http-seller.txt differ from docs/api.md');
expect(JSON.stringify(jsonBlock(ref('checks.txt'), '## Writing checks that protect a buyer')) === JSON.stringify(jsonBlock(apiMd, 'A worked example for a customer list')), 'the worked checks example in ref/checks.txt differs from docs/api.md');
for (const fact of ['x25519-xsalsa20poly1305', '139 characters', 'iv (12 random bytes) || AES-256-GCM ciphertext || tag (16 bytes); no associated data', 'checks-only']) expect(apiMd.includes(fact), `docs/api.md no longer says ${fact}`);
const endpoints = ref('http.txt').slice(ref('http.txt').indexOf('## Endpoints used here'));
const routes = [...endpoints.matchAll(/`(?:GET|POST) (\/[^`?]+)/g)].map((m) => m[1].replace(/<[^>]+>/g, '{x}'));
expect(routes.length >= 12, 'the endpoint list is shorter than expected');
const apiText = apiMd.replace(/\{[a-zA-Z]+\}/g, '{x}');
for (const r of routes) {
  const kind = /^\/v1\/prepare\/([a-z-]+)$/.exec(r)?.[1];
  if (kind) expect(apiMd.includes('/v1/prepare/{kind}') && apiMd.includes(`| \`${kind}\` |`), `prepare kind ${kind} is not in docs/api.md`);
  else expect(apiText.includes(r), `route ${r} is not in docs/api.md`);
}
for (const r of ['/terms', '/recipients', '/events', '/judgment', '/key?recipient=']) expect(apiMd.includes(`/v1/commitments/{id}${r}`), `route /v1/commitments/{id}${r} is not in docs/api.md`);

// 5. Problem pages.
const { PROBLEMS, PROBLEM_BASE } = await import(here('../apps/operator/src/problems.ts'));
const problems = await problemPages();
// T-400: every page the build writes carries a title, a description and a link-preview card, and the site's one
// footer (site/footer.ts); the share image is 1200 by 630 px; no page follows the system's dark mode (light only).
const built = new Map([['index.html', html], ['404.html', read('404.html')], ['demo/index.html', read('demo/index.html')], ['visualdemo/index.html', visualdemoPage(read('visualdemo/index.html'))], ...problems]);
for (const [path, h] of built) {
  expect(/<title>[^<]+<\/title>/.test(h) && ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"', 'name="twitter:card" content="summary_large_image"'].every((t) => h.includes(t)), `${path} lacks its title, description or link-preview card (site/footer.ts)`);
  expect(h.includes('<footer class="ck-foot">') && h.includes('<p>Verifiable settlement for AI commerce</p>') && h.includes('Testing Now Live'), `${path} lacks the site's footer (site/footer.ts)`);
  expect(!/prefers-color-scheme/.test(h), `${path} follows the system's dark mode: the site is light only`);
}
expect(!/prefers-color-scheme/.test(HOME_CSS), 'home.css follows the system dark mode: the site is light only');
const og = readFileSync(here(OG_IMAGE.path));
expect(og.subarray(1, 4).toString() === 'PNG' && og.readUInt32BE(16) === OG_IMAGE.width && og.readUInt32BE(20) === OG_IMAGE.height, `site/${OG_IMAGE.path} must be a ${OG_IMAGE.width} by ${OG_IMAGE.height} px PNG`);
expect(PROBLEM_BASE === `${SITE_URL}problems/`, `problem pages live at ${SITE_URL}problems/, the operator links ${PROBLEM_BASE}`);
expect(problems.has('problems/index.html'), 'no problems/index.html');
for (const [type, p] of Object.entries(PROBLEMS)) {
  const html = problems.get(`problems/${type}.html`);
  expect(html !== undefined && html.includes(`HTTP ${p.status}`) && html.includes(`<code>${type}</code>`), `no page for problem type ${type}`);
}
expect(md.includes(PROBLEM_BASE) && apiMd.includes(PROBLEM_BASE), 'llms.txt and docs/api.md must say where problem types are documented');
expect(ref('http.txt').includes(`${PROBLEM_BASE}<type>`), 'ref/http.txt must say each problem type is explained at its page');
if (existsSync(here('../reports/site-out/llms.txt'))) for (const path of problems.keys()) expect(existsSync(here(`../reports/site-out/${path}`)), `reports/site-out/${path} is missing: build with --out again`);

// 6. Encodings: every client-side computation is on the page.
const encodings = signing.slice(signing.indexOf('## Encodings'), signing.indexOf('## ', signing.indexOf('## Encodings') + 3));
for (const fact of ['hasDelivery', 'hasAudience', 'hasCategories', '{"kind": "", "round": 0}','hashStruct("CommitmentTerms"', 'hashStruct("Delivery"', 'Nonces', '3600 seconds', '`attempt`', 'The funding nonce', 'The operator fee nonce']) expect(encodings.includes(fact), `ref/signing.txt "Encodings" no longer says ${fact}`);
for (const t of ['EarlyAccept', 'MutualSettlement', 'Appeal', 'ReadToken', 'Delegation', 'Publish']) expect(t in types, `the EIP-712 types in ref/signing.txt lack ${t}`);
expect(/"disclosure": "public"/.test(seller) && /"operatorFeeNonce"/.test(ref('http-buyer.txt')), 'the offer and agree requests in ref/http-seller.txt and ref/http-buyer.txt must send disclosure and every nonce');
for (const p of ['llms.txt', 'ref/http.txt', 'ref/signing.txt', 'ref/http-buyer.txt', 'ref/http-seller.txt']) expect(!/Holdback-Notice|GET \$OP1\/` lists|examples\/verify\.ts/.test(guides.get(p) ?? ''), `${p} still points at a header, GET / list or example file that is gone`);

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
// One-Click Escrow (D51, T-229): the copied prompt carries the exact command, so a fresh assistant asks for one
// approval; the visible page shows only the Try line.
const span = /<span id="prompt" hidden>([^<]*)<\/span>/.exec(html);
const prompt = (span?.[1] ?? '').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
expect(prompt.split('\n').includes(command) && prompt.includes(trySha256()), "the Try line's prompt does not carry the current try command on a line of its own");
expect(prompt.includes(`${SITE_URL}llms.txt`), "the Try line's prompt does not name llms.txt");
const visible = html.replace(span?.[0] ?? '', '');
expect(!visible.includes('mkdir -p crow-try') && !visible.includes(trySha256()), 'index.html shows the try command outside the hidden prompt: the page shows only the Try line');
// The clipboard fallback shows the prompt for a hand copy. pre-line collapses the two spaces in
// `echo "<sha256>  try.mjs" | shasum -a 256 -c`, and shasum then refuses the line; pre-wrap keeps them.
expect(/\.copied \{[^}]*white-space: pre-wrap;/.test(HOME_CSS), "the .copied fallback must use white-space: pre-wrap, or a hand copy breaks the command's hash check");
expect(!/before you ask|fetch https:\/\/crow\.direct\/try\.mjs/.test(tryIt), '"Try it" asks the agent to fetch try.mjs before the command: each fetch is one more approval');
expect(tryIt.includes('runs it only if its SHA-256 matches the one in the command') && tryIt.includes('`examples/try.ts`, `agent.ts` and `verify.ts` in https://github.com/rafaeldavid/holdback'), '"Try it" lost a trust anchor: the SHA-256 pin or the source on GitHub');

// 8. Crow's test seller.
const { LIMITS, TIMING, CHECKS, PRICE_UNITS } = await import(here('../apps/test-agents/src/catalog.ts'));
expect(command.endsWith(`&& node try.mjs --seller ${TEST_SELLER_URL}`), "the try command does not buy from Crow's test seller");
const intake = ref('intake.txt');
const testSeller = intake.indexOf("## Crow's test seller") < 0 ? '' : intake.slice(intake.indexOf("## Crow's test seller"), intake.indexOf('\n## ', intake.indexOf("## Crow's test seller") + 3));
expect(testSeller.includes(TEST_SELLER_URL) && testSeller.includes(`${TEST_SELLER_URL}/agent.json`) && tryIt.includes('`ref/intake.txt`'), `ref/intake.txt does not describe Crow's test seller at ${TEST_SELLER_URL} and its card, or "Try it" does not point there`);
const l = LIMITS;
expect(testSeller.includes(`${l.perClientPerHour} requests per IP address an hour and ${l.perClientPerDay} a day (a fresh key does not reset them); ${l.perHour} offers an hour and ${l.perDay} a day in all; ${l.open} in progress at once`), 'llms.txt states other limits for the test seller than apps/test-agents/src/catalog.ts');
expect(testSeller.includes(`expires ${TIMING.offerExpiresInSec / 60} minutes after it is made, and funding closes at ${TIMING.fundWithinSec / 60} minutes`) && TIMING.deliverWithinSec === 3600 && testSeller.includes('an hour after the offer'), 'llms.txt states other windows for the test seller than apps/test-agents/src/catalog.ts');
expect(PRICE_UNITS === '25000000' && testSeller.includes('for 25 tUSDC') && CHECKS.map((c) => c.id).join() === 'cols,rows,uniq' && testSeller.includes('`cols`, `rows` (exactly 3) and `uniq`'), "llms.txt states another catalog for the test seller than apps/test-agents/src/catalog.ts");
expect(tryIt.includes('`--outcome refund`') && testSeller.includes('"test": {"outcome": "refund"}'), 'llms.txt does not say how to ask the test seller for a refund');

// 9. Crow's test buyer (T-239): "Sell to Crow's test buyer" states its card, price caps, windows and limits as
//    apps/test-agents/src/buyer-rules.ts runs them.
const TEST_BUYER_URL = 'https://crow.direct/agents/test-buyer';
const rules = await import(here('../apps/test-agents/src/buyer-rules.ts'));
const start = intake.indexOf("## Sell to Crow's test buyer");
const testBuyer = start < 0 ? '' : intake.slice(start, intake.indexOf('\n## ', start + 3) < 0 ? undefined : intake.indexOf('\n## ', start + 3));
const tusdc = (u) => `${Number(BigInt(u) / 1_000_000n)} tUSDC`;
const bl = rules.BUYER_LIMITS, w = rules.WINDOWS, cr = rules.CHECKS_RULE;
// Whole sentences, matched as text: the URL is the buyer's address in the guide, not a value being sanitized.
expect(/beside the test seller, at https:\/\/crow\.direct\/agents\/test-buyer, so /.test(testBuyer) && /\*\*The card\.\*\* https:\/\/crow\.direct\/agents\/test-buyer\/agent\.json is a `crow-buyer` card/.test(testBuyer), `llms.txt has no "Sell to Crow's test buyer" section describing ${TEST_BUYER_URL} and its card`);
expect(testBuyer.includes(`A price of at most ${tusdc(rules.MAX_PRICE_UNITS)} and an adjudication fee of at most ${tusdc(rules.MAX_ADJUDICATION_FEE_UNITS)}`), 'llms.txt states other price caps for the test buyer than apps/test-agents/src/buyer-rules.ts');
expect(testBuyer.includes(`${cr.min} to ${cr.max} deterministic checks`) && testBuyer.includes(`at least ${cr.requiredAtLeast} of them \`"required": true\``), 'llms.txt states other check rules for the test buyer than apps/test-agents/src/buyer-rules.ts');
expect(testBuyer.includes(`at most ${w.maxDeliverWithinSec.toLocaleString('en-US')} s (a day) after the offer`) && testBuyer.includes(`at most ${w.maxJudgingSec.toLocaleString('en-US')} s`) && testBuyer.includes(`at least ${w.minFundingLeftSec} s left to agree and fund`), 'llms.txt states other windows for the test buyer than apps/test-agents/src/buyer-rules.ts');
expect(testBuyer.includes(`${bl.perSellerPerHour} deals per seller address an hour and ${bl.perSellerPerDay} a day; ${bl.perDay} a day in all; ${bl.open} in progress at once`), 'llms.txt states other limits for the test buyer than apps/test-agents/src/buyer-rules.ts');

// 10. The role pages (T-359, T-393).
const sections = (src) => [...src.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const sectionOf = (src, title) => {
  const at = src.indexOf(`\n## ${title}\n`);
  if (at < 0) return '';
  const end = src.indexOf('\n## ', at + 4);
  return src.slice(at + 1, end < 0 ? undefined : end + 1);
};
const links = (src) => (src.match(/https:\/\/[^\s<)`"]+[^\s<).,;:`"]/g) ?? []).filter((u) => URL.canParse(u)).map((u) => new URL(u));
const firstHour = sectionOf(sell, 'First hour');
for (const [file, src, title] of [['sell.txt', sell, '# Crow for sellers\n'], ['buy.txt', buy, '# Crow for buyers\n']]) {
  expect(src.startsWith(title) && sections(src).includes('First hour'), `site/${file} must open with its title and have a "## First hour"`);
  // A step runs from its numbered line to the next one, its indented code block included.
  const steps = sectionOf(src, 'First hour').split(/\n(?=\d+\. \*\*)/).slice(1);
  expect(steps.length >= 5 && steps.every((l, i) => l.startsWith(`${i + 1}. `) && l.includes('Worked')), `each "First hour" step in ${file} is numbered in order and says what you see when it Worked`);
  expect(links(src).some((u) => u.href === `${SITE_URL}llms.txt`) && links(src).some((u) => u.host === 'github.com' && u.pathname === '/rafaeldavid/holdback'), `${file} links the front door and the public repo`);
}
expect(!/127\.0\.0\.1|localhost/.test(sell.replace(firstHour, '')), 'sell.txt has a local address outside "First hour"');
const roles = sectionOf(md, 'Read one page for your role');
expect(roles.includes(BUY_URL) && roles.includes(SELL_URL), `llms.txt has a "Read one page for your role" section that links ${BUY_URL} and ${SELL_URL}`);

// 11. The guides together (T-393).
const published = new Set(['index.html', '404.html', 'home.css', 'home.js', 'try.mjs', 'buy.mjs', 'version.json', ...ASSETS]);
const scripts = JSON.parse(read('../package.json')).scripts;
const refs = referenceFiles();
const listed = [...sectionOf(md, 'Reference').matchAll(/^- \[([a-z0-9-]+\.txt)\]\(https:\/\/crow\.direct\/ref\/\1\):/gm)].map((m) => `ref/${m[1]}`).sort();
expect(refs.length > 0 && JSON.stringify(listed) === JSON.stringify(refs), `the front door's "Reference" lists ${listed.join(', ') || 'nothing'}, and site/ref/ holds ${refs.join(', ')}`);
for (const [p, text] of guides) {
  for (const r of namedReferences(text)) expect(refs.includes(r), `${p} names ${r}, which is not in site/ref/`);
  for (const { file, title } of citedSections(text)) expect(guides.has(file) && hasSection(guides.get(file), title), `${p} cites "${title}" in ${file}, which has no such section`);
  for (const u of links(text)) {
    if (u.host !== new URL(SITE_URL).host) continue;
    const path = u.pathname.slice(BASE.length);
    // What a publish build writes, and the two test agents, which apps/test-agents serves on routes of this host.
    const ok = guides.has(path) || published.has(path) || ['', 'problems/', 'visualdemo/'].includes(path) || problems.has(`${path.replace(/\.html$/, '')}.html`) || /^agents\/test-(seller|buyer)(\/agent\.json)?$/.test(path);
    expect(ok, `${p} links ${u.href}, which neither the publish build nor the test agents serve`);
  }
  for (const [, f] of text.matchAll(/`((?:examples|fixtures|spec)\/[A-Za-z0-9_./-]+\.[a-z]+)`/g)) expect(existsSync(here(`../${f}`)), `${p} names ${f}, which is not in the repository`);
  for (const [, f] of text.matchAll(/\bnode (examples\/[A-Za-z0-9_-]+\.ts)\b/g)) expect(existsSync(here(`../${f}`)), `${p} runs ${f}, which is not in the repository`);
  for (const [, name] of text.matchAll(/\bpnpm ([a-z][a-z:-]*)/g)) expect(name === 'install' || name in scripts, `${p} runs pnpm ${name}, which is not a script in package.json`);
  const routes = apiRoutes(apiMd);
  for (const call of namedCalls(text)) expect(routeKnown(call, routes), `${p} names ${call}, which docs/api.md does not describe`);
}
for (const { sentence, files } of duplicateSentences(guides)) expect(false, `one sentence is in ${files.join(' and ')}: "${sentence.slice(0, 120)}"`);
const pinned = [...new Set(Object.values(deployment).flatMap((v) => (typeof v === 'object' ? Object.values(v) : [v])).filter((v) => /^0x[0-9a-f]{40}$/i.test(String(v))).map((v) => String(v).toLowerCase()))];
for (const [p, text] of guides) if (p !== 'llms.txt') for (const a of pinned) expect(!text.toLowerCase().includes(a), `${p} names the deployment address ${a}: the pins live in llms.txt alone, which the cutover's copies step (scripts/record-copies.mjs) rewrites`);
let filledGuides = new Map();
try {
  filledGuides = publishedGuides(sample);
} catch (e) {
  expect(false, `the guides cannot be published: ${e.message}`);
}
if (existsSync(here('../reports/site-out/llms.txt'))) {
  const outOp = { op1: /^OP1=(.+)$/m.exec(read('../reports/site-out/llms.txt'))?.[1], op2: /^OP2=(.+)$/m.exec(read('../reports/site-out/llms.txt'))?.[1] };
  let built = new Map();
  try {
    built = publishedGuides(outOp);
  } catch {}
  for (const [p, text] of built) expect(existsSync(here(`../reports/site-out/${p}`)) && read(`../reports/site-out/${p}`) === text, `reports/site-out/${p} is missing or stale against site/${p}: build with --out again`);
}

// 13. The buyer's one file (T-393): site/buy.mjs is the current bundle of site/buy-entry.mjs, importing only Node's
//     own modules, viem and tweetnacl; its banner declares the commands it holds before any module runs; buy.txt's
//     first step carries the one install command, with the file's current sha256.
const buyFile = read('buy.mjs');
expect(buyFile === (await buyBundle()), 'site/buy.mjs is stale against examples/: run node site/build.mjs');
const buyImports = [...new Set([...buyFile.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]))].sort();
expect(buyImports.every((m) => m.startsWith('node:') || ['tweetnacl', 'viem', 'viem/accounts'].includes(m)) && !/@holdback\/|\bimport\(/.test(buyFile), `site/buy.mjs must import only node:*, viem, viem/accounts and tweetnacl, and nothing dynamically (it imports ${buyImports.join(', ')})`);
const declares = `Object.defineProperty(globalThis, 'crowCommands', { value: Object.freeze(${JSON.stringify(BUY_COMMANDS)})`;
expect(buyFile.indexOf(declares) > 0 && buyFile.indexOf(declares) < buyFile.indexOf('\nimport '), "site/buy.mjs's banner must declare crowCommands, as BUY_COMMANDS in site/build.mjs, before any module");
const install = buyInstall();
const firstStep = sectionOf(buy, 'First hour').split(/\n(?=\d+\. \*\*)/)[1] ?? '';
expect(count(buy, '{{BUY_INSTALL}}') === 1 && firstStep.includes('```sh\n   {{BUY_INSTALL}}\n   ```'), 'buy.txt must carry {{BUY_INSTALL}} once, in an sh block in the first step of "First hour"');
expect(install.includes(`curl -fsSL ${BUY_MJS_URL} -o buy.mjs.part `) && install.endsWith(`echo "${buySha256()}  buy.mjs.part" | shasum -a 256 -c && mv buy.mjs.part buy.mjs`) && (filledGuides.get('buy.txt') ?? '').includes(install), 'the published buy.txt does not carry the install command with the current sha256 of site/buy.mjs');
// The dispatcher's words and the banner's commands are one table: each `node buy.mjs <word>` routes to its own command,
// and every command a bundled file names is one the banner declares, or it would print a file crow-buy does not have.
const words = JSON.parse((/const SUBCOMMANDS = (\{[^}]*\});/.exec(read('buy-entry.mjs'))?.[1] ?? '{}').replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
const routed = { 'buy-with-signer': 'node buy.mjs', ...Object.fromEntries(Object.entries(words).map(([w, name]) => [name, `node buy.mjs ${w}`])) };
expect(JSON.stringify(Object.entries(routed).sort()) === JSON.stringify(Object.entries(BUY_COMMANDS).sort()), `site/buy-entry.mjs routes ${JSON.stringify(routed)}, and BUY_COMMANDS in site/build.mjs declares ${JSON.stringify(BUY_COMMANDS)}: they must be the same`);
for (const [, name] of buyFile.matchAll(/command(?:\$\d+)?\("([a-z-]+)"/g)) expect(Object.hasOwn(BUY_COMMANDS, name), `site/buy.mjs prints the command ${name}, which BUY_COMMANDS does not declare: it would print node examples/${name}.ts`);
for (const [name, line] of Object.entries(BUY_COMMANDS)) expect(!(filledGuides.get('buy.txt') ?? '').includes(`node examples/${name}.ts`) && buy.includes(line), `buy.txt must run ${name} as \`${line}\`, the file step one installs`);
if (existsSync(here('../reports/site-out/llms.txt'))) expect(existsSync(here('../reports/site-out/buy.mjs')) && read('../reports/site-out/buy.mjs') === buyFile, 'reports/site-out/buy.mjs is missing or differs from site/buy.mjs: build with --out again');

// 14. ASCII only (T-401): every guide an agent reads, llms.txt, buy.txt, sell.txt and ref/*.txt, holds no byte above 127.
for (const [p, text] of guides) for (const { line, char } of nonAscii(text)) expect(false, `site/${p} line ${line} holds ${char}: write the guides in ASCII ("Crow", "...", "x", "-")`);
for (const [p, text] of filledGuides) if (!nonAscii(guides.get(p) ?? '').length) for (const { line, char } of nonAscii(text)) expect(false, `the published ${p} line ${line} holds ${char}: a filled value is not ASCII`);

// 15. One brand kit (T-402): a colour (hex, rgb(), hsl()) or a font stack is written only in site/brand/tokens.css.
// The sources of the home page, the 404 and problem pages, the footer, the early-access dialog and the demo page, and
// the kit's own components.css, write none: they read the tokens. Nothing is allow-listed today; an entry needs its
// reason beside it. site/visualdemo/ and site/og.html (the share image's source, drawn once by hand) are not read here.
const KIT_READERS = ['build.mjs', 'footer.ts', 'drawer.ts', 'home.js', '../tools/duet/replay.ts', 'brand/components.css', 'brand/kit.mjs'];
const KIT_ALLOWED = new Map(); // 'path' -> the reason it may write a colour or a font stack
const COLOUR = /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(/g;
const FONT_STACK = /-apple-system|BlinkMacSystemFont|Helvetica|Arial|Garamond|Menlo|\bsans-serif\b|\bmonospace\b|"SF (?:Pro|Mono)/g;
for (const p of KIT_READERS) {
  if (KIT_ALLOWED.has(p)) continue;
  const src = read(p), at = p.startsWith('../') ? p.slice(3) : `site/${p}`;
  for (const m of src.matchAll(COLOUR)) expect(false, `${at} writes the colour ${m[0]} at line ${src.slice(0, m.index).split('\n').length}: use a token from site/brand/tokens.css`);
  for (const m of src.matchAll(FONT_STACK)) expect(false, `${at} writes a font stack (${m[0]}) at line ${src.slice(0, m.index).split('\n').length}: use --font, --display or --mono from site/brand/tokens.css`);
}
const kitFiles = ['brand/tokens.css', 'brand/components.css'].map(read).join('\n');
expect(!/!important/.test(kitFiles), 'site/brand/ uses !important: a part is never reshaped from outside, so it needs none');
expect(!/prefers-color-scheme/.test(kitFiles + HOME_CSS), 'site/brand/ or home.css follows the system dark mode: the kit is light only');
expect((read('brand/tokens.css').match(/:root \{/g) ?? []).length === 1, 'site/brand/tokens.css holds one :root block and nothing else');

// 12. The budget (T-393).
let measured = [];
try {
  measured = await measurePaths(filledGuides);
} catch (e) {
  expect(false, `the guides could not be counted: ${e.message}`);
}
for (const m of measured) expect(m.tokens <= FIRST_DEAL_BUDGET.tokens, `the ${m.role}'s first-deal path (${m.files.join(' + ')}) is ${m.tokens} tokens, over the budget of ${FIRST_DEAL_BUDGET.tokens} (${m.method})`);

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
for (const m of measured) console.log(`first-deal path, ${m.role}: ${m.files.join(' + ')}, ${m.bytes} bytes, ${m.tokens} of ${FIRST_DEAL_BUDGET.tokens} tokens (${m.method})${m.counted === null ? '' : `; the estimate, bytes divided by four, is ${m.estimate}`}`);
console.log(`site check PASS: one source, placeholders in place, links resolve under ${BASE}, content agrees with docs/api.md and examples/verify.ts, try.mjs current and its command in llms.txt, the test seller and the test buyer as apps/test-agents runs them, the role pages, the guides together, and each role's first-deal path within its budget`);
