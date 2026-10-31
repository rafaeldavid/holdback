// End to end over HTTP: prepare -> sign (viem, the agent's own key) -> submit, against a sim world (SimChain,
// two operators, three test adjudicators with fake judges). The operator signs no party message.
import { readFileSync } from 'node:fs';
import { holdbackDomain, termsDigest, type CommitmentTerms, type DeterministicCheck, type Hex32 } from '@holdback/core';
import { seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { hashTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prepared } from './prepare.js';
import { startSimWorld, type SimInfo, type SimWorld } from './sim-world.js';

let world: SimWorld;
let api: string;
let info: SimInfo;

beforeAll(async () => {
  world = await startSimWorld({ accounts: ['buyer-1', 'seller-1', 'buyer-2', 'seller-2'], env: {}, onError: () => {} });
  info = world.info;
  api = info.operators[1]!; // the second node, to show any node serves the whole flow
});
afterAll(() => world.close());

const acct = (label: string) => info.accounts.find((a) => a.label === label)!;
const slate = () => ({ primary: info.adjudicators[0]!.address, fallback: info.adjudicators[1]!.address, appeal: info.adjudicators[2]!.address });
const checks: DeterministicCheck[] = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 2, max: 10 },
];
const CSV = 'id,email\n1,ada@example.com\n2,alan@example.com\n';

let calls = 0;
async function call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'idempotency-key': `t-${++calls}` };
  const res = await fetch(`${api}${path}`, { method, headers, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as T };
}

function ints(types: Record<string, Array<{ name: string; type: string }>>, type: string, v: unknown): unknown {
  if (type.endsWith('[]')) return (v as unknown[]).map((x) => ints(types, type.slice(0, -2), x));
  if (types[type]) return Object.fromEntries(types[type]!.map((f) => [f.name, ints(types, f.type, (v as Record<string, unknown>)[f.name])]));
  return /^u?int\d*$/.test(type) ? BigInt(v as string) : v;
}

/** What an agent does: check the digest, sign its slots with its own key. */
async function sign(p: Prepared, label: string): Promise<Prepared> {
  const account = privateKeyToAccount(acct(label).privateKey);
  for (const s of p.sign.filter((x) => x.signer.toLowerCase() === account.address.toLowerCase())) {
    const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) } as Parameters<typeof hashTypedData>[0];
    expect(hashTypedData(typed)).toBe(s.digest);
    const path = s.slot.split('.');
    const parent = path.slice(0, -1).reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p.submit.body);
    parent[path.at(-1)!] = await account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
  }
  return p;
}
const submit = async (p: Prepared) => call('POST', p.submit.path, p.submit.body);

