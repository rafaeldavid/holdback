// The local EVM world for kind 'local': an anvil process on 127.0.0.1 (chain id 31337), the Holdback contracts
// deployed from `contracts/out` (run `forge build` first), and a snapshot each fresh settlement reverts to.
// Deployment: LocalUSDC (anvil-only test token with ERC-3009), CPP AuthCaptureEscrow v1.1.0 and both collectors,
// LocalMulticall3 (aggregate3, for the operator-fee bundle), then SimBeacon and HoldbackRules (which deploys
// HoldbackBonds). The rules contract's beacon is a constructor immutable and the sim beacon's seed is fixed at
// its deploy, so each fresh settlement reverts to the snapshot taken before those two and redeploys them with its
// genesis simSeed. The deployer's nonce is the same every time, so the rules and bonds addresses never change.
// Permit2 is not deployed: the Permit2 collector points at an address with no code, so only ERC-3009 funding runs.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, toHex, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { Abis, Deployment, EvmChain, Mined } from './chain.js';
import { assertLocalRpc, assertSafeChain } from './guard.js';

export type { Abis, Deployment } from './chain.js';

export const LOCAL_CHAIN_ID = 31337;
/** anvil's first well-known dev key (public; guards no value). Deploys the contracts and relays for 'anyone'. */
export const ANVIL_DEPLOYER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
/** The chain starts here so any scenario clock after it can be mined at its own second. */
const ANVIL_GENESIS_TIME = 1_700_000_000;
/** CPP authorizationExpiry margin after fallbackBy + appealDecideSec (ADR-0025; same as the contract tests). */
export const EXPIRY_MARGIN = 86_400n;

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

