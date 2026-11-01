// T-026: the operator behind a fetch-style entry (Request -> Response), as a Worker serves it. The same
// Operator.handle runs; the adapter only carries the request in and the response out.
import { parseOperatorStatus } from '@holdback/core';
import { requestOf } from '@holdback/sdk';
import { simActor } from '@holdback/settlement/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchHandler } from './fetch.js';
import { Operator, simRegistry, type LogEntry } from './index.js';
import { holdOf, world, type World } from './_world.js';

let w: World;
let op: Operator;
let handler: (req: Request, client?: string) => Promise<Response>;
const logs: LogEntry[] = [];
const BASE = 'https://op1.example.test';

beforeEach(async () => {
  w = await world();
  logs.length = 0;
  op = new Operator({ settlement: w.chain, registry: simRegistry(w.chain), signerKey: simActor('op-f', 'operator').key, operatorId: 'op-f', env: {}, baseUrl: BASE, log: (e) => void logs.push(e), rateLimit: { writes: 100, reads: 2, windowMs: 60_000 } });
  handler = fetchHandler(op);
});
afterEach(async () => w.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

describe('fetchHandler', () => {
  it('serves discovery with the standard headers and the base URL it was given', async () => {
    const r = await handler(new Request(`${BASE}/.well-known/holdback.json`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('holdback-schema-version')).toBeTruthy();
    expect(r.headers.get('request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body['apiBaseUrl']).toBe(BASE);
    const status = { ...body, domain: { ...(body['domain'] as object), chainId: '31337' } };
    for (const k of ['apiBaseUrl', 'settlementTime', 'notes']) delete (status as Record<string, unknown>)[k];
    expect(parseOperatorStatus(status).ok).toBe(true);
    expect(logs.at(-1)).toMatchObject({ method: 'GET', path: '/.well-known/holdback.json', status: 200 });
  });

  it('relays a signed write with its Idempotency-Key and replays it, and answers problems as problem+json', async () => {
    const { path, body } = requestOf(await holdOf(w.deal));
    const first = await post(path, body, { 'idempotency-key': 'f-1' });
    expect(first.status).toBe(200);
    const again = await post(path, body, { 'idempotency-key': 'f-1' });
    expect(await again.json()).toEqual(await first.json());
    const missing = await post(path, body);
    expect(missing.status).toBe(400);
    expect(missing.headers.get('content-type')).toBe('application/problem+json');
    const nf = await handler(new Request(`${BASE}/nope`));
    expect([nf.status, ((await nf.json()) as { type: string }).type]).toEqual([404, 'not_found']);
  });

  it('throttles reads by the client address it is given', async () => {
    const read = (client: string) => handler(new Request(`${BASE}/v1/status`), client);
    expect((await read('198.51.100.1')).status).toBe(200);
    expect((await read('198.51.100.1')).status).toBe(200);
    const third = await read('198.51.100.1');
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await read('198.51.100.2')).status).toBe(200);
  });

  it('adds the notes it was given to discovery and llms.txt (public mode)', async () => {
    const notes = ['Test tokens only.', 'Both nodes share one simulated settlement layer.'];
    const noted = fetchHandler(new Operator({ settlement: w.chain, registry: simRegistry(w.chain), signerKey: simActor('op-n', 'operator').key, operatorId: 'op-n', env: {}, baseUrl: BASE, notes }));
    expect(((await (await noted(new Request(`${BASE}/.well-known/holdback.json`))).json()) as { notes: string[] }).notes).toEqual(notes);
    const llms = await (await noted(new Request(`${BASE}/llms.txt`))).text();
    for (const n of notes) expect(llms).toContain(n);
    // Without notes, discovery has none (pnpm sim unchanged).
    expect(((await (await handler(new Request(`${BASE}/.well-known/holdback.json`))).json()) as Record<string, unknown>)['notes']).toBeUndefined();
  });

  it('streams server-sent events until the client goes away', async () => {
    const { path, body } = requestOf(await holdOf(w.deal));
    expect((await post(path, body, { 'idempotency-key': 'f-2' })).status).toBe(200);
    const ac = new AbortController();
    const r = await handler(new Request(`${BASE}/v1/events?from=0`, { signal: ac.signal }));
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    const reader = r.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toMatch(/^id: 0\nevent: commitment\.offered\n/);
    await reader.cancel();
  });
});