async function waitFor(id: Hex32, states: string[]): Promise<{ escrowState: string; appealState: string }> {
  for (let i = 0; i < 200; i++) {
    const s = (await call('GET', `/v1/commitments/${id}`)).body;
    if (states.includes(s.escrowState)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${id} never reached ${states.join('|')}`);
}

// Same inputs, same default nonce, same commitment: each deal here passes its own nonce to be distinct.
let deals = 0;
const offerInput = (buyer: string, seller: string, price = '25000000') => ({
  nonce: `0x${(++deals).toString(16).padStart(64, '0')}`,
  template: 'checks-only',
  clubId: info.clubId,
  seller: acct(seller).address,
  buyer: { address: acct(buyer).address, encryptionPublicKey: acct(buyer).encryptionPublicKey },
  adjudicators: slate(),
  price: { token: 'tUSD', amount: price },
  deliverable: { kind: 'dataset', description: 'Two customers.', format: 'text/csv' },
  checks,
});

async function heldDeal(buyer: string, seller: string, price?: string): Promise<Hex32> {
  const offer = (await call<Prepared>('POST', '/v1/prepare/offer', offerInput(buyer, seller, price))).body;
  expect((await submit(await sign(offer, seller))).body.escrowState).toBe('Offered');
  await waitFor(offer.commitmentId, ['AcceptedByAdjudicator']);
  const af = (await call<Prepared>('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.commitmentId })).body;
  expect((await submit(await sign(af, buyer))).body.escrowState).toBe('Held');
  return offer.commitmentId;
}

async function deliver(id: Hex32, seller: string, text: string) {
  const sealed = await seal(new TextEncoder().encode(text));
  const stored = (await call('POST', '/v1/ciphertext', sealed.ciphertext)).body;
  const { recipients } = (await call('GET', `/v1/commitments/${id}/recipients`)).body;
  const encryptedKeys = wrapKeyForRecipients(sealed.key, recipients.map((r: { address: string; encryptionPublicKey: string }) => ({ recipient: r.address, publicKey: r.encryptionPublicKey })));
  const p = (await call<Prepared>('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: stored.bytes }, plaintextSha256: sealed.plaintextSha256, encryptedKeys })).body;
  return submit(await sign(p, seller));
}

describe('operator API: prepare, sign, submit', () => {
  it('serves its discovery document at /.well-known/holdback.json', async () => {
    const res = await fetch(`${api}/.well-known/holdback.json`);
    const doc = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(doc.apiBaseUrl).toBe(`${api}/v1`);
    expect(doc.domain.chainId).toBe('31337');
    expect(doc.settlement).toEqual({ kind: 'sim' });
    expect(doc.receiptSigner).toMatch(/^0x/);
  });

  it('prepares offer typed data that is deterministic, matches core, and fills hashes from the registration', async () => {
    const input: Record<string, unknown> = offerInput('buyer-1', 'seller-1');
    delete input['nonce'];
    const a = (await call<Prepared>('POST', '/v1/prepare/offer', { ...input, createdAt: '2026-11-01T09:00:00Z' })).body;
    const b = (await call<Prepared>('POST', '/v1/prepare/offer', { ...input, createdAt: '2026-11-01T09:00:00Z' })).body;
    expect(a.sign[0]!.digest).toBe(b.sign[0]!.digest);
    expect((a.defaults as { nonce: string }).nonce).toMatch(/^0x[0-9a-f]{64}$/);
    const body = a.submit.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const terms = { ...body };
    delete terms['id'];
    delete terms['signatures'];
    expect(termsDigest(holdbackDomain(31337), terms as unknown as CommitmentTerms)).toBe(a.sign[0]!.digest);
    const reg = (await call('GET', `/v1/adjudicators/${slate().primary}`)).body;
    expect(body.adjudication.policyHash).toBe(reg.policyHash);
    expect(body.adjudication.registryHash).toBe(reg.registry.hash);
    expect(body.adjudication.fee).toEqual({ token: 'tUSD', amount: '1000000' });
    expect(Object.keys(a.sign[0]!.typedData.types).sort()).toEqual(['Adjudication', 'CommitmentTerms', 'Disclosure', 'EIP712Domain', 'Remedy', 'Settlement', 'Timing', 'TokenAmount']);
    expect(a.check.join(' ')).toMatch(/fee is kept on a refund/);
  });

  it('docs/api.md\'s agree-and-fund example has the shape the API takes and answers', async () => {
    const doc = readFileSync(new URL('../../../docs/api.md', import.meta.url), 'utf8');
    const section = doc.slice(doc.indexOf('## Example: agree and fund'), doc.indexOf('## SDK'));
    const [request, response] = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    const offer = (await call<Prepared>('POST', '/v1/prepare/offer', offerInput('buyer-1', 'seller-1'))).body;
    await submit(await sign(offer, 'seller-1'));
    await waitFor(offer.commitmentId, ['AcceptedByAdjudicator']);
    const af = await sign((await call<Prepared>('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.commitmentId })).body, 'buyer-1');
    const body = af.submit.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Object.keys(request!).sort()).toEqual(Object.keys(body).sort());
    expect(Object.keys(request!['fund']).sort()).toEqual(Object.keys(body['fund']).sort());
    expect(af.submit.path).toBe(`/v1/commitments/${offer.commitmentId}/agree`);
    const live = (await submit(af)).body;
    expect(live.escrowState).toBe(response!['escrowState']);
    for (const k of Object.keys(response!)) expect(live, k).toHaveProperty(k);
    expect(Object.keys(response!['receipt']).sort()).toEqual(Object.keys(live.receipt).sort());
  });

  it('settles a deal end to end: offer, agree and fund, encrypted delivery, release, buyer key', async () => {
    const before = (await call('GET', `/v1/balances/${acct('buyer-1').address}`)).body.amount;
    const id = await heldDeal('buyer-1', 'seller-1');
    const missing = await call('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: { uri: 'x', sha256: 'sha256:00', bytes: 1 }, plaintextSha256: 'sha256:00', encryptedKeys: [] });
    expect(missing.status).toBe(400);
    expect(missing.body.detail).toMatch(/no envelope for/);
    expect((await deliver(id, 'seller-1', CSV)).body.escrowState).toBe('Delivered');
    expect((await waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    const keys = (await call('GET', `/v1/commitments/${id}/key?recipient=${acct('buyer-1').address}`)).body.items;
    expect(keys).toHaveLength(1);
    expect(BigInt((await call('GET', `/v1/balances/${acct('buyer-1').address}`)).body.amount)).toBe(BigInt(before) - 26_000_000n);
    const record = (await call('GET', `/v1/commitments/${id}/judgment`)).body;
    expect(record.panel.ran).toBe(false);
  });

  it('refunds the price but not the fee when the checks fail', async () => {
    const before = BigInt((await call('GET', `/v1/balances/${acct('buyer-2').address}`)).body.amount);
    const id = await heldDeal('buyer-2', 'seller-2');
    await deliver(id, 'seller-2', 'id,email\n');
    expect((await waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Refunded');
    expect(BigInt((await call('GET', `/v1/balances/${acct('buyer-2').address}`)).body.amount)).toBe(before - 1_000_000n);
    const appeal = (await call<Prepared>('POST', '/v1/prepare/appeal', { commitmentId: id, appellant: acct('seller-2').address })).body;
    expect(appeal.check.join(' ')).toMatch(/bond of 1\.25 tUSD .* fee of 25 tUSD, 26\.25 tUSD in all/);
    await submit(await sign(appeal, 'seller-2'));
    expect((await waitFor(id, ['Refunded'])).appealState).not.toBe('none');
  });

  it('settles by agreement: both parties sign the same typed data', async () => {
    const id = await heldDeal('buyer-2', 'seller-2', '10000000');
    const p = (await call<Prepared>('POST', '/v1/prepare/settlement', { commitmentId: id, toSellerBps: 3000 })).body;
    expect(p.sign.map((s) => s.slot)).toEqual(['buyerSignature', 'sellerSignature']);
    await sign(await sign(p, 'buyer-2'), 'seller-2');
    expect((await submit(p)).body.escrowState).toBe('Settled');
  });

  it('stores ciphertext content-addressed under an Idempotency-Key and serves it back', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const put = await call('POST', '/v1/ciphertext', bytes);
    const got = new Uint8Array(await (await fetch(put.body.uri as string)).arrayBuffer());
    expect(got).toEqual(bytes);
    const noKey = await fetch(`${api}/v1/ciphertext`, { method: 'POST', body: bytes });
    expect(noKey.status).toBe(400);
  });

  it('answers unknown prepare kinds and bad inputs with problems', async () => {
    expect((await call('POST', '/v1/prepare/nope', {})).status).toBe(404);
    const r = await call('POST', '/v1/prepare/offer', { ...offerInput('buyer-1', 'seller-1'), price: { token: 'tUSD', amount: '25.5' } });
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(/6 decimals/);
  });
});
