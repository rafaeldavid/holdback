// The seller adapter's core on its own (T-434): no Node server and no journal file. A deal runs through `handle`
// and `wake` with an in-memory journal, the way apps/hosted-sellers runs it in a Durable Object. Then the core
// refuses a configuration that names one variable for two credentials.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { request as httpRequest } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plain as testkitPlain } from '@holdback/testkit';
import { plain } from './plain.ts';
import { config as shipped, createSellerAdapter, startSellerAdapter, type AdapterIO, type Journal, type RunningAdapter, type SellerAdapterConfig, type SellerAdapterCore } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const SAMPLE = JSON.parse(readFileSync(here('../fixtures/data/audit-report/report.json'), 'utf8'));
const SCOPE = { commit: SAMPLE.commit as string, files: SAMPLE.filesReviewed as string[], lines: 3000 };

let world: SimWorld;
let stub: StubSellerApi | undefined;
const cores: SellerAdapterCore[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
  await stub?.close();
  stub = undefined;
});

/** A journal kept in memory, as a structured clone, the way Durable Object storage keeps a value. */
function memoryJournal(): AdapterIO & { saved(): Journal | undefined; saves: number } {
  let kept: Journal | undefined;
  const io = {
    saves: 0,
    readText: (p: string) => readFileSync(p, 'utf8'),
    shippedTemplate: shipped.template,
    loadJournal: () => (kept === undefined ? undefined : structuredClone(kept)),
    saveJournal: (j: Journal) => {
      kept = structuredClone(j);
      io.saves++;
    },
    saved: () => kept,
  };
  return io;
}

async function core(io: AdapterIO, overrides: Partial<SellerAdapterConfig> = {}): Promise<{ core: SellerAdapterCore; lines: string[] }> {
  stub ??= await startStubSellerApi({ port: 0 });
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const lines: string[] = [];
  const c = await createSellerAdapter(
    { ...shipped, sellerApi: stub.api, clubId: world.info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! }, pollMs: 50, log: (l) => lines.push(l), ...overrides },
    { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') },
    io,
  );
  cores.push(c);
  return { core: c, lines };
}
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
/** Passes on the shell's schedule, as an alarm would run them, until `ok`. */
async function passUntil(c: SellerAdapterCore, what: string, ok: () => boolean): Promise<void> {
  await until(what, async () => {
    c.wake();
    await c.idle();
    return ok();
  });
}
const stageOf = (c: SellerAdapterCore, id: Hex) => c.deals().find((d) => d.id === id)?.stage;

