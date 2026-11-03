// D23 amends ADR-0019: a co-signed mutual settlement pays the held price to any addresses both parties
// sign for, in any split that sums to the price. These checks need the terms and the rulebook, so they
// sit beside the parser rather than in it. The settlement layer applies them before any posting.
import { tokenAmount } from './money/index.js';
import type { CommitmentTerms, MutualSettlement, Rulebook } from './types.js';

type Terms = Pick<CommitmentTerms, 'buyer' | 'seller' | 'price'>;
type Rule = Pick<Rulebook['mutualSettlement'], 'allowed' | 'payoutsTo'>;

/** Why a parsed MutualSettlement cannot settle these terms under this rule, or undefined if it can. */
export function mutualSettlementProblem(m: MutualSettlement, terms: Terms, rule: Rule): string | undefined {
  if (!rule.allowed) return 'mutual settlement is not allowed by the rulebook';
  const parties = new Set([terms.buyer.toLowerCase(), terms.seller.toLowerCase()]);
  let sum = 0n;
  for (const p of m.payouts) {
    if (p.amount.token !== terms.price.token) return `payout to ${p.to} is in ${p.amount.token}, not the price token ${terms.price.token}`;
    if (rule.payoutsTo === 'parties' && !parties.has(p.to.toLowerCase())) return `payout recipient ${p.to} is not a party, and the rulebook allows payouts to the parties only`;
    const a = tokenAmount(p.amount.token, p.amount.amount);
    if (!a.ok) return `payout to ${p.to} is not a valid amount`;
    sum += BigInt(p.amount.amount);
  }
  if (sum !== BigInt(terms.price.amount)) return `payouts total ${sum} but must equal the price ${terms.price.amount}`;
  return undefined;
}
