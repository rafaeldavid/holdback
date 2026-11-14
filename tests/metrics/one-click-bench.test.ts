// T-412: the benchmark harness (tools/one-click/bench.mjs). The scripted runs play each of the six outsider scenarios
// in the public demo's own world in a child process, against Crow's test seller and test buyer, with no key and no
// network beyond 127.0.0.1: a scenario that stops completing fails here. The live mode is tested only for what it does
// before it sends anything: the key check, and that the key never reaches what the harness prints or writes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { readsEnv } from '../../tools/one-click/bench-live.mjs';
import { apiCallsOf, costOf, docGapsOf, priceFor, scrubSecrets, tokensByModel } from '../../tools/one-click/bench-record.mjs';
import { SCENARIOS, SCENARIO_IDS } from '../../tools/one-click/scenarios.mjs';
import { ROOT, config } from './helpers';
import { liveRecord } from './one-click-records';

const prices = config('model-prices.json');
const BENCH = join(ROOT, 'tools/one-click/bench.mjs');
const KEY_VAR = 'HOLDBACK_AGENT_ANTHROPIC_API_KEY';
// Not shaped like an Anthropic key, so metrics.mjs's scrub() (which drops sk-… runs) does not hide it and the test shows scrubSecrets() at work.
const SENTINEL = 'crow-T412-sentinel-not-a-key-0123456789';
const envWithout = (extra: Record<string, string> = {}) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string' && k !== KEY_VAR) env[k] = v;
  return { ...env, ...extra };
};

