// Source verification of the five phase-one contracts on Sourcify, through its API v2 (T-410). forge 1.0.0 calls
// Sourcify's API v1, which Sourcify removed ("Cannot POST /verify", 404), so `forge verify-contract` no longer
// verifies there. This tool sends the compile job of the deployed build instead, one request per contract, and then
// asks Sourcify what it holds for each address.
//
//   node scripts/sourcify-verify.mjs --record <record.json> --rpc <rpc-url> [--root <checkout>]            check only
//   node scripts/sourcify-verify.mjs --record <record.json> --rpc <rpc-url> [--root <checkout>] --submit   send
//
// contracts/script/deploy-sepolia.sh --verify runs it with --submit after its --check passes; VERIFY_DRY_RUN=1 there
// runs it without. The routes are Sourcify's own documentation, /server/openapi.json (APIv2 2.1.0, read 2026-11-14):
//   POST /v2/verify/{chainId}/{address}   {stdJsonInput, compilerVersion, contractIdentifier, creationTransactionHash}
//                                         202 {verificationId}; 409 already_verified; 429 or 5xx: back off and retry
//   GET  /v2/verify/{verificationId}      {isJobCompleted, error?, contract: {match, runtimeMatch, creationMatch}}
//   GET  /v2/contract/{chainId}/{address} {match, runtimeMatch, creationMatch}: "exact_match", "match" or null
//
// 1. The input. It compiles the five contracts alone, with the project's settings and remappings, into a scratch
//    folder (`forge build <five paths> --force --build-info`), so contracts/out is untouched. The metadata hash of a
//    contract covers its own sources, the settings and every remapping, not the other files of a build, so this input
//    gives the same creation code as the full build the deploy used [measured on 2026-11-14: all five byte for byte]
//    and takes seconds where the full build takes minutes. The checkout must hold the record's commit for the build's
//    inputs, and on Sepolia every submodule, recursively: a checkout of fewer submodules has fewer remappings and gets
//    only a partial match (T-383, measured).
// 2. The check, before anything is sent: each contract's runtime code on the chain against the compiled code, the
//    immutables zeroed on both sides, and its creation transaction's input against the compiled creation code. It
//    prints `exact` (both, metadata included), `code only` (the metadata differs: Sourcify would give a partial match)
//    or `DIFFERS`. Nothing is sent unless all five are `exact`.
// 3. With --submit: the beacon first, then the other four, one at a time; the first refusal stops the run. Then one
//    lookup per address, and one line per contract saying whether Sourcify holds an exact match. It exits 0 only when
//    all five are exact_match for both the runtime and the creation code.
//
// Sepolia goes to https://sourcify.dev/server, fixed. A rehearsal on the local chain (31337) may name a stand-in server
// on this machine with --sourcify, and only there; a fork of Sepolia on a local node cannot submit at all, since the
// contracts it holds do not exist on Sepolia. The RPC URL is never printed: a hosted one may carry its key. The
// User-Agent names this tool and no project (`docs/writing.md`, privacy). The only network calls are the RPC's reads
// and, with --submit, Sourcify.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEPOLIA = 11155111;
export const LOCAL = 31337;
export const SOURCIFY = 'https://sourcify.dev/server';
export const USER_AGENT = 'sourcify-v2-verify/1.0';
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

/**
 * The five contracts the deploy script creates, in the order they are sent: the beacon first, so a refusal costs one
 * request. The identifiers are the `*_ID` lines of contracts/script/deploy-sepolia.sh (a test holds them equal); `at`
 * picks the address and the creation transaction out of the record.
 */
export const CONTRACTS = [
  { name: 'DrandQuicknetBeacon', id: 'src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon', at: (r) => r.contracts.DrandQuicknetBeacon },
  { name: 'AuthCaptureEscrow', id: 'lib/commerce-payments/src/AuthCaptureEscrow.sol:AuthCaptureEscrow', at: (r) => r.contracts.AuthCaptureEscrow },
  { name: 'ERC3009PaymentCollector', id: 'lib/commerce-payments/src/collectors/ERC3009PaymentCollector.sol:ERC3009PaymentCollector', at: (r) => r.contracts.ERC3009PaymentCollector },
  { name: 'TestUSDC', id: 'script/TestUSDC.sol:TestUSDC', at: (r) => r.token },
  { name: 'HoldbackRules', id: 'src/HoldbackRules.sol:HoldbackRules', at: (r) => r.contracts.HoldbackRules },
];

