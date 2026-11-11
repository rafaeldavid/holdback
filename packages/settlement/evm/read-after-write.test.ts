// T-232: every chain read the operators make right after a write sees that write. A load-balanced RPC such as
// publicnode can answer a read from a node a block or more behind, which still shows the state before the write; that
// came back five times on Sepolia (T-226, round 1's 3d and 10a, 3b's bond deposit, T-228, scenario 8). Here anvil stands
// in for Sepolia (a block every second at wall-clock time) behind a stand-in for such an RPC (`trailing`): after each
// receipt it hands out, a read that names no block, and its latest block, come from the block before that receipt, and
// a read pinned past that block finds no header the first `misses` times. Each test fails on an unpinned read and passes
// on one pinned to the write's block or later. Needs `anvil` on PATH and `forge build` output in contracts/out.
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { wholeSecond, type Address, type Club } from '@holdback/core';
import { BlockNotFoundError, encodeFunctionData, type Hex, type PublicClient } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission } from '../src/interface.js';
import { RelayRefused } from './chain.js';
import { EvmSettlement } from './evm-settlement.js';
import { FUNDING_LANE, LiveChain, type DeploymentFile } from './live.js';
import { ChainSync, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's fifth well-known dev key (public; guards no value): this file's relayer secret. */
const RELAYER: Hex = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a';
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What `trailing`'s stand-in node does, and every state read it was asked. */
interface Trail {
  /** Off: every call goes to anvil as it is. */
  on: boolean;
  /** The block an unpinned read answers from: one before the newest receipt handed out, or null before any. */
  block: bigint | null;
  /** How many times a read pinned past `block` finds no header before it answers; Infinity: the node never catches up. */
  misses: number;
  missed: Map<bigint, number>;
  /** Each state read (eth_call, eth_estimateGas, eth_getBalance, eth_getTransactionCount) and the block it named. */
  reads: Array<{ method: string; block: bigint | 'latest' }>;
}

const newTrail = (misses = 1): Trail => ({ on: true, block: null, misses, missed: new Map(), reads: [] });

/**
 * `base` behind a stand-in for a load-balanced RPC whose nodes trail every write (round 1's 3b, 2026-11-05: a deposit
 * simulated 2 to 4 s after its approval mined, on a node without the approval). The node that answers a receipt has its
 * block; the next read lands on one a block behind it.
 */
function trailing(base: LiveChain, t: Trail): LiveChain {
  const client = new Proxy(base.publicClient, {
    get(target, prop) {
      // A state read: unpinned, from the trailing block; pinned past it, no header the first `t.misses` times.
      const state = (method: string, run: (args: Record<string, unknown>) => Promise<unknown>) => async (args: Record<string, unknown>) => {
        const pinned = typeof args['blockNumber'] === 'bigint' ? (args['blockNumber'] as bigint) : null;
        t.reads.push({ method, block: pinned ?? 'latest' });
        if (!t.on || t.block === null) return run(args);
        if (pinned === null) {
          const rest = { ...args };
          delete rest['blockTag'];
          return run({ ...rest, blockNumber: t.block });
        }
        if (pinned > t.block) {
          const n = t.missed.get(pinned) ?? 0;
          if (n < t.misses) {
            t.missed.set(pinned, n + 1);
            throw new BlockNotFoundError({ blockNumber: pinned });
          }
        }
        return run(args);
      };
      const call = <K extends keyof PublicClient>(k: K) => (a: Record<string, unknown>) => (target[k] as (x: unknown) => Promise<unknown>)(a);
      if (prop === 'readContract') return state('eth_call', call('readContract'));
      if (prop === 'call') return state('eth_call', call('call'));
      if (prop === 'estimateGas') return state('eth_estimateGas', call('estimateGas'));
      if (prop === 'getBalance') return state('eth_getBalance', call('getBalance'));
      if (prop === 'getTransactionCount') return state('eth_getTransactionCount', call('getTransactionCount'));
      if (prop === 'getBlockNumber') return async (args?: { cacheTime?: number }) => (t.on && t.block !== null ? t.block : target.getBlockNumber({ ...args, cacheTime: 0 }));
      if (prop === 'getTransactionReceipt') {
        return async (args: Parameters<typeof target.getTransactionReceipt>[0]) => {
          const r = await target.getTransactionReceipt(args);
          if (t.on && (t.block === null || r.blockNumber - 1n > t.block)) t.block = r.blockNumber - 1n;
          return r;
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const c = Object.create(base) as LiveChain;
  Object.defineProperty(c, 'publicClient', { value: client });
  return c;
}

/**
 * The reads that named no block. A lane's pending nonce count has none to name: the nonce after the lane's last mined
 * transaction is its floor instead (the nonce test below).
 */
const unpinned = (t: Trail) => t.reads.filter((r) => r.block === 'latest' && r.method !== 'eth_getTransactionCount');

/**
 * A JSON-RPC stand-in over HTTP for a node without the block a read names: every eth_call answers `error`, in the shape
 * a real node sends (review of PR 239: viem rewraps a code -32603 answer as a contract revert). `calls` counts them.
 */
async function missingBlockRpc(error: { code: number; message: string; data?: Hex }) {
  const seen = { calls: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const r = JSON.parse(body) as { id: number; method: string } | Array<{ id: number; method: string }>;
      const one = (q: { id: number; method: string }) => {
        if (q.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: q.id, result: '0x64' };
        if (q.method === 'eth_call') seen.calls++;
        return { jsonrpc: '2.0', id: q.id, error };
      };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(r) ? r.map(one) : one(r)));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const close = () =>
    new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close };
}

describe('a pinned contract read asks again when a node answers it has no such block (review of PR 239)', () => {
  const token = '0x00000000000000000000000000000000000000b1' as Address;
  const file: DeploymentFile = {
    chainId: 31337,
    fromBlock: 1,
    token: { address: token, name: 'Test USDC', version: '2', symbol: 'tUSDC', decimals: 6 },
    escrow: '0x00000000000000000000000000000000000000b2',
    erc3009Collector: '0x00000000000000000000000000000000000000b3',
    permit2Collector: '0x00000000000000000000000000000000000000b4',
    multicall: '0x00000000000000000000000000000000000000b5',
    rules: '0x00000000000000000000000000000000000000b6',
    beacon: '0x00000000000000000000000000000000000000b8',
  };
  /** eth_calls for one balanceOf read at a block: once as a caller would, then through the chain's pinned read. */
  async function calls(error: { code: number; message: string; data?: Hex }): Promise<{ once: number; pinned: number }> {
    const rpc = await missingBlockRpc(error);
    try {
      // A 2 s bound (pollMs 400): viem retries a -32603 inside its transport, about 1 s a try.
      const c = new LiveChain({ deployment: file, rpcUrls: [rpc.url], relayerKey: RELAYER, pollMs: 400 });
      const read = (blockNumber: bigint) => c.publicClient.readContract({ address: token, abi: c.abis.token, functionName: 'balanceOf', args: [token], blockNumber });
      await expect(read(100n)).rejects.toThrow();
      const once = rpc.seen.calls;
      await expect(c.pinned(read)).rejects.toThrow();
      return { once, pinned: rpc.seen.calls - once };
    } finally {
      await rpc.close();
    }
  }

  it.each([
    { code: -32603, message: 'header not found' },
    { code: -32603, message: 'block not found: 0xb82718' },
    { code: -32000, message: 'unknown block' },
  ])('$code "$message" is asked again at least once', async (error) => {
    const { once, pinned } = await calls(error);
    expect(pinned).toBeGreaterThanOrEqual(2 * once);
  }, 30_000);

  it("a revert is the contract's answer at that block, and is not asked again", async () => {
    const { once, pinned } = await calls({ code: 3, message: 'execution reverted', data: '0x7939f424' });
    expect(pinned).toBe(once);
  }, 30_000);
});

describe.skipIf(!ready)(`T-232: reads after a write on a node that trails it${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let base: LiveChain;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  const wall = () => Date.now();
  const cast = evmCast();

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
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
    base = chainOf();
    for (const a of [...base.lanes.map((l) => l.address), ...Object.values(cast).map((a) => a.address)]) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start: wholeSecond(wall()), buyer: 0n }));
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  const chainOf = () => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
  const ok = async (s: EvmSettlement, sub: Submission) => {
    const r = await s.submit(sub, { via: 'op-1' });
    if (!r.ok) throw new Error(`${sub.kind}: ${r.problem.type}: ${r.problem.detail}`);
    return r;
  };
  async function head(): Promise<Cursor> {
    const n = await anvil.publicClient.getBlockNumber({ cacheTime: 0 });
    return { block: n.toString(), hash: (await anvil.publicClient.getBlock({ blockNumber: n })).hash! };
  }

  it("funds right after the faucet's mint, delivers right after the funding, and answers the release with the seller paid", async () => {
    const t = newTrail();
    const chain = trailing(base, t);
    const s = await EvmSettlement.restore(chain, genesis, undefined, wall);
    const d = new EvmDeal(s, cast, club, 't232-relays');
    const price = BigInt(d.terms.price.amount);
    const fee = BigInt(d.terms.adjudication.fee.amount);
    // The faucet's grant: the funding lane mints the buyer exactly the hold.
    await chain.mint(cast.buyer.address, price + fee);
    s.forgetBalances([cast.buyer.address]);
    expect((await s.balances([cast.buyer.address]))[cast.buyer.address]!.amount).toBe((price + fee).toString());
    await ok(s, await d.offer());
    await ok(s, await d.accept());
    // The funding's balance check reads the buyer after the mint, not before it.
    expect((await ok(s, await d.agreeAndFund())).state.escrowState).toBe('Held');
    // The delivery's simulation runs at the funding's block or later: a node before it would refuse it WrongStage.
    expect((await ok(s, await d.deliver())).state.escrowState).toBe('Delivered');
    const seller = BigInt((await s.balances([cast.seller.address]))[cast.seller.address]!.amount);
    const released = await ok(s, await d.decide('primary', 'accept'));
    expect(released.state.escrowState).toBe('Released');
    // The answer's balances are read after the release.
    expect(BigInt(released.state.balances?.[cast.seller.address]?.amount ?? -1)).toBe(seller + price);
    expect(unpinned(t)).toEqual([]);

    // A restart reads no earlier than the last block its saved log names (T-219's restore).
    const saved = s.drain();
    const blockOf = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? BigInt(v) : 0n);
    const last = saved.events.reduce((n, e) => (blockOf(e.payload['block']) > n ? blockOf(e.payload['block']) : n), 0n);
    expect(last).toBeGreaterThan(0n);
    const t2: Trail = { ...newTrail(), block: last - 1n };
    const restarted = await EvmSettlement.restore(trailing(chainOf(), t2), genesis, { books: saved.books, events: saved.events, mandates: saved.mandates }, wall);
    expect((await restarted.balances([cast.seller.address]))[cast.seller.address]!.amount).toBe((seller + price).toString());
    expect(t2.reads.length).toBeGreaterThan(0);
    for (const r of t2.reads) expect(r.block !== 'latest' && r.block >= last, `${r.method} at ${r.block}`).toBe(true);
  }, 120_000);

  describe('every read the operators serve after a write names a block at or after it', () => {
    const someone = testActor('t232-reader');
    const reads: Array<[string, (s: EvmSettlement, chain: LiveChain) => Promise<unknown>]> = [
      ['dealOf (stage)', (s) => s.stage(`0x${'12'.repeat(32)}`)],
      ['a token balance', (s) => s.tokenBalance(someone.address, true)],
      ['the balances an answer shows', (s) => s.balances([someone.address])],
      ["a lane's test ETH (topUpLanes)", (_s, chain) => chain.ethBalance(someone.address)],
      ["a relay's simulation", (_s, chain) => chain.simulate({ from: cast.buyer.address, to: deployment.token.address as Address, data: encodeFunctionData({ abi: base.abis.token, functionName: 'approve', args: [someone.address, 1n] }) })],
    ];
    it.each(reads)('%s', async (_name, read) => {
      const t = newTrail();
      const chain = trailing(base, t);
      const s = await EvmSettlement.restore(chain, genesis, undefined, wall);
      const mined = await chain.mint(someone.address, 1n);
      t.reads.length = 0;
      await read(s, chain);
      expect(t.reads.length).toBeGreaterThan(0);
      for (const r of t.reads) expect(r.block !== 'latest' && r.block >= mined.blockNumber, `${r.method} at ${r.block}, the write at ${mined.blockNumber}`).toBe(true);
    }, 30_000);
  });

  it('a balance read before a pass applied the chain is not served after it (try.mjs: two operators answer the same balance)', async () => {
    const t = newTrail();
    const chain = trailing(base, t);
    const other = await EvmSettlement.restore(chain, genesis, undefined, wall);
    const sync = new ChainSync(other, await head());
    const holder = testActor('t232-cached');
    const before = BigInt((await other.balances([holder.address]))[holder.address]!.amount);
    // Another node's write moves the balance (op1's release, in try.mjs); this node's next pass reads the chain past it,
    // within the 4 s a balance read is reused.
    const mined = await base.mint(holder.address, 7n);
    const r = await sync.pass();
    expect(BigInt(r!.to) >= mined.blockNumber).toBe(true);
    expect(BigInt((await other.balances([holder.address]))[holder.address]!.amount)).toBe(before + 7n);
  }, 30_000);

  it("a lane's nonce after a refused broadcast is the one after its last mined transaction, on a node whose pending count trails it", async () => {
    const t = newTrail();
    const chain = trailing(base, t);
    const to = testActor('t232-nonce').address;
    const first = await chain.send({ lane: FUNDING_LANE, to, data: '0x', value: 1n });
    const nonce = (await anvil.publicClient.getTransaction({ hash: first.hash })).nonce;
    // The node refuses the next broadcast (insufficient funds): the lane forgets its nonce and reads it again.
    const raw = base.publicClient.sendRawTransaction;
    let refuse = true;
    Object.defineProperty(base.publicClient, 'sendRawTransaction', {
      configurable: true,
      value: async (a: Parameters<typeof raw>[0]) => {
        if (refuse) {
          refuse = false;
          throw new Error('insufficient funds for gas * price + value');
        }
        return raw.call(base.publicClient, a);
      },
    });
    try {
      await expect(chain.send({ lane: FUNDING_LANE, to, data: '0x', value: 1n })).rejects.toBeInstanceOf(RelayRefused);
    } finally {
      Object.defineProperty(base.publicClient, 'sendRawTransaction', { configurable: true, value: raw });
    }
    const next = await chain.send({ lane: FUNDING_LANE, to, data: '0x', value: 1n });
    expect(next.status).toBe('success');
    expect((await anvil.publicClient.getTransaction({ hash: next.hash })).nonce).toBe(nonce + 1);
  }, 60_000);

  it('a pinned read on a node that never catches up fails after its bound, and never answers from the latest block', async () => {
    const t = newTrail(Infinity);
    const chain = trailing(base, t);
    const s = await EvmSettlement.restore(chain, genesis, undefined, wall);
    const holder = testActor('t232-never');
    await chain.mint(holder.address, 1n);
    t.reads.length = 0;
    const started = Date.now();
    await expect(s.tokenBalance(holder.address, true)).rejects.toBeInstanceOf(BlockNotFoundError);
    await expect(chain.simulate({ from: cast.buyer.address, to: deployment.token.address as Address, data: encodeFunctionData({ abi: base.abis.token, functionName: 'approve', args: [holder.address, 1n] }) })).rejects.toBeInstanceOf(BlockNotFoundError);
    // Five tries each, within five receipt polls (pollMs 100 here; 2 s, so 10 s, on Sepolia).
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(t.reads.filter((r) => r.method === 'eth_call')).toHaveLength(5);
    expect(unpinned(t)).toEqual([]);
  }, 30_000);

  it("a pass whose head trails this node's own write reads nothing, and the next one past it applies", async () => {
    const t = newTrail();
    const chain = trailing(base, t);
    const s = await EvmSettlement.restore(chain, genesis, undefined, wall);
    const start = await head();
    const sync = new ChainSync(s, start);
    await sleep(2_100);
    const mined = await chain.mint(testActor('t232-sync').address, 1n);
    // The stand-in's latest block is the one before the mint, and past the cursor.
    expect(t.block).toBe(mined.blockNumber - 1n);
    expect(t.block! > BigInt(start.block)).toBe(true);
    expect(await sync.read()).toBeNull();
    expect(sync.cursor).toEqual(start);
    t.on = false;
    await sleep(1_100);
    const r = await sync.pass();
    expect(BigInt(r!.to) >= mined.blockNumber).toBe(true);
  }, 30_000);

  it("a deal lane topped up a moment ago is not topped up again: its balance is read at the top-up's block", async () => {
    const t = newTrail();
    const chain = trailing(base, t);
    const floor = 10n ** 17n;
    const lane = base.lanes[1]!.address;
    for (const l of base.lanes.slice(1)) await anvil.rpc('anvil_setBalance', [l.address, '0x56bc75e2d63100000']);
    await anvil.rpc('anvil_setBalance', [lane, '0x1']);
    await anvil.rpc('evm_mine', []);
    expect(await chain.topUpLanes(floor, 2n * floor)).toHaveLength(1);
    expect(await chain.topUpLanes(floor, 2n * floor)).toEqual([]);
    expect(unpinned(t).filter((r) => r.method === 'eth_getBalance')).toEqual([]);
  }, 30_000);
});
