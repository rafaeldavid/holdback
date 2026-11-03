// T-030 (D39, docs/reviews/2026-11-02-api-agent-review.md): the operator API as an outside agent meets it, with
// an HTTP client, an EIP-712 signer and llms.txt. Problems an agent can branch on, planned routes that say so,
// one faucet, one discovery document with the limits, prepare that hides nothing, one timestamp format, notices
// in the body, and a write budget a forged signature cannot spend.
import { readFileSync } from 'node:fs';
import type { Hex32 } from '@holdback/core';
import { seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { hashTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testAccount } from './accounts.js';
import { fetchHandler } from './fetch.js';
import type { Prepared } from './prepare.js';
import { PROBLEM_BASE, PROBLEMS } from './problems.js';
import { simRegistry } from './registry.js';
import { startOperator, type RunningOperator } from './server.js';
import { startSimWorld, type SimWorld } from './sim-world.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const D33 = { to: testAccount('t030-fees').address, token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund' as const, refundable: false as const };

let world: SimWorld;
let api: string;
let throttled: RunningOperator;
let feeNode: RunningOperator;
let broken: RunningOperator;
let noticing: RunningOperator;

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  api = world.info.operators[0]!;
  const base = { settlement: world.chain, registry: simRegistry(world.chain), env: {} };
  throttled = await startOperator({ ...base, signerKey: testAccount('t030-throttled').privateKey, operatorId: 't030-throttled', rateLimit: { reads: 100, writes: 2, windowMs: 60_000 } });
  feeNode = await startOperator({ ...base, signerKey: testAccount('t030-fee').privateKey, operatorId: 't030-fee', fee: D33 });
  // A settlement layer whose balance read fails: the operator's own failure is a 500 `internal`.
  const failing = new Proxy(world.chain, {
    get(t, k) {
      if (k === 'balances') return async () => Promise.reject(new Error('disk on fire'));
      const v = Reflect.get(t, k) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  broken = await startOperator({ ...base, settlement: failing, signerKey: testAccount('t030-broken').privateKey, operatorId: 't030-broken' });
  noticing = await startOperator({ ...base, signerKey: testAccount('t030-notices').privateKey, operatorId: 't030-notices', notices: (s) => [`notice for ${s.kind}`] });
}, 30_000);
afterAll(async () => {
  await Promise.all([throttled, feeNode, broken, noticing].map((o) => o?.close()));
  await world?.close();
});

const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const slate = () => ({ primary: world.info.adjudicators[0]!.address, fallback: world.info.adjudicators[1]!.address, appeal: world.info.adjudicators[2]!.address });
const nonce = () => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
let keys = 0;

async function http(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: J; headers: Headers }> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(method === 'POST' && !url.includes('/prepare/') ? { 'idempotency-key': `t030-${++keys}` } : {}), ...headers }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text && /json/.test(res.headers.get('content-type') ?? '') ? JSON.parse(text) : text };
}

function ints(types: Record<string, Array<{ name: string; type: string }>>, type: string, v: unknown): unknown {
  if (type.endsWith('[]')) return (v as unknown[]).map((x) => ints(types, type.slice(0, -2), x));
  if (types[type]) return Object.fromEntries(types[type]!.map((f) => [f.name, ints(types, f.type, (v as Record<string, unknown>)[f.name])]));
  return /^u?int\d*$/.test(type) ? BigInt(v as string) : v;
}
/** Signs the slots whose signer is `key`'s address, or every slot when forging (a contract test: no verification). */
async function sign(p: Prepared, key: `0x${string}`, forge = false): Promise<Prepared> {
  const account = privateKeyToAccount(key);
  for (const s of p.sign.filter((x) => forge || x.signer.toLowerCase() === account.address.toLowerCase())) {
    const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) } as Parameters<typeof hashTypedData>[0];
    const path = s.slot.split('.');
    const parent = path.slice(0, -1).reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p.submit.body);
    parent[path.at(-1)!] = await account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
  }
  return p;
}

const offerInput = (buyer = 'buyer-1', seller = 'seller-1') => ({
  nonce: nonce(),
  disclosure: 'public',
  template: 'checks-only',
  clubId: world.info.clubId,
  seller: acct(seller).address,
  buyer: { address: acct(buyer).address, encryptionPublicKey: acct(buyer).encryptionPublicKey },
  adjudicators: slate(),
  price: { token: 'tUSD', amount: '25000000' },
  deliverable: { kind: 'dataset', description: 'Two customers.', format: 'text/csv' },
  checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] }],
});

