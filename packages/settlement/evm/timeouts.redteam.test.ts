// Red team of T-231 (PR 230): the operators send due timeouts on their own, at their own gas. Each test is named
// attack.t231-<name> and asserts the defended outcome; the four that failed against the PR's first head are fixed in
// it, and the two marked "holds" passed from the start. A fifth finding, the offer expiry's gas, stays by decision (the
// task file's Decisions). Same harness as timeouts.test.ts: anvil standing in for Sepolia (a block every second at
// wall-clock time), the contracts from contracts/out, the operator's settlement on a LiveChain, and the operators' pass
// (`OperatorTimeouts.run`) after each move of the clock. A load-balanced RPC whose node trails is modelled by a proxy on
// the public client (`Lag`): the reads it serves at the latest block answer at an older block, as the trailing node
// would. Needs `anvil` on PATH and contracts/out; CI's contracts job runs it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { wholeSecond, type Address, type Club } from '@holdback/core';
import { encodeFunctionData, maxUint256, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission, TimeoutKind } from '../src/interface.js';
import type { LaneRow } from './chain.js';
import { acceptanceView, agreeView, deliveryView, termsView } from './encode.js';
import { revertData, revertName } from './errors.js';
import { EvmSettlement } from './evm-settlement.js';
import { ensureBond, LiveChain, type DeploymentFile, type LaneStore } from './live.js';
import { ChainSync, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor, type TestActor } from './testing.js';
import { OperatorTimeouts, type OperatorTimeoutsOptions, type TimeoutBudget, type TimeoutReport } from './timeouts.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's well-known dev keys (public; guard no value): the operator's relayer secret, and a second for the restart test. */
const RELAYER: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const RESTART_RELAYER: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * What a load-balanced RPC serves while one of its nodes trails (each field unset: the live answer). Receipts and
 * broadcasts still reach a node that is up to date, as with a load balancer that spreads calls over its nodes.
 */
interface Lag {
  /** dealOf at the latest block answers at this block. */
  dealOfAt?: bigint;
  /** The head the RPC reports. */
  head?: bigint;
  /** eth_estimateGas, the relay's simulation at the latest block, runs at this block. */
  simulateAt?: bigint;
  /** dealOf pinned past this block fails, as a node without that block answers. */
  missingAfter?: bigint;
}

