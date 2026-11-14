// T-422: the operators' limits on abuse of the public API (docs/operator-threat-model.md). Each Worker refuses a flood
// and an oversized body before the World object; the World caps, per client and per operator, the deals the relayer
// funds and the ciphertext bytes it stores each UTC day; and no service limit refuses a replay of an accepted request.
// The limits are one operator's service protection: `neutrality.operator-daily-cap` shows a party one operator
// refuses completing its deal through the other.
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { DailyCaps, FLOOD_CEILING, MAX_BODY_BYTES, admitted, clientKey, secondsToUtcMidnight } from './limits.js';
import worker, { World, type Env } from './worker.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const closers: Array<() => Promise<void>> = [];
afterEach(async () => void (await Promise.all(closers.splice(0).map((c) => c()))));

/** One world served twice over HTTP: each server's requests count under its own client. */
async function serveWorld(options: Partial<PublicWorldOptions> = {}, storage = new MemoryStorage()) {
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
  const a = await serveTwoOrigins(world, { tickMs: 100, client: '198.51.100.7' });
  const b = await serveTwoOrigins(world, { client: '203.0.113.9' });
  closers.push(a.close, b.close);
  return { world, urls: a.urls, other: b.urls };
}

const freshAgent = (urls: string[]) => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
const post = (url: string, body: unknown, key?: string, extra: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...extra }, body: JSON.stringify(body) });
const postBytes = (url: string, bytes: Uint8Array, key: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'idempotency-key': key }, body: bytes });

/** Addresses the faucet granted: one grant per address an hour. */
const granted = new Set<string>();
/** A checks-only offer from a fresh seller to `buyer`, accepted by the demo primary; both agents hold faucet tokens. */
async function acceptedOffer(urls: string[], buyer: Agent) {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const seller = freshAgent(urls);
  for (const a of [buyer, seller]) {
    if (granted.has(a.address)) continue;
    await a.call('POST', '/v1/faucet', { address: a.address });
    granted.add(a.address);
  }
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
    timing: { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 0, appealDecideSec: 2 },
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  return { offer, seller };
}

/** Records the signed body and the answer of each funded agree the agents send, so a test can send the same one again. */
function captureAgrees(): { sent: Array<{ url: string; key: string; body: string; status: number; headers: Headers; answer: J }>; restore(): void } {
  const original = globalThis.fetch;
  const sent: Array<{ url: string; key: string; body: string; status: number; headers: Headers; answer: J }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const r = await original(input, init);
    const url = String(input);
    if (init?.method === 'POST' && /\/v1\/commitments\/0x[0-9a-f]+\/agree$/.test(url)) {
      sent.push({ url, key: new Headers(init.headers).get('idempotency-key') ?? '', body: String(init.body), status: r.status, headers: r.headers, answer: await r.clone().json() });
    }
    return r;
  }) as typeof fetch;
  return { sent, restore: () => void (globalThis.fetch = original) };
}

const expectRateLimited = (status: number, headers: Headers, body: J, retryAfterSec?: number) => {
  expect(status).toBe(429);
  expect(headers.get('content-type')).toBe('application/problem+json');
  expect(headers.get('link')).toMatch(/rate_limited>; rel="type"/);
  expect(body).toMatchObject({ type: 'rate_limited', status: 429, title: 'Too many requests' });
  expect(Number.isInteger(body.retryAfterSec) && body.retryAfterSec >= 1).toBe(true);
  expect(headers.get('retry-after')).toBe(String(body.retryAfterSec));
  if (retryAfterSec !== undefined) expect(body.retryAfterSec).toBe(retryAfterSec);
};

