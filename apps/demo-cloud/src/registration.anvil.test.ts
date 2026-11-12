// T-221 end to end (ADR-0030): an adjudicator no one at Crow runs registers through the API, bonds from its own key,
// and is named primary under the demo's fallback and appeal adjudicators. The contracts are the ones deployed to anvil,
// with the sim beacon reseeded to the world's own seed so the demo appeal adjudicator's beacon proofs verify.
//
// Its own file, with no test that needs a network or a secret, so CI's contracts job can run it in the anvil step that
// fails on any skip (T-221 review). Needs `anvil` on PATH and `forge build` output; elsewhere it skips and says why.
import { encodeFunctionData, getAddress, type Hex } from 'viem';
import { canonicalKeccak, holdbackDomain, verifyRegistration, wholeSecond, type Address } from '@holdback/core';
import { FAIL_MARKER, LIVE_REGISTRY_URI, liveRegistry, markedFake, markerFake } from '@holdback/adjudicator';
import { ensureBond, LiveChain, type DeploymentFile, type EvmSettlement } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deploymentOf, ENV, CSV, lc, Outsider, outsideDeal, PRICE, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
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

  it('registers, bonds, accepts and decides as primary; a wrong accept is overturned from its bond after a policy rotation; another registry is refused; the demo fallback declines under its appeal adjudicator', async () => {
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
      // The outside appeal adjudicator a party controls (D44): registered, never bonded (L-5: no clause pays from it).
      const attackers = new Outsider(world, demo.urls, 't-221/live-attackers-appeal', { trusted: [] });
      // The outsider judges blind to the scripted fail marker, so it accepts work the demo's panel rejects: a wrong accept.
      const outsider = new Outsider(world, demo.urls, 't-221/live-outsider', { trusted: [fallback, appeal], provider: markedFake(markerFake({}, 'NO-DELIVERY-CARRIES-THIS')) });
      const silent = new Outsider(world, demo.urls, 't-221/live-silent', { trusted: [fallback, attackers.address] });
      const issuedAt = wholeSecond(Date.now() - 120_000);

      // Registration through the API, before any bond: listed, signed, and plainly unbonded (Rafa: "be clear").
      const posted = await outsider.register(issuedAt);
      expect(posted.status).toBe(200);
      expect(posted.body.observed).toMatchObject({ bond: 'none', expired: false });
      for (const o of [silent, attackers]) expect((await o.register(issuedAt)).status).toBe(200);
      lap('registered');

      // The bond, from the outsider's own key (approve, then deposit); the relayer only pays its gas and mints its tUSDC.
      const BOND = 100_000_000n;
      for (const o of [outsider, silent]) await ensureBond(chain, o.account.privateKey, BOND, 100_000_000_000_000_000n);
      expect(await evm.bondOf(outsider.address)).toBe(BOND);
      // Both nodes serve the live bond once the per-block cache turns over (about 12 s): the read is HoldbackBonds'.
      let served: J = null;
      for (const end = Date.now() + 30_000; Date.now() < end; await sleep(500)) {
        const views = await Promise.all(demo.urls.map(async (u) => (await (await fetch(`${u}/v1/adjudicators/${outsider.address}`)).json()) as J));
        if (views.every((v) => v.observed?.bond === 'bonded')) {
          served = views[0];
          break;
        }
      }
      expect(served?.pool).toMatchObject({ junior: { amount: BOND.toString() }, reserved: { amount: '0' } });
      expect(await verifyRegistration(holdbackDomain(anvil.chainId, lc(deployment.rules) as Address), served)).toBe(true);
      lap('bonded');

      // Deal 1: the outsider accepts and decides by script; the deal is Released and the buyer opens its copy.
      const timing = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 120 };
      const one = await outsideDeal(demo.urls, deployment, outsider, { work: CSV, timing });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: one.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(one.buyer, one.id, ['Released'], 60_000);
      expect(await one.buyer.openDelivery(one.id)).toBe(CSV);
      const decided = evm.log().find((e) => e.commitmentId === one.id && e.type === 'judgment.decided')!;
      expect({ actor: lc(String(decided.actor)), via: decided.submittedVia }).toEqual({ actor: outsider.address, via: 'demo-op-1' });
      lap('deal 1 released');

      // Deal 4 (D44's second path): the silent outsider is primary, the demo fallback is named under an appeal
      // adjudicator it does not trust. Past judgeBy it neither triggers nor decides, and the state read says why.
      // judgeBy is deliverBy plus the judge window, so this deal's deliverBy is near too: about a minute from now.
      const four = await outsideDeal(demo.urls, deployment, silent, { work: CSV, timing: { ...timing, offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 5 }, adjudicators: { fallback, appeal: attackers.address } });
      // The relay said so before the buyer funded (T-221 review): the parties named it, so a notice, not a refusal.
      expect((four.offered.notices ?? []).join(' ')).toMatch(new RegExp(`fallback adjudicator ${fallback} will decline its fallback turn on these terms: .*${attackers.address}`));
      const fallbackBond = await evm.freeBond(fallback as Address);

      // Deal 2: the outsider accepts work that fails the rubric (the scripted panel's fail marker); the buyer appeals.
      const two = await outsideDeal(demo.urls, deployment, outsider, { work: `${FAIL_MARKER}: a summary that says nothing about the product.`, rubric: true, timing });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: two.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(two.buyer, two.id, ['Released'], 60_000);
      // attack.outside-primary-rotates-policy (T-221 review): the outsider registers another policy after its decision.
      // The terms still bind the old hash, and the demo appeal adjudicator reads the policy by that hash.
      const rotated = await outsider.register(wholeSecond(Date.now() - 60_000), { rationaleMaxChars: 599 });
      expect(rotated.status).toBe(200);
      expect(rotated.body.policyHash).not.toBe(two.terms.adjudication.policyHash);
      const outsiderBond = await evm.bondOf(outsider.address);
      const buyerBefore = await evm.tokenBalance(two.buyer.address, true);
      const { rulebook } = await two.buyer.club(d.demo.clubId);
      const appealBond = (BigInt(PRICE) * BigInt(rulebook.appealBondRateBps) + 9_999n) / 10_000n;
      await anvil.rpc('anvil_setBalance', [two.buyer.address, '0x56bc75e2d63100000']);
      const approved = await anvil.send({ key: two.buyerKey, to: deployment.token.address as Hex, data: encodeFunctionData({ abi: anvil.abis.token, functionName: 'approve', args: [deployment.bonds, appealBond] }) });
      expect(approved.status).toBe('success');
      const prepared = await two.buyer.call('POST', '/v1/prepare/appeal', { commitmentId: two.id, appellant: two.buyer.address });
      await two.buyer.signAndSubmit(prepared, { kind: 'appeal', terms: two.terms, me: two.buyer.address, appealBondRateBps: rulebook.appealBondRateBps });
      const overturned = await untilBoth(two.buyer, two.id, ['overturned', 'upheld'], 180_000, 'appealState');
      // The release paid the seller at the first decision and stands; the overturn pays the buyer the price from the
      // outsider's bond instead (D43, T-206 I-8): bond.slashed names the outsider.
      expect(overturned).toMatchObject({ appealState: 'overturned', escrowState: 'Released' });
      const slashed = evm.log().filter((e) => e.commitmentId === two.id && e.type === 'bond.slashed');
      expect(slashed.map((e) => e.payload)).toMatchObject([{ adjudicator: getAddress(outsider.address), junior: { amount: PRICE }, reason: 'overturn' }]);
      expect(outsiderBond - (await evm.bondOf(outsider.address))).toBe(BigInt(PRICE));
      // The buyer gets the price from the bond and its appeal bond back.
      expect((await evm.tokenBalance(two.buyer.address, true)) - buyerBefore).toBe(BigInt(PRICE));
      lap('deal 2 overturned');

      // Deal 4, continued: judgeBy has passed; the demo fallback declined its turn, and nothing reserved its bond.
      let notices: string[] = [];
      for (const end = Date.parse(four.terms.timing.judgeBy) + 30_000; Date.now() < end; await sleep(500)) {
        notices = ((await four.buyer.call('GET', `/v1/commitments/${four.id}`)) as J).notices ?? [];
        if (notices.some((n) => /fallback adjudicator declined/.test(n))) break;
      }
      expect(notices.join(' ')).toMatch(new RegExp(`fallback adjudicator declined this deal's fallback turn: .*does not trust ${attackers.address} as the appeal adjudicator`, 'i'));
      expect(notices.join(' ')).toMatch(/the default outcome applies at fallbackBy unless the parties settle by mutual agreement first/);
      expect(((await four.buyer.call('GET', `/v1/commitments/${four.id}`)) as J).escrowState).toBe('Delivered');
      expect(await evm.freeBond(fallback as Address)).toBe(fallbackBond);
      lap('deal 4 declined');

      // Deal 3: the same outsider re-registers binding another registry (a later issuedAt replaces the record). The
      // demo appeal adjudicator judges only under its own registry, so it refuses the appeal with registry_mismatch.
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
      await anvil.rpc('anvil_setBalance', [three.buyer.address, '0x56bc75e2d63100000']);
      expect((await anvil.send({ key: three.buyerKey, to: deployment.token.address as Hex, data: encodeFunctionData({ abi: anvil.abis.token, functionName: 'approve', args: [deployment.bonds, appealBond] }) })).status).toBe('success');
      const appealing = await three.buyer.call('POST', '/v1/prepare/appeal', { commitmentId: three.id, appellant: three.buyer.address });
      await three.buyer.signAndSubmit(appealing, { kind: 'appeal', terms: three.terms, me: three.buyer.address, appealBondRateBps: rulebook.appealBondRateBps });
      await untilBoth(three.buyer, three.id, ['open'], 60_000, 'appealState');
      const judge = world.adjudicators.appeal;
      const task = (await judge.settlement.tasks(judge.address)).find((t) => t.commitment.id === three.id);
      expect(task?.role).toBe('appeal');
      const refused = await judge.service.decideTask(task!);
      expect(refused.ok ? 'decided' : refused.error.type).toBe('registry_mismatch');
      // The world's own passes refuse it too: the appeal stays open, and the state read says why and what follows.
      let read: J = null;
      for (const end = Date.now() + 15_000; Date.now() < end; await sleep(500)) {
        read = await three.buyer.call('GET', `/v1/commitments/${three.id}`);
        if ((read.notices ?? []).some((n: string) => /appeal adjudicator .* cannot judge/.test(n))) break;
      }
      expect(read.appealState).toBe('open');
      expect((read.notices ?? []).join(' ')).toMatch(/The appeal adjudicator .* cannot judge this deal's appeal: this build does not carry registry .*What follows: the appeal expires at .*, and the first decision stands/);
      lap('deal 3 refused');
      expect(errors).toEqual([]);
      console.log(`T-221 anvil end to end, seconds from the world's start: ${JSON.stringify(took)}`);
    } finally {
      await demo.close();
    }
  }, 600_000);
});
