// The site's trust surfaces (T-421): the trust page (/trust), the status page (/status), their one stylesheet
// (/pages.css) and the security contact (/.well-known/security.txt, RFC 9116). site/build.mjs writes them; site/check.mjs
// checks them (group 16).
//
// Every statement on the trust page carries a link to its source. Values that live elsewhere are read from there at
// build time, never copied by hand: the contract addresses from the deployment record, the request log's and the
// problem reports' retention from the operators' code. A redeploy or a changed retention changes the page at the next
// build, and site/check.mjs fails until the committed page is rebuilt.
//
// The words follow crow-private strategy/2026-11-14-crow-ontology.md: "your company", "reviewer", "deal", "payment
// hold" said with its release rule, and none of the calming claims it refuses (site/check.mjs lists them).
import { readFileSync } from 'node:fs';
import { CARDS, cardTags, CODE_URL, footerHtml } from './footer.ts';
import { button, headerBar, kitCss, notice, sectionHead } from './brand/kit.mjs';
import { drawerScript } from './drawer.ts';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The day the trust page was last checked against its sources, line by line. */
export const TRUST_CHECKED = '2026-11-14';
/** Where a reporter sends a security problem: GitHub's private vulnerability reporting, on since before T-421. */
export const SECURITY_CONTACT = `${CODE_URL}/security/advisories/new`;
export const SECURITY_POLICY = `${CODE_URL}/blob/main/SECURITY.md`;
/** security.txt's Expires is this far ahead of the build (RFC 9116 asks for less than a year). */
export const SECURITY_TXT_DAYS = 180;

/** A file or folder in the public repository, on main. */
export const src = (path, anchor = '') => `${CODE_URL}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path.replace(/\/$/, '')}${anchor ? `#${anchor}` : ''}`;
const etherscan = (address) => `https://sepolia.etherscan.io/address/${address}`;
/** Coinbase's escrow at the commit the contracts pin (contracts/lib/commerce-payments). */
const CPP_ESCROW = 'https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol';

/** The values the trust page states, each read from its source. */
export function trustFacts() {
  const record = JSON.parse(read('../contracts/deployments/sepolia.json'));
  const requestLogDays = /const RETENTION_MS = (\d+) \* DAY_MS;/.exec(read('../apps/demo-cloud/src/telemetry.ts'))?.[1];
  if (!requestLogDays) throw new Error('site/trust.mjs cannot read the request log\'s retention from apps/demo-cloud/src/telemetry.ts: its shape changed');
  if (!Number.isInteger(record.expiryMarginSec) || record.expiryMarginSec <= 0 || record.expiryMarginSec % 3600 !== 0) throw new Error('contracts/deployments/sepolia.json names no expiryMarginSec in whole hours');
  if (record.chainId !== 11155111 || !/^0x[0-9a-fA-F]{40}$/.test(record.escrow ?? '') || !/^0x[0-9a-fA-F]{40}$/.test(record.rules ?? '')) throw new Error('contracts/deployments/sepolia.json names no Sepolia escrow and rules contract');
  return { escrow: record.escrow, rules: record.rules, token: record.token.address, requestLogDays: Number(requestLogDays), expiryMarginHours: record.expiryMarginSec / 3600 };
}

/**
 * The trust page's sections, written for a person on a company's security or procurement team (Rafa, 2026-11-14):
 * plain active sentences, subject first, in the order things happen. Models read llms.txt and ref/limits.txt.
 *
 * A section is a heading and blocks. A block is a paragraph, a list of sentences, each [html, sources], where sources
 * is a list of [label, url] cited as footnotes after that sentence; or { lead, items }, a lead paragraph and a plain
 * list the lead's sources cover. Sentence HTML is written here (it may hold <code>).
 */
