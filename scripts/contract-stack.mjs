// Builds the contract-stack page (reports/contract-stack.html) from the repository's sources of truth: the Sepolia
// deployment records, contracts/src, the contract review's findings with T-212's items and the audit's known-issues
// list, and the gas the local-chain differential and the Sepolia smoke deal recorded. Node and git only: no network, forge or secrets, so the founder
// console's job can import build() as it imports the design map's. The page lives at
// https://control.escrow.stream/contracts; the console rebuilds it only when stackVersion() changes, so it follows the
// contracts, not the clock. The page uses no storage, cookies or fetch, so it works in a sandboxed, opaque origin: one
// inline script renders the embedded data. Colours, type and the header bar come from Crow's brand kit (site/brand/),
// inlined at build time so the page stays one file (T-424).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerBar, kitCss, markDataUri } from '../site/brand/kit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const list = (dir, pattern) => readdirSync(join(root, dir)).filter((f) => pattern.test(f)).sort();
// null when git is missing or the history is too shallow to answer
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const num = (s) => Number(String(s).replace(/,/g, ''));

const REVIEW = 'docs/reviews/2026-11-03-contract-review.md';
const HARDENING = 'docs/tasks/T-212-contract-hardening.md';
// The audit's list of findings: a finding's state there (fixed, or not in phase one) wins over the review's and T-212's.
const KNOWN = 'docs/audit/known-issues.md';
// The deploy record: each redeploy's smoke deal writes its gas there, newest first (the redeploy runbook).
const OPERATIONS = 'docs/operations.md';
const DIFFERENTIAL = 'reports/differential-local.md';

/** What the deploy script builds from (contracts/script/deploy-sepolia.sh, BUILD_INPUTS): a change here changes deployed code. */
export const BUILD_INPUTS = ['contracts/src/', 'contracts/lib', 'contracts/foundry.toml', 'contracts/remappings.txt', 'contracts/script/TestUSDC.sol'];

/** Every path the page reads: a commit that touches none of them cannot change the page. */
export const INPUTS = [...BUILD_INPUTS, 'contracts/deployments/', REVIEW, HARDENING, KNOWN, OPERATIONS, DIFFERENTIAL, 'tools/contract-stack/', 'scripts/contract-stack.mjs', 'site/brand/', 'site/crow-mark.svg'];

/** True in a checkout without the history (actions/checkout's default depth of one commit). */
export function shallow() {
  return git(['rev-parse', '--is-shallow-repository']) !== 'false';
}

/**
 * The page's version: the latest commit on main's first-parent line that touched any of its inputs. The founder
 * console rebuilds and pushes the page only when this changes. It needs the history, so it is null in a shallow
 * checkout (where every input looks new) or without git: the caller then rebuilds. Check out with fetch-depth 0.
 */
export function stackVersion() {
  if (shallow()) return null;
  const out = git(['log', '-1', '--first-parent', '--format=%H%x1f%cs', '--', ...INPUTS]);
  if (!out) return null;
  const [commit, date] = out.split('\x1f');
  return { commit, short: commit.slice(0, 7), date };
}

/**
 * The record's address fields, with the names the page shows. A phase-one record (ADR-0031) has the first six; the
 * last three appear only in records deployed before it, which the page still reads, and are left out when absent.
 */
const ADDRESSES = [
  ['rules', 'HoldbackRules'],
  ['beacon', 'DrandQuicknetBeacon'],
  ['escrow', 'AuthCaptureEscrow'],
  ['erc3009Collector', 'ERC3009PaymentCollector'],
  ['token', 'tUSDC'],
  ['multicall', 'Multicall3'],
  // Not in phase one: the adjudicators' bond vault and Permit2 funding, named only by an earlier deployment record.
  ['bonds', 'HoldbackBonds'],
  ['permit2Collector', 'Permit2PaymentCollector'],
  ['permit2', 'Permit2'],
];
export const PHASE_ONE_ADDRESS_KEYS = ADDRESSES.slice(0, 6).map(([key]) => key);

export function plain() {
  return JSON.parse(read('tools/contract-stack/plain.json'));
}

