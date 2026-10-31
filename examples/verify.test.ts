// neutrality.operator-lies-in-prepare: an operator that edits a prepared message, even consistently (typed data,
// digest and body together), gets no signature. Operator proposes, agent verifies (docs/team.md, Rules and
// checks). The snap runner drives SimChain directly and has no prepare step, so this is a test, not a fixture.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { hashTypedData, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { appealBondOf, commitmentIdOf, freshNonce, Refusal, SIMCHAIN_DOMAIN, verifyPrepared, type Intent } from './verify.ts';

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

/** Settlement-layer time: the verifier's clock, never the wall clock. */
const now = () => Date.parse(world.chain.now());
const verify = (p: J, intent: Intent, me: string) => verifyPrepared(p, intent, me, SIMCHAIN_DOMAIN, now());
const slate = () => ({ primary: world.info.adjudicators[0]!.address, fallback: world.info.adjudicators[1]!.address, appeal: world.info.adjudicators[2]!.address });
const silence = (role: string, silent: boolean) => fetch(`${world.url}/adjudicators/${role}`, { method: 'POST', body: JSON.stringify({ silent }) });
let deals = 0;
const request = (over: J = {}) => ({
  nonce: freshNonce(),
  template: 'checks-only',
  clubId: world.info.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
  adjudicators: slate(),
  price: { token: 'tUSD', amount: '25000000' },
  deliverable: { kind: 'dataset', description: `rows, deal ${++deals}`, format: 'text/csv' },
  checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }],
  ...over,
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
/** Applies each edit to a copy, recomputes the digest, and expects a refusal. */
const refusesEach = (p: J, intent: Intent, me: string, edits: Array<[string, (q: J) => void]>) => {
  for (const [name, edit] of edits) {
    const q = structuredClone(p);
    edit(q);
    expect(() => verify(redigest(q), intent, me), name).toThrow(Refusal);
  }
};
/** Both sides of a field, in the typed data of slot i and in the body at `path`. */
const both = (i: number, field: string, value: J, path: string[] = [field]) => (q: J) => {
  q.sign[i].typedData.message[field] = value;
  path.slice(0, -1).reduce((o: J, k) => o[k], q.submit.body)[path.at(-1)!] = value;
};
const offerIntent = async (req: J): Promise<Intent> => ({ kind: 'offer', request: req, registration: await seller.registration(req.adjudicators.primary), rulebookHash: await seller.rulebookHash(req.clubId) });
/** An offer agreed and funded; the primary may be silenced first to keep the deal in Delivered later. */
async function held(over: J = {}): Promise<{ id: Hex; terms: J }> {
  const offer = await seller.offer(request(over));
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(offer.terms, 100_000_000n);
  return offer;
}

