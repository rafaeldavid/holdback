// The hosted seller (T-435, ADR-0037 section 11) on the in-process world, against the job stub with accounts: its page
// and card, a whole deal driven by the object's alarm, a reset of the object mid-deal, no secret in storage, logs,
// card or health, and the refusals of a bad bundle or a stray variable. The Durable Object's state is faked as
// apps/test-agents does: MemoryStorage with an alarm.
import type { Hex } from 'viem';
import { MemoryStorage } from '@holdback/demo-cloud';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { jobStubSellerApi, startJobStub, type JobStub } from '../../../examples/seller-adapter-job-stub.ts';
import { checkBundle, type HostedBundle } from './bundle.ts';
import { HostedSellerObject, journalStore, setupOf, workerFor, type Env } from './worker.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SECRETS = { JOBS_API_KEY: 'hosted-api-key-c41d0e', QUOTE_CREDENTIALS: 'hosted-quote-cred-77a2', READY_CREDENTIALS: 'hosted-ready-cred-90b3' };
const SLUG = 'example-audits';
const BASE = `https://crow.direct/agents/${SLUG}`;
const WS = 'ws-hosted-1';
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target'], properties: { target: { const: '{{target}}' } } } }],
};

class FakeStorage extends MemoryStorage {
  alarm: number | null = null;
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
}

let world: SimWorld;
let stub: JobStub | undefined;
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));
let logs: string[] = [];

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  vi.restoreAllMocks();
  await stub?.close();
  stub = undefined;
});

/** One seller's bundle: the job stub's API with the account pinned, its own template, a quote credential. */
function bundleFor(base: string, over: { config?: J; slug?: string; card?: J } = {}): HostedBundle {
  const api = jobStubSellerApi(base);
  delete api.result.files;
  api.quote.path = 'workspaces/{{workspace}}/estimates';
  api.start.path = 'workspaces/{{workspace}}/runs';
  api.workspace = { id: WS, resultPointer: '/run/workspace' };
  return {
    slug: over.slug ?? SLUG,
    card: over.card ?? { name: 'Example audits <b>&</b>', item: 'audit', description: 'A test seller for "hosted" deals.' },
    config: { template: 'template.json', scope: SCOPE_RULES, pollMs: 50, sellerApi: api, quoteAuth: { kind: 'bearer', env: 'QUOTE_CREDENTIALS' }, redelivery: { refetchEverySec: 0, readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } }, ...over.config },
    files: { 'template.json': JSON.stringify(TEMPLATE) },
  };
}
function envFor(extra: Record<string, unknown> = {}): Env {
  return { SELLER: undefined as never, OPERATOR_URLS: world.info.operators.join(','), SELLER_URL: BASE, HOLDBACK_KEY: acct('seller-1').privateKey, ...SECRETS, ...extra };
}
async function seller(o: { storage?: FakeStorage; bundle?: HostedBundle; env?: Env } = {}) {
  stub ??= await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 1, workspaces: true });
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
  const storage = o.storage ?? new FakeStorage();
  const object = new HostedSellerObject({ storage }, o.env ?? envFor(), setupOf(o.bundle ?? bundleFor(stub.base)));
  return { object, storage };
}
const get = (o: HostedSellerObject, path: string) => o.fetch(new Request(`${BASE}${path}`));
async function quote(o: HostedSellerObject, buyer: Agent, credential = SECRETS.QUOTE_CREDENTIALS): Promise<{ status: number; body: J }> {
  const res = await o.fetch(new Request(`${BASE}/quote`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) }));
  return { status: res.status, body: await res.json() };
}
async function fund(buyer: Agent, id: Hex) {
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
}
/** Runs the object's alarm, as Cloudflare would at each set time, until `ok`. */
async function alarmsUntil(o: HostedSellerObject, storage: FakeStorage, what: string, ok: () => Promise<boolean>, timeoutMs = 20_000) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    if (storage.alarm !== null) await o.alarm();
    if (await ok()) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = async (storage: FakeStorage, id: Hex) => ((await storage.get<J>(`deal:${id}`))?.stage as string | undefined);