async function waitFor(id: Hex32, states: string[], base = api): Promise<J> {
  for (let i = 0; i < 200; i++) {
    const s = (await http('GET', `${base}/v1/commitments/${id}`)).body;
    if (states.includes(s.escrowState)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${id} never reached ${states.join('|')}`);
}

async function offered(buyer = 'buyer-1', seller = 'seller-1'): Promise<Hex32> {
  const p = (await http('POST', `${api}/v1/prepare/offer`, offerInput(buyer, seller))).body as Prepared;
  expect((await http('POST', `${api}${p.submit.path}`, (await sign(p, acct(seller).privateKey)).submit.body)).body.escrowState).toBe('Offered');
  await waitFor(p.commitmentId, ['AcceptedByAdjudicator']);
  return p.commitmentId;
}
async function held(buyer = 'buyer-1', seller = 'seller-1'): Promise<Hex32> {
  const id = await offered(buyer, seller);
  const p = (await http('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce: nonce(), fundingNonce: nonce() })).body as Prepared;
  expect((await http('POST', `${api}${p.submit.path}`, (await sign(p, acct(buyer).privateKey)).submit.body)).body.escrowState).toBe('Held');
  return id;
}

describe('problems an agent can act on (F4)', () => {
  it('links each problem to its type page, titles it, and names the input at fault', async () => {
    const r = await http('GET', `${api}/v1/commitments?limit=999`);
    expect([r.status, r.body.type, r.body.field, r.body.title]).toEqual([400, 'invalid_terms', 'limit', PROBLEMS.invalid_terms.title]);
    expect(r.headers.get('link')).toBe(`<${PROBLEM_BASE}invalid_terms>; rel="type"`);
    expect((await http('GET', `${api}/v1/commitments?cursor=nope`)).body.type).toBe('invalid_cursor');
    const { seller: _s, ...noSeller } = offerInput(); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect((await http('POST', `${api}/v1/prepare/offer`, noSeller)).body).toMatchObject({ type: 'invalid_terms', field: 'seller' });
    const p = (await http('POST', `${api}/v1/prepare/offer`, offerInput())).body as Prepared;
    const bad = { ...p.submit.body, price: { token: 'tUSD', amount: '25.5' } };
    expect((await http('POST', `${api}/v1/commitments`, bad)).body).toMatchObject({ type: 'invalid_terms', field: 'price.amount' });
    const signed = (await sign(p, acct('seller-1').privateKey)).submit.body;
    expect((await http('POST', `${api}/v1/commitments`, signed, { 'idempotency-key': '' })).body).toMatchObject({ type: 'invalid_terms', field: 'Idempotency-Key' });
  });

  it('says the state and what the call needs on invalid_state, from prepare and from the settlement layer', async () => {
    const id = await held();
    const early = await http('POST', `${api}/v1/prepare/early-accept`, { commitmentId: id, nonce: nonce() });
    expect([early.status, early.body.state, early.body.needs]).toEqual([409, 'Held', ['Delivered']]);
    const trigger = await http('POST', `${api}/v1/commitments/${id}/triggers/fallback`, {});
    expect([trigger.status, trigger.body.type, trigger.body.state, trigger.body.needs]).toEqual([409, 'invalid_state', 'Held', ['Delivered']]);
  });

  it('names the fee on payment_required', async () => {
    const id = await offered('buyer-2', 'seller-2');
    const p = (await http('POST', `${feeNode.url}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce: nonce(), fundingNonce: nonce(), operatorFeeNonce: nonce() })).body as Prepared;
    const { operatorFee: _f, ...unpaid } = (await sign(p, acct('buyer-2').privateKey)).submit.body; // eslint-disable-line @typescript-eslint/no-unused-vars
    const r = await http('POST', `${feeNode.url}${p.submit.path}`, unpaid);
    expect([r.status, r.body.type, r.body.fee]).toEqual([402, 'payment_required', { to: D33.to, token: 'tUSD', amount: '10000' }]);
  });

  it('answers its own failure as 500 internal, without the cause', async () => {
    const r = await http('GET', `${broken.url}/v1/balances/${acct('buyer-1').address}`);
    expect([r.status, r.body.type, r.body.status]).toEqual([500, 'internal', 500]);
    expect(JSON.stringify(r.body)).not.toContain('disk on fire');
  });
});

