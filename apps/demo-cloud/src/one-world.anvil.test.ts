// T-220 and D49 on anvil: today's Sepolia world reopens under this build, which names drand quicknet in the demo
// club's rulebook, without a new world. A deal opened before the switch keeps its rulebook and moves on, an offer signed
// against the old rulebook is refused with rulebook_unknown, the setup pass sends nothing, and the demo adjudicators hand
// a new deal the drand source and an old one the sim beacon.
//
// The world's first open names the sim beacon (`beacon: 'sim'`), as the deployed build does; the second names drand
// quicknet, as this build does on Sepolia. anvil's contracts verify the sim beacon, so no fallback or appeal decides
// here (the Sepolia fork run does that: live-fork.test.ts opens a new world against the deployment record). No network
// and no secret: CI's anvil step can require
// it. Needs `anvil` on PATH and `forge build` output.
import type { Hex } from 'viem';
import { canonicalKeccak, DRAND_QUICKNET, DRAND_QUICKNET_CHAIN_HASH, wholeSecond, type Commitment, type Hex32 } from '@holdback/core';
import type { RandomnessSource } from '@holdback/adjudicator';
import { LiveChain, type DeploymentFile, type EvmSettlement } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSV, deploymentOf, ENV, estimateShim, host, lc, Outsider, outsideDeal, party, PRICE, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

