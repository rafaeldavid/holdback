// The deployment record's copies, by one command (T-383; cutover step 3). A redeploy on Sepolia writes a new
// contracts/deployments/sepolia.json; every file that pins the deployed contracts must then name the new ones, in the
// same commit. This command does that in three steps, and the third is what makes it safe:
//
//   1. Substitute: each old address and hash the two records give (by field name, never by position) is replaced by
//      the new one in a fixed list of files, in the letter case each occurrence was written in. examples/deployments.ts
//      gets the new record as its SEPOLIA constant, whole.
//   2. Rebuild: `node site/build.mjs` regenerates site/try.mjs and site/index.html from the files above.
//   3. Sweep: it fails if any old address or hash, the ones the new record dropped included, remains in a tracked file
//      outside the history files listed in HISTORY below. So the step cannot pass with a pin missed.
//
//   node scripts/record-copies.mjs keep --rpc <url> [--root <dir>]
//   node scripts/record-copies.mjs --old contracts/deployments/sepolia-<YYYY-MM-DD>T<HHMM>Z-domain-<version>.json \
//                                  --new contracts/deployments/sepolia.json [--root <dir>] [--no-build]
//
// `keep` runs before the deploy (cutover step 2.3). It copies the live record, contracts/deployments/sepolia.json, to
// its dated name, sepolia-<YYYY-MM-DD>T<HHMM>Z-domain-<version>.json: the UTC time the deployment happened (the record's
// `deployedAt`, or for a record without one the block time of its `fromBlock`) and the EIP-712 domain version its
// rules contract signs under. Both reads are read-only calls through `cast`; it prints the dated name for --old. The
// copies themselves read and write files in the checkout only: no network, no key, no chain.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files that copy the record, each rewritten by substitution. examples/deployments.ts is regenerated instead. */
export const PINNED = [
  'site/llms.txt',
  'examples/verify.ts',
  'tools/contract-stack/plain.json',
  'packages/settlement/evm/accepted-tokens.json',
];
export const DEPLOYMENTS_TS = 'examples/deployments.ts';
export const LIVE_RECORD = 'contracts/deployments/sepolia.json';
/** A dated record's path: the date, and since T-383 the UTC time, of its deployment, then its domain version. */
export const DATED = /^contracts\/deployments\/sepolia-\d{4}-\d{2}-\d{2}(T\d{4}Z)?-domain-[\d.]+\.json$/;

/** The dated name of a record deployed at `deployedAt` (an ISO time) whose rules contract signs under `version`. */
export function datedName(deployedAt, version) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(deployedAt));
  if (!m || Number.isNaN(Date.parse(deployedAt))) throw new Error(`the deployment time ${JSON.stringify(deployedAt)} is not an ISO time`);
  const utc = new Date(deployedAt).toISOString();
  if (!/^[\d.]+$/.test(String(version))) throw new Error(`the domain version ${JSON.stringify(version)} is not a version number`);
  return `contracts/deployments/sepolia-${utc.slice(0, 10)}T${utc.slice(11, 13)}${utc.slice(14, 16)}Z-domain-${version}.json`;
}

/** The chain reads `keep` needs, through `cast`: the chain ID, a block's time (ISO, UTC) and the domain version. */
export const castReads = {
  chainId: (rpc) => Number(cast(['chain-id', '--rpc-url', rpc])),
  blockTime: (rpc, block) => new Date(Number(cast(['to-dec', cast(['block', String(block), '--field', 'timestamp', '--rpc-url', rpc])])) * 1000).toISOString(),
  domainVersion: (rpc, rules) => {
    const lines = cast(['call', rules, 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])', '--rpc-url', rpc]).split('\n');
    return JSON.parse(lines[2] ?? '""');
  },
};

function cast(args) {
  const r = spawnSync('cast', args, { encoding: 'utf8' });
  // The RPC URL can carry a key: the error names the subcommand only.
  if (r.status !== 0) throw new Error(`cast ${args[0]} failed: ${(r.stderr || '').split('\n')[0].replace(/https?:\/\/\S+/g, '<rpc>')}`);
  return r.stdout.trim();
}

