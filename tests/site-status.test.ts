// T-421: the site Worker relays the two operators' public discovery reads for the status page, and serves the
// security.txt asset at /.well-known/security.txt. The trust surfaces' builders (site/trust.mjs) write a security.txt
// that RFC 9116's five fields parse from, and pages whose every statement links its source.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM Worker without type declarations
import site from '../apps/site/worker.js';
// @ts-expect-error -- plain ESM module without type declarations
import { checkOperator, OPERATORS, STATUS_PATH, statusResponse } from '../apps/site/status.js';
// @ts-expect-error -- plain ESM module without type declarations
import { parseSecurityTxt, securityTxt, SECURITY_CONTACT, STATUS_SOURCES, statusPage, trustPage } from '../site/trust.mjs';

type Fetcher = { fetch(request: Request, env: unknown, ctx?: unknown): Promise<Response> };
const discovery = (operatorId: string) => new Response(JSON.stringify({ operatorId, apiVersion: 'v1', domain: { chainId: 11155111 } }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the status relay (apps/site/status.js)', () => {
  it('reads each operator once and says operational for a discovery document', async () => {
    const asked: string[] = [];
    const fetcher = async (u: string) => (asked.push(u), discovery(u.includes('api2') ? 'demo-op-2' : 'demo-op-1'));
    const r = await statusResponse(new Request(`https://crow.direct${STATUS_PATH}`), { fetcher, now: () => Date.UTC(2026, 10, 14, 12) });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=15');
    const body = await r.json();
    expect(body.checkedAt).toBe('2026-11-14T12:00:00.000Z');
    expect(body.operators.map((o: { id: string; state: string; operatorId: string }) => [o.id, o.state, o.operatorId])).toEqual([['op1', 'operational', 'demo-op-1'], ['op2', 'operational', 'demo-op-2']]);
    expect(asked).toEqual(OPERATORS.map((o: { url: string }) => `${o.url}/.well-known/holdback.json`));
  });
  it('says down, with the reason, for a 5xx, a body that is not discovery, and no answer', async () => {
    expect(await checkOperator(OPERATORS[0], { fetcher: async () => new Response('x', { status: 503 }) })).toMatchObject({ state: 'down', status: 503, reason: 'answered HTTP 503' });
    expect(await checkOperator(OPERATORS[0], { fetcher: async () => new Response('<html>', { status: 200 }) })).toMatchObject({ state: 'down', status: 200 });
    expect(await checkOperator(OPERATORS[0], { fetcher: async () => Promise.reject(new TypeError('fetch failed')) })).toMatchObject({ state: 'down', status: 0, reason: 'no answer' });
  });
  it('answers from the cache while it holds a read, and refuses methods other than GET and HEAD', async () => {
    const store = new Map<string, Response>();
    const cache = { match: async (k: Request) => store.get(k.url)?.clone(), put: async (k: Request, v: Response) => void store.set(k.url, v) };
    let reads = 0;
    const fetcher = async () => (reads++, discovery('demo-op-1'));
    const pending: Promise<unknown>[] = [];
    const o = { cache, fetcher, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    await statusResponse(new Request(`https://crow.direct${STATUS_PATH}`), o);
    await Promise.all(pending);
    await statusResponse(new Request(`https://crow.direct${STATUS_PATH}`), o);
    expect(reads).toBe(2); // two operators, read once
    expect((await statusResponse(new Request(`https://crow.direct${STATUS_PATH}`, { method: 'POST' }), o)).status).toBe(405);
  });
});

describe('the site Worker (crow-site), T-421 routes', () => {
  it('serves the security.txt asset at /.well-known/security.txt, as UTF-8 text', async () => {
    const asked: string[] = [];
    const env = { ASSETS: { fetch: async (r: Request) => (asked.push(new URL(r.url).pathname), new Response('Contact: x\n', { status: 200, headers: { 'content-type': 'text/plain' } })) } };
    const r = await (site as Fetcher).fetch(new Request('https://crow.direct/.well-known/security.txt'), env, { waitUntil() {} });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(asked).toEqual(['/security.txt']);
  });
  it('leaves other paths to the assets', async () => {
    const asked: string[] = [];
    const env = { ASSETS: { fetch: async (r: Request) => (asked.push(new URL(r.url).pathname), new Response('ok', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) } };
    await (site as Fetcher).fetch(new Request('https://crow.direct/trust'), env, { waitUntil() {} });
    await (site as Fetcher).fetch(new Request('https://crow.direct/status'), env, { waitUntil() {} });
    expect(asked).toEqual(['/trust', '/status']);
  });
});

describe('the trust surfaces (site/trust.mjs)', () => {
  it('writes a security.txt with the five fields RFC 9116 asks for, expiring 180 days after the build', () => {
    const fields = parseSecurityTxt(securityTxt(new Date('2026-11-14T15:00:00Z')));
    expect(fields.get('Contact')).toEqual([SECURITY_CONTACT]);
    expect(fields.get('Expires')).toEqual(['2027-05-13T00:00:00.000Z']);
    expect(fields.get('Preferred-Languages')).toEqual(['en']);
    expect(fields.get('Canonical')).toEqual(['https://crow.direct/.well-known/security.txt']);
    expect(fields.get('Policy')).toEqual(['https://github.com/rafaeldavid/holdback/blob/main/SECURITY.md']);
    expect(() => parseSecurityTxt('Contact https://x\n')).toThrow(/not "Field: value"/);
  });
  it('gives every statement on the trust page a source link', () => {
    const items = [...String(trustPage()).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    expect(items.length).toBeGreaterThan(20);
    for (const it of items) expect(it).toMatch(/<p class="src">Source: <a href="https:\/\//);
  });
  it('has the status page read its listed public sources only', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(statusPage())![1]!;
    expect([...script.matchAll(/timed\('([^']+)'\)/g)].map((m) => m[1])).toEqual(STATUS_SOURCES);
  });
});
