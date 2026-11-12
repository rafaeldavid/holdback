// Hand-written types for spec/schemas v0.11 (signed encoding 0.8: the EIP-712 domain version in eip712.ts; ADR-0023,
// ADR-0024, ADR-0029, ADR-0033). Values reach these types only through the parsers in parse.ts, which validate against the
// schema files. Phase 1 narrows the commitment to guaranteed_on_decision and maxSubmissions = 1 (ADR-0007).
import type { TokenAmount } from './money/index.js';

export type { TokenAmount } from './money/index.js';

// common.schema.json
export type Address = `0x${string}`;
export type Hex32 = `0x${string}`;
export type Signature = `0x${string}`;
export type Sha256 = `sha256:${string}`;
/** RFC 3339 date-time. */
export type Timestamp = string;
export type Base64Url = string;
/** Basis points: an integer from 0 to 10000, where 10000 is all (ADR-0022). */
export type Bps = number;
/** An exact ratio; denominator 1..100. Supermajorities also need numerator <= denominator < 2 x numerator. */
export interface Fraction {
  numerator: number;
  denominator: number;
}
export type SettlementMode = 'guaranteed_on_decision' | 'settle_after_window' | 'optimistic';
export type RandomnessSource = 'sim' | 'drand-quicknet' | 'prevrandao';
/** ADR-0020, ADR-0024: the level the terms sign; the rulebook's disclosureMin is its floor. */
export type DisclosureLevel = 'private' | 'judgment' | 'public';
export type IdentityMode = 'long-term' | 'pseudonymous';

/** When a recipient may open an encrypted key (ADR-0020). Phase 1 admits none only. */
export interface KeyUnlock {
  kind: 'none' | 'beacon-round';
  round?: number;
}

export interface EncryptedKey {
  recipient: Address;
  scheme: 'x25519-xsalsa20poly1305';
  ciphertext: Base64Url;
  unlock?: KeyUnlock;
}

/** A body kept off the public record: its hash and the readers' key envelopes (ADR-0020). */
export interface PrivateBody {
  hash: Hex32;
  envelopes: EncryptedKey[];
}

/**
 * One encrypted terms body (ADR-0024 §2): AES-256-GCM of the body's RFC 8785 JSON under its own key, with AAD =
 * commitment ID || part name. `hash` is canonicalKeccak of the body, the value the terms bind.
 */
export interface PrivatePart {
  hash: Hex32;
  /** iv (12) || ciphertext || tag (16), base64url. */
  ciphertext: Base64Url;
  envelopes: EncryptedKey[];
}

/** The two terms bodies as ciphertext, under separate keys (ADR-0024 §2). */
export interface PrivateTerms {
  deliverable: PrivatePart;
  acceptance: PrivatePart;
}
export type PartyRole = 'buyer' | 'seller';
export type MimeType = 'text/csv' | 'application/json' | 'text/plain' | 'text/markdown';

export interface Scope {
  roles: PartyRole[];
  maxPerCommitment: TokenAmount;
  maxDaily: TokenAmount;
  categories?: string[];
  expiresAt: Timestamp;
}

// commitment.schema.json
export interface ContentRef {
  uri: string;
  sha256: Sha256;
}

interface CheckBase {
  id: string;
  required: boolean;
}

export type DeterministicCheck =
  | (CheckBase & { type: 'csv_columns_exact'; columns: string[] })
  | (CheckBase & { type: 'row_count_range'; min: number; max: number })
  | (CheckBase & { type: 'unique_key'; columns: string[] })
  | (CheckBase & { type: 'null_rate_max'; column: string; maxBps: Bps })
  | (CheckBase & { type: 'regex_match_rate_min'; column: string; pattern: string; minBps: Bps })
  | (CheckBase & { type: 'iso8601_date_column'; column: string })
  | (CheckBase & { type: 'json_schema'; schema: Record<string, unknown> })
  | (CheckBase & { type: 'reference_row_match_min'; reference: ContentRef; keyColumn: string; minBps: Bps })
  | (CheckBase & { type: 'hidden_characters_max'; max: HiddenCharacterMax });

