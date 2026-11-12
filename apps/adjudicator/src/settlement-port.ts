// The slice of the settlement layer the adjudicator service needs. simchain-adapter.ts implements it on
// the Settlement (packages/settlement/src/interface.ts) plus SimChain's reads; _sim.ts implements it
// for unit tests that inject failures.
import type {
  AdjudicatorAcceptance,
  AdjudicatorPolicy,
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
  // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
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
  /**
   * True on the phase-one contracts (ADR-0031 §8, D57): no bonds and no party appeals, so an acceptance reserves 0, a
   * first decision is final at once, and there is no appeal to expire or bond to cover. Absent or false: the full
   * protocol, as SimChain keeps it.
   */
  readonly phaseOne?: boolean;
  now(): Timestamp;
  /**
   * The beacon the commitment's club rulebook names (ADR-0018 §6, T-217): its clock and its rounds. null when this port
   * cannot read that source; never another source in its place.
   */
  randomness(commitment: Commitment): RandomnessSource | null;
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
  // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
  expireAppeal(commitmentId: Hex32): Promise<Result<unknown, Problem>>;
  /**
   * The bond this adjudicator could put behind its decision on the commitment now, in base units of the price token:
   // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
   * its free bond (the contract's `freeOf`) plus what the commitment already holds on it. The contract reserves a
   * fallback's bond when it decides and refuses an uncovered one (T-206 M-3); SimChain reserves it at takeover.
   */
  bondCover(adjudicator: Hex32, commitment: Commitment): Promise<bigint>;
  ciphertext(uri: string): Promise<Uint8Array>;
  /** Content-addressed publication of the judgment record; returns its URI. */
  publishRecord(record: Judgment): Promise<string>;
  submit(message: AdjudicatorAcceptance | Decision): Promise<Result<unknown, Problem>>;
  registration(address: Hex32): Promise<AdjudicatorRegistration | null>;
  /**
   * A policy by its hash, from a store that keeps every policy a registration ever carried (T-221 review). The terms
   * bind only the primary's policy hash, and the primary can register a new policy after agreement, so a fallback or
   * appeal adjudicator reads the bound one here. null when none is kept. Absent: only the latest registration is read.
   */
  policy?(hash: Hex32): Promise<AdjudicatorPolicy | null>;
}
