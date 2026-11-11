// The seller adapter (T-318) against the stub seller API, on SimChain: a quote becomes a signed offer, a
// funded hold starts one job, and a result is delivered only after the seller's own preflight passes.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTypedData, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { loadTermsFile } from '@holdback/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { config as shipped, loadConfig, startSellerAdapter, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi, type StubOptions } from './seller-adapter-stub.ts';
import { serveTwoOrigins } from './two-origins.ts';
import { knownPins, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const SAMPLE = JSON.parse(readFileSync(here('../fixtures/data/audit-report/report.json'), 'utf8'));
/** The sample deal's scope. The stub prices 3,000 lines at 2,000.00 tUSD and quotes 4 days. */
const SCOPE = { commit: SAMPLE.commit as string, files: SAMPLE.filesReviewed as string[], lines: 3000 };
const FOUR_DAYS_SEC = 4 * 86_400;

let world: SimWorld;
let stub: StubSellerApi | undefined;
const adapters: RunningAdapter[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  await stub?.close();
  stub = undefined;
});

/** An adapter for seller-1 on this world. The keys reach it as environment values only. */
async function adapter(overrides: Partial<SellerAdapterConfig> = {}, stubOptions: StubOptions = {}) {
  stub ??= await startStubSellerApi({ port: 0, ...stubOptions });
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const lines: string[] = [];
  const running = await startSellerAdapter(
    {
      ...shipped,
      port: 0,
      sellerApi: stub.api,
      clubId: world.info.clubId,
      adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! },
      journal: join(mkdtempSync(join(tmpdir(), 't318-')), 'journal.json'),
      pollMs: 50,
      log: (line) => lines.push(line),
      ...overrides,
    },
    { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') },
  );
  adapters.push(running);
  return { running, lines };
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: J }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const quoteFor = (a: RunningAdapter, buyer: Agent, scope: unknown = SCOPE, headers: Record<string, string> = {}) =>
  post(`${a.url}/quote`, { buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope }, headers);

/** The buyer's side as T-319 plays it: read the commitment by its ID, check it, agree and fund. */
async function termsOf(buyer: Agent, id: Hex): Promise<J> {
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  return terms;
}
async function fund(buyer: Agent, id: Hex): Promise<J> {
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  return buyer.agreeAndFund(await termsOf(buyer, id), 2_100_000_000n);
}
const events = async (buyer: Agent, id: Hex, type: string): Promise<J[]> => (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === type);
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = (a: RunningAdapter, id: Hex) => a.deals().find((d) => d.id === id)?.stage;

describe('seller adapter: quote to offer', () => {
  it('answers a quote with an offer the seller signed, naming the buyer, at the quoted price', async () => {
    const { running } = await adapter();
    const buyer = agent('buyer-1');
    const q = await quoteFor(running, buyer);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(Object.keys(q.body).sort()).toEqual(['commitmentId', 'expiresAt', 'fees', 'price']);
    expect(q.body.price).toEqual({ token: 'tUSD', amount: '2000000000' }); // 2,000.00 tUSD in base units, a string
    expect(q.body.fees.adjudication).toEqual({ token: 'tUSD', amount: expect.stringMatching(/^[1-9][0-9]*$/) });
    expect(q.body.fees.operator).toBeNull(); // this world's operators publish no fee
    expect(q.body.fees.total).toEqual({ token: 'tUSD', amount: (2_000_000_000n + BigInt(q.body.fees.adjudication.amount)).toString() });

    const signed = await buyer.call('GET', `/v1/commitments/${q.body.commitmentId}/terms`);
    const { id, signatures, ...terms } = signed;
    expect(id).toBe(q.body.commitmentId);
    expect(terms.buyer).toBe(buyer.address);
    expect(terms.buyerEncryptionPublicKey).toBe(buyer.encryptionPublicKey);
    expect(terms.seller).toBe(acct('seller-1').address.toLowerCase());
    expect(terms.price).toEqual(q.body.price);
    expect(terms.timing.offerExpiresAt).toBe(q.body.expiresAt);
    expect((Date.parse(terms.timing.deliverBy) - Date.parse(terms.createdAt)) / 1000).toBe(FOUR_DAYS_SEC);
    expect(await verifyTypedData({ address: terms.seller, ...typedOf('CommitmentTerms', terms, buyer.domain), signature: signatures.seller })).toBe(true);

    // The template filled with the sample scope is the audit-report deal of T-317.
    const sample = loadTermsFile(here('../fixtures/terms/audit-report.yaml'));
    expect(terms.acceptance).toEqual(sample.acceptance);
    expect(terms.deliverable.format).toBe('application/json');
    expect(terms.deliverable.description).toContain(`commit ${SCOPE.commit}. Scope: ${SCOPE.files.join(', ')}.`);
    expect(stub!.calls.start).toBe(0); // no hold yet, so no work
  });

  it('refuses a scope outside the configured rules and makes no offer', async () => {
    const { running } = await adapter();
    const buyer = agent('buyer-1');
    const bad: unknown[] = [
      { ...SCOPE, commit: 'main' },
      { ...SCOPE, files: [] },
      { ...SCOPE, files: ['a.sol', 'a.sol'] },
      { ...SCOPE, files: ['{{commit}}'] },
      { ...SCOPE, lines: 12.5 },
      { ...SCOPE, lines: '3000' },
      { ...SCOPE, extra: true },
      { commit: SCOPE.commit, files: SCOPE.files },
      'everything',
    ];
    for (const scope of bad) {
      const r = await quoteFor(running, buyer, scope);
      expect(r.status, JSON.stringify(scope)).toBe(400);
      expect(r.body.type).toBe('invalid_request');
    }
    expect((await post(`${running.url}/quote`, { buyer: 'me', buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE })).status).toBe(400);
    expect((await post(`${running.url}/quote`, { buyer: buyer.address, buyerEncryptionPublicKey: 'short', scope: SCOPE })).status).toBe(400);
    expect(stub!.calls.quote).toBe(0);
    expect(running.deals()).toEqual([]);
  });

  it('replays a quote on the same Idempotency-Key and answers 409 when the body differs', async () => {
    const { running } = await adapter();
    const buyer = agent('buyer-1');
    const key = { 'idempotency-key': 'quote-1' };
    const first = await quoteFor(running, buyer, SCOPE, key);
    const again = await quoteFor(running, buyer, SCOPE, key);
    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    expect(running.deals()).toHaveLength(1);
    const other = await quoteFor(running, buyer, { ...SCOPE, lines: 4000 }, key);
    expect(other.status).toBe(409);
    expect(running.deals()).toHaveLength(1);
  });

  it('refuses a price from the seller API that is not a base-unit decimal string', async () => {
    for (const amount of [2000.5, 2_000_000_000, '2000.50', '-1', '2e9']) {
      const { running } = await adapter({}, { quoteOverride: { price: { token: 'tUSD', amount } } });
      const r = await quoteFor(running, agent('buyer-1'));
      expect(r.status, String(amount)).toBe(502);
      expect(running.deals()).toEqual([]);
      await running.close();
      await stub!.close();
      stub = undefined;
    }
  });

  it('refuses a price in a token other than the settlement layer\'s, and says which token it holds', async () => {
    // A seller API set up for another settlement layer prices in that layer's token; this world holds tUSD.
    const { running, lines } = await adapter({}, { token: 'tUSDC' });
    const r = await quoteFor(running, agent('buyer-1'));
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ type: 'seller_api_failed', detail: 'the seller could not price this scope' });
    expect(lines.join('\n')).toContain("Quote refused: the seller API priced in tUSDC; this settlement layer's token is tUSD (tUSD).");
    expect(running.deals()).toEqual([]);
  });
});

