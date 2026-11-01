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
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Running {
  world: PublicWorld;
  urls: [string, string];
  close(): Promise<void>;
}
const running: Running[] = [];
afterEach(async () => void (await Promise.all(running.splice(0).map((r) => r.close()))));

/** Serves a world as two nodes: http://127.0.0.1:<port> is node 0, http://localhost:<port> node 1. */
async function serve(options: Partial<PublicWorldOptions> = {}, storage = new MemoryStorage()): Promise<Running> {
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const node = host.startsWith('localhost') ? 1 : 0;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node, origin: `http://${host}`, client: req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
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

  it('states what the demo is in discovery notes, llms.txt and GET /', async () => {
    const { urls } = await serve();
    for (const u of urls) {
      const d = (await (await fetch(`${u}/.well-known/holdback.json`)).json()) as J;
      expect(d.apiBaseUrl).toBe(u);
      expect(d.domain.chainId).toBe(31337);
      const notes = d.notes.join('\n');
      expect(notes).toMatch(/test tokens only/i);
      expect(notes).toMatch(/one shared simulated settlement layer/i);
      expect(notes).toMatch(/POST \/v1\/faucet/);
      expect(notes).toMatch(/scripted/i);
      expect(await (await fetch(`${u}/llms.txt`)).text()).toMatch(/POST \/v1\/faucet/);
    }
    const index = (await (await fetch(`${urls[1]}/`)).json()) as J;
    expect(index).toMatchObject({ clubId: 'demo-club', operators: urls, token: { symbol: 'tUSD', decimals: 6 } });
    expect(index.adjudicators.map((a: J) => a.role)).toEqual(['primary', 'fallback', 'appeal']);
    // The two nodes sign receipts with different keys.
    const signers = await Promise.all(urls.map(async (u) => ((await (await fetch(`${u}/v1/status`)).json()) as J).receiptSigner));
    expect(new Set(signers).size).toBe(2);
  });

  it('labels a rubric offer as judged by a scripted panel', async () => {
    const { urls } = await serve();
    const r = await post(`${urls[0]}/v1/prepare/offer`, { template: 'default' });
    expect(r.headers.get('holdback-notice')).toMatch(/scripted/);
    const c = await post(`${urls[0]}/v1/prepare/offer`, { template: 'checks-only' });
    expect(c.headers.get('holdback-notice')).toBeNull();
  });
});

/** The code-fix job from tools/sim/catalogue.json: a rubric deal a judge panel decides. */
async function rubricDeal(urls: string[], diff: string): Promise<{ id: string; state: J; buyer: Agent }> {
  const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
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
    const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
    expect(index.judges).toMatchObject({ panel: 'live', registry: { uri: LIVE_REGISTRY_URI, hash: liveRegistry().hash }, liveCallsPerDay: 7, liveCallsToday: 0 });
    expect(index.judges.models).toEqual(liveRegistry().active.map((e) => e.model));
    for (const a of index.adjudicators) expect(a.scriptedPanel).toBe(false);
    const regs = (await (await fetch(`${urls[0]}/v1/adjudicators`)).json()) as J;
    for (const r of regs.items ?? regs) expect(r.registry.hash).toBe(liveRegistry().hash);
    const notes = ((await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J).notes.join('\n');
    expect(notes).toMatch(/live judge panel/i);
    expect(notes).toMatch(/7 live judge calls a day/);
    const r = await post(`${urls[0]}/v1/prepare/offer`, { template: 'default' });
    expect(r.headers.get('holdback-notice')).toMatch(/live judge panel/);
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
    expect(((await (await fetch(`${urls[0]}/`)).json()) as J).judges.liveCallsToday).toBe(3);

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
    expect(((await (await fetch(`${b.urls[0]}/`)).json()) as J).judges.liveCallsToday).toBe(3);
  }, 90_000);

  it('without keys the panel is scripted, and the env decides: all three variables or none', async () => {
    const { urls } = await serve({ env: { HOLDBACK_ANTHROPIC_API_KEY: 'k' } });
    const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
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
    const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
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
    expect(((await (await fetch(`${second.urls[0]}/`)).json()) as J).minWindowSec).toBe(2);
    const again = new Agent(second.urls, generatePrivateKey(), nacl.randomBytes(32));
    expect((await again.call('GET', `/v1/commitments/${offer.id}`)).escrowState).toBe('Released');
    expect((await again.call('GET', `/v1/commitments/${offer.id}/judgment`)).commitmentId).toBe(offer.id);
    expect((await again.call('GET', `/v1/balances/${seller.address}`)).amount).toBe('1025000000');
  }, 60_000);
});
