// The round's driver runs as Rafa runs it: a separate Node process that reaches the operators over HTTP only and
// derives its keys from E2E_SEPOLIA_SEED. The operators here are the public demo's own world (apps/demo-cloud, the
// code the live nodes run) served in this process on two origins: on SimChain always, and on the contracts deployed
// to anvil, as Sepolia's stand-in, when anvil and `forge build` output are present (as apps/demo-cloud/src/live.test.ts).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, roundKey } from './e2e-keys.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const root = here('../');
/** The demo's fee: 1 bp, minimum 0.01 test token. Short windows keep each scenario to seconds. */
const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' };
const WORLD = { minWindowSec: 4, faucetPerClient: 100 };

/** The world as two nodes: http://127.0.0.1:<port> is node 0, http://localhost:<port> node 1 (as try.test.ts). */
async function serve(world: PublicWorld, tickMs: number): Promise<{ urls: [string, string]; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node: host.startsWith('localhost') ? 1 : 0, origin: `http://${host}`, client: req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
  const loop = (async () => {
    while (ticking) {
      await world.work();
      await new Promise((r) => setTimeout(r, tickMs));
    }
  })();
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

type Run = { code: number | null; out: string };
function driver(args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['E2E_SEPOLIA_SEED', 'HOLDBACK_DEPLOYMENT', 'SEPOLIA_RPC_URL'].includes(k)));
    const child = spawn(process.execPath, [here('./e2e-round.ts'), ...args], { env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

/** The run folder a driver run wrote, and its JSON records by scenario. */
function results(out: string): { folder: string; byId: Record<string, J> } {
  const [folder] = readdirSync(out).map((d) => join(out, d));
  const byId = Object.fromEntries(readdirSync(folder!).filter((f) => /^\w+\.json$/.test(f) && f !== 'finality.json').map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(folder!, f), 'utf8'))]));
  return { folder: folder!, byId };
}

/** Neither the seed nor any key derived from it appears in what the driver printed or wrote. */
function expectNoSecrets(seed: string, out: string, folder: string): void {
  const files = readdirSync(folder).map((f) => readFileSync(join(folder, f), 'utf8'));
  for (const secret of [seed, ...ROLES.map((r) => roundKey(seed, r))]) {
    const bare = secret.slice(2).toLowerCase();
    expect(out.toLowerCase()).not.toContain(bare);
    for (const f of files) expect(f.toLowerCase()).not.toContain(bare);
  }
}