describe('seller adapter: the settlement layer', () => {
  it('signs under the domain the operators serve, and refuses to start on one that is not pinned', async () => {
    // The adapter's offer on this world verifies under the domain discovery serves (the first quote test). Two
    // operators that serve another domain: the adapter stops before it signs anything, and names the domain.
    const foreign = { name: 'Holdback', version: '0.7', chainId: 99_999, verifyingContract: `0x${'12'.repeat(20)}` };
    const world = { fetch: async () => new Response(JSON.stringify({ domain: foreign }), { headers: { 'content-type': 'application/json' } }), work: async () => {} };
    const served = await serveTwoOrigins(world as unknown as Parameters<typeof serveTwoOrigins>[0]);
    stub = await startStubSellerApi({ port: 0 });
    try {
      const start = startSellerAdapter(
        { ...shipped, port: 0, sellerApi: stub.api, journal: join(mkdtempSync(join(tmpdir(), 't321-')), 'journal.json'), log: () => {} },
        { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: served.urls.join(',') },
      );
      await expect(start).rejects.toThrow(/^the operators serve EIP-712 domain \{"chainId":99999,.*\}, not one pinned in verify\.ts \(/);
    } finally {
      await served.close();
    }
  });
});

/** Two operators that serve only a discovery document: enough for the adapter to stop before it signs anything. */
async function discoveryOnly(doc: J) {
  const fake = { fetch: async () => new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } }), work: async () => {} };
  return serveTwoOrigins(fake as unknown as Parameters<typeof serveTwoOrigins>[0]);
}
/** Runs a node script as a child process. Never spawnSync: the worlds these scripts call run in this process. */
const runNode = (args: string[], env: Record<string, string | undefined>) =>
  new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
const mandatesOf = async (op: string, address: string): Promise<J[]> => {
  const res = await fetch(`${op}/v1/agents/${address}`);
  return res.status === 404 ? [] : ((await res.json()) as J).mandates;
};

