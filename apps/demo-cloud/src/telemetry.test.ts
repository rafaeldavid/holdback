// T-031: the demo's minimal telemetry. A request log by hour for seven days, this Durable Object's free-tier use with
// a warning before it runs out, and hourly and daily summaries of what the operator nodes already see.
import type { SettlementEvent, SettlementEventType } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from './storage.js';
import { dealFacts, summarize, Telemetry, type RequestLine, type TelemetryOptions } from './telemetry.js';

type Line = { level: 'info' | 'warn'; line: Record<string, unknown> };

const T0 = Date.parse('2026-11-03T10:15:00Z');
function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}
function logged(): { lines: Line[]; log: NonNullable<TelemetryOptions['log']> } {
  const lines: Line[] = [];
  return { lines, log: (level, line) => void lines.push({ level, line }) };
}
const line = (over: Partial<RequestLine> = {}): RequestLine => ({ requestId: crypto.randomUUID(), at: Math.floor(T0 / 1000), node: 0, method: 'GET', route: '/v1/status', status: 200, ms: 3, ...over });

describe('the request log', () => {
  it('keeps lines by hour for seven days and finds one by Request-Id, also after a cold start', async () => {
    const storage = new MemoryStorage();
    const c = clock();
    const t = await Telemetry.open({ storage, now: c.now });
    const l = line();
    t.request(l);
    expect(await t.lookup(l.requestId)).toEqual(l);
    await t.flush();
    const again = await Telemetry.open({ storage, now: c.now });
    expect(await again.lookup(l.requestId)).toEqual(l);
    expect(await again.lookup(crypto.randomUUID())).toBeUndefined();

    c.advance(8 * 86_400_000);
    again.request(line({ at: Math.floor(c.now() / 1000) }));
    await again.flush();
    expect(await again.lookup(l.requestId)).toBeUndefined();
    expect([...(await storage.list({ prefix: 'rl:' })).keys()]).toEqual(['rl:2026-11-11T10']);
  });

  it('stores only the Request-Id, time, node, method, route, status, problem and timing', async () => {
    const storage = new MemoryStorage();
    const t = await Telemetry.open({ storage, now: clock().now });
    t.request({ ...line({ status: 404, problem: 'not_found' }), path: '/v1/agents/0xabc', authorization: 'Holdback-ReadToken x', client: '203.0.113.7' } as RequestLine);
    await t.flush();
    const [bucket] = [...(await storage.list<{ lines: object[] }>({ prefix: 'rl:' })).values()];
    expect(Object.keys(bucket!.lines[0]!).sort()).toEqual(['at', 'method', 'ms', 'node', 'problem', 'requestId', 'route', 'status']);
  });
});

describe('free-tier use', () => {
  it('counts rows as Durable Object SQLite storage bills the key-value methods, and keeps the count across a cold start', async () => {
    const storage = new MemoryStorage();
    const c = clock();
    const t = await Telemetry.open({ storage, now: c.now });
    const before = t.usage();
    await t.storage.put({ a: 1, b: 2 });
    await t.storage.get('a');
    await t.storage.list({ prefix: 'a' });
    await t.storage.delete(['a', 'b']);
    t.alarmSet();
    t.invoked();
    const after = t.usage();
    expect([after.requests - before.requests, after.rowsRead - before.rowsRead, after.rowsWritten - before.rowsWritten]).toEqual([1, 2, 5]);
    await t.flush();
    expect((await Telemetry.open({ storage, now: c.now })).usage().requests).toBe(1);
  });

  it('warns once at 80% and once at 95% of a daily limit, then not again that day', async () => {
    const { lines, log } = logged();
    const t = await Telemetry.open({ storage: new MemoryStorage(), now: clock().now, log, limits: { requests: 10, rowsRead: 1e9, rowsWritten: 1e9 } });
    for (let i = 0; i < 8; i++) t.invoked();
    await t.flush();
    for (let i = 0; i < 2; i++) t.invoked();
    await t.flush();
    await t.flush();
    const warnings = lines.filter((l) => l.level === 'warn').map((l) => l.line);
    expect(warnings).toEqual([
      expect.objectContaining({ alert: 'durable-object-quota', day: '2026-11-03', metric: 'requests', used: 8, limit: 10, percent: 80, threshold: 80 }),
      expect.objectContaining({ alert: 'durable-object-quota', metric: 'requests', used: 10, percent: 100, threshold: 95 }),
    ]);
  });
});

