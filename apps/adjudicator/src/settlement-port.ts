// The slice of the settlement layer the adjudicator service needs. simchain-adapter.ts implements it on
// the Settlement (packages/settlement/src/interface.ts) plus SimChain's reads; _sim.ts implements it
// for unit tests that inject failures.
import type {
  AdjudicatorAcceptance,
  AdjudicatorRegistration,
  Address,
  AdjudicatorRole,
  AppealGround,
  Commitment,
  Decision,
  Delivery,
  EncryptedKey,
  Hex32,
  Judgment,
  Problem,
  Result,
  Timestamp,
  TokenAmount,
} from '@holdback/core';
import type { RandomnessSource } from './randomness.js';

/** A case this adjudicator must decide now. */
export interface DecisionTask {
  commitment: Commitment;
  role: AdjudicatorRole;
  attempt: number;
  /**
   * The seller-signed delivery as posted: the adjudicator verifies the seller's signature and names its hash in the
   * decision and the record (ADR-0029). A fallback or appeal adjudicator never opens its envelopes; it uses
   * `releasedKey` (ADR-0020).
   */
  delivery: Delivery;
  /**
   * The envelope this adjudicator may open. Primary: absent (it opens its own envelope in the delivery).
   * Fallback: released by the settlement layer on fallback.triggered. Appeal: from the escalate decision
   * or the appeal filing.
   */
  releasedKey?: EncryptedKey;
  /** Settlement-layer time that fixes the beacon round: judgeBy (fallback), when the escalation or appeal was applied (appeal). */
  roundFixedAt?: Timestamp;
  /** Appeal after a first-instance decision: that decision's outcome. Absent after an escalation. */
  firstOutcome?: 'accept' | 'reject';
  /**
   * Appeal: the adjudicator whose decision brought the case here (the first-instance decider, or the one that
   * escalated). A service that made that decision already consented to the deal (T-211); absent, it has not.
   */
  firstDecider?: Address;
  /** Appeal ground the appellant named, if the settlement layer could classify it. */
  appealGround?: AppealGround;
  deadline: Timestamp;
}

/** An offer naming this adjudicator as primary, awaiting its acceptance. */
export interface OfferTask {
  commitment: Commitment;
  unencumberedBond: TokenAmount;
}

export interface AdjudicatorSettlement {
  now(): Timestamp;
  readonly randomness: RandomnessSource;
  offers(adjudicator: Hex32): Promise<OfferTask[]>;
  tasks(adjudicator: Hex32): Promise<DecisionTask[]>;
  /** Delivered cases past judgeBy where this adjudicator is the fallback and no trigger has fired. */
  takeoversDue(adjudicator: Hex32): Promise<Commitment[]>;
  /** The permissionless `trigger_fallback`. */
  triggerFallback(commitmentId: Hex32): Promise<Result<unknown, Problem>>;
  /**
   * Cases this adjudicator decided first whose appeal can now be expired, which releases its bond: no appeal by
   * appealBy, or an open appeal past appealDecideBy.
   */
  appealExpiriesDue(adjudicator: Hex32): Promise<Hex32[]>;
  /** The permissionless appeal expiry. */
  expireAppeal(commitmentId: Hex32): Promise<Result<unknown, Problem>>;
  /**
   * The bond this adjudicator could put behind its decision on the commitment now, in base units of the price token:
   * its free bond (the contract's `freeOf`) plus what the commitment already holds on it. The contract reserves a
   * fallback's bond when it decides and refuses an uncovered one (T-206 M-3); SimChain reserves it at takeover.
   */
  bondCover(adjudicator: Hex32, commitment: Commitment): Promise<bigint>;
  ciphertext(uri: string): Promise<Uint8Array>;
  /** Content-addressed publication of the judgment record; returns its URI. */
  publishRecord(record: Judgment): Promise<string>;
  submit(message: AdjudicatorAcceptance | Decision): Promise<Result<unknown, Problem>>;
  registration(address: Hex32): Promise<AdjudicatorRegistration | null>;
}