/** ADR-0021: maximum counts of invisible characters in the raw bytes, per class or in total. At least one is set. */
export interface HiddenCharacterMax {
  tag?: number;
  bidi?: number;
  variationSelector?: number;
  otherIgnorable?: number;
  total?: number;
}

export interface Criterion {
  id: string;
  description: string;
  weight: number;
  anchors: { '0': string; '1'?: string; '2': string; '3'?: string; '4': string };
}

export interface Deliverable {
  kind: 'dataset' | 'document' | 'other';
  description: string;
  format: MimeType;
  inputs?: ContentRef[];
  /** ADR-0024: random 32 bytes, so a guessable body cannot be confirmed against its hash. */
  salt?: Hex32;
  notes?: string;
  /** ADR-0024 §6: the seller's per-deal x25519 key, bound by deliverableHash. */
  sellerEncryptionPublicKey?: Base64Url;
}

export interface AcceptanceSpec {
  deterministicChecks: DeterministicCheck[];
  /** passThreshold is in hundredths of a rubric point (300 = 3.00). */
  rubric: { criteria: Criterion[]; passThreshold: number };
  sealedChecks?: { count: number; commitment: Hex32; weightBps: Bps };
  /** ADR-0024: random 32 bytes, so a template rubric cannot be confirmed against its hash. */
  salt?: Hex32;
}

export interface Adjudication {
  adjudicator: Address;
  fallbackAdjudicator: Address;
  appealAdjudicator: Address;
  policyId: string;
  fee: TokenAmount;
  registryHash: Hex32;
  policyHash: Hex32;
}

export interface Timing {
  offerExpiresAt: Timestamp;
  fundBy: Timestamp;
  deliverBy: Timestamp;
  judgeBy: Timestamp;
  fallbackBy: Timestamp;
  appealWindowSec: number;
  appealDecideSec: number;
  /** Phase 1: resubmission is not supported (ADR-0007). */
  maxSubmissions: 1;
  /** Optimistic mode only (ADR-0015); refused in Phase 1, bound by the commitment ID regardless. */
  disputeBy?: Timestamp;
  disputeJudgeSec?: number;
  disputeFallbackSec?: number;
}

/** Everything the commitment ID hashes: the commitment minus id, signatures and adjudicatorAcceptance (ADR-0016). */
export interface CommitmentTerms {
  schemaVersion: '0.8';
  clubId: string;
  rulebookHash: Hex32;
  /** Signs the agreement, an early accept and a settlement; the content key is sealed to it. */
  buyer: Address;
  /** Signs the terms, the delivery and a settlement. */
  seller: Address;
  /** ADR-0033: funds the hold and receives every refund (the escrow's payer). May equal buyer. */
  buyerPaymentAddress: Address;
  /** ADR-0033: receives every payment to the seller (the escrow's receiver). May equal seller. */
  sellerPayoutAddress: Address;
  deliverable: Deliverable;
  acceptance: AcceptanceSpec;
  price: TokenAmount;
  adjudication: Adjudication;
  timing: Timing;
  /** Phase 1: guaranteed_on_decision only (ADR-0007). */
  settlement: { mode: 'guaranteed_on_decision'; token: string };
  remedy: { onReject: 'full_refund' };
  /** ADR-0020, ADR-0024: private is the recipe's default; at private and judgment the bodies travel sealed. */
  disclosure: { level: DisclosureLevel };
  buyerEncryptionPublicKey: Base64Url;
  nonce: Hex32;
  createdAt: Timestamp;
}

export interface Commitment extends CommitmentTerms {
  id: Hex32;
  signatures: { seller: Signature; buyer?: Signature };
  adjudicatorAcceptance?: AdjudicatorAcceptance;
}

/**
 * The wire form at private and judgment (ADR-0024): the terms with the two bodies replaced by privateTerms. Its ID
 * equals the plaintext form's, because the struct binds only the bodies' hashes.
 */
export type SealedCommitmentTerms = Omit<CommitmentTerms, 'deliverable' | 'acceptance'> & { privateTerms: PrivateTerms };
export type SealedCommitment = SealedCommitmentTerms & Pick<Commitment, 'id' | 'signatures' | 'adjudicatorAcceptance'>;
/** Either form: what settlement and operators handle. Settlement needs only the hashes. */
export type AnyCommitmentTerms = CommitmentTerms | SealedCommitmentTerms;
export type AnyCommitment = Commitment | SealedCommitment;

