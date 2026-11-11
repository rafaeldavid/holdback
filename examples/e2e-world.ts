// What the round's tests share (T-216): the public demo's own world (apps/demo-cloud, the code the live nodes run)
// served in the test's process on two origins, on SimChain or on the contracts deployed to anvil as Sepolia's
// stand-in; the driver run as a separate process, as Rafa runs it; and the check that no key leaks. Only tests import
// it: e2e-round.test.ts, e2e-adjudicator.test.ts and the scenario groups' tests.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { expect } from 'vitest';
import { ROLES, roundEncryptionKey, roundKey } from './e2e-keys.ts';
import { serveTwoOrigins } from './two-origins.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
export const root = here('../');
/** The demo's fee: 1 bp, minimum 0.01 test token. Short windows keep each scenario to seconds. */
export const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' };
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
export async function simWorld(): Promise<Served> {
  return serve(await PublicWorld.open({ storage: new MemoryStorage(), env: ENV, ...WORLD }), 100);
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
export async function anvilWorld(): Promise<AnvilWorld> {
  const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
  const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
  const live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
  const anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
  const d = anvil.deployment;
  const deployment = {
    chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
    token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
    escrow: d.escrow, erc3009Collector: d.erc3009Collector, permit2Collector: d.permit2Collector, multicall: d.multicall, rules: d.rules, bonds: d.bonds, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
  };
  // anvil's second dev account (from its public default mnemonic; guards no value): the world's relayer funding lane.
  const relayerKey = toHex(mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 1 }).getHdKey().privateKey!);
  const chain = new live.LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { ...ENV, OPERATOR_FEE_GAS: '4700000' }, ...WORLD, live: { chain } });
  const served = await serve(world, 200);
  for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
  return {
    ...served,
    rpcUrl: anvil.rpcUrl,
    deployment,
    // A round key pays its own gas for direct calls, approvals and bond deposits: anvil sets its balance.
    setBalance: async (address, wei) => {
      await fetch(anvil.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [address, toHex(wei)] }) });
    },
    close: async () => {
      await served.close();
      await anvil.stop();
    },
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
  for (const secret of [seed, ...ROLES.map((r) => roundKey(seed, r)), ...x25519.map((k) => `0x${k.toString('hex')}`)]) {
    const bare = secret.slice(2).toLowerCase();
    expect(out.toLowerCase()).not.toContain(bare);
    for (const f of files) expect(f.toLowerCase()).not.toContain(bare);
  }
}
