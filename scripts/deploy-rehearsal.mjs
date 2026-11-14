// The redeploy, rehearsed whole on a local chain (T-410): steps 2 and 3 of docs/redeploy-contracts.md, each run
// against a local anvil with a throwaway key, each printed with the command it stands for on Sepolia.
//
//   node scripts/deploy-rehearsal.mjs [--runs <n>] [--keep]
//
// It needs anvil, forge, cast and jq on PATH and `forge build` output in contracts/out (it builds when the output is
// missing). Nothing reaches a network: anvil runs on 127.0.0.1, with no fork. No keystore of anyone's is read: it makes
// a new throwaway one in a scratch folder, which it removes at the end (--keep leaves the folder and prints its path).
//
// It works on a copy of the checkout's tracked files, so no file of the checkout changes. The copy starts as if the
// live world were a first local deployment: its contracts/deployments/sepolia.json is that deployment's record, and
// its accepted-token table names that deployment's token for chain 31337. Then, --runs times (default 1), the routine:
//
//   0.4  the runtime hashes of the rules contract and the beacon at this build
//   2.1  the chain id
//   2.2  keep: the live record under its dated name        (scripts/record-copies.mjs keep)
//   2.3  deploy                                             (contracts/script/deploy-sepolia.sh, the copy's record)
//   2.4  the rules contract's EIP-712 domain
//   3.1  the record's copies                                (scripts/record-copies.mjs, without the site rebuild)
//   3.2  the read-only check, and the runtime hashes on the chain against step 0.4's
//   3.3  the source check before Sourcify                   (deploy-sepolia.sh --verify, VERIFY_DRY_RUN=1)
//
// What a local chain cannot show is printed at the end with the step that covers it: the finality wait (anvil mines
// no block between transactions, so the rehearsal takes the latest block), what Sourcify answers, the site rebuild,
// the type checks and tests on the new record, and steps 4 to 11.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keep, recordCopies, trackedFiles, LIVE_RECORD } from './record-copies.mjs';
import { stripMetadata, zeroImmutables } from './sourcify-verify.mjs';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const HASHED = [
  ['HoldbackRules', 'contracts/out/HoldbackRules.sol/HoldbackRules.json', (r) => r.rules],
  ['DrandQuicknetBeacon', 'contracts/out/DrandQuicknetBeacon.sol/DrandQuicknetBeacon.json', (r) => r.beacon],
];

/** The Sepolia command each step stands for, in the runbook's variables (docs/redeploy-contracts.md, "The day's terminal"). */
export const SEPOLIA_COMMANDS = {
  '0.4': 'the runtime-hash loop of docs/redeploy-contracts.md step 0.4, in $W',
  '2.1': 'cast chain-id --rpc-url $D && cast chain-id --rpc-url $R   (each prints 11155111)',
  '2.2': 'node $W/scripts/record-copies.mjs keep --rpc $R',
  '2.3': '$W/contracts/script/deploy-sepolia.sh $D <keystore-file> <password-file>',
  '2.4': "cast call $(jq -r .rules $W/contracts/deployments/sepolia.json) 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])' --rpc-url $R",
  '3.1': 'the --old line step 2.2 printed (it rebuilds the site, then sweeps)',
  '3.2': '$W/contracts/script/deploy-sepolia.sh --check $R',
  '3.3': '$W/contracts/script/deploy-sepolia.sh --verify $R   (sends the five to Sourcify; part of the run\'s go-ahead)',
};

/** What this rehearsal cannot show, and where it is shown instead. */
export const NOT_REHEARSED = [
  'the finality wait: the deploy on Sepolia waits until its last block is finalized, about 13 minutes; here it takes the latest block',
  "Sourcify's answer: step 3.3 on Sepolia; here the source check runs and nothing is sent",
  'the site rebuild of step 3.1, and step 3.4 (forge build, site/check.mjs, typecheck, tests on the new record): run them in $W, or on a fork of Sepolia (step 1.2)',
  'steps 4 to 11: the fork suites, the quiet, the operators, the test agents, the live rounds, the merge, the site, the tag',
];

