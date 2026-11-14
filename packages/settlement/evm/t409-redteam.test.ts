// Red team of T-409 (2026-11-14), adopted as regression tests. The probes were in reports/scratch/t-409/redteam/
// (git-ignored); each `it` asserts the defended outcome, and the comment above it says what the relay did before its fix.
// Three findings:
//   L3, a regression of T-409's own nonce change: a receipt whose block's header read fails left the funding lane with
//       no nonce cache, so its next send against a node that trails the receipt took the mined nonce.
//   L2: a node's "no such block" answer that carries `data` was read as a contract revert by the timeouts pass's check
//       and by the relay's simulation.
//   M1: one sync pass whose eth_getLogs comes from a backend more than OVERLAP blocks behind moves the cursor past a
//       direct transaction, which no later pass applies; the operators' timeout pass only backed off on its WrongStage.
// The `missingBlock` cases need no chain. The rest need anvil on PATH and `forge build` output in contracts/out; CI's
// anvil job runs them (the settlement leg runs every file in packages/settlement/evm).
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { wholeSecond, type Address, type Club } from '@holdback/core';
import { BlockNotFoundError, encodeFunctionData, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission } from '../src/interface.js';
import type { LaneRow } from './chain.js';
import { acceptanceView, agreeView, termsView } from './encode.js';
import { missingBlock } from './errors.js';
import { EvmSettlement } from './evm-settlement.js';
import { FUNDING_LANE, LiveChain, type DeploymentFile, type LaneStore } from './live.js';
import { ChainSync, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor } from './testing.js';
import { OperatorTimeouts, type TimeoutReport } from './timeouts.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's well-known dev keys #4, #6, #7 and #8 (public; guard no value): one relayer secret per finding. */
const RELAYER_FAKE: Hex = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a';
const RELAYER_L3: Hex = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
const RELAYER_L2: Hex = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';
const RELAYER_M1: Hex = '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356';
const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled'];
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A deployment file for a stand-in RPC with no contracts behind it. */
const fakeFile: DeploymentFile = {
  chainId: 31337,
  fromBlock: 1,
  token: { address: '0x00000000000000000000000000000000000000b1', name: 'Test USDC', version: '2', symbol: 'tUSDC', decimals: 6 },
  escrow: '0x00000000000000000000000000000000000000b2',
  erc3009Collector: '0x00000000000000000000000000000000000000b3',
  multicall: '0x00000000000000000000000000000000000000b5',
  rules: '0x00000000000000000000000000000000000000b6',
  beacon: '0x00000000000000000000000000000000000000b8',
};

type RpcError = { code: number; message: string; data?: unknown };

/** A JSON-RPC stand-in over HTTP whose every state read answers `error`; eth_chainId and eth_blockNumber answer. */
async function errorRpc(error: RpcError) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const q = JSON.parse(body) as { id: number; method: string } | Array<{ id: number; method: string }>;
      const one = (r: { id: number; method: string }) =>
        r.method === 'eth_chainId' ? { jsonrpc: '2.0', id: r.id, result: '0x7a69' } : r.method === 'eth_blockNumber' ? { jsonrpc: '2.0', id: r.id, result: '0x64' } : { jsonrpc: '2.0', id: r.id, error };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(q) ? q.map(one) : one(q)));
    });
  });
  await new Promise<void>((d) => server.listen(0, '127.0.0.1', d));
  const close = () =>
    new Promise<void>((d) => {
      server.closeAllConnections();
      server.close(() => d());
    });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close };
}

