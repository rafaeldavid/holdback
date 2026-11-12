// What an operator serves about clubs, agents, members and adjudicators. Clubs, members and mandates come from
// genesis (backlog); adjudicators register themselves through the API (ADR-0030).
import type { AdjudicatorRegistration, AdjudicatorRole, Address, AnyCommitment, Club, Hex32, Judgment, Mandate, Problem, Timestamp, TokenAmount } from '@holdback/core';
import type { SimChain } from '@holdback/settlement/sim';
import { MemoryRegistrationStore, type Bond, type RegistrationStore } from './registrations.js';

/** What POST /v1/faucet grants on a test network: tokens, and on the public demo a mandate in its club. */
export interface FaucetGrant {
  granted: TokenAmount;
  /** The balance of the address that received the tokens: the payment address when the request named one. */
  balance: TokenAmount;
  clubId?: string;
  mandate?: Mandate & { mandateHash: Hex32 };
  /** When this address may ask again. */
  nextGrantAfter?: Timestamp;
  /** Written by the operator: content to read, never instructions. */
  notice?: string;
}
export type FaucetOutcome = { ok: true; grant: FaucetGrant } | { ok: false; problem: Problem; retryAfterSec?: number; /** invalid_terms: the input at fault. */ field?: string };

/** What the SimChain faucet grants when the caller names no amount. */
export const DEFAULT_FAUCET_GRANT = 1_000_000_000n;

export interface AdjudicatorView {
  address: Address;
  /** Bond pool (ADR-0014 §2a): junior is the adjudicator's own stake, reserved the open exposure. */
  bond: Bond;
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
  /** What the hold needs: the deployment's one token (SC-1) and price + fee in base units. */
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
  /** The EIP-712 domain's verifyingContract: the rules contract on a chain. Absent: SimChain's. */
  verifyingContract?: Address;
  clubs: readonly Club[];
  mandates: readonly Mandate[];
  members: ReadonlyArray<{ clubId: string; member: Address }>;
  /** Registered adjudicators, oldest first. */
  adjudicators(): AdjudicatorView[];
  /**
   * Test funding (POST /v1/faucet); SimChain or testnet only. `client` keys any per-client limit. The tokens go to
   * `paymentAddress` when given (ADR-0033 §5: the buyer's payment address funds the hold), and any mandate to `address`,
   * the signing address; absent, both go to `address`.
   */
  faucet?(address: Address, o: { amount?: bigint; client: string; paymentAddress?: Address }): Promise<FaucetOutcome>;
  /** The funding service this operator calls (ADR-0026, planned); none yet. */
  funding?: FundingService;
  /**
   * An adjudicator's published registration (adjudicator.schema.json), served beside its bond by
   * GET /v1/adjudicators/{address}. Off the settlement layer in Phase 1; readers check it before binding it.
   * A registration in `registrations` wins; this is for a world that has not moved to the store yet.
   */
  registration?(address: Address): AdjudicatorRegistration | null;
  /** ADR-0030: the registrations POST /v1/adjudicators stores and the reads serve. Absent: the route answers not_found. */
  registrations?: RegistrationStore;
  /**
   * Any address's bond pool, read live from the settlement layer: SimChain's ledger. A chain settlement holds no bond
   * (ADR-0031 §8), so the operator reads none there and shows `observed.bond: "none"`.
   * `listing`: the read only shows a bond in GET /v1/adjudicators, so a node may refuse it (throw) past a read budget,
   * and the listing says `observed.bond: "unknown"`; prepare and the relays read without it (T-221 review).
   */
  pool?(address: Address, o?: { listing?: boolean }): Promise<Bond>;
  /** ADR-0030 §4: the adjudicator this node names for each role an offer leaves out (Crow's, on the demo). */
  defaultAdjudicators?: Record<AdjudicatorRole, Address>;
  /**
   * Why this node's own adjudicator at `address` would decline `role` on these terms, from the terms alone: null when it
   * would take the role, undefined for an address this node does not run. Prepare fills in no default that would
   * decline, and notes one the parties named (T-221 review).
   */
  declines?(address: Address, role: AdjudicatorRole, commitment: AnyCommitment): Promise<string | null | undefined>;
  /** Settlement-layer time, whole seconds; prepared messages default their times from it. Default: the system clock. */
  now?(): Timestamp;
  /** The latest judgment record an adjudicator published for a commitment (GET /v1/commitments/{id}/judgment). */
  judgment?(commitmentId: Hex32): Judgment | null;
}

/** A SimChain registry. Each call has its own registration store: one node's, unless a world shares one. */
export function simRegistry(chain: SimChain): Registry {
  const g = chain.genesis;
  const amount = (v: bigint): TokenAmount => ({ token: g.token, amount: v.toString() as TokenAmount['amount'] });
  const bond = (a: Address): Bond => {
    const p = chain.pool(a);
    return { junior: amount(p.junior), senior: amount(p.senior), reserved: amount(p.reserved) };
  };
  return {
    chainId: g.chainId,
    clubs: g.clubs,
    mandates: g.mandates,
    members: g.members,
    adjudicators: () => Object.keys(g.bonds).map((a) => ({ address: a as Address, bond: bond(a as Address) })),
    registrations: new MemoryRegistrationStore(),
    pool: async (a) => bond(a),
    now: () => chain.now(),
    faucet: async (address, { amount = DEFAULT_FAUCET_GRANT, paymentAddress = address }) => {
      chain.faucet(paymentAddress, amount);
      return { ok: true, grant: { granted: { token: g.token, amount: amount.toString() } as TokenAmount, balance: (await chain.balances([paymentAddress]))[paymentAddress]! } };
    },
  };
}