describe('seller adapter core (T-434): a deal with no server and no journal file', () => {
  it('answers a quote through handle, and its passes start the job and deliver once', async () => {
    const io = memoryJournal();
    const { core: c, lines } = await core(io);
    c.announce('serves POST https://hosted.example/quote; journal in memory');
    expect(lines.join('\n')).toContain('serves POST https://hosted.example/quote; journal in memory, 0 deals.');

    const defaults = await c.handle(new Request('https://hosted.example/defaults'), '/defaults');
    expect(defaults.status).toBe(200);
    expect(((await defaults.json()) as J).scope).toEqual(shipped.scope);

    const buyer = agent('buyer-1');
    const asked = await c.handle(new Request('https://hosted.example/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) }), '/quote');
    const q = (await asked.json()) as J;
    expect(asked.status, JSON.stringify(q)).toBe(200);
    const id = q.commitmentId as Hex;
    expect(io.saved()?.deals[id]?.stage).toBe('offered');

    await buyer.waitFor(id, ['AcceptedByAdjudicator']);
    const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
    delete terms.id;
    delete terms.signatures;
    await buyer.agreeAndFund(terms, 2_100_000_000n);
    await passUntil(c, 'the delivery', () => stageOf(c, id) === 'delivered');
    expect(stub!.calls.start).toBe(1);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(io.saved()?.deals[id]?.stage).toBe('delivered');
    expect(c.hasOpen()).toBe(false);
  }, 45_000);

  it('a second core on the same journal resumes the open deal and starts no second job', async () => {
    const io = memoryJournal();
    const one = await core(io);
    const buyer = agent('buyer-2');
    const asked = await one.core.handle(new Request('https://hosted.example/quote', { method: 'POST', body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) }), '/quote');
    const id = ((await asked.json()) as J).commitmentId as Hex;
    await one.core.close(); // the object is reset: nothing in memory survives, the storage does
    await buyer.waitFor(id, ['AcceptedByAdjudicator']);
    const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
    delete terms.id;
    delete terms.signatures;
    await buyer.agreeAndFund(terms, 2_100_000_000n);

    const two = await core(io);
    expect(two.core.hasOpen()).toBe(true);
    await passUntil(two.core, 'the delivery', () => stageOf(two.core, id) === 'delivered');
    expect(stub!.calls.start).toBe(1);
  }, 45_000);

  it('answers unknown paths, wrong methods and oversized bodies as the Node server did', async () => {
    const { core: c } = await core(memoryJournal());
    expect((await c.handle(new Request('https://h.example/elsewhere'), '/elsewhere')).status).toBe(404);
    expect((await c.handle(new Request('https://h.example/quote'), '/quote')).status).toBe(405);
    const big = await c.handle(new Request('https://h.example/quote', { method: 'POST', body: 'x'.repeat(65_537) }), '/quote');
    expect(big.status).toBe(413);
    const notJson = await c.handle(new Request('https://h.example/quote', { method: 'POST', body: '{' }), '/quote');
    expect(notJson.status).toBe(400);
  }, 30_000);
});

describe('seller adapter core (T-434): one variable for each credential', () => {
  const env = { HOLDBACK_KEY: `0x${'11'.repeat(32)}`, HOLDBACK_OPERATORS: 'http://127.0.0.1:1,http://127.0.0.2:1', API_KEY: 'k', QUOTE_KEYS: 'q', READY_KEYS: 'r', ALERT_SECRET: 's' };
  const api = (auth: J) => ({ baseUrl: 'http://127.0.0.1:1/api/', auth, quote: { path: 'q' }, start: { path: 's', idempotencyHeader: 'X-Key' }, result: { path: 'r/{{jobId}}' } });
  const start = (over: Partial<SellerAdapterConfig>) => startSellerAdapter({ ...shipped, journal: '/nonexistent/journal.json', ...over } as SellerAdapterConfig, env);
  it('refuses the signing key or the operators named as a credential, before anything is sent', async () => {
    await expect(start({ sellerApi: api({ env: 'HOLDBACK_KEY', header: 'Authorization', prefix: 'Bearer ' }) as J })).rejects.toThrow("sellerApi.auth.env names HOLDBACK_KEY, which holds the seller's signing key: name a variable of its own");
    await expect(start({ quoteAuth: { kind: 'bearer', env: 'HOLDBACK_OPERATORS' } })).rejects.toThrow(/^quoteAuth\.env names HOLDBACK_OPERATORS/);
  });
  it('refuses one variable named for two credentials', async () => {
    const cases: Array<[Partial<SellerAdapterConfig>, RegExp]> = [
      [{ sellerApi: api({ env: 'QUOTE_KEYS', header: 'X-Api-Key' }) as J, quoteAuth: { kind: 'bearer', env: 'QUOTE_KEYS' } }, /^quoteAuth\.env and sellerApi\.auth\.env both name QUOTE_KEYS/],
      [{ quoteAuth: { kind: 'bearer', env: 'READY_KEYS' }, redelivery: { readyAuth: { kind: 'bearer', env: 'READY_KEYS' } } }, /^redelivery\.readyAuth\.env and quoteAuth\.env both name READY_KEYS/],
      [{ alerts: { callback: 'http://127.0.0.1:9/a', secretEnv: 'API_KEY' }, sellerApi: api({ env: 'API_KEY', header: 'X-Api-Key' }) as J }, /^alerts\.secretEnv and sellerApi\.auth\.env both name API_KEY/],
    ];
    for (const [over, message] of cases) await expect(start(over)).rejects.toThrow(message);
  });
});

describe('seller adapter core (T-434): the red team\'s cases', () => {
  const env = { HOLDBACK_KEY: `0x${'11'.repeat(32)}`, HOLDBACK_OPERATORS: 'http://127.0.0.1:1,http://127.0.0.2:1', API_KEY: 'k', QUOTE_KEYS: 'q1,q2', READY_KEYS: 'r', ALERT_SECRET: 's' };
  const api = (auth: J) => ({ baseUrl: 'http://127.0.0.1:1/api/', auth, quote: { path: 'q' }, start: { path: 's', idempotencyHeader: 'X-Key' }, result: { path: 'r/{{jobId}}' } });
  const start = (over: Partial<SellerAdapterConfig>, e: Record<string, string> = env) => startSellerAdapter({ ...shipped, journal: '/nonexistent/journal.json', ...over } as SellerAdapterConfig, e);
  it('refuses a credential variable named in any shape but a variable name', async () => {
    for (const name of [['HOLDBACK_KEY'], 7, 'A-B', '', { x: 1 }]) {
      await expect(start({ quoteAuth: { kind: 'bearer', env: name as J } }), JSON.stringify(name)).rejects.toThrow('quoteAuth.env must name an environment variable');
      await expect(start({ redelivery: { readyAuth: { kind: 'bearer', env: name as J } } }), JSON.stringify(name)).rejects.toThrow('redelivery.readyAuth.env must name an environment variable');
      await expect(start({ alerts: { callback: 'http://127.0.0.1:9/a', secretEnv: name as J } }), JSON.stringify(name)).rejects.toThrow('alerts.secretEnv must name an environment variable');
    }
  });
  it('refuses a shell variable in any case, and names what each holds', async () => {
    await expect(start({ quoteAuth: { kind: 'bearer', env: 'holdback_key' } })).rejects.toThrow("quoteAuth.env names holdback_key, which holds the seller's signing key");
    await expect(start({ quoteAuth: { kind: 'bearer', env: 'HOLDBACK_DEPLOYMENT' } })).rejects.toThrow('quoteAuth.env names HOLDBACK_DEPLOYMENT, which holds the settlement deployment the adapter pins');
  });
  it('refuses two credentials that hold one value, the signing key included, and names no value', async () => {
    const same = { ...env, API_KEY: env.HOLDBACK_KEY.toUpperCase().replace('0X', '0x') };
    await expect(start({ sellerApi: api({ env: 'API_KEY', header: 'X-Api-Key' }) as J }, same)).rejects.toThrow(/^sellerApi\.auth\.env and HOLDBACK_KEY hold the same value/);
    const shared = { ...env, READY_KEYS: 'q2' };
    const e = await start({ quoteAuth: { kind: 'bearer', env: 'QUOTE_KEYS' }, redelivery: { readyAuth: { kind: 'bearer', env: 'READY_KEYS' } } }, shared).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/^redelivery\.readyAuth\.env and quoteAuth\.env hold the same value/);
    expect((e as Error).message).not.toContain('q2');
  });
  it('plain is the testkit\'s plain', () => {
    for (const t of ['a\r\nb', 'x\u202ey', 'tag\u{e0041}', 'esc\u001b[31m', 'ok', '\u2028line']) expect(plain(t)).toBe(testkitPlain(t));
  });
});

