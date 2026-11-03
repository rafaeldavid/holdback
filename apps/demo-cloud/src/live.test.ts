// The public world settling on a live chain (D41, ADR-0028), with anvil standing in for Sepolia: a block every
// second at wall-clock time, the T-202 contracts deployed from contracts/out, LiveChain sending from relayer lanes
// derived from one key. examples/try.ts runs a deal against it over HTTP in its own process, as against Sepolia,
// with the deployment pinned through HOLDBACK_DEPLOYMENT. Needs `anvil` on PATH and `forge build` output.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { EvmSettlement, LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { anvilAvailable, EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStorage, PublicWorld } from './index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ready = anvilAvailable() && existsSync(`${root}contracts/out/HoldbackRules.sol/HoldbackRules.json`);
/** anvil's second well-known dev key (public; guards no value): the relayer's funding lane here. */
const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' };

async function serve(world: PublicWorld): Promise<{ urls: [string, string]; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const node = host.startsWith('localhost') ? 1 : 0;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node, origin: `http://${host}`, client: req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
  const loop = (async () => {
    while (ticking) {
      await world.work();
      await new Promise((r) => setTimeout(r, 200));
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

function runTry(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${root}examples/try.ts`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe.skipIf(!ready)(`the public world on a live chain (anvil for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  const storage = new MemoryStorage();
  const chainOf = () => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1 });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSD', decimals: 6 },
      escrow: d.escrow,
      erc3009Collector: d.erc3009Collector,
      permit2Collector: d.permit2Collector,
      multicall: d.multicall,
      rules: d.rules,
      bonds: d.bonds,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
  }, 120_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  it('sets up its adjudicators, runs try.ts to Released with a transaction per money step, and reopens from storage', async () => {
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() } });
    const demo = await serve(world);
    try {
      const status = (await (await fetch(`${demo.urls[0]}/v1/status`)).json()) as { settlement: unknown; domain: { chainId: string; verifyingContract: string } };
      expect(status.settlement).toEqual({ kind: 'chain', chainId: String(anvil.chainId) });
      expect(status.domain.verifyingContract.toLowerCase()).toBe(deployment.rules.toLowerCase());
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
      expect(world.ready()).toBe(true);

      const run = await runTry({ HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.code).toBe(0);
      // The funding (with the operator fee in the same transaction), the delivery and the release: three transactions.
      const chainLines = run.out.split('\n').filter((l) => l.startsWith('chain'));
      expect(chainLines.map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
      for (const l of chainLines) expect(l).toMatch(/0x[0-9a-f]{64}$/);

      const id = /commitment (0x[0-9a-f]{64}) Released/.exec(run.out)![1]!;
      const evm = world.chain as EvmSettlement;
      expect((await evm.stage(id as `0x${string}`)).stage).toBe('Released');
      // The money moved on chain: the seller holds the price, the hold is empty.
      expect(await evm.heldFor(id as `0x${string}`)).toBe(0n);
    } finally {
      await demo.close();
    }

    // A restart (Durable Object eviction): the same storage opens without a replay and serves the same deal.
    const again = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() } });
    expect(again.ready()).toBe(true);
    expect(again.digest()).toBe(world.digest());
    const before = (world.chain as EvmSettlement).log();
    expect((again.chain as EvmSettlement).log()).toEqual(before);
  }, 300_000);

  it('refuses to open a world created on another settlement layer', async () => {
    const sim = new MemoryStorage();
    await PublicWorld.open({ storage: sim, env: {} });
    await expect(PublicWorld.open({ storage: sim, env: {}, live: { chain: chainOf() } })).rejects.toThrow(/settles on sim/);
  });
});

// The same deal against the deployed Sepolia contracts, forked locally by anvil (chain id 11155111, the real
// HoldbackRules, CPP, tUSD and drand verifier), with a test relayer funded on the fork only. Needs network: it runs
// when SEPOLIA_FORK_RPC names a Sepolia RPC and contracts/deployments/sepolia.json exists.
const forkRpc = process.env['SEPOLIA_FORK_RPC'];
const deploymentFile = `${root}contracts/deployments/sepolia.json`;
const forkReady = anvilAvailable() && !!forkRpc && existsSync(deploymentFile);

describe.skipIf(!forkReady)(`the public world on a Sepolia fork${forkReady ? '' : ' (SKIPPED: needs SEPOLIA_FORK_RPC and contracts/deployments/sepolia.json)'}`, () => {
  let anvil: ChildProcess;
  let rpc: string;
  const deployment = forkReady ? (JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile) : (undefined as never);
  beforeAll(async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    anvil = spawn('anvil', ['--fork-url', forkRpc!, '--host', '127.0.0.1', '--port', String(port), '--block-time', '2', '--silent'], { stdio: 'ignore' });
    rpc = `http://127.0.0.1:${port}`;
    const call = (method: string, params: unknown[]) => fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json() as Promise<{ result?: unknown }>);
    for (let i = 0; i < 100 && !(await call('eth_chainId', []).catch(() => ({}))).result; i++) await new Promise((r) => setTimeout(r, 200));
    // The fork's copy of the test relayer gets test ETH; nothing touches the real chain.
    await call('anvil_setBalance', [privateKeyToAccount(RELAYER).address, '0x8ac7230489e80000']);
  }, 60_000);
  afterAll(() => {
    anvil?.kill();
  });

  it('runs try.ts to Released on the deployed contracts', async () => {
    const chain = new LiveChain({ deployment, rpcUrls: [rpc], relayerKey: RELAYER, pollMs: 300, rebroadcastMs: 20_000, mintBatchMs: 300 });
    await chain.verify();
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: ENV, live: { chain } });
    const demo = await serve(world);
    try {
      for (const end = Date.now() + 120_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 500));
      expect(world.ready()).toBe(true);
      const run = await runTry({ HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.out.split('\n').filter((l) => l.startsWith('chain')).map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
    } finally {
      await demo.close();
    }
  }, 300_000);
});
