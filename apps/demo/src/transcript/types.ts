// The transcript interface between a beat runner and the narration, renderers and viewer (T-013).
// A beat runner (T-012's SimChain runner, or the scripted stand-in) produces a BeatTranscript; everything
// downstream reads only this. Money is a token amount in base units as a decimal string; times are whole
// milliseconds since the job's first call. Deliverable content appears in one place only: the 'judge-prompt'
// event (T-019), an excerpt of one judge's prompt and its verdict, made plain line by line at ingestion and escaped
// again by every renderer. Everything else is hashes, sizes and counts.

/** Who appears in the demo. Display names live in cast.ts. */
export type CastKey =
  | 'buyer'
  | 'seller'
  | 'benchA'
  | 'benchB'
  | 'benchC'
  | 'backer'
  | 'observer'
  | 'club'
  | 'op1'
  | 'op2'
  | 'chain'
  | 'escrow';

/** A token amount in base units (decimal string, no sign, no fraction) and its token identifier. */
export interface Amount {
  token: string;
  amount: string;
}

/** Who relayed a call: an operator, or a direct submission to the settlement layer. */
export type Via = 'op1' | 'op2' | 'direct';

export interface CheckResult {
  id: string;
  type: string;
  required: boolean;
  passed: boolean;
  /** The measured value against its limit, e.g. "8,740 rows; allowed 9,400 to 9,600". */
  detail: string;
}

export interface JudgeSeat {
  seat: number;
  /** Pinned model ID from the adjudicator's registry, never an alias. */
  model: string;
  family: string;
  verdict: 'pass' | 'fail' | 'abstain';
  /** Weighted rubric score in hundredths of a point (0 to 400), when the judge returned one. */
  score?: number;
}

export interface BalanceRow {
  who: CastKey;
  /** Free balance, or for a bench, its bond pool. */
  amount: Amount;
  /** Bond reserved against open commitments, for a bench. */
  reserved?: Amount;
}

