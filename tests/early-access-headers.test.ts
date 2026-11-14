// T-462: every answer of crow-early-access carries the operators' security headers (imported from
// apps/demo-cloud/src/headers.ts, T-451), and nothing else about it changes: its CORS answer, its no-store on the build
// read, its bodies, and what it stores. Plain HTTP is redirected before anything is stored.
import { describe, expect, it } from 'vitest';
import { API_HEADERS } from '../apps/demo-cloud/src/headers.ts';
// @ts-expect-error -- plain ESM Worker without type declarations
import join from '../apps/early-access/worker.js';

type Fetcher = { fetch(request: Request, env: unknown): Promise<Response> };
const kv = () => {
  const store = new Map<string, string>();
  return { store, EMAILS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } };
};
const call = (url: string, init: RequestInit, env: unknown) => (join as Fetcher).fetch(new Request(url, init), env);
const J = 'https://join.crow.direct';
const post = (origin: string, body: unknown) => ({ method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

function hasAll(r: Response) {
  for (const [k, v] of Object.entries(API_HEADERS)) expect(r.headers.get(k), k).toBe(v);
  expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  expect(r.headers.get('x-frame-options')).toBe('DENY');
}
const corsOf = (r: Response) => ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'vary', 'cache-control'].map((k) => r.headers.get(k));
// The CORS answer as before, and no Cache-Control, as before.
const CORS_CROW = ['https://crow.direct', 'POST, OPTIONS', 'content-type', 'origin', null];

describe('the security headers on crow-early-access (T-462)', () => {
  it('a sign-up from crow.direct, its preflight, a refusal and a 404 carry them, with CORS and bodies as before', async () => {
    const env = kv();
    const pre = await call(`${J}/early-access`, { method: 'OPTIONS', headers: { origin: 'https://crow.direct', 'access-control-request-method': 'POST' } }, env);
    expect(pre.status).toBe(204);
    hasAll(pre);
    expect(corsOf(pre)).toEqual(CORS_CROW);
    expect(pre.headers.get('content-type')).toBeNull();
    const ok = await call(`${J}/early-access`, post('https://crow.direct', { email: 'A@Example.com', page: '/trust' }), env);
    expect(ok.status).toBe(200);
    hasAll(ok);
    expect(corsOf(ok)).toEqual(CORS_CROW);
    expect(await ok.json()).toEqual({ ok: true });
    expect([...env.store.keys()]).toEqual(['email:a@example.com']);
    const here = await call(`${J}/early-access`, post('https://npc.here.now', { email: 'b@example.com' }), env);
    expect(here.headers.get('access-control-allow-origin')).toBe('https://npc.here.now');
    hasAll(here);
    const refused = await call(`${J}/early-access`, post('https://evil.example', { email: 'c@example.com' }), env);
    expect(refused.status).toBe(403);
    hasAll(refused);
    expect(refused.headers.get('access-control-allow-origin')).toBe('https://crow.direct');
    const bad = await call(`${J}/early-access`, post('https://crow.direct', { email: 'nope' }), env);
    expect(bad.status).toBe(400);
    hasAll(bad);
    const missing = await call(`${J}/`, {}, env);
    expect(missing.status).toBe(404);
    hasAll(missing);
    expect(corsOf(missing)).toEqual(CORS_CROW);
    expect(env.store.size).toBe(2);
  });

  it('the build read keeps its CORS header and no-store; the forward from join.escrow.stream carries the headers', async () => {
    const env = kv();
    const v = await call(`${J}/version.json`, {}, { ...env, BUILD_COMMIT: 'a'.repeat(40) });
    expect(v.status).toBe(200);
    hasAll(v);
    expect([v.headers.get('access-control-allow-origin'), v.headers.get('cache-control')]).toEqual(['*', 'no-store']);
    const moved = await call('https://join.escrow.stream/version.json', {}, env);
    expect([moved.status, moved.headers.get('location')]).toEqual([301, `${J}/version.json`]);
    hasAll(moved);
  });

  it('plain HTTP stores nothing: a read gets a 301 and a write a 308 to HTTPS; local runs stay on HTTP', async () => {
    const env = kv();
    for (const [init, status] of [[{}, 301], [post('https://crow.direct', { email: 'd@example.com' }), 308]] as const) {
      const r = await call('http://join.crow.direct/early-access', init, env);
      expect([r.status, r.headers.get('location')]).toEqual([status, `${J}/early-access`]);
      hasAll(r);
    }
    expect(env.store.size).toBe(0);
    const local = await call('http://127.0.0.1:8791/early-access', post('https://crow.direct', { email: 'e@example.com' }), env);
    expect(local.status).toBe(200);
    expect(env.store.size).toBe(1);
  });

  it('a failed store write is a 500 with the headers and the CORS answer, so the form can show its message', async () => {
    const env = { EMAILS: { get: async () => null, put: async () => Promise.reject(new Error('KV write limit')) } };
    const r = await call(`${J}/early-access`, post('https://crow.direct', { email: 'f@example.com' }), env);
    expect(r.status).toBe(500);
    hasAll(r);
    expect(corsOf(r)).toEqual(CORS_CROW);
    expect((await r.json()).error).toMatch(/try again/);
  });
});
