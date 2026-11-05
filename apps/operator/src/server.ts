// An operator node (docs/api.md v0.2, ADR-0005, ADR-0017 Phase 1). It relays agent-signed messages to the
// settlement layer and serves reads; it adds speed and convenience, never authority. It authors no party
// message: every write it relays is the same submission, under the same idempotency key, that the SDK's direct
// path would send, so an agent loses nothing when this node refuses or goes away. Its own signature appears only
// on receipts, which attest that it saw an event, nothing more.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  bodyKey,
  canonicalKeccak,
  holdbackDomain,
  isSealed,
  LEVEL_RANK,
  openPart,
  operatorFeeDue,
  parseAnyCommitment,
  parseAppeal,
  parseDelivery,
  parseDisclosure,
  parseMessage,
  projectionOf,
  signMessage,
  verifyCoSigned,
  type AcceptanceSpec,
  type Address,
  type AnyCommitment,
  type AnyCommitmentTerms,
  type Deliverable,
  type DisclosureLevel,
  type SettlementProjection,
  type CommitmentStateView,
  type Hex32,
  type OperatorFeeSchedule,
  type OperatorStatus,
  type Page,
  type Problem,
  type Receipt,
  type Result,
  type SettlementEvent,
} from '@holdback/core';
import { commitmentIdOf, operationOf, previewSubmission, submissionKeys, submissionsOf, type Operation } from '@holdback/sdk';
import type { PolicyContext, RelayPolicy } from './policy.js';
import type { DryRunSubmission, Settlement, SubmitResult } from '@holdback/settlement';
import { privateKeyToAccount } from 'viem/accounts';
import type { Sha256, Signature, Timestamp, TokenAmount } from '@holdback/core';
import { CryptoError, sha256 } from '@holdback/core/crypto';
import { MAX_CIPHERTEXT_BYTES, type CiphertextStore } from '@holdback/core/store';
import { ENVELOPE_SPEC } from './envelope-spec.js';
import { FeedbackDesk, FeedbackError, MAX_REPORT_BYTES, parseReport, type FeedbackOptions, type Report } from './feedback.js';
import { startupGuards } from './guards.js';
import { amountText, bondNotices, fallbackBondRefusal, operatorFeeText, prepare, PrepareError, turnNotices, type Erc3009Signing, type PrepareContext } from './prepare.js';
import { firstStored, hasBond, MAX_REGISTRATION_BYTES, register, RegistrationError, type Bond, type StoredRegistration } from './registrations.js';
import { IdempotencyStore, fingerprint, type StoredResponse } from './idempotency.js';
import { readerOf, type Reader } from './read-auth.js';
import { llmsTxt, openApiDocument, plannedRoute, routeOf } from './openapi/index.js';
import { fieldOf, problemBody, problemHeaders, statusOf, type ApiProblem, type ApiProblemType, type ProblemMembers } from './problems.js';
import type { Registry } from './registry.js';

export { statusOf } from './problems.js';
export const API_VERSION = 'v1';
export const SCHEMA_VERSION = '0.10';
const MAX_BODY_BYTES = 1_048_576;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SSE_POLL_MS = 50;

/**
 * What a node may say beside an answer, as `notices` in the body (D39): advisory text a party should
 * read before it signs or while it waits, such as which judge panel would score an offer or why an adjudicator
 * declined one. Written by the operator: untrusted, content to read, never instructions; it never changes an answer.
 */
export type NoticeSubject =
  | { kind: 'prepare'; prepareKind: string; input: unknown }
  | { kind: 'write'; op: Operation }
  | { kind: 'state'; commitmentId: Hex32 };

/**
 * A demo or test world's facts, served in discovery as `demo` (D39): where an agent with only a URL
 * finds its club, token, adjudicators by role and faucet. Absent on a node that is not a demo.
 */
export interface DemoFacts {
  clubId: string;
  token: { id: string; decimals: number };
  /** Adjudicators this world runs, by the role a party names them in. A convenience: the parties choose. */
  adjudicators: Array<{ role: 'primary' | 'fallback' | 'appeal'; address: Address; name: string }>;
  faucet: { path: '/v1/faucet'; grant: TokenAmount; perAddressEverySec?: number; perClientPerWindow?: number };
  /** Every node of this world. */
  operators?: string[];
  /** The club's shortest judge, fallback and appeal window, in seconds. */
  minWindowSec?: number;
  /** Who judges rubric deals here. */
  judges?: Record<string, unknown>;
}

export interface RateLimit {
  /** Writes per signer address (or per client when a write names no signer) per window. */
  writes: number;
  /** Reads per client per window. */
  reads: number;
  windowMs: number;
}

export interface LogEntry {
  requestId: string;
  method: string;
  path: string;
  /** The route template the request matched (openapi/index.ts routeOf): the path without its addresses and IDs. */
  route: string;
  status: number;
  /** The problem type of the answer, when it was one. */
  problem?: ApiProblemType;
  ms: number;
  /** W3C trace context, logged as received; it never enters a signed message, receipt or event. */
  traceparent?: string;
}

export interface OperatorOptions {
  settlement: Settlement;
  registry: Registry;
  /** The receipt-signing key. From the environment in a deployment; never logged. */
  signerKey: `0x${string}`;
  operatorId: string;
  /** Checked by the startup guards (no real money). */
  env: Readonly<Record<string, string | undefined>>;
  rateLimit?: RateLimit;
  log?: (entry: LogEntry) => void;
  /**
   * A relay policy: returns a problem to refuse an operation. Any operator may refuse anything; the
   * neutrality tests and demo beat 7 use it to show that a refusal never stops a valid commitment
   * (ADR-0005). `refuseParties` in policy.ts is the stock one.
   */
  policy?: RelayPolicy;
  /**
   * A content-addressed ciphertext store served at /v1/ciphertext (ADR-0016 §8). Ciphertext only: an
   * operator never receives plaintext or a content key. Without one, those routes answer not_found.
   */
  store?: CiphertextStore;
  /** This node's public base URL, for ciphertext URIs and the well-known document. Default: the listening address. */
  baseUrl?: string;
  /**
   * Plain-language notes a public node states about itself (the hosted demo: test tokens only, what is
   * shared, what is scripted), served as `notes` in /.well-known/holdback.json and appended to /llms.txt.
   * Absent by default, so `pnpm sim` serves neither.
   */
  notes?: readonly string[];
  /**
   * ADR-0023: this node's operator fee, published in /v1/status and discovery as `fees.operator`. When the fee it
   * gives for a commitment's price is above zero, prepare/agree-and-fund adds the third slot and a funded agree
   * without it is answered 402 payment_required. Nothing on the settlement layer requires it: other operators and
   * direct submission relay the same agreement free. Absent: this node charges nothing.
   */
  fee?: OperatorFeeSchedule;
  /** On an EVM settlement layer: the ERC-3009 messages the buyer signs to fund and to pay the fee (ADR-0025). */
  erc3009?: Erc3009Signing;
  /** Advisory notices this node adds to prepare, write and state answers (NoticeSubject). Absent: none. */
  notices?: (about: NoticeSubject) => readonly string[] | Promise<readonly string[]>;
  /** A demo world's facts for discovery (DemoFacts). Absent: this node is not a demo. */
  demo?: () => DemoFacts | Promise<DemoFacts>;
  /** Feedback and issue reports at /v1/feedback (T-032, feedback.ts), an operator service. Absent: those routes answer not_found. */
  feedback?: FeedbackOptions;
  /** Test only: relay, then drop the connection without answering (a response lost in transit). */
  dropResponses?: boolean;
  now?: () => number;
}

/** A problem with any extra headers (a planned route's Link to its source). */
class HttpProblem extends Error {
  constructor(
    readonly problem: ApiProblem,
    readonly headers: Record<string, string> = {},
  ) {
    super(problem.detail);
  }
}
const fail = (type: ApiProblemType, detail: string, members: ProblemMembers = {}, headers?: Record<string, string>): never => {
  throw new HttpProblem({ type, detail, ...members }, headers);
};

// Pagination (page.schema.json)

const encodeCursor = (seq: number): string => Buffer.from(`s${seq}`).toString('base64url');
function decodeCursor(cursor: string): number {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) fail('invalid_cursor', 'cursor is not one this operator issued');
  const m = /^s(\d{1,15})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) fail('invalid_cursor', 'cursor is not one this operator issued');
  return Number(m![1]);
}