/**
 * Step 2.3: the live record copied to its dated name, before a deploy writes over it. Refuses a chain other than the
 * record's, and a dated file of that name with other content; the same content again is a no-op, so a rerun is safe.
 * Returns the dated name.
 */
export function keep({ root, rpc, reads = castReads, log = console.log }) {
  const livePath = join(root, LIVE_RECORD);
  const text = readFileSync(livePath, 'utf8');
  const record = JSON.parse(text);
  const chain = reads.chainId(rpc);
  if (chain !== record.chainId) throw new Error(`the RPC serves chain ${chain}, the live record chain ${record.chainId}`);
  const at = record.deployedAt ?? reads.blockTime(rpc, record.fromBlock);
  const name = datedName(at, reads.domainVersion(rpc, record.rules));
  const path = join(root, name);
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== text) throw new Error(`${name} exists with other content: two deployments in the same minute, or an edited copy; nothing was written`);
    log(`record-copies: ${name} already holds the live record`);
  } else {
    writeFileSync(path, text);
    log(`record-copies: kept ${LIVE_RECORD} as ${name}`);
  }
  log(`record-copies: after the deploy, run: node scripts/record-copies.mjs --old ${name} --new ${LIVE_RECORD}`);
  return name;
}

/**
 * Where an old value may stay, and why. Anything else that names one fails the sweep.
 * Each entry is a path prefix, or a regular expression on the path.
 */
export const HISTORY = [
  { path: DATED, why: 'a dated record: the deployment it names' },
  { path: 'docs/tasks/', why: 'dated history: task files' },
  { path: 'docs/reviews/', why: 'dated history: reviews' },
  { path: 'docs/research/', why: 'dated history: research and its recorded runs' },
  { path: 'docs/operations.md', why: 'the dated record of each deploy' },
  { path: 'docs/cutover-phase-one.md', why: "this cutover's runbook, which names the old world on purpose" },
  { path: 'docs/audit/scope.md', why: 'rewritten for the frozen commit at cutover step 11.4' },
  { path: 'tests/metrics/fixtures/', why: 'recorded answers of past live runs' },
  { path: 'examples/e2e-run.test.ts', why: 'a recorded Sepolia run' },
  { path: 'examples/e2e-adjudicator.test.ts', why: 'a fixed test vector: its hashes are computed over these values' },
  { path: 'examples/send-timeout.test.ts', why: 'a fixed test vector: its commitment ID is the hash of its terms' },
];

const HEX = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

/**
 * The record's addresses and hashes by field name: the top-level addresses, the token's address, domain separator and
 * transaction, each contract's address, transaction and token store, and the checks' hashes. Constructor arguments
 * are left out: their positions change between deployments, and each is one of the addresses above.
 */
export function valuesOf(record) {
  const out = new Map();
  const put = (name, v) => {
    if (typeof v === 'string' && HEX.test(v)) out.set(name, v);
  };
  for (const [k, v] of Object.entries(record)) put(k, v);
  for (const [k, v] of Object.entries(record.token ?? {})) put(`token.${k}`, v);
  for (const [k, v] of Object.entries(record.checks ?? {})) put(`checks.${k}`, v);
  for (const [name, c] of Object.entries(record.contracts ?? {})) for (const [k, v] of Object.entries(c ?? {})) put(`contracts.${name}.${k}`, v);
  return out;
}

/**
 * The old values and what each becomes: `pairs` (old → new, lowercase keys) for every field both records name with
 * different values, and `retired` for the old deployment's own contracts and transactions (its `contracts` entries)
 * that the new record no longer names anywhere, such as a cut vault. An outside contract the old record named, such as
 * the canonical token-approval contract, is not retired: it is not this deployment's. Fails when one old value would
 * become two new ones.
 */
