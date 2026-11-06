// Red-team of T-230 (the operators join a delivery that is already on chain): the relay and join path in
// EvmSettlement's `deliver` case (`landedDelivery`, `joinLanded`, `keepLanded`, the `posted` copy, `settlePosted`)
// and `commitmentTxs`'s pinned head. One attack per test, named `attack.t230-<name>: <expected outcome>`; the expected
// outcome is the defense the task and docs/neutrality.md claim, so a failing test shows a weakness. Written by the
// red-team pass on 2026-11-06: 8 of the 12 failed against the first fix and pass since its findings were fixed (T-230
// Evidence); they stay as regression tests.
//
// On its own anvil (a block every second, standing in for Sepolia; a free port), with a harness copied from
// sync.test.ts. `faulty` stands in for a load-balanced RPC whose backends disagree: a head that trails, a log index
// that trails, state reads that trail (or sit on another fork), reads pinned past a block that fail, and a lying
// deliveryHashOf. Needs `anvil` on PATH and `forge build` output in contracts/out.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryHash, signMessage, verifyMessage, wholeSecond, type Address, type Club, type Decision, type Delivery, type Hex32, type UnsignedMessage } from '@holdback/core';
import { BlockNotFoundError, encodeFunctionData, maxUint256, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission } from '../src/interface.js';
import { decisionView, deliveryView, NO_DELIVERY, termsView } from './encode.js';
import { EvmSettlement, type Book } from './evm-settlement.js';
import { ensureBond, LiveChain, type DeploymentFile } from './live.js';
import { ChainSync, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor, type TestActor } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 65 bytes no key signed. */
const JUNK: Hex = `0x${'11'.repeat(65)}`;

type Answer = Awaited<ReturnType<EvmSettlement['submit']>>;
/** The answer's state, or its problem type. */
const kind = (r: Answer) => (r.ok ? `ok: ${r.state.escrowState}${r.replayed ? ' (replayed)' : ''}` : r.problem.type);
/** True for the 409 that says the node keeps the signed copy (T-230 acceptance 5). */
const keeps = (r: Answer) => !r.ok && r.problem.type === 'invalid_state' && /keeps this signed copy/.test(r.problem.detail);
/** The book as the store would write it (read from the private map: an observation only). */
const bookOf = (s: EvmSettlement, id: Hex32): Book | undefined => (s as unknown as { books: Map<Hex32, Book> }).books.get(id);

/** What a faulty RPC does, per read; null is a healthy backend. */
interface Faults {
  /** eth_blockNumber answers this block (and estimateGas and unpinned reads run there) until the relay broadcasts. */
  head: bigint | null;
  /** eth_getLogs answers only up to this block, with no error (a trailing log index). */
  logs: bigint | null;
  /** deliveryHashOf and dealOf answer from this block, wherever pinned (a backend whose state trails, or another fork). */
  stale: bigint | null;
  /** A read pinned past this block fails, as on a node without the block. */
  missing: bigint | null;
  /** deliveryHashOf answers this hash (a lying or forked backend). */
  hash: Hex | null;
}
const healthy = (): Faults => ({ head: null, logs: null, stale: null, missing: null, hash: null });