/** Items newest first by `seq`; a cursor resumes below the last sequence number served. */
function paginate<T>(items: readonly T[], seq: (t: T) => number, q: URLSearchParams): Page<T> {
  const rawLimit = q.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!(limit >= 1 && limit <= MAX_LIMIT)) fail('invalid_terms', `limit must be an integer from 1 to ${MAX_LIMIT}`, { field: 'limit' });
  const cursor = q.get('cursor');
  const below = cursor === null ? Infinity : decodeCursor(cursor);
  const sorted = [...items].sort((a, b) => seq(b) - seq(a)).filter((t) => seq(t) < below);
  const page = sorted.slice(0, limit);
  return { items: page, nextCursor: sorted.length > limit ? encodeCursor(seq(page.at(-1)!)) : null };
}

// Schema checks

const ZERO_SIGNATURE = `0x${'00'.repeat(65)}` as const;
/** A slot left out or left `null` (as prepare returns it) gets the placeholder; a signature present is kept. */
const withSig = <T extends object>(m: T, ...keys: string[]): T => {
  const out = { ...m } as Record<string, unknown>;
  for (const k of keys) if (out[k] === undefined || out[k] === null) out[k] = ZERO_SIGNATURE;
  return out as T;
};

/** Fills the signatures a dry run leaves out or sends as null, so the unsigned body can be checked for shape only. */
function placeholderSigned(op: Operation): Operation {
  switch (op.kind) {
    case 'offer':
      return { ...op, commitment: { ...op.commitment, signatures: withSig(op.commitment.signatures ?? {}, 'seller') } };
    case 'hold':
      return { ...op, commitment: { ...op.commitment, signatures: withSig(op.commitment.signatures ?? {}, 'seller') }, agree: withSig(op.agree, 'signature'), funding: withSig(op.funding, 'signature') };
    case 'agree':
      return op.fund
        ? { ...op, message: withSig(op.message, 'signature'), fund: withSig(op.fund, 'signature'), ...(op.operatorFee ? { operatorFee: withSig(op.operatorFee, 'signature') } : {}) }
        : { ...op, message: withSig(op.message, 'signature') };
    case 'fund':
    case 'early_accept':
      return { ...op, message: withSig(op.message, 'signature') } as Operation;
    case 'deliver':
      return { ...op, delivery: withSig(op.delivery, 'signature') };
    case 'appeal':
      return { ...op, appeal: withSig(op.appeal, 'signature') };
    case 'settle':
      return { ...op, message: withSig(op.message, 'buyerSignature', 'sellerSignature') };
    default:
      return op;
  }
}

/** A core refusal as this node answers it: an invalid_terms names the input at fault (`prefix` places a nested part). */
const refusal = (p: Problem, prefix?: string): never => {
  const field = p.type === 'invalid_terms' ? fieldOf(p.detail, prefix) : undefined;
  return fail(p.type, p.detail, field ? { field } : {});
};
function message<T>(value: unknown, type: string, prefix?: string): T {
  const r = parseMessage(value);
  if (!r.ok) refusal(r.error, prefix);
  if (r.ok && r.value.type !== type) fail('invalid_terms', `expected a ${type}, got ${r.value.type}`, { field: prefix ? `${prefix}.type` : 'type' });
  return (r as Extract<typeof r, { ok: true }>).value as T;
}
function parsed<T>(r: Result<T, Problem>, prefix?: string): T {
  if (!r.ok) refusal(r.error, prefix);
  return (r as Extract<typeof r, { ok: true }>).value;
}

/** Checks every body against spec/schemas and that each message is the type its route takes. */
function checkShape(op: Operation): void {
  switch (op.kind) {
    case 'offer':
      parsed(parseAnyCommitment(op.commitment));
      return;
    case 'acceptance':
      message(op.message, 'AdjudicatorAcceptance');
      return;
    case 'agree':
      message(op.message, 'Agree');
      if (op.fund) message(op.fund, 'FundingAuthorization', 'fund');
      if (op.operatorFee) message(op.operatorFee, 'TransferAuthorization', 'operatorFee');
      return;
    case 'hold':
      parsed(parseAnyCommitment(op.commitment), 'commitment');
      message(op.acceptance, 'AdjudicatorAcceptance', 'acceptance');
      message(op.agree, 'Agree', 'agree');
      message(op.funding, 'FundingAuthorization', 'funding');
      return;
    case 'fund':
      message(op.message, 'FundingAuthorization');
      return;
    case 'deliver':
      parsed(parseDelivery(op.delivery));
      return;
    case 'early_accept':
      message(op.message, 'EarlyAccept');
      return;
    case 'decide':
      message(op.message, 'Decision');
      return;
    case 'appeal':
      parsed(parseAppeal(op.appeal));
      return;
    case 'settle':
      message(op.message, 'MutualSettlement');
      return;
    case 'trigger':
      return;
  }
}

const MISSING_ID =
  'id is required: the commitment ID is the EIP-712 struct hash (hashStruct, primary type CommitmentTerms) of the terms, without id and signatures. ' +
  'POST /v1/prepare/offer returns it as commitmentId and in submit.body.id; to compute it yourself, see "Encodings" in https://escrow.stream/llms.txt';

/** `?validateOnly=` is `true`, `false` or absent; anything else is refused rather than run live. */
function validateOnly(q: URLSearchParams): boolean {
  const values = q.getAll('validateOnly');
  if (values.length === 0) return false;
  if (values.length > 1 || (values[0] !== 'true' && values[0] !== 'false')) fail('invalid_terms', 'validateOnly must be true or false', { field: 'validateOnly' });
  return values[0] === 'true';
}

/**
 * The escrow states that take each operation, for `needs` on an invalid_state (D39). The settlement layer still
 * decides; this only tells a caller what to wait for.
 */
const SETTLE_STATES = ['Held', 'Delivered', 'FallbackJudging', 'Escalated'];
export const NEEDS: Partial<Record<Operation['kind'], string[]>> = {
  acceptance: ['Offered'],
  agree: ['AcceptedByAdjudicator'],
  fund: ['Agreed'],
  deliver: ['Held'],
  early_accept: ['Delivered'],
  decide: ['Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded'],
  appeal: ['Released', 'Refunded'],
  settle: SETTLE_STATES,
};
export const TRIGGER_NEEDS: Record<string, string[]> = {
  expire_offer: ['Offered', 'AcceptedByAdjudicator', 'Agreed'],
  reclaim: ['Held'],
  fallback: ['Delivered'],
  default: ['FallbackJudging', 'Escalated'],
  apply_default: ['Defaulted'],
  appeal_expiry: ['Released', 'Refunded'],
  settle: ['Disputed'],
};
const needsOf = (op: Operation): string[] | undefined => (op.kind === 'trigger' ? TRIGGER_NEEDS[op.timeout] : NEEDS[op.kind]);

/** Whole seconds with Z, one format in every read model (D39): `…07.000Z` becomes `…07Z`. */
const TIME_MS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.0+Z$/;
function wholeSeconds<T>(v: T): T {
  if (typeof v === 'string') return (TIME_MS.test(v) ? v.replace(TIME_MS, '$1Z') : v) as T;
  if (Array.isArray(v)) return v.map(wholeSeconds) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wholeSeconds(x)])) as T;
  return v;
}

/** The address whose write budget an operation spends, when it names one. */
function signerOf(op: Operation): string | undefined {
  switch (op.kind) {
    case 'offer':
      return op.commitment.seller;
    case 'hold':
      return op.agree.buyer;
    case 'acceptance':
    case 'decide':
      return op.message.adjudicator;
    case 'agree':
    case 'early_accept':
      return op.message.buyer;
    case 'fund':
      return op.message.from;
    case 'appeal':
      return op.appeal.appellantAddress;
    default:
      return undefined;
  }
}

// The operator

interface Indexed {
  offeredSeq: number;
  buyer: string;
  seller: string;
  adjudicators: string[];
  /** The level the terms signed (ADR-0020); a verified Publish raises it in `disclosures`. */
  level: DisclosureLevel;
  events: SettlementEvent[];
}

/**
 * ADR-0024 §3: what this node has verified for publication of a private deal: the level a co-signed Publish raised
 * it to, and the bodies whose keys decrypted to their bound hashes. Held per node; each node checks for itself.
 */
interface Published {
  level: DisclosureLevel;
  disclosed: NonNullable<SettlementProjection['disclosed']>;
}

