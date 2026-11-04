// ChainSync (T-218): the operators' view follows calls sent straight to HoldbackRules, past every operator (ADR-0005).
// On anvil standing in for Sepolia (a block every second at wall-clock time, ADR-0028), the contracts from
// contracts/out, the operator's settlement on a LiveChain. Each direct call goes from a party's or a stranger's own key
// and must show after one pass as SimChain's step, with `submittedVia: 'direct'` and its transaction. Windows pass by
// moving anvil's clock and the settlement's together. Needs `anvil` on PATH and `forge build` output in contracts/out.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEvent, wholeSecond, type AdjudicatorAcceptance, type Address, type Club, type Decision, type SettlementEvent } from '@holdback/core';
import { BlockNotFoundError, concat, encodeFunctionData, keccak256, maxUint256, parseGwei, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Genesis } from '../sim/simchain.js';
import type { Submission } from '../src/interface.js';
import { RelayRefused, type EvmChain } from './chain.js';
import { acceptanceView, agreeView, appealView, decisionView, deliveryView, earlyAcceptView, keyProof, mutualView, NO_DELIVERY, NO_KEY, termsView } from './encode.js';
import { EvmSettlement } from './evm-settlement.js';
import { ensureBond, LIVE_ABIS, LiveChain, type DeploymentFile } from './live.js';
import { ChainSync, LOG_RANGE, type Cursor } from './sync.js';
import { evmCast, evmGenesis, EvmDeal, testActor, type TestActor } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's well-known dev keys (public; guard no value): two operators' relayer secrets. */
const RELAYER: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const HASTY_RELAYER: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 65 bytes no key signed. */
const JUNK: Hex = `0x${'11'.repeat(65)}`;

const schemaErrors = (log: readonly SettlementEvent[]): string[] =>
  log.flatMap((e) => {
    const r = parseEvent(e);
    return r.ok ? [] : [`#${e.seq} ${e.type}: ${r.error.detail}`];
  });

/** The log is one chain of hashes, in order (append-only). */
function chained(s: EvmSettlement): void {
  for (const [i, e] of s.log().entries()) {
    expect(e.seq).toBe(i);
    if (i > 0) expect(e.prevHash).toBe(s.log()[i - 1]!.hash);
  }
}

describe('ChainSync reads', () => {
  const rules = `0x${'b'.repeat(40)}` as Address;
  const stub = (o: { head: bigint; logs?: (range: [bigint, bigint]) => unknown[]; tx?: () => Promise<unknown> }) => {
    const ranges: Array<[bigint, bigint]> = [];
    let observed = 0;
    const world = {
      deployment: { rules, fromBlock: 100n },
      abis: LIVE_ABIS,
      publicClient: {
        getBlockNumber: async () => o.head,
        getBlock: async () => ({ timestamp: 0n, hash: `0x${'11'.repeat(32)}` }),
        getTransaction: o.tx ?? (async () => Promise.reject(new Error('no transaction'))),
        getTransactionReceipt: o.tx ?? (async () => Promise.reject(new Error('no receipt'))),
        request: async ({ params }: { params: [{ fromBlock: Hex; toBlock: Hex }] }) => {
          const range: [bigint, bigint] = [BigInt(params[0].fromBlock), BigInt(params[0].toBlock)];
          ranges.push(range);
          return o.logs?.(range) ?? [];
        },
      },
    };
    const evm = {
      world,
      eventCount: () => 0,
      follows: () => true,
      applied: () => false,
      stage: async () => ({ stage: 'Held', appeal: 0 }),
      observe: async () => {
        observed++;
        return { applied: 0, seen: 0, behind: 0, unknown: 0 };
      },
    } as unknown as EvmSettlement;
    return { evm, ranges, observed: () => observed };
  };

  it('reads the logs in chunks of at most 50,000 blocks, from the deployment block to the head', async () => {
    const { evm, ranges } = stub({ head: 120_100n });
    const sync = new ChainSync(evm);
    const report = await sync.pass();
    expect(ranges).toEqual([
      [100n, 50_099n],
      [50_100n, 100_099n],
      [100_100n, 120_100n],
    ]);
    for (const [a, b] of ranges) expect(b - a + 1n).toBeLessThanOrEqual(LOG_RANGE);
    expect(report).toMatchObject({ from: '100', to: '120100', logs: 0, txs: 0 });
    expect(sync.cursor).toEqual({ block: '120100', hash: `0x${'11'.repeat(32)}` });
    // Nothing new: no read past the head, no report.
    expect(await sync.pass()).toBeNull();
  });

  it('reads the last three blocks again each pass, and counts only the logs past the cursor (review L2)', async () => {
    const { evm, ranges } = stub({ head: 200n });
    const sync = new ChainSync(evm, { block: '150', hash: `0x${'22'.repeat(32)}` });
    expect(await sync.pass()).toMatchObject({ from: '148', to: '200' });
    expect(ranges).toEqual([[148n, 200n]]);
  });

  it('halves a range the provider caps, and stops halving for an error that is not a cap (red-team 4)', async () => {
    const { evm, ranges } = stub({
      head: 100n + 40_000n,
      logs: ([a, b]) => {
        if (b - a + 1n > 10_000n) throw new Error('query returned more than 10000 results');
        return [];
      },
    });
    await new ChainSync(evm).pass();
    expect(ranges.filter(([a, b]) => b - a + 1n <= 10_000n).reduce((n, [a, b]) => n + (b - a + 1n), 0n)).toBe(40_001n);
    const down = stub({
      head: 50_000n,
      logs: () => {
        throw new Error('fetch failed');
      },
    });
    await expect(new ChainSync(down.evm).pass()).rejects.toThrow(/fetch failed/);
    expect(down.ranges).toHaveLength(1);
  });

  it('fails closed: an RPC error after the logs applies nothing and moves no cursor', async () => {
    const id = `0x${'ab'.repeat(32)}`;
    const log = { address: rules, topics: [`0x${'00'.repeat(32)}`, id], blockNumber: '0x70', transactionIndex: '0x0', transactionHash: `0x${'cd'.repeat(32)}` };
    const { evm, observed } = stub({ head: 200n, logs: () => [log], tx: async () => Promise.reject(new Error('RPC down')) });
    const at: Cursor = { block: '100', hash: `0x${'22'.repeat(32)}` };
    const sync = new ChainSync(evm, at);
    await expect(sync.read()).rejects.toThrow(/RPC down/);
    expect(sync.cursor).toEqual(at);
    expect(observed()).toBe(0);
  });
});

