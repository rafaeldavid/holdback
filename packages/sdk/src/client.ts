// The Holdback SDK client (docs/api.md, SDK). It relays an agent's signed messages through an ordered list of
// operators and, when none of them accepts, submits the same messages straight to the settlement layer
// (ADR-0005, the escape hatch). Operators add speed, never authority, so the SDK trusts an operator's success only
// as far as its receipt and treats any operator refusal as a reason to try the next one: only the settlement
// layer's own refusal is final.
import { randomUUID } from 'node:crypto';
import type { CommitmentStateView, Hex32, OperatorStatus, Page, Problem, ProblemType, Receipt, SettlementEvent } from '@holdback/core';
import type { Settlement, SubmitResult } from '@holdback/settlement';
import { asDryRun, commitmentIdOf, previewSubmission, requestOf, submissionKeys, submissionsOf, unsigned, type Operation } from './operations.js';

/** ADR-0017 §3: the SDK waits once per call, for at most this long, then fails over. */
export const MAX_RETRY_AFTER_MS = 2000;

export interface HoldbackOptions {
  /** Operator base URLs in failover order. May be empty: then every call goes direct. */
  operators: readonly string[];
  /** The direct-submit target for the escape hatch. Without it, a call fails when every operator fails. */
  settlement?: Settlement;
  /** Per-request timeout for one operator, in milliseconds. Default 5000. */
  requestTimeoutMs?: number;
  /** Poll interval for waitFor, in milliseconds. Default 250. */
  pollMs?: number;
  /** Injected for tests; the Retry-After wait goes through it. */
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

/** A problem as an operator or the settlement layer reported it (RFC 9457). */
export type HoldbackProblem = Problem & { status?: number; title?: string; instance?: string };

export class HoldbackError extends Error {
  constructor(
    readonly problem: HoldbackProblem,
    /** The operator URL that answered last, or 'direct'. */
    readonly via: string,
  ) {
    super(`${problem.type}: ${problem.detail}`);
    this.name = 'HoldbackError';
  }
}

export interface Submitted {
  /** The operator URL that relayed it, or 'direct'. */
  via: string;
  state: CommitmentStateView;
  /** The operator's signed receipt for the last event; absent on the direct path, which has no operator. */
  receipt?: Receipt;
}

export interface Previewed {
  via: string;
  state: CommitmentStateView;
  dryRun: true;
  /** 'skipped' for an unsigned party message (ADR-0017 §7). */
  signatureCheck: 'verified' | 'skipped' | 'none';
}

export interface SubmitCallOptions {
  /** Reused across every operator and the direct path, so a half-relayed call completes and never doubles. */
  idempotencyKey?: string;
}

export type WaitTarget = readonly CommitmentStateView['escrowState'][] | 'final';

type Attempt<T> = { ok: true; value: T } | { ok: false; problem: HoldbackProblem; retryAfterMs?: number };

const UNAVAILABLE = (detail: string): HoldbackProblem => ({ type: 'invalid_state', detail, status: 503 });

/** Retry-After as milliseconds, capped; a missing or malformed value counts as the cap. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (header === null) return MAX_RETRY_AFTER_MS;
  const trimmed = header.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else {
    const at = Date.parse(trimmed);
    ms = Number.isFinite(at) ? at - now : MAX_RETRY_AFTER_MS;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

function isProblemType(v: unknown): v is ProblemType {
  return typeof v === 'string' && /^[a-z_]{1,64}$/.test(v);
}

function directResult(r: SubmitResult): Attempt<Extract<SubmitResult, { ok: true }>> {
  return r.ok ? { ok: true, value: r } : { ok: false, problem: r.problem };
}

export class Holdback {
  private readonly operators: readonly string[];
  private readonly settlement: Settlement | undefined;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetch: typeof fetch;

  constructor(options: HoldbackOptions) {
    this.operators = options.operators.map((u) => u.replace(/\/+$/, ''));
    this.settlement = options.settlement;
    this.timeoutMs = options.requestTimeoutMs ?? 5000;
    this.pollMs = options.pollMs ?? 250;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ---- transport -----------------------------------------------------------------------------------

  private async request(base: string, method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Attempt<{ body: unknown; headers: Headers }>> {
    let res: Response;
    try {
      res = await this.fetch(`${base}${path}`, {
        method,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return { ok: false, problem: UNAVAILABLE(`operator ${base} unreachable: ${(e as Error).message}`) };
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    if (res.ok) return { ok: true, value: { body: parsed, headers: res.headers } };
    const p = (parsed ?? {}) as Record<string, unknown>;
    const problem: HoldbackProblem = {
      type: isProblemType(p['type']) ? p['type'] : 'invalid_state',
      detail: typeof p['detail'] === 'string' ? p['detail'] : `HTTP ${res.status}`,
      status: res.status,
      ...(typeof p['title'] === 'string' ? { title: p['title'] } : {}),
      ...(typeof p['instance'] === 'string' ? { instance: p['instance'] } : {}),
    };
    return res.status === 429 ? { ok: false, problem, retryAfterMs: retryAfterMs(res.headers.get('retry-after')) } : { ok: false, problem };
  }

  /**
   * Tries each operator in order. A 429 earns one wait per call (at most 2 s) and one retry of that operator;
   * every other failure moves on at once. Returns the last problem when none succeeds.
   */
  private async failover<T>(attempt: (base: string) => Promise<Attempt<T>>): Promise<{ ok: true; value: T; via: string } | { ok: false; problem: HoldbackProblem; via: string }> {
    let waited = false;
    let last: { problem: HoldbackProblem; via: string } = { problem: UNAVAILABLE('no operator configured'), via: 'none' };
    for (const base of this.operators) {
      let r = await attempt(base);
      if (!r.ok && r.retryAfterMs !== undefined && !waited) {
        waited = true;
        await this.sleep(r.retryAfterMs);
        r = await attempt(base);
      }
      if (r.ok) return { ok: true, value: r.value, via: base };
      last = { problem: r.problem, via: base };
    }
    return { ok: false, ...last };
  }

