// Shared fixtures for the T-066 metrics tests. No network: every source is a file in tests/metrics/fixtures/ or a
// fake fetch. The run-once deal (0xa93a4a1d…) was read live from api.escrow.stream and Sepolia on 2026-11-05.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const json = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
export const config = (name: string) => JSON.parse(readFileSync(join(ROOT, 'config', name), 'utf8'));

export const ONCE = '0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93';
/** Deal lane 1, which sent every transaction of the run-once deal. */
export const LANE = '0x5e7f1a8c06f357e8e321ba33a3ffb0b4a0fd3243';
/** 2026-11-05T15:00:00Z: after the run-once deal, inside its 7-day window. */
export const NOW = Date.parse('2026-11-05T15:00:00Z');
/** The eventLog block deal-timing.mjs's run() writes beside a body: node 1 served events 0 to 181, one deal funded. */
export const EVENT_LOG = { node: 'https://api.escrow.stream', from: 0, head: 181, events: 11, complete: true, fundedDeals: 1 };
export const COMMIT = '7639613453bc367ed3ac0122cdb38e4e4553765d';

type Event = { seq: number; type: string; at: string; commitmentId?: string; actor?: string; payload: Record<string, unknown> };

export function onceEvents(): Event[] {
  return json('deal-once.events.json');
}

export function onceBlocks(): Map<string, number> {
  const raw = json('deal-once.blocks.json') as Record<string, number>;
  return new Map(Object.entries(raw).map(([b, s]) => [b, s * 1000]));
}

/** The run-once deal with each step's gas set to the measured values of T-066's Context (1,261,428 in all). */
export function measuredStepEvents(): Event[] {
  // appeal.expired is not in phase one: the run-once deal ran on the 0.7 deployment, whose appeal window closed it.
  const gas: Record<string, string> = { 'hold.funded': '840697', 'fee.operator': '840697', 'delivery.submitted': '173131', 'judgment.decided': '166808', 'settlement.released': '166808', 'key.released': '166808', 'appeal.expired': '80792' };
  return onceEvents().map((e) => (typeof e.payload.gasUsed === 'string' ? { ...e, payload: { ...e.payload, gasUsed: gas[e.type] } } : e));
}

/** A run file in the shape tools/one-click/metrics.mjs writes (slice 1), with run "once"'s numbers. */
export function sampleRun(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'crow.metrics.one-click/1',
    generatedAt: '2026-11-05T15:00:00Z',
    generator: { script: 'tools/one-click/run.mjs', commit: COMMIT },
    sources: [],
    gaps: [],
    runId: '2026-11-05T13-35-12Z-buyer',
    scenario: 'buyer',
    harness: { sdkVersion: '0.3.318', claudeCodeVersion: '2.1.318', maxReplies: 6, timeoutMs: 600000 },
    prompt: { text: "Run a test deal with Crow's test environment, following https://escrow.stream/llms.txt", source: 'https://escrow.stream/ #prompt', matchesExpected: true },
    model: { requested: 'claude-opus-5-5', init: 'claude-opus-5-5', effortRequested: 'medium', effortApplied: 'medium', effortSource: 'hook' },
    outcome: { state: 'Released', commitmentId: '0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93', txs: [], releasedAtMs: 63000 },
    approvals: { total: 4, toolPermission: 4, conversational: 0, byTool: { Bash: 4 }, requests: [{ atMs: 5000, tool: 'Bash', summary: 'curl -s https://escrow.stream/llms.txt' }] },
    tokens: { byModel: { 'claude-opus-5-5': { input: 12, cacheWrite5m: 0, cacheWrite1h: 13201, cacheRead: 125536, output: 2331, thinking: 387 } }, sdkUsage: { input_tokens: 12 }, numTurns: 6 },
    cost: { atOpus55: { usdMicros: '182499', byModel: { 'claude-opus-5-5': '177383', 'claude-haiku-5-5': '5116' }, priceTable: { file: 'config/model-prices.json', model: 'claude-opus-5-5', source: 'https://platform.claude.com/docs/en/about-claude/pricing', readOn: '2026-11-05' } }, sdk: { totalCostUsd: '0.1775111', byModel: { 'claude-opus-5-5': '0.1773832' } }, deltaBps: 281 },
    time: { wallMs: 104755, modelMs: 36001, toolMs: 64000, approvalWaitMs: 3, otherMs: 4751, sdkDurationMs: 104755 },
    cloudflare: null,
    errors: [],
    timedOut: false,
    ...overrides,
  };
}

/** Tail counts for a run file's `cloudflare`, in the shape the one-click schema allows. */
export const TAIL = {
  basis: 'tail',
  window: { from: '2026-11-05T13:35:12Z', to: '2026-11-05T13:37:00Z' },
  otherDealsInWindow: 0,
  workers: {
    'holdback-op1': { requests: 40, cpuMs: 120, wallMs: 3000, durableObjectRequests: 30, durableObjectWallMs: 8000 },
    'crow-test-agents': { requests: 10, cpuMs: 30, wallMs: 500, durableObjectRequests: 0, durableObjectWallMs: null },
  },
};

/** holdback-op1's tail counts without `requests`: a malformed worker that must never price as 0 requests. */
export const NO_REQUESTS = Object.fromEntries(Object.entries(TAIL.workers['holdback-op1']).filter(([k]) => k !== 'requests'));

/** A copy of an event list as another deal: a new commitment id and every time moved by `shiftMs`. */
export function asDeal(events: Event[], n: number, shiftMs: number, overrides: Partial<Record<string, number>> = {}): Event[] {
  const id = `0x${n.toString(16).padStart(64, '0')}`;
  return events.map((e) => {
    const extra = overrides[e.type] ?? 0;
    return { ...e, seq: e.seq + n * 100, commitmentId: id, at: new Date(Date.parse(e.at) + shiftMs + extra).toISOString().replace(/\.\d{3}Z$/, 'Z'), payload: { ...e.payload } };
  });
}
