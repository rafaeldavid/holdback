// The escalation group's tests (T-216): 5a and 5b, run through the driver as e2e-round.test.ts runs its scenarios,
// against the demo's own world on SimChain and on the contracts deployed to anvil (e2e-world.ts). On anvil the world's
// rulebook names the sim beacon, so the driver records 5b as waiting for T-217's drand proofs, as it does scenario 6.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ESCALATION } from './e2e-scenarios-escalation.ts';
import { ANVIL_SKIP, anvilReady, anvilWorld, driver, expectNoSecrets, results, simWorld, type AnvilWorld, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const failed = (rec: J) => rec.checks.filter((c: J) => !c.ok).map((c: J) => `${c.name}: ${c.detail}`);
const named = (rec: J, name: string) => rec.checks.find((c: J) => c.name === name);

describe('e2e-scenarios-escalation.ts', () => {
  it('lists 5a and 5b as built: 5a waits for nothing, 5b only for T-217', async () => {
    expect(ESCALATION.map((s) => [s.id, s.waitsFor, s.needs])).toEqual([['5a', [], undefined], ['5b', ['T-217'], undefined]]);
    const r = await driver(['list'], {});
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^ {2}5a +Escalation, then the default outcome \(API\)$/m);
    expect(r.out).toMatch(/^ {2}5b +Escalation decided by the appeal adjudicator \(API\); waits for T-217$/m);
    expect(r.out).not.toMatch(/^ {2}5[ab] .*\n {6}needs:/m);
  });

  describe('against the demo world on SimChain', () => {
    let demo: Served;
    beforeAll(async () => {
      demo = await simWorld();
    });
    afterAll(() => demo.close());

    it('5a escalates on the check budget and defaults to a refund; 5b escalates on the screen and the appeal panel decides', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-escalation-'));
      const r = await driver(['run', '5a', '5b'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });
      const { folder, byId } = results(out);
      expect(r.out).toMatch(/^results: 5a pass, 5b pass$/m);
      expect(r.code, r.out).toBe(0);
      expect(failed(byId['5a'])).toEqual([]);
      expect(failed(byId['5b'])).toEqual([]);
      // 5a: the check ran out on both instances, nobody signed after the escalation, and the default refunded.
      for (const name of ['the primary escalates with no panel: the check ran out of its work budget', 'the appeal adjudicator judges again and escalates for the same reason', 'the appeal adjudicator signs no decision after the escalation', 'the deal ends Refunded by the default outcome']) {
        expect(named(byId['5a'], name)?.ok, name).toBe(true);
      }
      // SimChain pays the seller the rulebook's compensation from the appeal adjudicator's bond (10 % of 25 tUSD).
      expect(named(byId['5a'], 'the seller gets the default compensation')?.detail).toMatch(/^seller 2\.5 tUSD/);
      // 5b: the screen flagged soft hyphens, the five-seat panel accepted unanimously, the later appeal was refused.
      expect(named(byId['5b'], 'the screen flags the delivery')?.detail).toMatch(/zero_width/);
      expect(named(byId['5b'], "the appeal adjudicator's five-seat panel decides (D27a/b)")?.detail).toMatch(/^accept by 5 seats/);
      expect(named(byId['5b'], 'a later appeal is refused (invalid_state)')?.detail).toMatch(/invalid_state/);
      expect(byId['5b'].deals[0].buyerOpened).toBe(true);
      expectNoSecrets(seed, r.out, folder);
    }, 300_000);
  });

  // anvil for Sepolia (e2e-world.ts): the T-202 contracts, the world's relayer lanes, a block a second.
  describe.skipIf(!anvilReady)(`against the demo world on anvil${ANVIL_SKIP}`, () => {
    let demo: AnvilWorld;
    beforeAll(async () => {
      demo = await anvilWorld();
    }, 180_000);
    afterAll(async () => {
      await demo?.close();
    });

    it('runs 5a with every transaction read back from the chain, and holds 5b for T-217', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-escalation-anvil-'));
      const r = await driver(['run', '5a', '5b', '--no-homepage'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out, HOLDBACK_DEPLOYMENT: JSON.stringify(demo.deployment), SEPOLIA_RPC_URL: demo.rpcUrl });
      const { folder, byId } = results(out);
      expect(r.out).toMatch(/^results: 5a pass, 5b waits$/m);
      expect(r.code, r.out).toBe(0);
      expect(failed(byId['5a'])).toEqual([]);
      expect(byId['5b']).toMatchObject({ status: 'waits', waitsFor: ['T-217'] });
      const calls = byId['5a'].deals[0].transactions.flatMap((t: J) => t.calls.map((c: J) => c.fn));
      expect(calls).toEqual(expect.arrayContaining(['decide', 'triggerDefault']));
      for (const name of ["the primary's decision on chain is an escalation", 'no Decided log names the appeal adjudicator', 'triggerDefault records the default from Escalated', 'the price and the adjudication fee return to the buyer on chain']) {
        expect(named(byId['5a'], name)?.ok, name).toBe(true);
      }
      expect(named(byId['5a'], 'the seller gets the default compensation')?.detail).toMatch(/^seller 0 tUSDC/);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);
  });
});
