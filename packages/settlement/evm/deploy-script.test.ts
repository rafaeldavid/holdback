// The deploy script (contracts/script/deploy-sepolia.sh), rehearsed on a local anvil (T-383). The script runs as Rafa
// runs it on Sepolia: five `forge create` calls from a keystore, the wiring and creation-code checks, and a record,
// written to a file DEPLOY_RECORD names so contracts/deployments/sepolia.json is never touched. Multicall3's canonical
// code is etched at its address first, the same bytes contracts/test/crosscheck/Erc6492Prepare.t.sol pins.
//
// Needs anvil, forge, cast and jq on PATH and `forge build` output in contracts/out; the CI anvil job has all four.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('the local chain id behind a URL that is not exactly a local origin is refused', async () => {
    // The same anvil, reached with user info in the URL: the chain answers 31337, and the script still refuses it.
    const c = await run('bash', [SCRIPT, '--check', chain.rpc.replace('http://', 'http://rehearsal@')], { DEPLOY_RECORD: record });
    expect(c.code).not.toBe(0);
    expect(c.stderr).toContain('is not a local RPC');
    expect(c.stderr).not.toContain('rehearsal@');
  });
});
