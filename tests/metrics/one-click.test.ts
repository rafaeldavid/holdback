// T-066 slice 1: tools/one-click/metrics.mjs on fixtures cut from the two harness runs of 2026-11-05 (T-066 Context):
// the SDK's init and result messages, without the assistant's text, and the harness's bookkeeping. No network, and the
// Agent SDK is not installed in CI: metrics.mjs imports none of it.
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { buildRunFile, decimalToMicros, runIdOf, scrub, tokensOf, unionMs } from '../../tools/one-click/metrics.mjs';
import { config, json } from './helpers';

const prices = config('model-prices.json');
const COMMIT = '7639613453bc367ed3ac0122cdb38e4e4553765d';
const STARTED = Date.parse('2026-11-05T13:35:12Z');
const options = { scenario: 'buyer', model: 'claude-opus-5-5', effort: 'medium', maxReplies: 6, timeoutMs: 600_000 };

function build(name: string, effortApplied: string | null = 'medium') {
  const f = json(name);
  return buildRunFile({ init: f.init, result: f.result, book: { ...f.book, effortApplied }, options, prices, startedAtMs: STARTED, generatedAtMs: STARTED + 120_000, commit: COMMIT, sdkVersion: '0.3.318' });
}

describe('the run file, run "once"', () => {
  const run = build('one-click-once.json');

  it('counts 4 approvals, all tool permissions for Bash', () => {
    expect(run.approvals).toMatchObject({ total: 4, toolPermission: 4, conversational: 0, byTool: { Bash: 4 } });
    expect(run.approvals.requests.map((r: { atMs: number }) => r.atMs)).toEqual([5500, 16000, 19800, 24500]);
    expect(run.approvals.requests[0].summary).toBe('curl -sS https://escrow.stream/llms.txt');
  });

  it('keeps the token fields of T-066 Context', () => {
    expect(run.tokens.byModel['claude-opus-5-5']).toEqual({ input: 12, cacheWrite5m: 0, cacheWrite1h: 13_201, cacheRead: 125_536, output: 2_331, thinking: 387 });
    expect(run.tokens.byModel['claude-haiku-5-5']).toEqual({ input: 1_194, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 17, thinking: 0 });
    expect(run.tokens.numTurns).toBe(6);
    expect(run.tokens.sdkUsage.cache_creation).toEqual({ ephemeral_1h_input_tokens: 13_201, ephemeral_5m_input_tokens: 0 });
  });

  it('prices every token at Opus 5.5 by hand', () => {
    // Opus: 12 × 4 + 13,201 × 8 + 125,536 × 0.20 + 2,331 × 20 = 177,383.2 µUSD.
    // Haiku at Opus prices: 1,194 × 4 + 17 × 20 = 5,116 µUSD. In all 182,499.2, rounded once to 182,499.
    expect(run.cost.atOpus55).toMatchObject({ usdMicros: '182499', byModel: { 'claude-opus-5-5': '177383', 'claude-haiku-5-5': '5116' } });
    expect(run.cost.atOpus55.priceTable).toEqual({ file: 'config/model-prices.json', model: 'claude-opus-5-5', source: 'https://platform.claude.com/docs/en/about-claude/pricing', readOn: '2026-11-05' });
  });

  it("reproduces the SDK's Opus 5.5 costUSD of 0.1773832 within 1% (the acceptance check)", () => {
    expect(run.cost.sdk).toEqual({ totalCostUsd: '0.17751109999999998', byModel: { 'claude-haiku-5-5': '0.0001279', 'claude-opus-5-5': '0.17738319999999996' } });
    const ours = BigInt(run.cost.atOpus55.byModel['claude-opus-5-5']);
    const sdk = decimalToMicros(run.cost.sdk.byModel['claude-opus-5-5']) as bigint;
    expect(sdk).toBe(177_383n);
    expect(ours - sdk).toBe(0n);
    // The whole run reads 2.81% above the SDK's total: the Haiku side call priced at Opus rates.
    expect(run.cost.deltaBps).toBe(281);
  });

  it('splits the wall time into model, tool, approval wait and the rest', () => {
    // Tool spans: 1.0 + 0 + 0.3 + 0.1 + 68.3 s = 69.7 s; the rest: 106 − 36.001 − 69.7 = 0.299 s.
    expect(run.time).toEqual({ wallMs: 106_000, modelMs: 36_001, toolMs: 69_700, approvalWaitMs: 0, otherMs: 299, sdkDurationMs: 104_755 });
  });

  it('records the outcome and the effort a hook reported', () => {
    expect(run.runId).toBe('2026-11-05T13-35-12Z-buyer');
    expect(run.outcome).toMatchObject({ state: 'Released', commitmentId: '0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93', releasedAtMs: 92_800 });
    expect(run.outcome.txs).toHaveLength(3);
    expect(run.model).toEqual({ requested: 'claude-opus-5-5', init: 'claude-opus-5-5', effortRequested: 'medium', effortApplied: 'medium', effortSource: 'hook' });
    expect(run.harness).toEqual({ sdkVersion: '0.3.318', claudeCodeVersion: '2.1.318', maxReplies: 6, timeoutMs: 600_000 });
  });

  it('validates against its schema', () => {
    expect(check('one-click', run)).toEqual({ ok: true, errors: [] });
  });
});

