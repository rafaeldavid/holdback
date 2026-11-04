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
import { createPublicClient, encodeFunctionData, http, keccak256, stringToBytes, toHex, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import type { AnyCommitmentTerms } from '@holdback/core';
import { EvmSettlement, GAS_CAP, LiveChain, termsView, type Cursor, type DeploymentFile } from '@holdback/settlement/live';
import { anvilAvailable, EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStorage, PublicWorld } from './index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ready = anvilAvailable() && existsSync(`${root}contracts/out/HoldbackRules.sol/HoldbackRules.json`);
/** anvil's second well-known dev key (public; guards no value): the relayer's funding lane here. */
const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
/** The demo's fee: 1 bp, minimum 0.01 tUSDC plus the 4.70 tUSDC gas quote a chain world adds (D33 as amended). */
const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000', OPERATOR_FEE_GAS: '4700000' };

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

function runTry(env: Record<string, string>, script = 'examples/try.ts'): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${root}${script}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const chainOf = (rpcUrl = anvil.rpcUrl) => new LiveChain({ deployment, rpcUrls: [rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
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
    let id = '0x' as Hex;
    try {
      const status = (await (await fetch(`${demo.urls[0]}/v1/status`)).json()) as { settlement: unknown; domain: { chainId: string; verifyingContract: string } };
      expect(status.settlement).toEqual({ kind: 'chain', chainId: String(anvil.chainId) });
      expect(status.domain.verifyingContract.toLowerCase()).toBe(deployment.rules.toLowerCase());
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
      expect(world.ready()).toBe(true);

      const run = await runTry({ HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.code).toBe(0);
      // The buyer pays the gas in the operator fee: 4.71 tUSDC on a 25 tUSDC deal.
      expect(run.out).toMatch(/^fund +Held: 26 tUSDC held \(25 price \+ 1 adjudication fee\), operator fee 4\.71 tUSDC$/m);
      // The funding (with the operator fee in the same transaction), the delivery and the release: three transactions.
      const chainLines = run.out.split('\n').filter((l) => l.startsWith('chain'));
      expect(chainLines.map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
      for (const l of chainLines) expect(l).toMatch(/0x[0-9a-f]{64}$/);

      id = /commitment (0x[0-9a-f]{64}) Released/.exec(run.out)![1]! as Hex;
      const evm = world.chain as EvmSettlement;
      expect((await evm.stage(id as `0x${string}`)).stage).toBe('Released');
      // The money moved on chain: the seller holds the price, the hold is empty.
      expect(await evm.heldFor(id as `0x${string}`)).toBe(0n);
      // No route serves a key the world holds, the relayer's lanes included.
      const paths = ['/', '/.well-known/holdback.json', '/llms.txt', '/v1/status', '/v1/adjudicators', '/v1/commitments', `/v1/commitments/${id}`, `/v1/commitments/${id}/events?limit=200`, `/v1/commitments/${id}/terms`];
      const bodies = await Promise.all(demo.urls.flatMap((u) => paths.map(async (p) => (await fetch(`${u}${p}`)).text())));
      const secrets = world.secretsForTest().map((s) => s.toLowerCase().replace(/^0x/, ''));
      expect(secrets).toContain(RELAYER.slice(2));
      for (const body of [...bodies, run.out]) for (const s of secrets) expect(body.toLowerCase().includes(s)).toBe(false);
    } finally {
      await demo.close();
    }

    // A restart (Durable Object eviction): the same storage opens without a replay and serves the same deal. Opening
    // reads no chain; the first pass verifies it, and the bonds recorded in storage are not sent again.
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    const again = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() }, onError });
    expect(again.ready()).toBe(false);
    // Setup left: a pass is due in 2 s (T-057). Once set up, the Released deal awaits no adjudicator, but it is still
    // open (its appeal window, then an hour): a pass reads the chain within a minute (T-218).
    expect(again.nextPass()! - Date.now()).toBeGreaterThan(1500);
    expect(again.nextPass()! - Date.now()).toBeLessThanOrEqual(2000);
    await again.work();
    expect(again.ready()).toBe(true);
    expect(again.nextPass()! - Date.now()).toBeLessThanOrEqual(60_000);
    expect(errors).toEqual([]);
    // The pass read the chain since the stored cursor (null when no block came since) and applied nothing twice.
    expect(again.lastSync()?.applied ?? 0).toBe(0);

    // T-218: a call sent straight to the contract shows after one pass. The appeal window closes (anvil's clock and the
    // reopened world's move two minutes on), and a stranger closes it on the contract, past both operators.
    const skew = 120_000;
    await anvil.rpc('evm_increaseTime', [skew / 1000]);
    const later = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() }, now: () => Date.now() + skew, onError });
    const terms =(later.chain as EvmSettlement).log().find((e) => e.commitmentId === id && e.type === 'commitment.offered')!.payload['terms'] as AnyCommitmentTerms;
    const strangerKey = keccak256(stringToBytes('t-218/stranger'));
    const stranger = anvil.wallet(strangerKey);
    await anvil.rpc('anvil_setBalance', [stranger.account!.address, '0x56bc75e2d63100000']);
    // A fixed gas limit: anvil's estimate fails for a cheap call under Prague's calldata floor (sync.test.ts).
    const hash = await stranger.sendTransaction({ account: stranger.account!, chain: foundry, to: deployment.rules as Hex, data: encodeFunctionData({ abi: anvil.abis.rules, functionName: 'expireAppeal', args: [termsView(terms)] }), gas: 3_000_000n });
    const mined = await anvil.receipt(hash);
    expect(mined.status).toBe('success');
    const usage = { ...later.telemetry.usage() };
    const t0 = Date.now();
    await later.work();
    const passMs = Date.now() - t0;
    const state = await (later.chain as EvmSettlement).state(id as `0x${string}`);
    expect(state).toMatchObject({ escrowState: 'Released', appealState: 'expired' });
    expect((later.chain as EvmSettlement).log().at(-1)).toMatchObject({ type: 'appeal.expired', submittedVia: 'direct', payload: { tx: hash } });
    expect(later.lastSync()).toMatchObject({ applied: 1, behind: 0, unknown: 0 });
    // The cursor row moved past the stranger's block, after the books and events.
    expect(BigInt((await storage.get<Cursor>('cursor'))!.block)).toBeGreaterThanOrEqual(mined.blockNumber);
    const busy = { read: later.telemetry.usage().rowsRead - usage.rowsRead, written: later.telemetry.usage().rowsWritten - usage.rowsWritten };
    // An idle pass after it writes no row: no log read, and the cursor row is less than 300 blocks behind.
    const quiet = { ...later.telemetry.usage() };
    await later.work();
    const idle = { read: later.telemetry.usage().rowsRead - quiet.rowsRead, written: later.telemetry.usage().rowsWritten - quiet.rowsWritten };
    expect(idle.written).toBe(0);
    console.log(`T-218 pass with a direct call: ${passMs} ms, rows read ${busy.read}, written ${busy.written}; idle pass: rows read ${idle.read}, written ${idle.written}; ${JSON.stringify(later.lastSync())}`);
    // The deal is final now: no deal is open and no adjudicator has a turn, so no pass is due (T-057 unchanged).
    expect(later.nextPass()).toBeNull();

    // Reopened with the RPC down: each failing setup step doubles the wait (4, 8, 16 s), not a retry every 2 s (T-057 review).
    const down = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf('http://127.0.0.1:9') }, onError: () => {} });
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await down.work();
      waits.push(down.nextPass()! - Date.now());
    }
    expect(down.ready()).toBe(false);
    for (const [i, w] of waits.entries()) {
      expect(w).toBeGreaterThan(4000 * 2 ** i - 500);
      expect(w).toBeLessThanOrEqual(4000 * 2 ** i);
    }
    // A takeover wake whose judgeBy passed during the outage (set by hand: this storage holds no Delivered deal) never
    // schedules a pass in the past, and a failing pass still rereads settlement state (T-057 review 4).
    const inside = down as unknown as { wake: number | null };
    inside.wake = Date.now() - 1000;
    expect(down.nextPass()!).toBeGreaterThan(Date.now());
    await down.work();
    expect(inside.wake).toBeNull();
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
// HoldbackRules, CPP, tUSDC and drand verifier), with a test relayer funded on the fork only. Needs network: it runs
// when SEPOLIA_FORK_RPC names a Sepolia RPC and contracts/deployments/sepolia.json exists. anvil prices gas by Prague,
// and Sepolia charges new state about 3.5 times that (measured 2026-11-03), so every transaction the fork mined is
// replayed through eth_simulateV1 on the real chain (nothing is sent) and must fit under the relayer's gas cap.
const forkRpc = process.env['SEPOLIA_FORK_RPC'];
const deploymentFile = `${root}contracts/deployments/sepolia.json`;
const forkReady = anvilAvailable() && !!forkRpc && existsSync(deploymentFile);