describe('seller adapter: one configuration file (T-331)', () => {
  it('starts from a file that names only the seller API, with the club and adjudicators from discovery', async () => {
    stub = await startStubSellerApi({ port: 0, pollsUntilComplete: 0 });
    const dir = mkdtempSync(join(tmpdir(), 't331-'));
    const file = join(dir, 'seller.json');
    writeFileSync(file, JSON.stringify({ port: 0, sellerApi: stub.api }));
    const child = spawn(process.execPath, [here('./seller-adapter.ts'), file], { cwd: dir, env: { ...process.env, HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const exited = new Promise<number | null>((r) => child.on('exit', r));
    try {
      await until('the adapter to listen', () => /serves POST (http:\/\/\S+)\/quote/.test(out) || child.exitCode !== null);
      const url = /serves POST (http:\/\/\S+)\/quote/.exec(out)?.[1];
      expect(url, err).toBeDefined();
      const buyer = agent('buyer-1');
      const q = await post(`${url}/quote`, { buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE });
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      const terms = await termsOf(buyer, q.body.commitmentId);
      const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address.toLowerCase());
      expect(terms.clubId).toBe(world.info.clubId);
      expect([terms.adjudication.adjudicator, terms.adjudication.fallbackAdjudicator, terms.adjudication.appealAdjudicator].map((a: string) => a.toLowerCase())).toEqual([primary, fallback, appeal]);
      expect(out).toMatch(/club sim-club and its adjudicators from discovery/);
      // The journal lands in the working directory, as before.
      expect(Object.keys(JSON.parse(readFileSync(join(dir, 'seller-adapter.journal.json'), 'utf8')).deals)).toEqual([q.body.commitmentId]);
    } finally {
      child.kill('SIGTERM');
    }
    expect(await exited).toBe(0);
    expect(out + err).not.toContain(acct('seller-1').privateKey.slice(2));
  }, 30_000);

  it('stops with the usage when no file is named, and names a file it cannot read', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [here('./seller-adapter.ts'), ...args], { encoding: 'utf8', env: { ...process.env, HOLDBACK_KEY: '', HOLDBACK_OPERATORS: '' } });
    const none = run();
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/usage: node examples\/seller-adapter\.ts <config\.json> \[--sim\]/);
    const missing = run(join(tmpdir(), 't331-missing.json'));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/cannot read .*t331-missing\.json/);
  });

  it('reads paths beside the file, defaults the rest, and refuses an unknown field or a removed option, naming it', () => {
    const dir = mkdtempSync(join(tmpdir(), 't331-'));
    const write = (body: J) => {
      const f = join(dir, `c-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(f, JSON.stringify(body));
      return f;
    };
    const api = { quote: 'http://127.0.0.1:1/quote', start: 'http://127.0.0.1:1/jobs', result: 'http://127.0.0.1:1/jobs/{jobId}/result' };
    // Only the seller API: every other field is the shipped default, with no club and no adjudicators named.
    const plain = loadConfig(write({ sellerApi: api }));
    expect(plain).toEqual({ ...shipped, sellerApi: api });
    expect(plain.clubId).toBeUndefined();
    expect(plain.adjudicators).toBeUndefined();
    // A template and a mapping are read beside the file; the journal stays where the adapter runs; windows merge.
    const own = loadConfig(write({ sellerApi: api, template: 'terms.json', reportMapping: 'map.json', scope: { commit: { type: 'string', pattern: '^[0-9a-f]{40}$' } }, timing: { deliverWithinSec: 60 }, journal: 'j.json' }));
    expect(own.template).toBe(join(dir, 'terms.json'));
    expect(own.reportMapping).toBe(join(dir, 'map.json'));
    expect(own.journal).toBe('j.json');
    expect(own.timing).toEqual({ ...shipped.timing, deliverWithinSec: 60 });
    expect(own.options).toBeUndefined(); // the shipped options and rules go with the shipped template only
    expect(own.termsRules).toBeUndefined();
    // Refused, naming the field.
    expect(() => loadConfig(write({}))).toThrow(/sellerApi is required: your API's quote, start and result addresses/);
    expect(() => loadConfig(write({ sellerApi: api, template: 'terms.json' }))).toThrow(/scope is required with your own template/);
    expect(() => loadConfig(write({ sellerApi: api, colour: 'blue' }))).toThrow(/has a field the adapter does not take: colour/);
    expect(() => loadConfig(write({ sellerApi: api, timing: { deliverWithinDays: 7 } }))).toThrow(/timing has a window the offer does not take: deliverWithinDays/);
    expect(() => loadConfig(write({ sellerApi: { ...api, result: 7 } }))).toThrow(/sellerApi\.result must be an http or https address/);
    expect(() => loadConfig(write({ sellerApi: { ...api, quote: 'file:///etc/passwd' } }))).toThrow(/sellerApi\.quote must be an http or https address/);
    for (const [field, body] of [['stream', { stream: false }], ['host', { host: '0.0.0.0' }], ['trustProxy', { trustProxy: true }], ['quoteRateLimit.perClient', { quoteRateLimit: { perClient: { requests: 1, windowSec: 1 } } }]] as const) {
      expect(() => loadConfig(write({ sellerApi: api, ...body }))).toThrow(new RegExp(`^.*: ${field.replace('.', '\\.')} was removed \\(T-331\\)`));
    }
    const broken = write({});
    writeFileSync(broken, '{"sellerApi": ');
    expect(() => loadConfig(broken)).toThrow(/is not JSON/);
    // The shipped example: the stub's API, the defaults, and an overall limit.
    const example = loadConfig(here('./seller-adapter.config.json'));
    expect(example).toMatchObject({ port: shipped.port, sellerApi: shipped.sellerApi, template: shipped.template, quoteRateLimit: { overall: { requests: 100, windowSec: 60 } } });
  });

  it('stops on a zero-address adjudicator, and when neither the file nor discovery names a club', async () => {
    await expect(adapter({ adjudicators: { primary: `0x${'0'.repeat(40)}`, fallback: acct('seller-1').address, appeal: acct('seller-1').address } })).rejects.toThrow(/^adjudicators\.primary is the zero address/);
    const served = await discoveryOnly({ domain: knownPins()[0]!.domain });
    stub = await startStubSellerApi({ port: 0 });
    try {
      const start = startSellerAdapter({ ...shipped, port: 0, sellerApi: stub.api, journal: join(mkdtempSync(join(tmpdir(), 't331-')), 'journal.json'), log: () => {} }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: served.urls.join(',') });
      await expect(start).rejects.toThrow(/^name clubId in the configuration: these operators' discovery names no demo club/);
    } finally {
      await served.close();
    }
  });

  it('stops when the seller holds no mandate in the club, and says why', async () => {
    const fresh = generatePrivateKey(); // no genesis mandate; the SimChain faucet grants tokens only
    const start = (over: Partial<SellerAdapterConfig>) =>
      startSellerAdapter({ ...shipped, port: 0, sellerApi: { quote: 'http://127.0.0.1:1/q', start: 'http://127.0.0.1:1/s', result: 'http://127.0.0.1:1/{jobId}' }, journal: join(mkdtempSync(join(tmpdir(), 't331-')), 'journal.json'), log: () => {}, ...over }, { HOLDBACK_KEY: fresh, HOLDBACK_OPERATORS: world.info.operators.join(',') });
    await expect(start({})).rejects.toThrow(/holds no mandate in club sim-club, and the faucet granted none/);
    await expect(start({ mandate: { fromFaucet: false } })).rejects.toThrow(/holds no mandate in club sim-club: ask the club's principal for one/);
  });

  it('on the test service, takes its mandate from the faucet and renews it when the clock moves 30 days', async () => {
    let aheadMs = 0;
    const own = await PublicWorld.open({ storage: new MemoryStorage(), env: {}, now: () => Date.now() + aheadMs, telemetryLog: () => {} });
    const served = await serveTwoOrigins(own, { tickMs: 100 });
    const discovery = (await (await fetch(`${served.urls[0]}/.well-known/holdback.json`)).json()) as J;
    stub = await startStubSellerApi({ port: 0, token: discovery.demo.token.id });
    const key = generatePrivateKey();
    const seller = new Agent(served.urls, key, new Uint8Array(32));
    const buyer = new Agent(served.urls, generatePrivateKey(), new Uint8Array(32).fill(7));
    const lines: string[] = [];
    let running: RunningAdapter | undefined;
    try {
      expect(await mandatesOf(served.urls[0]!, seller.address)).toEqual([]);
      running = await startSellerAdapter({ ...shipped, port: 0, sellerApi: stub.api, journal: join(mkdtempSync(join(tmpdir(), 't331-')), 'journal.json'), pollMs: 50, log: (l) => lines.push(l) }, { HOLDBACK_KEY: key, HOLDBACK_OPERATORS: served.urls.join(',') });
      const [first] = await mandatesOf(served.urls[0]!, seller.address);
      expect(first?.clubId).toBe(discovery.demo.clubId);
      expect(lines.join('\n')).toMatch(/took a mandate in club \S+ from the test service's faucet, until /);
      const ask1 = await quoteFor(running, buyer);
      expect(ask1.status, JSON.stringify(ask1.body)).toBe(200);

      aheadMs += 30 * 86_400_000 + 2 * 3_600_000; // past the mandate's 30 days and the faucet's hour
      const ask2 = await quoteFor(running, buyer);
      expect(ask2.status, JSON.stringify(ask2.body)).toBe(200);
      const [renewed] = await mandatesOf(served.urls[0]!, seller.address);
      expect(Date.parse(renewed!.scope.expiresAt)).toBeGreaterThan(Date.parse(first!.scope.expiresAt));
      expect(lines.join('\n')).toMatch(/renewed its mandate in club \S+ from the test service's faucet, until /);
    } finally {
      await running?.close();
      await served.close();
    }
  }, 30_000);
});

describe('seller adapter: on operators that charge a fee', () => {
  it('quotes the operator fee and the total, and the deal settles with the fee paid', async () => {
    const shared = world;
    world = await startSimWorld({ env: {}, onError: () => {}, operatorFee: { bps: 1, min: '10000', max: null } }); // 1 bp, at least 0.01 tUSD
    try {
      const { running } = await adapter({}, { pollsUntilComplete: 0 });
      const buyer = agent('buyer-1');
      const { body: q } = await quoteFor(running, buyer);
      expect(q.fees.operator).toEqual({ token: 'tUSD', amount: '200000' }); // 1 bp of 2,000.00 tUSD is 0.20 tUSD
      expect(q.fees.total).toEqual({ token: 'tUSD', amount: (2_000_000_000n + BigInt(q.fees.adjudication.amount) + 200_000n).toString() });
      await buyer.waitFor(q.commitmentId, ['AcceptedByAdjudicator']);
      await buyer.agreeAndFund(await termsOf(buyer, q.commitmentId), BigInt(q.fees.total.amount)); // the total is exactly enough
      expect((await buyer.waitFor(q.commitmentId, ['Released', 'Refunded'])).escrowState).toBe('Released');
      await running.close();
    } finally {
      await world.close();
      world = shared;
    }
  }, 30_000);
});

describe('seller adapter: funded hold to delivery', () => {
  it('a 2,000.00 tUSD job with a 4-day window ends Released, and the buyer opens the report', async () => {
    const { running, lines } = await adapter();
    const buyer = agent('buyer-1');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await new Promise((r) => setTimeout(r, 200)); // several polls pass while the offer is unfunded
    expect(stub!.calls.start).toBe(0);

    const held = await fund(buyer, id);
    expect(held.escrowState).toBe('Held');
    const done = await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated']);
    expect(done.escrowState).toBe('Released');
    // The stub's report is the sample with a summary that counts the job's own files.
    expect(JSON.parse(await buyer.openDelivery(id))).toEqual({ ...SAMPLE, summary: 'The review covered 3 files at the commit above and reports 3 findings.' });
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(stub!.calls.start).toBe(1);
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/preflight: accept/);
    expect((await buyer.call('GET', `/v1/balances/${acct('seller-1').address}`)).amount).toMatch(/^[0-9]+$/);
  }, 30_000);

  it('learns of the hold from polling: the event stream follower is gone (T-331)', async () => {
    const { running } = await adapter();
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    await fund(buyer, q.commitmentId);
    expect((await buyer.waitFor(q.commitmentId, ['Released', 'Refunded'])).escrowState).toBe('Released');
    expect('following' in running).toBe(false);
  }, 30_000);

  it('does not deliver a report that fails preflight, and logs the failed check', async () => {
    const { running, lines } = await adapter({}, { report: 'missing-file' });
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    await new Promise((r) => setTimeout(r, 300)); // more polls: the refusal holds
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');
    expect(stageOf(running, id)).toBe('refused');
    const log = lines.join('\n');
    expect(log).toMatch(/preflight: reject/);
    expect(log).toContain('FAIL coverage (required): schema: /filesReviewed: fewer than 3 items');
    expect(log).toMatch(/not delivered/);
  }, 30_000);
});

describe('seller adapter: a report in the seller\'s own shape (T-323)', () => {
  const MAPPING = here('../fixtures/data/audit-report/seller-shape-a.mapping.json');
  const STUB_SUMMARY = 'The review covered 3 files at the commit above and reports 3 findings.';

  it('converts the result with the configured mapping, checks the converted bytes and delivers them', async () => {
    const { running, lines } = await adapter({ reportMapping: MAPPING }, { report: 'own-shape', pollsUntilComplete: 0 });
    const buyer = agent('buyer-1');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(JSON.parse(await buyer.openDelivery(id))).toEqual({ ...SAMPLE, summary: STUB_SUMMARY });
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(lines.join('\n')).toMatch(/converted the result with the report mapping: [0-9]+ bytes to [0-9]+ bytes/);
    expect(lines.join('\n')).toMatch(/preflight: accept/);
  }, 30_000);

  it('with no mapping it delivers the result as it comes, so a report in another shape fails preflight', async () => {
    const { running, lines } = await adapter({}, { report: 'own-shape', pollsUntilComplete: 0 });
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect(lines.join('\n')).not.toMatch(/converted the result/);
    expect(lines.join('\n')).toMatch(/FAIL report \(required\)/);
  }, 30_000);

  it('does not deliver a result the mapping cannot convert, and names the field', async () => {
    // The seller's mapping lists no "critical" in its severity map, and the stub's first finding is critical.
    const mapping = JSON.parse(readFileSync(MAPPING, 'utf8'));
    delete mapping.report.findings.$item.severity.$map.critical;
    const file = join(mkdtempSync(join(tmpdir(), 't323-')), 'mapping.json');
    writeFileSync(file, JSON.stringify(mapping));
    const { running, lines } = await adapter({ reportMapping: file }, { report: 'own-shape', pollsUntilComplete: 0 });
    const buyer = agent('buyer-1');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    await new Promise((r) => setTimeout(r, 300)); // more polls: the refusal holds
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');
    const note = running.deals().find((d) => d.id === id)!.note!;
    expect(note).toContain('the result is not delivered: the report mapping cannot convert it: findings[0].severity: issues[0].risk is "critical", which the mapping does not list');
    expect(lines.join('\n')).not.toMatch(/preflight:/); // nothing reached the check run
  }, 30_000);

  it('refuses to start with a mapping file that is not a mapping, and names the file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 't323-')), 'mapping.json');
    writeFileSync(file, JSON.stringify({ version: 1, report: { commit: { $eval: 'process.exit(1)' } } }));
    await expect(adapter({ reportMapping: file })).rejects.toThrow(`${file}: mapping report.commit: $eval is not a directive`);
  });
});

describe('seller adapter: restarts', () => {
  it('a restart mid-deal starts one job and delivers once', async () => {
    const journal = join(mkdtempSync(join(tmpdir(), 't318-')), 'journal.json');
    const buyer = agent('buyer-1');
    // Run 1: the quote. It stops before the buyer funds.
    const one = await adapter({ journal }, { pollsUntilComplete: 1_000_000 });
    const { body: q } = await quoteFor(one.running, buyer);
    const id = q.commitmentId as Hex;
    await one.running.close();
    await fund(buyer, id);

    // Run 2: it finds the hold funded and starts the job. It stops while the job runs.
    const two = await adapter({ journal });
    await until('run 2 to start the job', () => stageOf(two.running, id) === 'started');
    await two.running.close();
    expect(stub!.calls.start).toBe(1);

    // The journal as a crash between the start call and its record would leave it.
    const saved = JSON.parse(readFileSync(journal, 'utf8'));
    expect(saved.deals[id].jobId).toBeTruthy();
    delete saved.deals[id].jobId;
    saved.deals[id].stage = 'starting';
    writeFileSync(journal, JSON.stringify(saved));

    // Run 3: it sends the start again under the same key, gets the same job, and delivers its result.
    stub!.completeAll();
    const three = await adapter({ journal });
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('run 3 to record the delivery', () => stageOf(three.running, id) === 'delivered');
    await three.running.close();
    expect(stub!.calls.start).toBe(2); // the repeat reached the seller API
    expect(stub!.jobs()).toHaveLength(1); // and it started nothing new
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);

    // Run 4, with the journal set back to before the delivery: the settlement layer already holds one.
    const before = JSON.parse(readFileSync(journal, 'utf8'));
    before.deals[id].stage = 'started';
    writeFileSync(journal, JSON.stringify(before));
    const four = await adapter({ journal });
    await until('run 4 to see the delivery', () => stageOf(four.running, id) === 'delivered');
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
    expect(stub!.jobs()).toHaveLength(1);
  }, 45_000);
});

// ---- T-324: the adapter as a service ----

/** An adapter for seller-1 with extra environment values, such as the quote route's credentials. */
async function service(overrides: Partial<SellerAdapterConfig> = {}, extraEnv: Record<string, string> = {}, stubOptions: StubOptions = {}) {
  stub ??= await startStubSellerApi({ port: 0, ...stubOptions });
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const lines: string[] = [];
  const settings: SellerAdapterConfig = {
    ...shipped,
    port: 0,
    sellerApi: stub.api,
    clubId: world.info.clubId,
    adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! },
    journal: join(mkdtempSync(join(tmpdir(), 't324-')), 'journal.json'),
    pollMs: 50,
    log: (line) => lines.push(line),
    ...overrides,
  };
  const env = { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), ...extraEnv };
  const running = await startSellerAdapter(settings, env);
  adapters.push(running);
  return { running, lines, settings, env };
}
/** A quote with the headers given, answering the status, the headers and the body. */
async function ask(a: RunningAdapter, buyer: Agent, headers: Record<string, string> = {}, scope: unknown = SCOPE) {
  const res = await fetch(`${a.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope }) });
  return { status: res.status, headers: res.headers, body: (await res.json()) as J };
}