// The EIP-712 domain HoldbackRules signs under at the deployed commit, with where it was read: from that commit when
// the history has it, else from this checkout (true only while contracts/src has not changed since the deploy).
function domainOf(commit) {
  const atCommit = commit ? git(['show', `${commit}:contracts/src/HoldbackRules.sol`]) : null;
  const m = (atCommit || read('contracts/src/HoldbackRules.sol')).match(/_domainNameAndVersion\(\)[\s\S]*?return \("([^"]+)", "([^"]+)"\)/);
  return m ? { name: m[1], version: m[2], readFrom: atCommit ? 'deployed commit' : 'this checkout' } : null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function record(file) {
  const r = JSON.parse(read(`contracts/deployments/${file}`));
  const addresses = ADDRESSES.map(([key, name]) => ({ key, name, address: key === 'token' ? r.token.address : r[key] })).filter((a) => a.address);
  for (const a of addresses) if (!ADDRESS.test(a.address)) throw new Error(`${file}: ${a.key} is not an address: ${a.address}`);
  return {
    file: `contracts/deployments/${file}`,
    chainId: r.chainId,
    commit: r.commit ?? null,
    fromBlock: r.fromBlock,
    rulesBlock: r.contracts?.HoldbackRules?.block ?? null,
    deployer: r.deployer ?? null,
    token: { symbol: r.token.symbol, name: r.token.name, decimals: r.token.decimals },
    addresses,
    contracts: Object.keys(r.contracts ?? {}),
    checks: r.checks ?? {},
  };
}

export function deployments() {
  const history = !shallow();
  const live = { ...record('sepolia.json'), domain: null };
  live.domain = domainOf(history ? live.commit : null);
  // The deploy writes the record on the day it runs, so the commit that last changed it dates the deployment.
  live.recordedOn = history ? git(['log', '-1', '--format=%cs', '--', 'contracts/deployments/sepolia.json']) : null;
  // An earlier record's name carries its date and its EIP-712 domain version (sepolia-2026-11-03-domain-0.6.json); since
  // T-383 also the UTC time, so two deployments on one day differ (sepolia-2026-11-20T1403Z-domain-0.8.json).
  const earlier = list('contracts/deployments', /^sepolia-\d{4}-\d{2}-\d{2}(T\d{4}Z)?-domain-[\d.]+\.json$/)
    .reverse()
    .map((file) => {
      const [, deployedOn, , version] = file.match(/^sepolia-(\d{4}-\d{2}-\d{2})(T\d{4}Z)?-domain-([\d.]+)\.json$/);
      return { ...record(file), deployedOn, domain: { version, readFrom: 'file name' } };
    });
  // Whether this checkout builds the code the live record was deployed from: 0 same, 1 changed, else unknown.
  const diff = history && live.commit ? spawnSync('git', ['diff', '--quiet', live.commit, '--', ...BUILD_INPUTS], { cwd: root }).status : null;
  const srcMatchesLive = diff === 0 ? true : diff === 1 ? false : null;
  return { live, earlier, srcMatchesLive };
}

export function contracts(live) {
  const words = plain().contracts;
  return list('contracts/src', /\.sol$/).map((file) => {
    const text = read(`contracts/src/${file}`);
    const lines = text.replace(/\n$/, '').split('\n');
    const decl = text.match(/^(abstract contract|contract|library|interface) (\w+)/m);
    const name = decl?.[2] ?? file.replace(/\.sol$/, '');
    const notice = text.match(/@notice\s+([^\n]+)/)?.[1].trim() ?? '';
    return {
      file: `contracts/src/${file}`,
      name,
      kind: decl?.[1] ?? 'contract',
      lines: lines.length,
      codeLines: lines.filter((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l)).length,
      deployed: live.contracts.includes(name),
      text: words[name] ?? notice,
    };
  });
}

// T-212's items by the finding each fixes: "3. **L-1.** …", done when the item says "**Done".
function hardeningItems() {
  const items = {};
  for (const m of read(HARDENING).matchAll(/^(\d+)\. \*\*([HMLI]-\d+)\b[^\n]*$/gm)) {
    items[m[2]] = { item: Number(m[1]), done: /\*\*Done/.test(m[0]) };
  }
  return items;
}

// The review's findings about the bond vault and party appeals, which the phase-one contracts cut (ADR-0031 §8, SC-7):
// their fixes were real on the 2026-11-04 contracts, but the code they fixed is gone, so the page shows them as cut.
// known-issues lists L-2, L-3 and L-5 in its section 9; these four it names only as history or as "I-8 rest".
export const CUT_WITH_BONDS = ['M-1', 'M-3', 'L-7', 'I-8'];

// docs/audit/known-issues.md by finding ID: 'fixed' when its row in the findings tables says "fixed", 'cut' when the
// row sits in section 9, "Not in phase one". Rows that name several IDs ("I-1, I-4, …") or a part ("I-8 rest") are
// left to the review and T-212; a "<ID> limit" row that is open becomes its own finding (limits()).
export function knownIssues() {
  const out = {};
  let cutSection = false;
  for (const line of read(KNOWN).split('\n')) {
    if (/^## /.test(line)) cutSection = /not in phase one/i.test(line);
    const m = line.match(/^\| ([HMLI]-\d+) \|(.*)\|$/);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    if (cutSection) out[m[1]] = 'cut';
    else if (/^fixed\b/i.test(cells[3] ?? '')) out[m[1]] = 'fixed';
  }
  return out;
}

export function findings() {
  const words = plain().findings;
  const items = hardeningItems();
  const known = { ...knownIssues(), ...Object.fromEntries(CUT_WITH_BONDS.map((id) => [id, 'cut'])) };
  // A re-rated finding keeps its history in the cell ("low, medium since D43"): the rating after "since" applies now.
  const current = (cell) => (cell.match(/(high|medium|low|info) since\b/i)?.[1] ?? cell.split(/[\s,]/)[0]).toLowerCase();
  const rows = [...read(REVIEW).matchAll(/^\| ([HMLI]-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|$/gm)].map((m) => ({
    id: m[1],
    severity: current(m[2].trim()),
    severityNote: m[2].trim(),
    reviewTitle: m[3].replace(/`/g, '').trim(),
    litmus: m[4].trim(),
    label: m[5].trim(),
    status: m[6].trim(),
  }));
  // T-212 items for findings the review's summary table folds into "I-1 to I-13" (such as the overturn payout, I-8)
  for (const [id, it] of Object.entries(items)) {
    if (!rows.some((r) => r.id === id)) rows.push({ id, severity: 'info', severityNote: 'info', reviewTitle: words[id]?.title ?? id, litmus: '', label: '', status: `T-212 item ${it.item}` });
  }
  return rows.map((r) => {
    const item = items[r.id];
    const state = known[r.id] ?? (/^fixed\b/i.test(r.status) || item?.done ? 'fixed' : /^accepted\b/i.test(r.status) ? 'accepted' : 'open');
    const w = words[r.id] ?? {};
    // Without wording for its current state, say only what the sources say, so the text never contradicts the state.
    const fallback = state === 'cut' ? `${r.reviewTitle}. Not in phase one (${KNOWN}, section 9).`
      : state === 'fixed' && known[r.id] ? `${r.reviewTitle}. Fixed in the phase-one contracts (${KNOWN}).`
      : state === 'fixed' && item?.done && !/^fixed\b/i.test(r.status) ? `${r.reviewTitle}. Fixed in T-212 item ${item.item}.` : `${r.reviewTitle}. Review status: ${r.status}.`;
    return { ...r, item: item?.item ?? null, state, title: w.title ?? r.reviewTitle, text: w[state] ?? fallback };
  }).concat(limits(words));
}

// known-issues rows named "<ID> limit" whose status starts "open": a residual of a fixed finding that stays open in
// phase one (the H-2 limit: a call carrying the buyer's key publishes it even when the call reverts).
function limits(words) {
  const out = [];
  for (const line of read(KNOWN).split('\n')) {
    const m = line.match(/^\| ([HMLI]-\d+ limit) \|(.*)\|$/);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    if (!/^open\b/i.test(cells[3] ?? '')) continue;
    const severity = (cells[2] ?? 'info').split(/[\s,]/)[0].toLowerCase();
    const w = words[m[1]] ?? {};
    out.push({ id: m[1], severity, severityNote: severity, reviewTitle: cells[0], litmus: '', label: '', status: cells[3], item: null, state: 'open', title: w.title ?? cells[0], text: w.open ?? `${cells[0]}. Status in ${KNOWN}: open in phase one.` });
  }
  return out;
}

/** The review's informational items that the summary table folds into one row ("I-1 to I-13"). */
export function infoCount() {
  return Number(read(REVIEW).match(/^\| I-1 to I-(\d+) \|/m)?.[1] ?? 0);
}

export function gas() {
  const text = read(DIFFERENTIAL);
  const rows = [...text.matchAll(/^\| `([^`]+)` \| ([^|]+) \| (\d*) \| ([\d,]*) \|/gm)].map((m) => ({
    fixture: m[1],
    result: m[2].trim(),
    transactions: m[3] ? Number(m[3]) : null,
    gas: m[4] ? num(m[4]) : null,
  }));
  const paths = plain().gas.map((p) => ({ ...p, ...(rows.find((r) => r.fixture === p.fixture) ?? {}) }));
  const recorded = shallow() ? null : git(['log', '-1', '--format=%h%x1f%cs', '--', DIFFERENTIAL])?.split('\x1f');
  return { paths, fixtures: rows.length, recordedAt: recorded ? { commit: recorded[0], date: recorded[1] } : null, source: DIFFERENTIAL };
}

// The Sepolia smoke deal's gas, from the transaction receipts: the deploy record's first line (it runs newest first),
// else T-212's last (the deployment of 2026-11-04, which recorded it there).
const GAS_LINE = /Gas on Sepolia: fund ([\d,]+), deliver ([\d,]+), decide ([\d,]+), total ([\d,]+)/g;
export function sepoliaGas() {
  const ops = read(OPERATIONS);
  const fromOps = [...ops.slice(Math.max(0, ops.indexOf('\n## Deploy record'))).matchAll(GAS_LINE)][0];
  const m = fromOps ?? [...read(HARDENING).matchAll(GAS_LINE)].at(-1);
  return m ? { fund: num(m[1]), deliver: num(m[2]), decide: num(m[3]), total: num(m[4]), source: fromOps ? OPERATIONS : HARDENING } : null;
}

export function review() {
  const text = read(REVIEW);
  return { file: REVIEW, title: text.match(/^# (.+)$/m)?.[1] ?? REVIEW, date: REVIEW.match(/(\d{4}-\d{2}-\d{2})/)[1], crossFamily: /## \d+\. Cross-family pass/.test(text) };
}

export function collect() {
  const deployment = deployments();
  return {
    // The inputs' version, not HEAD, so the same inputs always render the same page.
    version: stackVersion(),
    deployment,
    contracts: contracts(deployment.live),
    findings: findings(),
    infoCount: infoCount(),
    history: !shallow(),
    gas: gas(),
    sepoliaGas: sepoliaGas(),
    review: review(),
  };
}

export function build() {
  const template = read('tools/contract-stack/template.html');
  const marker = '/*__STACK_DATA__*/null';
  if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
  const data = JSON.stringify(collect()).replace(/</g, '\\u003c');
  return withKit(template).replace(marker, () => data);
}

/** The template with the brand kit's CSS (tokens, base, header bar, pill) and its header bar, Crow's mark inlined. */
export function withKit(template) {
  for (const m of ['/*__KIT_CSS__*/', '<!--__KIT_HEADER__-->']) if (!template.includes(m)) throw new Error(`template is missing ${m}`);
  return template
    .replace('/*__KIT_CSS__*/', () => kitCss({ parts: ['bar', 'pill'], mark: markDataUri() }))
    .replace('<!--__KIT_HEADER__-->', () => headerBar({ home: 'https://crow.direct' }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = join(root, 'reports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'contract-stack.html');
  writeFileSync(out, build());
  console.log(`contract stack written: ${out}`);
}