describe('the scripted runs, one per scenario', () => {
  const out = mkdtempSync(join(tmpdir(), 'crow-bench-test-'));
  let run: { status: number | null; stderr: string };
  const records: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(() => {
    run = spawnSync(process.execPath, [BENCH, '--scenario', 'all', '--out', out], { encoding: 'utf8', env: envWithout(), timeout: 240_000 });
    for (const f of readdirSync(out)) {
      const r = JSON.parse(readFileSync(join(out, f), 'utf8'));
      records[r.scenario?.id ?? f] = r;
    }
  }, 250_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('writes one valid record per scenario and exits 0', () => {
    expect(run.status, run.stderr).toBe(0);
    expect(readdirSync(out).filter((f) => f.endsWith('.invalid'))).toEqual([]);
    expect(Object.keys(records).sort()).toEqual(SCENARIO_IDS);
    for (const id of SCENARIO_IDS) expect(check('one-click', records[id]), id).toEqual({ ok: true, errors: [] });
  });

  const runnable = SCENARIO_IDS.filter((id) => !('blockedBy' in SCENARIOS[id as keyof typeof SCENARIOS].scripted));
  it('runs s1, s3, s4 and s6 today, and records s2 and s5 as blocked', () => {
    expect(runnable).toEqual(['s1', 's3', 's4', 's6']);
  });

  it.each(runnable)('%s reaches its end state against the Crow test agent it names', (id) => {
    const r = records[id];
    const s = SCENARIOS[id as keyof typeof SCENARIOS];
    expect(r.outcome, run.stderr).toMatchObject({ success: true, state: s.endState, blockedBy: null, stoppedAt: null });
    expect(r.outcome.commitmentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r).toMatchObject({ mode: 'scripted', world: { engine: 'local' }, agent: { kind: 'scripted' }, scenario: { id, party: s.party } });
    // Every call went to the in-process world or the test agent, and was counted.
    expect(r.apiCalls.total).toBeGreaterThan(5);
    expect(r.apiCalls.crow).toBe(r.apiCalls.total);
    expect(Object.keys(r.apiCalls.byHost).every((h) => /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(h))).toBe(true);
    expect(r.errors).toEqual([]);
    // No model and no person: no tokens, no cost, no approvals.
    expect(r.tokens).toEqual({ in: 0, out: 0, byModel: {} });
    expect(r.cost.usdMicros).toBe(null);
    expect(r.approvals.total).toBe(0);
    expect(r.time.wallMs).toBeGreaterThan(0);
  });

  it.each(['s2', 's5'])('%s writes a blocked record that names N70', (id) => {
    expect(records[id].outcome).toMatchObject({ success: false, state: 'blocked', commitmentId: null });
    expect(records[id].outcome.blockedBy).toMatch(/^N70: the test seller/);
    expect(records[id].apiCalls.total).toBe(0);
  });
});

describe('the live mode, before it sends anything', () => {
  it('refuses to start without the agent key, sends nothing and writes nothing', () => {
    const out = mkdtempSync(join(tmpdir(), 'crow-bench-live-'));
    try {
      const r = spawnSync(process.execPath, [BENCH, '--scenario', 's1', '--live', '--out', out], { encoding: 'utf8', env: envWithout() });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`needs ${KEY_VAR} in the environment`);
      expect(r.stderr).toContain('nothing was sent');
      expect(readdirSync(out)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('refuses an empty key the same way', () => {
    const r = spawnSync(process.execPath, [BENCH, '--scenario', 's1', '--live'], { encoding: 'utf8', env: envWithout({ [KEY_VAR]: '  ' }) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`needs ${KEY_VAR}`);
  });

  it('never prints the key, even when it refuses for another reason', () => {
    for (const argv of [['--scenario', 'all', '--live'], ['--scenario', 's1', '--live', '--model', 'Bad Model'], ['--scenario', 's1', '--live', '--effort', 'turbo']]) {
      const r = spawnSync(process.execPath, [BENCH, ...argv], { encoding: 'utf8', env: envWithout({ [KEY_VAR]: SENTINEL }) });
      expect(r.status, argv.join(' ')).toBe(2);
      expect(r.stdout + r.stderr).not.toContain(SENTINEL);
      expect(r.stdout + r.stderr).not.toContain(SENTINEL.slice(8));
    }
  });

  it('scrubs the key from a record wherever it appears, before the record is checked and written', () => {
    const record = liveRecord({ texts: [`GUESS: the key is ${SENTINEL}`], errors: [`query threw: 401 for ${SENTINEL}`] });
    const clean = scrubSecrets(record, [SENTINEL]);
    expect(JSON.stringify(record)).toContain(SENTINEL.slice(10)); // the unscrubbed record carries it, so the test bites
    expect(JSON.stringify(clean)).not.toContain(SENTINEL.slice(10));
    expect(check('one-click', clean)).toEqual({ ok: true, errors: [] });
  });

  it('denies a tool request that would read the environment', () => {
    expect(readsEnv('Bash', { command: 'node -e "console.log(process.env)"' })).toBe(true);
    expect(readsEnv('Bash', { command: 'echo $ANTHROPIC_API_KEY' })).toBe(true);
    expect(readsEnv('Bash', { command: 'cat /proc/self/environ' })).toBe(true);
    expect(readsEnv('Bash', { command: 'set' })).toBe(true);
    expect(readsEnv('Bash', { command: 'curl -sS https://crow.direct/llms.txt' })).toBe(false);
    expect(readsEnv('Bash', { command: 'node try.mjs --seller https://crow.direct/agents/test-seller' })).toBe(false);
  });
});


describe('the record, from fixed bookkeeping', () => {
  it('prices each model at its own entry, by hand', () => {
    // Opus 5.5: 1,000 × 4 + 10,000 × 8 (1 h writes) + 100,000 × 0.20 + 2,000 × 20 = 144,000 µUSD.
    const r = liveRecord();
    expect(r.cost).toEqual({ usdMicros: '144000', byModel: { 'claude-opus-5-5': '144000' }, priceTable: { file: 'config/model-prices.json', readOn: '2026-11-05' } });
    expect(r.tokens).toMatchObject({ in: 111_000, out: 2_000 });
  });

  it('prices a Haiku side call at Haiku prices, not Opus', () => {
    const byModel = tokensByModel([{ modelUsage: { 'claude-haiku-5-5': { inputTokens: 1_194, outputTokens: 17 } } }]);
    // 1,194 × 0.10 + 17 × 0.50 = 127.9, rounded once to 128 µUSD.
    expect(costOf(byModel, prices)).toEqual({ usdMicros: '128', byModel: { 'claude-haiku-5-5': '128' }, gaps: [] });
  });

  it('sums tokens over every result message', () => {
    const byModel = tokensByModel([{ modelUsage: { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 2 } } }, { modelUsage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 20 } } }]);
    expect(byModel['claude-opus-5-5']).toMatchObject({ input: 11, output: 22 });
  });

  it('leaves the cost null, with a gap, when a model has no price', () => {
    const c = costOf(tokensByModel([{ modelUsage: { 'some-other-model': { inputTokens: 5, outputTokens: 5 } } }]), prices);
    expect(c.usdMicros).toBe(null);
    expect(c.gaps[0]).toContain('no entry for some-other-model');
  });

  it('finds the price of a model ID the SDK reports with a suffix', () => {
    expect(priceFor(prices, 'claude-opus-5-5[1m]')?.key).toBe('claude-opus-5-5');
    expect(priceFor(prices, 'claude-opus-5-5')?.key).toBe('claude-opus-5-5');
    expect(priceFor(prices, 'claude-opus-5')).toBe(null);
  });

  it('counts API calls by host and status, leaves out model vendors and npm, and keeps no IDs in error paths', () => {
    const a = apiCallsOf([
      { method: 'GET', origin: 'https://crow.direct', path: '/llms.txt', status: 200 },
      { method: 'POST', origin: 'https://api.crow.direct', path: `/v1/commitments/0x${'cd'.repeat(32)}/fund`, status: 409 },
      { method: 'GET', origin: 'https://ethereum-sepolia-rpc.publicnode.com', path: '/', status: 200 },
      { method: 'POST', origin: 'https://api.anthropic.com', path: '/v1/messages', status: 200 },
      { method: 'GET', origin: 'https://registry.npmjs.org', path: '/viem', status: 200 },
    ]);
    expect(a).toEqual({
      total: 3,
      crow: 2,
      byHost: { 'https://crow.direct': 1, 'https://api.crow.direct': 1, 'https://ethereum-sepolia-rpc.publicnode.com': 1 },
      byStatus: { 200: 2, 409: 1 },
      errors: { '409 POST /v1/commitments/<id>/fund': 1 },
    });
  });

  it('takes each GUESS: line as a doc gap, scrubbed', () => {
    expect(docGapsOf(['Reading the docs.\nGUESS: the fee is added to the price (section 5 does not say)\n- GUESS: deliverBy counts from the offer'])).toEqual([
      { source: 'agent', text: 'the fee is added to the price (section 5 does not say)' },
      { source: 'agent', text: 'deliverBy counts from the offer' },
    ]);
  });

  it('marks a run that missed its end state as a failure, with where it stopped', () => {
    const r = liveRecord({ success: false });
    expect(r.outcome).toMatchObject({ success: false, state: 'stopped', stoppedAt: 'no commitment reached its end state' });
    expect(check('one-click', r)).toEqual({ ok: true, errors: [] });
  });

  it('splits wall time into the approval wait and the time without the user', () => {
    expect(liveRecord().time).toEqual({ wallMs: 300_000, approvalWaitMs: 2_000, withoutUserMs: 298_000, modelMs: 60_000 });
  });
});

describe('the schema, version 2 beside version 1', () => {
  const r = liveRecord();
  it('accepts a live record', () => expect(check('one-click', r)).toEqual({ ok: true, errors: [] }));
  it('refuses an unknown field, an unknown mode and a float for money', () => {
    expect(check('one-click', { ...r, extra: 1 }).ok).toBe(false);
    expect(check('one-click', { ...r, mode: 'simulated' }).ok).toBe(false);
    expect(check('one-click', { ...r, cost: { ...r.cost, usdMicros: 0.144 } }).ok).toBe(false);
  });
  it('refuses a version 2 record shaped as version 1, and a run ID outside the six scenarios', () => {
    expect(check('one-click', { ...r, runId: '2026-11-14T10-00-00Z-buyer' }).ok).toBe(false);
    expect(check('one-click', { ...r, scenario: { ...r.scenario, id: 's7' } }).ok).toBe(false);
  });
});
