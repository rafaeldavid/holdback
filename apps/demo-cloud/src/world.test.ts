// T-026, the public demo world: what the two Workers and the Durable Object serve, run in Node over HTTP.
// Two origins (127.0.0.1 and localhost on one port) stand in for the two operator Workers; a timer stands in
// for the Durable Object's alarm. The deal is the examples' agent (examples/agent.ts) with keys it made itself.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { LIVE_REGISTRY_URI, liveRegistry, markerFake, placeholderRegistry } from '@holdback/adjudicator';
import { encodePublicKey, generateEncryptionKeyPair } from '@holdback/core/crypto';
import { MemoryFeedbackStore } from '@holdback/operator';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';

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
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const node = host.startsWith('localhost') ? 1 : 0;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node, origin: `http://${host}`, client: client ?? req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = passes;
  const loop = (async () => {
    while (ticking) {
      await world.work();
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const r: Running = {
    world,
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
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
      expect(d.limits).toEqual({ reads: { limit: 1200, windowSec: 60, per: 'client' }, writes: { limit: 120, windowSec: 60, per: 'signer' }, idempotency: { replays: 'success-only', retention: 'process' } });
      expect(d.demo).toMatchObject({ clubId: 'demo-club', operators: urls, token: { id: 'tUSD', decimals: 6 }, minWindowSec: 2, faucet: { path: '/v1/faucet', grant: { token: 'tUSD', amount: '1000000000' }, perAddressEverySec: 3600, perClientPerWindow: 10 } });
      expect(d.demo.adjudicators.map((a: J) => a.role)).toEqual(['primary', 'fallback', 'appeal']);
      const root = (await (await fetch(`${u}/`)).json()) as J;
      expect(Object.keys(root).sort()).toEqual(Object.keys(d).sort());
      expect(root.demo.adjudicators).toEqual(d.demo.adjudicators);
      const llms = await (await fetch(`${u}/llms.txt`)).text();
      expect(llms).toMatch(/POST \/v1\/faucet/);
      expect(llms).toContain('https://escrow.stream/llms.txt');
    }
    // The two nodes sign receipts with different keys.
    const signers = await Promise.all(urls.map(async (u) => ((await (await fetch(`${u}/v1/status`)).json()) as J).receiptSigner));
    expect(new Set(signers).size).toBe(2);
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

    // Restarted with live judges, the primary refuses the delivery (registry_mismatch, docs/backlog.md) on every
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
    expect(new Set([...everything.keys()].map((k) => k.split(':')[0]))).toEqual(new Set(['meta', 'j', 'fa', 'ct', 'jr', 'rl', 'tm']));
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
