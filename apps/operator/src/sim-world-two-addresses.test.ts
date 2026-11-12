// T-378 (ADR-0033 §10, the operator package's proof): on the local world, over HTTP, a buyer whose per-deal signing key
// holds no token at any step. A standing payment address funds the hold, pays this node's operator fee and receives the
// refund; the seller is paid at a payout address apart from its signing address. One deal Released, one Refunded.
import { seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import type { Hex32 } from '@holdback/core';
import { hashTypedData, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testAccount } from './accounts.js';
import type { Prepared } from './prepare.js';
import { startSimWorld, type SimInfo, type SimWorld } from './sim-world.js';

let world: SimWorld;
let api: string;
let info: SimInfo;

beforeAll(async () => {
  // One basis point, at least 0.01 tUSD: the payment address pays the operator fee as on the live world.
  world = await startSimWorld({ accounts: ['seller-1'], env: {}, onError: () => {}, operatorFee: { bps: 1, min: '10000', max: null } });
  info = world.info;
  api = info.operators[0]!;
});
afterAll(() => world.close());

let calls = 0;
async function call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'idempotency-key': `two-${++calls}` };
  const res = await fetch(`${api}${path}`, { method, headers, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as T };
}

function ints(types: Record<string, Array<{ name: string; type: string }>>, type: string, v: unknown): unknown {
  if (type.endsWith('[]')) return (v as unknown[]).map((x) => ints(types, type.slice(0, -2), x));
  if (types[type]) return Object.fromEntries(types[type]!.map((f) => [f.name, ints(types, f.type, (v as Record<string, unknown>)[f.name])]));
  return /^u?int\d*$/.test(type) ? BigInt(v as string) : v;
}

/** Signs every slot whose signer is this key, after checking the digest; returns the slots it signed. */
async function sign(p: Prepared, key: Hex): Promise<string[]> {
  const account = privateKeyToAccount(key);
  const signed: string[] = [];
  for (const s of p.sign.filter((x) => x.signer.toLowerCase() === account.address.toLowerCase())) {
    const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) } as Parameters<typeof hashTypedData>[0];
    expect(hashTypedData(typed)).toBe(s.digest);
    const path = s.slot.split('.');
    const parent = path.slice(0, -1).reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p.submit.body);
    parent[path.at(-1)!] = await account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
    signed.push(s.slot);
  }
  return signed;
}
const submit = async (p: Prepared) => call('POST', p.submit.path, p.submit.body);
const balance = async (a: string): Promise<bigint> => BigInt((await call('GET', `/v1/balances/${a}`)).body.amount);