export function trustSections(f = trustFacts()) {
  const record = ['The deployment record (contracts/deployments/sepolia.json)', src('contracts/deployments/sepolia.json')];
  const limits = ['Agent docs: honest limits (ref/limits.txt)', 'https://crow.direct/ref/limits.txt'];
  const baseline = (anchor, label) => [`Privacy baseline: ${label}`, src('docs/privacy-baseline.md', anchor)];
  const neutrality = (anchor, label) => [`Neutrality: ${label}`, src('docs/neutrality.md', anchor)];
  const ops = (anchor, label) => [`Operations: ${label}`, src('docs/operations.md', anchor)];
  const scope = (anchor, label) => [`Audit scope${label ? `: ${label}` : ''}`, src('docs/audit/scope.md', anchor)];
  const adr3 = ['ADR-0003: why Crow uses this escrow', src('docs/decisions/ADR-0003-escrow-contract-base.md')];
  const policy = ['Security policy (SECURITY.md)', SECURITY_POLICY];
  return [
    {
      title: 'Where the money sits',
      blocks: [
        [[`When the buyer funds a deal, the payment goes straight into an escrow contract on Ethereum Sepolia, a public test network.`, [record, ['The escrow contract on Etherscan', etherscan(f.escrow)]]],
          [`The escrow is Coinbase’s Commerce Payments escrow, used without changes.`, [adr3]],
          [`The payment never passes through an account that Crow controls.`, null],
          [`Inside the escrow, the tokens sit in a token store that the escrow creates for Crow’s rules contract. Etherscan shows the balance there, not at the escrow’s own address.`, [['Coinbase’s escrow code at the pinned commit (getTokenStore)', CPP_ESCROW]]]],
        { lead: [`The payment hold opens in only five ways, all set by the deal’s terms:`, [neutrality('the-test', 'the test'), scope('in-scope', 'the rules contract'), ['The rules contract on Etherscan', etherscan(f.rules)]]],
          items: [
            'the reviewer signs a decision: accept pays the seller, and reject refunds the buyer;',
            'the buyer signs an early accept;',
            'both parties sign a settlement;',
            'the seller misses its delivery deadline, and the buyer gets a refund;',
            'no reviewer decides in time, and the default outcome applies, which on the live service refunds the buyer.',
          ] },
        [[`As a last backstop, if money is still held ${f.expiryMarginHours} hours after the deal’s last decision deadline, the buyer’s payment address can take it back directly from the escrow.`, [['The rules contract’s code (_escrowExpiry)', src('contracts/src/HoldbackRules.sol')]]]],
        [[`Anyone can trigger the late-delivery refund or the default outcome once it is due. Crow’s operators do it on their own and pay the gas themselves.`, [neutrality('control-point-analysis', 'who can do what'), limits]]],
        [[`The price only ever goes to the seller’s payout address or back to the buyer’s payment address. If the terms set a reviewer’s fee, the reviewer that decides is paid that fee from the hold when it decides.`, [neutrality('control-point-analysis', 'who can do what'), scope('the-phase-one-scope', 'the phase-one scope')]]],
        [[`The money is a test token called tUSDC. Anyone can mint it, it is worth nothing, and it is not Circle’s USDC. No real money can enter Crow today.`, [ops('sepolia-contracts-t-206', 'Sepolia contracts'), ['The tUSDC token on Etherscan', etherscan(f.token)], limits]]],
      ],
    },
    {
      title: 'Who can move the money, and who cannot',
      blocks: [
        [[`No one at Crow can move a held payment outside the deal’s terms. The contracts have no admin key, no pause switch and no way to upgrade them, and the key that deployed them only paid the gas.`, [ops('sepolia-contracts-t-206', 'Sepolia contracts'), ['The no-admin test (contracts/test/fuzz/NoAdmin.fuzz.t.sol)', src('contracts/test/fuzz/NoAdmin.fuzz.t.sol')]]]],
        [[`Crow’s operators pass the parties’ signed messages to the contracts and pay the gas. Their keys have no role in any contract. The rules contract checks every signature itself, so a message that was changed on the way fails.`, [neutrality('control-point-analysis', 'who can do what')]]],
        [[`Crow runs the reviewers on the live service, and a reviewer’s signed decision does move the payment: to the seller, or back to the buyer, as the terms say. The buyer and the seller name all three reviewers in the terms they sign, and each decision is final once it settles.`, [scope('the-phase-one-scope', 'the phase-one scope'), neutrality('residual-control-points', 'what remains'), limits]]],
        [[`If Crow’s operators refuse a deal or go offline, either party can send the same signed messages straight to the contracts, using its own Sepolia ETH. Today the two operators share one process, so most failures hit both.`, [neutrality('escape-hatch-requirements', 'the escape hatch'), limits]],
          [`Crow’s reviewers run in the same service. While it is down, a deal that named them ends at its deadlines with the default refund, unless the buyer accepts early or both parties sign a settlement.`, [ops('what-is-live', 'what is live'), neutrality('escape-hatch-requirements', 'the escape hatch')]]],
        [[`With a real stablecoin, the issuer could freeze its own token. No one at Crow can. Each deployment works with the one token it was deployed with.`, [neutrality('residual-control-points', 'what remains')]]],
      ],
    },
    {
      title: 'What Crow holds, and what it does not',
      blocks: [
        [[`Crow holds none of your company’s keys. Your agents sign with keys they keep, and the buyer’s tool creates each deal’s keys on your machine and never sends them anywhere.`, [['The buyer’s tool (examples/buyer-signer.ts)', src('examples/buyer-signer.ts')], ['The signing rule (CLAUDE.md, hard rules)', src('CLAUDE.md', 'hard-rules')]]]],
        [[`On the test service, Crow’s demo principal signs every agent’s mandate, the standing approval of what the agent may sign. So on the test service, the authority that stands for your company is a Crow key. When a company runs its own club, it signs its agents’ mandates itself.`, [baseline('level-public-the-only-level-the-live-service-judges', 'what each observer learns'), ['ADR-0038: where a mandate’s limits hold', src('docs/decisions/ADR-0038-mandate-limits-and-revocation.md')]]]],
        [[`Crow’s operators never write a message on a party’s behalf. Every step that changes a deal carries that party’s own signature, and anyone can check it.`, [neutrality('control-point-analysis', 'who can do what')]]],
        [[`Crow keeps its own secrets as Cloudflare Worker secrets, never in the code repository: the operators’ gas key on Sepolia, the model providers’ keys for the reviewers’ judges, and the test seller’s seed.`, [ops('secrets', 'secrets')]],
          [`The reviewers’ and the operators’ signing keys, which sign the decisions that move payments, work differently: they come from a random secret that the operators’ Durable Object keeps in its own storage.`, [['The keys’ code (apps/demo-cloud/src/world.ts)', src('apps/demo-cloud/src/world.ts')]]]],
        [[`The seller encrypts the work before sending it, for the first reviewer and the buyer. A backup reviewer gets the key only if it takes over. The reviewer opens the work to judge it, and the buyer opens it after paying. Crow runs the reviewers on the live service, so Crow can read the work in the deals it reviews.`, [baseline('what-the-encrypted-delivery-hides-and-what-it-does-not', 'what encryption hides'), neutrality('residual-control-points', 'what remains')]]],
      ],
    },
    {
      title: 'What a deal makes public',
      blocks: [
        [[`Every deal on the live service is public today. Anyone can read its terms: the scope, the checks, the price, the deadlines, the reviewers and every address.`, [baseline('the-answer', 'the answer')]]],
        [[`The work itself stays encrypted. Even so, anyone can see its exact size, when it arrived, and a fingerprint that confirms a guessed copy.`, [baseline('what-the-encrypted-delivery-hides-and-what-it-does-not', 'what encryption hides')]]],
        [[`If the terms include a rubric, two model providers read the work, and the judges’ public notes quote its findings. A deal judged by checks alone sends the work to no model provider.`, [baseline('what-a-design-partner-should-be-told-before-its-first-deal', 'what to tell a partner')]]],
        [[`The chain shows the amounts and the time of each step, and links each payment and payout address to the deal’s signing key. Use a fresh key and fresh addresses for each deal.`, [baseline('what-a-design-partner-should-be-told-before-its-first-deal', 'what to tell a partner')]]],
      ],
    },
    {
      title: 'What the operators keep, and for how long',
      blocks: [
        [[`The operators keep a request log with one line per request: its ID, the time, the node, the method, the route, the status and how long it took. The log never holds a request body, a header, an IP address or a path. Each line is deleted after ${f.requestLogDays} days.`, [ops('telemetry-t-031', 'telemetry'), ['The request log’s code (apps/demo-cloud/src/telemetry.ts)', src('apps/demo-cloud/src/telemetry.ts')]]]],
        [[`They also write hourly and daily summaries (counts, timings and the deal funnel, with no addresses in them) and error lines to Cloudflare’s Workers Logs, which keeps them for 7 days. Request headers are not logged.`, [ops('telemetry-t-031', 'telemetry')]]],
        [[`The operators see each caller’s IP address while they pass on its request, but they do not write it to the request log.`, [ops('telemetry-t-031', 'telemetry'), baseline('leaks-no-choice-closes-today-most-serious-first', 'leaks no choice closes')]]],
        [[`The live operators do not accept problem reports yet. Their report route, <code>POST /v1/feedback</code>, is switched off, so they keep no reports.`, [ops('feedback-triage-t-032', 'feedback triage')]]],
        [[`Deal records (the terms, the events and the receipts) stay as long as the contracts they settle on are in use, and start over only when the contracts are deployed again. The chain keeps its part for good, so keep your own copy of the terms you sign.`, [limits]]],
        [[`The early-access sign-up keeps your email address, the time and the page you signed up from. It keeps no IP address and sets no cookie, and it has no deletion date yet.`, [['The sign-up service’s code (apps/early-access/worker.js)', src('apps/early-access/worker.js')]]]],
      ],
    },
    {
      title: 'What has been reviewed from outside, and what has not',
      blocks: [
        [[`Coinbase’s escrow contract, which holds the money, has had outside reviews. Cantina reviewed the whole contract in April 2025 and found one critical issue, which was fixed before release. In July 2026, Cantina reviewed its last code change, PR 90, at the exact commit Crow deploys, and found three informational issues. One later change, the renames in PR 71, has not been reviewed.`, [['Cross-check of the published audits', src('docs/reviews/2026-11-03-public-audit-crosscheck.md')], ['The pinned commit (contracts/lib/commerce-payments)', src('contracts/lib/commerce-payments/')], adr3]]],
        [[`Crow’s own rules contract, which decides when the escrow pays out, has not had an outside audit yet. Models from two AI families have reviewed it, and the scope an auditor would need is written up.`, [ops('sepolia-contracts-t-206', 'Sepolia contracts'), scope('', '')]]],
        [[`Crow also runs its own checks: unit, fuzz and invariant tests of the contracts, a TLA+ model of a deal’s states, and attack and neutrality scenarios for the judging and the operators.`, [['The contract tests (contracts/test)', src('contracts/test/')], ['The TLA+ model (formal)', src('formal/')], ['The scenarios (fixtures/scenarios)', src('fixtures/scenarios/')]]]],
        [[`Each contract’s source code is published on Sourcify. The deployment record names the commit and the compiler settings, so anyone can rebuild the bytecode and compare it.`, [ops('sepolia-contracts-t-206', 'Sepolia contracts'), record]]],
        [[`Not done yet: a penetration test, SOC 2, ISO 27001 or any other certification, and a bug bounty. A bug bounty sized to the funds at risk will start before any deployment with real money.`, [policy]]],
      ],
    },
    {
      title: 'How to report a problem',
      blocks: [
        [[`If you find a security problem, report it privately through GitHub’s private vulnerability reporting for Crow’s repository. Crow acknowledges each report within 3 business days and will not take legal action over research that follows the policy.`, [['Report a vulnerability on GitHub', SECURITY_CONTACT], policy, ['security.txt', 'https://crow.direct/.well-known/security.txt']]]],
        [[`For any other problem with a call or a guide, open an issue on Crow’s public repository. Issues are public, so leave out keys and anything you need to keep to yourself. The operators’ own report route is not switched on yet.`, [['Issues on GitHub', `${CODE_URL}/issues`], ops('feedback-triage-t-032', 'feedback triage')]]],
        [[`To see whether Crow is answering right now, open the status page. It checks each part when you open it.`, [['The status page', 'https://crow.direct/status']]]],
      ],
    },
  ];
}

