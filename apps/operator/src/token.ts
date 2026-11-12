// One token (the contract plan 2c; Rafa, 2026-11-12: "make sure the API only accepts USDC for now"). A deployment's rules
// contract holds one token, fixed at deploy (SC-1), and refuses any other at funding, after both parties have signed and
// with an error that names no token. So every route that takes terms refuses another token first, before it prepares
// anything to sign, and names the one it accepts. It is no new restriction (D31): terms in a token the deployment cannot
// hold are terms settlement cannot process. SimChain's world has one token too, and the same check applies there.
import type { AnyCommitmentTerms, TokenAmount } from '@holdback/core';
import type { ApiProblem } from './problems.js';

/** The token this node's deployment settles in, as discovery states it under `token`. */
export interface AcceptedToken {
  /** The token identifier in terms: the token's lowercase address on a chain, `tUSD` on SimChain. */
  id: string;
  /** What people read, such as tUSDC. */
  symbol: string;
  decimals: number;
}

/** "tUSDC (identifier 0x…, 6 decimals)": the accepted token in words, as every refusal names it. */
export const acceptedText = (t: AcceptedToken): string => `${t.symbol} (identifier ${t.id}, ${t.decimals} decimals)`;

/**
 * The one check: null when every amount in the terms is in the accepted token, else 400 invalid_terms naming the first
 * field in another token and the token this deployment accepts. `prefix` is the request path to the terms (`commitment.`
 * for a hold), so `field` points into the body the caller sent.
 */
export function tokenRefusal(accepted: AcceptedToken | undefined, t: Pick<AnyCommitmentTerms, 'price' | 'adjudication' | 'settlement'>, prefix = ''): ApiProblem | null {
  if (!accepted) return null;
  const fields: Array<[string, string | undefined]> = [
    ['price.token', t.price?.token],
    ['adjudication.fee.token', t.adjudication?.fee?.token],
    ['settlement.token', t.settlement?.token],
  ];
  for (const [field, token] of fields) {
    if (typeof token === 'string' && token.toLowerCase() === accepted.id.toLowerCase()) continue;
    return {
      type: 'invalid_terms',
      detail: `${field} is ${JSON.stringify(token ?? null)}, and this deployment settles only in ${acceptedText(accepted)}, the token its rules contract was deployed with. Price the terms in ${accepted.id}; discovery names it under token`,
      field: `${prefix}${field}`,
    };
  }
  return null;
}

/** The same check for one amount an input names on its own (a prepare route's `price` or `fee`), before terms exist. */
export function amountTokenRefusal(accepted: AcceptedToken | undefined, a: TokenAmount | undefined, field: string): ApiProblem | null {
  if (!accepted || !a || a.token.toLowerCase() === accepted.id.toLowerCase()) return null;
  return { type: 'invalid_terms', detail: `${field} is in ${JSON.stringify(a.token)}, and this deployment settles only in ${acceptedText(accepted)}, the token its rules contract was deployed with; discovery names it under token`, field };
}
