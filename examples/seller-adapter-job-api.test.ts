// The seller adapter against a job API of another shape (T-366), driven only by a configuration file: a credential
// header, mapped quote and start calls, a run read by a state field, and proof files fetched one by one. The first
// part runs deals on SimChain; the second checks the mapping's refusals against the stub alone, with no chain.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { DELIVERY_CAP_BYTES, FilesNotAdded, sellerApiClient } from './seller-adapter-api.ts';
import { DEFAULT_FILES, jobStubSellerApi, startJobStub, type JobStub, type JobStubOptions } from './seller-adapter-job-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = 'jobs-api-test-credential-7f3a9c'; // a test credential: it must appear in no log line and no journal
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const FIELDS = { scope: ['target', 'depth'], options: [] };
/** The seller's own deal template: a JSON report with two or more proof files, each with its path and content. */
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}, with the proof files it names.', format: 'application/json' },
  checks: [
    {
      id: 'report',
      type: 'json_schema',
      required: true,
      schema: {
        type: 'object',
        required: ['summary', 'target', 'proofs'],
        properties: {
          target: { const: '{{target}}' },
          proofs: { type: 'array', minItems: 2, items: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string', minLength: 1 } } } },
        },
      },
    },
  ],
};

let world: SimWorld;
let stub: JobStub | undefined;
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

/** Writes the seller's configuration file and template into a new folder; returns the file's path. */
function configFile(stubBase: string, extra: J = {}, files: J = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 't366-'));
  writeFileSync(join(dir, 'template.json'), JSON.stringify(TEMPLATE));
  const file = join(dir, 'seller.json');
  writeFileSync(file, JSON.stringify({ port: 0, pollMs: 50, journal: join(dir, 'journal.json'), template: 'template.json', scope: SCOPE_RULES, redelivery: { refetchEverySec: 0 }, sellerApi: jobStubSellerApi(stubBase, { files }), ...extra }));
  return file;
}