async function waitFor(id: Hex32, states: string[]): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const s = (await call('GET', `/v1/commitments/${id}`)).body.escrowState as string;
    if (states.includes(s)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${id} never reached ${states.join('|')}`);
}

const nonce = () => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
const checks = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 2, max: 10 },
];
const seller = () => info.accounts.find((a) => a.label === 'seller-1')!;
const PRICE = 25_000_000n;

describe('two addresses on the local world (ADR-0033)', () => {
  // The standing payment address, used by both deals; each deal has its own signing key.
  const payment = generatePrivateKey();
  const paymentAddress = privateKeyToAccount(payment).address.toLowerCase();
  const payoutAddress = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

  async function deal(csv: string): Promise<{ id: Hex32; signing: string; trail: bigint[]; before: { payment: bigint; payout: bigint; sellerSigning: bigint }; feeTo: string; opFee: bigint }> {
    const buyerKey = generatePrivateKey();
    const signing = privateKeyToAccount(buyerKey).address.toLowerCase();
    const buyerEnc = testAccount(`two-addresses/${signing}`);
    const trail: bigint[] = [];
    const watch = async () => void trail.push(await balance(signing));

    // The faucet: tokens to the payment address, the mandate to the signing key.
    const grant = await call('POST', '/v1/faucet', { address: signing, paymentAddress, amount: '100000000' });
    expect(grant.status).toBe(200);
    expect(grant.body).toMatchObject({ address: signing, paymentAddress, mandate: { agent: signing } });
    await watch();

    const before = { payment: await balance(paymentAddress), payout: await balance(payoutAddress), sellerSigning: await balance(seller().address) };
    const offer = await call<Prepared>('POST', '/v1/prepare/offer', {
      nonce: nonce(),
      disclosure: 'public',
      template: 'checks-only',
      clubId: info.clubId,
      seller: seller().address,
      sellerPayoutAddress: payoutAddress,
      buyer: { address: signing, encryptionPublicKey: buyerEnc.encryptionPublicKey, paymentAddress },
      adjudicators: { primary: info.adjudicators[0]!.address, fallback: info.adjudicators[1]!.address, appeal: info.adjudicators[2]!.address },
      price: { token: 'tUSD', amount: PRICE.toString() },
      deliverable: { kind: 'dataset', description: 'Two customers.', format: 'text/csv' },
      checks,
    });
    expect(offer.status).toBe(200);
    const terms = offer.body.submit.body as Record<string, string>;
    expect(terms).toMatchObject({ buyer: signing, buyerPaymentAddress: paymentAddress, seller: seller().address, sellerPayoutAddress: payoutAddress });
    expect(offer.body.notices ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/not set/)]));
    expect(await sign(offer.body, seller().privateKey)).toEqual(['signatures.seller']);
    expect((await submit(offer.body)).body.escrowState).toBe('Offered');
    await waitFor(offer.body.commitmentId, ['AcceptedByAdjudicator']);
    await watch();

    const af = (await call<Prepared>('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.body.commitmentId, agreeNonce: nonce(), fundingNonce: nonce(), operatorFeeNonce: nonce() })).body;
    expect(af.sign.map((s) => [s.slot, s.signer])).toEqual([
      ['signature', signing],
      ['fund.signature', paymentAddress],
      ['operatorFee.signature', paymentAddress],
    ]);
    expect(await sign(af, buyerKey)).toEqual(['signature']);
    expect(await sign(af, payment)).toEqual(['fund.signature', 'operatorFee.signature']);
    expect((await submit(af)).body.escrowState).toBe('Held');
    await watch();

    const sealed = await seal(new TextEncoder().encode(csv));
    const stored = (await call('POST', '/v1/ciphertext', sealed.ciphertext)).body;
    const { recipients } = (await call('GET', `/v1/commitments/${offer.body.commitmentId}/recipients`)).body;
    const encryptedKeys = wrapKeyForRecipients(sealed.key, recipients.map((r: { address: string; encryptionPublicKey: string }) => ({ recipient: r.address, publicKey: r.encryptionPublicKey })));
    const dv = (await call<Prepared>('POST', '/v1/prepare/delivery', { commitmentId: offer.body.commitmentId, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: stored.bytes }, plaintextSha256: sealed.plaintextSha256, encryptedKeys })).body;
    await sign(dv, seller().privateKey);
    expect((await submit(dv)).body.escrowState).toBe('Delivered');
    await watch();
    const feeTo = (af.submit.body as { operatorFee: { to: string; value: string } }).operatorFee;
    return { id: offer.body.commitmentId, signing, trail, before, feeTo: feeTo.to, opFee: BigInt(feeTo.value) };
  }

  it('Released: the payment address pays price, fee and operator fee; the payout address gets the price; no signing address moves', async () => {
    const d = await deal('id,email\n1,ada@example.com\n2,alan@example.com\n');
    expect(await waitFor(d.id, ['Released', 'Refunded'])).toBe('Released');
    d.trail.push(await balance(d.signing));
    expect(d.trail.every((b) => b === 0n)).toBe(true);
    const fee = 1_000_000n; // the world adjudicators' minimum fee, 1 tUSD
    expect(d.opFee).toBe(10_000n); // 1 bp of 25 tUSD is below the 0.01 tUSD minimum
    expect(await balance(paymentAddress)).toBe(d.before.payment - PRICE - fee - d.opFee);
    expect(await balance(payoutAddress)).toBe(d.before.payout + PRICE);
    expect(await balance(seller().address)).toBe(d.before.sellerSigning);
    // The content key is released to the buyer's signing key, the party the terms name (ADR-0033 §2).
    expect((await call('GET', `/v1/commitments/${d.id}/key?recipient=${d.signing}`)).body.items).toHaveLength(1);
  });

  it('Refunded: the price returns to the payment address; the signing key still holds nothing', async () => {
    const d = await deal('id,email\n');
    expect(await waitFor(d.id, ['Released', 'Refunded'])).toBe('Refunded');
    d.trail.push(await balance(d.signing));
    expect(d.trail.every((b) => b === 0n)).toBe(true);
    const fee = 1_000_000n;
    // The adjudication fee and the operator fee are kept; the price comes back.
    expect(await balance(paymentAddress)).toBe(d.before.payment - fee - d.opFee);
    expect(await balance(payoutAddress)).toBe(d.before.payout);
    expect(await balance(seller().address)).toBe(d.before.sellerSigning);
  });
});
