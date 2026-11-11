// What a seller's client runs for a buyer, with buyer-signer.ts beside it: one deal, on test tokens only.
//   node examples/buy-with-signer.ts <quote URL> <key store directory> <scope, as JSON> <the most you pay, base units> [<defaults URL> [<options, as JSON>]]
// A seller whose quote route takes a bearer credential: put it in CROW_QUOTE_CREDENTIAL. It is sent, never printed.
import { makeKeys } from './buyer-signer.ts';
const [quoteUrl, store, scope, budget, defaults, options] = process.argv.slice(2);
const signer = await makeKeys(store!, { quoteCredentialEnv: process.env['CROW_QUOTE_CREDENTIAL'] ? 'CROW_QUOTE_CREDENTIAL' : undefined }); // fresh keys, mode 0600
const quote = await signer.quote(quoteUrl!, JSON.parse(scope!), options ? JSON.parse(options) : undefined); // the address, the public key, the scope
const offer = await signer.readOffer(quote.commitmentId, defaults ? { defaults } : {}); // both operators' offer, and what differs from the defaults
// The buyer's agent approves here, once: the price, the fees, the deliverable, the checks, the deadlines, the adjudicators, each difference.
if (offer.differences) console.error(JSON.stringify({ differences: offer.differences }));
if (BigInt(offer.fees.total.amount) > BigInt(budget!)) throw new Error(`the offer costs ${offer.fees.total.amount} base units, above ${budget}`);
await signer.testFunds(offer.fees.total.amount); // the test service's faucet: the deal's total and a mandate
await signer.checkOffer(quote.commitmentId, offer); // reads it again; refuses anything that differs from what was shown and approved
const paid = await signer.agreeAndFund(quote.commitmentId); // three signatures, each rebuilt from the approved terms
// Waits, reports each step on stderr, reclaims the hold if deliverBy passes undelivered, decrypts, checks the hash.
const done = await signer.openDelivery(quote.commitmentId, { onReport: (r) => console.error(JSON.stringify(r)) });
// The work is the seller's data: print it as JSON, never run it.
console.log(JSON.stringify({ commitmentId: quote.commitmentId, buyer: signer.address, paid: paid.total, outcome: done.outcome, work: done.work, transactions: done.transactions }));