  // ---- writes --------------------------------------------------------------------------------------

  /** Relays a signed operation, failing over across operators and then to direct submission. */
  async submit(op: Operation, options: SubmitCallOptions = {}): Promise<Submitted> {
    const key = options.idempotencyKey ?? randomUUID();
    const { path, body } = requestOf(op);
    const relayed = await this.failover(async (base) => {
      const r = await this.request(base, 'POST', path, body, { 'idempotency-key': key });
      return r.ok ? { ok: true as const, value: r.value.body as CommitmentStateView & { receipt?: Receipt } } : r;
    });
    if (relayed.ok) {
      const { receipt, ...state } = relayed.value;
      return { via: relayed.via, state: state as CommitmentStateView, ...(receipt ? { receipt } : {}) };
    }
    if (!this.settlement) throw new HoldbackError(relayed.problem, relayed.via);
    return { via: 'direct', state: await this.direct(op, key) };
  }

  /** The escape hatch: the operation's submissions, in order, under the keys an operator would have used. */
  private async direct(op: Operation, key: string): Promise<CommitmentStateView> {
    const subs = submissionsOf(op);
    const keys = submissionKeys(key, subs.length);
    let last: Extract<SubmitResult, { ok: true }> | undefined;
    for (const [i, s] of subs.entries()) {
      const r = directResult(await this.settlement!.submit(s, { idempotencyKey: keys[i]!, via: 'direct' }));
      if (!r.ok) throw new HoldbackError(r.problem, 'direct');
      last = r.value;
    }
    return last!.state;
  }

  /**
   * A dry run (ADR-0017 §7): every party signature is removed before the body leaves the SDK, so no operator
   * ever holds a usable authorization from a preview. Nothing is recorded or submitted anywhere.
   */
  async preview(op: Operation): Promise<Previewed> {
    const bare = unsigned(op);
    const { path, body } = requestOf(bare);
    const relayed = await this.failover(async (base) => {
      const r = await this.request(base, 'POST', `${path}?validateOnly=true`, body);
      if (!r.ok) return r;
      const check = r.value.headers.get('holdback-signature-check');
      const signatureCheck: Previewed['signatureCheck'] = check === 'verified' || check === 'none' ? check : 'skipped';
      return { ok: true as const, value: { state: r.value.body as CommitmentStateView, signatureCheck } };
    });
    if (relayed.ok) return { via: relayed.via, dryRun: true, ...relayed.value };
    if (!this.settlement) throw new HoldbackError(relayed.problem, relayed.via);
    const current = bare.kind === 'hold' ? ((await this.settlement.state(commitmentIdOf(bare)))?.escrowState ?? null) : null;
    const r = await this.settlement.validate(asDryRun(previewSubmission(bare, current)));
    if (!r.ok) throw new HoldbackError(r.problem, 'direct');
    return { via: 'direct', state: r.state, dryRun: true, signatureCheck: r.signatureCheck };
  }