describe.skipIf(!forkReady)(`the public world on a Sepolia fork${forkReady ? '' : ' (SKIPPED: needs SEPOLIA_FORK_RPC and contracts/deployments/sepolia.json)'}`, () => {
  let anvil: ChildProcess;
  let rpc: string;
  let forkBlock: bigint;
  const deployment = forkReady ? (JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile) : (undefined as never);
  beforeAll(async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    // Prague, as Sepolia runs: the drand verifier needs EIP-2537's BLS precompiles (T-206, measured).
    anvil = spawn('anvil', ['--fork-url', forkRpc!, '--hardfork', 'prague', '--host', '127.0.0.1', '--port', String(port), '--block-time', '2', '--silent'], { stdio: 'ignore' });
    rpc = `http://127.0.0.1:${port}`;
    const call = (method: string, params: unknown[]) => fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json() as Promise<{ result?: unknown }>);
    // anvil forks over the public RPC, which can take a while to answer.
    for (let i = 0; i < 300 && !(await call('eth_chainId', []).catch(() => ({}))).result; i++) await new Promise((r) => setTimeout(r, 200));
    const head = await call('eth_blockNumber', []).catch(() => ({ result: undefined }));
    if (typeof head.result !== 'string') throw new Error(`anvil did not fork ${forkRpc} within 60 s`);
    forkBlock = BigInt(head.result);
    // The fork's copy of the test relayer gets test ETH; nothing touches the real chain.
    await call('anvil_setBalance', [privateKeyToAccount(RELAYER).address, '0x8ac7230489e80000']);
  }, 90_000);
  afterAll(() => {
    anvil?.kill();
  });

  it('runs try.ts, then site/walkthrough.mjs following llms.txt literally, to Released on the deployed contracts', async () => {
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
      // The page's own walkthrough: every message built from site/llms.txt alone, under the domain and deployment it pins.
      const walk = await runTry({ OP1: demo.urls[0], OP2: demo.urls[1] }, 'site/walkthrough.mjs');
      expect(walk.out).toMatch(/^walkthrough PASS/m);
      expect(walk.code).toBe(0);
    } finally {
      await demo.close();
    }

    // Setup, faucet, funding, delivery and decision, in the order the fork mined them, on Sepolia's own gas rules.
    const fork = createPublicClient({ transport: http(rpc) });
    const txs: { from: Hex; to: Hex; input: Hex; value: bigint }[] = [];
    for (let b = forkBlock + 1n, latest = await fork.getBlockNumber(); b <= latest; b++) txs.push(...(await fork.getBlock({ blockNumber: b, includeTransactions: true })).transactions.map((t) => ({ from: t.from, to: t.to!, input: t.input, value: t.value })));
    const stateOverrides = Object.fromEntries([...new Set(txs.map((t) => t.from.toLowerCase()))].map((a) => [a, { balance: toHex(10n ** 20n) }]));
    const now = Math.floor(Date.now() / 1000);
    const blockStateCalls = txs.map((t, i) => ({ ...(i === 0 ? { stateOverrides } : {}), blockOverrides: { time: toHex(now + 12 * (i + 1)) }, calls: [{ from: t.from, to: t.to, data: t.input, value: toHex(t.value) }] }));
    const sim = (await (await fetch(forkRpc!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_simulateV1', params: [{ blockStateCalls, validation: false }, 'latest'] }) })).json()) as { result: { calls: { status: string; gasUsed: string }[] }[] };
    const gas = sim.result.map((b) => b.calls[0]!);
    expect(gas.map((c) => c.status)).toEqual(txs.map(() => '0x1'));
    for (const c of gas) expect((BigInt(c.gasUsed) * 5n) / 4n).toBeLessThanOrEqual(GAS_CAP);
    console.log(`Sepolia gas per transaction (eth_simulateV1): ${gas.map((c) => BigInt(c.gasUsed)).join(', ')}`);
  }, 600_000);
});
