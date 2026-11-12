// T-333: the deal record, on SimChain through startSimWorld. A Released, a Refunded and a reclaimed deal each give a
// record whose every check the running party can run passes, and whose other checks say why they could not run. An
// operator that serves another answer is named, not merged. The program only reads, only from configured operators.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import type { Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { dealRecord, lateWorkLine, lateWorkOf, type DealRecord } from './deal-record.ts';
import { deliveryHashOf, freshNonce, type Intent } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PRICE = { token: 'tUSD', amount: '25000000' };
const FEE = '1000000';
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
const GOOD = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';
const BAD = 'name\nada\n';
const DELIVER_WITHIN_SEC = 120;
const MONEY = /^(0|[1-9][0-9]*)$/;

let world: SimWorld;
const dirs: string[] = [];
const realFetch = globalThis.fetch;
/** Every request any code in this process sent while `watching` is on, with its method. */
const sent: Array<{ method: string; url: string }> = [];
let watching = false;

beforeAll(async () => {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (watching) sent.push({ method: init?.method ?? 'GET', url: input instanceof Request ? input.url : String(input) });
    return realFetch(input, init);
  };
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await world.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Deal = { id: Hex; terms: J; buyer: Agent; buyerKey: string; seller: Agent; delivery: J | null; plaintext: string | null };
let n = 0;
/** One funded deal: the seller delivers `work` and keeps its signed delivery body, or delivers nothing (null). */
async function deal(work: string | null): Promise<Deal> {
  const account = async () => (await (await realFetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
  const s = await account(), b = await account();
  const seller = new Agent([...world.info.operators], s.privateKey, Buffer.from(s.encryptionSecretKey, 'base64url'));
  const buyer = new Agent([...world.info.operators], b.privateKey, Buffer.from(b.encryptionSecretKey, 'base64url'));
  const a = world.info.adjudicators;
  const offer = await seller.offer({
    template: 'checks-only', clubId: world.info.clubId, seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address },
    price: PRICE, deliverable: { kind: 'dataset', description: `customers, deal ${++n}`, format: 'text/csv' }, checks: CHECKS,
    timing: { offerExpiresInSec: 60, fundWithinSec: 90, deliverWithinSec: DELIVER_WITHIN_SEC },
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(offer.terms, 10n ** 12n);
  let delivery: J | null = null;
  if (work !== null) delivery = (await seller.deliverAndShare(offer.terms, new TextEncoder().encode(work))).delivery;
  else {
    await buyer.waitFor(offer.id, ['Held']);
    world.advance(DELIVER_WITHIN_SEC + 1);
    await buyer.call('POST', `/v1/commitments/${offer.id}/triggers/reclaim`, {});
  }
  await buyer.waitFor(offer.id, ['Released', 'Refunded']);
  // T-358: with an appeal window of 0 (phase one's default) the operator closes the appeal window right after the
  // decision; the record is of a final deal, so wait for it.
  for (let i = 0; i < 100 && !(await buyer.call('GET', `/v1/commitments/${offer.id}`)).finalAt; i++) await new Promise((r) => setTimeout(r, 100));
  return { id: offer.id, terms: offer.terms, buyer, buyerKey: b.encryptionSecretKey, seller, delivery, plaintext: work };
}

/** The checks by name: ok true, false, or null with why. */
const checks = (r: DealRecord) => Object.fromEntries(r.checks.map((c) => [c.check, c.ok]));
const failed = (r: DealRecord) => r.checks.filter((c) => c.ok === false);
/** Every value under a key named amount, anywhere in the record. */
const amounts = (v: J): J[] => (Array.isArray(v) ? v.flatMap(amounts) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => (k === 'amount' && (x === null || typeof x !== 'object') ? [x] : amounts(x))) : []);

/** The checks every party can run on every finished deal on SimChain, with two operators answering. */
const ALWAYS = ['all operators answered', 'domain is pinned', 'commitment ID', "seller's terms signature", 'termsHash in events', 'event hashes', 'operator receipts', 'hold is price plus fee', 'operator fee', 'postings conserve the hold', 'postings follow the outcome'];
const JUDGED = ['judgment recordHash', "adjudicator's record signature", 'judgment names the delivery', 'ciphertext sha256'];

describe('deal-record.ts writes one verified record of a finished deal (T-333)', () => {
  let released: Deal, refunded: Deal, reclaimed: Deal;
  beforeAll(async () => {
    released = await deal(GOOD);
    refunded = await deal(BAD);
    reclaimed = await deal(null);
  }, 60_000);

  it('a Released deal: the buyer with its own key verifies every field, the plaintext included', async () => {
    const r = await dealRecord(released.id, { operators: [...world.info.operators], party: 'buyer', encryptionSecretKey: released.buyerKey });
    expect(failed(r)).toEqual([]);
    const c = checks(r);
    for (const name of [...ALWAYS, ...JUDGED, 'plaintext sha256']) expect(c[name], name).toBe(true);
    // Without the signed delivery body the delivery hash cannot be recomputed, and the record says so.
    expect(r.checks.find((x) => x.check === 'delivery hash')).toMatchObject({ ok: null, why: expect.stringContaining('delivery body') });
    expect(r.disagreements).toEqual([]);
    expect(r.outcome).toMatchObject({ escrowState: 'Released', reclaimed: false });
    expect(r.terms.commitmentId).toBe(released.id);
    expect(r.terms.signatures.seller.signer).toBe(released.seller.address);
    expect(r.judgment).toMatchObject({ outcome: 'accept', decision: 'accept', deterministic: [{ checkId: 'cols', passed: true }], panel: { ran: false } });
    expect(r.settlement.postings).toEqual([
      { to: released.seller.address, amount: PRICE, why: 'price to the seller' },
      { to: world.info.adjudicators[0]!.address, amount: { token: 'tUSD', amount: FEE }, why: expect.any(String) },
    ]);
    // The last step, `appeal.expired`, is SimChain only: this world runs the full protocol, whose appeal window closes (ADR-0031 §8).
    expect(r.steps.map((s) => s.step)).toEqual(['commitment.offered', 'adjudicator.accepted', 'commitment.agreed', 'hold.funded', 'delivery.submitted', 'key.released', 'judgment.decided', 'settlement.released', 'key.released', 'appeal.expired']);
    expect(r.row).toMatchObject({ commitmentId: released.id, buyer: released.buyer.address, seller: released.seller.address, price: PRICE, adjudicationFee: { token: 'tUSD', amount: FEE }, operatorFee: { token: 'tUSD', amount: '0' }, outcome: 'Released', panelDecision: 'accept', transactions: [] });
    for (const at of ['offeredAt', 'agreedAt', 'fundedAt', 'deliveredAt', 'decidedAt', 'settledAt']) expect(r.row[at as keyof typeof r.row], at).toMatch(/^\d{4}-\d\d-\d\dT/);
    // The record holds no secret and no work.
    const text = JSON.stringify(r);
    expect(text).not.toContain(released.buyerKey);
    expect(text).not.toContain('ada@example.com');
    for (const a of amounts(r)) expect(a).toMatch(MONEY);
  });

  it("a Released deal: the seller, with its signed delivery body, recomputes the delivery hash and recovers its own signature", async () => {
    const r = await dealRecord(released.id, { operators: [...world.info.operators], party: 'seller', delivery: released.delivery });
    expect(failed(r)).toEqual([]);
    const c = checks(r);
    for (const name of [...ALWAYS, ...JUDGED, 'delivery hash', "seller's delivery signature"]) expect(c[name], name).toBe(true);
    expect(r.checks.find((x) => x.check === 'plaintext sha256')).toMatchObject({ ok: null, why: expect.stringContaining('buyer') });
    expect(r.delivery).toMatchObject({ attempt: 1, deliveryHash: expect.stringMatching(/^0x[0-9a-f]{64}$/), signer: released.seller.address });
  });

  it('a Refunded deal: the failed check, the decision and the refund, with the plaintext marked not released', async () => {
    const r = await dealRecord(refunded.id, { operators: [...world.info.operators], party: 'buyer', encryptionSecretKey: refunded.buyerKey });
    expect(failed(r)).toEqual([]);
    const c = checks(r);
    for (const name of [...ALWAYS, ...JUDGED]) expect(c[name], name).toBe(true);
    expect(r.checks.find((x) => x.check === 'plaintext sha256')).toMatchObject({ ok: null, why: expect.stringContaining('not released') });
    expect(r.outcome).toMatchObject({ escrowState: 'Refunded', reclaimed: false });
    expect(r.judgment).toMatchObject({ outcome: 'reject', decision: 'reject', deterministic: [{ checkId: 'cols', passed: false, detail: expect.stringContaining('expected') }] });
    expect(r.settlement.postings[0]).toEqual({ to: refunded.buyer.address, amount: PRICE, why: 'price back to the buyer' });
    expect(r.row).toMatchObject({ outcome: 'Refunded', panelDecision: 'reject' });
  });

  it('a reclaimed deal: reclaimed, no judgment, price and fee back to the buyer', async () => {
    const r = await dealRecord(reclaimed.id, { operators: [...world.info.operators], party: 'buyer', encryptionSecretKey: reclaimed.buyerKey });
    expect(failed(r)).toEqual([]);
    const c = checks(r);
    for (const name of ALWAYS) expect(c[name], name).toBe(true);
    for (const name of JUDGED) expect(c[name], name).toBeUndefined();
    expect(r.outcome).toMatchObject({ escrowState: 'Refunded', reclaimed: true });
    expect(r.judgment).toBeNull();
    expect(r.delivery).toBeNull();
    expect(r.settlement.postings).toEqual([{ to: reclaimed.buyer.address, amount: { token: 'tUSD', amount: '26000000' }, why: expect.any(String) }]);
    expect(r.row).toMatchObject({ outcome: 'Refunded', reclaimed: true, panelDecision: null, deliveredAt: null, decidedAt: null });
  });

  it('sends GET requests only, and only to configured operators, even when an operator records the ciphertext elsewhere', async () => {
    const liar = await proxy(world.info.operators[1]!, { ciphertextUri: 'http://127.0.0.2:9/v1/ciphertext/x' });
    try {
      sent.length = 0;
      watching = true;
      const r = await dealRecord(released.id, { operators: [world.info.operators[0]!, liar.url], party: 'buyer', encryptionSecretKey: released.buyerKey });
      watching = false;
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.filter((s) => s.method !== 'GET')).toEqual([]);
      const origins = new Set([new URL(world.info.operators[0]!).origin, new URL(liar.url).origin]);
      expect(sent.filter((s) => !origins.has(new URL(s.url).origin))).toEqual([]);
      // The rewritten URI is a difference between the operators, named; the hashes still verify from a configured operator.
      expect(r.disagreements.map((d) => d.section)).toContain('delivery');
      expect(r.checks.filter((x) => x.check === 'ciphertext sha256').every((x) => x.ok === true)).toBe(true);
    } finally {
      watching = false;
      await liar.close();
    }
  });

  it('names an operator that serves another state, and keeps that section per operator', async () => {
    const liar = await proxy(world.info.operators[1]!, { state: 'Released' });
    try {
      const r = await dealRecord(refunded.id, { operators: [world.info.operators[0]!, liar.url], party: 'buyer' });
      const d = r.disagreements.find((x) => x.section === 'outcome');
      expect(d?.operators.sort()).toEqual([world.info.operators[0]!, liar.url].sort());
      expect((r.outcome as J).byOperator[liar.url].escrowState).toBe('Released');
      expect((r.outcome as J).byOperator[world.info.operators[0]!].escrowState).toBe('Refunded');
      expect(r.row.outcome).toBeNull();
    } finally {
      await liar.close();
    }
  });

  it('fails the commitment ID check for the operator that serves tampered terms, and names it', async () => {
    const liar = await proxy(world.info.operators[1]!, { tamperPrice: '1' });
    try {
      const r = await dealRecord(released.id, { operators: [world.info.operators[0]!, liar.url], party: 'seller' });
      expect(r.checks.filter((x) => x.ok === false).map((x) => [x.check, x.operator])).toEqual(expect.arrayContaining([['commitment ID', liar.url]]));
      expect(r.checks.find((x) => x.check === 'commitment ID' && x.operator === world.info.operators[0])?.ok).toBe(true);
      expect(r.disagreements.map((x) => x.section)).toContain('terms');
    } finally {
      await liar.close();
    }
  });

  it('marks an operator that does not answer, and writes the record from the others', async () => {
    const r = await dealRecord(released.id, { operators: [world.info.operators[0]!, 'http://127.0.0.1:9'], party: 'seller' });
    expect(r.checks.find((x) => x.check === 'all operators answered')).toMatchObject({ ok: false, why: expect.stringContaining('127.0.0.1:9') });
    expect(r.operators.find((o) => o.api === 'http://127.0.0.1:9')?.answered).toBe(false);
    expect(r.outcome).toMatchObject({ escrowState: 'Released' });
  });

  it('runs as a command: writes the record to a file, reads the key from the environment and never writes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deal-record-'));
    dirs.push(dir);
    const out = join(dir, 'record.json');
    const script = join(import.meta.dirname, 'deal-record.ts');
    const env = { ...process.env, HOLDBACK_OPERATORS: world.info.operators.join(','), HOLDBACK_ENCRYPTION_KEY: released.buyerKey };
    const code = await new Promise<number>((resolve) => spawn(process.execPath, [script, released.id, '--as', 'buyer', '--out', out], { env, stdio: 'ignore' }).on('exit', (c) => resolve(c ?? 1)));
    expect(code).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(text).not.toContain(released.buyerKey);
    const r = JSON.parse(text) as DealRecord;
    expect(failed(r)).toEqual([]);
    expect(checks(r)['plaintext sha256']).toBe(true);
  });
});

