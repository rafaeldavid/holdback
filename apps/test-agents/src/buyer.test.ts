// Crow's test buyer against the public demo's own world, served on two origins in this process: an outside seller's
// agent reads the buyer's card, offers on Crow naming the buyer, and posts the commitment ID to the buyer's intake,
// over HTTP only, as site/llms.txt "Sell to Crow's test buyer" describes.
import { MemoryStorage } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { commitmentIdOf, freshNonce, knownPins, typedOf, type Pin } from '../../../examples/verify.ts';
import { BUYER_LIMITS, TestBuyer, type BuyerLimits } from './buyer.ts';
import { BAD_CSV, CHECKS, DELIVERABLE, GOOD_CSV } from './catalog.ts';
import { serveWorld, type TestWorld } from './test-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const BASE = 'https://crow.direct/agents/test-buyer';
const pin = knownPins()[0]!; // SimChain, as the in-process world settles
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PRICE = { token: pin.token.id, amount: '25000000' };
const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 1200, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 60 };
/** An address on a port nobody listens on: an operator that is offline. */
const OFFLINE = 'http://127.0.0.1:9';

let demo: TestWorld;
beforeAll(async () => {
  demo = await serveWorld();
});
afterAll(() => demo.close());
afterEach(() => {
  vi.restoreAllMocks();
});

type Started = ReturnType<typeof startBuyer>;
/** A buyer with its own storage and secret, worked in the background the way the Durable Object's alarm works it. */
function startBuyer(o: { limits?: BuyerLimits; world?: TestWorld; storage?: MemoryStorage; seed?: string; operators?: string[]; run?: boolean } = {}) {
  const world = o.world ?? demo;
  const buyer = new TestBuyer({ storage: o.storage ?? new MemoryStorage(), operators: o.operators ?? world.urls, seed: o.seed ?? generatePrivateKey(), pin, base: BASE, log: () => {}, ...(o.limits ? { limits: o.limits } : {}) });
  // run: false leaves the work to the test, one pass at a time.
  let running = o.run ?? true;
  const loop = (async () => {
    while (running) {
      await buyer.work();
      await sleep(50);
    }
  })();
  const call = (path: string, init: RequestInit = {}, client = '203.0.113.7') => buyer.fetch(new Request(`${BASE}${path}`, init), client);
  return { buyer, call, world, stop: async () => { running = false; await loop; } };
}

/** A different documentation address each call by default, so the per-client caps stay out of tests about other rules. */
let clients = 0;
const nextClient = () => `198.18.${Math.floor(++clients / 250)}.${clients % 250}`;
const postOffer = (s: Started, body: unknown, client = nextClient()) => s.call('/offers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, client);

async function freshSeller(world = demo): Promise<Agent> {
  const seller = new Agent(world.urls, generatePrivateKey(), nacl.randomBytes(32), pin.domain);
  await seller.call('POST', '/v1/faucet', { address: seller.address });
  return seller;
}

/** The outside seller's side: read the buyer's card and discovery, offer on Crow naming the buyer, as section 5 does. */
async function offerTo(s: Started, seller: Agent, over: J = {}): Promise<{ id: Hex; terms: J }> {
  const card = await (await s.call('/agent.json')).json();
  const found = await seller.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  const role = (r: string) => found.adjudicators.find((a: J) => a.role === r).address;
  const { id, terms } = await seller.offer({
    template: 'checks-only', clubId: found.clubId, seller: seller.address,
    buyer: { address: card.buyer, encryptionPublicKey: card.buyerEncryptionPublicKey },
    adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
    price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING, ...over,
  });
  return { id, terms };
}

async function statusUntil(s: Started, id: string, done: (x: J) => boolean, timeoutMs = 30_000): Promise<J> {
  let x: J;
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(100)) {
    x = await (await s.call(`/status/${id}`)).json();
    if (done(x)) return x;
  }
  throw new Error(`status stayed ${JSON.stringify(x)}`);
}

