// The deploy script (contracts/script/deploy-sepolia.sh), rehearsed on a local anvil (T-383). The script runs as Rafa
// runs it on Sepolia: five `forge create` calls from a keystore, the wiring and creation-code checks, and a record,
// written to a file DEPLOY_RECORD names so contracts/deployments/sepolia.json is never touched. Multicall3's canonical
// code is etched at its address first, the same bytes contracts/test/crosscheck/Erc6492Prepare.t.sol pins.
//
// Needs anvil, forge, cast and jq on PATH and `forge build` output in contracts/out; the CI anvil job has all four.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script with no types
import { rehearse } from '../../../scripts/deploy-rehearsal.mjs';
// @ts-expect-error -- a plain .mjs script with no types
import { CONTRACTS, USER_AGENT } from '../../../scripts/sourcify-verify.mjs';
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
    readonly address = '',
  ) {}

  static async start(extra: string[] = []): Promise<Rehearsal> {
    const port = await freePort();
    const proc = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--hardfork', 'prague', '--silent', ...extra], { stdio: 'ignore' });
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
    return new Rehearsal(rpc, dir, join(keys, file), r.passwordFile, proc, address);
  }

  async rpcCall(method: string, params: unknown[]): Promise<unknown> {
    const res = await fetch(this.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }

  /**
   * The script's deploy mode, writing `record`. anvil mines a block only for a transaction, so its finalized block
   * stays 64 behind; a rehearsal takes `latest` unless a test names DEPLOY_FINALITY.
   */
  deploy(record: string, env: Record<string, string> = {}): Promise<Run> {
    return run('bash', [SCRIPT, this.rpc, this.keystore, this.passwordFile], { DEPLOY_RECORD: record, DEPLOY_FINALITY: 'latest', ...env });
  }

  /** The deployer's mined nonce. */
  async nonce(): Promise<number> {
    return Number(await this.rpcCall('eth_getTransactionCount', [this.address, 'latest']));
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
    // The first creation's block time, which names the record's dated copy (scripts/record-copies.mjs keep).
    expect(r.deployedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
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

  // Source verification (T-410): the committed tool, scripts/sourcify-verify.mjs, through Sourcify's API v2. No test
  // reaches Sourcify: a stand-in server on this machine answers as Sourcify's documentation says it does.
  describe('--verify', () => {
    it('checks the record first, then the five contracts against the chain, and sends nothing under VERIFY_DRY_RUN=1', async () => {
      const r = JSON.parse(readFileSync(record, 'utf8'));
      const v = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, VERIFY_DRY_RUN: '1' });
      expect(v.stderr).toBe('');
      expect(v.code).toBe(0);
      expect(v.stdout).toContain(`${record} matches the chain and the build`);
      for (const [name, address] of [['DrandQuicknetBeacon', r.beacon], ['AuthCaptureEscrow', r.escrow], ['ERC3009PaymentCollector', r.erc3009Collector], ['TestUSDC', r.token.address], ['HoldbackRules', r.rules]]) {
        expect(v.stdout).toContain(`${name} ${address}: exact\n`);
      }
      expect(v.stdout).toContain('dry run: nothing was sent to Sourcify');
    }, 300_000);

    it('names the five contracts with the identifiers the script deploys them under', () => {
      const ids = [...readFileSync(SCRIPT, 'utf8').matchAll(/^[A-Z0-9]+_ID=(\S+)$/gm)].map((m) => m[1]);
      expect(new Set(CONTRACTS.map((c: { id: string }) => c.id))).toEqual(new Set(ids));
      expect(ids).toHaveLength(5);
    });

    /** A stand-in for Sourcify's API v2, on this machine: what it was sent, and what it answers. */
    async function standIn(answers: { conflict?: string[]; partial?: string[]; refuse?: string[] } = {}) {
      const posts: { address: string; body: Record<string, unknown>; agent: string | undefined }[] = [];
      const verified = new Map<string, string>();
      const jobs = new Map<string, string>();
      const read = (req: IncomingMessage) => new Promise<string>((ok) => {
        let b = '';
        req.on('data', (d: Buffer) => (b += d.toString()));
        req.on('end', () => ok(b));
      });
      const server = createHttpServer(async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        const url = req.url ?? '';
        let m = /^\/v2\/verify\/31337\/(0x[0-9a-fA-F]{40})$/.exec(url);
        if (req.method === 'POST' && m) {
          const address = m[1]!.toLowerCase();
          posts.push({ address, body: JSON.parse(await read(req)), agent: req.headers['user-agent'] });
          if (answers.refuse?.includes(address)) return send(400, { customCode: 'no_match', message: 'stand-in refusal', errorId: 'x' });
          if (answers.conflict?.includes(address)) {
            verified.set(address, 'match');
            return send(409, { customCode: 'already_verified', message: 'stand-in', errorId: 'x' });
          }
          const id = `job-${jobs.size + 1}`;
          jobs.set(id, address);
          verified.set(address, answers.partial?.includes(address) ? 'match' : 'exact_match');
          return send(202, { verificationId: id });
        }
        m = /^\/v2\/verify\/(job-\d+)$/.exec(url);
        if (req.method === 'GET' && m && jobs.has(m[1]!)) {
          const kind = verified.get(jobs.get(m[1]!)!);
          return send(200, { isJobCompleted: true, verificationId: m[1], contract: { match: kind, runtimeMatch: kind, creationMatch: kind } });
        }
        m = /^\/v2\/contract\/31337\/(0x[0-9a-fA-F]{40})$/.exec(url);
        if (req.method === 'GET' && m) {
          const kind = verified.get(m[1]!.toLowerCase());
          return kind ? send(200, { match: kind, runtimeMatch: kind, creationMatch: kind, chainId: '31337', address: m[1] }) : send(404, { customCode: 'not_found', message: 'none', errorId: 'x' });
        }
        send(404, { customCode: 'route', message: url, errorId: 'x' });
      });
      const port = await new Promise<number>((ok) => server.listen(0, '127.0.0.1', () => ok((server.address() as { port: number }).port)));
      return { url: `http://127.0.0.1:${port}`, posts, close: () => server.close() };
    }

    it('sends each contract to Sourcify v2 with its creation transaction, and prints an exact match for each', async () => {
      const r = JSON.parse(readFileSync(record, 'utf8'));
      const sourcify = await standIn();
      try {
        const v = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, SOURCIFY_URL: sourcify.url });
        expect(v.stderr).toBe('');
        expect(v.code).toBe(0);
        // The beacon first; then the rest, each with its identifier, its creation transaction and the full compiler version.
        const order = [['DrandQuicknetBeacon', r.beacon, r.contracts.DrandQuicknetBeacon.tx], ['AuthCaptureEscrow', r.escrow, r.contracts.AuthCaptureEscrow.tx], ['ERC3009PaymentCollector', r.erc3009Collector, r.contracts.ERC3009PaymentCollector.tx], ['TestUSDC', r.token.address, r.token.tx], ['HoldbackRules', r.rules, r.contracts.HoldbackRules.tx]];
        expect(sourcify.posts.map((p) => p.address)).toEqual(order.map(([, a]) => a.toLowerCase()));
        for (const [i, [name, address, tx]] of order.entries()) {
          const body = sourcify.posts[i]!.body as { contractIdentifier: string; creationTransactionHash: string; compilerVersion: string; stdJsonInput: Record<string, unknown> };
          expect(body.contractIdentifier.endsWith(`:${name}`)).toBe(true);
          expect(body.creationTransactionHash).toBe(tx.toLowerCase());
          expect(body.compilerVersion).toMatch(/^0\.8\.28\+commit\.[0-9a-f]{8}$/);
          expect(Object.keys(body.stdJsonInput).sort()).toEqual(['language', 'settings', 'sources']);
          expect(sourcify.posts[i]!.agent).toBe(USER_AGENT);
          expect(v.stdout).toContain(`${name} ${address}: exact match on Sourcify (runtime exact_match, creation exact_match)`);
        }
        expect(v.stdout).toContain('deploy-sepolia: the five contracts are an exact match on Sourcify');
      } finally {
        sourcify.close();
      }
    }, 300_000);

    it('says plainly which contract is not an exact match, and fails', async () => {
      const r = JSON.parse(readFileSync(record, 'utf8'));
      const sourcify = await standIn({ conflict: [r.token.address.toLowerCase()], partial: [r.rules.toLowerCase()] });
      try {
        const v = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, SOURCIFY_URL: sourcify.url });
        expect(v.code).not.toBe(0);
        expect(v.stdout).toContain(`TestUSDC ${r.token.address}: NOT an exact match on Sourcify (runtime match, creation match)`);
        expect(v.stdout).toContain(`HoldbackRules ${r.rules}: NOT an exact match on Sourcify (runtime match, creation match)`);
        expect(v.stdout).toContain(`DrandQuicknetBeacon ${r.beacon}: exact match on Sourcify`);
        expect(v.stderr).toContain('Sourcify verification did not end in five exact matches');
      } finally {
        sourcify.close();
      }
    }, 300_000);

    it('stops at the first refusal: the contracts after it are not sent', async () => {
      const r = JSON.parse(readFileSync(record, 'utf8'));
      const sourcify = await standIn({ refuse: [r.escrow.toLowerCase()] });
      try {
        const v = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, SOURCIFY_URL: sourcify.url });
        expect(v.code).not.toBe(0);
        expect(sourcify.posts.map((p) => p.address)).toEqual([r.beacon.toLowerCase(), r.escrow.toLowerCase()]);
        expect(v.stdout).toContain('AuthCaptureEscrow: refused, status 400: no_match stand-in refusal');
        expect(v.stdout).toContain('stopped at AuthCaptureEscrow');
      } finally {
        sourcify.close();
      }
    }, 300_000);

    it('refuses to send a local rehearsal to an explorer, and verifies nothing when the check fails', async () => {
      const live = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record });
      expect(live.code).not.toBe(0);
      expect(live.stderr).toContain('no explorer serves the local chain');
      // A stand-in server not on this machine is refused before anything is sent.
      const away = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: record, SOURCIFY_URL: 'https://sourcify.example' });
      expect(away.code).not.toBe(0);
      expect(away.stdout).toContain('--sourcify names a stand-in server, on this machine and for the local chain only');
      // An argument the record holds, changed: the whole-record comparison refuses, so nothing is verified.
      const wrong = chain.planted(record, 'verify-wrong-argument', (r) => {
        const c = (r['contracts'] as Record<string, { args: string[] }>)['ERC3009PaymentCollector']!;
        c.args = [c.args[0]!, '0x00000000000000000000000000000000000BeEF0'];
      });
      const bad = await chain.run(['--verify', chain.rpc], { DEPLOY_RECORD: wrong, VERIFY_DRY_RUN: '1' });
      expect(bad.code).not.toBe(0);
      expect(bad.stderr).toContain('differs from what the chain and this build give');
      expect(bad.stdout).not.toContain(': exact');
    }, 300_000);
  });

  // The nonce (T-410). On 2026-11-13 a send failed with "replacement transaction underpriced" from a lagging backend.
  // A stand-in for forge fails one creation in a chosen way; the script must settle it from the chain and never create
  // a second copy of a contract: the deployer ends exactly five nonces on, and the record checks.
  describe('a failed send', () => {
    /** A stand-in for forge that fails the first `forge create` of `target` in `mode`, and runs forge otherwise. */
    const shim = (name: string, target: string, mode: 'after' | 'before' | 'foreign' | 'pending') => {
      const file = join(chain.dir, `forge-${name}.sh`);
      const log = join(chain.dir, `forge-${name}.log`);
      const underpriced = 'echo "Error: server returned an error response: error code -32000: replacement transaction underpriced" >&2';
      writeFileSync(file, [
        '#!/usr/bin/env bash',
        `echo "$*" >> '${log}'`,
        `if [[ "$*" == *':${target} '* ]] && [ "$(grep -c ':${target} ' '${log}')" = 1 ]; then`,
        mode === 'after' ? `  forge "$@" >/dev/null 2>&1; ${underpriced}; exit 1` : '',
        mode === 'before' ? `  ${underpriced}; exit 1` : '',
        mode === 'foreign' ? `  cast send '${chain.address}' --value 1 --keystore '${chain.keystore}' --password-file '${chain.passwordFile}' --rpc-url '${chain.rpc}' >/dev/null || exit 9` : '',
        // The creation goes to the pool with mining off, forge reports a failure, and a block comes 4 s later.
        ...(mode === 'pending'
          ? [
              `  n=$(sed -E 's/.*--nonce ([0-9]+).*/\\1/' <<<"$*")`,
              `  cast rpc evm_setAutomine false --rpc-url '${chain.rpc}' >/dev/null || exit 9`,
              `  cast send --nonce "$n" --async --keystore '${chain.keystore}' --password-file '${chain.passwordFile}' --rpc-url '${chain.rpc}' --create "$(forge inspect --root '${join(root, 'contracts')}' 'src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon' bytecode)" >/dev/null || { cast rpc evm_setAutomine true --rpc-url '${chain.rpc}' >/dev/null; exit 9; }`,
              `  ( sleep 4; cast rpc evm_setAutomine true --rpc-url '${chain.rpc}'; cast rpc evm_mine --rpc-url '${chain.rpc}' ) >/dev/null 2>&1 &`,
              `  ${underpriced}; exit 1`,
            ]
          : []),
        'fi',
        'exec forge "$@"',
        '',
      ].join('\n'), { mode: 0o755 });
      return { file, calls: () => readFileSync(log, 'utf8').trim().split('\n') };
    };

    it('the deploy sends each creation at the next nonce, in order', async () => {
      const r = JSON.parse(readFileSync(record, 'utf8'));
      const nonces: number[] = [];
      for (const tx of [r.contracts.AuthCaptureEscrow.tx, r.contracts.ERC3009PaymentCollector.tx, r.contracts.DrandQuicknetBeacon.tx, r.token.tx, r.contracts.HoldbackRules.tx]) {
        nonces.push(Number(((await chain.rpcCall('eth_getTransactionByHash', [tx])) as { nonce: string }).nonce));
      }
      expect(nonces).toEqual([0, 1, 2, 3, 4]);
      expect(deployed.stdout.match(/^deploy-sepolia: created \w+ at 0x[0-9a-fA-F]{40} \(nonce \d+, /gm)).toHaveLength(5);
    });

    it('a send that reached the chain and then failed is taken from the chain, not sent again', async () => {
      const start = await chain.nonce();
      const f = shim('after', 'DrandQuicknetBeacon', 'after');
      const out = join(chain.dir, 'sent-then-failed.json');
      const d = await chain.deploy(out, { DEPLOY_FORGE: f.file, DEPLOY_POLL_SEC: '0' });
      expect(d.code, d.stderr).toBe(0);
      expect(d.stderr).toContain('replacement transaction underpriced');
      expect(d.stderr).toMatch(/the chain holds DrandQuicknetBeacon at 0x[0-9a-fA-F]{40} from nonce \d+ \(0x[0-9a-f]{64}\); nothing is sent again/);
      expect(f.calls().filter((c) => c.includes(':DrandQuicknetBeacon '))).toHaveLength(1);
      expect(await chain.nonce()).toBe(start + 5);
      const c = await chain.check(out);
      expect(c.code, c.stderr).toBe(0);
    }, 300_000);

    it('a send still pending is waited for, then taken from the chain, not sent again', async () => {
      const start = await chain.nonce();
      const f = shim('pending', 'DrandQuicknetBeacon', 'pending');
      const out = join(chain.dir, 'pending.json');
      let d: Run;
      try {
        d = await chain.deploy(out, { DEPLOY_FORGE: f.file, DEPLOY_POLL_SEC: '1' });
      } finally {
        await chain.rpcCall('evm_setAutomine', [true]);
      }
      expect(d.code, d.stderr).toBe(0);
      expect(d.stderr).toContain(`a transaction at nonce ${start + 2} is pending; waiting until it is mined`);
      expect(d.stderr).toMatch(/the chain holds DrandQuicknetBeacon at 0x[0-9a-fA-F]{40} from nonce \d+ \(0x[0-9a-f]{64}\); nothing is sent again/);
      expect(f.calls().filter((c) => c.includes(':DrandQuicknetBeacon '))).toHaveLength(1);
      expect(await chain.nonce()).toBe(start + 5);
      expect((await chain.check(out)).code).toBe(0);
    }, 300_000);

    it('a send that never reached the chain goes again at the same nonce, once', async () => {
      const start = await chain.nonce();
      const f = shim('before', 'ERC3009PaymentCollector', 'before');
      const out = join(chain.dir, 'never-sent.json');
      const d = await chain.deploy(out, { DEPLOY_FORGE: f.file, DEPLOY_POLL_SEC: '0' });
      expect(d.code, d.stderr).toBe(0);
      expect(d.stderr).toContain(`nonce ${start + 1} is unused and nothing is pending; sending ERC3009PaymentCollector again at the same nonce (attempt 2 of 3)`);
      const sends = f.calls().filter((c) => c.includes(':ERC3009PaymentCollector '));
      expect(sends).toHaveLength(2);
      for (const s of sends) expect(s).toContain(` --nonce ${start + 1} `);
      expect(await chain.nonce()).toBe(start + 5);
      expect((await chain.check(out)).code).toBe(0);
    }, 300_000);

    it('another transaction from the deployer stops the run; it writes no record and names its orphans', async () => {
      const f = shim('foreign', 'TestUSDC', 'foreign');
      const out = join(chain.dir, 'foreign.json');
      const d = await chain.deploy(out, { DEPLOY_FORGE: f.file, DEPLOY_POLL_SEC: '0' });
      expect(d.code).not.toBe(0);
      expect(d.stderr).toMatch(/did not create 0x[0-9a-fA-F]{40}: it is not this run's creation of TestUSDC/);
      expect(existsSync(out)).toBe(false);
      expect(d.stderr).toContain('the run stopped before the record was written');
      for (const name of ['AuthCaptureEscrow', 'ERC3009PaymentCollector', 'DrandQuicknetBeacon']) expect(d.stderr).toMatch(new RegExp(`deploy-sepolia: {3}${name} 0x[0-9a-fA-F]{40} in 0x[0-9a-f]{64}`));
      expect(d.stderr).not.toMatch(/deploy-sepolia: {3}TestUSDC /);
    }, 300_000);
  });

  // Finality (T-410): the record pins five creations, so it is written only once the last one's block is final.
  describe('the record waits for finality', () => {
    it('writes no record while the last creation is not finalized, and names the orphans', async () => {
      const out = join(chain.dir, 'not-final.json');
      const d = await chain.deploy(out, { DEPLOY_FINALITY: 'finalized', DEPLOY_POLL_SEC: '1', DEPLOY_FINALITY_WAIT_SEC: '2' });
      expect(d.code).not.toBe(0);
      expect(d.stderr).toMatch(/block \d+ is not finalized after 2 s/);
      expect(existsSync(out)).toBe(false);
      expect(d.stderr.match(/^deploy-sepolia: {3}\w+ 0x/gm)).toHaveLength(5);
    }, 300_000);

    it('waits until the finalized block passes the last creation, then writes the record', async () => {
      const out = join(chain.dir, 'final.json');
      // anvil's finalized block is 64 behind its head; blocks mined beside the run let it pass.
      const miner = setInterval(() => void chain.rpcCall('anvil_mine', ['0x1']).catch(() => {}), 100);
      try {
        const d = await chain.deploy(out, { DEPLOY_FINALITY: 'finalized', DEPLOY_POLL_SEC: '1' });
        expect(d.code, d.stderr).toBe(0);
        expect(d.stdout).toMatch(/waiting until block \d+ is finalized before the checks and the record/);
        expect(d.stdout).toContain(`wrote ${out}`);
      } finally {
        clearInterval(miner);
      }
      expect((await chain.check(out)).code).toBe(0);
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

  // The routine twice, with no hand edit between runs (T-383, "done looks like"), now the rehearsal command (T-410):
  // on a copy of the repository's tracked files, scripts/deploy-rehearsal.mjs runs steps 2.1 to 3.3 of
  // docs/redeploy-contracts.md against its own anvil and prints each step's Sepolia command. What this shows is the
  // chain side: the record, the dated copy, the table and examples/deployments.ts move with no hand edit, and the check
  // and the source check pass each time. The site's pins, the rebuild and a sweep that catches a miss are shown on the
  // Sepolia record by tests/record-copies.test.ts instead.
  it('the rehearsal command runs the whole routine twice on a local chain with no hand edit', async () => {
    const lines: string[] = [];
    const code = await rehearse({ root, runs: 2, log: (l: string) => lines.push(l) });
    const out = lines.join('\n');
    expect(code, out).toBe(0);
    for (const id of ['2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '3.3']) expect(out.match(new RegExp(`^step ${id.replace('.', '\\.')} +pass`, 'gm')), id).toHaveLength(2);
    expect(out).toMatch(/^step 0\.4 +pass/m);
    expect(out).toContain('on Sepolia: $W/contracts/script/deploy-sepolia.sh $D <keystore-file> <password-file>');
    expect(out).toContain('on Sepolia: $W/contracts/script/deploy-sepolia.sh --verify $R');
    // Two dated copies with two names, and both runtime hashes equal at each run.
    const dated = [...out.matchAll(/keep the live record under its dated name: (\S+)/g)].map((m) => m[1]);
    expect(new Set(dated).size).toBe(2);
    expect(out).toContain('deploy-rehearsal: pass: 15 steps, 2 run(s); nothing was sent to a network');
  }, 900_000);

  it('the local chain id behind a URL that is not exactly a local origin is refused', async () => {
    // The same anvil, reached with user info in the URL: the chain answers 31337, and the script still refuses it.
    const c = await run('bash', [SCRIPT, '--check', chain.rpc.replace('http://', 'http://rehearsal@')], { DEPLOY_RECORD: record });
    expect(c.code).not.toBe(0);
    expect(c.stderr).toContain('is not a local RPC');
    expect(c.stderr).not.toContain('rehearsal@');
  });
});

// The chain the script is pointed at (T-410). A development node answering Sepolia's chain id is a fork, a rehearsal
// that never writes the Sepolia record; a node that answers as Sepolia takes no stand-in and no knob; any other chain
// id, mainnet's included, is refused before anything is read or sent. The "Sepolia" here is a local anvil behind a
// proxy that names itself as another client: no test reaches a network.
describe.skipIf(!ready)('the chain the deploy script is pointed at (T-410)', () => {
  let fork: Rehearsal;
  const servers: { close: () => void }[] = [];

  beforeAll(async () => {
    fork = await Rehearsal.start(['--chain-id', '11155111']);
  }, 120_000);
  afterAll(() => {
    fork?.stop();
    for (const s of servers) s.close();
  });

  /** A proxy to the fork that answers `chainId` and `client` in place of anvil's own. */
  async function posingAs(chainId: string, client: string): Promise<string> {
    const server = createHttpServer((req, res) => {
      let b = '';
      req.on('data', (d: Buffer) => (b += d.toString()));
      req.on('end', async () => {
        const call = JSON.parse(b) as { id: number; method: string; params: unknown[] };
        const answer = (result: unknown) => res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
        if (call.method === 'eth_chainId') return answer(chainId);
        if (call.method === 'web3_clientVersion') return answer(client);
        const r = await fetch(fork.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b });
        res.end(await r.text());
      });
    });
    servers.push(server);
    const port = await new Promise<number>((ok) => server.listen(0, '127.0.0.1', () => ok((server.address() as { port: number }).port)));
    return `http://127.0.0.1:${port}`;
  }

  const sepoliaRecord = join(root, 'contracts', 'deployments', 'sepolia.json');
  const untouched = () => readFileSync(sepoliaRecord, 'utf8');

  it('a development node on chain 11155111 is a fork: it needs a scratch record and never names the Sepolia record', async () => {
    const before = untouched();
    const none = await run('bash', [SCRIPT, fork.rpc, fork.keystore, fork.passwordFile], { DEPLOY_RECORD: '', DEPLOY_FINALITY: 'latest' });
    expect(none.code).not.toBe(0);
    expect(none.stderr).toMatch(/a rehearsal on a fork of Sepolia \(anvil\S*\) needs DEPLOY_RECORD/);
    const real = await fork.deploy(sepoliaRecord);
    expect(real.code).not.toBe(0);
    expect(real.stderr).toContain('a rehearsal must not write or check');
    const out = join(fork.dir, 'fork.json');
    const d = await fork.deploy(out);
    expect(d.code, d.stderr).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8')).chainId).toBe(11155111);
    expect(untouched()).toBe(before);
  }, 300_000);

  it('the source tool sends nothing from a fork', async () => {
    const r = await run('node', [join(root, 'scripts', 'sourcify-verify.mjs'), '--record', join(fork.dir, 'fork.json'), '--rpc', fork.rpc, '--submit']);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain('a development node forking Sepolia');
  }, 120_000);

  it('Sepolia takes no stand-in and no knob, before anything is read or written', async () => {
    const before = untouched();
    const sepolia = await posingAs('0xaa36a7', 'reth/v2.11.0');
    for (const knob of ['DEPLOY_FORGE', 'DEPLOY_FINALITY', 'DEPLOY_POLL_SEC', 'DEPLOY_FINALITY_WAIT_SEC', 'SOURCIFY_URL']) {
      const c = await run('bash', [SCRIPT, '--check', sepolia], { DEPLOY_RECORD: '', [knob]: knob === 'DEPLOY_FINALITY' ? 'latest' : '1' });
      expect(c.code, knob).not.toBe(0);
      expect(c.stderr, knob).toContain(`on Sepolia ${knob} is not taken; unset it`);
      const d = await run('bash', [SCRIPT, sepolia, fork.keystore, fork.passwordFile], { DEPLOY_RECORD: '', [knob]: knob === 'DEPLOY_FINALITY' ? 'latest' : '1' });
      expect(d.code, knob).not.toBe(0);
      expect(d.stderr, knob).toContain(`on Sepolia ${knob} is not taken; unset it`);
    }
    const scratch = await run('bash', [SCRIPT, '--check', sepolia], { DEPLOY_RECORD: join(fork.dir, 'fork.json') });
    expect(scratch.stderr).toContain('on Sepolia the record is');
    expect(untouched()).toBe(before);
  }, 300_000);

  it('a mainnet chain id, or any chain but Sepolia and the local one, is refused', async () => {
    for (const [id, dec] of [['0x1', '1'], ['0x2105', '8453'], ['0x4268', '17000']] as const) {
      const other = await posingAs(id, 'Geth/v1.15.0');
      const d = await run('bash', [SCRIPT, other, fork.keystore, fork.passwordFile], { DEPLOY_RECORD: '' });
      expect(d.code, id).not.toBe(0);
      expect(d.stderr, id).toContain(`chain id ${dec} is not Sepolia (11155111), nor the local chain (31337) for a rehearsal`);
      const v = await run('node', [join(root, 'scripts', 'sourcify-verify.mjs'), '--record', sepoliaRecord, '--rpc', other, '--submit']);
      expect(v.code, id).not.toBe(0);
      expect(v.stdout, id).toContain(`the RPC serves chain ${dec}, but the record is for chain 11155111`);
    }
  }, 300_000);
});