/** The build's inputs, as contracts/script/deploy-sepolia.sh names them (BUILD_INPUTS), from the repository root. */
export const BUILD_INPUTS = ['contracts/src', 'contracts/lib', 'contracts/foundry.toml', 'contracts/remappings.txt', 'contracts/script/TestUSDC.sol'];

const hex = (s) => String(s).replace(/^0x/, '').toLowerCase();

/** `code` (hex, no 0x) with each immutable's bytes set to zero; `refs` is solc's immutableReferences. */
export function zeroImmutables(code, refs = {}) {
  let out = code;
  for (const ranges of Object.values(refs)) {
    for (const { start, length } of ranges) out = out.slice(0, start * 2) + '0'.repeat(length * 2) + out.slice((start + length) * 2);
  }
  return out;
}

/** `code` (hex, no 0x) without solc's CBOR metadata tail, whose length is the last two bytes. */
export function stripMetadata(code) {
  if (code.length < 4) return code;
  const n = Number.parseInt(code.slice(-4), 16);
  const cut = (n + 2) * 2;
  return cut <= code.length ? code.slice(0, code.length - cut) : code;
}

/**
 * The local verdict for one contract: `exact` when the runtime code (immutables zeroed) and the creation code both
 * equal the build's, metadata included; `code only` when only the metadata differs; otherwise `DIFFERS`.
 */
export function compare({ runtime, creationInput, built }) {
  const refs = built.immutableReferences ?? {};
  const got = zeroImmutables(hex(runtime), refs);
  const want = zeroImmutables(hex(built.runtime), refs);
  const creation = hex(creationInput);
  const runtimeExact = got === want;
  const creationExact = creation.startsWith(hex(built.creation));
  if (runtimeExact && creationExact) return 'exact';
  if (stripMetadata(got) === stripMetadata(want)) return 'code only';
  return 'DIFFERS';
}

/** A Sourcify lookup's answer, in one plain line. */
export function matchLine(name, address, c) {
  const exact = c?.runtimeMatch === 'exact_match' && c?.creationMatch === 'exact_match';
  const what = exact ? 'exact match on Sourcify' : c?.match ? 'NOT an exact match on Sourcify' : 'NOT verified on Sourcify';
  return { exact, line: `${name} ${address}: ${what} (runtime ${c?.runtimeMatch ?? 'none'}, creation ${c?.creationMatch ?? 'none'})` };
}

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** A development node (anvil, Hardhat, Ganache): on chain 11155111 it is a fork of Sepolia, never Sepolia itself. */
export const isDevNode = (clientVersion) => /^(anvil|hardhat|ganache)/i.test(String(clientVersion ?? ''));

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** The reasons, if any, why `root`'s checkout cannot give the record's build. */
export function checkoutProblems(root, commit, { needAllSubmodules }) {
  const problems = [];
  if (!git(root, ['cat-file', '-e', `${commit}^{commit}`]).ok) return [`the record's commit ${commit} is not in this checkout`];
  if (!git(root, ['diff', '--quiet', commit, '--', ...BUILD_INPUTS]).ok) problems.push(`contracts/src, lib, the build config or TestUSDC differ from ${commit}`);
  if (git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...BUILD_INPUTS]).out) problems.push('contracts/src, lib, the build config or TestUSDC have uncommitted changes');
  if (needAllSubmodules) {
    const s = git(root, ['submodule', 'status', '--recursive']);
    const missing = s.out.split('\n').filter((l) => /^[-+U]/.test(l));
    if (!s.ok || missing.length) problems.push(`${missing.length || 'the'} submodules are not checked out at their commits, recursively: run \`git submodule update --init --recursive\` (a checkout of fewer submodules has fewer remappings and gets only a partial match)`);
  }
  return problems;
}

