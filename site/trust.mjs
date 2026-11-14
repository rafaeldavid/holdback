// The site's trust surfaces (T-421): the trust page (/trust), the status page (/status), their one stylesheet
// (/pages.css) and the security contact (/.well-known/security.txt, RFC 9116). site/build.mjs writes them; site/check.mjs
// checks them (group 16).
//
// Both pages are FAQs for an agent reader (Rafa, 2026-11-14), with plain-text and JSON copies built from the same data:
// /trust.txt and /status.json. Every answer ends with a Source line of full links. Values that live elsewhere are read
// from there at build time, never copied by hand: the contract addresses and the chain from the deployment record, the
// request log's retention from the operators' code. A redeploy or a changed retention changes the pages at the next
// build, and site/check.mjs fails until the committed pages are rebuilt.
//
// The words are the guides' ("principal", "adjudicator", "hold", "operator", "deal"), each glossed once, and none of the
// calming claims crow-private strategy/2026-11-14-crow-ontology.md refuses (site/check.mjs lists them).
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
  return { chainId: record.chainId, escrow: record.escrow, rules: record.rules, token: record.token.address, requestLogDays: Number(requestLogDays), expiryMarginHours: record.expiryMarginSec / 3600 };
}

/**
 * The trust page as an FAQ for an agent reader doing due diligence for its principal (Rafa, 2026-11-14): one literal
 * question per heading, the answer first ("No.", "Yes."), then the rule, what enforces it and any number with its unit,
 * then a Source line with full links. Each answer stands alone: it names things again instead of pointing back. The
 * guides' words are used ("principal", "adjudicator", "hold", "operator"), each glossed once in plain words.
 *
 * A group is a short label and its questions. A question is { id, q, a, list?, sources }: `a` is HTML sentences, `list`
 * an optional list after them, and a source is [label, url], the label a file path and section where it is a file.
 */
