// T-412: the benchmark's headline numbers (scripts/metrics/one-click-summary.mjs). Only live records that reached their
// end state fill a number; a scripted record never does, and with no live deal every number reads missing, never 0.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { buildSummary, readRecords } from '../../scripts/metrics/one-click-summary.mjs';
import { buildBenchRecord } from '../../tools/one-click/bench-record.mjs';
import { SCENARIOS } from '../../tools/one-click/scenarios.mjs';
import { liveRecord } from './one-click-records';
import { COMMIT, NOW, config, sampleRun } from './helpers';

const prices = config('model-prices.json');
const at = (n: number) => Date.parse('2026-11-14T10:00:00Z') + n * 60_000;

/** A scripted record with big numbers, so a leak into a headline would show. */
function scripted(id: string, n: number) {
  const s = { id, ...SCENARIOS[id as keyof typeof SCENARIOS] };
  return buildBenchRecord({
    mode: 'scripted', scenario: s, world: { engine: 'local', docs: 'in-process' }, agent: { script: 'examples/try.ts' },
    outcome: { state: s.endState, commitmentId: `0x${'ef'.repeat(32)}` },
    book: { permissionRequests: Array.from({ length: 50 }, () => ({ tool: 'Bash' })), wallMs: 9_999_999 },
    results: [{ modelUsage: { 'claude-opus-5-5': { inputTokens: 9_000_000, outputTokens: 9_000_000 } } }],
    prices, startedAtMs: at(n), generatedAtMs: at(n) + 1000, commit: COMMIT,
  });
}

describe('the summary', () => {
  it('reads missing everywhere with scripted records only, and validates', () => {
    const s = buildSummary({ records: [scripted('s1', 1), scripted('s4', 2)], generatedAtMs: NOW, commit: COMMIT });
    expect(s.headline).toEqual({
      approvalsPerDeal: { state: 'missing', value: null, deals: 0 },
      tokensPerDeal: { state: 'missing', in: null, uncachedIn: null, out: null, total: null, deals: 0 },
      timeWithoutUserMs: { state: 'missing', value: null, deals: 0 },
      costPerDealUsdMicros: { state: 'missing', value: null, deals: 0 },
    });
    expect(s.gaps[0]).toMatch(/^No live record yet/);
    expect(s.byScenario.s1.latestScripted).toMatchObject({ state: 'Released', success: true });
    expect(check('one-click-summary', s)).toEqual({ ok: true, errors: [] });
  });

  it('takes medians from live completed deals only: a failed live run and a scripted run change nothing', () => {
    const records = [
      liveRecord({ id: 's1', approvals: 2, wallMs: 100_000, startedAtMs: at(1) }),
      liveRecord({ id: 's3', approvals: 4, wallMs: 300_000, startedAtMs: at(2) }),
      liveRecord({ id: 's4', approvals: 3, wallMs: 200_000, startedAtMs: at(3) }),
      liveRecord({ id: 's6', approvals: 40, wallMs: 900_000, success: false, startedAtMs: at(4) }),
      scripted('s1', 5),
    ];
    const s = buildSummary({ records, generatedAtMs: NOW, commit: COMMIT });
    // Approvals 2, 3, 4: median 3. Time without the user: 98,000, 198,000, 298,000 ms (2,000 ms approval wait each).
    expect(s.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 3, deals: 3 });
    expect(s.headline.timeWithoutUserMs).toEqual({ state: 'measured', value: 198_000, deals: 3 });
    expect(s.headline.tokensPerDeal).toEqual({ state: 'measured', in: 111_000, uncachedIn: 1_000, out: 2_000, total: 113_000, deals: 3 });
    expect(s.headline.costPerDealUsdMicros).toEqual({ state: 'measured', value: '144000', deals: 3 });
    expect(s.runs).toEqual({ records: 5, live: 4, scripted: 1, liveCompleted: 3, invalid: 0, versionOne: 0 });
    expect(s.byScenario.s6).toMatchObject({ live: 1, liveCompleted: 0, latestLive: { state: 'stopped', success: false } });
    expect(check('one-click-summary', s)).toEqual({ ok: true, errors: [] });
  });

  it('reads a folder: counts a file that fails its schema and a version 1 run, and leaves both out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-summary-'));
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify(liveRecord({ startedAtMs: at(1) })));
      writeFileSync(join(dir, 'b.json'), JSON.stringify({ ...liveRecord({ startedAtMs: at(2) }), mode: 'guess' }));
      writeFileSync(join(dir, 'c.json'), '{not json');
      writeFileSync(join(dir, 'd.json'), JSON.stringify(sampleRun()));
      const read = readRecords([dir]);
      expect(read.records).toHaveLength(1);
      expect(read.invalid.sort()).toEqual(['b.json', 'c.json']);
      expect(read.v1).toBe(1);
      const s = buildSummary({ ...read, generatedAtMs: NOW, commit: COMMIT });
      expect(s.runs).toMatchObject({ records: 1, invalid: 2, versionOne: 1 });
      expect(s.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 3, deals: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