export function changes(oldRecord, newRecord) {
  const before = valuesOf(oldRecord);
  const after = valuesOf(newRecord);
  const kept = new Set([...after.values()].map((v) => v.toLowerCase()));
  const pairs = new Map();
  const retired = new Set();
  for (const [name, v] of before) {
    const o = v.toLowerCase();
    const n = after.get(name);
    if (n !== undefined && n.toLowerCase() !== o) {
      const seen = pairs.get(o);
      if (seen && seen.toLowerCase() !== n.toLowerCase()) throw new Error(`${v} becomes both ${seen} and ${n}: the records disagree on what replaces it`);
      pairs.set(o, n);
    } else if (n === undefined && !kept.has(o) && /^contracts\./.test(name)) retired.add(o);
  }
  // A value both records name, under any field, stays.
  for (const o of pairs.keys()) if (kept.has(o)) pairs.delete(o);
  // A value one field retires and another replaces (the vault's creation was the rules contract's) is replaced.
  for (const o of pairs.keys()) retired.delete(o);
  return { pairs, retired };
}

/** `next` written in the letter case `seen` was: all lower, all upper hex, or the checksummed form the record gives. */
function sameCase(seen, next, old) {
  const body = seen.slice(2);
  if (body === body.toLowerCase()) return `0x${next.slice(2).toLowerCase()}`;
  if (body === body.toUpperCase()) return `0x${next.slice(2).toUpperCase()}`;
  if (seen === old) return next;
  throw new Error(`${seen} is written in a letter case this command does not know; fix it by hand`);
}

/** Replaces each old value in `text`; returns the text and the count. A value inside a longer hex string is left alone. */
export function substitute(text, pairs, oldRecord) {
  const original = new Map([...valuesOf(oldRecord).values()].map((v) => [v.toLowerCase(), v]));
  let count = 0;
  const out = text.replace(/0x[0-9a-fA-F]+/g, (seen) => {
    const n = pairs.get(seen.toLowerCase());
    if (!n) return seen;
    count++;
    return sameCase(seen, n, original.get(seen.toLowerCase()));
  });
  return { text: out, count };
}