// messages.schema.json
interface MessageBase {
  nonce: Hex32;
  expiresAt: Timestamp;
  signature: Signature;
}

export interface Offer extends MessageBase {
  type: 'Offer';
  commitmentId: Hex32;
  seller: Address;
}

export interface Agree extends MessageBase {
  type: 'Agree';
  commitmentId: Hex32;
  buyer: Address;
}

export interface AdjudicatorAcceptance extends MessageBase {
  type: 'AdjudicatorAcceptance';
  commitmentId: Hex32;
  adjudicator: Address;
  /** keccak256(seed); the seed is revealed in the Decision. */
  seedCommitment: Hex32;
  policyHash: Hex32;
  registryHash: Hex32;
  fee: TokenAmount;
  bondReserved: TokenAmount;
}

export interface FundingAuthorization extends MessageBase {
  type: 'FundingAuthorization';
  scheme: 'erc3009' | 'permit2';
  commitmentId: Hex32;
  from: Address;
  /** Base units, decimal string. */
  value: string;
  token: string;
  validAfter: Timestamp;
  validBefore: Timestamp;
}

/**
 * ADR-0023: the buyer pays the relaying operator's fee. Sent in the agree body as `operatorFee`; the settlement
 * layer applies it with the agreement and the funding, as a plain transfer outside the hold. Never refunded.
 */
export interface TransferAuthorization extends MessageBase {
  type: 'TransferAuthorization';
  scheme: 'erc3009';
  purpose: 'operator_fee';
  commitmentId: Hex32;
  from: Address;
  to: Address;
  /** Base units, decimal string. */
  value: string;
  token: string;
  validAfter: Timestamp;
  validBefore: Timestamp;
}

export interface EarlyAccept extends MessageBase {
  type: 'EarlyAccept';
  commitmentId: Hex32;
  buyer: Address;
  attempt: number;
  /** ADR-0029: deliveryHash() of the delivery the buyer opened; settlement refuses any other. */
  deliveryHash: Hex32;
}

export type AdjudicatorRole = 'primary' | 'fallback' | 'appeal';
export type DecisionOutcome = 'accept' | 'reject' | 'escalate';
export type AppealGround = 'wrong-outcome' | 'missing-or-wrong-key' | 'policy-or-panel-violation' | 'mislabeled-model';

export interface SealedKey {
  scheme: 'x25519-xsalsa20poly1305';
  ciphertext: Base64Url;
}

export interface Decision extends MessageBase {
  type: 'Decision';
  commitmentId: Hex32;
  attempt: number;
  /** ADR-0029: deliveryHash() of the delivery judged, the posted one; settlement refuses any other. */
  deliveryHash: Hex32;
  adjudicator: Address;
  role: AdjudicatorRole;
  outcome: DecisionOutcome;
  seed: Hex32;
  policyHash: Hex32;
  registryHash: Hex32;
  judgmentRecordHash: Hex32;
  keyForBuyer?: SealedKey;
  appealGround?: AppealGround;
  /** Fallback and appeal panels (ADR-0018). Required with a signature unless the source is sim. */
  beacon?: BeaconProof;
  /** On escalate only: the content key for the appeal adjudicator (ADR-0020). */
  encryptedKeys?: EncryptedKey[];
}

export interface BeaconProof {
  source: RandomnessSource;
  round: number;
  value: Hex32;
  signature?: `0x${string}`;
}

/** Optimistic mode (ADR-0015): built in Phase 4; Phase 1 parses it but no state accepts it. */
export interface Dispute extends MessageBase {
  type: 'Dispute';
  commitmentId: Hex32;
  buyer: Address;
  attempt: number;
  grounds: string;
  bond: TokenAmount;
  fee: TokenAmount;
  /** The content key for the three adjudicators (ADR-0020). */
  encryptedKeys: EncryptedKey[];
}

export interface AgentRevocation extends MessageBase {
  type: 'AgentRevocation';
  agent: Address;
  principal: Address;
}

export interface MemberAdmission extends MessageBase {
  type: 'MemberAdmission';
  clubId: string;
  member: Address;
  operator: Address;
  validUntil: Timestamp;
}

