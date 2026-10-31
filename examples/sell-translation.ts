// Sell a translation for 8 tUSD over the HTTP API. A translation has no deterministic checks, so a panel of
// judges from two model families scores it against a rubric. In the sim the judges are fake: no model runs,
// and every record says so. Run: pnpm example sell-translation (docs/quickstart.md).
import { simAgents } from './agent.ts';

const sim = await simAgents();
const seller = sim.agent('seller-2');
const buyer = sim.agent('buyer-2'); // played here so the example runs alone
const [primary, fallback, appeal] = sim.info.adjudicators.map((a: { address: string }) => a.address);
const memo = 'The goods ship on Tuesday. Payment is due within 30 days of delivery.';

const offer = await seller.call('POST', '/v1/prepare/offer', {
  template: 'default', // deterministic checks (none here), then a judge panel on the rubric
  clubId: sim.info.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: sim.identity('buyer-2').encryptionPublicKey },
  adjudicators: { primary, fallback, appeal },
  price: { token: 'tUSD', amount: '8000000' },
  deliverable: { kind: 'document', description: `Translate into French: "${memo}"`, format: 'text/plain' },
  rubric: {
    passThreshold: 300, // hundredths of a point: 3.00 of 4
    criteria: [
      { id: 'faithful', description: 'Every sentence keeps its meaning, dates and amounts.', weight: 70, anchors: { '0': 'Meaning lost', '2': 'Minor errors', '4': 'Faithful' } },
      { id: 'fluent', description: 'Reads as natural, formal French.', weight: 30, anchors: { '0': 'Unreadable', '2': 'Awkward', '4': 'Natural' } },
    ],
  },
});
await seller.submit(await seller.sign(offer));
const id = offer.commitmentId;

await buyer.waitFor(id, ['AcceptedByAdjudicator']);
await buyer.submit(await buyer.sign(await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: id })));

const french = 'Les marchandises sont expédiées mardi. Le paiement est dû dans les 30 jours suivant la livraison.';
await seller.submit(await seller.sign(await seller.prepareDelivery(id, new TextEncoder().encode(french))));

const done = await seller.waitFor(id, ['Released', 'Refunded', 'Escalated']);
console.log(`outcome: ${done.escrowState}`);
const record = await seller.call('GET', `/v1/commitments/${id}/judgment`);
const fake = record.panel.members.some((m: { model: string }) => m.model.startsWith('placeholder-'));
console.log(`panel of ${record.panel.members.length}${fake ? ', FAKE JUDGES (no model ran)' : ''}: ${record.aggregate.decision}`);
for (const m of record.panel.members) console.log(`  ${m.model} (${m.family}): ${m.verdict?.overall ?? m.status}; ${m.verdict?.rationale ?? ''}`);

// Paid on the decision; final once the appeal window closes with no appeal.
console.log(`seller balance ${(await seller.call('GET', `/v1/balances/${seller.address}`)).amount} base units; appeal window closes ${done.deadlines.appealBy}`);
const commitment = { buyer: buyer.address, primary };
for (const e of (await seller.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.reverse().filter((x: { type: string }) => x.type === 'key.released')) {
  const r = e.payload.recipient.toLowerCase();
  console.log(`key released to ${r === commitment.buyer ? 'the buyer' : r === commitment.primary ? 'the primary adjudicator' : r}`);
}
