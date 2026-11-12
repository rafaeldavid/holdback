// The public demo's minimal telemetry (T-031; D39; docs/reviews/2026-11-02-api-agent-review.md §9). Only what the
// operator nodes already see (ADR-0024 §1), aggregated:
// - a request log kept seven days, one line per request: Request-Id, time, node, method, route template, status,
//   problem type and timing. Never a body, a header value, an IP, or the path itself (it carries addresses and IDs);
// - this Durable Object's use of the Workers Free tier (requests, SQLite rows read and written), estimated from its
//   own calls, with a warning at 80% and 95% of a daily limit, and the rows it keeps for good (adjudicator
//   registrations, T-221), and the timeouts the operators sent on their own that day, by kind (T-231);
// - a summary line per hour and per UTC day: per-route requests, errors and latency, problems, 429s, prepare against
//   submit and, from settlement events only, the deal funnel, time per stage and signers as counts.
// Summaries and warnings go to the account's Workers Logs as console lines. Nothing here is served or published.
import type { SettlementEvent, SettlementEventType } from '@holdback/core';
import type { WorldStorage } from './storage.js';

export interface RequestLine {
  requestId: string;
  /** Unix time, whole seconds. */
  at: number;
  /** Which operator node answered: 0 for holdback-op1, 1 for holdback-op2. */
  node: 0 | 1;
  method: string;
  /** The route template (`/v1/agents/{address}`), or `unmatched`. */
  route: string;
  status: number;
  problem?: string;
  ms: number;
}

/** The Workers Free tier's daily Durable Object limits (Cloudflare pricing, read 2026-11-03). */
export const FREE_TIER = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000 } as const;
export type Quota = keyof typeof FREE_TIER;
const QUOTAS = Object.keys(FREE_TIER) as Quota[];
const WARN_AT_PERCENT = [80, 95] as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RETENTION_MS = 7 * DAY_MS;
const FLUSH_EVERY_MS = 60_000;
/** Lines kept per hour, so one hour's bucket stays well under the 2 MB value limit. */
const MAX_LINES_PER_HOUR = 6_000;
const USAGE_KEY = 'tm:current';
/** Any other method a caller sends is logged as OTHER: the method is caller text, and it names a summary key. */
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

interface Usage extends Record<Quota, number> {
  day: string;
  /** Cold starts, with the rows they read and the time they took to replay storage. */
  wakes: number;
  replayRowsRead: number;
  replayMs: number;
  /** Warnings given today, as `metric:threshold`. */
  warned: string[];
  /** The hour whose bucket is still open (its summary line not yet written). */
  openHour: string;
  /**
   * Rows the world keeps for good under a prefix, as last counted: `ar` for adjudicator registrations and `ph` for the
   * policies later registrations replaced, neither ever removed (T-221, ADR-0030 §3). Carried into each new day, so
   * every day line shows the storage growth.
   */
  rows?: Record<string, number>;
  /** Timeouts the operators sent on their own today, by kind (T-231). */
  timeouts?: Record<string, number>;
}

interface Hour {
  hour: string;
  lines: RequestLine[];
  dropped: number;
}

export interface Window {
  from: number;
  to: number;
}

/** Settlement-side facts for a day's summary line. */
export type DayFacts = (day: string, window: Window) => Promise<Record<string, unknown>>;

export interface TelemetryOptions {
  storage: WorldStorage;
  now: () => number;
  /** Where summary lines and warnings go. Default: console.log and console.warn, which Workers Logs keeps. */
  log?: (level: 'info' | 'warn', line: Record<string, unknown>) => void;
  /** Daily limits to warn against. Default: FREE_TIER. */
  limits?: Record<Quota, number>;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const hourOf = (ms: number) => new Date(ms).toISOString().slice(0, 13);
const freshUsage = (ms: number): Usage => ({ day: dayOf(ms), requests: 0, rowsRead: 0, rowsWritten: 0, wakes: 0, replayRowsRead: 0, replayMs: 0, warned: [], openHour: hourOf(ms) });
const consoleLog: NonNullable<TelemetryOptions['log']> = (level, line) => (level === 'warn' ? console.warn(line) : console.log(line));

/** Nearest-rank quantile of ascending values; undefined when there are none. */
const quantile = (sorted: readonly number[], q: number): number | undefined => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];