export interface MemberRevocation extends MessageBase {
  type: 'MemberRevocation';
  clubId: string;
  member: Address;
  operator: Address;
}

/** ADR-0024 §3: authenticates a private read. audience is the operator's receipt signer; a zero commitmentId scopes list reads. */
export interface ReadToken extends MessageBase {
  type: 'ReadToken';
  viewer: Address;
  commitmentId: Hex32;
  audience?: Address;
}

/** ADR-0024 §7: the long-term agent key certifies one per-deal signing key and one per-deal encryption key. */
export interface Delegation extends MessageBase {
  type: 'Delegation';
  principal: Address;
  agent: Address;
  dealKey: Address;
  dealEncryptionKey: Base64Url;
  clubId: string;
  scope: Scope;
}

/** ADR-0024 §6: an adjudicator's self-signed encryption key. */
export interface KeyRegistration extends MessageBase {
  type: 'KeyRegistration';
  adjudicator: Address;
  encryptionPublicKey: Base64Url;
  keyId: string;
}

/**
 * ADR-0030: an adjudicator's self-signed registration, rebuilt from its record (registrationMessageOf). Named for its
 * type like every message; the TypeScript name differs only because AdjudicatorRegistration is the record's.
 */
export interface AdjudicatorRegistrationMessage extends MessageBase {
  type: 'AdjudicatorRegistration';
  adjudicator: Address;
  encryptionPublicKey: Base64Url;
  keyId: string;
  policyHash: Hex32;
  registryHash: Hex32;
  fee: TokenAmount;
  poolTermsHash: Hex32;
  /** keccak256 of the RFC 8785 JSON of the registered record (registeredBody). */
  bodyHash: Hex32;
  issuedAt: Timestamp;
}

/** Messages that authenticate or certify and change no settlement state (ADR-0024, ADR-0030). */
export type CredentialMessage = ReadToken | Delegation | KeyRegistration | AdjudicatorRegistrationMessage;

/** disclosure.schema.json: keys posted to publish a private deal's bodies (ADR-0024 §3). */
export interface DisclosureBody {
  commitmentId: Hex32;
  publish?: Publish;
  keys: { acceptanceKey?: Base64Url; deliverableKey?: Base64Url; recordKeys?: Array<{ recordHash: Hex32; key: Base64Url }> };
}

/** projection.schema.json: what anyone may read about a private deal (ADR-0024 §3, §8). */
export interface SettlementProjection {
  commitmentId: Hex32;
  disclosure: { level: DisclosureLevel };
  buyer: Address;
  seller: Address;
  price: TokenAmount;
  adjudication: Pick<Adjudication, 'adjudicator' | 'fallbackAdjudicator' | 'appealAdjudicator' | 'fee'>;
  timing: Timing;
  settlement: CommitmentTerms['settlement'];
  hashes: { deliverableHash: Hex32; acceptanceHash: Hex32; rulebookHash: Hex32; registryHash: Hex32; policyHash: Hex32 };
  disclosed?: { deliverable?: Deliverable; acceptance?: AcceptanceSpec };
}

export type SignedMessage =
  | Offer
  | Agree
  | AdjudicatorAcceptance
  | FundingAuthorization
  | EarlyAccept
  | Decision
  | AgentRevocation
  | MemberAdmission
  | MemberRevocation
  | Dispute
  | TransferAuthorization;

/**
 * Buyer and seller close a commitment by agreement (ADR-0019, amended by D23). Both sign the identical
 * struct, so it carries two signatures instead of MessageBase's one.
 */
/** D23: `parties` limits payouts to the buyer and the seller; `any` admits any address both sign for. */
export type PayoutsTo = 'parties' | 'any';

export interface Payout {
  /** Any address both parties sign for, unless the rulebook restricts payouts to the parties. */
  to: Address;
  /** Above zero, in the price token. */
  amount: TokenAmount;
}

export interface MutualSettlement {
  type: 'MutualSettlement';
  commitmentId: Hex32;
  /** The delivery being settled, or null before any delivery. */
  deliveryHash: Hex32 | null;
  /** One to eight payouts that sum to the price (D23); the adjudication fee returns to the buyer. */
  payouts: Payout[];
  releaseKey: boolean;
  nonce: Hex32;
  expiresAt: Timestamp;
  buyerSignature: Signature;
  sellerSignature: Signature;
}

