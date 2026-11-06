// The round's driver runs as Rafa runs it: a separate Node process that reaches the operators over HTTP only and
// derives its keys from E2E_SEPOLIA_SEED. The operators here are the public demo's own world (apps/demo-cloud, the
// code the live nodes run) served in this process on two origins: on SimChain always, and on the contracts deployed
// to anvil, as Sepolia's stand-in, when anvil and `forge build` output are present (as apps/demo-cloud/src/live.test.ts).
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { roundKey } from './e2e-keys.ts';
import { ANVIL_SKIP, anvilReady, anvilWorld, driver, expectNoSecrets, results, simWorld, type AnvilWorld, type Served } from './e2e-world.ts';
import { pinOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('e2e-round.ts', () => {
  it('lists every scenario with what it waits for', async () => {
    const r = await driver(['list'], {});
    expect(r.code, r.out).toBe(0);
    for (const id of ['1', '2', '3a', '3b', '3c', '3d', '4', '5a', '5b', '6', '7', '8', '9', '10a', '10b', '11']) expect(r.out).toMatch(new RegExp(`^  ${id} +\\S`, 'm'));
    expect(r.out).toMatch(/^ {2}4 +Fallback when the primary is silent \(API\); waits for T-217, T-221$/m);
  });

  it('refuses to run without the seed, before any network call', async () => {
    const r = await driver(['run', '1'], { HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/E2E_SEPOLIA_SEED is not set/);
  });

  describe('against operators pinned to Sepolia and a stand-in RPC', () => {
    // Two origins serving the discovery document for Sepolia's pinned deployment, and an RPC that logs what it is asked.
    let operators: Server;
    let rpc: Server;
    let urls: string;
    let rpcPort: number;
    const asked: string[] = [];
    const posted: string[] = [];
    let answer: (method: string) => { status: number; body: unknown } = () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x1' } });
    beforeAll(async () => {
      const pin = pinOf(SEPOLIA!);
      const discovery = { domain: pin.domain, demo: { clubId: 'demo-club', token: { id: pin.token.id }, minWindowSec: 60, adjudicators: ['primary', 'fallback', 'appeal'].map((role, i) => ({ role, address: `0x${String(i + 1).repeat(40)}` })) }, fees: { operator: null }, settlementTime: new Date().toISOString() };
      operators = createServer((req, res) => {
        if (req.method !== 'GET') posted.push(`${req.method} ${req.url}`);
        res.writeHead(req.url === '/.well-known/holdback.json' ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.url === '/.well-known/holdback.json' ? discovery : { type: 'not_found', detail: 'stand-in' }));
      });
      rpc = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const { method } = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { method: string };
        asked.push(method);
        const a = answer(method);
        res.writeHead(a.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(a.body));
      });
      await Promise.all([operators, rpc].map((s) => new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))));
      const port = (operators.address() as AddressInfo).port;
      urls = `http://127.0.0.1:${port},http://localhost:${port}`;
      rpcPort = (rpc.address() as AddressInfo).port;
    });
    afterAll(async () => {
      await Promise.all([operators, rpc].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    });

    it('refuses an RPC on a mainnet with exit 3, after asking it only its chain ID and before any write', async () => {
      asked.length = 0;
      answer = () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x1' } });
      const r = await driver(['run', '1'], { E2E_SEPOLIA_SEED: generatePrivateKey(), HOLDBACK_OPERATORS: urls, SEPOLIA_RPC_URL: `http://127.0.0.1:${rpcPort}`, E2E_OUT: mkdtempSync(join(tmpdir(), 'e2e-round-refuse-')) });
      expect(r.code, r.out).toBe(3);
      expect(r.out).toMatch(/^refused: refusing: chain 1 is a mainnet \(hard rule: no real money\)$/m);
      expect(asked).toEqual(['eth_chainId']);
      expect(posted).toEqual([]);
    });

    it('never prints a keyed RPC URL when the RPC fails', async () => {
      answer = () => ({ status: 500, body: { error: 'down' } });
      const planted = 'PLANTED_PROVIDER_KEY_123';
      const out = mkdtempSync(join(tmpdir(), 'e2e-round-url-'));
      const r = await driver(['run', '1'], { E2E_SEPOLIA_SEED: generatePrivateKey(), HOLDBACK_OPERATORS: urls, SEPOLIA_RPC_URL: `http://127.0.0.1:${rpcPort}/v2/${planted}`, E2E_OUT: out });
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/^stopped: /m);
      expect(r.out).not.toContain(planted);
      for (const d of readdirSync(out)) for (const f of readdirSync(join(out, d))) expect(readFileSync(join(out, d, f), 'utf8')).not.toContain(planted);
    });
  });

  describe('against the demo world on SimChain', () => {
    let demo: Served;
    beforeAll(async () => {
      demo = await simWorld();
    });
    afterAll(() => demo.close());

    it('runs scenarios 1, 2, 3a, 3d, 6 and 10a, fails 1 only on its scripted panel, and prints no key', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-round-'));
      // 3b is built in the silent group; e2e-scenarios-silent.test.ts runs it.
      const r = await driver(['run', '1', '2', '3a', '3d', '6', '10a'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });
      const { folder, byId } = results(out);
      expect(r.out).toMatch(/^results: 1 fail, 2 pass, 3a pass, 3d pass, 6 pass, 10a pass$/m);
      expect(r.code, r.out).toBe(1);
      // Scenario 1 asks for a live panel; this world has no model keys, so its judges are scripted and the run says so.
      expect(byId['1'].checks.filter((c: J) => !c.ok).map((c: J) => c.name)).toEqual(['a live panel judged']);
      // Released, the buyer opened the work, both homepage runs passed, both operators agree.
      expect(byId['1'].deals[0].buyerOpened).toBe(true);
      expect(byId['1'].checks.map((c: J) => c.name)).toEqual(expect.arrayContaining(['the homepage command passes relayed by ' + new URL(demo.urls[0]).origin, 'the homepage command passes relayed by ' + new URL(demo.urls[1]).origin]));
      // Scenario 2 relays through the second node; no key reaches the buyer.
      expect(byId['2'].deals[0].relay).toBe(new URL(demo.urls[1]).origin);
      expect(byId['2'].checks.find((c: J) => c.name === 'no key reaches the buyer').ok).toBe(true);
      expect(readFileSync(join(folder, 'summary.md'), 'utf8')).toMatch(/^\| 2\. Refund on reject \(API\) \| pass \| \d+ of \d+ \|/m);
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

    it('runs scenarios 1, 2, 3a (API and direct), 3d and 10a with every transaction read back from the chain, holds 6 for T-217, then re-reads their blocks', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-round-anvil-'));
      const env = { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out, HOLDBACK_DEPLOYMENT: JSON.stringify(demo.deployment), SEPOLIA_RPC_URL: demo.rpcUrl };
      // The round's buyer and seller pay their own gas for the direct calls: anvil sets their balances.
      for (const role of ['buyer', 'seller'] as const) await demo.setBalance(privateKeyToAccount(roundKey(seed, role)).address, 10n ** 18n);
      const r = await driver(['run', '1', '2', '3a', '3d', '6', '10a', '--no-homepage'], env);
      expect(r.out).toMatch(/^results: 1 fail, 2 (pass|fail), 3a pass, 3d pass, 6 waits, 10a pass$/m);
      const { folder, byId } = results(out);
      // anvil 1.0.0's eth_estimateGas sometimes refuses expireAppeal ("gas floor exceeds the gas limit"), so the
      // operator's relay answers 500 and the driver closes the window directly (docs/backlog.md); on Sepolia the run shows it.
      const known = ['a live panel judged', 'appeal-expiry relayed through the API'];
      for (const id of ['1', '2']) for (const c of byId[id].checks.filter((x: J) => !x.ok)) expect(known, `${id}: ${c.name}: ${c.detail}`).toContain(c.name);
      expect(byId['6']).toMatchObject({ status: 'waits', waitsFor: ['T-217'] });
      const steps = (id: string, deal = 0) => byId[id].deals[deal].transactions.map((t: J) => t.steps.join('+'));
      expect(steps('1')).toEqual(expect.arrayContaining([expect.stringContaining('hold.funded'), expect.stringContaining('delivery.submitted'), expect.stringContaining('judgment.decided')]));
      for (const t of byId['1'].deals[0].transactions) expect(Number(t.gasUsed)).toBeGreaterThan(21_000);
      expect(byId['2'].checks.find((c: J) => c.name === 'the decision names the posted delivery (D44)').ok).toBe(true);
      expect(byId['3a'].deals[1].transactions.find((t: J) => t.sentBy === 'round')?.calls[0]?.fn).toBe('reclaim');
      const fin = await driver(['finality', folder], env);
      expect(fin.out).toMatch(/transactions re-read, \d+ in the same block, 0 changed/);
      expect(fin.code, fin.out).toBe(0);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);
  });
});