describe.skipIf(!ready)(`one world through the drand rulebook (anvil; T-220, D49)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
  }, 120_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  it('keeps the old deal on its rulebook, refuses an offer bound to the old hash, sends nothing at setup, and hands drand to new deals only', async () => {
    const storage = new MemoryStorage();
    const chainOf = () => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    const timing = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }; // phase one: no party appeal (ADR-0033 §2b)

    // Today's world: the rulebook names the sim beacon, as the deployed build's does. It posts no bond (ADR-0031 §8).
    const today = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf(), beacon: 'sim' }, faucetPerClient: 100, onError });
    const demo = await host(today);
    try {
      for (const end = Date.now() + 90_000; !today.ready() && Date.now() < end; ) await sleep(250);
      expect(today.ready()).toBe(true);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const adjudicators = d.demo.adjudicators.map((a: J) => a.address as string) as [string, string, string];
      const [primary, fallback, appeal] = adjudicators;
      const [b, s, s2] = [party(demo.urls, deployment), party(demo.urls, deployment), party(demo.urls, deployment)];
      for (const a of [b.agent, s.agent, s2.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
      const before = await s.agent.club(d.demo.clubId);
      expect(before.rulebook.randomness).toEqual({ source: 'sim' });
      const request = (seller: string) => ({
        template: 'checks-only',
        clubId: d.demo.clubId,
        seller,
        buyer: { address: b.agent.address, encryptionPublicKey: b.agent.encryptionPublicKey },
        adjudicators: { primary, fallback, appeal },
        price: { token: deployment.token.address.toLowerCase(), amount: PRICE },
        deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
        checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }],
        timing,
      });

      // A deal funded before the switch.
      const old = await s.agent.offer(request(s.agent.address));
      await untilBoth(b.agent, old.id, ['AcceptedByAdjudicator'], 30_000);
      expect((await b.agent.agreeAndFund(old.terms, 40_000_000n)).escrowState).toBe('Held');
      // An offer prepared and signed against today's rulebook, posted only after the switch.
      const req = { nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`, disclosure: 'public', ...request(s2.agent.address) };
      const stale = await s2.agent.sign(await s2.agent.call('POST', '/v1/prepare/offer', req), { kind: 'offer', request: req, registration: await s2.agent.registration(primary), rulebookHash: before.rulebookHash as Hex });

      // The deploy: this build opens the same storage. Before it: the head and the funding lane's balance.
      const chain = chainOf();
      const head = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
      const funding = await chain.ethBalance(chain.funding);
      const asked: number[] = [];
      const drand: RandomnessSource = { kind: 'drand-quicknet', clock: DRAND_QUICKNET, value: async (round) => (asked.push(round), null) };
      // On Sepolia this build names drand quicknet by default; anvil's chain id gets the sim beacon, so say it here.
      const next = await demo.deploy(() => PublicWorld.open({ storage, env: ENV, live: { chain, drand, beacon: 'drand-quicknet' }, faucetPerClient: 100, onError }));
      for (const end = Date.now() + 60_000; !next.ready() && Date.now() < end; ) await sleep(250);
      expect(next.ready()).toBe(true);
      // The setup pass sent nothing: no transaction since the deploy, and the funding lane's balance unchanged.
      await sleep(2500);
      let sent = 0;
      for (let n = head + 1n, end = await chain.publicClient.getBlockNumber({ cacheTime: 0 }); n <= end; n++) sent += (await chain.publicClient.getBlock({ blockNumber: n })).transactions.length;
      expect(sent).toBe(0);
      expect(await chain.ethBalance(chain.funding)).toBe(funding);

      // The club names drand quicknet now; the adjudicators are the same three.
      const after = await s.agent.club('demo-club');
      expect(after.rulebook.randomness).toEqual({ source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH });
      expect(after.rulebookHash).not.toBe(before.rulebookHash);
      expect(((await (await fetch(`${demo.urls[1]}/.well-known/holdback.json`)).json()) as J).demo.adjudicators.map((a: J) => a.address)).toEqual(adjudicators);

      // The old deal keeps its rulebook and moves on: delivered, decided by the primary, Released, opened by the buyer.
      expect(((await s.agent.call('GET', `/v1/commitments/${old.id}/terms`)) as J).rulebookHash).toBe(before.rulebookHash);
      expect(next.chain.escrowState(old.id as Hex32)?.kind).toBe('Held');
      await s.agent.deliver(old.terms, new TextEncoder().encode(CSV));
      await untilBoth(b.agent, old.id, ['Released'], 60_000);
      expect(await b.agent.openDelivery(old.id)).toBe(CSV);

      // The offer signed against the old rulebook: 422 rulebook_unknown, and the problem says to read the club again.
      const res = await fetch(`${demo.urls[0]}${stale.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(stale.body) });
      const problem = (await res.json()) as J;
      expect(res.status).toBe(422);
      expect(problem.type).toBe('rulebook_unknown');
      // Its page, named by the Link header, says to read the club and bind its current rulebookHash.
      expect(res.headers.get('link')).toMatch(/problems\/rulebook_unknown/);
      console.log(`T-220 stale offer: ${res.status} ${problem.type}: ${problem.detail}`);

      // A new deal binds the new rulebook and keeps drand quicknet as its source. The adjudicators read its rounds from
      // the drand source, and the old deal's from the sim beacon.
      const fresh = await s.agent.offer(request(s.agent.address));
      await untilBoth(b.agent, fresh.id, ['AcceptedByAdjudicator'], 30_000);
      expect(fresh.terms.rulebookHash).toBe(after.rulebookHash);
      const evm = next.chain as EvmSettlement;
      expect(evm.escrowState(fresh.id as Hex32)?.beaconSource).toBe('drand-quicknet');
      expect(evm.escrowState(old.id as Hex32)?.beaconSource ?? 'sim').toBe('sim');
      for (const role of ['fallback', 'appeal'] as const) {
        const port = next.adjudicators[role].settlement;
        expect(port.randomness({ id: fresh.id } as Commitment)).toBe(drand);
        expect(port.randomness({ id: old.id } as Commitment)?.kind).toBe('sim');
      }
      // No fallback or appeal turn came up, so no round was asked for.
      expect(asked).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await demo.close();
    }
  }, 600_000);
});

// T-378 part 6 (ADR-0032 §3.5): on a rules contract with a beacon margin, the demo fallback takes over at judgeBy and
// decides once its round is public. Here the margin is 7 s over the sim beacon, so the fallback's round is judgeBy + 7,
// and the deal's fallback window is 12 s. This shows a fallback decision with a margin through the demo world; the old
// wake schedule passes it too, so the wake times themselves are pinned by round-wake.test.ts.
describe.skipIf(!ready)(`the fallback woken when its round is public (anvil, a 7 s beacon margin; T-378, ADR-0032)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  const MARGIN = 7;
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  // anvil cannot estimate a relayed trigger (the takeover); the shim answers from eth_call, as for the operators' timeouts.
  let shim: Awaited<ReturnType<typeof estimateShim>>;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc', beaconMarginSec: MARGIN });
    deployment = { ...deploymentOf(anvil), beaconMarginSec: MARGIN };
    shim = await estimateShim(anvil.rpcUrl);
  }, 120_000);
  afterAll(async () => {
    await shim?.close();
    await anvil?.stop();
  });

  it('a silent primary: the demo fallback takes over at judgeBy and decides a 12 s fallback window after its round', async () => {
    const storage = new MemoryStorage();
    const chain = new LiveChain({ deployment, rpcUrls: [shim.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain, beacon: 'sim' }, minWindowSec: 5, faucetPerClient: 100, onError: (e) => errors.push(e.message) });
    // Opening reads no chain: reseed the sim beacon now, before the world's first pass sends anything.
    const { start } = (await storage.get<{ start: string }>('meta'))!;
    await anvil.fresh(canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }));
    const demo = await serve(world);
    try {
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
      expect(world.ready()).toBe(true);
      const evm = world.chain as EvmSettlement;
      expect(evm.beaconMarginSec).toBe(MARGIN);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
      // A primary that accepts and then says nothing: the takeover is the fallback's.
      const silent = new Outsider(world, demo.urls, 't-378/margin-silent', { trusted: [fallback, appeal] });
      expect((await silent.register(wholeSecond(Date.now() - 120_000))).status).toBe(200);
      const deal = await outsideDeal(demo.urls, deployment, silent, { work: CSV, timing: { offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 5, fallbackWithinSec: 12, appealWindowSec: 0, appealDecideSec: 60 } });
      const judgeBy = Date.parse(deal.terms.timing.judgeBy);
      const fallbackBy = Date.parse(deal.terms.timing.fallbackBy);
      const end = await untilBoth(deal.buyer, deal.id, ['Released', 'Refunded', 'Defaulted'], fallbackBy - Date.now() + 30_000).catch((e: Error) => {
        throw new Error(`${e.message}; world errors: ${errors.join(' | ') || 'none'}; events: ${evm.log().filter((x) => x.commitmentId === deal.id).map((x) => x.type).join(', ')}`);
      });
      expect(end.escrowState).toBe('Released');
      const decided = evm.log().find((e) => e.commitmentId === deal.id && e.type === 'judgment.decided')!;
      expect(lc(String(decided.actor))).toBe(lc(fallback));
      // Decided after its round was public (judgeBy + 7 s on the sim beacon) and before fallbackBy.
      const at = Date.parse(decided.at);
      expect(at).toBeGreaterThanOrEqual(judgeBy + MARGIN * 1000);
      expect(at).toBeLessThan(fallbackBy);
      expect(errors).toEqual([]);
    } finally {
      await demo.close();
    }
  }, 300_000);
});