/** Buyer and seller raise the disclosure level by agreement (ADR-0020); raising only is checked by settlement. */
export interface Publish {
  type: 'Publish';
  commitmentId: Hex32;
  level: DisclosureLevel;
  nonce: Hex32;
  expiresAt: Timestamp;
  buyerSignature: Signature;
  sellerSignature: Signature;
}

/** Messages both parties sign over the identical struct. */
export type CoSignedMessage = MutualSettlement | Publish;

/** Everything messages.schema.json admits. */
export type Message = SignedMessage | CoSignedMessage | CredentialMessage;

// delivery.schema.json
export interface Delivery {
  commitmentId: Hex32;
  attempt: number;
  ciphertext: { uri: string; sha256: Sha256; bytes: number; cipher: 'aes-256-gcm' };
  plaintextSha256: Sha256;
  plaintextMime: MimeType;
  encryptedKeys: EncryptedKey[];
  submittedAt: Timestamp;
  signature: Signature;
}

// appeal.schema.json
export interface Appeal {
  commitmentId: Hex32;
  appellant: PartyRole;
  appellantAddress: Address;
  grounds: string;
  bond: TokenAmount;
  filedAt: Timestamp;
  signature: Signature;
}

// mandate.schema.json
export interface Mandate {
  principal: Address;
  agent: Address;
  clubId: string;
  scope: Scope;
  nonce: Hex32;
  issuedAt: Timestamp;
  signature: Signature;
}

// agent.schema.json
export interface AgentRegistration {
  address: Address;
  clubId: string;
  memberId: string;
  principal: Address;
  scope: Scope;
  encryptionPublicKey?: Base64Url;
  mandateHash: Hex32;
  status: 'active' | 'revoked';
  registeredAt: Timestamp;
}

// club.schema.json
export interface Rulebook {
  version: string;
  open: boolean;
  documentUri?: string;
  minWindowsSec: { judge: number; fallback: number; appealWindow: number; appealDecide: number };
  windowCoverageRatioBps: Bps;
  appealBondRateBps: Bps;
  sealedChecksMaxWeightBps: Bps;
  maxSubmissions: number;
  defaultOutcome: {
    judged: { refundBuyer: true; sellerCompensationRateBps: Bps };
    optimistic?: { release: true; buyerCompensationRateBps: Bps };
  };
  allowedSettlementModes: SettlementMode[];
  allowedTokens: string[];
  panelPolicyMin: { panelSize: number; appealPanelSize: number; minFamilies: number };
  appealFee: TokenAmount;
  /** ADR-0019. */
  mutualSettlement: { allowed: boolean; adjudicatorFeeShareAfterDeliveryBps: number; payoutsTo: PayoutsTo };
  disclosureMin: DisclosureLevel;
  /** Long-term keys, and pseudonymous per-deal keys with a Delegation (ADR-0024 §7). */
  identityModes: IdentityMode[];
  firstLossShareMinBps: Bps;
  bondNoticePeriodMinSec: number;
  randomness: { source: RandomnessSource; chainHash?: Hex32 };
  minInspectionWindowSec: number;
  disputeBond: TokenAmount;
}

export interface Club {
  id: string;
  name: string;
  operator: Address;
  rulebook: Rulebook;
  rulebookHash: Hex32;
}

// adjudicator.schema.json
export interface AdjudicatorPolicy {
  id: string;
  panelSize: number;
  appealPanelSize: number;
  minFamilies: number;
  minFamiliesAppeal: number;
  minValid: number;
  minValidAppeal: number;
  acceptSupermajority: Fraction;
  rejectSupermajority: Fraction;
  judgeTimeoutSec: number;
  rationaleMaxChars: number;
  promptTemplateHash: Hex32;
  appealPromptTemplateHash: Hex32;
  aggregationVersion: string;
  screenVersion: string;
  providerPrivacy: 'standard' | 'zdr' | 'tee' | 'local';
  disclosureMin: DisclosureLevel;
}

