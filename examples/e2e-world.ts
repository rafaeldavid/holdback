// What the round's tests share (T-216): the public demo's own world (apps/demo-cloud, the code the live nodes run)
// served in the test's process on two origins, on SimChain or on the contracts deployed to anvil as Sepolia's
// stand-in; the driver run as a separate process, as Rafa runs it; and the check that no key leaks. Only tests import
// it: e2e-round.test.ts, e2e-adjudicator.test.ts and the scenario groups' tests.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { expect } from 'vitest';
import { MONEY_ROLES, ROLES, roundEncryptionKey, roundKey } from './e2e-keys.ts';
import { serveTwoOrigins } from './two-origins.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
export const root = here('../');
/** The operator fee's variables (ADR-0023, D33), as the World Durable Object reads them. */
export type FeeEnv = { OPERATOR_FEE_BPS?: string; OPERATOR_FEE_MIN?: string; OPERATOR_FEE_MAX?: string; OPERATOR_FEE_GAS?: string };

/**
 * The fee the live operators are deployed with: the fee variables of `apps/demo-cloud/wrangler.op1.jsonc`, whose
 * World serves both nodes (T-392). The round's local worlds run with it, so a local run tests what deploys; at the
 * first pilots' fee of 0 the prepare route returns no fee slot and no fee moves (T-389).
 */
export function deployedFee(file = join(root, 'apps/demo-cloud/wrangler.op1.jsonc')): FeeEnv {
  // JSONC with whole-line comments only; a `//` inside a string (a URL) stays.
  const text = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const vars = (JSON.parse(text) as { vars?: Record<string, string> }).vars ?? {};
  return Object.fromEntries(['OPERATOR_FEE_BPS', 'OPERATOR_FEE_MIN', 'OPERATOR_FEE_MAX', 'OPERATOR_FEE_GAS'].filter((k) => vars[k] !== undefined).map((k) => [k, vars[k]!])) as FeeEnv;
}

/** The round's default world: the deployed fee. Short windows (WORLD) keep each scenario to seconds. */
export const ENV: FeeEnv = deployedFee();

/**
 * An operator that charges (ADR-0023): 1 bp, minimum 0.01 test token, and a gas quote of 4.70 test tokens. Not what
 * Crow's operators deploy for the first pilots; another operator may charge, so one round test keeps this case alive.
 */
export const NONZERO_FEE: FeeEnv = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000', OPERATOR_FEE_GAS: '4700000' };
export const WORLD = { minWindowSec: 4, faucetPerClient: 100 };
/** anvil's default mnemonic, published with Foundry: its accounts guard no value. */
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

export type Served = { urls: [string, string]; requests: string[]; close(): Promise<void> };

/**
 * The world as two nodes: http://127.0.0.1:<port> is node 0, http://localhost:<port> node 1 (as try.test.ts), with its
 * passes every `tickMs`. `requests` lists every write as "METHOD /path", for tests that count what a step sent.
 */
export const serve = (world: PublicWorld, tickMs: number): Promise<Served> => serveTwoOrigins(world, { tickMs });

/** The demo's world on SimChain, served as two nodes. */
export async function simWorld(env: FeeEnv = ENV): Promise<Served> {
  // The round's own harness runs the SimChain-only scenarios here (party appeals, the bond's default compensation), so this
  // world keeps the full protocol; the round's chain leg tests phase one (T-378).
  return serve(await PublicWorld.open({ storage: new MemoryStorage(), env, ...WORLD, simProfile: 'full' }), 100);
}

/** anvil on PATH and `forge build` output: the anvil tests run, else they skip and say why (CI's test shards have neither). */
export const anvilReady = existsSync(join(root, 'contracts/out/HoldbackRules.sol/HoldbackRules.json')) && spawnSync('anvil', ['--version']).status === 0;
export const ANVIL_SKIP = anvilReady ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)';

export type AnvilWorld = Served & { rpcUrl: string; deployment: J; setBalance(address: string, wei: bigint): Promise<void> };

/**
 * anvil for Sepolia: the T-202 contracts, the world's relayer lanes, a block a second. The settlement packages are
 * reached through apps/demo-cloud, whose dependency they are; examples/ depends only on what an outside agent has.
 * Resolves once the world is ready; `close` stops the world and anvil.
 */
