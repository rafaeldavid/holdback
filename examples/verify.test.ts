// neutrality.operator-lies-in-prepare: an operator that edits a prepared message, even consistently (typed data,
// digest and body together), gets no signature. Operator proposes, agent verifies (docs/team.md, Rules and
// checks). The snap runner drives SimChain directly and has no prepare step, so this is a test, not a fixture.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startSimWorld, typesFor, type SimWorld } from '@holdback/operator';
import nacl from 'tweetnacl';
import { hashTypedData, hexToBytes, keccak256, toBytes, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { appealBondOf, checkPaymentFile, commitmentIdOf, ERC3009_TYPES, freshNonce, fundingNonceOf, openOwnEnvelope, Refusal, SIMCHAIN_DOMAIN, typedDataFile, TYPES, verifyPrepared, type ChainPin, type Intent } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** A lying operator's own x25519 public key, derived at test time from a public label (no key literal in source). */
const OPERATOR_PUBLIC_KEY = Buffer.from(nacl.box.keyPair.fromSecretKey(hexToBytes(keccak256(toBytes('holdback/test/lying-operator')))).publicKey).toString('base64url');
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
  disclosure: 'public',
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

describe('neutrality.operator-lies-in-prepare', () => {
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
      ['buyerEncryptionPublicKey', both(0, 'buyerEncryptionPublicKey', OPERATOR_PUBLIC_KEY)],
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

  it('offer: the money addresses come from the agent\'s own request; a prepared offer that substitutes either is refused (ADR-0033 §6)', async () => {
    const payout = '0x00000000000000000000000000000000000000a1', payment = '0x00000000000000000000000000000000000000b2', attacker = '0x000000000000000000000000000000000000dead';
    // Without the inputs, each money address is its party's signing address, and the honest prepared offer verifies.
    const plainReq = request();
    const plain = await seller.call('POST', '/v1/prepare/offer', plainReq);
    const plainIntent = await offerIntent(plainReq);
    expect(verify(plain, plainIntent, seller.address).body).toMatchObject({ buyerPaymentAddress: buyer.address, sellerPayoutAddress: seller.address });
    refusesEach(plain, plainIntent, seller.address, [
      ['attack.prepare-substitutes-payout-address', both(0, 'sellerPayoutAddress', attacker)],
      ['attack.prepare-substitutes-payment-address', both(0, 'buyerPaymentAddress', attacker)],
    ]);
    // With the inputs, the agent's own terms carry them: an operator that leaves them out or changes them is refused.
    const req = request({ sellerPayoutAddress: payout, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: payment } });
    const intent = await offerIntent(req);
    const prepared = await seller.call('POST', '/v1/prepare/offer', req);
    const asked = { ...structuredClone(prepared) };
    both(0, 'sellerPayoutAddress', payout)(asked);
    both(0, 'buyerPaymentAddress', payment)(asked);
    asked.submit.body.id = commitmentIdOf((({ id: _i, signatures: _s, ...t }) => t)(asked.submit.body)); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(verify(redigest(asked), intent, seller.address).body).toMatchObject({ buyerPaymentAddress: payment, sellerPayoutAddress: payout });
    refusesEach(asked, intent, seller.address, [
      ['payout address back to the signing address', both(0, 'sellerPayoutAddress', seller.address)],
      ['payout address to the attacker', both(0, 'sellerPayoutAddress', attacker)],
      ['payment address to the attacker', both(0, 'buyerPaymentAddress', attacker)],
    ]);
    // A malformed address in the agent's own request stops it before anything is compared.
    expect(() => verify(prepared, { ...(intent as Extract<Intent, { kind: 'offer' }>), request: { ...req, sellerPayoutAddress: '0x12' } }, seller.address)).toThrow(/sellerPayoutAddress must be an address/);
  });

  it('offerDirect: a public offer built by the agent itself, with no prepare call, names the money addresses it asked for and is accepted by the operators', async () => {
    const payout = '0x00000000000000000000000000000000000000a1';
    const offer = await seller.offerDirect(request({ sellerPayoutAddress: payout }));
    expect(offer.terms).toMatchObject({ seller: seller.address, sellerPayoutAddress: payout, buyerPaymentAddress: buyer.address });
    expect(offer.state.escrowState).toBe('Offered');
    for (const api of honest) expect(((await (await fetch(`${api}/v1/commitments/${offer.id}`)).json()) as J).escrowState).toMatch(/Offered|AcceptedByAdjudicator/);
  });

  it('agree-and-fund: refuses terms whose payment address is not the buyer\'s own (ADR-0033 §6)', async () => {
    const other = '0x00000000000000000000000000000000000000c3';
    const offer = await seller.offerDirect(request({ buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: other } }));
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    const nonces = { agreeNonce: freshNonce(), fundingNonce: freshNonce() };
    const prepared = await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id, ...nonces });
    const intent: Intent = { kind: 'agree-and-fund', terms: offer.terms, me: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, maxTotal: 26_000_000n, ...nonces };
    expect(() => verify(prepared, intent, buyer.address)).toThrow(`refusing to sign: the terms name ${other} as the payment address, not your ${buyer.address}`);
    // Named as the buyer's own payment address, the funding and fee slots are the payment address's to sign, not this agent's.
    const mine = verify(prepared, { ...intent, paymentAddress: other }, buyer.address);
    expect(mine.toSign.map((s) => s.slot)).toEqual(['signature']);
    expect(prepared.sign.map((s: J) => [s.slot, s.signer.toLowerCase()])).toEqual([['signature', buyer.address], ['fund.signature', other]]);
    await expect(buyer.agreeAndFund(offer.terms, 26_000_000n)).rejects.toThrow(/that address signs the funding and the operator fee, not this agent/);
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
    // T-025: the price agreed by mail, and optionally the whole terms' hash, bind even within maxTotal.
    expect(verify(prepared, { ...intent, expectedPrice: { token: 'tUSD', amount: '25000000' }, expectedCommitmentId: offer.id }, buyer.address).toSign).toHaveLength(2);
    expect(() => verify(prepared, { ...intent, expectedPrice: { token: 'tUSD', amount: '24000000' } }, buyer.address)).toThrow(/price 25000000 tUSD is not the 24000000 tUSD you agreed/);
    expect(() => verify(prepared, { ...intent, expectedPrice: { token: 'USDC', amount: '25000000' } }, buyer.address)).toThrow(/not the 25000000 USDC you agreed/);
    expect(() => verify(prepared, { ...intent, expectedCommitmentId: `0x${'cd'.repeat(32)}` }, buyer.address)).toThrow(/terms you were sent are not the ones you expected/);
    // Money rule: a decimal string of base units, nothing looser (a float, leading zeros, a number, an exponent).
    for (const amount of ['25.0', '025000000', 25000000, '2.5e7', ' 25000000', '']) {
      expect(() => verify(prepared, { ...intent, expectedPrice: { token: 'tUSD', amount } as J }, buyer.address), String(amount)).toThrow(/decimal string/);
    }
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

  it('early accept: refuses another buyer, attempt, delivery, nonce or a far expiry', async () => {
    const { id, terms } = await held();
    await silence('primary', true); // keep the deal in Delivered so the buyer can accept early
    try {
      const { delivery } = await seller.deliverAndShare(terms, new TextEncoder().encode('a\n1\n'));
      const nonce = freshNonce();
      const prepared = await buyer.call('POST', '/v1/prepare/early-accept', { commitmentId: id, nonce });
      const opened = await openOwnEnvelope(await buyer.envelopeMaterial(terms, delivery)); // T-024, D32: open before accepting
      const intent: Intent = { kind: 'early-accept', terms, nonce, deliveryHash: opened.deliveryHash };
      expect(verify(prepared, intent, buyer.address).toSign).toHaveLength(1);
      refusesEach(prepared, intent, buyer.address, [
        ['buyer', both(0, 'buyer', seller.address)],
        ['attempt', both(0, 'attempt', 2)],
        // ADR-0029: an accept prepared for a delivery the buyer did not open.
        ['deliveryHash', both(0, 'deliveryHash', `0x${'4b'.repeat(32)}`)],
        ['nonce', both(0, 'nonce', freshNonce())],
        ['expiry two days out', (p) => { p.submit.body.expiresAt = new Date(now() + 2 * 86_400_000).toISOString(); }],
      ]);
      expect((await buyer.signAndSubmit(prepared, intent)).escrowState).toBe('Released');
    } finally {
      await silence('primary', false);
    }
  });

  it('appeal: the bond is exactly the rulebook rate of the price, never what the operator asks', async () => {
    // The full protocol's party appeal (SimChain): the terms name an appeal window; the default is phase one's 0.
    const { id, terms } = await held({ timing: { appealWindowSec: 300 } });
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
    const operatorKey = OPERATOR_PUBLIC_KEY;
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

// ADR-0023: the buyer computes the operator fee itself from the schedule both operators publish, signs the third
// slot only for that amount, and refuses a fee above the schedule or to another address.
describe('operator fee: the agent checks the fee slot against the published schedule', () => {
  let feeWorld: SimWorld;
  const accountIn = async (w: SimWorld) => {
    const a = (await (await fetch(`${w.url}/accounts`, { method: 'POST' })).json()) as J;
    return new Agent([...w.info.operators], a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url'));
  };
  beforeAll(async () => {
    feeWorld = await startSimWorld({ env: {}, onError: () => {}, operatorFee: { bps: 1, min: '10000', max: null } });
  });
  afterAll(async () => feeWorld.close());

  it('pays the fee the schedule gives, and refuses a higher fee, another payee or a missing or extra slot', async () => {
    const [s, b] = [await accountIn(feeWorld), await accountIn(feeWorld)];
    const schedule = await b.trusted('/.well-known/holdback.json', (x) => x.fees.operator);
    expect(schedule).toMatchObject({ bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false });
    const slateOf = feeWorld.info.adjudicators.map((a) => a.address);
    const offer = await s.offer({ ...request(), seller: s.address, buyer: { address: b.address, encryptionPublicKey: b.encryptionPublicKey }, clubId: feeWorld.info.clubId, adjudicators: { primary: slateOf[0], fallback: slateOf[1], appeal: slateOf[2] } });
    await b.waitFor(offer.id, ['AcceptedByAdjudicator']);
    const nonces = { agreeNonce: freshNonce(), fundingNonce: freshNonce(), operatorFeeNonce: freshNonce() };
    const prepared = await b.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id, ...nonces });
    const fee = { schedule, nonce: nonces.operatorFeeNonce };
    const intent: Intent = { kind: 'agree-and-fund', terms: offer.terms, me: b.address, encryptionPublicKey: b.encryptionPublicKey, maxTotal: 27_000_000n, agreeNonce: nonces.agreeNonce, fundingNonce: nonces.fundingNonce, operatorFee: fee };
    const at = Date.parse(feeWorld.chain.now());
    const check = (p: J, i: Intent = intent) => verifyPrepared(p, i, b.address, SIMCHAIN_DOMAIN, at);
    expect(check(prepared).toSign.map((t) => t.slot)).toEqual(['signature', 'fund.signature', 'operatorFee.signature']);
    const edited = (edit: (q: J) => void) => {
      const q = structuredClone(prepared);
      edit(q);
      return redigest(q);
    };
    expect(() => check(edited((q) => { q.sign[2].typedData.message.value = '10001'; q.submit.body.operatorFee.value = '10001'; }))).toThrow(/above the schedule/);
    expect(() => check(edited((q) => { q.sign[2].typedData.message.to = s.address; q.submit.body.operatorFee.to = s.address; }))).toThrow(Refusal);
    expect(() => check(edited((q) => { q.sign.pop(); delete q.submit.body.operatorFee; }))).toThrow(Refusal);
    expect(() => check(prepared, { ...intent, operatorFee: undefined })).toThrow(/above the schedule/);
    expect(() => check(prepared, { ...intent, maxTotal: 26_000_000n })).toThrow(/exceeds your limit/);
    expect(() => check(prepared, { ...intent, operatorFee: { ...fee, schedule: { ...schedule, min: '5000000000' } } })).toThrow(Refusal);
    // The whole flow through Agent.agreeAndFund: it reads the schedule from both operators itself.
    const before = BigInt((await b.call('GET', `/v1/balances/${b.address}`)).amount);
    expect((await b.agreeAndFund(offer.terms, 27_000_000n)).escrowState).toBe('Held');
    expect(before - BigInt((await b.call('GET', `/v1/balances/${b.address}`)).amount)).toBe(26_010_000n);
    expect(feeWorld.chain.log().filter((e) => e.type === 'fee.operator')).toHaveLength(1);
  });
});

// ADR-0030: an adjudicator agent signs its acceptance, decision and registration from these types, and llms.txt
// publishes them from TYPES, so they must be core's, struct for struct.
describe('the holder of a payment address checks the funding file alone, from the terms and its own pinned deployment (ADR-0033 §3, §10)', () => {
  // A chain deployment pinned in the holder's own configuration. Addresses made up for the test: the check is pure.
  const at = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Hex;
  const chain: ChainPin = { tokenDomain: { name: 'Test USDC', version: '2', chainId: 11_155_111, verifyingContract: at(0x70) }, escrow: at(0xe5), collector: at(0xc0), rules: at(0x91), expiryMarginSec: 86_400 };
  const domain = { name: 'Holdback' as const, version: '0.8', chainId: 11_155_111, verifyingContract: at(0x91) };
  const payer = at(0xa1), buyerKey = at(0xb1);
  const terms: J = {
    schemaVersion: '0.8', clubId: 'demo-club', rulebookHash: `0x${'11'.repeat(32)}`, buyer: buyerKey, seller: at(0x51), buyerPaymentAddress: payer, sellerPayoutAddress: at(0x52),
    deliverable: { kind: 'dataset', description: 'rows', format: 'text/csv' }, acceptance: { deterministicChecks: [], rubric: { criteria: [], passThreshold: 0 } },
    price: { token: at(0x70), amount: '25000000' },
    adjudication: { adjudicator: at(0xd1), fallbackAdjudicator: at(0xd2), appealAdjudicator: at(0xd3), policyId: 'p', fee: { token: at(0x70), amount: '1000000' }, registryHash: `0x${'22'.repeat(32)}`, policyHash: `0x${'33'.repeat(32)}` },
    timing: { offerExpiresAt: '2026-11-12T10:15:00Z', fundBy: '2026-11-12T10:30:00Z', deliverBy: '2026-11-13T10:00:00Z', judgeBy: '2026-11-13T10:05:00Z', fallbackBy: '2026-11-13T10:10:00Z', appealWindowSec: 0, appealDecideSec: 300, maxSubmissions: 1 },
    settlement: { mode: 'guaranteed_on_decision', token: at(0x70) }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' }, buyerEncryptionPublicKey: 'k', nonce: `0x${'44'.repeat(32)}`, createdAt: '2026-11-12T10:00:00Z',
  };
  /** The funding file a prepare route would hand over, built from `t` on `c`: what the holder's wallet would be shown. */
  const fileFor = (t: J, c: ChainPin) => typedDataFile({
    domain: c.tokenDomain, types: { ReceiveWithAuthorization: ERC3009_TYPES.ReceiveWithAuthorization }, primaryType: 'ReceiveWithAuthorization',
    message: { from: t.buyerPaymentAddress, to: c.collector, value: 26_000_000n, validAfter: 0n, validBefore: BigInt(Date.parse(t.timing.fundBy) / 1000), nonce: fundingNonceOf(t, commitmentIdOf(t), c) },
  });
  const check = (file: J) => checkPaymentFile(file, terms, { kind: 'funding', domain, chain, buyer: buyerKey });

  it('passes the file the terms give, and says in one sentence who pays whom how much, until when, for which deal', () => {
    const r = check(fileFor(terms, chain));
    expect(r.summary).toBe(`${payer} pays 26000000 base units of ${at(0x70)} to ${at(0xc0)}, the escrow's collector, into the hold, valid until 2026-11-12T10:30:00Z, for deal ${commitmentIdOf(terms)} only.`);
  });

  it('refuses a nonce built with another operator, receiver, buyer, chain ID or margin', () => {
    const cases: Array<[string, J, ChainPin]> = [
      ['another operator (rules contract)', terms, { ...chain, rules: at(0x99) }],
      ['another receiver', { ...terms, sellerPayoutAddress: at(0x66) }, chain],
      ['another buyer', { ...terms, buyer: at(0xb2) }, chain],
      ['another chain ID', terms, { ...chain, tokenDomain: { ...chain.tokenDomain, chainId: 1 } }],
      ['another margin', terms, { ...chain, expiryMarginSec: 3600 }],
    ];
    for (const [name, t, c] of cases) {
      const file = fileFor(t, c);
      if (name === 'another chain ID') file.domain.chainId = chain.tokenDomain.chainId; // a wallet prompt that looks right
      expect(() => check(file), name).toThrow(/^refusing to sign: the message's nonce 0x[0-9a-f]{64} is not the 0x[0-9a-f]{64} these terms give on your pinned deployment/);
    }
  });

  it('refuses another payer, another amount, another collector or another token domain, and terms that name another signing key', () => {
    const edit = (f: (x: J) => void) => {
      const file = fileFor(terms, chain);
      f(file);
      return file;
    };
    expect(() => check(edit((x) => (x.message.from = at(0xbad))))).toThrow(/pays from 0x0{37}bad, not the payment address/);
    expect(() => check(edit((x) => (x.message.value = '99000000')))).toThrow(/pays 99000000 base units, not the 26000000 the terms hold/);
    expect(() => check(edit((x) => (x.message.to = at(0xbad))))).toThrow(/is not the message these terms give on your pinned settlement layer/);
    expect(() => check(edit((x) => (x.domain.verifyingContract = at(0xbad))))).toThrow(/is not the message these terms give/);
    expect(() => checkPaymentFile(fileFor(terms, chain), terms, { kind: 'funding', domain, chain, buyer: at(0xb2) })).toThrow(/the terms name 0x0{38}b1 as the buyer's signing key, not the 0x0{38}b2 you expect/);
  });

  it('on SimChain, passes the funding file the signer writes and refuses one for another deal', async () => {
    const payerAgent = await fresh();
    const offer = await seller.offerDirect(request({ buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: payerAgent.address } }));
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    const { slots } = await buyer.prepareAgreeAndFund(offer.terms, 100_000_000n, { paymentAddress: payerAgent.address });
    const file = typedDataFile(slots.find((s) => s.slot === 'fund.signature')!.typed);
    const opts = { kind: 'funding' as const, domain: SIMCHAIN_DOMAIN, buyer: buyer.address };
    expect(checkPaymentFile(file, offer.terms, opts).summary).toMatch(new RegExp(`^${payerAgent.address} pays 26000000 base units of tUSD into the hold, valid until .*, for deal ${offer.id} only\\.$`));
    const other = structuredClone(file);
    other.message.commitmentId = `0x${'cd'.repeat(32)}`;
    expect(() => checkPaymentFile(other, offer.terms, opts)).toThrow(/^refusing to sign: the message is for deal 0x(cd){32}, not /);
  });
});

describe('TYPES match the operator and core', () => {
  it.each(['AdjudicatorAcceptance', 'Decision', 'AdjudicatorRegistration', 'CommitmentTerms', 'Delivery', 'Appeal', 'MutualSettlement', 'Delegation'])('%s and every struct it uses', (primary) => {
    const { EIP712Domain: _domain, ...core } = typesFor(primary);
    void _domain;
    expect(Object.fromEntries(Object.keys(core).map((k) => [k, (TYPES as J)[k]]))).toEqual(core);
  });
});
