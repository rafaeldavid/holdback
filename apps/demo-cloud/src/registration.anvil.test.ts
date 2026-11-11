// T-221 end to end (ADR-0030): an adjudicator no one at Crow runs registers through the API and is named primary under
// the demo's fallback and appeal adjudicators. The phase-one contracts hold no bond and take no party appeal (ADR-0031
// §8): it posts no bond, accepts with bondReserved 0, and its first decision is final at once. The contracts are the ones deployed to anvil,
// with the sim beacon reseeded to the world's own seed so the demo appeal adjudicator's beacon proofs verify.
//
// Its own file, with no test that needs a network or a secret, so CI's contracts job can run it in the anvil step that
// fails on any skip (T-221 review). Needs `anvil` on PATH and `forge build` output; elsewhere it skips and says why.
import { canonicalKeccak, holdbackDomain, verifyRegistration, wholeSecond, type Address } from '@holdback/core';
import { LIVE_REGISTRY_URI, liveRegistry, markedFake, markerFake } from '@holdback/adjudicator';
import { LiveChain, type DeploymentFile, type EvmSettlement } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deploymentOf, ENV, CSV, lc, Outsider, outsideDeal, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

describe.skipIf(!ready)(`an outside adjudicator on a live chain (anvil; T-221)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
  }, 120_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  it('registers, accepts with bondReserved 0 and decides as primary, final at once; an appeal is refused naming phase one; another registry is noted; the demo fallback declines under its appeal adjudicator', async () => {
    const storage = new MemoryStorage();
    const chain = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain }, minWindowSec: 5, faucetPerClient: 100, onError: (e) => errors.push(e.message) });
    // Opening reads no chain: reseed the sim beacon now, before the world's first pass sends anything.
    const { start } = (await storage.get<{ start: string }>('meta'))!;
    await anvil.fresh(canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }));
    const demo = await serve(world);
    const t0 = Date.now();
    const took: Record<string, number> = {};
    const lap = (name: string) => (took[name] = Math.round((Date.now() - t0) / 1000));
    try {
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
      expect(world.ready()).toBe(true);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
      const evm = world.chain as EvmSettlement;
      // The outside appeal adjudicator a party controls (D44): registered, and named in deal 4.
      const attackers = new Outsider(world, demo.urls, 't-221/live-attackers-appeal', { trusted: [] });
      const outsider = new Outsider(world, demo.urls, 't-221/live-outsider', { trusted: [fallback, appeal], provider: markedFake(markerFake({}, 'NO-DELIVERY-CARRIES-THIS')) });
      const silent = new Outsider(world, demo.urls, 't-221/live-silent', { trusted: [fallback, attackers.address] });
      const issuedAt = wholeSecond(Date.now() - 120_000);

      // Registration through the API: listed, signed, and plainly unbonded (Rafa: "be clear"). A chain holds no bond.
      const posted = await outsider.register(issuedAt);
      expect(posted.status).toBe(200);
      expect(posted.body.observed).toMatchObject({ bond: 'none', expired: false });
      for (const o of [silent, attackers]) expect((await o.register(issuedAt)).status).toBe(200);
      const served = await Promise.all(demo.urls.map(async (u) => (await (await fetch(`${u}/v1/adjudicators/${outsider.address}`)).json()) as J));
      for (const v of served) expect(v.observed?.bond).toBe('none');
      expect(await verifyRegistration(holdbackDomain(anvil.chainId, lc(deployment.rules) as Address), served[0])).toBe(true);
      lap('registered');

      // Deal 1: the outsider accepts and decides by script; the deal is Released and the buyer opens its copy.
      const timing = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 120 };
      const one = await outsideDeal(demo.urls, deployment, outsider, { work: CSV, timing });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: one.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(one.buyer, one.id, ['Released'], 60_000);
      expect(await one.buyer.openDelivery(one.id)).toBe(CSV);
      const decided = evm.log().find((e) => e.commitmentId === one.id && e.type === 'judgment.decided')!;
      expect({ actor: lc(String(decided.actor)), via: decided.submittedVia }).toEqual({ actor: outsider.address, via: 'demo-op-1' });
      // ADR-0031 §8: the outsider's acceptance reserved no bond, and the decision is final at once.
      const accepted = evm.log().find((e) => e.commitmentId === one.id && e.type === 'adjudicator.accepted')!;
      expect(accepted.payload['bondRequired']).toMatchObject({ amount: '0' });
      const final = (await one.buyer.call('GET', `/v1/commitments/${one.id}`)) as J;
      expect(final).toMatchObject({ escrowState: 'Released', appealState: 'none' });
      expect(final.finalAt).toBe(final.settledAt);
      // The buyer's appeal is refused before anything is signed or sent, with the reason.
      const refusedAppeal = await fetch(`${demo.urls[0]}/v1/prepare/appeal`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ commitmentId: one.id, appellant: one.buyer.address }) });
      expect(refusedAppeal.status).toBe(409);
      expect((await refusedAppeal.json()) as J).toMatchObject({ type: expect.stringMatching(/invalid_state$/), detail: expect.stringMatching(/phase-one contracts, which have no party appeals/) });
      lap('deal 1 released');

      // Deal 4 (D44's second path): the silent outsider is primary, the demo fallback is named under an appeal
      // adjudicator it does not trust. Past judgeBy it neither triggers nor decides, and the state read says why.
      // judgeBy is deliverBy plus the judge window, so this deal's deliverBy is near too: about a minute from now.
      const four = await outsideDeal(demo.urls, deployment, silent, { work: CSV, timing: { ...timing, offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 5 }, adjudicators: { fallback, appeal: attackers.address } });
      // The relay said so before the buyer funded (T-221 review): the parties named it, so a notice, not a refusal.
      expect((four.offered.notices ?? []).join(' ')).toMatch(new RegExp(`fallback adjudicator ${fallback} will decline its fallback turn on these terms: .*${attackers.address}`));

      // Deal 4, continued: judgeBy has passed, and the demo fallback declined its turn.
      let notices: string[] = [];
      for (const end = Date.parse(four.terms.timing.judgeBy) + 30_000; Date.now() < end; await sleep(500)) {
        notices = ((await four.buyer.call('GET', `/v1/commitments/${four.id}`)) as J).notices ?? [];
        if (notices.some((n) => /fallback adjudicator declined/.test(n))) break;
      }
      expect(notices.join(' ')).toMatch(new RegExp(`fallback adjudicator declined this deal's fallback turn: .*does not trust ${attackers.address} as the appeal adjudicator`, 'i'));
      expect(notices.join(' ')).toMatch(/the default outcome applies at fallbackBy unless the parties settle by mutual agreement first/);
      expect(((await four.buyer.call('GET', `/v1/commitments/${four.id}`)) as J).escrowState).toBe('Delivered');
      lap('deal 4 declined');

      // Deal 3: the same outsider re-registers binding another registry (a later issuedAt replaces the record). The
      // demo appeal adjudicator judges escalations only under its own registry, and the relay says so before funding.
      outsider.rebind(liveRegistry(), LIVE_REGISTRY_URI);
      const again = await outsider.register(wholeSecond(Date.now()));
      expect(again.status).toBe(200);
      expect(again.body.registry.hash).toBe(liveRegistry().hash);
      const three = await outsideDeal(demo.urls, deployment, outsider, { work: CSV, timing });
      expect(((await three.buyer.call('GET', `/v1/commitments/${three.id}/terms`)) as J).adjudication.registryHash).toBe(liveRegistry().hash);
      // The relay noted it before the buyer funded (T-221 review).
      expect((three.offered.notices ?? []).join(' ')).toMatch(new RegExp(`appeal adjudicator ${appeal} will decline its appeal turn on these terms: .*registry`));
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: three.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(three.buyer, three.id, ['Released'], 60_000);
      expect(((await three.buyer.call('GET', `/v1/commitments/${three.id}`)) as J).appealState).toBe('none');
      lap('deal 3 noted');
      expect(errors).toEqual([]);
      console.log(`T-221 anvil end to end, seconds from the world's start: ${JSON.stringify(took)}`);
    } finally {
      await demo.close();
    }
  }, 600_000);
});