export async function anvilWorld(env: FeeEnv = ENV): Promise<AnvilWorld> {
  const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
  const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
  const live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
  const anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
  const d = anvil.deployment;
  const deployment = {
    chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
    token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
    escrow: d.escrow, erc3009Collector: d.erc3009Collector, multicall: d.multicall, rules: d.rules, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
  };
  // anvil's second dev account (from its public default mnemonic; guards no value): the world's relayer funding lane.
  const relayerKey = toHex(mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 1 }).getHdKey().privateKey!);
  // The relays go through the estimate shim: on the phase-one contracts an escalation reserves no bond, so its decide
  // costs less to run than its calldata floor, and anvil 1.0.0 cannot estimate it (Sepolia's nodes can).
  const shim = await estimateShim(anvil.rpcUrl);
  const chain = new live.LiveChain({ deployment, rpcUrls: [shim.url], relayerKey, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env, ...WORLD, live: { chain } });
  const served = await serve(world, 200);
  for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
  return {
    ...served,
    rpcUrl: anvil.rpcUrl,
    deployment,
    // A round key pays its own gas for direct calls and approvals: anvil sets its balance.
    setBalance: async (address, wei) => {
      await fetch(anvil.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [address, toHex(wei)] }) });
    },
    close: async () => {
      await served.close();
      await shim.close();
      await anvil.stop();
    },
  };
}

/**
 * anvil 1.0.0 cannot estimate a call whose calldata floor (EIP-7623, Prague) exceeds its execution gas: it answers "gas
 * floor exceeds the gas limit" (T-217 Decision 11). This JSON-RPC stand-in in front of anvil answers only that error,
 * from eth_call: a revert stays a revert, a success gets 1,000,000 gas (as apps/demo-cloud/test/anvil.ts).
 */
async function estimateShim(upstream: string): Promise<{ url: string; close(): Promise<void> }> {
  type Rpc = { id: number; method: string; params?: unknown[] };
  const forward = (body: unknown) => fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ result?: unknown; error?: { message?: string } }>);
  const one = async (r: Rpc) => {
    const answer = await forward(r);
    if (r.method !== 'eth_estimateGas' || !/gas floor exceeds the gas limit/.test(answer.error?.message ?? '')) return answer;
    const call = await forward({ ...r, method: 'eth_call', params: [r.params?.[0], r.params?.[1] ?? 'latest'] });
    return call.error ? { jsonrpc: '2.0', id: r.id, error: call.error } : { jsonrpc: '2.0', id: r.id, result: '0xf4240' };
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Rpc | Rpc[];
    const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type DriverRun = { code: number | null; out: string };
/** The driver as a separate process, with the environment's own round settings replaced by `env`. */
export function driver(args: string[], env: Record<string, string>): Promise<DriverRun> {
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
export function results(out: string): { folder: string; byId: Record<string, J> } {
  const [folder] = readdirSync(out).map((d) => join(out, d));
  const byId = Object.fromEntries(readdirSync(folder!).filter((f) => /^\w+\.json$/.test(f) && f !== 'finality.json').map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(folder!, f), 'utf8'))]));
  return { folder: folder!, byId };
}

/** Neither the seed nor any key derived from it, signing or x25519, appears in what the driver printed or wrote. */
export function expectNoSecrets(seed: string, out: string, folder: string): void {
  const files = readdirSync(folder).map((f) => readFileSync(join(folder, f), 'utf8'));
  const x25519 = ROLES.map((r) => Buffer.from(roundEncryptionKey(seed, r)));
  for (const k of x25519) for (const text of [out, ...files]) expect(text).not.toContain(k.toString('base64url'));
  for (const secret of [seed, ...ROLES.map((r) => roundKey(seed, r)), ...MONEY_ROLES.map((r) => roundKey(seed, r)), ...x25519.map((k) => `0x${k.toString('hex')}`)]) {
    const bare = secret.slice(2).toLowerCase();
    expect(out.toLowerCase()).not.toContain(bare);
    for (const f of files) expect(f.toLowerCase()).not.toContain(bare);
  }
}
