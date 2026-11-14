// T-462: every answer of crow-test-agents carries the operators' security headers (imported from
// apps/demo-cloud/src/headers.ts, T-451); the two HTML cards carry a policy whose one hash is their inline style as
// served; CORS, Cache-Control and bodies stay as the agents wrote them; plain HTTP is redirected before it reaches them.
import { createHash } from 'node:crypto';
import { MemoryStorage } from '@holdback/demo-cloud';
import { describe, expect, it } from 'vitest';
import { API_HEADERS } from '../../demo-cloud/src/headers.ts';
import { CARD_POLICY } from './headers.ts';
import worker, { Agents, type Env } from './worker.ts';

class FakeStorage extends MemoryStorage {
  alarm: number | null = null;
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
}

/** The Worker in front of a real Agents object, with unreachable operators: nothing here calls them. */
function deployed(): { env: Env; reached: () => number } {
  let reached = 0;
  const base: Env = { AGENTS: undefined as never, OPERATOR_URLS: 'http://127.0.0.1:9,http://localhost:9', SELLER_URL: 'https://crow.direct/agents/test-seller', BUYER_URL: 'https://crow.direct/agents/test-buyer', TEST_AGENTS_SEED: `0x${'22'.repeat(32)}` };
  const object = new Agents({ storage: new FakeStorage() }, base);
  const env: Env = { ...base, AGENTS: { idFromName: (n: string) => n, get: () => ({ fetch: (r: Request) => (reached++, object.fetch(r)) }) } };
  return { env, reached: () => reached };
}
const call = (env: Env, url: string, init: RequestInit = {}) => worker.fetch(new Request(url, init), env);
const S = 'https://crow.direct/agents/test-seller', B = 'https://crow.direct/agents/test-buyer';

function hasAll(r: Response) {
  for (const [k, v] of Object.entries(API_HEADERS)) if (k !== 'content-security-policy') expect(r.headers.get(k), k).toBe(v);
  expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  expect(r.headers.get('x-frame-options')).toBe('DENY');
  expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
}

describe('the security headers on crow-test-agents (T-462)', () => {
  it('each card carries a policy whose one style hash is the style it serves, and its JSON block still reads', async () => {
    const { env } = deployed();
    for (const [url, id] of [[S, 'crow-agent'], [B, 'crow-buyer']] as const) {
      const r = await call(env, url);
      expect(r.status).toBe(200);
      hasAll(r);
      expect([r.headers.get('content-type'), r.headers.get('cache-control')]).toEqual(['text/html; charset=utf-8', 'no-store']);
      const html = await r.text();
      const styles = [...html.matchAll(/<style>([^<]*)<\/style>/g)].map((m) => m[1]!);
      expect(styles).toHaveLength(1);
      const hash = `'sha256-${createHash('sha256').update(styles[0]!, 'utf8').digest('base64')}'`;
      expect(r.headers.get('content-security-policy')).toBe(CARD_POLICY);
      expect(CARD_POLICY).toBe(`default-src 'none'; style-src ${hash}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(html).toContain(`<script type="application/json" id="${id}">`);
      expect(html).not.toMatch(/\sstyle=|\son[a-z]+=/i);
    }
  });

  it('the JSON an agent reads keeps its CORS, no-store and body, with the operators’ policy', async () => {
    const { env } = deployed();
    for (const [url, status] of [[`${S}/agent.json`, 200], [`${S}/health`, 200], [`${S}/status?token=x`, 400], [`${S}/nope`, 404], [`${B}/agent.json`, 200], [`${B}/health`, 200], [`${B}/status/0x00`, 400]] as const) {
      const r = await call(env, url);
      expect(r.status, url).toBe(status);
      hasAll(r);
      expect(r.headers.get('content-security-policy')).toBe(API_HEADERS['content-security-policy']);
      expect([r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('access-control-allow-origin')]).toEqual(['application/json', 'no-store', '*']);
      expect(typeof (await r.json())).toBe('object');
    }
  });

  it('the preflights and the build reads keep their CORS headers, and carry the headers too', async () => {
    const { env } = deployed();
    const pre = await call(env, `${S}/requests`, { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    hasAll(pre);
    expect([pre.headers.get('access-control-allow-origin'), pre.headers.get('access-control-allow-methods'), pre.headers.get('access-control-allow-headers')]).toEqual(['*', 'GET, POST, OPTIONS', 'content-type']);
    const buyerPre = await call(env, `${B}/offers`, { method: 'OPTIONS' });
    expect(buyerPre.headers.get('access-control-allow-headers')).toBe('content-type, idempotency-key');
    hasAll(buyerPre);
    const v = await call(env, `${S}/version.json`);
    hasAll(v);
    expect([v.headers.get('access-control-allow-origin'), v.headers.get('cache-control')]).toEqual(['*', 'no-store']);
  });

  it('plain HTTP reaches no agent: a read gets a 301 and a write a 308 to HTTPS; escrow.stream keeps its 308; local runs stay on HTTP', async () => {
    const { env, reached } = deployed();
    for (const [method, status] of [['GET', 301], ['HEAD', 301], ['POST', 308]] as const) {
      const r = await call(env, 'http://crow.direct/agents/test-seller/requests?x=1', { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect([r.status, r.headers.get('location')]).toEqual([status, 'https://crow.direct/agents/test-seller/requests?x=1']);
      hasAll(r);
    }
    expect(reached()).toBe(0);
    const old = await call(env, 'https://escrow.stream/agents/test-seller/agent.json', { method: 'POST', body: '{}' });
    expect([old.status, old.headers.get('location')]).toEqual([308, 'https://crow.direct/agents/test-seller/agent.json']);
    hasAll(old);
    expect((await call(env, 'http://127.0.0.1:8790/agents/test-seller/health')).status).toBe(200);
    expect(reached()).toBe(1);
  });
});
