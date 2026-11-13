// SimChain only: the party-appeal group's tests (T-216, T-374), 3c and 7 through the driver, as e2e-round.test.ts runs
// its scenarios; e2e-round.test.ts runs 6. The phase-one contracts take no party appeal (ADR-0031 §8). On SimChain,
// always: the round's adjudicator cannot bond there, so 3c's and 7's deals are priced at zero and every step runs with
// the money checks at zero. On the contracts deployed to anvil, when anvil and `forge build` output are present, the
// driver records both as waiting on ADR-0031 and sends nothing for them.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_SKIP, anvilReady, anvilWorld, driver, expectNoSecrets, results, simWorld, type AnvilWorld, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The names of a scenario record's failed checks. */
const failed = (rec: J): string[] => rec.checks.filter((c: J) => !c.ok).map((c: J) => `${c.name}: ${c.detail}`);
/** A check of a scenario record by name. */
const check = (rec: J, name: string): J => rec.checks.find((c: J) => c.name === name);

describe('e2e-scenarios-appeal.ts', () => {
  it('lists 3c and 7 with what they wait for, and nothing left to build', async () => {
    const r = await driver(['list'], {});
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^ {2}3c +Timeouts: appeal expiry when the appeal adjudicator is silent \(API\); waits for T-221$/m);
    expect(r.out).toMatch(/^ {2}7 +Appeal overturned both ways, paid from the first decider's bond \(API\); waits for T-217, T-221$/m);
    for (const id of ['3c', '7']) expect(r.out).not.toMatch(new RegExp(`^ {2}${id} .*\\n {6}needs:`, 'm'));
  });

  describe('against the demo world on SimChain', () => {
    let demo: Served;
    beforeAll(async () => {
      demo = await simWorld();
    });
    afterAll(() => demo.close());

    it('runs 3c and 7, priced at zero: the silent appeal expires and the refund stands; both wrong decisions are overturned', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-appeal-'));
      const r = await driver(['run', '3c', '7'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });
      const { folder, byId } = results(out);
      expect(r.out).toMatch(/^results: 3c pass, 7 pass$/m);
      expect(r.code, r.out).toBe(0);
      // 3c: the round's primary rejected, the seller appealed, the round's appeal adjudicator stayed silent, and the
      // round's appeal-expiry through the API left the refund standing.
      const c = byId['3c'];
      expect(failed(c)).toEqual([]);
      expect(c.deals).toHaveLength(1);
      expect(c.deals[0].operators.views.map((v: J) => `${v.escrowState} ${v.appealState}`)).toEqual(['Refunded expired', 'Refunded expired']);
      expect(check(c, 'appeal-expiry relayed through the API')?.ok).toBe(true);
      expect(check(c, 'the appellant gets its appeal bond back')?.ok).toBe(true);
      // 7: an accept of failing work and a reject of passing work, each overturned by the demo appeal adjudicator.
      const s = byId['7'];
      expect(failed(s)).toEqual([]);
      expect(s.deals.map((d: J) => d.operators.views.map((v: J) => `${v.escrowState} ${v.appealState}`))).toEqual([
        ['Released overturned', 'Released overturned'],
        ['Refunded overturned', 'Refunded overturned'],
      ]);
      expect(check(s, 'seller: no key reaches the refunded buyer')?.ok).toBe(true);
      expectNoSecrets(seed, r.out, folder);
    }, 300_000);
  });

  describe.skipIf(!anvilReady)(`against the demo world on anvil${ANVIL_SKIP}`, () => {
    let world: AnvilWorld;
    beforeAll(async () => {
      world = await anvilWorld();
    }, 180_000);
    afterAll(async () => {
      await world?.close();
    });

    it('holds 3c and 7 on a chain: not in phase one (ADR-0031), with no deal opened', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-appeal-anvil-'));
      const r = await driver(['run', '3c', '7'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: world.urls.join(','), E2E_OUT: out, HOLDBACK_DEPLOYMENT: JSON.stringify(world.deployment), SEPOLIA_RPC_URL: world.rpcUrl });
      const { folder, byId } = results(out);
      expect(r.out).toMatch(/^results: 3c waits, 7 waits$/m);
      for (const id of ['3c', '7']) {
        expect(byId[id], r.out).toMatchObject({ status: 'waits', waitsFor: ['ADR-0031'] });
        expect(byId[id].deals).toEqual([]);
      }
      expect(r.out).toMatch(/not in phase one \(ADR-0031\)/);
      expectNoSecrets(seed, r.out, folder);
    }, 300_000);
  });
});
