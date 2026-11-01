// T-207 stage 2a (ADR-0024, D34): a private deal over HTTP against a sim, with per-deal keys and Delegation
// certificates, ReadTokens, the client-side recipe, and two-key disclosure. Each `it` is named after ADR-0024's
// accepted fixture list where one applies. Canary strings are planted in both terms bodies and the work; the scans
// show where they appear.
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { hashTypedData, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { commitmentIdOf, freshNonce, jcsHash, privateOfferTerms, Refusal, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CANARY_D = 'CANARY-DELIVERABLE-q7Zx';
const CANARY_A = 'CANARY-ACCEPTANCE-m4Kp';
const CANARY_W = 'CANARY-WORK-t9Rb';
const CANARIES = [CANARY_D, CANARY_A, CANARY_W];
const PRICE = { token: 'tUSD', amount: '5000000' };

let world: SimWorld;
let buyerLT: Agent; // long-term keys
let sellerLT: Agent;
let outsider: Agent;
let primary: string, fallback: string, appeal: string;

/** Every string reachable from a value: objects, arrays, Maps, Sets and byte buffers (decoded as UTF-8). */
function strings(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v instanceof Uint8Array) out.push(Buffer.from(v).toString('utf8'));
  else if (v && typeof v === 'object' && !seen.has(v)) {
    seen.add(v);
    if (v instanceof Map)
      for (const [k, x] of v) {
        strings(k, out, seen);
        strings(x, out, seen);
      }
    else if (v instanceof Set) for (const x of v) strings(x, out, seen);
    else for (const k of Object.getOwnPropertyNames(v)) strings((v as Record<string, unknown>)[k], out, seen);
  }
  return out;
}
const leaks = (v: unknown, canaries = CANARIES) => canaries.filter((c) => strings(v).some((s) => s.includes(c)));

async function rawGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers });
  return { status: res.status, text: await res.text() };
}
/** The first chunks of the SSE stream /v1/events, read for `ms` then dropped. */
async function sse(api: string, ms = 400): Promise<string> {
  const ctl = new AbortController();
  const res = await fetch(`${api}/v1/events?from=0`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  let text = '';
  const stop = setTimeout(() => ctl.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('utf8');
    }
  } catch {
    // aborted
  }
  clearTimeout(stop);
  return text;
}

interface Deal {
  id: Hex;
  terms: J;
  keys: { deliverable: Uint8Array; acceptance: Uint8Array };
  buyer: Agent;
  seller: Agent;
  buyerDelegation: J;
  sellerDelegation: J;
}

/** The happy path, private by default: per-deal keys, the recipe, sealed bodies, early accept. */
async function privateDeal(level: 'private' | 'judgment' = 'private'): Promise<Deal> {
  const clubId = world.info.clubId;
  const { deal: buyer, delegation: buyerDelegation } = await buyerLT.dealKeys(clubId, 'buyer', PRICE);
  const { deal: seller, delegation: sellerDelegation } = await sellerLT.dealKeys(clubId, 'seller', PRICE);
  // The seller checks the buyer's certificate before sealing anything to its per-deal key.
  await sellerLT.checkDelegation(buyerDelegation, { dealKey: buyer.address, dealEncryptionKey: buyer.encryptionPublicKey, clubId, role: 'buyer', price: PRICE });
  const offer = await seller.offerPrivate({
    clubId,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: PRICE,
    deliverable: { kind: 'dataset', description: `customers.csv ${CANARY_D}`, format: 'text/csv', notes: `deliver by noon ${CANARY_D}` },
    acceptance: { deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', CANARY_A] }], rubric: { criteria: [], passThreshold: 0 } },
    level,
  });
  expect(offer.state.escrowState).toBe('Offered');
  // The buyer opens the terms from both operators with its ReadTokens, and checks the seller's certificate (D32).
  const opened = await buyer.openTerms(offer.id);
  expect(opened).toEqual(offer.terms);
  await buyerLT.checkDelegation(sellerDelegation, { dealKey: opened.seller, dealEncryptionKey: opened.deliverable.sellerEncryptionPublicKey, clubId, role: 'seller', price: opened.price });
  // Funding a per-deal key: here the test faucet; in practice your choice of source (residual 11).
  await buyer.call('POST', '/v1/test/faucet', { address: buyer.address, amount: '20000000' });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  const held = await buyer.agreeAndFund(opened, 10_000_000n);
  expect(held.escrowState).toBe('Held');
  const { delivery } = await seller.deliverAndShare(offer.terms, new TextEncoder().encode(`customer_id,${CANARY_A}\n1,${CANARY_W}\n`));
  const done = await buyer.earlyAccept(opened, delivery);
  expect(done.escrowState).toBe('Released');
  return { id: offer.id, terms: offer.terms, keys: offer.keys, buyer, seller, buyerDelegation, sellerDelegation };
}

let deal: Deal;

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  const acct = (l: string) => world.info.accounts.find((a) => a.label === l)!;
  const lt = (l: string) => new Agent(world.info.operators, acct(l).privateKey, Buffer.from(acct(l).encryptionSecretKey, 'base64url'));
  buyerLT = lt('buyer-1');
  sellerLT = lt('seller-1');
  outsider = lt('buyer-2');
  [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address) as [string, string, string];
  deal = await privateDeal();
}, 60_000);
afterAll(() => world.close());