describe('neutrality.operator-lies-in-prepare', { timeout: 30_000 }, () => {
  it('offer: signs the honest one, refuses every edited copy', async () => {
    const req = request();
    const honestOffer = await seller.call('POST', '/v1/prepare/offer', req);
    const intent = await offerIntent(req);
    expect(verify(honestOffer, intent, seller.address).toSign).toHaveLength(1);
    const dead = '0x000000000000000000000000000000000000dead';
    const ahead = new Date(now() + 300_000).toISOString().replace('.000Z', 'Z');
    refusesEach(honestOffer, intent, seller.address, [
      ['buyer', both(0, 'buyer', dead)],
      ['buyer, typed data only', (p) => { p.sign[0].typedData.message.buyer = dead; }],
      ['buyer, body only', (p) => { p.submit.body.buyer = dead; }],
      ['price', (p) => { p.sign[0].typedData.message.price.amount = '9000000000'; p.submit.body.price.amount = '9000000000'; }],
      ['fee', (p) => { p.sign[0].typedData.message.adjudication.fee.amount = '9000000'; p.submit.body.adjudication.fee.amount = '9000000'; }],
      ['primary adjudicator', (p) => { p.sign[0].typedData.message.adjudication.adjudicator = '0x000000000000000000000000000000000000beef'; p.submit.body.adjudication.adjudicator = '0x000000000000000000000000000000000000beef'; }],
      ['domain.chainId', (p) => { p.sign[0].typedData.domain.chainId = 1; }],
      ['domain.verifyingContract', (p) => { p.sign[0].typedData.domain.verifyingContract = '0x1111111111111111111111111111111111111111'; }],
      ['extra signature slot', (p) => { p.sign.push({ ...p.sign[0], slot: 'signatures.buyer' }); }],
      ['primaryType', (p) => { p.sign[0].typedData.primaryType = 'Agree'; }],
      ['types', (p) => { p.sign[0].typedData.types.TokenAmount.reverse(); }],
      ['buyerEncryptionPublicKey', both(0, 'buyerEncryptionPublicKey', 'pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk')],
      ['deliverable', (p) => { p.submit.body.deliverable.description = 'anything'; p.sign[0].typedData.message.deliverableHash = `0x${'ab'.repeat(32)}`; }],
      ['checks', (p) => { p.submit.body.acceptance.deterministicChecks = []; }],
      ['token', (p) => { p.sign[0].typedData.message.price.token = 'USDC'; p.submit.body.price.token = 'USDC'; }],
      ['deadline', (p) => { p.submit.body.timing.deliverBy = '2030-01-01T00:00:00Z'; }],
      ['nonce the operator chose', both(0, 'nonce', freshNonce())],
      ['createdAt far away', (p) => { p.submit.body.createdAt = '2020-01-01T00:00:00Z'; }],
      ['createdAt 5 minutes ahead', (p) => { p.submit.body.createdAt = ahead; }],
      ['submit path', (p) => { p.submit.path = '/v1/commitments/0x00/agree'; }],
    ]);
    // An agent that sends no nonce of its own is told to pick one.
    const { nonce: _n, ...noNonce } = req; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(() => verify(honestOffer, { ...(intent as Extract<Intent, { kind: 'offer' }>), request: noNonce }, seller.address)).toThrow(/generate nonce yourself/);
  });

  it('offer: the default template, named or not, verifies; the server refuses it without a rubric', async () => {
    const rubric = { passThreshold: 300, criteria: [{ id: 'ok', description: 'Fine.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] };
    for (const req of [request({ template: 'default', checks: undefined, rubric }), (() => { const r: J = request({ rubric }); delete r.template; return r; })()]) {
      const p = await seller.call('POST', '/v1/prepare/offer', req);
      expect(verify(p, await offerIntent(req), seller.address).toSign).toHaveLength(1);
    }
    await expect(seller.call('POST', '/v1/prepare/offer', request({ template: 'default' }))).rejects.toThrow(/rubric/);
  });

  it('agree-and-fund: refuses edits, an operator-chosen or shared nonce, and terms that are not the buyer\'s', async () => {
    const offer = await seller.offer(request());
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    const nonces = { agreeNonce: freshNonce(), fundingNonce: freshNonce() };
    const prepared = await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id, ...nonces });
    const intent: Intent = { kind: 'agree-and-fund', terms: offer.terms, me: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, maxTotal: 26_000_000n, ...nonces };
    expect(verify(prepared, intent, buyer.address).toSign).toHaveLength(2);
    refusesEach(prepared, intent, buyer.address, [
      ['value', (p) => { p.sign[1].typedData.message.value = '99000000'; p.submit.body.fund.value = '99000000'; }],
      ['payer', (p) => { p.sign[1].typedData.message.from = seller.address; p.submit.body.fund.from = seller.address; }],
      ['commitment', both(0, 'commitmentId', `0x${'cd'.repeat(32)}`)],
      ['validBefore', (p) => { p.sign[1].typedData.message.validBefore = '9999999999'; }],
      ['one nonce for both', (p) => { p.sign[1].typedData.message.nonce = nonces.agreeNonce; p.submit.body.fund.nonce = nonces.agreeNonce; }],
    ]);
    expect(() => verify(prepared, { ...intent, fundingNonce: nonces.agreeNonce }, buyer.address)).toThrow(/must differ/);
    expect(() => verify(prepared, { ...intent, maxTotal: 25_000_000n }, buyer.address)).toThrow(/exceeds your limit/);
    expect(() => verify(prepared, { ...intent, encryptionPublicKey: seller.encryptionPublicKey }, buyer.address)).toThrow(/key you do not hold/);
    // The honest message, signed from the agent's own typed data, is accepted by the settlement layer.
    expect((await buyer.signAndSubmit(prepared, intent)).escrowState).toBe('Held');
  });

  it('delivery: refuses a different pointer, hash, envelope, format or time', async () => {
    const { terms } = await held();
    const { prepared, intent } = await seller.prepareDelivery(terms, new TextEncoder().encode('a\n1\n'));
    expect(verify(prepared, intent, seller.address).toSign).toHaveLength(1);
    refusesEach(prepared, intent, seller.address, [
      ['ciphertext uri', (p) => { p.sign[0].typedData.message.ciphertext.uri = 'http://evil.invalid/x'; p.submit.body.ciphertext.uri = 'http://evil.invalid/x'; }],
      ['ciphertext sha256', (p) => { p.submit.body.ciphertext.sha256 = `sha256:${'0'.repeat(64)}`; }],
      ['plaintextSha256', both(0, 'plaintextSha256', `sha256:${'1'.repeat(64)}`)],
      ['an envelope', (p) => { p.submit.body.encryptedKeys[3].ciphertext = p.submit.body.encryptedKeys[0].ciphertext; }],
      ['envelope recipient', (p) => { p.submit.body.encryptedKeys[3].recipient = '0x000000000000000000000000000000000000dead'; }],
      ['plaintextMime', both(0, 'plaintextMime', 'application/json')],
      ['submittedAt far away', (p) => { p.submit.body.submittedAt = '2020-01-01T00:00:00Z'; }],
      ['attempt', both(0, 'attempt', 2)],
    ]);
    expect((await seller.signAndSubmit(prepared, intent)).escrowState).toBe('Delivered');
  });

  it('early accept: refuses another buyer, attempt, nonce or a far expiry', async () => {
    const { id, terms } = await held();
    await silence('primary', true); // keep the deal in Delivered so the buyer can accept early
    try {
      await seller.deliver(terms, new TextEncoder().encode('a\n1\n'));
      const nonce = freshNonce();
      const prepared = await buyer.call('POST', '/v1/prepare/early-accept', { commitmentId: id, nonce });
      const intent: Intent = { kind: 'early-accept', terms, nonce };
      expect(verify(prepared, intent, buyer.address).toSign).toHaveLength(1);
      refusesEach(prepared, intent, buyer.address, [
        ['buyer', both(0, 'buyer', seller.address)],
        ['attempt', both(0, 'attempt', 2)],
        ['nonce', both(0, 'nonce', freshNonce())],
        ['expiry two days out', (p) => { p.submit.body.expiresAt = new Date(now() + 2 * 86_400_000).toISOString(); }],
      ]);
      expect((await buyer.signAndSubmit(prepared, intent)).escrowState).toBe('Released');
    } finally {
      await silence('primary', false);
    }
  });

  it('appeal: the bond is exactly the rulebook rate of the price, never what the operator asks', async () => {
    const { id, terms } = await held();
    await seller.deliver(terms, new TextEncoder().encode('b\n2\n')); // wrong column: refunded
    await buyer.waitFor(id, ['Refunded']);
    const prepared = await seller.call('POST', '/v1/prepare/appeal', { commitmentId: id, appellant: seller.address });
    const { rulebook } = await seller.club(terms.clubId);
    const intent: Intent = { kind: 'appeal', terms, me: seller.address, appealBondRateBps: rulebook.appealBondRateBps };
    expect(verify(prepared, intent, seller.address).toSign).toHaveLength(1);
    expect(prepared.submit.body.bond.amount).toBe(appealBondOf(terms.price, rulebook.appealBondRateBps)); // 1.25 tUSD
    refusesEach(prepared, intent, seller.address, [
      ['a larger bond (the settlement layer would accept it)', (p) => { p.sign[0].typedData.message.bond.amount = '20000000'; p.submit.body.bond.amount = '20000000'; }],
      ['bond token', (p) => { p.sign[0].typedData.message.bond.token = 'USDC'; p.submit.body.bond.token = 'USDC'; }],
      ['appellant role', both(0, 'appellant', 'buyer')],
      ['appellant address', both(0, 'appellantAddress', buyer.address)],
      ['grounds', both(0, 'grounds', 'mislabeled-model')],
      ['filedAt far away', (p) => { p.submit.body.filedAt = '2020-01-01T00:00:00Z'; }],
    ]);
    expect((await seller.signAndSubmit(prepared, intent)).appealState).toBe('open');
  });

  it('settlement: refuses payouts, key release or a nonce other than agreed', async () => {
    const { id, terms } = await held({ price: { token: 'tUSD', amount: '10000000' } });
    const nonce = freshNonce();
    const p = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: id, toSellerBps: 3000, releaseKey: false, nonce });
    const payouts = [{ to: seller.address, amount: { token: 'tUSD', amount: '3000000' } }, { to: buyer.address, amount: { token: 'tUSD', amount: '7000000' } }];
    const intent: Intent = { kind: 'settlement', terms, payouts, releaseKey: false, deliveryHash: null, nonce };
    expect(verify(p, intent, buyer.address).toSign.map((s) => s.slot)).toEqual(['buyerSignature']);
    const worse = structuredClone(p);
    worse.submit.body.payouts[0].amount.amount = '9000000';
    worse.submit.body.payouts[1].amount.amount = '1000000';
    expect(() => verify(worse, intent, buyer.address)).toThrow(/payouts/);
    expect(() => verify(p, { ...intent, releaseKey: true }, buyer.address)).toThrow(Refusal);
    expect(() => verify(p, { ...intent, nonce: freshNonce() }, buyer.address)).toThrow(/nonce is not the one you sent/);
  });

  it('a seller never seals the key to a recipient or key an operator substitutes', async () => {
    const { terms } = await held();
    const operatorKey = 'pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk';
    // The same seller, relaying through the lying operator first and reading the honest one as its second source.
    const liarSeller = new Agent([liarUrl, honest[1]!], keys.get(seller)!.privateKey, keys.get(seller)!.enc);
    lie = (path, body) => (path.endsWith('/recipients') ? { ...body, recipients: body.recipients.map((r: J) => (r.role === 'buyer' ? { ...r, encryptionPublicKey: operatorKey } : r)) } : body);
    await expect(liarSeller.deliver(terms, new TextEncoder().encode('a\n1\n'))).rejects.toThrow(/do not seal/);
    lie = (path, body) => (path.startsWith('/v1/adjudicators/') ? { ...body, encryptionPublicKey: operatorKey } : body);
    await expect(liarSeller.deliver(terms, new TextEncoder().encode('a\n1\n'))).rejects.toThrow(/operators disagree/);
    lie = null;
    expect((await liarSeller.deliver(terms, new TextEncoder().encode('a\n1\n'))).escrowState).toBe('Delivered');
  });

  it('"two operators agree" needs two distinct origins: one node listed twice is one source', async () => {
    const twice = new Agent([honest[0]!, `${honest[0]}/`, honest[0]!.replace('127.0.0.1', '127.0.0.1')], keys.get(seller)!.privateKey, keys.get(seller)!.enc);
    expect(() => twice.sources()).toThrow(/distinct origins/);
    await expect(twice.registration(slate().primary)).rejects.toThrow(/distinct origins/);
    expect(seller.sources()).toHaveLength(2);
  });

  it('times are checked against settlement-layer time, so the sim walkthrough survives POST /advance', async () => {
    world.advance(3600);
    const req = request();
    const p = await seller.call('POST', '/v1/prepare/offer', req);
    const intent = await offerIntent(req);
    expect(Math.abs((await seller.settlementNow()) - now())).toBeLessThanOrEqual(1000);
    expect(verifyPrepared(p, intent, seller.address, SIMCHAIN_DOMAIN, await seller.settlementNow()).toSign).toHaveLength(1);
    // Against the wall clock, an hour behind, the same honest offer would be refused.
    expect(() => verifyPrepared(p, intent, seller.address, SIMCHAIN_DOMAIN, Date.now())).toThrow(/settlement time/);
    expect(commitmentIdOf((await seller.offer(request())).terms)).toMatch(/^0x/);
  });
});
