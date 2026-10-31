// neutrality.operator-lies-in-prepare: an operator that edits a prepared message, even consistently (typed data,
// digest and body together), gets no signature. Operator proposes, agent verifies (docs/team.md, Rules and
// checks). The snap runner drives SimChain directly and has no prepare step, so this is a test, not a fixture.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { hashTypedData } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { Refusal, verifyPrepared, type Intent } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let world: SimWorld;
let honest: string[];
let seller: Agent;
let buyer: Agent;
let liar: Server;
let liarUrl: string;
/** What the lying operator rewrites, by path pattern. */
let lie: ((path: string, body: J) => J) | null = null;

const keys = new Map<Agent, { privateKey: `0x${string}`; enc: Uint8Array }>();
const fresh = async () => {
  const a = (await (await fetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
  const agent = new Agent(honest, a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url'));
  keys.set(agent, { privateKey: a.privateKey, enc: Buffer.from(a.encryptionSecretKey, 'base64url') });
  return agent;
};

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  honest = [...world.info.operators];
  // A proxy in front of operator 1 that can rewrite any JSON answer.
  liar = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await fetch(`${honest[0]}${req.url}`, { method: req.method!, headers: { 'content-type': req.headers['content-type'] ?? 'application/json', ...(req.headers['idempotency-key'] ? { 'idempotency-key': String(req.headers['idempotency-key']) } : {}) }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const text = await r.text();
    let out = text;
    try {
      if (lie) out = JSON.stringify(lie(req.url!, JSON.parse(text)));
    } catch {
      out = text;
    }
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(out);
  });
  await new Promise<void>((r) => liar.listen(0, '127.0.0.1', r));
  liarUrl = `http://127.0.0.1:${(liar.address() as AddressInfo).port}`;
  seller = await fresh();
  buyer = await fresh();
});
afterAll(async () => {
  await new Promise<void>((r) => liar.close(() => r()));
  await world.close();
});

const slate = () => ({ primary: world.info.adjudicators[0]!.address, fallback: world.info.adjudicators[1]!.address, appeal: world.info.adjudicators[2]!.address });
let deals = 0;
const request = () => ({
  template: 'checks-only',
  clubId: world.info.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
  adjudicators: slate(),
  price: { token: 'tUSD', amount: '25000000' },
  deliverable: { kind: 'dataset', description: `rows, deal ${++deals}`, format: 'text/csv' }, // distinct deals, distinct terms
  checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }],
});
const ints = (types: J, type: string, v: J): J =>
  type.endsWith('[]') ? v.map((x: J) => ints(types, type.slice(0, -2), x)) : types[type] ? Object.fromEntries(types[type].map((x: J) => [x.name, ints(types, x.type, v?.[x.name])])) : /^u?int\d*$/.test(type) ? BigInt(v) : v;
/** A consistent lie: after editing, the digest is recomputed from the edited typed data. */
const redigest = (p: J): J => {
  for (const s of p.sign) {
    const types = { ...s.typedData.types };
    delete types.EIP712Domain;
    try {
      s.digest = hashTypedData({ ...s.typedData, types, message: ints(types, s.typedData.primaryType, s.typedData.message) });
    } catch {
      // An edit viem cannot even hash (a primary type with no definition) keeps the old digest.
    }
  }
  return p;
};
const offerIntent = async (req: J): Promise<Intent> => ({ kind: 'offer', request: req, registration: await seller.registration(req.adjudicators.primary), rulebookHash: await seller.rulebookHash(req.clubId) });