export interface AdjudicatorRegistration {
  address: Address;
  name: string;
  encryptionPublicKey: Base64Url;
  affiliations: string[];
  policy: AdjudicatorPolicy;
  registry: { hash: Hex32; uri: string };
  policyHash: Hex32;
  fee: { min: TokenAmount };
  pool: AdjudicatorPool;
  poolTermsHash: Hex32;
  metrics?: { falseAcceptRateBps: Bps; falseRejectRateBps: Bps; escalationRateBps: Bps; sampleSize: number; measuredAt: Timestamp };
  status: 'active' | 'suspended';
  /** ADR-0030: the adjudicator's signature over this record. Absent on an unsigned record (SimChain genesis). */
  registration?: RegistrationEnvelope;
}

/** ADR-0030: with the record's own fields, the AdjudicatorRegistration message the adjudicator signed. */
export interface RegistrationEnvelope {
  keyId: string;
  bodyHash: Hex32;
  issuedAt: Timestamp;
  nonce: Hex32;
  expiresAt: Timestamp;
  signature: Signature;
}

/** ADR-0030: the record an adjudicator posts: signed, and without the balances the chain holds (pool keeps its terms). */
export type RegisteredAdjudicator = Omit<AdjudicatorRegistration, 'pool' | 'registration'> & {
  pool: { terms: AdjudicatorPool['terms'] };
  registration: RegistrationEnvelope;
};

/** ADR-0014 §2a. terms is what poolTermsHash binds; balances are not part of it. */
export interface AdjudicatorPool {
  junior: TokenAmount;
  senior: TokenAmount;
  reserved: TokenAmount;
  terms: { capitalChargeRateBps: Bps; capitalChargeToPoolRateBps: Bps; firstLossShareBps: Bps; noticePeriodSec: number };
}

// commitment-state.schema.json (the read model; the domain state machine is in state.ts)
export type EscrowStateKind =
  | 'Offered'
  | 'AcceptedByAdjudicator'
  | 'Agreed'
  | 'Held'
  | 'Delivered'
  | 'Disputed'
  | 'FallbackJudging'
  | 'Escalated'
  | 'Released'
  | 'Refunded'
  | 'Settled'
  | 'Defaulted'
  | 'Expired';
export type AppealStateKind = 'none' | 'open' | 'upheld' | 'overturned' | 'expired';

export interface CommitmentStateView {
  commitmentId: Hex32;
  escrowState: EscrowStateKind;
  appealState: AppealStateKind;
  attempt: number;
  /**
   * ADR-0029: the posted delivery's hash, so a buyer can cross-check two operators. Present while the state holds the
   * delivery and after a signature that named it; absent before a delivery, in Defaulted and after a default or reclaim.
   */
  deliveryHash?: Hex32;
  hold?: { amount: TokenAmount; railRef: string };
  deadlines: Record<string, Timestamp>;
  balances?: Record<Address, TokenAmount>;
  /** Present only when escrowState is Settled (ADR-0019). */
  settled?: { payouts: Payout[]; keyReleased: boolean };
  /** D20: money moved and is irrevocable for its payee. Not signed. */
  settledAt?: Timestamp | null;
  /** D20: no protocol step can change who got what; null until true. Not signed. */
  finalAt?: Timestamp | null;
  lastEventSeq: number;
  updatedAt: Timestamp;
}

// event.schema.json
export type SettlementEventType =
  | 'club.registered'
  | 'agent.registered'
  | 'agent.revoked'
  | 'adjudicator.registered'
  | 'commitment.offered'
  | 'adjudicator.accepted'
  | 'member.admitted'
  | 'member.revoked'
  | 'commitment.agreed'
  | 'offer.expired'
  | 'hold.funded'
  | 'delivery.submitted'
  | 'judgment.decided'
  | 'fallback.triggered'
  | 'default.triggered'
  | 'appeal.filed'
  | 'appeal.decided'
  | 'appeal.expired'
  | 'settlement.released'
  | 'settlement.refunded'
  | 'settlement.reclaimed'
  | 'key.released'
  | 'bond.paid'
  | 'bond.deposited'
  | 'bond.withdrawn'
  | 'bond.slashed'
  | 'dispute.opened'
  | 'commitment.settled'
  /** ADR-0023: the buyer's operator fee, paid with the funded agreement, outside the hold. */
  | 'fee.operator';