export function trustFaq(f = trustFacts()) {
  const file = (path, section, anchor) => [section ? `${path}, “${section}”` : path, src(path, anchor)];
  const record = file('contracts/deployments/sepolia.json');
  const limits = ['crow.direct/ref/limits.txt, “Honest limits”', 'https://crow.direct/ref/limits.txt'];
  const neutralityTest = file('docs/neutrality.md', 'The test', 'the-test');
  const controls = file('docs/neutrality.md', 'Control-point analysis', 'control-point-analysis');
  const residual = file('docs/neutrality.md', 'Residual control points', 'residual-control-points');
  const hatch = file('docs/neutrality.md', 'Escape hatch requirements', 'escape-hatch-requirements');
  const sepolia = file('docs/operations.md', 'Sepolia contracts (T-206)', 'sepolia-contracts-t-206');
  const telemetry = file('docs/operations.md', 'Telemetry (T-031)', 'telemetry-t-031');
  const feedback = file('docs/operations.md', 'Feedback triage (T-032)', 'feedback-triage-t-032');
  const phaseOne = file('docs/audit/scope.md', 'The phase-one scope', 'the-phase-one-scope');
  const adr3 = file('docs/decisions/ADR-0003-escrow-contract-base.md');
  const encryption = file('docs/privacy-baseline.md', 'What the encrypted delivery hides, and what it does not', 'what-the-encrypted-delivery-hides-and-what-it-does-not');
  const partner = file('docs/privacy-baseline.md', 'What a design partner should be told before its first deal', 'what-a-design-partner-should-be-told-before-its-first-deal');
  const policy = ['SECURITY.md', SECURITY_POLICY];
  return [
    { group: 'Money', questions: [
      { id: 'does-crow-hold-funds', q: 'Does Crow hold the funds of a deal?',
        a: `No. When the buyer funds a deal, the payment goes straight into Coinbase’s Commerce Payments escrow contract on Ethereum Sepolia, used without changes. The payment never passes through an account that Crow controls.`,
        sources: [record, ['The escrow contract on Etherscan', etherscan(f.escrow)], adr3] },
      { id: 'which-contract-holds-funds', q: 'Which contract holds the funds?',
        a: `Coinbase’s Commerce Payments escrow contract (AuthCaptureEscrow) on Ethereum Sepolia, chain ${f.chainId}. The escrow keeps the tokens in a separate token store contract that it creates for Crow’s rules contract (HoldbackRules), so Etherscan shows the balance at the token store, not at the escrow’s own address. The deployment record lists the escrow, the rules contract and the token; the token store’s address is <code>getTokenStore</code> of the rules contract, read on the escrow.`,
        sources: [record, ['The escrow contract on Etherscan', etherscan(f.escrow)], ['Coinbase’s escrow code at the pinned commit, getTokenStore', CPP_ESCROW]] },
      { id: 'when-is-the-hold-released', q: 'When is the hold released or refunded?',
        a: `In five ways set by the deal’s signed terms, plus one backstop. The rules contract enforces the five. The hold is the buyer’s payment, locked in escrow until the deal settles. The hold opens when:`,
        list: [
          'the adjudicator (the reviewer both parties name in the terms) signs a decision: accept pays the seller, and reject refunds the buyer;',
          'the buyer signs an early accept;',
          'both parties sign a settlement;',
          'the seller misses its delivery deadline, which refunds the buyer;',
          'no adjudicator decides in time, and the default outcome applies, which on the live service refunds the buyer.',
        ],
        after: `The backstop: if funds are still held ${f.expiryMarginHours} hours after the deal’s last decision deadline, the buyer’s payment address can take them back directly from the escrow.`,
        sources: [neutralityTest, file('docs/audit/scope.md', 'In scope', 'in-scope'), ['The rules contract on Etherscan', etherscan(f.rules)], file('contracts/src/HoldbackRules.sol', '_escrowExpiry')] },
      { id: 'funds-held-after-deadlines', q: 'What happens to funds still held after every deadline?',
        a: `The buyer’s payment address can take them back directly from the escrow, starting ${f.expiryMarginHours} hours after the deal’s last decision deadline. Coinbase’s escrow contract enforces this backstop.`,
        sources: [file('contracts/src/HoldbackRules.sol', '_escrowExpiry')] },
      { id: 'who-triggers-refunds', q: 'Who can trigger a refund after a missed deadline?',
        a: `Anyone. Once the late-delivery refund or the default outcome is due, anyone can send it to the rules contract. Crow’s operators (the servers that relay the parties’ signed messages and serve Crow’s API) send these on their own and pay the gas.`,
        sources: [controls, limits] },
      { id: 'who-receives-money', q: 'Which addresses can receive money from the hold?',
        a: `Only three. The price goes to the seller’s payout address or back to the buyer’s payment address. The adjudicator that decides receives its fee from the hold at the decision, if the terms set one. The rules contract pays no other address.`,
        sources: [controls, phaseOne] },
      { id: 'can-an-operator-move-funds', q: 'Can an operator move held funds?',
        a: `No. An operator’s relayer keys, which pay the gas for relayed messages, have no role in any contract. The rules contract checks every signature itself, so a relayed message that was changed fails. On the live service, Crow’s adjudicators run in the same service as Crow’s operators, and an adjudicator’s signed decision does move held funds within the deal’s terms.`,
        sources: [controls, file('docs/operations.md', 'What is live', 'what-is-live')] },
      { id: 'can-crow-move-funds', q: 'Can Crow move held funds outside a deal’s terms?',
        a: `No. No one at Crow can move a held payment outside the deal’s terms. On the live service Crow runs the adjudicators, whose signed decisions pay the seller or refund the buyer as the terms say.`,
        sources: [controls, phaseOne] },
      { id: 'can-crow-change-contracts', q: 'Can Crow pause or upgrade the contracts?',
        a: `No. The contracts have no admin key, no pause and no upgrade path, and the key that deployed them only paid the gas.`,
        sources: [sepolia, file('contracts/test/fuzz/NoAdmin.fuzz.t.sol')] },
      { id: 'can-an-adjudicator-move-funds', q: 'Can an adjudicator move held funds?',
        a: `Yes, within the deal’s terms. The adjudicator’s signed decision pays the seller or refunds the buyer, as the terms say, and each decision is final once it settles. Crow runs the adjudicators on the live service, and the buyer and the seller name all three adjudicators in the terms they sign.`,
        sources: [phaseOne, residual, limits] },
      { id: 'can-the-token-be-frozen', q: 'Can a token issuer freeze held funds?',
        a: `Yes, with a real stablecoin: its issuer could freeze its own token. No one at Crow can. Each deployment settles in the one token it was deployed with.`,
        sources: [residual] },
      { id: 'is-real-money-involved', q: 'Is real money involved?',
        a: `No. Crow runs on Ethereum Sepolia, a public test network, with tUSDC, a test token that anyone can mint, that is worth nothing and that is not Circle’s USDC. No real money can enter Crow today.`,
        sources: [sepolia, ['The tUSDC token on Etherscan', etherscan(f.token)], limits] },
      { id: 'if-operators-go-offline', q: 'What happens if Crow’s operators refuse a deal or go offline?',
        a: `Either party can send the same signed messages straight to the contracts, using its own Sepolia ETH. The two operators share one process today, so most failures hit both. Crow’s adjudicators run in the same service: while it is down, a deal that named them ends at its deadlines with the default refund, unless the buyer accepts early or both parties sign a settlement.`,
        sources: [hatch, file('docs/operations.md', 'What is live', 'what-is-live'), limits] },
    ] },
    { group: 'Keys', questions: [
      { id: 'does-crow-hold-keys', q: 'Does Crow hold my keys?',
        a: `No. Agents sign with keys they keep. The buyer’s tool, <code>examples/buyer-signer.ts</code>, creates each deal’s keys on the buyer’s machine and never sends them anywhere.`,
        sources: [file('examples/buyer-signer.ts'), file('CLAUDE.md', 'Hard rules', 'hard-rules')] },
      { id: 'who-can-sign-for-my-address', q: 'Who can sign for my address?',
        a: `Only a valid signature for that address: a signature from the address’s key or, for a contract account, one that the contract accepts (ERC-1271). Every step that changes a deal carries the party’s own signature, which anyone can check, and Crow’s operators never write a message on a party’s behalf.`,
        sources: [controls, phaseOne, file('contracts/src/HoldbackRules.sol', '_requireSigned')] },
      { id: 'who-signs-mandates', q: 'Who signs an agent’s mandate on the test service?',
        a: `Crow’s demo principal. A mandate is the standing approval of what an agent may sign; the principal is the company or person the agent acts for. On the test service, Crow’s demo principal signs every agent’s mandate, so the authority standing for your company there is a Crow key. A company that runs its own club signs its agents’ mandates itself.`,
        sources: [file('docs/privacy-baseline.md', 'Level public', 'level-public-the-only-level-the-live-service-judges'), file('docs/decisions/ADR-0038-mandate-limits-and-revocation.md')] },
      { id: 'what-secrets-crow-keeps', q: 'What secrets does Crow keep?',
        a: `Cloudflare Worker secrets, never stored in the code repository: the operators’ gas key on Sepolia, the model providers’ keys for the adjudicators’ judges, and the test seller’s seed. The adjudicators’ and the operators’ signing keys, which sign the decisions that move payments, come from a random secret that the operators’ Durable Object keeps in its own storage. The key that deployed the contracts sits in an encrypted keystore outside the repository and only pays gas.`,
        sources: [file('docs/operations.md', 'Secrets', 'secrets'), file('apps/demo-cloud/src/world.ts'), sepolia] },
    ] },
    { group: 'Data', questions: [
      { id: 'is-a-deal-public', q: 'Is a deal’s data public?',
        a: `Yes. Every deal on the live service is public today: anyone can read its terms, including the scope, the checks, the price, the deadlines, the adjudicators and every address. The chain shows the amounts and the time of each step, and links each payment and payout address to the deal’s signing key. The delivered work stays encrypted. Use a fresh key and fresh addresses for each deal.`,
        sources: [file('docs/privacy-baseline.md', 'The answer', 'the-answer'), partner, encryption] },
      { id: 'who-can-read-the-work', q: 'Who can read the delivered work?',
        a: `The first adjudicator and the buyer. The seller encrypts the work for those two before sending it. A backup adjudicator gets the key only if it takes over, and the buyer opens the work after paying. Crow runs the adjudicators on the live service, so Crow can read the work in the deals it judges. If the terms include a rubric, two model providers also read the work.`,
        sources: [encryption, residual, partner] },
      { id: 'what-the-work-reveals', q: 'What can anyone learn about the delivered work?',
        a: `Its exact size, when it arrived, and a fingerprint that confirms a guessed copy; the work itself stays encrypted. If the terms include a rubric, two model providers read the work and the judges’ public notes quote its findings. A deal judged by checks alone sends the work to no model provider.`,
        sources: [encryption, partner] },
      { id: 'what-an-operator-logs', q: 'What does an operator log for each request?',
        a: `One line in a request log: the request’s ID, the time, the node, the method, the route, the status and the duration. The line holds no body, no header, no IP address and no path, and the operator deletes it after ${f.requestLogDays} days. The operators see each caller’s IP address while relaying, but do not write it to the request log.`,
        sources: [telemetry, file('apps/demo-cloud/src/telemetry.ts'), file('docs/privacy-baseline.md', 'Leaks no choice closes today', 'leaks-no-choice-closes-today-most-serious-first')] },
      { id: 'what-goes-to-cloudflare-logs', q: 'What goes to Cloudflare’s logs?',
        a: `Hourly and daily summaries (counts, timings and the deal funnel, with no addresses) and error lines, in Cloudflare’s Workers Logs, which keeps them for 7 days. Request headers are not logged.`,
        sources: [telemetry] },
      { id: 'how-long-deal-records-stay', q: 'How long does an operator keep a deal’s records?',
        a: `As long as the contracts the deal settles on are in use. The terms, the events and the receipts start over only when the contracts are deployed again, and the chain keeps its part for good. Keep your own copy of the terms you sign.`,
        sources: [limits] },
      { id: 'are-problem-reports-stored', q: 'Does an operator store problem reports?',
        a: `No. The live operators’ report route, <code>POST /v1/feedback</code>, is switched off, so the operators keep no problem reports.`,
        sources: [feedback] },
      { id: 'what-early-access-stores', q: 'What does the early-access sign-up store?',
        a: `The email address, the time and the page the sign-up came from, with no IP address and no cookie. The sign-up has no deletion date yet.`,
        sources: [file('apps/early-access/worker.js')] },
    ] },
    { group: 'Outside review', questions: [
      { id: 'escrow-external-review', q: 'Has Coinbase’s escrow contract had an external review?',
        a: `Yes. Cantina reviewed the escrow contract twice in April 2025 and found one critical issue, which was fixed before release. In July 2026, Cantina reviewed the contract’s last code change, PR 90, at the exact commit Crow deploys, and found three informational issues. One later change, the renames in PR 71, has no review.`,
        sources: [file('docs/reviews/2026-11-03-public-audit-crosscheck.md'), file('contracts/lib/commerce-payments/'), adr3] },
      { id: 'rules-contract-audit', q: 'Has the rules contract had an external audit?',
        a: `No. Crow’s rules contract (HoldbackRules), which decides when the escrow pays out, has had no outside audit yet. Models from two AI families reviewed it, and the scope an auditor would need is written.`,
        sources: [sepolia, file('docs/audit/scope.md')] },
      { id: 'what-testing-crow-runs', q: 'What testing does Crow run?',
        a: `Unit, fuzz and invariant tests of the contracts, a TLA+ model of a deal’s states, and attack and neutrality scenarios for the judging and the operators.`,
        sources: [file('contracts/test/'), file('formal/'), file('fixtures/scenarios/')] },
      { id: 'can-i-check-the-bytecode', q: 'Can I check the deployed bytecode?',
        a: `Yes. Each contract’s source code is published on Sourcify, and the deployment record names the commit and the compiler settings, so anyone can rebuild the bytecode and compare it.`,
        sources: [sepolia, record] },
      { id: 'certifications', q: 'Does Crow hold a security certification?',
        a: `No. Crow holds no SOC 2, ISO 27001 or other certification yet.`,
        sources: [policy] },
      { id: 'penetration-test', q: 'Has Crow had a penetration test?',
        a: `No. Crow has had no penetration test yet.`,
        sources: [policy] },
      { id: 'bug-bounty', q: 'Does Crow run a bug bounty?',
        a: `No. Crow runs no bug bounty yet. A bug bounty sized to the funds at risk starts before any deployment with real money.`,
        sources: [policy] },
    ] },
    { group: 'Reporting a problem', questions: [
      { id: 'report-a-security-problem', q: 'Where do I report a security problem?',
        a: `Privately, through GitHub’s private vulnerability reporting for Crow’s repository. Crow acknowledges each report within 3 business days and takes no legal action over research that follows the security policy.`,
        sources: [['GitHub: report a vulnerability', SECURITY_CONTACT], policy, ['crow.direct/.well-known/security.txt', 'https://crow.direct/.well-known/security.txt']] },
      { id: 'report-another-problem', q: 'Where do I report any other problem?',
        a: `In a public issue on Crow’s GitHub repository. Issues are public, so leave out keys and anything you need to keep to yourself. The operators’ own report route, <code>POST /v1/feedback</code>, is not switched on yet.`,
        sources: [['GitHub: issues', `${CODE_URL}/issues`], feedback] },
      { id: 'is-crow-up', q: 'How do I check whether Crow is up?',
        a: `Open https://crow.direct/status. The status page checks each part of Crow when it is opened, and https://crow.direct/status.json lists what it checks.`,
        sources: [['crow.direct/status', 'https://crow.direct/status'], ['crow.direct/status.json', 'https://crow.direct/status.json']] },
    ] },
  ];
}