/** The shapes a node answers for a block it does not have, from the red team's probe (refusal.redteam-probe). */
const MISSING: RpcError[] = [
  { code: -32000, message: 'header not found' },
  { code: -32603, message: 'header not found' },
  { code: -32602, message: 'block not found' },
  { code: -32001, message: 'block not found: 0x64' },
  { code: -32000, message: 'header not found', data: '0x' },
  { code: -32000, message: 'block not found', data: { message: 'block not found', data: '0x' } },
  { code: -32603, message: 'Internal error', data: { message: 'header not found' } },
];
/** Answers that are not a missing block: a pruned state, and a contract revert with its data. */
const NOT_MISSING: RpcError[] = [
  { code: -32000, message: 'missing trie node 0000000000000000000000000000000000000000000000000000000000000000 (path ) state 0x0 is not available' },
  { code: 3, message: 'execution reverted', data: '0x7939f424' },
];
/** The error LiveChain's own transport throws for `error`, on an eth_call and on an eth_estimateGas. */
async function thrown(error: RpcError): Promise<{ call: unknown; estimate: unknown }> {
  const rpc = await errorRpc(error);
  try {
    const c = new LiveChain({ deployment: fakeFile, rpcUrls: [rpc.url], relayerKey: RELAYER_FAKE, pollMs: 100 });
    const a = fakeFile.rules as Address;
    const call = await c.publicClient.call({ account: a, to: a, data: '0x12345678', blockNumber: 100n }).then(() => null, (e: unknown) => e);
    const estimate = await c.publicClient.estimateGas({ account: a, to: a, data: '0x12345678', blockNumber: 100n }).then(() => null, (e: unknown) => e);
    return { call, estimate };
  } finally {
    await rpc.close();
  }
}

describe("missingBlock reads every shape of a node's no-such-block answer, through LiveChain's own transport (T-409, L2)", () => {
  it.each(MISSING)('%o is a missing block on eth_call and eth_estimateGas', async (shape) => {
    const { call, estimate } = await thrown(shape);
    expect({ call: missingBlock(call), estimate: missingBlock(estimate) }).toEqual({ call: true, estimate: true });
  }, 30_000);

  it.each(NOT_MISSING)('%o is not a missing block', async (shape) => {
    const { call, estimate } = await thrown(shape);
    expect({ call: missingBlock(call), estimate: missingBlock(estimate) }).toEqual({ call: false, estimate: false });
  }, 30_000);

  it("viem's own BlockNotFoundError is a missing block", () => {
    expect(missingBlock(new BlockNotFoundError({ blockNumber: 100n }))).toBe(true);
  });

  // An accepted limit: a revert whose reason contains the words is read as a missing block, so it is asked again and
  // then thrown as an RPC failure (a 30 s back-off), never sent. The contract's own errors are custom errors with no
  // such text, so only a token or another contract's reason string could say it.
  it('an accepted limit: a revert reason that says "header not found" is read as a missing block', async () => {
    const { call } = await thrown({ code: -32000, message: 'execution reverted: header not found for block 0x64' });
    expect(missingBlock(call)).toBe(true);
  }, 30_000);
});

/**
 * `base` behind a stand-in RPC: anvil's estimate bug shim from timeouts.test.ts, and `f`'s faults. Each fault is read on
 * every call, so a test can switch it.
 */
interface Faults {
  /** eth_call (the timeouts pass's check) goes to this stand-in node, which has no such block. */
  callTo?: LiveChain;
  /** eth_estimateGas (the relay's simulation) goes to this stand-in node. */
  estimateTo?: LiveChain;
  /** Every block-header read fails, as a node behind that block answers. */
  headerFails?: boolean;
  /** Unpinned reads (latest, pending) and eth_blockNumber answer from this block, as a node behind the receipt. */
  trailAt?: bigint;
  /** eth_getLogs answers as a node at this block would (toBlock clamped), with no error. */
  logsAt?: bigint;
}

