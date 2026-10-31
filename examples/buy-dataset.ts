// Buy a cleaned dataset for 25 tUSD over the HTTP API. Acceptance is a set of declarative checks, so no model
// judges this deal: the checks alone decide. Every prepared message is verified against the agent's own
// intent before it is signed (verify.ts). Run: pnpm example buy-dataset (docs/quickstart.md).
import { simAgents } from './agent.ts';

const sim = await simAgents(); // the world `pnpm sim` started: operators, adjudicators, fresh test accounts
const buyer = await sim.fresh();
const seller = await sim.fresh(); // the other side, played here so the example runs alone
const [primary, fallback, appeal] = sim.info.adjudicators.map((a) => a.address);

// 1. Seller: the operator fills the terms from a template and the adjudicator's registration; the seller
//    rebuilds them from its own request, checks them against both operators, signs and submits.
const offer = await seller.offer({
  template: 'checks-only',
  clubId: sim.info.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey }, // sent by the buyer
  adjudicators: { primary, fallback, appeal },
  price: { token: 'tUSD', amount: '25000000' }, // 25 tUSD: 6 decimals
  deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
  checks: [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
    { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
  ],
});
console.log(`offer ${offer.id}: ${offer.state.escrowState}`);

// 2. Buyer: checks the terms the seller sent (its address, its key, its budget), waits for the primary's
//    acceptance, then agrees and holds price plus fee in one signed call.
await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
const held = await buyer.agreeAndFund(offer.terms, 30_000_000n); // at most 30 tUSD
console.log(`held: ${held.escrowState}, ${held.hold.amount.amount} base units`);

// 3. Seller: encrypt, upload, seal the key to each adjudicator and the buyer, sign the delivery.
const csv = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
await seller.deliver(offer.terms, new TextEncoder().encode(csv));

// 4. The adjudicator runs the checks; on accept, payment and the buyer's key are released together.
const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);
console.log(`outcome: ${done.escrowState}`);
if (done.escrowState === 'Released') console.log(`buyer opened:\n${(await buyer.openDelivery(offer.id)).trimEnd()}`);
const balance = async (a: typeof buyer) => (await a.call('GET', `/v1/balances/${a.address}`)).amount;
console.log(`balances (base units): buyer ${await balance(buyer)}, seller ${await balance(seller)}`);