/**
 * Footnotes: each source gets one number, in the order it is first cited. cite() returns the superscript for a
 * sentence; list() returns the Sources list, each entry linking its source and back to every place that cites it.
 */
export function footnotes() {
  const entries = [], byUrl = new Map();
  const cite = (list) => {
    if (!list || !list.length) return '';
    const links = list.map(([label, url]) => {
      if (!byUrl.has(url)) byUrl.set(url, entries.push({ label, url, refs: [] }));
      const n = byUrl.get(url), e = entries[n - 1], id = `ref-${n}-${e.refs.length + 1}`;
      e.refs.push(id);
      return `<a href="#src-${n}" id="${id}">${n}</a>`;
    });
    return `<sup class="fn">${links.join(', ')}</sup>`;
  };
  const list = () => `<h2 id="sources">Sources</h2>
<ol class="sources">
${entries.map((e, i) => `<li id="src-${i + 1}"><a href="${esc(e.url)}">${esc(e.label)}</a> ${e.refs.map((r, k) => `<a class="back" href="#${r}" aria-label="Back to citation ${k + 1} of source ${i + 1}">↩</a>`).join(' ')}</li>`).join('\n')}
</ol>`;
  return { cite, list };
}

/** One paragraph of [html, sources] sentences, each followed by its footnotes. */
const paragraph = (sentences, cite) => `<p class="claim">${sentences.map(([html, list]) => `${html}${cite(list)}`).join(' ')}</p>`;

