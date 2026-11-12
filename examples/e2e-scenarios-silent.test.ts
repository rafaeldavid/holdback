// The silent-adjudicator group's tests (T-216): 3b, 4, 9 and 10b, run through the driver as a separate process, as
// e2e-round.test.ts runs its scenarios. The round's own adjudicator is the silent primary (and 3b's fallback): it
// accepts and never decides. On SimChain it cannot bond at run time, so its deals are priced at 0 there and the money
// checks run on anvil, where it bonds from its own key.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roundKey } from './e2e-keys.ts';
import { ANVIL_SKIP, anvilReady, anvilWorld, driver, expectNoSecrets, results, simWorld, type AnvilWorld, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const failed = (rec: J) => rec.checks.filter((c: J) => !c.ok).map((c: J) => `${c.name}: ${c.detail}`);
const names = (rec: J) => rec.checks.map((c: J) => c.name);

describe('e2e-scenarios-silent.ts', () => {
  it('lists 3b, 4, 9 and 10b as built: no "needs" line, the same prerequisites', async () => {
    const r = await driver(['list'], {});
    expect(r.code, r.out).toBe(0);
    for (const [id, waits] of [['3b', 'T-221'], ['4', 'T-217, T-221'], ['9', 'T-221'], ['10b', 'T-221']] as const) {
      const line = r.out.split('\n').findIndex((l) => new RegExp(`^  ${id} +\\S`).test(l));
      expect(line, id).toBeGreaterThanOrEqual(0);
      expect(r.out.split('\n')[line], id).toMatch(new RegExp(`; waits for ${waits}$`));
      // A built scenario has no "needs" line under it.
      expect(r.out.split('\n')[line + 1] ?? '', id).not.toMatch(/^ +needs: /);
    }
  });

  describe('against the demo world on SimChain', () => {
    let demo: Served;
    beforeAll(async () => {
      demo = await simWorld();
    });
    afterAll(() => demo.close());

    it("runs 3b, 4 and 9 with the round's silent primary on deals priced at 0, stops 10b before a deal, and prints no key", async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-silent-'));
      const r = await driver(['run', '3b', '4', '9', '10b'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });
      const { folder, byId } = results(out);
      expect(r.out, r.out).toMatch(/^results: 3b pass, 4 pass, 9 pass, 10b error$/m);
      expect(r.code, r.out).toBe(1);
      for (const id of ['3b', '4', '9']) {
        expect(failed(byId[id]), id).toEqual([]);
        // The round's own adjudicator cannot bond on SimChain: the deal is priced at 0, and the record says so.
        expect(byId[id].notes.join('\n'), id).toMatch(/priced at 0/);
      }
      // A price of 0 leaves a mutual settlement no payout to carry, so 10b runs on a chain only, and says so first.
      expect(byId['10b']).toMatchObject({ status: 'error', deals: [] });
      expect(byId['10b'].error).toMatch(/10b runs on a chain/);
      // 3b: the driver sends the takeover (no demo fallback is named), then the default outcome refunds.
      expect(names(byId['3b'])).toEqual(expect.arrayContaining(['the fallback trigger moves the deal to FallbackJudging', 'the deal ends Refunded by the default outcome', 'no key reaches the buyer']));
      // 4: the demo fallback decides over the silent primary, and the work settles.
      expect(names(byId['4'])).toEqual(expect.arrayContaining(['the demo fallback adjudicator decides', 'the deal ends Released, as the work passes', 'the buyer opens the work with its released key']));
      // 9: the early accept releases, and the primary's late decision is refused.
      expect(names(byId['9'])).toEqual(expect.arrayContaining(['the deal ends Released by the early accept', 'the buyer opens the work with its released key', "the primary's later decision is refused"]));
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

    it('runs 3b, 9 and 10b with the money read back from the chain, holds 4 for T-217, then re-reads their blocks', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-silent-anvil-'));
      const env = { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out, HOLDBACK_DEPLOYMENT: JSON.stringify(demo.deployment), SEPOLIA_RPC_URL: demo.rpcUrl };
      // The round's adjudicators bond from their own keys; the parties pay their own gas: anvil sets their balances.
      for (const role of ['buyer', 'seller', 'adjudicator-1', 'adjudicator-2'] as const) await demo.setBalance(privateKeyToAccount(roundKey(seed, role)).address, 10n ** 18n);
      const r = await driver(['run', '3b', '4', '9', '10b', '--no-homepage'], env);
      const { folder, byId } = results(out);
      expect(r.out, r.out).toMatch(/^results: 3b (pass|fail), 4 waits, 9 pass, 10b pass$/m);
      for (const id of ['9', '10b']) expect(failed(byId[id]), id).toEqual([]);
      // anvil 1.0.0 refuses to estimate a trigger whose EIP-7623 calldata floor exceeds its execution gas, so the
      // operator's relay can answer 500 and the driver sends the call directly (backlog); Sepolia's nodes estimate it.
      const known = /^(fallback|default) relayed through the API: /;
      for (const f of failed(byId['3b'])) expect(f).toMatch(known);
      // The anvil world's fallback decides on a chain only with drand proofs (T-217).
      expect(byId['4']).toMatchObject({ status: 'waits', waitsFor: ['T-217'] });
      const calls = (id: string) => byId[id].deals[0].transactions.flatMap((t: J) => t.calls.map((c: J) => c.fn));
      expect(calls('3b')).toEqual(expect.arrayContaining(['triggerFallback', 'triggerDefault']));
      // triggerDefault does default and apply_default in one transaction.
      const dflt = byId['3b'].deals[0].transactions.find((t: J) => t.calls.some((c: J) => c.fn === 'triggerDefault'));
      expect(dflt.steps).toEqual(expect.arrayContaining(['default.triggered', 'settlement.refunded']));
      expect(calls('9')).toContain('earlyAccept');
      // 10b: settled by agreement after delivery, the key released to the buyer.
      expect(calls('10b')).toContain('mutualSettle');
      expect(names(byId['10b'])).toEqual(expect.arrayContaining(['the deal ends Settled', 'the buyer opens the work with its released key', 'the key reaches the buyer on chain']));
      for (const id of ['3b', '9', '10b']) expect(byId[id].deals[0].transactions.length, id).toBeGreaterThan(2);
      const fin = await driver(['finality', folder], env);
      expect(fin.out).toMatch(/transactions re-read, \d+ in the same block, 0 changed/);
      expect(fin.code, fin.out).toBe(0);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);
  });
});
