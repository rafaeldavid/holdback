// Feedback and issue reports (T-032; D39; docs/reviews/2026-11-02-api-agent-review.md §8): an operator service, not
// protocol. An agent reports a bug, a docs problem, feedback or a feature request, naming the Request-Id of the call
// it is about; the operator attaches its own log line for that request, groups reports by fingerprint, and answers
// with a status and replies the reporter reads back by ID. Reports land in a private store; none is filed publicly.
// Sharing a report is the reporter's choice: the dry run says so, naming this operator. A report that may carry deal
// details is sealed to the operator's feedback key, built like a delivery, and only its holder can open it.
// Report text is untrusted content: kept and shown as data, never placed in a model's instruction position or run.
import { randomUUID } from 'node:crypto';
import { canonicalKeccak, type Address, type HoldbackDomain, type Hex32, type SealedKey, type Sha256, type Timestamp } from '@holdback/core';
import { ENVELOPE_SCHEME } from '@holdback/core/crypto';
import { verifyTypedData } from 'viem';
import type { ApiProblem } from './problems.js';

export const REPORT_KINDS = ['bug', 'docs', 'feedback', 'feature'] as const;
export const REPORT_STATUSES = ['received', 'triaged', 'fixed', 'wontfix', 'duplicate'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The largest report body, in bytes on the wire. */
export const MAX_REPORT_BYTES = 16_384;
/** How long the store keeps a report. */
export const RETENTION_DAYS = 90;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * EIP-712: the optional signature over a report, under the Holdback domain the agent pins. `operator` is the receipt
 * signer of the node it is sent to, so a copy cannot be filed elsewhere in the reporter's name.
 */
export const REPORT_TYPES = {
  Report: [
    { name: 'reporter', type: 'address' },
    { name: 'operator', type: 'address' },
    { name: 'bodyHash', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface Report {
  kind: ReportKind;
  summary: string;
  detail?: string;
  requestId?: string;
  commitmentId?: Hex32;
  observed?: string;
  expected?: string;
  client?: { name: string; version?: string; model?: string };
  schemaVersion?: string;
  /** `{detail, observed?, expected?}` as JSON, encrypted like a delivery to the operator's feedback key. */
  sealed?: { ciphertext: string; plaintextSha256: Sha256; envelope: SealedKey };
  signer?: Address;
  nonce?: Hex32;
  signature?: `0x${string}`;
}

/** This node's log line for a request (route template, status, problem type, timing), as the operator keeps it. */
export interface LogLine {
  requestId: string;
  at: number;
  node?: number;
  route: string;
  method: string;
  status: number;
  problem?: string;
  ms: number;
}

export interface StoredReport {
  id: string;
  receivedAt: Timestamp;
  status: ReportStatus;
  fingerprint: Hex32;
  duplicateOf?: string;
  /** The report as sent: untrusted content. */
  report: Report;
  /** The verified signer, when the report was signed. */
  signer?: Address;
  /** What the operator attached: its log line for `requestId`, and the context the report was received in. */
  attached: { log: LogLine | null; operatorId: string; schemaVersion: string; eventSeq: number; commitment?: { escrowState: string; lastEventSeq: number } | null };
  /** Written by the operator when it triages: also untrusted for any other reader. */
  replies: Array<{ at: Timestamp; text: string }>;
  fixedIn?: string;
}

/** The private store: an operator's own (the demo uses Workers KV). Reports expire after RETENTION_DAYS. */
export interface FeedbackStore {
  get(id: string): Promise<StoredReport | undefined>;
  /** The first report with this fingerprint still in the store. */
  firstWith(fingerprint: Hex32): Promise<string | undefined>;
  add(report: StoredReport): Promise<void>;
}

export class MemoryFeedbackStore implements FeedbackStore {
  readonly reports = new Map<string, StoredReport>();
  async get(id: string) {
    return structuredClone(this.reports.get(id));
  }
  async firstWith(fingerprint: Hex32) {
    return [...this.reports.values()].find((r) => r.fingerprint === fingerprint)?.id;
  }
  async add(report: StoredReport) {
    this.reports.set(report.id, structuredClone(report));
  }
}

export class FeedbackError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail);
  }
}
const refuse = (type: ApiProblem['type'], detail: string, members: Omit<ApiProblem, 'type' | 'detail'> = {}): never => {
  throw new FeedbackError({ type, detail, ...members });
};

/** Abuse limits: reports per client (IP, in memory) and per verified signer, per hour, and a cap per UTC day. */
export interface FeedbackLimits {
  unsignedPerClientPerHour: number;
  signedPerSignerPerHour: number;
  /** A report costs the store at most two writes, so 150 keep Workers KV's Free plan (1,000 writes a day, per account) clear. */
  perDay: number;
}
export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = { unsignedPerClientPerHour: 10, signedPerSignerPerHour: 60, perDay: 150 };

/**
 * The limits' counters, in memory: one per operator, shared by its nodes, so two nodes over one store do not double
 * them. A client IP stays here until the next report or status read after its hour, or until the process ends.
 */
export class ReportLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private today = { day: '', count: 0 };

  constructor(readonly limits: FeedbackLimits = DEFAULT_FEEDBACK_LIMITS) {}

  /** Drops the windows whose hour has passed. */
  sweep(now: number): void {
    for (const [k, v] of this.windows) if (now - v.start >= HOUR_MS) this.windows.delete(k);
  }

  /** Refuses with 429 when the bucket or the day is spent; counts the report only when `charge`. */
  admit(bucket: string, budget: number, what: string, now: number, charge: boolean): void {
    this.sweep(now);
    let w = this.windows.get(bucket);
    if (!w) this.windows.set(bucket, (w = { start: now, count: 0 }));
    if (w.count >= budget) refuse('rate_limited', `at most ${budget} ${what} an hour`, { retryAfterSec: Math.max(1, Math.ceil((w.start + HOUR_MS - now) / 1000)) });
    const day = wholeSecond(now).slice(0, 10);
    if (this.today.day !== day) this.today = { day, count: 0 };
    if (this.today.count >= this.limits.perDay) refuse('rate_limited', 'this operator has taken its reports for today; retry tomorrow (UTC) or report to another operator', { retryAfterSec: Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + DAY_MS - now) / 1000)) });
    if (charge) {
      w.count++;
      this.today.count++;
    }
  }
}

