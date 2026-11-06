// ChainSync: the operators' view follows the chain (T-218, ADR-0028 §11). Any party with test ETH can call HoldbackRules
// past the operators (ADR-0005), so the view reads the rules contract's logs from a stored cursor and hands every
// transaction this node has not applied to the settlement adapter, which rebuilds the step from the calldata.
//
// - The logs find the transactions and confirm their effect; the calldata carries the signed messages core's steps
//   need, which the contract's events do not (EvmSettlement.observe rebuilds them).
// - Reads go in chunks of at most LOG_RANGE blocks, publicnode's cap (research 2026-11-03 §4).
// - Fail closed: every read of a pass happens before anything is applied, so an RPC error applies nothing and moves no
//   cursor. One transaction the adapter cannot rebuild puts its deal behind and moves the cursor on.
// - The cursor keeps the block's hash beside its number, for the reorg check (backlog, "Sepolia: reorg check").
import { decodeFunctionData, encodeAbiParameters, getAddress, parseAbi, toFunctionSelector, type AbiFunction, type Address, type Hex, type RpcLog } from 'viem';
import type { Hex32 } from '@holdback/core';
import type { EvmChain } from './chain.js';
import type { EvmSettlement, ObserveReport } from './evm-settlement.js';

/** The last block the view has read: its number (a decimal string, so the row is plain JSON) and its hash. */
export interface Cursor {
  block: string;
  hash: Hex;
}

/** The most blocks one eth_getLogs spans: publicnode's cap; Tenderly's gateway took 100,000 (research §4). */
export const LOG_RANGE = 50_000n;
/** Blocks each pass reads again below its cursor (about 36 s on Sepolia). */
export const OVERLAP = 3n;

/** A mined transaction with a rules-contract log, as the adapter applies it. Plain JSON: a book can hold it. */
export interface ChainTx {
  hash: Hex;
  from: Address;
  /** The contract the transaction called: the rules contract, a Multicall3 bundle, or any other contract. */
  to: Address | null;
  input: Hex;
  block: string;
  /** The block's timestamp, unix seconds. */
  timestamp: number;
  gasUsed: string;
  /** Every log of the receipt (the rules contract's, the bonds', the token's and CPP's). */
  logs: Array<{ address: Address; topics: Hex[]; data: Hex; logIndex: number }>;
}

/** A HoldbackRules call inside a transaction: the function and its decoded arguments. */
export interface RulesCall {
  fn: string;
  args: readonly unknown[];
}

/** What one pass read and did, for the world's counters and the tests. */
export interface SyncReport extends ObserveReport {
  /** The blocks read, inclusive. */
  from: string;
  to: string;
  /** Rules-contract logs in blocks past the old cursor, and every transaction the pass read (the overlap included). */
  logs: number;
  txs: number;
  /** JSON-RPC requests the pass made. */
  rpc: number;
}

