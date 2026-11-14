// T-412: fixed records for the benchmark's tests (one-click-bench.test.ts, one-click-summary.test.ts).
import { buildBenchRecord } from '../../tools/one-click/bench-record.mjs';
import { SCENARIOS } from '../../tools/one-click/scenarios.mjs';
import { COMMIT, config } from './helpers';

const prices = config('model-prices.json');
const STARTED = Date.parse('2026-11-14T10:00:00Z');

// A live record built from fixed bookkeeping, as bench.mjs builds one after a live run.
const USAGE = { inputTokens: 1_000, outputTokens: 2_000, cacheReadInputTokens: 100_000, cacheCreationInputTokens: 10_000, cacheCreationEphemeral1hInputTokens: 10_000, costUSD: 0.1 };
export function liveRecord(o: { texts?: string[]; errors?: string[]; success?: boolean; approvals?: number; wallMs?: number; usage?: object; id?: string; startedAtMs?: number } = {}) {
  const id = o.id ?? 's1';
  const s = { id, ...SCENARIOS[id as keyof typeof SCENARIOS] };
  return buildBenchRecord({
    mode: 'live',
    scenario: s,
    world: { engine: 'sepolia', docs: 'https://crow.direct/llms.txt' },
    agent: { requested: 'claude-opus-5-5', reported: 'claude-opus-5-5', effortRequested: 'medium', effortApplied: 'medium', claudeCodeVersion: '2.1.318', sdkVersion: '0.3.318' },
    outcome: o.success === false ? { state: 'stopped', commitmentId: null, stoppedAt: 'no commitment reached its end state' } : { state: s.endState, commitmentId: `0x${'ab'.repeat(32)}` },
    book: { permissionRequests: Array.from({ length: o.approvals ?? 3 }, (_, i) => ({ atMs: i * 1000, tool: 'Bash' })), wallMs: o.wallMs ?? 300_000, approvalWaitMs: 2_000, errors: o.errors ?? [] },
    results: [{ modelUsage: { 'claude-opus-5-5': o.usage ?? USAGE }, duration_api_ms: 60_000 }],
    calls: [{ via: 'curl', method: 'GET', origin: 'https://crow.direct', path: '/llms.txt', status: 200 }],
    texts: o.texts ?? [],
    prices,
    startedAtMs: o.startedAtMs ?? STARTED,
    generatedAtMs: (o.startedAtMs ?? STARTED) + 400_000,
    commit: COMMIT,
  });
}