describe('the run file, run "always"', () => {
  const run = build('one-click-always.json');

  it('counts 4 approvals and prices Opus 5.5 at the SDK figure', () => {
    expect(run.approvals.total).toBe(4);
    expect(run.tokens.byModel['claude-opus-5-5']).toEqual({ input: 12, cacheWrite5m: 0, cacheWrite1h: 15_403, cacheRead: 131_507, output: 2_238, thinking: 477 });
    // 12 × 4 + 15,403 × 8 + 131,507 × 0.20 + 2,238 × 20 = 194,333.4 µUSD; the SDK says 0.1944613 − 0.0001279 = 0.1943334.
    expect(run.cost.atOpus55.byModel['claude-opus-5-5']).toBe('194333');
    expect(run.cost.atOpus55.usdMicros).toBe('199449');
    expect(check('one-click', run).ok).toBe(true);
  });
});

describe('what the run file refuses to claim', () => {
  it('marks the effort unknown when no hook reported it', () => {
    const run = build('one-click-once.json', null);
    expect(run.model).toMatchObject({ effortApplied: null, effortSource: 'none' });
    expect(run.gaps.some((g: string) => /marks this run invalid/.test(g))).toBe(true);
    expect(check('one-click', run).ok).toBe(true);
  });

  it('reads the cost at Opus 5.5 as unknown with no price table', () => {
    const f = json('one-click-once.json');
    const run = buildRunFile({ init: f.init, result: f.result, book: f.book, options, prices: null, startedAtMs: STARTED, generatedAtMs: STARTED, commit: COMMIT, sdkVersion: '0.3.318' });
    expect(run.cost.atOpus55.usdMicros).toBe(null);
    expect(run.cost.deltaBps).toBe(null);
  });

  it('shows a run that stopped short as stopped', () => {
    const f = json('one-click-once.json');
    const run = buildRunFile({ init: f.init, result: f.result, book: { ...f.book, finalState: null, commitmentId: null }, options, prices, startedAtMs: STARTED, generatedAtMs: STARTED, commit: COMMIT, sdkVersion: '0.3.318' });
    expect(run.outcome.state).toBe('stopped');
  });
});

describe('helpers', () => {
  it('turns the SDK dollar strings into micro-dollars exactly', () => {
    expect(decimalToMicros('0.17751109999999998')).toBe(177_511n);
    expect(decimalToMicros('1e-7')).toBe(0n);
    expect(decimalToMicros('5e-7')).toBe(1n);
    expect(decimalToMicros('12')).toBe(12_000_000n);
    expect(decimalToMicros('NaN')).toBe(null);
  });

  it('counts an unsplit cache write as a 5-minute write', () => {
    expect(tokensOf({ inputTokens: 1, cacheCreationInputTokens: 10, cacheCreationEphemeral1hInputTokens: 4, outputTokens: 2 })).toMatchObject({ cacheWrite5m: 6, cacheWrite1h: 4 });
  });

  it('counts overlapping tool spans once', () => {
    expect(unionMs([{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 15 }, { startMs: 20, endMs: 25 }])).toBe(20);
  });

  it('keeps no local path, control character or long secret-like run in a summary', () => {
    expect(scrub('cat /Users/someone/.claude/x.txt | head')).toBe('cat <local path> | head');
    expect(scrub('echo sk-ant-abcdefghijkl')).toBe('echo <redacted>');
    expect(scrub(`a${String.fromCodePoint(0x7)}b${String.fromCodePoint(0x202e)}c`)).toBe('a b c');
    expect(scrub('x'.repeat(500))).toBe('<redacted>');
    expect(scrub('ab '.repeat(500))).toHaveLength(300);
  });

  it('names a run by its start and scenario', () => {
    expect(runIdOf(Date.parse('2026-11-05T13:35:12.345Z'), 'seller')).toBe('2026-11-05T13-35-12Z-seller');
  });
});