describe.skipIf(!ready)(`red team of the operators' own timeouts, on anvil standing in for Sepolia (T-231, PR 230)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let chain: LiveChain;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  let skew = 0;
  const wall = () => Date.now() + skew;
  const cast = evmCast();
  const watcher = testActor('t-231-redteam/watcher');

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
    const restarting = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RESTART_RELAYER });
    const everyone = [...chain.lanes, ...restarting.lanes].map((l) => l.address).concat(Object.values(cast).map((a) => a.address), watcher.address);
    for (const a of everyone) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start: wholeSecond(wall()), buyer: 0n, bond: 0n }));
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

  /**
   * `base` behind the shim for anvil 1.0.0's estimate bug (timeouts.test.ts: a call whose EIP-7623 calldata floor
   * exceeds its execution gas is answered from eth_call), and behind `lag`, read on every call so a test can change it.
   */
  function shimmed(base: LiveChain, lag: Lag = {}): LiveChain {
    const client = new Proxy(base.publicClient, {
      get(target, prop) {
        if (prop === 'estimateGas') {
          return async (args: { account: Address; to: Address; data: Hex; value?: bigint; blockNumber?: bigint }) => {
            const at = lag.simulateAt === undefined ? args : { ...args, blockNumber: lag.simulateAt };
            try {
              return await target.estimateGas(at);
            } catch (e) {
              if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
              await target.call(at);
              return 1_000_000n;
            }
          };
        }
        if (prop === 'getBlockNumber' && lag.head !== undefined) {
          const head = lag.head;
          return async () => head;
        }
        if (prop === 'readContract') {
          return async (args: Record<string, unknown>) => {
            const pinned = args['blockNumber'] as bigint | undefined;
            if (args['functionName'] === 'dealOf') {
              if (pinned === undefined && lag.dealOfAt !== undefined) return target.readContract({ ...args, blockNumber: lag.dealOfAt } as never);
              if (pinned !== undefined && lag.missingAfter !== undefined && pinned > lag.missingAfter) throw new Error(`header not found: this node has no block ${pinned} yet`);
            }
            return target.readContract(args as never);
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
  const idempotencyOf = (id: string, kind: string) => `t-231-redteam/${id}/${kind}`;
  /** No grace past a deadline unless a test sets one, so each test moves the clock just past its deadline. */
  async function node(o: Partial<OperatorTimeoutsOptions> = {}, c: LiveChain = shimmed(chain)): Promise<{ s: EvmSettlement; sync: ChainSync; pass: OperatorTimeouts }> {
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    return { s, sync: new ChainSync(s, await head()), pass: new OperatorTimeouts(s, { via: 'op-1', key: idempotencyOf, graceMs: 0, ...o }) };
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
      if ((await chain.publicClient.getBlock({ blockTag: 'latest' })).timestamp >= target) return;
      await sleep(100);
    }
    throw new Error(`anvil did not reach ${target}`);
  }
  const nonce = (a: Address) => chain.publicClient.getTransactionCount({ address: a, blockTag: 'pending' });
  /** Every transaction the relayer lanes have sent so far. */
  const lanes = async (c: LiveChain = chain) => (await Promise.all(c.lanes.map((l) => nonce(l.address)))).reduce((n, x) => n + x, 0);
  const sent = (r: { sent: Array<{ kind: TimeoutKind }> }) => r.sent.map((x) => x.kind);
  const rulesCall = (fn: string, args: readonly unknown[]) => encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args });
  /** The contract's answer to `data` from `from` at the latest block: null when it accepts it, else the revert's name. */
  const answer = (from: Address, data: Hex) =>
    chain.publicClient.call({ account: from, to: chain.deployment.rules, data }).then(
      () => null,
      (e: unknown) => revertName(chain.abis.rules, revertData(e)) ?? String((e as Error).message).slice(0, 120),
    );
  /** Sends a rules call from `who`'s own wallet, past every operator, with a fixed gas limit (anvil's estimate bug). */
  async function direct(who: TestActor, to: Address, data: Hex): Promise<void> {
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to, data, gas: 8_000_000n });
    expect((await anvil.receipt(hash)).status).toBe('success');
  }
  const rowKey = (r: LaneRow) => `${r.lane}:${r.from.toLowerCase()}:${r.nonce}`;
  const storeOf = (m: Map<string, LaneRow>): LaneStore => ({
    load: async () => [...m.values()].map((r) => structuredClone(r)),
    write: async (r) => void m.set(rowKey(r), structuredClone(r)),
    remove: async (rs) => {
      for (const r of rs) m.delete(rowKey(r));
    },
  });
  /** A node's relayer on the restart test's key, with its lane rows in `rows`. */
  const opened = async (rows: Map<string, LaneRow>, lag: Lag = {}) => {
    const base = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RESTART_RELAYER, pollMs: 100 });
    await base.attach(storeOf(rows));
    return { base, c: shimmed(base, lag) };
  };

  it("attack.t231-behind-recovery-stale-stage: a restart while the takeover of a deal behind the chain is in flight, and one recovery read from a node a block behind, must not stop the pass from sending the default", async () => {
    const rowsA = new Map<string, LaneRow>();
    const a = await opened(rowsA);
    const { s, sync, pass } = await node({}, a.c);
    const { rules, multicall } = chain.deployment;
    const d = new EvmDeal(s, cast, club, 't-231-rt-behind-restart');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const af = await d.agreeAndFund();
    const delivery = await d.deliver();
    if (accept.kind !== 'adjudicator_accept' || af.kind !== 'agree_and_fund' || delivery.kind !== 'deliver') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    // Residual 13, case 3 (T-228's case): the funding and the delivery in one Multicall3 transaction.
    const bundle = encodeFunctionData({
      abi: chain.abis.multicall,
      functionName: 'aggregate3',
      args: [
        [
          { target: rules, allowFailure: false, callData: rulesCall('agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(af.agree), { method: 0, signature: af.funding.signature }]) },
          { target: rules, allowFailure: false, callData: rulesCall('deliver', [termsView(d.terms), deliveryView(delivery.delivery), delivery.delivery.signature]) },
        ],
      ],
    });
    await direct(watcher, multicall, bundle);
    expect(await sync.pass()).toMatchObject({ behind: 1 });
    expect(s.behindStage(d.id)).toEqual({ stage: 'Delivered', appeal: 0 });
    // What the world's persist does: the books are written; the sync's cursor stands before the takeover.
    const cursor = await head();
    const books = s.drain();
    await a.base.release(books.relayed);

    // Past fallbackBy: the pass sends the takeover the default needs. Mining is held, and the node restarts with the
    // takeover in the pool (a deploy, as T-231's own Handoff does to the live world).
    await jump(4_830);
    let copy = new Map<string, LaneRow>();
    let lagging = 0n;
    let first: Promise<TimeoutReport> | undefined;
    await anvil.rpc('evm_setIntervalMining', [0]);
    try {
      first = pass.run();
      for (let i = 0; i < 300 && rowsA.size === 0; i++) await sleep(20);
      for (let i = 0; i < 300 && (await anvil.rpc<{ pending: Hex }>('txpool_status', [])).pending === '0x0'; i++) await sleep(20);
      lagging = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
      copy = new Map([...rowsA].map(([k, v]) => [k, structuredClone(v)]));
    } finally {
      await anvil.rpc('evm_setIntervalMining', [1]);
    }
    expect([...copy.values()].map((r) => r.note?.call)).toEqual(['triggerFallback']);
    expect(sent(await first!)).toEqual(['fallback']);

    // The restarted node lands the open row (T-219). Its one unpinned dealOf read (`land`) is served by a node still at
    // the block before the takeover; every read after it is current.
    const lag: Lag = { dealOfAt: lagging };
    const b = await opened(copy, lag);
    const restarted = await EvmSettlement.restore(b.c, genesis, books, wall);
    const again = new OperatorTimeouts(restarted, { via: 'op-1', key: idempotencyOf, graceMs: 0 });
    expect(await restarted.recover()).toMatchObject({ failed: 0 });
    delete lag.dealOfAt;
    // The world's pass: persist (the landed row goes), then the chain sync from the cursor before the takeover.
    await b.base.release(restarted.drain().relayed);
    await new ChainSync(restarted, cursor).pass();
    // The recovery's read is `land`'s dealOf. Before T-232 it named no block, the lagging node answered it from the block
    // before the takeover, and the book kept Delivered. T-232 pins it at the takeover's receipt or later, so the book
    // shows the takeover; the pass must close the deal either way.
    expect({ book: restarted.behindStage(d.id), chain: await restarted.stage(d.id) }).toEqual({ book: { stage: 'FallbackJudging', appeal: 0 }, chain: { stage: 'FallbackJudging', appeal: 0 } });

    // Half an hour of passes, each past any back-off, each followed by the world's persist (the applied rows go).
    const reports: TimeoutReport[] = [];
    for (let i = 0; i < 6; i++) {
      reports.push(await again.run());
      await b.base.release(restarted.drain().relayed);
      await jump(301);
    }
    const after = await restarted.stage(d.id);
    const alarm = again.nextAt();
    expect({
      sent: reports.flatMap((r) => sent(r)),
      deferred: reports.map((r) => r.deferred),
      stage: after.stage,
      book: restarted.behindStage(d.id),
      alarmWithin5Min: alarm !== null && alarm - wall() <= 300_000,
    }).toEqual({
      sent: ['default'],
      deferred: [0, 0, 0, 0, 0, 0],
      stage: 'Refunded',
      // The default's own receipt read sets the book's stage right again.
      book: { stage: 'Refunded', appeal: 5 },
      alarmWithin5Min: false,
    });
  }, 240_000);

  it('attack.t231-budget-spent-without-a-send: a relay that refuses every send (the network above its gas cap) must not spend the daily budget', async () => {
    const { s } = await node();
    const deals = [await funded('t-231-rt-burn-1', s), await funded('t-231-rt-burn-2', s), await funded('t-231-rt-burn-3', s)];
    await jump(3_610);
    const books = s.drain();
    // The same operator's settlement behind a relay whose fee cap sits below the network's price: Sepolia during a spike
    // above the live 20 gwei cap, modelled with a cap of 0.05 gwei against anvil's base fee plus the 0.1 gwei minimum tip.
    const capped = shimmed(new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 100, maxFeeGwei: 0.05 }));
    const spiked = await EvmSettlement.restore(capped, genesis, books, wall);
    let spent = 0;
    const budget: TimeoutBudget = {
      take: async () => {
        spent++;
        return true;
      },
      give: async () => {
        spent--;
      },
    };
    const pass = new OperatorTimeouts(spiked, { via: 'op-1', key: idempotencyOf, budget, graceMs: 0 });
    const before = await lanes();
    const refused: string[][] = [];
    for (let i = 0; i < 4; i++) refused.push((await pass.run()).refused.map((x) => x.detail));
    await jump(61);
    for (let i = 0; i < 4; i++) refused.push((await pass.run()).refused.map((x) => x.detail));
    // Every send met the relay's refusal before anything was signed: no gas went out, and the budget got each unit back.
    expect(refused.flat().every((x) => /^relay_refused: .*above this node's cap/.test(x))).toBe(true);
    // One attempt, then every deal waits a minute: the next three passes try nothing, and after the minute one more.
    expect(refused.map((r) => r.length)).toEqual([1, 0, 0, 0, 1, 0, 0, 0]);
    expect(deals.map((d) => spiked.escrowState(d.id)!.kind)).toEqual(['Held', 'Held', 'Held']);
    expect({ transactions: (await lanes()) - before, budgetSpent: spent }).toEqual({ transactions: 0, budgetSpent: 0 });
    // The alarm waits for the pause too: no pass for a timeout before it ends.
    expect(pass.nextAt()!).toBeGreaterThan(wall() + 60_000);
  }, 180_000);

  it("attack.t231-round1-direct-reclaim-preempted: round 1's scenario 3a sends the buyer's own reclaim straight to the contract once deliverBy passed; the operators' pass must leave that call able to land", async () => {
    // The world's default: a minute's grace past each deadline.
    const { s, sync, pass } = await node({ graceMs: 60_000 });
    const d = await funded('t-231-rt-3a-direct', s);
    // The alarm comes at deliverBy plus the grace; round 1's driver waits 2 s past deliverBy on the operators' clock
    // (waitPast), then simulates the buyer's reclaim and retries TooEarly every 3 s (RoundChain.trigger).
    expect(pass.nextAt()).toBe(Date.parse(d.terms.timing.deliverBy) + 60_000);
    await jump(3_610);
    const before = await lanes();
    // Ten seconds past deliverBy: the pass reads nothing and sends nothing, so the buyer's own call is free to land.
    expect(await pass.run()).toMatchObject({ sent: [], reads: 0 });
    // examples/e2e-scenarios.ts 3a, `via === 'direct'`: round.chain.trigger(round.key('buyer'), 'reclaim', deal.terms),
    // whose simulateContract throws on any revert other than TooEarly.
    expect(await answer(cast.buyer.address, rulesCall('reclaim', [termsView(d.terms)]))).toBeNull();
    await direct(cast.buyer, chain.deployment.rules, rulesCall('reclaim', [termsView(d.terms)]));
    // After the grace, before any sync has read the buyer's reclaim: the contract's check refuses, and nothing goes.
    await jump(61);
    const late = await pass.run();
    expect(late.sent).toEqual([]);
    expect(late.refused.map((x) => x.detail)).toEqual([expect.stringMatching(/^contract revert WrongStage at block \d+$/)]);
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect(pass.nextAt()).toBeNull();
    expect((await lanes()) - before).toBe(0);
  }, 120_000);

  it("attack.t231-party-trigger-races-pass (holds): a party's reclaim through the API, sent while the pass sends its own, makes one transaction in all, and both answer without an error", async () => {
    const { s, pass } = await node();
    const d = await funded('t-231-rt-race', s);
    await jump(3_610);
    const before = await lanes();
    const [r, party] = await Promise.all([pass.run(), s.trigger(d.id, 'reclaim', { via: 'op-2', idempotencyKey: 't-231-rt/party-reclaim' })]);
    expect(party.ok).toBe(true);
    expect(r.refused).toEqual([]);
    expect((await lanes()) - before).toBe(1);
    expect((await s.stage(d.id)).stage).toBe('Refunded');
    // Exactly one of the two carried the reclaim's events; the other found it ran.
    const carried = [r.sent.length, party.ok ? party.events.length : 0];
    expect(carried.filter((n) => n > 0)).toHaveLength(1);
  }, 120_000);

  it("attack.t231-late-triggers (holds): after the pass's offer expiry and default, a party's same trigger answers the state they left, sends nothing, and replays under its key", async () => {
    const { s, pass } = await node();
    const offer = new EvmDeal(s, cast, club, 't-231-rt-late-offer');
    await ok(s, await offer.offer());
    await ok(s, await offer.accept());
    const escalated = await funded('t-231-rt-late-escalated', s);
    await ok(s, await escalated.deliver());
    await ok(s, await escalated.decide('primary', 'escalate'));
    await jump(910);
    const r = await pass.run();
    expect(sent(r).sort()).toEqual(['default', 'expire_offer']);
    const before = await lanes();
    const late = await Promise.all([s.trigger(offer.id, 'expire_offer', { via: 'op-2', idempotencyKey: 't-231-rt/late-1' }), s.trigger(escalated.id, 'default', { via: 'op-2', idempotencyKey: 't-231-rt/late-2' })]);
    expect(late.map((x) => (x.ok ? `${x.state.escrowState} ${x.events.length}` : x.problem.type))).toEqual(['Expired 0', 'Refunded 0']);
    const again = await s.trigger(offer.id, 'expire_offer', { via: 'op-2', idempotencyKey: 't-231-rt/late-1' });
    expect(again.ok && again.replayed).toBe(true);
    expect((await lanes()) - before).toBe(0);
  }, 120_000);

  it('attack.t231-mined-unapplied-send-goes-twice: a reclaim mined while the RPC trails must not be sent a second time by the next pass', async () => {
    const lag: Lag = {};
    const errors: string[] = [];
    // The world's relayer, with its lane rows in storage (T-219).
    const rows = new Map<string, LaneRow>();
    const a = await opened(rows, lag);
    const { s, pass } = await node({ onError: (e) => errors.push(e.message) }, a.c);
    const d = await funded('t-231-rt-twice', s);
    // What the world's persist does after the funding: the books are written, then its lane row goes.
    await a.base.release(s.drain().relayed);
    await jump(3_610);
    const trailing = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    // From here the node this settlement reads from stays at `trailing`: its head, its simulations, and no answer for a
    // later block. Receipts and broadcasts reach an up-to-date node, as through a load balancer.
    Object.assign(lag, { head: trailing, simulateAt: trailing, missingAfter: trailing });
    const before = await lanes(a.base);
    const first = await pass.run();
    // The reclaim is mined; the read of dealOf at its block fails for the whole retry budget (10 s), so the book stays Held
    // and the reclaim's lane row stays open. The next pass leaves the deal to the sync, which applies that receipt.
    await jump(31);
    const second = await pass.run();
    expect(second.deferred).toBe(1);
    for (const k of Object.keys(lag)) delete lag[k as keyof Lag];
    const reverted = second.refused.map((x) => /0x[0-9a-f]{64}/.exec(x.detail)?.[0]).filter((h): h is string => !!h);
    const wasted = await Promise.all(reverted.map(async (h) => (await chain.publicClient.getTransactionReceipt({ hash: h as Hex })).gasUsed));
    expect({ firstError: errors.length, stage: (await s.stage(d.id)).stage }).toEqual({ firstError: 1, stage: 'Refunded' });
    expect(first.sent).toEqual([]);
    expect({ transactions: (await lanes(a.base)) - before, secondPass: second.refused.map((x) => x.detail.replace(/0x[0-9a-f]{64}/, '0x…')), gasWasted: wasted }).toEqual({ transactions: 1, secondPass: [], gasWasted: [] });
  }, 180_000);
});
