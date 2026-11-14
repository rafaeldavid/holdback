// T-413: the site, the test agents and early access each answer GET …/version.json with the commit they were built
// from and the time Cloudflare created the live version, in one shape (apps/site/build-info.schema.json), uncached.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module without type declarations
import { buildInfo } from '../apps/site/build-info.js';
// @ts-expect-error -- plain ESM Worker without type declarations
import site from '../apps/site/worker.js';
// @ts-expect-error -- plain ESM Worker without type declarations
import join from '../apps/early-access/worker.js';
import agents from '../apps/test-agents/src/worker.ts';

type Fetcher = { fetch(request: Request, env: unknown): Promise<Response> };
const COMMIT = '016c28e0123456789abcdef0123456789abcdef0';
const META = { id: '6122d260-d59b-41a0-8699-3bc6cacaa354', tag: '', timestamp: '2026-11-14T09:30:05.123Z' };
const schema = JSON.parse(readFileSync(new URL('../apps/site/build-info.schema.json', import.meta.url), 'utf8'));
const valid = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: true }).compile(schema);

async function read(worker: Fetcher, url: string, env: Record<string, unknown>) {
  const r = await worker.fetch(new Request(url), env);
  const body = await r.json();
  expect(valid(body), JSON.stringify(valid.errors)).toBe(true);
  return { r, body };
}
const expectUncached = (r: Response) => {
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(r.headers.get('cache-control')).toBe('no-store');
};

describe('buildInfo', () => {
  it('names the commit, the live version and its creation time', () => {
    expect(buildInfo({ worker: 'crow-site', commit: COMMIT.toUpperCase(), metadata: META })).toEqual({ schema: 'crow.build/1', worker: 'crow-site', commit: COMMIT, deployedAt: '2026-11-14T09:30:05.123Z', versionId: META.id });
  });

  it('reads null for anything malformed or absent, never a guess', () => {
    for (const commit of [undefined, '', 'main', `${COMMIT}0`, 42]) expect(buildInfo({ worker: 'crow-site', commit, metadata: META }).commit).toBeNull();
    for (const metadata of [undefined, null, {}, { id: 'v1', timestamp: 'yesterday' }, { id: 7, timestamp: 7 }]) {
      const b = buildInfo({ worker: 'crow-site', commit: COMMIT, metadata });
      expect([b.deployedAt, b.versionId]).toEqual([null, null]);
      expect(valid(b)).toBe(true);
    }
  });
});

describe('GET …/version.json on each Worker', () => {
  it('the site: the commit from the built version.json asset, the time from the binding', async () => {
    const env = { CF_VERSION_METADATA: META, ASSETS: { fetch: async () => new Response(`{\n  "commit": "${COMMIT}"\n}\n`, { status: 200, headers: { 'content-type': 'application/json' } }) } };
    const { r, body } = await read(site, 'https://crow.direct/version.json', env);
    expectUncached(r);
    expect(body).toEqual({ schema: 'crow.build/1', worker: 'crow-site', commit: COMMIT, deployedAt: META.timestamp, versionId: META.id });
  });

  it('the site: a missing or unreadable asset reads a null commit, and other paths still serve the assets', async () => {
    for (const asset of [new Response('not found', { status: 404 }), new Response('<!doctype html>', { status: 200 }), new Response('{"commit":null}', { status: 200 })]) {
      const { body } = await read(site, 'https://crow.direct/version.json', { CF_VERSION_METADATA: META, ASSETS: { fetch: async () => asset.clone() } });
      expect(body.commit).toBeNull();
    }
    const r = await (site as Fetcher).fetch(new Request('https://crow.direct/llms.txt'), { ASSETS: { fetch: async () => new Response('guide', { status: 200 }) } });
    expect(await r.text()).toBe('guide');
  });

  it('the test agents: on both agents\' paths, before the Durable Object, from BUILD_COMMIT', async () => {
    const env = { BUILD_COMMIT: COMMIT, CF_VERSION_METADATA: META, AGENTS: { idFromName: () => { throw new Error('the Durable Object must not be reached'); } } };
    for (const url of ['https://crow.direct/agents/test-seller/version.json', 'https://crow.direct/agents/test-buyer/version.json']) {
      const { r, body } = await read(agents as unknown as Fetcher, url, env);
      expectUncached(r);
      expect(body).toEqual({ schema: 'crow.build/1', worker: 'crow-test-agents', commit: COMMIT, deployedAt: META.timestamp, versionId: META.id });
    }
    // A POST to the same path is the agent's own business: it goes to the Durable Object.
    await expect((agents as unknown as Fetcher).fetch(new Request('https://crow.direct/agents/test-seller/version.json', { method: 'POST' }), env)).rejects.toThrow(/must not be reached/);
  });

  it('early access: on join.crow.direct, from BUILD_COMMIT; the sign-up route is unchanged', async () => {
    const { r, body } = await read(join, 'https://join.crow.direct/version.json', { BUILD_COMMIT: COMMIT, CF_VERSION_METADATA: META });
    expectUncached(r);
    expect(body).toEqual({ schema: 'crow.build/1', worker: 'crow-early-access', commit: COMMIT, deployedAt: META.timestamp, versionId: META.id });
    const unknown = await read(join, 'https://join.crow.direct/version.json', {});
    expect(unknown.body).toMatchObject({ commit: null, deployedAt: null, versionId: null });
    const other = await (join as Fetcher).fetch(new Request('https://join.crow.direct/anything'), {});
    expect(other.status).toBe(404);
  });
});

describe('HEAD …/version.json', () => {
  it('answers 200 with the same headers and no body on each Worker', async () => {
    const env = { BUILD_COMMIT: COMMIT, CF_VERSION_METADATA: META, ASSETS: { fetch: async () => new Response(`{"commit":"${COMMIT}"}`, { status: 200 }) } };
    for (const [worker, url] of [[site, 'https://crow.direct/version.json'], [agents, 'https://crow.direct/agents/test-seller/version.json'], [join, 'https://join.crow.direct/version.json']] as const) {
      const r = await (worker as unknown as Fetcher).fetch(new Request(url, { method: 'HEAD' }), env);
      expectUncached(r);
      expect(await r.text()).toBe('');
    }
  });
});

describe('each Worker binds its version metadata', () => {
  it.each(['apps/site/wrangler.jsonc', 'apps/test-agents/wrangler.jsonc', 'apps/early-access/wrangler.jsonc'])('%s', (file) => {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(text).toMatch(/"version_metadata":\s*\{\s*"binding":\s*"CF_VERSION_METADATA"\s*\}/);
  });
});
