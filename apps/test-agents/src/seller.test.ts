// Crow's test seller against the public demo's own world, served on two origins in this process: a visitor's buyer
// agent follows the intake convention in site/ref/intake.txt ("Two agents, two people") over HTTP only.
import { MemoryStorage } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { commitmentIdOf, jcs, knownPins, operatorFeeOf, sealKeyTo, type Pin } from '../../../examples/verify.ts';
import { BAD_SUMMARY, CHECKS, DELIVERABLE, GOOD_CSV, GOOD_SUMMARY, PRICE_UNITS, SILENT_TIMING, SUMMARY, SUMMARY_CHECKS, SUMMARY_PRICE_UNITS, SUMMARY_RUBRIC } from './catalog.ts';
import { clientKey, storeUri, TestSeller, type Limits } from './seller.ts';
import { serveWorld, type TestWorld } from './test-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const BASE = 'https://crow.direct/agents/test-seller';
const pin = knownPins()[0]!; // SimChain, as the in-process world settles
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256hex = async (s: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex');

let demo: TestWorld;
beforeAll(async () => {
  demo = await serveWorld();
});
afterAll(() => demo.close());
afterEach(() => {
  vi.restoreAllMocks();
});

type Started = ReturnType<typeof startSeller>;
/** A seller with its own storage and secret, worked in the background the way the Durable Object's alarm works it. */
function startSeller(o: { limits?: Partial<Limits>; timing?: Record<string, number>; world?: TestWorld; storage?: MemoryStorage; seed?: string; pin?: Pin } = {}) {
  const world = o.world ?? demo;
  const seller = new TestSeller({ storage: o.storage ?? new MemoryStorage(), operators: world.urls, seed: o.seed ?? generatePrivateKey(), pin: o.pin ?? pin, base: BASE, log: () => {}, ...(o.limits ? { limits: o.limits } : {}), ...(o.timing ? { timing: o.timing } : {}) });
  let running = true;
  const loop = (async () => {
    while (running) {
      await seller.work();
      await sleep(50);
    }
  })();
  const call = (path: string, init: RequestInit = {}, client = '203.0.113.7') => seller.fetch(new Request(`${BASE}${path}`, init), client);
  return { seller, call, world, stop: async () => { running = false; await loop; } };
}

const post = (call: Started['call'], body: unknown, client?: string) => call('/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, client);

/** The buyer's side of the intake convention: a sealed proposal on Crow, the pointer and the sealed key to the intake. */
async function propose(s: Started, buyer: Agent, proposal: J, client?: string): Promise<{ token: string; res: Response; request: J }> {
  const card = await (await s.call('/agent.json')).json();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(proposal))))]);
  const stored = await buyer.call('POST', '/v1/ciphertext', ct);
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const request = { type: 'crow-request', proposal: { uri: stored.uri, sha256: stored.id }, sealedKey: sealKeyTo(key, 'intake', card.intake.encryptionPublicKey).ciphertext, statusTokenHash: await sha256hex(token), from: 'seller.test.ts' };
  return { token, res: await post(s.call, request, client), request };
}

const proposalFor = (buyer: Agent, extra: J = {}) => ({
  type: 'crow-proposal', buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, want: '3 rows of customer_id,email',
  budget: { token: pin.token.id, amount: PRICE_UNITS, covers: 'price' },
  terms: { price: { token: pin.token.id, amount: PRICE_UNITS }, deliverable: DELIVERABLE, template: 'checks-only', disclosure: 'public', checks: CHECKS },
  ...extra,
});

async function statusUntil(s: Started, token: string, done: (x: J) => boolean, timeoutMs = 20_000): Promise<J> {
  let x: J;
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(100)) {
    x = await (await s.call(`/status?token=${token}`)).json();
    if (done(x)) return x;
  }
  throw new Error(`status stayed ${JSON.stringify(x)}`);
}

async function freshBuyer(world = demo): Promise<Agent> {
  const buyer = new Agent(world.urls, generatePrivateKey(), nacl.randomBytes(32), pin.domain);
  await buyer.call('POST', '/v1/faucet', { address: buyer.address });
  return buyer;
}

