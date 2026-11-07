// Red team of PR 239 (T-232, the read-after-write audit), 2026-11-06, adopted as regression tests on 2026-11-07. Each
// `it` asserts the defended outcome; the comment above each says what the branch did before its fix (measured on
// 5d05e49). Needs anvil on PATH and `forge build` output in contracts/out.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { wholeSecond, type Address, type Club } from '@holdback/core';
import { BlockNotFoundError, encodeFunctionData, maxUint256, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission, SubmitResult } from '../src/interface.js';
import type { LaneRow } from './chain.js';
import { termsView } from './encode.js';
import { EvmSettlement } from './evm-settlement.js';
import { ensureBond, FUNDING_LANE, LiveChain, type DeploymentFile, type LaneStore } from './live.js';
import { ChainSync, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor, type TestActor } from './testing.js';
import { OperatorTimeouts } from './timeouts.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's well-known dev keys #1, #2 and #3 (public; guard no value): one relayer secret per test. */
const RELAYER: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const RELAYER_B: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const RELAYER_C: Hex = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the stand-in RPC does wrong. */
interface Faults {
  /** The next eth_blockNumber asked with cacheTime 0 answers this many blocks past the real head, once. */
  bogusHeadOnce?: bigint;
  /** Once a receipt is handed out, every balanceOf read fails as a node without the block would (header not found). */
  balancesFailAfterReceipt?: boolean;
  balancesFailing?: boolean;
}

/**
 * `base` behind a stand-in RPC: anvil's estimate bug shim from timeouts.test.ts (anvil 1.0.0 refuses a call whose
 * EIP-7623 calldata floor exceeds its execution gas), plus the faults above.
 */
