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

/** The values the trust page states, each read from its source. */
export function trustFacts() {
  const record = JSON.parse(read('../contracts/deployments/sepolia.json'));
  const requestLogDays = /const RETENTION_MS = (\d+) \* DAY_MS;/.exec(read('../apps/demo-cloud/src/telemetry.ts'))?.[1];
  const feedbackDays = /export const RETENTION_DAYS = (\d+);/.exec(read('../apps/operator/src/feedback.ts'))?.[1];
  if (!requestLogDays || !feedbackDays) throw new Error('site/trust.mjs cannot read the retention from apps/demo-cloud/src/telemetry.ts or apps/operator/src/feedback.ts: their shape changed');
  if (record.chainId !== 11155111 || !/^0x[0-9a-fA-F]{40}$/.test(record.escrow ?? '') || !/^0x[0-9a-fA-F]{40}$/.test(record.rules ?? '')) throw new Error('contracts/deployments/sepolia.json names no Sepolia escrow and rules contract');
  return { escrow: record.escrow, rules: record.rules, token: record.token.address, requestLogDays: Number(requestLogDays), feedbackDays: Number(feedbackDays) };
}

/**
 * The trust page's sections: a heading, then statements, each with the links to its sources. A statement's text is
 * HTML written here (it may hold <code>); a source is [label, url].
 */