function faulty(base: LiveChain, f: Faults): LiveChain {
  const client = new Proxy(base.publicClient, {
    get(target, prop) {
      if (prop === 'getBlockNumber') return async (args?: { cacheTime?: number }) => f.head ?? target.getBlockNumber(args);
      if (prop === 'estimateGas') {
        return async (args: Parameters<typeof target.estimateGas>[0]) => {
          const at = f.head === null ? args : ({ ...args, blockNumber: f.head } as typeof args);
          try {
            return await target.estimateGas(at);
          } catch (e) {
            // anvil 1.0.0 cannot estimate a call whose EIP-7623 calldata floor exceeds its execution gas (a timeout among
            // them; sync.test.ts `shimmed`): only that error is answered, from eth_call.
            if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
            await target.call(at as Parameters<typeof target.call>[0]);
            return 1_000_000n;
          }
        };
      }
      if (prop === 'readContract') {
        return async (args: { functionName: string; blockNumber?: bigint }) => {
          const read = target.readContract as (a: unknown) => Promise<unknown>;
          if (f.hash !== null && args.functionName === 'deliveryHashOf') return f.hash;
          if (f.stale !== null && (args.functionName === 'deliveryHashOf' || args.functionName === 'dealOf')) return read({ ...args, blockNumber: f.stale });
          if (f.missing !== null && args.blockNumber !== undefined && args.blockNumber > f.missing) throw new BlockNotFoundError({ blockNumber: args.blockNumber });
          if (f.head !== null && args.blockNumber === undefined) return read({ ...args, blockNumber: f.head });
          return read(args);
        };
      }
      if (prop === 'request') {
        return async (r: { method: string; params?: unknown[] }) => {
          const p = r.params?.[0] as { toBlock?: Hex } | undefined;
          const clamp = r.method === 'eth_getLogs' && f.logs !== null && p?.toBlock !== undefined && BigInt(p.toBlock) > f.logs;
          return (target.request as (a: unknown) => Promise<unknown>)(clamp ? { ...r, params: [{ ...p, toBlock: `0x${f.logs!.toString(16)}` }] } : r);
        };
      }
      if (prop === 'sendRawTransaction') {
        return async (args: Parameters<typeof target.sendRawTransaction>[0]) => {
          // The node that takes the broadcast and answers the receipt has the receipt's block (round 1, scenario 8).
          f.head = null;
          return target.sendRawTransaction(args);
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

describe.skipIf(!ready)(`attack.t230: the relay and join path for a delivery already on chain${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let chain: LiveChain;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  let skew = 0;
  const wall = () => Date.now() + skew;
  const cast = evmCast();
  const relayer = testActor('t230-red-team-relayer');
  const watcher = testActor('t230-red-team-watcher');

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
    chain = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: relayer.key, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
    const everyone = chain.lanes.map((l) => l.address).concat(Object.values(cast).map((a) => a.address), watcher.address);
    for (const a of everyone) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    const start = wholeSecond(wall());
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start, buyer: 0n, bond: 0n }));
    // The world's sim beacon is the contract's SimBeacon, deployed with the zero seed (world.ts).
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
    const n = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    return { block: n.toString(), hash: (await chain.publicClient.getBlock({ blockNumber: n })).hash! };
  }
  /** An operator's settlement on `c`, with a sync whose cursor is the current head. */
  async function node(c: LiveChain = chain): Promise<{ s: EvmSettlement; sync: ChainSync }> {
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    return { s, sync: new ChainSync(s, await head()) };
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
  const rulesCall = (fn: string, args: readonly unknown[]) => encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args });
  /** A rules call from `who`'s own wallet, past every operator (fixed gas: anvil's EIP-7623 estimate bug, sync.test.ts). */
  async function direct(who: TestActor, fn: string, args: readonly unknown[]): Promise<{ hash: Hex; block: bigint }> {
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to: chain.deployment.rules, data: rulesCall(fn, args), gas: 3_000_000n });
    const r = await anvil.receipt(hash);
    expect(r.status).toBe('success');
    return { hash, block: r.blockNumber };
  }
  /** A Multicall3 bundle of rules calls from `who`'s own wallet. */
  async function bundled(who: TestActor, calls: Hex[]): Promise<{ hash: Hex; block: bigint }> {
    const data = encodeFunctionData({ abi: chain.abis.multicall, functionName: 'aggregate3', args: [calls.map((callData) => ({ target: chain.deployment.rules, allowFailure: false, callData }))] });
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to: chain.deployment.multicall, data, gas: 8_000_000n });
    const r = await anvil.receipt(hash);
    expect(r.status).toBe('success');
    return { hash, block: r.blockNumber };
  }
  const laneNonce = (a: Address) => chain.publicClient.getTransactionCount({ address: a, blockTag: 'pending' });
  async function headAtLeast(n: bigint): Promise<void> {
    for (let i = 0; i < 200 && (await chain.publicClient.getBlockNumber({ cacheTime: 0 })) < n; i++) await sleep(100);
  }
  const deliverArgs = (d: EvmDeal, del: Delivery) => [termsView(d.terms), deliveryView(del), del.signature];
  /** Moves anvil's clock and the settlement's by `sec`, and waits for a block at the new time (sync.test.ts). */
  async function jump(sec: number): Promise<void> {
    await anvil.rpc('evm_increaseTime', [sec]);
    skew += sec * 1000;
    const target = BigInt(Math.floor(wall() / 1000) - 1);
    for (let i = 0; i < 100; i++) {
      if ((await chain.publicClient.getBlock({ blockTag: 'latest' })).timestamp >= target) return;
      await sleep(100);
    }
    throw new Error(`anvil did not reach ${target}`);
  }

  // Idea 1 and 2: forged or mismatched copies.

  it('attack.t230-forged-or-mismatched: a forged signature, another seller-signed body, attempt 2 and a body relabelled for another deal are refused, send nothing and keep nothing; the seller\'s copy then joins', async () => {
    const { s } = await node();
    const d = await funded('t230-mismatch', s);
    const e = await funded('t230-mismatch-other', s);
    const sub = await d.deliver();
    const landed = d.delivery!;
    await sleep(1_100);
    const otherBody = await d.deliver();
    const attempt2 = await d.deliver(2);
    await direct(cast.seller, 'deliver', deliverArgs(d, landed));
    const lanes = [s.world.senderFor(d.id), s.world.senderFor(e.id)];
    const before = await Promise.all(lanes.map(laneNonce));
    const tries = {
      junkSignature: kind(await s.submit({ kind: 'deliver', delivery: { ...landed, signature: JUNK } }, { via: 'op-1', idempotencyKey: 'k-t230-m1' })),
      otherBody: kind(await s.submit(otherBody, { via: 'op-1', idempotencyKey: 'k-t230-m2' })),
      attempt2: kind(await s.submit(attempt2, { via: 'op-1', idempotencyKey: 'k-t230-m3' })),
      otherCommitment: kind(await s.submit({ kind: 'deliver', delivery: { ...landed, commitmentId: e.id } }, { via: 'op-1', idempotencyKey: 'k-t230-m4' })),
    };
    const sent = (await Promise.all(lanes.map(laneNonce))).map((n, i) => n - before[i]!);
    const kept = [bookOf(s, d.id)?.posted !== undefined, bookOf(s, e.id)?.posted !== undefined];
    const books = [s.escrowState(d.id)!.kind, s.escrowState(e.id)!.kind];
    const genuine = kind(await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-m5' }));
    expect({ tries, sent, kept, books, genuine, primaryKeys: (await s.keysFor(d.id, cast.primary.address)).length }).toEqual({
      tries: { junkSignature: 'invalid_signature', otherBody: 'invalid_state', attempt2: 'invalid_state', otherCommitment: 'invalid_signature' },
      sent: [0, 0],
      kept: [false, false],
      books: ['Held', 'Held'],
      genuine: 'ok: Delivered',
      primaryKeys: 1,
    });
  }, 120_000);

  it('attack.t230-forged-copy-stale-state: a copy of the landed delivery with a signature the seller never made is refused, even through a node whose state reads trail the chain; the seller\'s own copy then joins', async () => {
    const f = healthy();
    const { s } = await node(faulty(chain, f));
    const d = await funded('t230-forged-stale', s);
    const sub = await d.deliver();
    const landed = d.delivery!;
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, landed));
    // deliveryHashOf and dealOf answer from the block before the seller's delivery for the whole read budget (a backend
    // that trails, or one on another fork); estimateGas and eth_getLogs answer from the head.
    f.stale = mined.block - 1n;
    const forged = await s.submit({ kind: 'deliver', delivery: { ...landed, signature: JUNK } }, { via: 'op-1', idempotencyKey: 'k-t230-forged-stale' });
    f.stale = null;
    const genuine = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-forged-stale-genuine' });
    const st = s.escrowState(d.id)!;
    const stored = 'delivery' in st ? st.delivery : undefined;
    // What the operator's adjudicators check before judging (apps/adjudicator/src/service.ts, decideTask): the seller's
    // signature on the delivery the book holds.
    const sellersSignature = stored ? await verifyMessage(s.domain, { ...stored, type: 'Delivery' }, d.terms.seller) : null;
    expect({ forged: kind(forged), genuine: kind(genuine), book: st.kind, sellersSignature, primaryKeys: (await s.keysFor(d.id, cast.primary.address)).length }).toEqual({
      forged: 'invalid_signature',
      genuine: 'ok: Delivered',
      book: 'Delivered',
      sellersSignature: true,
      primaryKeys: 1,
    });
  }, 120_000);

  it('attack.t230-envelope-missing: a seller-signed delivery the contract took directly but core refuses (no envelope for the fallback) does not join: no envelope is released and no copy is kept', async () => {
    const { s } = await node();
    const d = await funded('t230-envelope-missing', s);
    await d.deliver();
    const full = d.delivery!;
    const { adjudication, buyer } = d.terms;
    const { signature: _drop, ...rest } = full;
    void _drop;
    const body = { ...rest, encryptedKeys: [adjudication.adjudicator, adjudication.appealAdjudicator, buyer].map((r) => d.envelope(r)) };
    const short: Delivery = { ...body, signature: await signMessage(cast.seller.key, s.domain, { ...body, type: 'Delivery' } as UnsignedMessage) } as Delivery;
    await direct(cast.seller, 'deliver', deliverArgs(d, short));
    const r = await s.submit({ kind: 'deliver', delivery: short }, { via: 'op-1', idempotencyKey: 'k-t230-envelope' });
    expect({
      answer: kind(r),
      behind: s.lag(d.id) !== null,
      waiting: bookOf(s, d.id)?.behind?.waiting !== undefined,
      primaryKeys: (await s.keysFor(d.id, cast.primary.address)).length,
      kept: bookOf(s, d.id)?.posted !== undefined,
      chain: (await s.stage(d.id)).stage,
    }).toEqual({ answer: 'invalid_state', behind: true, waiting: false, primaryKeys: 0, kept: false, chain: 'Delivered' });
  }, 120_000);

  // Idea 3: replay.

  it('attack.t230-key-held-by-kept-copy: the Idempotency-Key of a post the node keeps is taken until the pass joins it; another body under it is idempotency_conflict, and the retry replays the join', async () => {
    const f = healthy();
    const { s, sync } = await node(faulty(chain, f));
    const d = await funded('t230-key-held', s);
    const sub = await d.deliver();
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, d.delivery!));
    f.logs = mined.block - 1n;
    const first = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-held' });
    // The same key with another body before the pass: an offer for another deal.
    const other = new EvmDeal(s, cast, club, 't230-key-held-other');
    const reused = await s.submit(await other.offer(), { via: 'op-1', idempotencyKey: 'k-t230-held' });
    f.logs = null;
    await sleep(1_100);
    await sync.pass();
    const joined = { book: s.escrowState(d.id)!.kind, primaryKeys: (await s.keysFor(d.id, cast.primary.address)).length };
    const retry = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-held' });
    expect({ kept: keeps(first), reused: kind(reused), joined, retry: kind(retry) }).toEqual({
      kept: true,
      reused: 'idempotency_conflict',
      joined: { book: 'Delivered', primaryKeys: 1 },
      retry: 'ok: Delivered (replayed)',
    });
  }, 120_000);

  it('attack.t230-kept-copy-overwritten: a second post of the same delivery under another key does not take the first post\'s answer; each key\'s retry replays the join', async () => {
    const f = healthy();
    const { s, sync } = await node(faulty(chain, f));
    const d = await funded('t230-overwritten', s);
    const sub = await d.deliver();
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, d.delivery!));
    f.logs = mined.block - 1n;
    const seller = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-seller-post' });
    // The same signed body under another key: the seller retrying with a fresh key, or another holder of the copy (an
    // operator the seller also posted it to).
    const second = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-second-post' });
    f.logs = null;
    await sleep(1_100);
    await sync.pass();
    const book = s.escrowState(d.id)!.kind;
    const sellerRetry = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-seller-post' });
    const secondRetry = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-second-post' });
    expect({ kept: [keeps(seller), keeps(second)], book, sellerRetry: kind(sellerRetry), secondRetry: kind(secondRetry) }).toEqual({
      kept: [true, true],
      book: 'Delivered',
      sellerRetry: 'ok: Delivered (replayed)',
      secondRetry: 'ok: Delivered (replayed)',
    });
  }, 120_000);

  it('attack.t230-replay-after-join-restart: after the join and a restart, the post\'s key with another body is idempotency_conflict and with the same body replays', async () => {
    const { s } = await node();
    const d = await funded('t230-replay-restart', s);
    const sub = await d.deliver();
    const del = d.delivery!;
    await direct(cast.seller, 'deliver', deliverArgs(d, del));
    const joined = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-replay' });
    const restarted = await EvmSettlement.restore(chain, genesis, s.drain(), wall);
    const conflict = await restarted.submit({ kind: 'deliver', delivery: { ...del, signature: JUNK } }, { via: 'op-1', idempotencyKey: 'k-t230-replay' });
    const replay = await restarted.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-replay' });
    expect({ joined: kind(joined), conflict: kind(conflict), replay: kind(replay) }).toEqual({ joined: 'ok: Delivered', conflict: 'idempotency_conflict', replay: 'ok: Delivered (replayed)' });
  }, 120_000);

  // The pinned reads against a lagging or lying RPC, and the read budget.

  it('attack.t230-revert-block-unread: a relay that reverts behind the seller\'s delivery, through a node that cannot read the revert\'s block for the whole read budget, keeps the signed copy, and the next pass joins it', async () => {
    const f = healthy();
    const { s, sync } = await node(faulty(chain, f));
    const d = await funded('t230-revert-unread', s);
    const sub = await d.deliver();
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, d.delivery!));
    // The node's head and state trail the seller's block. The broadcast moves its head on (the receipt comes from a
    // backend that has the block), but a read pinned past the trailing block fails for the whole read budget (10 s).
    f.head = mined.block - 1n;
    f.missing = mined.block - 1n;
    const lane = s.world.senderFor(d.id);
    const nonce = await laneNonce(lane);
    const first = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-revert-unread' });
    f.missing = null;
    const relayed = (await laneNonce(lane)) - nonce;
    const kept = bookOf(s, d.id)?.posted !== undefined;
    await sleep(1_100);
    await sync.pass();
    const afterPass = { book: s.escrowState(d.id)!.kind, primaryKeys: (await s.keysFor(d.id, cast.primary.address)).length, behind: s.lag(d.id) !== null };
    const retry = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-revert-unread' });
    expect({ relayed, first: first.ok ? kind(first) : `${first.problem.type}: ${first.problem.detail.replace(/0x[0-9a-f]{64}/g, '0x…')}`, kept, afterPass, retry: kind(retry) }).toEqual({
      relayed: 1,
      first: expect.stringMatching(/^invalid_state: .*keeps this signed copy/),
      kept: true,
      afterPass: { book: 'Delivered', primaryKeys: 1, behind: false },
      retry: 'ok: Delivered (replayed)',
    });
  }, 120_000);

  it('attack.t230-pass-skips-the-block: a kept copy whose transaction the passes never read (the log index trailed past the overlap) still joins without a second post', async () => {
    const f = healthy();
    const { s, sync } = await node(faulty(chain, f));
    const d = await funded('t230-pass-skips', s);
    const sub = await d.deliver();
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, d.delivery!));
    f.logs = mined.block - 1n;
    const first = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-pass-skips' });
    // The log index still trails when the next pass runs, more than OVERLAP (3) blocks after the seller's block.
    await headAtLeast(mined.block + 5n);
    await sync.pass();
    f.logs = null;
    await sleep(1_100);
    await sync.pass();
    await sleep(1_100);
    await sync.pass();
    const afterPasses = { book: s.escrowState(d.id)!.kind, primaryKeys: (await s.keysFor(d.id, cast.primary.address)).length, chain: (await s.stage(d.id)).stage };
    const retry = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-pass-skips' });
    expect({ kept: keeps(first), afterPasses, retry: kind(retry) }).toEqual({
      kept: true,
      afterPasses: { book: 'Delivered', primaryKeys: 1, chain: 'Delivered' },
      retry: 'ok: Delivered (replayed)',
    });
  }, 120_000);

  it('attack.t230-lying-hash-read: a node whose deliveryHashOf read names the posted delivery while the contract holds none still gets the delivery on chain before deliverBy', async () => {
    const f = healthy();
    const { s } = await node(faulty(chain, f));
    const d = await funded('t230-lying-hash', s);
    const sub = await d.deliver();
    f.hash = deliveryHash(d.delivery!);
    const lane = s.world.senderFor(d.id);
    const nonce = await laneNonce(lane);
    const first = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-lying' });
    f.hash = null;
    const relayed = (await laneNonce(lane)) - nonce;
    const chainStage = (await s.stage(d.id)).stage;
    const retry = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-lying' });
    expect({ first: kind(first), toldOnChain: !first.ok && /the contract holds this delivery/.test(first.problem.detail), relayed, chainStage, retry: kind(retry) }).toEqual({
      first: 'ok: Delivered',
      toldOnChain: false,
      relayed: 1,
      chainStage: 'Delivered',
      retry: 'ok: Delivered (replayed)',
    });
  }, 120_000);

  // Dry runs.

  it('attack.t230-dry-run: validate of the landed delivery answers ok as a dry run, keeps no copy, sends nothing and moves no book; a forged copy is refused', async () => {
    const f = healthy();
    const { s } = await node(faulty(chain, f));
    const d = await funded('t230-dry-run', s);
    const sub = await d.deliver();
    const del = d.delivery!;
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, del));
    // A live post now would keep a copy: the log index trails the seller's block.
    f.logs = mined.block - 1n;
    s.drain();
    const lane = s.world.senderFor(d.id);
    const nonce = await laneNonce(lane);
    const dry = await s.validate(sub);
    const forged = await s.validate({ kind: 'deliver', delivery: { ...del, signature: JUNK } });
    const dirty = s.drain().books.map(([id]) => id);
    expect({
      dry: dry.ok ? { ok: true, dryRun: dry.dryRun, state: dry.state.escrowState, events: dry.events.length } : dry.problem.type,
      forged: kind(forged),
      kept: bookOf(s, d.id)?.posted !== undefined,
      dirty: dirty.includes(d.id),
      sent: (await laneNonce(lane)) - nonce,
      book: s.escrowState(d.id)!.kind,
    }).toEqual({ dry: { ok: true, dryRun: true, state: 'Held', events: 0 }, forged: 'invalid_signature', kept: false, dirty: false, sent: 0, book: 'Held' });
  }, 120_000);

  // Idea 6: a deal behind the chain for another reason (residual 13).

  it('attack.t230-copy-kept-after-behind: a kept copy whose deal the next pass puts behind for another reason (two signed steps in one transaction) is dropped, as `joinLanded` drops it', async () => {
    const f = healthy();
    const { s, sync } = await node(faulty(chain, f));
    const d = await funded('t230-kept-behind', s);
    const sub = await d.deliver();
    const del = d.delivery!;
    const m = ((await d.decide('primary', 'accept')) as { message: Decision }).message;
    // Residual 13, case 3: the delivery and the primary's decision in one Multicall3 transaction.
    const mined = await bundled(watcher, [rulesCall('deliver', deliverArgs(d, del)), rulesCall('decide', [termsView(d.terms), decisionView(m), NO_DELIVERY, '0x'])]);
    f.logs = mined.block - 1n;
    const first = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-kept-behind' });
    f.logs = null;
    await sleep(1_100);
    await sync.pass();
    expect({ kept: keeps(first), behind: s.lag(d.id)?.includes('2 signed calls') ?? false, copyAfterPass: bookOf(s, d.id)?.posted !== undefined, chain: (await s.stage(d.id)).stage }).toEqual({
      kept: true,
      behind: true,
      copyAfterPass: false,
      chain: 'Released',
    });
  }, 120_000);

  // Idea 6 with T-228. Last: it moves anvil's clock past judgeBy.

  it('attack.t230-kept-copy-then-timeout: a kept copy the passes never joined still lets a party with no gas close the deal through the operator: the fallback takeover is relayed at judgeBy (T-228)', async () => {
    const f = healthy();
    const { s, sync } = await node(faulty(chain, f));
    const d = await funded('t230-kept-timeout', s);
    const sub = await d.deliver();
    const mined = await direct(cast.seller, 'deliver', deliverArgs(d, d.delivery!));
    f.logs = mined.block - 1n;
    const first = await s.submit(sub, { via: 'op-1', idempotencyKey: 'k-t230-kept-timeout' });
    await headAtLeast(mined.block + 5n);
    await sync.pass();
    f.logs = null;
    await sleep(1_100);
    await sync.pass();
    const before = { book: s.escrowState(d.id)!.kind, notice: s.lag(d.id), view: (await s.state(d.id))!.escrowState, chain: (await s.stage(d.id)).stage };
    await jump(4_201);
    const takeover = await s.trigger(d.id, 'fallback', { via: 'op-1' }).then(kind, (e: unknown) => `throws: ${(e as Error).message.slice(0, 120)}`);
    expect({ kept: keeps(first), before, takeover }).toEqual({
      kept: true,
      before: { book: 'Delivered', notice: null, view: 'Delivered', chain: 'Delivered' },
      takeover: 'ok: FallbackJudging',
    });
  }, 120_000);
});