interface At {
  /** Whole milliseconds since the job's first call. */
  atMs: number;
  /** Set on events the scripted stand-in wrote (illustrative), in a transcript that also has SimChain events. */
  standIn?: true;
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Primary, fallback and appeal adjudicators as cast keys. */
export interface SlateKeys {
  primary: CastKey;
  fallback: CastKey;
  appeal: CastKey;
}

/** One registration the buyer read before proposing (T-017). `name` is the registration's own text: untrusted. */
export interface ConsideredAdjudicator {
  name: string;
  who?: CastKey;
  eligible: boolean;
  /** Why the club rulebook excludes it; empty when eligible. */
  reasons: string[];
}

/** A bench's profile for the viewer (T-017). Effort, harness, roles and history are display data, not protocol. */
export interface AdjudicatorProfile {
  who?: CastKey;
  name: string;
  tagline: string;
  roles: string[];
  selected: 'primary' | 'fallback' | 'appeal' | 'declined';
  declinedBecause?: string[];
  /** The seller's checks this bench passed, with its numbers. */
  sellerChecks?: string[];
  /** Pinned model IDs from the registry, with the reasoning setting the bench declares per judge. */
  judges: { id: string; model: string; family: string; effort: string }[];
  harness: string[];
  /** Formatted terms: fee, panel, deadline, appeal window, bond. */
  terms: { label: string; value: string }[];
  /** Invented for the demo. */
  history: { rolePlay: true; lines: string[] };
}

/** A judge's verdict as the transcript shows it. Model output over untrusted input: plain at ingestion. */
export interface VerdictView {
  overall: 'pass' | 'fail' | 'abstain';
  criteria: { id: string; score: number; evidence: string }[];
  injectionSuspected: boolean;
  injectionEvidence?: string;
  rationale: string;
}

/**
 * One judge's prompt, as the judge received it, with the middle of the data section left out. Each entry is one
 * line, made plain (no controls, bidi or tag characters). `omitted` lines sit between `head` and `tail`.
 */
export interface PromptView {
  system: string[];
  user: { head: string[]; omitted: number; tail: string[]; lines: number };
}

/** How long judging took, measured by the adjudicator service's run (T-019). */
export interface JudgingTiming {
  /** From the delivery's stamp to the decision's. */
  afterDeliveryMs: number;
  /** From the start of the adjudicator service's run (read, decrypt, checks, screen, panel) to its signed decision. */
  judgingMs: number;
  /** From the first judge call to the last verdict; absent when no panel sat. */
  panelMs?: number;
}

export type DemoEvent =
  | (At & { kind: 'adjudicator-proposal'; actor: CastKey; registrations: number; rules: string[]; considered: ConsideredAdjudicator[]; proposed: SlateKeys })
  | (At & {
      kind: 'adjudicator-agreement';
      actor: CastKey;
      agreed: SlateKeys;
      /** The checks the seller applies to every bench, in words; per-bench results are in the profiles. */
      policy: string[];
      bondRequired: Amount;
      bonds: { who: CastKey; free: Amount }[];
    })
  | (At & { kind: 'offer'; actor: CastKey; commitmentId: string; price: Amount; fee: Amount; primary: CastKey; fallback: CastKey; appeal: CastKey; disclosure: 'public' | 'judgment' | 'private' })
  | (At & { kind: 'acceptance'; actor: CastKey; bondReserved: Amount; seedCommitment: string })
  | (At & { kind: 'hold'; actor: CastKey; amount: Amount; via: Via })
  | (At & { kind: 'delivery'; actor: CastKey; deliveryHash: string; plaintextSha256: string; ciphertextBytes: number; keyRecipients: CastKey[]; via: Via })
  | (At & { kind: 'checks'; actor: CastKey; results: CheckResult[] })
  | (At & { kind: 'screen'; actor: CastKey; flagged: boolean; signals: string[]; consequence: string })
  | (At & { kind: 'panel'; actor: CastKey; seed: string; seedSource: 'commit-reveal' | 'beacon'; rule: string; judges: JudgeSeat[]; outcome: 'accept' | 'reject' | 'escalate' })
  | (At & {
      kind: 'judge-prompt';
      actor: CastKey;
      seat: number;
      model: string;
      family: string;
      /** SHA-256 of the full {system, user} prompt, as the judgment record holds it. */
      inputHash: string;
      /** True when a fake provider wrote the verdict (no model read the prompt). */
      scripted: boolean;
      prompt: PromptView;
      verdict?: VerdictView;
    })
  | (At & { kind: 'decision'; actor: CastKey; role: 'primary' | 'fallback' | 'appeal'; outcome: 'accept' | 'reject'; via: Via; timing?: JudgingTiming })
  | (At & { kind: 'escalation'; actor: CastKey; to: CastKey; reason: string; panelSize: number; families: number })
  | (At & { kind: 'settlement'; actor: CastKey; settlement: 'release' | 'refund' | 'mutual'; payouts: { to: CastKey; amount: Amount; reason: string }[]; keyReleasedTo?: CastKey; via: Via })
  | (At & { kind: 'open'; actor: CastKey; plaintextSha256: string; matchesDelivery: boolean; bytes: number; stripped?: { what: string; count: number } })
  | (At & { kind: 'finality'; actor: CastKey; payee: CastKey; appealWindowSec: number; bondAtRisk: Amount; bondHolder: CastKey })
  | (At & { kind: 'receipt'; actor: CastKey; receiptHash: string })
  | (At & { kind: 'neutrality'; actor: CastKey; target: CastKey; failure: 'refused' | 'offline' | 'revoked'; consequence: string; via?: Via })
  | (At & {
      /**
       * D26: each party fetches its own copy of the record through its own SDK client (commitment state, every
       * settlement event, every operator receipt, the judgment record) and hashes it. The work itself is excluded;
       * only its hash is in the events. `match` is measured: true only when every party's hash is equal.
       */
      kind: 'shared-record';
      actor: CastKey;
      parties: { who: CastKey; hash: string }[];
      events: number;
      receipts: number;
      /** The judgment record's hash, when an adjudicator decided. */
      judgmentRecord?: string;
      /** The decision event's hash, as its operator receipt attests it. */
      decision?: string;
      match: boolean;
    })
  | (At & { kind: 'balances'; actor: CastKey; label: string; rows: BalanceRow[] })
  | (At & { kind: 'signed'; actor: CastKey; messageType: string; signer: string; body: { [key: string]: Json }; signature: string });

export type EventKind = DemoEvent['kind'];

/** Where a beat's numbers come from. */
export interface TranscriptSource {
  /** 'mixed': SimChain events plus stand-in events, each stand-in event marked `standIn`. */
  kind: 'simchain' | 'stand-in' | 'mixed';
  /** What the transcript prints about where its numbers come from. */
  note: string;
}

export interface BeatTranscript {
  format: 'holdback.demo.transcript/v0';
  beat: number;
  title: string;
  /** What the viewer sees, in one sentence. */
  summary: string;
  /** The litmus test this beat shows. */
  litmus: string;
  /** scripted: fake judges; recorded: replayed model recordings; live: models called in this run. */
  mode: 'scripted' | 'recorded' | 'live';
  source: TranscriptSource;
  commitmentId?: string;
  events: DemoEvent[];
  /** Beat 1: every adjudicator the agents considered, with its profile (T-017). */
  adjudicators?: AdjudicatorProfile[];
}

/** Produces transcripts, one beat at a time. Each beat runs alone. */
export interface EventSource {
  readonly name: string;
  beats(): readonly number[];
  run(beat: number): Promise<BeatTranscript>;
}
