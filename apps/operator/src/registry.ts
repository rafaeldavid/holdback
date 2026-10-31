// What an operator serves about clubs, agents, members and adjudicators. Phase 1 has no run-time registration:
// SimChain reads them from genesis, so these reads serve genesis (docs/backlog.md, source T-006 and T-007).
import type { Address, Club, Mandate, TokenAmount } from '@holdback/core';
import type { SimChain } from '@holdback/settlement/sim';

export interface AdjudicatorView {
  address: Address;
  /** Bond pool (ADR-0014 §2a): junior is the adjudicator's own stake, reserved the open exposure. */
  bond: { junior: TokenAmount; senior: TokenAmount; reserved: TokenAmount };
}

export interface Registry {
  /** The chain ID agents sign under (EIP-712 domain). */
  chainId: number;
  clubs: readonly Club[];
  mandates: readonly Mandate[];
  members: ReadonlyArray<{ clubId: string; member: Address }>;
  /** Registered adjudicators, oldest first. */
  adjudicators(): AdjudicatorView[];
  /** Test funding (POST /v1/test/faucet); SimChain or testnet only. */
  faucet?(address: Address, amount: bigint): Promise<TokenAmount>;
}

export function simRegistry(chain: SimChain): Registry {
  const g = chain.genesis;
  const amount = (v: bigint): TokenAmount => ({ token: g.token, amount: v.toString() as TokenAmount['amount'] });
  return {
    chainId: g.chainId,
    clubs: g.clubs,
    mandates: g.mandates,
    members: g.members,
    adjudicators: () =>
      Object.keys(g.bonds).map((a) => {
        const p = chain.pool(a as Address);
        return { address: a as Address, bond: { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved) } };
      }),
    faucet: async (address, value) => {
      chain.faucet(address, value);
      return (await chain.balances([address]))[address]!;
    },
  };
}