/** The page's notice: what is not there yet. */
const COMING_SOON = { title: 'Coming soon', text: 'An outside audit of Crow’s own contracts, a penetration test, a certification such as SOC 2 or ISO 27001, a bug bounty, and deals with real money. Today Crow runs on a test network, with test tokens only.' };
const comingSoonSources = () => [['SECURITY.md, “Status”', `${SECURITY_POLICY}#status`], ['docs/audit/scope.md', src('docs/audit/scope.md')]];

/** A Source line: each source's label linked to its full address. */
const sourceLine = (list) => `<p class="source">Source: ${list.map(([label, url]) => `<a href="${esc(url)}">${esc(label)}</a>`).join('; ')}</p>`;
/** HTML to plain text: tags out, entities and typographic quotes to ASCII. */
const plain = (html) => String(html).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
/** A list of the questions at the top, grouped, each linking its answer. */
const toc = (groups) => `<nav class="toc" aria-label="Questions">
${groups.map((g) => `<p class="toc-group">${esc(g.group)}</p>
<ul>${g.questions.map((x) => `<li><a href="#${x.id}">${esc(x.q)}</a></li>`).join('')}</ul>`).join('\n')}
</nav>`;
/** One answer: the question as a heading, the answer, an optional list, its Source line. */
const qaHtml = (x) => `<section class="qa" id="${x.id}">
<h3>${esc(x.q)}</h3>
<p>${x.a}</p>${x.list ? `\n<ul>${x.list.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}${x.after ? `\n<p>${x.after}</p>` : ''}
${sourceLine(x.sources)}
</section>`;
/** The header both pages share: the kit's header bar, its one button opening the early-access drawer. */
const header = (base) => headerBar({ home: base, links: [[`${base}demo/`, 'Demo'], [`${base}llms.txt`, 'Agent docs']], button: { label: 'Request early access', href: `${base}#join-form`, attrs: 'data-join' } });