export interface FeedbackOptions {
  store: FeedbackStore;
  /** The operator's feedback encryption key (x25519, base64url), when it takes sealed reports. Its secret stays off the node. */
  encryptionPublicKey?: string;
  /** This node's log line for a Request-Id, when it keeps a request log. */
  requestLog?: (requestId: string) => Promise<LogLine | undefined>;
  /** Counters shared by the operator's nodes. Default: one per node, with DEFAULT_FEEDBACK_LIMITS. */
  limiter?: ReportLimiter;
}

export interface FeedbackContext {
  operatorId: string;
  receiptSigner: Address;
  domain: HoldbackDomain;
  schemaVersion: string;
  now: () => number;
  eventSeq: () => Promise<number>;
  commitment: (id: Hex32) => Promise<{ escrowState: string; lastEventSeq: number } | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
/** Half a surrogate pair: what cutting a string at a UTF-16 length can leave of an emoji. It cannot be hashed. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const wholeSecond = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z') as Timestamp;

/** A bounded, non-blank, well-formed string, or a refusal naming `field`. */
function bounded(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) refuse('invalid_terms', `${field} is a non-empty string of at most ${max} characters`, { field });
  if (LONE_SURROGATE.test(v as string)) refuse('invalid_terms', `${field} holds half a surrogate pair (a character cut in two); send well-formed Unicode`, { field });
  return v as string;
}