describe('the daily cap on deals the relayer funds, per client and per operator', () => {
  it('neutrality.operator-daily-cap: refused at one operator, the same signed funding goes through the other, and the deal is Released', async () => {
    const { urls, other } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      // The first deal of the day funds at node 0.
      const buyer = freshAgent(urls);
      const first = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(first.offer.terms, 30_000_000n);
      expect(capture.sent.at(-1)!.status).toBe(200);

      // The second is refused at node 0, with when to retry and where else to go.
      const second = await acceptedOffer(urls, buyer);
      await expect(buyer.agreeAndFund(second.offer.terms, 30_000_000n)).rejects.toThrow(/rate_limited/);
      const refused = capture.sent.at(-1)!;
      expectRateLimited(refused.status, refused.headers, refused.answer, secondsToUtcMidnight(Date.now()));
      expect(refused.answer.detail).toMatch(/at most 1 funded deal a day/);
      expect(refused.answer.detail).toMatch(/other operator|another operator/);
      expect(refused.answer.detail).toMatch(/settlement contract|settlement layer/);

      // Another client funds through node 0 at the same moment: the cap is this client's alone.
      const stranger = freshAgent(other);
      const theirs = await acceptedOffer(other, stranger);
      await stranger.agreeAndFund(theirs.offer.terms, 30_000_000n);
      expect(capture.sent.at(-1)!.status).toBe(200);

      // The same signed funding, sent unchanged to node 1, funds the deal; the seller delivers and it is Released.
      const at1 = await post(refused.url.replace(urls[0], urls[1]), JSON.parse(refused.body), 'retry-at-node-1');
      expect(at1.status).toBe(200);
      await second.seller.deliver(second.offer.terms, new TextEncoder().encode('customer_id,email\n1,ada@example.com\n'));
      expect((await buyer.waitFor(second.offer.id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    } finally {
      capture.restore();
    }
  }, 60_000);

  it('answers a replay of an accepted funding from the stored response while the client is over its cap', async () => {
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      const buyer = freshAgent(urls);
      const deal = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(deal.offer.terms, 30_000_000n);
      const accepted = capture.sent.at(-1)!;
      expect(accepted.status).toBe(200);
      const again = await post(accepted.url, JSON.parse(accepted.body), accepted.key);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(accepted.answer);
    } finally {
      capture.restore();
    }
  }, 60_000);

  it('counts a dry run and a refused funding as nothing, and keeps the count in storage across a reopen', async () => {
    const storage = new MemoryStorage();
    const first = await serveWorld({ fundedDealsPerClientPerDay: 1 }, storage);
    const buyer = freshAgent(first.urls);
    const capture = captureAgrees();
    try {
      const deal = await acceptedOffer(first.urls, buyer);
      // A dry run of the funding first: no gas, so no count.
      const prepared = await buyer.prepareAgreeAndFund(deal.offer.terms, 30_000_000n);
      expect(prepared.prepared).toBeTruthy();
      await buyer.agreeAndFund(deal.offer.terms, 30_000_000n);
      expect(capture.sent.at(-1)!.status).toBe(200);
    } finally {
      capture.restore();
    }
    for (const c of closers.splice(0)) await c();
    const second = await serveWorld({ fundedDealsPerClientPerDay: 1 }, storage);
    const buyer2 = freshAgent(second.urls);
    const deal2 = await acceptedOffer(second.urls, buyer2);
    await expect(buyer2.agreeAndFund(deal2.offer.terms, 30_000_000n)).rejects.toThrow(/rate_limited/);
  }, 60_000);
});

describe('the daily cap on ciphertext stored, per client and per operator', () => {
  it('refuses new bytes over the cap, takes bytes the store already holds, and answers a replay', async () => {
    const { urls, other } = await serveWorld({ ciphertextBytesPerClientPerDay: 100 });
    const a = new Uint8Array(80).fill(1);
    const b = new Uint8Array(80).fill(2);
    const first = await postBytes(`${urls[0]}/v1/ciphertext`, a, 'ct-a');
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const over = await postBytes(`${urls[0]}/v1/ciphertext`, b, 'ct-b');
    expectRateLimited(over.status, over.headers, await over.json(), secondsToUtcMidnight(Date.now()));
    // A replay, and the same bytes under a new key, store nothing new.
    const replay = await postBytes(`${urls[0]}/v1/ciphertext`, a, 'ct-a');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect((await postBytes(`${urls[0]}/v1/ciphertext`, a, 'ct-a-again')).status).toBe(200);
    // The other operator and the other client each count apart.
    expect((await postBytes(`${urls[1]}/v1/ciphertext`, b, 'ct-b-1')).status).toBe(200);
    expect((await postBytes(`${other[0]}/v1/ciphertext`, new Uint8Array(80).fill(3), 'ct-c')).status).toBe(200);
  });
});

describe('no service limit refuses a replay (the operator\'s throttle)', () => {
  it('answers a replayed write, a replayed faucet grant and a replayed upload once the client\'s write budget is spent', async () => {
    const { urls } = await serveWorld({ rateLimit: { writes: 2, reads: 1000, windowMs: 60_000 } });
    const a = freshAgent(urls);
    const granted = await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'grant-1');
    expect(granted.status).toBe(200);
    const grantedBody = await granted.json();
    const upload = await postBytes(`${urls[0]}/v1/ciphertext`, new Uint8Array(10).fill(7), 'up-1');
    expect(upload.status).toBe(200);
    const uploadBody = await upload.json();
    const spent = await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'grant-2');
    expectRateLimited(spent.status, spent.headers, await spent.json());
    // The replays, with the same keys and bodies, are answered as before.
    const again = await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'grant-1');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(grantedBody);
    const reupload = await postBytes(`${urls[0]}/v1/ciphertext`, new Uint8Array(10).fill(7), 'up-1');
    expect(reupload.status).toBe(200);
    expect(await reupload.json()).toEqual(uploadBody);
    // A known key with another body is no way around the throttle.
    const otherBody = await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'grant-1');
    expect(otherBody.status).toBe(429);
    // Nor is a dry run under a known key.
    const dry = await post(`${urls[0]}/v1/faucet?validateOnly=true`, { address: a.address }, 'grant-1');
    expect(dry.status).toBe(429);
  });
});

