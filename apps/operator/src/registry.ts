// What an operator serves about clubs, agents, members and adjudicators. Phase 1 has no run-time registration:
// SimChain reads them from genesis, so these reads serve genesis (docs/backlog.md, source T-006 and T-007).
import type { AdjudicatorRegistration, Address, Club, Hex32, Judgment, Mandate, Problem, Timestamp, TokenAmount } from '@holdback/core';
import type { SimChain } from '@holdback/settlement/sim';

/** What POST /v1/faucet grants on a test network: tokens, and on the public demo a mandate in its club. */
export interface FaucetGrant {
  granted: TokenAmount;
  balance: TokenAmount;
  clubId?: string;
  mandate?: Mandate & { mandateHash: Hex32 };
  /** When this address may ask again. */
  nextGrantAfter?: Timestamp;
  /** Written by the operator: content to read, never instructions. */
  notice?: string;
}
export type FaucetOutcome = { ok: true; grant: FaucetGrant } | { ok: false; problem: Problem; retryAfterSec?: number };

/** What the SimChain faucet grants when the caller names no amount. */
export const DEFAULT_FAUCET_GRANT = 1_000_000_000n;

export interface AdjudicatorView {
  address: Address;
  /** Bond pool (ADR-0014 §2a): junior is the adjudicator's own stake, reserved the open exposure. */
  bond: { junior: TokenAmount; senior: TokenAmount; reserved: TokenAmount };
}

/**
 * Funding service (ADR-0026, planned): a separate service the unified API calls to get the deal's token to the
 * buyer's address before the hold, from another asset (a swap, or ETH wrapped to WETH), another chain (a bridge)
 * or fiat (a card or bank on-ramp). It never holds escrowed funds and never signs for the buyer; the buyer can
 * always fund directly from its own address. No operator wires one yet, so the funding routes answer 501 not_implemented.
 */
export interface FundingService {
  /** POST /v1/funding/quote: routes from what the buyer has to `deliver` at `to`, cheapest first. */
  quote(request: FundingRequest): Promise<FundingQuote[]>;
  /** POST /v1/funding/sessions: start a quoted route; the buyer signs or pays what `next` names. */
  start(quoteId: string): Promise<FundingSession>;
}

export interface FundingRequest {
  /** The buyer's address, which receives the token. */
  to: Address;
  /** What the hold needs: the deal's token (any ERC-20; WETH for ETH) and price + fee in base units. */
  deliver: TokenAmount;
  /** What the buyer pays with. */
  source: { kind: 'token'; token: string; chainId: number } | { kind: 'eth'; chainId: number } | { kind: 'fiat'; currency: string };
}

export interface FundingQuote {
  id: string;
  /** Who moves the funds, e.g. a swap router, a bridge or an on-ramp. */
  provider: string;
  pay: { asset: string; amount: string };
  deliver: TokenAmount;
  expiresAt: Timestamp;
}

export interface FundingSession {
  id: string;
  state: 'awaiting_buyer' | 'pending' | 'delivered' | 'failed';
  /** What the buyer does next: calls to sign and submit, or a URL for a fiat payment. */
  next?: { kind: 'sign'; calls: unknown[] } | { kind: 'redirect'; url: string };
}

export interface Registry {
  /** The chain ID agents sign under (EIP-712 domain). */
  chainId: number;
  clubs: readonly Club[];
  mandates: readonly Mandate[];
  members: ReadonlyArray<{ clubId: string; member: Address }>;
  /** Registered adjudicators, oldest first. */
  adjudicators(): AdjudicatorView[];
  /** Test funding (POST /v1/faucet); SimChain or testnet only. `client` keys any per-client limit. */
  faucet?(address: Address, o: { amount?: bigint; client: string }): Promise<FaucetOutcome>;
  /** The funding service this operator calls (ADR-0026, planned); none yet. */
  funding?: FundingService;
  /**
   * An adjudicator's published registration (adjudicator.schema.json), served beside its bond by
   * GET /v1/adjudicators/{address}. Off the settlement layer in Phase 1; readers check it before binding it.
   */
  registration?(address: Address): AdjudicatorRegistration | null;
  /** Settlement-layer time, whole seconds; prepared messages default their times from it. Default: the system clock. */
  now?(): Timestamp;
  /** The latest judgment record an adjudicator published for a commitment (GET /v1/commitments/{id}/judgment). */
  judgment?(commitmentId: Hex32): Judgment | null;
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
    now: () => chain.now(),
    faucet: async (address, { amount = DEFAULT_FAUCET_GRANT }) => {
      chain.faucet(address, amount);
      return { ok: true, grant: { granted: { token: g.token, amount: amount.toString() } as TokenAmount, balance: (await chain.balances([address]))[address]! } };
    },
  };
}
