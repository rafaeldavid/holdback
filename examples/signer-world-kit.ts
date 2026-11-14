// What the signer's tests against a demo world share (T-439, T-440): a seller that offers by Agent.offerDirect and
// delivers once the hold is funded, the version 1 rules for that world's club and reviewers, the administrator's
// top-up of the float, and the buying agent's steps up to the payment. Only tests import it. Keys are made in memory.
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import type { Hex } from 'viem';
import { expect } from 'vitest';
import { Agent } from './agent.ts';
import { makeKeys, type BuyerSigner, type PaymentFile } from './buyer-signer.ts';
import { CHECKS, DELIVERABLE, fresh, V1, type Cast } from './signer-test-kit.ts';
import { jcsHash } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** The version 1 windows, and a judge and fallback of 60 s each, as the selling agent's offer has them (S4). */
export const TIMING = { offerExpiresInSec: 300, fundWithinSec: 600, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: V1.buying.terms.appealDecideSec };

/** A temporary folder for one key store, removed by the caller's cleanup. */
export const storeIn = (dirs: string[]) => () => {
  const d = mkdtempSync(join(tmpdir(), 'crow-agent-'));
  dirs.push(d);
  return d;
};
export const post = async (base: string, path: string, body: J) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as J };
};

export type Seller = { quoteUrl: string; address: string; payout: string; set(o: { price?: J; payout?: string }): void; close(): Promise<void> };
export type World = { urls: string[]; seller: Seller; found: J; token: string };

/** A seller that answers POST /quote with an offer built by Agent.offerDirect, and delivers once the hold is funded. */
export async function serveSeller(operators: string[], found: J, token: string, o: { domain?: J; chain?: J } = {}): Promise<Seller> {
  const agent = new Agent(operators, generatePrivateKey(), nacl.randomBytes(32), ...((o.domain ? [o.domain, o.chain] : []) as []));
  await agent.call('POST', '/v1/faucet', { address: agent.address });
  const role = (r: string): string => found.demo.adjudicators.find((a: J) => a.role === r).address;
  const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
  const payout = fresh();
  let set: { price?: J; payout?: string } = {}, open = true;
  const deliverWhenHeld = async (id: Hex, terms: J) => {
    while (open) {
      const s = await agent.call('GET', `/v1/commitments/${id}`).catch(() => null);
      if (s?.escrowState === 'Held') return void (await agent.deliver(terms, new TextEncoder().encode(CSV)));
      if (s && !['Offered', 'AcceptedByAdjudicator', 'Agreed'].includes(s.escrowState)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as J;
    try {
      const offer = await agent.offerDirect({
        template: 'checks-only', clubId: found.demo.clubId, seller: agent.address, buyer: { address: body.buyer, encryptionPublicKey: body.buyerEncryptionPublicKey, ...(body.buyerPaymentAddress ? { paymentAddress: body.buyerPaymentAddress } : {}) },
        sellerPayoutAddress: set.payout ?? payout, adjudicators, price: set.price ?? { token, amount: '9000000' }, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING,
      });
      void deliverWhenHeld(offer.id, offer.terms).catch(() => undefined);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commitmentId: offer.id, price: offer.terms.price, fees: null, expiresAt: offer.terms.timing.offerExpiresAt }));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'offer_failed', detail: String((e as Error).message).slice(0, 200) }));
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    quoteUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/quote`, address: agent.address.toLowerCase(), payout, set: (x) => void (set = x),
    close: async () => {
      open = false;
      await new Promise<void>((ok) => server.close(() => ok()));
      server.closeAllConnections();
    },
  };
}

/** The version 1 rules for this world: its club, its reviewers and the seller's product, as a probe offer names them. */
export async function rulesForWorld(w: World, c: Cast, store: () => string, chain: J = { network: 'simchain' }): Promise<J> {
  const probe = await makeKeys(store(), { operators: w.urls, paymentAddress: c.float, log: () => {} });
  const q = await probe.quote(w.seller.quoteUrl, 'rows');
  const t = (await (await fetch(`${w.urls[0]}/v1/commitments/${q.commitmentId}/terms`)).json()) as J;
  const a = t.adjudication;
  return {
    ...V1, chain, floatAddress: c.float,
    buying: {
      ...V1.buying, principal: c.principal.address.toLowerCase(), standingKey: c.standing, mandatePath: 'mandate.json', clubId: t.clubId, rulebookHash: t.rulebookHash,
      reviewers: { adjudicator: a.adjudicator, fallbackAdjudicator: a.fallbackAdjudicator, appealAdjudicator: a.appealAdjudicator, policyId: a.policyId, policyHash: a.policyHash, registryHash: a.registryHash, fee: a.fee.amount },
      sellers: [{ seller: w.seller.address, payoutAddress: w.seller.payout, deliverableHashes: [jcsHash(t.deliverable)], acceptanceHash: jcsHash(t.acceptance) }],
    },
    reads: { ...V1.reads, operators: w.urls },
  };
}

/** The administrator's top-up of the float, by hand: the faucet sends `amount` to the float (the test service's money). */
export const topUp = (w: World, float: string, amount: string) => post(w.urls[0]!, '/v1/faucet', { address: fresh(), paymentAddress: float, amount });
export const balance = async (w: World, a: string) => BigInt(((await (await fetch(`${w.urls[1]}/v1/balances/${a}`)).json()) as J).amount ?? '0');

export type UpToPayment = { buyer: BuyerSigner; id: Hex; terms: J; file: J; dir: string; files: PaymentFile[] };
/** The agent's side up to the payment: quote, read and check the offer, a mandate for the deal key, the funding file. */
export async function upToPayment(w: World, float: string, store: () => string): Promise<UpToPayment> {
  const dir = store();
  const buyer = await makeKeys(dir, { operators: w.urls, paymentAddress: float, log: () => {} });
  const q = await buyer.quote(w.seller.quoteUrl, 'rows');
  const offer = await buyer.readOffer(q.commitmentId);
  await buyer.checkOffer(q.commitmentId, offer);
  // The deal key's mandate in the demo club, and 1 base unit of the test token to the deal key itself: nothing to the float.
  expect((await post(w.urls[0]!, '/v1/faucet', { address: buyer.address, amount: '1' })).status).toBe(200);
  const files = await buyer.fundingFiles(q.commitmentId);
  return { buyer, id: q.commitmentId, terms: JSON.parse(readFileSync(join(dir, `${buyer.address}.terms.json`), 'utf8')), file: JSON.parse(readFileSync(files[0]!.path, 'utf8')), dir, files };
}
