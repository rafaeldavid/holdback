// The first pilot wave's fee (T-389, Rafa 2026-11-12): the operators charge nothing, and Crow's relayer pays the gas.
// The world opens with the fee variables exactly as wrangler.op1.jsonc sets them for both nodes, on anvil standing in
// for Sepolia. Two deals, each funded from a payment address apart from the buyer's signing key, as an outside wallet
// funds one: one Released, one Refunded. The buyer signs the agreement and the funding only, with no operator-fee
// message, and pays the price plus the adjudication fee and nothing else; the seller receives the price.
// The non-zero fee keeps its own tests (fee.test.ts, live.test.ts, world.test.ts), with their own values.
// Needs `anvil` on PATH and `forge build` output.
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { pinOf } from '../../../examples/verify.ts';
import { CSV, deploymentOf, estimateShim, lc, ready, RELAYER, root, serve, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

/** The fee variables of the live nodes' config (holdback-op1's vars; holdback-op2 reads op1's World). */
function pilotFeeEnv(): Record<string, string> {
  const text = readFileSync(`${root}apps/demo-cloud/wrangler.op1.jsonc`, 'utf8');
  const config = JSON.parse(text.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')) as { vars: Record<string, string> };
  return Object.fromEntries(Object.entries(config.vars).filter(([k]) => k.startsWith('OPERATOR_FEE_')));
}

const PRICE = '25000000'; // 25 tUSDC
const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n'; // 2 rows: fails the rows check
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };

describe.skipIf(!ready)(`the first pilots' zero operator fee on a live chain (anvil for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  let shim: { url: string; close(): Promise<void> };
  let demo: { urls: [string, string]; close(): Promise<void> };
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
    shim = await estimateShim(anvil.rpcUrl);
    const chain = new LiveChain({ deployment, rpcUrls: [shim.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: pilotFeeEnv(), live: { chain } });
    demo = await serve(world);
    for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
    expect(world.ready()).toBe(true);
  }, 180_000);
  afterAll(async () => {
    await demo?.close();
    await shim?.close();
    await anvil?.stop();
  });

  it('the live config sets every fee variable to 0, and both nodes publish the schedule at 0', async () => {
    expect(pilotFeeEnv()).toEqual({ OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0', OPERATOR_FEE_GAS: '0' });
    for (const url of demo.urls) {
      const d = (await (await fetch(`${url}/.well-known/holdback.json`)).json()) as J;
      expect(d.fees.operator).toMatchObject({ bps: 0, min: '0', max: null, appliesAt: 'agree-and-fund', refundable: false });
      expect(d.notes.join(' ')).toMatch(/Operator fee: published at 0 .* relay a funded agreement free for now/);
      expect(d.notes.join(' ')).not.toMatch(/4\.70|4\.71/);
    }
  });

  /** One deal funded from a payment address apart; `work` decides Released or Refunded. */
  async function deal(work: string, outcome: 'Released' | 'Refunded'): Promise<void> {
    const pin = pinOf(deployment);
    const fresh = () => new Agent([...demo.urls], generatePrivateKey(), nacl.randomBytes(32), pin.domain, pin.chain);
    const [buyer, seller] = [fresh(), fresh()];
    const payer = privateKeyToAccount(generatePrivateKey());
    const payment = lc(payer.address);
    const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
    const role = (r: string): string => d.demo.adjudicators.find((a: J) => a.role === r).address;
    // The faucet admits both signing keys to the club; the buyer's key's own grant pays for nothing in this deal.
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const balance = async (a: string) => BigInt(((await (await fetch(`${demo.urls[1]}/v1/balances/${a}`)).json()) as { amount: string }).amount);
    const offer = await seller.offer({
      template: 'checks-only', clubId: d.demo.clubId, seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: payment },
      adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
      price: { token: lc(deployment.token.address), amount: PRICE },
      deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' }, checks: CHECKS, timing: TIMING,
    });
    const adjudicationFee = BigInt(offer.terms.adjudication.fee.amount);
    expect(adjudicationFee).toBeGreaterThan(0n); // the adjudication fee is not waived: only the operator's
    // The payment address gets exactly the price plus the adjudication fee: any other charge would fail the funding.
    const grant = await buyer.call('POST', '/v1/faucet', { address: payment, amount: (BigInt(PRICE) + adjudicationFee).toString() });
    expect(grant.balance.amount).toBe((BigInt(PRICE) + adjudicationFee).toString());
    const sellerBefore = await balance(seller.address);
    await untilBoth(buyer, offer.id, ['AcceptedByAdjudicator'], 60_000);

    // What the buyer is asked to sign: the agreement (its signing key) and the funding (the payment address). No fee.
    const { prepared, intent, slots } = await buyer.prepareAgreeAndFund(offer.terms, BigInt(PRICE) + adjudicationFee, { paymentAddress: payment });
    expect(slots.map((s) => [s.slot, s.signer])).toEqual([['signature', buyer.address], ['fund.signature', payment]]);
    expect(prepared.sign.map((s: J) => s.slot)).toEqual(['signature', 'fund.signature']);
    expect(prepared.submit.body).not.toHaveProperty('operatorFee');
    expect(prepared.check.join(' ')).not.toMatch(/operator fee/);
    const fundSlot = slots.find((s) => s.slot === 'fund.signature')!;
    const held = await buyer.submitAgreeAndFund(prepared, intent, { 'fund.signature': await payer.signTypedData(fundSlot.typed as never) });
    expect(held.escrowState).toBe('Held');
    expect(held.hold.amount.amount).toBe((BigInt(PRICE) + adjudicationFee).toString());

    await untilBoth(seller, offer.id, ['Held'], 60_000);
    await seller.deliver(offer.terms, new TextEncoder().encode(work));
    const done = await untilBoth(buyer, offer.id, ['Released', 'Refunded'], 180_000);
    expect(done.escrowState).toBe(outcome);

    const events = (await buyer.call('GET', `/v1/commitments/${offer.id}/events?limit=200`)).items as J[];
    expect(events.map((e) => e.type)).not.toContain('fee.operator');
    if (outcome === 'Released') {
      // The buyer paid the price and the adjudication fee and nothing else; the seller received the price.
      expect(await balance(payment)).toBe(0n);
      expect((await balance(seller.address)) - sellerBefore).toBe(BigInt(PRICE));
    } else {
      // The price came back to the payment address; the adjudication fee is spent; the seller received nothing.
      expect(await balance(payment)).toBe(BigInt(PRICE));
      expect(await balance(seller.address)).toBe(sellerBefore);
    }
  }

  it('a Released deal: the buyer pays the price plus the adjudication fee, the seller receives the price', () => deal(CSV, 'Released'), 300_000);
  it('a Refunded deal: the buyer gets the price back and is down only the adjudication fee', () => deal(BAD_CSV, 'Refunded'), 300_000);
});