/** The buyer checks the offer on both operators against what it proposed and the seller's published address, then funds it. */
async function checkAndFund(buyer: Agent, id: Hex, seller: string, want: { price: string; acceptance: J } = { price: PRICE_UNITS, acceptance: { deterministicChecks: CHECKS, rubric: { criteria: [], passThreshold: 0 } } }): Promise<J> {
  // The primary adjudicator accepts the offer within moments; agreeing before that is refused (acceptance_missing).
  for (const end = Date.now() + 20_000; ; await sleep(100)) {
    const states = await Promise.all(buyer.sources().map((api) => buyer.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (states.every((x) => x.escrowState === 'AcceptedByAdjudicator')) break;
    if (Date.now() > end) throw new Error(`${id} is ${states.map((x) => x.escrowState).join(' / ')}, not AcceptedByAdjudicator`);
  }
  const { id: servedId, signatures: _s, ...terms } = await buyer.trusted(`/v1/commitments/${id}/terms`); // eslint-disable-line @typescript-eslint/no-unused-vars
  expect(commitmentIdOf(terms)).toBe(id);
  expect(String(servedId).toLowerCase()).toBe(id);
  expect(terms.seller).toBe(seller);
  expect(terms.buyer).toBe(buyer.address);
  expect(terms.buyerEncryptionPublicKey).toBe(buyer.encryptionPublicKey);
  expect(terms.price).toEqual({ token: pin.token.id, amount: want.price });
  expect(jcs(terms.acceptance)).toBe(jcs(want.acceptance));
  const schedule = await buyer.operatorFeeSchedule();
  const fee = BigInt(terms.adjudication.fee.amount);
  return buyer.agreeAndFund(terms, BigInt(want.price) + fee + (schedule ? operatorFeeOf(terms.price, schedule) : 0n));
}

/**
 * Records every fetch that `match` picks, with its idempotency key and body, and makes the first one act as `act`;
 * every other fetch goes through.
 */
function spyFetch(match: (url: string, init?: RequestInit) => boolean, act: (real: typeof fetch, url: string, init?: RequestInit) => Promise<Response>) {
  const real = globalThis.fetch;
  const calls: Array<{ key: string | null; body: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (match(url, init)) {
      calls.push({ key: new Headers(init?.headers).get('idempotency-key'), body: String(init?.body ?? '') });
      if (calls.length === 1) return act(real, url, init);
    }
    return real(input, init);
  });
  return calls;
}

describe("Crow's test seller", () => {
  it('publishes its intake: the standing address, the encryption key, the offer with its live fees, its limits', async () => {
    const s = startSeller();
    const card = await (await s.call('/agent.json')).json();
    expect(card.type).toBe('crow-agent');
    expect(card.seller).toBe(s.seller.agent.address);
    expect(card.intake).toMatchObject({ api: `${BASE}/requests`, status: `${BASE}/status`, scheme: 'x25519-xsalsa20poly1305' });
    expect(card.intake.encryptionPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(card.offers[0].terms.checks).toEqual(CHECKS);
    const f = card.offers[0].fees;
    expect(BigInt(f.total.amount)).toBe(BigInt(PRICE_UNITS) + BigInt(f.adjudication.amount) + BigInt(f.operator.amount));
    expect(card.limits).toMatchObject({ perClientPerHour: 3, perClientPerDay: 10, perHour: 20, perDay: 100, open: 10 });
    const page = await s.call('');
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await page.text();
    const block = /<script type="application\/json" id="crow-agent">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(JSON.parse(block!)).toEqual(card);
    expect(html).toMatch(/Test tokens only/);
    expect(html).toContain(card.seller);
    expect(await (await s.call('/health')).json()).toEqual({ status: 'operational', open: 0 });
    await s.stop();
  });

  it('sells twice from one standing address: offered, held, delivered, released, and the buyer opens the work', async () => {
    const s = startSeller();
    for (const round of [1, 2]) {
      const buyer = await freshBuyer();
      const { token, res } = await propose(s, buyer, proposalFor(buyer));
      expect(res.status).toBe(201);
      const offered = await statusUntil(s, token, (x) => x.status === 'offered');
      expect(offered.countered).toBe(false);
      // The second deal reuses the mandate: the faucet, once an hour per address, would refuse it.
      expect(offered.seller).toBe(s.seller.agent.address);
      const held = await checkAndFund(buyer, offered.commitmentId, offered.seller);
      expect(held.escrowState).toBe('Held');
      const done = await statusUntil(s, token, (x) => x.deal === 'released', 30_000);
      expect(done.outcome).toBe('release');
      expect(await buyer.openDelivery(offered.commitmentId)).toBe(GOOD_CSV);
      expect(round).toBeGreaterThan(0);
    }
    await s.stop();
  });

  it('delivers work that fails the rows check when the buyer asks to see a refund', async () => {
    const s = startSeller();
    const buyer = await freshBuyer();
    const { token } = await propose(s, buyer, proposalFor(buyer, { test: { outcome: 'refund' } }));
    const offered = await statusUntil(s, token, (x) => x.status === 'offered');
    await checkAndFund(buyer, offered.commitmentId, offered.seller);
    const done = await statusUntil(s, token, (x) => x.deal === 'refunded', 30_000);
    expect(done.outcome).toBe('refund');
    const judgment = await buyer.call('GET', `/v1/commitments/${offered.commitmentId}/judgment`);
    expect(judgment.deterministic.find((c: J) => c.checkId === 'rows').passed).toBe(false);
    expect(judgment.aggregate.decision).toBe('reject');
    await s.stop();
  });

  it('counters another price with its catalog terms, and refuses other work with a reason', async () => {
    const s = startSeller({ limits: { open: 10, perHour: 20, perDay: 100, perClientPerHour: 10, perClientPerDay: 10 } });
    const buyer = await freshBuyer();
    const cheaper = await propose(s, buyer, proposalFor(buyer, { terms: { price: { token: pin.token.id, amount: '1000000' }, deliverable: DELIVERABLE, template: 'checks-only', disclosure: 'public', checks: CHECKS } }));
    const offered = await statusUntil(s, cheaper.token, (x) => x.status === 'offered');
    expect(offered.countered).toBe(true);
    expect((await buyer.trusted(`/v1/commitments/${offered.commitmentId}/terms`)).price.amount).toBe(PRICE_UNITS);
    const other = await propose(s, buyer, proposalFor(buyer, { terms: { price: { token: pin.token.id, amount: PRICE_UNITS }, deliverable: { kind: 'translation', description: 'Spanish', format: 'text/plain' } } }));
    const refused = await statusUntil(s, other.token, (x) => x.status === 'failed');
    expect(refused.detail).toMatch(/sells only customers\.csv/);
    expect(refused.commitmentId).toBeUndefined();
    // Other windows (or adjudicators) are other terms too: the catalog's windows come back as a counter-offer.
    const card = await (await s.call('/agent.json')).json();
    const slower = await propose(s, buyer, proposalFor(buyer, { terms: { ...card.offers[0].terms, timing: { ...card.offers[0].terms.timing, deliverWithinSec: 86_400 } } }));
    expect((await statusUntil(s, slower.token, (x) => x.status === 'offered')).countered).toBe(true);
    const same = await propose(s, buyer, proposalFor(buyer, { terms: card.offers[0].terms }));
    expect((await statusUntil(s, same.token, (x) => x.status === 'offered')).countered).toBe(false);
    await s.stop();
  });

  it('refuses to offer through operators on another settlement layer than the one it pinned', async () => {
    const sepolia = knownPins().find((p) => p.domain.chainId === 11155111)!;
    const s = startSeller({ pin: sepolia });
    const buyer = await freshBuyer();
    const { token } = await propose(s, buyer, proposalFor(buyer));
    const failed = await statusUntil(s, token, (x) => x.status === 'failed');
    expect(failed.detail).toMatch(/serve EIP-712 domain .*"chainId":31337.*, not the pinned .*"chainId":11155111/);
    await s.stop();
  });

  it('counts only requests whose proposal opens against the shared caps, and per-client caps by IPv6 /64', async () => {
    const s = startSeller({ limits: { open: 10, perHour: 1, perDay: 10, perClientPerHour: 5, perClientPerDay: 10 } });
    const buyer = await freshBuyer();
    // A junk request is taken, fails, and leaves the one offer this hour to a real buyer.
    const junk = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const card = await (await s.call('/agent.json')).json();
    expect((await post(s.call, { type: 'crow-request', proposal: { uri: `${demo.urls[0]}/v1/ciphertext/sha256:${'0'.repeat(64)}`, sha256: `sha256:${'0'.repeat(64)}` }, sealedKey: sealKeyTo(new Uint8Array(32), 'intake', card.intake.encryptionPublicKey).ciphertext, statusTokenHash: await sha256hex(junk) })).status).toBe(201);
    await statusUntil(s, junk, (x) => x.status === 'failed');
    const real = await propose(s, buyer, proposalFor(buyer));
    await statusUntil(s, real.token, (x) => x.status === 'offered');
    const full = await propose(s, buyer, proposalFor(buyer));
    expect(full.res.status).toBe(429);
    expect((await full.res.json()).error).toMatch(/1 offers in the last hour/);
    await s.stop();
    expect(clientKey('2001:db8:1:2::5')).toBe(clientKey('2001:0db8:0001:0002:ffff::9'));
    expect(clientKey('2001:db8:1:2::5')).not.toBe(clientKey('2001:db8:1:3::5'));
    expect(clientKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    const v6 = startSeller({ limits: { open: 10, perHour: 10, perDay: 10, perClientPerHour: 1, perClientPerDay: 10 } });
    expect((await propose(v6, buyer, proposalFor(buyer), '2001:db8:1:2::5')).res.status).toBe(201);
    expect((await propose(v6, buyer, proposalFor(buyer), '2001:db8:1:2:ffff::9')).res.status).toBe(429);
    expect((await propose(v6, buyer, proposalFor(buyer), '2001:db8:1:3::1')).res.status).toBe(201);
    await v6.stop();
  });

  it('refuses a malformed request, and fails one whose key does not open, or that points off the operators, with a reason', async () => {
    const s = startSeller();
    const bad = await post(s.call, { type: 'crow-request' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/proposal\.uri/);
    const buyer = await freshBuyer();
    const stored = await buyer.call('POST', '/v1/ciphertext', new Uint8Array(64));
    const card = await (await s.call('/agent.json')).json();
    const cases: Array<[J, RegExp]> = [
      [{ proposal: { uri: stored.uri, sha256: stored.id }, sealedKey: sealKeyTo(new Uint8Array(32), 'x', Buffer.from(nacl.box.keyPair().publicKey).toString('base64url')).ciphertext }, /does not open with this intake's key/],
      [{ proposal: { uri: `https://example.com/v1/ciphertext/sha256:${'0'.repeat(64)}`, sha256: `sha256:${'0'.repeat(64)}` }, sealedKey: sealKeyTo(new Uint8Array(32), 'intake', card.intake.encryptionPublicKey).ciphertext }, /must be a ciphertext URI on/],
    ];
    for (const [fields, why] of cases) {
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      expect((await post(s.call, { type: 'crow-request', ...fields, statusTokenHash: await sha256hex(token) })).status).toBe(201);
      expect((await statusUntil(s, token, (x) => x.status === 'failed')).detail).toMatch(why);
    }
    await s.stop();
  });

  it('caps requests per client an hour and a day, keeps no IP in storage, and replays a request it already has', async () => {
    const storage = new MemoryStorage();
    const seller = new TestSeller({ storage, operators: demo.urls, seed: generatePrivateKey(), pin, base: BASE, log: () => {}, limits: { open: 10, perHour: 10, perDay: 10, perClientPerHour: 1, perClientPerDay: 10 } });
    const s = { seller, call: (path: string, init: RequestInit = {}, client = '203.0.113.7') => seller.fetch(new Request(`${BASE}${path}`, init), client), world: demo, stop: async () => {} };
    const buyer = await freshBuyer();
    const first = await propose(s, buyer, proposalFor(buyer), '198.51.100.1');
    expect(first.res.status).toBe(201);
    const again = await post(s.call, first.request, '198.51.100.1'); // the same request replays, past the cap
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(1);
    const second = await propose(s, buyer, proposalFor(buyer), '198.51.100.1');
    expect(second.res.status).toBe(429);
    expect(Number(second.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await second.res.json()).retryAfterSec).toBeGreaterThan(0);
    expect((await propose(s, buyer, proposalFor(buyer), '198.51.100.2')).res.status).toBe(201);
    const stored = JSON.stringify([...(await storage.list({ prefix: '' })).entries()]);
    expect(stored).not.toContain('198.51.100');
    const daily = new TestSeller({ storage: new MemoryStorage(), operators: demo.urls, seed: generatePrivateKey(), pin, base: BASE, log: () => {}, limits: { open: 10, perHour: 10, perDay: 10, perClientPerHour: 5, perClientPerDay: 1 } });
    const d = { seller: daily, call: (path: string, init: RequestInit = {}, client = '203.0.113.7') => daily.fetch(new Request(`${BASE}${path}`, init), client), world: demo, stop: async () => {} };
    expect((await propose(d, buyer, proposalFor(buyer))).res.status).toBe(201);
    const over = await propose(d, buyer, proposalFor(buyer));
    expect(over.res.status).toBe(429);
    expect((await over.res.json()).error).toMatch(/today/);
  });

  it('retries a transient failure instead of failing the deal', async () => {
    const s = startSeller();
    const buyer = await freshBuyer();
    const offers = spyFetch((url, init) => init?.method === 'POST' && new URL(url).pathname === '/v1/commitments', async () => new Response(JSON.stringify({ type: 'internal', detail: 'injected 503' }), { status: 503, headers: { 'content-type': 'application/problem+json' } }));
    const { token } = await propose(s, buyer, proposalFor(buyer));
    const offered = await statusUntil(s, token, (x) => x.status === 'offered' && x.deal === 'offered');
    expect(offered.commitmentId).toMatch(/^0x[0-9a-f]{64}$/);
    // The retry sent the offer it had signed, under the same key: no second offer was signed.
    expect(offers).toHaveLength(2);
    expect(offers[1]!.key).toBe(offers[0]!.key);
    expect(offers[1]!.body).toBe(offers[0]!.body);
    await s.stop();
  });

  it('replays a delivery whose answer was lost, with the same key and body, so it is delivered once', async () => {
    const s = startSeller();
    const buyer = await freshBuyer();
    const { token } = await propose(s, buyer, proposalFor(buyer));
    const offered = await statusUntil(s, token, (x) => x.status === 'offered');
    const deliveries = spyFetch((url, init) => init?.method === 'POST' && url.endsWith('/deliveries'), async (real, url, init) => {
      await real(url, init); // the operator takes it; the answer never arrives
      throw new TypeError('fetch failed: injected after the operator answered');
    });
    await checkAndFund(buyer, offered.commitmentId, offered.seller);
    await statusUntil(s, token, (x) => x.deal === 'released', 30_000);
    // The retry replayed the delivery it had signed, under the same key, and the operator answered it as the first.
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]!.key).toBe(deliveries[0]!.key);
    expect(deliveries[1]!.body).toBe(deliveries[0]!.body);
    const events = (await buyer.call('GET', `/v1/commitments/${offered.commitmentId}/events?limit=200`)).items;
    expect(events.filter((e: J) => e.type === 'delivery.submitted')).toHaveLength(1);
    await s.stop();
  });

  it('expires an offer the buyer never funds once the funding window has passed, in settlement time', async () => {
    let skew = 0;
    const world = await serveWorld({ now: () => Date.now() + skew });
    try {
      const s = startSeller({ world });
      const buyer = await freshBuyer(world);
      const { token } = await propose(s, buyer, proposalFor(buyer));
      await statusUntil(s, token, (x) => x.status === 'offered');
      expect(await (await s.call('/health')).json()).toEqual({ status: 'operational', open: 1 });
      skew = 2 * 3_600_000;
      const expired = await statusUntil(s, token, (x) => x.deal === 'expired');
      expect(expired.detail).toMatch(/did not agree and fund/);
      expect((await (await s.call('/health')).json()).open).toBe(0);
      await s.stop();
    } finally {
      await world.close();
    }
  });

  it('bounds the buyer\'s loss when the seller stalls after funding: the buyer reclaims at deliverBy', async () => {
    let skew = 0;
    const world = await serveWorld({ now: () => Date.now() + skew });
    try {
      const timing = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 1200, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
      const storage = new MemoryStorage();
      const seed = generatePrivateKey();
      const s = startSeller({ world, timing, storage, seed });
      const buyer = await freshBuyer(world);
      const { token } = await propose(s, buyer, proposalFor(buyer));
      const offered = await statusUntil(s, token, (x) => x.status === 'offered');
      await s.stop(); // the seller goes down before it sees Held
      const before = BigInt((await buyer.call('GET', `/v1/balances/${buyer.address}`)).amount);
      const held = await checkAndFund(buyer, offered.commitmentId, offered.seller);
      expect(held.escrowState).toBe('Held');
      skew = 1300_000;
      const reclaimed = await buyer.call('POST', `/v1/commitments/${offered.commitmentId}/triggers/reclaim`, {});
      expect(reclaimed.escrowState).toBe('Refunded');
      const after = BigInt((await buyer.call('GET', `/v1/balances/${buyer.address}`)).amount);
      const schedule = await buyer.operatorFeeSchedule();
      // Down only the operator fee: the price and the adjudication fee came back.
      expect(before - after).toBe(schedule ? operatorFeeOf({ token: pin.token.id, amount: PRICE_UNITS }, schedule) : 0n);
      // The seller comes back and closes the deal it can no longer act on, freeing its slot.
      const back = startSeller({ world, timing, storage, seed });
      const closed = await statusUntil(back, token, (x) => x.deal === 'refunded');
      expect(closed.detail).toMatch(/reclaimed its hold/);
      expect(await (await back.call('/health')).json()).toEqual({ status: 'operational', open: 0 });
      await back.stop();
    } finally {
      await world.close();
    }
  });
});

// T-420: the four named offers, one per ending an outsider needs to see. The judged offers meet a panel that stands
// in for the live models: it reads the text against the rubric the way a careful judge would, failing a text that says
// the seller is paid at once (BAD_SUMMARY) and passing the rest. The world calls it live, within a daily budget.
const IDS = '6. "criteria" must contain each of these ids exactly once: ';
const standIn = { complete: async (req: { system: string; user: string }) => {
  const ids = (req.system.split('\n').find((l) => l.startsWith(IDS)) ?? IDS).slice(IDS.length).replace(/\.$/, '').split(', ').filter((x) => x && x !== '(none)');
  const fails = /rating/.test(req.user);
  return { kind: 'ok' as const, text: JSON.stringify({ criteria: ids.map((id) => ({ id, score: fails ? 0 : 4, evidence: fails ? 'It contradicts the facts.' : 'It states the facts.' })), overall: fails ? 'fail' : 'pass', injectionSuspected: false, rationale: fails ? 'stand-in: fail' : 'stand-in: pass' }), latencyMs: 1 };
} };
const JUDGED = { price: SUMMARY_PRICE_UNITS, acceptance: { deterministicChecks: SUMMARY_CHECKS, rubric: SUMMARY_RUBRIC } };
const named = (buyer: Agent, offer: string, extra: J = {}) => ({ ...proposalFor(buyer), offer, ...extra });
const judgedProposal = (buyer: Agent, offer: string) => named(buyer, offer, { want: 'a summary of the payment hold', budget: { token: pin.token.id, amount: SUMMARY_PRICE_UNITS, covers: 'price' }, terms: { price: { token: pin.token.id, amount: SUMMARY_PRICE_UNITS }, deliverable: SUMMARY, template: 'default', disclosure: 'public', checks: SUMMARY_CHECKS, rubric: SUMMARY_RUBRIC } });

describe("the test seller's named offers (T-420)", () => {
  let judged: TestWorld;
  beforeAll(async () => {
    judged = await serveWorld({ judgeProvider: standIn, liveCallsPerDay: 1000 });
  });
  afterAll(() => judged.close());

  it('lists four offers by name on its card and its page, customers-3 first, each with its terms, fees and ending', async () => {
    const s = startSeller({ world: judged });
    const card = await (await s.call('/agent.json')).json();
    expect(card.offers.map((o: J) => o.id)).toEqual(['customers-3', 'summary-judged', 'summary-judged-fails', 'customers-3-silent']);
    for (const o of card.offers) {
      expect(typeof o.ends).toBe('string');
      expect(BigInt(o.fees.total.amount)).toBe(BigInt(o.terms.price.amount) + BigInt(o.fees.adjudication.amount) + BigInt(o.fees.operator.amount));
    }
    const [checked, pass, fail, silent] = card.offers;
    expect(checked.terms).toMatchObject({ template: 'checks-only', checks: CHECKS });
    expect(pass.terms).toMatchObject({ template: 'default', deliverable: SUMMARY, checks: SUMMARY_CHECKS, rubric: SUMMARY_RUBRIC });
    expect(fail.terms).toEqual(pass.terms);
    expect(silent.terms.timing).toEqual(SILENT_TIMING);
    expect(silent.terms.timing.deliverWithinSec).toBe(300);
    expect(card.limits.judgedPerDay).toBe(5);
    const html = await (await s.call('')).text();
    for (const o of card.offers) expect(html).toContain(o.id);
    await s.stop();
  });

  it('summary-judged: the checks pass, the panel passes the text, the deal releases, and the buyer opens it', async () => {
    const s = startSeller({ world: judged });
    const buyer = await freshBuyer(judged);
    const { token } = await propose(s, buyer, judgedProposal(buyer, 'summary-judged'));
    const offered = await statusUntil(s, token, (x) => x.status === 'offered');
    expect(offered).toMatchObject({ offer: 'summary-judged', countered: false, outcome: 'release' });
    await checkAndFund(buyer, offered.commitmentId, offered.seller, JUDGED);
    await statusUntil(s, token, (x) => x.deal === 'released', 30_000);
    const judgment = await buyer.call('GET', `/v1/commitments/${offered.commitmentId}/judgment`);
    expect(judgment.deterministic.every((c: J) => c.passed)).toBe(true);
    expect(judgment.aggregate.decision).toBe('accept');
    expect(judgment.panel.members.length).toBeGreaterThan(0);
    expect(await buyer.openDelivery(offered.commitmentId)).toBe(GOOD_SUMMARY);
    await s.stop();
  });

  it('summary-judged-fails: the checks pass, the panel rejects the text, and the price comes back', async () => {
    const s = startSeller({ world: judged });
    const buyer = await freshBuyer(judged);
    const { token } = await propose(s, buyer, judgedProposal(buyer, 'summary-judged-fails'));
    const offered = await statusUntil(s, token, (x) => x.status === 'offered');
    expect(offered).toMatchObject({ offer: 'summary-judged-fails', countered: false, outcome: 'refund' });
    await checkAndFund(buyer, offered.commitmentId, offered.seller, JUDGED);
    const done = await statusUntil(s, token, (x) => x.deal === 'refunded', 30_000);
    expect(done.outcome).toBe('refund');
    const judgment = await buyer.call('GET', `/v1/commitments/${offered.commitmentId}/judgment`);
    expect(judgment.deterministic.every((c: J) => c.passed)).toBe(true);
    expect(judgment.aggregate.decision).toBe('reject');
    expect(judgment.panel.members.every((m: J) => m.verdict.overall === 'fail')).toBe(true);
    expect(BAD_SUMMARY).not.toMatch(/judge|ignore|instruction|score/i); // honest bad work, not an attack
    await s.stop();
  });

  it('customers-3-silent: the seller never delivers, and the buyer\'s hold comes back after the 5-minute deadline', async () => {
    let skew = 0;
    const world = await serveWorld({ now: () => Date.now() + skew });
    try {
      const s = startSeller({ world });
      const buyer = await freshBuyer(world);
      const { token } = await propose(s, buyer, named(buyer, 'customers-3-silent'));
      const offered = await statusUntil(s, token, (x) => x.status === 'offered');
      expect(offered).toMatchObject({ offer: 'customers-3-silent', countered: false, outcome: 'silent' });
      const terms = await buyer.trusted(`/v1/commitments/${offered.commitmentId}/terms`);
      expect(Date.parse(terms.timing.deliverBy) - Date.parse(terms.createdAt)).toBe(300_000);
      await checkAndFund(buyer, offered.commitmentId, offered.seller);
      await sleep(1000);
      expect((await buyer.call('GET', `/v1/commitments/${offered.commitmentId}`)).escrowState).toBe('Held');
      expect((await (await s.call(`/status?token=${token}`)).json()).deal).toBe('offered');
      skew = 310_000;
      const reclaimed = await buyer.call('POST', `/v1/commitments/${offered.commitmentId}/triggers/reclaim`, {});
      expect(reclaimed.escrowState).toBe('Refunded');
      const closed = await statusUntil(s, token, (x) => x.deal === 'refunded');
      expect(closed.detail).toMatch(/reclaimed its hold/);
      expect(closed.transactions?.map((t: J) => t.step) ?? []).not.toContain('delivered');
      await s.stop();
    } finally {
      await world.close();
    }
  });

  it('refuses an unknown offer, a test outcome on a named offer, and judged work past its daily budget, each with a reason', async () => {
    const s = startSeller({ world: judged, limits: { perClientPerHour: 10, judgedPerDay: 1 } });
    const buyer = await freshBuyer(judged);
    const unknown = await propose(s, buyer, named(buyer, 'poems'));
    expect((await statusUntil(s, unknown.token, (x) => x.status === 'failed')).detail).toMatch(/offer must be one of customers-3, summary-judged, summary-judged-fails, customers-3-silent/);
    const outcome = await propose(s, buyer, { ...judgedProposal(buyer, 'summary-judged'), test: { outcome: 'refund' } });
    expect((await statusUntil(s, outcome.token, (x) => x.status === 'failed')).detail).toMatch(/test\.outcome works only with the offer customers-3/);
    // Without "offer", a proposal for the summary is the judged offer that passes; without either, the dataset.
    const first = await propose(s, buyer, { ...judgedProposal(buyer, 'x'), offer: undefined });
    expect(await statusUntil(s, first.token, (x) => x.status === 'offered')).toMatchObject({ offer: 'summary-judged' });
    // A judged deal retried after a transient failure counts once: the first try's prepare fails with a 503.
    await s.stop();
    const storage = new MemoryStorage();
    const seed = generatePrivateKey();
    const r = startSeller({ world: judged, storage, seed, limits: { perClientPerHour: 10, judgedPerDay: 1 } });
    spyFetch((url, init) => url.endsWith('/v1/prepare/offer') && init?.method === 'POST', async () => new Response(JSON.stringify({ type: 'unavailable', detail: 'try again' }), { status: 503 }));
    const retried = await propose(r, buyer, judgedProposal(buyer, 'summary-judged'));
    expect(await statusUntil(r, retried.token, (x) => x.status === 'offered')).toMatchObject({ offer: 'summary-judged' });
    expect((await storage.get<unknown[]>('judged'))?.length).toBe(1);
    await r.stop();
    const again = startSeller({ world: judged, storage, seed, limits: { perClientPerHour: 10, judgedPerDay: 1 } });
    const second = await propose(again, buyer, judgedProposal(buyer, 'summary-judged-fails'));
    expect((await statusUntil(again, second.token, (x) => x.status === 'failed')).detail).toMatch(/1 judged offers today \(UTC\)/);
    const plain = await propose(again, buyer, proposalFor(buyer));
    expect(await statusUntil(again, plain.token, (x) => x.status === 'offered')).toMatchObject({ offer: 'customers-3', outcome: 'release' });
    await again.stop();
  });

  it('refuses judged work when the live panel cannot sit: no live budget left today, or a scripted panel', async () => {
    const spent = await serveWorld({ judgeProvider: standIn, liveCallsPerDay: 0 });
    try {
      const s = startSeller({ world: spent });
      const buyer = await freshBuyer(spent);
      const { token } = await propose(s, buyer, judgedProposal(buyer, 'summary-judged'));
      expect((await statusUntil(s, token, (x) => x.status === 'failed')).detail).toMatch(/live judge panel cannot sit/);
      await s.stop();
    } finally {
      await spent.close();
    }
    const s = startSeller(); // the default world has no live models: its panels are scripted
    const buyer = await freshBuyer();
    const { token } = await propose(s, buyer, judgedProposal(buyer, 'summary-judged'));
    expect((await statusUntil(s, token, (x) => x.status === 'failed')).detail).toMatch(/live judge panel cannot sit/);
    await s.stop();
  });
});

// T-312: the operators answer on api.crow.direct and api.escrow.stream alike, and advertise one of them. The seller
// accepts a ciphertext URI on either (its operators plus their aliases), and nothing else.
describe("the test seller's ciphertext store check", () => {
  const origins = ['https://api.crow.direct', 'https://api2.crow.direct', 'https://api.escrow.stream', 'https://api2.escrow.stream'];
  const id = `sha256:${'ab'.repeat(32)}`;
  it('accepts a ciphertext URI on an operator hostname, old or new', () => {
    for (const o of origins) expect(storeUri(new URL(`${o}/v1/ciphertext/${id}`), origins)).toBe(true);
  });
  it('refuses another host, another path, or a look-alike host', () => {
    expect(storeUri(new URL(`https://example.com/v1/ciphertext/${id}`), origins)).toBe(false);
    expect(storeUri(new URL(`https://api.crow.direct/v1/commitments/${id}`), origins)).toBe(false);
    expect(storeUri(new URL(`https://api.crow.direct.example.com/v1/ciphertext/${id}`), origins)).toBe(false);
  });
});