/** Reads a forge artifact from contracts/out. */
export function artifact(root: string, file: string, name: string): Artifact {
  const path = join(root, 'contracts', 'out', file, `${name}.json`);
  if (!existsSync(path)) throw new Error(`no artifact ${path}: run \`forge build\` in contracts/ first`);
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
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

/** True when `anvil` is on PATH. */
export function anvilAvailable(): boolean {
  return spawnSync('anvil', ['--version'], { encoding: 'utf8' }).status === 0;
}

/** The sim seed the world's first rules deployment uses; each settlement redeploys with its own. */
const BOOT_SIM_SEED: Hex = `0x${'00'.repeat(32)}`;

/** The gas limit of every anvil transaction: the scenario never runs out, and receipts measure what was used. */
const TX_GAS = 3_000_000n;

export class EvmWorld implements EvmChain {
  readonly chainId = LOCAL_CHAIN_ID;
  readonly clock = 'scenario' as const;
  readonly relayer: Address = privateKeyToAccount(ANVIL_DEPLOYER_KEY).address;
  readonly expiryMargin = EXPIRY_MARGIN;
  private snapshotId: Hex | null = null;

  private constructor(
    readonly rpcUrl: string,
    readonly publicClient: PublicClient,
    readonly deployment: Deployment,
    readonly abis: Abis,
    /** The token's EIP-712 name and version: LocalUSDC's "USD Coin" (CPP's mock), or TestUSDC's "Crow Test USDC". */
    readonly tokenDomain: { name: string; version: string },
    private readonly proc: ChildProcess | null,
    private readonly deployRules: (simSeed: Hex) => Promise<RulesDeployment>,
  ) {}

  /**
   * Starts anvil on a free localhost port and deploys. `root` is the repository root (for contracts/out).
   * `blockTimeSec`: mine a block every so many seconds at wall-clock time instead of one per transaction at the
   * scenario's second, so anvil stands in for a testnet (a LiveChain over `rpcUrl`, ADR-0028). `token`: LocalUSDC
   * (the fixtures') or TestUSDC (the Sepolia demo's tUSDC, D42).
   */
  static async start(root: string, options: { rpcUrl?: string; blockTimeSec?: number; token?: 'local-usdc' | 'test-usdc' } = {}): Promise<EvmWorld> {
    let proc: ChildProcess | null = null;
    let rpcUrl = options.rpcUrl;
    if (!rpcUrl) {
      const port = await freePort();
      const clock = options.blockTimeSec ? ['--block-time', String(options.blockTimeSec)] : ['--timestamp', String(ANVIL_GENESIS_TIME)];
      proc = spawn('anvil', ['--chain-id', String(LOCAL_CHAIN_ID), '--host', '127.0.0.1', '--port', String(port), ...clock, '--hardfork', 'prague', '--silent'], {
        stdio: 'ignore',
      });
      rpcUrl = `http://127.0.0.1:${port}`;
    }
    assertLocalRpc(rpcUrl);
    // No cached block number: evm_revert between settlements moves the head backwards.
    const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl), cacheTime: 0 }) as PublicClient;
    try {
      await waitFor(publicClient);
      const chainId = await publicClient.getChainId();
      assertSafeChain(chainId);
      if (chainId !== LOCAL_CHAIN_ID) throw new RangeError(`kind local expects anvil chain id ${LOCAL_CHAIN_ID}, got ${chainId}`);
      const testUsdc = options.token === 'test-usdc';
      const { base, abis, deployRules } = await deploy(root, rpcUrl, publicClient, testUsdc ? ['TestUSDC.sol', 'TestUSDC'] : ['LocalUSDC.sol', 'LocalUSDC']);
      // Snapshot before the beacon and the rules contract, then deploy them once to learn their addresses.
      const snapshotId = await publicClient.request({ method: 'evm_snapshot' as never, params: [] as never }) as Hex;
      const rules = await deployRules(BOOT_SIM_SEED);
      const tokenDomain = testUsdc ? { name: 'Crow Test USDC', version: '1' } : { name: 'USD Coin', version: '1' };
      const world = new EvmWorld(rpcUrl, publicClient, { ...base, ...rules }, abis, tokenDomain, proc, deployRules);
      world.snapshotId = snapshotId;
      return world;
    } catch (e) {
      proc?.kill();
      throw e;
    }
  }

  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    return (await this.publicClient.request({ method: method as never, params: params as never })) as T;
  }

  /**
   * Reverts the chain to just before the beacon and rules deployment and redeploys both, the sim beacon seeded with
   * `simSeed` (the genesis seed, as SimChain's beacon), so each settlement starts from the same state and addresses.
   */
  async fresh(simSeed: Hex = BOOT_SIM_SEED): Promise<void> {
    if (!this.snapshotId) throw new Error('EvmWorld has no snapshot');
    const ok = await this.rpc<boolean>('evm_revert', [this.snapshotId]);
    if (!ok) throw new Error('anvil refused evm_revert');
    this.snapshotId = await this.rpc<Hex>('evm_snapshot', []);
    const d = await this.deployRules(simSeed);
    if (d.rules !== this.deployment.rules || d.bonds !== this.deployment.bonds || d.beacon !== this.deployment.beacon || d.fromBlock !== this.deployment.fromBlock) {
      throw new Error(`the rules redeployment moved: ${JSON.stringify({ ...d, fromBlock: String(d.fromBlock) })}`);
    }
  }

  wallet(key: Hex): WalletClient {
    return createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(this.rpcUrl) });
  }

  senderFor(): Address {
    return this.relayer;
  }

  /** Simulates on the pending block, mined at the scenario second `at`. */
  async simulate(tx: { from: Address; to: Address; data: Hex }, at?: number): Promise<void> {
    if (at !== undefined) await this.rpc('evm_setNextBlockTimestamp', [at]);
    await this.rpc('eth_call', [{ ...tx, gas: toHex(TX_GAS) }, 'pending']);
  }

  /** Mines the transaction at the scenario second `at`, from `key` or the deployer. */
  async send(tx: { key?: Hex; to: Address; data: Hex; value?: bigint }, at?: number): Promise<Mined> {
    if (at !== undefined) await this.rpc('evm_setNextBlockTimestamp', [at]);
    const wallet = this.wallet(tx.key ?? ANVIL_DEPLOYER_KEY);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to: tx.to, data: tx.data, gas: TX_GAS, ...(tx.value ? { value: tx.value } : {}) });
    const r = await this.publicClient.waitForTransactionReceipt({ hash });
    const timestamp = at ?? Number((await this.publicClient.getBlock({ blockNumber: r.blockNumber })).timestamp);
    return { hash, from: wallet.account!.address, status: r.status, gasUsed: r.gasUsed, blockNumber: r.blockNumber, timestamp, logs: r.logs };
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const p = this.proc;
    await new Promise<void>((resolve) => {
      p.once('exit', () => resolve());
      p.kill();
      setTimeout(resolve, 2000).unref();
    });
  }
}