/** The fields a report may carry, with their limits: everything a reporter writes is a bounded string. */
export function parseReport(raw: unknown): Report {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) refuse('invalid_terms', 'a report is a JSON object');
  const r = raw as Record<string, unknown>;
  const allowed = new Set(['kind', 'summary', 'detail', 'requestId', 'commitmentId', 'observed', 'expected', 'client', 'schemaVersion', 'sealed', 'signer', 'nonce', 'signature']);
  for (const k of Object.keys(r)) if (!allowed.has(k)) refuse('invalid_terms', `a report has no field ${k}`, { field: k });
  const text = (k: string, max: number, required = false): string | undefined => (r[k] === undefined && !required ? undefined : bounded(r[k], k, max));
  if (!REPORT_KINDS.includes(r['kind'] as ReportKind)) refuse('invalid_terms', `kind is one of ${REPORT_KINDS.join(', ')}`, { field: 'kind' });
  const report: Report = { kind: r['kind'] as ReportKind, summary: text('summary', 200, true)! };
  const detail = text('detail', 4000);
  if (detail !== undefined) report.detail = detail;
  for (const k of ['observed', 'expected'] as const) {
    const v = text(k, 500);
    if (v !== undefined) report[k] = v;
  }
  if (r['requestId'] !== undefined) {
    if (typeof r['requestId'] !== 'string' || !UUID.test(r['requestId'])) refuse('invalid_terms', 'requestId is the Request-Id header of the call the report is about (a lowercase UUID)', { field: 'requestId' });
    report.requestId = r['requestId'] as string;
  } else if (report.kind === 'bug') refuse('invalid_terms', 'a bug report names the requestId of the call that failed (its Request-Id header)', { field: 'requestId' });
  if (r['commitmentId'] !== undefined) {
    if (typeof r['commitmentId'] !== 'string' || !HEX32.test(r['commitmentId'])) refuse('invalid_terms', 'commitmentId is 0x and 64 lowercase hex digits', { field: 'commitmentId' });
    report.commitmentId = r['commitmentId'] as Hex32;
  }
  if (r['schemaVersion'] !== undefined) {
    if (typeof r['schemaVersion'] !== 'string' || !/^\d{1,3}\.\d{1,3}$/.test(r['schemaVersion'])) refuse('invalid_terms', 'schemaVersion is the version you pinned, such as "0.8"', { field: 'schemaVersion' });
    report.schemaVersion = r['schemaVersion'] as string;
  }
  if (r['client'] !== undefined) {
    const c = r['client'] as Record<string, unknown>;
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some((k) => !['name', 'version', 'model'].includes(k))) refuse('invalid_terms', 'client is {name, version?, model?}', { field: 'client' });
    report.client = { name: bounded(c['name'], 'client.name', 100) };
    for (const k of ['version', 'model'] as const) if (c[k] !== undefined) report.client[k] = bounded(c[k], `client.${k}`, 100);
  }
  if (r['sealed'] !== undefined) {
    const s = (r['sealed'] ?? {}) as Record<string, unknown>;
    const e = (s['envelope'] ?? {}) as Record<string, unknown>;
    const ok =
      typeof s === 'object' &&
      Object.keys(s).sort().join() === 'ciphertext,envelope,plaintextSha256' &&
      typeof s['ciphertext'] === 'string' &&
      B64URL.test(s['ciphertext']) &&
      s['ciphertext'].length <= 12_000 &&
      typeof s['plaintextSha256'] === 'string' &&
      /^sha256:[0-9a-f]{64}$/.test(s['plaintextSha256']) &&
      Object.keys(e).sort().join() === 'ciphertext,scheme' &&
      e['scheme'] === ENVELOPE_SCHEME &&
      typeof e['ciphertext'] === 'string' &&
      /^[A-Za-z0-9_-]{139}$/.test(e['ciphertext']);
    if (!ok) refuse('invalid_terms', `sealed is {ciphertext, plaintextSha256, envelope: {scheme: "${ENVELOPE_SCHEME}", ciphertext}}, built like a delivery: the JSON {detail, observed?, expected?} under a fresh key, sealed to feedback.encryptionPublicKey`, { field: 'sealed' });
    if (report.detail !== undefined || report.observed !== undefined || report.expected !== undefined) refuse('invalid_terms', 'a sealed report carries detail, observed and expected inside sealed only', { field: 'sealed' });
    report.sealed = { ciphertext: s['ciphertext'] as string, plaintextSha256: s['plaintextSha256'] as Sha256, envelope: { scheme: ENVELOPE_SCHEME, ciphertext: e['ciphertext'] as string } as SealedKey };
  } else if (report.detail === undefined) refuse('invalid_terms', 'detail is required (or sealed, which carries it)', { field: 'detail' });
  const signed = ['signer', 'nonce', 'signature'].filter((k) => r[k] !== undefined);
  if (signed.length > 0) {
    if (signed.length < 3) refuse('invalid_terms', 'a signed report carries signer, nonce and signature together', { field: ['signer', 'nonce', 'signature'].find((k) => r[k] === undefined)! });
    if (typeof r['signer'] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(r['signer'])) refuse('invalid_terms', 'signer is an address', { field: 'signer' });
    if (typeof r['nonce'] !== 'string' || !HEX32.test(r['nonce'])) refuse('invalid_terms', 'nonce is 32 random bytes: 0x and 64 lowercase hex digits', { field: 'nonce' });
    if (typeof r['signature'] !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(r['signature'])) refuse('invalid_terms', 'signature is a 65-byte EIP-712 signature', { field: 'signature' });
    Object.assign(report, { signer: (r['signer'] as string).toLowerCase(), nonce: r['nonce'], signature: r['signature'] });
  }
  return report;
}

