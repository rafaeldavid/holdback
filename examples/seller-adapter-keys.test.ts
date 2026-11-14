// T-432: the seller adapter signs each deal with a fresh key (`signingKey: "per-deal"`), on the demo world with its
// faucet, as the test service runs it. Done when a read of the commitments by a seller key returns one deal per key.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { config as shipped, dealKeyOf, holdingKeyOf, signerFor, startSellerAdapter, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { knownPins } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SCOPE = { commit: 'a'.repeat(40), files: ['contracts/Vault.sol', 'contracts/InterestModel.sol', 'contracts/PriceFeed.sol'], lines: 3000 };

/** A demo world of its own behind two origins, with `perClient` faucet grants an hour (the test service's limit). */
async function demoWorld(perClient: number) {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: {}, faucetPerClient: perClient, telemetryLog: () => {} });
  const served = await serveTwoOrigins(world, { tickMs: 100 });
  const discovery = (await (await fetch(`${served.urls[0]}/.well-known/holdback.json`)).json()) as J;
  return { served, discovery };
}

let served: TwoOrigins;
let discovery: J;
let stub: StubSellerApi;
const running: RunningAdapter[] = [];
beforeAll(async () => {
  ({ served, discovery } = await demoWorld(100));
  stub = await startStubSellerApi({ port: 0, token: discovery.demo.token.id, quoteOverride: { price: { token: discovery.demo.token.id, amount: '5000000' } } });
});
afterEach(async () => {
  for (const r of running.splice(0)) await r.close();
});
afterAll(async () => {
  await stub.close();
  await served.close();
});