export function trustSections(f = trustFacts()) {
  const record = src('contracts/deployments/sepolia.json');
  const limits = ['The agent docs: limits', 'https://crow.direct/ref/limits.txt'];
  const baseline = (anchor) => ['The privacy baseline', src('docs/privacy-baseline.md', anchor)];
  const neutrality = (anchor) => ['Neutrality', src('docs/neutrality.md', anchor)];
  const ops = (anchor, label = 'Operations') => [label, src('docs/operations.md', anchor)];
  return [
    {
      title: 'Where the money sits',
      items: [
        [`From funding on, a deal’s payment sits in an escrow contract on Ethereum Sepolia, a public test network. It is Coinbase’s Commerce Payments escrow, used unchanged. No account of Crow’s sits between the buyer’s payment and the escrow.`,
          [['The deployment record', record], ['The escrow on Etherscan', etherscan(f.escrow)], ['Why this escrow (ADR-0003)', src('docs/decisions/ADR-0003-escrow-contract-base.md')]]],
        [`The payment hold opens only in one of five ways the deal’s terms set: the reviewer’s signed decision (accept pays the seller, reject refunds the buyer), the buyer’s signed early accept, a settlement both parties sign, a refund when the seller misses its delivery deadline, or the default outcome when no reviewer decides in time, which on the live service refunds the buyer.`,
          [neutrality('the-test'), ['The audit scope: the rules contract', src('docs/audit/scope.md', 'in-scope')], ['The rules contract on Etherscan', etherscan(f.rules)]]],
        [`Anyone may send the last two, the late-delivery refund and the default outcome, once they are due. Crow’s operators send them on their own, at their own gas.`,
          [neutrality('control-point-analysis'), limits]],
        [`The reviewer’s fee, when the terms set one, is paid from the hold at the decision, to the reviewer that decided. The price goes only to the seller’s payout address or back to the buyer’s payment address.`,
          [neutrality('control-point-analysis'), ['The audit scope', src('docs/audit/scope.md', 'the-phase-one-scope')]]],
        [`The money is a test token, tUSDC. Anyone can mint it, it is worth nothing, and it is not Circle’s USDC. No real money can enter.`,
          [ops('sepolia-contracts-t-206', 'Operations: Sepolia contracts'), ['The token on Etherscan', etherscan(f.token)], limits]],
      ],
    },
    {
      title: 'Who can move it, and who cannot',
      items: [
        [`No one at Crow can move a held payment outside the deal’s terms. The contracts have no admin key, no pause and no upgrade path, and the key that deployed them only paid the gas.`,
          [ops('sepolia-contracts-t-206', 'Operations: Sepolia contracts'), ['The no-admin test', src('contracts/test/fuzz/NoAdmin.fuzz.t.sol')]]],
        [`Crow’s operators relay the parties’ signed messages and pay the gas. Their keys have no role in any contract: the rules contract checks every signature itself, so a relayed step that changes a field fails.`,
          [neutrality('control-point-analysis')]],
        [`Crow runs the reviewers the live service offers. A reviewer’s signed decision does move the payment, to the seller or back to the buyer, as the terms say. The parties name all three reviewers in the terms they sign, and each decision is final when it settles.`,
          [['The audit scope: assumptions', src('docs/audit/scope.md', 'the-phase-one-scope')], neutrality('residual-control-points'), limits]],
        [`If Crow’s operators refuse or go offline, a party can send the same signed messages straight to the contracts, with Sepolia ETH of its own. The two operators run as one process today, so they go down together.`,
          [neutrality('control-point-analysis'), limits]],
        [`With a real stablecoin, its issuer could freeze its own token; no one at Crow can. Each deployment settles the one token it was deployed with.`,
          [neutrality('residual-control-points')]],
      ],
    },
    {
      title: 'What Crow holds, and what it does not',
      items: [
        [`Crow holds none of your company’s keys. Your agents sign with keys they keep: the buyer’s tool makes each deal’s keys on your machine and sends none of them anywhere.`,
          [['The buyer’s tool', src('examples/buyer-signer.ts')], ['The signing rule', src('CLAUDE.md', 'hard-rules')]]],
        [`Crow’s operators never write a party’s message. Every step that changes a deal carries the party’s own signature, which anyone can check.`,
          [neutrality('control-point-analysis')]],
        [`Crow keeps secrets of its own, as Cloudflare Worker secrets and never in the repository: the operators’ gas key on Sepolia, the model providers’ keys for the reviewers’ judges, and the test seller’s seed.`,
          [ops('secrets', 'Operations: secrets')]],
        [`The seller encrypts the work before it leaves, to the reviewers and the buyer. The reviewer opens it to judge it, and the buyer opens it once it has paid. Crow runs the live service’s reviewers, so Crow can read the work of the deals it reviews.`,
          [baseline('what-the-encrypted-delivery-hides-and-what-it-does-not')]],
      ],
    },
    {
      title: 'What a deal makes public',
      items: [
        [`Every deal on the live service is public today. Anyone can read its terms: the scope, the checks, the price, the deadlines, the reviewers and every address.`,
          [baseline('the-answer')]],
        [`The work stays encrypted, but anyone sees its exact size, when it arrived, and a fingerprint that confirms a guessed copy.`,
          [baseline('what-the-encrypted-delivery-hides-and-what-it-does-not')]],
        [`With a rubric, two model providers read the work, and the judges’ public notes quote its findings. A checks-only deal sends the work to no model provider.`,
          [baseline('what-a-design-partner-should-be-told-before-its-first-deal')]],
        [`The chain shows the amounts, the time of each step, and ties each payment and payout address to the deal’s signing key. Use a fresh key and fresh addresses for each deal.`,
          [baseline('what-a-design-partner-should-be-told-before-its-first-deal')]],
      ],
    },
    {
      title: 'What the operators keep, and for how long',
      items: [
        [`A request log: one line per request, with its ID, time, node, method, route, status and duration. It holds no body, no header, no IP address and no path. Each line is kept ${f.requestLogDays} days, then deleted.`,
          [ops('telemetry-t-031', 'Operations: telemetry'), ['The code', src('apps/demo-cloud/src/telemetry.ts')]]],
        [`Hourly and daily summary lines (counts, timings, the deal funnel), with no address in them, in Cloudflare’s Workers Logs, which keeps them 7 days. Request headers are not logged.`,
          [ops('telemetry-t-031', 'Operations: telemetry')]],
        [`The operators see each caller’s IP address while they relay. They do not write it to the request log.`,
          [ops('telemetry-t-031', 'Operations: telemetry'), baseline('leaks-no-choice-closes-today-most-serious-first')]],
        [`A problem report sent with <code>POST /v1/feedback</code> is kept ${f.feedbackDays} days in the operator’s own store. Sending one is your choice to share it.`,
          [['The agent docs: reporting a problem', 'https://crow.direct/ref/limits.txt'], ['The code', src('apps/operator/src/feedback.ts')]]],
        [`The deal records (terms, events, receipts) stay while the contracts they settle on are in use, and start over only when the contracts are deployed again. The chain keeps its part for good. Keep your own copy of the terms you sign.`,
          [limits]],
        [`An early-access sign-up keeps the email address, the time and the page, with no IP address and no cookie. No deletion date is set yet.`,
          [['The sign-up service', src('apps/early-access/worker.js')]]],
      ],
    },
    {
      title: 'What has been reviewed from outside, and what has not',
      items: [
        [`Coinbase’s escrow contract, which holds the money, has an outside review: Cantina reviewed it in July 2026, at the exact commit Crow deploys, with three informational findings.`,
          [['Why this escrow (ADR-0003)', src('docs/decisions/ADR-0003-escrow-contract-base.md')], ['The pinned commit', src('.gitmodules')]]],
        [`Crow’s own rules contract, which decides when the escrow pays, has no outside audit yet. Models from two families reviewed it, and the scope an auditor needs is written.`,
          [ops('sepolia-contracts-t-206', 'Operations: Sepolia contracts'), ['The audit scope', src('docs/audit/scope.md')]]],
        [`Crow’s own checks: unit, fuzz and invariant tests of the contracts, a TLA+ model of a deal’s states, and attack and neutrality scenarios for the judging and the operators.`,
          [['The contract tests', src('contracts/test/')], ['The TLA+ model', src('formal/')], ['The scenarios', src('fixtures/scenarios/')]]],
        [`Each contract’s source is published on Sourcify, and the deployment record names the commit and the compiler settings, so anyone can rebuild the bytecode and compare it.`,
          [ops('sepolia-contracts-t-206', 'Operations: Sepolia contracts'), ['The deployment record', record]]],
        [`Not yet: a penetration test, SOC 2, ISO 27001 or any other certification, and a bug bounty. A bounty sized to the funds at risk starts before any deployment with real money.`,
          [['The security policy', SECURITY_POLICY]]],
      ],
    },
    {
      title: 'How to report a problem',
      items: [
        [`A security problem: report it privately through GitHub’s private vulnerability reporting for Crow’s repository. Crow acknowledges a report within 3 business days and does not take legal action against research that follows the policy.`,
          [['Report a vulnerability', SECURITY_CONTACT], ['The security policy', SECURITY_POLICY], ['security.txt', 'https://crow.direct/.well-known/security.txt']]],
        [`Any other problem with a call or a guide: send <code>POST /v1/feedback</code> to an operator, as the agent docs describe.`,
          [['The agent docs: reporting a problem', 'https://crow.direct/ref/limits.txt']]],
        [`Whether Crow answers right now: the status page checks each part when you open it.`,
          [['The status page', 'https://crow.direct/status']]],
      ],
    },
  ];
}

