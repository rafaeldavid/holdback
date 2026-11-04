// LiveChain: the EvmChain of a public testnet (D41, ADR-0028). Blocks keep their own time (about 12 s on Sepolia),
// so the adapter's clock is the wall clock and each state change waits for its receipt.
//
// Who pays gas: relayer lanes, keys held by the operator as one secret and used only on test networks. They relay;
// they never author (CLAUDE.md, ADR-0005). Each call they send carries the parties' or an adjudicator's signatures,
// which the rules contract checks, or is a permissionless timeout; the contracts never read msg.sender and give the
// relayer no role, so it cannot move held funds or change an outcome. The faucet's mint (open mint on the test token)
// and the gas the demo adjudicators and the deal lanes need are the operator's own test-token and test-ETH chores.
//
// Lanes (ADR-0028 §3): the secret is the funding lane, and derives DEAL_LANES deal lanes. A commitment keeps one deal
// lane; each lane sends one transaction at a time and waits for its receipt, so its nonce is always the last mined
// plus one, and one stuck transaction delays one lane. The funding lane mints, sets up and tops up the deal lanes.
import {
  BlockNotFoundError,
  concat,
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  hexToBigInt,
  http,
  keccak256,
  parseGwei,
  stringToHex,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { holdbackDomain, type HoldbackDomain } from '@holdback/core';
import abisJson from './abis.json' with { type: 'json' };
import { RelayRefused, type Abis, type Deployment, type EvmChain, type Mined } from './chain.js';
import { assertSafeChain } from './guard.js';

/** contracts/deployments/<network>.json, as the testnet deployment writes it (T-206). */
export interface DeploymentFile {
  chainId: number;
  /** The reviewed contracts commit the bytecode was built from. */
  commit?: string;
  fromBlock: number | string;
  token: { address: string; name: string; version: string; symbol: string; decimals: number };
  escrow: string;
  erc3009Collector: string;
  permit2Collector: string;
  multicall: string;
  rules: string;
  bonds: string;
  beacon: string;
  expiryMarginSec?: number;
}

/**
 * Why a rules contract's EIP-712 domain cannot settle this build's messages, or null when it can. The name and the
 * version must be core's (`holdbackDomain`): a contract under another version refuses every signature this build makes,
 * so every agreeAndFund would revert BadSignature (ADR-0029 §8).
 */
export function domainMismatch(onChain: { name: string; version: string }, want: Pick<HoldbackDomain, 'name' | 'version'>): string | null {
  if (onChain.name === want.name && onChain.version === want.version) return null;
  return `the rules contract signs under EIP-712 domain "${onChain.name}" ${onChain.version}, this build under "${want.name}" ${want.version}: every message would revert BadSignature. Deploy the ${want.version} contracts and update the deployment file (contracts/deployments/<network>.json, ADR-0029 §8) before starting this build`;
}

/** The six ABIs from contracts/out (scripts/evm-abis.mjs), for a runtime with no file system. */
export const LIVE_ABIS = abisJson as unknown as Abis;

/** The chains a live settlement may run on: Sepolia, and anvil standing in for it in tests. Never a mainnet. */
export const LIVE_CHAIN_IDS: ReadonlySet<number> = new Set([11155111, 31337]);

/** Keyless Sepolia endpoints that served batches and wide log ranges in the research pass (2026-11-03). */
export const SEPOLIA_PUBLIC_RPCS: readonly string[] = ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co'];

export const DEAL_LANES = 3;
export const FUNDING_LANE = 'funding';

export function deploymentOf(f: DeploymentFile): Deployment {
  return {
    token: getAddress(f.token.address),
    escrow: getAddress(f.escrow),
    erc3009Collector: getAddress(f.erc3009Collector),
    permit2Collector: getAddress(f.permit2Collector),
    multicall: getAddress(f.multicall),
    rules: getAddress(f.rules),
    bonds: getAddress(f.bonds),
    beacon: getAddress(f.beacon),
    fromBlock: BigInt(f.fromBlock),
  };
}

export interface LiveChainOptions {
  deployment: DeploymentFile;
  /** JSON-RPC endpoints, tried in order. https only, except a local node (tests). */
  rpcUrls: readonly string[];
  /** The relayer secret: the funding lane's key, from which the deal lanes derive. Sepolia only; never logged. */
  relayerKey: Hex;
  /** Refuse to send when the fee per gas would pass this many gwei. Default 20. */
  maxFeeGwei?: number;
  /** Receipt polling. Defaults: every 2 s, rebroadcast after 36 s, a fee bump after 72 s, give up after 180 s. */
  pollMs?: number;
  rebroadcastMs?: number;
  receiptTimeoutMs?: number;
  /** How long the faucet gathers mints into one transaction. Default 1 s. */
  mintBatchMs?: number;
}

const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
const GWEI = 1_000_000_000n;
const MIN_TIP = GWEI / 10n;
const MAX_TIP = 2n * GWEI;
/**
 * The most gas this node sends a call with, after the 25 % pad. Measured on Sepolia (2026-11-03, eth_simulateV1): the
 * funding bundle 938,547, a decision 521,658, a bond deposit 244,975; new state costs about 3.5 times Prague's there.
 */
export const GAS_CAP = 3_000_000n;
/**
 * Faucet mints per Multicall3 call: on Sepolia a batched mint to a new holder is about 130,000 gas (two in one call,
 * 262,195, measured) and a lone first mint 238,103, so six stay well inside the cap even at the higher figure.
 */
const MINT_BATCH_MAX = 6;

/** A deal lane's key: keccak256(secret ‖ "holdback/relayer-lane/<i>"). Rafa funds the funding lane; it tops these up. */
export function laneKey(relayerKey: Hex, i: number): Hex {
  return keccak256(concat([relayerKey, stringToHex(`holdback/relayer-lane/${i}`)]));
}

/** Which deal lane a commitment keeps: its ID modulo the lane count. */
export function laneOf(commitmentId: string, lanes = DEAL_LANES): number {
  return /^0x[0-9a-fA-F]{64}$/.test(commitmentId) ? Number(hexToBigInt(commitmentId as Hex) % BigInt(lanes)) : 0;
}

export class LiveChain implements EvmChain {
  readonly clock = 'wall' as const;
  readonly chainId: number;
  readonly deployment: Deployment;
  readonly abis: Abis = LIVE_ABIS;
  readonly publicClient: PublicClient;
  readonly token: DeploymentFile['token'];
  readonly tokenDomain: { name: string; version: string };
  readonly expiryMargin: bigint;
  /** The funding lane, then the deal lanes. */
  readonly lanes: readonly PrivateKeyAccount[];
  private readonly keys: readonly Hex[];
  private readonly maxFee: bigint;
  private readonly pollMs: number;
  private readonly rebroadcastMs: number;
  private readonly timeoutMs: number;
  private readonly mintBatchMs: number;
  private readonly nonces = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();
  /** simulate's gas estimate, reused by the send that follows it. */
  private readonly estimates = new Map<string, bigint>();
  private verified: Promise<void> | undefined;
  private fees: { at: number; base: bigint; tip: bigint } | null = null;
  private readonly blockTimes = new Map<bigint, number>();
  private mints: Array<{ to: Address; amount: bigint; resolve: (m: Mined) => void; reject: (e: unknown) => void }> = [];

  constructor(o: LiveChainOptions) {
    const id = o.deployment.chainId;
    assertSafeChain(id);
    if (!LIVE_CHAIN_IDS.has(id)) throw new RangeError(`a live settlement runs on Sepolia (11155111) only, not chain id ${id} (hard rule: no real money)`);
    if (o.rpcUrls.length === 0) throw new RangeError('a live chain needs at least one JSON-RPC URL');
    for (const u of o.rpcUrls) if (!u.startsWith('https://') && !LOCAL.test(u)) throw new RangeError('an RPC URL is neither https nor a local node');
    this.chainId = id;
    this.deployment = deploymentOf(o.deployment);
    this.token = o.deployment.token;
    this.tokenDomain = { name: o.deployment.token.name, version: o.deployment.token.version };
    this.expiryMargin = BigInt(o.deployment.expiryMarginSec ?? 86_400);
    this.keys = [o.relayerKey, ...Array.from({ length: DEAL_LANES }, (_, i) => laneKey(o.relayerKey, i + 1))];
    this.lanes = this.keys.map((k) => privateKeyToAccount(k));
    this.maxFee = parseGwei(String(o.maxFeeGwei ?? 20));
    this.pollMs = o.pollMs ?? 2000;
    this.rebroadcastMs = o.rebroadcastMs ?? 36_000;
    this.timeoutMs = o.receiptTimeoutMs ?? 180_000;
    this.mintBatchMs = o.mintBatchMs ?? 1000;
    const transport = fallback(
      o.rpcUrls.map((u) => http(u, { batch: { wait: 10 }, retryCount: 1, timeout: 8_000 })),
      { rank: false, retryCount: 2, retryDelay: 150 },
    );
    this.publicClient = createPublicClient({ transport, cacheTime: 1000 }) as PublicClient;
  }

  /** The lane keys, for the test that no route serves one. In-process only. */
  secretsForTest(): readonly Hex[] {
    return this.keys;
  }

  /** The funding lane: the address Rafa funds with Sepolia ETH. */
  get funding(): Address {
    return this.lanes[0]!.address;
  }

  /** A commitment's deal lane, or the funding lane. */
  private account(lane: string | undefined): PrivateKeyAccount {
    return lane === undefined || lane === FUNDING_LANE ? this.lanes[0]! : this.lanes[1 + laneOf(lane)]!;
  }

  senderFor(lane: string): Address {
    return this.account(lane).address;
  }

  /**
   * Checks that the RPC serves the deployment's chain and that the rules contract is the one in the file. Reads only,
   * once: every send waits for it, so nothing is sent to a chain that has not passed.
   */
  verify(): Promise<void> {
    this.verified ??= this.check().catch((e: unknown) => {
      this.verified = undefined;
      throw e;
    });
    return this.verified;
  }

  private async check(): Promise<void> {
    const id = await this.publicClient.getChainId();
    if (id !== this.chainId) throw new RangeError(`the RPC serves chain id ${id}, not the deployment's ${this.chainId}`);
    const code = await this.publicClient.getCode({ address: this.deployment.rules });
    if (!code || code === '0x') throw new RangeError(`no contract at the rules address ${this.deployment.rules} on chain ${id}`);
    // ADR-0029: every message is signed under core's domain. A contract under another version (the 0.6 deployment, for a
    // 0.7 build) refuses every signature, so a build must not start against it.
    const [, name, version] = (await this.publicClient.readContract({ address: this.deployment.rules, abi: this.abis.rules, functionName: 'eip712Domain' })) as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
    const mismatch = domainMismatch({ name, version }, holdbackDomain(id, this.deployment.rules));
    if (mismatch) throw new RangeError(`${mismatch} (rules contract ${this.deployment.rules} on chain ${id})`);
    // Every funding nonce hashes the margin: a deployment file that disagrees with the contract signs for nothing.
    const margin = (await this.publicClient.readContract({ address: this.deployment.rules, abi: this.abis.rules, functionName: 'EXPIRY_MARGIN' })) as bigint;
    if (BigInt(margin) !== this.expiryMargin) throw new RangeError(`the rules contract's EXPIRY_MARGIN is ${margin}, the deployment file says ${this.expiryMargin}`);
  }

  /** eth_estimateGas: a revert throws with its data, as eth_call would; the estimate is kept for the send. */
  async simulate(tx: { from: Address; to: Address; data: Hex }): Promise<void> {
    const gas = await this.publicClient.estimateGas({ account: tx.from, to: tx.to, data: tx.data });
    // Dry runs never send, so their estimates are dropped wholesale now and then rather than one by one.
    if (this.estimates.size > 256) this.estimates.clear();
    this.estimates.set(`${lc(tx.from)}|${lc(tx.to)}|${tx.data}`, gas);
  }

  /** Sends on the key's own lane, or the named lane, after the lane's previous transaction is mined. */
  send(tx: { key?: Hex; lane?: string; to: Address; data: Hex; value?: bigint }): Promise<Mined> {
    const account = tx.key ? privateKeyToAccount(tx.key) : this.account(tx.lane);
    return this.serialized(account.address, () => this.sendNow(account, tx.to, tx.data, tx.value ?? 0n));
  }

  /**
   * The faucet's grant: the funding lane mints test tokens to `to` (open mint). Grants that arrive within
   * `mintBatchMs` go in one Multicall3 call, so two agents funded together wait for one block.
   */
  mint(to: Address, amount: bigint): Promise<Mined> {
    return new Promise((resolve, reject) => {
      this.mints.push({ to: getAddress(to), amount, resolve, reject });
      if (this.mints.length === 1) setTimeout(() => void this.flushMints(), this.mintBatchMs);
    });
  }

  async ethBalance(a: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address: a });
  }

  /** Each deal lane holds at least `floor` test ETH: the funding lane sends `topUp` to any below it. */
  async topUpLanes(floor: bigint, topUp: bigint): Promise<Hex[]> {
    const sent: Hex[] = [];
    for (const lane of this.lanes.slice(1)) {
      if ((await this.ethBalance(lane.address)) >= floor) continue;
      sent.push((await this.send({ lane: FUNDING_LANE, to: lane.address, data: '0x', value: topUp })).hash);
    }
    return sent;
  }

  private async flushMints(): Promise<void> {
    const batch = this.mints.splice(0, MINT_BATCH_MAX);
    if (batch.length === 0) return;
    // The rest go in the next call, queued behind this one on the funding lane.
    if (this.mints.length > 0) setTimeout(() => void this.flushMints(), 0);
    try {
      const { token, multicall } = this.deployment;
      const call = (b: (typeof batch)[number]) => encodeFunctionData({ abi: this.abis.token, functionName: 'mint', args: [b.to, b.amount] });
      const mined =
        batch.length === 1
          ? await this.send({ lane: FUNDING_LANE, to: token, data: call(batch[0]!) })
          : await this.send({
              lane: FUNDING_LANE,
              to: multicall,
              data: encodeFunctionData({ abi: this.abis.multicall, functionName: 'aggregate3', args: [batch.map((b) => ({ target: token, allowFailure: false, callData: call(b) }))] }),
            });
      if (mined.status !== 'success') throw new Error(`the faucet's mint reverted: ${mined.hash}`);
      for (const b of batch) b.resolve(mined);
    } catch (e) {
      for (const b of batch) b.reject(e);
    }
  }

  /** One sender's transactions in order: each starts after the previous one is mined or given up. */
  private serialized<T>(from: Address, f: () => Promise<T>): Promise<T> {
    const key = lc(from);
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(f, f);
    const settled = next.catch(() => undefined);
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next;
  }

  private async sendNow(account: PrivateKeyAccount, to: Address, data: Hex, value: bigint): Promise<Mined> {
    await this.verify();
    const from = account.address;
    const k = `${lc(from)}|${lc(to)}|${data}`;
    const estimate = this.estimates.get(k) ?? (await this.publicClient.estimateGas({ account: from, to, data, value }));
    this.estimates.delete(k);
    // Sent with less gas than it needs, a call would run out on chain and spend the gas for nothing.
    if ((estimate * 5n) / 4n > GAS_CAP) throw new RelayRefused(`the call needs about ${estimate} gas, above this node's cap of ${GAS_CAP}`);
    const gas = (estimate * 5n) / 4n;
    const nonce = this.nonces.get(lc(from)) ?? (await this.publicClient.getTransactionCount({ address: from, blockTag: 'pending' }));
    let fee = await this.feesNow();
    const sign = (f: { max: bigint; tip: bigint }) => account.signTransaction({ chainId: this.chainId, type: 'eip1559', to, data, value, gas, nonce, maxFeePerGas: f.max, maxPriorityFeePerGas: f.tip });
    let raw = await sign(fee);
    const hashes: Hex[] = [await this.broadcast(raw, from)];
    const start = Date.now();
    let checkpoint = start;
    try {
      for (;;) {
        for (const hash of hashes) {
          const r = await this.publicClient.getTransactionReceipt({ hash }).catch((e: unknown) => {
            if (e instanceof TransactionReceiptNotFoundError) return null;
            throw e;
          });
          if (r) {
            this.nonces.set(lc(from), nonce + 1);
            return { hash, from, status: r.status, gasUsed: r.gasUsed, blockNumber: r.blockNumber, timestamp: await this.blockTime(r.blockNumber), logs: r.logs };
          }
        }
        const now = Date.now();
        if (now - start > this.timeoutMs) throw new Error(`a transaction from ${from} (nonce ${nonce}) was not mined within ${Math.round(this.timeoutMs / 1000)} s: ${hashes.join(', ')}`);
        if (now - checkpoint > this.rebroadcastMs) {
          checkpoint = now;
          if (hashes.length < 2 && now - start > 2 * this.rebroadcastMs && fee.max < this.maxFee) {
            // Replace at the same nonce with fees up by a quarter (nodes require at least a tenth), within the cap.
            // If the first one was mined meanwhile, the node refuses the replacement; the loop then finds its receipt.
            const max = (fee.max * 5n) / 4n > this.maxFee ? this.maxFee : (fee.max * 5n) / 4n;
            fee = { max, tip: (fee.tip * 5n) / 4n > max ? max : (fee.tip * 5n) / 4n };
            const replacement = await sign(fee);
            const hash = await this.broadcast(replacement, from).catch(() => null);
            if (hash) {
              raw = replacement;
              hashes.push(hash);
            }
          } else {
            await this.broadcast(raw, from).catch(() => undefined);
          }
        }
        await sleep(this.pollMs);
      }
    } catch (e) {
      this.nonces.delete(lc(from));
      throw e;
    }
  }

  private async broadcast(raw: Hex, from: Address): Promise<Hex> {
    try {
      return await this.publicClient.sendRawTransaction({ serializedTransaction: raw });
    } catch (e) {
      const text = String((e as Error).message);
      if (/already known/i.test(text)) return keccak256(raw);
      this.nonces.delete(lc(from));
      if (/insufficient funds/i.test(text)) throw new RelayRefused(`relayer ${from} has too little test ETH for this transaction's gas`);
      throw e;
    }
  }

  /** EIP-1559 fees: the median tip of the last 20 blocks, clamped to 0.1 to 2 gwei, and twice the next base fee; refused above the cap. */
  private async feesNow(): Promise<{ max: bigint; tip: bigint }> {
    if (!this.fees || Date.now() - this.fees.at > 12_000) {
      const h = await this.publicClient.getFeeHistory({ blockCount: 20, rewardPercentiles: [50] });
      const tips = (h.reward ?? []).map((r) => r[0] ?? 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const median = tips.length ? tips[Math.floor(tips.length / 2)]! : MIN_TIP;
      const tip = median < MIN_TIP ? MIN_TIP : median > MAX_TIP ? MAX_TIP : median;
      this.fees = { at: Date.now(), base: h.baseFeePerGas.at(-1) ?? 0n, tip };
    }
    const { base, tip } = this.fees;
    if (base + tip > this.maxFee) throw new RelayRefused(`test-network gas is ${base + tip} wei per gas, above this node's cap of ${this.maxFee}; try again later`);
    const want = base * 2n + tip;
    return { max: want > this.maxFee ? this.maxFee : want, tip };
  }

  /**
   * A mined block's time. A node behind that block answers null, which viem throws as BlockNotFoundError without trying
   * the next RPC: ask again at the receipt poll's pace, five tries in all (T-216 round 1).
   */
  private async blockTime(n: bigint): Promise<number> {
    const hit = this.blockTimes.get(n);
    if (hit !== undefined) return hit;
    let block: { timestamp: bigint } | undefined;
    for (let tries = 1; !block; tries++) {
      block = await this.publicClient.getBlock({ blockNumber: n }).catch(async (e: unknown) => {
        if (!(e instanceof BlockNotFoundError) || tries >= 5) throw e;
        await sleep(this.pollMs);
        return undefined;
      });
    }
    const t = Number(block.timestamp);
    if (this.blockTimes.size > 256) this.blockTimes.clear();
    this.blockTimes.set(n, t);
    return t;
  }
}