describe('the replay path is bounded and opens no way around a limit (the coordinator\'s conditions, T-422)', () => {
  it('a replay flood meets its own budget, the size of the write budget, while another client still writes', async () => {
    const { urls, other } = await serveWorld({ rateLimit: { writes: 3, reads: 1000, windowMs: 60_000 } });
    const a = freshAgent(urls);
    const body = { address: a.address };
    expect((await post(`${urls[0]}/v1/faucet`, body, 'flood-1')).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await post(`${urls[0]}/v1/faucet`, body, 'flood-1')).status, `replay ${i + 1}`).toBe(200);
    const stopped = await post(`${urls[0]}/v1/faucet`, body, 'flood-1');
    expectRateLimited(stopped.status, stopped.headers, await stopped.json());
    // The flood spent only its own client's replay budget: another client writes and replays in the same window.
    const b = freshAgent(other);
    expect((await post(`${other[0]}/v1/faucet`, { address: b.address }, 'b-1')).status).toBe(200);
    expect((await post(`${other[0]}/v1/faucet`, { address: b.address }, 'b-1')).status).toBe(200);
    // And the flooding client's own write budget is untouched by its replays.
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'flood-2')).status).toBe(200);
  });

  it('the same key with another body is a 409 and counts as a write; another party\'s key replays nothing of theirs', async () => {
    const { urls, other } = await serveWorld({ rateLimit: { writes: 2, reads: 1000, windowMs: 60_000 } });
    const a = freshAgent(urls);
    expect((await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'k-a')).status).toBe(200);
    const conflict = await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'k-a');
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).type).toBe('idempotency_conflict');
    // Two writes are spent (the grant and the conflict), so the next one is refused.
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'k-c')).status).toBe(429);
    // Another client that guesses the key gets the stored answer only by sending the very same request, which is public
    // anyway (the faucet's answer names the address it granted); any other body under that key is a 409.
    const guess = await post(`${other[0]}/v1/faucet`, { address: freshAgent(other).address }, 'k-a');
    expect(guess.status).toBe(409);
  });

  it('caps the body before the replay lookup: an oversized body under a known key is a 413 and counts', async () => {
    const { urls } = await serveWorld({ rateLimit: { writes: 2, reads: 1000, windowMs: 60_000 } });
    const a = freshAgent(urls);
    expect((await post(`${urls[0]}/v1/faucet`, { address: a.address }, 'big-1')).status).toBe(200);
    const big = await fetch(`${urls[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'big-1' }, body: `{"address":"${'a'.repeat(MAX_BODY_BYTES)}"}` });
    expect(big.status).toBe(413);
    expect((await big.json()).maxBytes).toBe(MAX_BODY_BYTES);
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'big-2')).status).toBe(429);
  });
});

describe('the limits come from Worker variables and discovery states them', () => {
  it('reads each limit from its variable, publishes them under demo.limits, and refuses a malformed one at start', async () => {
    const env = { FUNDED_DEALS_PER_CLIENT_PER_DAY: '7', CIPHERTEXT_BYTES_PER_CLIENT_PER_DAY: '1048576', RATE_READS_PER_MIN: '600', RATE_WRITES_PER_MIN: '60' };
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env, minWindowSec: 2 });
    const { urls, close } = await serveTwoOrigins(world, {});
    closers.push(close);
    const d = (await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J;
    expect(d.limits.reads).toEqual({ limit: 600, windowSec: 60, per: 'client' });
    expect(d.limits.writes).toEqual({ limit: 60, windowSec: 60, per: 'signer' });
    expect(d.demo.limits).toMatchObject({ fundedDealsPerDay: 7, ciphertextBytesPerDay: 1_048_576, floodCeiling: { limit: FLOOD_CEILING.limit, windowSec: FLOOD_CEILING.periodSec } });
    expect(d.demo.limits.client).toMatch(/IPv4 address or an IPv6 \/64/);
    for (const bad of [{ FUNDED_DEALS_PER_CLIENT_PER_DAY: '-1' }, { CIPHERTEXT_BYTES_PER_CLIENT_PER_DAY: '1.5' }, { RATE_READS_PER_MIN: 'many' }, { RATE_WRITES_PER_MIN: '' }]) {
      await expect(PublicWorld.open({ storage: new MemoryStorage(), env: bad, minWindowSec: 2 }), JSON.stringify(bad)).rejects.toThrow(/must be a whole number/);
    }
  });

  it('keeps the defaults with no variables: 1,200 reads and 120 writes a minute, 100 funded deals and 256 MiB a day', async () => {
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: {}, minWindowSec: 2 });
    const { urls, close } = await serveTwoOrigins(world, {});
    closers.push(close);
    const d = (await (await fetch(`${urls[0]}/`)).json()) as J;
    expect([d.limits.reads.limit, d.limits.writes.limit]).toEqual([1200, 120]);
    expect([d.demo.limits.fundedDealsPerDay, d.demo.limits.ciphertextBytesPerDay]).toEqual([100, 268_435_456]);
  });
});

describe('DailyCaps', () => {
  it('opens again at 00:00 UTC and deletes the rows of past days', async () => {
    const storage = new MemoryStorage();
    let now = Date.parse('2026-11-14T23:59:00Z');
    const caps = new DailyCaps(storage, () => now, 'secret', { fundedDeals: 1, ciphertextBytes: 10 });
    expect((await caps.takeFunding(0, '198.51.100.7', 'fp-1')).ok).toBe(true);
    const refused = await caps.takeFunding(0, '198.51.100.7', 'fp-2');
    expect(refused).toEqual({ ok: false, retryAfterSec: 60 });
    // A replay of the accepted one is no new funding.
    expect((await caps.takeFunding(0, '198.51.100.7', 'fp-1')).ok).toBe(true);
    now = Date.parse('2026-11-15T00:00:01Z');
    expect((await caps.takeFunding(0, '198.51.100.7', 'fp-2')).ok).toBe(true);
    const rows = [...(await storage.list({ prefix: 'lc:' })).keys()];
    expect(rows.every((k) => k.startsWith('lc:2026-11-15:'))).toBe(true);
    // The rows name no address: the client is hashed with the world's secret.
    expect(rows.join()).not.toContain('198.51.100.7');
  });

  it('gives a funding back when the relay refused it', async () => {
    const caps = new DailyCaps(new MemoryStorage(), () => Date.parse('2026-11-14T12:00:00Z'), 'secret', { fundedDeals: 1, ciphertextBytes: 10 });
    const t = await caps.takeFunding(1, 'c', 'fp-1');
    expect(t.ok).toBe(true);
    await caps.settleFunding(1, 'c', 'fp-1', false);
    expect((await caps.takeFunding(1, 'c', 'fp-2')).ok).toBe(true);
  });
});

describe('clientKey', () => {
  it('counts an IPv4 address alone and an IPv6 address by its /64', () => {
    expect(clientKey('198.51.100.7')).toBe('198.51.100.7');
    expect(clientKey('2001:db8:1:2::5')).toBe('2001:0db8:0001:0002::/64');
    expect(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:0db8:0001:0002::/64');
    expect(clientKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(clientKey('unknown')).toBe('unknown');
  });
});

/** The two Workers over one fake World object (as worker.test.ts), with a flood binding the test controls. */
function edge(o: { flood?: boolean[]; metadata?: { id: string; timestamp: string } } = {}) {
  const forwarded: Request[] = [];
  const keys: string[] = [];
  const verdicts = [...(o.flood ?? [])];
  const FLOOD = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: verdicts.length ? verdicts.shift()! : true }) };
  const WORLD = { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => (forwarded.push(r), new Response('{}', { headers: { 'content-type': 'application/json' } })) }) };
  const env = (node: string): Env => ({ WORLD, NODE_INDEX: node, SETTLEMENT: 'sim', FLOOD, ...(o.metadata ? { CF_VERSION_METADATA: o.metadata } : {}) }) as unknown as Env;
  return { forwarded, keys, env };
}
const at = (path: string, init: RequestInit & { ip?: string } = {}) => new Request(`https://api.crow.direct${path}`, { ...init, headers: { 'cf-connecting-ip': init.ip ?? '198.51.100.7', ...(init.headers as Record<string, string>) } });

describe('each Worker, before the World object', () => {
  it('refuses a client over the flood ceiling with 429 and Retry-After, and forwards nothing', async () => {
    const e = edge({ flood: [true, false] });
    expect((await worker.fetch(at('/v1/status'), e.env('0'))).status).toBe(200);
    const r = await worker.fetch(at('/v1/status'), e.env('0'));
    expectRateLimited(r.status, r.headers, await r.json(), FLOOD_CEILING.periodSec);
    expect(e.forwarded).toHaveLength(1);
  });

  it('a flood from one client, replays included, stops at the ceiling while another client is forwarded', async () => {
    // A fixed-window stand-in for Cloudflare's binding: FLOOD_CEILING.limit per client per window.
    const counts = new Map<string, number>();
    const FLOOD = { limit: async ({ key }: { key: string }) => ({ success: (counts.set(key, (counts.get(key) ?? 0) + 1).get(key) ?? 0) <= FLOOD_CEILING.limit }) };
    const forwarded: string[] = [];
    const WORLD = { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => (forwarded.push(r.headers.get('x-holdback-client')!), new Response('{}')) }) };
    const env = { WORLD, NODE_INDEX: '0', SETTLEMENT: 'sim', FLOOD } as unknown as Env;
    const replay = () => at('/v1/faucet', { method: 'POST', headers: { 'idempotency-key': 'same', 'content-type': 'application/json' }, body: '{}' });
    const answers = [];
    for (let i = 0; i <= FLOOD_CEILING.limit; i++) answers.push((await worker.fetch(replay(), env)).status);
    expect(answers.filter((s) => s === 200)).toHaveLength(FLOOD_CEILING.limit);
    expect(answers.at(-1)).toBe(429);
    expect((await worker.fetch(at('/v1/status', { ip: '203.0.113.9' }), env)).status).toBe(200);
    expect(forwarded.filter((c) => c === '203.0.113.9')).toHaveLength(1);
  });

  it('answers 404 for a path with an empty segment or a backslash, which the operator would route as another path', async () => {
    const e = edge();
    for (const path of ['//x/v1/commitments/0x01/agree', '/\\x/v1/ciphertext', '/v1//holds']) {
      const r = await worker.fetch(at(path, { method: 'POST', body: '{}' }), e.env('0'));
      expect(r.status, path).toBe(404);
      expect((await r.json()).type).toBe('not_found');
    }
    expect(e.forwarded).toHaveLength(0);
  });

  it('fails open when the flood binding hangs or throws', async () => {
    expect(await admitted({ limit: () => new Promise(() => undefined) }, 'k', 20)).toBe(true);
    expect(await admitted({ limit: () => Promise.reject(new Error('down')) }, 'k', 20)).toBe(true);
    expect(await admitted({ limit: async () => ({ success: false }) }, 'k', 20)).toBe(false);
  });

  it('counts an IPv6 /64 as one client and forwards that key as the client', async () => {
    const e = edge();
    await worker.fetch(at('/v1/status', { ip: '2001:db8:1:2::5' }), e.env('1'));
    await worker.fetch(at('/v1/status', { ip: '2001:db8:1:2::99' }), e.env('1'));
    expect(e.keys).toEqual(['2001:0db8:0001:0002::/64', '2001:0db8:0001:0002::/64']);
    expect(e.forwarded.map((r) => r.headers.get('x-holdback-client'))).toEqual(['2001:0db8:0001:0002::/64', '2001:0db8:0001:0002::/64']);
  });

  it('refuses a body whose Content-Length is above the route\'s cap with 413 and maxBytes, and forwards one at the cap', async () => {
    const e = edge();
    const big = (path: string, n: number) => at(path, { method: 'POST', headers: { 'content-length': String(n), 'content-type': 'application/json' }, body: 'x' });
    const json = await worker.fetch(big('/v1/commitments', 1_048_577), e.env('0'));
    expect(json.status).toBe(413);
    expect(await json.json()).toMatchObject({ type: 'payload_too_large', status: 413, maxBytes: 1_048_576 });
    const reg = await worker.fetch(big('/v1/adjudicators', 196_609), e.env('0'));
    expect(await reg.json()).toMatchObject({ type: 'payload_too_large', maxBytes: 196_608 });
    expect(e.forwarded).toHaveLength(0);
    await worker.fetch(at('/v1/ciphertext', { method: 'POST', headers: { 'content-length': '1048576' }, body: new Uint8Array(1_048_576) }), e.env('0'));
    expect(e.forwarded).toHaveLength(1);
  });

  it('forwards its own deploy time from the version-metadata binding, replacing any a caller sent', async () => {
    const e = edge({ metadata: { id: '33fe56ea-48b0-40ce-b9eb-10846f25d3fc', timestamp: '2026-11-14T12:34:56.789Z' } });
    await worker.fetch(at('/v1/status', { headers: { 'x-holdback-deployed-at': '1999-01-01T00:00:00.000Z' } }), e.env('0'));
    expect(e.forwarded[0]!.headers.get('x-holdback-deployed-at')).toBe('2026-11-14T12:34:56.789Z');
    const none = edge();
    await worker.fetch(at('/v1/status', { headers: { 'x-holdback-deployed-at': '1999-01-01T00:00:00.000Z' } }), none.env('0'));
    expect(none.forwarded[0]!.headers.has('x-holdback-deployed-at')).toBe(false);
  });

  it('binds the flood ceiling and the version metadata in both Wrangler files, each operator counting apart', () => {
    const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as J;
    const files = [read('wrangler.op1.jsonc'), read('wrangler.op2.jsonc')];
    for (const w of files) {
      expect(w.ratelimits).toEqual([{ name: 'FLOOD', namespace_id: expect.stringMatching(/^[1-9][0-9]*$/), simple: { limit: FLOOD_CEILING.limit, period: FLOOD_CEILING.periodSec } }]);
      expect(w.version_metadata).toEqual({ binding: 'CF_VERSION_METADATA' });
    }
    expect(files[0].ratelimits[0].namespace_id).not.toBe(files[1].ratelimits[0].namespace_id);
  });
});

describe('discovery names each node\'s deploy time (T-413)', () => {
  it('serves demo.build.deployedAt from the Worker that answered, and null without the binding', async () => {
    const storage = Object.assign(new MemoryStorage(), { getAlarm: async () => null, setAlarm: async () => undefined });
    const state = { storage, blockConcurrencyWhile: <T>(f: () => Promise<T>) => f() };
    const env0 = { NODE_INDEX: '0', SETTLEMENT: 'sim', MIN_WINDOW_SEC: '2' };
    const object = new World(state, env0 as unknown as Env);
    const WORLD = { idFromName: (n: string) => n, get: () => object };
    const envs = [
      { ...env0, WORLD, CF_VERSION_METADATA: { id: 'a', timestamp: '2026-11-14T12:00:00.000Z' } },
      { NODE_INDEX: '1', SETTLEMENT: 'sim', WORLD },
    ] as unknown as Env[];
    const d0 = (await (await worker.fetch(at('/.well-known/holdback.json'), envs[0]!)).json()) as J;
    const d1 = (await (await worker.fetch(at('/.well-known/holdback.json'), envs[1]!)).json()) as J;
    expect(d0.demo.build).toEqual({ commit: null, deployedAt: '2026-11-14T12:00:00.000Z' });
    expect(d1.demo.build).toEqual({ commit: null, deployedAt: null });
  });
});