/** The two pages' styles, served as pages.css: the kit's parts they use, then their own layout. */
export const PAGES_CSS = kitCss({ parts: ['bar', 'button', 'pill', 'head', 'table', 'notice', 'footer'] }) + `/* the trust and status pages (site/trust.mjs, T-421): light only, one column, the kit's tokens */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--page); color: var(--ink); font: var(--size-body)/1.55 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font: .9em var(--mono); }
.doc { max-width: 760px; margin: 0 auto; padding: 72px var(--gutter) 88px; }
.doc .ck-notice { margin-top: 32px; }
.doc .ck-notice + .src { margin-top: 8px; }
.doc h2 { margin: 56px 0 0; font-family: var(--display); font-size: var(--size-lede); line-height: 1.3; font-weight: var(--weight-bold); letter-spacing: -.01em; }
.claims { margin: 16px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--hair); }
.claims li { padding: 16px 0; border-bottom: 1px solid var(--hair); }
.claims p { margin: 0; }
.src { margin: 6px 0 0; font-size: var(--size-note); color: var(--ink-3); }
.src a { color: var(--ink-2); text-underline-offset: 2px; }
.src a + a::before { content: "\\00b7"; display: inline-block; margin: 0 8px; color: var(--ink-3); }
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

const sources = (list) => `<p class="src">Source: ${list.map(([label, url]) => `<a href="${esc(url)}">${esc(label)}</a>`).join('')}</p>`;

/** The trust page, /trust. */
export function trustPage({ site = 'https://crow.direct/', base = '/', facts = trustFacts() } = {}) {
  const sections = trustSections(facts);
  return `${head({ site, base, card: CARDS.trust })}