/** The two pages' styles, served as pages.css: the kit's parts they use, then their own layout. */
export const PAGES_CSS = kitCss({ parts: ['bar', 'button', 'pill', 'head', 'table', 'notice', 'dialog', 'footer'] }) + `/* the trust and status pages (site/trust.mjs, T-421): light only, one column, the kit's tokens */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--page); color: var(--ink); font: var(--size-body)/1.55 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font: .9em var(--mono); overflow-wrap: anywhere; }
.ck-bar .ck-btn { white-space: nowrap; }
.doc { max-width: 760px; margin: 0 auto; padding: 72px var(--gutter) 88px; }
/* the title and the lede wrap with no word alone on a line, at a reading measure (Rafa, 2026-11-14) */
.doc .ck-title { text-wrap: balance; }
.doc .ck-lede { max-width: 65ch; text-wrap: balance; }
.doc .ck-notice { margin-top: 32px; }
.doc .ck-notice + .source { margin-top: 8px; }
.alt { margin: 20px 0 0; font-size: var(--size-small); color: var(--ink-2); }
.toc { margin-top: 40px; padding-top: 8px; border-top: 1px solid var(--hair); }
.toc-group { margin: 20px 0 6px; font-size: var(--size-note); font-weight: var(--weight-strong); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.toc ul { margin: 0; padding: 0; list-style: none; }
.toc li { margin: 4px 0; }
.toc a { text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.doc h2 { margin: 64px 0 0; padding-bottom: 8px; border-bottom: 1px solid var(--hair); font-size: var(--size-note); font-weight: var(--weight-strong); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.qa { padding: 24px 0 0; scroll-margin-top: 72px; }
.qa h3 { margin: 0; font-family: var(--display); font-size: var(--size-lede); line-height: 1.3; font-weight: var(--weight-bold); letter-spacing: -.01em; text-wrap: balance; }
.qa p, .qa ul { max-width: 68ch; margin: 8px 0 0; text-wrap: pretty; }
.qa ul { padding-left: 1.25em; }
.qa li { margin-top: 4px; }
.source { margin: 8px 0 0; font-size: var(--size-note); color: var(--ink-3); overflow-wrap: anywhere; }
.source a { color: var(--ink-2); text-underline-offset: 2px; }
.checked { margin-top: 48px; font-size: var(--size-note); color: var(--ink-3); }
.note { display: block; font-size: var(--size-note); color: var(--ink-3); }
.status-table { margin-top: 32px; overflow-x: auto; }
.status-table td:nth-child(2), .status-table td.at { white-space: nowrap; }
.status-table td.addr { font-size: var(--size-note); color: var(--ink-2); }
.again { margin-top: 20px; }
@media (max-width: 600px) {
  .doc { padding-top: 48px; }
  .status-table thead { display: none; }
  .status-table tr { display: block; padding: 12px 0; border-bottom: 1px solid var(--hair); }
  .status-table td { display: block; padding: 2px 0; border: 0; }
}
`;

