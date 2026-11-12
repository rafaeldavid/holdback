// The buyer signer and the two money addresses (ADR-0033, T-379), against the public demo's own world served in this
// process on two origins. The seller here builds its offer itself (Agent.offerDirect, no prepare call), so it can
// name a payout address apart from its signing key, and, in the attack cases, a payment address the buyer never gave.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { makeKeys } from './buyer-signer.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PRICE = { token: 'tUSD', amount: '25000000' };
const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** Price 25 tUSD, adjudication fee 1 tUSD, operator fee 0.01 tUSD (1 bp, at least 10,000 base units). */
const TOTAL = '26010000';
const fresh = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

let demo: TwoOrigins;
const stores: string[] = [];
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'buyer-signer-addresses-'));
  stores.push(dir);
  return dir;
};

/**
 * A seller that answers POST /quote with an offer built by Agent.offerDirect. `payout` is its payout address;
 * `payment(asked)` picks the payment address the offer names (default: the one the quote asked for); `price` the price.
 */
type Seller = { quoteUrl: string; address: string; asked: J[]; set(o: { payout?: string; payment?: (asked: J) => string | undefined; price?: J }): void; close(): Promise<void> };
async function serveSeller(operators: string[]): Promise<Seller> {
  const agent = new Agent(operators, generatePrivateKey(), nacl.randomBytes(32));
  await agent.call('POST', '/v1/faucet', { address: agent.address });
  const found = await agent.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  const role = (r: string): string => found.adjudicators.find((a: J) => a.role === r).address;
  const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
  let open = true;
  let o: { payout?: string; payment?: (asked: J) => string | undefined; price?: J } = {};
  const asked: J[] = [];
  const deliverWhenHeld = async (id: `0x${string}`, terms: J) => {
    while (open) {
      const s = await agent.call('GET', `/v1/commitments/${id}`);
      if (s.escrowState === 'Held') return void (await agent.deliver(terms, new TextEncoder().encode(CSV)));
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as J;
    asked.push(body);
    try {
      const paymentAddress = o.payment ? o.payment(body) : body.buyerPaymentAddress;
      const offer = await agent.offerDirect({
        template: 'checks-only', clubId: found.clubId, seller: agent.address, buyer: { address: body.buyer, encryptionPublicKey: body.buyerEncryptionPublicKey, ...(paymentAddress ? { paymentAddress } : {}) },
        ...(o.payout ? { sellerPayoutAddress: o.payout } : {}), adjudicators, price: o.price ?? PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING,
      });
      void deliverWhenHeld(offer.id, offer.terms).catch(() => undefined);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commitmentId: offer.id, price: offer.terms.price, fees: null, expiresAt: offer.terms.timing.offerExpiresAt }));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'offer_failed', detail: String((e as Error).message).slice(0, 200) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    quoteUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/quote`, address: agent.address, asked,
    set: (x) => void (o = x),
    close: async () => {
      open = false;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

let seller: Seller;
beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 100 });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  seller = await serveSeller(demo.urls);
});
afterAll(async () => {
  await seller.close();
  await demo.close();
  for (const dir of stores) rmSync(dir, { recursive: true, force: true });
});
const balance = async (address: string) => ((await (await fetch(`${demo.urls[1]}/v1/balances/${address}`)).json()) as { amount: string }).amount;
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);

describe('buyer-signer.ts and the two money addresses (ADR-0033)', () => {
  it('without a payment address the signer says in one line that the signing address pays, and the quote names none', async () => {
    const lines: string[] = [];
    seller.set({});
    const signer = await makeKeys(store(), { operators: demo.urls, log: (l) => lines.push(l) });
    expect(signer.paymentAddress).toBe(signer.address);
    await signer.quote(seller.quoteUrl, 'rows');
    expect(lines).toEqual([`Payment address: not set. The signing address ${signer.address} funds the hold, and refunds return to it.`]);
    expect(seller.asked.at(-1)).not.toHaveProperty('buyerPaymentAddress');
  });

  it('a payment address given to makeKeys is saved in the key file, sent with the quote, and shown in the offer with the seller\'s payout address and the five fields T-332 left out', async () => {
    const payment = fresh(), payout = fresh();
    const lines: string[] = [];
    seller.set({ payout });
    const dir = store();
    const signer = await makeKeys(dir, { operators: demo.urls, paymentAddress: payment.toUpperCase().replace('0X', '0x'), log: (l) => lines.push(l) });
    expect(signer.paymentAddress).toBe(payment);
    expect(JSON.parse(readFileSync(join(dir, `${signer.address}.json`), 'utf8')).paymentAddress).toBe(payment);
    const quote = await signer.quote(seller.quoteUrl, 'rows');
    expect(seller.asked.at(-1).buyerPaymentAddress).toBe(payment);
    expect(lines[0]).toBe(`Payment address: ${payment} funds the hold and the operator fee, and refunds return to it. The signing address ${signer.address} holds nothing.`);
    const offer = await signer.readOffer(quote.commitmentId);
    expect(offer).toMatchObject({
      buyerPaymentAddress: payment, sellerPayoutAddress: payout, seller: seller.address, schemaVersion: '0.8', remedy: { onReject: 'full_refund' },
      nonce: expect.stringMatching(/^0x[0-9a-f]{64}$/), createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), token: { id: 'tUSD', symbol: 'tUSD', decimals: 6 },
    });
    // The checks pass; the approval names the payout address it saw.
    await expect(signer.checkOffer(quote.commitmentId, { ...offer, sellerPayoutAddress: payout })).resolves.toMatchObject({ sellerPayoutAddress: payout });
  });

  it('checkOffer refuses terms whose payment address is not the one in the key file (attack: the seller or a prepare substitutes it)', async () => {
    const mine = fresh(), theirs = fresh();
    seller.set({ payment: () => theirs });
    const signer = await makeKeys(store(), { operators: demo.urls, paymentAddress: mine, log: () => {} });
    const quote = await signer.quote(seller.quoteUrl, 'rows');
    const offer = await signer.readOffer(quote.commitmentId);
    expect(offer.buyerPaymentAddress).toBe(theirs);
    const e = await refusal(signer.checkOffer(quote.commitmentId, offer));
    expect(e).toBeInstanceOf(Refusal);
    expect(e!.message).toBe(`refusing to sign: buyerPaymentAddress is "${theirs}", not the approved "${mine}"`);
    // A buyer that set none is refused the same way: its payment address is its signing address.
    const plain = await makeKeys(store(), { operators: demo.urls, log: () => {} });
    const q2 = await plain.quote(seller.quoteUrl, 'rows');
    const e2 = await refusal(plain.checkOffer(q2.commitmentId, await plain.readOffer(q2.commitmentId)));
    expect(e2!.message).toMatch(/^refusing to sign: buyerPaymentAddress is /);
  });

  it('checkOffer refuses an offer whose payout address is not the one the buyer approved', async () => {
    const payout = fresh(), approvedPayout = fresh();
    seller.set({ payout });
    const signer = await makeKeys(store(), { operators: demo.urls, log: () => {} });
    const quote = await signer.quote(seller.quoteUrl, 'rows');
    const offer = await signer.readOffer(quote.commitmentId);
    const e = await refusal(signer.checkOffer(quote.commitmentId, { ...offer, sellerPayoutAddress: approvedPayout }));
    expect(e).toBeInstanceOf(Refusal);
    expect(e!.message).toBe(`refusing to sign: sellerPayoutAddress is "${payout}", not the approved "${approvedPayout}"`);
  });

  it('readOffer warns, and refuses nothing, when the payout address is an adjudicator or the zero address', async () => {
    const found = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
    const primary = found.demo.adjudicators.find((a: J) => a.role === 'primary').address.toLowerCase();
    for (const [payout, warning] of [[primary, "the payout address is the deal's primary adjudicator"], [`0x${'0'.repeat(40)}`, 'the payout address is the zero address']] as const) {
      seller.set({ payout });
      const lines: string[] = [];
      const signer = await makeKeys(store(), { operators: demo.urls, log: (l) => lines.push(l) });
      const quote = await signer.quote(seller.quoteUrl, 'rows');
      await expect(signer.readOffer(quote.commitmentId)).resolves.toMatchObject({ sellerPayoutAddress: payout });
      expect(lines.some((l) => l.startsWith('Warning: ') && l.includes(warning))).toBe(true);
    }
  });

  it('refuses an offer in another token than the settlement layer holds, naming both', async () => {
    seller.set({ price: { token: 'XUSD', amount: '25000000' } });
    const signer = await makeKeys(store(), { operators: demo.urls, log: () => {} });
    // This world's operators refuse the offer before it exists (measured: the fallback's bond check, in XUSD). The
    // signer's own refusal in readOffer is a second line for operators that relay it; a lying operator cannot change
    // the token of a real offer, since the commitment ID covers it.
    const e = await refusal(signer.quote(seller.quoteUrl, 'rows'));
    expect(e!.message).toMatch(/quote route answered 502: .*XUSD/);
  });

  it('a deal whose payout address differs from the seller\'s signing key releases to the payout address; the signing key receives nothing, and the deal record shows who was paid', async () => {
    const payout = fresh();
    seller.set({ payout });
    const signer = await makeKeys(store(), { operators: demo.urls, log: () => {} });
    const quote = await signer.quote(seller.quoteUrl, 'rows');
    const offer = await signer.readOffer(quote.commitmentId);
    await signer.checkOffer(quote.commitmentId, { ...offer, sellerPayoutAddress: payout });
    await signer.testFunds(TOTAL);
    const sellerBefore = await balance(seller.address);
    await signer.agreeAndFund(quote.commitmentId);
    const done = await signer.openDelivery(quote.commitmentId, { timeoutMs: 30_000, pollMs: 200 });
    expect(done.outcome).toBe('Released');
    expect(done.work).toBe(CSV);
    expect(await balance(payout)).toBe(PRICE.amount);
    expect(await balance(seller.address)).toBe(sellerBefore);
    // Item 79: the signer writes the buyer's record with its own key; nobody reads the key file.
    const record = await signer.record();
    expect(record.row).toMatchObject({ buyer: signer.address, seller: seller.address, buyerPaymentAddress: signer.address, sellerPayoutAddress: payout, paidTo: payout, refundedTo: null, outcome: 'Released' });
    expect(record.checks.find((c) => c.check === 'postings follow the outcome')?.ok).toBe(true);
    expect(record.checks.find((c) => c.check === 'signing addresses receive nothing')?.ok).toBe(true);
    expect(JSON.stringify(record)).not.toContain(JSON.parse(readFileSync(join(signer.store, `${signer.address}.json`), 'utf8')).encryptionSecretKey);
  }, 60_000);
});