export interface SettlementEvent {
  seq: number;
  type: SettlementEventType;
  commitmentId?: Hex32;
  at: Timestamp;
  actor?: Address | 'anyone';
  submittedVia?: string;
  payload: Record<string, unknown>;
  prevHash: Hex32;
  hash: Hex32;
}

// judge-verdict.schema.json
export interface JudgeVerdict {
  criteria: Array<{ id: string; score: 0 | 1 | 2 | 3 | 4; evidence: string }>;
  overall: 'pass' | 'fail' | 'abstain';
  injectionSuspected: boolean;
  injectionEvidence?: string;
  rationale: string;
}

// judgment.schema.json
export type ScreenSignalKind =
  | 'instruction_phrase'
  | 'encoded_run'
  | 'unicode_tags'
  | 'zero_width'
  | 'canary_echo'
  | 'classifier'
  // ADR-0021
  | 'nfkc_changed'
  | 'variation_selector_run'
  | 'mixed_script'
  | 'hidden_characters';

export interface PanelMember {
  judgeId: string;
  provider: string;
  family: string;
  /** Pinned model ID; the schema rejects floating aliases such as "latest". */
  model: string;
  promptTemplateHash: Hex32;
  inputHash: Hex32;
  rubricHash: Hex32;
  latencyMs?: number;
  status: 'ok' | 'abstain' | 'timeout' | 'error' | 'recorded';
  verdict?: JudgeVerdict;
}

export interface Judgment {
  commitmentId: Hex32;
  attempt: number;
  /** ADR-0029: deliveryHash() of the delivery judged; recordHash covers it. */
  deliveryHash: Hex32;
  adjudicator: Address;
  role: AdjudicatorRole;
  intake: { plaintextHashVerified: boolean; mime: string; bytes: number; normalized: boolean };
  deterministic: Array<{ checkId: string; required: boolean; passed: boolean; detail?: string }>;
  screen: { flagged: boolean; signals: Array<{ kind: ScreenSignalKind; detail?: string }> };
  panel: {
    ran: boolean;
    policyId: string;
    policyHash: Hex32;
    seedSource: 'commit-reveal' | 'beacon';
    seedCommitment?: Hex32;
    beaconRound?: number;
    seed?: Hex32;
    members: PanelMember[];
  };
  aggregate: {
    decision: DecisionOutcome;
    /** Hundredths of a rubric point, or null when no verdict was valid. */
    weightedScore?: number | null;
    passCount?: number;
    failCount?: number;
    validCount?: number;
    passFamilies?: string[];
    reasons: string[];
  };
  recordUri?: string;
  privateRecord?: PrivateBody;
  recordHash: Hex32;
  decidedAt: Timestamp;
  signature: Signature;
}

// page.schema.json (ADR-0017)
export interface Page<T = unknown> {
  items: T[];
  nextCursor: string | null;
}

// receipt.schema.json (ADR-0017)
export interface Receipt {
  operator: Address;
  eventSeq: number;
  eventHash: Hex32;
  /** Absent for events with no commitment, such as bond deposits. */
  commitmentId?: Hex32;
  signature: Signature;
}

// operator-status.schema.json (ADR-0017)
export interface OperatorStatus {
  operatorId: string;
  receiptSigner: Address;
  settlement: { kind: 'sim' | 'chain'; chainId?: string };
  domain: { name: 'Holdback'; version: string; chainId: string; verifyingContract: Address };
  apiVersion: string;
  schemaVersion: string;
  head: { eventSeq: number; lagBlocks?: number; lagSec: number };
  settlementModes: SettlementMode[];
  /** ADR-0023: what this operator charges; absent when it charges nothing. */
  fees?: { operator: OperatorFeeSchedule };
}

/** ADR-0023 (operator-status.schema.json OperatorFee): max(min, ceil(price x bps / 10000)), capped at max. */
export interface OperatorFeeSchedule {
  to: Address;
  token: string;
  bps: number;
  /** Base units, decimal string. */
  min: string;
  /** Base units, decimal string, or null for no cap. */
  max: string | null;
  appliesAt: 'agree-and-fund';
  refundable: false;
}
