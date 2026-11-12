// Terms presets. A draft describes the job (what, how it is accepted, the price, who adjudicates) with windows
// in seconds; POST /v1/prepare/offer (prepare.ts) completes it with what the operator reads: the club's rulebook hash, and the
// primary adjudicator's policy ID, policy hash, registry hash and minimum fee from its published registration.
// Nobody computes a hash by hand.
import { plusSeconds, type AcceptanceSpec, type Address, type CommitmentTerms, type Deliverable, type DeterministicCheck, type Hex32, type Timestamp, type TokenAmount } from '@holdback/core';
import type { PartyIdentity } from './accounts.js';

/** The three adjudicators the two parties chose, by address. */
export interface AdjudicatorSlate {
  primary: Address;
  fallback: Address;
  appeal: Address;
}

/** Windows in whole seconds: the first three count from createdAt, judge from deliverBy, fallback from judgeBy. */
export interface RelativeTiming {
  offerExpiresInSec: number;
  fundWithinSec: number;
  deliverWithinSec: number;
  judgeWithinSec: number;
  fallbackWithinSec: number;
  appealWindowSec: number;
  appealDecideSec: number;
}

/**
 * 15 minutes to accept, 30 to fund, a day to deliver, 5 minutes for each adjudicator, and no party appeal: phase one
 * has none and requires an appeal window of 0 (ADR-0033 §2b). An agent on the full protocol (SimChain) names its own.
 */
export const DEFAULT_TIMING: RelativeTiming = {
  offerExpiresInSec: 900,
  fundWithinSec: 1800,
  deliverWithinSec: 86_400,
  judgeWithinSec: 300,
  fallbackWithinSec: 300,
  appealWindowSec: 0,
  appealDecideSec: 300,
};

export interface TermsInput {
  clubId: string;
  /** The buyer's address and encryption key, as the buyer gave them to the seller. */
  buyer: PartyIdentity;
  adjudicators: AdjudicatorSlate;
  price: TokenAmount;
  deliverable: Deliverable;
  /** Declarative checks that run first (no code). Default: none. */
  checks?: DeterministicCheck[];
  /** What the judge panel scores. passThreshold is in hundredths of a point (300 = 3.00 of 4). */
  rubric?: AcceptanceSpec['rubric'];
  /** The adjudication fee. Default: the primary adjudicator's published minimum. */
  fee?: TokenAmount;
  timing?: Partial<RelativeTiming>;
}

export interface TermsDraft {
  clubId: string;
  buyer: PartyIdentity;
  adjudicators: AdjudicatorSlate;
  price: TokenAmount;
  deliverable: Deliverable;
  acceptance: AcceptanceSpec;
  fee?: TokenAmount;
  timing: RelativeTiming;
}

function draft(input: TermsInput, acceptance: AcceptanceSpec): TermsDraft {
  return {
    clubId: input.clubId,
    buyer: { ...input.buyer },
    adjudicators: { ...input.adjudicators },
    price: { ...input.price },
    deliverable: structuredClone(input.deliverable),
    acceptance: structuredClone(acceptance),
    ...(input.fee ? { fee: { ...input.fee } } : {}),
    timing: { ...DEFAULT_TIMING, ...input.timing },
  };
}

/** Terms judged by checks and a panel: any `checks` first, then the rubric. Needs a rubric with criteria. */
export function defaultTerms(input: TermsInput): TermsDraft {
  if (!input.rubric || input.rubric.criteria.length === 0) throw new TypeError('defaultTerms needs a rubric with at least one criterion; use checksOnlyTerms when the checks decide alone');
  return draft(input, { deterministicChecks: input.checks ?? [], rubric: input.rubric });
}

/** Terms decided by deterministic checks alone: no panel sits, so no model judges the work. */
export function checksOnlyTerms(input: Omit<TermsInput, 'rubric'> & { checks: DeterministicCheck[] }): TermsDraft {
  if (input.checks.length === 0) throw new TypeError('checksOnlyTerms needs at least one deterministic check');
  return draft(input, { deterministicChecks: input.checks, rubric: { criteria: [], passThreshold: 0 } });
}

/** What the offer adds to a draft: the seller, and the hashes and fee read from the club and the adjudicator. */
export interface ResolvedTerms {
  seller: Address;
  rulebookHash: Hex32;
  policyId: string;
  policyHash: Hex32;
  registryHash: Hex32;
  fee: TokenAmount;
  nonce: Hex32;
  /** Whole seconds, settlement-layer time. */
  createdAt: Timestamp;
}

/** The full commitment terms (commitment.schema.json without id and signatures). */
export function completeTerms(d: TermsDraft, r: ResolvedTerms): CommitmentTerms {
  const ms = Date.parse(r.createdAt);
  if (!Number.isFinite(ms) || ms % 1000 !== 0) throw new RangeError(`createdAt ${r.createdAt} must be a whole-second timestamp`);
  const createdAt = plusSeconds(r.createdAt, 0);
  const deliverBy = plusSeconds(createdAt, d.timing.deliverWithinSec);
  const judgeBy = plusSeconds(deliverBy, d.timing.judgeWithinSec);
  return {
    schemaVersion: '0.8',
    clubId: d.clubId,
    rulebookHash: r.rulebookHash,
    buyer: d.buyer.address,
    seller: r.seller,
    // ADR-0033 §7: with no separate address named, each defaults to its party's signing address. The prepare routes'
    // inputs for a separate address are the operator package's (R6c-2).
    buyerPaymentAddress: d.buyer.address,
    sellerPayoutAddress: r.seller,
    deliverable: structuredClone(d.deliverable),
    acceptance: structuredClone(d.acceptance),
    price: { ...d.price },
    adjudication: {
      adjudicator: d.adjudicators.primary,
      fallbackAdjudicator: d.adjudicators.fallback,
      appealAdjudicator: d.adjudicators.appeal,
      policyId: r.policyId,
      fee: { ...(d.fee ?? r.fee) },
      registryHash: r.registryHash,
      policyHash: r.policyHash,
    },
    timing: {
      offerExpiresAt: plusSeconds(createdAt, d.timing.offerExpiresInSec),
      fundBy: plusSeconds(createdAt, d.timing.fundWithinSec),
      deliverBy,
      judgeBy,
      fallbackBy: plusSeconds(judgeBy, d.timing.fallbackWithinSec),
      appealWindowSec: d.timing.appealWindowSec,
      appealDecideSec: d.timing.appealDecideSec,
      maxSubmissions: 1,
    },
    settlement: { mode: 'guaranteed_on_decision', token: d.price.token },
    remedy: { onReject: 'full_refund' },
    disclosure: { level: 'public' },
    buyerEncryptionPublicKey: d.buyer.encryptionPublicKey,
    nonce: r.nonce,
    createdAt,
  };
}
