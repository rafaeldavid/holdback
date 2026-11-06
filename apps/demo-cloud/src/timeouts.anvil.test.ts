// T-231 end to end in the public world: the operators' pass sends due timeouts on its own. Two parties use only the
// HTTP API and then go away: an offer the demo primary accepted that nobody funds, and a funded deal nobody delivers.
// The world's own passes expire the one and reclaim the other, at the relayer's gas, with no trigger from anyone, and
// the day's budget row and telemetry count both. The contracts are the ones deployed
// to anvil (a block every second at wall-clock time), behind the estimate shim for anvil 1.0.0's calldata-floor bug.
//
// Its own file, with no test that needs a network or a secret, like registration.anvil.test.ts. CI's contracts job runs
// the settlement half (packages/settlement/evm/timeouts.test.ts); this file runs where anvil is installed and skips,
// saying why, elsewhere. Needs `anvil` on PATH and `forge build` output.
import type { Hex } from 'viem';
import { LiveChain, type DeploymentFile, type EvmSettlement } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deploymentOf, ENV, estimateShim, lc, party, PRICE, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

const DATASET = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];

describe.skipIf(!ready)(`the operators send due timeouts on their own in the public world (anvil; T-231)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  let shim: Awaited<ReturnType<typeof estimateShim>>;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
    shim = await estimateShim(anvil.rpcUrl);
  }, 120_000);
  afterAll(async () => {
    await shim?.close();
    await anvil?.stop();
  });

  it('an accepted offer nobody funds expires, and a funded deal nobody delivers is reclaimed, with no caller', async () => {
    const storage = new MemoryStorage();
    const chain = new LiveChain({ deployment, rpcUrls: [shim.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain }, minWindowSec: 5, onError: (e) => errors.push(e.message) });
    const demo = await serve(world);
    try {
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
      expect(world.ready()).toBe(true);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const [buyer, seller] = [party(demo.urls, deployment), party(demo.urls, deployment)];
      for (const a of [buyer.agent, seller.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
      const token = lc(deployment.token.address);
      const role = (r: string) => d.demo.adjudicators.find((a: J) => a.role === r).address as string;
      const terms = (timing: Record<string, number>) => ({
        adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
        template: 'checks-only',
        clubId: d.demo.clubId,
        seller: seller.agent.address,
        buyer: { address: buyer.agent.address, encryptionPublicKey: buyer.agent.encryptionPublicKey },
        price: { token, amount: PRICE },
        deliverable: DATASET,
        checks: CHECKS,
        timing: { judgeWithinSec: 5, fallbackWithinSec: 5, appealWindowSec: 5, appealDecideSec: 5, ...timing },
      });
      // An offer the demo primary accepts and nobody funds.
      const unfunded = await seller.agent.offer(terms({ offerExpiresInSec: 20, fundWithinSec: 30, deliverWithinSec: 40 }));
      await untilBoth(buyer.agent, unfunded.id, ['AcceptedByAdjudicator'], 30_000);
      // A deal the buyer funds and the seller never delivers.
      const undelivered = await seller.agent.offer(terms({ offerExpiresInSec: 30, fundWithinSec: 40, deliverWithinSec: 45 }));
      await untilBoth(buyer.agent, undelivered.id, ['AcceptedByAdjudicator'], 30_000);
      expect((await buyer.agent.agreeAndFund(undelivered.terms, 40_000_000n)).escrowState).toBe('Held');
      const evm = world.chain as EvmSettlement;
      const held = await evm.heldFor(undelivered.id as Hex);
      const before = await evm.tokenBalance(buyer.agent.address, true);

      // From here no party calls anything: the world's own passes close both.
      await untilBoth(buyer.agent, unfunded.id, ['Expired'], 60_000);
      await untilBoth(buyer.agent, undelivered.id, ['Refunded'], 60_000);
      expect((await evm.stage(unfunded.id as Hex)).stage).toBe('Expired');
      expect((await evm.stage(undelivered.id as Hex)).stage).toBe('Refunded');
      expect(await evm.tokenBalance(buyer.agent.address, true)).toBe(before + held);
      // Node 1's relay sent each, from the deal's relayer lane; neither party ever held test ETH.
      const last = (id: string) => evm.log().filter((e) => e.commitmentId === id).at(-1)!;
      expect(last(unfunded.id)).toMatchObject({ type: 'offer.expired', submittedVia: 'demo-op-1' });
      expect(last(undelivered.id)).toMatchObject({ type: 'settlement.reclaimed', submittedVia: 'demo-op-1' });
      for (const id of [unfunded.id, undelivered.id]) {
        const tx = evm.transactions().filter((t) => t.commitmentId === id).at(-1)!;
        expect([lc(tx.from), tx.via]).toEqual([lc(evm.world.senderFor(id as Hex)), 'demo-op-1']);
      }
      for (const a of [buyer.agent, seller.agent]) expect(await evm.world.publicClient.getTransactionCount({ address: a.address as Hex })).toBe(0);
      // Counted: the day's budget row, written before each send, and the day's telemetry.
      const day = new Date().toISOString().slice(0, 10);
      expect(await storage.get(`ot:${day}`)).toEqual({ sent: 2, offers: 1 });
      expect(world.telemetry.usage()).toMatchObject({ timeouts: { expire_offer: 1, reclaim: 1 } });
      // Nothing is left to send, and no alarm is due for a timeout.
      for (let i = 0; i < 20 && (world.lastTimeouts()?.sent.length ?? 0) > 0; i++) await sleep(250);
      expect(world.lastTimeouts()).toMatchObject({ sent: [], refused: [] });
      expect(errors).toEqual([]);
    } finally {
      await demo.close();
    }
  }, 300_000);
});