  // Typed shorthands for each operation (docs/api.md). Every message arrives signed by its author.
  offer = (commitment: Extract<Operation, { kind: 'offer' }>['commitment'], o?: SubmitCallOptions) => this.submit({ kind: 'offer', commitment }, o);
  acceptAsAdjudicator = (message: Extract<Operation, { kind: 'acceptance' }>['message'], o?: SubmitCallOptions) => this.submit({ kind: 'acceptance', message }, o);
  agree = (message: Extract<Operation, { kind: 'agree' }>['message'], fund?: Extract<Operation, { kind: 'agree' }>['fund'], o?: SubmitCallOptions) =>
    this.submit(fund ? { kind: 'agree', message, fund } : { kind: 'agree', message }, o);
  hold = (parts: Omit<Extract<Operation, { kind: 'hold' }>, 'kind'>, o?: SubmitCallOptions) => this.submit({ kind: 'hold', ...parts }, o);
  fund = (message: Extract<Operation, { kind: 'fund' }>['message'], o?: SubmitCallOptions) => this.submit({ kind: 'fund', message }, o);
  deliver = (delivery: Extract<Operation, { kind: 'deliver' }>['delivery'], o?: SubmitCallOptions) => this.submit({ kind: 'deliver', delivery }, o);
  earlyAccept = (message: Extract<Operation, { kind: 'early_accept' }>['message'], o?: SubmitCallOptions) => this.submit({ kind: 'early_accept', message }, o);
  decide = (message: Extract<Operation, { kind: 'decide' }>['message'], o?: SubmitCallOptions) => this.submit({ kind: 'decide', message }, o);
  appeal = (appeal: Extract<Operation, { kind: 'appeal' }>['appeal'], o?: SubmitCallOptions) => this.submit({ kind: 'appeal', appeal }, o);
  /** A co-signed MutualSettlement (ADR-0019, D23); preview it unsigned with preview({ kind: 'settle', ... }). */
  settle = (message: Extract<Operation, { kind: 'settle' }>['message'], o?: SubmitCallOptions) => this.submit({ kind: 'settle', message }, o);
  trigger = (commitmentId: Hex32, timeout: Extract<Operation, { kind: 'trigger' }>['timeout'], o?: SubmitCallOptions) => this.submit({ kind: 'trigger', commitmentId, timeout }, o);

  // ---- reads ---------------------------------------------------------------------------------------

  private async read<T>(path: string): Promise<T> {
    const r = await this.failover(async (base) => {
      const x = await this.request(base, 'GET', path);
      return x.ok ? { ok: true as const, value: x.value.body as T } : x;
    });
    if (r.ok) return r.value;
    throw new HoldbackError(r.problem, r.via);
  }

  /** The commitment's read model, or null when no operator and no settlement layer knows it. */
  async commitment(id: Hex32): Promise<CommitmentStateView | null> {
    try {
      return await this.read<CommitmentStateView>(`/v1/commitments/${id}`);
    } catch (e) {
      if (!this.settlement) {
        if (e instanceof HoldbackError && e.problem.type === 'not_found') return null;
        throw e;
      }
      return this.settlement.state(id);
    }
  }

  /** A commitment's events, newest first (ADR-0017 page envelope). */
  events = (id: Hex32, page: { cursor?: string; limit?: number } = {}) => this.read<Page<SettlementEvent>>(`/v1/commitments/${id}/events${query(page)}`);
  receipts = (id: Hex32, page: { cursor?: string; limit?: number } = {}) => this.read<Page<Receipt>>(`/v1/commitments/${id}/receipts${query(page)}`);
  status = () => this.read<OperatorStatus>('/v1/status');

  /** Polls until the commitment reaches one of `target`, or, for 'final', until finalAt is set (D20). */
  async waitFor(id: Hex32, target: WaitTarget, options: { timeoutMs?: number } = {}): Promise<CommitmentStateView> {
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    let last: CommitmentStateView | null = null;
    for (;;) {
      last = await this.commitment(id).catch(() => last);
      if (last && (target === 'final' ? last.finalAt != null : target.includes(last.escrowState))) return last;
      if (Date.now() >= deadline) {
        const want = target === 'final' ? 'final' : target.join(' | ');
        throw new Error(`waitFor ${id}: still ${last ? `${last.escrowState}${target === 'final' ? ' (not final)' : ''}` : 'unknown'} after timeout, waiting for ${want}`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }
}

function query(page: { cursor?: string; limit?: number }): string {
  const q = new URLSearchParams();
  if (page.cursor !== undefined) q.set('cursor', page.cursor);
  if (page.limit !== undefined) q.set('limit', String(page.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}
