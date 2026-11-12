// T-231: the operators send each due timeout on their own, at their own gas, so a deal reaches its end with no caller.
// The first suite reads the next timeout of a book with no chain. The second runs on anvil standing in for Sepolia (a
// block every second at wall-clock time, ADR-0028): the contracts from contracts/out, the operator's settlement on a
// LiveChain, and the operators' pass (`OperatorTimeouts.run`) after each move of the clock. Windows pass by moving
// anvil's clock and the settlement's together, as in sync.test.ts (T-218, T-228). The anvil suite needs `anvil` on PATH
// and `forge build` output in contracts/out; CI's contracts job runs it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { wholeSecond, type Address, type Club, type EscrowState, type Timing } from '@holdback/core';
import { encodeErrorResult, encodeFunctionData, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission, TimeoutKind } from '../src/interface.js';
import type { LaneRow } from './chain.js';
import { acceptanceView, agreeView, deliveryView, termsView } from './encode.js';
import { EvmSettlement } from './evm-settlement.js';
import { LiveChain, type DeploymentFile, type LaneStore } from './live.js';
import { ChainSync, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor, type TestActor } from './testing.js';
import { nextOnChain, nextTimeout, OperatorTimeouts, type OperatorTimeoutsOptions, type TimeoutBudget } from './timeouts.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's well-known dev keys (public; guard no value): the operator's relayer secret, and a second for the restart test. */
const RELAYER: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const RESTART_RELAYER: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (iso: string) => Date.parse(iso);

const TIMING: Timing = {
  offerExpiresAt: '2026-11-06T10:15:00Z',
  fundBy: '2026-11-06T10:30:00Z',
  deliverBy: '2026-11-06T11:00:00Z',
  judgeBy: '2026-11-06T11:10:00Z',
  fallbackBy: '2026-11-06T11:20:00Z',
  appealWindowSec: 300,
  appealDecideSec: 600,
  maxSubmissions: 1,
};
/** Just enough of a book's state for `nextTimeout`: its kind, its terms' timing, and the fields that kind adds. */
const book = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, terms: { timing: TIMING }, ...extra }) as unknown as EscrowState;

describe('the next timeout the operators send for a book (T-231)', () => {
  it('names the timeout that ends each open state, and when it falls due', () => {
    // An accepted offer expires at the earlier of its two deadlines; nothing is held, so it comes last.
    expect(nextTimeout(book('AcceptedByAdjudicator'))).toEqual({ kind: 'expire_offer', at: at(TIMING.offerExpiresAt), rank: 1 });
    expect(nextTimeout(book('Agreed', { terms: { timing: { ...TIMING, fundBy: '2026-11-06T10:10:00Z' } } }))).toEqual({ kind: 'expire_offer', at: at('2026-11-06T10:10:00Z'), rank: 1 });
    expect(nextTimeout(book('Held'))).toEqual({ kind: 'reclaim', at: at(TIMING.deliverBy), rank: 0 });
    // The takeover before fallbackBy is the fallback adjudicator's own turn (T-211); at fallbackBy the default needs it.
    expect(nextTimeout(book('Delivered'))).toEqual({ kind: 'fallback', at: at(TIMING.fallbackBy), rank: 0 });
    expect(nextTimeout(book('FallbackJudging'))).toEqual({ kind: 'default', at: at(TIMING.fallbackBy), rank: 0 });
    expect(nextTimeout(book('Escalated', { escalation: { appealDecideBy: '2026-11-06T11:30:00Z' } }))).toEqual({ kind: 'default', at: at('2026-11-06T11:30:00Z'), rank: 0 });
  });

  it('sends nothing for an offer no adjudicator accepted, nor for a deal that is over', () => {
    // Nobody can fund an unaccepted offer, and posting one costs nothing.
    expect(nextTimeout(book('Offered'))).toBeNull();
    for (const kind of ['Expired', 'Settled']) expect(nextTimeout(book(kind))).toBeNull();
    for (const via of [{ kind: 'reclaim' }, { kind: 'default_outcome' }, { kind: 'early_accept' }, { kind: 'escalation' }]) expect(nextTimeout(book('Refunded', { via }))).toBeNull();
    // A first decision is final at once on the phase-one contracts (ADR-0031 §8): no appeal expiry follows it.
    for (const appeal of [{ kind: 'none', appealBy: '2026-11-06T11:05:00Z', appealDecideBy: '2026-11-06T11:15:00Z' }, { kind: 'open', appealDecideBy: '2026-11-06T11:15:00Z' }, { kind: 'upheld' }, { kind: 'overturned' }, { kind: 'expired' }]) {
      for (const kind of ['Released', 'Refunded']) expect(nextTimeout(book(kind, { via: { kind: 'first_instance', appeal } }))).toBeNull();
    }
  });

  it('reads a deal behind the chain from dealOf: its stage and t1', () => {
    const t1 = Math.floor(at('2026-11-06T11:00:00Z') / 1000);
    expect(nextOnChain({ stage: 'Held', t1: 0 }, TIMING)).toEqual({ kind: 'reclaim', at: at(TIMING.deliverBy), rank: 0 });
    expect(nextOnChain({ stage: 'Delivered', t1: 0 }, TIMING)).toEqual({ kind: 'fallback', at: at(TIMING.fallbackBy), rank: 0 });
    expect(nextOnChain({ stage: 'FallbackJudging', t1 }, TIMING)).toEqual({ kind: 'default', at: at(TIMING.fallbackBy), rank: 0 });
    expect(nextOnChain({ stage: 'Escalated', t1 }, TIMING)).toEqual({ kind: 'default', at: (t1 + 600) * 1000, rank: 0 });
    // Released and Refunded are final at once on the phase-one contracts (ADR-0031 §8).
    for (const stage of ['None', 'Released', 'Refunded', 'Settled', 'Expired']) expect(nextOnChain({ stage, t1 }, TIMING)).toBeNull();
  });
});