/** The two pages' styles, served as pages.css: the kit's parts they use, then their own layout. */
export const PAGES_CSS = kitCss({ parts: ['bar', 'button', 'pill', 'head', 'table', 'notice', 'dialog', 'footer'] }) + `/* the trust and status pages (site/trust.mjs, T-421): light only, one column, the kit's tokens */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--page); color: var(--ink); font: var(--size-body)/1.55 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font: .9em var(--mono); }
.doc { max-width: 760px; margin: 0 auto; padding: 72px var(--gutter) 88px; }
/* the title and the lede wrap with no word alone on a line, at a reading measure (Rafa, 2026-11-14) */
.doc .ck-title { text-wrap: balance; }
.doc .ck-lede { max-width: 65ch; text-wrap: balance; }
.doc .ck-notice { margin-top: 32px; }
.doc .cta { margin: 20px 0 0; }
.doc h2 { margin: 56px 0 0; font-family: var(--display); font-size: var(--size-lede); line-height: 1.3; font-weight: var(--weight-bold); letter-spacing: -.01em; }
/* prose with footnotes: a superscript after each sourced sentence, the Sources list at the foot */
.claim, .ways { max-width: 68ch; margin: 16px 0 0; text-wrap: pretty; }
.ways { padding-left: 1.25em; }
.ways li { margin-top: 4px; }
.doc h2 + .claim { margin-top: 12px; }
sup.fn { font-size: .68em; line-height: 0; margin-left: 1px; color: var(--ink-3); white-space: nowrap; }
sup.fn a { color: var(--ink-2); text-decoration: none; }
sup.fn a:hover { text-decoration: underline; }
.sources { margin: 16px 0 0; padding-left: 1.6em; font-size: var(--size-note); color: var(--ink-2); }
.sources li { margin-top: 6px; overflow-wrap: anywhere; }
.sources a { color: var(--ink-2); text-underline-offset: 2px; }
.sources a.back { text-decoration: none; color: var(--ink-3); }
:target { scroll-margin-top: 24px; }
.note { display: block; font-size: var(--size-note); color: var(--ink-3); }
.checked { margin-top: 48px; font-size: var(--size-note); color: var(--ink-3); }
.status-table { margin-top: 32px; overflow-x: auto; }
.status-table td:nth-child(2), .status-table td.at { white-space: nowrap; }
.status-table .how { color: var(--ink-2); }
.again { margin-top: 20px; }
@media (max-width: 600px) {
  .doc { padding-top: 48px; }
  .status-table thead { display: none; }
  .status-table tr { display: block; padding: 12px 0; border-bottom: 1px solid var(--hair); }
  .status-table td { display: block; padding: 2px 0; border: 0; }
}
`;