describe('private deals over HTTP (ADR-0024, T-207 stage 2a)', () => {
  it('pseudonymous.certificate-checked-before-agree: per-deal keys settle, and a forged or mismatched certificate is refused', async () => {
    // The deal settled under per-deal keys that hold no mandate of their own.
    expect(deal.terms.buyer).toBe(deal.buyer.address);
    expect(deal.terms.buyer).not.toBe(buyerLT.address);
    expect(deal.terms.disclosure.level).toBe('private');
    // A certificate signed by the deal key itself, not the long-term agent, is refused.
    const { agent: _agent, signature: _sig, ...rest } = deal.sellerDelegation; // eslint-disable-line @typescript-eslint/no-unused-vars
    const selfSigned = { ...rest, agent: deal.seller.address, signature: await deal.seller.account.signTypedData(typedOf('Delegation', { ...rest, agent: deal.seller.address }, deal.seller.domain)) };
    const want = { dealKey: deal.terms.seller, dealEncryptionKey: deal.terms.deliverable.sellerEncryptionPublicKey, clubId: world.info.clubId, role: 'seller' as const, price: PRICE };
    // The deal key holds no mandate: the registry has no such agent.
    await expect(buyerLT.checkDelegation(selfSigned, want)).rejects.toThrow(/not_found|no mandate/);
    // A genuine certificate for another deal key is refused.
    await expect(buyerLT.checkDelegation(deal.sellerDelegation, { ...want, dealKey: deal.buyer.address })).rejects.toThrow(Refusal);
    // One for a price above its cap is refused.
    await expect(buyerLT.checkDelegation(deal.sellerDelegation, { ...want, price: { token: 'tUSD', amount: '5000001' } })).rejects.toThrow(/cap/);
  });

  it('attack.third-party-reads-private-deal: no canary in any unauthenticated read, the event stream or a receipt, at either operator', async () => {
    const id = deal.id;
    const routes = [
      `/v1/commitments/${id}`,
      `/v1/commitments/${id}/terms`,
      `/v1/commitments/${id}/events?limit=200`,
      `/v1/commitments/${id}/receipts?limit=200`,
      `/v1/commitments/${id}/recipients`,
      `/v1/commitments/${id}/judgment`,
      `/v1/commitments/${id}/key?recipient=${deal.terms.buyer}`,
      `/v1/commitments?party=${deal.terms.buyer}`,
      `/v1/commitments`,
      '/v1/status',
      '/.well-known/holdback.json',
    ];
    for (const api of world.info.operators) {
      for (const r of routes) {
        const got = await rawGet(`${api}${r}`);
        expect(leaks(got.text), `${api}${r}`).toEqual([]);
      }
      expect(leaks(await sse(api)), `${api}/v1/events`).toEqual([]);
      // The terms read is the settlement projection: per-deal parties, money, deadlines, hashes.
      const projection = JSON.parse((await rawGet(`${api}/v1/commitments/${id}/terms`)).text);
      expect(Object.keys(projection).sort()).toEqual(['adjudication', 'buyer', 'commitmentId', 'disclosure', 'hashes', 'price', 'seller', 'settlement', 'timing']);
      expect(projection.hashes.deliverableHash).toBeDefined();
      expect(JSON.stringify(projection)).not.toContain('privateTerms');
      // The judgment record of a private deal needs a token.
      expect((await rawGet(`${api}/v1/commitments/${id}/judgment`)).status).toBe(401);
    }
  });

  it('refuses a ReadToken from someone who is not a party: 401 unauthorized', async () => {
    const api = world.info.operators[0]!;
    const res = await rawGet(`${api}/v1/commitments/${deal.id}/terms`, { authorization: await outsider.readToken(deal.id, api) });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).type).toBe('unauthorized');
    expect(leaks(res.text)).toEqual([]);
  });

  it('error.read-token-audience: a token for one operator is refused at the other', async () => {
    const [op1, op2] = world.info.operators as [string, string];
    const token = await deal.buyer.readToken(deal.id, op1);
    expect((await rawGet(`${op1}/v1/commitments/${deal.id}/terms`, { authorization: token })).status).toBe(200);
    const replay = await rawGet(`${op2}/v1/commitments/${deal.id}/terms`, { authorization: token });
    expect(replay.status).toBe(401);
    expect(JSON.parse(replay.text).detail).toContain('not this one');
  });

  it('a party reads ciphertext only: the full sealed terms carry no plaintext either', async () => {
    const sealed = await deal.buyer.readPrivate(`/v1/commitments/${deal.id}/terms`, deal.id);
    expect(sealed.privateTerms.deliverable.envelopes.length).toBe(2);
    expect(leaks(sealed)).toEqual([]);
  });

  it('attack.operator-reads-private-deal: no canary in the operators\' state or logs, or the settlement log, and settlement still checks every signature', async () => {
    const logs: unknown[] = [];
    const scanned = [world.operators.map((o) => o.operator), world.chain, logs];
    expect(leaks(scanned)).toEqual([]);
    // The sealed offer is still verified by settlement: a wrong signature is refused.
    const sealed = await deal.buyer.readPrivate(`/v1/commitments/${deal.id}/terms`, deal.id);
    const { id: _id, signatures: _s, ...rest } = sealed; // eslint-disable-line @typescript-eslint/no-unused-vars
    const forged = { ...rest, nonce: freshNonce().toLowerCase() };
    const forgedId = commitmentIdOf({ ...deal.terms, nonce: forged.nonce });
    await expect(deal.seller.call('POST', '/v1/commitments', { ...forged, id: forgedId, signatures: { seller: sealed.signatures.seller } })).rejects.toThrow(/invalid_signature/);
  });

  it('publish.judgment-discloses-acceptance-only: two keys, so publishing the acceptance leaves the deliverable sealed', async () => {
    const d = await privateDeal();
    const outsiderView = async () => (await rawGet(`${world.info.operators[0]}/v1/commitments/${d.id}/terms`)).text;
    expect(leaks(await outsiderView())).toEqual([]);
    const m = { commitmentId: d.id, level: 'judgment' as const, nonce: freshNonce().toLowerCase() as Hex, expiresAt: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
    const publish = { type: 'Publish', ...m, buyerSignature: await d.buyer.signPublish(m), sellerSignature: await d.seller.signPublish(m) };
    const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64url');
    // At judgment the deliverable key is refused; the acceptance key is checked and served.
    await expect(d.seller.disclose(d.id, { publish, keys: { deliverableKey: b64(d.keys.deliverable) } })).rejects.toThrow(/judgment/);
    await expect(d.seller.disclose(d.id, { publish, keys: { acceptanceKey: b64(d.keys.deliverable) } })).rejects.toThrow(/invalid_terms/);
    await d.seller.disclose(d.id, { publish, keys: { acceptanceKey: b64(d.keys.acceptance) } });
    const view = JSON.parse(await outsiderView());
    expect(view.disclosure.level).toBe('judgment');
    expect(view.disclosed.acceptance).toEqual(d.terms.acceptance);
    expect(leaks(view)).toEqual([CANARY_A]);
    // The other operator serves the same once it has the keys; an uncosigned raise is refused.
    const lone = { ...publish, level: 'public', buyerSignature: publish.sellerSignature };
    await expect(d.seller.disclose(d.id, { publish: lone, keys: { deliverableKey: b64(d.keys.deliverable) } })).rejects.toThrow(/unauthorized|invalid_signature/);
    // Raising to public with both keys discloses the deliverable too.
    const m2 = { ...m, level: 'public' as const, nonce: freshNonce().toLowerCase() as Hex };
    const pub = { type: 'Publish', ...m2, buyerSignature: await d.buyer.signPublish(m2), sellerSignature: await d.seller.signPublish(m2) };
    await d.buyer.disclose(d.id, { publish: pub, keys: { deliverableKey: b64(d.keys.deliverable) } });
    const full = JSON.parse(await outsiderView());
    expect(full.disclosed.deliverable).toEqual(d.terms.deliverable);
    expect(leaks(full)).toEqual([CANARY_D, CANARY_A]);
  });

  it('the recipe: the agent builds the terms and typed data with no operator call, and the hash-only prepare agrees', async () => {
    const api = world.info.operators[0]!;
    const registration = await sellerLT.registration(primary);
    const input = {
      clubId: world.info.clubId,
      rulebookHash: await sellerLT.rulebookHash(world.info.clubId),
      seller: sellerLT.address,
      buyer: { address: buyerLT.address, encryptionPublicKey: buyerLT.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      registration,
      price: PRICE,
      deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
      acceptance: { deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }], rubric: { criteria: [], passThreshold: 0 } },
      sellerEncryptionPublicKey: sellerLT.encryptionPublicKey,
      createdAt: '2026-11-01T10:00:00Z',
      nonce: `0x${'5a'.repeat(32)}` as Hex,
      salts: { deliverable: `0x${'6b'.repeat(32)}` as Hex, acceptance: `0x${'7c'.repeat(32)}` as Hex },
    };
    const terms = privateOfferTerms(input);
    expect(privateOfferTerms(input)).toEqual(terms); // deterministic
    const id = commitmentIdOf(terms);
    const digest = hashTypedData(typedOf('CommitmentTerms', terms, sellerLT.domain));
    const prepared = await sellerLT.call('POST', '/v1/prepare/offer', {
      hashOnly: true,
      clubId: input.clubId,
      seller: input.seller,
      buyer: input.buyer,
      adjudicators: input.adjudicators,
      price: PRICE,
      disclosure: 'private',
      deliverableHash: jcsHash(terms.deliverable),
      acceptanceHash: jcsHash(terms.acceptance),
      createdAt: input.createdAt,
      nonce: input.nonce,
    }, api);
    expect(prepared.commitmentId).toBe(id);
    expect(prepared.sign[0].digest).toBe(digest);
    expect(JSON.stringify(prepared)).not.toContain('"deliverable":{');
  });
});