async function start(o: { key: Hex; journal?: string; events?: string; urls?: string[]; over?: Partial<SellerAdapterConfig>; api?: StubSellerApi }) {
  const lines: string[] = [];
  const r = await startSellerAdapter(
    {
      ...shipped,
      port: 0,
      sellerApi: (o.api ?? stub).api,
      journal: o.journal ?? join(mkdtempSync(join(tmpdir(), 't432-')), 'journal.json'),
      ...(o.events ? { events: o.events } : {}),
      pollMs: 50,
      log: (l) => lines.push(l),
      signingKey: 'per-deal',
      ...o.over,
    },
    { HOLDBACK_KEY: o.key, HOLDBACK_OPERATORS: (o.urls ?? served.urls).join(',') },
  );
  running.push(r);
  return { r, lines };
}
const buyerAgent = (urls = served.urls) => new Agent(urls, generatePrivateKey(), new Uint8Array(32).fill(7));
async function quote(r: RunningAdapter, buyer: Agent, headers: Record<string, string> = {}): Promise<{ status: number; body: J; headers: Headers }> {
  const res = await fetch(`${r.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const termsOf = async (a: Agent, id: string): Promise<J> => {
  const t = await a.call('GET', `/v1/commitments/${id}/terms`);
  delete t.id;
  delete t.signatures;
  return t;
};
/** Every deal one key signed, as one operator lists it. */
const dealsOf = async (op: string, address: string): Promise<string[]> => ((await (await fetch(`${op}/v1/commitments?party=${address}&limit=100`)).json()) as J).items.map((x: J) => x.id ?? x.commitmentId);
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}

describe('seller adapter: a fresh key for each deal (T-432)', () => {
  it('three quotes give three seller keys: a read by each finds one deal, and HOLDBACK_KEY\'s address none', async () => {
    const key = generatePrivateKey();
    const longTerm = privateKeyToAccount(key).address.toLowerCase();
    const { r, lines } = await start({ key });
    const ids: string[] = [];
    const sellers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const q = await quote(r, buyerAgent());
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      const terms = await termsOf(buyerAgent(), q.body.commitmentId);
      ids.push(q.body.commitmentId);
      sellers.push(String(terms.seller).toLowerCase());
      // The deal key is the one HOLDBACK_KEY and the offer's own nonce derive; payments go to HOLDBACK_KEY's address.
      expect(terms.seller.toLowerCase()).toBe(privateKeyToAccount(dealKeyOf(key, terms.nonce)).address.toLowerCase());
      expect(terms.sellerPayoutAddress.toLowerCase()).toBe(longTerm);
    }
    expect(new Set(sellers).size).toBe(3);
    expect(sellers).not.toContain(longTerm);
    for (const op of served.urls) {
      for (let i = 0; i < 3; i++) expect(await dealsOf(op, sellers[i]!)).toEqual([ids[i]]);
      expect(await dealsOf(op, longTerm)).toEqual([]);
    }
    const out = lines.join('\n');
    expect(out).toMatch(/Signing key: a fresh key for each deal, derived from HOLDBACK_KEY; its own address 0x[0-9a-f]{40} signs no deal/);
    expect(out).toMatch(/is offered, signed by its deal key 0x[0-9a-f]{40}, to /);
    expect(out).toMatch(/Each deal key takes its own mandate from the faucet with its quote\./);
    expect(out).not.toMatch(/The mandate ends 1970/);
    // Advisories, never refusals: an open /quote spends grants, and the default payout address links the deals.
    expect(out).toMatch(/Warning: per-deal keys with no quoteAuth and no quoteRateLimit/);
    expect(out).toMatch(/Warning: every deal names HOLDBACK_KEY's address 0x[0-9a-f]{40} as its payout address/);
  }, 60_000);

  it('a funded deal ends Released, delivered by its deal key after a restart, with no key in the journal, the events or the log', async () => {
    const key = generatePrivateKey();
    const dir = mkdtempSync(join(tmpdir(), 't432-'));
    const journal = join(dir, 'journal.json');
    const events = join(dir, 'events.jsonl');
    const first = await start({ key, journal, events });
    const buyer = buyerAgent();
    await buyer.call('POST', '/v1/faucet', { address: buyer.address });
    const q = await quote(first.r, buyer);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const id = q.body.commitmentId as Hex;
    // The adapter stops before the hold; the next run derives the deal key again from the signed terms.
    await first.r.close();
    running.splice(running.indexOf(first.r), 1);
    await buyer.waitFor(id, ['AcceptedByAdjudicator']);
    await buyer.agreeAndFund(await termsOf(buyer, id), 200_000_000n);
    const second = await start({ key, journal, events });
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => second.r.deals().find((d) => d.id === id)?.stage === 'delivered');
    const terms = await termsOf(buyer, id);
    const delivered = ((await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)) as J).items.find((e: J) => e.type === 'delivery.submitted');
    expect(String(delivered.actor).toLowerCase()).toBe(String(terms.seller).toLowerCase());

    // No secret anywhere the adapter writes: HOLDBACK_KEY, the deal key, the holding key, with or without 0x.
    const secrets = [key, dealKeyOf(key, terms.nonce), holdingKeyOf(key)].flatMap((k) => [k.toLowerCase(), k.slice(2).toLowerCase()]);
    const written = [readFileSync(journal, 'utf8'), readFileSync(events, 'utf8'), ...first.lines, ...second.lines].join('\n').toLowerCase();
    for (const s of secrets) expect(written).not.toContain(s);
    const offered = readFileSync(events, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e: J) => e.type === 'deal.offered');
    expect(Number.isSafeInteger(offered.grantMs)).toBe(true); // the faucet's time, for the seller's own metrics
  }, 90_000);

  it('a deal keeps the key it was offered with when the mode changes across a restart, either way', async () => {
    const key = generatePrivateKey();
    const longTerm = privateKeyToAccount(key).address.toLowerCase();
    const journal = join(mkdtempSync(join(tmpdir(), 't432-')), 'journal.json');
    const [b1, b2] = [buyerAgent(), buyerAgent()];
    for (const b of [b1, b2]) await b.call('POST', '/v1/faucet', { address: b.address });
    // Deal 1 offered in standing mode, deal 2 in per-deal mode; each is funded while the adapter is down.
    const one = await start({ key, journal, over: { signingKey: 'standing' } });
    const id1 = (await quote(one.r, b1)).body.commitmentId as Hex;
    await one.r.close();
    running.splice(running.indexOf(one.r), 1);
    const two = await start({ key, journal });
    const id2 = (await quote(two.r, b2)).body.commitmentId as Hex;
    await two.r.close();
    running.splice(running.indexOf(two.r), 1);
    for (const [b, id] of [[b1, id1], [b2, id2]] as const) {
      await b.waitFor(id, ['AcceptedByAdjudicator']);
      await b.agreeAndFund(await termsOf(b, id), 200_000_000n);
    }
    // Run 3 in standing mode delivers both: deal 1 with HOLDBACK_KEY, deal 2 with the key its nonce derives.
    const three = await start({ key, journal, over: { signingKey: 'standing' } });
    for (const [b, id] of [[b1, id1], [b2, id2]] as const) expect((await b.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('both deliveries recorded', () => three.r.deals().every((d) => d.stage === 'delivered'));
    const actor = async (b: Agent, id: string) => String(((await b.call('GET', `/v1/commitments/${id}/events?limit=200`)) as J).items.find((e: J) => e.type === 'delivery.submitted').actor).toLowerCase();
    expect(await actor(b1, id1)).toBe(longTerm);
    const t2 = await termsOf(b2, id2);
    expect(await actor(b2, id2)).toBe(privateKeyToAccount(dealKeyOf(key, t2.nonce)).address.toLowerCase());
  }, 120_000);

  it('a replayed quote takes no second key and no second grant', async () => {
    const { r } = await start({ key: generatePrivateKey() });
    const buyer = buyerAgent();
    const one = await quote(r, buyer, { 'idempotency-key': 'replay-1' });
    const two = await quote(r, buyer, { 'idempotency-key': 'replay-1' });
    expect(one.status).toBe(200);
    expect(two.body).toEqual(one.body);
    expect(r.deals()).toHaveLength(1);
  }, 60_000);

  it('at the faucet\'s limit a quote answers 503 with Retry-After, and nothing is signed with HOLDBACK_KEY instead', async () => {
    const own = await demoWorld(1); // one grant an hour from this client
    const api = await startStubSellerApi({ port: 0, token: own.discovery.demo.token.id, quoteOverride: { price: { token: own.discovery.demo.token.id, amount: '5000000' } } });
    try {
      const key = generatePrivateKey();
      const { r, lines } = await start({ key, urls: own.served.urls, api }); // the start itself takes no grant
      expect((await quote(r, buyerAgent(own.served.urls))).status).toBe(200);
      const refused = await quote(r, buyerAgent(own.served.urls));
      expect(refused.status).toBe(503);
      expect(refused.body.type ?? refused.body.error ?? refused.body.code).toBe('seller_unavailable');
      // The faucet's own wait (its hour, here) rides through, and the next quote asks no faucet until it passes.
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(60);
      const again = await quote(r, buyerAgent(own.served.urls));
      expect(again.status).toBe(503);
      expect(Number(again.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(lines.filter((l) => /the faucet gave the deal key/.test(l))).toHaveLength(1);
      expect(r.deals()).toHaveLength(1);
      for (const op of own.served.urls) expect(await dealsOf(op, privateKeyToAccount(key).address.toLowerCase())).toEqual([]);
      expect(lines.join('\n')).toMatch(/the faucet gave the deal key 0x[0-9a-f]{40} no mandate .*No offer is signed with HOLDBACK_KEY instead/);
    } finally {
      for (const x of running.splice(0)) await x.close();
      await api.close();
      await own.served.close();
    }
  }, 60_000);

  it('refuses to start in per-deal mode without the faucet, and the standing key is the default', async () => {
    const key = generatePrivateKey();
    await expect(start({ key, over: { mandate: { fromFaucet: false } } })).rejects.toThrow(/signingKey "per-deal" takes a mandate for each deal key from the test service's faucet, and mandate.fromFaucet is false: set signingKey to "standing"/);
    expect(shipped.signingKey).toBeUndefined();
    const { r } = await start({ key, over: { signingKey: 'standing' } });
    const q = await quote(r, buyerAgent());
    expect((await termsOf(buyerAgent(), q.body.commitmentId)).seller.toLowerCase()).toBe(privateKeyToAccount(key).address.toLowerCase());
  }, 60_000);

  it('signerFor picks HOLDBACK_KEY for its own terms, the deal key for a per-deal offer, and refuses any other seller', () => {
    const key = generatePrivateKey();
    const pin = knownPins()[0]!;
    const nonce = `0x${'12'.repeat(32)}` as Hex;
    const own = privateKeyToAccount(key).address;
    const deal = privateKeyToAccount(dealKeyOf(key, nonce)).address;
    expect(signerFor(key, served.urls, pin, { seller: own, nonce }).address).toBe(own.toLowerCase());
    expect(signerFor(key, served.urls, pin, { seller: deal, nonce }).address).toBe(deal.toLowerCase());
    expect(() => signerFor(key, served.urls, pin, { seller: privateKeyToAccount(generatePrivateKey()).address, nonce })).toThrow(/neither HOLDBACK_KEY's address nor the deal key their nonce derives/);
    expect(dealKeyOf(key, nonce)).not.toBe(dealKeyOf(key, `0x${'34'.repeat(32)}`));
  });
});