/** The head both pages share. */
const head = ({ site, base, card }) => `<!doctype html>
<!-- For AI agents: Crow's guide for agents is ${site}llms.txt (plain text). -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(card.title)}</title>
${cardTags({ site, ...card })}
<link rel="canonical" href="${site}${card.path}">
<link rel="icon" type="image/svg+xml" href="${base}crow-mark.svg">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${base}llms.txt">
<link rel="stylesheet" href="${base}pages.css">
</head>
<body>
${headerBar({ home: base, links: [[`${base}demo/`, 'Demo'], [`${base}llms.txt`, 'Agent docs']] })}`;

/** The trust page, /trust. */
export function trustPage({ site = 'https://crow.direct/', base = '/', facts = trustFacts() } = {}) {
  const { cite, list } = footnotes();
  const sections = trustSections(facts);
  const comingSoon = notice({ title: 'Coming soon', text: 'An outside audit of Crow’s own contracts, a penetration test, a certification such as SOC 2 or ISO 27001, a bug bounty, and deals with real money. Today Crow runs on a test network, with test tokens only.' });
  const noticeCites = cite([['Security policy: status', `${SECURITY_POLICY}#status`], ['Audit scope', src('docs/audit/scope.md')]]);
  const body = sections.map((s) => `<h2>${esc(s.title)}</h2>
${s.blocks.map((b) => (Array.isArray(b) ? paragraph(b, cite) : `${paragraph([b.lead], cite)}
<ul class="ways">${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>`)).join('\n')}`).join('\n');
  return `${head({ site, base, card: CARDS.trust })}
<main class="doc">
${sectionHead({ eyebrow: 'Trust', title: 'How Crow handles money, keys and data', lede: 'Plain answers for your company’s security team, with sources at the end. Crow runs on the Sepolia test network, with test tokens only.' })}
${comingSoon.replace(/<\/p><\/div>$/, `${noticeCites}</p></div>`)}
<p class="cta">${button({ label: 'Request early access', href: `${base}#join-form`, attrs: 'data-join' })}</p>
${body}
<p class="checked">Each answer was checked against its source on ${TRUST_CHECKED}. The addresses and the retention periods come from the deployment record and the code each time the site is built.</p>
${list()}
</main>
${footerHtml({ base, current: 'trust' })}
<script>
${drawerScript()}
</script>
</body>
</html>
`;
}

/**
 * What the status page checks, in order. `how` says who reads what. The site, the test seller and Blockscout send
 * access-control-allow-origin: *, so the reader's browser reads them itself; the operators send no CORS header, so the
 * site Worker reads them (apps/site/status.js) and the browser reads its answer.
 */
export const STATUS_CHECKS = [
  { id: 'site', name: 'The site, crow.direct', how: 'Your browser reads <code>/version.json</code>.' },
  { id: 'op1', name: 'Operator 1, api.crow.direct', how: 'The site’s Worker reads <code>/.well-known/holdback.json</code> and passes the answer on.' },
  { id: 'op2', name: 'Operator 2, api2.crow.direct', how: 'The same, on operator 2.' },
  { id: 'seller', name: 'Crow’s test seller', how: 'Your browser reads <code>/agents/test-seller/health</code>.' },
  { id: 'network', name: 'Ethereum Sepolia, where deals settle', how: 'Your browser reads the newest blocks from Blockscout, a public explorer.' },
];
/** Every address the status page's script reads: public endpoints only, and nothing from the private console. */
export const STATUS_SOURCES = ['/version.json', '/status/operators.json', '/agents/test-seller/health', 'https://eth-sepolia.blockscout.com/api/v2/main-page/blocks'];
/** Sepolia makes a block about every 12 s; a newest block older than this reads Degraded. */
export const NETWORK_STALE_SEC = 120;

/** The status page's script: one round of checks on load and on "Check again". No storage, no history. */
const STATUS_JS = `(function () {
  var rows = {};
  document.querySelectorAll('[data-check]').forEach(function (tr) { rows[tr.getAttribute('data-check')] = tr; });
  var hhmmss = function (d) { return d.toISOString().slice(11, 19) + ' UTC'; };
  var show = function (id, state, note, at) {
    var tr = rows[id]; if (!tr) return;
    var pill = tr.querySelector('.ck-pill');
    pill.textContent = state;
    pill.className = 'ck-pill' + (state === 'Down' || state === 'Degraded' ? ' ck-pill-warn' : '');
    tr.querySelector('.note').textContent = note;
    tr.querySelector('.at').textContent = at ? hhmmss(at) : '';
  };
  var timed = function (url) {
    var t0 = Date.now(), ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var stop = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(stop);
      return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b, ms: Date.now() - t0 }; }, function () { return { ok: false, status: r.status, body: null, ms: Date.now() - t0 }; });
    }, function () { clearTimeout(stop); return { ok: false, status: 0, body: null, ms: Date.now() - t0 }; });
  };
  var answered = function (a) { return a.status === 0 ? 'no answer' : 'HTTP ' + a.status; };
  function run() {
    Object.keys(rows).forEach(function (id) { show(id, 'Checking', '', null); });
    timed('${STATUS_SOURCES[0]}').then(function (a) {
      var up = a.ok && a.body && a.body.worker === 'crow-site';
      show('site', up ? 'Operational' : 'Down', up ? 'answered in ' + a.ms + ' ms' : a.ok ? 'answered, but not with the site’s version file' : answered(a), new Date());
    });
    timed('${STATUS_SOURCES[1]}').then(function (a) {
      var list = a.ok && a.body && a.body.operators ? a.body.operators : [];
      ['op1', 'op2'].forEach(function (id) {
        var o = list.filter(function (x) { return x.id === id; })[0];
        if (!o) { show(id, 'Unknown', 'the site’s Worker gave no answer (' + answered(a) + ')', new Date()); return; }
        show(id, o.state === 'operational' ? 'Operational' : 'Down', o.state === 'operational' ? 'answered in ' + o.ms + ' ms' : (o.reason || answered(o)), new Date(a.body.checkedAt));
      });
    });
    timed('${STATUS_SOURCES[2]}').then(function (a) {
      var up = a.ok && a.body && a.body.status === 'operational';
      show('seller', up ? 'Operational' : 'Down', a.ok && a.body ? 'reports ' + a.body.status + ', ' + a.ms + ' ms' : answered(a), new Date());
    });
    timed('${STATUS_SOURCES[3]}').then(function (a) {
      var b = a.ok && Array.isArray(a.body) && a.body[0] ? a.body[0] : null, t = b ? Date.parse(b.timestamp) : NaN;
      if (!b || isNaN(t)) { show('network', 'Unknown', 'Blockscout gave no block (' + answered(a) + ')', new Date()); return; }
      var age = Math.max(0, Math.round((Date.now() - t) / 1000));
      show('network', age <= ${NETWORK_STALE_SEC} ? 'Operational' : 'Degraded', 'newest block ' + b.height + ', ' + age + ' s ago', new Date());
    });
  }
  document.getElementById('again').addEventListener('click', run);
  run();
})();`;

/** The status page, /status. */
export function statusPage({ site = 'https://crow.direct/', base = '/' } = {}) {
  const { cite, list } = footnotes();
  const limits = ['Agent docs: honest limits (ref/limits.txt)', 'https://crow.direct/ref/limits.txt'];
  const code = ['This page’s code (site/trust.mjs)', src('site/trust.mjs')];
  return `${head({ site, base, card: CARDS.status })}
