// T-066: every metrics file and both price tables validate against their schemas (Ajv 2020-12, strict), and the
// schemas refuse what the data format forbids: floats for money, an unknown basis, a local path as a source.
import { describe, expect, it } from 'vitest';
import { check, loadSchemas } from '../../scripts/metrics/check.mjs';
import { buildDealTiming } from '../../scripts/metrics/deal-timing.mjs';
import { envelope } from '../../scripts/metrics/lib.mjs';
import { buildOpsCost } from '../../scripts/metrics/ops-cost.mjs';
import { buildThroughput } from '../../scripts/metrics/throughput.mjs';
import { LANE, NOW, config, json, onceBlocks, onceEvents } from './helpers';

const schemas = loadSchemas();
const COMMIT = '7639613453bc367ed3ac0122cdb38e4e4553765d';
const SOURCES = [{ id: 'events', url: 'https://api.escrow.stream/v1/events?from=0', readAt: '2026-11-05T15:00:00Z', ok: true, ms: 68, error: null }];
const wrap = (name: string, body: { gaps: string[] } & Record<string, unknown>) => {
  const { gaps, ...rest } = body;
  return { ...envelope(name, { script: `scripts/metrics/${name}.mjs`, commit: COMMIT, generatedAt: NOW, sources: SOURCES, gaps }), ...rest };
};
const expectValid = (name: string, value: unknown) => expect(check(name, value, schemas)).toEqual({ ok: true, errors: [] });

const dealTiming = { ...wrap('deal-timing', buildDealTiming({ events: onceEvents(), blockTimes: onceBlocks(), crow: new Set([LANE]), nowMs: NOW })), eventLog: { node: 'https://api.escrow.stream', from: 0, head: 181, events: 11, complete: true } };
const code = { dealLanes: 3, mintsPerDay: 600, commit: COMMIT };
const throughput = wrap('throughput', buildThroughput({ discovery: json('discovery.json'), agent: json('test-seller-agent.json'), dealTiming, blockTimesMs: [0, 12_000, 24_000], code, nowMs: NOW }));
const opsCost = wrap('ops-cost', buildOpsCost({ dealTiming, prices: config('ops-cost-prices.json'), modelPrices: config('model-prices.json'), discovery: json('discovery.json'), faucetMintGas: ['140171'], effectiveGasPrices: ['999999999'], balances: [{ address: LANE, role: 'deal lane', wei: '12777644593723979' }] }));

/** A run file in the shape tools/one-click/metrics.mjs writes (slice 1), with run "once"'s numbers. */
const oneClick = {
  ...envelope('one-click', { script: 'tools/one-click/run.mjs', commit: COMMIT, generatedAt: NOW, sources: [], gaps: [] }),
  runId: '2026-11-05T13-35-12Z-buyer',
  scenario: 'buyer',
  harness: { sdkVersion: '0.3.318', claudeCodeVersion: '2.1.318', maxReplies: 6, timeoutMs: 600000 },
  prompt: { text: "Run a test deal with Crow's test environment, following https://escrow.stream/llms.txt", source: 'https://escrow.stream/ #prompt', matchesExpected: true },
  model: { requested: 'claude-opus-5-5', init: 'claude-opus-5-5', effortRequested: 'medium', effortApplied: 'medium', effortSource: 'hook' },
  outcome: { state: 'Released', commitmentId: '0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93', txs: [], releasedAtMs: 63000 },
  approvals: { total: 4, toolPermission: 4, conversational: 0, byTool: { Bash: 4 }, requests: [{ atMs: 5000, tool: 'Bash', summary: 'curl -s https://escrow.stream/llms.txt' }] },
  tokens: { byModel: { 'claude-opus-5-5': { input: 12, cacheWrite5m: 0, cacheWrite1h: 13201, cacheRead: 125536, output: 2331, thinking: 387 } }, sdkUsage: { input_tokens: 12 }, numTurns: 6 },
  cost: { atOpus55: { usdMicros: '182499', priceTable: { file: 'config/model-prices.json', model: 'claude-opus-5-5', source: 'https://platform.claude.com/docs/en/about-claude/pricing', readOn: '2026-11-05' } }, sdk: { totalCostUsd: '0.1775111', byModel: { 'claude-opus-5-5': '0.1773832' } }, deltaBps: 280 },
  time: { wallMs: 104755, modelMs: 36001, toolMs: 64000, approvalWaitMs: 3, otherMs: 4751, sdkDurationMs: 104755 },
  cloudflare: null,
  errors: [],
  timedOut: false,
};

describe('metrics schemas', () => {
  it('loads every schema under Ajv strict', () => {
    expect(schemas.names.sort()).toEqual(['deal-timing', 'model-prices', 'one-click', 'ops-cost', 'ops-cost-prices', 'throughput']);
  });

  it('accepts what the scripts write', () => {
    expectValid('deal-timing', dealTiming);
    expectValid('throughput', throughput);
    expectValid('ops-cost', opsCost);
    expectValid('one-click', oneClick);
  });

  it('accepts both price tables as tracked', () => {
    expectValid('model-prices', config('model-prices.json'));
    expectValid('ops-cost-prices', config('ops-cost-prices.json'));
  });

  it('refuses a float where money goes', () => {
    const bad = structuredClone(opsCost) as { perDeal: { gas: { usdMicros: { ethereum: unknown } } } };
    bad.perDeal.gas.usdMicros.ethereum = 3.78;
    expect(check('ops-cost', bad, schemas).ok).toBe(false);
    const alsoBad = structuredClone(opsCost) as { perDeal: { gas: { usdMicros: { ethereum: unknown } } } };
    alsoBad.perDeal.gas.usdMicros.ethereum = '3.78';
    expect(check('ops-cost', alsoBad, schemas).ok).toBe(false);
  });

  it('refuses a price that is not an integer', () => {
    const prices = config('model-prices.json');
    prices.models['claude-opus-5-5'].cacheRead = 0.2;
    expect(check('model-prices', prices, schemas).ok).toBe(false);
  });

  it('refuses an unknown basis, an unknown field and a local path as a source', () => {
    const t = structuredClone(throughput) as { capacity: { limits: { basis: string }[] } };
    t.capacity.limits[0].basis = 'vibes';
    expect(check('throughput', t, schemas).ok).toBe(false);
    expect(check('deal-timing', { ...dealTiming, extra: 1 }, schemas).ok).toBe(false);
    expect(check('deal-timing', { ...dealTiming, sources: [{ ...SOURCES[0], url: '/Users/someone/file.json' }] }, schemas).ok).toBe(false);
  });

  it('refuses a run file whose effort is not a level', () => {
    expect(check('one-click', { ...oneClick, model: { ...oneClick.model, effortApplied: 'turbo' } }, schemas).ok).toBe(false);
  });
});