function freePort() {
  return new Promise((ok, no) => {
    const s = createServer();
    s.unref();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Runs a command to its end and never throws on a non-zero exit. */
function run(cmd, args, { cwd, env = {} } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', no);
    p.on('close', (code) => ok({ code: code ?? -1, stdout, stderr }));
  });
}

async function rpcCall(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** A runtime code's size and SHA-256, the immutables zeroed and the metadata tail cut (T-384's method). */
export function runtimeHash(code, refs) {
  const body = stripMetadata(zeroImmutables(String(code).replace(/^0x/, '').toLowerCase(), refs));
  return `${body.length / 2} bytes ${createHash('sha256').update(Buffer.from(body, 'hex')).digest('hex')}`;
}

/** The whole rehearsal. Returns 0 when every step passes. */
export async function rehearse({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), runs = 1, keepDir = false, log = console.log } = {}) {
  const script = join(root, 'contracts', 'script', 'deploy-sepolia.sh');
  const steps = [];
  const step = (id, title, ok, detail) => {
    steps.push({ id, ok });
    log(`step ${id.padEnd(4)} ${ok ? 'pass' : 'FAIL'}  ${title}${detail ? `: ${detail}` : ''}`);
    if (SEPOLIA_COMMANDS[id]) log(`          on Sepolia: ${SEPOLIA_COMMANDS[id]}`);
    if (!ok) throw new Error(`step ${id} failed`);
  };
  for (const tool of ['anvil', 'forge', 'cast', 'jq']) {
    if (spawnSync(tool, ['--version'], { encoding: 'utf8' }).status !== 0) {
      log(`deploy-rehearsal: ${tool} is not on PATH`);
      return 1;
    }
  }
  if (!existsSync(join(root, HASHED[0][1]))) {
    log('deploy-rehearsal: contracts/out is missing; running forge build');
    const b = await run('forge', ['build'], { cwd: join(root, 'contracts') });
    if (b.code !== 0) {
      log(`deploy-rehearsal: forge build failed: ${b.stderr.trim().split('\n').slice(-3).join(' ')}`);
      return 1;
    }
  }

  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-rehearsal-')));
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--hardfork', 'prague', '--silent'], { stdio: 'ignore' });
  try {
    for (let i = 0; ; i++) {
      try {
        await rpcCall(rpc, 'eth_chainId', []);
        break;
      } catch (e) {
        if (i > 100) throw e;
        await new Promise((ok) => setTimeout(ok, 100));
      }
    }
    // Multicall3's canonical runtime, as contracts/test/crosscheck/Erc6492Prepare.t.sol pins it.
    const pin = /MULTICALL3_CODE\s*=\s*hex"([0-9a-fA-F]+)"/.exec(readFileSync(join(root, 'contracts', 'test', 'crosscheck', 'Erc6492Prepare.t.sol'), 'utf8'));
    if (!pin) throw new Error('Erc6492Prepare.t.sol no longer pins MULTICALL3_CODE');
    await rpcCall(rpc, 'anvil_setCode', [MULTICALL3, `0x${pin[1]}`]);
    // A throwaway keystore, for this chain only.
    const password = join(dir, 'password');
    writeFileSync(password, 'rehearsal only\n');
    mkdirSync(join(dir, 'keys'));
    const made = await run('cast', ['wallet', 'new', join(dir, 'keys'), '--unsafe-password', 'rehearsal only']);
    const address = /0x[0-9a-fA-F]{40}/.exec(made.stdout)?.[0];
    const keystore = join(dir, 'keys', readdirSync(join(dir, 'keys'))[0] ?? '');
    if (made.code !== 0 || !address) throw new Error(`cast wallet new failed: ${made.stderr}`);
    await rpcCall(rpc, 'anvil_setBalance', [address, '0x56bc75e2d63100000']);

    // The copy of the tracked files, whose record stands for the live world.
    const copy = join(dir, 'checkout');
    for (const file of trackedFiles(root)) {
      const from = join(root, file);
      if (!existsSync(from) || statSync(from).isDirectory()) continue; // a submodule
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      cpSync(from, join(copy, file));
    }
    const live = join(copy, LIVE_RECORD);
    const table = join(copy, 'packages', 'settlement', 'evm', 'accepted-tokens.json');
    const env = { DEPLOY_RECORD: live, ACCEPTED_TOKENS: table, DEPLOY_FINALITY: 'latest' };
    const deploy = () => run('bash', [script, rpc, keystore, password], { env });
    log('deploy-rehearsal: a first local deployment stands for the live world');
    const first = await deploy();
    if (first.code !== 0) throw new Error(`the first local deployment failed: ${first.stderr.trim()}`);
    const t = JSON.parse(readFileSync(table, 'utf8'));
    t['31337'] = { address: JSON.parse(readFileSync(live, 'utf8')).token.address, symbol: 'tUSDC', decimals: 6 };
    writeFileSync(table, `${JSON.stringify(t, null, 2)}\n`);

    // Step 0.4, from this build's artifacts.
    const want = {};
    for (const [name, artifact] of HASHED) {
      const a = JSON.parse(readFileSync(join(root, artifact), 'utf8'));
      want[name] = runtimeHash(a.deployedBytecode.object, a.deployedBytecode.immutableReferences);
    }
    step('0.4', 'the runtime hashes at this build', true, HASHED.map(([n]) => `${n} ${want[n]}`).join('; '));

    const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    for (let n = 1; n <= runs; n++) {
      log(`deploy-rehearsal: run ${n} of ${runs}`);
      // Two runs on one day: the clock moves two minutes, so the dated copies get two names.
      await rpcCall(rpc, 'evm_increaseTime', [120]);
      await rpcCall(rpc, 'evm_mine', []);
      const chain = Number.parseInt(await rpcCall(rpc, 'eth_chainId', []), 16);
      step('2.1', 'the chain id', chain === 31337, `${chain}, the local chain (Sepolia's is 11155111)`);
      let dated;
      try {
        dated = keep({ root: copy, rpc, log: () => {} });
      } catch (e) {
        step('2.2', 'keep the live record under its dated name', false, e.message);
      }
      step('2.2', 'keep the live record under its dated name', true, dated);
      const before = JSON.parse(readFileSync(live, 'utf8'));
      const d = await deploy();
      const after = JSON.parse(readFileSync(live, 'utf8'));
      const created = (d.stdout.match(/^deploy-sepolia: created /gm) ?? []).length;
      step('2.3', 'deploy the contracts', d.code === 0 && created === 5 && after.rules !== before.rules && after.commit === head && after.beaconMarginSec !== undefined && after.deployedAt !== undefined,
        d.code === 0 ? `${created} creations; the record's rules contract is ${after.rules}, its commit ${after.commit.slice(0, 7)}` : d.stderr.trim().split('\n').slice(-3).join(' '));
      const domain = await run('cast', ['call', after.rules, 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])', '--rpc-url', rpc]);
      const [, name, version] = domain.stdout.split('\n');
      step('2.4', "the rules contract's EIP-712 domain", domain.code === 0 && name === '"Holdback"', `name ${name}, version ${version}`);
      const copies = [];
      let code;
      try {
        code = recordCopies({ root: copy, oldPath: dated, newPath: LIVE_RECORD, build: false, log: (l) => copies.push(l) });
      } catch (e) {
        copies.push(e.message);
        code = 1;
      }
      step('3.1', "write the record's copies", code === 0, code === 0 ? copies.at(-1)?.replace(/^record-copies: /, '') : copies.join(' | '));
      const check = await run('bash', [script, '--check', rpc], { env });
      const hashes = [];
      for (const [n, artifact, at] of HASHED) {
        const a = JSON.parse(readFileSync(join(root, artifact), 'utf8'));
        hashes.push([n, runtimeHash(await rpcCall(rpc, 'eth_getCode', [at(after), 'latest']), a.deployedBytecode.immutableReferences)]);
      }
      const same = hashes.every(([n, h]) => h === want[n]);
      step('3.2', 'the read-only check, and the runtime hashes on the chain', check.code === 0 && same,
        check.code === 0 ? (same ? "the record matches the chain and the build; both runtime hashes equal step 0.4's" : `a runtime hash differs: ${hashes.map(([n, h]) => `${n} ${h}`).join('; ')}`) : check.stderr.trim());
      const verify = await run('bash', [script, '--verify', rpc], { env: { ...env, VERIFY_DRY_RUN: '1' } });
      const exact = (verify.stdout.match(/: exact$/gm) ?? []).length;
      step('3.3', 'the source check before Sourcify', verify.code === 0 && exact === 5, verify.code === 0 ? `${exact} of 5 exact; nothing was sent` : (verify.stdout + verify.stderr).trim().split('\n').slice(-3).join(' '));
    }
    log('deploy-rehearsal: not shown on a local chain:');
    for (const l of NOT_REHEARSED) log(`  - ${l}`);
    log(`deploy-rehearsal: pass: ${steps.length} steps, ${runs} run(s); nothing was sent to a network`);
    return 0;
  } catch (e) {
    log(`deploy-rehearsal: FAIL: ${e.message}`);
    return 1;
  } finally {
    anvil.kill();
    if (keepDir) log(`deploy-rehearsal: the scratch folder stays at ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let runs = 1;
  let keepDir = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep') keepDir = true;
    else if (argv[i] === '--runs' && /^[1-9]\d*$/.test(argv[i + 1] ?? '')) runs = Number(argv[++i]);
    else {
      console.log('usage: node scripts/deploy-rehearsal.mjs [--runs <n>] [--keep]');
      process.exit(2);
    }
  }
  rehearse({ runs, keepDir }).then((code) => process.exit(code));
}
