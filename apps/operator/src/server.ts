// An operator node (docs/api.md v0.2, ADR-0005, ADR-0017 Phase 1). It relays agent-signed messages to the
// settlement layer and serves reads; it adds speed and convenience, never authority. It authors no party
// message: every write it relays is the same submission, under the same idempotency key, that the SDK's direct
// path would send, so an agent loses nothing when this node refuses or goes away. Its own signature appears only
// on receipts, which attest that it saw an event, nothing more.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  canonicalKeccak,
  holdbackDomain,
  operatorFeeDue,
  parseAppeal,
  parseCommitment,
  parseDelivery,
  parseMessage,
  problem,
  signMessage,
  type Address,
  type CommitmentStateView,
  type Hex32,
  type OperatorFeeSchedule,
  type OperatorStatus,
  type Page,
  type Problem,
  type ProblemType,
  type Receipt,
  type Result,
  type SettlementEvent,
} from '@holdback/core';
import { commitmentIdOf, operationOf, previewSubmission, submissionKeys, submissionsOf, type Operation } from '@holdback/sdk';
import type { PolicyContext, RelayPolicy } from './policy.js';
import type { DryRunSubmission, Settlement, SubmitResult } from '@holdback/settlement';
import { privateKeyToAccount } from 'viem/accounts';
import type { CommitmentTerms, Sha256, Signature, Timestamp, TokenAmount } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { MAX_CIPHERTEXT_BYTES, type CiphertextStore } from '@holdback/core/store';
import { ENVELOPE_SPEC } from './envelope-spec.js';
import { startupGuards } from './guards.js';
import { amountText, operatorFeeText, prepare, PrepareError, type PrepareContext } from './prepare.js';
import { IdempotencyStore, fingerprint, type StoredResponse } from './idempotency.js';
import { llmsTxt, openApiDocument } from './openapi/index.js';
import type { Registry } from './registry.js';

export const API_VERSION = 'v1';
export const SCHEMA_VERSION = '0.7';
const MAX_BODY_BYTES = 1_048_576;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SSE_POLL_MS = 50;

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
  status: number;
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
   * Plain-language notes a public node states about itself (T-026's hosted demo: test tokens only, what is
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
  /** Test only: relay, then drop the connection without answering (a response lost in transit). */
  dropResponses?: boolean;
  now?: () => number;
}

const STATUS: Partial<Record<ProblemType, number>> = {
  invalid_terms: 400,
  invalid_cursor: 400,
  mime_not_allowed: 400,
  invalid_signature: 401,
  unauthorized: 401,
  payment_required: 402,
  scope_exceeded: 403,
  mandate_expired: 403,
  member_not_admitted: 403,
  relay_refused: 403,
  adjudicator_affiliated: 403,
  not_your_turn: 403,
  not_found: 404,
  invalid_state: 409,
  nonce_reused: 409,
  idempotency_conflict: 409,
  deadline_passed: 409,
  submission_limit_reached: 409,
  payload_too_large: 413,
  rate_limited: 429,
};
export const statusOf = (type: ProblemType): number => STATUS[type] ?? 422;

/** A problem with its HTTP status and any extra headers. */
class HttpProblem extends Error {
  constructor(
    readonly problem: Problem,
    readonly headers: Record<string, string> = {},
  ) {
    super(problem.detail);
  }
}
const fail = (type: ProblemType, detail: string, headers?: Record<string, string>): never => {
  throw new HttpProblem(problem(type, detail), headers);
};

// ---- pagination (page.schema.json) -------------------------------------------------------------

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
  if (!(limit >= 1 && limit <= MAX_LIMIT)) fail('invalid_cursor', `limit must be an integer from 1 to ${MAX_LIMIT}`);
  const cursor = q.get('cursor');
  const below = cursor === null ? Infinity : decodeCursor(cursor);
  const sorted = [...items].sort((a, b) => seq(b) - seq(a)).filter((t) => seq(t) < below);
  const page = sorted.slice(0, limit);
  return { items: page, nextCursor: sorted.length > limit ? encodeCursor(seq(page.at(-1)!)) : null };
}