describe('e2e-round.ts', () => {
  it('lists every scenario with what it waits for', async () => {
    const r = await driver(['list'], {});
    expect(r.code, r.out).toBe(0);
    for (const id of ['1', '2', '3a', '3b', '3c', '3d', '4', '5a', '5b', '6', '7', '8', '9', '10', '11']) expect(r.out).toMatch(new RegExp(`^  ${id} +\\S`, 'm'));
    expect(r.out).toMatch(/^ {2}4 +Fallback when the primary is silent \(API\); waits for T-217, T-221$/m);
  });

  it('refuses to run without the seed, before any network call', async () => {
    const r = await driver(['run', '1'], { HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/E2E_SEPOLIA_SEED is not set/);
  });

  describe('against the demo world on SimChain', () => {
    let demo: Awaited<ReturnType<typeof serve>>;
    beforeAll(async () => {
      demo = await serve(await PublicWorld.open({ storage: new MemoryStorage(), env: ENV, ...WORLD }), 100);
    });
    afterAll(() => demo.close());

    it('runs scenarios 1, 2, 3a, 3d, 6 and 10, records 3b as waiting, fails 1 only on its scripted panel, and prints no key', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-round-'));
      const r = await driver(['run', '1', '2', '3a', '3b', '3d', '6', '10'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });
      const { folder, byId } = results(out);
      expect(r.out).toMatch(/^results: 1 fail, 2 pass, 3a pass, 3b waits, 3d pass, 6 pass, 10 pass$/m);
      expect(r.code, r.out).toBe(1);
      // Scenario 1 asks for a live panel; this world has no model keys, so its judges are scripted and the run says so.
      expect(byId['1'].checks.filter((c: J) => !c.ok).map((c: J) => c.name)).toEqual(['a live panel judged']);
      // Released, the buyer opened the work, both homepage runs passed, both operators agree.
      expect(byId['1'].deals[0].buyerOpened).toBe(true);
      expect(byId['1'].checks.map((c: J) => c.name)).toEqual(expect.arrayContaining(['the homepage command passes relayed by ' + new URL(demo.urls[0]).origin, 'the homepage command passes relayed by ' + new URL(demo.urls[1]).origin]));
      // Scenario 2 relays through the second node; no key reaches the buyer.
      expect(byId['2'].deals[0].relay).toBe(new URL(demo.urls[1]).origin);
      expect(byId['2'].checks.find((c: J) => c.name === 'no key reaches the buyer').ok).toBe(true);
      expect(byId['3b']).toMatchObject({ status: 'waits', waitsFor: ['T-221'] });
      expect(readFileSync(join(folder, 'summary.md'), 'utf8')).toMatch(/^\| 2\. Refund on reject \(API\) \| pass \| \d+ of \d+ \|/m);
      expectNoSecrets(seed, r.out, folder);
    }, 300_000);
  });

  // anvil for Sepolia: the T-202 contracts, the world's relayer lanes, a block a second. The settlement packages are
  // reached through apps/demo-cloud, whose dependency they are; examples/ depends only on what an outside agent has.
  const ready = existsSync(join(root, 'contracts/out/HoldbackRules.sol/HoldbackRules.json')) && spawnSync('anvil', ['--version']).status === 0;
  describe.skipIf(!ready)(`against the demo world on anvil${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
    let anvil: J;
    let demo: Awaited<ReturnType<typeof serve>>;
    let deployment: J;
    beforeAll(async () => {
      const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
      const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
      const live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
      anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
      const d = anvil.deployment;
      deployment = {
        chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
        token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
        escrow: d.escrow, erc3009Collector: d.erc3009Collector, permit2Collector: d.permit2Collector, multicall: d.multicall, rules: d.rules, bonds: d.bonds, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
      };
      // anvil's second well-known dev key (public; guards no value): the world's relayer funding lane.
      const chain = new live.LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
      const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { ...ENV, OPERATOR_FEE_GAS: '4700000' }, ...WORLD, live: { chain } });
      demo = await serve(world, 200);
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
    }, 180_000);
    afterAll(async () => {
      await demo?.close();
      await anvil?.stop();
    });

    it('runs scenarios 1, 2, 3a (API and direct), 3d and 10 with every transaction read back from the chain, holds 6 for T-217, then re-reads their blocks', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-round-anvil-'));
      const env = { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out, HOLDBACK_DEPLOYMENT: JSON.stringify(deployment), SEPOLIA_RPC_URL: anvil.rpcUrl };
      // The round's buyer and seller pay their own gas for the direct calls: anvil sets their balances.
      for (const role of ['buyer', 'seller'] as const) {
        await fetch(anvil.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [privateKeyToAccount(roundKey(seed, role)).address, '0xde0b6b3a7640000'] }) });
      }
      const r = await driver(['run', '1', '2', '3a', '3d', '6', '10', '--no-homepage'], env);
      expect(r.out).toMatch(/^results: 1 fail, 2 (pass|fail), 3a pass, 3d pass, 6 waits, 10 pass$/m);
      const { folder, byId } = results(out);
      // anvil 1.0.0's eth_estimateGas sometimes refuses expireAppeal ("gas floor exceeds the gas limit"), so the
      // operator's relay answers 500 and the driver closes the window directly (docs/backlog.md); on Sepolia the run shows it.
      const known = ['a live panel judged', 'appeal-expiry relayed through the API'];
      for (const id of ['1', '2']) for (const c of byId[id].checks.filter((x: J) => !x.ok)) expect(known, `${id}: ${c.name}: ${c.detail}`).toContain(c.name);
      expect(byId['6']).toMatchObject({ status: 'waits', waitsFor: ['T-217'] });
      const steps = (id: string, deal = 0) => byId[id].deals[deal].transactions.map((t: J) => t.steps.join('+'));
      expect(steps('1')).toEqual(expect.arrayContaining([expect.stringContaining('hold.funded'), expect.stringContaining('delivery.submitted'), expect.stringContaining('judgment.decided')]));
      for (const t of byId['1'].deals[0].transactions) expect(Number(t.gasUsed)).toBeGreaterThan(21_000);
      expect(byId['2'].checks.find((c: J) => c.name === 'the decision names the posted delivery (D44)').ok).toBe(true);
      expect(byId['3a'].deals[1].transactions.find((t: J) => t.sentBy === 'round')?.calls[0]?.fn).toBe('reclaim');
      const fin = await driver(['finality', folder], env);
      expect(fin.out).toMatch(/transactions re-read, \d+ in the same block, 0 changed/);
      expect(fin.code, fin.out).toBe(0);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);
  });
});