function standIn(base: LiveChain, f: Faults): LiveChain {
  const client = new Proxy(base.publicClient, {
    get(target, prop) {
      if (prop === 'getBlockNumber') {
        return async (args?: { cacheTime?: number }) => {
          const n = await target.getBlockNumber(args);
          if (args?.cacheTime === 0 && f.bogusHeadOnce !== undefined) {
            const by = f.bogusHeadOnce;
            delete f.bogusHeadOnce;
            return n + by;
          }
          return n;
        };
      }
      if (prop === 'estimateGas') {
        return async (args: { account: Address; to: Address; data: Hex; value?: bigint; blockNumber?: bigint }) => {
          try {
            return await target.estimateGas(args);
          } catch (e) {
            if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
            await target.call(args);
            return 1_000_000n;
          }
        };
      }
      if (prop === 'readContract') {
        return async (args: { functionName: string; blockNumber?: bigint }) => {
          if (f.balancesFailing && args.functionName === 'balanceOf') throw new BlockNotFoundError({ blockNumber: args.blockNumber ?? 0n });
          return target.readContract(args as Parameters<typeof target.readContract>[0]);
        };
      }
      if (prop === 'getTransactionReceipt') {
        return async (args: Parameters<typeof target.getTransactionReceipt>[0]) => {
          const r = await target.getTransactionReceipt(args);
          if (f.balancesFailAfterReceipt) f.balancesFailing = true;
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

/** An in-memory lane store, as the world's Durable Object storage keeps the rows (T-219). */
function memoryStore(rows: Map<string, LaneRow>): LaneStore {
  const id = (r: LaneRow) => `${lc(r.from)}:${r.nonce}`;
  return {
    load: async () => [...rows.values()].map((r) => structuredClone(r)),
    write: async (r) => void rows.set(id(r), structuredClone(r)),
    remove: async (rs) => {
      for (const r of rs) rows.delete(id(r));
    },
  };
}

const settle = <T>(p: Promise<T>): Promise<{ value: T } | { error: string }> => p.then((value) => ({ value }), (e: unknown) => ({ error: `${(e as Error).name}: ${String((e as Error).message).split('\n')[0]!.slice(0, 120)}` }));
const answer = (r: SubmitResult) => (r.ok ? { ok: true, state: r.state.escrowState, replayed: r.replayed } : { ok: false, problem: r.problem.type });

describe.skipIf(!ready)(`T-232 red team on anvil${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let chain: LiveChain;
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
      permit2Collector: d.permit2Collector,
      multicall: d.multicall,
      rules: d.rules,
      bonds: d.bonds,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
    chain = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
    const others = [RELAYER_B, RELAYER_C].flatMap((k) => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: k }).lanes);
    for (const a of [...chain.lanes, ...others].map((l) => l.address).concat(Object.values(cast).map((a) => a.address))) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start: wholeSecond(wall()), buyer: 0n, bond: 0n }));
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
    await chain.mint(cast.buyer.address, 10n ** 12n);
    await chain.mint(cast.seller.address, 10n ** 10n);
    for (const a of [cast.primary, cast.fallback, cast.appeal]) await ensureBond(chain, a.key, 500_000_000_000n, 10n ** 18n);
    for (const p of [cast.buyer, cast.seller]) await chain.send({ key: p.key, to: d.token, data: encodeFunctionData({ abi: chain.abis.token, functionName: 'approve', args: [d.bonds, maxUint256] }) });
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  async function head(): Promise<Cursor> {
    const n = await anvil.publicClient.getBlockNumber({ cacheTime: 0 });
    return { block: n.toString(), hash: (await anvil.publicClient.getBlock({ blockNumber: n })).hash! };
  }
  const ok = async (s: EvmSettlement, sub: Submission, key?: string) => {
    const r = await s.submit(sub, { via: 'op-1', ...(key ? { idempotencyKey: key } : {}) });
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
    const d = (await anvil.publicClient.readContract({ address: deployment.rules as Address, abi: chain.abis.rules, functionName: 'dealOf', args: [id] })) as { stage: number };
    return ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'][d.stage];
  };
  async function direct(who: TestActor, to: Address, data: Hex): Promise<string> {
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to, data, gas: 8_000_000n });
    return (await anvil.receipt(hash)).status;
  }

  // Finding 1. The timeouts pass raises the chain's floor to the head it was answered (timeouts.ts:272-275) before any
  // read proves that block exists. One wrong eth_blockNumber answer (a provider bug, or a mis-set URL in the fallback
  // list that serves another chain) puts the floor past the chain. The floor never moves down, so from then on every
  // pinned read asks for a block no node has and fails after its bound, every relay's simulation with it, and every sync
  // pass returns null without a word (sync.ts:335). On the demo, both operators share one world, so both stop until the
  // Durable Object restarts. The buyer's own reclaim, sent directly, still settles (the escape hatch holds).
  // Measured on the branch: floorPastChain true, the sync reads nothing, the balance and the relay's simulation fail,
  // and the book never learns of the buyer's direct reclaim. On origin/main's code (7810395) this test passes: a
  // regression of this PR.
  it('neutrality.t232-rpc-bogus-head: one wrong head from the RPC must not stop the operator; the direct path still settles', async () => {
    const f: Faults = {};
    const c = standIn(chain, f);
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    const sync = new ChainSync(s, await head());
    const errors: string[] = [];
    const pass = new OperatorTimeouts(s, { via: 'op-1', key: (id, kind) => `rt/${id}/${kind}`, graceMs: 0, onError: (e) => errors.push(e.message.slice(0, 100)) });
    const d = await funded('t232-rt-bogus-head', s);
    await jump(3_601); // past deliverBy: the reclaim is due
    f.bogusHeadOnce = 1_000_000n;
    await pass.run();
    const real = await anvil.publicClient.getBlockNumber({ cacheTime: 0 });
    // The RPC answers honestly from here on. Give it two seconds, two blocks.
    await sleep(2_000);
    const syncRead = await sync.read();
    const balance = await settle(s.tokenBalance(cast.buyer.address, true));
    const approve = encodeFunctionData({ abi: chain.abis.token, functionName: 'approve', args: [cast.seller.address, 1n] });
    const simulation = await settle(c.simulate({ from: cast.buyer.address, to: deployment.token.address as Address, data: approve }));
    // The escape hatch: the buyer reclaims directly, past every operator.
    const directReclaim = await direct(cast.buyer, deployment.rules as Address, encodeFunctionData({ abi: chain.abis.rules, functionName: 'reclaim', args: [termsView(d.terms)] }));
    const onChain = await stageNow(d.id);
    // Three of the world's passes later, the operator's book should follow the chain.
    for (let i = 0; i < 3; i++) {
      await sleep(1_100);
      await settle(sync.pass());
    }
    const observed = {
      floorPastChain: (c.floor?.() ?? 0n) > real + 1_000n,
      syncRead: syncRead !== null,
      balance: 'value' in balance ? 'read' : balance.error,
      relaySimulation: 'value' in simulation ? 'ran' : simulation.error,
      book: s.escrowState(d.id)?.kind,
    };
    expect({ directReclaim, onChain }).toEqual({ directReclaim: 'success', onChain: 'Refunded' });
    expect(observed).toEqual({ floorPastChain: false, syncRead: true, balance: 'read', relaySimulation: 'ran', book: 'Refunded' });
    // The pass with the wrong head failed loudly (its check found no such block) and sent nothing.
    expect(errors.length).toBeGreaterThan(0);
  }, 120_000);

  // Finding 2. A write mines, then the answer's own reads fail (evm-settlement.ts:876, `view` reads both parties'
  // balances, now pinned at the receipt's block or later). `process` throws after the book moved, so it stores no
  // replay for the Idempotency-Key (880-883) and never marks the lane row done (888). The row is not an orphan, so the
  // next `process` does not land it (837), and the sync skips the transaction as applied (sync.ts:343), so `follow`,
  // which would store the answer (1750-1753), never runs. Until the process restarts: a retry with the same key and body
  // is applied again and refused instead of replayed (hard rule: idempotency), and the timeouts pass defers the deal
  // every pass because its row is open (timeouts.ts:288). T-232 makes this likelier: before it, the same read answered
  // stale at `latest` instead of failing on a node without the block.
  // Measured on the branch: first throws, book and chain Delivered, retry and retryAfterSync refused invalid_state, the
  // row stays open, and the takeover is deferred. origin/main's code fails the same way under the same injected read
  // failure: the mechanism predates this PR, which makes its trigger likelier.
  it('attack.t232-answer-read-fails-after-relay: a retry with the same Idempotency-Key replays the mined answer', async () => {
    const rows = new Map<string, LaneRow>();
    const base = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_B, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
    await base.attach(memoryStore(rows));
    const f: Faults = {};
    const c = standIn(base, f);
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    const sync = new ChainSync(s, await head());
    const d = await funded('t232-rt-answer-read', s);
    await base.release(s.drain().relayed);
    const deliver = await d.deliver();
    const key = 'rt/deliver-once';
    f.balancesFailAfterReceipt = true;
    const first = await settle(s.submit(deliver, { via: 'op-1', idempotencyKey: key }));
    f.balancesFailAfterReceipt = false;
    f.balancesFailing = false;
    const chainStage = await stageNow(d.id);
    const book = (await s.state(d.id))?.escrowState;
    const retry = answer(await s.submit(deliver, { via: 'op-1', idempotencyKey: key }));
    // The world's next pass: persist, then the chain sync.
    await base.release(s.drain().relayed);
    await sleep(1_100);
    await sync.pass();
    await base.release(s.drain().relayed);
    const retryAfterSync = answer(await s.submit(deliver, { via: 'op-1', idempotencyKey: key }));
    const open = c.openRows().filter((r) => lc(r.note?.commitmentId ?? '') === lc(d.id)).map((r) => r.note?.call);
    // Past fallbackBy, with no adjudicator acting: the operators' own pass sends the takeover the default needs (T-231,
    // as attack.t231-behind-recovery-stale-stage does).
    const pass = new OperatorTimeouts(s, { via: 'op-1', key: (id, kind) => `rt/${id}/${kind}`, graceMs: 0 });
    await jump(4_830);
    const takeover = await pass.run();
    const observed = {
      first: 'error' in first ? 'threw' : answer(first.value),
      chainStage,
      book,
      retry,
      retryAfterSync,
      open,
      takeover: { sent: takeover.sent.map((x) => x.kind), deferred: takeover.deferred },
    };
    // The fix (the coordinator's, 2026-11-07): the answer's balances are a best effort, so the mined write answers at
    // once, without them, and stores that answer for its key. The red team's draft expected the first call to throw;
    // with best-effort balances it answers instead, and every retry replays that answer.
    if ('value' in first && first.value.ok) expect(first.value.state.balances).toBeUndefined();
    expect(observed).toEqual({
      first: { ok: true, state: 'Delivered', replayed: false },
      chainStage: 'Delivered',
      book: 'Delivered',
      retry: { ok: true, state: 'Delivered', replayed: true },
      retryAfterSync: { ok: true, state: 'Delivered', replayed: true },
      open: [],
      takeover: { sent: ['fallback'], deferred: 0 },
    });
  }, 120_000);

  // Finding 3. Decision 5 says a reorg could make the nonce floor too high "and the give-up rule then frees the lane".
  // It does not: a give-up deletes the nonce cache (live.ts:469, 579) but never `minedNonce` (live.ts:605), so every
  // later send on that lane takes the same too-high nonce, waits out the receipt timeout and gives up again, until the
  // process restarts. evm_revert stands in for a reorg that drops the lane's last mined transaction.
  // Measured on the branch: the first send after the rollback gives up at nonce 1 (the chain's is 0), and every send
  // after it reuses nonce 1 ("transaction already imported" on anvil). On origin/main's code this test passes: a
  // regression of this PR.
  it("attack.t232-mined-nonce-after-rollback: after the block with a lane's last transaction is dropped, the give-up frees the lane", async () => {
    const c = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER_C, pollMs: 50, rebroadcastMs: 300, receiptTimeoutMs: 2_000, mintBatchMs: 50 });
    const to = testActor('t232-rt-nonce').address;
    const snapshot = await anvil.rpc<Hex>('evm_snapshot', []);
    const first = await c.send({ lane: FUNDING_LANE, to, data: '0x', value: 1n });
    const n = (await anvil.publicClient.getTransaction({ hash: first.hash })).nonce;
    await anvil.rpc('evm_revert', [snapshot]);
    await sleep(1_500);
    const chainNonce = await anvil.publicClient.getTransactionCount({ address: c.funding, blockTag: 'latest' });
    // Until the chain regrows past the dropped block, the floor names a block it does not have (a side effect, bounded).
    const sends: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await c.send({ lane: FUNDING_LANE, to, data: '0x', value: 1n }).then(
        (m) => m.status,
        (e: unknown) => `${(e as Error).name}: ${[...`${(e as Error).message} ${(e as { details?: string }).details ?? ''}`.matchAll(/\(nonce [0-9]+\)|underpriced|nonce too low|already known|not mined within [0-9]+ s/g)].map((m) => m[0]).join(', ') || ((e as { details?: string }).details ?? String((e as Error).message).slice(0, 80))}`,
      );
      sends.push(r);
    }
    expect(chainNonce).toBe(n);
    // Decision 5: the give-up frees the lane, so a send after a give-up is mined.
    const gaveUp = sends.findIndex((x) => /not mined within/.test(x));
    expect(gaveUp, sends.join(' | ')).toBeGreaterThanOrEqual(0);
    expect(sends.slice(gaveUp + 1), sends.join(' | ')).toContain('success');
  }, 60_000);
});