describe.skipIf(!ready)(`the operators send due timeouts on their own, on anvil standing in for Sepolia (T-231)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let chain: LiveChain;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  let skew = 0;
  const wall = () => Date.now() + skew;
  const cast = evmCast();
  const watcher = testActor('t-231/watcher');

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
    chain = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
    const restarting = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RESTART_RELAYER });
    const everyone = [...chain.lanes, ...restarting.lanes].map((l) => l.address).concat(Object.values(cast).map((a) => a.address), watcher.address);
    for (const a of everyone) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start: wholeSecond(wall()), buyer: 0n }));
    // The world's sim beacon is the contract's SimBeacon, deployed with the zero seed (world.ts).
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
    await chain.mint(cast.buyer.address, 10n ** 12n);
    await chain.mint(cast.seller.address, 10n ** 10n);
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  /**
   * `base` behind a shim for one anvil 1.0.0 bug (T-217 Decision 11): anvil cannot estimate a call whose EIP-7623
   * calldata floor exceeds its execution gas, every timeout among them, and answers "gas floor exceeds the gas limit".
   * The shim answers only that error, from eth_call: a revert stays a revert. Sepolia's own nodes estimate these calls.
   */
  function shimmed(base: LiveChain, lag: { head?: bigint } = {}): LiveChain {
    const client = new Proxy(base.publicClient, {
      get(target, prop) {
        // With `lag.head`, an RPC node whose latest block trails: it reports that head.
        if (prop === 'getBlockNumber' && lag.head !== undefined) {
          const n = lag.head;
          return async () => n;
        }
        if (prop === 'estimateGas') {
          return async (args: { account: Address; to: Address; data: Hex; value?: bigint }) => {
            try {
              return await target.estimateGas(args);
            } catch (e) {
              if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
              await target.call(args);
              return 1_000_000n;
            }
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

  async function head(): Promise<Cursor> {
    const n = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    return { block: n.toString(), hash: (await chain.publicClient.getBlock({ blockNumber: n })).hash! };
  }
  /**
   * An operator's settlement and its pass, with a sync whose cursor is the current head. No grace past a deadline here,
   * so each test moves the clock just past it; the grace has its own test (timeouts.redteam.test.ts, 3a).
   */
  async function node(o: Partial<OperatorTimeoutsOptions> = {}, c: LiveChain = shimmed(chain)): Promise<{ s: EvmSettlement; sync: ChainSync; pass: OperatorTimeouts }> {
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    return { s, sync: new ChainSync(s, await head()), pass: new OperatorTimeouts(s, { via: 'op-1', key: (id, kind) => `t-231/${id}/${kind}`, graceMs: 0, ...o }) };
  }
  const ok = async (s: EvmSettlement, sub: Submission) => {
    const r = await s.submit(sub, { via: 'op-1' });
    if (!r.ok) throw new Error(`${sub.kind}: ${r.problem.type}: ${r.problem.detail}`);
    return r;
  };
  async function funded(tag: string, s: EvmSettlement, o: { deliver?: boolean } = {}): Promise<EvmDeal> {
    const d = new EvmDeal(s, cast, club, tag);
    await ok(s, await d.offer());
    await ok(s, await d.accept());
    await ok(s, await d.agreeAndFund());
    if (o.deliver) await ok(s, await d.deliver());
    return d;
  }
  /** Moves anvil's clock and the settlement's by `sec`, and waits for a block at the new time. */
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
  const nonce = (a: Address) => chain.publicClient.getTransactionCount({ address: a, blockTag: 'pending' });
  /** Every transaction the relayer lanes have sent so far, and the parties'. */
  const lanes = async (c: LiveChain = chain) => (await Promise.all(c.lanes.map((l) => nonce(l.address)))).reduce((n, x) => n + x, 0);
  const parties = async () => Promise.all([nonce(cast.buyer.address), nonce(cast.seller.address)]);
  const sent = (r: { sent: Array<{ kind: TimeoutKind }> }) => r.sent.map((x) => x.kind);
  const answer = (r: Awaited<ReturnType<EvmSettlement['submit']>>) => (r.ok ? `ok: ${r.state.escrowState} with ${r.events.length} events${r.replayed ? ' (replayed)' : ''}` : `${r.problem.type}: ${r.problem.detail}`);
  const rulesCall = (fn: string, args: readonly unknown[]) => encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args });
  /** Sends a rules call from `who`'s own wallet, past every operator, with a fixed gas limit (anvil's estimate bug above). */
  async function direct(who: TestActor, to: Address, data: Hex): Promise<void> {
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to, data, gas: 8_000_000n });
    expect((await anvil.receipt(hash)).status).toBe('success');
  }

  it('reclaim: nothing is sent before deliverBy; after it the pass refunds the buyer once, with no caller and no gas from the parties', async () => {
    const { s, pass } = await node();
    const d = await funded('t-231-reclaim', s);
    const before = await lanes();
    // Not due: no chain read, nothing sent, and the next pass is due at deliverBy.
    expect(await pass.run()).toMatchObject({ sent: [], reads: 0 });
    expect(await lanes()).toBe(before);
    expect(pass.nextAt()).toBe(at(d.terms.timing.deliverBy));

    await jump(3_601);
    const held = await s.heldFor(d.id);
    const buyer = await s.tokenBalance(cast.buyer.address, true);
    const partyNonces = await parties();
    const r = await pass.run();
    expect(sent(r)).toEqual(['reclaim']);
    expect((await s.stage(d.id)).stage).toBe('Refunded');
    expect((await s.state(d.id))!.escrowState).toBe('Refunded');
    expect(await s.tokenBalance(cast.buyer.address, true)).toBe(buyer + held);
    expect(await s.heldFor(d.id)).toBe(0n);
    // The operator's relayer lane sent it, labelled as the operator; the parties sent nothing.
    expect(s.log().filter((e) => e.commitmentId === d.id).at(-1)).toMatchObject({ type: 'settlement.reclaimed', submittedVia: 'op-1' });
    expect(s.transactions().filter((t) => t.commitmentId === d.id && t.call === 'reclaim').map((t) => [lc(t.from), t.via])).toEqual([[lc(s.world.senderFor(d.id)), 'op-1']]);
    expect(await parties()).toEqual(partyNonces);
    expect((await lanes()) - before).toBe(1);

    // Once: the next pass reads nothing and sends nothing, and no pass is due for it again.
    expect(await pass.run()).toMatchObject({ sent: [], reads: 0 });
    expect(pass.nextAt()).toBeNull();
    // A party's trigger that comes after the operators' answers the state it left and sends nothing (the round-1
    // driver's own triggers among them).
    expect(answer(await s.trigger(d.id, 'reclaim', { via: 'op-2', idempotencyKey: 't-231/party-reclaim' }))).toBe('ok: Refunded with 0 events');
    expect((await lanes()) - before).toBe(1);
  }, 120_000);

  it('default: a silent primary and fallback get no takeover before fallbackBy; then the takeover and the default refund the buyer; an unheard escalation defaults too', async () => {
    const { s, pass } = await node();
    const silent = await funded('t-231-silent', s, { deliver: true });
    const escalated = await funded('t-231-escalated', s, { deliver: true });
    await ok(s, await escalated.decide('primary', 'escalate'));
    expect(s.escrowState(escalated.id)!.kind).toBe('Escalated');
    const before = await lanes();
    expect(sent(await pass.run())).toEqual([]);

    // The appeal adjudicator stays silent past appealDecideBy: the default refunds the escalated deal.
    await jump(301);
    const held = await s.heldFor(escalated.id);
    const buyer = await s.tokenBalance(cast.buyer.address, true);
    expect(sent(await pass.run())).toEqual(['default']);
    expect((await s.state(escalated.id))!.escrowState).toBe('Refunded');
    expect(await s.tokenBalance(cast.buyer.address, true)).toBe(buyer + held);

    // Past judgeBy, before fallbackBy: the takeover is the fallback adjudicator's own turn, so the pass sends nothing.
    await jump(3_950);
    expect(Date.now() + skew).toBeGreaterThan(at(silent.terms.timing.judgeBy));
    expect(await pass.run()).toMatchObject({ sent: [], reads: 0 });
    expect((await lanes()) - before).toBe(1);

    // Past fallbackBy: the takeover the default needs, then the default on the next pass.
    await jump(600);
    const heldSilent = await s.heldFor(silent.id);
    const buyerSilent = await s.tokenBalance(cast.buyer.address, true);
    expect(sent(await pass.run())).toEqual(['fallback']);
    expect(s.escrowState(silent.id)!.kind).toBe('FallbackJudging');
    expect(sent(await pass.run())).toEqual(['default']);
    expect((await s.stage(silent.id)).stage).toBe('Refunded');
    expect((await s.state(silent.id))!.escrowState).toBe('Refunded');
    expect(await s.tokenBalance(cast.buyer.address, true)).toBe(buyerSilent + heldSilent);
    // The takeover hands the fallback its envelope, as any takeover does; the default then refunds.
    expect(s.log().filter((e) => e.commitmentId === silent.id).slice(-4).map((e) => [e.type, e.submittedVia])).toEqual([
      ['fallback.triggered', 'op-1'],
      ['key.released', 'op-1'],
      ['default.triggered', 'op-1'],
      ['settlement.refunded', 'op-1'],
    ]);
    expect((await lanes()) - before).toBe(3);
    expect(pass.nextAt()).toBeNull();
  }, 120_000);

  it('offer expiry: an accepted offer expires on chain with no caller; an offer no adjudicator accepted gets no transaction', async () => {
    const { s, pass } = await node();
    const accepted = new EvmDeal(s, cast, club, 't-231-accepted');
    await ok(s, await accepted.offer());
    await ok(s, await accepted.accept());
    const unaccepted = new EvmDeal(s, cast, club, 't-231-unaccepted');
    await ok(s, await unaccepted.offer());
    const before = await lanes();
    expect(sent(await pass.run())).toEqual([]);
    await jump(901);
    const r = await pass.run();
    expect(sent(r)).toEqual(['expire_offer']);
    expect(r.sent[0]!.commitmentId).toBe(accepted.id);
    expect((await s.state(accepted.id))!.escrowState).toBe('Expired');
    expect((await s.stage(accepted.id)).stage).toBe('Expired');
    expect((await s.state(unaccepted.id))!.escrowState).toBe('Offered');
    expect((await lanes()) - before).toBe(1);
    expect(await pass.run()).toMatchObject({ sent: [], reads: 0 });
  }, 120_000);

  it('no appeal expiry: a decided deal is final at once, and no pass sends anything for it once the old window would have passed (ADR-0031 §8)', async () => {
    const { s, pass } = await node();
    const decided = await funded('t-349-decided', s, { deliver: true });
    await ok(s, await decided.decide('primary', 'accept'));
    const view = (await s.state(decided.id))!;
    expect(view).toMatchObject({ escrowState: 'Released', appealState: 'none' });
    expect(view.finalAt).toBe(view.settledAt);
    expect(pass.nextAt()).toBeNull();
    const before = await lanes();
    await jump(decided.terms.timing.appealWindowSec + decided.terms.timing.appealDecideSec + 1);
    expect(await pass.run()).toMatchObject({ sent: [], refused: [] });
    expect(await lanes()).toBe(before);
  }, 120_000);

  it('the contract is the check: a reclaim the book thinks due but the chain refuses at the pinned block is not sent, nor tried every pass', async () => {
    const { s, sync, pass } = await node();
    const d = await funded('t-231-stranger', s);
    await jump(3_601);
    // A stranger reclaims straight on the contract; no sync pass has read it, so the book still shows Held.
    await direct(cast.stranger, chain.deployment.rules, rulesCall('reclaim', [termsView(d.terms)]));
    const before = await lanes();
    const r = await pass.run();
    expect(r).toMatchObject({ sent: [], reads: 1 });
    expect(r.refused.map((x) => x.detail)).toEqual([expect.stringMatching(/^contract revert WrongStage at block \d+$/)]);
    expect(await lanes()).toBe(before);
    // Backed off: the next pass reads nothing for it.
    expect(await pass.run()).toMatchObject({ sent: [], refused: [], reads: 0 });
    // The sync applies the stranger's reclaim; the deal is over and the pass forgets it.
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect((await s.state(d.id))!.escrowState).toBe('Refunded');
    expect(pass.nextAt()).toBeNull();
    expect(await lanes()).toBe(before);
  }, 120_000);

  it('the check reads at the latest of the RPC head, the sync cursor and the highest block in the log, never before a block this node applied', async () => {
    // An RPC node whose latest block trails every write: it reports the deployment's first block as its head.
    const lag: { head?: bigint } = {};
    const { s, pass } = await node({}, shimmed(chain, lag));
    const d = await funded('t-231-pinned', s);
    const funding = BigInt(String(s.log().find((e) => e.commitmentId === d.id && e.type === 'hold.funded')!.payload['block']));
    await jump(3_601);
    lag.head = chain.deployment.fromBlock;
    // The pass reads at the funding's block, the highest in its log, not at the head the RPC reports. Before deliverBy
    // there, so the contract answers TooEarly and nothing is sent.
    const lagged = await pass.run();
    expect(lagged.block).toBe(funding.toString());
    expect(lagged.refused.map((x) => x.detail)).toEqual([`contract revert TooEarly at block ${funding}`]);
    expect(lagged.sent).toEqual([]);
    // The sync's cursor raises it further: at the chain's real head, the reclaim is due.
    await jump(13);
    const real = BigInt((await head()).block);
    const raised = await pass.run(real);
    expect(BigInt(raised.block!)).toBeGreaterThanOrEqual(real);
    expect(sent(raised)).toEqual(['reclaim']);
    delete lag.head;
    expect((await s.stage(d.id)).stage).toBe('Refunded');
  }, 120_000);

  // T-232, red team of PR 239 (neutrality.t232-rpc-bogus-head): the floor rises only to a block a read proved.
  it('one wrong head from the RPC does not raise the floor: that pass fails its check, and the next one sends the reclaim', async () => {
    const lag: { head?: bigint } = {};
    const { s, pass } = await node({}, shimmed(chain, lag));
    const d = await funded('t-232-bogus-head', s);
    await jump(3_601);
    const real = BigInt((await head()).block);
    // An RPC answers eth_blockNumber 1,000,000 blocks past the chain, once: the check at that block finds no such block.
    lag.head = real + 1_000_000n;
    const wrong = await pass.run();
    delete lag.head;
    expect(wrong.sent).toEqual([]);
    expect(s.world.floor!()).toBeLessThan(real + 1_000n);
    // Past the failed check's back-off (30 s), a pass with an honest head reads, checks and sends at the real chain.
    await jump(31);
    expect(sent(await pass.run())).toEqual(['reclaim']);
    expect((await s.stage(d.id)).stage).toBe('Refunded');
  }, 120_000);

  it('a restart between the broadcast and the receipt sends the reclaim once', async () => {
    const rowKey = (r: LaneRow) => `${r.lane}:${r.from.toLowerCase()}:${r.nonce}`;
    const storeOf = (m: Map<string, LaneRow>): LaneStore => ({
      load: async () => [...m.values()].map((r) => structuredClone(r)),
      write: async (r) => void m.set(rowKey(r), structuredClone(r)),
      remove: async (rs) => {
        for (const r of rs) m.delete(rowKey(r));
      },
    });
    const opened = async (rows: Map<string, LaneRow>) => {
      const base = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RESTART_RELAYER, pollMs: 100 });
      await base.attach(storeOf(rows));
      return { base, c: shimmed(base) };
    };
    const rowsA = new Map<string, LaneRow>();
    const a = await opened(rowsA);
    const { s, pass } = await node({}, a.c);
    const d = await funded('t-231-restart', s);
    // What the world's persist does: the books are written, then the funding's lane row goes.
    const books = s.drain();
    await a.base.release(books.relayed);
    expect(rowsA.size).toBe(0);
    await jump(3_601);
    const start = await lanes(a.base);
    // Mining held back: the row is written and the reclaim sits in the pool when the node restarts.
    await anvil.rpc('evm_setIntervalMining', [0]);
    let copy: Map<string, LaneRow>;
    let first: Promise<Awaited<ReturnType<OperatorTimeouts['run']>>>;
    try {
      first = pass.run();
      for (let i = 0; i < 300 && rowsA.size === 0; i++) await sleep(20);
      for (let i = 0; i < 300 && (await anvil.rpc<{ pending: Hex }>('txpool_status', [])).pending === '0x0'; i++) await sleep(20);
      copy = new Map([...rowsA].map(([k, v]) => [k, structuredClone(v)]));
    } finally {
      await anvil.rpc('evm_setIntervalMining', [1]);
    }
    expect(copy.size).toBe(1);
    expect([...copy.values()][0]!.note).toMatchObject({ call: 'reclaim', idempotencyKey: `t-231/${d.id}/reclaim` });
    expect(sent(await first)).toEqual(['reclaim']);

    // The restarted node holds the books from before the reclaim and the open row. Its pass leaves that deal to the
    // row's recovery, which lands the reclaim as the relay it was; after it there is nothing to send.
    const b = await opened(copy);
    const restarted = await EvmSettlement.restore(b.c, genesis, books, wall);
    const again = new OperatorTimeouts(restarted, { via: 'op-1', key: (id, kind) => `t-231/${id}/${kind}`, graceMs: 0 });
    expect(await again.run()).toMatchObject({ sent: [], deferred: 1 });
    expect(await restarted.recover()).toMatchObject({ applied: 1, failed: 0 });
    expect((await restarted.state(d.id))!.escrowState).toBe('Refunded');
    expect(await again.run()).toMatchObject({ sent: [], reads: 0 });
    expect((await lanes(a.base)) - start).toBe(1);
  }, 120_000);

  it('a deal behind the chain still closes with no caller: the takeover and the default at fallbackBy, read from dealOf (T-228)', async () => {
    const { s, sync, pass } = await node();
    const { rules, multicall } = chain.deployment;
    const d = new EvmDeal(s, cast, club, 't-231-behind');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const af = await d.agreeAndFund();
    const delivery = await d.deliver();
    if (accept.kind !== 'adjudicator_accept' || af.kind !== 'agree_and_fund' || delivery.kind !== 'deliver') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    // Residual 13, case 3: the funding and the delivery in one Multicall3 transaction. The book stays
    // AcceptedByAdjudicator while dealOf moves to Delivered.
    const bundle = encodeFunctionData({
      abi: chain.abis.multicall,
      functionName: 'aggregate3',
      args: [
        [
          { target: rules, allowFailure: false, callData: rulesCall('agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(af.agree), { signature: af.funding.signature }]) },
          { target: rules, allowFailure: false, callData: rulesCall('deliver', [termsView(d.terms), deliveryView(delivery.delivery), delivery.delivery.signature]) },
        ],
      ],
    });
    await direct(watcher, multicall, bundle);
    expect(await sync.pass()).toMatchObject({ behind: 1 });
    expect(s.escrowState(d.id)!.kind).toBe('AcceptedByAdjudicator');
    expect(s.behindStage(d.id)).toEqual({ stage: 'Delivered' });

    const before = await lanes();
    const partyNonces = await parties();
    // The book's own timeout (an offer expiry) is not this deal's: the pass reads dealOf, which says fallbackBy.
    expect(await pass.run()).toMatchObject({ sent: [], reads: 1 });
    expect(pass.nextAt()).toBe(at(d.terms.timing.fallbackBy));
    await jump(4_201);
    expect(await pass.run()).toMatchObject({ sent: [], reads: 0 });

    await jump(600);
    const held = await s.heldFor(d.id);
    const buyer = await s.tokenBalance(cast.buyer.address, true);
    expect(sent(await pass.run())).toEqual(['fallback']);
    expect(s.behindStage(d.id)).toEqual({ stage: 'FallbackJudging' });
    expect(sent(await pass.run())).toEqual(['default']);
    expect((await s.stage(d.id)).stage).toBe('Refunded');
    expect((await s.state(d.id))!.escrowState).toBe('Refunded');
    expect(s.lag(d.id)).toContain('dealOf: Refunded');
    expect(await s.tokenBalance(cast.buyer.address, true)).toBe(buyer + held);
    expect(await parties()).toEqual(partyNonces);
    expect((await lanes()) - before).toBe(2);
    // Over on chain: the next pass reads dealOf once more, finds nothing to send, and forgets the deal.
    expect(await pass.run()).toMatchObject({ sent: [], reads: 1 });
    expect(pass.nextAt()).toBeNull();
  }, 120_000);

  it('a cap per pass and a daily budget hold sends back, and money comes first', async () => {
    let left = 2;
    const opensAt = () => wall() + 3_600_000;
    const budget: TimeoutBudget = { take: async () => (left-- > 0 ? true : { opensAt: opensAt(), offersOnly: false }) };
    const { s, pass } = await node({ perPass: 2, budget });
    // An accepted offer whose expiry is due first, and three held deals whose reclaims come due after it.
    const offer = new EvmDeal(s, cast, club, 't-231-cap-offer');
    await ok(s, await offer.offer());
    await ok(s, await offer.accept());
    const held = [await funded('t-231-cap-1', s), await funded('t-231-cap-2', s), await funded('t-231-cap-3', s)];
    await jump(3_601);
    const before = await lanes();
    // Two sends a pass, reclaims first: the offer holds no money.
    const first = await pass.run();
    expect(sent(first)).toEqual(['reclaim', 'reclaim']);
    expect(first.deferred).toBe(2);
    expect(pass.nextAt()).toBeLessThanOrEqual(wall());
    // The budget is spent: nothing more until it opens, and no pass is due before then.
    const second = await pass.run();
    expect(sent(second)).toEqual([]);
    expect(pass.nextAt()).toBeGreaterThanOrEqual(opensAt() - 5_000);
    expect((await lanes()) - before).toBe(2);
    expect(held.map((d) => s.escrowState(d.id)!.kind).sort()).toEqual(['Held', 'Refunded', 'Refunded']);
    expect(s.escrowState(offer.id)!.kind).toBe('AcceptedByAdjudicator');
  }, 120_000);

  // T-313: whether a send went out is a flag on the relay's answer (`reverted`), set where the relay learns it. The pass
  // read the words "reverted on chain" in the answer's detail before; the next two tests change the words each way.
  /** A budget that counts what the pass takes and gives back. */
  function counting(): { budget: TimeoutBudget; counts: { taken: number; given: number } } {
    const counts = { taken: 0, given: 0 };
    return {
      counts,
      budget: {
        take: async () => {
          counts.taken++;
          return true;
        },
        give: async () => {
          counts.given++;
        },
      },
    };
  }

  it('a send that reverted on chain keeps its budget unit and waits an hour, whatever its detail says', async () => {
    const { budget, counts } = counting();
    const c = shimmed(chain);
    // Between the relay's simulation and its transaction's block, a stranger's reclaim lands: the relay's own reverts.
    let land: (() => Promise<void>) | undefined;
    c.simulate = async (tx) => {
      await LiveChain.prototype.simulate.call(c, tx);
      const first = land;
      land = undefined;
      await first?.();
    };
    const { s, pass } = await node({ budget }, c);
    const d = await funded('t-313-reverted', s);
    await jump(3_601);
    // The relay's answer as it left the settlement, then with other words, as a later edit of that message would leave it.
    const answers: Array<Awaited<ReturnType<EvmSettlement['trigger']>>> = [];
    const relay = s.trigger.bind(s);
    s.trigger = async (...a) => {
      const r = await relay(...a);
      answers.push(r);
      return r.ok ? r : { ...r, problem: { ...r.problem, detail: 'the transaction failed in its block' } };
    };
    land = () => direct(cast.stranger, chain.deployment.rules, rulesCall('reclaim', [termsView(d.terms)]));
    const before = await lanes();
    const r = await pass.run();
    expect(answers).toEqual([expect.objectContaining({ ok: false, reverted: true })]);
    expect(answer(answers[0]!)).toMatch(/^invalid_state: reclaim reverted on chain in 0x[0-9a-f]{64} after a passing simulation/);
    expect(r.sent).toEqual([]);
    expect(r.refused.map((x) => x.detail)).toEqual(['invalid_state: the transaction failed in its block']);
    // The transaction went out and cost its gas: the budget keeps the unit, and the deal waits an hour, not a minute.
    expect((await lanes()) - before).toBe(1);
    expect(counts).toEqual({ taken: 1, given: 0 });
    const wait = pass.nextAt()! - wall();
    expect(wait).toBeGreaterThan(3_500_000);
    expect(wait).toBeLessThanOrEqual(3_600_000);
  }, 120_000);

  it('a refusal before the broadcast gets its budget unit back and waits a minute, even when its detail says "reverted on chain"', async () => {
    const { budget, counts } = counting();
    const c = shimmed(chain);
    // The relay's simulation meets a revert string that carries the words (a token's own, say): nothing is sent.
    const revert: { words?: string } = {};
    c.simulate = async (tx) => {
      if (revert.words === undefined) return LiveChain.prototype.simulate.call(c, tx);
      const data = encodeErrorResult({ abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }], errorName: 'Error', args: [revert.words] });
      throw Object.assign(new Error('execution reverted'), { data });
    };
    const { s, pass } = await node({ budget }, c);
    await funded('t-313-words', s);
    await jump(3_601);
    revert.words = 'the transfer reverted on chain';
    const before = await lanes();
    const r = await pass.run();
    expect(r.sent).toEqual([]);
    expect(r.refused.map((x) => x.detail)).toEqual(['invalid_state: contract revert Error(the transfer reverted on chain)']);
    expect(await lanes()).toBe(before);
    expect(counts).toEqual({ taken: 1, given: 1 });
    const wait = pass.nextAt()! - wall();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60_000);
  }, 120_000);
});