describe('seller adapter as a service: authentication on the quote route', () => {
  it('with quoteAuth, answers 401 without a valid bearer credential, makes no offer, and never logs a credential', async () => {
    // The seller names the environment variable; its value lists the accepted credentials, comma-separated.
    const { running, lines } = await service({ quoteAuth: { kind: 'bearer', env: 'BUYER_TICKETS' } }, { BUYER_TICKETS: 'ticket-one, ticket-two' });
    const buyer = agent('buyer-1');
    const refused = [{}, { authorization: 'Bearer ticket-three' }, { authorization: 'Basic ticket-one' }, { authorization: 'Bearer ' }, { authorization: 'Bearer ticket-one, ticket-two' }];
    for (const headers of refused) {
      const r = await ask(running, buyer, headers);
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.body.type).toBe('unauthorized');
      expect(r.headers.get('www-authenticate')).toMatch(/^Bearer /);
    }
    expect(stub!.calls.quote).toBe(0);
    expect(running.deals()).toEqual([]);

    const ok = await ask(running, buyer, { authorization: 'Bearer ticket-two' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.commitmentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(running.deals()).toHaveLength(1);
    // The idempotency rule holds behind the credential: the same key and body replay, another body is a conflict.
    const keyed = { authorization: 'Bearer ticket-one', 'idempotency-key': 'auth-1' };
    const first = await ask(running, buyer, keyed);
    expect((await ask(running, buyer, keyed)).body).toEqual(first.body);
    expect((await ask(running, buyer, keyed, { ...SCOPE, lines: 4000 })).status).toBe(409);

    const log = lines.join('\n');
    for (const secret of ['ticket-one', 'ticket-two', 'ticket-three']) expect(log).not.toContain(secret);
  }, 30_000);

  it('refuses to start when quoteAuth names a variable that holds no credential', async () => {
    await expect(service({ quoteAuth: { kind: 'bearer', env: 'BUYER_TICKETS' } }, {})).rejects.toThrow(/^set BUYER_TICKETS to one or more quote credentials, comma-separated$/);
    await expect(service({ quoteAuth: { kind: 'bearer', env: 'BUYER_TICKETS' } }, { BUYER_TICKETS: ' , ' })).rejects.toThrow(/BUYER_TICKETS/);
  });
});

describe('seller adapter as a service: a rate limit on the quote route', () => {
  it('answers 429 with Retry-After past the seller\'s limit, and makes no offer for a refused request', async () => {
    const { running } = await service({ quoteRateLimit: { overall: { requests: 2, windowSec: 3600 } } });
    const buyer = agent('buyer-1');
    expect((await ask(running, buyer)).status).toBe(200);
    expect((await ask(running, buyer, {}, 'everything')).status).toBe(400); // a refused scope counts too
    const limited = await ask(running, buyer);
    expect(limited.status).toBe(429);
    expect(limited.body.type).toBe('rate_limited');
    const wait = Number(limited.headers.get('retry-after'));
    expect(Number.isSafeInteger(wait) && wait >= 1 && wait <= 3600, String(wait)).toBe(true);
    expect(stub!.calls.quote).toBe(1);
    expect(running.deals()).toHaveLength(1);
  }, 30_000);

  it('opens again when the window passes, and X-Forwarded-For makes no new client', async () => {
    const { running } = await service({ quoteRateLimit: { overall: { requests: 1, windowSec: 1 } } });
    const buyer = agent('buyer-1');
    expect((await ask(running, buyer, { 'x-forwarded-for': '10.0.0.1' })).status).toBe(200);
    expect((await ask(running, buyer, { 'x-forwarded-for': '10.0.0.2' })).status).toBe(429);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await ask(running, buyer)).status).toBe(200);
  }, 30_000);

  it('refuses to start on a limit that is not a positive whole number', async () => {
    for (const limit of [{ requests: 0, windowSec: 60 }, { requests: 5, windowSec: 0 }, { requests: 1.5, windowSec: 60 }]) {
      await expect(service({ quoteRateLimit: { overall: limit } })).rejects.toThrow(/quoteRateLimit\.overall/);
    }
  });
});

