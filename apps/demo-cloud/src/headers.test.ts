// T-451: every answer of the operator Workers carries the security headers, and nothing else about it changes: the
// World's own headers, the body's bytes, and the absence of CORS headers (measured live on 2026-11-14) stay as they were.
import { describe, expect, it } from 'vitest';
import { API_HEADERS } from './headers.js';
import { MemoryStorage } from './storage.js';
import worker, { World, type Env } from './worker.js';

/** One SimChain World behind holdback-op1, with an optional flood binding. */
function node(extra: Partial<Env> = {}): Env {
  const storage = Object.assign(new MemoryStorage(), { getAlarm: async () => null, setAlarm: async () => undefined });
  const state = { storage, blockConcurrencyWhile: <T>(f: () => Promise<T>) => f() };
  let object: World | undefined;
  const env: Env = {
    WORLD: { idFromName: (n: string) => n, get: () => (object ??= new World(state, env)) },
    NODE_INDEX: '0',
    SETTLEMENT: 'sim',
    MIN_WINDOW_SEC: '2',
    ...extra,
  };
  return env;
}

const call = (env: Env, path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://api.crow.direct${path}`, init), env);

function hasAll(r: Response) {
  for (const [k, v] of Object.entries(API_HEADERS)) expect(r.headers.get(k), k).toBe(v);
  expect(r.headers.get('strict-transport-security')).toMatch(/^max-age=31536000; includeSubDomains$/);
  expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  // CORS stays as it was: none.
  expect([...r.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
}

describe('the security headers on the operator Workers (T-451)', () => {
  it('discovery, a read, a 404 problem and an OPTIONS preflight carry them, with the World’s own headers and body kept', async () => {
    const env = node();
    const discovery = await call(env, '/.well-known/holdback.json');
    expect(discovery.status).toBe(200);
    hasAll(discovery);
    expect(discovery.headers.get('content-type')).toMatch(/^application\/json/);
    expect(Object.keys((await discovery.json()) as object).length).toBeGreaterThan(0);

    const read = await call(env, '/v1/agreements/0x' + '0'.repeat(64));
    hasAll(read);
    expect(read.status).toBe(404);
    expect(read.headers.get('content-type')).toBe('application/problem+json');
    expect(read.headers.get('link')).toMatch(/rel="type"/);

    const unknown = await call(env, '/v1/nope');
    hasAll(unknown);
    expect(unknown.status).toBe(404);

    const preflight = await call(env, '/v1/messages', { method: 'OPTIONS', headers: { origin: 'https://crow.direct', 'access-control-request-method': 'POST' } });
    hasAll(preflight);
    expect(preflight.status).toBe(404);
  });

  it('the body passes through byte for byte', async () => {
    const body = new Uint8Array([0, 1, 2, 250, 255]);
    const env: Env = { WORLD: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response(body, { status: 201, headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', etag: '"x"' } }) }) }, NODE_INDEX: '1', SETTLEMENT: 'sim' };
    const r = await call(env, '/v1/ciphertext/abc');
    hasAll(r);
    expect(r.status).toBe(201);
    expect([r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('etag')]).toEqual(['application/octet-stream', 'no-store', '"x"']);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(body);
  });

  it('the refusals the Worker answers itself carry them: the flood 429, the size 413, an empty segment, an unconfigured node’s 500', async () => {
    const flood = await call(node({ FLOOD: { limit: async () => ({ success: false }) } }), '/v1/status');
    expect(flood.status).toBe(429);
    hasAll(flood);
    const big = await call(node(), '/v1/messages', { method: 'POST', headers: { 'content-length': String(64 * 1024 * 1024) }, body: 'x' });
    expect(big.status).toBe(413);
    hasAll(big);
    const empty = await call(node(), '/v1//agreements');
    expect(empty.status).toBeGreaterThanOrEqual(400);
    hasAll(empty);
    const unset = await call(node({ SETTLEMENT: undefined }), '/v1/status');
    expect(unset.status).toBe(500);
    hasAll(unset);
  });

  it('plain HTTP reaches no World: a read gets a 301 and a write a 308 to the same path over HTTPS; local runs stay on HTTP', async () => {
    let forwarded = 0;
    const env: Env = { WORLD: { idFromName: (n: string) => n, get: () => ({ fetch: async () => (forwarded++, new Response('{}', { headers: { 'content-type': 'application/json' } })) }) }, NODE_INDEX: '0', SETTLEMENT: 'sim' };
    for (const [method, status] of [['GET', 301], ['HEAD', 301], ['POST', 308], ['PUT', 308]] as const) {
      const r = await worker.fetch(new Request('http://api.crow.direct/v1/commitments?party=0x1', { method, ...(method === 'POST' || method === 'PUT' ? { body: '{}' } : {}) }), env);
      expect([r.status, r.headers.get('location')]).toEqual([status, 'https://api.crow.direct/v1/commitments?party=0x1']);
      hasAll(r);
    }
    expect(forwarded).toBe(0);
    for (const local of ['http://127.0.0.1:8787/v1/status', 'http://localhost:8788/v1/status']) expect((await worker.fetch(new Request(local), env)).status).toBe(200);
    expect(forwarded).toBe(2);
  });
});
