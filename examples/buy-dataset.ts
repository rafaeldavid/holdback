// Buy a cleaned dataset for 25 tUSD over the HTTP API. Acceptance is a set of declarative checks, so no model
// judges this deal: the checks alone decide. Run: pnpm example buy-dataset (docs/quickstart.md).
import { simAgents } from './agent.ts';

const sim = await simAgents(); // the world `pnpm sim` started: operators, test accounts, adjudicators
const buyer = sim.agent('buyer-1');
const seller = sim.agent('seller-1'); // the other side, played here so the example runs alone
const [primary, fallback, appeal] = sim.info.adjudicators.map((a: { address: string }) => a.address);

// 1. Seller: the operator fills the terms from a template and the adjudicator's registration; the seller
//    checks them, signs, and submits the offer.
const offer = await seller.call('POST', '/v1/prepare/offer', {
  template: 'checks-only',
  clubId: sim.info.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: sim.identity('buyer-1').encryptionPublicKey },
  adjudicators: { primary, fallback, appeal },
  price: { token: 'tUSD', amount: '25000000' }, // 25 tUSD: 6 decimals
  deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
  checks: [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
    { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
  ],
});
console.log(offer.check.map((c: string) => `  check: ${c}`).join('\n')); // verify before you sign
await seller.submit(await seller.sign(offer));
const id = offer.commitmentId;

// 2. Buyer: once the primary adjudicator accepts, agree and hold price plus fee in one signed call.
await buyer.waitFor(id, ['AcceptedByAdjudicator']);
const held = await buyer.submit(await buyer.sign(await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: id })));
console.log(`held: ${held.escrowState}, ${held.hold.amount.amount} base units`);

// 3. Seller: encrypt, upload, seal the key to each adjudicator and the buyer, sign the delivery.
const csv = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
await seller.submit(await seller.sign(await seller.prepareDelivery(id, new TextEncoder().encode(csv))));

// 4. The adjudicator runs the checks; on accept, payment and the buyer's key are released together.
const done = await buyer.waitFor(id, ['Released', 'Refunded']);
console.log(`outcome: ${done.escrowState}`);
if (done.escrowState === 'Released') console.log(`buyer opened:\n${(await buyer.openDelivery(id)).trimEnd()}`);
const balance = async (a: typeof buyer) => (await a.call('GET', `/v1/balances/${a.address}`)).amount;
console.log(`balances (base units): buyer ${await balance(buyer)}, seller ${await balance(seller)}`);