/**
 * Gives an adjudicator key this world holds at least `amount` of its own bond in HoldbackBonds (the demo's setup,
 * ADR-0028 §7). The funding lane tops up the adjudicator's test ETH to `gas` and mints the missing test tokens to it
 * (open mint); the adjudicator then approves and deposits with its own key, as HoldbackBonds bonds msg.sender.
 * Idempotent: every step is decided by an on-chain read, and nothing is sent when the bond is already there.
 */
export async function ensureBond(chain: LiveChain, adjudicatorKey: Hex, amount: bigint, gas: bigint): Promise<Hex[]> {
  const a = privateKeyToAccount(adjudicatorKey).address;
  const { token, bonds } = chain.deployment;
  const read = (address: Address, functionName: string, args: unknown[]) => chain.publicClient.readContract({ address, abi: address === bonds ? chain.abis.bonds : chain.abis.token, functionName, args }) as Promise<bigint>;
  const bond = await read(bonds, 'bondOf', [a, token]);
  if (bond >= amount) return [];
  const sent: Hex[] = [];
  const need = amount - bond;
  if ((await chain.ethBalance(a)) < gas / 2n) sent.push((await chain.send({ lane: FUNDING_LANE, to: a, data: '0x', value: gas })).hash);
  if ((await read(token, 'balanceOf', [a])) < need) sent.push((await chain.mint(a, need)).hash);
  if ((await read(token, 'allowance', [a, bonds])) < need) {
    sent.push((await chain.send({ key: adjudicatorKey, to: token, data: encodeFunctionData({ abi: chain.abis.token, functionName: 'approve', args: [bonds, need] }) })).hash);
  }
  const deposit = await chain.send({ key: adjudicatorKey, to: bonds, data: encodeFunctionData({ abi: chain.abis.bonds, functionName: 'deposit', args: [token, need] }) });
  if (deposit.status !== 'success') throw new Error(`the bond deposit for ${a} reverted: ${deposit.hash}`);
  return [...sent, deposit.hash];
}