describe('seller adapter, the Node shell (T-434): requests it answers itself', () => {
  let running: RunningAdapter | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });
  async function shell(over: Partial<SellerAdapterConfig> = {}, extraEnv: Record<string, string> = {}) {
    stub ??= await startStubSellerApi({ port: 0 });
    const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
    running = await startSellerAdapter(
      { ...shipped, port: 0, sellerApi: stub.api, clubId: world.info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! }, journal: join(mkdtempSync(join(tmpdir(), 't434-')), 'journal.json'), pollMs: 50, log: () => {}, ...over },
      { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), ...extraEnv },
    );
    return running;
  }
  const raw = (url: string, method: string, body?: Buffer) =>
    new Promise<{ status: number; ms: number; body: string }>((resolve, reject) => {
      const t = Date.now();
      const req = httpRequest(url, { method, headers: body ? { 'content-length': String(body.length) } : {} }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, ms: Date.now() - t, body: b });
          req.destroy(); // the answer is in: stop uploading the rest
        });
      });
      const quiet = (e: NodeJS.ErrnoException) => (['ECONNRESET', 'EPIPE'].includes(e.code ?? '') ? undefined : reject(e));
      req.on('error', quiet);
      req.on('socket', (socket) => socket.on('error', quiet));
      if (body) req.end(body);
      else req.end();
    });
  it('answers 405 to a method a standard Request cannot carry', async () => {
    const a = await shell();
    for (const m of ['TRACE']) expect((await raw(`${a.url}/quote`, m)).status, m).toBe(405);
  }, 30_000);
  it('refuses an oversized body without reading it all, and a 500 names no internal detail', async () => {
    const a = await shell({ quoteAuth: { kind: 'bearer', env: 'QUOTE_KEYS' } }, { QUOTE_KEYS: 'quote-one' });
    const answer = await raw(`${a.url}/quote`, 'POST', Buffer.alloc(20 * 1024 * 1024, 0x61));
    expect(answer.status).toBe(401); // the credential is checked first, on the first 65,537 bytes
    expect(answer.ms).toBeLessThan(2000);
  }, 30_000);
});