/** The head both pages share, then the header. */
const head = ({ site, base, card, alternate }) => `<!doctype html>
<!-- For AI agents: this page's answers are in plain text at ${site}${alternate.path}. Crow's guide for agents is ${site}llms.txt. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(card.title)}</title>
${cardTags({ site, ...card })}
<link rel="canonical" href="${site}${card.path}">
<link rel="icon" type="image/svg+xml" href="${base}crow-mark.svg">
<link rel="alternate" type="${alternate.type}" title="${esc(alternate.title)}" href="${base}${alternate.path}">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${base}llms.txt">
<link rel="stylesheet" href="${base}pages.css">
</head>
<body>
${header(base)}`;

/** The trust page, /trust. */
export function trustPage({ site = 'https://crow.direct/', base = '/', facts = trustFacts() } = {}) {
  const groups = trustFaq(facts);
  return `${head({ site, base, card: CARDS.trust, alternate: { type: 'text/plain', title: 'These answers in plain text (trust.txt)', path: 'trust.txt' } })}
<main class="doc">
${sectionHead({ eyebrow: 'Trust', title: 'How Crow handles money, keys and data', lede: 'Due-diligence answers about Crow, for an agent or for your company’s security team. Each answer stands alone and ends with its source.' })}
${notice(COMING_SOON)}
${sourceLine(comingSoonSources())}
<p class="alt">The same answers in plain text: <a href="${base}trust.txt">${esc(site)}trust.txt</a></p>
${toc(groups)}
${groups.map((g) => `<h2>${esc(g.group)}</h2>\n${g.questions.map(qaHtml).join('\n')}`).join('\n')}
<p class="checked">Each answer was checked against its source on ${TRUST_CHECKED}. The addresses, the chain and the request log’s retention come from the deployment record and the code each time the site is built.</p>
</main>
${footerHtml({ base, current: 'trust' })}
<script>
${drawerScript()}
</script>
</body>
</html>
`;
}

