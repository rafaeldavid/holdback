// Builds the contract-stack page (reports/contract-stack.html) from the repository's sources of truth: the Sepolia
// deployment records, contracts/src, the contract review's findings with T-212's items, and the gas the local-chain
// differential and the Sepolia smoke deal recorded. Node and git only: no network, forge or secrets, so the founder
// console's job can import build() as it imports the design map's. The page lives at escrow.stream/control/contracts;
// the console rebuilds it only when stackVersion() changes, so it follows the contracts, not the clock.
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

/** Every path the page reads: a commit that touches none of them cannot change the page. */
export const INPUTS = ['contracts/src/', 'contracts/deployments/', REVIEW, HARDENING, DIFFERENTIAL, 'tools/contract-stack/', 'scripts/contract-stack.mjs'];

/**
 * The page's version: the latest commit that touched any of its inputs. The founder console rebuilds and pushes the
 * page only when this changes. null when git is unavailable, so the caller rebuilds. It needs the history: in a
 * one-commit checkout (actions/checkout's default depth) every input looks new, so the version is always HEAD and
 * the job would rebuild every run; check out with fetch-depth 0.
 */
export function stackVersion() {
  const out = git(['log', '-1', '--format=%H%x1f%cs', '--', ...INPUTS]);
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

// The EIP-712 domain HoldbackRules signs under, at the deployed commit when the history has it, else in this checkout.
function domainOf(commit) {
  const source = (commit && git(['show', `${commit}:contracts/src/HoldbackRules.sol`])) || read('contracts/src/HoldbackRules.sol');
  const m = source.match(/_domainNameAndVersion\(\)[\s\S]*?return \("([^"]+)", "([^"]+)"\)/);
  return m ? { name: m[1], version: m[2] } : null;
}

function record(file) {
  const r = JSON.parse(read(`contracts/deployments/${file}`));
  return {
    file: `contracts/deployments/${file}`,
    chainId: r.chainId,
    commit: r.commit ?? null,
    fromBlock: r.fromBlock,
    deployer: r.deployer ?? null,
    token: { symbol: r.token.symbol, name: r.token.name, decimals: r.token.decimals },
    addresses: ADDRESSES.map(([key, name]) => ({ key, name, address: key === 'token' ? r.token.address : r[key] })).filter((a) => a.address),
    contracts: Object.keys(r.contracts ?? {}),
    checks: r.checks ?? {},
    domain: domainOf(r.commit),
  };
}

export function deployments() {
  const live = record('sepolia.json');
  // The deploy writes the record on the day it runs, so the commit that last changed it dates the deployment.
  live.recordedOn = git(['log', '-1', '--format=%cs', '--', 'contracts/deployments/sepolia.json']);
  const earlier = list('contracts/deployments', /^sepolia-\d{4}-\d{2}-\d{2}-domain-[\d.]+\.json$/)
    .reverse()
    .map((file) => ({ ...record(file), deployedOn: file.match(/^sepolia-(\d{4}-\d{2}-\d{2})/)[1] }));
  // Whether contracts/src here is the code the live record was deployed from: 0 same, 1 changed, else unknown.
  const diff = live.commit ? spawnSync('git', ['diff', '--quiet', live.commit, '--', 'contracts/src'], { cwd: root }).status : null;
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
  const rows = [...read(REVIEW).matchAll(/^\| ([HMLI]-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|$/gm)].map((m) => ({
    id: m[1],
    severity: m[2].trim().split(/[\s,]/)[0].toLowerCase(),
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
    return { ...r, item: item?.item ?? null, state, title: w.title ?? r.reviewTitle, text: w[state] ?? `${r.reviewTitle}. Review status: ${r.status}.` };
  });
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
  const recorded = git(['log', '-1', '--format=%h%x1f%cs', '--', DIFFERENTIAL])?.split('\x1f');
  return { paths, fixtures: rows.length, recordedAt: recorded ? { commit: recorded[0], date: recorded[1] } : null, source: DIFFERENTIAL };
}

// The smoke deal's gas on Sepolia, as T-212 records it from the transaction receipts.
export function sepoliaGas() {
  const m = read(HARDENING).match(/Gas on Sepolia: fund ([\d,]+), deliver ([\d,]+), decide ([\d,]+), total ([\d,]+)/);
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
