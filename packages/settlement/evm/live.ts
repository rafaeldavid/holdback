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
//
// In-flight rows (T-219): with a lane store attached, a deal lane writes one row before each broadcast (the nonce,
// every hash sent at it, the raw transaction and what the settlement adapter relayed) and rewrites it before a fee
// bump. The row stays until the adapter has applied the receipt and the world has written the books it changed
// (`release`). After a restart the rows a previous run left are read once (`attach`); until a row is resolved, its
// lane sends nothing else, and its nonce is never read from `pending`. `resume` resolves one: a mined row sets the
// lane's nonce to its own plus one; one not mined is rebroadcast as it was, then the usual give-up rule applies.
//
// Reads after a write (T-232): a load-balanced RPC can answer from a node a block or more behind, which still shows the
// state before this node's own last transaction (five times on Sepolia: T-226, round 1's 3d and 10a, 3b's bond deposit,
// T-228, scenario 8). Every receipt raises the chain's floor, and every read of the state now (a simulation, a gas
// estimate, a balance, the adapter's contract reads) names a block: the node's latest, or the floor when the node trails
// it. A node without that block is asked again within a bound, then the read fails; none answers from `latest`.
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
  parseTransaction,
  stringToHex,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { holdbackDomain, type HoldbackDomain } from '@holdback/core';
import abisJson from './abis.json' with { type: 'json' };
import { RelayRefused, type Abis, type Deployment, type EvmChain, type LaneRow, type Mined, type RelayNote } from './chain.js';
import { revertData } from './errors.js';
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
  /** The bond vault of a deployment from before phase one (ADR-0031 §8). Read by nothing: phase one has no vault. */
  bonds?: string;
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
/** The waits before each retry of a pinned read, in quarters of a receipt poll: 0.5, 1, 2 and 4 s at Sepolia's 2 s poll (T-232). */
const PINNED_WAITS = [1, 2, 4, 8];

/** A deal lane's key: keccak256(secret ‖ "holdback/relayer-lane/<i>"). Rafa funds the funding lane; it tops these up. */
export function laneKey(relayerKey: Hex, i: number): Hex {
  return keccak256(concat([relayerKey, stringToHex(`holdback/relayer-lane/${i}`)]));
}

/** Which deal lane a commitment keeps: its ID modulo the lane count. */
export function laneOf(commitmentId: string, lanes = DEAL_LANES): number {
  return /^0x[0-9a-fA-F]{64}$/.test(commitmentId) ? Number(hexToBigInt(commitmentId as Hex) % BigInt(lanes)) : 0;
}

/** Where a live world keeps its deal lanes' in-flight rows (T-219): the demo's Durable Object storage. */
export interface LaneStore {
  /** The rows a previous run left open, read once when the world opens. */
  load(): Promise<LaneRow[]>;
  /** Writes a row before its broadcast, and again before a fee bump. */
  write(row: LaneRow): Promise<void>;
  /** Deletes rows whose receipts are applied, or that were given up. */
  remove(rows: readonly LaneRow[]): Promise<void>;
}

/** A transaction between its first broadcast and its receipt: what the receipt loop needs to rebroadcast or bump it. */
interface Flight {
  from: Address;
  nonce: number;
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  fee: { max: bigint; tip: bigint };
  raw: Hex;
  /** The hashes the RPC accepted at this nonce. */
  hashes: Hex[];
  /** The fee bump waits two rebroadcast windows from here (ms). */
  start: number;
  /** The last rebroadcast (ms); 0 rebroadcasts at the first look. */
  checkpoint: number;
  /** Past this the loop gives up (ms). */
  deadline: number;
  row: LaneRow | null;
}

/** The receipt did not come before the deadline: the existing give-up rule (the lane reads its nonce again). */
class GaveUp extends Error {}

const rowId = (r: Pick<LaneRow, 'from' | 'nonce'>) => `${r.from.toLowerCase()}:${r.nonce}`;

/** How nodes word an answer for a block they do not have yet. */
const MISSING_BLOCK = /header not found|block not found|unknown block/i;

/** True when any message in the error's chain says the node has no such block. */
const missingBlock = (e: unknown): boolean => {
  const seen = new Set<unknown>();
  for (let x: unknown = e; x && typeof x === 'object' && !seen.has(x); x = (x as { cause?: unknown }).cause) {
    seen.add(x);
    const o = x as { message?: unknown; details?: unknown; shortMessage?: unknown };
    if ([o.message, o.details, o.shortMessage].some((m) => typeof m === 'string' && MISSING_BLOCK.test(m))) return true;
  }
  return false;
};