/** /trust.txt: the trust page's questions and answers in plain text, from the same data. */
export function trustText({ site = 'https://crow.direct/', facts = trustFacts() } = {}) {
  const src_ = (list) => `Source: ${list.map(([label, url]) => `${plain(label)}, ${url}`).join('; ')}`;
  const groups = trustFaq(facts);
  return [
    '# Crow trust: questions and answers',
    '',
    `> Due-diligence answers about Crow for an agent or a security team. Each answer stands alone and ends with its source. The same answers as a page: ${site}trust. Checked against the sources on ${TRUST_CHECKED}.`,
    '',
    `${COMING_SOON.title}: ${plain(COMING_SOON.text)}`,
    src_(comingSoonSources()),
    '',
    ...groups.flatMap((g) => [`## ${g.group}`, '', ...g.questions.flatMap((x) => [`### ${plain(x.q)}`, '', plain(x.a), ...(x.list ? x.list.map((i) => `- ${plain(i)}`) : []), ...(x.after ? [plain(x.after)] : []), src_(x.sources), ''])]),
  ].join('\n');
}

/** Every address the status page's script reads: public endpoints only, and nothing from the private console. */
export const STATUS_SOURCES = ['/version.json', '/status/operators.json', '/agents/test-seller/health', 'https://eth-sepolia.blockscout.com/api/v2/main-page/blocks'];
/** Sepolia makes a block about every 12 s; a newest block older than this reads Degraded. */
export const NETWORK_STALE_SEC = 120;

