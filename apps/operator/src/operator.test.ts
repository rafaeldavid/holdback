// The operator node over SimChain (docs/api.md v0.2, ADR-0017 Phase 1 subset), exercised over real HTTP.
import { holdbackDomain, parseOperatorStatus, parsePage, parseReceipt, verifyMessage, type CommitmentStateView, type Receipt } from '@holdback/core';
import { Holdback, requestOf } from '@holdback/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Operator, simRegistry, type LogEntry } from './index.js';
import { asOperation, hex32, holdOf, world, type World } from './_world.js';

let w: World;
let base: string;
const logs: LogEntry[] = [];

beforeEach(async () => {
  w = await world();
  logs.length = 0;
  base = (await w.operator('op-1', { log: (e) => void logs.push(e) })).url;
});
afterEach(async () => w.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers });
const json = async <T = Record<string, unknown>>(r: Response) => (await r.json()) as T;

async function held(): Promise<CommitmentStateView & { receipt: Receipt }> {
  const { path, body } = requestOf(await holdOf(w.deal));
  const r = await post(path, body, { 'idempotency-key': 'hold-1' });
  expect(r.status).toBe(200);
  return json(r);
}

describe('mutations', () => {
  it('one-shot hold returns Held with an operator-signed receipt that verifies against /v1/status', async () => {
    const h = await held();
    expect(h.escrowState).toBe('Held');
    expect(parseReceipt(h.receipt).ok).toBe(true);
    const status = await json<{ receiptSigner: `0x${string}` }>(await get('/v1/status'));
    expect(h.receipt.operator).toBe(status.receiptSigner);
    expect(await verifyMessage(holdbackDomain(31337), { ...h.receipt, type: 'Receipt' }, status.receiptSigner)).toBe(true);
    const last = w.chain.log().at(-1)!;
    expect([h.receipt.eventSeq, h.receipt.eventHash, h.receipt.commitmentId]).toEqual([last.seq, last.hash, w.deal.id]);
  });

  it('walks the demo path through the SDK: hold, deliver, decide, released, and serves receipts', async () => {
    const hb = new Holdback({ operators: [base] });
    await hb.hold(await holdOf(w.deal));
    await hb.submit(asOperation(await w.deal.deliver()));
    w.chain.advance(5);
    const r = await hb.submit(asOperation(await w.deal.decide('primary', 'accept')));
    expect(r.state.escrowState).toBe('Released');
    expect(r.via).toBe(base);
    const receipts = await hb.receipts(w.deal.id);
    expect(parsePage(receipts).ok).toBe(true);
    expect(receipts.items.map((x) => x.eventSeq)).toEqual([...receipts.items.map((x) => x.eventSeq)].sort((a, b) => b - a));
    expect(receipts.items.every((x) => parseReceipt(x).ok)).toBe(true);
    // The released key reaches the buyer.
    const keys = await json<{ items: unknown[] }>(await get(`/v1/commitments/${w.deal.id}/key?recipient=${w.cast.buyer.address}`));
    expect(keys.items).toHaveLength(1);
  });

  it('settles a co-signed MutualSettlement with payouts, and previews it unsigned', async () => {
    const hb = new Holdback({ operators: [base] });
    await hb.hold(await holdOf(w.deal));
    const settle = asOperation(await w.deal.mutual());
    const before = w.chain.log().length;
    const preview = await hb.preview(settle);
    expect([preview.state.escrowState, preview.signatureCheck, w.chain.log().length]).toEqual(['Settled', 'skipped', before]);
    const r = await hb.submit(settle);
    expect(r.state.escrowState).toBe('Settled');
    expect(r.state.settled?.payouts).toHaveLength(2);
  });

  it('requires an Idempotency-Key on a live mutation', async () => {
    const { path, body } = requestOf(await holdOf(w.deal));
    const r = await post(path, body);
    expect(r.status).toBe(400);
    expect((await json(r))['type']).toBe('invalid_terms');
  });

  it('replays the same key and body, and answers 409 idempotency_conflict for another body', async () => {
    const { path, body } = requestOf(await holdOf(w.deal));
    const first = await post(path, body, { 'idempotency-key': 'k1' });
    const events = w.chain.log().length;
    const again = await post(path, body, { 'idempotency-key': 'k1' });
    expect(await again.json()).toEqual(await first.json());
    expect(w.chain.log().length).toBe(events);
    const other = await post(path, { ...(body as object), extra: 1 }, { 'idempotency-key': 'k1' });
    expect(other.status).toBe(409);
    expect((await json(other))['type']).toBe('idempotency_conflict');
  });

  it('relays the settlement layer refusal as a problem', async () => {
    const r = await post(`/v1/commitments/${w.deal.id}/triggers/reclaim`, {}, { 'idempotency-key': 'k2' });
    expect(r.headers.get('content-type')).toMatch(/application\/problem\+json/);
    expect([r.status, (await json(r))['type']]).toEqual([404, 'not_found']);
  });

  it('refuses a malformed body against spec/schemas before relaying', async () => {
    const r = await post('/v1/commitments', { id: hex32('ab') }, { 'idempotency-key': 'k3' });
    expect(r.status).toBe(400);
    expect((await json(r))['type']).toBe('invalid_terms');
  });
});