async function waitFor(client: PublicClient): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('anvil did not start within 10 s');
}

type RulesDeployment = Pick<Deployment, 'rules' | 'bonds' | 'beacon' | 'fromBlock'>;

async function deploy(
  root: string,
  rpcUrl: string,
  client: PublicClient,
  tokenArtifact: [file: string, name: string],
): Promise<{ base: Omit<Deployment, keyof RulesDeployment>; abis: Abis; deployRules: (simSeed: Hex) => Promise<RulesDeployment> }> {
  const wallet = createWalletClient({ account: privateKeyToAccount(ANVIL_DEPLOYER_KEY), chain: foundry, transport: http(rpcUrl) });
  const one = async (a: Artifact, args: unknown[] = []): Promise<Address> => {
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args } as Parameters<typeof wallet.deployContract>[0]);
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== 'success' || !r.contractAddress) throw new Error(`deployment failed: ${hash}`);
    return r.contractAddress;
  };
  const token = artifact(root, ...tokenArtifact);
  const escrowA = artifact(root, 'AuthCaptureEscrow.sol', 'AuthCaptureEscrow');
  const c3009 = artifact(root, 'ERC3009PaymentCollector.sol', 'ERC3009PaymentCollector');
  const cPermit2 = artifact(root, 'Permit2PaymentCollector.sol', 'Permit2PaymentCollector');
  const multicallA = artifact(root, 'LocalMulticall3.sol', 'LocalMulticall3');
  const rulesA = artifact(root, 'HoldbackRules.sol', 'HoldbackRules');
  const beaconA = artifact(root, 'SimBeacon.sol', 'SimBeacon');
  const bondsA = artifact(root, 'HoldbackBonds.sol', 'HoldbackBonds');

  const tokenAddr = await one(token);
  const escrow = await one(escrowA);
  const multicall = await one(multicallA);
  const erc3009Collector = await one(c3009, [escrow, multicall]);
  const permit2Collector = await one(cPermit2, [escrow, '0x000000000022D473030F116dDEE9F6B43aC78BA3', multicall]);
  // The sim beacon: value(round) = keccak256(simSeed ‖ round), round(t) = t (drand's formula with genesis 1 s and
  // period 1 s, equal to SimChain's floor(ms / 1000)) (ADR-0018). Fixed at deploy; no setter.
  const deployRules = async (simSeed: Hex): Promise<RulesDeployment> => {
    const beacon = await one(beaconA, [simSeed]);
    const rules = await one(rulesA, [escrow, erc3009Collector, permit2Collector, EXPIRY_MARGIN, beacon]);
    const bonds = (await client.readContract({ address: rules, abi: rulesA.abi, functionName: 'BONDS' })) as Address;
    const fromBlock = (await client.getBlockNumber()) + 1n;
    return { rules, bonds, beacon, fromBlock };
  };
  return {
    base: { token: tokenAddr, escrow, erc3009Collector, permit2Collector, multicall },
    abis: { rules: rulesA.abi, bonds: bondsA.abi, token: token.abi, escrow: escrowA.abi, multicall: multicallA.abi, collector: c3009.abi },
    deployRules,
  };
}