/** World storage that counts rows as Durable Object SQLite storage bills its key-value methods: one per key. */
class CountedStorage implements WorldStorage {
  constructor(
    private readonly inner: WorldStorage,
    private readonly count: (quota: Quota, rows: number) => void,
  ) {}

  get<T = unknown>(key: string): Promise<T | undefined> {
    this.count('rowsRead', 1);
    return this.inner.get<T>(key);
  }

  put(entries: Record<string, unknown>): Promise<void> {
    this.count('rowsWritten', Object.keys(entries).length);
    return this.inner.put(entries);
  }

  delete(keys: string[]): Promise<number> {
    this.count('rowsWritten', keys.length);
    return this.inner.delete(keys);
  }

  async list<T = unknown>(options: { prefix: string; end?: string }): Promise<Map<string, T>> {
    const found = await this.inner.list<T>(options);
    this.count('rowsRead', Math.max(1, found.size));
    return found;
  }
}

export class Telemetry {
  /** The world's storage, counted: every row read or written through it is added to today's use. */
  readonly storage: WorldStorage;
  private readonly closedHours: Hour[] = [];
  private readonly closedDays: Usage[] = [];
  private readonly limits: Record<Quota, number>;
  private readonly log: NonNullable<TelemetryOptions['log']>;
  private unflushedLines = 0;
  private changed = false;
  private lastFlush: number;

  private constructor(
    private readonly o: TelemetryOptions,
    private today: Usage,
    private hour: Hour,
  ) {
    this.storage = new CountedStorage(o.storage, (quota, rows) => this.count(quota, rows));
    this.limits = o.limits ?? FREE_TIER;
    this.log = o.log ?? consoleLog;
    this.lastFlush = o.now();
  }

  /** Loads today's use and the open hour of the log; a day or hour that ended meanwhile is summarized at the next flush. */
  static async open(o: TelemetryOptions): Promise<Telemetry> {
    const stored = await o.storage.get<Usage>(USAGE_KEY);
    const bucket = stored ? await o.storage.get<Hour>(`rl:${stored.openHour}`) : undefined;
    const t = new Telemetry(o, stored ?? freshUsage(o.now()), bucket ?? { hour: stored?.openHour ?? hourOf(o.now()), lines: [], dropped: 0 });
    t.count('rowsRead', stored ? 2 : 1);
    return t;
  }

  private day(): Usage {
    const day = dayOf(this.o.now());
    if (this.today.day !== day) {
      this.closedDays.push(this.today);
      this.today = { ...freshUsage(this.o.now()), ...(this.today.rows ? { rows: { ...this.today.rows } } : {}) };
    }
    return this.today;
  }

  private bucket(): Hour {
    const hour = hourOf(this.o.now());
    if (this.hour.hour !== hour) {
      this.closedHours.push(this.hour);
      this.hour = { hour, lines: [], dropped: 0 };
    }
    return this.hour;
  }

  private count(quota: Quota, n: number): void {
    this.day()[quota] += n;
    this.changed = true;
  }

  /** Today's use so far. */
  usage(): Readonly<Usage> {
    return { ...this.day() };
  }

  /** One Durable Object invocation: a request or an alarm. */
  invoked(): void {
    this.count('requests', 1);
  }

  /** One setAlarm, billed as a row written. */
  alarmSet(): void {
    this.count('rowsWritten', 1);
  }

  /** How many rows the world keeps under `prefix` (`ar`: adjudicator registrations; `ph`: replaced policies, T-221); the usage view shows it. */
  rows(prefix: string, count: number): void {
    const u = this.day();
    if (u.rows?.[prefix] === count) return;
    u.rows = { ...(u.rows ?? {}), [prefix]: count };
    this.changed = true;
  }