describe('startup guards apply to every operator', () => {
  it('constructing an Operator directly runs the guards', async () => {
    const registry = simRegistry(w.chain);
    const options = { settlement: w.chain, registry, signerKey: `0x${'22'.repeat(32)}` as const, operatorId: 'direct' };
    expect(() => new Operator({ ...options, env: { STRIPE_SECRET_KEY: 'sk_live_x' } })).toThrow(/sk_test_/);
    expect(() => new Operator({ ...options, env: {}, registry: { ...registry, chainId: 100 } })).toThrow(/allowlist/);
    expect(() => new Operator({ ...options, env: {} })).not.toThrow();
  });
});

describe('dry run (?validateOnly=true)', () => {
  it('validates an unsigned party message, records nothing, and marks the response', async () => {
    const hb = new Holdback({ operators: [base] });
    await hb.hold(await holdOf(w.deal));
    await hb.submit(asOperation(await w.deal.deliver()));
    const op = asOperation(await w.deal.earlyAccept());
    const before = { log: w.chain.log().length, digest: w.chain.digest() };
    const { path, body } = requestOf(op);
    const unsigned = { ...(body as Record<string, unknown>) };
    delete unsigned['signature'];
    const r = await post(`${path}?validateOnly=true`, unsigned);
    expect(r.status).toBe(200);
    expect(r.headers.get('holdback-dry-run')).toBe('true');
    expect(r.headers.get('holdback-signature-check')).toBe('skipped');
    const out = await json(r);
    expect(out['escrowState']).toBe('Released');
    expect(out).not.toHaveProperty('receipt');
    expect({ log: w.chain.log().length, digest: w.chain.digest() }).toEqual(before);
    // No idempotency record: the live call with any key still runs.
    expect((await hb.submit(op)).state.escrowState).toBe('Released');
  });

  it('returns the problem the live call would', async () => {
    const r = await post(`/v1/commitments/${w.deal.id}/triggers/reclaim?validateOnly=true`, {});
    expect([r.status, (await json(r))['type']]).toEqual([404, 'not_found']);
    expect(r.headers.get('holdback-dry-run')).toBeNull();
  });
});