function standIn(base: LiveChain, f: Faults): LiveChain {
  const client = new Proxy(base.publicClient, {
    get(target, prop) {
      if (prop === 'call') return (args: Parameters<typeof target.call>[0]) => (f.callTo ? f.callTo.publicClient.call(args) : target.call(args));
      if (prop === 'estimateGas') {
        return async (args: { account: Address; to: Address; data: Hex; value?: bigint; blockNumber?: bigint }) => {
          if (f.estimateTo) return f.estimateTo.publicClient.estimateGas(args);
          try {
            return await target.estimateGas(args);
          } catch (e) {
            if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
            await target.call(args);
            return 1_000_000n;
          }
        };
      }
      if (prop === 'getBlock') {
        return async (args: Parameters<typeof target.getBlock>[0]) => {
          if (f.headerFails) throw new BlockNotFoundError({ blockNumber: (args as { blockNumber?: bigint } | undefined)?.blockNumber ?? 0n });
          return target.getBlock(args);
        };
      }
      if (prop === 'getBlockNumber') return async (args?: { cacheTime?: number }) => (f.trailAt !== undefined ? f.trailAt : target.getBlockNumber(args));
      if (prop === 'getTransactionCount') {
        return async (args: { address: Address; blockTag?: 'pending' | 'latest'; blockNumber?: bigint }) => {
          if (f.trailAt !== undefined && args.blockNumber === undefined) return target.getTransactionCount({ address: args.address, blockNumber: f.trailAt });
          return target.getTransactionCount(args);
        };
      }
      if (prop === 'request') {
        return async (args: { method: string; params: Array<{ toBlock?: Hex; fromBlock?: Hex }> }) => {
          if (args.method === 'eth_getLogs' && f.logsAt !== undefined) {
            const p = { ...args.params[0]! };
            if (BigInt(p.fromBlock!) > f.logsAt) return [];
            if (BigInt(p.toBlock!) > f.logsAt) p.toBlock = `0x${f.logsAt.toString(16)}`;
            return target.request({ ...args, params: [p] } as Parameters<typeof target.request>[0]);
          }
          return target.request(args as Parameters<typeof target.request>[0]);
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

const memoryStore = (rows: Map<string, LaneRow>): LaneStore => ({
  load: async () => [...rows.values()].map((r) => structuredClone(r)),
  write: async (r) => void rows.set(`${lc(r.from)}:${r.nonce}`, structuredClone(r)),
  remove: async (rs) => {
    for (const r of rs) rows.delete(`${lc(r.from)}:${r.nonce}`);
  },
});

const outcome = (p: Promise<{ status: string }>) =>
  p.then(
    (m) => m.status,
    (e: unknown) => `${(e as Error).name}: ${String((e as Error).message).split('\n').find((l) => /nonce|not mined|header|block/i.test(l))?.slice(0, 120) ?? String((e as Error).message).slice(0, 120)}`,
  );
const settle = <T>(p: Promise<T>): Promise<{ value: T } | { error: string }> => p.then((value) => ({ value }), (e: unknown) => ({ error: `${(e as Error).name}: ${String((e as Error).message).split('\n')[0]!.slice(0, 120)}` }));

describe.skipIf(!ready)(`T-409 red team on anvil${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  let skew = 0;
  const wall = () => Date.now() + skew;
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
      multicall: d.multicall,
      rules: d.rules,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
    const lanes = [RELAYER_L3, RELAYER_L2, RELAYER_M1].flatMap((k) => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: k }).lanes.map((l) => l.address));
    for (const a of [...lanes, ...Object.values(cast).map((a) => a.address)]) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start: wholeSecond(wall()), buyer: 0n }));
    // The world's sim beacon is the contract's SimBeacon, deployed with the zero seed (world.ts).
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
    await new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_M1, pollMs: 100, mintBatchMs: 50 }).mint(cast.buyer.address, 10n ** 12n);
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  async function head(): Promise<Cursor> {
    const n = await anvil.publicClient.getBlockNumber({ cacheTime: 0 });
    return { block: n.toString(), hash: (await anvil.publicClient.getBlock({ blockNumber: n })).hash! };
  }
  const ok = async (s: EvmSettlement, sub: Submission) => {
    const r = await s.submit(sub, { via: 'op-1' });
    if (!r.ok) throw new Error(`${sub.kind}: ${r.problem.type}: ${r.problem.detail}`);
    return r;
  };
  async function funded(tag: string, s: EvmSettlement): Promise<EvmDeal> {
    const d = new EvmDeal(s, cast, club, tag);
    await ok(s, await d.offer());
    await ok(s, await d.accept());
    await ok(s, await d.agreeAndFund());
    return d;
  }
  /** Moves anvil's clock and the settlement's by `sec`, and waits for a block at the new time. */
  async function jump(sec: number): Promise<void> {
    await anvil.rpc('evm_increaseTime', [sec]);
    skew += sec * 1000;
    const target = BigInt(Math.floor(wall() / 1000) - 1);
    for (let i = 0; i < 100; i++) {
      if ((await anvil.publicClient.getBlock({ blockTag: 'latest' })).timestamp >= target) return;
      await sleep(100);
    }
    throw new Error(`anvil did not reach ${target}`);
  }
  const stageNow = async (id: Hex) => {
    const d = (await anvil.publicClient.readContract({ address: deployment.rules as Address, abi: anvil.abis.rules, functionName: 'dealOf', args: [id] })) as { stage: number };
    return STAGES[d.stage];
  };

  // L3. `fly` set the lane's nonce cache when it found the receipt, then read the block's time; when that header read
  // failed, `sendNow`'s catch deleted the cache. The funding lane keeps no row, so its next send resolves no orphan
  // first: it asked a node that trails the receipt for the lane's nonce and got the mined one ("nonce too low").
  it('attack.t409-nonce-after-header-read-fails: after a receipt whose header read fails, the funding lane sends at the next nonce', async () => {
    const base = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_L3, pollMs: 100, rebroadcastMs: 1_000, receiptTimeoutMs: 4_000, mintBatchMs: 50 });
    await base.attach(memoryStore(new Map()));
    const f: Faults = {};
    const c = standIn(base, f);
    const to = testActor('t409-nonce-funding').address;
    const tx = { lane: FUNDING_LANE, to, data: '0x' as Hex, value: 1n };
    // A mined send first, so the floor covers the lane's earlier history.
    const warm = await outcome(c.send(tx));
    f.headerFails = true;
    const first = await outcome(c.send(tx));
    const sender = c.senderFor(FUNDING_LANE);
    const now = await anvil.publicClient.getTransactionCount({ address: sender, blockTag: 'latest' });
    let minedBlock = await anvil.publicClient.getBlockNumber({ cacheTime: 0 });
    while ((await anvil.publicClient.getTransactionCount({ address: sender, blockNumber: minedBlock - 1n })) === now) minedBlock--;
    f.headerFails = false;
    // The node answering now is one block behind the receipt it just gave.
    f.trailAt = minedBlock - 1n;
    const second = await outcome(c.send(tx));
    delete f.trailAt;
    expect({ warm, first: /could not be found/.test(first), second }).toEqual({ warm: 'success', first: true, second: 'success' });
  }, 60_000);

  // L2, the timeouts pass's check (timeouts.ts `refusal`). A node's no-such-block answer with `data` read as a contract
  // revert: the pass logged "contract revert an unknown error", backed the deal off as refused (60 s), and said nothing
  // through onError. Defended: it is an RPC failure (onError, a 30 s back-off), and the next honest pass sends.
  it('attack.t409-missing-block-read-as-revert, the timeouts check: an RPC failure, never a refusal', async () => {
    const f: Faults = {};
    const c = standIn(new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_L2, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 }), f);
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    const errors: string[] = [];
    const pass = new OperatorTimeouts(s, { via: 'op-1', key: (id, kind) => `t409/${id}/${kind}`, graceMs: 0, onError: (e) => errors.push(e.message.slice(0, 160)) });
    const d = await funded('t409-l2-refusal', s);
    await jump(3_601); // past deliverBy: the reclaim is due
    const refused: string[] = [];
    let misses = 0;
    for (const shape of MISSING.filter((x) => x.data !== undefined)) {
      const rpc = await errorRpc(shape);
      try {
        f.callTo = new LiveChain({ deployment: fakeFile, rpcUrls: [rpc.url], relayerKey: RELAYER_FAKE, pollMs: 100 });
        const r = await pass.run();
        refused.push(...r.refused.map((x) => x.detail));
      } finally {
        delete f.callTo;
        await rpc.close();
      }
      // Past an RPC failure's back-off (30 s, doubling with each miss), so every shape meets the check.
      await jump(30 * 2 ** misses++ + 1);
    }
    const sent = await pass.run();
    expect({ refused, failures: errors.length, sent: sent.sent.map((x) => x.kind), stage: await stageNow(d.id) }).toEqual({ refused: [], failures: 3, sent: ['reclaim'], stage: 'Refunded' });
  }, 120_000);

  // L2, the relay's simulation (evm-settlement.ts `send`). The same answer to eth_estimateGas, once the pinned read's
  // bound ran out, was read as a contract revert: a party's trigger answered as a refusal of the deal, not a failure of
  // the node.
  it('attack.t409-missing-block-read-as-revert, the relay simulation: an RPC failure, never a refusal', async () => {
    const f: Faults = {};
    const c = standIn(new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_L2, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 }), f);
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    const d = await funded('t409-l2-simulate', s);
    await jump(3_601);
    const answers: string[] = [];
    for (const shape of MISSING.filter((x) => x.data !== undefined)) {
      const rpc = await errorRpc(shape);
      try {
        f.estimateTo = new LiveChain({ deployment: fakeFile, rpcUrls: [rpc.url], relayerKey: RELAYER_FAKE, pollMs: 100 });
        const r = await settle(s.trigger(d.id, 'reclaim', { via: 'op-1' }));
        answers.push('error' in r ? 'threw' : r.value.ok ? 'ok' : `refused ${r.value.problem.type}`);
      } finally {
        delete f.estimateTo;
        await rpc.close();
      }
    }
    const honest = await s.trigger(d.id, 'reclaim', { via: 'op-1' });
    expect({ answers, honest: honest.ok && honest.state.escrowState }).toEqual({ answers: ['threw', 'threw', 'threw'], honest: 'Refunded' });
  }, 120_000);

  // M1. One sync pass whose eth_getLogs comes from a backend more than OVERLAP (3) blocks behind still moves the cursor
  // to the head, so a direct reclaim mined in the gap is never applied: the book says Held while the chain says
  // Refunded, indefinitely, and the timeout pass met WrongStage and only backed off. Defended: on WrongStage the pass
  // reads the deal's own transactions again (`resync`), and the book follows the chain.
  it('attack.t409-sync-log-gap: a direct reclaim a lagging getLogs pass skipped reaches the book through the timeout pass', async () => {
    const f: Faults = {};
    const c = standIn(new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_M1, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 }), f);
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    const sync = new ChainSync(s, await head());
    const d = await funded('t409-m1-sync-gap', s);
    const matching = await funded('t409-m1-matching', s);
    await sync.pass();
    await jump(3_601); // past deliverBy
    const wallet = anvil.wallet(cast.buyer.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to: deployment.rules as Address, data: encodeFunctionData({ abi: anvil.abis.rules, functionName: 'reclaim', args: [termsView(d.terms)] }), gas: 3_000_000n });
    const r = await anvil.receipt(hash);
    // Four more blocks, so the head is past the reclaim by more than the overlap.
    while ((await anvil.publicClient.getBlockNumber({ cacheTime: 0 })) < r.blockNumber + 4n) await sleep(200);
    f.logsAt = r.blockNumber - 1n;
    await sync.pass();
    delete f.logsAt;
    for (let i = 0; i < 3; i++) {
      await sleep(1_100);
      await sync.pass();
    }
    // The gap: no pass reads the reclaim again.
    expect({ book: s.escrowState(d.id)?.kind, chain: await stageNow(d.id) }).toEqual({ book: 'Held', chain: 'Refunded' });
    const errors: string[] = [];
    const pass = new OperatorTimeouts(s, { via: 'op-1', key: (id, kind) => `t409/${id}/${kind}`, graceMs: 0, onError: (e) => errors.push(e.message) });
    // The other deal is due too; the pass sends its reclaim. Only the gap's deal meets WrongStage.
    const t1: TimeoutReport = await pass.run(BigInt(sync.cursor!.block));
    await sync.pass();
    const onChain = await stageNow(d.id);
    const view = (await s.state(d.id))?.escrowState;
    expect({ onChain, view, sent: t1.sent.map((x) => x.commitmentId), errors }).toEqual({ onChain: 'Refunded', view: 'Refunded', sent: [matching.id], errors: [] });

    // A resync of a deal whose book already matches the chain changes nothing; an unknown deal is no error.
    const events = s.log().length;
    const before = structuredClone(s.escrowState(matching.id));
    await s.resync(matching.id);
    await s.resync(d.id);
    await s.resync(`0x${'99'.repeat(32)}`);
    expect({ events: s.log().length, book: s.escrowState(matching.id) }).toEqual({ events, book: before });
  }, 120_000);

  // M1, the SC-6 path. A funding sent straight to the contract in the gap of a lagging eth_getLogs pass: the book keeps
  // the offer unfunded, and at its deadline the pass's offer expiry is refused ("the contract holds this deal Held ...
  // This node applies the funding at its next sync"), which no sync does. Defended: on that refusal the pass reads the
  // deal's own transactions again, and the book holds the funding.
  it('attack.t409-sync-log-gap-funding: a direct funding a lagging getLogs pass skipped reaches the book at the offer expiry', async () => {
    const f: Faults = {};
    const c = standIn(new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_M1, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 }), f);
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    const sync = new ChainSync(s, await head());
    const d = new EvmDeal(s, cast, club, 't409-m1-funding-gap');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const af = await d.agreeAndFund();
    if (accept.kind !== 'adjudicator_accept' || af.kind !== 'agree_and_fund') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    await sync.pass();
    // The buyer's own funding, past every operator.
    const wallet = anvil.wallet(cast.stranger.key);
    await anvil.rpc('anvil_setBalance', [cast.stranger.address, '0x56bc75e2d63100000']);
    const data = encodeFunctionData({ abi: anvil.abis.rules, functionName: 'agreeAndFund', args: [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(af.agree), { signature: af.funding.signature }] });
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to: deployment.rules as Address, data, gas: 8_000_000n });
    const r = await anvil.receipt(hash);
    expect(r.status).toBe('success');
    while ((await anvil.publicClient.getBlockNumber({ cacheTime: 0 })) < r.blockNumber + 4n) await sleep(200);
    f.logsAt = r.blockNumber - 1n;
    await sync.pass();
    delete f.logsAt;
    for (let i = 0; i < 3; i++) {
      await sleep(1_100);
      await sync.pass();
    }
    expect({ book: s.escrowState(d.id)?.kind, chain: await stageNow(d.id) }).toEqual({ book: 'AcceptedByAdjudicator', chain: 'Held' });
    await jump(901); // past offerExpiresAt
    const errors: string[] = [];
    const pass = new OperatorTimeouts(s, { via: 'op-1', key: (id, kind) => `t409/${id}/${kind}`, graceMs: 0, onError: (e) => errors.push(e.message) });
    const t1 = await pass.run(BigInt(sync.cursor!.block));
    const refused = t1.refused.filter((x) => x.commitmentId === d.id).map((x) => /the contract holds this deal Held/.test(x.detail));
    expect({ refused, marked: t1.marked, errors, book: s.escrowState(d.id)?.kind, view: (await s.state(d.id))?.escrowState }).toEqual({ refused: [true], marked: [], errors: [], book: 'Held', view: 'Held' });
  }, 120_000);
});
