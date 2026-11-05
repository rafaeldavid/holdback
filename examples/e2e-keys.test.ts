// T-216: the round's keys. No network; the command runs as its own Node process on a temporary file, never on .env.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { MASTER_RESERVE, ROLES, SEED_VAR, SEPOLIA_CHAIN_ID, TOPUP_TARGET, assertSepolia, planTopUps, printable, roundAddresses, roundKey, type Role } from './e2e-keys.ts';

const cli = fileURLToPath(new URL('./e2e-keys.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'e2e-keys-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** `node examples/e2e-keys.ts <args>` with only PATH and `env` in its environment. */
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
const seedLines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith(`${SEED_VAR}=`));
/** Neither the secret nor any key derived from it appears in what a command printed. */
const expectNoSecret = (out: { stdout: string; stderr: string }, seed: string) => {
  const printed = out.stdout + out.stderr;
  expect(printed).not.toContain(seed.slice(2));
  for (const r of ROLES) expect(printed).not.toContain(roundKey(seed, r).slice(2));
};

describe('the round keys', () => {
  const seed = `0x${'11'.repeat(32)}`;

  it('derive one distinct key per role, the same every time', () => {
    const keys = ROLES.map((r) => roundKey(seed, r));
    expect(new Set(keys).size).toBe(ROLES.length);
    expect(ROLES.map((r) => roundKey(seed, r))).toEqual(keys);
    expect(roundKey(`0x${'22'.repeat(32)}`, 'master')).not.toBe(roundKey(seed, 'master'));
  });

  it('refuse a seed that is not 32 bytes of hex', () => {
    expect(() => roundKey('0x1234', 'master')).toThrow(RangeError);
    expect(() => roundKey('11'.repeat(32), 'master')).toThrow(RangeError);
  });

  it('init writes a fresh secret once, never prints it, and prints the master it derives', () => {
    const file = join(dir, 'env');
    const first = run(['init', file]);
    expect(first.status).toBe(0);
    const [line] = seedLines(file);
    const written = line!.slice(SEED_VAR.length + 1);
    expect(written).toMatch(/^0x[0-9a-f]{64}$/);
    expectNoSecret(first, written);
    expect(first.stdout).toContain(roundAddresses(written).master);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = run(['init', file]);
    expect(again.status).toBe(2);
    expect(seedLines(file)).toHaveLength(1);
  });

  it('init appends to an existing file, keeps its lines, and warns when others can read it', () => {
    const file = join(dir, 'existing');
    writeFileSync(file, 'OTHER=1\nKEPT=two', { mode: 0o644 });
    chmodSync(file, 0o644);
    const out = run(['init', file]);
    expect(out.status).toBe(0);
    expect(out.stderr).toContain('readable by other users');
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('OTHER=1\nKEPT=two\n')).toBe(true);
    expect(seedLines(file)).toHaveLength(1);
    expectNoSecret(out, seedLines(file)[0]!.slice(SEED_VAR.length + 1));
  });

  it('init refuses a file that sets the secret in another form', () => {
    for (const line of [`export ${SEED_VAR}=0x${'33'.repeat(32)}`, `  ${SEED_VAR} = 0x${'33'.repeat(32)}`]) {
      const file = join(dir, `form-${line.length}`);
      writeFileSync(file, `A=1\n${line}\n`, { mode: 0o600 });
      expect(run(['init', file]).status).toBe(2);
      expect(readFileSync(file, 'utf8')).toBe(`A=1\n${line}\n`);
    }
  });

  it('init and address read the secret from the environment, and address refuses without one', () => {
    const file = join(dir, 'untouched');
    const loaded = run(['init', file], { [SEED_VAR]: seed });
    expect(loaded.status).toBe(0);
    expect(loaded.stdout).toContain('nothing written');
    expect(() => statSync(file)).toThrow();

    const out = run(['address'], { [SEED_VAR]: seed });
    expect(out.status).toBe(0);
    for (const a of Object.values(roundAddresses(seed))) expect(out.stdout).toContain(a);
    expectNoSecret(out, seed);
    expectNoSecret(loaded, seed);
    expect(run(['address']).status).toBe(1);
  });
});