interface Ctx {
  requestId: string;
  method: string;
  url: URL;
  segments: string[];
  req: IncomingMessage;
  res: ServerResponse;
  /** The problem type answered, for the log line. */
  problem?: ApiProblemType;
}

const lc = (s: string) => s.toLowerCase();

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}
const isAddress = (s: string | undefined): s is Address => s !== undefined && /^0x[0-9a-fA-F]{40}$/.test(s);
/** The events that count as an adjudicator's use (ADR-0030 `observed.lastUsedAt`): an acceptance or a decision. */
const USES = new Set<string>(['adjudicator.accepted', 'judgment.decided', 'appeal.decided']);
/** A cursor below every listing seq, so the adjudicator list pages oldest first through the newest-first paginate. */
const LIST_TOP = 999_999_999_999_999;
const isHex32 = (s: string | undefined): s is Hex32 => s !== undefined && /^0x[0-9a-f]{64}$/.test(s);

export class Operator {
  private readonly domain;
  private readonly signer;
  private readonly idempotency = new IdempotencyStore();
  private readonly index = new Map<Hex32, Indexed>();
  private readonly disclosures = new Map<Hex32, Published>();
  private readonly receipts = new Map<Hex32, Map<number, Receipt>>();
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly streams = new Set<ServerResponse>();
  /** ADR-0030: when each adjudicator last accepted or decided, from the events this node indexed. */
  private readonly lastUsed = new Map<string, Timestamp>();
  private head = -1;
  private syncing: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly desk: FeedbackDesk | undefined;
  /** Public base URL (no trailing slash); startOperator sets it to the listening address when not given. */
  baseUrl: string;

  /** Runs the startup guards: no Operator exists off a test chain or with a live Stripe key. */
  constructor(private readonly o: OperatorOptions) {
    startupGuards({ env: o.env, chainId: o.registry.chainId });
    this.baseUrl = (o.baseUrl ?? '').replace(/\/+$/, '');
    this.domain = holdbackDomain(o.registry.chainId, o.registry.verifyingContract);
    this.signer = privateKeyToAccount(o.signerKey).address;
    this.now = o.now ?? Date.now;
    this.desk = o.feedback
      ? new FeedbackDesk(o.feedback, {
          operatorId: o.operatorId,
          receiptSigner: this.signer,
          domain: this.domain,
          schemaVersion: SCHEMA_VERSION,
          now: this.now,
          eventSeq: async () => {
            await this.sync();
            return Math.max(this.head, 0);
          },
          commitment: async (id) => {
            const s = await o.settlement.state(id);
            return s ? { escrowState: s.escrowState, lastEventSeq: s.lastEventSeq } : null;
          },
        })
      : undefined;
  }

  get receiptSigner(): Address {
    return this.signer;
  }

  /** ADR-0023: the fee schedule this node publishes, if any. */
  get feeSchedule(): OperatorFeeSchedule | undefined {
    return this.o.fee;
  }

  /** Ends open event streams (server shutdown). */
  endStreams(): void {
    for (const s of this.streams) s.end();
    this.streams.clear();
  }

  // The event index

  /** Catches up with the settlement layer's event log. Serialized, so concurrent reads index once. */
  private sync(): Promise<void> {
    this.syncing = this.syncing.then(async () => {
      for await (const e of this.o.settlement.events(this.head + 1)) {
        this.head = e.seq;
        if (USES.has(e.type) && e.actor && e.actor !== 'anyone') this.lastUsed.set(lc(e.actor), e.at);
        if (!e.commitmentId) continue;
        let entry = this.index.get(e.commitmentId);
        if (e.type === 'commitment.offered') {
          const t = e.payload['terms'] as AnyCommitmentTerms;
          const a = t.adjudication;
          entry = { offeredSeq: e.seq, buyer: lc(t.buyer), seller: lc(t.seller), adjudicators: [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].map(lc), level: t.disclosure.level, events: [] };
          this.index.set(e.commitmentId, entry);
        }
        entry?.events.push(e);
      }
    });
    return this.syncing;
  }

  // Receipts

  private async receiptFor(e: SettlementEvent): Promise<Receipt> {
    const body = { operator: this.signer, eventSeq: e.seq, eventHash: e.hash, ...(e.commitmentId ? { commitmentId: e.commitmentId } : {}) };
    const signature = await signMessage(this.o.signerKey, this.domain, { ...body, type: 'Receipt' });
    const receipt: Receipt = { ...body, signature };
    if (e.commitmentId) {
      const m = this.receipts.get(e.commitmentId) ?? new Map<number, Receipt>();
      m.set(e.seq, receipt);
      this.receipts.set(e.commitmentId, m);
    }
    return receipt;
  }

  // HTTP

  readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    const started = this.now();
    const requestId = randomUUID();
    const url = new URL(req.url ?? '/', 'http://operator.invalid');
    const ctx: Ctx = { requestId, method: req.method ?? 'GET', url, segments: url.pathname.split('/').filter(Boolean), req, res };
    res.setHeader('Request-Id', requestId);
    res.setHeader('Holdback-Schema-Version', SCHEMA_VERSION);
    res.on('finish', () => {
      const tp = req.headers['traceparent'];
      this.o.log?.({
        requestId,
        method: ctx.method,
        path: url.pathname,
        route: routeOf(ctx.method, url.pathname),
        status: res.statusCode,
        ...(ctx.problem ? { problem: ctx.problem } : {}),
        ms: this.now() - started,
        ...(typeof tp === 'string' ? { traceparent: tp } : {}),
      });
    });
    this.route(ctx).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpProblem) return this.sendProblem(ctx, e.problem, e.headers);
      // Never the cause: it may name internals. The Request-Id ties the answer to this node's log line.
      this.sendProblem(ctx, { type: 'internal', detail: 'the operator could not process this request; retry, or use another operator' });
    });
  };

  private send(ctx: Ctx, r: StoredResponse): void {
    if (ctx.res.writableEnded) return;
    ctx.res.writeHead(r.status, r.headers);
    ctx.res.end(r.body);
  }

  /** RFC 9457 with the type's page linked (problems.ts); a `link` in `headers` joins it. */
  private problemResponse(ctx: Ctx, p: ApiProblem, headers: Record<string, string> = {}): StoredResponse {
    ctx.problem = p.type;
    const own = problemHeaders(p);
    const link = headers['link'] ? `${own['link']}, ${headers['link']}` : own['link']!;
    return { status: statusOf(p.type), headers: { ...own, ...headers, link }, body: JSON.stringify(problemBody(p, ctx.requestId)) };
  }

  private sendProblem(ctx: Ctx, p: ApiProblem, headers: Record<string, string> = {}): void {
    this.send(ctx, this.problemResponse(ctx, p, headers));
  }

  private ok(body: unknown, headers: Record<string, string> = {}): StoredResponse {
    return { status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
  }

  private client(ctx: Ctx): string {
    return ctx.req.socket.remoteAddress ?? 'unknown';
  }

  /** This node's notices about a subject, when it has any (`notices` in the body; never changes the answer). */
  private async noticesFor(about: NoticeSubject): Promise<{ notices?: string[] }> {
    const n = this.o.notices ? await this.o.notices(about) : [];
    return n.length ? { notices: [...n] } : {};
  }

  /** The fixed window a bucket is in now (ADR-0017 §3). */
  private window(bucket: string): { start: number; count: number } {
    const now = this.now();
    let w = this.windows.get(bucket);
    if (!w || now - w.start >= this.o.rateLimit!.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(bucket, w);
    }
    return w;
  }

  /** Refuses with 429 (Retry-After and retryAfterSec in whole seconds) when the bucket is spent; charges nothing. */
  private admit(bucket: string, budget: number): void {
    if (!this.o.rateLimit) return;
    const w = this.window(bucket);
    if (w.count < budget) return;
    const retryAfterSec = Math.max(1, Math.ceil((w.start + this.o.rateLimit.windowMs - this.now()) / 1000));
    fail('rate_limited', 'too many requests; retry later or use another operator', { retryAfterSec });
  }

  private charge(bucket: string): void {
    if (this.o.rateLimit) this.window(bucket).count++;
  }

  /** Moves one counted request from one bucket to another (a write the settlement layer verified: client to signer). */
  private transfer(from: string, to: string): void {
    if (!this.o.rateLimit) return;
    const w = this.window(from);
    if (w.count > 0) w.count--;
    this.window(to).count++;
  }

  /** Fixed-window throttle: admit, then charge. */
  private throttle(bucket: string, budget: number): void {
    this.admit(bucket, budget);
    this.charge(bucket);
  }

  private async body(ctx: Ctx, limit = MAX_BODY_BYTES): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of ctx.req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) fail('payload_too_large', `request bodies are limited to ${limit} bytes here`);
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '') return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return fail('invalid_terms', 'the body is not JSON');
    }
  }

  private async route(ctx: Ctx): Promise<void> {
    const { method, segments: s } = ctx;
    const path = ctx.url.pathname;
    // One discovery document (D39), also at / for an agent that has only this node's URL.
    if (method === 'GET' && (path === '/.well-known/holdback.json' || path === '/')) return this.send(ctx, this.ok(await this.discovery()));
    if (method === 'GET' && path === '/llms.txt') return this.send(ctx, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: llmsTxt(this.baseUrl, this.o.notes) });
    // A route a decision names but no build serves yet (x-holdback-planned): 501 and where it is specified (D39).
    // Counted as a read of this client first, so planned routes are no way around the throttle.
    const planned = plannedRoute(method, path);
    if (planned) {
      this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
      fail('not_implemented', `${method} ${planned.path} is planned, not built: ${planned.note}`, {}, { link: `<${planned.source}>; rel="describedby"` });
    }
    if (s[0] !== 'v1') fail('not_found', `no route ${path}`);
    if (s[1] === 'ciphertext') return this.ciphertext(ctx);
    if (s[1] === 'feedback') return this.feedback(ctx);
    if (method === 'POST' && s[1] === 'prepare' && s.length === 3) return this.prepare(ctx, s[2]!);
    if (method === 'POST') return this.write(ctx);
    if (method !== 'GET') fail('not_found', `no route ${method} ${path}`);
    this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
    if (s.length === 2 && s[1] === 'events') return this.stream(ctx);
    const body = await this.read(ctx);
    // The state read links to the signed terms it is about (RFC 8288), so a party compares against the operator's copy.
    const link = s[1] === 'commitments' && s.length === 3 ? { link: `</v1/commitments/${s[2]}/terms>; rel="terms"` } : {};
    return this.send(ctx, this.ok(body, link));
  }

  // Writes

  /**
   * Writes. ADR-0024 §1 (C4): every write is counted against its client at entry, in one synchronous step, so a
   * concurrent burst cannot pass the check before any of it is counted. A fresh relay the settlement layer accepted
   * (its signature verified) moves that count from the client to the signer. So a forged signature never spends
   * another signer's budget, refusals, unsigned writes, dry runs and replays stay on the client, and a signer can
   * overshoot its own budget only by concurrent writes within its clients' budgets.
   */
  private async write(ctx: Ctx): Promise<void> {
    const budget = this.o.rateLimit?.writes ?? 0;
    const client = `w:${this.client(ctx)}`;
    this.throttle(client, budget);
    const s = ctx.segments;
    const raw = await this.body(ctx, s.join('/') === 'v1/adjudicators' ? MAX_REGISTRATION_BYTES : MAX_BODY_BYTES);
    const dryRun = validateOnly(ctx.url.searchParams);
    if (s.join('/') === 'v1/faucet') return this.idempotent(ctx, raw, () => this.faucet(ctx, raw));
    if (s.join('/') === 'v1/adjudicators') return this.registerAdjudicator(ctx, raw, dryRun);
    if (s.length === 4 && s[1] === 'commitments' && s[3] === 'disclosure') {
      if (dryRun) fail('invalid_terms', 'disclosure has no dry run', { field: 'validateOnly' });
      return this.idempotent(ctx, raw, () => this.disclose(s[2]!, raw));
    }
    const parsedOp = operationOf(s, raw);
    if (!parsedOp.ok) refusal(parsedOp.error);
    const op = (parsedOp as Extract<typeof parsedOp, { ok: true }>).value;
    if ((op.kind === 'offer' || op.kind === 'hold') && (op.commitment as { id?: unknown }).id === undefined) fail('invalid_terms', MISSING_ID, { field: 'id' });
    checkShape(dryRun ? placeholderSigned(op) : op);
    const signer = signerOf(op);
    const signerBucket = signer ? `w:${lc(signer)}` : undefined;
    if (signerBucket) this.admit(signerBucket, budget);
    // The policy sees a frozen copy: it can decline, never alter what this node relays.
    const refused = this.o.policy?.(deepFreeze(structuredClone(op)), await this.policyContext(op));
    if (refused) fail(refused.type, refused.detail);
    if (dryRun) {
      await this.refuseUnpayableFallback(op);
      return this.send(ctx, await this.dryRun(op));
    }
    return this.idempotent(ctx, raw, async () => {
      // Inside the handler, so a retry of a relayed write replays its answer even if a bond or the fee changed since
      // (ADR-0030 §5). The fallback refusal comes before the fee, so a buyer is never asked to pay for terms refused here.
      await this.refuseUnpayableFallback(op);
      await this.chargeFee(op);
      const r = await this.relay(ctx, op, await this.bondNoticesFor(op));
      if (r.status < 300 && signerBucket) this.transfer(client, signerBucket);
      return r;
    });
  }

  /**
   * ADR-0030 §5: advisory notices on a relayed offer, hold or agreement for each named adjudicator without a bond for
   * the price, read before the relay. At agree the primary is warned about only when it has no bond (bondNotices).
   * T-221 review: and for each of this node's own adjudicators that would decline its role on these terms.
   */
  private async bondNoticesFor(op: Operation): Promise<string[]> {
    const ctx = this.prepareContext();
    if (op.kind === 'offer' || op.kind === 'hold') return [...(await bondNotices(ctx, op.commitment)), ...(await turnNotices(ctx, op.commitment))];
    if (op.kind !== 'agree') return [];
    const terms = await ctx.commitment(op.message.commitmentId);
    const state = terms ? await this.o.settlement.state(terms.id) : null;
    return terms ? [...(await bondNotices(ctx, terms, { primaryAccepted: state !== null && state.escrowState !== 'Offered' })), ...(await turnNotices(ctx, terms))] : [];
  }

  /**
   * ADR-0023: a funded agree relayed by this node carries this node's fee, or the answer is 402 naming it. Only this
   * node asks: the settlement layer, other operators and direct submission take the same agreement without it.
   * A dry run is free, and so is every other call.
   */
  private async chargeFee(op: Operation): Promise<void> {
    const schedule = this.o.fee;
    if (!schedule || op.kind !== 'agree' || !op.fund) return;
    const terms = await this.prepareContext().commitment(op.message.commitmentId);
    if (!terms) return; // the settlement layer answers for a commitment this node has not indexed
    const due = operatorFeeDue(terms.price, schedule);
    if (due.amount === '0') return;
    const paid = op.operatorFee;
    if (paid && lc(paid.to) === lc(schedule.to) && paid.token === due.token && BigInt(paid.value) >= BigInt(due.amount)) return;
    const what = !paid ? 'carries no operatorFee' : lc(paid.to) !== lc(schedule.to) ? `pays its operatorFee to ${paid.to}, not to this operator` : `pays an operatorFee of ${amountText({ token: paid.token, amount: paid.value } as TokenAmount)}`;
    fail(
      'payment_required',
      `this operator relays a funded agreement for its operator fee of ${operatorFeeText(due, schedule)}, not refunded; this agree ${what}. ` +
        'Prepare it again with POST /v1/prepare/agree-and-fund and sign the operatorFee slot, or send the same signed agreement to another operator or directly to the settlement layer, where no fee of this operator applies',
      { fee: { to: schedule.to, token: due.token, amount: due.amount } },
    );
  }

  /**
   * ADR-0030 §5: this node relays no offer, hold or agreement whose fallback has less free bond than the price, since an
   * overturned fallback decision pays the price from that bond (D43). A relay refusal: the settlement layer, other
   * operators and direct submission take the same signed messages.
   */
  private async refuseUnpayableFallback(op: Operation): Promise<void> {
    const terms = op.kind === 'offer' || op.kind === 'hold' ? op.commitment : op.kind === 'agree' ? await this.prepareContext().commitment(op.message.commitmentId) : undefined;
    if (!terms) return;
    const why = await fallbackBondRefusal(this.prepareContext(), terms);
    if (why) fail('invalid_terms', why, op.kind === 'agree' ? {} : { field: `${op.kind === 'hold' ? 'commitment.' : ''}adjudication.fallbackAdjudicator` });
  }

  /**
   * POST /v1/adjudicators (ADR-0030): verifies and stores an adjudicator's self-signed registration, and answers the
   * served record. A write, counted against the client at entry, and it stays there: anyone can post a registration
   * the adjudicator once signed, so none moves to the adjudicator's own budget, and fresh keys cannot multiply a
   * client's budget (review of PR 184).
   */
  private async registerAdjudicator(ctx: Ctx, raw: unknown, dryRun: boolean): Promise<void> {
    const store = this.o.registry.registrations ?? fail('not_found', 'this operator stores no adjudicator registrations; post yours to another operator');
    const run = async () => {
      try {
        return await register(store!, raw, { domain: this.domain, now: this.settlementNow(), dryRun });
      } catch (e) {
        if (e instanceof RegistrationError) throw new HttpProblem(e.problem);
        throw e;
      }
    };
    if (dryRun) return this.send(ctx, this.ok(await this.listingOf((await run()).stored), { 'holdback-dry-run': 'true' }));
    return this.idempotent(ctx, raw, async () => {
      const { stored } = await run();
      await this.sync();
      return this.ok(await this.listingOf(stored));
    });
  }

  /**
   * Any address's bond as the settlement layer holds it, read live: undefined when this node has no bond reader, and
   * `unreadable` when the read failed. The bond refusal and the notices act only on this read, never on a cache that
   * may be cold (review of PR 184).
   */
  private async liveBond(a: Address, o: { listing?: boolean } = {}): Promise<Bond | 'unreadable' | undefined> {
    if (!this.o.registry.pool) return undefined;
    try {
      return await this.o.registry.pool(a, o);
    } catch {
      return 'unreadable';
    }
  }

  /**
   * A bond to list beside a registration: the live read, else this world's own list. A listing read may be refused
   * past the node's read budget (T-221 review), so an unauthenticated page cannot fan out into unbounded chain reads.
   */
  private async bondOf(a: Address): Promise<Bond | undefined> {
    const live = await this.liveBond(a, { listing: true });
    return (live === 'unreadable' ? undefined : live) ?? this.o.registry.adjudicators().find((x) => lc(x.address) === lc(a))?.bond;
  }

  /**
   * ADR-0030 §3: a stored registration as this node serves it: the signed record, the bond the settlement layer holds
   * (in `pool` and as `bond`), and `observed`, what this node saw. Only `observed` and the balances are unsigned.
   */
  private async listingOf(stored: StoredRegistration): Promise<Record<string, unknown>> {
    const r = stored.record;
    const zero = { token: r.fee.min.token, amount: '0' } as TokenAmount;
    const read = await this.bondOf(r.address);
    const bond = read ?? { junior: zero, senior: zero, reserved: zero };
    const defaults: Partial<Record<string, Address>> = this.o.registry.defaultAdjudicators ?? {};
    const defaultFor = (['primary', 'fallback', 'appeal'] as const).filter((role) => defaults[role] && lc(defaults[role]) === lc(r.address));
    return {
      ...r,
      pool: { ...bond, terms: r.pool.terms },
      bond,
      observed: {
        registeredAt: stored.registeredAt,
        lastUsedAt: this.lastUsed.get(lc(r.address)) ?? null,
        expired: !(Date.parse(this.settlementNow()) < Date.parse(r.registration.expiresAt)),
        bond: !read ? 'unknown' : hasBond(bond) ? 'bonded' : 'none',
        ...(defaultFor.length ? { defaultFor } : {}),
      },
    };
  }

  /**
   * GET /v1/adjudicators: every adjudicator this node serves, oldest first. The world's own bonded adjudicators keep
   * their place whether or not they registered, then registrations follow in the order this node first stored them, so
   * a cursor never skips one. Bonds are read for the page only.
   */
  private async adjudicatorPage(q: URLSearchParams): Promise<Page<Record<string, unknown>>> {
    const reg = this.o.registry;
    const stored = new Map(((await reg.registrations?.list()) ?? []).map((r) => [lc(r.record.address), r]));
    const own = reg.adjudicators();
    const ownSet = new Set(own.map((a) => lc(a.address)));
    const later = [...stored.values()].filter((r) => !ownSet.has(lc(r.record.address))).sort(firstStored);
    const rows: Array<{ seq: number; stored?: StoredRegistration; view?: (typeof own)[number] }> = [
      ...own.map((view, i) => ({ seq: LIST_TOP - i, view, ...(stored.has(lc(view.address)) ? { stored: stored.get(lc(view.address))! } : {}) })),
      ...later.map((r, i) => ({ seq: LIST_TOP - own.length - i, stored: r })),
    ];
    const page = paginate(rows, (r) => r.seq, q);
    return { items: await Promise.all(page.items.map((r) => (r.stored ? this.listingOf(r.stored) : this.unregisteredListing(r.view!)))), nextCursor: page.nextCursor };
  }

  /** A bonded adjudicator with no stored registration: a world's own record when it has one, else the bond alone. */
  private unregisteredListing(a: ReturnType<Registry['adjudicators']>[number]): Record<string, unknown> {
    const r = this.o.registry.registration?.(a.address);
    return r ? { ...r, ...a } : { ...a };
  }

  /** The registration this node holds for an address: a stored one, else a world's own record. */
  private async registrationOf(a: Address) {
    return (await this.o.registry.registrations?.get(a))?.record ?? this.o.registry.registration?.(a) ?? null;
  }

  /** A settlement-layer refusal as this node answers it: an invalid_state says the state now and what the call needs. */
  private async refusalOf(op: Operation, p: Problem): Promise<ApiProblem> {
    if (p.type !== 'invalid_state') return p.type === 'invalid_terms' ? { ...p, ...(fieldOf(p.detail) ? { field: fieldOf(p.detail)! } : {}) } : p;
    const s = await this.o.settlement.state(commitmentIdOf(op)).catch(() => null);
    if (!s) return p;
    const needs = needsOf(op);
    return { ...p, state: s.escrowState, ...(needs && !needs.includes(s.escrowState) ? { needs } : {}) };
  }

  /** The parties of the commitment an operation touches: from the operation, else from this node's index. */
  private async policyContext(op: Operation): Promise<PolicyContext> {
    const signer = signerOf(op);
    const out: PolicyContext = signer ? { signer: lc(signer) } : {};
    if (op.kind === 'offer' || op.kind === 'hold') {
      const t = op.commitment;
      const a = t.adjudication;
      return { ...out, parties: { buyer: lc(t.buyer), seller: lc(t.seller), adjudicators: [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].map(lc) } };
    }
    await this.sync();
    const entry = this.index.get(commitmentIdOf(op));
    return entry ? { ...out, parties: { buyer: entry.buyer, seller: entry.seller, adjudicators: entry.adjudicators } } : out;
  }

  private async idempotent(ctx: Ctx, raw: unknown, handler: (key: string) => Promise<StoredResponse>): Promise<void> {
    const key = ctx.req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 1 || key.length > 255) fail('invalid_terms', 'mutating requests need an Idempotency-Key header (1 to 255 characters)', { field: 'Idempotency-Key' });
    const k = key as string;
    const outcome = await this.idempotency.run(k, fingerprint('POST', ctx.url.pathname, raw), async () => {
      try {
        return await handler(k);
      } catch (e) {
        if (e instanceof HttpProblem) return this.problemResponse(ctx, e.problem, e.headers);
        throw e;
      }
    });
    if (outcome.kind === 'conflict') fail('idempotency_conflict', `Idempotency-Key ${k} was used with another request`);
    const response = (outcome as Exclude<typeof outcome, { kind: 'conflict' }>).response;
    if (this.o.dropResponses) return void ctx.res.socket?.destroy();
    this.send(ctx, response);
  }

  /** The operation's submissions in order, under the keys the SDK's direct path would use. */
  private async relay(ctx: Ctx, op: Operation, before: readonly string[] = []): Promise<StoredResponse> {
    const key = ctx.req.headers['idempotency-key'] as string;
    const subs = submissionsOf(op);
    const keys = submissionKeys(key, subs.length);
    let last: Extract<SubmitResult, { ok: true }> | undefined;
    for (const [i, sub] of subs.entries()) {
      const r = await this.o.settlement.submit(sub, { idempotencyKey: keys[i]!, via: this.o.operatorId });
      if (!r.ok) return this.problemResponse(ctx, await this.refusalOf(op, r.problem));
      last = r;
    }
    const event = last!.events.at(-1);
    const receipt = event ? await this.receiptFor(event) : undefined;
    const notices = [...before, ...((await this.noticesFor({ kind: 'write', op })).notices ?? [])];
    return this.ok({ ...wholeSeconds(last!.state), ...(receipt ? { receipt } : {}), ...(notices.length ? { notices } : {}) });
  }

  /** ADR-0017 §7: Settlement.validate, no idempotency record, no receipt, Holdback-Dry-Run: true. */
  private async dryRun(op: Operation): Promise<StoredResponse> {
    const current = op.kind === 'hold' ? ((await this.o.settlement.state(op.commitment.id))?.escrowState ?? null) : null;
    let r: SubmitResult;
    try {
      r = await this.o.settlement.validate(previewSubmission(op, current) as DryRunSubmission);
    } catch {
      return fail('invalid_terms', 'the settlement layer could not read this message');
    }
    if (!r.ok) throw new HttpProblem(await this.refusalOf(op, r.problem));
    const ok = r as Extract<SubmitResult, { ok: true }>;
    return this.ok(wholeSeconds(ok.state), { 'holdback-dry-run': 'true', 'holdback-signature-check': ok.signatureCheck });
  }

  /**
   * POST /v1/commitments/{id}/disclosure (ADR-0024 §3): publishes a private deal's bodies at this node. A co-signed
   * Publish raises the level (raise only); each key must decrypt its part to the hash the terms bind before this node
   * serves the plaintext. At judgment only the acceptance is served, at public both. Nothing changes on a refusal.
   */
  private async disclose(id: string, raw: unknown): Promise<StoredResponse> {
    const body = parsed(parseDisclosure(raw));
    if (!isHex32(id) || body.commitmentId !== id) fail('invalid_terms', 'commitmentId must be the commitment in the path', { field: 'commitmentId' });
    const c = (await this.prepareContext().commitment(id as Hex32)) ?? fail('not_found', `no commitment ${id}`);
    if (!isSealed(c!)) fail('invalid_terms', 'this commitment is public: its bodies are already served in the clear');
    const sealed = c as unknown as Extract<AnyCommitment, { privateTerms: unknown }>;
    const current = this.disclosures.get(sealed.id) ?? { level: sealed.disclosure.level, disclosed: {} };
    let level = current.level;
    const p = body.publish;
    if (p) {
      if (p.commitmentId !== sealed.id) fail('invalid_terms', 'the Publish names another commitment');
      if (LEVEL_RANK[p.level] < LEVEL_RANK[level]) fail('invalid_state', `the level is already ${level}; a Publish only raises it`);
      if (!(Date.parse(this.settlementNow()) < Date.parse(p.expiresAt))) fail('deadline_passed', `the Publish expired at ${p.expiresAt}`);
      if (!(await verifyCoSigned(this.domain, p, sealed.buyer, sealed.seller))) fail('invalid_signature', 'the Publish is not signed by both the buyer and the seller of these terms');
      level = p.level;
    }
    if (body.keys.recordKeys?.length) fail('invalid_terms', 'recordKeys are reserved: sealed judgment records arrive in a later slice of T-207');
    const disclosed = { ...current.disclosed };
    const open = async (name: 'deliverable' | 'acceptance', key: string): Promise<unknown> => {
      try {
        return await openPart(sealed.privateTerms[name], sealed.id, name, bodyKey(key));
      } catch (e) {
        if (e instanceof CryptoError) return fail('invalid_terms', `the ${name}Key does not open the ${name} to the ${name}Hash the terms bind`);
        throw e;
      }
    };
    if (body.keys.acceptanceKey !== undefined) {
      if (LEVEL_RANK[level] < LEVEL_RANK.judgment) fail('invalid_state', 'at level private no body is published; post the keys with a co-signed Publish to judgment or public');
      disclosed.acceptance = (await open('acceptance', body.keys.acceptanceKey)) as AcceptanceSpec;
    }
    if (body.keys.deliverableKey !== undefined) {
      if (level !== 'public') fail('invalid_state', `at level ${level} only the acceptance is published; a co-signed Publish to public discloses the deliverable`);
      disclosed.deliverable = (await open('deliverable', body.keys.deliverableKey)) as Deliverable;
    }
    this.disclosures.set(sealed.id, { level, disclosed });
    return this.ok(this.projection(sealed));
  }

  /** The projection anyone may read, with the level and bodies this node verified for publication. */
  private projection(c: AnyCommitment): SettlementProjection {
    const pub = this.disclosures.get(c.id);
    const p = projectionOf(c, pub?.disclosed);
    return pub ? { ...p, disclosure: { level: pub.level } } : p;
  }

  /** The level a reader is held to: the signed level, or the one a verified Publish raised it to at this node. */
  private levelOf(id: Hex32, signed: DisclosureLevel): DisclosureLevel {
    return this.disclosures.get(id)?.level ?? signed;
  }

  private settlementNow(): Timestamp {
    return this.o.registry.now?.() ?? (new Date(Math.floor(this.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z') as Timestamp);
  }

  /**
   * Who reads a commitment (ADR-0024 §3): anonymous without an Authorization header, else a party or involved
   * adjudicator with a valid ReadToken; any other token is answered 401 unauthorized.
   */
  private async readerFor(ctx: Ctx, c: AnyCommitment): Promise<Reader> {
    const header = ctx.req.headers['authorization'];
    const a = c.adjudication;
    const r = await readerOf(typeof header === 'string' ? header : undefined, {
      domain: this.domain,
      operator: this.signer,
      now: this.settlementNow(),
      commitmentId: c.id,
      parties: { buyer: c.buyer, seller: c.seller, adjudicator: a.adjudicator, fallbackAdjudicator: a.fallbackAdjudicator, appealAdjudicator: a.appealAdjudicator },
      state: await this.o.settlement.state(c.id),
    });
    if (!r.ok) fail(r.problem.type, r.problem.detail);
    return (r as Extract<typeof r, { ok: true }>).reader;
  }

  /** An event as an outsider reads it: a private deal's offer shows the settlement projection, not the sealed terms. */
  private projectEvent(e: SettlementEvent): SettlementEvent {
    if (e.type !== 'commitment.offered' || !e.commitmentId) return e;
    const p = e.payload as unknown as { termsHash: Hex32; terms: AnyCommitmentTerms; sellerSignature: Signature };
    if (!isSealed(p.terms)) return e;
    const c = { ...p.terms, id: e.commitmentId, signatures: { seller: p.sellerSignature } } as AnyCommitment;
    return { ...e, payload: { termsHash: p.termsHash, projection: this.projection(c) } as unknown as SettlementEvent['payload'] };
  }

  /**
   * POST /v1/faucet (test networks only; the one faucet, D39): test tokens for `address`, and whatever else this
   * world grants with them (on the public demo, a mandate in its club). `amount` is optional; a node may grant a
   * fixed amount instead, and `granted` says what it gave.
   */
  private async faucet(ctx: Ctx, raw: unknown): Promise<StoredResponse> {
    const faucet = this.o.registry.faucet ?? fail('not_found', 'this node has no faucet: it does not serve a test network');
    const b = (raw && typeof raw === 'object' ? raw : {}) as { address?: unknown; amount?: unknown };
    if (!isAddress(b.address as string)) fail('invalid_terms', 'the faucet takes {"address": "0x<40 hex>"}: your own address; make your own keys', { field: 'address' });
    if (b.amount !== undefined && (typeof b.amount !== 'string' || !/^[1-9][0-9]{0,30}$/.test(b.amount))) fail('invalid_terms', 'amount, when given, is base units as a decimal string', { field: 'amount' });
    const address = lc(b.address as string) as Address;
    const r = await faucet(address, { ...(typeof b.amount === 'string' ? { amount: BigInt(b.amount) } : {}), client: this.client(ctx) });
    if (!r.ok) fail(r.problem.type, r.problem.detail, r.retryAfterSec !== undefined ? { retryAfterSec: r.retryAfterSec } : {});
    return this.ok({ address, ...(r as Extract<typeof r, { ok: true }>).grant });
  }

  // Prepare, ciphertext

  /** POST /v1/prepare/{kind}: typed data to sign and the body to submit. Reads only; nothing is recorded. */
  private async prepare(ctx: Ctx, kind: string): Promise<void> {
    this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
    const input = await this.body(ctx);
    let prepared;
    try {
      prepared = await prepare(kind, this.prepareContext(), input);
    } catch (e) {
      if (e instanceof PrepareError) throw new HttpProblem(e.problem);
      throw e;
    }
    const notices = [...(prepared.notices ?? []), ...((await this.noticesFor({ kind: 'prepare', prepareKind: kind, input })).notices ?? [])];
    return this.send(ctx, this.ok({ ...prepared, ...(notices.length ? { notices } : {}) }));
  }

  private prepareContext(): PrepareContext {
    const reg = this.o.registry;
    const eventsOf = async (id: Hex32) => {
      await this.sync();
      return this.index.get(id)?.events ?? [];
    };
    return {
      domain: this.domain,
      now: () => reg.now?.() ?? (new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z') as Timestamp),
      club: (id) => reg.clubs.find((c) => c.id === id),
      registration: (a) => this.registrationOf(a),
      bond: (a) => this.liveBond(a),
      ...(reg.defaultAdjudicators ? { defaultAdjudicators: reg.defaultAdjudicators } : {}),
      ...(reg.declines ? { declines: reg.declines } : {}),
      commitment: async (id) => {
        const offered = (await eventsOf(id)).find((e) => e.type === 'commitment.offered');
        if (!offered) return undefined;
        const p = offered.payload as unknown as { terms: AnyCommitmentTerms; sellerSignature: Signature };
        return { ...p.terms, id, signatures: { seller: p.sellerSignature } } as AnyCommitment;
      },
      delivery: async (id) => (await eventsOf(id)).filter((e) => e.type === 'delivery.submitted').at(-1)?.payload as { deliveryHash: Hex32; attempt: number } | undefined,
      attempt: async (id) => (await this.o.settlement.state(id))?.attempt ?? 1,
      state: (id) => this.o.settlement.state(id),
      ...(this.o.fee ? { operatorFee: this.o.fee } : {}),
      ...(this.o.erc3009 ? { erc3009: this.o.erc3009 } : {}),
    };
  }

  /** POST /v1/ciphertext (raw bytes, Idempotency-Key) stores ciphertext; GET /v1/ciphertext/{sha256:hex} reads it. */
  private async ciphertext(ctx: Ctx): Promise<void> {
    const store = this.o.store ?? fail('not_found', 'this operator does not store ciphertext');
    const s = ctx.segments;
    if (ctx.method === 'GET' && s.length === 3) {
      this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
      let bytes: Uint8Array;
      try {
        bytes = await store!.get(decodeURIComponent(s[2]!) as Sha256);
      } catch {
        return fail('not_found', 'no ciphertext with this id');
      }
      ctx.res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length), 'x-content-type-options': 'nosniff' });
      return void ctx.res.end(Buffer.from(bytes));
    }
    if (ctx.method !== 'POST' || s.length !== 2) fail('not_found', `no route ${ctx.method} ${ctx.url.pathname}`);
    this.throttle(`w:${this.client(ctx)}`, this.o.rateLimit?.writes ?? 0);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of ctx.req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_CIPHERTEXT_BYTES) fail('payload_too_large', `ciphertext is limited to ${MAX_CIPHERTEXT_BYTES} bytes`);
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(Buffer.concat(chunks));
    if (bytes.length === 0) fail('invalid_terms', 'POST the ciphertext bytes as the body (application/octet-stream)');
    // Content-addressed, so the fingerprint is the hash: the same key with other bytes is a conflict.
    return this.idempotent(ctx, { sha256: sha256(bytes) }, async () => {
      const id = await store!.put(bytes);
      return this.ok({ id, uri: `${this.baseUrl}/v1/ciphertext/${id}`, bytes: bytes.length });
    });
  }

  /**
   * POST /v1/feedback (Idempotency-Key; `?validateOnly=true` answers the warning and keeps nothing) and
   * GET /v1/feedback/{id}. An operator service: feedback.ts has the rules.
   */
  private async feedback(ctx: Ctx): Promise<void> {
    const desk = this.desk ?? fail('not_found', 'this operator takes no reports');
    const s = ctx.segments;
    const answer = async (f: () => Promise<Record<string, unknown>>, status = 200): Promise<StoredResponse> => {
      try {
        return { ...this.ok(await f()), status };
      } catch (e) {
        if (e instanceof FeedbackError) throw new HttpProblem(e.problem);
        throw e;
      }
    };
    if (ctx.method === 'GET' && s.length === 3) {
      this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
      return this.send(ctx, await answer(() => desk.status(s[2]!)));
    }
    if (ctx.method !== 'POST' || s.length !== 2) fail('not_found', `no route ${ctx.method} ${ctx.url.pathname}`);
    this.throttle(`w:${this.client(ctx)}`, this.o.rateLimit?.writes ?? 0);
    // Size-capped on the wire and parsed before anything hashes it, as a write is shape-checked first.
    const raw = await this.body(ctx, MAX_REPORT_BYTES);
    let report: Report;
    try {
      report = parseReport(raw);
    } catch (e) {
      if (e instanceof FeedbackError) throw new HttpProblem(e.problem);
      throw e;
    }
    if (validateOnly(ctx.url.searchParams)) return this.send(ctx, await answer(() => desk.check(report, this.client(ctx))));
    return this.idempotent(ctx, report, () => answer(() => desk.submit(report, this.client(ctx)), 202));
  }

  // Reads

  private async read(ctx: Ctx): Promise<unknown> {
    const s = ctx.segments;
    const q = ctx.url.searchParams;
    const reg = this.o.registry;
    if (s.length === 2 && s[1] === 'status') return this.status();
    if (s.length === 2 && s[1] === 'openapi.json') return openApiDocument(this.baseUrl) ?? fail('not_found', 'this build has no spec/openapi.json');
    if (s[1] === 'clubs' && s.length === 3) return reg.clubs.find((c) => c.id === s[2]) ?? fail('not_found', `no club ${s[2]}`);
    if (s[1] === 'clubs' && s.length === 5 && s[3] === 'members') {
      const m = reg.members.find((x) => x.clubId === s[2] && lc(x.member) === lc(s[4]!));
      return m ? { clubId: m.clubId, member: m.member, status: 'admitted' } : fail('not_found', `${s[4]} is not an admitted member of ${s[2]}`);
    }
    if (s[1] === 'agents' && s.length === 3) {
      const mandates = reg.mandates.filter((m) => lc(m.agent) === lc(s[2]!));
      if (mandates.length === 0) fail('not_found', `no agent ${s[2]}`);
      return { address: mandates[0]!.agent, status: 'active', mandates: mandates.map((m) => ({ ...m, mandateHash: canonicalKeccak(m) })) };
    }
    // ADR-0030: a registration is served with its signature, the bond the settlement layer holds and what this node saw.
    if (s[1] === 'adjudicators' && s.length === 2) {
      await this.sync();
      return this.adjudicatorPage(q);
    }
    if (s[1] === 'adjudicators' && s.length === 3) {
      if (!isAddress(s[2])) fail('not_found', `no adjudicator ${s[2]}`);
      await this.sync();
      const stored = await reg.registrations?.get(s[2] as Address);
      if (stored) return this.listingOf(stored);
      const a = reg.adjudicators().find((x) => lc(x.address) === lc(s[2]!));
      return a ? this.unregisteredListing(a) : fail('not_found', `no adjudicator ${s[2]}`);
    }
    if (s[1] === 'balances' && s.length === 3) {
      if (!isAddress(s[2])) fail('invalid_terms', 'balances takes an address');
      return (await this.o.settlement.balances([s[2] as Address]))[s[2] as Address];
    }
    if (s[1] === 'commitments' && s.length === 2) return this.commitments(q);
    if (s[1] === 'commitments' && s.length >= 3) {
      const id = s[2];
      if (!isHex32(id)) fail('not_found', `no commitment ${id}`);
      await this.sync();
      const entry = this.index.get(id as Hex32);
      if (!entry) fail('not_found', `no commitment ${id}`);
      if (s.length === 3) {
        const state = (await this.o.settlement.state(id as Hex32)) ?? fail('not_found', `no commitment ${id}`);
        return { ...wholeSeconds(state), ...(await this.noticesFor({ kind: 'state', commitmentId: id as Hex32 })) };
      }
      // ADR-0024 §3: a sealed deal's terms, full events and judgment record go to a party or involved adjudicator with
      // a ReadToken; everyone else reads the settlement projection (and 401 for a record of a still-private deal).
      const terms = (await this.prepareContext().commitment(id as Hex32))!;
      const reader = isSealed(terms) ? await this.readerFor(ctx, terms) : ({ kind: 'party' } as const);
      const outsider = reader.kind === 'anonymous';
      if (s.length === 4 && s[3] === 'events') return paginate(outsider ? entry!.events.map((e) => this.projectEvent(e)) : entry!.events, (e) => e.seq, q);
      if (s.length === 4 && s[3] === 'receipts') {
        // Sign a receipt for every event of the commitment this node has indexed (ADR-0017: relayed or indexed).
        for (const e of entry!.events) if (!this.receipts.get(id as Hex32)?.has(e.seq)) await this.receiptFor(e);
        return paginate([...this.receipts.get(id as Hex32)!.values()], (r) => r.eventSeq, q);
      }
      if (s.length === 4 && s[3] === 'recipients') return this.recipients(id as Hex32);
      // The terms as the seller signed them (commitment.schema.json): the commitment.offered event's terms, id and seller signature.
      if (s.length === 4 && s[3] === 'terms') return outsider ? this.projection(terms) : terms;
      if (s.length === 4 && s[3] === 'judgment') {
        if (outsider && this.levelOf(terms.id, terms.disclosure.level) === 'private') {
          fail('unauthorized', 'this deal is private: its judgment record is served to a party or an involved adjudicator with a ReadToken (Authorization: Holdback-ReadToken)');
        }
        return reg.judgment?.(id as Hex32) ?? fail('not_found', `no judgment record for ${id} on this operator`);
      }
      if (s.length === 4 && s[3] === 'key') {
        const recipient = q.get('recipient') ?? undefined;
        if (!isAddress(recipient)) fail('invalid_terms', 'key takes ?recipient=<address>');
        return { items: await this.o.settlement.keysFor(id as Hex32, recipient as Address), nextCursor: null };
      }
    }
    return fail('not_found', `no route GET ${ctx.url.pathname}`);
  }

  /** GET /v1/commitments/{id}/recipients: who the content key must be sealed to, and how (ENVELOPE_SPEC). */
  private async recipients(id: Hex32): Promise<unknown> {
    const c = (await this.prepareContext().commitment(id)) ?? fail('not_found', `no commitment ${id}`);
    const a = c!.adjudication;
    const reg = async (role: string, address: Address) => {
      const r = await this.registrationOf(address);
      if (!r) fail('not_found', `the ${role} adjudicator ${address} has no published registration`);
      return { role, address, encryptionPublicKey: r!.encryptionPublicKey };
    };
    return {
      commitmentId: id,
      recipients: [
        await reg('primary', a.adjudicator),
        await reg('fallback', a.fallbackAdjudicator),
        await reg('appeal', a.appealAdjudicator),
        { role: 'buyer', address: c!.buyer, encryptionPublicKey: c!.buyerEncryptionPublicKey },
      ],
      envelope: ENVELOPE_SPEC,
    };
  }

  private async commitments(q: URLSearchParams): Promise<Page<CommitmentStateView>> {
    await this.sync();
    const party = q.get('party');
    const role = q.get('role');
    const states = q.getAll('escrowState');
    if (party !== null && !isAddress(party)) fail('invalid_terms', 'party must be an address');
    if (role !== null && !['buyer', 'seller', 'adjudicator'].includes(role)) fail('invalid_terms', 'role is buyer, seller or adjudicator');
    const p = party === null ? null : lc(party);
    const matches = (e: Indexed) => {
      if (p === null) return true;
      if (role === 'buyer') return e.buyer === p;
      if (role === 'seller') return e.seller === p;
      if (role === 'adjudicator') return e.adjudicators.includes(p);
      return e.buyer === p || e.seller === p || e.adjudicators.includes(p);
    };
    const rows: Array<{ seq: number; view: CommitmentStateView }> = [];
    for (const [id, e] of this.index) {
      if (!matches(e)) continue;
      const view = await this.o.settlement.state(id);
      if (view && (states.length === 0 || states.includes(view.escrowState))) rows.push({ seq: e.offeredSeq, view });
    }
    const page = paginate(rows, (r) => r.seq, q);
    return { items: page.items.map((r) => wholeSeconds(r.view)), nextCursor: page.nextCursor };
  }

  /**
   * The one discovery document (D39): /v1/status, with `chainId` a number as in prepared typed data, plus where to
   * send requests, settlement-layer time, this node's limits and, on a demo, the demo's facts. Discovery says where,
   * not what to trust: an agent pins its EIP-712 domain in its own configuration.
   */
  private async discovery(): Promise<Record<string, unknown>> {
    const s = await this.status();
    const r = this.o.rateLimit;
    const windowSec = r ? Math.round(r.windowMs / 1000) : 0;
    const limits = {
      ...(r ? { reads: { limit: r.reads, windowSec, per: 'client' }, writes: { limit: r.writes, windowSec, per: 'signer' } } : {}),
      // Refusals are not stored (a corrected call reuses its key); successes are kept until this node restarts.
      idempotency: { replays: 'success-only', retention: 'process' },
    };
    return {
      ...s,
      domain: { ...s.domain, chainId: Number(s.domain.chainId) },
      apiBaseUrl: this.baseUrl,
      settlementTime: this.settlementNow(),
      limits,
      ...(this.desk ? { feedback: this.desk.discovery() } : {}),
      // ADR-0030 §4: who this node names for a role an offer leaves out. Naming others is the parties' choice.
      ...(this.o.registry.defaultAdjudicators ? { defaultAdjudicators: { ...this.o.registry.defaultAdjudicators } } : {}),
      ...(this.o.demo ? { demo: await this.o.demo() } : {}),
      ...(this.o.notes ? { notes: [...this.o.notes] } : {}),
    };
  }

  async status(): Promise<OperatorStatus> {
    await this.sync();
    const kind = this.o.settlement.kind;
    const chainId = String(this.o.registry.chainId);
    return {
      operatorId: this.o.operatorId,
      receiptSigner: this.signer,
      settlement: kind === 'sim' ? { kind: 'sim' } : { kind: 'chain', chainId },
      domain: { name: 'Holdback', version: this.domain.version, chainId, verifyingContract: this.domain.verifyingContract },
      apiVersion: API_VERSION,
      schemaVersion: SCHEMA_VERSION,
      head: { eventSeq: Math.max(this.head, 0), lagSec: 0 },
      settlementModes: ['guaranteed_on_decision'],
      ...(this.o.fee ? { fees: { operator: { ...this.o.fee } } } : {}),
    };
  }

  /** GET /v1/events?from=<seq>: server-sent events (event.schema.json), polling the settlement log. */
  private async stream(ctx: Ctx): Promise<void> {
    const from = ctx.url.searchParams.get('from') ?? '0';
    if (!/^\d{1,15}$/.test(from)) fail('invalid_terms', 'from must be a sequence number', { field: 'from' });
    let next = Number(from);
    const { res } = ctx;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    this.streams.add(res);
    res.on('close', () => this.streams.delete(res));
    while (this.streams.has(res)) {
      for await (const e of this.o.settlement.events(next)) {
        // The stream is unauthenticated: a private deal's offer appears as its settlement projection (ADR-0024 §3).
        res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(this.projectEvent(e))}\n\n`);
        next = e.seq + 1;
      }
      await new Promise((r) => setTimeout(r, SSE_POLL_MS));
    }
  }
}

export interface RunningOperator {
  url: string;
  operator: Operator;
  close(): Promise<void>;
}

/** Builds an operator (which runs the startup guards), then serves the API. `port: 0` picks a free port. */
export async function startOperator(o: OperatorOptions & { port?: number; host?: string }): Promise<RunningOperator> {
  const operator = new Operator(o);
  const server: Server = createServer(operator.handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 0, o.host ?? '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://${o.host ?? '127.0.0.1'}:${port}`;
  if (!operator.baseUrl) operator.baseUrl = url;
  let closed: Promise<void> | undefined;
  return {
    url,
    operator,
    close: () =>
      (closed ??= new Promise<void>((resolve) => {
        operator.endStreams();
        server.close(() => resolve());
        server.closeAllConnections();
      })),
  };
}