/** Compiles the five contracts alone into a scratch folder; returns the one build-info file's compile job. */
export function buildFive(root, log) {
  const work = mkdtempSync(join(tmpdir(), 'sourcify-verify-'));
  try {
    const paths = [...new Set(CONTRACTS.map((c) => c.id.split(':')[0]))];
    log(`sourcify-verify: compiling the ${CONTRACTS.length} contracts alone, with the project's settings, into a scratch folder`);
    const r = spawnSync('forge', ['build', ...paths, '--force', '--build-info', '--build-info-path', join(work, 'bi'), '--out', join(work, 'out'), '--cache-path', join(work, 'cache')], { cwd: join(root, 'contracts'), encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`forge build failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-5).join(' ')}`);
    const files = readdirSync(join(work, 'bi')).filter((f) => f.endsWith('.json'));
    if (files.length !== 1) throw new Error(`the build made ${files.length} compile jobs, not 1; Sourcify takes one job per request`);
    return JSON.parse(readFileSync(join(work, 'bi', files[0]), 'utf8'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The compiled code and the full compiler version of each contract, from a build-info file's output. */
export function builtFrom(buildInfo) {
  const out = {};
  for (const c of CONTRACTS) {
    const [file, name] = c.id.split(':');
    const o = buildInfo.output?.contracts?.[file]?.[name];
    if (!o) throw new Error(`the build has no ${c.id}`);
    out[c.name] = {
      creation: o.evm.bytecode.object,
      runtime: o.evm.deployedBytecode.object,
      immutableReferences: o.evm.deployedBytecode.immutableReferences ?? {},
      compilerVersion: JSON.parse(o.metadata).compiler.version,
    };
  }
  return out;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** One Sourcify request, backing off on 429 and 5xx as its fair-use terms ask (Retry-After, or doubling from 5 s). */
async function sourcify(base, path, init, { fetchImpl, pause, tries = 5 }) {
  for (let i = 0; ; i++) {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers: { 'user-agent': USER_AGENT, ...(init?.headers ?? {}) } });
    if ((res.status === 429 || res.status >= 500) && i + 1 < tries) {
      const after = Number(res.headers.get('retry-after'));
      await pause(Number.isFinite(after) && after > 0 ? after * 1000 : 5000 * 2 ** i);
      continue;
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 200) };
    }
    return { status: res.status, body };
  }
}

/** Sends one contract and waits for its job. Returns a line to print, and whether to go on. */
export async function submitOne({ base, chainId, contract, address, tx, input, compilerVersion, fetchImpl = fetch, pause = sleep, pollMs = 5000, polls = 120 }) {
  const body = { stdJsonInput: input, compilerVersion, contractIdentifier: contract.id, creationTransactionHash: `0x${hex(tx)}` };
  const sent = await sourcify(base, `/v2/verify/${chainId}/${address}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { fetchImpl, pause });
  if (sent.status === 409) return { ok: true, line: `  ${contract.name}: already verified (${sent.body.customCode ?? 'already_verified'})` };
  if (sent.status !== 202 || !sent.body.verificationId) return { ok: false, line: `  ${contract.name}: refused, status ${sent.status}: ${sent.body.customCode ?? ''} ${sent.body.message ?? ''}`.trimEnd() };
  const id = sent.body.verificationId;
  for (let i = 0; i < polls; i++) {
    await pause(pollMs);
    const job = await sourcify(base, `/v2/verify/${id}`, { method: 'GET' }, { fetchImpl, pause });
    if (job.status !== 200 || !job.body.isJobCompleted) continue;
    if (job.body.error) return { ok: false, line: `  ${contract.name}: failed, ${job.body.error.customCode}: ${job.body.error.message} (job ${id})` };
    return { ok: true, line: `  ${contract.name}: verified, runtime ${job.body.contract?.runtimeMatch ?? 'none'}, creation ${job.body.contract?.creationMatch ?? 'none'} (job ${id})` };
  }
  return { ok: false, line: `  ${contract.name}: job ${id} did not complete within ${Math.round((polls * pollMs) / 1000)} s` };
}

export function parseArgs(argv) {
  const a = { submit: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--submit') a.submit = true;
    else if (['--record', '--rpc', '--root', '--sourcify'].includes(k)) {
      if (argv[i + 1] === undefined) throw new Error(`${k} needs a value`);
      a[k.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument ${k}`);
  }
  if (!a.record || !a.rpc) throw new Error('usage: node scripts/sourcify-verify.mjs --record <record.json> --rpc <rpc-url> [--root <checkout>] [--submit]');
  return a;
}

/**
 * The whole run; returns the exit code. `buildInfo` (a parsed build-info file) skips the compile, for tests; `fetchImpl`
 * and `pause` reach Sourcify.
 */
export async function main(argv, { log = console.log, fetchImpl = fetch, pause = sleep, buildInfo, pollMs } = {}) {
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    log(`sourcify-verify: ${e.message}`);
    return 2;
  }
  const say = (l) => log(`sourcify-verify: ${l}`);
  const root = resolve(a.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const record = JSON.parse(readFileSync(a.record, 'utf8'));
  let chainId;
  let client;
  try {
    chainId = Number.parseInt(await rpc(a.rpc, 'eth_chainId', []), 16);
    client = await rpc(a.rpc, 'web3_clientVersion', []).catch(() => '');
  } catch (e) {
    say(`reading the chain failed: ${e.message}`);
    return 1;
  }
  if (chainId !== Number(record.chainId)) return say(`the RPC serves chain ${chainId}, but the record is for chain ${record.chainId}`), 1;
  const fork = chainId === SEPOLIA && isDevNode(client);
  if (chainId === LOCAL && !LOOPBACK.test(a.rpc)) return say(`chain ${LOCAL} is a rehearsal on this machine only; the RPC URL is not a local RPC (http://127.0.0.1 or http://localhost)`), 1;
  if (chainId !== SEPOLIA && chainId !== LOCAL) return say(`chain ${chainId} is not Sepolia (${SEPOLIA}), nor the local chain (${LOCAL}) for a rehearsal`), 1;
  let base = SOURCIFY;
  if (a.sourcify !== undefined) {
    if (chainId !== LOCAL || !LOOPBACK.test(a.sourcify)) return say(`--sourcify names a stand-in server, on this machine and for the local chain only; Sepolia goes to ${SOURCIFY}`), 1;
    base = a.sourcify.replace(/\/$/, '');
  }
  if (a.submit && fork) return say('this RPC is a development node forking Sepolia: its contracts do not exist on Sepolia, so nothing is sent; run without --submit'), 1;
  if (a.submit && chainId === LOCAL && a.sourcify === undefined) return say('no explorer serves the local chain: a rehearsal submits only to a stand-in named by --sourcify'), 1;

  if (!buildInfo) {
    const problems = checkoutProblems(root, record.commit, { needAllSubmodules: chainId === SEPOLIA && !fork });
    if (problems.length) {
      for (const p of problems) say(p);
      return 1;
    }
    try {
      buildInfo = buildFive(root, log);
    } catch (e) {
      say(e.message);
      return 1;
    }
  }
  const built = builtFrom(buildInfo);
  const input = { language: buildInfo.input.language, sources: buildInfo.input.sources, settings: buildInfo.input.settings };

  // The check, before anything is sent.
  say(`checking the ${CONTRACTS.length} contracts of the record at ${record.commit} against the chain (${chainId}); nothing is sent`);
  const rows = [];
  for (const c of CONTRACTS) {
    const at = c.at(record);
    if (!at?.address || !at?.tx) return say(`the record has no address or creation transaction for ${c.name}`), 1;
    const [runtime, txn, receipt] = await Promise.all([rpc(a.rpc, 'eth_getCode', [at.address, 'latest']), rpc(a.rpc, 'eth_getTransactionByHash', [at.tx]), rpc(a.rpc, 'eth_getTransactionReceipt', [at.tx])]);
    if (!receipt || receipt.status !== '0x1' || hex(receipt.contractAddress ?? '') !== hex(at.address)) return say(`${c.name}: the record's transaction ${at.tx} did not create ${at.address}`), 1;
    const verdict = compare({ runtime, creationInput: txn.input, built: built[c.name] });
    rows.push({ c, at, verdict });
    log(`${c.name} ${at.address}: ${verdict}`);
  }
  if (rows.some((r) => r.verdict !== 'exact')) {
    say('not every contract is exact, so nothing is sent: `code only` means another metadata hash, most often a checkout without `--recursive` submodules or another commit');
    return 1;
  }
  if (!a.submit) {
    say(`all ${rows.length} are exact; check only, nothing was sent to Sourcify (--submit sends them)`);
    return 0;
  }

  // The submissions: one at a time, the first refusal stops the run.
  say(`sending ${rows.length} contracts to ${base === SOURCIFY ? 'Sourcify' : 'the stand-in Sourcify server'}, one at a time`);
  for (const { c, at } of rows) {
    const r = await submitOne({ base, chainId, contract: c, address: at.address, tx: at.tx, input, compilerVersion: built[c.name].compilerVersion, fetchImpl, pause, ...(pollMs !== undefined ? { pollMs } : {}) });
    log(r.line);
    if (!r.ok) {
      say(`stopped at ${c.name}: the contracts after it were not sent`);
      return 1;
    }
  }

  // What Sourcify holds now, per contract.
  let all = true;
  for (const { c, at } of rows) {
    const got = await sourcify(base, `/v2/contract/${chainId}/${at.address}`, { method: 'GET' }, { fetchImpl, pause });
    const m = matchLine(c.name, at.address, got.status === 200 ? got.body : null);
    all &&= m.exact;
    log(m.line);
  }
  say(all ? `all ${rows.length} contracts are an exact match on Sourcify` : 'not every contract is an exact match on Sourcify: read the lines above');
  return all ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`sourcify-verify: ${e.message}`);
    process.exit(1);
  });
}