/** A JavaScript literal in the repository's style: bare keys, single quotes, two-space indent, trailing commas. */
export function literal(v, indent = '') {
  const next = `${indent}  `;
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[\n${v.map((x) => `${next}${literal(x, next)},`).join('\n')}\n${indent}]`;
  if (v && typeof v === 'object') {
    const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
    return `{\n${Object.entries(v).map(([k, x]) => `${next}${key(k)}: ${literal(x, next)},`).join('\n')}\n${indent}}`;
  }
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return JSON.stringify(v);
}

/** examples/deployments.ts with its SEPOLIA constant, and the comment above it, made from `record`. */
export function regenerateDeployments(text, record) {
  const start = text.indexOf('/**\n * Ethereum Sepolia');
  const head = 'export const SEPOLIA: DeploymentFile | null = ';
  const at = text.indexOf(head);
  if (start < 0 || at < start) throw new Error(`${DEPLOYMENTS_TS} has no SEPOLIA constant with its comment`);
  const end = text.indexOf('\n};\n', at);
  if (end < 0) throw new Error(`${DEPLOYMENTS_TS}: the SEPOLIA constant has no end`);
  const comment = [
    '/**',
    ` * Ethereum Sepolia (chain id ${record.chainId}): the deployment in contracts/deployments/sepolia.json, from the contracts at`,
    ` * ${String(record.commit).slice(0, 7)}. Written by scripts/record-copies.mjs; earlier deployments are the dated records beside it.`,
    ' */',
  ].join('\n');
  return `${text.slice(0, start)}${comment}\n${head}${literal(record)};\n${text.slice(end + 4)}`;
}

/** The tracked files under `root` (git ls-files), or every file when `root` is no git checkout. */
export function trackedFiles(root) {
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  if (git.status === 0 && existsSync(join(root, '.git'))) return git.stdout.split('\0').filter(Boolean);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p));
    }
  };
  walk(root);
  return out;
}

const inHistory = (file) => HISTORY.some((h) => (typeof h.path === 'string' ? file.startsWith(h.path) : h.path.test(file)));

/**
 * Every line of a tracked file outside HISTORY that still names an old value: `file:line: value`. A value is found by
 * its hex body, in any letter case and anywhere in the line, so a pin with no `0x`, padded to 32 bytes (a log topic,
 * ABI data) or inside a longer hex string is found too (review of PR 425). Substitution rewrites whole `0x` values
 * only; any other spelling the sweep finds is fixed by hand.
 */
export function sweep(root, oldValues) {
  const bodies = [...oldValues].map((v) => v.slice(2));
  const found = [];
  for (const file of trackedFiles(root)) {
    if (inHistory(file)) continue;
    const path = join(root, file);
    if (!existsSync(path) || statSync(path).size > 8_000_000) continue;
    const text = readFileSync(path, 'utf8');
    if (text.includes('\0')) continue;
    const lower = text.toLowerCase();
    if (!bodies.some((b) => lower.includes(b))) continue;
    text.split('\n').forEach((line, i) => {
      const l = line.toLowerCase();
      for (const b of bodies) if (l.includes(b)) found.push(`${file}:${i + 1}: 0x${b}`);
    });
  }
  return found;
}

/** The whole command. Returns the lines it printed and an exit code; throws nothing a user should see as a stack. */
export function recordCopies({ root, oldPath, newPath, build = true, log = console.log }) {
  const oldRecord = JSON.parse(readFileSync(resolve(root, oldPath), 'utf8'));
  const newRecord = JSON.parse(readFileSync(resolve(root, newPath), 'utf8'));
  if (oldRecord.chainId !== newRecord.chainId) throw new Error(`the old record is for chain ${oldRecord.chainId}, the new one for chain ${newRecord.chainId}`);
  const { pairs, retired } = changes(oldRecord, newRecord);
  if (pairs.size === 0) throw new Error('the two records name the same contracts: nothing to copy');
  for (const file of PINNED) {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`${file} is missing: the list of copies names it`);
    const { text, count } = substitute(readFileSync(path, 'utf8'), pairs, oldRecord);
    if (count > 0) writeFileSync(path, text);
    log(`record-copies: ${file}: ${count} replaced`);
  }
  const ts = join(root, DEPLOYMENTS_TS);
  writeFileSync(ts, regenerateDeployments(readFileSync(ts, 'utf8'), newRecord));
  log(`record-copies: ${DEPLOYMENTS_TS}: SEPOLIA is the new record`);
  if (build) {
    // The real path: build.mjs runs only when its own URL equals argv[1], and a symlinked folder (macOS's /var) differs.
    const b = spawnSync(process.execPath, [realpathSync(join(root, 'site', 'build.mjs'))], { cwd: root, encoding: 'utf8' });
    if (b.status !== 0 || !/wrote site\/try\.mjs/.test(b.stdout)) throw new Error(`node site/build.mjs did not rebuild the site: ${b.stderr || b.stdout}`);
    log('record-copies: site/try.mjs and site/index.html rebuilt');
  }
  const left = sweep(root, new Set([...pairs.keys(), ...retired]));
  if (left.length > 0) {
    log(`record-copies: FAIL: ${left.length} old value(s) remain outside the history files:`);
    for (const l of left) log(`  ${l}`);
    return 1;
  }
  log(`record-copies: pass: ${pairs.size} value(s) replaced, ${retired.size} retired, none left outside the history files`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const oldPath = flag('--old');
  const newPath = flag('--new');
  const rpc = flag('--rpc');
  const keeping = args[0] === 'keep';
  if (keeping ? !rpc : !oldPath || !newPath) {
    console.error('usage: node scripts/record-copies.mjs keep --rpc <url> [--root <dir>]\n       node scripts/record-copies.mjs --old <dated old record> --new <new record> [--root <dir>] [--no-build]');
    process.exit(2);
  }
  const root = resolve(flag('--root') ?? fileURLToPath(new URL('..', import.meta.url)));
  try {
    if (keeping) {
      keep({ root, rpc });
      process.exit(0);
    }
    process.exit(recordCopies({ root, oldPath, newPath, build: !args.includes('--no-build') }));
  } catch (e) {
    console.error(`record-copies: ${e.message}`);
    process.exit(1);
  }
}