describe('neutrality.operator-lies-in-prepare', () => {
  it('signs an honest offer, and refuses every edited copy of it', async () => {
    const req = request();
    const honestOffer = await seller.call('POST', '/v1/prepare/offer', req);
    const intent = await offerIntent(req);
    expect(verifyPrepared(honestOffer, intent, seller.address).toSign).toHaveLength(1);
    const dead = '0x000000000000000000000000000000000000dead';
    const beef = '0x000000000000000000000000000000000000beef';
    const edits: Array<[string, (p: J) => void]> = [
      ['buyer', (p) => { p.sign[0].typedData.message.buyer = dead; p.submit.body.buyer = dead; }],
      ['buyer, typed data only', (p) => { p.sign[0].typedData.message.buyer = dead; }],
      ['buyer, body only', (p) => { p.submit.body.buyer = dead; }],
      ['price', (p) => { p.sign[0].typedData.message.price.amount = '9000000000'; p.submit.body.price.amount = '9000000000'; }],
      ['fee', (p) => { p.sign[0].typedData.message.adjudication.fee.amount = '9000000'; p.submit.body.adjudication.fee.amount = '9000000'; }],
      ['primary adjudicator', (p) => { p.sign[0].typedData.message.adjudication.adjudicator = beef; p.submit.body.adjudication.adjudicator = beef; }],
      ['domain.chainId', (p) => { p.sign[0].typedData.domain.chainId = 1; }],
      ['domain.verifyingContract', (p) => { p.sign[0].typedData.domain.verifyingContract = '0x1111111111111111111111111111111111111111'; }],
      ['extra signature slot', (p) => { p.sign.push({ ...p.sign[0], slot: 'signatures.buyer' }); }],
      ['primaryType', (p) => { p.sign[0].typedData.primaryType = 'Agree'; }],
      ['types', (p) => { p.sign[0].typedData.types.TokenAmount.reverse(); }],
      ['buyerEncryptionPublicKey', (p) => { p.sign[0].typedData.message.buyerEncryptionPublicKey = 'pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk'; p.submit.body.buyerEncryptionPublicKey = 'pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk'; }],
      ['deliverable (acceptanceHash and deliverableHash)', (p) => { p.submit.body.deliverable.description = 'anything'; p.sign[0].typedData.message.deliverableHash = `0x${'ab'.repeat(32)}`; }],
      ['checks', (p) => { p.submit.body.acceptance.deterministicChecks = []; }],
      ['token', (p) => { p.sign[0].typedData.message.price.token = 'USDC'; p.submit.body.price.token = 'USDC'; }],
      ['deadline', (p) => { p.submit.body.timing.deliverBy = '2030-01-01T00:00:00Z'; }],
      ['nonce not hex', (p) => { p.submit.body.nonce = 'nope'; }],
      ['createdAt far away', (p) => { p.submit.body.createdAt = '2020-01-01T00:00:00Z'; }],
      ['submit path', (p) => { p.submit.path = '/v1/commitments/0x00/agree'; }],
    ];
    for (const [name, edit] of edits) {
      const p = structuredClone(honestOffer);
      edit(p);
      redigest(p);
      expect(() => verifyPrepared(p, intent, seller.address), name).toThrow(Refusal);
    }
  });

  it('refuses agree-and-fund edits: value, payer, commitment, and terms that are not the buyer\'s', async () => {
    const offer = await seller.offer(request());
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    const prepared = await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id });
    const intent: Intent = { kind: 'agree-and-fund', terms: offer.terms, me: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, maxTotal: 26_000_000n };
    expect(verifyPrepared(prepared, intent, buyer.address).toSign).toHaveLength(2);
    for (const edit of [
      (p: J) => { p.sign[1].typedData.message.value = '99000000'; p.submit.body.fund.value = '99000000'; },
      (p: J) => { p.sign[1].typedData.message.from = seller.address; p.submit.body.fund.from = seller.address; },
      (p: J) => { p.sign[0].typedData.message.commitmentId = `0x${'cd'.repeat(32)}`; p.submit.body.commitmentId = `0x${'cd'.repeat(32)}`; },
      (p: J) => { p.sign[1].typedData.message.validBefore = '9999999999'; },
    ]) {
      const p = structuredClone(prepared);
      edit(p);
      expect(() => verifyPrepared(redigest(p), intent, buyer.address)).toThrow(Refusal);
    }
    expect(() => verifyPrepared(prepared, { ...intent, maxTotal: 25_000_000n }, buyer.address)).toThrow(/exceeds your limit/);
    expect(() => verifyPrepared(prepared, { ...intent, encryptionPublicKey: seller.encryptionPublicKey }, buyer.address)).toThrow(/key you do not hold/);
    // The honest message, signed from the agent's own typed data, is accepted by the settlement layer.
    expect((await buyer.signAndSubmit(prepared, intent)).escrowState).toBe('Held');
  });

  it('refuses a settlement whose payouts or key release differ from what was agreed', async () => {
    const offer = await seller.offer({ ...request(), price: { token: 'tUSD', amount: '10000000' } });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    await buyer.signAndSubmit(await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id }), { kind: 'agree-and-fund', terms: offer.terms, me: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, maxTotal: 11_000_000n });
    const p = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: offer.id, toSellerBps: 3000 });
    const payouts = [{ to: seller.address, amount: { token: 'tUSD', amount: '3000000' } }, { to: buyer.address, amount: { token: 'tUSD', amount: '7000000' } }];
    const intent: Intent = { kind: 'settlement', terms: offer.terms, payouts, releaseKey: false, deliveryHash: null };
    expect(verifyPrepared(p, intent, buyer.address).toSign.map((s) => s.slot)).toEqual(['buyerSignature']);
    const worse = structuredClone(p);
    worse.submit.body.payouts[0].amount.amount = '9000000';
    worse.submit.body.payouts[1].amount.amount = '1000000';
    expect(() => verifyPrepared(worse, intent, buyer.address)).toThrow(/payouts/);
    expect(() => verifyPrepared(p, { ...intent, releaseKey: true }, buyer.address)).toThrow(Refusal);
  });

  it('a seller never seals the key to a recipient or key an operator substitutes', async () => {
    const offer = await seller.offer(request());
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    await buyer.signAndSubmit(await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id }), { kind: 'agree-and-fund', terms: offer.terms, me: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, maxTotal: 26_000_000n });
    const operatorKey = 'pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk';
    // The same seller, relaying through the lying operator first and reading the honest one as its second source.
    const liarSeller = new Agent([liarUrl, honest[1]!], keys.get(seller)!.privateKey, keys.get(seller)!.enc);
    // 1. /recipients swaps the buyer's key for the operator's own.
    lie = (path, body) => (path.endsWith('/recipients') ? { ...body, recipients: body.recipients.map((r: J) => (r.role === 'buyer' ? { ...r, encryptionPublicKey: operatorKey } : r)) } : body);
    await expect(liarSeller.deliver(offer.terms, new TextEncoder().encode('a\n1\n'))).rejects.toThrow(/do not seal/);
    // 2. The operator's registration gives an adjudicator its own key: the second operator disagrees.
    lie = (path, body) => (path.startsWith('/v1/adjudicators/') ? { ...body, encryptionPublicKey: operatorKey } : body);
    await expect(liarSeller.deliver(offer.terms, new TextEncoder().encode('a\n1\n'))).rejects.toThrow(/operators disagree/);
    lie = null;
    expect((await liarSeller.deliver(offer.terms, new TextEncoder().encode('a\n1\n'))).escrowState).toBe('Delivered');
  });
});