  /** One timeout the operators sent on their own (T-231): the usage view counts them by kind as `operatorTimeouts`. */
  timeout(kind: string): void {
    const u = this.day();
    u.timeouts = { ...(u.timeouts ?? {}), [kind]: (u.timeouts?.[kind] ?? 0) + 1 };
    this.changed = true;
  }

  /** Marks a cold start; call the returned function when storage has been replayed. */
  wake(): () => void {
    const rows = this.day().rowsRead;
    const started = this.o.now();
    return () => {
      const u = this.day();
      u.wakes++;
      u.replayRowsRead += u.rowsRead - rows;
      u.replayMs += this.o.now() - started;
      this.changed = true;
    };
  }

  /** Logs one request: these fields only, whatever else the caller holds, and a method from a fixed set. */
  request(l: RequestLine): void {
    const h = this.bucket();
    const method = METHODS.has(l.method) ? l.method : 'OTHER';
    const line: RequestLine = { requestId: l.requestId, at: l.at, node: l.node, method, route: l.route, status: l.status, ...(l.problem ? { problem: l.problem } : {}), ms: l.ms };
    if (h.lines.length < MAX_LINES_PER_HOUR) h.lines.push(line);
    else h.dropped++;
    this.unflushedLines++;
    this.changed = true;
  }

