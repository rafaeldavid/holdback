// T-451: every answer of the site Worker (crow-site) carries the security headers; HTML pages carry a content security
// policy that names the build's inline hashes, and nothing else about an answer changes: its body's bytes, its
// Cache-Control and its CORS header stay as the asset server or the route sent them.
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM Worker without type declarations
import site from '../apps/site/worker.js';
// @ts-expect-error -- plain ESM module without type declarations
import { COMMON, contentSecurityPolicy, forgetHashes, parseHashes } from '../apps/site/headers.js';

type Fetcher = { fetch(request: Request, env: unknown, ctx?: unknown): Promise<Response> };
const S = `sha256-${'A'.repeat(43)}=`, T = `sha256-${'B'.repeat(43)}=`;
const HASHES = { scripts: [S], styles: [T] };

/** A stand-in assets binding: each path answers its own type; /csp-hashes.json answers `hashes` (or 404 when null). */
function assets(hashes: unknown = HASHES) {
  const asked: string[] = [];
  const types: Record<string, string> = { '/llms.txt': 'text/plain', '/security.txt': 'text/plain', '/try.mjs': 'text/javascript', '/favicon.ico': 'image/vnd.microsoft.icon', '/status.json': 'application/json', '/version.json': 'application/json' };
  const ASSETS = {
    fetch: async (r: Request) => {
      const p = new URL(r.url).pathname;
      asked.push(p);
      if (p === '/csp-hashes.json') return hashes === null ? new Response('not found', { status: 404 }) : Response.json(hashes);
      if (p === '/version.json') return Response.json({ commit: 'abc' });
      return new Response(`bytes of ${p} – Crow’s`, { status: p === '/missing' ? 404 : 200, headers: { 'content-type': types[p] ?? 'text/html', 'cache-control': 'public, max-age=0, must-revalidate' } });
    },
  };
  return { asked, env: { ASSETS } };
}
const get = (url: string, env: unknown) => (site as Fetcher).fetch(new Request(url), env, { waitUntil: () => undefined });

function common(r: Response) {
  for (const [k, v] of Object.entries(COMMON as Record<string, string>)) expect(r.headers.get(k), k).toBe(v);
  expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  expect(r.headers.get('x-frame-options')).toBe('DENY');
  expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
}

afterEach(() => forgetHashes());

describe('the security headers on the site Worker (T-451)', () => {
  it('each kind of page carries the policy with the build’s hashes, no unsafe-inline for scripts, and no framing', async () => {
    const { env } = assets();
    for (const path of ['/', '/demo/', '/trust', '/status', '/problems/not_found', '/missing']) {
      const r = await get(`https://crow.direct${path}`, env);
      common(r);
      const csp = r.headers.get('content-security-policy')!;
      expect(csp).toBe(contentSecurityPolicy(HASHES, path));
      expect(csp).toContain(`script-src 'self' '${S}'`);
      expect(csp).toContain(`style-src 'self' '${T}'`);
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("connect-src 'self' https://join.crow.direct https://eth-sepolia.blockscout.com");
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|https:(?!\/\/)/);
      expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(r.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    }
  });

  it('the visual walkthrough alone may use inline styles and its Google font; its scripts are hashed as elsewhere', async () => {
    const { env } = assets();
    const csp = (await get('https://crow.direct/visualdemo/', env)).headers.get('content-security-policy')!;
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain('font-src https://fonts.gstatic.com');
    expect(csp).toContain(`script-src 'self' '${S}';`);
    for (const path of ['/visualdemox', '/demo/visualdemo']) expect((await get(`https://crow.direct${path}`, env)).headers.get('content-security-policy')).not.toContain('unsafe-inline');
  });

  it('the guides, the bundles, the icon and the JSON keep their bytes and type, and carry the headers with a policy that runs nothing', async () => {
    const { env } = assets();
    for (const [path, type] of [['/llms.txt', 'text/plain; charset=utf-8'], ['/try.mjs', 'text/javascript; charset=utf-8'], ['/favicon.ico', 'image/vnd.microsoft.icon'], ['/status.json', 'application/json'], ['/.well-known/security.txt', 'text/plain; charset=utf-8']] as const) {
      const r = await get(`https://crow.direct${path}`, env);
      common(r);
      expect(r.headers.get('content-type')).toBe(type);
      expect(await r.text()).toBe(`bytes of ${path === '/.well-known/security.txt' ? '/security.txt' : path} – Crow’s`);
      expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(r.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(r.headers.get('cross-origin-opener-policy')).toBeNull();
    }
  });

  it('version.json keeps its CORS header and no-store; the 301 from escrow.stream carries the headers too', async () => {
    const { env } = assets();
    const v = await get('https://crow.direct/version.json', env);
    common(v);
    expect(v.headers.get('access-control-allow-origin')).toBe('*');
    expect(v.headers.get('cache-control')).toBe('no-store');
    const moved = await get('https://escrow.stream/trust?x=1', env);
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('https://crow.direct/trust?x=1');
    common(moved);
  });

  it('reads the hashes once per instance; without a readable hashes file, pages run no inline script or style (fail closed)', async () => {
    const one = assets();
    await get('https://crow.direct/', one.env);
    await get('https://crow.direct/trust', one.env);
    expect(one.asked.filter((p) => p === '/csp-hashes.json')).toHaveLength(1);
    for (const bad of [null, { scripts: ["'unsafe-inline'"], styles: [] }, { scripts: [S] }]) {
      forgetHashes();
      const { env } = assets(bad);
      const csp = (await get('https://crow.direct/', env)).headers.get('content-security-policy')!;
      expect(csp).toContain("script-src 'self';");
      expect(csp).toContain("style-src 'self';");
      expect(csp).not.toContain('unsafe');
    }
    expect(parseHashes({ scripts: [S, 'sha256-x'], styles: [] })).toBeNull();
    expect(parseHashes(HASHES)).toEqual(HASHES);
  });
});
