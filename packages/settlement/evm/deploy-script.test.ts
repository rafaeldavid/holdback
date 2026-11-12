// The deploy script (contracts/script/deploy-sepolia.sh), rehearsed on a local anvil (T-383). The script runs as Rafa
// runs it on Sepolia: five `forge create` calls from a keystore, the wiring and creation-code checks, and a record,
// written to a file DEPLOY_RECORD names so contracts/deployments/sepolia.json is never touched. Multicall3's canonical
// code is etched at its address first, the same bytes contracts/test/crosscheck/Erc6492Prepare.t.sol pins.
//
// Needs anvil, forge, cast and jq on PATH and `forge build` output in contracts/out; the CI anvil job has all four.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script with no types
import { recordCopies, trackedFiles } from '../../../scripts/record-copies.mjs';
import { anvilAvailable } from './world.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT = join(root, 'contracts', 'script', 'deploy-sepolia.sh');
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const have = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const ready = anvilAvailable() && have('forge') && have('cast') && have('jq') && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));

/** Multicall3's canonical runtime, as the crosscheck test pins it (fetched read-only from Sepolia there). */
function multicall3Code(): string {
  const src = readFileSync(join(root, 'contracts', 'test', 'crosscheck', 'Erc6492Prepare.t.sol'), 'utf8');
  const m = /MULTICALL3_CODE\s*=\s*hex"([0-9a-fA-F]+)"/.exec(src);
  if (!m) throw new Error('Erc6492Prepare.t.sol no longer pins MULTICALL3_CODE');
  return `0x${m[1]}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command to its end; never throws on a non-zero exit. */
export function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** A local anvil with Multicall3 etched and a funded throwaway keystore: what the script needs to deploy. */
export class Rehearsal {
  private constructor(
    readonly rpc: string,
    readonly dir: string,
    readonly keystore: string,
    readonly passwordFile: string,
    private readonly proc: ReturnType<typeof spawn>,
  ) {}

  static async start(): Promise<Rehearsal> {
    const port = await freePort();
    const proc = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--hardfork', 'prague', '--silent'], { stdio: 'ignore' });
    const rpc = `http://127.0.0.1:${port}`;
    const dir = mkdtempSync(join(tmpdir(), 't383-deploy-'));
    const r = new Rehearsal(rpc, dir, '', join(dir, 'password'), proc);
    for (let i = 0; ; i++) {
      try {
        await r.rpcCall('eth_chainId', []);
        break;
      } catch (e) {
        if (i > 100) throw e;
        await new Promise((ok) => setTimeout(ok, 100));
      }
    }
    await r.rpcCall('anvil_setCode', [MULTICALL3, multicall3Code()]);
    writeFileSync(r.passwordFile, 'rehearsal only\n');
    const keys = join(dir, 'keys');
    mkdirSync(keys);
    const made = await run('cast', ['wallet', 'new', keys, '--unsafe-password', 'rehearsal only']);
    if (made.code !== 0) throw new Error(`cast wallet new failed: ${made.stderr}`);
    const address = /0x[0-9a-fA-F]{40}/.exec(made.stdout)?.[0];
    const file = readdirSync(keys)[0];
    if (!address || !file) throw new Error(`cast wallet new printed no address: ${made.stdout}`);
    await r.rpcCall('anvil_setBalance', [address, '0x56bc75e2d63100000']);
    return new Rehearsal(rpc, dir, join(keys, file), r.passwordFile, proc);
  }

  async rpcCall(method: string, params: unknown[]): Promise<unknown> {
    const res = await fetch(this.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }

  /** The script's deploy mode, writing `record`. */
  deploy(record: string, env: Record<string, string> = {}): Promise<Run> {
    return run('bash', [SCRIPT, this.rpc, this.keystore, this.passwordFile], { DEPLOY_RECORD: record, ...env });
  }

  /** The script with any arguments. */
  run(args: string[], env: Record<string, string> = {}): Promise<Run> {
    return run('bash', [SCRIPT, ...args], env);
  }

  /** The script's read-only check of `record`. */
  check(record: string, env: Record<string, string> = {}): Promise<Run> {
    return run('bash', [SCRIPT, '--check', this.rpc], { DEPLOY_RECORD: record, ...env });
  }

  /** A copy of `record` with `edit` applied, beside it. */
  planted(record: string, name: string, edit: (r: Record<string, unknown>) => void): string {
    const out = join(this.dir, `${name}.json`);
    const r = JSON.parse(readFileSync(record, 'utf8')) as Record<string, unknown>;
    edit(r);
    writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
    return out;
  }

  stop(): void {
    this.proc.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

describe.skipIf(!ready)(`the deploy script on a local chain (T-383)${ready ? '' : ' (SKIPPED: needs anvil, forge, cast, jq and contracts/out)'}`, () => {
  let chain: Rehearsal;
  let record: string;
  let deployed: Run;

  beforeAll(async () => {
    chain = await Rehearsal.start();
    record = join(chain.dir, 'local.json');
    deployed = await chain.deploy(record);
  }, 600_000);

  afterAll(() => chain?.stop());

  it('deploys the five contracts with the beacon margin of 29 s and writes the record', () => {
    expect(deployed.stderr).toBe('');
    expect(deployed.code).toBe(0);
    expect(deployed.stdout).toContain(`wrote ${record}`);
    const r = JSON.parse(readFileSync(record, 'utf8'));
    expect(r.chainId).toBe(31337);
    expect(r.beaconMarginSec).toBe(29);
    expect(r.expiryMarginSec).toBe(86_400);
    expect(r.contracts.HoldbackRules.args).toEqual([r.escrow, r.erc3009Collector, '86400', r.beacon, r.token.address, '29']);
    expect(Object.keys(r.contracts).sort()).toEqual(['AuthCaptureEscrow', 'DrandQuicknetBeacon', 'ERC3009PaymentCollector', 'HoldbackRules']);
  });

  it('--check re-derives the same record from the chain and the build', async () => {
    const c = await chain.check(record);
    expect(c.stderr).toBe('');
    expect(c.code).toBe(0);
    expect(c.stdout).toContain(`${record} matches the chain and the build`);
  }, 300_000);

  it('--check fails on a record whose beacon margin is not the one the script deploys', async () => {
    const wrong = chain.planted(record, 'wrong-margin', (r) => (r['beaconMarginSec'] = 30));
    const c = await chain.check(wrong);
    expect(c.code).not.toBe(0);
    expect(c.stderr).toContain("the record's beaconMarginSec is 30; this script deploys 29");
  }, 300_000);

  /** An accepted-token table with one entry for the local chain. */
  const table = (address: string): string => {
    const file = join(chain.dir, `table-${address.toLowerCase()}.json`);
    writeFileSync(file, JSON.stringify({ '31337': { address, symbol: 'tUSDC', decimals: 6 } }));
    return file;
  };

  it('--check passes when the table, the record and TOKEN() name one token', async () => {
    const r = JSON.parse(readFileSync(record, 'utf8'));
    const c = await chain.check(record, { ACCEPTED_TOKENS: table(r.token.address.toLowerCase()) });
    expect(c.stderr).toBe('');
    expect(c.code).toBe(0);
  }, 300_000);

  it('--check fails on a table that names another token, and names both', async () => {
    const r = JSON.parse(readFileSync(record, 'utf8'));
    const other = '0x00000000000000000000000000000000000BeEF0';
    const c = await chain.check(record, { ACCEPTED_TOKENS: table(other) });
    expect(c.code).not.toBe(0);
    expect(c.stderr).toContain(`the record's token is ${r.token.address}, but Crow's operators accept ${other} on chain 31337`);
  }, 300_000);

  it('--check fails on a table entry for the chain that names no address', async () => {
    const file = join(chain.dir, 'table-no-address.json');
    writeFileSync(file, JSON.stringify({ '31337': { symbol: 'tUSDC', decimals: 6 } }));
    const c = await chain.check(record, { ACCEPTED_TOKENS: file });
    expect(c.code).not.toBe(0);
    expect(c.stderr).toContain("the accepted-token table's entry for chain 31337 names no address");
  }, 300_000);

  it('--check fails on a token address that holds no code', async () => {
    const r = JSON.parse(readFileSync(record, 'utf8'));
    const snapshot = await chain.rpcCall('evm_snapshot', []);
    try {
      await chain.rpcCall('anvil_setCode', [r.token.address, '0x']);
      const c = await chain.check(record);
      expect(c.code).not.toBe(0);
      expect(c.stderr).toContain(`no contract at the token address ${r.token.address}: no deal could fund`);
    } finally {
      await chain.rpcCall('evm_revert', [snapshot]);
    }
  }, 300_000);

  it('--check fails on a record whose token is not the rules contract’s TOKEN()', async () => {
    const other = '0x00000000000000000000000000000000000BeEF0';
    const wrong = chain.planted(record, 'wrong-token', (r) => ((r['token'] as Record<string, unknown>)['address'] = other));
    const c = await chain.check(wrong);
    expect(c.code).not.toBe(0);
    // The rules contract's creation input carries its token, so the creation-code check is the first to refuse.
    expect(c.stderr).toContain('src/HoldbackRules.sol:HoldbackRules: the creation input differs from this build');
  }, 300_000);

  // Explorer verification (T-383 item 4). No explorer serves chain 31337 and no test reaches the network, so the
  // rehearsal prints the commands; what Sourcify and Etherscan answer on Sepolia is untested here.
  describe('--verify', () => {
    const lines = (out: string) => out.split('\n').filter((l) => l.startsWith('deploy-sepolia: would run: '));

    it('checks first, then names each of the five contracts with the record’s constructor arguments, on Sourcify only without a key', async () => {
      const r = JSON.parse(readFileSync(record, 'utf8'));
      const v = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, VERIFY_DRY_RUN: '1', ETHERSCAN_API_KEY: '' });
      expect(v.stderr).toBe('');
      expect(v.code).toBe(0);
      expect(v.stdout).toContain(`${record} matches the chain and the build`);
      const runs = lines(v.stdout);
      expect(runs).toHaveLength(5);
      for (const l of runs) expect(l).toMatch(/ env -u ETHERSCAN_API_KEY forge verify-contract 0x[0-9a-fA-F]{40} \S+ --root \S+ --chain 31337 --watch( --constructor-args 0x[0-9a-f]+)? --verifier sourcify$/);
      const rulesArgs = (await run('cast', ['abi-encode', 'constructor(address,address,uint64,address,address,uint64)', ...r.contracts.HoldbackRules.args])).stdout.trim();
      const collectorArgs = (await run('cast', ['abi-encode', 'constructor(address,address)', ...r.contracts.ERC3009PaymentCollector.args])).stdout.trim();
      expect(runs.find((l) => l.includes(` ${r.rules} src/HoldbackRules.sol:HoldbackRules `))).toContain(`--constructor-args ${rulesArgs} `);
      expect(runs.find((l) => l.includes(` ${r.erc3009Collector} `))).toContain(`--constructor-args ${collectorArgs} `);
      for (const [address, id] of [[r.escrow, 'AuthCaptureEscrow'], [r.beacon, 'DrandQuicknetBeacon'], [r.token.address, 'TestUSDC']]) {
        const l = runs.find((x) => x.includes(` ${address} `));
        expect(l).toContain(`:${id} `);
        expect(l).not.toContain('--constructor-args');
      }
      expect(v.stdout).toContain('dry run: nothing was sent to an explorer');
    }, 300_000);

    it('adds Etherscan when ETHERSCAN_API_KEY is set, and never puts the key on a command line', async () => {
      const key = 'REHEARSAL-NOT-A-KEY';
      const v = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, VERIFY_DRY_RUN: '1', ETHERSCAN_API_KEY: key });
      expect(v.code).toBe(0);
      const runs = lines(v.stdout);
      expect(runs.filter((l) => l.endsWith('--verifier sourcify'))).toHaveLength(5);
      expect(runs.filter((l) => l.endsWith('--verifier etherscan'))).toHaveLength(5);
      expect(v.stdout + v.stderr).not.toContain(key);
    }, 300_000);

    it('refuses to send a local rehearsal to an explorer, and verifies nothing when the check fails', async () => {
      const live = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record });
      expect(live.code).not.toBe(0);
      expect(live.stderr).toContain('no explorer serves the local chain');
      const wrong = chain.planted(record, 'verify-wrong-margin', (r) => (r['beaconMarginSec'] = 30));
      const bad = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: wrong, VERIFY_DRY_RUN: '1' });
      expect(bad.code).not.toBe(0);
      expect(lines(bad.stdout)).toHaveLength(0);
    }, 300_000);
  });

  it('a rehearsal needs DEPLOY_RECORD and never names the Sepolia record', async () => {
    const none = await run('bash', [SCRIPT, '--check', chain.rpc], { DEPLOY_RECORD: '' });
    expect(none.code).not.toBe(0);
    expect(none.stderr).toContain('needs DEPLOY_RECORD');
    // Every spelling of the Sepolia record, and any other file beside it (review of PR 422, H1).
    for (const spelling of [
      join(root, 'contracts', 'deployments', 'sepolia.json'),
      'contracts/deployments/sepolia.json',
      join(root, 'contracts', 'deployments', '.', 'sepolia.json'),
      join(root, 'contracts', 'script', '..', 'deployments', 'sepolia.json'),
      join(root, 'contracts', 'deployments', 'rehearsal.json'),
    ]) {
      const live = await chain.check(spelling);
      expect(live.code, spelling).not.toBe(0);
      expect(live.stderr, spelling).toContain('a rehearsal must not write or check');
    }
    const deployed = await chain.deploy('contracts/deployments/sepolia.json');
    expect(deployed.code).not.toBe(0);
    expect(deployed.stderr).toContain('a rehearsal must not write or check');
  }, 120_000);

  // The routine twice, with no hand edit between runs (T-383, "done looks like"): on a copy of the repository's
  // tracked files, each run copies the record to its dated name, deploys, writes the copies with
  // scripts/record-copies.mjs and checks all three token values. The copy starts as if the live world were a first
  // local deployment: its record is sepolia.json and its table names that deployment's token for chain 31337. The site
  // rebuild is left out here (--no-build); tests/record-copies.test.ts runs it.
  it('runs the whole routine twice on the local chain with no hand edit', async () => {
    const copy = realpathSync(mkdtempSync(join(tmpdir(), 't383-routine-')));
    try {
      for (const file of trackedFiles(root)) {
        const from = join(root, file);
        if (!existsSync(from) || statSync(from).isDirectory()) continue; // a submodule
        mkdirSync(dirname(join(copy, file)), { recursive: true });
        cpSync(from, join(copy, file));
      }
      const live = join(copy, 'contracts', 'deployments', 'sepolia.json');
      const table = join(copy, 'packages', 'settlement', 'evm', 'accepted-tokens.json');
      cpSync(record, live);
      const first = JSON.parse(readFileSync(record, 'utf8'));
      const t = JSON.parse(readFileSync(table, 'utf8'));
      t['31337'] = { address: first.token.address, symbol: 'tUSDC', decimals: 6 };
      writeFileSync(table, `${JSON.stringify(t, null, 2)}\n`);
      const rules = [first.rules];
      for (const day of ['2026-11-20', '2026-11-27']) {
        // 1. The old record keeps its dated name.
        const dated = `contracts/deployments/sepolia-${day}-domain-0.8.json`;
        cpSync(live, join(copy, dated));
        // 2. Deploy, into the copy's record.
        const d = await chain.deploy(live, { ACCEPTED_TOKENS: table });
        expect(d.code, d.stderr).toBe(0);
        expect(d.stdout).toContain('the table names');
        // 3. The record's copies.
        const lines: string[] = [];
        const code = recordCopies({ root: copy, oldPath: dated, newPath: 'contracts/deployments/sepolia.json', build: false, log: (l: string) => lines.push(l) });
        expect(code, lines.join('\n')).toBe(0);
        // 4. The check, now with all three token values.
        const c = await chain.check(live, { ACCEPTED_TOKENS: table });
        expect(c.stderr).toBe('');
        expect(c.code).toBe(0);
        const now = JSON.parse(readFileSync(live, 'utf8'));
        expect(JSON.parse(readFileSync(table, 'utf8'))['31337'].address).toBe(now.token.address);
        expect(readFileSync(join(copy, 'examples', 'deployments.ts'), 'utf8')).toContain(`rules: '${now.rules}',`);
        rules.push(now.rules);
      }
      // Each run is a new deployment, so each is a new world: the Workers name it by the record's rules address.
      expect(new Set(rules.map((r) => r.toLowerCase())).size).toBe(3);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }, 600_000);

  it('the local chain id behind a URL that is not exactly a local origin is refused', async () => {
    // The same anvil, reached with user info in the URL: the chain answers 31337, and the script still refuses it.
    const c = await run('bash', [SCRIPT, '--check', chain.rpc.replace('http://', 'http://rehearsal@')], { DEPLOY_RECORD: record });
    expect(c.code).not.toBe(0);
    expect(c.stderr).toContain('is not a local RPC');
    expect(c.stderr).not.toContain('rehearsal@');
  });
});