describe('summaries', () => {
  it('per route: requests, errors, p50 and p95 latency and problems; 429s by bucket; prepare against submit', () => {
    const post = (route: string, status = 200, problem?: string) => line({ method: 'POST', route, status, ...(problem ? { problem } : {}) });
    const s = summarize([
      ...Array.from({ length: 20 }, (_, i) => line({ ms: i + 1 })),
      ...[1, 2, 3].map(() => post('/v1/prepare/offer')),
      ...[1, 2].map(() => post('/v1/commitments')),
      post('/v1/commitments', 400, 'invalid_terms'),
      post('/v1/faucet', 429, 'rate_limited'),
      line({ route: '/v1/commitments/{commitmentId}', status: 429, problem: 'rate_limited' }),
      post('/v1/commitments/{commitmentId}/agree', 500, 'internal'),
    ]);
    expect(s.requests).toBe(29);
    expect(s.routes['GET /v1/status']).toEqual({ requests: 20, clientErrors: 0, serverErrors: 0, p50Ms: 10, p95Ms: 19, problems: {} });
    expect(s.routes['POST /v1/commitments']).toMatchObject({ requests: 3, clientErrors: 1, problems: { invalid_terms: 1 } });
    expect(s.routes['POST /v1/commitments/{commitmentId}/agree']).toMatchObject({ serverErrors: 1, problems: { internal: 1 } });
    expect(s.throttled).toEqual({ read: 1, write: 0, faucet: 1 });
    expect(s.conversion['offer']).toEqual({ prepared: 3, submitted: 2 });
  });

  it('deals from settlement events: stages, time per stage, outcomes, and signers as counts only', () => {
    const at = (sec: number) => new Date(T0 + sec * 1000).toISOString().replace('.000Z', 'Z');
    const [s1, b1, s2, b2, adj] = ['0x51', '0xb1', '0x52', '0xb2', '0xad'].map((p) => p.padEnd(42, '0'));
    let seq = 0;
    const ev = (type: SettlementEventType, id: string, sec: number, actor: string, payload: Record<string, unknown> = {}) =>
      ({ seq: seq++, type, commitmentId: id, at: at(sec), actor, payload, prevHash: '0x', hash: '0x' }) as unknown as SettlementEvent;
    const events = [
      ev('commitment.offered', 'C', -86_400, s1!, { terms: { buyer: b2, seller: s1 } }),
      ev('commitment.offered', 'A', 0, s1!, { terms: { buyer: b1, seller: s1 } }),
      ev('commitment.offered', 'B', 10, s2!, { terms: { buyer: b2, seller: s2 } }),
      ev('hold.funded', 'A', 60, b1!),
      ev('delivery.submitted', 'A', 120, s1!),
      ev('judgment.decided', 'A', 180, adj!),
      ev('settlement.released', 'A', 180, 'anyone'),
      ev('offer.expired', 'B', 3600, 'anyone'),
    ];
    const views: Record<string, { settledAt: string | null; finalAt: string | null }> = { A: { settledAt: at(180), finalAt: at(300) }, B: { settledAt: null, finalAt: at(3600) }, C: { settledAt: null, finalAt: null } };
    const day = Date.parse('2026-11-03T00:00:00Z');
    const f = dealFacts(events, (id) => views[id], { from: day, to: day + 86_400_000 });
    expect(f.deals).toEqual({
      offered: { deals: 2, medianSecFromPrevious: null },
      funded: { deals: 1, medianSecFromPrevious: 60 },
      delivered: { deals: 1, medianSecFromPrevious: 60 },
      decided: { deals: 1, medianSecFromPrevious: 60 },
      final: { deals: 2, medianSecFromPrevious: 120 },
    });
    expect(f.outcomes).toMatchObject({ released: 1, expired: 1, refunded: 0, reclaimed: 0 });
    // s1 acted the day before, so only b1 and s2 are new; b1's first deal completed, s2's expired. b2 never signed.
    expect(f.signers).toEqual({ active: 3, fresh: 2, firstDealCompleted: 1 });
    expect(JSON.stringify(f)).not.toMatch(/0x/);
  });

  it('writes an hour line when the hour ends and a day line when the day ends, also across a cold start', async () => {
    const storage = new MemoryStorage();
    const c = clock(Date.parse('2026-11-03T23:30:00Z'));
    const t = await Telemetry.open({ storage, now: c.now });
    t.request(line({ at: Math.floor(c.now() / 1000), route: '/v1/faucet', method: 'POST' }));
    await t.flush();
    c.advance(3_600_000);
    const { lines, log } = logged();
    const windows: unknown[] = [];
    const again = await Telemetry.open({ storage, now: c.now, log });
    await again.flush(async (day, window) => (windows.push({ day, window }), { journalEntries: 7 }));
    expect(lines.map((l) => [l.level, l.line['telemetry'], l.line['hour'] ?? l.line['day'], l.line['requests']])).toEqual([
      ['info', 'hour', '2026-11-03T23', 1],
      ['info', 'day', '2026-11-03', 1],
    ]);
    expect(lines[1]!.line).toMatchObject({ journalEntries: 7, usage: { requests: expect.any(Object), rowsRead: expect.any(Object), rowsWritten: expect.any(Object) } });
    expect(windows).toEqual([{ day: '2026-11-03', window: { from: Date.parse('2026-11-03T00:00:00Z'), to: Date.parse('2026-11-04T00:00:00Z') } }]);
    await again.flush();
    expect(lines).toHaveLength(2);
  });
});