/** A proxy in front of one operator that rewrites some answers: the escrow state, the terms' price, a ciphertext URI. */
async function proxy(target: string, lie: { state?: string; tamperPrice?: string; ciphertextUri?: string }): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = req.url ?? '/';
    const up = await realFetch(`${target}${path}`, { method: req.method! });
    let text = Buffer.from(await up.arrayBuffer()).toString();
    if (up.ok && (up.headers.get('content-type') ?? '').includes('json')) {
      const body = JSON.parse(text);
      if (lie.state && /^\/v1\/commitments\/0x[0-9a-f]{64}$/.test(path)) body.escrowState = lie.state;
      if (lie.tamperPrice && /\/terms$/.test(path)) body.price.amount = lie.tamperPrice;
      if (lie.ciphertextUri && /\/events/.test(path)) for (const e of body.items) if (e.type === 'delivery.submitted') e.payload.ciphertext.uri = lie.ciphertextUri;
      text = JSON.stringify(body);
    }
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' }).end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

describe('deal-record.ts shows late work accepted by a mutual settlement (SC-5b)', () => {
  // The event log as T-378's route writes it (rafaeldavid/holdback#408): no delivery.submitted, a settlement that
  // released the key, then the key released by "mutual settlement". Newest last here, as the record sorts by seq.
  const buyer = `0x${'b1'.repeat(20)}`, hash = `0x${'de'.repeat(32)}`;
  const log = (over: { delivered?: boolean; keyReleased?: boolean } = {}) => [
    { seq: 1, type: 'commitment.offered', payload: {} },
    { seq: 4, type: 'hold.funded', payload: {} },
    ...(over.delivered ? [{ seq: 5, type: 'delivery.submitted', payload: {} }] : []),
    { seq: 6, type: 'commitment.settled', payload: { payouts: [], keyReleased: over.keyReleased ?? true } },
    ...((over.keyReleased ?? true) ? [{ seq: 7, type: 'key.released', payload: { recipient: buyer, envelope: {}, path: 'mutual settlement' } }] : []),
  ];

  it('names late work in one line, with the delivery hash from the party\'s own signed settlement, since no event carries it', () => {
    const late = lateWorkOf(log(), { commitmentId: `0x${'11'.repeat(32)}`, deliveryHash: hash.toUpperCase().replace('0X', '0x') });
    expect(late).toEqual({ deliveryHash: hash, keyReleasedTo: buyer });
    expect(lateWorkLine(late!)).toBe(`The work was delivered late and accepted by a mutual settlement, which released its key to ${buyer}; delivery hash ${hash}.`);
    expect(lateWorkLine(lateWorkOf(log())!)).toMatch(/; delivery hash not confirmed \(pass your signed settlement and the delivery: --settlement <file> --delivery <file>\)\.$/);
  });

  it('does not call a settlement late work when a delivery was posted, or when it released no key', () => {
    expect(lateWorkOf(log({ delivered: true }))).toBeNull();
    expect(lateWorkOf(log({ keyReleased: false }))).toBeNull();
    // A key released before the settlement is another path's, not this one.
    expect(lateWorkOf([{ seq: 2, type: 'key.released', payload: { path: 'mutual settlement', recipient: buyer } }, { seq: 6, type: 'commitment.settled', payload: { keyReleased: true } }])).toBeNull();
  });

  it('on a deal that settled late work, binds the party\'s settlement and delivery to it, and names no hash for a signed draft that never settled', async () => {
    const account = async () => (await (await realFetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
    const s = await account(), b = await account();
    const seller = new Agent([...world.info.operators], s.privateKey, Buffer.from(s.encryptionSecretKey, 'base64url'));
    const buyer = new Agent([...world.info.operators], b.privateKey, Buffer.from(b.encryptionSecretKey, 'base64url'));
    const a = world.info.adjudicators;
    const offer = await seller.offer({
      template: 'checks-only', clubId: world.info.clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address }, price: PRICE, deliverable: { kind: 'dataset', description: `customers, late ${++n}`, format: 'text/csv' }, checks: CHECKS,
      timing: { offerExpiresInSec: 60, fundWithinSec: 90, deliverWithinSec: DELIVER_WITHIN_SEC },
    });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    await buyer.agreeAndFund(offer.terms, 10n ** 12n);
    await buyer.waitFor(offer.id, ['Held']);
    // Two signed deliveries the seller never posts: the late work, and another one for a draft that never settles.
    const unposted = async (work: string) => {
      const { prepared, intent } = await seller.prepareDelivery(offer.terms, new TextEncoder().encode(work));
      return (await seller.sign(prepared, intent)).body;
    };
    const late = await unposted(GOOD), other = await unposted(`${GOOD}3,grace@example.com\n`);
    const settle = async (delivery: J) => {
      const nonce = freshNonce();
      const p = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: offer.id, nonce, toSellerBps: 7000, delivery });
      const intent: Intent = { kind: 'settlement', terms: offer.terms, payouts: p.submit.body.payouts, releaseKey: true, deliveryHash: deliveryHashOf(delivery), nonce, delivery };
      const mine = await buyer.sign(p, intent), theirs = await seller.sign(p, intent);
      return { ...mine.body, sellerSignature: theirs.body.sellerSignature, path: mine.path };
    };
    const draft = await settle(other); // signed by both, never submitted
    const real = await settle(late);
    const { path, ...body } = real;
    expect((await buyer.call('POST', path, body)).escrowState).toBe('Settled');
    const record = (settlement: J, delivery: J) => dealRecord(offer.id, { operators: [...world.info.operators], party: 'buyer', settlement, delivery });
    const good = await record(body, late);
    expect(checks(good)).toMatchObject({ 'late work: the settlement is the one that settled': true, 'late work: settlement names the delivery': true });
    expect(good.row.lateWork).toBe(true);
    expect((good.outcome as J).lateWork).toEqual({ deliveryHash: deliveryHashOf(late).toLowerCase(), keyReleasedTo: buyer.address });
    // A signed draft for another delivery passes the signatures and payouts, and fails on the released envelope.
    const { path: _p, ...draftBody } = draft; // eslint-disable-line @typescript-eslint/no-unused-vars
    const forged = await record(draftBody, other);
    expect(checks(forged)).toMatchObject({ 'late work: the settlement is the one that settled': true, 'late work: settlement names the delivery': false });
    expect((forged.outcome as J).lateWork).toEqual({ deliveryHash: null, keyReleasedTo: buyer.address });
    // Changed payouts, or no settlement at all.
    const changed = await record({ ...body, payouts: [...body.payouts].reverse() }, late);
    expect(checks(changed)['late work: the settlement is the one that settled']).toBe(false);
    expect(checks(await record(null, late))['late work: the settlement is the one that settled']).toBeNull();
  }, 60_000);
});
