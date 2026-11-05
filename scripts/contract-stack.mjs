// Builds the contract-stack page (reports/contract-stack.html) from the repository's sources of truth: the Sepolia
// deployment records, contracts/src, the contract review's findings with T-212's items, and the gas the local-chain
// differential and the Sepolia smoke deal recorded. Node and git only: no network, forge or secrets, so the founder
// console's job can import build() as it imports the design map's. The page lives at
// https://control.escrow.stream/contracts; the console rebuilds it only when stackVersion() changes, so it follows the
// contracts, not the clock. The page uses no storage, cookies or fetch, so it works in a sandboxed, opaque origin: one
// inline script renders the embedded data, and the Google Fonts stylesheet is optional (system serif otherwise).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const DIFFERENTIAL = 'reports/differential-local.md';

/** What the deploy script builds from (contracts/script/deploy-sepolia.sh, BUILD_INPUTS): a change here changes deployed code. */
export const BUILD_INPUTS = ['contracts/src/', 'contracts/lib', 'contracts/foundry.toml', 'contracts/remappings.txt', 'contracts/script/TestUSDC.sol'];

/** Every path the page reads: a commit that touches none of them cannot change the page. */
export const INPUTS = [...BUILD_INPUTS, 'contracts/deployments/', REVIEW, HARDENING, DIFFERENTIAL, 'tools/contract-stack/', 'scripts/contract-stack.mjs'];

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

/** The record's address fields, with the names the page shows. */
const ADDRESSES = [
  ['rules', 'HoldbackRules'],
  ['bonds', 'HoldbackBonds'],
  ['beacon', 'DrandQuicknetBeacon'],
  ['escrow', 'AuthCaptureEscrow'],
  ['erc3009Collector', 'ERC3009PaymentCollector'],
  ['permit2Collector', 'Permit2PaymentCollector'],
  ['token', 'tUSDC'],
  ['multicall', 'Multicall3'],
  ['permit2', 'Permit2'],
];

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
  // An earlier record's name carries its date and its EIP-712 domain version (sepolia-2026-11-03-domain-0.6.json).
  const earlier = list('contracts/deployments', /^sepolia-\d{4}-\d{2}-\d{2}-domain-[\d.]+\.json$/)
    .reverse()
    .map((file) => {
      const [, deployedOn, version] = file.match(/^sepolia-(\d{4}-\d{2}-\d{2})-domain-([\d.]+)\.json$/);
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

export function findings() {
  const words = plain().findings;
  const items = hardeningItems();
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
    const state = /^fixed\b/i.test(r.status) || item?.done ? 'fixed' : /^accepted\b/i.test(r.status) ? 'accepted' : 'open';
    const w = words[r.id] ?? {};
    // Without wording for its current state, say only what the sources say, so the text never contradicts the state.
    const fallback = state === 'fixed' && item?.done && !/^fixed\b/i.test(r.status) ? `${r.reviewTitle}. Fixed in T-212 item ${item.item}.` : `${r.reviewTitle}. Review status: ${r.status}.`;
    return { ...r, item: item?.item ?? null, state, title: w.title ?? r.reviewTitle, text: w[state] ?? fallback };
  });
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

// The Sepolia smoke deal's gas, as T-212 records it from the transaction receipts; the last such line is the newest.
export function sepoliaGas() {
  const m = [...read(HARDENING).matchAll(/Gas on Sepolia: fund ([\d,]+), deliver ([\d,]+), decide ([\d,]+), total ([\d,]+)/g)].at(-1);
  return m ? { fund: num(m[1]), deliver: num(m[2]), decide: num(m[3]), total: num(m[4]), source: HARDENING } : null;
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
  return template.replace(marker, data);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = join(root, 'reports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'contract-stack.html');
  writeFileSync(out, build());
  console.log(`contract stack written: ${out}`);
}
