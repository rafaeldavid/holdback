// Every way a hold comes back, with the buyer's payment address apart from its signing key (ADR-0033, T-379): a
// reject, a reclaim after deliverBy, a default after the fallback stays silent, and a settlement's remainder all
// return to the payment address, and the signing key's balance never moves. The payment address signs the funding
// and the operator fee from typed-data files (verify.ts typedDataFile), as a wallet outside the tool would; the
// signing key signs only the agreement and the settlement. On the operators' SimChain world (`pnpm sim`).
import { startSimWorld, type SimWorld } from '@holdback/operator';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { freshNonce, typedDataFile, type Intent } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let world: SimWorld;
let seller: Agent, buyer: Agent, payer: ReturnType<typeof privateKeyToAccount>;
const fresh = async () => (await (await fetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
const balance = async (a: string) => BigInt(((await (await fetch(`${world.info.operators[1]}/v1/balances/${a}`)).json()) as J).amount ?? '0');
const silence = (role: string, silent: boolean) => fetch(`${world.url}/adjudicators/${role}`, { method: 'POST', body: JSON.stringify({ silent }) });
const PRICE = '10000000';
const TIMING = { offerExpiresInSec: 240, fundWithinSec: 300, deliverWithinSec: 3600, judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 0, appealDecideSec: 300 }; // the sim rulebook's smallest windows

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  const agent = (a: J) => new Agent(world.info.operators, a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url'));
  seller = agent(await fresh());
  buyer = agent(await fresh());
  payer = privateKeyToAccount((await fresh()).privateKey);
});
afterAll(() => world.close());

let deals = 0;
/** A deal offered to `buyer` with `payer` as its payment address, funded by the payer's signatures over the typed-data files. */
async function fundedApart(): Promise<{ id: Hex; terms: J }> {
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const offer = await seller.offerDirect({
    template: 'checks-only', clubId: world.info.clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: payer.address },
    adjudicators: { primary, fallback, appeal }, price: { token: 'tUSD', amount: PRICE }, deliverable: { kind: 'dataset', description: `rows, deal ${++deals}`, format: 'text/csv' },
    checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }], timing: TIMING,
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  const { prepared, intent, slots } = await buyer.prepareAgreeAndFund(offer.terms, 100_000_000n, { paymentAddress: payer.address });
  const outside: Record<string, Hex> = {};
  for (const s of slots.filter((x) => x.signer === payer.address.toLowerCase())) outside[s.slot] = await payer.signTypedData(typedDataFile(s.typed));
  expect(Object.keys(outside)).toEqual(['fund.signature']); // this world's operators publish no fee
  expect((await buyer.submitAgreeAndFund(prepared, intent, outside)).escrowState).toBe('Held');
  return offer;
}
const settled = async (id: Hex, state: string) => expect((await buyer.waitFor(id, [state], 20_000)).escrowState).toBe(state);