describe('headers and problems', () => {
  it('sets Request-Id and Holdback-Schema-Version on every response and repeats the ID in a problem instance', async () => {
    const ok = await get('/v1/status');
    expect(ok.headers.get('request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok.headers.get('holdback-schema-version')).toBe('0.10');
    const missing = await get(`/v1/commitments/${hex32('ee')}`);
    expect(missing.status).toBe(404);
    const p = await json(missing);
    expect(p).toMatchObject({ type: 'not_found', status: 404, title: 'No such resource or route' });
    expect(missing.headers.get('link')).toBe('<https://crow.direct/problems/not_found>; rel="type"');
    expect(p['instance']).toBe(`urn:holdback:request:${missing.headers.get('request-id')}`);
    expect(missing.headers.get('holdback-schema-version')).toBe('0.10');
    expect((await get('/v1/nothing')).status).toBe(404);
  });

  it('accepts and logs traceparent, and never puts it in a receipt', async () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const { path, body } = requestOf(await holdOf(w.deal));
    const r = await post(path, body, { 'idempotency-key': 'k-tp', traceparent: tp });
    expect(logs.some((l) => l.traceparent === tp)).toBe(true);
    expect(JSON.stringify(await r.json())).not.toContain('0af7651916cd43dd8448eb211c80319c');
  });

  it('logs the route template and problem type, never an address or ID from the path', async () => {
    const address = `0x${'ab'.repeat(20)}`;
    for (const path of [`/v1/agents/${address}`, `/v1/commitments/${hex32('99')}/terms`, `/wp-admin/${address}`]) await (await get(path)).text();
    await (await post('/v1/webhooks', {})).text();
    const hold = requestOf(await holdOf(w.deal));
    await (await post(hold.path, hold.body, { 'idempotency-key': 'k-route' })).text();
    expect(logs.map((l) => [l.method, l.route, l.status, l.problem])).toEqual([
      ['GET', '/v1/agents/{address}', 404, 'not_found'],
      ['GET', '/v1/commitments/{commitmentId}/terms', 404, 'not_found'],
      ['GET', 'unmatched', 404, 'not_found'],
      ['POST', '/v1/webhooks', 501, 'not_implemented'],
      ['POST', '/v1/holds', 200, undefined],
    ]);
    expect(JSON.stringify(logs.map((l) => l.route))).not.toMatch(/0x/);
  });

  it('answers 429 rate_limited with Retry-After when a signer exceeds its write budget', async () => {
    const limited = await w.operator('op-limited', { rateLimit: { writes: 1, reads: 100, windowMs: 60_000 } });
    const t1 = await fetch(`${limited.url}/v1/commitments/${w.deal.id}/triggers/reclaim`, { method: 'POST', headers: { 'idempotency-key': 'a' }, body: '{}' });
    expect(t1.status).not.toBe(429);
    const t2 = await fetch(`${limited.url}/v1/commitments/${w.deal.id}/triggers/reclaim`, { method: 'POST', headers: { 'idempotency-key': 'b' }, body: '{}' });
    expect(t2.status).toBe(429);
    expect((await json(t2))['type']).toBe('rate_limited');
    expect(Number(t2.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('refusals change nothing (docs/team.md: signed messages only)', () => {
  async function deliveredEarlyAccept() {
    const hb = new Holdback({ operators: [base] });
    await hb.hold(await holdOf(w.deal));
    await hb.submit(asOperation(await w.deal.deliver()));
    return requestOf(asOperation(await w.deal.earlyAccept()));
  }

  it('an unsigned live EarlyAccept is 400 invalid_terms, and SimChain is unchanged', async () => {
    const { path, body } = await deliveredEarlyAccept();
    const unsigned = { ...(body as Record<string, unknown>) };
    delete unsigned['signature'];
    const before = w.chain.digest();
    const r = await post(path, unsigned, { 'idempotency-key': 'unsigned' });
    expect([r.status, (await json(r))['type']]).toEqual([400, 'invalid_terms']);
    expect(w.chain.digest()).toBe(before);
  });

  it('an EarlyAccept with a zero signature is 401 invalid_signature, and SimChain is unchanged', async () => {
    const { path, body } = await deliveredEarlyAccept();
    const before = w.chain.digest();
    const r = await post(path, { ...(body as object), signature: `0x${'00'.repeat(65)}` }, { 'idempotency-key': 'zero-sig' });
    expect([r.status, (await json(r))['type']]).toEqual([401, 'invalid_signature']);
    expect(w.chain.digest()).toBe(before);
  });

  it('an EarlyAccept signed by the wrong key is 401 invalid_signature, and SimChain is unchanged', async () => {
    const { path, body } = await deliveredEarlyAccept();
    const before = w.chain.digest();
    const r = await post(path, { ...(body as object), signature: `0x${'11'.repeat(64)}1b` }, { 'idempotency-key': 'bad-sig' });
    expect([r.status, (await json(r))['type']]).toEqual([401, 'invalid_signature']);
    expect(w.chain.digest()).toBe(before);
  });

  it('a malformed body is 400 invalid_terms, not 500, even with rate limits on', async () => {
    const limited = await w.operator('op-shape', { rateLimit: { writes: 10, reads: 10, windowMs: 60_000 } });
    for (const [path, body] of [
      ['/v1/commitments', { seller: 1 }],
      ['/v1/holds', { commitment: { seller: 1 }, acceptance: {}, agree: { buyer: 1 }, funding: {} }],
      [`/v1/commitments/${w.deal.id}/fund`, { commitmentId: w.deal.id, from: 1 }],
    ] as const) {
      const r = await fetch(`${limited.url}${path}`, { method: 'POST', headers: { 'idempotency-key': `shape-${path}` }, body: JSON.stringify(body) });
      expect([path, r.status, ((await r.json()) as Record<string, unknown>)['type']]).toEqual([path, 400, 'invalid_terms']);
    }
  });

  it.each(['1', 'TRUE', 'yes', ''])('?validateOnly=%j is 400 invalid_terms and executes nothing', async (value) => {
    const { path, body } = await deliveredEarlyAccept();
    const before = w.chain.digest();
    const r = await post(`${path}?validateOnly=${value}`, body, { 'idempotency-key': `vo-${value}` });
    expect([r.status, (await json(r))['type']]).toEqual([400, 'invalid_terms']);
    expect(w.chain.digest()).toBe(before);
  });

  it('?validateOnly=false is a live call', async () => {
    const { path, body } = await deliveredEarlyAccept();
    const before = w.chain.digest();
    const r = await post(`${path}?validateOnly=false`, body, { 'idempotency-key': 'vo-false' });
    const out = await json(r);
    expect([out['escrowState'], r.headers.get('holdback-dry-run')]).toEqual(['Released', null]);
    expect(out).toHaveProperty('receipt');
    expect(w.chain.digest()).not.toBe(before);
  });
});

describe('reads', () => {
  it('GET /v1/status conforms to operator-status.schema.json with the EIP-712 domain', async () => {
    const s = await json(await get('/v1/status'));
    const parsed = parseOperatorStatus(s);
    expect(parsed.ok ? null : parsed.error).toBeNull();
    expect(s).toMatchObject({ operatorId: 'op-1', settlement: { kind: 'sim' }, domain: { name: 'Holdback', version: '0.7', chainId: '31337' }, apiVersion: 'v1', schemaVersion: '0.10' });
  });

  it('GET /v1/commitments/{id} serves the read model with settledAt and finalAt', async () => {
    await held();
    const s = await json(await get(`/v1/commitments/${w.deal.id}`));
    expect(s).toMatchObject({ commitmentId: w.deal.id, escrowState: 'Held', settledAt: null, finalAt: null });
  });

  it('lists commitments by party, role and escrowState in the page envelope', async () => {
    await held();
    const q = async (qs: string) => json<{ items: CommitmentStateView[]; nextCursor: string | null }>(await get(`/v1/commitments?${qs}`));
    expect((await q(`party=${w.cast.buyer.address}&role=buyer`)).items.map((c) => c.commitmentId)).toEqual([w.deal.id]);
    expect((await q(`party=${w.cast.buyer.address}&role=seller`)).items).toEqual([]);
    expect((await q(`party=${w.cast.primary.address}&role=adjudicator&escrowState=Held&escrowState=Released`)).items).toHaveLength(1);
    expect((await q('escrowState=Released')).items).toEqual([]);
    expect(parsePage(await q('')).ok).toBe(true);
  });

  it('pages a commitment events newest first, and refuses a bad cursor with invalid_cursor', async () => {
    await held();
    const p1 = await json<{ items: Array<{ seq: number }>; nextCursor: string }>(await get(`/v1/commitments/${w.deal.id}/events?limit=2`));
    expect(p1.items.map((e) => e.seq)).toEqual([3, 2]);
    expect(p1.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const p2 = await json<{ items: Array<{ seq: number }>; nextCursor: string | null }>(await get(`/v1/commitments/${w.deal.id}/events?limit=2&cursor=${p1.nextCursor}`));
    expect([p2.items.map((e) => e.seq), p2.nextCursor]).toEqual([[1, 0], null]);
    const bad = await get(`/v1/commitments/${w.deal.id}/events?cursor=!!`);
    expect([bad.status, (await json(bad))['type']]).toEqual([400, 'invalid_cursor']);
    expect((await get(`/v1/commitments/${w.deal.id}/events?limit=201`)).status).toBe(400);
  });

  it('serves the club, the agent, the member and the paginated adjudicators from the registry', async () => {
    const club = await json(await get(`/v1/clubs/${w.club.id}`));
    expect(club).toMatchObject({ id: w.club.id, rulebookHash: w.club.rulebookHash });
    const agent = await json<{ address: string; mandates: unknown[] }>(await get(`/v1/agents/${w.cast.buyer.address}`));
    expect(agent.mandates).toHaveLength(1);
    expect((await get(`/v1/agents/${hex32('00').slice(0, 42)}`)).status).toBe(404);
    expect((await get(`/v1/clubs/nope`)).status).toBe(404);
    expect((await get(`/v1/clubs/${w.club.id}/members/${w.cast.buyer.address}`)).status).toBe(404);
    const adjudicators = await json<{ items: Array<{ address: string }>; nextCursor: string | null }>(await get('/v1/adjudicators?limit=2'));
    expect(adjudicators.items).toHaveLength(2);
    const rest = await json<{ items: unknown[]; nextCursor: string | null }>(await get(`/v1/adjudicators?limit=2&cursor=${adjudicators.nextCursor}`));
    expect([rest.items.length, rest.nextCursor]).toEqual([1, null]);
  });

  it('streams events as server-sent events from a sequence number', async () => {
    await held();
    const controller = new AbortController();
    const r = await fetch(`${base}/v1/events?from=1`, { signal: controller.signal });
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = r.body!.getReader();
    let text = '';
    while ((text.match(/\n\n/g) ?? []).length < 2) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.slice(0, 2)).toEqual([1, 2]);
    expect(text).toContain('event: adjudicator.accepted');
  });

  it('a failed read of the settlement events fails that request only; the next read indexes every event once (T-313)', async () => {
    await held();
    // A delivery sent straight to the settlement layer: events this node has not indexed yet.
    await w.chain.submit(await w.deal.deliver());
    const events = w.chain.events.bind(w.chain);
    let failures = 1;
    // The settlement layer's event read hands over one event, then fails, once.
    w.chain.events = async function* (fromSeq?: number) {
      let handed = 0;
      for await (const e of events(fromSeq)) {
        if (failures > 0 && handed++ === 1) {
          failures--;
          throw new Error('the event read failed (test)');
        }
        yield e;
      }
    };
    const mine = w.chain.log().filter((e) => e.commitmentId === w.deal.id).map((e) => e.seq);
    expect(mine.length).toBeGreaterThan(5);
    expect((await get(`/v1/commitments/${w.deal.id}/events?limit=200`)).status).toBe(500);
    expect(failures).toBe(0);
    const page = await get(`/v1/commitments/${w.deal.id}/events?limit=200`);
    expect(page.status).toBe(200);
    expect((await json<{ items: Array<{ seq: number }> }>(page)).items.map((e) => e.seq)).toEqual([...mine].reverse());
  });
});
