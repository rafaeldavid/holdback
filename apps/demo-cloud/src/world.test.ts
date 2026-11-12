// T-026, the public demo world: what the two Workers and the Durable Object serve, run in Node over HTTP.
// Two origins (127.0.0.1 and localhost on one port) stand in for the two operator Workers; a timer stands in
// for the Durable Object's alarm. The deal is the examples' agent (examples/agent.ts) with keys it made itself.
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { LIVE_REGISTRY_URI, liveRegistry, markerFake, placeholderRegistry } from '@holdback/adjudicator';
import { canonicalKeccak, DRAND_QUICKNET_CHAIN_HASH, holdbackDomain, verifyRegistration, type Address, type AdjudicatorRegistration, type RegisteredAdjudicator } from '@holdback/core';
import { LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { encodePublicKey, generateEncryptionKeyPair } from '@holdback/core/crypto';
import { MemoryFeedbackStore, signRegistration, testAccount, type StoredRegistration, type TestAccount } from '@holdback/operator';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { checkExchange } from '../../../tests/contract/openapi-check.ts';
import { JudgeBudget } from './judges.js';
import { BondReads, DEMO_FAUCET_MAX_GRANT, DEMO_MAX_CIPHERTEXT_BYTES, TimeoutBudgetRows, buildCommit, relayerFacts } from './world.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Running {
  world: PublicWorld;
  urls: [string, string];
  close(): Promise<void>;
}
const running: Running[] = [];
afterEach(async () => void (await Promise.all(running.splice(0).map((r) => r.close()))));

/**
 * Serves a world as two nodes: http://127.0.0.1:<port> is node 0, http://localhost:<port> node 1. Adjudicator passes run
 * every 100 ms, or only when the test calls `world.work()` with `passes: false`.
 */
async function serve(options: Partial<PublicWorldOptions> = {}, storage = new MemoryStorage(), client?: string, { passes = true } = {}): Promise<Running> {
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
  const { urls, close } = await serveTwoOrigins(world, { tickMs: passes ? 100 : undefined, client, keepContentLength: true });
  const r: Running = { world, urls, close };
  running.push(r);
  return r;
}

const freshAgent = (urls: string[]) => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
const post = (url: string, body: unknown, key?: string) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });

describe('public mode', () => {
  it('funds and admits a fresh address once per window, per address and per client', async () => {
    const { urls } = await serve({ faucetPerClient: 2 });
    const a = freshAgent(urls);
    const first = await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'k-1');
    expect(first.status).toBe(200);
    const granted = (await first.json()) as J;
    expect(granted).toMatchObject({ address: a.address, clubId: 'demo-club', granted: { token: 'tUSD', amount: '1000000000' }, balance: { token: 'tUSD', amount: '1000000000' } });
    expect(granted.mandate).toMatchObject({ agent: a.address, clubId: 'demo-club', scope: { roles: ['buyer', 'seller'] } });
    // The same call again replays; another call for the address in the window is refused.
    expect(await (await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'k-1')).json()).toEqual(granted);
    const again = await post(`${urls[1]}/v1/faucet`, { address: a.address }, 'k-2');
    expect([again.status, ((await again.json()) as J).type]).toEqual([429, 'rate_limited']);
    expect(again.headers.get('retry-after')).toMatch(/^\d+$/);
    // The address is admitted: every node serves its mandate, and its balance.
    for (const u of urls) {
      expect(((await (await fetch(`${u}/v1/agents/${a.address}`)).json()) as J).mandates[0].agent).toBe(a.address);
      expect(((await (await fetch(`${u}/v1/balances/${a.address}`)).json()) as J).amount).toBe('1000000000');
    }
    // Per client: a second address is funded, a third is not.
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'k-3')).status).toBe(200);
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'k-4')).status).toBe(429);
    // Malformed input and a missing Idempotency-Key are refused.
    expect((await post(`${urls[0]}/v1/faucet`, { address: 'nope' }, 'k-5')).status).toBe(400);
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address })).status).toBe(400);
  });

  it('grants once when two requests for one address arrive together', async () => {
    const { urls } = await serve();
    const a = freshAgent(urls);
    const both = await Promise.all([post(`${urls[0]}/v1/faucet`, { address: a.address }, 'k-race-1'), post(`${urls[1]}/v1/faucet`, { address: a.address }, 'k-race-2')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(((await (await fetch(`${urls[0]}/v1/balances/${a.address}`)).json()) as J).amount).toBe('1000000000');
  });

  it('grants the amount a request names, up to the cap discovery states: a fresh buyer funds a 2,000 tUSD deal, fees included (T-314)', async () => {
    // The live demo's operator fee is 4.71 tUSDC a deal; with the 1.00 tUSD adjudication fee a 2,000 tUSD deal costs 2,005.71 tUSD.
    const { urls } = await serve({ env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '4710000' } });
    const d = await discovery(urls);
    const cap = DEMO_FAUCET_MAX_GRANT.toString();
    expect(d.demo.faucet).toEqual({ path: '/v1/faucet', grant: { token: 'tUSD', amount: '1000000000' }, maxGrant: { token: 'tUSD', amount: cap }, perAddressEverySec: 3600, perClientPerWindow: 10 });
    expect(d.notes.join('\n')).toMatch(/"amount"/);
    const [buyer, seller] = [freshAgent(urls), freshAgent(urls)];
    // Above the cap: refused by name, nothing granted, and the address keeps its turn in the window.
    const over = await post(`${urls[0]}/v1/faucet`, { address: buyer.address, amount: (DEMO_FAUCET_MAX_GRANT + 1n).toString() }, 'k-over');
    const refusal = (await over.json()) as J;
    expect([over.status, refusal.type, refusal.field]).toEqual([400, 'invalid_terms', 'amount']);
    expect(refusal.detail).toContain(cap);
    expect(((await (await fetch(`${urls[0]}/v1/balances/${buyer.address}`)).json()) as J).amount).toBe('0');
    const total = 2_005_710_000n;
    const granted = await buyer.call('POST', '/v1/faucet', { address: buyer.address, amount: total.toString() });
    expect(granted).toMatchObject({ granted: { token: 'tUSD', amount: total.toString() }, balance: { token: 'tUSD', amount: total.toString() } });
    // The window holds whatever the amount: a second ask waits.
    const again = await post(`${urls[1]}/v1/faucet`, { address: buyer.address, amount: '1' }, 'k-again');
    expect([again.status, ((await again.json()) as J).type]).toEqual([429, 'rate_limited']);
    // The cap itself is granted.
    expect((await seller.call('POST', '/v1/faucet', { address: seller.address, amount: cap })).balance.amount).toBe(cap);
    const offer = await seller.offer(offerRequest(d, seller, buyer, { price: { token: 'tUSD', amount: '2000000000' } }));
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    expect((await buyer.agreeAndFund(offer.terms, total)).escrowState).toBe('Held');
    expect((await buyer.call('GET', `/v1/balances/${buyer.address}`)).amount).toBe('0');
  });

  it('states the faucet cap in the agent docs as the code has it (T-314)', () => {
    const cap = `${(DEMO_FAUCET_MAX_GRANT / 1_000_000n).toLocaleString('en-US')} tUSDC`;
    expect(cap).toBe('1,000,000 tUSDC');
    for (const file of ['site/llms.txt', 'docs/api.md']) {
      const text = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
      const faucet = text.split('\n').filter((line) => /faucet/i.test(line) && line.includes('maxGrant'));
      expect(faucet.some((line) => line.includes(cap)), `${file} states the faucet cap of ${cap} beside maxGrant`).toBe(true);
    }
  });

  it('renews the mandate on every grant: past its 30 days or close to them, the address gets a fresh one in place of the old', async () => {
    let t = Math.ceil(Date.now() / 1000) * 1000;
    const storage = new MemoryStorage();
    const { world, urls } = await serve({ now: () => t }, storage, undefined, { passes: false });
    const d = await discovery(urls);
    const [seller, buyer] = [freshAgent(urls), freshAgent(urls)];
    const grant = async (a: Agent): Promise<J> => (await a.call('POST', '/v1/faucet', { address: a.address })).mandate;
    const first = await grant(seller);
    await grant(buyer);
    // At its expiry the address cannot offer; the next grant admits a fresh mandate, and the address offers again.
    t = Date.parse(first.scope.expiresAt);
    await expect(seller.offer(offerRequest(d, seller, buyer))).rejects.toThrow(/mandate_expired/);
    const renewed = await grant(seller);
    expect(Date.parse(renewed.scope.expiresAt)).toBe(t + 30 * 86_400_000);
    await grant(buyer);
    expect((await seller.offer(offerRequest(d, seller, buyer))).state.escrowState).toBe('Offered');
    // A live mandate is renewed too: the test seller asks two hours before its mandate expires (D47).
    t = Date.parse(renewed.scope.expiresAt) - 2 * 3_600_000;
    const early = await grant(seller);
    expect(Date.parse(early.scope.expiresAt)).toBe(t + 30 * 86_400_000);
    // A deal in flight continues across a renewal: both parties renew between the offer and the agreement.
    const timing = { offerExpiresInSec: 7200, fundWithinSec: 7300, deliverWithinSec: 7400, judgeWithinSec: 600, fallbackWithinSec: 600, appealWindowSec: 60, appealDecideSec: 60 };
    const offer = await seller.offer(offerRequest(d, seller, buyer, { timing }));
    await world.work();
    t += 3_600_000;
    const latest = await grant(seller);
    await grant(buyer);
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    expect((await world.chain.state(offer.id))?.escrowState).toBe('Held');
    // Every node, and a world rebuilt from the same storage, serves only the latest mandate.
    const served = async (u: string) => ((await (await fetch(`${u}/v1/agents/${seller.address}`)).json()) as J).mandates.map((m: J) => m.mandateHash);
    for (const u of urls) expect(await served(u)).toEqual([latest.mandateHash]);
    const rebuilt = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, now: () => t });
    expect(rebuilt.chain.agentMandates().filter((m) => m.agent.toLowerCase() === seller.address).map((m) => m.scope.expiresAt)).toEqual([latest.scope.expiresAt]);
  });

  it('has no clock or adjudicator controls and no arbitrary-amount faucet', async () => {
    const { urls } = await serve();
    for (const path of ['/advance', '/accounts', '/adjudicators/primary', '/v1/test/faucet']) {
      const r = await post(`${urls[0]}${path}`, { seconds: 600, silent: true, address: freshAgent(urls).address, amount: '1' }, `x${path}`);
      expect(r.status, path).toBe(404);
    }
    expect((await fetch(`${urls[0]}/clock`)).status).toBe(404);
  });

  it('never serves a secret key: every GET route, discovery and the faucet are free of the world keys', async () => {
    const { world, urls } = await serve();
    const a = freshAgent(urls);
    const faucet = await (await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'k-s')).text();
    const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
    const adjudicators = ((await (await fetch(`${urls[0]}/v1/adjudicators`)).json()) as J).items.map((x: J) => x.address);
    const paths = ['/', '/.well-known/holdback.json', '/llms.txt', '/v1/status', '/v1/openapi.json', `/v1/clubs/${index.clubId}`, '/v1/adjudicators', ...adjudicators.map((x: string) => `/v1/adjudicators/${x}`), `/v1/agents/${a.address}`, '/v1/commitments'];
    const bodies = [faucet];
    for (const u of urls) for (const p of paths) bodies.push(await (await fetch(`${u}${p}`)).text());
    const secrets = world.secretsForTest();
    expect(secrets.length).toBeGreaterThan(5);
    for (const body of bodies) for (const s of secrets) expect(body.toLowerCase().includes(s.toLowerCase().replace(/^0x/, ''))).toBe(false);
  });

  it('states what the demo is in one discovery document, also served at GET /, and in llms.txt', async () => {
    const { urls } = await serve();
    for (const u of urls) await fetch(`${u}/v1/status`); // a node learns its public origin from its first request
    for (const u of urls) {
      const d = (await (await fetch(`${u}/.well-known/holdback.json`)).json()) as J;
      expect(d.apiBaseUrl).toBe(u);
      expect(d.domain.chainId).toBe(31337);
      const notes = d.notes.join('\n');
      expect(notes).toMatch(/test tokens only/i);
      expect(notes).toMatch(/one shared simulated settlement layer/i);
      expect(notes).toMatch(/POST \/v1\/faucet/);
      expect(notes).toMatch(/scripted/i);
      expect(d.limits).toEqual({ reads: { limit: 1200, windowSec: 60, per: 'client' }, writes: { limit: 120, windowSec: 60, per: 'signer' }, maxCiphertextBytes: 1_048_576, idempotency: { replays: 'success-only', retention: 'process' } });
      expect(d.demo).toMatchObject({ clubId: 'demo-club', operators: urls, token: { id: 'tUSD', decimals: 6 }, minWindowSec: 2, faucet: { path: '/v1/faucet', grant: { token: 'tUSD', amount: '1000000000' }, perAddressEverySec: 3600, perClientPerWindow: 10 } });
      expect(d.demo.adjudicators.map((a: J) => a.role)).toEqual(['primary', 'fallback', 'appeal']);
      const root = (await (await fetch(`${u}/`)).json()) as J;
      expect(Object.keys(root).sort()).toEqual(Object.keys(d).sort());
      expect(root.demo.adjudicators).toEqual(d.demo.adjudicators);
      const llms = await (await fetch(`${u}/llms.txt`)).text();
      expect(llms).toMatch(/POST \/v1\/faucet/);
      expect(llms).toContain('https://crow.direct/llms.txt');
    }
    // The two nodes sign receipts with different keys.
    const signers = await Promise.all(urls.map(async (u) => ((await (await fetch(`${u}/v1/status`)).json()) as J).receiptSigner));
    expect(new Set(signers).size).toBe(2);
  });

  it('publishes the largest ciphertext it stores, refuses a larger one by that number, and the docs state the same (T-315)', async () => {
    const { urls } = await serve();
    const cap = DEMO_MAX_CIPHERTEXT_BYTES;
    // Discovery, on both nodes.
    for (const u of urls) expect(((await (await fetch(`${u}/.well-known/holdback.json`)).json()) as J).limits.maxCiphertextBytes).toBe(cap);
    const upload = (bytes: Uint8Array, key: string) => fetch(`${urls[0]}/v1/ciphertext`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'idempotency-key': key }, body: bytes });
    // The node: exactly the cap is stored and served back; one byte more is refused with the cap in `maxBytes`.
    const fits = await upload(new Uint8Array(cap).fill(7), 'k-fits');
    const stored = (await fits.json()) as J;
    expect([fits.status, stored.bytes]).toEqual([200, cap]);
    expect((await (await fetch(stored.uri)).arrayBuffer()).byteLength).toBe(cap);
    const over = await upload(new Uint8Array(cap + 1).fill(7), 'k-over');
    const refusal = (await over.json()) as J;
    expect([over.status, refusal.type, refusal.maxBytes]).toEqual([413, 'payload_too_large', cap]);
    expect(refusal.detail).toContain(String(cap));
    // The docs: each names the field and the demo's number beside it, and neither says a node stores 10 MiB.
    const bytes = `${cap.toLocaleString('en-US')} bytes`;
    expect(bytes).toBe('1,048,576 bytes');
    for (const file of ['site/llms.txt', 'docs/api.md', 'spec/openapi/paths.json']) {
      const text = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
      expect(text.split('\n').some((line) => line.includes('maxCiphertextBytes') && line.includes(bytes)), `${file} states ${bytes} beside limits.maxCiphertextBytes`).toBe(true);
      expect(text.split('\n').filter((line) => /ciphertext/i.test(line) && /at most 10 MiB|ciphertext 10 MiB/.test(line)), `${file} no longer says a node stores 10 MiB`).toEqual([]);
    }
  });

  it('notes in the body which panel judges a rubric offer; a checks-only offer gets no notice', async () => {
    const { urls } = await serve();
    const d = await discovery(urls);
    const [seller, buyer] = [freshAgent(urls), freshAgent(urls)];
    const r = (await (await post(`${urls[0]}/v1/prepare/offer`, offerRequest(d, seller, buyer, RUBRIC_OFFER))).json()) as J;
    expect(r.notices).toEqual([expect.stringMatching(/scripted/)]);
    const c = (await (await post(`${urls[0]}/v1/prepare/offer`, offerRequest(d, seller, buyer))).json()) as J;
    expect(c.kind).toBe('offer');
    expect(c.notices).toBeUndefined();
  });

  it('declines a private offer it cannot open, and says so before the offer and on the state read (F1)', async () => {
    const { urls } = await serve();
    const d = await discovery(urls);
    const [seller, buyer] = [freshAgent(urls), freshAgent(urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const price = { token: 'tUSD', amount: '5000000' };
    // Before anything is signed, a hash-only prepare says the demo adjudicators decline sealed offers.
    const h = { ...offerRequest(d, seller, buyer), deliverable: undefined, checks: undefined, template: undefined, hashOnly: true, disclosure: 'private', deliverableHash: `0x${'11'.repeat(32)}`, acceptanceHash: `0x${'22'.repeat(32)}`, createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z') };
    const prepared = (await (await post(`${urls[0]}/v1/prepare/offer`, h)).json()) as J;
    expect(prepared.notices.join(' ')).toMatch(/decline/);
    const { deal: dealBuyer } = await buyer.dealKeys(d.demo.clubId, 'buyer', price);
    const { deal: dealSeller } = await seller.dealKeys(d.demo.clubId, 'seller', price);
    const [primary, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address);
    const offer = await dealSeller.offerPrivate({
      clubId: d.demo.clubId,
      buyer: { address: dealBuyer.address, encryptionPublicKey: dealBuyer.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      price,
      deliverable: { kind: 'dataset', description: 'a private dataset', format: 'text/csv' },
      acceptance: { deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id'] }], rubric: { criteria: [], passThreshold: 0 } },
    });
    expect(offer.state.notices.join(' ')).toMatch(/decline/);
    let state: J;
    for (const end = Date.now() + 10_000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
      state = await seller.call('GET', `/v1/commitments/${offer.id}`);
      if (state.notices?.some((n: string) => /declined/.test(n))) break;
    }
    expect(state.escrowState).toBe('Offered');
    expect(state.notices.join(' ')).toMatch(/primary adjudicator declined this offer: .*sealed terms/);
  });
});

/** A rubric deal: a judge panel scores it. */
const RUBRIC_OFFER = { template: 'default', rubric: { passThreshold: 300, criteria: [{ id: 'ok', description: 'Fine.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] } };
/** The discovery document, as an agent with only a URL reads it. */
const discovery = async (urls: string[]): Promise<J> => (await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J;
/** A checks-only offer request from the demo facts in discovery. */
const offerRequest = (d: J, seller: Agent, buyer: Agent, extra: J = {}) => {
  const [primary, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address);
  return {
    nonce: `0x${Buffer.from(nacl.randomBytes(32)).toString('hex')}`,
    disclosure: 'public',
    template: 'checks-only',
    clubId: d.demo.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
    checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
    ...extra,
  };
};

/** The code-fix job from tools/sim/catalogue.json: a rubric deal a judge panel decides. */
async function rubricDeal(urls: string[], diff: string): Promise<{ id: string; state: J; buyer: Agent }> {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const buyer = freshAgent(urls);
  const seller = freshAgent(urls);
  for (const a of [buyer, seller]) await a.call('POST', '/v1/faucet', { address: a.address });
  const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
  const offer = await seller.offer({
    template: 'default',
    clubId: index.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '30000000' },
    deliverable: { kind: 'other', description: 'Unified diff fixing the off-by-one in page()', format: 'text/plain' },
    checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
    rubric: {
      passThreshold: 300,
      criteria: [
        { id: 'fixes', description: 'The diff makes page() return exactly `size` items per full page.', weight: 70, anchors: { '0': 'Does not fix it', '2': 'Partly', '4': 'Fixes it' } },
        { id: 'minimal', description: 'No unrelated changes.', weight: 30, anchors: { '0': 'Rewrites everything', '2': 'Some noise', '4': 'Minimal' } },
      ],
    },
    timing: { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 2, appealDecideSec: 2 },
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(offer.terms, 40_000_000n);
  await seller.deliver(offer.terms, new TextEncoder().encode(diff));
  const state = await buyer.waitFor(offer.id, ['Released', 'Refunded']);
  return { id: offer.id, state, buyer };
}

const DIFF = '--- a/page.js\n+++ b/page.js\n@@ -1 +1 @@\n-function page(items, n, size) { return items.slice(n * size, n * size + size - 1); }\n+function page(items, n, size) { return items.slice(n * size, n * size + size); }\n';

/** World storage that remembers every key written, to show what an open writes. */
class RecordingStorage extends MemoryStorage {
  readonly written: string[] = [];
  override async put(entries: Record<string, unknown>): Promise<void> {
    this.written.push(...Object.keys(entries));
    return super.put(entries);
  }
}

/** An outside adjudicator's registration, as the `llms.txt` recipe writes it: the demo primary's policy under its own id. */
async function outsideRegistration(urls: string[], who: TestAccount, issuedAt: string, over: Partial<AdjudicatorRegistration['policy']> = {}): Promise<RegisteredAdjudicator> {
  const d = await discovery(urls);
  const demo = (await (await fetch(`${urls[0]}/v1/adjudicators/${d.demo.adjudicators[0].address}`)).json()) as AdjudicatorRegistration;
  const policy = { ...demo.policy, id: `outsider-${who.address.slice(2, 8)}/p1`, ...over };
  const terms = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 0 };
  const body = {
    address: who.address.toLowerCase() as RegisteredAdjudicator['address'],
    name: 'Outside adjudicator (test)',
    encryptionPublicKey: who.encryptionPublicKey,
    affiliations: [],
    policy,
    registry: demo.registry,
    policyHash: canonicalKeccak(policy),
    fee: { min: { token: 'tUSD', amount: '0' } as AdjudicatorRegistration['fee']['min'] },
    status: 'active' as const,
    pool: { terms },
    poolTermsHash: canonicalKeccak(terms),
  };
  const expiresAt = new Date(Date.parse(issuedAt) + 365 * 86_400_000).toISOString().replace('.000Z', 'Z');
  return signRegistration(who.privateKey, holdbackDomain(31337), body, { keyId: `${body.policy.id}/k1`, issuedAt, nonce: canonicalKeccak({ who: who.address, issuedAt }), expiresAt });
}

describe('two hostnames per operator node (T-312)', () => {
  it('answers on api.escrow.stream and api.crow.direct alike, and advertises the crow.direct addresses it is configured with', async () => {
    const urls = ['https://api.crow.direct', 'https://api2.crow.direct'];
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_URLS: urls.join(',') }, minWindowSec: 2 });
    for (const [node, host] of [[0, 'api.escrow.stream'], [0, 'api.crow.direct'], [1, 'api2.escrow.stream'], [1, 'api2.crow.direct']] as const) {
      const r = await world.fetch(new Request(`https://${host}/.well-known/holdback.json`), { node, origin: `https://${host}`, client: 'test' });
      expect(r.status).toBe(200);
      const d = (await r.json()) as J;
      expect(d.apiBaseUrl).toBe(urls[node]);
      expect(d.demo.operators).toEqual(urls);
    }
  });
});

describe('adjudicator registrations in the world store (T-221 slice 2, ADR-0030)', () => {
  const page = async (url: string, q = ''): Promise<J> => (await (await fetch(`${url}/v1/adjudicators${q}`)).json()) as J;
  const rows = async (storage: MemoryStorage) => [...(await storage.list<StoredRegistration>({ prefix: 'ar:' })).values()];

  it('the demo adjudicators register through the store when the world opens: signed, the defaults, and no row written on a reopen', async () => {
    const storage = new RecordingStorage();
    const first = await serve({}, storage, undefined, { passes: false });
    const d = await discovery(first.urls);
    const slate = d.demo.adjudicators.map((a: J) => a.address);
    expect(d.defaultAdjudicators).toEqual({ primary: slate[0], fallback: slate[1], appeal: slate[2] });
    for (const url of first.urls) {
      const listed = (await page(url)).items;
      expect(listed.map((x: J) => x.address)).toEqual(slate);
      for (const [i, x] of listed.entries()) {
        expect(await verifyRegistration(holdbackDomain(31337), x)).toBe(true);
        expect(x.observed).toMatchObject({ bond: 'bonded', expired: false, defaultFor: [['primary', 'fallback', 'appeal'][i]] });
      }
    }
    expect((await rows(storage)).map((r) => [r.record.address, r.seq])).toEqual(slate.map((a: string, i: number) => [a, i]).sort());
    expect(first.world.telemetry.usage().rows).toEqual({ ar: 3 });
    const before = (await page(first.urls[0])).items;
    await first.close();
    running.splice(running.indexOf(first), 1);

    // A restart signs the same messages again: the store answers unchanged, and the open writes no `ar:` row.
    storage.written.length = 0;
    const second = await serve({}, storage, undefined, { passes: false });
    expect(storage.written.filter((k) => k.startsWith('ar:'))).toEqual([]);
    expect((await page(second.urls[1])).items).toEqual(before);
  });

  it('the agent guide names the defaults where discovery serves them: `defaultAdjudicators`, and `observed.defaultFor` (T-220 review)', async () => {
    const { urls } = await serve({}, new MemoryStorage(), undefined, { passes: false });
    const d = await discovery(urls);
    expect(Object.keys(d.defaultAdjudicators).sort()).toEqual(['appeal', 'fallback', 'primary']);
    const guide = readFileSync(new URL('../../../site/llms.txt', import.meta.url), 'utf8');
    const start = guide.indexOf('## Run your own adjudicator');
    const section = guide.slice(start, guide.indexOf('\n## ', start + 3));
    for (const field of ['`defaultAdjudicators`', '`observed.defaultFor`']) expect(section).toContain(field);
  });

  it('an outside adjudicator registers at either node, both serve it after the demo three, and a reopened world serves it in the same place', async () => {
    const storage = new MemoryStorage();
    // Settlement time stands still, so every registration below is stored in the same second.
    const t = Math.floor(Date.now() / 1000) * 1000;
    const first = await serve({ now: () => t }, storage, undefined, { passes: false });
    const issuedAt = new Date(t - 60_000).toISOString().replace('.000Z', 'Z');
    // The second registrant's row key sorts before the first's: storage alone would list it first.
    const accounts = Array.from({ length: 40 }, (_, i) => testAccount(`t-221/world-outsider-${i}`));
    const one = accounts[0]!;
    const two = accounts.find((a) => a.address.toLowerCase() < one.address.toLowerCase())!;
    const posted = await post(`${first.urls[0]}/v1/adjudicators`, await outsideRegistration(first.urls, one, issuedAt), 'reg-one');
    expect(posted.status).toBe(200);
    expect(((await posted.json()) as J).observed).toMatchObject({ bond: 'none', registeredAt: new Date(t).toISOString().replace('.000Z', 'Z'), expired: false });
    expect((await post(`${first.urls[1]}/v1/adjudicators`, await outsideRegistration(first.urls, two, issuedAt), 'reg-two')).status).toBe(200);
    expect(first.world.telemetry.usage().rows).toEqual({ ar: 5 });

    const slate = (await discovery(first.urls)).demo.adjudicators.map((a: J) => a.address);
    const order = [...slate, one.address.toLowerCase(), two.address.toLowerCase()];
    const paged = async (url: string) => {
      const a = await page(url, '?limit=4');
      const b = await page(url, `?limit=4&cursor=${a.nextCursor}`);
      return [...a.items, ...b.items].map((x: J) => x.address);
    };
    for (const url of first.urls) expect(await paged(url)).toEqual(order);
    const served = (await (await fetch(`${first.urls[1]}/v1/adjudicators/${one.address}`)).json()) as J;
    expect(await verifyRegistration(holdbackDomain(31337), served)).toBe(true);
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await serve({ now: () => t + 5000 }, storage, undefined, { passes: false });
    expect(await paged(second.urls[0])).toEqual(order);
    expect(((await (await fetch(`${second.urls[0]}/v1/adjudicators/${one.address}`)).json()) as J).registration).toEqual(served.registration);
    expect(second.world.telemetry.usage().rows).toEqual({ ar: 5 });
  });

  it('reads any named adjudicator\'s bond live: one without a bond gets a notice as primary and is refused as fallback (ADR-0030 §5)', async () => {
    const { urls } = await serve({}, new MemoryStorage(), undefined, { passes: false });
    const d = await discovery(urls);
    const outsider = testAccount('t-221/world-unbonded');
    expect((await post(`${urls[0]}/v1/adjudicators`, await outsideRegistration(urls, outsider, new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')), 'reg-unbonded')).status).toBe(200);
    const [seller, buyer] = [freshAgent(urls), freshAgent(urls)];
    const [primary, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address);
    const asPrimary = (await (await post(`${urls[0]}/v1/prepare/offer`, offerRequest(d, seller, buyer, { adjudicators: { primary: outsider.address, fallback, appeal } }))).json()) as J;
    expect(asPrimary.notices.join(' ')).toMatch(new RegExp(`primary adjudicator ${outsider.address.toLowerCase()} has no bond`, 'i'));
    const asFallback = await post(`${urls[0]}/v1/prepare/offer`, offerRequest(d, seller, buyer, { adjudicators: { primary, fallback: outsider.address, appeal } }));
    expect(asFallback.status).toBe(400);
    expect(((await asFallback.json()) as J).detail).toMatch(/fallback adjudicator .* free bond, less than the price/);
  });

  it('a world created before registrations gets its rows on its next open; a changed record is signed again with a later issuedAt', async () => {
    const storage = new MemoryStorage();
    const first = await serve({}, storage, undefined, { passes: false });
    const start = ((await storage.get<{ start: string }>('meta'))!).start;
    await first.close();
    running.splice(running.indexOf(first), 1);
    // As before slice 2: no `ar:` row.
    await storage.delete([...(await storage.list({ prefix: 'ar:' })).keys()]);
    const second = await serve({}, storage, undefined, { passes: false });
    const made = await rows(storage);
    expect(made).toHaveLength(3);
    for (const r of made) expect(r.record.registration.issuedAt).toBe(start);
    await second.close();
    running.splice(running.indexOf(second), 1);

    // Live judges change each demo adjudicator's name and registry: the record changes, so the open signs it again.
    const third = await serve({ judgeProvider: markerFake() }, storage, undefined, { passes: false });
    const changed = await rows(storage);
    for (const r of changed) {
      const was = made.find((m) => m.record.address === r.record.address)!;
      expect(Date.parse(r.record.registration.issuedAt)).toBeGreaterThan(Date.parse(start));
      expect([r.registeredAt, r.seq]).toEqual([was.registeredAt, was.seq]);
      expect(r.record.registry.hash).toBe(liveRegistry().hash);
    }
    for (const x of (await page(third.urls[0])).items) expect(await verifyRegistration(holdbackDomain(31337), x)).toBe(true);
  });

  // T-221 review (high): terms bind only the primary's policy hash. A primary that registers again with another policy
  // after agreement must not leave the demo's fallback and appeal adjudicators without the bound one.
  it('keeps a replaced policy by its hash in a `ph:` row, so the demo adjudicators still read the bound policy, also after a reopen', async () => {
    const storage = new MemoryStorage();
    const first = await serve({}, storage, undefined, { passes: false });
    const who = testAccount('t-221/world-rotating');
    const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const one = await outsideRegistration(first.urls, who, iso(Date.now() - 120_000));
    expect((await post(`${first.urls[0]}/v1/adjudicators`, one, 'rotate-1')).status).toBe(200);
    const two = await outsideRegistration(first.urls, who, iso(Date.now() - 60_000), { rationaleMaxChars: one.policy.rationaleMaxChars - 1 });
    expect((await post(`${first.urls[1]}/v1/adjudicators`, two, 'rotate-2')).status).toBe(200);
    expect(two.policyHash).not.toBe(one.policyHash);
    for (const role of ['fallback', 'appeal'] as const) {
      expect(await first.world.adjudicators[role].settlement.policy(one.policyHash)).toEqual(one.policy);
      expect(await first.world.adjudicators[role].settlement.policy(two.policyHash)).toEqual(two.policy);
    }
    expect([...(await storage.list({ prefix: 'ph:' })).keys()]).toEqual([`ph:${one.policyHash}`]);
    expect(first.world.telemetry.usage().rows).toEqual({ ar: 4, ph: 1 });
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await serve({}, storage, undefined, { passes: false });
    expect(await second.world.adjudicators.appeal.settlement.policy(one.policyHash)).toEqual(one.policy);
    expect(second.world.telemetry.usage().rows).toEqual({ ar: 4, ph: 1 });
  });

  // T-221 review: an outside primary whose fee is below the demo adjudicators' quote: they would decline their turns.
  it('fills in no demo adjudicator that would decline the terms, and notes the ones the parties named', async () => {
    const { urls } = await serve({}, new MemoryStorage(), undefined, { passes: false });
    const d = await discovery(urls);
    const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address);
    const outsider = testAccount('t-221/world-below-quote');
    expect((await post(`${urls[0]}/v1/adjudicators`, await outsideRegistration(urls, outsider, new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')), 'reg-cheap')).status).toBe(200);
    const [seller, buyer] = [freshAgent(urls), freshAgent(urls)];
    const filled = await post(`${urls[0]}/v1/prepare/offer`, offerRequest(d, seller, buyer, { adjudicators: { primary: outsider.address } }));
    const refused = (await filled.json()) as J;
    expect([filled.status, refused.type, refused.field]).toEqual([400, 'invalid_terms', 'adjudicators.fallback']);
    expect(refused.detail).toMatch(/default fallback adjudicator .* would decline these terms: the fee 0 tUSD is below the quote/);
    // Named by the seller: prepared and relayed, each with a notice for both demo adjudicators.
    await seller.call('POST', '/v1/faucet', { address: seller.address });
    const offered = await seller.offer(offerRequest(d, seller, buyer, { adjudicators: { primary: outsider.address, fallback, appeal } }));
    const notices = (offered.state.notices ?? []).join(' ');
    expect(notices).toMatch(new RegExp(`fallback adjudicator ${fallback} will decline its fallback turn on these terms`));
    expect(notices).toMatch(new RegExp(`appeal adjudicator ${appeal} will decline its appeal turn on these terms`));
  });
});

// T-221 review: one unauthenticated listing page could cost up to 400 RPC calls once the cache was cold, and the cache
// started again from empty past 1,024 addresses.
describe('bond reads from HoldbackBonds (T-221 review)', () => {
  it('reuses a read for a block, drops the least recently read past its size, and spends the listing budget only on uncached reads', async () => {
    let t = 0;
    const reads: string[] = [];
    const r = new BondReads(async (a) => (reads.push(a), { held: 5n, free: 3n }), () => t, { ttlMs: 12_000, max: 3, listingPerMin: 2 });
    const [a, b, c, d] = ['0xa', '0xb', '0xc', '0xd'].map((x) => x.padEnd(42, '0') as Address);
    for (const x of [a, b, c, a]) await r.get(x);
    expect(reads).toEqual([a, b, c]);
    // d pushes out b, the least recently read; a and c are still cached.
    for (const x of [d, a, c]) await r.get(x);
    expect(reads).toEqual([a, b, c, d]);
    await r.get(b);
    expect(reads).toEqual([a, b, c, d, b]);

    // A block later every read is stale. Listings may read 2 uncached addresses a minute; a cached one costs nothing.
    t = 20_000;
    await r.get(a, { listing: true });
    await r.get(b, { listing: true });
    await expect(r.get(c, { listing: true })).rejects.toThrow(/read 2 bonds for listings in the last minute/);
    expect(await r.get(a, { listing: true })).toEqual({ held: 5n, free: 3n });
    // Prepare and the relays read without the budget.
    await r.get(c);
    expect(reads.slice(5)).toEqual([a, b, c]);
    t = 80_000;
    await r.get(d, { listing: true });
    expect(reads.at(-1)).toBe(d);
  });
});

// T-231: the timeouts the operators send on their own spend the relayer's gas, so a daily budget bounds them. An offer
// costs nothing to post, so offer expiries have a cap of their own inside it.
describe('the daily budget for the timeouts the operators send (T-231)', () => {
  it('counts each send in one row a UTC day before it goes out, caps offer expiries apart, and opens again at midnight UTC', async () => {
    const storage = new MemoryStorage();
    let t = Date.parse('2026-11-06T23:00:00Z');
    const budget = new TimeoutBudgetRows(storage, () => t, { perDay: 3, offersPerDay: 1 });
    const midnight = Date.parse('2026-11-07T00:00:00Z');
    expect(await budget.take('expire_offer')).toBe(true);
    expect(await storage.get('ot:2026-11-06')).toEqual({ sent: 1, offers: 1 });
    // The offers' cap is spent; the hold's timeouts still go.
    expect(await budget.take('expire_offer')).toEqual({ opensAt: midnight, offersOnly: true });
    expect(await budget.take('reclaim')).toBe(true);
    expect(await budget.take('default')).toBe(true);
    expect(await budget.take('reclaim')).toEqual({ opensAt: midnight, offersOnly: false });
    expect(await storage.get('ot:2026-11-06')).toEqual({ sent: 3, offers: 1 });
    // A restart reads the day's row: what was spent stays spent.
    const restarted = new TimeoutBudgetRows(storage, () => t, { perDay: 3, offersPerDay: 1 });
    expect(await restarted.take('appeal_expiry')).toEqual({ opensAt: midnight, offersOnly: false });
    // A new UTC day starts from zero.
    t = midnight + 1;
    expect(await restarted.take('expire_offer')).toBe(true);
    expect(await storage.get('ot:2026-11-07')).toEqual({ sent: 1, offers: 1 });
  });

  it('gives a unit back when nothing went out: the row returns to its count before, an offer expiry lowers the offers too, and a give after midnight UTC changes nothing', async () => {
    const storage = new MemoryStorage();
    let t = Date.parse('2026-11-06T23:59:00Z');
    const budget = new TimeoutBudgetRows(storage, () => t, { perDay: 3, offersPerDay: 1 });
    expect(await budget.take('reclaim')).toBe(true);
    expect(await budget.take('expire_offer')).toBe(true);
    expect(await storage.get('ot:2026-11-06')).toEqual({ sent: 2, offers: 1 });
    await budget.give('expire_offer');
    expect(await storage.get('ot:2026-11-06')).toEqual({ sent: 1, offers: 0 });
    // The offers' cap is open again.
    expect(await budget.take('expire_offer')).toBe(true);
    await budget.give('reclaim');
    expect(await storage.get('ot:2026-11-06')).toEqual({ sent: 1, offers: 1 });
    // Past midnight UTC the day's row is closed: a late give writes nothing to it or to the new day.
    t = Date.parse('2026-11-07T00:00:01Z');
    await budget.give('reclaim');
    expect(await storage.get('ot:2026-11-06')).toEqual({ sent: 1, offers: 1 });
    expect(await storage.get('ot:2026-11-07')).toBeUndefined();
  });
});

describe('live judges (T-028), with a stand-in for the models', () => {
  /** markerFake stands in for the live provider: unmarked verdicts, as a model's would be. Counts calls. */
  const standIn = () => {
    const inner = markerFake();
    const calls: string[] = [];
    return { calls, provider: { complete: (r: Parameters<typeof inner.complete>[0]) => (calls.push(r.model), inner.complete(r)) } };
  };

  it('says so in GET /, the notes and the offer notice, and binds the live registry', async () => {
    const { provider } = standIn();
    const { urls } = await serve({ judgeProvider: provider, liveCallsPerDay: 7 });
    const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
    expect(index.judges).toMatchObject({ panel: 'live', registry: { uri: LIVE_REGISTRY_URI, hash: liveRegistry().hash }, liveCallsPerDay: 7, liveCallsToday: 0 });
    expect(index.judges.models).toEqual(liveRegistry().active.map((e) => e.model));
    for (const a of index.adjudicators) expect(a.name).toMatch(/live panel/);
    const regs = (await (await fetch(`${urls[0]}/v1/adjudicators`)).json()) as J;
    for (const r of regs.items ?? regs) expect(r.registry.hash).toBe(liveRegistry().hash);
    const notes = ((await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J).notes.join('\n');
    expect(notes).toMatch(/live judge panel/i);
    expect(notes).toMatch(/7 live judge calls a day/);
    const d = await discovery(urls);
    const r = (await (await post(`${urls[0]}/v1/prepare/offer`, offerRequest(d, freshAgent(urls), freshAgent(urls), RUBRIC_OFFER))).json()) as J;
    expect(r.notices).toEqual([expect.stringMatching(/live judge panel/)]);
  });

  it('judges a rubric deal live within the daily budget, then falls back to marked scripted judges', async () => {
    const { calls, provider } = standIn();
    const { urls } = await serve({ judgeProvider: provider, liveCallsPerDay: 5 });
    const first = await rubricDeal(urls, DIFF);
    expect(first.state.escrowState).toBe('Released');
    expect(calls).toHaveLength(3);
    const live = (await first.buyer.call('GET', `/v1/commitments/${first.id}/judgment`)) as J;
    expect(live.panel.members).toHaveLength(3);
    for (const m of live.panel.members) {
      expect(liveRegistry().active.map((e) => e.model)).toContain(m.model);
      expect(m.verdict.rationale).not.toMatch(/^\[fake judge, no model ran\]/);
    }
    expect(((await (await fetch(`${urls[0]}/`)).json()) as J).demo.judges.liveCallsToday).toBe(3);

    // Two calls left today: fewer than a panel needs, so the next panel is scripted and its record says so.
    const second = await rubricDeal(urls, DIFF);
    expect(second.state.escrowState).toBe('Released');
    expect(calls).toHaveLength(3);
    const scripted = (await second.buyer.call('GET', `/v1/commitments/${second.id}/judgment`)) as J;
    for (const m of scripted.panel.members) expect(m.verdict.rationale).toMatch(/^\[fake judge, no model ran\]/);
  }, 90_000);

  it('keeps the count across a rebuild from storage', async () => {
    const storage = new MemoryStorage();
    const { provider } = standIn();
    const a = await serve({ judgeProvider: provider, liveCallsPerDay: 5 }, storage);
    await rubricDeal(a.urls, DIFF);
    await a.close();
    running.splice(running.indexOf(a), 1);
    const b = await serve({ judgeProvider: provider, liveCallsPerDay: 5 }, storage);
    expect(((await (await fetch(`${b.urls[0]}/`)).json()) as J).demo.judges.liveCallsToday).toBe(3);
  }, 90_000);

  it('without keys the panel is scripted, and the env decides: all three variables or none', async () => {
    const { urls } = await serve({ env: { HOLDBACK_ANTHROPIC_API_KEY: 'k' } });
    const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
    expect(index.judges).toMatchObject({ panel: 'scripted', registry: { hash: placeholderRegistry().hash } });
    expect(index.judges.missing).toEqual(['HOLDBACK_OPENAI_COMPATIBLE_API_KEY', 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL']);
    expect(JSON.stringify(index)).not.toContain('"k"');
  });
});

describe('a checks-only deal between two fresh agents, over HTTP', () => {
  it('reaches Released and final, and survives the world being rebuilt from storage', async () => {
    const storage = new MemoryStorage();
    const first = await serve({}, storage);
    const { urls } = first;
    const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
    const buyer = freshAgent(urls);
    const seller = freshAgent(urls);
    for (const a of [buyer, seller]) await a.call('POST', '/v1/faucet', { address: a.address });
    const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
    const offer = await seller.offer({
      template: 'checks-only',
      clubId: index.clubId,
      seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      price: { token: 'tUSD', amount: '25000000' },
      deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
      checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
      timing: { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 2, appealDecideSec: 2 },
    });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    await seller.deliver(offer.terms, new TextEncoder().encode('customer_id,email\n1,ada@example.com\n'));
    expect((await buyer.waitFor(offer.id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    let state: J;
    for (const end = Date.now() + 10_000; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
      state = await buyer.call('GET', `/v1/commitments/${offer.id}`);
      if (state.finalAt) break;
    }
    expect(state.finalAt).toBeTruthy();
    expect(await buyer.openDelivery(offer.id)).toMatch(/ada@example.com/);
    const balance = async (a: Agent) => (await a.call('GET', `/v1/balances/${a.address}`)).amount;
    expect([await balance(buyer), await balance(seller)]).toEqual(['974000000', '1025000000']);

    // Eviction: a new world over the same storage replays the journal to the same state.
    const digest = first.world.digest();
    await first.close();
    running.splice(running.indexOf(first), 1);
    // A changed configuration does not change a world already created: its club keeps the windows it began with.
    const second = await serve({ minWindowSec: 99 }, storage);
    expect(second.world.digest()).toBe(digest);
    expect(((await (await fetch(`${second.urls[0]}/`)).json()) as J).demo.minWindowSec).toBe(2);
    const again = new Agent(second.urls, generatePrivateKey(), nacl.randomBytes(32));
    expect((await again.call('GET', `/v1/commitments/${offer.id}`)).escrowState).toBe('Released');
    expect((await again.call('GET', `/v1/commitments/${offer.id}/judgment`)).commitmentId).toBe(offer.id);
    expect((await again.call('GET', `/v1/balances/${seller.address}`)).amount).toBe('1025000000');
  }, 60_000);
});

describe('adjudicator passes (T-057)', () => {
  /** A new world over the same storage, as after an eviction, woken by a plain read. */
  const wake = async (storage: MemoryStorage, options: Partial<PublicWorldOptions> = {}) => {
    const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
    await world.fetch(new Request('http://127.0.0.1/v1/status'), { node: 0, origin: 'http://127.0.0.1', client: 'test' });
    return world;
  };

  it('a world rebuilt from storage is active after a read only while its adjudicators have work', async () => {
    const storage = new MemoryStorage();
    const first = await serve({}, storage, undefined, { passes: false });
    const d = await discovery(first.urls);
    const [seller, buyer] = [freshAgent(first.urls), freshAgent(first.urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    // A faucet grant moves no deal: nothing awaits the adjudicators.
    expect(first.world.active()).toBe(false);
    const offer = await seller.offer(offerRequest(d, seller, buyer));
    expect(first.world.active()).toBe(true);
    await first.close();
    running.splice(running.indexOf(first), 1);

    // Evicted with the offer pending: the rebuilt world is active and its primary accepts.
    const second = await wake(storage);
    expect(second.active()).toBe(true);
    await second.work();
    expect((await second.chain.state(offer.id))?.escrowState).toBe('AcceptedByAdjudicator');
    // The accepted deal waits on its buyer, not on an adjudicator: no pass is due, before or after a rebuild.
    expect([second.active(), second.nextPass()]).toEqual([false, null]);
    expect((await wake(storage)).active()).toBe(false);
  });

  it('a pass that changes nothing doubles the wait, up to a minute; 15 minutes after settlement moved only the takeover stays scheduled', async () => {
    const storage = new MemoryStorage();
    let t = Date.now();
    const now = () => t;
    const first = await serve({ now }, storage, undefined, { passes: false });
    const d = await discovery(first.urls);
    const [seller, buyer] = [freshAgent(first.urls), freshAgent(first.urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const timing = { judgeWithinSec: 7200, fallbackWithinSec: 7200, appealWindowSec: 2, appealDecideSec: 2 };
    const offer = await seller.offer(offerRequest(d, seller, buyer, { timing }));
    await first.world.work();
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    await seller.deliver(offer.terms, new TextEncoder().encode('customer_id,email\n1,ada@example.com\n'));
    await first.close();
    running.splice(running.indexOf(first), 1);

    // Restarted with live judges, the primary refuses the delivery (registry_mismatch, backlog) on every
    // pass until judgeBy, two hours away: a case no pass can finish.
    const stuck = await wake(storage, { now, judgeProvider: markerFake() });
    expect(stuck.nextPass()).toBe(t + 1000);
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      await stuck.work();
      waits.push(stuck.nextPass()! - t);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    const { escrowState, deadlines } = (await stuck.chain.state(offer.id))!;
    expect(escrowState).toBe('Delivered');
    t += 15 * 60_000;
    expect([stuck.active(), stuck.nextPass()]).toEqual([false, Date.parse(deadlines['judgeBy']!)]);
    // judgeBy passes before anything rereads the state: the takeover still gets a pass, after the current wait.
    t = Date.parse(deadlines['judgeBy']!) + 1;
    expect(stuck.nextPass()).toBe(t + 60_000);
  });

  it('a deal that moves as its deadline passes stays scheduled: a read and a delivery straddle deliverBy (T-057 review)', async () => {
    let t = Math.ceil(Date.now() / 1000) * 1000;
    const { world, urls } = await serve({ now: () => t }, new MemoryStorage(), undefined, { passes: false });
    const d = await discovery(urls);
    const [seller, buyer] = [freshAgent(urls), freshAgent(urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const timing = { offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 600, fallbackWithinSec: 600, appealWindowSec: 60, appealDecideSec: 60 };
    const offer = await seller.offer(offerRequest(d, seller, buyer, { timing }));
    await world.work();
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    const deliverBy = Date.parse(offer.terms.timing.deliverBy);
    t = deliverBy - 500;
    const { prepared, intent } = await seller.prepareDelivery(offer.terms, new TextEncoder().encode('customer_id,email\n1,ada@example.com\n'));
    const { path, body } = await seller.sign(prepared, intent);
    // Both start, and stamp the settlement clock, before deliverBy; the read's look runs after it and drops the
    // Held deal, then the delivery lands, stamped in time.
    const via = { node: 0 as const, origin: urls[0], client: 'test' };
    const read = world.fetch(new Request(`${urls[0]}/v1/status`), via);
    const delivery = world.fetch(new Request(`${urls[0]}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k-race' }, body: JSON.stringify(body) }), via);
    t = deliverBy + 100;
    await read;
    expect((await delivery).ok).toBe(true);
    expect((await world.chain.state(offer.id))?.escrowState).toBe('Delivered');
    expect(world.active()).toBe(true);
  });
});

// T-313: a rejected storage write leaves memory ahead of storage. The world stays failed and says so (`broken`); a
// world opened from the same storage starts from what was written, as after a restart.
describe('a failed storage write (T-313)', () => {
  it('fails the call that hit it and every call after, reports it once, and a world reopened from the same storage keeps what clients were told', async () => {
    const storage = new MemoryStorage();
    const errors: string[] = [];
    const first = await serve({ onError: (e) => void errors.push(e.message) }, storage, undefined, { passes: false });
    const d = await discovery(first.urls);
    const [seller, buyer] = [freshAgent(first.urls), freshAgent(first.urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const offer = await seller.offer(offerRequest(d, seller, buyer));
    const balance = async (a: Agent, urls = first.urls) => (await freshAgent(urls).call('GET', `/v1/balances/${a.address}`)).amount as string;
    const told = [await balance(seller), await balance(buyer)];
    expect(first.world.broken).toBe(false);

    // The pass accepts the offer in memory; storage rejects its journal write, once.
    const put = storage.put.bind(storage);
    let failures = 1;
    storage.put = async (entries) => {
      if (failures > 0 && Object.keys(entries).some((k) => k.startsWith('j:'))) {
        failures--;
        throw new Error('storage put failed (test)');
      }
      return put(entries);
    };
    await expect(first.world.work()).rejects.toThrow('storage put failed (test)');
    expect(first.world.broken).toBe(true);
    // Storage works again, and the world still fails: it does not write on from a state storage never held.
    await expect(first.world.fetch(new Request('http://127.0.0.1/v1/status'), { node: 0, origin: 'http://127.0.0.1', client: 'test' })).rejects.toThrow('storage put failed (test)');
    expect(first.world.broken).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/storage write failed.*storage put failed \(test\)/);
    // A broken world takes no new work: a grant fails before the faucet runs, and a pass before the adjudicators do.
    const digest = first.world.digest();
    const grant = new Request('http://127.0.0.1/v1/faucet', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'late' }, body: JSON.stringify({ address: freshAgent(first.urls).address }) });
    await expect(first.world.fetch(grant, { node: 0, origin: 'http://127.0.0.1', client: 'test' })).rejects.toThrow('storage put failed (test)');
    await expect(first.world.work()).rejects.toThrow('storage put failed (test)');
    expect(first.world.digest()).toBe(digest);
    await first.close();
    running.splice(running.indexOf(first), 1);

    // A world opened from the same storage: the offer and the grants the clients were answered for are there, and the
    // acceptance no one was told about is not. The next pass accepts again, and this time it is written.
    const second = await serve({}, storage, undefined, { passes: false });
    expect(second.world.broken).toBe(false);
    expect((await second.world.chain.state(offer.id))?.escrowState).toBe('Offered');
    expect([await balance(seller, second.urls), await balance(buyer, second.urls)]).toEqual(told);
    await second.world.work();
    expect((await second.world.chain.state(offer.id))?.escrowState).toBe('AcceptedByAdjudicator');
    const third = await PublicWorld.open({ storage, env: {}, minWindowSec: 2 });
    expect((await third.chain.state(offer.id))?.escrowState).toBe('AcceptedByAdjudicator');
  });
});

describe('telemetry (T-031)', () => {
  it('never receives a body, a header value, an IP or an address, and summarizes the day from settlement events', async () => {
    const lines: J[] = [];
    let offset = 0;
    const storage = new MemoryStorage();
    const ip = '203.0.113.77';
    const { urls, world } = await serve({ now: () => Date.now() + offset, telemetryLog: (_level, line) => void lines.push(line) }, storage, ip);
    const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
    const [buyer, seller] = [freshAgent(urls), freshAgent(urls)];
    for (const a of [buyer, seller]) await a.call('POST', '/v1/faucet', { address: a.address });
    const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
    const offer = await seller.offer({
      template: 'checks-only',
      clubId: index.clubId,
      seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      price: { token: 'tUSD', amount: '25000000' },
      deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
      checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
      timing: { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 2, appealDecideSec: 2 },
    });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    await seller.deliver(offer.terms, new TextEncoder().encode('customer_id,email\n1,ada@example.com\n'));
    await buyer.waitFor(offer.id, ['Released']);

    // A value in every header, the query and the body, from a client whose IP is known.
    const canaries = { authorization: 'Holdback-ReadToken canary-authorization', traceparent: '00-c0ffeec0ffeec0ffeec0ffeec0ffee00-c0ffeec0ffee0000-01', 'user-agent': 'canary-user-agent', 'x-canary': 'canary-header', 'idempotency-key': 'canary-idempotency-key' };
    const terms = await fetch(`${urls[0]}/v1/commitments/${offer.id}/terms?canary=canary-query`, { headers: canaries });
    await terms.text();
    const faucet = await fetch(`${urls[1]}/v1/faucet`, { method: 'POST', headers: { ...canaries, 'content-type': 'application/json' }, body: JSON.stringify({ address: buyer.address, canary: 'canary-body' }) });
    await faucet.text();
    const stray = await fetch(`${urls[0]}/wp-admin/${seller.address}?canary=canary-query`, { headers: canaries });
    await stray.text();

    // The next UTC day: the world closes the hours and the day it saw.
    offset = Date.parse(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) + 60_000 - Date.now();
    for (const end = Date.now() + 10_000; Date.now() < end && !lines.some((l) => l.telemetry === 'day'); ) await new Promise((r) => setTimeout(r, 100));
    const day = lines.find((l) => l.telemetry === 'day');
    expect(day.deals).toMatchObject({ offered: { deals: 1 }, funded: { deals: 1 }, delivered: { deals: 1 }, decided: { deals: 1 }, final: { deals: 1 } });
    expect(day.outcomes.released).toBe(1);
    expect(day.signers).toEqual({ active: 2, fresh: 2, firstDealCompleted: 2 });
    expect(day.routes['POST /v1/faucet']).toMatchObject({ requests: 3, clientErrors: 1, problems: { rate_limited: 1 } });
    expect(day.usage.requests.used).toBeGreaterThan(0);
    expect(day.journalEntries).toBe(world.chain.journalLength());

    // The log finds each request by its Request-Id, as the node that answered it.
    expect(await world.telemetry.lookup(terms.headers.get('request-id')!)).toMatchObject({ node: 0, method: 'GET', route: '/v1/commitments/{commitmentId}/terms', status: 200 });
    expect(await world.telemetry.lookup(faucet.headers.get('request-id')!)).toMatchObject({ node: 1, route: '/v1/faucet', status: 429, problem: 'rate_limited' });
    expect(await world.telemetry.lookup(stray.headers.get('request-id')!)).toMatchObject({ route: 'unmatched', status: 404 });

    // Nothing a request carried, and no address or deal ID, reaches the log lines, the stored log or the usage.
    const kept = JSON.stringify([lines, [...(await storage.list({ prefix: 'rl:' })).values()], await storage.get('tm:current')]).toLowerCase();
    for (const secret of [...Object.values(canaries), 'c0ffeec0ffee', 'canary-query', 'canary-body', ip, buyer.address, seller.address, offer.id]) expect(kept).not.toContain(secret.toLowerCase());
    expect(kept).not.toMatch(/0x[0-9a-f]{40}/);
    // And no header, query or body value, nor the IP, lands anywhere in the world's storage.
    const everything = await storage.list({ prefix: '' });
    // `ar`: the demo adjudicators' own registrations (T-221), which hold no request data.
    expect(new Set([...everything.keys()].map((k) => k.split(':')[0]))).toEqual(new Set(['meta', 'j', 'fa', 'ct', 'jr', 'rl', 'tm', 'ar']));
    const stored = JSON.stringify([...everything.values()], (_k, v) => (v instanceof Uint8Array ? undefined : v)).toLowerCase();
    for (const secret of [...Object.values(canaries), 'c0ffeec0ffee', 'canary-query', 'canary-body', ip]) expect(stored).not.toContain(secret.toLowerCase());
  }, 60_000);
});

describe('feedback (T-032)', () => {
  it("attaches the node's own log line for the failing request, and publishes the feedback key", async () => {
    const store = new MemoryFeedbackStore();
    const key = encodePublicKey(generateEncryptionKeyPair().publicKey);
    const { urls } = await serve({ feedbackStore: store, env: { FEEDBACK_ENCRYPTION_PUBLIC_KEY: key } });
    const failed = await fetch(`${urls[1]}/v1/agents/0x${'ab'.repeat(20)}`);
    await failed.text();
    const requestId = failed.headers.get('request-id')!;
    const report = { kind: 'bug', summary: 'my agent is not found', detail: 'GET after the faucet', requestId };
    const filed = (await (await post(`${urls[0]}/v1/feedback`, report, 'k-report')).json()) as J;
    expect(filed).toMatchObject({ status: 'received', logAttached: true });
    expect(store.reports.get(filed.id)!.attached.log).toMatchObject({ requestId, node: 1, method: 'GET', route: '/v1/agents/{address}', status: 404, problem: 'not_found' });
    expect(JSON.stringify(store.reports.get(filed.id))).not.toContain('ab'.repeat(20));
    expect((await discovery(urls)).feedback).toMatchObject({ path: '/v1/feedback', encryptionPublicKey: key });
  });

  it('refuses to start with a malformed feedback key, and takes no reports without a store', async () => {
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { FEEDBACK_ENCRYPTION_PUBLIC_KEY: 'not-a-key' }, feedbackStore: new MemoryFeedbackStore() })).rejects.toThrow();
    const { urls } = await serve();
    expect((await post(`${urls[0]}/v1/feedback`, { kind: 'docs', summary: 's', detail: 'd' }, 'k')).status).toBe(404);
  });
});

describe('operator fee from Worker variables (ADR-0023, T-029)', () => {
  const D33 = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' };

  it('publishes no fee without the variables, and one schedule on both nodes with them', async () => {
    const none = await serve();
    expect(((await (await fetch(`${none.urls[0]}/v1/status`)).json()) as J).fees).toBeUndefined();
    const { urls } = await serve({ env: D33 });
    const [a, b] = await Promise.all(urls.map(async (u) => ((await (await fetch(`${u}/.well-known/holdback.json`)).json()) as J).fees.operator));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false });
    const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
    expect(index.fees.operator).toEqual(a);
    expect(index.operatorFee).toBeUndefined(); // one name for the fee
    expect(index.notes.join(' ')).toMatch(/operator fee of 1 bp of the price, at least 0.01 tUSD/);
    expect(await (await fetch(`${urls[1]}/llms.txt`)).text()).toMatch(/not refunded/);
  });

  it('a 25 tUSD deal pays 0.01 tUSD to the operator; at 0 / 0 it pays nothing', async () => {
    for (const [env, paid] of [[D33, 10_000n], [{ OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' }, 0n]] as const) {
      const { urls } = await serve({ env });
      const d = (await (await fetch(`${urls[0]}/`)).json()) as J;
      const index = d.demo;
      const buyer = freshAgent(urls);
      const seller = freshAgent(urls);
      for (const x of [buyer, seller]) await x.call('POST', '/v1/faucet', { address: x.address });
      const [primary, fallback, appeal] = index.adjudicators.map((x: J) => x.address);
      const offer = await seller.offer({
        template: 'checks-only', clubId: index.clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
        adjudicators: { primary, fallback, appeal }, price: { token: 'tUSD', amount: '25000000' },
        deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' }, checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
      });
      await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
      expect((await buyer.agreeAndFund(offer.terms, 30_000_000n)).escrowState).toBe('Held');
      expect(1_000_000_000n - BigInt((await buyer.call('GET', `/v1/balances/${buyer.address}`)).amount)).toBe(26_000_000n + paid);
      expect((await buyer.call('GET', `/v1/balances/${d.fees.operator.to}`)).amount).toBe(paid.toString());
    }
  }, 60_000);

  it('refuses a malformed schedule at start', async () => {
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '0.5', OPERATOR_FEE_MIN: '10000' } })).rejects.toThrow(/OPERATOR_FEE_BPS/);
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '0.01' } })).rejects.toThrow(/OPERATOR_FEE_MIN/);
  });
});

describe('the Sepolia world names drand quicknet, changed in place (T-220, D49)', () => {
  const deployment = JSON.parse(readFileSync(new URL('../../../contracts/deployments/sepolia.json', import.meta.url), 'utf8')) as DeploymentFile;
  /** anvil's second well-known dev key (public; guards no value). Opening reads no chain, so no RPC answers here. */
  const chain = () => new LiveChain({ deployment, rpcUrls: ['http://127.0.0.1:9'], relayerKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' });
  const get = async (world: PublicWorld, path: string): Promise<J> => (await (await world.fetch(new Request(`http://127.0.0.1${path}`), { node: 0, origin: 'http://127.0.0.1', client: '127.0.0.1' })).json()) as J;

  it("today's world reopens under this build with the drand rulebook: a new hash, the same keys, registrations and meta", async () => {
    const storage = new RecordingStorage();
    // The rulebook the live demo serves today (the deployed build names the sim beacon), on the world's own storage.
    const today = await PublicWorld.open({ storage, env: {}, live: { chain: chain(), beacon: 'sim' }, onError: () => {} });
    const before = await get(today, '/v1/clubs/demo-club');
    expect(before.rulebook.randomness).toEqual({ source: 'sim' });
    const adjudicators = (await get(today, '/.well-known/holdback.json')).demo.adjudicators;
    const meta = await storage.get('meta');
    storage.written.length = 0;

    // This build, on the same storage: the default for a chain world is the deployment's drand quicknet beacon.
    const next = await PublicWorld.open({ storage, env: {}, live: { chain: chain() }, onError: () => {} });
    const after = await get(next, '/v1/clubs/demo-club');
    expect(after.rulebook.randomness).toEqual({ source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH });
    expect(after.rulebookHash).toBe(canonicalKeccak(after.rulebook));
    expect(after.rulebookHash).not.toBe(before.rulebookHash);
    // Only the randomness source changed.
    expect({ ...after.rulebook, randomness: null }).toEqual({ ...before.rulebook, randomness: null });
    const d = await get(next, '/.well-known/holdback.json');
    expect(d.demo.adjudicators).toEqual(adjudicators);
    // No new world: the same meta (secret, start, rules address, bonds), no registration signed again, no book touched.
    expect(await storage.get('meta')).toEqual(meta);
    expect(storage.written.filter((k) => k === 'meta' || k.startsWith('ar:') || k.startsWith('ph:') || k.startsWith('b:'))).toEqual([]);

    // The notes say what changed: no "drand not yet" line, and the view is kept across deploys.
    const notes = d.notes.join('\n');
    expect(notes).not.toMatch(/do not fetch yet|may be reset/);
    expect(notes).toMatch(/Fallback and appeal adjudicators decide on Sepolia: their panels are seeded from a drand quicknet round/);
    expect(notes).toMatch(/The operators' view is kept across deploys\. It starts over only when the settlement contracts are redeployed; what happened on Sepolia stays there\. Keep your own copy of the terms you signed\./);
  });

  it('keeps the sim beacon on a SimChain world and, by default, on a local anvil chain, whose harness deploys SimBeacon', async () => {
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: {} });
    expect((await get(world, '/v1/clubs/demo-club')).rulebook.randomness).toEqual({ source: 'sim' });
    expect((await get(world, '/.well-known/holdback.json')).notes.join('\n')).not.toMatch(/drand/);
    const local = new LiveChain({ deployment: { ...deployment, chainId: 31337 }, rpcUrls: ['http://127.0.0.1:9'], relayerKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' });
    const anvil = await PublicWorld.open({ storage: new MemoryStorage(), env: {}, live: { chain: local }, onError: () => {} });
    expect((await get(anvil, '/v1/clubs/demo-club')).rulebook.randomness).toEqual({ source: 'sim' });
  });
});

describe('discovery publishes what Crow Control reads by script (T-066, slice 3)', () => {
  const deployment = JSON.parse(readFileSync(new URL('../../../contracts/deployments/sepolia.json', import.meta.url), 'utf8')) as DeploymentFile;
  /** anvil's second well-known dev key (public; guards no value). Opening reads no chain, so no RPC answers here. */
  const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const chain = () => new LiveChain({ deployment, rpcUrls: ['http://127.0.0.1:9'], relayerKey: RELAYER });
  const demoOf = async (world: PublicWorld): Promise<J> => ((await (await world.fetch(new Request('http://127.0.0.1/.well-known/holdback.json'), { node: 0, origin: 'http://127.0.0.1', client: '127.0.0.1' })).json()) as J).demo;
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';

  it('names the deployed commit from BUILD_COMMIT, and null for anything that is not 40 hex characters', async () => {
    expect((await demoOf(await PublicWorld.open({ storage: new MemoryStorage(), env: { BUILD_COMMIT: COMMIT } }))).build).toEqual({ commit: COMMIT });
    expect((await demoOf(await PublicWorld.open({ storage: new MemoryStorage(), env: {} }))).build).toEqual({ commit: null });
    expect(buildCommit({ BUILD_COMMIT: COMMIT.toUpperCase() })).toBe(COMMIT);
    expect(buildCommit({ BUILD_COMMIT: 'main' })).toBe(null);
    expect(buildCommit({ BUILD_COMMIT: `${COMMIT}0` })).toBe(null);
  });

  it('lists the relayer lanes and the faucet mints a day on a chain world only', async () => {
    const live = chain();
    const d = await demoOf(await PublicWorld.open({ storage: new MemoryStorage(), env: {}, live: { chain: live }, onError: () => {} }));
    expect(d.relayer).toEqual({ fundingLane: live.funding.toLowerCase(), dealLanes: live.lanes.slice(1).map((a) => a.address.toLowerCase()) });
    expect(d.relayer.dealLanes).toHaveLength(3);
    expect(d.faucet.mintsPerDay).toBe(600);
    // Addresses only: no lane key reaches the document.
    for (const key of live.secretsForTest()) expect(JSON.stringify(d).toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    const sim = await demoOf(await PublicWorld.open({ storage: new MemoryStorage(), env: {} }));
    expect(sim.relayer).toBeUndefined();
    expect(sim.faucet.mintsPerDay).toBeUndefined();
  });

  it('takes the funding lane first and the deal lanes after it', () => {
    const lanes = [{ address: '0xAA00000000000000000000000000000000000001' }, { address: '0xBB00000000000000000000000000000000000002' }];
    expect(relayerFacts({ funding: lanes[0]!.address, lanes })).toEqual({ fundingLane: '0xaa00000000000000000000000000000000000001', dealLanes: ['0xbb00000000000000000000000000000000000002'] });
  });

  it("splits today's live judge tokens by model, counts only, and keeps them across a rebuild", async () => {
    const storage = new MemoryStorage();
    const now = () => Date.parse('2026-11-05T12:00:00Z');
    const budget = new JudgeBudget(storage, 30, now);
    await budget.take();
    budget.usage({ provider: 'anthropic', model: 'claude-opus-5-5@2026-09-21', inputTokens: 900, outputTokens: 180 });
    await budget.take();
    budget.usage({ provider: 'openai-compatible', model: 'deepseek-flash@2026-11-01', inputTokens: 1000, outputTokens: 200 });
    budget.usage({ provider: 'anthropic', model: 'claude-opus-5-5@2026-09-21', inputTokens: 887, outputTokens: 181 });
    const today = await budget.used();
    expect(today).toMatchObject({ calls: 2, inputTokens: 2787, outputTokens: 561 });
    expect(today.byModel).toEqual({ 'claude-opus-5-5@2026-09-21': { calls: 2, input: 1787, output: 361 }, 'deepseek-flash@2026-11-01': { calls: 1, input: 1000, output: 200 } });
    await budget.flush();
    expect((await new JudgeBudget(storage, 30, now).used()).byModel).toEqual(today.byModel);
  });

  it("serves a discovery document the node's own contract accepts, on SimChain and on a chain world", async () => {
    const live = chain();
    for (const world of [await PublicWorld.open({ storage: new MemoryStorage(), env: { BUILD_COMMIT: COMMIT } }), await PublicWorld.open({ storage: new MemoryStorage(), env: {}, live: { chain: live }, onError: () => {} })]) {
      const url = new URL('http://127.0.0.1/.well-known/holdback.json');
      const r = await world.fetch(new Request(url), { node: 0, origin: 'http://127.0.0.1', client: '127.0.0.1' });
      expect(checkExchange({ method: 'GET', url, status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }).errors).toEqual([]);
    }
  });

  it('starts a new UTC day with no tokens by model', async () => {
    const storage = new MemoryStorage();
    let t = Date.parse('2026-11-05T23:59:00Z');
    const budget = new JudgeBudget(storage, 30, () => t);
    await budget.take();
    budget.usage({ provider: 'anthropic', model: 'claude-opus-5-5@2026-09-21', inputTokens: 10, outputTokens: 2 });
    t = Date.parse('2026-11-06T00:01:00Z');
    expect((await budget.used()).byModel).toEqual({});
  });

  it('serves tokensToday.byModel with a live panel', async () => {
    const inner = markerFake();
    const { urls } = await serve({ judgeProvider: { complete: (r: Parameters<typeof inner.complete>[0]) => inner.complete(r) }, liveCallsPerDay: 7 });
    const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
    expect(index.judges.tokensToday).toEqual({ input: 0, output: 0, byModel: {} });
  });
});