  /** The log line of a request in the last seven days, newest hour first; undefined when there is none. */
  async lookup(requestId: string): Promise<RequestLine | undefined> {
    const held = [this.hour, ...this.closedHours].flatMap((h) => h.lines).find((l) => l.requestId === requestId);
    if (held) return { ...held };
    const now = this.o.now();
    for (let ms = now; ms > now - RETENTION_MS; ms -= HOUR_MS) {
      if (hourOf(ms) === this.hour.hour) continue;
      const hit = (await this.storage.get<Hour>(`rl:${hourOf(ms)}`))?.lines.find((l) => l.requestId === requestId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Milliseconds until log lines are due to be flushed, or null when none are waiting. */
  flushDueInMs(): number | null {
    return this.unflushedLines > 0 ? Math.max(0, this.lastFlush + FLUSH_EVERY_MS - this.o.now()) : null;
  }

  /** Flushes when something changed and the last flush is a minute old. */
  async maybeFlush(facts?: DayFacts): Promise<void> {
    if (this.changed && this.o.now() - this.lastFlush >= FLUSH_EVERY_MS) await this.flush(facts);
  }

  /** Persists the log and today's use, writes the summary of each hour and day that ended, and warns near a limit. */
  async flush(facts?: DayFacts): Promise<void> {
    this.bucket();
    this.day();
    const hours = this.closedHours.splice(0);
    const days = this.closedDays.splice(0);
    this.warn();
    this.today.openHour = this.hour.hour;
    const buckets = this.unflushedLines > 0 ? [...hours, this.hour] : hours;
    await this.storage.put({ ...Object.fromEntries(buckets.map((h) => [`rl:${h.hour}`, h])), [USAGE_KEY]: this.today });
    this.unflushedLines = 0;
    this.changed = false;
    this.lastFlush = this.o.now();
    for (const h of hours) {
      const today = h.hour.startsWith(this.today.day) ? { usageToday: this.usageView(this.today) } : {};
      this.log('info', { telemetry: 'hour', hour: h.hour, ...summarize(h.lines), ...(h.dropped ? { dropped: h.dropped } : {}), ...today });
    }
    for (const u of days) {
      const lines = [...(await this.storage.list<Hour>({ prefix: `rl:${u.day}` })).values()].flatMap((h) => h.lines);
      const from = Date.parse(`${u.day}T00:00:00Z`);
      // A failure in the settlement-side facts still writes the line: the day is closed only once.
      const settlement = facts ? await facts(u.day, { from, to: from + DAY_MS }).catch(() => ({ facts: 'unavailable' })) : {};
      this.log('info', { telemetry: 'day', day: u.day, ...summarize(lines), usage: this.usageView(u), ...settlement });
    }
    if (hours.length > 0) await this.prune();
  }

  /** Deletes log hours older than seven days. */
  private async prune(): Promise<void> {
    const old = [...(await this.storage.list({ prefix: 'rl:', end: `rl:${hourOf(this.o.now() - RETENTION_MS)}` })).keys()];
    for (let i = 0; i < old.length; i += 128) await this.storage.delete(old.slice(i, i + 128));
  }

  private warn(): void {
    const u = this.today;
    for (const metric of QUOTAS) {
      const limit = this.limits[metric];
      const percent = Math.floor((u[metric] * 100) / limit);
      for (const threshold of WARN_AT_PERCENT) {
        const key = `${metric}:${threshold}`;
        if (percent < threshold || u.warned.includes(key)) continue;
        u.warned.push(key);
        this.log('warn', { alert: 'durable-object-quota', day: u.day, metric, used: u[metric], limit, percent, threshold, runbook: 'docs/operations.md, Telemetry' });
      }
    }
  }

  private usageView(u: Usage): Record<string, unknown> {
    const quotas = Object.fromEntries(QUOTAS.map((q) => [q, { used: u[q], limit: this.limits[q], percent: Math.floor((u[q] * 100) / this.limits[q]) }]));
    return { ...quotas, wakes: u.wakes, replayRowsRead: u.replayRowsRead, replayMs: u.replayMs, ...(u.rows ? { rows: { ...u.rows } } : {}), ...(u.timeouts ? { operatorTimeouts: { ...u.timeouts } } : {}) };
  }
}

/** Where a prepared message of each kind is submitted. */
const SUBMIT_ROUTE: Record<string, string> = {
  offer: '/v1/commitments',
  'agree-and-fund': '/v1/commitments/{commitmentId}/agree',
  delivery: '/v1/commitments/{commitmentId}/deliveries',
  'early-accept': '/v1/commitments/{commitmentId}/accept',
  appeal: '/v1/commitments/{commitmentId}/appeals',
  settlement: '/v1/commitments/{commitmentId}/settlements',
};

/** The throttle bucket a 429 came from: prepare is counted as a read. */
const bucketOf = (l: RequestLine): 'read' | 'write' | 'faucet' => (l.route === '/v1/faucet' ? 'faucet' : l.method === 'GET' || l.route.startsWith('/v1/prepare/') ? 'read' : 'write');

/** Per route: requests, 4xx and 5xx, p50 and p95 latency, problems by type; 429s by bucket; prepared against submitted. */
export function summarize(lines: readonly RequestLine[]) {
  const routes: Record<string, { requests: number; clientErrors: number; serverErrors: number; p50Ms: number; p95Ms: number; problems: Record<string, number> }> = {};
  const latencies: Record<string, number[]> = {};
  const throttled = { read: 0, write: 0, faucet: 0 };
  const ok = (method: string, route: string) => lines.filter((l) => l.method === method && l.route === route && l.status < 300).length;
  for (const l of lines) {
    const key = `${l.method} ${l.route}`;
    const r = (routes[key] ??= { requests: 0, clientErrors: 0, serverErrors: 0, p50Ms: 0, p95Ms: 0, problems: {} });
    r.requests++;
    if (l.status >= 500) r.serverErrors++;
    else if (l.status >= 400) r.clientErrors++;
    if (l.problem) r.problems[l.problem] = (r.problems[l.problem] ?? 0) + 1;
    if (l.status === 429) throttled[bucketOf(l)]++;
    (latencies[key] ??= []).push(l.ms);
  }
  for (const [key, ms] of Object.entries(latencies)) {
    ms.sort((a, b) => a - b);
    routes[key]!.p50Ms = quantile(ms, 0.5)!;
    routes[key]!.p95Ms = quantile(ms, 0.95)!;
  }
  const conversion = Object.fromEntries(Object.entries(SUBMIT_ROUTE).map(([kind, route]) => [kind, { prepared: ok('POST', `/v1/prepare/${kind}`), submitted: ok('POST', route) }]));
  return { requests: lines.length, routes, throttled, conversion };
}

const STAGES = ['offered', 'funded', 'delivered', 'decided', 'final'] as const;
type Stage = (typeof STAGES)[number];
const STAGE_OF: Partial<Record<SettlementEventType, Stage>> = { 'commitment.offered': 'offered', 'hold.funded': 'funded', 'delivery.submitted': 'delivered', 'judgment.decided': 'decided' };
const OUTCOME_OF: Partial<Record<SettlementEventType, string>> = {
  'settlement.released': 'released',
  'settlement.refunded': 'refunded',
  'settlement.reclaimed': 'reclaimed',
  'commitment.settled': 'settled',
  'offer.expired': 'expired',
  'fallback.triggered': 'escalated',
  // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
  'appeal.filed': 'appealed',
  'default.triggered': 'defaulted',
};

export interface Finality {
  settledAt: string | null;
  finalAt: string | null;
}

/**
 * The deal funnel in a window, from settlement events and each deal's finality only: deals reaching each stage, the
 * median seconds from the stage before, outcomes, and signers as counts. Decided: a judgment or an early accept.
 * Final: settled and past every appeal (an expired offer is an outcome, not final). Active: parties that signed in
 * the window. Fresh: parties whose first signed event is in it. First deal completed: fresh parties whose first deal
 * has settled and is final, so far. No address leaves this function.
 */
export function dealFacts(events: readonly SettlementEvent[], finality: (id: string) => Finality | undefined, { from, to }: Window) {
  const inWindow = (t: number) => t >= from && t < to;
  const deals = new Map<string, { parties: string[]; at: Partial<Record<Stage, number>> }>();
  const firstSigned = new Map<string, { at: number; deal: string }>();
  const active = new Set<string>();
  const outcomes = Object.fromEntries(Object.values(OUTCOME_OF).map((o) => [o, 0]));
  for (const e of events) {
    if (!e.commitmentId) continue;
    const t = Date.parse(e.at);
    if (e.type === 'commitment.offered') {
      const terms = e.payload['terms'] as { buyer?: string; seller?: string } | undefined;
      if (!terms?.buyer || !terms.seller) continue;
      deals.set(e.commitmentId, { parties: [terms.buyer.toLowerCase(), terms.seller.toLowerCase()], at: {} });
    }
    const deal = deals.get(e.commitmentId);
    if (!deal) continue;
    const stage = e.type === 'settlement.released' && e.payload['via'] === 'early_accept' ? 'decided' : STAGE_OF[e.type];
    if (stage && deal.at[stage] === undefined) deal.at[stage] = t;
    const outcome = OUTCOME_OF[e.type];
    if (outcome && inWindow(t)) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    const actor = typeof e.actor === 'string' ? e.actor.toLowerCase() : '';
    if (!deal.parties.includes(actor)) continue;
    if (!firstSigned.has(actor)) firstSigned.set(actor, { at: t, deal: e.commitmentId });
    if (inWindow(t)) active.add(actor);
  }
  const reached = Object.fromEntries(STAGES.map((s) => [s, { deals: 0, gaps: [] as number[] }])) as Record<Stage, { deals: number; gaps: number[] }>;
  for (const [id, deal] of deals) {
    const f = finality(id);
    if (f?.settledAt && f.finalAt) deal.at.final = Date.parse(f.finalAt);
    let previous: number | undefined;
    for (const s of STAGES) {
      const t = deal.at[s];
      if (t === undefined) continue;
      if (inWindow(t)) {
        reached[s].deals++;
        if (previous !== undefined) reached[s].gaps.push((t - previous) / 1000);
      }
      previous = t;
    }
  }
  const fresh = [...firstSigned.values()].filter((f) => inWindow(f.at));
  const completed = fresh.filter((f) => {
    const v = finality(f.deal);
    return Boolean(v?.settledAt && v.finalAt);
  });
  return {
    deals: Object.fromEntries(STAGES.map((s) => [s, { deals: reached[s].deals, medianSecFromPrevious: quantile([...reached[s].gaps].sort((a, b) => a - b), 0.5) ?? null }])) as Record<Stage, { deals: number; medianSecFromPrevious: number | null }>,
    outcomes,
    signers: { active: active.size, fresh: fresh.length, firstDealCompleted: completed.length },
  };
}