describe('seller adapter as a service: HTTPS behind a TLS proxy', () => {
  it('answers a quote over HTTPS through a TLS proxy, and a forged X-Forwarded-For does not escape the limit', async () => {
    // A self-signed certificate for 127.0.0.1, made for this run only, with `openssl` (on the CI runners; the test
    // fails without it rather than skip). The recipe's proxy is Caddy; this one plays it.
    const dir = mkdtempSync(join(tmpdir(), 't324-tls-'));
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'tls.pem'), '-out', join(dir, 'cert.pem')]);
    expect(made.status, String(made.stderr)).toBe(0);
    const cert = readFileSync(join(dir, 'cert.pem'));
    const { running } = await service({ quoteRateLimit: { overall: { requests: 1, windowSec: 3600 } } });
    const upstream = new URL(running.url);
    // Like Caddy's reverse_proxy: it terminates TLS and appends the client's address to X-Forwarded-For.
    const proxy = createHttpsServer({ cert, key: readFileSync(join(dir, 'tls.pem')) }, (req, res) => {
      const prior = req.headers['x-forwarded-for'];
      const headers = { ...req.headers, 'x-forwarded-for': `${prior ? `${prior}, ` : ''}${req.socket.remoteAddress}` };
      const out = httpRequest({ host: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      });
      req.pipe(out);
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    const httpsQuote = (extra: Record<string, string> = {}) =>
      new Promise<{ status: number; body: J }>((resolve, reject) => {
        const buyer = agent('buyer-1');
        const body = JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE });
        const req = httpsRequest({ host: '127.0.0.1', port: (proxy.address() as AddressInfo).port, path: '/quote', method: 'POST', ca: cert, headers: { 'content-type': 'application/json', ...extra } }, (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(body);
      });
    try {
      const first = await httpsQuote();
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.commitmentId).toMatch(/^0x[0-9a-f]{64}$/);
      // The limit counts every request, so a forged X-Forwarded-For does not make a new client.
      expect((await httpsQuote({ 'x-forwarded-for': '10.9.9.9' })).status).toBe(429);
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()));
    }
  }, 30_000);

  it('the recipe proxies HTTPS to the address the shipped configuration listens on, and starts the adapter from one file', () => {
    const caddy = readFileSync(here('./seller-adapter.Caddyfile'), 'utf8');
    expect(caddy).toContain(`reverse_proxy 127.0.0.1:${shipped.port}`); // the adapter listens on 127.0.0.1 only
    const unit = readFileSync(here('./seller-adapter.service'), 'utf8');
    expect(unit).toMatch(/^ExecStart=\S*node \S*examples\/seller-adapter\.ts \/etc\/crow-seller\/seller-adapter\.json$/m);
    expect(unit).toMatch(/^Restart=always$/m);
    expect(unit).toMatch(/^KillSignal=SIGTERM$/m);
  });
});