describe('the top-up from the master', () => {
  const addresses = roundAddresses(`0x${'11'.repeat(32)}`);
  const balances = (master: bigint, others: Partial<Record<Role, bigint>> = {}) =>
    Object.fromEntries(ROLES.map((r) => [r, r === 'master' ? master : (others[r] ?? 0n)])) as Record<Role, bigint>;

  it('brings every empty key up to the target, in role order, and never sends to the master', () => {
    const plan = planTopUps(addresses, balances(2_500_000_000_000_000_000n));
    expect(plan.map((t) => t.role)).toEqual(['buyer', 'seller', 'adjudicator-1', 'adjudicator-2', 'adjudicator-3']);
    expect(plan.every((t) => t.send === TOPUP_TARGET && t.address === addresses[t.role])).toBe(true);
  });

  it('sends only the shortfall, and nothing to a key at or above the target', () => {
    const plan = planTopUps(addresses, balances(2_500_000_000_000_000_000n, { buyer: TOPUP_TARGET, seller: TOPUP_TARGET + 1n, 'adjudicator-1': TOPUP_TARGET - 7n }));
    expect(plan.map((t) => [t.role, t.send])).toEqual([['adjudicator-1', 7n], ['adjudicator-2', TOPUP_TARGET], ['adjudicator-3', TOPUP_TARGET]]);
    expect(planTopUps(addresses, balances(0n, Object.fromEntries(ROLES.map((r) => [r, TOPUP_TARGET]))))).toEqual([]);
  });

  it('refuses, planning nothing, when the master cannot cover the top-ups and keep its reserve', () => {
    const need = TOPUP_TARGET * 5n + MASTER_RESERVE;
    expect(planTopUps(addresses, balances(need))).toHaveLength(5);
    expect(() => planTopUps(addresses, balances(need - 1n))).toThrow(/refusing: the master holds/);
  });

  it('refuses every chain but Sepolia', () => {
    expect(() => assertSepolia(SEPOLIA_CHAIN_ID)).not.toThrow();
    for (const id of [1, 31337, 8453]) expect(() => assertSepolia(id)).toThrow(RangeError);
  });

  it('topup refuses without the secret and with an unknown argument, before any network call', () => {
    expect(run(['topup']).status).toBe(1);
    const out = run(['topup', '--send-all'], { [SEED_VAR]: `0x${'11'.repeat(32)}` });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('topup [--dry-run]');
  });

  it('prints errors without any URL but an Etherscan link', () => {
    expect(printable(new Error('failed: https://eth-sepolia.g.alchemy.com/v2/KEY123 timed out'))).toBe('failed: <rpc url> timed out');
    expect(printable(new Error('reverted: https://sepolia.etherscan.io/tx/0xab'))).toBe('reverted: https://sepolia.etherscan.io/tx/0xab');
  });
});

/** A local JSON-RPC stand-in on 127.0.0.1: `answer` gives a method's result, or an HTTP status to fail with. */
async function rpc(answer: (method: string, params: unknown[]) => { result: unknown } | { status: number }) {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      methods.push(method);
      const a = answer(method, params);
      if ('status' in a) res.writeHead(a.status).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result: a.result }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const close = () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
  // The path stands in for a provider key, which must never be printed.
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2/PLANTED`, methods, close };
}

/** `node examples/e2e-keys.ts topup --dry-run` against `url`, without blocking the stand-in's event loop. */
const dryRun = (url: string) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [cli, 'topup', '--dry-run'], { env: { PATH: process.env['PATH'] ?? '', [SEED_VAR]: `0x${'11'.repeat(32)}`, SEPOLIA_RPC_URL: url } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (status) => done({ status, stdout, stderr }));
  });

describe('the top-up against an RPC', () => {
  it('checks the chain before any other call, and stops on another chain', async () => {
    const node = await rpc((method) => (method === 'eth_chainId' ? { result: '0x1' } : { result: '0x0' }));
    const out = await dryRun(node.url);
    await node.close();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('not Sepolia');
    expect(node.methods).toEqual(['eth_chainId']);
  });

  it('refuses while a transfer from the master is still pending, before reading any balance', async () => {
    const node = await rpc((method, params) =>
      method === 'eth_chainId' ? { result: '0xaa36a7' } : method === 'eth_getTransactionCount' ? { result: params[1] === 'pending' ? '0x5' : '0x4' } : { result: '0x0' });
    const out = await dryRun(node.url);
    await node.close();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('still pending');
    expect(node.methods).not.toContain('eth_getBalance');
    expect(node.methods).not.toContain('eth_sendRawTransaction');
  });

  it('never prints the RPC URL when the RPC fails', async () => {
    const node = await rpc(() => ({ status: 429 }));
    const out = await dryRun(node.url);
    await node.close();
    expect(out.status).toBe(1);
    expect(out.stdout + out.stderr).not.toContain('PLANTED');
    expect(out.stdout + out.stderr).not.toContain('127.0.0.1');
  }, 20_000);
});
