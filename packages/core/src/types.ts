// Hand-written types for spec/schemas v0.4. Values reach these types only through the parsers in
// parse.ts, which validate against the schema files. Phase 1 narrows the commitment to
// guaranteed_on_decision and maxSubmissions = 1 (ADR-0007).
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
/** 0..1 inclusive. Not money. */
export type Rate = number;
export type SettlementMode = 'guaranteed_on_decision' | 'settle_after_window';
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
  | (CheckBase & { type: 'null_rate_max'; column: string; max: Rate })
  | (CheckBase & { type: 'regex_match_rate_min'; column: string; pattern: string; min: Rate })
  | (CheckBase & { type: 'iso8601_date_column'; column: string })
  | (CheckBase & { type: 'json_schema'; schema: Record<string, unknown> })
  | (CheckBase & { type: 'reference_row_match_min'; reference: ContentRef; keyColumn: string; min: Rate });

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
}

export interface AcceptanceSpec {
  deterministicChecks: DeterministicCheck[];
  rubric: { criteria: Criterion[]; passThreshold: number };
  sealedChecks?: { count: number; commitment: Hex32; weight: number };
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
}

/** Everything the commitment ID hashes: the commitment minus id, signatures and adjudicatorAcceptance (ADR-0016). */
export interface CommitmentTerms {
  schemaVersion: '0.4';
  clubId: string;
  rulebookHash: Hex32;
  buyer: Address;
  seller: Address;
  deliverable: Deliverable;
  acceptance: AcceptanceSpec;
  price: TokenAmount;
  adjudication: Adjudication;
  timing: Timing;
  /** Phase 1: guaranteed_on_decision only (ADR-0007). */
  settlement: { mode: 'guaranteed_on_decision'; token: string };
  remedy: { onReject: 'full_refund' };
  buyerEncryptionPublicKey: Base64Url;
  nonce: Hex32;
  createdAt: Timestamp;
}

export interface Commitment extends CommitmentTerms {
  id: Hex32;
  signatures: { seller: Signature; buyer?: Signature };
  adjudicatorAcceptance?: AdjudicatorAcceptance;
}

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

export interface EarlyAccept extends MessageBase {
  type: 'EarlyAccept';
  commitmentId: Hex32;
  buyer: Address;
  attempt: number;
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
  adjudicator: Address;
  role: AdjudicatorRole;
  outcome: DecisionOutcome;
  seed: Hex32;
  policyHash: Hex32;
  registryHash: Hex32;
  judgmentRecordHash: Hex32;
  keyForBuyer?: SealedKey;
  appealGround?: AppealGround;
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

export type SignedMessage =
  | Offer
  | Agree
  | AdjudicatorAcceptance
  | FundingAuthorization
  | EarlyAccept
  | Decision
  | AgentRevocation
  | MemberAdmission
  | MemberRevocation;

// delivery.schema.json
export interface Delivery {
  commitmentId: Hex32;
  attempt: number;
  ciphertext: { uri: string; sha256: Sha256; bytes: number; cipher: 'aes-256-gcm' };
  plaintextSha256: Sha256;
  plaintextMime: MimeType;
  encryptedKeys: Array<{ recipient: Address } & SealedKey>;
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
  windowCoverageRatio: Rate;
  appealBondRate: Rate;
  sealedChecksMaxWeight: number;
  maxSubmissions: number;
  defaultOutcome: { refundBuyer: true; sellerCompensationRate: Rate };
  allowedSettlementModes: SettlementMode[];
  allowedTokens: string[];
  panelPolicyMin: { panelSize: number; appealPanelSize: number; minFamilies: number };
  appealFee: TokenAmount;
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
  acceptSupermajority: Rate;
  rejectSupermajority: Rate;
  judgeTimeoutSec: number;
  rationaleMaxChars: number;
  promptTemplateHash: Hex32;
  appealPromptTemplateHash: Hex32;
  aggregationVersion: string;
  screenVersion: string;
}

export interface AdjudicatorRegistration {
  address: Address;
  name: string;
  encryptionPublicKey: Base64Url;
  affiliations: string[];
  bond: TokenAmount;
  openExposure: TokenAmount;
  policy: AdjudicatorPolicy;
  registry: { hash: Hex32; uri: string };
  policyHash: Hex32;
  fee: { min: TokenAmount; capitalChargeRate: Rate };
  metrics?: { falseAcceptRate: Rate; falseRejectRate: Rate; escalationRate: Rate; sampleSize: number; measuredAt: Timestamp };
  status: 'active' | 'suspended';
}

// commitment-state.schema.json (the read model; the domain state machine is in state.ts)
export type EscrowStateKind =
  | 'Offered'
  | 'AcceptedByAdjudicator'
  | 'Agreed'
  | 'Held'
  | 'Delivered'
  | 'FallbackJudging'
  | 'Escalated'
  | 'Released'
  | 'Refunded'
  | 'Defaulted'
  | 'Expired';
export type AppealStateKind = 'none' | 'open' | 'upheld' | 'overturned' | 'expired';

export interface CommitmentStateView {
  commitmentId: Hex32;
  escrowState: EscrowStateKind;
  appealState: AppealStateKind;
  attempt: number;
  hold?: { amount: TokenAmount; railRef: string };
  deadlines: Record<string, Timestamp>;
  balances?: Record<Address, TokenAmount>;
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
  | 'bond.paid';

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
export type ScreenSignalKind = 'instruction_phrase' | 'encoded_run' | 'unicode_tags' | 'zero_width' | 'canary_echo' | 'classifier';

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
  adjudicator: Address;
  role: AdjudicatorRole;
  intake: { plaintextHashVerified: boolean; mime: string; bytes: number; normalized: boolean };
  deterministic: Array<{ checkId: string; required: boolean; passed: boolean; detail?: string }>;
  screen: { flagged: boolean; signals: Array<{ kind: ScreenSignalKind; detail?: string }> };
  panel: { ran: boolean; policyId: string; policyHash: Hex32; seedCommitment: Hex32; seed?: Hex32; members: PanelMember[] };
  aggregate: {
    decision: DecisionOutcome;
    weightedScore?: number | null;
    passShare?: Rate;
    failShare?: Rate;
    passFamilies?: string[];
    reasons: string[];
  };
  recordUri?: string;
  recordHash: Hex32;
  decidedAt: Timestamp;
  signature: Signature;
}