<main class="doc">
${sectionHead({ eyebrow: 'Status', title: 'Is Crow answering?', lede: 'This page checks each part of Crow when you open it and shows when each check ran. It keeps no history.' })}
<div class="status-table">
<table class="ck-table" aria-label="Status of each part of Crow">
<thead><tr><th scope="col">Part</th><th scope="col">State</th><th scope="col">Checked</th><th scope="col">How</th></tr></thead>
<tbody>
${STATUS_CHECKS.map((c) => `<tr data-check="${c.id}"><td>${esc(c.name)}<span class="note"></span></td><td><span class="ck-pill">Not checked</span></td><td class="at"></td><td class="how">${c.how}</td></tr>`).join('\n')}
</tbody>
</table>
</div>
<p class="again">${button({ label: 'Check again', variant: 'outlined', size: 'compact', attrs: 'id="again"' })}</p>
<noscript><p>This page checks with a script in your browser. Without it, read each source yourself: <a href="${base}version.json">the site</a>, <a href="https://api.crow.direct/.well-known/holdback.json">operator 1</a>, <a href="https://api2.crow.direct/.well-known/holdback.json">operator 2</a>, <a href="${base}agents/test-seller/health">the test seller</a>.</p></noscript>
<h2>What this page can tell you, and what it cannot</h2>
${paragraph([[`It tells you whether each part of Crow answers a plain request right now. Your browser checks the site, the test seller and Sepolia itself. For the two operators, the site’s Worker checks from Cloudflare’s network and passes the answer on.`, [['The relay’s code (apps/site/status.js)', src('apps/site/status.js')], code]]], cite)}
${paragraph([[`It cannot tell you whether a deal will go through: a part can answer and still fail a step of a deal. The test deal in the agent docs checks the whole path.`, [['Agent docs (llms.txt)', `${site}llms.txt`]]]], cite)}
${paragraph([[`The two operators are two Workers that share one process today, so most failures hit both.`, [limits]]], cite)}
${paragraph([[`The Sepolia row reads Blockscout, a public block explorer. If Blockscout does not answer, the row says Unknown, not Down. If the newest block is more than ${NETWORK_STALE_SEC} s old, the row says Degraded, because Sepolia normally makes a block about every 12 s.`, [['Blockscout for Sepolia', 'https://eth-sepolia.blockscout.com/']]]], cite)}
${paragraph([[`The page reads only public addresses, the same ones any agent can read. It stores nothing except the site Worker’s 15-second cache of the operators’ answer, and it sends no alerts.`, [code]]], cite)}
${list()}
</main>
${footerHtml({ base, current: 'status' })}
<script>
${STATUS_JS}
</script>
</body>
</html>
`;
}

/** /.well-known/security.txt (RFC 9116), with Expires SECURITY_TXT_DAYS after `now`. */
export function securityTxt(now = new Date(), site = 'https://crow.direct/') {
  const expires = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + SECURITY_TXT_DAYS));
  return [
    "# Crow's security contact (RFC 9116). Report a security problem privately through GitHub's private",
    '# vulnerability reporting; the policy says what to include and what to expect. Test network only, test tokens only.',
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${site}.well-known/security.txt`,
    `Policy: ${SECURITY_POLICY}`,
    '',
  ].join('\n');
}

/** RFC 9116's fields, parsed: each field name with its values, in order. Throws on a line that is not a field or a comment. */
export function parseSecurityTxt(text) {
  const fields = new Map();
  for (const [i, line] of text.split('\n').entries()) {
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([A-Za-z][A-Za-z-]*): (\S.*)$/.exec(line);
    if (!m) throw new Error(`security.txt line ${i + 1} is not "Field: value": ${line}`);
    fields.set(m[1], [...(fields.get(m[1]) ?? []), m[2]]);
  }
  return fields;
}