/** Records every fetch that `match` picks, with its idempotency key and body, and makes the first one act as `act`. */
function spyFetch(match: (url: string, init?: RequestInit) => boolean, act?: (real: typeof fetch, url: string, init?: RequestInit) => Promise<Response>) {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; key: string | null; body: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (match(url, init)) {
      calls.push({ url, key: new Headers(init?.headers).get('idempotency-key'), body: String(init?.body ?? '') });
      if (calls.length === 1 && act) return act(real, url, init);
    }
    return real(input, init);
  });
  return calls;
}

describe("Crow's test buyer", () => {
  it('publishes what it accepts: its address and key, the token, its largest price, the windows, the checks, its limits', async () => {
    const s = startBuyer();
    const card = await (await s.call('/agent.json')).json();
    expect(card.type).toBe('crow-buyer');
    expect(card.buyer).toBe(s.buyer.agent.address);
    expect(card.buyerEncryptionPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(card.intake).toMatchObject({ api: `${BASE}/offers`, status: `${BASE}/status/<commitmentId>` });
    expect(card.accepts.token).toBe(pin.token.id);
    expect(card.accepts.maxPrice).toEqual({ token: pin.token.id, amount: '50000000' });
    expect(card.accepts.template).toBe('checks-only');
    expect(card.accepts.checks.types).toContain('row_count_range');
    expect(card.accepts.checks.requiredAtLeast).toBe(1);
    expect(card.accepts.windows).toMatchObject({ maxDeliverWithinSec: 86_400, maxJudgingSec: 3600, maxCreatedAheadSec: 60, maxAdjudicatorAcceptSec: 120 });
    expect(card.accepts.adjudicators).toMatchObject({ primary: expect.stringMatching(/^0x/), fallback: expect.stringMatching(/^0x/), appeal: expect.stringMatching(/^0x/) });
    expect(card.limits).toMatchObject({ perSellerPerHour: 3, perSellerPerDay: 10, perDay: 50, open: 10, perClientPerMinute: 6, perClientPerHour: 60 });
    expect(card.testTokensOnly).toBe(true);
    const page = await s.call('');
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await page.text();
    const block = /<script type="application\/json" id="crow-buyer">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(JSON.parse(block!)).toEqual(card);
    expect(html).toMatch(/Test tokens only/);
    expect(await (await s.call('/health')).json()).toMatchObject({ status: 'operational', open: 0 });
    await s.stop();
  });

  it('agrees and funds an offer that fits its rules, and a delivery that passes the checks ends Released', async () => {
    const s = startBuyer();
    const seller = await freshSeller();
    const { id, terms } = await offerTo(s, seller);
    const res = await postOffer(s, { commitmentId: id });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ commitmentId: id, status: `${BASE}/status/${id}` });
    // The same ID again is the same deal: no second agreement.
    expect((await postOffer(s, { commitmentId: id })).status).toBe(200);
    expect((await statusUntil(s, id, (x) => x.status === 'funded')).seller).toBe(seller.address);
    await seller.waitFor(id, ['Held']);
    await seller.deliver(terms, new TextEncoder().encode(GOOD_CSV));
    const done = await statusUntil(s, id, (x) => x.status === 'released');
    expect(done.detail).toMatch(/passed the agreed checks/);
    expect((await seller.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Released');
    const events = (await seller.call('GET', `/v1/commitments/${id}/events?limit=200`)).items;
    expect(events.filter((e: J) => e.type === 'hold.funded')).toHaveLength(1);
    await s.stop();
  });

  it('ends Refunded when the delivery fails a check', async () => {
    const s = startBuyer();
    const seller = await freshSeller();
    const { id, terms } = await offerTo(s, seller);
    expect((await postOffer(s, { commitmentId: id })).status).toBe(202);
    await seller.waitFor(id, ['Held']);
    await seller.deliver(terms, new TextEncoder().encode(BAD_CSV));
    const done = await statusUntil(s, id, (x) => x.status === 'refunded');
    expect(done.detail).toMatch(/failed the agreed checks/);
    const judgment = await seller.call('GET', `/v1/commitments/${id}/judgment`);
    expect(judgment.deterministic.find((c: J) => c.checkId === 'rows').passed).toBe(false);
    await s.stop();
  });

  it('sends the reclaim itself once deliverBy passes with nothing delivered, and gets its hold back', async () => {
    let skew = 0;
    const world = await serveWorld({ now: () => Date.now() + skew });
    try {
      const s = startBuyer({ world });
      const seller = await freshSeller(world);
      const { id, terms } = await offerTo(s, seller);
      expect((await postOffer(s, { commitmentId: id })).status).toBe(202);
      await statusUntil(s, id, (x) => x.status === 'funded');
      const before = BigInt((await seller.call('GET', `/v1/balances/${s.buyer.agent.address}`)).amount);
      const reclaims = spyFetch((url, init) => init?.method === 'POST' && url.endsWith('/triggers/reclaim'));
      // Just past deliverBy: the operators wait a minute before they send it, so the buyer is first.
      skew = Date.parse(terms.timing.deliverBy) - Date.now() + 5000;
      const done = await statusUntil(s, id, (x) => x.status === 'reclaimed');
      expect(done.reclaimedBy).toBe('buyer');
      expect(reclaims.length).toBeGreaterThanOrEqual(1);
      expect(reclaims.every((c) => c.key === reclaims[0]!.key && c.key)).toBe(true);
      const after = BigInt((await seller.call('GET', `/v1/balances/${s.buyer.agent.address}`)).amount);
      // The price and the adjudication fee came back; only the operator's fee, paid at funding, stays spent.
      expect(after - before).toBe(BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount));
      await s.stop();
    } finally {
      await world.close();
    }
  });

  it('refuses an offer that breaks a published rule, naming the rule, and keeps nothing of it', async () => {
    const s = startBuyer();
    const seller = await freshSeller();
    const cases: Array<[J, string]> = [
      [{ price: { token: pin.token.id, amount: '50000001' } }, 'accepts.maxPrice'],
      [{ checks: [{ id: 'cols', type: 'csv_columns_exact', required: false, columns: ['customer_id', 'email'] }] }, 'accepts.checks.requiredAtLeast'],
      // A minute over the day: the window counts from settlement time at the post, a few seconds after createdAt.
      [{ timing: { ...TIMING, deliverWithinSec: 86_460, fundWithinSec: 900 } }, 'accepts.windows.maxDeliverWithinSec'],
      [{ timing: { ...TIMING, appealWindowSec: 3601 } }, 'accepts.windows.maxJudgingSec'],
    ];
    for (const [over, rule] of cases) {
      const { id } = await offerTo(s, seller, over);
      const res = await postOffer(s, { commitmentId: id });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.rule).toBe(rule);
      expect(body.error).toMatch(/\S/);
      expect((await s.call(`/status/${id}`)).status).toBe(404);
    }
    // An offer to another buyer is not one this buyer can take.
    const other = new Agent(demo.urls, generatePrivateKey(), nacl.randomBytes(32), pin.domain);
    const { id: elsewhere } = await offerTo(s, seller, { buyer: { address: other.address, encryptionPublicKey: other.encryptionPublicKey } });
    expect((await (await postOffer(s, { commitmentId: elsewhere })).json()).rule).toBe('buyer');
    const bad = await postOffer(s, { commitmentId: '0x1234' });
    expect(bad.status).toBe(400);
    expect((await postOffer(s, { commitmentId: `0x${'ab'.repeat(32)}` })).status).toBe(404);
    await s.stop();
  });

  it('accepts only declarative checks of the types it publishes', async () => {
    const { checkTerms } = await import('./buyer.ts');
    const s = startBuyer();
    const seller = await freshSeller();
    const { id, terms } = await offerTo(s, seller);
    const ctx = await s.buyer.context();
    expect(checkTerms(id, terms, ctx)).toBeNull();
    // Other terms are another commitment: each is checked under its own ID.
    const check = (t: J) => checkTerms(commitmentIdOf(t), t, ctx)?.rule;
    expect(checkTerms(id, { ...terms, price: { ...terms.price, amount: '1' } }, ctx)?.rule).toBe('commitmentId');
    expect(check({ ...terms, acceptance: { ...terms.acceptance, deterministicChecks: [{ id: 'x', type: 'run_script', required: true, script: 'rm -rf /' }] } })).toBe('accepts.checks.types');
    expect(check({ ...terms, acceptance: { ...terms.acceptance, deterministicChecks: [] } })).toBe('accepts.checks.min');
    expect(check({ ...terms, acceptance: { ...terms.acceptance, rubric: { criteria: [{ id: 'q', text: 'is it good' }], passThreshold: 1 } } })).toBe('accepts.template');
    await s.stop();
  });

  it('caps deals per seller an hour, answering 429 with the rule and when to retry', async () => {
    const s = startBuyer({ limits: { ...BUYER_LIMITS, perSellerPerHour: 1 } });
    const seller = await freshSeller();
    expect((await postOffer(s, { commitmentId: (await offerTo(s, seller)).id })).status).toBe(202);
    const over = await postOffer(s, { commitmentId: (await offerTo(s, seller)).id });
    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body.rule).toBe('limits.perSellerPerHour');
    expect(body.retryAfterSec).toBeGreaterThan(0);
    // Another seller has its own count.
    expect((await postOffer(s, { commitmentId: (await offerTo(s, await freshSeller())).id })).status).toBe(202);
    await s.stop();
  });

  it('still funds and settles when one operator is offline', async () => {
    const s = startBuyer({ operators: [OFFLINE, demo.urls[1]] });
    const seller = await freshSeller();
    const { id, terms } = await offerTo(s, seller);
    expect((await postOffer(s, { commitmentId: id })).status).toBe(202);
    await statusUntil(s, id, (x) => x.status === 'funded');
    await seller.waitFor(id, ['Held']);
    await seller.deliver(terms, new TextEncoder().encode(GOOD_CSV));
    await statusUntil(s, id, (x) => x.status === 'released');
    await s.stop();
  });

  it('replays a funding whose answer was lost, after a restart, with the same key and body: one hold', async () => {
    const storage = new MemoryStorage();
    const seed = generatePrivateKey();
    const funds = spyFetch((url, init) => init?.method === 'POST' && /\/v1\/commitments\/0x[0-9a-f]{64}\/agree$/.test(url), async (real, url, init) => {
      await real(url, init); // the operator takes it; the answer never arrives
      throw new TypeError('fetch failed: injected after the operator answered');
    });
    const first = startBuyer({ storage, seed });
    const seller = await freshSeller();
    const { id } = await offerTo(first, seller);
    expect((await postOffer(first, { commitmentId: id })).status).toBe(202);
    for (const end = Date.now() + 20_000; funds.length === 0 && Date.now() < end; ) await sleep(50);
    await first.stop(); // the buyer goes down with the funding sent and no answer
    const back = startBuyer({ storage, seed });
    await statusUntil(back, id, (x) => x.status === 'funded');
    expect(funds.length).toBeGreaterThanOrEqual(2);
    expect(funds.every((f) => f.key === funds[0]!.key && f.body === funds[0]!.body)).toBe(true);
    const events = (await seller.call('GET', `/v1/commitments/${id}/events?limit=200`)).items;
    expect(events.filter((e: J) => e.type === 'hold.funded')).toHaveLength(1);
    await back.stop();
  });

  it("runs the outside seller's script end to end: offered, taken, funded, delivered, released", async () => {
    const { sellOnce } = await import('./sell-once.ts');
    const s = startBuyer();
    const lines: string[] = [];
    const { status } = await sellOnce({ operators: demo.urls, pin, buyer: (path, init) => s.call(path, init), log: (l) => lines.push(l), timeoutMs: 30_000 });
    expect(status.status).toBe('released');
    expect(lines.some((l) => /^Held: the test buyer agreed and funded/.test(l))).toBe(true);
    await s.stop();
  });

  it('refuses to start on a mainnet chain ID', () => {
    const mainnet: Pin = { ...pin, domain: { ...pin.domain, chainId: 1 } };
    expect(() => new TestBuyer({ storage: new MemoryStorage(), operators: demo.urls, seed: generatePrivateKey(), pin: mainnet, base: BASE })).toThrow(/chain 1 is not a test network/);
  });
});