/** An adapter for seller-1 started from the configuration file alone; only the log goes to the test. */
async function adapter(file: string) {
  const lines: string[] = [];
  const running = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY });
  adapters.push(running);
  return { running, lines };
}
async function quote(a: RunningAdapter, buyer: Agent): Promise<{ status: number; body: J }> {
  const res = await fetch(`${a.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
  return { status: res.status, body: await res.json() };
}
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
const deliveries = async (buyer: Agent, id: Hex): Promise<J[]> => (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === 'delivery.submitted');
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = (a: RunningAdapter, id: Hex) => a.deals().find((d) => d.id === id)?.stage;
const journalText = (file: string) => readFileSync(JSON.parse(readFileSync(file, 'utf8')).journal, 'utf8');

describe('seller adapter, a job API of another shape (T-366): deals', () => {
  it('a quote becomes a signed offer: the mapped body, the credential header, the price read by pointers', async () => {
    stub = await startJobStub({ key: KEY });
    const file = configFile(stub.base);
    const { running, lines } = await adapter(file);
    const buyer = agent('buyer-1');
    const q = await quote(running, buyer);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.price).toEqual({ token: 'tUSD', amount: '200000000' }); // 200.00 tUSD; the mapping reads no token
    const asked = stub.requests.filter((r) => r.path === '/api/v2/estimates');
    expect(asked).toEqual([{ method: 'POST', path: '/api/v2/estimates', apiKey: KEY, requestKey: undefined, body: { target: 'vault-core', depth: 2, client: buyer.address.toLowerCase() } }]);
    const terms = await termsOf(buyer, q.body.commitmentId);
    expect((Date.parse(terms.timing.deliverBy) - Date.parse(terms.createdAt)) / 1000).toBe(2 * 86_400); // turnaroundSeconds
    expect((Date.parse(terms.timing.offerExpiresAt) - Date.parse(terms.createdAt)) / 1000).toBe(600); // validSeconds caps the 900 s default
    expect(terms.deliverable.description).toBe('A review of vault-core to depth 2, with the proof files it names.');
    const log = lines.join('\n');
    expect(log).toContain(`The seller API is under ${stub.base}, with a credential from JOBS_API_KEY in header x-api-key; its job state is read by a status field, and a result's further files are added at /proofs.`);
    expect(log).not.toContain(KEY);
    expect(journalText(file)).not.toContain(KEY);
  }, 30_000);

  it('a funded deal starts one job, polls it while it runs, adds its files, and delivers once', async () => {
    stub = await startJobStub({ key: KEY, readsUntilComplete: 3 });
    const events = join(mkdtempSync(join(tmpdir(), 't417-')), 'events.jsonl');
    const file = configFile(stub.base, { events });
    const { running, lines } = await adapter(file);
    const buyer = agent('buyer-1');
    const { body: q } = await quote(running, buyer);
    const id = q.commitmentId as Hex;
    await new Promise((r) => setTimeout(r, 200)); // polls pass while the offer is unfunded
    expect(stub.runs()).toEqual([]);
    await fund(buyer, id);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');

    // One run, keyed by the deal's ID, with the mapped body; the run was read while queued and running.
    expect(stub.runs()).toEqual([{ id: 41, key: id, reference: id }]);
    const starts = stub.requests.filter((r) => r.path === '/api/v2/runs');
    expect(starts.map((s) => [s.requestKey, s.body])).toEqual([[id, { estimate: expect.stringMatching(/^est-/), reference: id, input: SCOPE }]]);
    expect(stub.requests.filter((r) => r.path === '/api/v2/runs/41').length).toBeGreaterThanOrEqual(4);
    expect(stub.requests.filter((r) => r.path.startsWith('/api/v2/runs/41/files/')).map((r) => r.path)).toEqual(['/api/v2/runs/41/files/poc/overflow.t.sol', '/api/v2/runs/41/files/poc/reentry.t.sol']);
    expect(stub.requests.every((r) => r.path.startsWith('/api/v2/') && r.apiKey === KEY)).toBe(true);

    // The delivered JSON carries each file's path and content where the list was.
    const delivered = JSON.parse(await buyer.openDelivery(id));
    expect(delivered).toEqual({ summary: 'Reviewed vault-core to depth 2.', target: 'vault-core', proofs: Object.entries(DEFAULT_FILES).map(([path, content]) => ({ path, content })) });
    expect(await deliveries(buyer, id)).toHaveLength(1);
    const log = lines.join('\n');
    expect(log).toMatch(/added the result's files/);
    expect(log).toMatch(/preflight: accept/);
    expect(log).not.toContain(KEY);
    expect(journalText(file)).not.toContain(KEY);

    // T-417: the events, one JSON line each: the quote, each stage with its times, the job's states, the delivery.
    const text = readFileSync(events, 'utf8');
    const ev = text.trim().split('\n').map((l) => JSON.parse(l));
    expect(ev.every((e) => e.schema === 'crow.seller-adapter.event/1' && typeof e.at === 'string')).toBe(true);
    const types = ev.map((e) => (e.type === 'deal.stage' ? `stage:${e.stage}` : e.type === 'job.status' ? `status:${e.status}` : e.type));
    expect(types.slice(0, 2)).toEqual(['deal.offered', 'quote.answered']);
    for (const t of ['stage:starting', 'stage:started', 'status:queued', 'status:running', 'job.done', 'stage:delivering', 'stage:delivered']) expect(types, t).toContain(t);
    expect(types.indexOf('status:queued')).toBeLessThan(types.indexOf('status:running'));
    expect(ev.find((e) => e.type === 'deal.offered')).toMatchObject({ commitmentId: id, price: { amount: '200000000' }, deliverWithinSec: 2 * 86_400 });
    expect(ev.find((e) => e.type === 'quote.answered')).toMatchObject({ commitmentId: id, ms: expect.any(Number) });
    const done = ev.find((e) => e.type === 'deal.stage' && e.stage === 'delivered');
    expect(done).toMatchObject({ from: 'delivering', refusals: 0, secSinceOffered: expect.any(Number), secSincePrevious: expect.any(Number) });
    expect(ev.find((e) => e.type === 'job.done')).toMatchObject({ secSinceStarted: expect.any(Number), bytes: expect.any(Number) });
    // No content, credential, identity or scope.
    for (const secret of [KEY, buyer.address.toLowerCase(), buyer.address, 'vault-core', 'Reviewed', 'overflow', DEFAULT_FILES['poc/overflow.t.sol']!]) expect(text, secret).not.toContain(secret);
    const journaled = JSON.parse(journalText(file)).deals[id];
    expect(Object.keys(journaled.times).sort()).toEqual(['delivered', 'delivering', 'jobDone', 'offered', 'started', 'starting'].sort());
  }, 30_000);

  it('a quote the adapter refuses is an event with its reason code and no request content (T-417)', async () => {
    stub = await startJobStub({ key: KEY });
    const events = join(mkdtempSync(join(tmpdir(), 't417-')), 'events.jsonl');
    const { running } = await adapter(configFile(stub.base, { events }));
    const res = await fetch(`${running.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: '0x00000000000000000000000000000000000000aa', buyerEncryptionPublicKey: 'x', scope: { target: 'secret-target', depth: 2 } }) });
    expect(res.status).toBe(400);
    const text = readFileSync(events, 'utf8');
    expect(JSON.parse(text.trim())).toMatchObject({ type: 'quote.refused', status: 400, reason: 'invalid_request', ms: expect.any(Number) });
    for (const secret of ['secret-target', '0x00000000000000000000000000000000000000aa']) expect(text).not.toContain(secret);
  }, 30_000);

  it('a replayed quote is marked, a refused credential is counted, and an unwritable file never stops the adapter (T-417)', async () => {
    const here = await startJobStub({ key: KEY });
    stub = here;
    const events = join(mkdtempSync(join(tmpdir(), 't417-')), 'events.jsonl');
    const { running } = await adapter(configFile(here.base, { events }));
    const buyer = agent('buyer-2');
    const body = JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE });
    const post = () => fetch(`${running.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k-t417' }, body });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const answered = readFileSync(events, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'quote.answered');
    expect(answered.map((e) => e.replayed)).toEqual([false, true]);

    // A quote route with a credential: a refusal there is counted too.
    const guarded = join(mkdtempSync(join(tmpdir(), 't417-')), 'events.jsonl');
    const lines: string[] = [];
    const g = await startSellerAdapter({ ...loadConfig(configFile(here.base, { events: guarded, quoteAuth: { kind: 'bearer', env: 'QUOTE_CREDENTIALS' } })), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY, QUOTE_CREDENTIALS: 'q-1' });
    adapters.push(g);
    expect((await fetch(`${g.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401);
    expect(JSON.parse(readFileSync(guarded, 'utf8').trim())).toMatchObject({ type: 'quote.refused', status: 401, reason: 'unauthorized' });

    // A file in a folder that does not exist: one log line, and quotes still answer.
    const broken: string[] = [];
    const b = await startSellerAdapter({ ...loadConfig(configFile(here.base, { events: join(tmpdir(), 't417-missing-folder', 'events.jsonl') })), log: (l) => broken.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY });
    adapters.push(b);
    for (const key of ['k-b1', 'k-b2']) expect((await fetch(`${b.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body })).status).toBe(200);
    expect(broken.filter((l) => l.includes('Events: cannot write'))).toHaveLength(1);
    expect(() => loadConfig(configFile(here.base, { events: 1 }))).toThrow('events must be a file path');
  }, 30_000);

  it('a start whose answer is lost, then a restart, starts one job under the same key and delivers once', async () => {
    stub = await startJobStub({ key: KEY, failFirstStart: true, readsUntilComplete: 0 });
    const file = configFile(stub.base);
    const one = await adapter(file);
    const buyer = agent('buyer-2');
    const { body: q } = await quote(one.running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the lost start answer', () => one.lines.some((l) => l.includes(`${id} waits at starting: the seller API answered 503 to the start`)));
    await one.running.close();
    expect(stub.runs()).toHaveLength(1); // the seller made the run, and the adapter never heard

    const two = await adapter(file);
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('run 2 to record the delivery', () => stageOf(two.running, id) === 'delivered');
    const starts = stub.requests.filter((r) => r.path === '/api/v2/runs');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(starts.map((s) => s.requestKey))).toEqual(new Set([id]));
    expect(stub.runs()).toHaveLength(1);
    expect(await deliveries(buyer, id)).toHaveLength(1);
  }, 30_000);

  it('a start the API cannot repeat safely is sent once; a lost answer holds the deal until a person names the job (T-408)', async () => {
    stub = await startJobStub({ key: KEY, failFirstStart: true, readsUntilComplete: 0 });
    const api = jobStubSellerApi(stub.base);
    const ready = 'ready-credential-t408';
    const file = configFile(stub.base, { sellerApi: { ...api, start: { ...api.start, repeatable: false } }, redelivery: { refetchEverySec: 0, readyAuth: { kind: 'bearer', env: 'HOLDBACK_READY_CREDENTIALS' } } });
    const lines: string[] = [];
    const running = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY, HOLDBACK_READY_CREDENTIALS: ready });
    adapters.push(running);
    expect(lines.join('\n')).toContain('The seller API\'s start is sent at most once a deal');
    const buyer = agent('buyer-1');
    const { body: q } = await quote(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the deal to hold at start-unknown', () => stageOf(running, id) === 'start-unknown');
    await new Promise((r) => setTimeout(r, 400)); // eight more polls: none may start again
    expect(stub.requests.filter((r) => r.path === '/api/v2/runs')).toHaveLength(1);
    expect(lines.some((l) => l.includes('job.start_unknown'))).toBe(true);

    // A journal written before T-408 has a `starting` deal with no attempt count: it reads as attempted, never as new.
    await running.close();
    adapters.splice(adapters.indexOf(running), 1);
    const jfile = JSON.parse(readFileSync(file, 'utf8')).journal;
    const old = JSON.parse(readFileSync(jfile, 'utf8'));
    old.deals[id].stage = 'starting';
    delete old.deals[id].startAttempts;
    writeFileSync(jfile, JSON.stringify(old));
    const restarted = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY, HOLDBACK_READY_CREDENTIALS: ready });
    adapters.push(restarted);
    await until('the old-format deal to hold at start-unknown', () => stageOf(restarted, id) === 'start-unknown');
    expect(stub.requests.filter((r) => r.path === '/api/v2/runs')).toHaveLength(1);
    expect(lines.join('\n')).toContain('the mapping says "repeatable": false');

    const job = (jobId: J, credential = ready, deal: string = id) => fetch(`${restarted.url}/deals/${deal}/job`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
    expect((await job(41, 'wrong')).status).toBe(401);
    expect((await job('')).status).toBe(400);
    expect((await job('41', ready, `0x${'ab'.repeat(32)}`)).status).toBe(404);
    const named = await job('41');
    expect(named.status).toBe(202);
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('the delivery to be recorded', () => stageOf(restarted, id) === 'delivered');
    expect(stub.requests.filter((r) => r.path === '/api/v2/runs')).toHaveLength(1);
    expect(stub.runs()).toHaveLength(1);
    expect(await deliveries(buyer, id)).toHaveLength(1);
    expect((await job('41')).status).toBe(409); // the deal no longer waits for a job ID
  }, 30_000);

  it('a start-unknown deal nobody names closes at deliverBy (T-408)', async () => {
    stub = await startJobStub({ key: KEY, failFirstStart: true, readsUntilComplete: 0 });
    const api = jobStubSellerApi(stub.base);
    const file = configFile(stub.base, { sellerApi: { ...api, start: { ...api.start, repeatable: false } } });
    const { running } = await adapter(file);
    const buyer = agent('buyer-2');
    const { body: q } = await quote(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('start-unknown', () => stageOf(running, id) === 'start-unknown');
    world.advance(2 * 86_400 + 60); // past deliverBy, two days after the offer
    await until('the deal to close', () => stageOf(running, id) === 'closed');
    expect(running.deals().find((d) => d.id === id)?.note).toContain('the delivery deadline passed with no job named');
    expect(stub.requests.filter((r) => r.path === '/api/v2/runs')).toHaveLength(1);
  }, 30_000);

  it('a failed job is reported once and never delivered', async () => {
    stub = await startJobStub({ key: KEY, fail: true, readsUntilComplete: 1 });
    const { running, lines } = await adapter(configFile(stub.base));
    const buyer = agent('buyer-1');
    const { body: q } = await quote(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to close the deal', () => stageOf(running, id) === 'closed');
    await new Promise((r) => setTimeout(r, 300)); // more polls: nothing more happens
    expect(lines.filter((l) => l.includes(`ALERT ${id} job.failed`))).toHaveLength(1);
    expect(lines.join('\n')).toContain(`the seller's job 41 failed (error); nothing is delivered`);
    expect(await deliveries(buyer, id)).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');
  }, 30_000);

  it('a file that fails to fetch holds the delivery and alerts; once it fetches, the result is delivered once', async () => {
    stub = await startJobStub({ key: KEY, readsUntilComplete: 0, brokenFiles: ['poc/reentry.t.sol'] });
    const file = configFile(stub.base);
    const { running, lines } = await adapter(file);
    const buyer = agent('buyer-2');
    const { body: q } = await quote(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    await until('the adapter to hold the delivery', () => stageOf(running, id) === 'refused');
    await new Promise((r) => setTimeout(r, 300)); // refetches of the same result raise no second alert
    const alerts = lines.filter((l) => l.includes(`ALERT ${id} delivery.refused`));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('FILES NOT ADDED file poc/reentry.t.sol: the seller API answered 500');
    expect(await deliveries(buyer, id)).toEqual([]);

    stub.fixFiles();
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(await deliveries(buyer, id)).toHaveLength(1);
    expect(lines.join('\n')).not.toContain(KEY);
    expect(journalText(file)).not.toContain(KEY);
  }, 30_000);

  it('with a report mapping too, the mapping converts the result with its files, and the files are delivered', async () => {
    stub = await startJobStub({ key: KEY, readsUntilComplete: 0 });
    // The files land beside the list, at /attachments; the mapping moves them to the template's proofs.
    const file = configFile(stub.base, { reportMapping: 'mapping.json' }, { into: '/attachments' });
    writeFileSync(join(dirname(file), 'mapping.json'), JSON.stringify({ version: 1, report: { summary: { $path: 'summary' }, target: { $path: 'target' }, proofs: { $each: 'attachments', $item: { path: { $path: 'path' }, content: { $path: 'content' } } } } }));
    const { running, lines } = await adapter(file);
    const buyer = agent('buyer-1');
    const { body: q } = await quote(running, buyer);
    const id = q.commitmentId as Hex;
    await fund(buyer, id);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(JSON.parse(await buyer.openDelivery(id))).toEqual({ summary: 'Reviewed vault-core to depth 2.', target: 'vault-core', proofs: Object.entries(DEFAULT_FILES).map(([path, content]) => ({ path, content })) });
    expect(lines.join('\n')).toMatch(/added the result's files[\s\S]*converted the result with the report mapping/);
  }, 30_000);

  it('stops at start when the credential\'s variable is unset, before it reads the operators', async () => {
    stub = await startJobStub({ key: KEY });
    const settings = loadConfig(configFile(stub.base));
    // No operators either: a start that reached the network would fail on those first, with another message.
    await expect(startSellerAdapter({ ...settings, log: () => {} }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: '' })).rejects.toThrow("set JOBS_API_KEY to your seller API's credential: sellerApi.auth names it");
    expect(stub.requests).toEqual([]);
  });
});

// ---- The mapping's refusals, against the stub alone ----

const client = (api: J, env: Record<string, string> = { JOBS_API_KEY: KEY }) => sellerApiClient(api, env, FIELDS);
const withResult = (base: string, change: (r: J) => void): J => {
  const api = jobStubSellerApi(base);
  change(api.result);
  return api;
};

describe('seller adapter, a job API of another shape (T-366): the configuration', () => {
  const base = 'http://127.0.0.1:9/api/v2/';
  it('a start repeats only when its API keys it: an idempotencyHeader, or repeatable true (T-408)', () => {
    const api = jobStubSellerApi(base);
    const noHeader = { ...api.start };
    delete noHeader.idempotencyHeader;
    expect(client(api).startRepeatable).toBe(true); // names X-Request-Key
    expect(client({ ...api, start: noHeader })).toMatchObject({ startRepeatable: false, startOneShotBecause: 'the mapping names no idempotencyHeader' });
    expect(client({ ...api, start: { ...api.start, repeatable: false } })).toMatchObject({ startRepeatable: false, startOneShotBecause: 'the mapping says "repeatable": false' });
    expect(client({ ...api, start: { ...noHeader, repeatable: true } }).startRepeatable).toBe(true);
    expect(client({ quote: 'http://127.0.0.1:8790/quote', start: 'http://127.0.0.1:8790/jobs', result: 'http://127.0.0.1:8790/jobs/{jobId}/result' }, {}).startRepeatable).toBe(true);
    expect(() => client({ ...api, start: { ...api.start, repeatable: 'no' } })).toThrow('sellerApi.start.repeatable must be true or false');
  });

  it('refuses a mapping that could send a request outside the base URL, naming the field', () => {
    const at = (path: string) => () => client({ ...jobStubSellerApi(base), quote: { ...jobStubSellerApi(base).quote, path } });
    for (const path of ['../admin', 'a/../../admin', 'https://elsewhere.example/estimates']) expect(at(path), path).toThrow(/sellerApi\.quote\.path: (the address leaves the base URL|a path under sellerApi\.baseUrl, not an address)/);
    expect(() => client({ ...jobStubSellerApi(base), baseUrl: undefined })).toThrow('sellerApi.baseUrl is required with a mapping or a credential');
    expect(() => client({ ...jobStubSellerApi(base), baseUrl: 'http://user:pw@127.0.0.1:9/api/' })).toThrow(/carries no user, query or fragment/);
    expect(() => client({ baseUrl: base, quote: 'http://elsewhere.example/quote', start: `${base}runs`, result: `${base}runs/{jobId}` })).toThrow('sellerApi.quote: the address leaves the base URL');
  });

  it('refuses a placeholder outside the fixed list, or one the call cannot fill, and any expression', () => {
    const body = (b: J) => () => client({ ...jobStubSellerApi(base), quote: { ...jobStubSellerApi(base).quote, body: b } });
    expect(body({ k: '{{secret}}' })).toThrow('sellerApi.quote.body.k uses {{secret}}, which this call cannot fill');
    expect(body({ k: '{{jobId}}' })).toThrow('uses {{jobId}}, which this call cannot fill');
    expect(body({ k: '{{scope.price}}' })).toThrow('uses {{scope.price}}, which the scope rules do not define');
    expect(body({ k: 'depth {{scope}}' })).toThrow('uses {{scope}} inside text');
    expect(body({ k: '{{ scope.depth + 1 }}' })).toThrow('a placeholder is {{name}} or {{scope.<field>}}, nothing else');
    expect(body({ k: '{{env.KEY}}' })).toThrow('uses {{env}}, which this call cannot fill');
  });

  it('refuses a header that would replace the credential or the idempotency key, and a GET with a body', () => {
    const api = jobStubSellerApi(base);
    expect(() => client({ ...api, quote: { ...api.quote, headers: { 'X-Api-Key': 'mine' } } })).toThrow('set by the adapter');
    expect(() => client({ ...api, start: { ...api.start, headers: { 'x-request-key': '{{scope.target}}' } } })).toThrow('set by the adapter');
    expect(() => client({ ...api, start: { ...api.start, idempotencyHeader: 'X-Api-Key' } })).toThrow('idempotencyHeader must be a header name other than the credential');
    expect(() => client(withResult(base, (r) => (r.body = { a: 1 })))).toThrow('a GET carries no body');
  });

  it('refuses file limits above the delivery cap, and status values in two lists', () => {
    expect(() => client(withResult(base, (r) => (r.files.maxTotalBytes = DELIVERY_CAP_BYTES + 1)))).toThrow(`at most the delivery cap of ${DELIVERY_CAP_BYTES}`);
    expect(() => client(withResult(base, (r) => (r.files.maxCount = 0)))).toThrow('maxCount must be a positive whole number');
    expect(() => client(withResult(base, (r) => (r.status.failed = ['complete'])))).toThrow('a status value is in more than one list');
    expect(() => client(withResult(base, (r) => (r.status = { by: 'code' })))).toThrow('status.by must be "http" or "field"');
  });

  it('the shipped job-API example loads and its mapping passes the checks; the Caddyfile forwards /defaults', () => {
    const example = loadConfig(fileURLToPath(new URL('./seller-adapter.job-api.config.json', import.meta.url)));
    expect(() => sellerApiClient(example.sellerApi, { JOBS_API_KEY: KEY }, { scope: Object.keys(example.scope), options: [] })).not.toThrow();
    const caddy = readFileSync(fileURLToPath(new URL('./seller-adapter.Caddyfile', import.meta.url)), 'utf8');
    expect(caddy).toMatch(/handle \/quote \{\s+reverse_proxy 127\.0\.0\.1:8791\s+\}/);
    expect(caddy).toMatch(/handle \/defaults \{\s+reverse_proxy 127\.0\.0\.1:8791\s+\}/);
    expect(caddy).not.toMatch(/handle \/deals/);
  });

  it('loads a configuration file with a mapping, and keeps today\'s three addresses working', () => {
    const file = configFile(base);
    expect(loadConfig(file).sellerApi).toEqual(jobStubSellerApi(base));
    expect(() => client({ quote: 'http://127.0.0.1:8790/quote', start: 'http://127.0.0.1:8790/jobs', result: 'http://127.0.0.1:8790/jobs/{jobId}/result' }, {})).not.toThrow();
  });
});

describe('seller adapter, a job API of another shape (T-366): answers', () => {
  it('a job ID that would climb out of the base URL is refused before any request', async () => {
    stub = await startJobStub({ key: KEY });
    const api = client(jobStubSellerApi(stub.base));
    await expect(api.result({ jobId: '..' })).rejects.toThrow('a path segment is empty, "." or ".."');
    await api.result({ jobId: '../../elsewhere' }).catch(() => {}); // encoded: it stays a run ID under the base
    expect(stub.requests.map((r) => r.path)).toEqual(['/api/v2/runs/..%2F..%2Felsewhere']);
  });

  it('a redirect is refused, so the credential never follows it elsewhere', async () => {
    stub = await startJobStub({ key: KEY });
    const api = client({ ...jobStubSellerApi(stub.base), quote: { ...jobStubSellerApi(stub.base).quote, path: 'moved' } });
    await expect(api.quote({ scope: SCOPE })).rejects.toThrow('the seller API answered 302 to the quote, a redirect, which the adapter never follows');
    expect(stub.requests.map((r) => r.path)).toEqual(['/api/v2/moved']);
  });

  it('asks the runtime for no redirect handling of its own: redirect "manual", which the Workers runtime accepts (T-433)', async () => {
    stub = await startJobStub({ key: KEY });
    const api = client(jobStubSellerApi(stub.base));
    const seen: Array<RequestInit['redirect']> = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push(init?.redirect);
      return real(input, init);
    }) as typeof fetch;
    try {
      await api.quote({ scope: SCOPE });
    } finally {
      globalThis.fetch = real;
    }
    expect(seen).toEqual(['manual']);
  });

  it('prices a quote that counts units, such as credits, at a fixed price per unit (T-406)', async () => {
    const answers: J[] = [{ quoted_price: 500, admission_charge: 0 }, { quoted_price: '7' }, { quoted_price: 5e2 }, { quoted_price: 1.5 }, { quoted_price: -3 }, {}, { quoted_price: '007' }, { quoted_price: 9007199254740993 }, { quoted_price: '9'.repeat(31) }];
    const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answers.shift())));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const call = (quote: J) => client({ baseUrl: b, quote: { path: 'q', ...quote }, start: { path: 's' }, result: { path: 'jobs/{{jobId}}' } });
    try {
      const api = call({ read: { units: '/quoted_price' }, unitPrice: '1500000' }); // 1.50 of a 6-decimal token a unit
      expect(api.describe).toContain('a quote prices /quoted_price units at 1500000 base units each');
      expect((await api.quote({ scope: SCOPE })).price).toEqual({ token: undefined, amount: '750000000' }); // 500 units: 750.00
      expect((await api.quote({ scope: SCOPE })).price.amount).toBe('10500000'); // a count written as text: 7 units
      expect((await api.quote({ scope: SCOPE })).price.amount).toBe('750000000'); // 5e2 is the number 500
      for (const bad of ['1.5', '-3', 'undefined', '"007"', 'beyond a safe integer']) await expect(api.quote({ scope: SCOPE }), bad).rejects.toThrow('the quote\'s /quoted_price is not a whole number of units, as a JSON number or digits with no leading zero');
      const huge = call({ read: { units: '/quoted_price' }, unitPrice: '9'.repeat(78) });
      await expect(huge.quote({ scope: SCOPE })).rejects.toThrow('is larger than base units can hold');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect(() => call({ unitPrice: '1500000' })).toThrow('sellerApi.quote.unitPrice needs sellerApi.quote.read.units');
    expect(() => call({ read: { units: '/quoted_price' } })).toThrow('sellerApi.quote.read.units needs sellerApi.quote.unitPrice');
    expect(() => call({ read: { units: '/quoted_price', amount: '/price' }, unitPrice: '1500000' })).toThrow('sellerApi.quote.read takes units or amount, not both');
    for (const p of ['1.5', '-1', '01', 1500000]) expect(() => call({ read: { units: '/quoted_price' }, unitPrice: p }), String(p)).toThrow('sellerApi.quote.unitPrice must be base units as a decimal string');
  });

  it('reads the job state by HTTP status when the configuration says so', async () => {
    const codes = [202, 202, 410];
    const server = createServer((_req, res) => res.writeHead(codes.shift() ?? 200, { 'content-type': 'application/json' }).end('{"ok": true}'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const api = client({ baseUrl: b, quote: { path: 'q' }, start: { path: 's' }, result: { path: 'jobs/{{jobId}}', status: { by: 'http', running: [202], done: [200], failed: [410] } } });
      expect(await api.result({ jobId: '7' })).toEqual({ state: 'running' });
      expect(await api.result({ jobId: '7' })).toEqual({ state: 'running' });
      expect(await api.result({ jobId: '7' })).toEqual({ state: 'failed', status: 'HTTP 410' });
      expect(await api.result({ jobId: '7' })).toMatchObject({ state: 'done' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  const files = async (options: Partial<JobStubOptions>, change: (f: J) => void = () => {}) => {
    stub = await startJobStub({ key: KEY, ...options });
    const api = client(withResult(stub.base, (r) => change(r.files)));
    const report = new TextEncoder().encode(JSON.stringify({ summary: 's', target: 't', proofs: options.fileList ?? Object.keys(DEFAULT_FILES) }));
    return api.withFiles(report, { jobId: '41' });
  };
  it('refuses a file list that repeats, climbs out, or is too long, and files over the byte limit', async () => {
    await expect(files({ fileList: ['poc/overflow.t.sol', 'poc/overflow.t.sol'] })).rejects.toThrow(new FilesNotAdded('the result names a file twice: poc/overflow.t.sol'));
    await stub!.close();
    for (const bad of ['../../../elsewhere', 'poc/../../x', '/etc/passwd', 'poc//a']) {
      await expect(files({ fileList: [bad] }), bad).rejects.toThrow(/a path segment is empty/);
      expect(stub!.requests, bad).toEqual([]);
      await stub!.close();
    }
    await expect(files({}, (f) => (f.maxCount = 1))).rejects.toThrow('the result names 2 files, more than files.maxCount, 1');
    await stub!.close();
    await expect(files({ files: { a: 'x'.repeat(600), b: 'y'.repeat(600) }, fileList: ['a', 'b'] }, (f) => (f.maxTotalBytes = 1000))).rejects.toThrow('file b: the seller API\'s answer to a file is larger than 400 bytes');
    await stub!.close();
    await expect(files({ fileList: ['poc/missing.t.sol'] })).rejects.toThrow('file poc/missing.t.sol: the seller API answered 404');
    await stub!.close();
    await expect(files({ files: { bin: new Uint8Array([0xff, 0xfe]) }, fileList: ['bin'] })).rejects.toThrow('file bin is not UTF-8 text');
    await stub!.close();
    await expect(files({}, (f) => (f.into = '/summary'))).rejects.toThrow('the result already has a field at /summary');
  });

  it('adds base64 content when the configuration says so', async () => {
    const out = JSON.parse(new TextDecoder().decode(await files({ files: { bin: new Uint8Array([0xff, 0xfe]) }, fileList: ['bin'] }, (f) => { f.encoding = 'base64'; f.into = '/attachments'; })));
    expect(out).toEqual({ summary: 's', target: 't', proofs: ['bin'], attachments: [{ path: 'bin', content: '//4=' }] });
  });
});