describe('planned routes (D39)', () => {
  it('answer 501 not_implemented with a Link to their source, from x-holdback-planned', async () => {
    const doc = JSON.parse(readFileSync(new URL('../../../spec/openapi.json', import.meta.url), 'utf8')) as J;
    const planned = doc['x-holdback-planned'] as Array<{ method: string; path: string; source: string }>;
    // The two feedback routes are served since T-032.
    expect(planned.length).toBeGreaterThanOrEqual(17);
    expect(planned.filter((p) => p.path.startsWith('/v1/feedback'))).toEqual([]);
    for (const p of planned) {
      const path = p.path.replace(/\{[^}]+\}/g, (m) => (m === '{address}' || m === '{principal}' ? acct('buyer-1').address : m === '{commitmentId}' ? `0x${'ab'.repeat(32)}` : 'x1'));
      const r = await http(p.method as 'GET' | 'POST', `${api}${path}`, p.method === 'POST' ? {} : undefined);
      expect([r.status, r.body.type], `${p.method} ${p.path}`).toEqual([501, 'not_implemented']);
      expect(r.headers.get('link'), p.path).toContain(`<${p.source}>; rel="describedby"`);
    }
    expect((await http('GET', `${api}/v1/nothing-here`)).status).toBe(404);
  });

  it('count as a read of the client, so they are no way around the throttle (PR 85 review)', async () => {
    const handle = fetchHandler(throttled.operator);
    const codes: number[] = [];
    for (let i = 0; i < 101; i++) codes.push((await handle(new Request('http://op.invalid/v1/funding/quote', { method: 'POST', body: '{}' }), 'planned-reader')).status);
    expect([codes.slice(0, 100).every((c) => c === 501), codes[100]]).toEqual([true, 429]);
  });
});

describe('one faucet (Simplify 3)', () => {
  it('serves POST /v1/faucet; the old /v1/test/faucet is gone', async () => {
    const a = acct('seller-2').address;
    const r = await http('POST', `${api}/v1/faucet`, { address: a, amount: '5' });
    expect([r.status, r.body.address, r.body.granted]).toEqual([200, a, { token: 'tUSD', amount: '5' }]);
    expect(r.body.balance.token).toBe('tUSD');
    expect((await http('POST', `${api}/v1/faucet`, { address: a })).body.granted.amount).toBe('1000000000');
    expect((await http('POST', `${api}/v1/test/faucet`, { address: a, amount: '5' })).status).toBe(404);
  });
});

describe('one discovery document (Simplify 1, F8, F9)', () => {
  it('carries the limits, idempotency retention and the demo facts, and GET / serves it too', async () => {
    const d = (await http('GET', `${api}/.well-known/holdback.json`)).body;
    expect(d.limits).toEqual({ idempotency: { replays: 'success-only', retention: 'process' } });
    expect(d.demo).toMatchObject({ clubId: world.info.clubId, token: { id: 'tUSD', decimals: 6 }, faucet: { path: '/v1/faucet' } });
    expect(d.demo.adjudicators.map((a: J) => [a.role, a.address])).toEqual(world.info.adjudicators.map((a) => [a.role, a.address]));
    const root = (await http('GET', `${api}/`)).body;
    expect({ ...root, settlementTime: null, head: null }).toEqual({ ...d, settlementTime: null, head: null });
    const t = (await http('GET', `${throttled.url}/.well-known/holdback.json`)).body;
    expect(t.limits).toEqual({ reads: { limit: 100, windowSec: 60, per: 'client' }, writes: { limit: 2, windowSec: 60, per: 'signer' }, idempotency: { replays: 'success-only', retention: 'process' } });
    expect(t.demo).toBeUndefined();
  });
});

