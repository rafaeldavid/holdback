// The buyer signer and the two money addresses (ADR-0033, T-379), against the public demo's own world served in this
// process on two origins. The seller here builds its offer itself (Agent.offerDirect, no prepare call), so it can
// name a payout address apart from its signing key, and, in the attack cases, a payment address the buyer never gave.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { checkPaymentFile, Refusal, SIMCHAIN_DOMAIN } from './verify.ts';

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
type SellerOptions = { payout?: string; payment?: (asked: J) => string | undefined; price?: J; work?: string };
type Seller = { quoteUrl: string; address: string; asked: J[]; set(o: SellerOptions): void; close(): Promise<void> };
async function serveSeller(operators: string[]): Promise<Seller> {
  const agent = new Agent(operators, generatePrivateKey(), nacl.randomBytes(32));
  await agent.call('POST', '/v1/faucet', { address: agent.address });
  const found = await agent.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  const role = (r: string): string => found.adjudicators.find((a: J) => a.role === r).address;
  const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
  let open = true;
  let o: SellerOptions = {};
  const asked: J[] = [];
  const deliverWhenHeld = async (id: `0x${string}`, terms: J, work: string) => {
    while (open) {
      const s = await agent.call('GET', `/v1/commitments/${id}`);
      if (s.escrowState === 'Held') return void (await agent.deliver(terms, new TextEncoder().encode(work)));
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
      void deliverWhenHeld(offer.id, offer.terms, o.work ?? CSV).catch(() => undefined);
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
/** How far this world's clock runs ahead of the wall clock, in ms: a test moves it to pass an offer's expiry. */
let aheadMs = 0;
beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 100, now: () => Date.now() + aheadMs });
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
    expect(lines[0]).toBe(`Payment address: ${payment} funds the hold and the operator fee, and refunds return to it. The signing address ${signer.address} receives none of the deal's money.`);
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

/** A wallet outside the signer: it signs a typed-data file as it reads it from disk, knowing nothing of the signer. */
const wallet = (key: `0x${string}`) => {
  const account = privateKeyToAccount(key);
  return { address: account.address.toLowerCase(), sign: (path: string) => account.signTypedData(JSON.parse(readFileSync(path, 'utf8'))), signFile: (file: J) => account.signTypedData(file) };
};
/** A buyer whose payment address is `pay`'s, with the deal checked and the test funds in place: ready for fundingFiles. */
async function readyToFund(pay: { address: string }, o: SellerOptions = {}) {
  seller.set(o);
  const signer = await makeKeys(store(), { operators: demo.urls, paymentAddress: pay.address, log: () => {} });
  const quote = await signer.quote(seller.quoteUrl, 'rows');
  await signer.checkOffer(quote.commitmentId, await signer.readOffer(quote.commitmentId));
  await signer.testFunds(TOTAL);
  return { signer, id: quote.commitmentId };
}
const stateOf = async (id: string) => ((await (await fetch(`${demo.urls[0]}/v1/commitments/${id}`)).json()) as { escrowState: string }).escrowState;

describe('a wallet outside the signer pays (ADR-0033 §3)', () => {
  it('the signer writes the funding and the operator fee as eth_signTypedData_v4 files; signed from the files alone, they fund the deal from the payment address, and the signing key holds nothing at any step', async () => {
    const pay = wallet(generatePrivateKey());
    const { signer, id } = await readyToFund(pay);
    const signingBefore = '0'; // the faucet sends the signing key its mandate and no tokens (T-378)
    expect(await balance(signer.address)).toBe(signingBefore);
    expect(await balance(pay.address)).toBe(TOTAL);
    await expect(signer.agreeAndFund(id)).rejects.toThrow(/call fundingFiles/);
    const lines: string[] = [];
    const files = await signer.fundingFiles(id);
    expect(files.map((f) => f.name)).toEqual(['funding', 'operator-fee']);
    for (const f of files) {
      const file = JSON.parse(readFileSync(f.path, 'utf8')) as J;
      expect(Object.keys(file).sort()).toEqual(['domain', 'message', 'primaryType', 'types']);
      expect(file.types.EIP712Domain.map((x: J) => x.name)).toEqual(['name', 'version', 'chainId', 'verifyingContract']);
      expect(file.message.from).toBe(pay.address);
      expect(f.summary).toContain(`${pay.address} pays `);
      expect(f.summary).toContain(`for deal ${id} only`);
    }
    expect(JSON.parse(readFileSync(files[0]!.path, 'utf8')).message).toMatchObject({ commitmentId: id, value: '26000000', token: 'tUSD' });
    expect(files[1]!.summary).toMatch(/pays 10000 base units of tUSD \(0\.010000 tUSD\) to 0x[0-9a-f]{40}, the operator's fee/);
    void lines;
    // Writing them again gives the same messages.
    expect((await signer.fundingFiles(id)).map((f) => f.digest)).toEqual(files.map((f) => f.digest));
    const paid = await signer.agreeAndFund(id, { funding: await pay.sign(files[0]!.path), operatorFee: await pay.sign(files[1]!.path) });
    expect(paid.total).toEqual({ token: 'tUSD', amount: TOTAL });
    expect(await stateOf(id)).toBe('Held');
    expect(await balance(pay.address)).toBe('0');
    expect(await balance(signer.address)).toBe(signingBefore);
    const done = await signer.openDelivery(id, { timeoutMs: 30_000, pollMs: 200 });
    expect(done).toMatchObject({ outcome: 'Released', work: CSV });
    expect(await balance(signer.address)).toBe(signingBefore);
    expect((await signer.record()).row).toMatchObject({ buyerPaymentAddress: pay.address, paidTo: seller.address, refundedTo: null });
  }, 60_000);

  it('refuses a signature that is not the payment address\'s, one for another deal, and one for more than the approved total, and sends nothing', async () => {
    const pay = wallet(generatePrivateKey()), stranger = wallet(generatePrivateKey());
    const { signer, id } = await readyToFund(pay);
    const [funding, fee] = await signer.fundingFiles(id);
    const feeSig = await pay.sign(fee!.path);
    let held = await balance(pay.address);
    const refused = async (sigs: J, why: RegExp) => {
      const e = await refusal(signer.agreeAndFund(id, sigs));
      expect(e).toBeInstanceOf(Refusal);
      expect(e!.message).toMatch(why);
      expect(await stateOf(id)).toBe('AcceptedByAdjudicator');
      expect(await balance(pay.address)).toBe(held); // nothing moved
    };
    // 1. Not the payment address's: another key signed this very file.
    await refused({ funding: await stranger.sign(funding!.path), operatorFee: feeSig }, new RegExp(`fund\\.signature signature recovers to ${stranger.address} over this deal's message, not to ${pay.address}`));
    // 2. For another deal: the payment address signed the funding file of a second deal it also pays for.
    const other = await readyToFund(pay);
    held = await balance(pay.address); // the faucet may mint the second deal's total too (T-378)
    const [otherFunding] = await other.signer.fundingFiles(other.id);
    const otherFile = JSON.parse(readFileSync(otherFunding!.path, 'utf8'));
    await refused({ funding: await pay.signFile(otherFile), operatorFee: feeSig }, /fund\.signature signature recovers to 0x[0-9a-f]{40} over this deal's message, not to/);
    await refused({ funding: await pay.signFile(otherFile), operatorFee: feeSig, signed: { funding: otherFile } }, /^refusing to sign: the signed funding message is for another deal/);
    // 3. For more than the approved total: the payment address signed this deal's funding with a higher value.
    const more = JSON.parse(readFileSync(funding!.path, 'utf8'));
    more.message.value = '99000000';
    await refused({ funding: await pay.signFile(more), operatorFee: feeSig }, /fund\.signature signature recovers to 0x[0-9a-f]{40} over this deal's message, not to/);
    await refused({ funding: await pay.signFile(more), operatorFee: feeSig, signed: { funding: more } }, /^refusing to sign: the signed funding message pays 99000000 base units, more than the approved 26000000$/);
    // A missing or malformed signature is refused before anything is prepared.
    await refused({ funding: '0x1234', operatorFee: feeSig }, /the funding signature is missing or not 65 bytes/);
    await refused({ funding: await pay.sign(funding!.path) }, /the operator-fee signature is missing/);
    // The honest signatures still fund it: nothing above was spent.
    await expect(signer.agreeAndFund(id, { funding: await pay.sign(funding!.path), operatorFee: feeSig, signed: { funding: JSON.parse(readFileSync(funding!.path, 'utf8')) } })).resolves.toMatchObject({ total: { amount: TOTAL } });
    expect(await stateOf(id)).toBe('Held');
  }, 60_000);

  it('as a person runs it: the buyer\'s command stops with exit status 4 and the files, the holder checks a file alone, signs both, funds, and resumes to the work', async () => {
    seller.set({});
    const pay = wallet(generatePrivateKey());
    const dir = store();
    const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
    const node = (args: string[], env: Record<string, string> = {}) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, args, { env: { ...process.env, HOLDBACK_OPERATORS: demo.urls.join(','), ...env } });
      let out = '', err = '';
      child.stdout.on('data', (x: Buffer) => (out += x.toString()));
      child.stderr.on('data', (x: Buffer) => (err += x.toString()));
      child.on('exit', (code) => resolve({ code, out, err }));
    });
    const stopped = await node([here('./buy-with-signer.ts'), seller.quoteUrl, dir, JSON.stringify('rows'), TOTAL, '--stop-after-funding'], { CROW_PAYMENT_ADDRESS: pay.address });
    expect(stopped.code, stopped.err).toBe(3); // the approval stop comes first, as for every buyer (T-368)
    const shown = JSON.parse(stopped.out) as J;
    expect(shown).toMatchObject({ approval: 'needed', buyerPaymentAddress: pay.address });
    const files = await node([here('./buy-with-signer.ts'), 'approve', dir, shown.commitmentId, TOTAL, '--stop-after-funding']);
    expect(files.code, files.err).toBe(4);
    const lines = files.err.trimEnd().split('\n');
    const signs = lines.filter((l) => l.startsWith('{"sign":')).map((l) => JSON.parse(l) as { sign: string; summary: string });
    expect(signs.map((s) => s.sign.split('.').slice(-3, -2)[0])).toEqual(['funding', 'operator-fee']);
    expect(lines.at(-1)).toMatch(new RegExp(`Stopped for the payment address's signatures: nothing is paid\\. .* fund ${dir} ${shown.commitmentId} <funding signature> \\[<operator-fee signature>\\]$`));
    expect(await stateOf(shown.commitmentId)).toBe('AcceptedByAdjudicator');
    // The holder's own check, from the terms and its pinned layer (SimChain here), with no access to the key store.
    const termsFile = join(store(), 'terms.json');
    writeFileSync(termsFile, JSON.stringify(await (await fetch(`${demo.urls[1]}/v1/commitments/${shown.commitmentId}/terms`)).json()));
    const buyerAddress = readdirSync(dir).find((f) => /^0x[0-9a-f]{40}\.json$/.test(f))!.slice(0, 42); // the signing key the holder expects
    const checked = await node([here('./pay-from-wallet.ts'), 'check', signs[0]!.sign, termsFile, buyerAddress, '--sim']);
    expect(checked.code, checked.err).toBe(0);
    expect(JSON.parse(checked.out)).toMatchObject({ ok: true, kind: 'funding', summary: signs[0]!.summary.replace(/^The funding \(digest 0x[0-9a-f]{64}\): /, '') });
    const wrongBuyer = await node([here('./pay-from-wallet.ts'), 'check', signs[0]!.sign, termsFile, pay.address, '--sim']);
    expect(wrongBuyer.code).toBe(3);
    // The wallet signs each file as it is; the signatures fund the deal; resume follows it to the work.
    const funded = await node([here('./pay-from-wallet.ts'), 'fund', dir, shown.commitmentId, await pay.sign(signs[0]!.sign), await pay.sign(signs[1]!.sign)]);
    expect(funded.code, funded.err).toBe(0);
    expect(JSON.parse(funded.out)).toMatchObject({ funded: shown.commitmentId, paid: { token: 'tUSD', amount: TOTAL }, from: pay.address });
    const done = await node([here('./buy-with-signer.ts'), 'resume', dir]);
    expect(done.code, done.err).toBe(0);
    expect(JSON.parse(done.out)).toMatchObject({ outcome: 'Released', work: CSV });
    expect(await balance(pay.address)).toBe('0');
  }, 90_000);

  it('red team M-1: a file replaced on disk after the signer wrote it is named, and its signature funds nothing; the holder\'s check refuses it first', async () => {
    const pay = wallet(generatePrivateKey());
    const { signer, id } = await readyToFund(pay);
    const other = await readyToFund(pay); // another deal this payment address could be led to pay
    const [funding, fee] = await signer.fundingFiles(id);
    const [otherFunding] = await other.signer.fundingFiles(other.id);
    expect(funding!.check).toMatch(new RegExp(`^node examples/pay-from-wallet\\.ts check \\S+\\.funding\\.typed\\.json \\S+\\.terms\\.json ${signer.address} --sim$`));
    writeFileSync(funding!.path, readFileSync(otherFunding!.path)); // the attacker's file, same payer and amounts
    const terms = JSON.parse(readFileSync(join(signer.store, `${signer.address}.terms.json`), 'utf8'));
    expect(() => checkPaymentFile(JSON.parse(readFileSync(funding!.path, 'utf8')), terms, { kind: 'funding', domain: SIMCHAIN_DOMAIN, buyer: signer.address })).toThrow(/^refusing to sign: the message is for deal /);
    const e = await refusal(signer.agreeAndFund(id, { funding: await pay.sign(funding!.path), operatorFee: await pay.sign(fee!.path) }));
    expect(e!.message).toMatch(new RegExp(`^refusing to sign: ${funding!.path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} is not the file the signer wrote: it now hashes to 0x[0-9a-f]{64}, not ${funding!.digest}`));
    expect(await stateOf(id)).toBe('AcceptedByAdjudicator');
    expect(await stateOf(other.id)).toBe('AcceptedByAdjudicator');
  }, 60_000);

  it('red team L-6: a signature with v of 0 or 1 is sent as 27 or 28, the form the token on a chain takes', async () => {
    const pay = wallet(generatePrivateKey());
    const { signer, id } = await readyToFund(pay);
    const [funding, fee] = await signer.fundingFiles(id);
    const v01 = (sig: string) => `${sig.slice(0, 130)}${(parseInt(sig.slice(130), 16) - 27).toString(16).padStart(2, '0')}`;
    const sent: string[] = [];
    const watch = (url: string) => url.endsWith('/agree');
    const real = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (watch(String(input instanceof Request ? input.url : input)) && typeof init?.body === 'string') sent.push(init.body);
      return real(input, init);
    };
    try {
      await signer.agreeAndFund(id, { funding: v01(await pay.sign(funding!.path)), operatorFee: v01(await pay.sign(fee!.path)) });
    } finally {
      globalThis.fetch = real;
    }
    const body = JSON.parse(sent[0]!);
    for (const sig of [body.fund.signature, body.operatorFee.signature]) expect(['1b', '1c']).toContain(sig.slice(130));
    expect(await stateOf(id)).toBe('Held');
  }, 60_000);

  it('red team L-3: once the offer has expired, the signer writes no files, and the sentence names the offer\'s expiry', async () => {
    const pay = wallet(generatePrivateKey());
    const { signer, id } = await readyToFund(pay);
    const [funding] = await signer.fundingFiles(id);
    const expires = JSON.parse(readFileSync(join(signer.store, `${signer.address}.terms.json`), 'utf8')).timing.offerExpiresAt;
    expect(funding!.summary).toContain(`Sign before the offer expires at ${expires}: after that nothing can fund it.`);
    aheadMs += Date.parse(expires) - Date.now() + 5_000;
    try {
      await new Promise((r) => setTimeout(r, 300)); // the world's next tick
      await expect(signer.fundingFiles(id)).rejects.toThrow(new RegExp(`^the offer ${id} expired at ${expires}: nothing can fund it now, so no files are written$`));
    } finally {
      aheadMs = 0;
    }
  }, 60_000);

  it('a rejected delivery refunds the price to the payment address, and the signing key holds nothing', async () => {
    const pay = wallet(generatePrivateKey());
    const { signer, id } = await readyToFund(pay, { work: 'customer_id,email\n1,ada@example.com\n' });
    const signingBefore = '0';
    expect(await balance(signer.address)).toBe(signingBefore);
    const [funding, fee] = await signer.fundingFiles(id);
    await signer.agreeAndFund(id, { funding: await pay.sign(funding!.path), operatorFee: await pay.sign(fee!.path) });
    const done = await signer.openDelivery(id, { timeoutMs: 30_000, pollMs: 200 });
    expect(done.outcome).toBe('Refunded');
    expect(await balance(pay.address)).toBe(PRICE.amount);
    expect(await balance(signer.address)).toBe(signingBefore);
    expect((await signer.record()).row).toMatchObject({ refundedTo: pay.address, paidTo: null });
  }, 60_000);
});