/** Multicall3's call-forwarding entry points (the canonical deployment on Sepolia), so a bundle is read through. */
const MULTICALL3 = parseAbi([
  'function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)',
  'function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
  'function blockAndAggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes32 blockHash, (bool success, bytes returnData)[] returnData)',
  'function tryBlockAndAggregate(bool requireSuccess, (address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes32 blockHash, (bool success, bytes returnData)[] returnData)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

const lc = (a: string) => a.toLowerCase();
/** How providers word a capped eth_getLogs ("query returned more than 10000 results", "block range is too wide"). */
const CAPPED = /more than \d+ (results|logs)|query returned more than|block range|range (is )?too (large|wide|big)|too many (blocks|results|logs)|response size|limit exceeded|exceeds? (the )?(max|limit)/i;
/** A rate limit or a server error is no cap: halving would only multiply the requests (review N2, red-team F). */
const RATED = /too many requests|rate.?limit|status:?\s*(429|5\d\d)\b/i;
/** At most this many halvings: 50,000 blocks down to one. */
const MAX_HALVINGS = 16;

/**
 * The HoldbackRules calls a transaction ran, read from its calldata: the call itself when it targets the rules
 * contract, or each rules call inside the deployment's Multicall3 when every call in the bundle must succeed. Null
 * when the calldata does not say what ran: another contract forwarded the call (a Safe, an ERC-4337 account), a
 * bundle call may have failed (`allowFailure`, `requireSuccess = false`), or a bundle calls a contract other than the
 * rules contract and the token, which could call the rules contract itself (red-team 2026-11-04, finding 1).
 */
export function rulesCalls(chain: Pick<EvmChain, 'deployment' | 'abis'>, tx: Pick<ChainTx, 'to' | 'input'>): RulesCall[] | null {
  const { rules, multicall, token } = chain.deployment;
  if (!tx.to) return null;
  if (lc(tx.to) === lc(rules)) {
    const call = decodeRules(chain, tx.input);
    return call ? [call] : null;
  }
  if (lc(tx.to) !== lc(multicall)) return null;
  try {
    const d = decodeFunctionData({ abi: MULTICALL3, data: tx.input });
    const args = d.args as readonly unknown[];
    const tolerant = d.functionName === 'tryAggregate' || d.functionName === 'tryBlockAndAggregate';
    if (tolerant && args[0] !== true) return null;
    const inner = (tolerant ? args[1] : args[0]) as ReadonlyArray<{ target: Address; callData: Hex; allowFailure?: boolean }>;
    const calls: RulesCall[] = [];
    for (const c of inner) {
      if (c.allowFailure) return null;
      // The token's ERC-3009 transfer (the operators' fee leg) calls nothing back.
      if (lc(c.target) === lc(token)) continue;
      if (lc(c.target) !== lc(rules)) return null;
      const call = decodeRules(chain, c.callData);
      if (!call) return null;
      calls.push(call);
    }
    return calls;
  } catch {
    return null;
  }
}

/**
 * The ERC-3009 transfers in a readable bundle (`rulesCalls` is not null): the operators' fee leg rides beside the
 * funding (ADR-0023). Every call in such a bundle ran, so each transfer here moved its amount.
 */
export function feeLegs(chain: Pick<EvmChain, 'deployment' | 'abis'>, tx: Pick<ChainTx, 'to' | 'input'>): Array<{ from: Address; to: Address; value: bigint; nonce: Hex }> {
  if (!tx.to || lc(tx.to) !== lc(chain.deployment.multicall) || !rulesCalls(chain, tx)) return [];
  try {
    const d = decodeFunctionData({ abi: MULTICALL3, data: tx.input });
    const args = d.args as readonly unknown[];
    const inner = (d.functionName === 'tryAggregate' || d.functionName === 'tryBlockAndAggregate' ? args[1] : args[0]) as ReadonlyArray<{ target: Address; callData: Hex }>;
    const out: Array<{ from: Address; to: Address; value: bigint; nonce: Hex }> = [];
    for (const c of inner) {
      if (lc(c.target) !== lc(chain.deployment.token)) continue;
      const t = decodeFunctionData({ abi: chain.abis.token, data: c.callData });
      if (t.functionName !== 'transferWithAuthorization') continue;
      const [from, to, value, , , nonce] = t.args as readonly [Address, Address, bigint, bigint, bigint, Hex];
      out.push({ from, to, value, nonce });
    }
    return out;
  } catch {
    return [];
  }
}

function decodeRules(chain: Pick<EvmChain, 'abis'>, data: Hex): RulesCall | null {
  try {
    const d = decodeFunctionData({ abi: chain.abis.rules, data });
    return { fn: d.functionName, args: d.args ?? [] };
  } catch {
    return null;
  }
}

/** The signed steps a forwarded call may be: timeouts are read from logs alone, so the scan never counts one (red-team round 3). */
const STEPS = ['agreeAndFund', 'deliver', 'decide', 'earlyAccept', 'mutualSettle', 'fileAppeal'];

/** The most bytes one embedded call is decoded from: a decision with a drand proof is about 2.5 KB. */
const EMBEDDED_WINDOW_HEX = 2 * 16_384;
/** A bound on hits, far above what a transaction holds (the needle is about 1 KB, a transaction at most 128 KB); no count of filler can hide the real call. */
const EMBEDDED_MAX = 1_024;

/**
 * Rules calls for one deal written verbatim somewhere in a transaction's calldata: what a simple forwarder, a Safe's
 * `execTransaction` or an ERC-4337 account passes on. Every step takes the terms first, as a static tuple, so each call
 * is a step selector followed by the deal's encoded terms: the scan looks for those bytes (linear in the calldata) and
 * decodes each hit from a bounded window (review 2026-11-04, N1). A candidate only: it may never have run. The adapter
 * accepts one only when its signatures verify and the receipt's logs show its effect.
 */
export function embeddedCalls(chain: Pick<EvmChain, 'abis'>, input: Hex, terms: unknown): RulesCall[] {
  const steps = chain.abis.rules.filter((x): x is AbiFunction => x.type === 'function' && STEPS.includes(x.name));
  const selectors = new Set(steps.map((f) => toFunctionSelector(f).slice(2)));
  const needle = encodeAbiParameters([steps[0]!.inputs[0]!], [terms]).slice(2).toLowerCase();
  const hex = input.slice(2).toLowerCase();
  const out: RulesCall[] = [];
  for (let at = hex.indexOf(needle); at !== -1 && out.length < EMBEDDED_MAX; at = hex.indexOf(needle, at + 2)) {
    if (at < 8 || at % 2 !== 0 || !selectors.has(hex.slice(at - 8, at))) continue;
    const call = decodeRules(chain, `0x${hex.slice(at - 8, at - 8 + EMBEDDED_WINDOW_HEX)}`);
    if (call) out.push(call);
  }
  return out;
}

/** The commitments a transaction's logs name: the first topic of every rules-contract log, in log order. */
export function idsOf(chain: Pick<EvmChain, 'deployment'>, logs: ReadonlyArray<{ address: string; topics: readonly Hex[] }>): Hex32[] {
  const rules = lc(chain.deployment.rules);
  const ids: Hex32[] = [];
  for (const l of logs) {
    const id = l.topics[1];
    if (lc(l.address) === rules && id && !ids.includes(id as Hex32)) ids.push(id as Hex32);
  }
  return ids;
}

/** One RPC client's reads for a pass, counted. */
class Reader {
  rpc = 0;
  private readonly times = new Map<bigint, { timestamp: number; hash: Hex }>();
  constructor(private readonly chain: EvmChain) {}

  head(): Promise<bigint> {
    this.rpc++;
    return this.chain.publicClient.getBlockNumber({ cacheTime: 0 });
  }

  async block(n: bigint): Promise<{ timestamp: number; hash: Hex }> {
    const hit = this.times.get(n);
    if (hit) return hit;
    this.rpc++;
    const b = await this.chain.publicClient.getBlock({ blockNumber: n });
    const out = { timestamp: Number(b.timestamp), hash: b.hash! };
    this.times.set(n, out);
    return out;
  }

  /**
   * The transactions with a rules-contract log in [from, to], in chain order, with the commitments each names. `id`
   * narrows the read to one commitment (its logs' first topic). Chunks of at most LOG_RANGE blocks.
   */
  async logs(from: bigint, to: bigint, id?: Hex32, after = from - 1n): Promise<{ count: number; txs: Array<{ hash: Hex; block: bigint; ids: Hex32[] }> }> {
    const byTx = new Map<Hex, { order: [bigint, number]; logs: Array<{ address: Address; topics: Hex[] }> }>();
    let count = 0;
    const read = async (start: bigint, end: bigint, depth = 0): Promise<RpcLog[]> => {
      try {
        return await this.range(start, end, id);
      } catch (e) {
        // A provider that caps a response's logs or blocks: halve the range. Anyone can make many logs cheaply (an
        // expireOffer with made-up terms), so a busy range must not stop the view (red-team 2026-11-04, finding 4).
        const text = `${(e as Error).message} ${String((e as { details?: unknown }).details ?? '')}`;
        if (end <= start || depth >= MAX_HALVINGS || !CAPPED.test(text) || RATED.test(text)) throw e;
        const mid = start + (end - start) / 2n;
        return [...(await read(start, mid, depth + 1)), ...(await read(mid + 1n, end, depth + 1))];
      }
    };
    for (let start = from; start <= to; start += LOG_RANGE) {
      const end = start + LOG_RANGE - 1n < to ? start + LOG_RANGE - 1n : to;
      const logs = await read(start, end);
      for (const l of logs) {
        if (l.removed) continue;
        if (BigInt(l.blockNumber!) > after) count++;
        const hash = l.transactionHash as Hex;
        const entry = byTx.get(hash) ?? { order: [BigInt(l.blockNumber!), Number(l.transactionIndex)], logs: [] };
        entry.logs.push({ address: getAddress(l.address), topics: l.topics as Hex[] });
        byTx.set(hash, entry);
      }
    }
    const txs = [...byTx.entries()]
      .sort(([, a], [, b]) => (a.order[0] === b.order[0] ? a.order[1] - b.order[1] : a.order[0] < b.order[0] ? -1 : 1))
      .map(([hash, e]) => ({ hash, block: e.order[0], ids: idsOf(this.chain, e.logs) }));
    return { count, txs };
  }

  /** One eth_getLogs over [start, end], every rules-contract log or one commitment's. */
  private range(start: bigint, end: bigint, id?: Hex32): Promise<RpcLog[]> {
    this.rpc++;
    return this.chain.publicClient.request({
      method: 'eth_getLogs',
      params: [{ address: this.chain.deployment.rules, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, ...(id ? { topics: [null, id] } : {}) }],
    });
  }

  /** A transaction, its receipt and its block's time. Only successful transactions leave logs. */
  async tx(hash: Hex): Promise<ChainTx> {
    this.rpc += 2;
    const [tx, receipt] = await Promise.all([this.chain.publicClient.getTransaction({ hash }), this.chain.publicClient.getTransactionReceipt({ hash })]);
    const { timestamp } = await this.block(receipt.blockNumber);
    return {
      hash,
      from: getAddress(tx.from),
      to: tx.to ? getAddress(tx.to) : null,
      input: tx.input,
      block: receipt.blockNumber.toString(),
      timestamp,
      gasUsed: receipt.gasUsed.toString(),
      logs: receipt.logs.map((l) => ({ address: getAddress(l.address), topics: [...l.topics] as Hex[], data: l.data, logIndex: Number(l.logIndex) })),
    };
  }

  /** dealOf's stage and appeal state for each commitment, at block `at`. */
  async stages(evm: EvmSettlement, ids: Iterable<Hex32>, at: bigint): Promise<Map<Hex32, { stage: string; appeal: number }>> {
    const out = new Map<Hex32, { stage: string; appeal: number }>();
    for (const id of ids) {
      this.rpc++;
      out.set(id, await evm.stage(id, at));
    }
    return out;
  }
}

/**
 * Every transaction this node has not applied for one commitment, from the deployment's first block to the head, read
 * and ready to apply: for a commitment the world joins late (its offer posted after its funding) or a delivery posted
 * after it landed directly. With `atLeast`, a node whose head trails that block is not read past (docs/team.md, a read
 * after a write): the call throws, and the caller asks again (T-230). Throws on an RPC error.
 */
export async function commitmentTxs(evm: EvmSettlement, id: Hex32, atLeast?: bigint): Promise<{ txs: ChainTx[]; stages: Map<Hex32, { stage: string; appeal: number }> }> {
  const read = new Reader(evm.world);
  const head = await read.head();
  if (atLeast !== undefined && head < atLeast) throw new Error(`the RPC node's latest block ${head} trails block ${atLeast}`);
  const { txs } = await read.logs(evm.world.deployment.fromBlock, head, id);
  const out: ChainTx[] = [];
  for (const t of txs) if (!evm.applied(id, t.hash)) out.push(await read.tx(t.hash));
  return { txs: out, stages: await read.stages(evm, [id], head) };
}

/**
 * The view's reader of the chain. `read` reads from the cursor to the head and applies what it found; the world writes
 * the books and events, then the cursor `read` returned, then calls `commit`. Opening reads nothing.
 */
export class ChainSync {
  private stored: Cursor | null;

  constructor(
    private readonly evm: EvmSettlement,
    cursor: Cursor | null = null,
  ) {
    this.stored = cursor;
  }

  /** The last block applied and written, or null before the first pass (the deployment's first block comes next). */
  get cursor(): Cursor | null {
    return this.stored;
  }

  /**
   * One pass: every rules-contract log after the cursor, up to the head. Reads everything first (logs, the transactions
   * this node has not applied, dealOf for the deals they touch, the head's hash), then applies. Null when no block is
   * new. Throws on an RPC error, having applied nothing.
   */
  async read(): Promise<{ cursor: Cursor; report: SyncReport } | null> {
    const chain = this.evm.world;
    const read = new Reader(chain);
    // A relay recorded after this mark may move a deal past the dealOf read below: observe does not check that deal.
    const mark = this.evm.eventCount();
    const head = await read.head();
    const last = this.stored ? BigInt(this.stored.block) : chain.deployment.fromBlock - 1n;
    if (last >= head) return null;
    // The last OVERLAP blocks again: a load-balanced RPC can answer from a node a block behind with no error. A
    // transaction applies once, so the overlap costs only the read (review 2026-11-04, L2).
    const from = last + 1n - OVERLAP > chain.deployment.fromBlock ? last + 1n - OVERLAP : chain.deployment.fromBlock;
    const { count, txs } = await read.logs(from, head, undefined, last);
    const fetched: ChainTx[] = [];
    const touched = new Set<Hex32>();
    for (const t of txs) {
      const want = t.ids.filter((id) => this.evm.follows(id) && !this.evm.applied(id, t.hash));
      if (want.length === 0) continue;
      for (const id of want) touched.add(id);
      fetched.push(await read.tx(t.hash));
    }
    const stages = await read.stages(this.evm, touched, head);
    const { hash } = await read.block(head);
    const observed = await this.evm.observe(fetched, stages, mark);
    // Logs of commitments this node never saw are counted, not fetched (T-218: no book is invented).
    const unknown = new Set(txs.filter((t) => t.block > last).flatMap((t) => t.ids.filter((id) => !this.evm.follows(id))));
    return {
      cursor: { block: head.toString(), hash },
      report: { ...observed, unknown: unknown.size, from: from.toString(), to: head.toString(), logs: count, txs: txs.length, rpc: read.rpc },
    };
  }

  /** Moves the cursor once the books and events `read` changed are written. */
  commit(c: Cursor): void {
    this.stored = c;
  }

  /** `read`, then `commit` at once: for a settlement with no store (tests, a script). */
  async pass(): Promise<SyncReport | null> {
    const r = await this.read();
    if (!r) return null;
    this.commit(r.cursor);
    return r.report;
  }
}