const cardOf = (html: string) => JSON.parse(/<script type="application\/json" id="crow-agent">([\s\S]*?)<\/script>/.exec(html)![1]!);

describe('a hosted seller (T-435): its page, its card and its health', () => {
  it('serves the crow-agent card with the quote and defaults addresses, with the name escaped', async () => {
    const { object } = await seller();
    const page = await get(object, '');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<title>Example audits &lt;b&gt;&amp;&lt;/b&gt;</title>');
    expect(html).not.toContain('<b>&</b>');
    const card = cardOf(html);
    expect(card).toMatchObject({ type: 'crow-agent', name: 'Example audits <b>&</b>', seller: acct('seller-1').address.toLowerCase(), testTokensOnly: true });
    expect(card.offers).toEqual([{ id: 'audit', description: 'A test seller for "hosted" deals.', pricing: { kind: 'quoted', quote: `${BASE}/quote`, defaults: `${BASE}/defaults` } }]);
    expect(card.configSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await get(object, '/agent.json')).json()).toEqual(card);
    const defaults = await get(object, '/defaults');
    expect(defaults.status).toBe(200);
    expect(((await defaults.json()) as J).scope).toEqual(SCOPE_RULES);
    const health = (await (await get(object, '/health')).json()) as J;
    expect(health).toMatchObject({ status: 'operational', seller: SLUG, configSha256: card.configSha256, open: 0 });
    expect(JSON.stringify({ html, health })).not.toContain(WS); // the account is the configuration's, not the page's
  }, 30_000);

  it('the quote route takes the quote credential only', async () => {
    const { object } = await seller();
    expect((await quote(object, agent('buyer-1'), 'not-it')).status).toBe(401);
    expect((await quote(object, agent('buyer-1'), SECRETS.READY_CREDENTIALS)).status).toBe(401);
    expect(stub!.requests).toEqual([]); // nothing reached the seller's API
  }, 30_000);
});

describe('a hosted seller (T-435): deals', () => {
  it('a quote becomes an offer, and the alarm starts one job in the pinned account and delivers once', async () => {
    const { object, storage } = await seller();
    const buyer = agent('buyer-1');
    const q = await quote(object, buyer);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const id = q.body.commitmentId as Hex;
    expect(storage.alarm).not.toBeNull(); // an open deal sets the alarm
    await fund(buyer, id);
    await alarmsUntil(object, storage, 'the delivery', async () => (await stageOf(storage, id)) === 'delivered');
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(stub!.runs()).toHaveLength(1);
    expect(stub!.workspacesNamed).toEqual([WS, WS]);
    // No secret in the object's storage, its log lines, its card or its health.
    const stored = JSON.stringify([...(await storage.list({ prefix: '' })).entries()]);
    const shown = (await (await get(object, '')).text()) + JSON.stringify(await (await get(object, '/health')).json());
    for (const secret of [...Object.values(SECRETS), acct('seller-1').privateKey]) {
      expect(stored).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
      expect(shown).not.toContain(secret);
    }
    expect(logs.join('\n')).toContain(`serves POST ${BASE}/quote; journal in its Durable Object`);
    // One entry per deal and per replay: no single value grows with every quote.
    const keys = [...(await storage.list({ prefix: '' })).keys()];
    expect(keys).toContain(`deal:${id}`);
    expect(keys).not.toContain('journal');
  }, 45_000);

  it('a reset of the object after the job started starts no second job and delivers once', async () => {
    stub = await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 50, workspaces: true }); // the job runs a while
    const first = await seller();
    const buyer = agent('buyer-2');
    const id = (await quote(first.object, buyer)).body.commitmentId as Hex;
    await fund(buyer, id);
    await alarmsUntil(first.object, first.storage, 'the start', async () => (await stageOf(first.storage, id)) === 'started');
    // The object resets: nothing in memory survives; a new instance reads the same storage.
    const second = await seller({ storage: first.storage });
    await alarmsUntil(second.object, first.storage, 'the delivery', async () => (await stageOf(first.storage, id)) === 'delivered');
    expect(stub!.runs()).toHaveLength(1);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
  }, 45_000);
});