describe('prepare hides nothing (Simplify 7, C9)', () => {
  it('requires every nonce from the caller and returns only times in defaults', async () => {
    const { nonce: _n, ...noNonce } = offerInput(); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect((await http('POST', `${api}/v1/prepare/offer`, noNonce)).body).toMatchObject({ status: 400, field: 'nonce' });
    const p = (await http('POST', `${api}/v1/prepare/offer`, offerInput())).body as Prepared;
    expect(Object.keys(p.defaults)).toEqual(['createdAt']);
    // One rule for integers in typed data: decimal strings, uint8 included (the fresh-agent run found uint8 as numbers).
    expect((p.sign[0]!.typedData.message['timing'] as J).maxSubmissions).toBe('1');
    const id = await offered();
    expect((await http('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: id, fundingNonce: nonce() })).body).toMatchObject({ status: 400, field: 'agreeNonce' });
    expect((await http('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce: nonce() })).body).toMatchObject({ status: 400, field: 'fundingNonce' });
    expect((await http('POST', `${feeNode.url}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce: nonce(), fundingNonce: nonce() })).body).toMatchObject({ status: 400, field: 'operatorFeeNonce' });
    const af = (await http('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce: nonce(), fundingNonce: nonce(), operatorFeeNonce: nonce() })).body as Prepared;
    expect(af.sign).toHaveLength(2); // no fee here: the fee nonce is ignored
    expect(af.defaults).toEqual({});
    const h = await held('buyer-2', 'seller-2');
    expect((await http('POST', `${api}/v1/prepare/settlement`, { commitmentId: h, toSellerBps: 5000 })).body).toMatchObject({ status: 400, field: 'nonce' });
    const s = (await http('POST', `${api}/v1/prepare/settlement`, { commitmentId: h, toSellerBps: 5000, nonce: nonce() })).body as Prepared;
    expect(Object.keys(s.defaults).sort()).toEqual(['expiresAt', 'releaseKey']);
  });

  it('requires the disclosure level: public in plaintext, private or judgment hash-only', async () => {
    const { disclosure: _d, ...noLevel } = offerInput(); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect((await http('POST', `${api}/v1/prepare/offer`, noLevel)).body).toMatchObject({ status: 400, field: 'disclosure' });
    expect((await http('POST', `${api}/v1/prepare/offer`, { ...offerInput(), disclosure: 'private' })).body).toMatchObject({ status: 400, field: 'disclosure' });
    const h = { ...offerInput(), deliverable: undefined, checks: undefined, template: undefined, hashOnly: true, deliverableHash: `0x${'11'.repeat(32)}`, acceptanceHash: `0x${'22'.repeat(32)}`, createdAt: world.chain.now() };
    expect((await http('POST', `${api}/v1/prepare/offer`, { ...h, disclosure: undefined })).body).toMatchObject({ status: 400, field: 'disclosure' });
    expect((await http('POST', `${api}/v1/prepare/offer`, { ...h, disclosure: 'public' })).body).toMatchObject({ status: 400, field: 'disclosure' });
    expect((await http('POST', `${api}/v1/prepare/offer`, { ...h, disclosure: 'judgment' })).status).toBe(200);
  });
});

describe('one timestamp format (Simplify 8, F5)', () => {
  it('serves read models in whole seconds with Z', async () => {
    const id = await held();
    // A delivery and a decision set the deadlines core computes (appealBy, finalAt) beside SimChain's times.
    const sealed = await seal(new TextEncoder().encode('id,email\n1,a@example.com\n'));
    const stored = (await http('POST', `${api}/v1/ciphertext`, sealed.ciphertext, { 'content-type': 'application/octet-stream' })).body;
    const { recipients } = (await http('GET', `${api}/v1/commitments/${id}/recipients`)).body;
    const encryptedKeys = wrapKeyForRecipients(sealed.key, recipients.map((r: J) => ({ recipient: r.address, publicKey: r.encryptionPublicKey })));
    const p = (await http('POST', `${api}/v1/prepare/delivery`, { commitmentId: id, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: stored.bytes }, plaintextSha256: sealed.plaintextSha256, encryptedKeys })).body as Prepared;
    await http('POST', `${api}${p.submit.path}`, (await sign(p, acct('seller-1').privateKey)).submit.body);
    const state = await waitFor(id, ['Released', 'Refunded']);
    const list = (await http('GET', `${api}/v1/commitments?party=${acct('buyer-1').address}`)).body;
    const times = JSON.stringify([state, list]).match(/"\d{4}-\d{2}-\d{2}T[^"]+"/g) ?? [];
    expect(times.length).toBeGreaterThan(5);
    for (const t of times) expect(t).toMatch(/^"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"$/);
  });
});

describe('notices in the body (Simplify 5)', () => {
  it('adds a node\'s notices to prepare, write and state answers', async () => {
    const p = (await http('POST', `${api}/v1/prepare/offer`, offerInput())).body as Prepared & { notices?: string[] };
    expect(p.notices).toBeUndefined(); // the sim nodes have nothing to say
    const w = await http('POST', `${noticing.url}${p.submit.path}`, (await sign(p, acct('seller-1').privateKey)).submit.body);
    expect([w.body.escrowState, w.body.notices]).toEqual(['Offered', ['notice for write']]);
    expect((await http('GET', `${noticing.url}/v1/commitments/${p.commitmentId}`)).body.notices).toEqual(['notice for state']);
    expect((await http('GET', `${api}/v1/commitments/${p.commitmentId}`)).body.notices).toBeUndefined();
    const af = (await http('POST', `${noticing.url}/v1/prepare/agree-and-fund`, { commitmentId: p.commitmentId, agreeNonce: nonce(), fundingNonce: nonce() })).body;
    expect(af.notices).toEqual(['notice for prepare']);
  });
});

describe('the write budget (C4, ADR-0024 §1)', () => {
  it('charges a signer only once the settlement layer verified its signature; a forger spends its own client budget', async () => {
    const handle = fetchHandler(throttled.operator);
    const post = (client: string, path: string, body: unknown, key = `t030-c4-${++keys}`) =>
      handle(new Request(`http://op.invalid${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }), client);
    const prep = async () => (await http('POST', `${api}/v1/prepare/offer`, offerInput('buyer-2', 'seller-2'))).body as Prepared;
    // Mallory signs offers naming seller-2 with her own key: refused, and her client runs out after two.
    const forged = async () => (await sign(await prep(), testAccount('mallory').privateKey, true)).submit.body;
    const first = await post('mallory', '/v1/commitments', await forged());
    expect([first.status, await first.text()]).toEqual([401, expect.stringContaining('invalid_signature')]);
    expect((await post('mallory', '/v1/commitments', await forged())).status).toBe(401);
    expect((await post('mallory', '/v1/commitments', await forged())).status).toBe(429);
    // seller-2's own budget is untouched: two verified writes from two clients, then the third is refused.
    const genuine = async () => (await sign(await prep(), acct('seller-2').privateKey)).submit.body;
    expect((await post('seller-a', '/v1/commitments', await genuine())).status).toBe(200);
    expect((await post('seller-b', '/v1/commitments', await genuine())).status).toBe(200);
    const third = await post('seller-c', '/v1/commitments', await genuine());
    expect([third.status, ((await third.json()) as J).retryAfterSec]).toEqual([429, expect.any(Number)]);
  });

  it('holds under a concurrent burst: a client is counted at entry, and a signer overshoots only within its clients\' budgets (PR 85 review)', async () => {
    const handle = fetchHandler(throttled.operator);
    const post = (client: string, body: unknown) =>
      handle(new Request('http://op.invalid/v1/commitments', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `t030-burst-${++keys}` }, body: JSON.stringify(body) }), client);
    const statuses = async (rs: Promise<Response>[]) => (await Promise.all(rs)).map((r) => r.status).sort();
    const offers = async (n: number, seller: string, buyer: string, key = acct(seller).privateKey, forge = false) =>
      Promise.all(Array.from({ length: n }, async () => (await sign((await http('POST', `${api}/v1/prepare/offer`, offerInput(buyer, seller))).body as Prepared, key, forge)).submit.body));
    // Twenty forged writes at once from one client with a budget of two: two reach the settlement layer.
    const forged = await offers(20, 'seller-1', 'buyer-1', testAccount('burst-mallory').privateKey, true);
    expect(await statuses(forged.map((b) => post('burst-mallory', b)))).toEqual([...Array(2).fill(401), ...Array(18).fill(429)]);
    // Ten genuine writes at once by one signer from one client: the client's budget holds.
    const one = await offers(10, 'seller-1', 'buyer-1');
    expect(await statuses(one.map((b) => post('burst-one', b)))).toEqual([...Array(2).fill(200), ...Array(8).fill(429)]);
    // Ten genuine writes at once by another signer from ten clients: each client spends one of its own two, the
    // signer is then over its budget, and its next write is refused from any client.
    const many = await offers(11, 'buyer-1', 'buyer-2');
    expect(await statuses(many.slice(0, 10).map((b, i) => post(`burst-${i}`, b)))).toEqual(Array(10).fill(200));
    expect((await post('burst-fresh', many[10])).status).toBe(429);
  });
});
