// A deal that ends Settled (T-390): the buyer signer's watch takes a mutual settlement as final, and the buyer's
// command `resume` returns with its payouts, opening the work when the settlement released the key. On the public
// demo's own world served in this process on two origins, phase one (T-378 part 3). The seller is an Agent here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { honestVerdict, type JudgeProvider } from '@holdback/judgment';
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { makeKeys, type BuyerSigner, type Report } from './buyer-signer.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { deliveryHashOf, freshNonce, type Intent } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const PRICE = { token: 'tUSD', amount: '25000000' };
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
const RUBRIC = { passThreshold: 300, criteria: [{ id: 'ok', description: 'The rows are customers.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] };
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';
const TOTAL = '26010000'; // price 25, adjudication fee 1, operator fee 0.01 tUSD

/** The judges wait at this gate, so a rubric deal stays in judging after its delivery until a test opens it. */
let gate: { open(): void; wait: Promise<void> } = (() => {
  let open = () => {};
  const wait = new Promise<void>((r) => (open = r));
  return { open, wait };
})();
const judgeProvider: JudgeProvider = { complete: async (req) => (await gate.wait, honestVerdict(req, 'pass')) };

let demo: TwoOrigins;
let seller: Agent;
let quoteUrl: string;
let server: Server;
let rubric = false;
const offers = new Map<string, J>();
const stores: string[] = [];
beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 100, judgeProvider });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  seller = new Agent(demo.urls, generatePrivateKey(), nacl.randomBytes(32));
  await seller.call('POST', '/v1/faucet', { address: seller.address });
  const found = await seller.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  const role = (r: string): string => found.adjudicators.find((a: J) => a.role === r).address;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as J;
    const offer = await seller.offerDirect({
      template: rubric ? 'default' : 'checks-only', clubId: found.clubId, seller: seller.address, buyer: { address: body.buyer, encryptionPublicKey: body.buyerEncryptionPublicKey },
      adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') }, price: PRICE,
      deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' }, checks: CHECKS, ...(rubric ? { rubric: RUBRIC } : {}), timing: TIMING,
    });
    offers.set(offer.id, offer.terms);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commitmentId: offer.id, price: PRICE, fees: null, expiresAt: offer.terms.timing.offerExpiresAt }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  quoteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/quote`;
});
afterAll(async () => {
  gate.open();
  await new Promise<void>((r) => server.close(() => r()));
  server.closeAllConnections();
  await demo.close();
  for (const d of stores) rmSync(d, { recursive: true, force: true });
});

/** A funded deal: the buyer signer's keys, the terms, and the buyer's signing key as an Agent (to sign a settlement). */
async function funded(withRubric: boolean): Promise<{ signer: BuyerSigner; id: Hex; terms: J; buyer: Agent; store: string }> {
  rubric = withRubric;
  const store = mkdtempSync(join(tmpdir(), 't390-'));
  stores.push(store);
  const signer = await makeKeys(store, { operators: demo.urls, log: () => {} });
  const quote = await signer.quote(quoteUrl, 'rows');
  await signer.checkOffer(quote.commitmentId, await signer.readOffer(quote.commitmentId));
  await signer.testFunds(TOTAL);
  await signer.agreeAndFund(quote.commitmentId);
  const saved = JSON.parse(readFileSync(join(store, `${signer.address}.json`), 'utf8')) as J;
  const buyer = new Agent(demo.urls, saved.privateKey, new Uint8Array(Buffer.from(saved.encryptionSecretKey, 'base64url')));
  return { signer, id: quote.commitmentId, terms: offers.get(quote.commitmentId), buyer, store };
}
/** Both parties sign a 70/30 settlement and the buyer submits it. `delivery`: the late work it carries. */
async function settle(d: { id: Hex; terms: J; buyer: Agent }, o: { releaseKey: boolean; deliveryHash: Hex | null; delivery?: J }): Promise<J> {
  const nonce = freshNonce();
  const p = await d.buyer.call('POST', '/v1/prepare/settlement', { commitmentId: d.id, nonce, toSellerBps: 7000, releaseKey: o.releaseKey, ...(o.delivery ? { delivery: o.delivery } : {}) });
  const intent: Intent = { kind: 'settlement', terms: d.terms, payouts: p.submit.body.payouts, releaseKey: o.releaseKey, deliveryHash: o.deliveryHash, nonce, ...(o.delivery ? { delivery: o.delivery } : {}) };
  const mine = await d.buyer.sign(p, intent), theirs = await seller.sign(p, intent);
  const state = await d.buyer.call('POST', mine.path, { ...mine.body, sellerSignature: theirs.body.sellerSignature });
  expect(state.escrowState).toBe('Settled');
  return p.submit.body.payouts;
}
const resume = (store: string, id: string, extra: string[] = []) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
  const child = spawn(process.execPath, [here('./buy-with-signer.ts'), 'resume', store, id, ...extra], { env: { ...process.env, HOLDBACK_OPERATORS: demo.urls.join(',') } });
  let out = '', err = '';
  child.stdout.on('data', (x: Buffer) => (out += x.toString()));
  child.stderr.on('data', (x: Buffer) => (err += x.toString()));
  const timer = setTimeout(() => child.kill(), 40_000); // a resume that never returns fails here, not by hanging the run
  child.on('exit', (code) => (clearTimeout(timer), resolve({ code, out, err })));
});

describe('a deal that ends Settled finishes in the buyer\'s tools (T-390)', () => {
  it('a settlement with the key released after a posted delivery: watch reports it, and resume returns with the payouts and the work', async () => {
    gate = (() => {
      let open = () => {};
      const wait = new Promise<void>((r) => (open = r));
      return { open, wait };
    })();
    const d = await funded(true);
    const { delivery } = await seller.deliverAndShare(d.terms, new TextEncoder().encode(CSV));
    const payouts = await settle(d, { releaseKey: true, deliveryHash: deliveryHashOf(delivery) as Hex });
    gate.open();
    const reports: Report[] = [];
    const done = await d.signer.watch(d.id, { pollMs: 200, timeoutMs: 20_000, onReport: (r) => void reports.push(r) });
    expect(done).toMatchObject({ outcome: 'Settled', settlement: { keyReleased: true } });
    expect(reports.map((r) => r.kind)).toContain('settled');
    const r = await resume(d.store, d.id);
    expect(r.code, r.err).toBe(0);
    const line = JSON.parse(r.out) as J;
    expect(line).toMatchObject({ outcome: 'Settled', work: CSV, settlement: { keyReleased: true, note: null } });
    expect(line.settlement.payouts).toEqual(payouts.map((p: J) => ({ ...p, to: p.to.toLowerCase() })));
  }, 60_000);

  it('a settlement that releases no key: resume returns with the payouts, opens nothing and says why', async () => {
    const d = await funded(false);
    const payouts = await settle(d, { releaseKey: false, deliveryHash: null });
    const r = await resume(d.store, d.id);
    expect(r.code, r.err).toBe(0);
    const line = JSON.parse(r.out) as J;
    expect(line).toMatchObject({ outcome: 'Settled', work: null, settlement: { keyReleased: false, note: 'the settlement released no key: there is no work to open' } });
    expect(line.settlement.payouts).toHaveLength(payouts.length);
  }, 60_000);

  it('a late-work settlement: resume returns and asks for the handed-over delivery, then opens it with --delivery, and refuses another', async () => {
    const d = await funded(false);
    const { prepared, intent } = await seller.prepareDelivery(d.terms, new TextEncoder().encode(CSV));
    const late = (await seller.sign(prepared, intent)).body; // signed, never posted
    const other = (await seller.sign(...Object.values(await seller.prepareDelivery(d.terms, new TextEncoder().encode(`${CSV}3,grace@example.com\n`))) as [J, Intent])).body;
    await settle(d, { releaseKey: true, deliveryHash: deliveryHashOf(late) as Hex, delivery: late });
    const asked = await resume(d.store, d.id);
    expect(asked.code, asked.err).toBe(0);
    expect(JSON.parse(asked.out)).toMatchObject({ outcome: 'Settled', work: null, settlement: { keyReleased: true, note: expect.stringContaining(`${d.id} --delivery <file>`) } });
    // T-399: with the outcome saved, a resume that names no deal says so and how to name one, instead of printing nothing.
    const none = await resume(d.store, '');
    expect(none.code, none.err).toBe(0);
    expect(none.out).toBe('');
    expect(none.err).toMatch(/No open deal in .*: each deal there has its outcome saved\. .*resume .* <commitment ID>/);
    const file = join(d.store, 'late-delivery.json'), wrong = join(d.store, 'other-delivery.json');
    writeFileSync(file, JSON.stringify(late));
    writeFileSync(wrong, JSON.stringify(other));
    const opened = await resume(d.store, d.id, ['--delivery', file]);
    expect(opened.code, opened.err).toBe(0);
    expect(JSON.parse(opened.out)).toMatchObject({ outcome: 'Settled', work: CSV, settlement: { keyReleased: true, note: null, deliveryHash: deliveryHashOf(late).toLowerCase() } });
    const refused = await resume(d.store, d.id, ['--delivery', wrong]);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/not your envelope in the delivery you passed/);
    expect(readdirSync(d.store).some((f) => f.endsWith('.watch.json'))).toBe(true);
  }, 90_000);
});
