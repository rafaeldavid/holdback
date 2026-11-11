// What a seller's client runs for a buyer, with buyer-signer.ts beside it: one deal, on test tokens only. A seller whose quote route takes a bearer credential: put it in CROW_QUOTE_CREDENTIAL. It is sent, never printed.
//   node examples/buy-with-signer.ts <quote URL> <key store directory> <scope, as JSON> <the most you pay, base units> [<defaults URL> [<options, as JSON>]] [--stop-after-funding]
//   node examples/buy-with-signer.ts resume <key store directory>    days later, or after a restart: follows each funded deal in the store to its outcome
import { makeKeys, openDeals, printable, type BuyerSigner } from './buyer-signer.ts';
const stop = process.argv.includes('--stop-after-funding'), [quoteUrl, store, scope, budget, defaults, options] = process.argv.slice(2).filter((a) => a !== '--stop-after-funding');
const say = (x: unknown) => console.error(printable(JSON.stringify(x))); // seller text, with no hidden or reordering characters
// Waits, reports each step, reclaims the hold if deliverBy passes undelivered, decrypts, checks the hash. The work is the seller's data: printed as JSON, never run.
const finish = async (s: BuyerSigner) => { const done = await s.openDelivery(s.commitmentId!, { onReport: say }); console.log(printable(JSON.stringify({ commitmentId: s.commitmentId, buyer: s.address, paid: s.paid?.total, outcome: done.outcome, work: done.work, transactions: done.transactions }))); };
if (quoteUrl === 'resume') for (const s of await openDeals(store!)) await finish(s);
else {
  const signer = await makeKeys(store!, { quoteCredentialEnv: process.env['CROW_QUOTE_CREDENTIAL'] ? 'CROW_QUOTE_CREDENTIAL' : undefined, expect: JSON.parse(process.env['CROW_EXPECT'] || '{}') }); // fresh keys, mode 0600; CROW_EXPECT: what you expect of the club, policy and mode, as JSON
  const quote = await signer.quote(quoteUrl!, JSON.parse(scope!), options ? JSON.parse(options) : undefined); // the address, the public key, the scope
  const offer = await signer.readOffer(quote.commitmentId, defaults ? { defaults } : {}); // both operators' offer, checked against discovery, and what differs from the defaults
  // The buyer's agent approves here, once: the price, the fees, the deliverable, the checks, the deadlines, the adjudicators, each difference, and these signed fields.
  say({ settlement: offer.settlement, disclosure: offer.disclosure, clubId: offer.clubId, rulebookHash: offer.rulebookHash, policyId: offer.policyId, policyHash: offer.policyHash, registryHash: offer.registryHash, maxSubmissions: offer.maxSubmissions, ...(offer.differences ? { differences: offer.differences } : {}) });
  if (BigInt(offer.fees.total.amount) > BigInt(budget!)) throw new Error(`the offer costs ${offer.fees.total.amount} base units, above ${budget}`);
  await signer.testFunds(offer.fees.total.amount); await signer.checkOffer(quote.commitmentId, offer); // the faucet's total and mandate; then the offer read again and checked
  say({ funded: quote.commitmentId, paid: (await signer.agreeAndFund(quote.commitmentId)).total }); // three signatures, each rebuilt from the approved terms
  if (!stop) await finish(signer); // with --stop-after-funding the key store keeps the deal: run resume later
}