describe('the payment address funds the hold and receives every refund; the signing key never moves (ADR-0033)', () => {
  it('a reject, a reclaim, a default and a settlement\'s remainder all return to the payment address', async () => {
    const signingKey = await balance(buyer.address);
    const start = await balance(payer.address);
    let spent = 0n, back = 0n;

    // A reject: the work fails the check; the price comes back, the adjudication fee pays the decider.
    const rejected = await fundedApart();
    const fee = BigInt(rejected.terms.adjudication.fee.amount);
    spent += BigInt(PRICE) + fee;
    await seller.deliver(rejected.terms, new TextEncoder().encode('b\n1\n'));
    await settled(rejected.id, 'Refunded');
    back += BigInt(PRICE);
    expect(await balance(payer.address)).toBe(start - spent + back);
    expect(await balance(buyer.address)).toBe(signingKey);

    // A reclaim: nothing delivered by deliverBy; the whole hold comes back.
    const reclaimed = await fundedApart();
    spent += BigInt(PRICE) + fee;
    world.advance(TIMING.deliverWithinSec + 1);
    await buyer.call('POST', `/v1/commitments/${reclaimed.id}/triggers/reclaim`, {});
    await settled(reclaimed.id, 'Refunded');
    back += BigInt(PRICE) + fee;
    expect(await balance(payer.address)).toBe(start - spent + back);
    expect(await balance(buyer.address)).toBe(signingKey);

    // A default: the work is delivered, both deciding adjudicators stay silent; after fallbackBy the hold comes back.
    const defaulted = await fundedApart();
    spent += BigInt(PRICE) + fee;
    await silence('primary', true);
    await silence('fallback', true);
    try {
      await seller.deliver(defaulted.terms, new TextEncoder().encode('a\n1\n'));
      world.advance(TIMING.deliverWithinSec + TIMING.judgeWithinSec + 1);
      await buyer.call('POST', `/v1/commitments/${defaulted.id}/triggers/fallback`, {}).catch(() => undefined); // the operator may have moved it already
      world.advance(TIMING.fallbackWithinSec + 1);
      await buyer.call('POST', `/v1/commitments/${defaulted.id}/triggers/default`, {}).catch(() => undefined);
      // On SimChain the default is two steps: Defaulted, then the default outcome, which refunds (packages/core/src/state.ts).
      await buyer.waitFor(defaulted.id, ['Defaulted', 'Refunded'], 20_000);
      await buyer.call('POST', `/v1/commitments/${defaulted.id}/triggers/apply-default`, {}).catch(() => undefined);
      await settled(defaulted.id, 'Refunded');
      const now = await balance(payer.address);
      expect(now - (start - spent + back)).toBeGreaterThanOrEqual(BigInt(PRICE)); // the price, and the fee when the default returns it
      back += now - (start - spent + back);
      expect(await balance(buyer.address)).toBe(signingKey);
    } finally {
      await silence('primary', false);
      await silence('fallback', false);
    }

    // A settlement: 30% to the seller's payout address, the rest and the adjudication fee to the payment address.
    const split = await fundedApart();
    spent += BigInt(PRICE) + fee;
    const nonce = freshNonce();
    const p = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: split.id, toSellerBps: 3000, releaseKey: false, nonce });
    expect(p.submit.body.payouts.map((x: J) => x.to.toLowerCase())).toEqual([seller.address, payer.address.toLowerCase()]);
    const intent: Intent = { kind: 'settlement', terms: split.terms, payouts: p.submit.body.payouts, releaseKey: false, deliveryHash: null, nonce };
    const mine = await buyer.sign(p, intent);
    const theirs = await seller.sign(p, intent);
    await buyer.call('POST', mine.path, { ...mine.body, sellerSignature: theirs.body.sellerSignature });
    await settled(split.id, 'Settled');
    back += 7_000_000n + fee;
    expect(await balance(payer.address)).toBe(start - spent + back);
    expect(await balance(buyer.address)).toBe(signingKey);
  }, 60_000);

  it('the payment address\'s signature for one deal does not fund another', async () => {
    const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
    const offer = () =>
      seller.offerDirect({
        template: 'checks-only', clubId: world.info.clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: payer.address },
        adjudicators: { primary, fallback, appeal }, price: { token: 'tUSD', amount: PRICE }, deliverable: { kind: 'dataset', description: `rows, deal ${++deals}`, format: 'text/csv' },
        checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }], timing: TIMING,
      });
    const a = await offer(), b = await offer();
    await buyer.waitFor(a.id, ['AcceptedByAdjudicator']);
    await buyer.waitFor(b.id, ['AcceptedByAdjudicator']);
    const pa = await buyer.prepareAgreeAndFund(a.terms, 100_000_000n, { paymentAddress: payer.address });
    const pb = await buyer.prepareAgreeAndFund(b.terms, 100_000_000n, { paymentAddress: payer.address });
    const forA = await payer.signTypedData(typedDataFile(pa.slots.find((s) => s.slot === 'fund.signature')!.typed));
    await expect(buyer.submitAgreeAndFund(pb.prepared, pb.intent, { 'fund.signature': forA })).rejects.toThrow(/fund\.signature signature recovers to 0x[0-9a-f]{40} over this deal's message, not to/);
    // Sent past the client's check straight to the operators, settlement refuses it too, and nothing is held.
    const body = structuredClone(pb.prepared.submit.body);
    body.fund.signature = forA;
    body.signature = await buyer.account.signTypedData(pb.slots.find((s) => s.slot === 'signature')!.typed);
    await expect(buyer.call('POST', pb.prepared.submit.path, body)).rejects.toThrow();
    expect((await buyer.call('GET', `/v1/commitments/${b.id}`)).escrowState).toBe('AcceptedByAdjudicator');
  }, 30_000);
});