// ---- schema checks ------------------------------------------------------------------------------

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

function message<T>(value: unknown, type: string): T {
  const r = parseMessage(value);
  if (!r.ok) fail(r.error.type, r.error.detail);
  if (r.ok && r.value.type !== type) fail('invalid_terms', `expected a ${type}, got ${r.value.type}`);
  return (r as Extract<typeof r, { ok: true }>).value as T;
}
function parsed<T>(r: Result<T, Problem>): T {
  if (!r.ok) fail(r.error.type, r.error.detail);
  return (r as Extract<typeof r, { ok: true }>).value;
}

/** Checks every body against spec/schemas and that each message is the type its route takes. */
function checkShape(op: Operation): void {
  switch (op.kind) {
    case 'offer':
      parsed(parseCommitment(op.commitment));
      return;
    case 'acceptance':
      message(op.message, 'AdjudicatorAcceptance');
      return;
    case 'agree':
      message(op.message, 'Agree');
      if (op.fund) message(op.fund, 'FundingAuthorization');
      if (op.operatorFee) message(op.operatorFee, 'TransferAuthorization');
      return;
    case 'hold':
      parsed(parseCommitment(op.commitment));
      message(op.acceptance, 'AdjudicatorAcceptance');
      message(op.agree, 'Agree');
      message(op.funding, 'FundingAuthorization');
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
  'POST /v1/prepare/offer returns it as commitmentId and in submit.body.id; to compute it yourself, see commitmentIdOf in examples/verify.ts';

/** `?validateOnly=` is `true`, `false` or absent; anything else is refused rather than run live. */
function validateOnly(q: URLSearchParams): boolean {
  const values = q.getAll('validateOnly');
  if (values.length === 0) return false;
  if (values.length > 1 || (values[0] !== 'true' && values[0] !== 'false')) fail('invalid_terms', 'validateOnly must be true or false');
  return values[0] === 'true';
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

// ---- the operator --------------------------------------------------------------------------------

interface Indexed {
  offeredSeq: number;
  buyer: string;
  seller: string;
  adjudicators: string[];
  events: SettlementEvent[];
}

interface Ctx {
  requestId: string;
  method: string;
  url: URL;
  segments: string[];
  req: IncomingMessage;
  res: ServerResponse;
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
const isHex32 = (s: string | undefined): s is Hex32 => s !== undefined && /^0x[0-9a-f]{64}$/.test(s);

export class Operator {
  private readonly domain;
  private readonly signer;
  private readonly idempotency = new IdempotencyStore();
  private readonly index = new Map<Hex32, Indexed>();
  private readonly receipts = new Map<Hex32, Map<number, Receipt>>();
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly streams = new Set<ServerResponse>();
  private head = -1;
  private syncing: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  /** Public base URL (no trailing slash); startOperator sets it to the listening address when not given. */
  baseUrl: string;

  /** Runs the startup guards: no Operator exists off a test chain or with a live Stripe key. */
  constructor(private readonly o: OperatorOptions) {
    startupGuards({ env: o.env, chainId: o.registry.chainId });
    this.baseUrl = (o.baseUrl ?? '').replace(/\/+$/, '');
    this.domain = holdbackDomain(o.registry.chainId);
    this.signer = privateKeyToAccount(o.signerKey).address;
    this.now = o.now ?? Date.now;
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

  // ---- the event index ---------------------------------------------------------------------------

  /** Catches up with the settlement layer's event log. Serialized, so concurrent reads index once. */
  private sync(): Promise<void> {
    this.syncing = this.syncing.then(async () => {
      for await (const e of this.o.settlement.events(this.head + 1)) {
        this.head = e.seq;
        if (!e.commitmentId) continue;
        let entry = this.index.get(e.commitmentId);
        if (e.type === 'commitment.offered') {
          const t = e.payload['terms'] as { buyer: string; seller: string; adjudication: { adjudicator: string; fallbackAdjudicator: string; appealAdjudicator: string } };
          const a = t.adjudication;
          entry = { offeredSeq: e.seq, buyer: lc(t.buyer), seller: lc(t.seller), adjudicators: [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].map(lc), events: [] };
          this.index.set(e.commitmentId, entry);
        }
        entry?.events.push(e);
      }
    });
    return this.syncing;
  }

  // ---- receipts ----------------------------------------------------------------------------------

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

  // ---- HTTP --------------------------------------------------------------------------------------

  readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    const started = this.now();
    const requestId = randomUUID();
    const url = new URL(req.url ?? '/', 'http://operator.invalid');
    const ctx: Ctx = { requestId, method: req.method ?? 'GET', url, segments: url.pathname.split('/').filter(Boolean), req, res };
    res.setHeader('Request-Id', requestId);
    res.setHeader('Holdback-Schema-Version', SCHEMA_VERSION);
    res.on('finish', () => {
      const tp = req.headers['traceparent'];
      this.o.log?.({ requestId, method: ctx.method, path: url.pathname, status: res.statusCode, ms: this.now() - started, ...(typeof tp === 'string' ? { traceparent: tp } : {}) });
    });
    this.route(ctx).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpProblem) return this.sendProblem(ctx, e.problem, e.headers);
      this.sendProblem(ctx, problem('invalid_state', 'the operator could not process this request'), {}, 500);
    });
  };

  private send(ctx: Ctx, r: StoredResponse): void {
    if (ctx.res.writableEnded) return;
    ctx.res.writeHead(r.status, r.headers);
    ctx.res.end(r.body);
  }

  private problemResponse(ctx: Ctx, p: Problem, headers: Record<string, string> = {}, status = statusOf(p.type)): StoredResponse {
    const body = { type: p.type, title: p.type, status, detail: p.detail, instance: `urn:holdback:request:${ctx.requestId}` };
    return { status, headers: { 'content-type': 'application/problem+json', ...headers }, body: JSON.stringify(body) };
  }

  private sendProblem(ctx: Ctx, p: Problem, headers: Record<string, string> = {}, status?: number): void {
    this.send(ctx, this.problemResponse(ctx, p, headers, status));
  }

  private ok(body: unknown, headers: Record<string, string> = {}): StoredResponse {
    return { status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
  }

  private client(ctx: Ctx): string {
    return ctx.req.socket.remoteAddress ?? 'unknown';
  }

  /** Fixed-window throttle (ADR-0017 §3); a throttled call gets 429 with Retry-After in whole seconds. */
  private throttle(bucket: string, budget: number): void {
    const limit = this.o.rateLimit;
    if (!limit) return;
    const now = this.now();
    let w = this.windows.get(bucket);
    if (!w || now - w.start >= limit.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(bucket, w);
    }
    if (w.count >= budget) {
      const retry = Math.max(1, Math.ceil((w.start + limit.windowMs - now) / 1000));
      fail('rate_limited', 'too many requests; retry later or use another operator', { 'retry-after': String(retry) });
    }
    w.count++;
  }

  private async body(ctx: Ctx): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of ctx.req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) fail('payload_too_large', `request bodies are limited to ${MAX_BODY_BYTES} bytes`);
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
    if (method === 'GET' && ctx.url.pathname === '/.well-known/holdback.json') {
      // chainId as a number, as in prepared typed data (/v1/status keeps the schema's string). Discovery only:
      // an agent pins its EIP-712 domain from its own configuration, not from an operator.
      const s = await this.status();
      const settlementTime = this.o.registry.now?.() ?? new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
      const notes = this.o.notes ? { notes: [...this.o.notes] } : {};
      return this.send(ctx, this.ok({ ...s, domain: { ...s.domain, chainId: Number(s.domain.chainId) }, apiBaseUrl: this.baseUrl, settlementTime, ...notes }));
    }
    if (method === 'GET' && ctx.url.pathname === '/llms.txt') return this.send(ctx, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: llmsTxt(this.baseUrl, this.o.notes) });
    if (s[0] !== 'v1') fail('not_found', `no route ${ctx.url.pathname}`);
    if (s[1] === 'ciphertext') return this.ciphertext(ctx);
    if (method === 'POST' && s[1] === 'prepare' && s.length === 3) return this.prepare(ctx, s[2]!);
    if (method === 'POST') return this.write(ctx);
    if (method !== 'GET') fail('not_found', `no route ${method} ${ctx.url.pathname}`);
    this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
    if (s.length === 2 && s[1] === 'events') return this.stream(ctx);
    const body = await this.read(ctx);
    // The state read links to the signed terms it is about (RFC 8288), so a party compares against the operator's copy.
    const link = s[1] === 'commitments' && s.length === 3 ? { link: `</v1/commitments/${s[2]}/terms>; rel="terms"` } : {};
    return this.send(ctx, this.ok(body, link));
  }

  // ---- writes ------------------------------------------------------------------------------------

  private async write(ctx: Ctx): Promise<void> {
    const raw = await this.body(ctx);
    const dryRun = validateOnly(ctx.url.searchParams);
    if (ctx.segments.join('/') === 'v1/test/faucet') {
      this.throttle(`w:${this.client(ctx)}`, this.o.rateLimit?.writes ?? 0);
      return this.idempotent(ctx, raw, () => this.faucet(raw));
    }
    const parsedOp = operationOf(ctx.segments, raw);
    if (!parsedOp.ok) fail(parsedOp.error.type, parsedOp.error.detail);
    const op = (parsedOp as Extract<typeof parsedOp, { ok: true }>).value;
    if ((op.kind === 'offer' || op.kind === 'hold') && (op.commitment as { id?: unknown }).id === undefined) fail('invalid_terms', MISSING_ID);
    // Shape first: the throttle reads the signer address, which only a checked body is sure to carry.
    checkShape(dryRun ? placeholderSigned(op) : op);
    this.throttle(`w:${lc(signerOf(op) ?? this.client(ctx))}`, this.o.rateLimit?.writes ?? 0);
    // The policy sees a frozen copy: it can decline, never alter what this node relays.
    const refusal = this.o.policy?.(deepFreeze(structuredClone(op)), await this.policyContext(op));
    if (refusal) fail(refusal.type, refusal.detail);
    if (dryRun) return this.send(ctx, await this.dryRun(op));
    await this.chargeFee(op);
    return this.idempotent(ctx, raw, () => this.relay(ctx, op));
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
    );
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
    if (typeof key !== 'string' || key.length < 1 || key.length > 255) fail('invalid_terms', 'mutating requests need an Idempotency-Key header (1 to 255 characters)');
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
  private async relay(ctx: Ctx, op: Operation): Promise<StoredResponse> {
    const key = ctx.req.headers['idempotency-key'] as string;
    const subs = submissionsOf(op);
    const keys = submissionKeys(key, subs.length);
    let last: Extract<SubmitResult, { ok: true }> | undefined;
    for (const [i, sub] of subs.entries()) {
      const r = await this.o.settlement.submit(sub, { idempotencyKey: keys[i]!, via: this.o.operatorId });
      if (!r.ok) return this.problemResponse(ctx, r.problem);
      last = r;
    }
    const event = last!.events.at(-1);
    const receipt = event ? await this.receiptFor(event) : undefined;
    return this.ok({ ...last!.state, ...(receipt ? { receipt } : {}) });
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
    if (!r.ok) fail(r.problem.type, r.problem.detail);
    const ok = r as Extract<SubmitResult, { ok: true }>;
    return this.ok(ok.state, { 'holdback-dry-run': 'true', 'holdback-signature-check': ok.signatureCheck });
  }

  private async faucet(raw: unknown): Promise<StoredResponse> {
    const faucet = this.o.registry.faucet;
    if (!faucet) fail('not_found', 'this settlement target has no faucet');
    const b = raw as { address?: string; amount?: string };
    if (!isAddress(b.address) || typeof b.amount !== 'string' || !/^[1-9][0-9]{0,30}$/.test(b.amount)) fail('invalid_terms', 'the faucet takes {address, amount} with amount in base units as a decimal string');
    const balance = await faucet!(b.address as Address, BigInt(b.amount!));
    return this.ok({ address: b.address, balance });
  }

  // ---- prepare, ciphertext -------------------------------------------------------------------------

  /** POST /v1/prepare/{kind}: typed data to sign and the body to submit. Reads only; nothing is recorded. */
  private async prepare(ctx: Ctx, kind: string): Promise<void> {
    this.throttle(`r:${this.client(ctx)}`, this.o.rateLimit?.reads ?? 0);
    const input = await this.body(ctx);
    try {
      return this.send(ctx, this.ok(await prepare(kind, this.prepareContext(), input)));
    } catch (e) {
      if (e instanceof PrepareError) fail(e.problem.type, e.problem.detail);
      throw e;
    }
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
      registration: (a) => reg.registration?.(a) ?? null,
      commitment: async (id) => {
        const offered = (await eventsOf(id)).find((e) => e.type === 'commitment.offered');
        if (!offered) return undefined;
        const p = offered.payload as unknown as { terms: CommitmentTerms; sellerSignature: Signature };
        return { ...p.terms, id, signatures: { seller: p.sellerSignature } };
      },
      delivery: async (id) => (await eventsOf(id)).filter((e) => e.type === 'delivery.submitted').at(-1)?.payload as { deliveryHash: Hex32; attempt: number } | undefined,
      attempt: async (id) => (await this.o.settlement.state(id))?.attempt ?? 1,
      state: (id) => this.o.settlement.state(id),
      ...(this.o.fee ? { operatorFee: this.o.fee } : {}),
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

  // ---- reads -------------------------------------------------------------------------------------

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
    // A published registration, when there is one, is served with the bond the settlement layer holds.
    const listing = (a: ReturnType<Registry['adjudicators']>[number]) => {
      const r = reg.registration?.(a.address);
      return r ? { ...r, ...a } : a;
    };
    if (s[1] === 'adjudicators' && s.length === 2) {
      const all = reg.adjudicators().map(listing);
      const order = new Map(all.map((a, i) => [a, i]));
      return paginate(all, (a) => order.get(a)!, q);
    }
    if (s[1] === 'adjudicators' && s.length === 3) {
      const a = reg.adjudicators().find((x) => lc(x.address) === lc(s[2]!));
      return a ? listing(a) : fail('not_found', `no adjudicator ${s[2]}`);
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
      if (s.length === 3) return (await this.o.settlement.state(id as Hex32)) ?? fail('not_found', `no commitment ${id}`);
      if (s.length === 4 && s[3] === 'events') return paginate(entry!.events, (e) => e.seq, q);
      if (s.length === 4 && s[3] === 'receipts') {
        // Sign a receipt for every event of the commitment this node has indexed (ADR-0017: relayed or indexed).
        for (const e of entry!.events) if (!this.receipts.get(id as Hex32)?.has(e.seq)) await this.receiptFor(e);
        return paginate([...this.receipts.get(id as Hex32)!.values()], (r) => r.eventSeq, q);
      }
      if (s.length === 4 && s[3] === 'recipients') return this.recipients(id as Hex32);
      // The terms as the seller signed them (commitment.schema.json): the commitment.offered event's terms, id and seller signature.
      if (s.length === 4 && s[3] === 'terms') return (await this.prepareContext().commitment(id as Hex32)) ?? fail('not_found', `no commitment ${id}`);
      if (s.length === 4 && s[3] === 'judgment') {
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
    const reg = (role: string, address: Address) => {
      const r = this.o.registry.registration?.(address);
      if (!r) fail('not_found', `the ${role} adjudicator ${address} has no published registration`);
      return { role, address, encryptionPublicKey: r!.encryptionPublicKey };
    };
    return {
      commitmentId: id,
      recipients: [reg('primary', a.adjudicator), reg('fallback', a.fallbackAdjudicator), reg('appeal', a.appealAdjudicator), { role: 'buyer', address: c!.buyer, encryptionPublicKey: c!.buyerEncryptionPublicKey }],
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
    return { items: page.items.map((r) => r.view), nextCursor: page.nextCursor };
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
    if (!/^\d{1,15}$/.test(from)) fail('invalid_cursor', 'from must be a sequence number');
    let next = Number(from);
    const { res } = ctx;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    this.streams.add(res);
    res.on('close', () => this.streams.delete(res));
    while (this.streams.has(res)) {
      for await (const e of this.o.settlement.events(next)) {
        res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
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
