// Sell a translation for 8 tUSD over the HTTP API. A translation has no deterministic checks, so a panel of
// judges from two model families scores it against a rubric. In the sim the judges are fake: no model runs,
// and every record says so. Run: pnpm example sell-translation (docs/quickstart.md).
import { simAgents } from './agent.ts';

const sim = await simAgents();
const seller = await sim.fresh();
const buyer = await sim.fresh(); // played here so the example runs alone
const [primary, fallback, appeal] = sim.info.adjudicators.map((a) => a.address);
const memo = 'The goods ship on Tuesday. Payment is due within 30 days of delivery.';

const offer = await seller.offer({
  template: 'default', // deterministic checks (none here), then a judge panel on the rubric
  clubId: sim.info.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
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

await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
await buyer.agreeAndFund(offer.terms, 10_000_000n);

// Put FAIL-ME in the text to see the fake panel reject it, and the refund.
const french = 'Les marchandises sont expédiées mardi. Le paiement est dû dans les 30 jours suivant la livraison.';
await seller.deliver(offer.terms, new TextEncoder().encode(french));

const done = await seller.waitFor(offer.id, ['Released', 'Refunded', 'Escalated']);
console.log(`outcome: ${done.escrowState}`);
const record = await seller.call('GET', `/v1/commitments/${offer.id}/judgment`);
const fake = record.panel.members.some((m: { model: string }) => m.model.startsWith('placeholder-'));
console.log(`panel of ${record.panel.members.length}${fake ? ', FAKE JUDGES (no model ran)' : ''}: ${record.aggregate.decision}`);
for (const m of record.panel.members) console.log(`  ${m.model} (${m.family}): ${m.verdict?.overall ?? m.status}; ${m.verdict?.rationale ?? ''}`);

// Paid on the decision; final once the appeal window closes with no appeal.
console.log(`seller balance ${(await seller.call('GET', `/v1/balances/${seller.address}`)).amount} base units; appeal window closes ${done.deadlines['appealBy']}`);
for (const e of (await seller.call('GET', `/v1/commitments/${offer.id}/events?limit=200`)).items.reverse().filter((x: { type: string }) => x.type === 'key.released')) {
  const r = e.payload.recipient.toLowerCase();
  console.log(`key released to ${r === buyer.address ? 'the buyer' : r === primary!.toLowerCase() ? 'the primary adjudicator' : r}`);
}
