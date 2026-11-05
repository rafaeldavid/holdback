// The scripted-adjudicator group's tests (T-216): 3c and 7 through the driver, as e2e-round.test.ts runs its scenarios.
// On SimChain, always: the round's adjudicator cannot bond there, so its deals are priced at zero and every step runs
// with the money checks at zero. On the contracts deployed to anvil, when anvil and `forge build` output are present:
// 3c runs priced, and 7 waits for T-217 through the driver, since the anvil world's rulebook names the sim beacon. The
// anvil world here reseeds that beacon with the world's own seed (as apps/demo-cloud's registration.anvil.test.ts
// does), so the demo appeal adjudicator's proofs verify on chain, and a second test runs 7's deals past the T-217 gate
// to check BondSlashed and the rest on chain.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { toHex } from 'viem';
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roundKey, type Role } from './e2e-keys.ts';
import { Round, Run } from './e2e-run.ts';
import { overturnedBothWays } from './e2e-scenarios-scripted.ts';
import { ANVIL_SKIP, anvilReady, driver, ENV, expectNoSecrets, results, root, serve, simWorld, WORLD, type AnvilWorld, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The names of a scenario record's failed checks. */
const failed = (rec: J): string[] => rec.checks.filter((c: J) => !c.ok).map((c: J) => `${c.name}: ${c.detail}`);
/** A check of a scenario record by name. */
const check = (rec: J, name: string): J => rec.checks.find((c: J) => c.name === name);

/** anvil's default mnemonic, published with Foundry: its accounts guard no value (as e2e-world.ts). */
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

/**
 * e2e-world.ts's anvilWorld, with the sim beacon redeployed under the world's own seed before the world's first pass,
 * as apps/demo-cloud/src/registration.anvil.test.ts does: the demo's appeal adjudicator then proves its beacon value on
 * this chain, and its decisions land.
 */
async function reseededAnvilWorld(): Promise<AnvilWorld> {
  const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
  const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
  const live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
  const core = await import(pathToFileURL(fromDemo.resolve('@holdback/core')).href);
  const anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
  const d = anvil.deployment;
  const deployment = {
    chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
    token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
    escrow: d.escrow, erc3009Collector: d.erc3009Collector, permit2Collector: d.permit2Collector, multicall: d.multicall, rules: d.rules, bonds: d.bonds, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
  };
  const relayerKey = toHex(mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 1 }).getHdKey().privateKey!);
  const chain = new live.LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  const storage = new MemoryStorage();
  const world = await PublicWorld.open({ storage, env: { ...ENV, OPERATOR_FEE_GAS: '4700000' }, ...WORLD, live: { chain } });
  // Opening reads no chain: redeploy the beacon and the rules contract now, at the same addresses, under the world's seed.
  const { start } = (await storage.get<{ start: string }>('meta'))!;
  await anvil.fresh(core.canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }));
  const served = await serve(world, 200);
  for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
  return {
    ...served,
    rpcUrl: anvil.rpcUrl,
    deployment,
    setBalance: async (address, wei) => {
      await fetch(anvil.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [address, toHex(wei)] }) });
    },
    close: async () => {
      await served.close();
      await anvil.stop();
    },
  };
}

describe('e2e-scenarios-scripted.ts', () => {
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
      const out = mkdtempSync(join(tmpdir(), 'e2e-scripted-'));
      const r = await driver(['run', '3c', '7'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });      const { folder, byId } = results(out);
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

  describe.skipIf(!anvilReady)(`against the demo world on anvil, its sim beacon reseeded${ANVIL_SKIP}`, () => {
    let world: AnvilWorld;
    beforeAll(async () => {
      world = await reseededAnvilWorld();
    }, 180_000);
    afterAll(async () => {
      delete process.env['HOLDBACK_DEPLOYMENT'];
      await world?.close();
    });

    /** Gas for the round keys that send their own transactions: the parties' approvals, the primary's bond. */
    const fund = (seed: string) => Promise.all((['buyer', 'seller', 'adjudicator-1'] as Role[]).map((role) => world.setBalance(privateKeyToAccount(roundKey(seed, role)).address, 10n ** 18n)));

    it('runs 3c priced, with the appeal bond back and the bond freed on chain, and holds 7 for T-217', async () => {
      const seed = generatePrivateKey();
      await fund(seed);
      const out = mkdtempSync(join(tmpdir(), 'e2e-scripted-anvil-'));
      const r = await driver(['run', '3c', '7'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: world.urls.join(','), E2E_OUT: out, HOLDBACK_DEPLOYMENT: JSON.stringify(world.deployment), SEPOLIA_RPC_URL: world.rpcUrl });
      const { folder, byId } = results(out);      expect(r.out).toMatch(/^results: 3c (pass|fail), 7 waits$/m);
      // anvil 1.0.0's eth_estimateGas sometimes refuses expireAppeal (e2e-round.test.ts); the round then closes the
      // window directly, and every other check must hold.
      const c = byId['3c'];
      expect(failed(c).filter((f) => !f.startsWith('appeal-expiry relayed through the API:')), r.out).toEqual([]);
      for (const name of ['the seller gets its appeal bond back on chain', "the primary's bond is freed after the appeal window", 'the appeal closes as expired on chain', "dealOf's appeal reads expired"]) expect(check(c, name)?.ok, name).toBe(true);
      expect(c.deals[0].transactions.map((t: J) => t.calls.map((x: J) => x.fn).join('+'))).toEqual(expect.arrayContaining(['decide', 'fileAppeal']));
      expect(byId['7']).toMatchObject({ status: 'waits', waitsFor: ['T-217'] });
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);

    it("runs 7's deals on chain past the T-217 gate: BondSlashed pays each appellant the price, its appeal bond comes back", async () => {
      process.env['HOLDBACK_DEPLOYMENT'] = JSON.stringify(world.deployment);
      const seed = generatePrivateKey();
      await fund(seed);
      const lines: string[] = [];
      const round = await Round.open({ operators: [...world.urls], seed, rpcUrl: world.rpcUrl, log: (l) => lines.push(l) });
      const r = new Run(round, '7', 'Appeal overturned both ways (anvil, past the T-217 gate)');
      await overturnedBothWays(r);      expect(r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`), lines.join('\n')).toEqual([]);
      expect(r.deals.map((d) => d.chain?.appeal)).toEqual(['overturned', 'overturned']);
      for (const name of ['buyer: BondSlashed pays the buyer the price from the primary\'s bond', 'seller: BondSlashed pays the seller the price from the primary\'s bond', 'buyer: the appeal decision carries a sim beacon proof from the round after the filing', 'seller: the appeal decision carries a sim beacon proof from the round after the filing']) {
        expect(r.checks.find((c) => c.name === name)?.ok, name).toBe(true);
      }
      for (const k of [roundKey(seed, 'adjudicator-1'), seed]) expect(lines.join('\n')).not.toContain(k.slice(2));
    }, 600_000);
  });
});