/**
 * Whether a failed pinned read is worth asking again. A node without the block is, first: viem rewraps a code -32603
 * "header not found" from eth_call as a contract revert (review of PR 239). Then not a revert (the contract's answer at
 * that block), and not anvil's EIP-7623 gas-floor refusal of a cheap call's estimate; a timeout or a rate limit is.
 */
export const askAgain = (e: unknown): boolean => missingBlock(e) || (revertData(e) === undefined && !/revert|gas floor exceeds/i.test(String((e as Error | undefined)?.message ?? e)));

/** The node's own answers that it did not take a transaction. Any other broadcast error may have sent it (T-219). */
const REFUSED = /nonce too low|nonce has already been used|underpriced|intrinsic gas too low|invalid sender|exceeds block gas limit|fee cap less than block base fee|max fee per gas less than block base fee/i;
const refused = (e: unknown): boolean => e instanceof RelayRefused || REFUSED.test(String((e as Error | undefined)?.message ?? e));

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
  /** T-219: where the deal lanes' in-flight rows are kept (none: no rows, as before). */
  private store: LaneStore | null = null;
  /** Rows written and not yet released, by sender and nonce. */
  private readonly rows = new Map<string, LaneRow>();
  /** Rows no caller waits on: read at `attach`, or left by an RPC error after the broadcast. */
  private readonly orphans = new Map<string, LaneRow>();
  /** Orphans whose receipts were found, kept for the adapter's `resume`. */
  private readonly resolved = new Map<string, Mined>();
  /** T-232: the newest block this node has a receipt from or has read the chain up to; reads of the state now pin there or later. */
  private seenBlock = 0n;
  /**
   * T-232: per sender, the nonce after its last mined transaction. Kept when a refusal or a give-up drops the nonce
   * cache, so a node whose pending count trails that transaction cannot hand out its nonce again.
   */
  private readonly minedNonce = new Map<string, number>();

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
    // eslint-disable-next-line no-restricted-syntax -- T-232: read before any write, and the domain is fixed at deployment (no admin keys, no upgrade proxy).
    const [, name, version] = (await this.publicClient.readContract({ address: this.deployment.rules, abi: this.abis.rules, functionName: 'eip712Domain' })) as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
    const mismatch = domainMismatch({ name, version }, holdbackDomain(id, this.deployment.rules));
    if (mismatch) throw new RangeError(`${mismatch} (rules contract ${this.deployment.rules} on chain ${id})`);
    // Every funding nonce hashes the margin: a deployment file that disagrees with the contract signs for nothing.
    // eslint-disable-next-line no-restricted-syntax -- T-232: read before any write, and EXPIRY_MARGIN is a constant of the deployed contract.
    const margin = (await this.publicClient.readContract({ address: this.deployment.rules, abi: this.abis.rules, functionName: 'EXPIRY_MARGIN' })) as bigint;
    if (BigInt(margin) !== this.expiryMargin) throw new RangeError(`the rules contract's EXPIRY_MARGIN is ${margin}, the deployment file says ${this.expiryMargin}`);
  }

  floor(): bigint {
    return this.seenBlock;
  }

  saw(block: bigint): void {
    if (block > this.seenBlock) this.seenBlock = block;
  }

  /**
   * The node's latest block, or the floor when the node trails it (T-232). `head: 'cached'` takes viem's head of up to a
   * second ago, one eth_blockNumber a second at most, for the reads the world budgets (the bond listing's 2 eth_calls a
   * second); the floor still covers this node's own writes. `'now'` asks each time, for a simulation or a gas estimate:
   * with an older head, a timeout sent just past its deadline would run at the block before it and be refused TooEarly.
   */
  async newest(head: 'now' | 'cached' = 'now'): Promise<bigint> {
    const latest = await this.publicClient.getBlockNumber(head === 'now' ? { cacheTime: 0 } : {});
    return latest > this.seenBlock ? latest : this.seenBlock;
  }

  /**
   * `read` at `newest(head)`, asked again while `again` says the error is worth it: after a quarter, a half, one and two
   * receipt polls (0.5, 1, 2 and 4 s on Sepolia), within five polls (10 s), the same bound as the adapter's reads at a
   * receipt's block. Then the last error is thrown; nothing is read at `latest` instead (T-232).
   */
  async pinned<T>(read: (block: bigint) => Promise<T>, again: (e: unknown) => boolean = askAgain, head: 'now' | 'cached' = 'cached'): Promise<T> {
    const deadline = Date.now() + 5 * this.pollMs;
    for (let tries = 0; ; tries++) {
      try {
        return await read(await this.newest(head));
      } catch (e) {
        const quarters = PINNED_WAITS[tries];
        const ms = quarters === undefined ? Infinity : (quarters * this.pollMs) / 4;
        if (!again(e) || Date.now() + ms > deadline) throw e;
        await sleep(ms);
      }
    }
  }

  /** eth_estimateGas: a revert throws with its data, as eth_call would; the estimate is kept for the send. */
  async simulate(tx: { from: Address; to: Address; data: Hex }): Promise<void> {
    // At the newest block this node knows of: a node a block behind still shows the deal before this node's last relay.
    const gas = await this.pinned((blockNumber) => this.publicClient.estimateGas({ account: tx.from, to: tx.to, data: tx.data, blockNumber }), askAgain, 'now');
    // Dry runs never send, so their estimates are dropped wholesale now and then rather than one by one.
    if (this.estimates.size > 256) this.estimates.clear();
    this.estimates.set(`${lc(tx.from)}|${lc(tx.to)}|${tx.data}`, gas);
  }

  /**
   * Sends on the key's own lane, or the named lane, after the lane's previous transaction is mined and any row a restart
   * left on that lane is resolved. A deal lane with a store writes the transaction's row, with `note`, before the broadcast.
   */
  send(tx: { key?: Hex; lane?: string; to: Address; data: Hex; value?: bigint; note?: RelayNote }): Promise<Mined> {
    const account = tx.key ? privateKeyToAccount(tx.key) : this.account(tx.lane);
    const lane = tx.key || tx.lane === undefined || tx.lane === FUNDING_LANE ? null : 1 + laneOf(tx.lane);
    return this.serialized(account.address, async () => {
      for (const r of this.inFlight()) if (lc(r.from) === lc(account.address)) await this.resolve(r);
      return this.sendNow(account, tx.to, tx.data, tx.value ?? 0n, lane, tx.note);
    });
  }

  /**
   * Attaches the store a world keeps its in-flight rows in, and reads the rows a previous run left open: one list,
   * no chain call, since a world opens inside blockConcurrencyWhile. Until each is resolved, its lane sends nothing else.
   */
  async attach(store: LaneStore): Promise<void> {
    this.store = store;
    for (const r of await store.load()) {
      this.rows.set(rowId(r), r);
      this.orphans.set(rowId(r), r);
    }
  }

  /** The rows no caller waits on, oldest nonce first: the settlement adapter resolves and applies them (T-219). */
  inFlight(): readonly LaneRow[] {
    return [...this.orphans.values()].sort((a, b) => a.nonce - b.nonce);
  }

  /**
   * Every row written and not yet released, oldest nonce first (T-231): the operators' own timeouts leave a deal alone
   * while any of its transactions is in flight or mined but not yet applied, so none is sent twice.
   */
  openRows(): readonly LaneRow[] {
    return [...this.rows.values()].sort((a, b) => a.nonce - b.nonce);
  }

  /** The open row that sent `hash`, if any: the sync tells this node's own relays from direct calls by it. */
  rowOf(hash: string): LaneRow | undefined {
    const h = lc(hash);
    for (const r of this.rows.values()) if (r.hashes.some((x) => lc(x) === h)) return r;
    return undefined;
  }

  /**
   * A row's receipt, in its lane's turn. Mined: the lane's nonce is the row's plus one. Not mined: the same raw
   * transaction is rebroadcast and awaited until the receipt timeout after its first broadcast, or one rebroadcast
   * window after now if that is later; then the row is given up (null) and the lane reads its nonce again. Throws on
   * an RPC error, and the row stays open.
   */
  resume(row: LaneRow): Promise<Mined | null> {
    return this.serialized(row.from, () => this.resolve(row));
  }

  /**
   * Deletes the rows that sent these hashes, once the books their receipts changed are written. A failed delete leaves
   * the row in storage: the next restart reads it, finds its receipt applied and deletes it then. It never throws, so a
   * world's persist goes on.
   */
  async release(hashes: readonly string[]): Promise<void> {
    if (!this.store || hashes.length === 0) return;
    const set = new Set(hashes.map(lc));
    const done = [...this.rows.values()].filter((r) => r.hashes.some((h) => set.has(lc(h))));
    if (done.length === 0) return;
    await this.store.remove(done).catch(() => undefined);
    for (const r of done) this.forget(r);
  }

  private forget(r: LaneRow): void {
    const id = rowId(r);
    this.rows.delete(id);
    this.orphans.delete(id);
    this.resolved.delete(id);
  }

  /** Removes a row nothing will apply: never sent, or given up. A failed delete leaves it for the next restart to give up. */
  private async drop(r: LaneRow): Promise<void> {
    await this.store?.remove([r]).catch(() => undefined);
    this.forget(r);
  }

  /** `resume`, inside the lane's turn. */
  private async resolve(row: LaneRow): Promise<Mined | null> {
    const id = rowId(row);
    const hit = this.resolved.get(id);
    if (hit) return hit;
    if (!this.rows.has(id)) return null;
    await this.verify();
    const t = parseTransaction(row.raw);
    const now = Date.now();
    const f: Flight = {
      from: getAddress(row.from),
      nonce: row.nonce,
      to: getAddress(t.to!),
      data: t.data ?? '0x',
      value: t.value ?? 0n,
      gas: t.gas!,
      fee: { max: t.maxFeePerGas!, tip: t.maxPriorityFeePerGas! },
      raw: row.raw,
      hashes: [...row.hashes],
      start: now,
      checkpoint: 0,
      deadline: Math.max(row.sentAt + this.timeoutMs, now + this.rebroadcastMs),
      row,
    };
    try {
      const mined = await this.fly(f, this.lanes.find((a) => lc(a.address) === lc(row.from)));
      this.resolved.set(id, mined);
      return mined;
    } catch (e) {
      if (!(e instanceof GaveUp)) throw e;
      this.nonces.delete(lc(row.from));
      await this.drop(row);
      return null;
    }
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

  /** Test ETH, at the block of the funding lane's last top-up or later (T-232): a lane just topped up is not topped up again. */
  async ethBalance(a: Address): Promise<bigint> {
    return this.pinned((blockNumber) => this.publicClient.getBalance({ address: a, blockNumber }));
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

  private async sendNow(account: PrivateKeyAccount, to: Address, data: Hex, value: bigint, lane: number | null, note?: RelayNote): Promise<Mined> {
    await this.verify();
    const from = account.address;
    const k = `${lc(from)}|${lc(to)}|${data}`;
    // Estimated at this node's newest block (T-232): a bond deposit estimated on a node without its approval reverts
    // TransferFromFailed (round 1's 3b, 2026-11-05).
    const estimate = this.estimates.get(k) ?? (await this.pinned((blockNumber) => this.publicClient.estimateGas({ account: from, to, data, value, blockNumber }), askAgain, 'now'));
    this.estimates.delete(k);
    // Sent with less gas than it needs, a call would run out on chain and spend the gas for nothing.
    if ((estimate * 5n) / 4n > GAS_CAP) throw new RelayRefused(`the call needs about ${estimate} gas, above this node's cap of ${GAS_CAP}`);
    const gas = (estimate * 5n) / 4n;
    // `pending` names no block to pin to: a node that trails the lane's last mined transaction counts the nonce before
    // it, so the nonce is never below the one after that transaction (T-232).
    // eslint-disable-next-line no-restricted-syntax -- T-232: the pending count has no block; minedNonce is its floor.
    const pending = this.nonces.get(lc(from)) ?? (await this.publicClient.getTransactionCount({ address: from, blockTag: 'pending' }));
    const after = this.minedNonce.get(lc(from)) ?? 0;
    const nonce = pending > after ? pending : after;
    const fee = await this.feesNow();
    const f: Flight = { from, nonce, to, data, value, gas, fee, raw: '0x', hashes: [], start: 0, checkpoint: 0, deadline: 0, row: null };
    f.raw = await this.sign(account, f, fee);
    // T-219: the row before the broadcast. A failed write throws here, with nothing sent.
    if (lane !== null && this.store) {
      const row: LaneRow = { lane, from, nonce, hashes: [keccak256(f.raw)], raw: f.raw, sentAt: Date.now(), ...(note ? { note } : {}) };
      await this.store.write(row);
      this.rows.set(rowId(row), row);
      f.row = row;
    }
    try {
      f.hashes.push(await this.broadcast(f.raw, from));
    } catch (e) {
      // The node refused it, so nothing went out at this nonce: the row goes, and the lane reads its nonce again. Any
      // other error (a timeout, a fallback RPC that took it) may have sent it: the row stays, and the lane's next send
      // resolves it first, rebroadcast and then the give-up rule (red-team, 2026-11-04).
      if (f.row && refused(e)) await this.drop(f.row);
      else if (f.row) this.orphans.set(rowId(f.row), f.row);
      throw e;
    }
    f.start = f.checkpoint = Date.now();
    f.deadline = f.start + this.timeoutMs;
    try {
      return await this.fly(f, account);
    } catch (e) {
      this.nonces.delete(lc(from));
      // Given up: the row goes with it. An RPC error: the transaction is out, so its lane waits for it (`resume`).
      if (f.row && e instanceof GaveUp) await this.drop(f.row);
      else if (f.row) this.orphans.set(rowId(f.row), f.row);
      throw e;
    }
  }

  private sign(account: PrivateKeyAccount, f: Pick<Flight, 'to' | 'data' | 'value' | 'gas' | 'nonce'>, fee: { max: bigint; tip: bigint }): Promise<Hex> {
    return account.signTransaction({ chainId: this.chainId, type: 'eip1559', to: f.to, data: f.data, value: f.value, gas: f.gas, nonce: f.nonce, maxFeePerGas: fee.max, maxPriorityFeePerGas: fee.tip });
  }

  /**
   * Waits for the receipt of any hash sent at the flight's nonce. Every rebroadcast window it sends the same raw
   * transaction again; after two windows it replaces it once at the same nonce with fees up by a quarter (nodes require
   * at least a tenth), within the cap, when it holds the lane's key. Past the deadline it gives up.
   */
  private async fly(f: Flight, account: PrivateKeyAccount | undefined): Promise<Mined> {
    for (;;) {
      for (const hash of f.hashes) {
        const r = await this.publicClient.getTransactionReceipt({ hash }).catch((e: unknown) => {
          if (e instanceof TransactionReceiptNotFoundError) return null;
          throw e;
        });
        if (r) {
          this.nonces.set(lc(f.from), f.nonce + 1);
          if (f.nonce + 1 > (this.minedNonce.get(lc(f.from)) ?? 0)) this.minedNonce.set(lc(f.from), f.nonce + 1);
          const timestamp = await this.blockTime(r.blockNumber);
          // Every read of the state from now on sees this transaction (T-232), once a read of its block succeeded.
          this.saw(r.blockNumber);
          return { hash, from: f.from, status: r.status, gasUsed: r.gasUsed, blockNumber: r.blockNumber, timestamp, logs: r.logs };
        }
      }
      const now = Date.now();
      if (now > f.deadline) throw new GaveUp(`a transaction from ${f.from} (nonce ${f.nonce}) was not mined within ${Math.round(this.timeoutMs / 1000)} s: ${f.hashes.join(', ')}`);
      if (now - f.checkpoint > this.rebroadcastMs) {
        f.checkpoint = now;
        if (account && f.hashes.length < 2 && now - f.start > 2 * this.rebroadcastMs && f.fee.max < this.maxFee) await this.bump(account, f);
        else await this.broadcast(f.raw, f.from).catch(() => undefined);
      }
      await sleep(this.pollMs);
    }
  }

  /** The one fee bump. If the first transaction was mined meanwhile, the node refuses the replacement; the loop then finds its receipt. */
  private async bump(account: PrivateKeyAccount, f: Flight): Promise<void> {
    const max = (f.fee.max * 5n) / 4n > this.maxFee ? this.maxFee : (f.fee.max * 5n) / 4n;
    f.fee = { max, tip: (f.fee.tip * 5n) / 4n > max ? max : (f.fee.tip * 5n) / 4n };
    const replacement = await this.sign(account, f, f.fee);
    if (f.row && this.store) {
      // The row names the replacement before it goes out, so a restart right after still finds its receipt. Without
      // that write, no replacement: the first transaction keeps its chance.
      const next: LaneRow = { ...f.row, hashes: [...f.row.hashes, keccak256(replacement)], raw: replacement };
      if (!(await this.store.write(next).then(() => true, () => false))) return;
      Object.assign(f.row, next);
    }
    const hash = await this.broadcast(replacement, f.from).catch(() => null);
    if (hash) {
      f.raw = replacement;
      f.hashes.push(hash);
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
