// Seller: encrypts a file for a commitment, uploads the ciphertext, seals the content key to the buyer's key from
// the terms you signed and to each adjudicator's key as every operator serves it, verifies the prepared delivery
// and submits it signed. It signs under the settlement layer the operators serve, pinned in verify.ts as the seller
// adapter pins it (SimChain, Sepolia, or HOLDBACK_DEPLOYMENT), and refuses any other (T-331).
// Usage: node examples/seal.ts <terms.json> <file>                  (terms.json: the offer you signed)
//        node examples/seal.ts <journal.json> <file> <commitmentId>  (the seller adapter's journal holds the terms)
// Env: HOLDBACK_KEY, HOLDBACK_OPERATORS (two or more, comma-separated). Uses agent.ts (Web Crypto, tweetnacl).
// Terms the adapter signed with a fresh key (signingKey "per-deal", T-432) are delivered by the key their nonce derives
// from HOLDBACK_KEY; terms naming any other seller are refused.
// The settlement layer takes one delivery per commitment: a second one is refused, so a run after the adapter
// delivered changes nothing.
import { readFileSync } from 'node:fs';
import { plain } from '@holdback/testkit';
import { help, helpAsked } from './help.ts';
import type { Hex } from 'viem';
import { pinnedSeller, signerFor } from './seller-adapter.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What the command does, its usage and one example (examples/help.ts). */
const USAGE = help('seal', import.meta.url);

/** The signed terms: the file itself, or the deal `commitmentId` in a seller adapter's journal. */
function termsFrom(path: string, commitmentId: string | undefined): J {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc === null || typeof doc !== 'object' || !('deals' in doc)) return doc;
  if (!commitmentId) throw new Error(`${path} is a journal: name the commitment ID too`);
  const deal = Object.hasOwn(doc.deals, commitmentId.toLowerCase()) ? doc.deals[commitmentId.toLowerCase()] : undefined;
  if (!deal) throw new Error(`${path} holds no deal ${commitmentId}`);
  return deal.terms;
}

const [termsFile, file, commitmentId] = process.argv.slice(2);
const asked = helpAsked(process.argv.slice(2));
if (asked !== null || !termsFile || !file) {
  (asked === 0 ? console.log : console.error)(USAGE);
  process.exit(asked ?? 2);
}
try {
  const operators = (process.env['HOLDBACK_OPERATORS'] ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',').filter(Boolean);
  const { pin } = await pinnedSeller(operators, process.env['HOLDBACK_KEY']);
  const terms = termsFrom(termsFile, commitmentId);
  // HOLDBACK_KEY's own agent, or the deal key the terms' nonce derives when the adapter signed with one (T-432).
  const signer = signerFor(process.env['HOLDBACK_KEY'] as Hex, operators, pin, terms);
  const state = await signer.deliver(terms, new Uint8Array(readFileSync(file)));
  console.log(JSON.stringify({ escrowState: state.escrowState }));
} catch (e) {
  console.error(`seal: ${plain((e as Error).message)}`);
  process.exit(2);
}
