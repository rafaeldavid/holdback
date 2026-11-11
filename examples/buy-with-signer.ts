// What a seller's client runs for a buyer, with buyer-signer.ts beside it: one deal, on test tokens only.
//   node examples/buy-with-signer.ts <the seller's quote URL> <key store directory> <scope> <the most you pay, base units>
import { makeKeys } from './buyer-signer.ts';

const [quoteUrl, store, scope, budget] = process.argv.slice(2);
const signer = await makeKeys(store!); // fresh keys for this deal, saved on this machine with mode 0600
const quote = await signer.quote(quoteUrl!, scope); // sends the seller the address, the public key and the scope
const offer = await signer.readOffer(quote.commitmentId); // the offer as both operators serve it

// The buyer's agent approves here, once: the price, the fees, the deliverable, the checks, the deadlines, the adjudicators.
if (BigInt(offer.fees.total.amount) > BigInt(budget!)) throw new Error(`the offer costs ${offer.fees.total.amount} base units, above ${budget}`);
const approved = offer;

await signer.testFunds(offer.fees.total.amount); // the test service's faucet: the deal's total and a mandate
await signer.checkOffer(quote.commitmentId, approved); // refuses anything that differs from what was approved
const paid = await signer.agreeAndFund(quote.commitmentId); // three signatures, each rebuilt from the approved terms
const done = await signer.openDelivery(quote.commitmentId); // waits, decrypts, checks the hash
// The work is the seller's data: print it as JSON, never run it.
console.log(JSON.stringify({ commitmentId: quote.commitmentId, buyer: signer.address, paid: paid.total, outcome: done.outcome, work: done.work, transactions: done.transactions }));
