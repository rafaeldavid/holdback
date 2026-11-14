// The seller adapter against a job API that ignores the idempotency key (T-407). Such an API makes and charges a new
// job for each start, and refuses a second one only while the first is queued or running. With
// `sellerApi.start.repeatable: false` the adapter sends the start at most once per deal: when that start's answer
// is lost, it holds the deal at `start-unknown`, alerts once, and goes on only when a person gives it the job's ID
// (POST /deals/<id>/job) or says no job was made. Deals run on SimChain; the stub is examples/seller-adapter-job-stub.ts.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { sellerApiClient } from './seller-adapter-api.ts';
import { jobStubSellerApi, startJobStub, type JobStub, type JobStubOptions } from './seller-adapter-job-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = 'one-shot-test-credential-3c81d2'; // test credentials: they must appear in no log line
const READY = 'one-shot-ready-credential-9e40aa';
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target'], properties: { target: { const: '{{target}}' } } } }],
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

/** A stub that ignores the request key, and the seller's configuration for it: a start it may send only once. */
async function setUp(o: Partial<JobStubOptions> = {}, readyAuth = true): Promise<string> {
  stub = await startJobStub({ key: KEY, ignoresKey: true, readsUntilComplete: 1, ...o });
  const dir = mkdtempSync(join(tmpdir(), 't407-'));
  writeFileSync(join(dir, 'template.json'), JSON.stringify(TEMPLATE));
  const api = jobStubSellerApi(stub.base);
  delete api.result.files; // this stub's result names no files to fetch
  api.start.repeatable = false;
  const file = join(dir, 'seller.json');
  const redelivery = { refetchEverySec: 0, ...(readyAuth ? { readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } } : {}) };
  writeFileSync(file, JSON.stringify({ port: 0, pollMs: 50, journal: join(dir, 'journal.json'), template: 'template.json', scope: SCOPE_RULES, redelivery, sellerApi: api }));
  return file;
}
async function adapter(file: string) {
  const lines: string[] = [];
  const running = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY, READY_CREDENTIALS: READY });
  adapters.push(running);
  return { running, lines };
}
async function quoteAndFund(a: RunningAdapter, label: string): Promise<{ buyer: Agent; id: Hex }> {
  const buyer = agent(label);
  const res = await fetch(`${a.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
  const q = (await res.json()) as J;
  expect(res.status, JSON.stringify(q)).toBe(200);
  const id = q.commitmentId as Hex;
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
  return { buyer, id };
}
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = (a: RunningAdapter, id: Hex) => a.deals().find((d) => d.id === id)?.stage;
const starts = () => stub!.requests.filter((r) => r.method === 'POST' && r.path === '/api/v2/runs');
const deliveries = async (buyer: Agent, id: Hex): Promise<J[]> => (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === 'delivery.submitted');
const job = (a: RunningAdapter, id: Hex, body: J, credential: string | null = READY) =>
  fetch(`${a.url}/deals/${id}/job`, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body) });

describe('seller adapter, a start the seller API cannot repeat (T-407)', () => {
  it('a lost start answer sends no second start, even after the first job ends; the job ID a person gives delivers once', async () => {
    const file = await setUp({ failFirstStart: true });
    const { running, lines } = await adapter(file);
    const { buyer, id } = await quoteAndFund(running, 'buyer-1');
    await until('the deal to wait for a person', () => stageOf(running, id) === 'start-unknown');
    expect(stub!.runs()).toHaveLength(1); // the API made the run, and the adapter never heard

    // The first job ends. A start sent now would make and charge a second one: the adapter sends none.
    stub!.finishRuns();
    await new Promise((r) => setTimeout(r, 400)); // several polls
    expect(starts()).toHaveLength(1);
    expect(stub!.runs()).toHaveLength(1);
    expect(stageOf(running, id)).toBe('start-unknown');
    const alerts = lines.filter((l) => l.includes(`ALERT ${id} job.start_unknown`));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(`POST {"jobId": "<its ID>"} to /deals/${id}/job`);

    // A person finds the run at the API and gives its ID: the adapter fetches the result and delivers once.
    const res = await job(running, id, { jobId: '41' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ commitmentId: id, stage: 'started', jobId: '41' });
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(starts()).toHaveLength(1);
    expect(await deliveries(buyer, id)).toHaveLength(1);
    const log = lines.join('\n');
    expect(log).toContain('it sends a start at most once per deal');
    expect(log).not.toContain(KEY);
    expect(log).not.toContain(READY);
  }, 30_000);

  it('a restart with the one start sent and no answer recorded sends no second start', async () => {
    const file = await setUp({ failFirstStart: true });
    const one = await adapter(file);
    const { id } = await quoteAndFund(one.running, 'buyer-2');
    await until('the deal to wait for a person', () => stageOf(one.running, id) === 'start-unknown');
    await one.running.close();
    stub!.finishRuns();
    const two = await adapter(file);
    await new Promise((r) => setTimeout(r, 400));
    expect(stageOf(two.running, id)).toBe('start-unknown');
    expect(starts()).toHaveLength(1);
    expect(two.lines.filter((l) => l.includes(`ALERT ${id} job.start_unknown`))).toHaveLength(0); // alerted once, by run 1
  }, 30_000);

  it('when a person says the API made no job, the adapter sends one more start and delivers', async () => {
    const file = await setUp({ downFirstStart: true });
    const { running } = await adapter(file);
    const { buyer, id } = await quoteAndFund(running, 'buyer-1');
    await until('the deal to wait for a person', () => stageOf(running, id) === 'start-unknown');
    expect(stub!.runs()).toHaveLength(0);
    expect((await job(running, id, { startAgain: true })).status).toBe(202);
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(starts()).toHaveLength(2);
    expect(stub!.runs()).toHaveLength(1);
  }, 30_000);

  it('a start that answers sends one start and needs no person', async () => {
    const file = await setUp();
    const { running, lines } = await adapter(file);
    const { buyer, id } = await quoteAndFund(running, 'buyer-2');
    expect((await buyer.waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    await until('the journal to record the delivery', () => stageOf(running, id) === 'delivered');
    expect(starts()).toHaveLength(1);
    expect(lines.some((l) => l.includes('job.start_unknown'))).toBe(false);
  }, 30_000);

  it('the job route needs the ready credential, a deal that waits, and one of its two bodies', async () => {
    const file = await setUp({ failFirstStart: true });
    const { running } = await adapter(file);
    const { id } = await quoteAndFund(running, 'buyer-1');
    await until('the deal to wait for a person', () => stageOf(running, id) === 'start-unknown');
    expect((await job(running, id, { jobId: '41' }, null)).status).toBe(401);
    expect((await job(running, id, { jobId: '41' }, 'not-the-credential')).status).toBe(401);
    for (const body of [{}, { jobId: '' }, { jobId: 41 }, { jobId: 'a b' }, { startAgain: false }, { jobId: '41', startAgain: true }, { jobId: 'x'.repeat(201) }]) {
      expect((await job(running, id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await job(running, `0x${'ab'.repeat(32)}` as Hex, { jobId: '41' })).status).toBe(404);
    expect(stageOf(running, id)).toBe('start-unknown');
    expect((await job(running, id, { jobId: '41' })).status).toBe(202);
    expect((await job(running, id, { jobId: '41' })).status).toBe(409); // no longer waiting
  }, 30_000);

  it('without a ready credential the alert says how to set one, and the job route is not served', async () => {
    const file = await setUp({ failFirstStart: true }, false);
    const { running, lines } = await adapter(file);
    const { id } = await quoteAndFund(running, 'buyer-2');
    await until('the deal to wait for a person', () => stageOf(running, id) === 'start-unknown');
    expect(lines.find((l) => l.includes(`ALERT ${id} job.start_unknown`))).toContain('set redelivery.readyAuth');
    expect((await job(running, id, { jobId: '41' })).status).toBe(404);
  }, 30_000);
});

describe('seller adapter, sellerApi.start.repeatable (T-407): the mapping', () => {
  const fields = { scope: ['target', 'depth'], options: [] };
  const env = { JOBS_API_KEY: KEY };
  const api = (repeatable: J) => ({ ...jobStubSellerApi('http://127.0.0.1:1/api/v2/'), start: { ...jobStubSellerApi('http://127.0.0.1:1/api/v2/').start, repeatable } });
  it('takes true or false, and repeats by default', () => {
    expect(sellerApiClient(jobStubSellerApi('http://127.0.0.1:1/api/v2/'), env, fields).startRepeatable).toBe(true);
    expect(sellerApiClient(api(true), env, fields).startRepeatable).toBe(true);
    expect(sellerApiClient(api(false), env, fields).startRepeatable).toBe(false);
  });
  it('refuses anything else', () => {
    for (const v of ['false', 0, null, {}]) expect(() => sellerApiClient(api(v), env, fields), JSON.stringify(v)).toThrow('sellerApi.start.repeatable must be true or false');
  });
});
