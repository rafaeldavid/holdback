// The seller adapter (T-318) against the stub seller API, on SimChain: a quote becomes a signed offer, a
// funded hold starts one job, and a result is delivered only after the seller's own preflight passes.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTypedData, type Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { loadTermsFile } from '@holdback/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { config as shipped, startSellerAdapter, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi, type StubOptions } from './seller-adapter-stub.ts';
import { typedOf } from './verify.ts';

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

  it('learns of the hold from the event stream alone', async () => {
    const { running } = await adapter({ pollMs: 3_600_000 }, { pollsUntilComplete: 0 });
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    await until('the adapter to follow the stream', () => running.following());
    await fund(buyer, q.commitmentId);
    expect((await buyer.waitFor(q.commitmentId, ['Released', 'Refunded'])).escrowState).toBe('Released');
  }, 30_000);

  it('learns of the hold from polling alone', async () => {
    const { running } = await adapter({ stream: false });
    const buyer = agent('buyer-2');
    const { body: q } = await quoteFor(running, buyer);
    await fund(buyer, q.commitmentId);
    expect((await buyer.waitFor(q.commitmentId, ['Released', 'Refunded'])).escrowState).toBe('Released');
    expect(running.following()).toBe(false);
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
