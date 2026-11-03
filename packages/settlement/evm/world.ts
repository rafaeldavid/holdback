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
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { assertLocalRpc, assertSafeChain } from './guard.js';

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

export interface Deployment {
  token: Address;
  escrow: Address;
  erc3009Collector: Address;
  permit2Collector: Address;
  multicall: Address;
  rules: Address;
  bonds: Address;
  /** The SimBeacon behind the rules contract (a shared chain would use the drand quicknet verifier). */
  beacon: Address;
  /** The first block after deployment; logs before it are setup. */
  fromBlock: bigint;
}

export interface Abis {
  rules: Abi;
  bonds: Abi;
  token: Abi;
  escrow: Abi;
  multicall: Abi;
  collector: Abi;
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

export class EvmWorld {
  readonly chainId = LOCAL_CHAIN_ID;
  private snapshotId: Hex | null = null;

  private constructor(
    readonly rpcUrl: string,
    readonly publicClient: PublicClient,
    readonly deployment: Deployment,
    readonly abis: Abis,
    private readonly proc: ChildProcess | null,
    private readonly deployRules: (simSeed: Hex) => Promise<RulesDeployment>,
  ) {}

  /** Starts anvil on a free localhost port and deploys. `root` is the repository root (for contracts/out). */
  static async start(root: string, options: { rpcUrl?: string } = {}): Promise<EvmWorld> {
    let proc: ChildProcess | null = null;
    let rpcUrl = options.rpcUrl;
    if (!rpcUrl) {
      const port = await freePort();
      proc = spawn('anvil', ['--chain-id', String(LOCAL_CHAIN_ID), '--host', '127.0.0.1', '--port', String(port), '--timestamp', String(ANVIL_GENESIS_TIME), '--hardfork', 'prague', '--silent'], {
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
      const { base, abis, deployRules } = await deploy(root, rpcUrl, publicClient);
      // Snapshot before the beacon and the rules contract, then deploy them once to learn their addresses.
      const snapshotId = await publicClient.request({ method: 'evm_snapshot' as never, params: [] as never }) as Hex;
      const rules = await deployRules(BOOT_SIM_SEED);
      const world = new EvmWorld(rpcUrl, publicClient, { ...base, ...rules }, abis, proc, deployRules);
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
): Promise<{ base: Omit<Deployment, keyof RulesDeployment>; abis: Abis; deployRules: (simSeed: Hex) => Promise<RulesDeployment> }> {
  const wallet = createWalletClient({ account: privateKeyToAccount(ANVIL_DEPLOYER_KEY), chain: foundry, transport: http(rpcUrl) });
  const one = async (a: Artifact, args: unknown[] = []): Promise<Address> => {
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args } as Parameters<typeof wallet.deployContract>[0]);
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== 'success' || !r.contractAddress) throw new Error(`deployment failed: ${hash}`);
    return r.contractAddress;
  };
  const token = artifact(root, 'LocalUSDC.sol', 'LocalUSDC');
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