/**
 * What the status page checks, in order: each service, the address checked, who reads it, and when it reads
 * Operational. The site, the test seller and Blockscout send access-control-allow-origin: *, so the reader's browser
 * reads them itself; the operators send no CORS header, so the site Worker reads them (apps/site/status.js) and the
 * browser reads its answer at /status/operators.json.
 */
export const STATUS_CHECKS = [
  { id: 'site', name: 'The site, crow.direct', address: 'https://crow.direct/version.json', checkedBy: 'browser', operationalWhen: 'it answers 200 with the site’s version file' },
  { id: 'op1', name: 'Operator 1, api.crow.direct', address: 'https://api.crow.direct/.well-known/holdback.json', checkedBy: 'site Worker', via: 'https://crow.direct/status/operators.json', operationalWhen: 'it answers 200 with its discovery document' },
  { id: 'op2', name: 'Operator 2, api2.crow.direct', address: 'https://api2.crow.direct/.well-known/holdback.json', checkedBy: 'site Worker', via: 'https://crow.direct/status/operators.json', operationalWhen: 'it answers 200 with its discovery document' },
  { id: 'seller', name: 'Crow’s test seller', address: 'https://crow.direct/agents/test-seller/health', checkedBy: 'browser', operationalWhen: 'it reports status “operational”' },
  { id: 'network', name: 'Ethereum Sepolia, where deals settle', address: 'https://eth-sepolia.blockscout.com/api/v2/main-page/blocks', checkedBy: 'browser', operationalWhen: `Blockscout’s newest block is at most ${NETWORK_STALE_SEC} s old` },
];

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

/** The status page's questions, written like the trust page's: literal, the answer first, each standing alone. */
export function statusFaq({ site = 'https://crow.direct/' } = {}) {
  const code = ['site/trust.mjs', src('site/trust.mjs')];
  const relay = ['apps/site/status.js', src('apps/site/status.js')];
  const limits = ['crow.direct/ref/limits.txt, “Honest limits”', 'https://crow.direct/ref/limits.txt'];
  return [
    { group: 'About these checks', questions: [
      { id: 'which-services', q: 'Which services does the status page check?',
        a: `Five: the site (crow.direct), operator 1 (api.crow.direct), operator 2 (api2.crow.direct), Crow’s test seller, and Ethereum Sepolia, the network where deals settle. An operator is a server that relays the parties’ signed messages and serves Crow’s API.`,
        sources: [code] },
      { id: 'how-each-check-works', q: 'How is each service checked?',
        a: `With one plain GET per service. The reader’s browser reads the site, the test seller and Blockscout directly. The operators send no CORS header, so the site’s Worker reads each operator’s <code>/.well-known/holdback.json</code> from Cloudflare’s network, and the browser reads the Worker’s answer at <code>${site}status/operators.json</code>.`,
        sources: [relay, code] },
      { id: 'what-the-states-mean', q: 'What does each state mean?',
        a: `Operational: the service answered as expected. Down: the service answered an error, answered with the wrong body, or did not answer in time. Degraded: Sepolia’s newest block on Blockscout is more than ${NETWORK_STALE_SEC} s old; Sepolia normally makes a block about every 12 s. Unknown: Blockscout or the site’s Worker gave no usable answer, so the state could not be read.`,
        sources: [code, ['Blockscout for Sepolia', 'https://eth-sepolia.blockscout.com/']] },
      { id: 'how-fresh', q: 'How fresh is each result?',
        a: `As fresh as the page load. Each check runs once when the page opens and again on Check again, and the table shows each check’s time in UTC. The operators’ answer can be up to 15 s old, because the site’s Worker caches it for 15 s. The status page keeps no history.`,
        sources: [code, relay] },
      { id: 'what-it-misses', q: 'What can the status page not detect?',
        a: `Whether a deal will go through: a service can answer a GET and still fail a step of a deal. The test deal in the agent docs, <code>${site}llms.txt</code>, checks the whole path. The two operators are two Workers that share one process today, so most failures hit both.`,
        sources: [[`${site.replace(/^https:\/\//, '')}llms.txt`, `${site}llms.txt`], limits] },
      { id: 'machine-readable-copy', q: 'Is there a machine-readable copy?',
        a: `Yes, without live states. <code>${site}status.json</code> lists each service, the address checked, who checks it and when it reads Operational. It carries no state or time, because the checks run in the reader’s browser; read each address yourself, or the operators’ live state at <code>${site}status/operators.json</code>.`,
        sources: [[`${site.replace(/^https:\/\//, '')}status.json`, `${site}status.json`], code] },
      { id: 'storage', q: 'Does the status page store data?',
        a: `No. The status page reads only public addresses, the same ones any agent can read, and keeps nothing but the site Worker’s 15-second cache of the operators’ answer.`,
        sources: [code, relay] },
      { id: 'alerts', q: 'Does the status page send alerts?',
        a: `No. The status page sends no alerts; it checks only when someone opens it.`,
        sources: [code] },
      { id: 'report-an-outage', q: 'Where do I report an outage?',
        a: `In a public issue on Crow’s GitHub repository. A security problem goes to GitHub’s private vulnerability reporting instead.`,
        sources: [['GitHub: issues', `${CODE_URL}/issues`], ['SECURITY.md', SECURITY_POLICY]] },
    ] },
  ];
}

