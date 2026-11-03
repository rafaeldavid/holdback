// The settlement layer as the operator API and SDK see it (docs/architecture.md, Settlement interface).
// SimChain implements it in process; EvmSettlement (evm/) implements it on a local chain with the same shape.
// Every state change arrives as a message a party or adjudicator signed, or as a permissionless trigger.
// The settlement layer never authors a party's message.
import type {
  AdjudicatorAcceptance,
  Agree,
  Address,
  AnyCommitment,
  Appeal,
  CommitmentStateView,
  Decision,
  Delivery,
  EarlyAccept,
  EncryptedKey,
  FundingAuthorization,
  Hex32,
  MutualSettlement,
  Problem,
  SettlementEvent,
  Signature,
  TokenAmount,
  TransferAuthorization,
} from '@holdback/core';

/**
 * Permissionless timeouts (ADR-0007). Anyone may call them; each is refused until its deadline.
 * - expire_offer: Offered, AcceptedByAdjudicator or Agreed past its deadline
 * - reclaim: Held past deliverBy with no delivery
 * - fallback: Delivered past judgeBy
 * - default: FallbackJudging past fallbackBy, or Escalated past appealDecideBy
 * - apply_default: Defaulted; refunds the buyer and pays the seller's compensation from bonds
 * - appeal_expiry: the appeal window or the open appeal's decision window passed
 * - settle: settle_after_window only (Phase 4); refused in Phase 1, where decisions settle at once
 */
export type TimeoutKind = 'expire_offer' | 'reclaim' | 'fallback' | 'default' | 'apply_default' | 'appeal_expiry' | 'settle';

export const TIMEOUT_KINDS: readonly TimeoutKind[] = ['expire_offer', 'reclaim', 'fallback', 'default', 'apply_default', 'appeal_expiry', 'settle'];

/** One submission to the settlement layer. Signatures are checked against the settlement layer's own facts. */
export type Submission =
  /** Either wire form: at private and judgment the bodies are privateTerms ciphertext, and settlement reads their hashes (ADR-0024). */
  | { kind: 'offer'; commitment: AnyCommitment }
  | { kind: 'adjudicator_accept'; message: AdjudicatorAcceptance }
  | { kind: 'agree'; message: Agree }
  | { kind: 'fund'; message: FundingAuthorization }
  /**
   * Agreement and funding applied together: both or neither (a one-shot hold). With `operatorFee` (ADR-0023),
   * the buyer's fee to the relaying operator moves in the same step, outside the hold: all three or none.
   */
  | { kind: 'agree_and_fund'; agree: Agree; funding: FundingAuthorization; operatorFee?: TransferAuthorization }
  | { kind: 'deliver'; delivery: Delivery }
  | { kind: 'early_accept'; message: EarlyAccept }
  | { kind: 'decide'; message: Decision }
  | { kind: 'appeal'; appeal: Appeal }
  | { kind: 'mutual_settle'; message: MutualSettlement }
  | { kind: 'trigger'; commitmentId: Hex32; timeout: TimeoutKind };

type Unsigned<T> = T extends { signature: Signature } ? Omit<T, 'signature'> & { signature?: Signature } : T;

/**
 * What `validate` accepts (ADR-0017 §7). Party messages may leave their signature out, and the result says the
 * check was skipped, so a preview never hands anyone a live authorization. Adjudicator messages (acceptance,
 * decision) must be signed, so a dry run is never a free check of a seed guess.
 */
export type DryRunSubmission =
  | Exclude<Submission, { kind: 'offer' | 'agree' | 'fund' | 'agree_and_fund' | 'deliver' | 'early_accept' | 'appeal' | 'mutual_settle' }>
  | { kind: 'offer'; commitment: Omit<AnyCommitment, 'signatures'> & { signatures: { seller?: Signature; buyer?: Signature } } }
  | { kind: 'agree'; message: Unsigned<Agree> }
  | { kind: 'fund'; message: Unsigned<FundingAuthorization> }
  | { kind: 'agree_and_fund'; agree: Unsigned<Agree>; funding: Unsigned<FundingAuthorization>; operatorFee?: Unsigned<TransferAuthorization> }
  | { kind: 'deliver'; delivery: Unsigned<Delivery> }
  | { kind: 'early_accept'; message: Unsigned<EarlyAccept> }
  | { kind: 'appeal'; appeal: Unsigned<Appeal> }
  | { kind: 'mutual_settle'; message: Omit<MutualSettlement, 'buyerSignature' | 'sellerSignature'> & { buyerSignature?: Signature; sellerSignature?: Signature } };

export interface SubmitOptions {
  /** Same key and same body replays the first successful result; same key and another body is idempotency_conflict. */
  idempotencyKey?: string;
  /** The operator that relayed the submission, or 'direct'. Recorded on events; it carries no authority. */
  via?: string;
}

export type SubmitResult =
  | {
      ok: true;
      commitmentId: Hex32;
      state: CommitmentStateView;
      /** The events this submission appended; empty for a dry run. */
      events: SettlementEvent[];
      /** True when an idempotency key replayed an earlier result. */
      replayed: boolean;
      dryRun: boolean;
      /** 'skipped' only on a dry run of an unsigned party message. */
      signatureCheck: 'verified' | 'skipped' | 'none';
    }
  | { ok: false; problem: Problem };

export interface Settlement {
  readonly kind: 'sim' | 'local' | 'testnet';
  /** Any party may call it; the settlement layer validates everything. */
  submit(submission: Submission, options?: SubmitOptions): Promise<SubmitResult>;
  /** The same guards as submit against the same facts, with no effects at all (ADR-0017 §7). */
  validate(submission: DryRunSubmission): Promise<SubmitResult>;
  /** Permissionless timeouts; shorthand for submit({ kind: 'trigger', ... }). */
  trigger(commitmentId: Hex32, timeout: TimeoutKind, options?: SubmitOptions): Promise<SubmitResult>;
  /** The read model, with settledAt and finalAt (D20); null for an unknown commitment. */
  state(commitmentId: Hex32): Promise<CommitmentStateView | null>;
  /** The hash-chained event log from a sequence number. */
  events(fromSeq?: number): AsyncIterable<SettlementEvent>;
  balances(addresses: readonly Address[]): Promise<Record<Address, TokenAmount>>;
  /** Content-key envelopes the settlement layer has released to a recipient for a commitment (ADR-0020). */
  keysFor(commitmentId: Hex32, recipient: Address): Promise<EncryptedKey[]>;
}