/**
 * An offer whose every time is moved by `shiftMs`: the seller signs it itself, so nothing in the prepare step bounds
 * its createdAt against settlement time (the review's finding 1).
 */
async function offerShifted(s: Started, seller: Agent, shiftMs: number): Promise<{ id: Hex; terms: J }> {
  const card = await (await s.call('/agent.json')).json();
  const found = await seller.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  const role = (r: string) => found.adjudicators.find((a: J) => a.role === r).address;
  const request = {
    nonce: freshNonce(), disclosure: 'public', template: 'checks-only', clubId: found.clubId, seller: seller.address,
    buyer: { address: card.buyer, encryptionPublicKey: card.buyerEncryptionPublicKey },
    adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
    price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING,
  };
  const prepared = await seller.call('POST', '/v1/prepare/offer', request);
  const { id: _id, signatures: _s, ...terms } = prepared.submit.body; // eslint-disable-line @typescript-eslint/no-unused-vars
  const move = (ts: string) => {
    const iso = new Date(Date.parse(ts) + shiftMs).toISOString();
    return ts.includes('.') ? iso : iso.replace(/\.\d{3}Z$/, 'Z');
  };
  terms.createdAt = move(terms.createdAt);
  for (const k of ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy']) terms.timing[k] = move(terms.timing[k]);
  const id = commitmentIdOf(terms);
  const signature = await seller.account.signTypedData(typedOf('CommitmentTerms', terms, pin.domain));
  const res = await fetch(`${s.world.urls[0]}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ ...terms, id, signatures: { seller: signature } }) });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return { id, terms };
}

/** Answers every fetch that `match` picks with `answer()`, and counts them; every other fetch goes through. */
function stubFetch(match: (url: string, init?: RequestInit) => boolean, answer: () => Response) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!match(url, init)) return real(input, init);
    calls.push(url);
    return answer();
  });
  return calls;
}

// The independent review of PR 309 (roadmap row N69): each finding first as a failing test, then fixed.
describe("Crow's test buyer, the review's findings", () => {
  it('1. refuses an offer dated after settlement time, and counts the delivery window from settlement time', async () => {
    const s = startBuyer({ run: false });
    const seller = await freshSeller();
    // Dated 2099, with every window as short as an honest offer's: before the fix, the buyer took it and signed.
    const { id: postdated } = await offerShifted(s, seller, Date.parse('2099-01-01T00:00:00Z') - Date.now());
    const res = await postOffer(s, { commitmentId: postdated });
    expect(res.status).toBe(422);
    expect((await res.json()).rule).toBe('accepts.windows.maxCreatedAheadSec');
    expect((await s.call(`/status/${postdated}`)).status).toBe(404);
    // The same rule in the pure check, and the delivery window counted from settlement time, not from createdAt.
    const { checkTerms } = await import('./buyer.ts');
    const { id, terms } = await offerTo(s, seller);
    const ctx = await s.buyer.context();
    expect(checkTerms(id, terms, ctx)).toBeNull();
    const at = (ms: number) => new Date(ms).toISOString();
    const check = (t: J) => checkTerms(commitmentIdOf(t), t, ctx)?.rule;
    // Dated 3 days back, due in 20 minutes: inside a day from now, so it fits.
    expect(check({ ...terms, createdAt: at(ctx.now - 3 * 86_400_000) })).toBeUndefined();
    // Dated now, due in 2 days: over the day.
    const late = Date.parse(terms.timing.deliverBy) + 2 * 86_400_000;
    expect(check({ ...terms, timing: { ...terms.timing, deliverBy: at(late), judgeBy: at(late + 60_000), fallbackBy: at(late + 120_000) } })).toBe('accepts.windows.maxDeliverWithinSec');
    await s.stop();
  });

  it('2. sends one reclaim a pass when the operators refuse it, and waits at least 12 s before the next', async () => {
    let skew = 0;
    const world = await serveWorld({ now: () => Date.now() + skew });
    try {
      const s = startBuyer({ world });
      const seller = await freshSeller(world);
      const { id, terms } = await offerTo(s, seller);
      expect((await postOffer(s, { commitmentId: id })).status).toBe(202);
      await statusUntil(s, id, (x) => x.status === 'funded');
      await s.stop(); // from here the test runs each pass itself
      // As on Sepolia, where the head block trails the clock: the contract still says too early.
      const reclaims = stubFetch((url, init) => init?.method === 'POST' && url.endsWith('/triggers/reclaim'), () => new Response(JSON.stringify({ type: 'invalid_state', detail: 'deliverBy has not passed on chain' }), { status: 409, headers: { 'content-type': 'application/problem+json' } }));
      skew = Date.parse(terms.timing.deliverBy) - Date.now() + 5000;
      await s.buyer.work();
      expect(reclaims).toHaveLength(1);
      await s.buyer.work();
      expect(reclaims).toHaveLength(1);
      const status = await (await s.call(`/status/${id}`)).json();
      expect(status.status).toBe('funded');
      expect(status.detail).toMatch(/retrying: .*reclaim.*invalid_state/);
      expect(Date.parse(status.retryAt) - Date.now()).toBeGreaterThanOrEqual(11_000);
    } finally {
      await world.close();
    }
  });

  it('3. caps offers per client before it reads the operators, and keeps no client address', async () => {
    const storage = new MemoryStorage();
    const s = startBuyer({ run: false, storage, limits: { ...BUYER_LIMITS, perClientPerMinute: 2 } });
    const terms = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
    // Every operator read the buyer makes, counted and passed through.
    const counted = spyFetch(() => true);
    for (const n of [1, 2]) expect((await postOffer(s, { commitmentId: terms(n) }, '192.0.2.44')).status).toBe(404);
    const before = counted.length;
    expect(before).toBeGreaterThan(0);
    const over = await postOffer(s, { commitmentId: terms(3) }, '192.0.2.44');
    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body.rule).toBe('limits.perClientPerMinute');
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(counted).toHaveLength(before); // refused before any operator read
    expect((await postOffer(s, { commitmentId: terms(4) }, '192.0.2.45')).status).toBe(404);
    expect(JSON.stringify([...(await storage.list({ prefix: '' })).entries()])).not.toContain('192.0.2.');
    await s.stop();
  });

  it('4. takes no more than its open cap from concurrent posts', async () => {
    const s = startBuyer({ run: false, limits: { ...BUYER_LIMITS, open: 2, perSellerPerHour: 10 } });
    const seller = await freshSeller();
    const ids: Hex[] = [];
    for (let i = 0; i < 5; i++) ids.push((await offerTo(s, seller)).id);
    const answers = await Promise.all(ids.map(async (id) => {
      const r = await postOffer(s, { commitmentId: id });
      return { status: r.status, rule: (await r.json()).rule };
    }));
    expect(answers.filter((a) => a.status === 202)).toHaveLength(2);
    expect(answers.filter((a) => a.status === 429).every((a) => a.rule === 'limits.open')).toBe(true);
    expect(answers.filter((a) => a.status === 429)).toHaveLength(3);
    await s.stop();
  });

  it('5. waits while a deal is Agreed but not Held, and closes it when it expires, freeing its slot', async () => {
    const s = startBuyer({ run: false });
    const seller = await freshSeller();
    const { id } = await offerTo(s, seller);
    expect((await postOffer(s, { commitmentId: id })).status).toBe(202);
    let state = 'Agreed';
    const path = `/v1/commitments/${id}`;
    stubFetch((url, init) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path, () => new Response(JSON.stringify({ commitmentId: id, escrowState: state }), { headers: { 'content-type': 'application/json' } }));
    await s.buyer.work();
    expect((await (await s.call(`/status/${id}`)).json()).status).toBe('accepted');
    state = 'Expired';
    await s.buyer.work();
    const done = await (await s.call(`/status/${id}`)).json();
    expect(done.status).toBe('expired');
    expect((await (await s.call('/health')).json()).open).toBe(0);
    await s.stop();
  });
});
