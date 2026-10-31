// Relay policies (ADR-0005). An operator node may refuse to relay anything, for its own reasons: a party it
// will not serve, a jurisdiction, a load limit. A refusal is the operator's choice, not the protocol's: the
// signed message stays valid, so the SDK fails over to another operator or submits it directly to the
// settlement layer, and the commitment settles on its terms (neutrality.operator-refuses).
import { problem, type Problem } from '@holdback/core';
import type { Operation } from '@holdback/sdk';

/** What the operator knows about the commitment an operation touches, from the operation or its event log. */
export interface PolicyContext {
  /** Lower-case addresses; absent when the operator has not seen the commitment offered. */
  parties?: { buyer: string; seller: string; adjudicators: string[] };
  /** The address that signed the operation, when the operation names one. */
  signer?: string;
}

export type RelayPolicy = (op: Operation, ctx: PolicyContext) => Problem | undefined;

/**
 * Refuses every operation on a commitment where one of `addresses` is the buyer or the seller, and every
 * operation one of them signs. Answers 403 `member_not_admitted`: this node does not admit the party to its
 * relay. Nothing on the settlement layer changes.
 */
export function refuseParties(addresses: readonly string[], detail?: string): RelayPolicy {
  const refused = new Set(addresses.map((a) => a.toLowerCase()));
  return (_op, ctx) => {
    const hit = [ctx.parties?.buyer, ctx.parties?.seller, ctx.signer].find((a) => a !== undefined && refused.has(a.toLowerCase()));
    if (!hit) return undefined;
    return problem('member_not_admitted', detail ?? `operator policy: this node does not relay for ${hit}; the signed message is still valid at any other operator or the settlement layer`);
  };
}