/** The hash a signed report's `bodyHash` commits to: keccak256 of the report's RFC 8785 JSON without the three signature fields. */
export function reportBodyHash(report: Report): Hex32 {
  const body: Partial<Report> = { ...report };
  delete body.signer;
  delete body.nonce;
  delete body.signature;
  return canonicalKeccak(body) as Hex32;
}

/** Groups reports of one problem: kind, the route and problem type of the call, the pinned schema, and the summary without numbers or hex. */
export function fingerprintOf(report: Report, log: LogLine | null): Hex32 {
  const summary = report.summary.toLowerCase().replace(/0x[0-9a-f]+/g, '0x').replace(/[0-9]+/g, '0').replace(/\s+/g, ' ').trim();
  return canonicalKeccak({ kind: report.kind, route: log ? `${log.method} ${log.route}` : null, problem: log?.problem ?? null, schemaVersion: report.schemaVersion ?? null, summary }) as Hex32;
}

/** One operator node's report desk: the warning, abuse limits, the attached log line and the private store. */
export class FeedbackDesk {
  private readonly limiter: ReportLimiter;

  constructor(
    private readonly o: FeedbackOptions,
    private readonly c: FeedbackContext,
  ) {
    this.limiter = o.limiter ?? new ReportLimiter();
  }

  /** What the reporter is told before it sends: it chooses to share the report with this operator. */
  get warning(): string {
    const sealing = this.o.encryptionPublicKey
      ? 'If it must carry deal details, put detail, observed and expected in sealed, encrypted to feedback.encryptionPublicKey in discovery; a sealed report is still shared with this operator, which holds that key.'
      : 'This node publishes no feedback key, so it takes no sealed reports: leave deal details out.';
    return `Sending a report is your choice to share it with operator ${this.c.operatorId} (receipt signer ${this.c.receiptSigner}), which keeps it ${RETENTION_DAYS} days in its private store with this node's log line for the requestId. Never include secret keys, signatures you have not yet submitted, plaintext work or terms bodies; the requestId is usually enough. ${sealing}`;
  }

  /** Discovery's `feedback` object. */
  discovery(): Record<string, unknown> {
    return {
      path: '/v1/feedback',
      retentionDays: RETENTION_DAYS,
      ...(this.o.encryptionPublicKey ? { encryptionPublicKey: this.o.encryptionPublicKey, scheme: 'x25519-xsalsa20poly1305' } : {}),
      notice: this.warning,
    };
  }