/** The status page, /status: the state of each service first, then the questions. */
export function statusPage({ site = 'https://crow.direct/', base = '/' } = {}) {
  const groups = statusFaq({ site });
  return `${head({ site, base, card: CARDS.status, alternate: { type: 'application/json', title: 'The services this page checks (status.json)', path: 'status.json' } })}
<main class="doc">
${sectionHead({ eyebrow: 'Status', title: 'Is Crow answering?', lede: 'Each service is checked when this page opens, with one plain GET. The table shows the state in a word and the time of each check in UTC.' })}
<div class="status-table">
<table class="ck-table" aria-label="State of each Crow service">
<thead><tr><th scope="col">Service</th><th scope="col">State</th><th scope="col">Checked (UTC)</th><th scope="col">Address checked</th></tr></thead>
<tbody>
${STATUS_CHECKS.map((c) => `<tr data-check="${c.id}"><td>${esc(c.name)}<span class="note"></span></td><td><span class="ck-pill">Not checked</span></td><td class="at"></td><td class="addr"><code>${esc(c.address)}</code>${c.via ? `<span class="note">read by the site’s Worker, <code>${esc(c.via)}</code></span>` : ''}</td></tr>`).join('\n')}
</tbody>
</table>
</div>
<p class="again">${button({ label: 'Check again', variant: 'outlined', size: 'compact', attrs: 'id="again"' })}</p>
<noscript><p>This page checks with a script in your browser. Without it, read each address yourself: ${STATUS_CHECKS.map((c) => `<a href="${esc(c.address)}">${esc(plain(c.name))}</a>`).join(', ')}.</p></noscript>
<p class="alt">The services and addresses as JSON: <a href="${base}status.json">${esc(site)}status.json</a></p>
${toc(groups)}
${groups.map((g) => `<h2>${esc(g.group)}</h2>\n${g.questions.map(qaHtml).join('\n')}`).join('\n')}
</main>
${footerHtml({ base, current: 'status' })}
<script>
${STATUS_JS}
</script>
<script>
${drawerScript()}
</script>
</body>
</html>
`;
}

/** /status.json: the status page's services, the address each check reads and when it reads Operational. No live state. */
export function statusJson({ site = 'https://crow.direct/' } = {}) {
  return `${JSON.stringify({
    schema: 'crow.status-checks/1',
    page: `${site}status`,
    live: false,
    note: 'The status page runs these checks in the reader’s browser, so this file carries no state and no time. Read each address yourself; the operators’ live state is at the address in operatorsLive.',
    operatorsLive: `${site}status/operators.json`,
    services: STATUS_CHECKS.map(({ id, name, address, checkedBy, via, operationalWhen }) => ({ id, name: plain(name), address, method: 'GET', checkedBy, ...(via ? { via } : {}), operationalWhen: plain(operationalWhen) })),
  }, null, 2)}\n`;
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
