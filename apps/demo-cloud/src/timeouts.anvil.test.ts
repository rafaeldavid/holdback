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
import { CSV, deploymentOf, ENV, estimateShim, lc, party, PRICE, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
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
      const usdc = lc(deployment.token.address);
      const role = (r: string) => d.demo.adjudicators.find((a: J) => a.role === r).address as string;
      const terms = (timing: Record<string, number>) => ({
        adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
        template: 'checks-only',
        clubId: d.demo.clubId,
        seller: seller.agent.address,
        buyer: { address: buyer.agent.address, encryptionPublicKey: buyer.agent.encryptionPublicKey },
        price: { token: usdc, amount: PRICE },
        deliverable: DATASET,
        checks: CHECKS,
        timing: { judgeWithinSec: 5, fallbackWithinSec: 5, appealWindowSec: 0, appealDecideSec: 5, ...timing },
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

      // From here no party calls anything: the world's own passes close both, a minute's grace after each deadline.
      await untilBoth(buyer.agent, unfunded.id, ['Expired'], 150_000);
      await untilBoth(buyer.agent, undelivered.id, ['Refunded'], 150_000);
      // Not before the grace: each closed at least a minute after its deadline (block times, on the chain's clock).
      const at = (id: string) => Date.parse(evm.log().filter((e) => e.commitmentId === id).at(-1)!.at);
      expect(at(unfunded.id)).toBeGreaterThanOrEqual(Date.parse(unfunded.terms.timing.offerExpiresAt) + 60_000);
      expect(at(undelivered.id)).toBeGreaterThanOrEqual(Date.parse(undelivered.terms.timing.deliverBy) + 60_000);
      // ADR-0031 §7 (SC-6): the offer's expiry is node 1's own record; the contract still holds it as None.
      expect((await evm.stage(unfunded.id as Hex)).stage).toBe('None');
      expect((await evm.stage(undelivered.id as Hex)).stage).toBe('Refunded');
      expect(await evm.tokenBalance(buyer.agent.address, true)).toBe(before + held);
      // Node 1 marked the expiry and sent the reclaim, from the deal's relayer lane; neither party ever held test ETH.
      const last = (id: string) => evm.log().filter((e) => e.commitmentId === id).at(-1)!;
      expect(last(unfunded.id)).toMatchObject({ type: 'offer.expired', submittedVia: 'demo-op-1' });
      expect(last(undelivered.id)).toMatchObject({ type: 'settlement.reclaimed', submittedVia: 'demo-op-1' });
      expect(evm.transactions().filter((t) => t.commitmentId === unfunded.id)).toEqual([]);
      const tx = evm.transactions().filter((t) => t.commitmentId === undelivered.id).at(-1)!;
      expect([lc(tx.from), tx.via]).toEqual([lc(evm.world.senderFor(undelivered.id as Hex)), 'demo-op-1']);
      for (const a of [buyer.agent, seller.agent]) expect(await evm.world.publicClient.getTransactionCount({ address: a.address as Hex })).toBe(0);
      // Counted: the day's budget row, written before each send, and the day's telemetry. The expiry costs nothing.
      const day = new Date().toISOString().slice(0, 10);
      expect(await storage.get(`ot:${day}`)).toEqual({ sent: 1, offers: 0 });
      expect(world.telemetry.usage()).toMatchObject({ timeouts: { reclaim: 1 } });
      expect(world.telemetry.usage().timeouts?.['expire_offer'] ?? 0).toBe(0);
      // Nothing is left to send, and no alarm is due for a timeout.
      for (let i = 0; i < 20 && (world.lastTimeouts()?.sent.length ?? 0) > 0; i++) await sleep(250);
      expect(world.lastTimeouts()).toMatchObject({ sent: [], refused: [] });
      expect(errors).toEqual([]);
    } finally {
      await demo.close();
    }
  }, 300_000);

  // T-409 (N80): T-372 bounded every store read the adjudicator's pass awaits, but showed it on the in-memory
  // settlement only, where the hung deal stays Delivered. On the phase-one contract a hung read must cost only its
  // own deal: the other deal is judged in the same pass, and the hung one is closed by the default outcome the
  // terms give for an adjudicator that does not decide, sent by the operators' own timeout pass at fallbackBy.
  it('neutrality.store-hangs on the contract: one ciphertext read never answers; the other deal is Released, and the hung one is Refunded by the default outcome', async () => {
    const storage = new HangingCiphertext();
    const chain = new LiveChain({ deployment, rpcUrls: [shim.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain }, minWindowSec: 5, faucetPerClient: 100, onError: (e) => errors.push(e.message) });
    const demo = await serve(world);
    try {
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
      expect(world.ready()).toBe(true);
      const evm = world.chain as EvmSettlement;
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const role = (r: string) => d.demo.adjudicators.find((a: J) => a.role === r).address as string;
      const [buyer, seller] = [party(demo.urls, deployment), party(demo.urls, deployment)];
      for (const a of [buyer.agent, seller.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
      const usdc = lc(deployment.token.address);
      // The store's limit is the service default, 10 s (DEFAULT_STORE_READ_TIMEOUT_MS): the windows leave room for a
      // pass of each adjudicator to wait it out once.
      const offer = () =>
        seller.agent.offer({
          adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
          template: 'checks-only',
          clubId: d.demo.clubId,
          seller: seller.agent.address,
          buyer: { address: buyer.agent.address, encryptionPublicKey: buyer.agent.encryptionPublicKey },
          price: { token: usdc, amount: PRICE },
          deliverable: DATASET,
          checks: CHECKS,
          timing: { offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 25, fallbackWithinSec: 25, appealWindowSec: 0, appealDecideSec: 5 },
        });
      const [hung, healthy] = [await offer(), await offer()];
      for (const o of [hung, healthy]) await untilBoth(buyer.agent, o.id, ['AcceptedByAdjudicator'], 30_000);
      for (const o of [hung, healthy]) expect((await buyer.agent.agreeAndFund(o.terms, 40_000_000n)).escrowState).toBe('Held');
      for (const o of [hung, healthy]) await untilBoth(seller.agent, o.id, ['Held'], 60_000);
      const held = await evm.heldFor(hung.id as Hex);
      const before = await evm.tokenBalance(buyer.agent.address, true);

      // The next ciphertext stored is the hung deal's: from its upload on, every read of it never answers. The relay's
      // own check waits 2 s on this store and then relays (T-372 Decision 7), so the delivery still reaches the chain.
      storage.armed = true;
      await seller.agent.deliver(hung.terms, new TextEncoder().encode(CSV));
      expect(storage.hung.size).toBe(1);
      await seller.agent.deliver(healthy.terms, new TextEncoder().encode(CSV));
      await untilBoth(buyer.agent, hung.id, ['Delivered'], 60_000);

      // The healthy deal is judged by the primary while the hung one waits, inside the primary's window.
      await untilBoth(buyer.agent, healthy.id, ['Released'], Date.parse(healthy.terms.timing.judgeBy) - Date.now() + 15_000);
      const decided = evm.log().find((e) => e.commitmentId === healthy.id && e.type === 'judgment.decided')!;
      expect(lc(String(decided.actor))).toBe(lc(role('primary')));
      // The hung deal's state read says why it is not judged, with no store error and no seller URI.
      const read = (await buyer.agent.call('GET', `/v1/commitments/${hung.id}`)) as J;
      expect(read.escrowState).toBe('Delivered');
      const waiting = (read.notices ?? []).find((n: string) => n.includes('cannot judge this deal yet'));
      expect(waiting, `notices: ${(read.notices ?? []).join(' | ')}`).toBeDefined();
      expect(waiting).toContain('It tries again on each pass.');

      // Nobody calls anything more. No adjudicator decides the hung deal; the operators' pass applies the default
      // outcome after fallbackBy and its grace, and the price returns to the buyer.
      const fallbackBy = Date.parse(hung.terms.timing.fallbackBy);
      const types = () => evm.log().filter((e) => e.commitmentId === hung.id).map((e) => e.type);
      await untilBoth(buyer.agent, hung.id, ['Refunded'], fallbackBy - Date.now() + 120_000).catch((e: Error) => {
        throw new Error(`${e.message}; events: ${types().join(', ')}; world errors: ${errors.join(' | ') || 'none'}`);
      });
      expect(types()).not.toContain('judgment.decided');
      expect(types()).toContain('default.triggered');
      expect(Date.parse(evm.log().filter((e) => e.commitmentId === hung.id).at(-1)!.at)).toBeGreaterThanOrEqual(fallbackBy);
      expect((await evm.stage(hung.id as Hex)).stage).toBe('Refunded');
      expect(await evm.tokenBalance(buyer.agent.address, true)).toBe(before + held);
      expect((await buyer.agent.call('GET', `/v1/commitments/${healthy.id}`)).escrowState).toBe('Released');
      // The world logged why, once per adjudicator and reason, and nothing about any other deal.
      expect(errors.some((e) => e.includes(`cannot act on ${hung.id} yet`))).toBe(true);
      expect(errors.filter((e) => !e.includes(hung.id))).toEqual([]);
    } finally {
      await demo.close();
    }
  }, 360_000);
});

/** World storage whose reads of one ciphertext never answer (T-409): the first `ct:` row put while armed hangs. */
class HangingCiphertext extends MemoryStorage {
  armed = false;
  readonly hung = new Set<string>();
  override async put(entries: Record<string, unknown>): Promise<void> {
    if (this.armed)
      for (const k of Object.keys(entries))
        if (k.startsWith('ct:')) {
          this.hung.add(k);
          this.armed = false;
        }
    return super.put(entries);
  }
  override get<T = unknown>(key: string): Promise<T | undefined> {
    return this.hung.has(key) ? new Promise<T | undefined>(() => {}) : super.get<T>(key);
  }
}