describe('seller adapter as a service: restarts with open deals', () => {
  // A world of its own: by now the shared one holds many open offers, and in a full run its primary adjudicator
  // did not accept deal A within 20 s.
  let shared: SimWorld;
  beforeAll(async () => {
    shared = world;
    world = await startSimWorld({ env: {}, onError: () => {} });
  });
  afterAll(async () => {
    for (const a of adapters.splice(0)) await a.close();
    await world.close();
    world = shared;
  });

  it('after a restart, finishes every open deal with one job and one delivery each, and replays a keyed quote', async () => {
    const journal = join(mkdtempSync(join(tmpdir(), 't324-')), 'journal.json');
    const one = await service({ journal }, {}, { pollsUntilComplete: 1_000_000 });
    const [b1, b2] = [agent('buyer-1'), agent('buyer-2')];
    // Deal A: quoted with a key, funded while the adapter is down. Deal B: started, its job runs across the restart.
    // Deal C: quoted, never funded.
    const a = await ask(one.running, b1, { 'idempotency-key': 'restart-a' });
    const b = await ask(one.running, b2);
    const c = await ask(one.running, b1, {}, { ...SCOPE, lines: 4000 });
    const idA = a.body.commitmentId as Hex;
    const idB = b.body.commitmentId as Hex;
    const idC = c.body.commitmentId as Hex;
    await fund(b2, idB);
    await until('run 1 to start deal B', () => stageOf(one.running, idB) === 'started');
    await one.running.close();
    await fund(b1, idA);
    expect(stub!.calls.start).toBe(1);

    stub!.completeAll();
    const two = await service({ journal });
    expect(await ask(two.running, b1, { 'idempotency-key': 'restart-a' })).toMatchObject({ status: 200, body: a.body }); // the journal kept the answer
    expect((await b1.waitFor(idA, ['Released', 'Refunded'])).escrowState).toBe('Released');
    expect((await b2.waitFor(idB, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('run 2 to record both deliveries', () => stageOf(two.running, idA) === 'delivered' && stageOf(two.running, idB) === 'delivered');
    expect(stub!.calls.start).toBe(2);
    expect(stub!.jobs()).toHaveLength(2);
    expect(await events(b1, idA, 'delivery.submitted')).toHaveLength(1);
    expect(await events(b2, idB, 'delivery.submitted')).toHaveLength(1);
    expect(stageOf(two.running, idC)).toBe('offered');
    expect(['Offered', 'AcceptedByAdjudicator']).toContain((await b1.call('GET', `/v1/commitments/${idC}`)).escrowState);
    expect(two.running.deals()).toHaveLength(3);
  }, 45_000);
});

// ---- T-329: a refused report alerts the seller, and the adapter delivers the fixed one ----

/** The seller's alert receiver: it keeps each POST's raw body and headers, and answers as told. */
async function alertReceiver(answer: 'ok' | 'fail' | 'hang' = 'ok') {
  const got: Array<{ raw: string; body: J; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      got.push({ raw, body: JSON.parse(raw), headers: req.headers });
      if (answer === 'ok') res.writeHead(204).end();
      else if (answer === 'fail') res.writeHead(500).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/crow-alerts`,
    got,
    of: (type: string) => got.filter((g) => g.body.type === type),
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
const ready = (a: RunningAdapter, id: string, credential?: string) =>
  fetch(`${a.url}/deals/${id}/ready`, { method: 'POST', headers: credential ? { authorization: `Bearer ${credential}` } : {} });
const hmac = (secret: string, raw: string) => `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
const GOOD_REPORT = { ...SAMPLE, summary: 'The review covered 3 files at the commit above and reports 3 findings.' };

describe('seller adapter: a refused report waits for the fixed one (T-329)', () => {
  // A world of its own, as for the restarts above: each test here funds a deal and waits on its adjudicator.
  let shared: SimWorld;
  const receivers: Array<{ close(): Promise<void> }> = [];
  beforeAll(async () => {
    shared = world;
    world = await startSimWorld({ env: {}, onError: () => {} });
  });
  afterEach(async () => {
    for (const r of receivers.splice(0)) await r.close();
  });
  afterAll(async () => {
    for (const a of adapters.splice(0)) await a.close();
    await world.close();
    world = shared;
  });
  const receiver = async (answer?: 'ok' | 'fail' | 'hang') => {
    const r = await alertReceiver(answer);
    receivers.push(r);
    return r;
  };

  it('alerts the seller with the failed check, holds the delivery, and delivers the fixed report when the seller says it is ready', async () => {
    const hook = await receiver();
    const { running, lines } = await service(
      { alerts: { callback: hook.url, secretEnv: 'ALERT_SECRET' }, redelivery: { readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } } },
      { ALERT_SECRET: 'alert-secret-1', READY_CREDENTIALS: 'ready-one' },
      { report: 'missing-file', pollsUntilComplete: 0 },
    );
    const buyer = agent('buyer-1');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    await until('the refusal alert', () => hook.of('delivery.refused').length === 1);

    // The alert names the check that failed, whether it is required, and why; the seller's secret signs it.
    const [alert] = hook.of('delivery.refused');
    const terms = await termsOf(buyer, id);
    expect(alert!.body).toMatchObject({ commitmentId: id, deliverBy: terms.timing.deliverBy, attempt: 1, result: 'reject' });
    expect(alert!.body.checks).toContainEqual({ checkId: 'coverage', required: true, outcome: 'fail', detail: 'schema: /filesReviewed: fewer than 3 items' });
    expect(alert!.headers['x-crow-signature']).toBe(hmac('alert-secret-1', alert!.raw));
    expect(lines.join('\n')).toContain(`ALERT ${id} delivery.refused (attempt 1): FAIL coverage (required): schema: /filesReviewed: fewer than 3 items`);

    // The delivery waits: nothing reaches the settlement layer, and the deal stays Held.
    await new Promise((r) => setTimeout(r, 300));
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');
    expect(running.deals().find((d) => d.id === id)).toMatchObject({ stage: 'refused', refusals: 1 });

    // The ready route takes the seller's credential only, and only for a deal the adapter holds.
    expect((await ready(running, id)).status).toBe(401);
    expect((await ready(running, id, 'ready-two')).status).toBe(401);
    expect((await ready(running, `0x${'ab'.repeat(32)}`, 'ready-one')).status).toBe(404);

    // The seller fixes its report and says so. The adapter fetches it again, checks it and delivers it.
    stub!.setReport('ok');
    const r = await ready(running, id, 'ready-one');
    expect(r.status).toBe(202);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(JSON.parse(await buyer.openDelivery(id))).toEqual(GOOD_REPORT);
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    await until('the fixed-report alert', () => hook.of('delivery.fixed').length === 1);
    expect(hook.of('delivery.fixed')[0]!.body).toMatchObject({ commitmentId: id, attempt: 2 });
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
    expect(stub!.calls.start).toBe(1);
    expect((await ready(running, id, 'ready-one')).status).toBe(409); // delivered: nothing waits any more

    const log = lines.join('\n');
    for (const secret of ['alert-secret-1', 'ready-one']) expect(log).not.toContain(secret);
  }, 45_000);

  it('fetches the result again on the seller\'s schedule and delivers the fixed report once it passes', async () => {
    const { running } = await service({ redelivery: { refetchEverySec: 1 } }, {}, { report: 'missing-file', pollsUntilComplete: 0 });
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    stub!.setReport('ok');
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(JSON.parse(await buyer.openDelivery(id))).toEqual(GOOD_REPORT);
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
  }, 45_000);

  it('a report never fixed is never delivered: the deal stays Held, and after deliverBy the adapter stops and says so', async () => {
    const hook = await receiver();
    // A 10-second delivery window (funded within 6 s), and a refetch at every poll: the seller's settings, any values (D31).
    const timing = { ...shipped.timing, offerExpiresInSec: 5, fundWithinSec: 6 };
    const { running, lines } = await service({ timing, alerts: { callback: hook.url }, redelivery: { refetchEverySec: 0 } }, {}, { report: 'missing-file', pollsUntilComplete: 0, quoteOverride: { deliverWithinSec: 10 } });
    const buyer = agent('buyer-1');
    const quoted = await quoteFor(running, buyer);
    expect(quoted.status, lines.join('\n')).toBe(200);
    const q = quoted.body;
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    const fetched = stub!.calls.result;
    await until('two more fetches of the result', () => stub!.calls.result >= fetched + 2);
    expect(hook.of('delivery.refused')).toHaveLength(1); // the same bytes again: no second alert
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');

    await until('the adapter to stop at deliverBy', () => stageOf(running, id) === 'closed', 20_000);
    const deal = running.deals().find((d) => d.id === id)!;
    expect(deal.note).toMatch(/deliverBy .* passed with no fixed report delivered/);
    await until('the deadline alert', () => hook.of('delivery.deadline_passed').length === 1);
    expect(hook.of('delivery.deadline_passed')[0]!.body).toMatchObject({ commitmentId: id, attempts: 1 });
    expect(lines.join('\n')).toContain(`ALERT ${id} delivery.deadline_passed`);
    const after = stub!.calls.result;
    await new Promise((r) => setTimeout(r, 300));
    expect(stub!.calls.result).toBe(after); // it stopped fetching
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held'); // the buyer's reclaim is the buyer's
  }, 45_000);

  it('a restart while waiting keeps the deal waiting, and a crash at the delivery call delivers once', async () => {
    const journal = join(mkdtempSync(join(tmpdir(), 't329-')), 'journal.json');
    const hook = await receiver('fail'); // a receiver that answers 500
    const settings = { journal, alerts: { callback: hook.url }, redelivery: { readyAuth: { kind: 'bearer' as const, env: 'READY_CREDENTIALS' } } };
    const env = { READY_CREDENTIALS: 'ready-one' };
    const buyer = agent('buyer-2');
    // Run 1: the report is refused, and the seller's receiver fails.
    const one = await service(settings, env, { report: 'missing-file', pollsUntilComplete: 0 });
    const { body: q } = await quoteFor(one.running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('run 1 to refuse the result', () => stageOf(one.running, id) === 'refused');
    await until('run 1 to log the failed alert', () => one.lines.some((l) => l.includes('the alert callback answered 500')));
    await one.running.close();
    const saved = JSON.parse(readFileSync(journal, 'utf8')).deals[id];
    expect(saved).toMatchObject({ stage: 'refused', refusals: 1, refusedSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });

    // Run 2: the deal still waits; it does not alert again for the same refusal, and delivers once the seller is ready.
    stub!.setReport('ok');
    const two = await service(settings, env);
    await new Promise((r) => setTimeout(r, 300));
    expect(stageOf(two.running, id)).toBe('refused');
    expect(hook.of('delivery.refused')).toHaveLength(1);
    expect(await events(buyer, id, 'delivery.submitted')).toEqual([]);
    expect((await ready(two.running, id, 'ready-one')).status).toBe(202);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('run 2 to record the delivery', () => stageOf(two.running, id) === 'delivered');
    await two.running.close();

    // Run 3, with the journal as a crash between the delivery call and its record leaves it: it reads the
    // settlement layer, finds the delivery there, and delivers nothing again.
    const crashed = JSON.parse(readFileSync(journal, 'utf8'));
    crashed.deals[id].stage = 'delivering';
    writeFileSync(journal, JSON.stringify(crashed));
    const results = stub!.calls.result;
    const three = await service(settings, env);
    await until('run 3 to see the delivery', () => stageOf(three.running, id) === 'delivered');
    expect(stub!.calls.result).toBe(results);
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
    expect(stub!.calls.start).toBe(1);
  }, 45_000);

  it('a crash just before the delivery call delivers once on the next start', async () => {
    const journal = join(mkdtempSync(join(tmpdir(), 't329-')), 'journal.json');
    const buyer = agent('buyer-1');
    const one = await service({ journal }, {}, { report: 'missing-file', pollsUntilComplete: 0 });
    const { body: q } = await quoteFor(one.running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('run 1 to refuse the result', () => stageOf(one.running, id) === 'refused');
    await one.running.close();
    // The journal as a crash right after recording `delivering`, before any delivery reached the settlement layer.
    stub!.setReport('ok');
    const crashed = JSON.parse(readFileSync(journal, 'utf8'));
    crashed.deals[id].stage = 'delivering';
    writeFileSync(journal, JSON.stringify(crashed));
    const two = await service({ journal });
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('run 2 to record the delivery', () => stageOf(two.running, id) === 'delivered');
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
  }, 45_000);

  it('a callback address that hangs or refuses connections never holds up the deal loop', async () => {
    const hang = await receiver('hang');
    const { running, lines } = await service(
      { alerts: { callback: hang.url, timeoutMs: 60_000 }, redelivery: { refetchEverySec: 1 } },
      {},
      { report: 'missing-file', pollsUntilComplete: 0 },
    );
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    await until('the receiver to get the alert', () => hang.got.length === 1);
    stub!.setReport('ok'); // the receiver has not answered, and the deal goes on
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(lines.join('\n')).toContain(`ALERT ${id} delivery.refused`);
    await running.close(); // close does not wait out the receiver's 60 s
    stub!.setReport('missing-file');

    // Nothing listens at this address: the alert fails at once, and the log says so.
    const gone = await receiver();
    const nowhere = gone.url;
    await gone.close();
    const second = await service({ alerts: { callback: nowhere } });
    const b = agent('buyer-1');
    const { body: q2 } = await quoteFor(second.running, b);
    await fund(b, q2.commitmentId);
    await until('the adapter to refuse the result', () => stageOf(second.running, q2.commitmentId) === 'refused');
    await until('the log to name the failed alert', () => second.lines.some((l) => /the alert callback failed/.test(l)));
    expect((await b.call('GET', `/v1/commitments/${q2.commitmentId}`)).escrowState).toBe('Held');
  }, 45_000);

  it('refuses to start on a malformed alert or redelivery setting, and names it', async () => {
    await expect(service({ alerts: { callback: 'not an address' } })).rejects.toThrow(/^alerts\.callback must be an http or https address$/);
    await expect(service({ alerts: { callback: 'file:///etc/passwd' } })).rejects.toThrow(/^alerts\.callback must be an http or https address$/);
    await expect(service({ alerts: { callback: 'http://127.0.0.1:9/a', secretEnv: 'ALERT_SECRET' } })).rejects.toThrow(/^set ALERT_SECRET to the alert callback's signing secret$/);
    await expect(service({ alerts: { callback: 'http://127.0.0.1:9/a', timeoutMs: 0 } })).rejects.toThrow(/alerts\.timeoutMs/);
    for (const refetchEverySec of [-1, 1.5]) await expect(service({ redelivery: { refetchEverySec } })).rejects.toThrow(/redelivery\.refetchEverySec/);
    await expect(service({ redelivery: { readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } } })).rejects.toThrow(/^set READY_CREDENTIALS to one or more ready credentials, comma-separated$/);
    // A misspelt field inside a block is refused, not dropped for the default (T-331 review).
    await expect(service({ redelivery: { refetchEverySecs: 600 } as J })).rejects.toThrow(/^redelivery has a field the adapter does not take: refetchEverySecs$/);
    await expect(service({ mandate: { renewBefore: 60 } as J })).rejects.toThrow(/^mandate has a field the adapter does not take: renewBefore$/);
    await expect(service({ alerts: { callbak: 'http://127.0.0.1:9/a' } as J })).rejects.toThrow(/^alerts has a field the adapter does not take: callbak$/);
  });

  it('a refused deal that is not due reads no state at each poll (T-329 triage row 2)', async () => {
    const { running } = await service({ redelivery: {} }, {}, { report: 'missing-file', pollsUntilComplete: 0 });
    const buyer = agent('seller-2'); // buyer-1 has spent its test funds in this world; any member may buy
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    // Count the adapter's reads of this commitment's state over about 20 polls of 50 ms.
    const send = globalThis.fetch;
    let reads = 0;
    globalThis.fetch = (input, init) => {
      if (new URL(input instanceof Request ? input.url : String(input)).pathname === `/v1/commitments/${id}`) reads++;
      return send(input, init);
    };
    try {
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      globalThis.fetch = send;
    }
    expect(reads).toBe(0);
    expect(stageOf(running, id)).toBe('refused');
  }, 30_000);

  it('with no redelivery set, the note names the manual path, and seal.ts delivers the fixed file once', async () => {
    const { running, settings, env } = await service({ redelivery: {} }, {}, { report: 'missing-file', pollsUntilComplete: 0 });
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => stageOf(running, id) === 'refused');
    const note = running.deals().find((d) => d.id === id)!.note!;
    expect(note).toContain(`node examples/check-delivery.ts <terms.json> <file>, then node examples/seal.ts ${settings.journal} <file> ${id}`);

    const fixed = join(mkdtempSync(join(tmpdir(), 't331-')), 'fixed.json');
    writeFileSync(fixed, JSON.stringify(GOOD_REPORT));
    const sealed = await runNode([here('./seal.ts'), settings.journal, fixed, id], env);
    expect(sealed.code, sealed.err).toBe(0);
    expect(JSON.parse(sealed.out).escrowState).toMatch(/^(Delivered|Judging|Released)$/);
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    // A restart reads every open deal's state: the adapter records the delivery and makes no second one.
    await running.close();
    const again = await startSellerAdapter(settings, env);
    adapters.push(again);
    await until('the journal to record the delivery', () => stageOf(again, id) === 'delivered');
    expect(await events(buyer, id, 'delivery.submitted')).toHaveLength(1);
  }, 30_000);
});

describe('seal.ts', () => {
  it('signs under the domain the operators serve, and refuses one that is not pinned, naming it', async () => {
    const foreign = { name: 'Holdback', version: '0.7', chainId: 99_999, verifyingContract: `0x${'12'.repeat(20)}` };
    const served = await discoveryOnly({ domain: foreign });
    try {
      const terms = join(mkdtempSync(join(tmpdir(), 't331-')), 'terms.json');
      writeFileSync(terms, '{}');
      const run = await runNode([here('./seal.ts'), terms, terms], { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: served.urls.join(',') });
      expect(run.code).toBe(2);
      expect(run.err).toMatch(/the operators serve EIP-712 domain \{"chainId":99999,.*\}, not one pinned in verify\.ts/);
    } finally {
      await served.close();
    }
  });
});
