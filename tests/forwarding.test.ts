// T-312: crow.direct is the canonical home, and the old escrow.stream hostnames forward to it. The site Worker sends
// every escrow.stream request to the same path on crow.direct with a 301 and serves the static assets for crow.direct;
// the early-access Worker sends join.escrow.stream to join.crow.direct (301 for GET, 308 for POST, which keeps the
// method and body) and keeps one KV namespace for both hostnames.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM Worker without type declarations
import site from '../apps/site/worker.js';
// @ts-expect-error -- plain ESM Worker without type declarations
import join from '../apps/early-access/worker.js';

type Fetcher = { fetch(request: Request, env: unknown): Promise<Response> };

/** A stand-in for the static assets binding: it records each path it is asked for. */
const assets = () => {
  const asked: string[] = [];
  return { asked, ASSETS: { fetch: async (r: Request) => (asked.push(new URL(r.url).pathname), new Response('asset', { status: 200 })) } };
};

/** A stand-in KV namespace. */
const kv = () => {
  const store = new Map<string, string>();
  return { store, EMAILS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } };
};

describe('the site Worker (crow-site)', () => {
  it('names the UTF-8 charset on the guides (.txt) and the bundles (.mjs), and leaves other types as they are (T-400)', async () => {
    const typed = (type: string) => ({ ASSETS: { fetch: async () => new Response('Crow’s guide', { status: 200, headers: { 'content-type': type } }) } });
    const typeOf = async (path: string, type: string) => (await (site as Fetcher).fetch(new Request(`https://crow.direct${path}`), typed(type))).headers.get('content-type');
    expect(await typeOf('/llms.txt', 'text/plain')).toBe('text/plain; charset=utf-8');
    expect(await typeOf('/try.mjs', 'text/javascript')).toBe('text/javascript; charset=utf-8');
    expect(await typeOf('/buy.mjs', 'application/javascript')).toBe('text/javascript; charset=utf-8');
    expect(await typeOf('/', 'text/html; charset=utf-8')).toBe('text/html; charset=utf-8');
    expect(await typeOf('/og.png', 'image/png')).toBe('image/png');
    expect(await typeOf('/llms.txt', 'text/plain; charset=utf-8')).toBe('text/plain; charset=utf-8');
  });
  it('answers escrow.stream and www.escrow.stream with a 301 to the same path and query on crow.direct', async () => {
    const env = assets();
    for (const [from, to] of [
      ['https://escrow.stream/', 'https://crow.direct/'],
      ['https://escrow.stream/llms.txt', 'https://crow.direct/llms.txt'],
      ['https://www.escrow.stream/problems/not_found?x=1&y=2', 'https://crow.direct/problems/not_found?x=1&y=2'],
    ]) {
      const r = await (site as Fetcher).fetch(new Request(from!), env);
      expect(r.status).toBe(301);
      expect(r.headers.get('location')).toBe(to);
    }
    const post = await (site as Fetcher).fetch(new Request('https://escrow.stream/try.mjs', { method: 'POST', body: 'x' }), env);
    expect(post.status).toBe(301);
    expect(env.asked).toEqual([]);
  });

  it('serves the static assets for crow.direct and www.crow.direct', async () => {
    const env = assets();
    for (const url of ['https://crow.direct/', 'https://crow.direct/llms.txt', 'https://www.crow.direct/crow.png']) {
      const r = await (site as Fetcher).fetch(new Request(url), env);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('asset');
    }
    expect(env.asked).toEqual(['/', '/llms.txt', '/crow.png']);
  });
});

describe('the early-access Worker (crow-early-access)', () => {
  const body = JSON.stringify({ email: 'ada@example.com', company: '', page: '/' });

  it('answers a GET on join.escrow.stream with a 301 and a POST with a 308 to join.crow.direct', async () => {
    const env = kv();
    const get = await (join as Fetcher).fetch(new Request('https://join.escrow.stream/early-access?from=old'), env);
    expect(get.status).toBe(301);
    expect(get.headers.get('location')).toBe('https://join.crow.direct/early-access?from=old');
    const post = await (join as Fetcher).fetch(new Request('https://join.escrow.stream/early-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), env);
    expect(post.status).toBe(308);
    expect(post.headers.get('location')).toBe('https://join.crow.direct/early-access');
    expect(env.store.size).toBe(0);
  });

  it('serves a sign-up from a page still open on escrow.stream in place: a browser turns a redirected cross-origin POST into Origin null', async () => {
    const env = kv();
    const pre = await (join as Fetcher).fetch(new Request('https://join.escrow.stream/early-access', { method: 'OPTIONS', headers: { origin: 'https://escrow.stream' } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://escrow.stream');
    const r = await (join as Fetcher).fetch(new Request('https://join.escrow.stream/early-access', { method: 'POST', headers: { origin: 'https://escrow.stream', 'content-type': 'application/json' }, body }), env);
    expect(r.status).toBe(200);
    expect([...env.store.keys()]).toEqual(['email:ada@example.com']);
  });

  it('takes sign-ups on join.crow.direct from both sites, into the same KV namespace, and refuses other origins', async () => {
    const env = kv();
    for (const [origin, email] of [['https://crow.direct', 'a@example.com'], ['https://www.crow.direct', 'b@example.com'], ['https://escrow.stream', 'c@example.com']]) {
      const r = await (join as Fetcher).fetch(new Request('https://join.crow.direct/early-access', { method: 'POST', headers: { origin: origin!, 'content-type': 'application/json' }, body: JSON.stringify({ email, page: '/' }) }), env);
      expect(r.status).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
    }
    expect([...env.store.keys()].sort()).toEqual(['email:a@example.com', 'email:b@example.com', 'email:c@example.com']);
    const other = await (join as Fetcher).fetch(new Request('https://join.crow.direct/early-access', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body }), env);
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBe('https://crow.direct');
  });
});