<main class="doc">
${sectionHead({ eyebrow: 'Trust', title: 'How Crow handles money, keys and data', lede: 'Plain answers for your company’s security team, each with its source. Crow runs on the Sepolia test network, with test tokens only.' })}
${notice({ title: 'Not there yet', text: 'No outside audit of Crow’s own contracts, no certification such as SOC 2 or ISO 27001, no penetration test and no bug bounty. Crow runs on a test network only.' })}
${sources([['The security policy: status', `${SECURITY_POLICY}#status`], ['The audit scope', src('docs/audit/scope.md')]])}
${sections.map((s) => `<h2>${esc(s.title)}</h2>
<ul class="claims">
${s.items.map(([text, list]) => `<li><p>${text}</p>${sources(list)}</li>`).join('\n')}
</ul>`).join('\n')}
<p class="checked">Each line was checked against its source on ${TRUST_CHECKED}. The addresses and the retention periods are read from the deployment record and the code each time the site is built.</p>
</main>
${footerHtml({ base, current: 'trust' })}
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
  const limits = 'https://crow.direct/ref/limits.txt';
  return `${head({ site, base, card: CARDS.status })}
<main class="doc">
${sectionHead({ eyebrow: 'Status', title: 'Is Crow answering?', lede: 'This page checks each part of Crow when you open it, with one plain GET, and shows the time of each check. It keeps no history.' })}
<div class="status-table">
<table class="ck-table" aria-label="Status of each part of Crow">
<thead><tr><th scope="col">Part</th><th scope="col">State</th><th scope="col">Checked</th><th scope="col">How</th></tr></thead>
<tbody>
${STATUS_CHECKS.map((c) => `<tr data-check="${c.id}"><td>${esc(c.name)}<br><span class="note src"></span></td><td><span class="ck-pill">Not checked</span></td><td class="at"></td><td class="how">${c.how}</td></tr>`).join('\n')}
</tbody>
</table>
</div>
<p class="again">${button({ label: 'Check again', variant: 'outlined', size: 'compact', attrs: 'id="again"' })}</p>
<noscript><p>This page checks with a script in your browser. Without it, read each source yourself: <a href="${base}version.json">the site</a>, <a href="https://api.crow.direct/.well-known/holdback.json">operator 1</a>, <a href="https://api2.crow.direct/.well-known/holdback.json">operator 2</a>, <a href="${base}agents/test-seller/health">the test seller</a>.</p></noscript>
<h2>What this page can tell you, and what it cannot</h2>
<ul class="claims">
<li><p>It tells you whether each part answers a plain GET right now: from your browser, or for the two operators from Cloudflare’s network, through the site’s Worker.</p>${sources([['The relay’s code', src('apps/site/status.js')], ['This page’s code', src('site/trust.mjs')]])}</li>
<li><p>It cannot tell you whether a deal will go through. A part can answer a GET and still fail a step of a deal. The test deal in the agent docs checks the whole path.</p>${sources([['The agent docs', `${site}llms.txt`]])}</li>
<li><p>The two operators run as one process today, so they answer or fail together.</p>${sources([['The agent docs: limits', limits]])}</li>
<li><p>The Sepolia row reads Blockscout, a public explorer. When Blockscout does not answer, the row says Unknown, not Down. A newest block older than ${NETWORK_STALE_SEC} s reads Degraded: Sepolia makes a block about every 12 s.</p>${sources([['Blockscout for Sepolia', 'https://eth-sepolia.blockscout.com/']])}</li>
<li><p>It reads only public endpoints, the same ones any agent can read. It keeps nothing but the site Worker’s 15 s cache of the operators’ answer, and it sends no alerts.</p>${sources([['This page’s code', src('site/trust.mjs')]])}</li>
</ul>
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