describe.skipIf(!ready)(`ChainSync on anvil standing in for Sepolia${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let chain: LiveChain;
  let deployment: DeploymentFile;
  let genesis: Genesis;
  let club: Club;
  let skew = 0;
  const wall = () => Date.now() + skew;
  const cast = evmCast();
  const watcher = testActor('watcher');
  /** Sends through its own wallet client, never LiveChain, whose nonce cache would go stale. */
  const mempoolWatcher = testActor('mempool-watcher');
  const deployer = testActor('forwarder-deployer');

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
    const hasty = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: HASTY_RELAYER });
    const everyone = [...chain.lanes, ...hasty.lanes].map((l) => l.address).concat(Object.values(cast).map((a) => a.address), watcher.address, mempoolWatcher.address, deployer.address);
    for (const a of everyone) await anvil.rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']);
    const start = wholeSecond(wall());
    ({ genesis, club } = await evmGenesis({ cast, token: lc(d.token), chainId: anvil.chainId, rules: d.rules, start, buyer: 0n, bond: 0n }));
    // The world's sim beacon is the contract's SimBeacon, deployed with the zero seed (world.ts).
    genesis = { ...genesis, simSeed: `0x${'00'.repeat(32)}` };
    await chain.mint(cast.buyer.address, 10n ** 12n);
    await chain.mint(cast.seller.address, 10n ** 10n);
    for (const a of [cast.primary, cast.fallback, cast.appeal]) await ensureBond(chain, a.key, 500_000_000_000n, 10n ** 18n);
    // The parties' one-time allowance to HoldbackBonds for appeal bonds.
    for (const p of [cast.buyer, cast.seller]) await chain.send({ key: p.key, to: d.token, data: encodeFunctionData({ abi: chain.abis.token, functionName: 'approve', args: [d.bonds, maxUint256] }) });
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  /** An operator's settlement on `c`, with a sync whose cursor is the current head: it reads only what happens next. */
  async function node(c: EvmChain = chain): Promise<{ s: EvmSettlement; sync: ChainSync; cursor: Cursor }> {
    const s = await EvmSettlement.restore(c, genesis, undefined, wall);
    return { s, sync: new ChainSync(s, await head()), cursor: await head() };
  }
  async function head(): Promise<Cursor> {
    const n = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    return { block: n.toString(), hash: (await chain.publicClient.getBlock({ blockNumber: n })).hash! };
  }
  const ok = async (s: EvmSettlement, sub: Submission) => {
    const r = await s.submit(sub, { via: 'op-1' });
    if (!r.ok) throw new Error(`${sub.kind}: ${r.problem.type}: ${r.problem.detail}`);
    return r;
  };
  /** A deal the operator offered, accepted and funded, and delivered when asked. */
  async function funded(tag: string, s: EvmSettlement, o: { deliver?: boolean } = {}): Promise<EvmDeal> {
    const d = new EvmDeal(s, cast, club, tag);
    await ok(s, await d.offer());
    await ok(s, await d.accept());
    await ok(s, await d.agreeAndFund());
    if (o.deliver) await ok(s, await d.deliver());
    return d;
  }
  /**
   * Sends a rules call from `who`'s own wallet, past every operator: at the top level, inside a Multicall3 bundle, or
   * through another contract. A fixed gas limit: anvil's eth_estimateGas fails ("gas floor exceeds the gas limit") for a
   * cheap call whose calldata floor (EIP-7623, Prague) is above its execution gas, although eth_call passes (measured).
   */
  async function direct(who: TestActor, fn: string, args: readonly unknown[], through?: 'multicall' | Address): Promise<{ hash: Hex }> {
    const { rules, multicall } = chain.deployment;
    const call = encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args });
    const to = through === undefined ? rules : through === 'multicall' ? multicall : through;
    const data = through === undefined ? call : through === 'multicall' ? encodeFunctionData({ abi: chain.abis.multicall, functionName: 'aggregate3', args: [[{ target: rules, allowFailure: false, callData: call }]] }) : concat([rules, call]);
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to, data, gas: 3_000_000n });
    expect((await anvil.receipt(hash)).status).toBe('success');
    return { hash };
  }
  const forwarders = new Map<string, Address>();
  /**
   * Minimal forwarders, deployed once each. 'plain' calls the address in the first 20 bytes of its calldata with the
   * rest, so the rules call sits verbatim in the calldata. 'opaque' first subtracts 1 from the call's first byte, so the
   * calldata never shows the call that runs.
   */
  async function forwarderAddress(kind: 'plain' | 'opaque' = 'plain'): Promise<Address> {
    const hit = forwarders.get(kind);
    if (hit) return hit;
    const code: Hex =
      kind === 'plain'
        ? '0x601c8060095f395ff35f5f601436038060145f375f5f5f3560601c5af1601a575f5ffd5b00'
        : '0x60278060095f395ff35f5f601436038060145f375f51600160f81b90035f525f5f5f3560601c5af16025575f5ffd5b00';
    const wallet = anvil.wallet(deployer.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, data: code });
    const address = (await anvil.receipt(hash)).contractAddress! as Address;
    forwarders.set(kind, address);
    return address;
  }
  /** A rules call through a forwarder: the target, then the call (its first byte raised by 1 for the opaque one). */
  async function forwarded(who: TestActor, fn: string, args: readonly unknown[], kind: 'plain' | 'opaque' = 'plain'): Promise<{ hash: Hex }> {
    const call = encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args });
    const data = kind === 'plain' ? call : (`0x${(parseInt(call.slice(2, 4), 16) + 1).toString(16).padStart(2, '0')}${call.slice(4)}` as Hex);
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to: await forwarderAddress(kind), data: concat([chain.deployment.rules, data]), gas: 3_000_000n });
    expect((await anvil.receipt(hash)).status).toBe('success');
    return { hash };
  }
  /** Sends raw calldata from `who`'s wallet. */
  async function raw(who: TestActor, to: Address, data: Hex): Promise<{ hash: Hex }> {
    const wallet = anvil.wallet(who.key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to, data, gas: 8_000_000n });
    expect((await anvil.receipt(hash)).status).toBe('success');
    return { hash };
  }
  const rulesCall = (fn: string, args: readonly unknown[]) => encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args });
  const bundle = (calls: Array<{ target: Address; allowFailure: boolean; callData: Hex }>) => encodeFunctionData({ abi: chain.abis.multicall, functionName: 'aggregate3', args: [calls] });
  const decision = async (d: EvmDeal, role: 'primary' | 'fallback' | 'appeal', outcome: Decision['outcome'], round?: number) => ((await d.decide(role, outcome, round)) as { message: Decision }).message;
  const decideArgs = (d: EvmDeal, m: Decision) => [termsView(d.terms), decisionView(m), NO_DELIVERY, '0x'];
  const after = (s: EvmSettlement, id: string, seq: number) => s.log().filter((e) => e.commitmentId === id && e.seq >= seq);
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
  /** Waits until the beacon round is in the past on chain and in the settlement's clock. */
  async function roundDue(s: EvmSettlement, round: number): Promise<void> {
    for (let i = 0; i < 100 && (s.beacon(round) === null || (await chain.publicClient.getBlock({ blockTag: 'latest' })).timestamp <= BigInt(round)); i++) await sleep(100);
  }

  it('agreeAndFund sent by the buyer, with the acceptance the operators serve, shows Held and equals dealOf', async () => {
    const { s, sync } = await node();
    const d = new EvmDeal(s, cast, club, 'direct-fund');
    await ok(s, await d.offer());
    await ok(s, await d.accept());
    const served = s.log().find((e) => e.commitmentId === d.id && e.type === 'adjudicator.accepted')!.payload['acceptance'] as AdjudicatorAcceptance;
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    const af = await d.agreeAndFund();
    if (af.kind !== 'agree_and_fund') throw new Error('unreachable');
    const seq = s.log().length;
    const mined = await direct(cast.buyer, 'agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(served), agreeView(af.agree), { method: 0, signature: af.funding.signature }]);
    expect((await s.state(d.id))!.escrowState).toBe('AcceptedByAdjudicator');
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0, unknown: 0 });
    expect((await s.state(d.id))!.escrowState).toBe('Held');
    expect((await s.stage(d.id)).stage).toBe('Held');
    const events = after(s, d.id, seq);
    expect(events.map((e) => [e.type, e.submittedVia])).toEqual([
      ['commitment.agreed', 'direct'],
      ['hold.funded', 'direct'],
    ]);
    expect(events[1]!.payload).toMatchObject({ tx: mined.hash, sender: lc(cast.buyer.address), amount: { amount: '2050000000' } });
    expect(s.openDeals()).toEqual({ recent: 1, idle: 0 });
    // The next pass applies nothing twice.
    expect((await sync.pass())?.applied ?? 0).toBe(0);
    expect(after(s, d.id, seq)).toHaveLength(2);
    expect(schemaErrors(s.log())).toEqual([]);
    chained(s);
  }, 60_000);

  it('a delivery sent by the seller puts the deal behind; the seller posts it, the operator joins it with no second transaction, and the primary decides', async () => {
    const { s, sync } = await node();
    const d = await funded('direct-deliver', s);
    const sub = await d.deliver();
    const del = d.delivery!;
    const mined = await direct(cast.seller, 'deliver', [termsView(d.terms), deliveryView(del), del.signature]);
    expect(await sync.pass()).toMatchObject({ applied: 0, behind: 1 });
    // The contract's stage, the book's last step, and a notice that says what the seller does.
    expect((await s.state(d.id))!.escrowState).toBe('Delivered');
    expect(s.escrowState(d.id)!.kind).toBe('Held');
    expect(s.lag(d.id)).toMatch(new RegExp(`^Behind the chain: .*${mined.hash}.*POST /v1/commitments/${d.id}/deliveries`));
    expect(await s.keysFor(d.id, cast.primary.address)).toEqual([]);
    // A relay the book cannot check against the chain is refused.
    const early = await s.submit(await d.earlyAccept(), { via: 'op-1' });
    expect(early.ok ? 'ok' : early.problem.type).toBe('invalid_state');
    const sent = s.transactions().length;
    const joined = await ok(s, sub);
    expect(joined.state.escrowState).toBe('Delivered');
    expect(joined.events.map((e) => [e.type, e.submittedVia])).toEqual([
      ['delivery.submitted', 'direct'],
      ['key.released', 'direct'],
    ]);
    expect(joined.events[0]!.payload).toMatchObject({ tx: mined.hash, attempt: 1, ciphertext: { uri: del.ciphertext.uri } });
    // Recorded once: the seller's own transaction, no relay of this node's.
    expect(s.transactions().slice(sent).map((t) => [t.hash, t.via])).toEqual([[mined.hash, 'direct']]);
    expect(s.lag(d.id)).toBeNull();
    expect(await s.keysFor(d.id, cast.primary.address)).toHaveLength(1);
    expect((await ok(s, await d.decide('primary', 'accept'))).state.escrowState).toBe('Released');
    expect(schemaErrors(s.log())).toEqual([]);
    chained(s);
  }, 60_000);

  it('a delivery posted before any pass read it joins at once: the refused relay reads the chain for that deal', async () => {
    const { s } = await node();
    const d = await funded('deliver-then-post', s);
    const sub = await d.deliver();
    const mined = await direct(cast.seller, 'deliver', [termsView(d.terms), deliveryView(d.delivery!), d.delivery!.signature]);
    const joined = await ok(s, sub);
    expect(joined.state.escrowState).toBe('Delivered');
    expect(joined.events[0]).toMatchObject({ type: 'delivery.submitted', submittedVia: 'direct', payload: { tx: mined.hash } });
    expect(await s.keysFor(d.id, cast.primary.address)).toHaveLength(1);
  }, 60_000);

  it('a decision sent by a stranger who holds it releases the money, and the buyer key is served', async () => {
    const { s, sync } = await node();
    const d = await funded('direct-decide', s, { deliver: true });
    const seq = s.log().length;
    const mined = await direct(cast.stranger, 'decide', decideArgs(d, await decision(d, 'primary', 'accept')));
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect(await s.state(d.id)).toMatchObject({ escrowState: 'Released', appealState: 'none' });
    expect(after(s, d.id, seq).map((e) => [e.type, e.submittedVia])).toEqual([
      ['judgment.decided', 'direct'],
      ['settlement.released', 'direct'],
      ['key.released', 'direct'],
    ]);
    expect(after(s, d.id, seq)[0]!.payload).toMatchObject({ role: 'primary', outcome: 'accept', tx: mined.hash, sender: lc(cast.stranger.address) });
    expect(await s.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
    expect(await s.tokenBalance(cast.primary.address, true)).toBeGreaterThanOrEqual(50_000_000n);
  }, 60_000);

  it('an early accept sent by the buyer releases the money', async () => {
    const { s, sync } = await node();
    const d = await funded('direct-early', s, { deliver: true });
    const m = ((await d.earlyAccept()) as { message: Parameters<typeof earlyAcceptView>[0] }).message;
    const del = d.delivery!;
    await direct(cast.buyer, 'earlyAccept', [termsView(d.terms), earlyAcceptView(m), deliveryView(del), del.signature, keyProof(del, d.terms.buyer) ?? NO_KEY]);
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect((await s.state(d.id))!.escrowState).toBe('Released');
    expect(s.log().filter((e) => e.commitmentId === d.id).at(-2)).toMatchObject({ type: 'settlement.released', submittedVia: 'direct', payload: { via: 'early_accept' } });
    expect(await s.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
  }, 60_000);

  it('an escalation sent directly hands the appeal adjudicator its envelope, and it decides', async () => {
    const { s, sync } = await node();
    const d = await funded('direct-escalate', s, { deliver: true });
    await direct(cast.stranger, 'decide', decideArgs(d, await decision(d, 'primary', 'escalate')));
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect((await s.state(d.id))!.escrowState).toBe('Escalated');
    expect(s.log().filter((e) => e.commitmentId === d.id && e.type === 'key.released').at(-1)!.payload).toMatchObject({ recipient: cast.appeal.address, path: 'escalation' });
    expect(await s.keysFor(d.id, cast.appeal.address)).toHaveLength(1);
    const state = s.escrowState(d.id)!;
    const round = state.kind === 'Escalated' ? Math.floor(Date.parse(state.escalation.at) / 1000) + 1 : 0;
    await roundDue(s, round);
    expect((await ok(s, await d.decide('appeal', 'accept', round))).state.escrowState).toBe('Released');
  }, 60_000);

  it('an appeal filed directly by the seller hands the appeal adjudicator its envelope, and it decides', async () => {
    const { s, sync } = await node();
    const d = await funded('direct-appeal', s, { deliver: true });
    await ok(s, await d.decide('primary', 'reject'));
    const p = ((await d.appealBy('seller', 100_000_000n)) as { appeal: Parameters<typeof appealView>[0] }).appeal;
    const seq = s.log().length;
    await direct(cast.seller, 'fileAppeal', [termsView(d.terms), appealView(p)]);
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect(await s.state(d.id)).toMatchObject({ escrowState: 'Refunded', appealState: 'open' });
    expect(after(s, d.id, seq).map((e) => [e.type, e.submittedVia, e.payload['path'] ?? e.payload['grounds']])).toEqual([
      ['appeal.filed', 'direct', 'wrong-outcome'],
      ['key.released', 'direct', 'appeal'],
    ]);
    expect(await s.keysFor(d.id, cast.appeal.address)).toHaveLength(1);
    const state = s.escrowState(d.id)!;
    const round = state.kind === 'Refunded' && state.via.kind === 'first_instance' && state.via.appeal.kind === 'open' ? Math.floor(Date.parse(state.via.appeal.openedAt) / 1000) + 1 : 0;
    await roundDue(s, round);
    expect((await ok(s, await d.decide('appeal', 'reject', round))).state.appealState).toBe('upheld');
  }, 60_000);

  it('a mutual settlement sent by the buyer settles the deal', async () => {
    const { s, sync } = await node();
    const d = await funded('direct-mutual', s);
    const m = ((await d.mutual(1_500_000_000n, false)) as { message: Parameters<typeof mutualView>[0] }).message;
    await direct(cast.buyer, 'mutualSettle', [termsView(d.terms), mutualView(m), NO_DELIVERY, NO_KEY]);
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect((await s.state(d.id))!.escrowState).toBe('Settled');
    expect(s.log().filter((e) => e.commitmentId === d.id).at(-1)).toMatchObject({ type: 'commitment.settled', submittedVia: 'direct', payload: { keyReleased: false } });
  }, 60_000);

  it('a call inside a Multicall3 bundle is read through the bundle', async () => {
    const { s, sync } = await node();
    const d = await funded('multicall', s, { deliver: true });
    await direct(cast.stranger, 'decide', decideArgs(d, await decision(d, 'primary', 'reject')), 'multicall');
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect((await s.state(d.id))!.escrowState).toBe('Refunded');
  }, 60_000);

  it('a call forwarded by another contract is read from its calldata when its logs and signatures confirm it', async () => {
    const { s, sync } = await node();
    const d = await funded('forwarded-plain', s, { deliver: true });
    const seq = s.log().length;
    const sent = await forwarded(cast.stranger, 'decide', decideArgs(d, await decision(d, 'primary', 'accept')));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect(await s.state(d.id)).toMatchObject({ escrowState: 'Released', appealState: 'none' });
    expect(after(s, d.id, seq).map((e) => [e.type, e.submittedVia])).toEqual([
      ['judgment.decided', 'direct'],
      ['settlement.released', 'direct'],
      ['key.released', 'direct'],
    ]);
    expect(after(s, d.id, seq)[0]!.payload['tx']).toBe(sent.hash);
  }, 60_000);

  it('a call another contract transforms serves dealOf with a notice, invents no step, and does not hold back the cursor or other deals', async () => {
    const { s, sync } = await node();
    const opaque = await forwarderAddress('opaque');
    const a = await funded('forwarded', s, { deliver: true });
    const b = await funded('beside-forwarded', s, { deliver: true });
    const seq = s.log().length;
    const sent = await forwarded(cast.stranger, 'decide', decideArgs(a, await decision(a, 'primary', 'accept')), 'opaque');
    await direct(cast.stranger, 'decide', decideArgs(b, await decision(b, 'primary', 'accept')));
    const report = await sync.pass();
    expect(report).toMatchObject({ applied: 1, behind: 1 });
    expect(sync.cursor!.block).toBe(report!.to);
    expect((await s.state(a.id))!.escrowState).toBe('Released');
    expect(s.escrowState(a.id)!.kind).toBe('Delivered');
    expect(s.lag(a.id)!.toLowerCase()).toContain(`called contract ${lc(opaque)}`);
    expect(s.lag(a.id)).toContain(sent.hash);
    // No step: only the buyer's key, which the transaction released on chain, so the buyer can still open the work.
    expect(s.log().filter((e) => e.commitmentId === a.id && e.seq >= seq).map((e) => [e.type, e.payload['recipient'], e.payload['tx']])).toEqual([['key.released', cast.buyer.address, sent.hash]]);
    expect(await s.keysFor(a.id, cast.buyer.address)).toHaveLength(1);
    expect((await s.state(b.id))!.escrowState).toBe('Released');
    expect(s.lag(b.id)).toBeNull();
  }, 60_000);

  it('a transaction this node relayed is applied once, before and after a restart', async () => {
    const { s, sync, cursor } = await node();
    const d = await funded('relayed-once', s, { deliver: true });
    await ok(s, await d.decide('primary', 'accept'));
    const log = s.log();
    // The overlap may also reread an earlier test's last blocks: at least this deal's three transactions.
    const first = await sync.pass();
    expect(first).toMatchObject({ applied: 0, behind: 0 });
    expect(first!.txs).toBeGreaterThanOrEqual(3);
    expect(s.log()).toEqual(log);
    const again = await EvmSettlement.restore(chain, genesis, s.drain(), wall);
    const second = await new ChainSync(again, cursor).pass();
    expect(second).toMatchObject({ applied: 0, behind: 0 });
    expect(second!.txs).toBeGreaterThanOrEqual(3);
    expect(again.log()).toEqual(log);
  }, 60_000);

  it('a relayed transaction whose receipt the node never saw applies on the next pass, labelled direct', async () => {
    const a = await EvmSettlement.restore(chain, genesis, undefined, wall);
    const d = await funded('missed-receipt', a, { deliver: true });
    const saved = a.drain();
    const start = await head();
    // This node stops waiting at once, as if restarted between the broadcast and the receipt.
    const hasty = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: HASTY_RELAYER, pollMs: 10, receiptTimeoutMs: 1 });
    const b = await EvmSettlement.restore(hasty, genesis, saved, wall);
    await expect(b.submit(await d.decide('primary', 'accept'), { via: 'op-1' })).rejects.toThrow(/not mined within/);
    const c = await EvmSettlement.restore(chain, genesis, saved, wall);
    const sync = new ChainSync(c, start);
    let applied = 0;
    for (let i = 0; i < 20 && applied === 0; i++) {
      applied = (await sync.pass())?.applied ?? 0;
      if (applied === 0) await sleep(250);
    }
    expect(applied).toBe(1);
    expect((await c.state(d.id))!.escrowState).toBe('Released');
    expect(c.log().find((e) => e.commitmentId === d.id && e.type === 'judgment.decided')).toMatchObject({ submittedVia: 'direct', payload: { sender: lc(hasty.senderFor(d.id)) } });
    expect(await c.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
  }, 60_000);

  it('a commitment this node never saw is counted and skipped; the posted offer joins the chain state', async () => {
    const { s, sync } = await node();
    const d = new EvmDeal(s, cast, club, 'never-offered');
    const offer = await d.offer();
    if (offer.kind !== 'offer') throw new Error('unreachable');
    const accept = await d.accept();
    const af = await d.agreeAndFund();
    if (accept.kind !== 'adjudicator_accept' || af.kind !== 'agree_and_fund') throw new Error('unreachable');
    const mined = await direct(cast.buyer, 'agreeAndFund', [termsView(d.terms), offer.commitment.signatures.seller, acceptanceView(accept.message), agreeView(af.agree), { method: 0, signature: af.funding.signature }]);
    expect(await sync.pass()).toMatchObject({ applied: 0, unknown: 1 });
    expect(s.follows(d.id)).toBe(false);
    const joined = await ok(s, offer);
    expect(joined.state.escrowState).toBe('Held');
    expect(joined.events.map((e) => [e.type, e.submittedVia])).toEqual([
      ['commitment.offered', 'op-1'],
      ['adjudicator.accepted', 'direct'],
      ['commitment.agreed', 'direct'],
      ['hold.funded', 'direct'],
    ]);
    expect(joined.events.at(-1)!.payload['tx']).toBe(mined.hash);
    // The next pass has nothing left for it.
    expect((await sync.pass())?.applied ?? 0).toBe(0);
  }, 60_000);

  it('the fund leg copied alone: the deal is Held with the fee unpaid, then the node relays the fee alone', async () => {
    const { s, sync } = await node();
    const d = new EvmDeal(s, cast, club, 'fund-leg-first');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const sub = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 4_710_000n } });
    if (sub.kind !== 'agree_and_fund' || accept.kind !== 'adjudicator_accept') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    await direct(watcher, 'agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(sub.agree), { method: 0, signature: sub.funding.signature }]);
    await sync.pass();
    expect((await s.state(d.id))!.escrowState).toBe('Held');
    expect(s.log().some((e) => e.commitmentId === d.id && e.type === 'fee.operator')).toBe(false);
    const fees = await s.tokenBalance(cast.operator.address, true);
    const r = await ok(s, sub);
    expect(r.events.map((e) => [e.type, e.submittedVia])).toEqual([['fee.operator', 'op-1']]);
    expect(await s.tokenBalance(cast.operator.address, true)).toBe(fees + 4_710_000n);
    // The same answer again: the fee's nonce is spent, so nothing more is sent.
    const again = await ok(s, sub);
    expect(again.events).toEqual([]);
    expect(await s.tokenBalance(cast.operator.address, true)).toBe(fees + 4_710_000n);
    expect(schemaErrors(s.log())).toEqual([]);
  }, 60_000);

  it("the fund leg copied out of the mempool: the node's bundle reverts, the view follows the copy, and the node relays the fee alone", async () => {
    const { s } = await node();
    const d = new EvmDeal(s, cast, club, 'fund-leg-race');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const sub = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 4_710_000n } });
    if (sub.kind !== 'agree_and_fund' || accept.kind !== 'adjudicator_accept') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    const fundLeg = encodeFunctionData({ abi: chain.abis.rules, functionName: 'agreeAndFund', args: [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(sub.agree), { method: 0, signature: sub.funding.signature }] });
    const fees = await s.tokenBalance(cast.operator.address, true);
    let copy: Hex | undefined;
    let pending: Promise<Awaited<ReturnType<EvmSettlement['submit']>>> | undefined;
    await anvil.rpc('evm_setIntervalMining', [0]);
    try {
      pending = s.submit(sub, { via: 'op-1' });
      // The bundle waits in the mempool; a watcher copies its fund leg and outbids it.
      for (let i = 0; i < 100 && (await anvil.rpc<{ pending: string }>('txpool_status', [])).pending !== '0x1'; i++) await sleep(50);
      const wallet = anvil.wallet(mempoolWatcher.key);
      copy = await wallet.sendTransaction({ account: wallet.account!, chain: foundry, to: chain.deployment.rules, data: fundLeg, gas: 3_000_000n, maxFeePerGas: parseGwei('50'), maxPriorityFeePerGas: parseGwei('10') });
      await anvil.rpc('evm_mine', []);
    } finally {
      await anvil.rpc('evm_setIntervalMining', [1]);
    }
    const r = await pending!;
    if (!r.ok) throw new Error(`${r.problem.type}: ${r.problem.detail}`);
    const block = await chain.publicClient.getBlock({ blockHash: (await anvil.receipt(copy!)).blockHash, includeTransactions: true });
    const statuses = await Promise.all(block.transactions.map(async (t) => (typeof t === 'string' ? '' : (await anvil.receipt(t.hash)).status)));
    // The copy first, then the node's bundle, which reverted.
    expect(block.transactions.map((t) => (typeof t === 'string' ? t : t.hash))[0]).toBe(copy);
    expect(statuses).toEqual(['success', 'reverted']);
    expect(r.state.escrowState).toBe('Held');
    expect(r.events.map((e) => [e.type, e.submittedVia])).toEqual([
      ['commitment.agreed', 'direct'],
      ['hold.funded', 'direct'],
      ['fee.operator', 'op-1'],
    ]);
    expect(r.events[1]!.payload['tx']).toBe(copy);
    expect(await s.tokenBalance(cast.operator.address, true)).toBe(fees + 4_710_000n);
  }, 60_000);

  it('timeouts sent by a stranger: an offer expires, and a held deal is reclaimed', async () => {
    const { s, sync } = await node();
    const offered = new EvmDeal(s, cast, club, 'direct-expire');
    await ok(s, await offered.offer());
    await ok(s, await offered.accept());
    const held = await funded('direct-reclaim', s);
    expect(s.openDeals()).toEqual({ recent: 2, idle: 0 });
    await jump(3_601);
    await direct(cast.stranger, 'expireOffer', [termsView(offered.terms)]);
    await direct(cast.stranger, 'reclaim', [termsView(held.terms)]);
    expect(await sync.pass()).toMatchObject({ applied: 2 });
    expect((await s.state(offered.id))!.escrowState).toBe('Expired');
    expect(s.log().filter((e) => e.commitmentId === offered.id).at(-1)).toMatchObject({ type: 'offer.expired', submittedVia: 'direct', payload: { from: 'AcceptedByAdjudicator' } });
    expect((await s.state(held.id))!.escrowState).toBe('Refunded');
    expect(s.log().filter((e) => e.commitmentId === held.id).at(-1)).toMatchObject({ type: 'settlement.reclaimed', submittedVia: 'direct' });
    expect(s.openDeals()).toEqual({ recent: 0, idle: 0 });
  }, 90_000);

  it('a takeover sent by a stranger hands the fallback its envelope with the contract round; a default and an appeal expiry close deals', async () => {
    const { s, sync } = await node();
    const takeover = await funded('direct-fallback', s, { deliver: true });
    const defaulted = await funded('direct-default', s, { deliver: true });
    const appealed = await funded('direct-appeal-expiry', s, { deliver: true });
    const forwardedTakeover = await funded('forwarded-fallback', s, { deliver: true });
    const opaqueTakeover = await funded('opaque-fallback', s, { deliver: true });
    await ok(s, await appealed.decide('primary', 'accept'));
    await jump(4_201);
    for (const d of [takeover, defaulted]) await direct(cast.stranger, 'triggerFallback', [termsView(d.terms)]);
    await direct(cast.buyer, 'expireAppeal', [termsView(appealed.terms)]);
    // A takeover through any contract follows from its logs alone: a timeout carries no signed message.
    await forwarded(cast.buyer, 'triggerFallback', [termsView(forwardedTakeover.terms)]);
    await forwarded(cast.buyer, 'triggerFallback', [termsView(opaqueTakeover.terms)], 'opaque');
    expect(await sync.pass()).toMatchObject({ applied: 5, behind: 0 });
    for (const d of [forwardedTakeover, opaqueTakeover]) {
      expect(s.escrowState(d.id)!.kind).toBe('FallbackJudging');
      expect(await s.keysFor(d.id, cast.fallback.address)).toHaveLength(1);
    }
    const judgeBy = (d: EvmDeal) => Math.floor(Date.parse(d.terms.timing.judgeBy) / 1000);
    for (const d of [takeover, defaulted]) {
      expect((await s.state(d.id))!.escrowState).toBe('FallbackJudging');
      // SimBeacon's round at judgeBy is judgeBy in seconds; the payload carries what the contract logged.
      expect(s.log().find((e) => e.commitmentId === d.id && e.type === 'fallback.triggered')).toMatchObject({ submittedVia: 'direct', payload: { beaconRound: judgeBy(d) } });
      expect(await s.keysFor(d.id, cast.fallback.address)).toHaveLength(1);
    }
    const appealView_ = (await s.state(appealed.id))!;
    expect(appealView_).toMatchObject({ escrowState: 'Released', appealState: 'expired' });
    // D20: final at appealBy, not when the stranger closed it.
    const decidedAt = s.log().find((e) => e.commitmentId === appealed.id && e.type === 'judgment.decided')!.at;
    expect(Date.parse(appealView_.finalAt!)).toBe(Date.parse(decidedAt) + 300_000);
    // The fallback decides the first and both forwarded takeovers (review H1); the second runs out its window and anyone
    // defaults it.
    for (const d of [takeover, forwardedTakeover, opaqueTakeover]) expect((await ok(s, await d.decide('fallback', 'accept', judgeBy(d)))).state.escrowState).toBe('Released');
    await jump(700);
    await direct(cast.stranger, 'triggerDefault', [termsView(defaulted.terms)]);
    expect(await sync.pass()).toMatchObject({ applied: 1 });
    expect((await s.state(defaulted.id))!.escrowState).toBe('Refunded');
    expect(s.log().filter((e) => e.commitmentId === defaulted.id).slice(-2).map((e) => [e.type, e.submittedVia])).toEqual([
      ['default.triggered', 'direct'],
      ['settlement.refunded', 'direct'],
    ]);
    chained(s);
  }, 120_000);

  // Regressions from the review and the red-team pass on PR 185 (2026-11-04).

  it('a reverted decoy beside the real call in a bundle is not a step: the view records the decision that ran (red-team 1)', async () => {
    const { s, sync } = await node();
    const d = await funded('decoy-early', s, { deliver: true });
    const del = d.delivery!;
    const real = await decision(d, 'primary', 'accept');
    // An early accept the buyer never signed: the contract reverts it, and the bundle allows that.
    const forged = { ...((await d.earlyAccept()) as { message: Parameters<typeof earlyAcceptView>[0] }).message, signature: JUNK };
    const decoy = rulesCall('earlyAccept', [termsView(d.terms), earlyAcceptView(forged), deliveryView(del), del.signature, keyProof(del, d.terms.buyer) ?? NO_KEY]);
    const { rules, multicall } = chain.deployment;
    const seq = s.log().length;
    await raw(cast.stranger, multicall, bundle([
      { target: rules, allowFailure: true, callData: decoy },
      { target: multicall, allowFailure: false, callData: bundle([{ target: rules, allowFailure: false, callData: rulesCall('decide', decideArgs(d, real)) }]) },
    ]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    const book = s.escrowState(d.id)!;
    expect(book.kind === 'Released' ? book.via.kind : book.kind).toBe('first_instance');
    expect((await s.state(d.id))!.deadlines['appealBy']).toBeDefined();
    expect(after(s, d.id, seq).map((e) => e.type)).toEqual(['judgment.decided', 'settlement.released', 'key.released']);
  }, 60_000);

  it('a decoy settlement beside the real one: the view records the payouts the chain made (red-team 1)', async () => {
    const { s, sync } = await node();
    const d = await funded('decoy-mutual', s);
    const real = ((await d.mutual(1_500_000_000n, false)) as { message: Parameters<typeof mutualView>[0] }).message;
    const forged = { ...real, payouts: [{ to: d.terms.buyer, amount: d.terms.price }], buyerSignature: JUNK, sellerSignature: JUNK };
    const { rules, multicall } = chain.deployment;
    await raw(cast.buyer, multicall, bundle([
      { target: rules, allowFailure: true, callData: rulesCall('mutualSettle', [termsView(d.terms), mutualView(forged), NO_DELIVERY, NO_KEY]) },
      { target: multicall, allowFailure: false, callData: bundle([{ target: rules, allowFailure: false, callData: rulesCall('mutualSettle', [termsView(d.terms), mutualView(real), NO_DELIVERY, NO_KEY]) }]) },
    ]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect((await s.state(d.id))!.settled!.payouts.map((p) => [lc(p.to), p.amount.amount])).toEqual(real.payouts.map((p) => [lc(p.to), p.amount.amount]));
  }, 60_000);

  it('a forwarded copy of the seller delivery joins when the seller posts it, and the primary decides (red-team 2)', async () => {
    const { s, sync } = await node();
    const d = await funded('forwarded-deliver', s);
    const sub = await d.deliver();
    const sent = await forwarded(cast.stranger, 'deliver', [termsView(d.terms), deliveryView(d.delivery!), d.delivery!.signature]);
    expect(await sync.pass()).toMatchObject({ behind: 1 });
    expect(s.lag(d.id)).toContain('/deliveries');
    const joined = await ok(s, sub);
    expect(joined.events.map((e) => [e.type, e.payload['tx'] ?? null])).toEqual([
      ['delivery.submitted', sent.hash],
      ['key.released', null],
    ]);
    expect((await ok(s, await d.decide('primary', 'accept'))).state.escrowState).toBe('Released');
  }, 60_000);

  it('a bundle with the same takeover twice, one allowed to fail, follows from the logs (review H1)', async () => {
    const { s, sync } = await node();
    const d = await funded('takeover-twice', s, { deliver: true });
    await jump(4_201);
    const { rules, multicall } = chain.deployment;
    const call = rulesCall('triggerFallback', [termsView(d.terms)]);
    await raw(cast.stranger, multicall, bundle([
      { target: rules, allowFailure: false, callData: call },
      { target: rules, allowFailure: true, callData: call },
    ]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect(s.escrowState(d.id)!.kind).toBe('FallbackJudging');
    const judgeBy = Math.floor(Date.parse(d.terms.timing.judgeBy) / 1000);
    expect((await ok(s, await d.decide('fallback', 'reject', judgeBy))).state.escrowState).toBe('Refunded');
  }, 60_000);

  it('an agreement that expires past what a timestamp holds reads as never expiring: the deal follows, and a direct delivery joins (review H2)', async () => {
    const { s, sync } = await node();
    const d = new EvmDeal(s, cast, club, 'huge-expiry');
    const beside = await funded('beside-huge-expiry', s, { deliver: true });
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const af = await d.agreeAndFund();
    if (af.kind !== 'agree_and_fund' || accept.kind !== 'adjudicator_accept') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    // The buyer signs an Agree that expires at 2^64 - 1 seconds, past what a timestamp holds; the contract takes it.
    const nonce = keccak256(stringToBytes('huge-expiry/agree'));
    const expiresAt = 2n ** 64n - 1n;
    const signature = await privateKeyToAccount(cast.buyer.key).signTypedData({
      domain: s.domain as Parameters<ReturnType<typeof privateKeyToAccount>['signTypedData']>[0]['domain'],
      types: { Agree: [{ name: 'commitmentId', type: 'bytes32' }, { name: 'buyer', type: 'address' }, { name: 'nonce', type: 'bytes32' }, { name: 'expiresAt', type: 'uint64' }] },
      primaryType: 'Agree',
      message: { commitmentId: d.id, buyer: cast.buyer.address, nonce, expiresAt },
    });
    await raw(cast.buyer, chain.deployment.rules, rulesCall('agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(accept.message), { nonce, expiresAt, signature }, { method: 0, signature: af.funding.signature }]));
    await direct(cast.stranger, 'decide', decideArgs(beside, await decision(beside, 'primary', 'accept')));
    expect(await sync.pass()).toMatchObject({ applied: 2, behind: 0 });
    expect(s.escrowState(d.id)!.kind).toBe('Held');
    expect((await s.state(beside.id))!.escrowState).toBe('Released');
    // The seller delivers on the contract and posts the same delivery: it joins, and the primary gets its envelope (A2).
    const sub = await d.deliver();
    await direct(cast.seller, 'deliver', [termsView(d.terms), deliveryView(d.delivery!), d.delivery!.signature]);
    await sync.pass();
    expect((await ok(s, sub)).state.escrowState).toBe('Delivered');
    expect(await s.keysFor(d.id, cast.primary.address)).toHaveLength(1);
  }, 60_000);

  it('a read that keeps failing after a relay mined leaves the book untouched, and the next pass applies the call (review M2)', async () => {
    let failDealOf = false;
    let failed = 0;
    const pc = chain.publicClient;
    const flakyClient = new Proxy(pc, {
      get(target, prop) {
        if (prop === 'readContract') {
          return async (args: { functionName: string }) => {
            if (failDealOf && args.functionName === 'dealOf') {
              failed++;
              throw new Error('RPC down');
            }
            return (target.readContract as (a: unknown) => Promise<unknown>)(args);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const flaky = Object.create(chain) as LiveChain;
    Object.defineProperty(flaky, 'publicClient', { value: flakyClient });
    const { s, sync } = await node(flaky);
    const d = await funded('flaky-read', s, { deliver: true });
    failDealOf = true;
    await expect(s.submit(await d.decide('primary', 'accept'), { via: 'op-1' })).rejects.toThrow(/RPC down/);
    // The read at the receipt's block is tried five times (T-216 round 1) before the relay gives up on it.
    expect(failed).toBe(5);
    failDealOf = false;
    expect(s.escrowState(d.id)!.kind).toBe('Delivered');
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect((await s.state(d.id))!.escrowState).toBe('Released');
    expect(s.log().filter((e) => e.commitmentId === d.id).map((e) => e.type).slice(-3)).toEqual(['judgment.decided', 'settlement.released', 'key.released']);
  }, 60_000);

  it("a relayed delivery is logged when the node asked for its block's time is a block behind (T-216 round 1)", async () => {
    let after: bigint | null = null;
    let missed = 0;
    const behindClient = new Proxy(chain.publicClient, {
      get(target, prop) {
        if (prop === 'getBlock') {
          return async (args: { blockNumber?: bigint }) => {
            // A node behind the receipt's block answers null; viem throws that as BlockNotFoundError.
            if (after !== null && args.blockNumber !== undefined && args.blockNumber > after && missed++ === 0) throw new BlockNotFoundError({ blockNumber: args.blockNumber });
            return (target.getBlock as (a: unknown) => Promise<unknown>)(args);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const behind = Object.create(chain) as LiveChain;
    Object.defineProperty(behind, 'publicClient', { value: behindClient });
    const { s } = await node(behind);
    const d = await funded('block-time-behind', s);
    after = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    const r = await s.submit(await d.deliver(), { via: 'op-1' });
    expect(r.ok ? r.events.map((e) => e.type) : r.problem.type).toEqual(['delivery.submitted', 'key.released']);
    expect(missed).toBe(2);
    expect(await s.keysFor(d.id, cast.primary.address)).toHaveLength(1);
  }, 60_000);

  // Round 2 (2026-11-04): calls planted beside a copied signed step in a forwarder's calldata.

  /** A copied call through the plain forwarder with more calldata after it, which the rules contract ignores. */
  const plantedAfter = async (who: TestActor, real: Hex, planted: Hex) => raw(who, await forwarderAddress(), concat([chain.deployment.rules, real, planted]));

  it('a copied decision with a planted takeover after it: the view records the decision, and no takeover (red-team round 2, A)', async () => {
    const { s, sync } = await node();
    const d = await funded('planted-takeover', s, { deliver: true });
    const real = await decision(d, 'primary', 'accept');
    await plantedAfter(watcher, rulesCall('decide', decideArgs(d, real)), rulesCall('triggerFallback', [termsView(d.terms)]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect(await s.state(d.id)).toMatchObject({ escrowState: 'Released', appealState: 'none' });
    expect(await s.keysFor(d.id, cast.fallback.address)).toEqual([]);
    // The buyer's appeal goes through the operator as usual.
    expect((await ok(s, await d.appealBy('buyer', 100_000_000n))).state.appealState).toBe('open');
  }, 60_000);

  it('a copied fund leg with a planted offer expiry after it: the view records the funding (red-team round 2, A)', async () => {
    const { s, sync } = await node();
    const d = new EvmDeal(s, cast, club, 'planted-expiry');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const sub = await d.agreeAndFund();
    if (sub.kind !== 'agree_and_fund' || accept.kind !== 'adjudicator_accept') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    const fundLeg = rulesCall('agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(sub.agree), { method: 0, signature: sub.funding.signature }]);
    await plantedAfter(watcher, fundLeg, rulesCall('expireOffer', [termsView(d.terms)]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect(s.escrowState(d.id)!.kind).toBe('Held');
    expect((await ok(s, await d.deliver())).state.escrowState).toBe('Delivered');
  }, 60_000);

  it('a copied delivery with a planted junk call after it still waits for the post, and joins (red-team round 2, G3)', async () => {
    const { s, sync } = await node();
    const d = await funded('planted-junk', s);
    const sub = await d.deliver();
    const del = d.delivery!;
    const junk = { ...((await d.earlyAccept()) as { message: Parameters<typeof earlyAcceptView>[0] }).message, signature: JUNK };
    await plantedAfter(watcher, rulesCall('deliver', [termsView(d.terms), deliveryView(del), del.signature]), rulesCall('earlyAccept', [termsView(d.terms), earlyAcceptView(junk), deliveryView(del), del.signature, keyProof(del, d.terms.buyer) ?? NO_KEY]));
    expect(await sync.pass()).toMatchObject({ behind: 1 });
    expect(s.lag(d.id)).toContain('/deliveries');
    expect((await ok(s, sub)).state.escrowState).toBe('Delivered');
    expect(await s.keysFor(d.id, cast.primary.address)).toHaveLength(1);
  }, 60_000);

  it('an early accept hidden by a transforming contract, with a planted takeover: no takeover and no fallback envelope (red-team round 2, B)', async () => {
    const { s, sync } = await node();
    const d = await funded('hidden-early', s, { deliver: true });
    const del = d.delivery!;
    const ea = ((await d.earlyAccept()) as { message: Parameters<typeof earlyAcceptView>[0] }).message;
    const call = rulesCall('earlyAccept', [termsView(d.terms), earlyAcceptView(ea), deliveryView(del), del.signature, keyProof(del, d.terms.buyer) ?? NO_KEY]);
    const hidden = `0x${(parseInt(call.slice(2, 4), 16) + 1).toString(16).padStart(2, '0')}${call.slice(4)}` as Hex;
    await raw(watcher, await forwarderAddress('opaque'), concat([chain.deployment.rules, hidden, rulesCall('triggerFallback', [termsView(d.terms)])]));
    expect(await sync.pass()).toMatchObject({ applied: 0, behind: 1 });
    expect((await s.state(d.id))!.escrowState).toBe('Released');
    expect(s.escrowState(d.id)!.kind).toBe('Delivered');
    expect(await s.keysFor(d.id, cast.fallback.address)).toEqual([]);
    // The buyer's key, released on chain, is served.
    expect(await s.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
  }, 60_000);

  it("another account's transfer with the deal's fee nonce is not recorded as the operator fee (red-team round 2, D)", async () => {
    const { s, sync } = await node();
    const d = new EvmDeal(s, cast, club, 'fake-fee');
    await ok(s, await d.offer());
    const accept = await d.accept();
    await ok(s, accept);
    const sub = await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 4_710_000n } });
    if (sub.kind !== 'agree_and_fund' || accept.kind !== 'adjudicator_accept') throw new Error('unreachable');
    const sellerSignature = s.log().find((e) => e.commitmentId === d.id && e.type === 'commitment.offered')!.payload['sellerSignature'] as Hex;
    const fundLeg = rulesCall('agreeAndFund', [termsView(d.terms), sellerSignature, acceptanceView(accept.message), agreeView(sub.agree), { method: 0, signature: sub.funding.signature }]);
    // The watcher signs its own transfer of 1 base unit, with the nonce bound to this commitment.
    await chain.mint(watcher.address, 10n);
    const validBefore = d.terms.timing.fundBy;
    const auth = await s.operatorFeeAuthorization(d.id, watcher.address, cast.operator.address, 1n, '1970-01-01T00:00:00Z', validBefore);
    const feeCall = encodeFunctionData({ abi: chain.abis.token, functionName: 'transferWithAuthorization', args: [watcher.address, cast.operator.address, 1n, 0n, BigInt(Math.floor(Date.parse(validBefore) / 1000)), auth.nonce, await sign({ hash: auth.digest, privateKey: watcher.key, to: 'hex' })] });
    const { token, rules, multicall } = chain.deployment;
    await raw(watcher, multicall, bundle([
      { target: token, allowFailure: false, callData: feeCall },
      { target: rules, allowFailure: false, callData: fundLeg },
    ]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect(s.log().some((e) => e.commitmentId === d.id && e.type === 'fee.operator')).toBe(false);
    // The buyer's own submission: the node follows the copy and relays the buyer's fee alone, once.
    await ok(s, sub);
    expect(s.log().filter((e) => e.commitmentId === d.id && e.type === 'fee.operator').map((e) => [String(e.payload['from']), (e.payload['amount'] as { amount: string }).amount])).toEqual([[lc(cast.buyer.address), '4710000']]);
  }, 60_000);

  it('a relayed fee bundle whose receipt the node missed applies with its operator fee (review L4)', async () => {
    const a = await EvmSettlement.restore(chain, genesis, undefined, wall);
    const d = new EvmDeal(a, cast, club, 'missed-fee-bundle');
    await ok(a, await d.offer());
    await ok(a, await d.accept());
    const saved = a.drain();
    const start = await head();
    const hasty = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: HASTY_RELAYER, pollMs: 10, receiptTimeoutMs: 1 });
    const b = await EvmSettlement.restore(hasty, genesis, saved, wall);
    await expect(b.submit(await d.agreeAndFund({ operatorFee: { to: cast.operator.address, value: 4_710_000n } }), { via: 'op-1' })).rejects.toThrow(/not mined within/);
    const c = await EvmSettlement.restore(chain, genesis, saved, wall);
    const sync = new ChainSync(c, start);
    let applied = 0;
    for (let i = 0; i < 20 && applied === 0; i++) {
      applied = (await sync.pass())?.applied ?? 0;
      if (applied === 0) await sleep(250);
    }
    expect(c.escrowState(d.id)!.kind).toBe('Held');
    expect(c.log().filter((e) => e.commitmentId === d.id).map((e) => e.type).slice(-3)).toEqual(['commitment.agreed', 'fee.operator', 'hold.funded']);
    expect(c.log().find((e) => e.commitmentId === d.id && e.type === 'fee.operator')!.payload).toMatchObject({ from: lc(cast.buyer.address), to: lc(cast.operator.address), amount: { amount: '4710000' } });
  }, 60_000);

  it('sixteen filler timeouts ahead of a copied decision in an unreadable bundle do not hide it (red-team round 3, H1)', async () => {
    const { s, sync } = await node();
    const d = await funded('filler', s, { deliver: true });
    const { rules, multicall } = chain.deployment;
    // A call to an address with no code succeeds and makes the bundle unreadable; the real decision runs after the filler.
    const nobody = `0x${'de'.repeat(20)}` as Address;
    const filler = Array.from({ length: 16 }, () => ({ target: nobody, allowFailure: false, callData: rulesCall('triggerFallback', [termsView(d.terms)]) }));
    await raw(watcher, multicall, bundle([...filler, { target: rules, allowFailure: false, callData: rulesCall('decide', decideArgs(d, await decision(d, 'primary', 'accept'))) }]));
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect((await s.state(d.id))!.escrowState).toBe('Released');
  }, 60_000);

  it('a decision carrying a delivery this node never held, with a planted junk call, waits for the delivery and joins (red-team round 3, H2)', async () => {
    const { s, sync } = await node();
    const d = await funded('carried-junk', s);
    const sub = await d.deliver();
    const del = d.delivery!;
    const m = await decision(d, 'primary', 'accept');
    const junk = { ...((await d.earlyAccept()) as { message: Parameters<typeof earlyAcceptView>[0] }).message, signature: JUNK };
    await plantedAfter(watcher, rulesCall('decide', [termsView(d.terms), decisionView(m), deliveryView(del), del.signature]), rulesCall('earlyAccept', [termsView(d.terms), earlyAcceptView(junk), deliveryView(del), del.signature, keyProof(del, d.terms.buyer) ?? NO_KEY]));
    expect(await sync.pass()).toMatchObject({ behind: 1 });
    expect(s.lag(d.id)).toContain('/deliveries');
    const joined = await ok(s, sub);
    expect(joined.state.escrowState).toBe('Released');
    expect(joined.events.map((e) => e.type)).toEqual(['delivery.submitted', 'key.released', 'judgment.decided', 'settlement.released', 'key.released']);
  }, 60_000);

  it('a forwarded call padded with 120 KB of selectors keeps a pass short (review N1)', async () => {
    const { s, sync } = await node();
    const d = await funded('padded', s, { deliver: true });
    const call = rulesCall('decide', decideArgs(d, await decision(d, 'primary', 'accept')));
    const padding = `0x${call.slice(2, 10).repeat(30_000)}` as Hex;
    await plantedAfter(watcher, call, padding);
    const t0 = Date.now();
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    // The pass includes its RPC reads (about 6 on anvil); the scan itself is linear in the calldata.
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect((await s.state(d.id))!.escrowState).toBe('Released');
  }, 60_000);

  it('neutrality.operator-refuses-on-chain: the operator refuses to relay after funding; the parties submit directly, the deal settles, and the view shows every step', async () => {
    let refusing = false;
    // The same relayer lanes, but a chain that refuses every send once the deal is funded (D27).
    const operator = Object.assign(Object.create(chain) as LiveChain, {
      send: (tx: Parameters<LiveChain['send']>[0]) => (refusing ? Promise.reject(new RelayRefused('this operator refuses to relay')) : chain.send(tx)),
    });
    const { s, sync } = await node(operator);
    const d = await funded('operator-refuses', s);
    refusing = true;
    const delivery = await d.deliver();
    const refused = await s.submit(delivery, { via: 'op-1' });
    expect(refused.ok ? 'ok' : refused.problem.type).toBe('relay_refused');
    // The seller delivers on the contract, then posts the same signed delivery so the adjudicators get their envelopes.
    await direct(cast.seller, 'deliver', [termsView(d.terms), deliveryView(d.delivery!), d.delivery!.signature]);
    await sync.pass();
    await ok(s, delivery);
    // The primary decides; the operator refuses to relay the decision, so the primary sends it itself.
    const m = await decision(d, 'primary', 'accept');
    const decided = await s.submit({ kind: 'decide', message: m }, { via: 'op-1' });
    expect(decided.ok ? 'ok' : decided.problem.type).toBe('relay_refused');
    await direct(cast.primary, 'decide', decideArgs(d, m));
    await sync.pass();
    expect(await s.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
    // The appeal window closes; the buyer closes it on the contract.
    await jump(301);
    await direct(cast.buyer, 'expireAppeal', [termsView(d.terms)]);
    await sync.pass();
    expect(await s.state(d.id)).toMatchObject({ escrowState: 'Released', appealState: 'expired' });
    expect((await s.stage(d.id)).stage).toBe('Released');
    expect(s.log().filter((e) => e.commitmentId === d.id).map((e) => [e.type, e.submittedVia])).toEqual([
      ['commitment.offered', 'op-1'],
      ['adjudicator.accepted', 'op-1'],
      ['commitment.agreed', 'op-1'],
      ['hold.funded', 'op-1'],
      ['delivery.submitted', 'direct'],
      ['key.released', 'direct'],
      ['judgment.decided', 'direct'],
      ['settlement.released', 'direct'],
      ['key.released', 'direct'],
      ['appeal.expired', 'direct'],
    ]);
    expect(s.transactions().filter((t) => t.via === 'op-1').map((t) => t.call)).toEqual(['agreeAndFund']);
    expect(schemaErrors(s.log())).toEqual([]);
    chained(s);
  }, 90_000);
});