describe('a hosted seller (T-435): a start that cannot be repeated', () => {
  it('a lost start answer, then a reset of the object: no second start, and the deal waits for a person', async () => {
    stub = await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 1, workspaces: true, failFirstStart: true });
    const b = bundleFor(stub.base);
    (b.config as J).sellerApi.start.repeatable = false; // the company's API would charge a second start
    const first = await seller({ bundle: b });
    const buyer = agent('buyer-1');
    const id = (await quote(first.object, buyer)).body.commitmentId as Hex;
    await fund(buyer, id);
    await alarmsUntil(first.object, first.storage, 'start-unknown', async () => (await stageOf(first.storage, id)) === 'start-unknown');
    const second = await seller({ storage: first.storage, bundle: b });
    for (let i = 0; i < 5; i++) await second.object.alarm();
    expect(await stageOf(first.storage, id)).toBe('start-unknown');
    expect(stub!.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/runs'))).toHaveLength(1);
    expect(stub!.runs()).toHaveLength(1);
    const health = (await (await get(second.object, '/health')).json()) as J;
    expect(health.stages).toEqual({ 'start-unknown': 1 });
  }, 45_000);
});

describe('a hosted seller (T-435): refusals', () => {
  it('a stray HOLDBACK_ variable, a SELLER_URL for another seller, or unreachable operators: degraded, and the alarm never throws', async () => {
    for (const [env, reason] of [
      [envFor({ HOLDBACK_DEPLOYMENT: '{}' }), 'HOLDBACK_DEPLOYMENT is set on this Worker'],
      [envFor({ SELLER_URL: 'https://crow.direct/agents/someone-else' }), 'SELLER_URL is https://crow.direct/agents/someone-else'],
      [envFor({ OPERATOR_URLS: 'http://127.0.0.1:9,http://localhost:9' }), 'did not start'],
    ] as const) {
      const { object, storage } = await seller({ env });
      const health = await get(object, '/health');
      expect(health.status).toBe(503);
      expect(((await health.json()) as J).reason).toBe('the seller could not start; its log says why'); // the detail is the log's
      expect(logs.join('\n')).toContain(reason);
      const again = await get(object, '/quote'); // within the minute after a failed start: 503 at once, no second start
      expect(again.status).toBe(503);
      await expect(object.alarm()).resolves.toBeUndefined();
      expect(storage.alarm).not.toBeNull(); // it tries again later
    }
  }, 30_000);

  it('a bundle that names a Worker variable or a HOLDBACK_ variable for a credential, a reserved slug, or a Node-only field', () => {
    const base = 'http://127.0.0.1:1/api/v2/';
    expect(() => checkBundle(bundleFor(base, { config: { quoteAuth: { kind: 'bearer', env: 'OPERATOR_URLS' } } }))).toThrow('names OPERATOR_URLS for a credential, which the Worker keeps for itself');
    expect(() => checkBundle(bundleFor(base, { config: { redelivery: { readyAuth: { kind: 'bearer', env: 'HOLDBACK_SPARE' } } } }))).toThrow('names HOLDBACK_SPARE for a credential');
    for (const slug of ['test-seller', 'test-buyer-2', 'Upper', 'a--b', '-a', 'x'.repeat(41)]) expect(() => checkBundle(bundleFor(base, { slug })), slug).toThrow(/^slug /);
    for (const k of ['journal', 'port', 'events']) expect(() => checkBundle(bundleFor(base, { config: { [k]: 'x' } })), k).toThrow(`config.${k} is for the adapter on Node`);
    expect(() => checkBundle(bundleFor(base, { config: { template: 'missing.json' } }))).toThrow('names missing.json, and the bundle holds no such file');
    expect(() => checkBundle(bundleFor(base, { card: { name: 'x', item: 'a b' } }))).toThrow('card.item must be');
    expect(checkBundle(bundleFor(base)).credentialVars.sort()).toEqual(['JOBS_API_KEY', 'QUOTE_CREDENTIALS', 'READY_CREDENTIALS']);
  });

  it('a bad bundle serves nothing: every request answers 503', async () => {
    const setup = setupOf({ ...bundleFor('http://127.0.0.1:1/api/v2/'), slug: 'test-seller' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const object = new HostedSellerObject({ storage: new FakeStorage() }, envFor(), setup);
    expect((await object.fetch(new Request('https://crow.direct/agents/test-seller'))).status).toBe(503);
    expect((await workerFor(setup).fetch(new Request('https://crow.direct/agents/test-seller'), envFor())).status).toBe(503);
  });
});

describe('the hosted seller Worker (T-435): routes', () => {
  it("passes the seller's own paths to its object, and nothing else", async () => {
    const forwarded: string[] = [];
    const namespace = { idFromName: (n: string) => n, get: (id: unknown) => ({ fetch: async (r: Request) => (forwarded.push(`${String(id)} ${new URL(r.url).pathname}`), new Response('ok')) }) };
    const worker = workerFor(setupOf(bundleFor('http://127.0.0.1:1/api/v2/')));
    const env = { ...envFor(), SELLER: namespace as never };
    for (const p of [`/agents/${SLUG}`, `/agents/${SLUG}/`, `/agents/${SLUG}/quote`, `/agents/${SLUG}/deals/0xab/job`]) expect((await worker.fetch(new Request(`https://crow.direct${p}`), env)).status, p).toBe(200);
    for (const p of [`/agents/${SLUG}x`, '/agents/test-seller', '/agents', '/']) expect((await worker.fetch(new Request(`https://crow.direct${p}`), env)).status, p).toBe(404);
    expect(forwarded).toEqual([`crow-hosted-seller-${SLUG} /agents/${SLUG}`, `crow-hosted-seller-${SLUG} /agents/${SLUG}/`, `crow-hosted-seller-${SLUG} /agents/${SLUG}/quote`, `crow-hosted-seller-${SLUG} /agents/${SLUG}/deals/0xab/job`]);
  });
});

describe('the hosted seller\'s journal store (T-435)', () => {
  it('keeps one entry per deal and per replay, writes only what changed, in parts of 128, and loads the same journal', async () => {
    const storage = new FakeStorage();
    const puts: number[] = [];
    const put = storage.put.bind(storage);
    storage.put = async (entries: Record<string, unknown>) => (puts.push(Object.keys(entries).length), put(entries));
    const store = journalStore(storage, () => {});
    const deals = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`0x${i.toString(16).padStart(64, '0')}`, { id: `0x${i}`, stage: 'offered' }]));
    const journal: J = { deals, quotes: { k1: { bodyHash: 'h', answer: { commitmentId: '0x1' } } }, mandatesSeen: ['0xab club'] };
    store.save(journal);
    await new Promise((r) => setTimeout(r, 0));
    expect(puts).toEqual([128, 4]); // 130 deals, 1 replay, 1 mandate list
    store.save(journal); // nothing changed: nothing written
    journal.deals[Object.keys(deals)[5]!].stage = 'starting';
    store.save(journal);
    await new Promise((r) => setTimeout(r, 0));
    expect(puts).toEqual([128, 4, 1]);
    expect(await journalStore(storage, () => {}).load()).toEqual(journal);
    expect(await journalStore(new FakeStorage(), () => {}).load()).toBeUndefined();
  });
});