  /** The dry run of a parsed report (parseReport): checked as it would be stored, nothing kept, the warning as a notice. */
  async check(report: Report, client: string): Promise<Record<string, unknown>> {
    const signer = await this.admit(report, client, false);
    const log = report.requestId ? ((await this.o.requestLog?.(report.requestId)) ?? null) : null;
    return { valid: true, kind: report.kind, ...(signer ? { signer } : {}), fingerprint: fingerprintOf(report, log), logAttached: log !== null, notices: [this.warning] };
  }

  /** Files a parsed report: 202 with its ID, status, fingerprint and the report it duplicates, if any. */
  async submit(report: Report, client: string): Promise<Record<string, unknown>> {
    const signer = await this.admit(report, client, true);
    const log = report.requestId ? ((await this.o.requestLog?.(report.requestId)) ?? null) : null;
    const fingerprint = fingerprintOf(report, log);
    const duplicateOf = await this.o.store.firstWith(fingerprint);
    const now = this.c.now();
    const stored: StoredReport = {
      id: randomUUID(),
      receivedAt: wholeSecond(now),
      status: 'received',
      fingerprint,
      ...(duplicateOf ? { duplicateOf } : {}),
      report,
      ...(signer ? { signer } : {}),
      attached: {
        log,
        operatorId: this.c.operatorId,
        schemaVersion: this.c.schemaVersion,
        eventSeq: await this.c.eventSeq(),
        ...(report.commitmentId ? { commitment: await this.c.commitment(report.commitmentId) } : {}),
      },
      replies: [],
    };
    await this.o.store.add(stored);
    return { id: stored.id, status: stored.status, fingerprint, ...(duplicateOf ? { duplicateOf } : {}), logAttached: log !== null, retentionUntil: wholeSecond(now + RETENTION_DAYS * DAY_MS) };
  }

  /**
   * GET /v1/feedback/{id}: the status and the operator's replies; the report itself stays private. A duplicate's ID
   * reads the first report's replies, so a reply never quotes a report.
   */
  async status(id: string): Promise<Record<string, unknown>> {
    this.limiter.sweep(this.c.now());
    if (!UUID.test(id)) refuse('not_found', `no report ${id}`);
    const r = (await this.o.store.get(id)) ?? refuse('not_found', `no report ${id} on this operator (reports are kept ${RETENTION_DAYS} days)`);
    return { id: r.id, kind: r.report.kind, status: r.status, fingerprint: r.fingerprint, ...(r.duplicateOf ? { duplicateOf: r.duplicateOf } : {}), receivedAt: r.receivedAt, replies: r.replies, ...(r.fixedIn ? { fixedIn: r.fixedIn } : {}) };
  }

  /** Verifies a signature and applies the limits (charging them only when `charge`); returns the verified signer. */
  private async admit(report: Report, client: string, charge: boolean): Promise<Address | undefined> {
    if (report.sealed && !this.o.encryptionPublicKey) refuse('invalid_terms', 'this node publishes no feedback key, so it takes no sealed report; send it without deal details, or to another operator', { field: 'sealed' });
    let signer: Address | undefined;
    if (report.signature) {
      const ok = await verifyTypedData({
        address: report.signer!,
        domain: { ...this.c.domain, chainId: BigInt(this.c.domain.chainId) },
        types: REPORT_TYPES,
        primaryType: 'Report',
        message: { reporter: report.signer!, operator: this.c.receiptSigner, bodyHash: reportBodyHash(report), nonce: report.nonce! },
        signature: report.signature,
      }).catch(() => false);
      if (!ok) refuse('invalid_signature', "the signature is not a Report {reporter, operator, bodyHash, nonce} signed by signer under the Holdback domain, with operator this node's receiptSigner");
      signer = report.signer;
    }
    const l = this.limiter.limits;
    if (signer) this.limiter.admit(`s:${signer}`, l.signedPerSignerPerHour, 'signed reports per signer', this.c.now(), charge);
    else this.limiter.admit(`c:${client}`, l.unsignedPerClientPerHour, 'unsigned reports per client', this.c.now(), charge);
    return signer;
  }
}
