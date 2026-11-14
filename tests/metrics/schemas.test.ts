// T-066: every metrics file and both price tables validate against their schemas (Ajv 2020-12, strict), and the
// schemas refuse what the data format forbids: floats for money, an unknown basis, a local path as a source.
import { describe, expect, it } from 'vitest';
import { check, loadSchemas } from '../../scripts/metrics/check.mjs';
import { buildDealTiming } from '../../scripts/metrics/deal-timing.mjs';
import { envelope } from '../../scripts/metrics/lib.mjs';
import { buildOpsCost } from '../../scripts/metrics/ops-cost.mjs';
import { buildThroughput } from '../../scripts/metrics/throughput.mjs';
import { COMMIT, EVENT_LOG, LANE, NOW, NO_REQUESTS, TAIL, config, json, onceBlocks, onceEvents, sampleRun } from './helpers';

const schemas = loadSchemas();
const SOURCES = [{ id: 'events', url: 'https://api.crow.direct/v1/events?from=0', readAt: '2026-11-05T15:00:00Z', ok: true, ms: 68, error: null }];
const wrap = (name: string, body: { gaps: string[] } & Record<string, unknown>) => {
  const { gaps, ...rest } = body;
  return { ...envelope(name, { script: `scripts/metrics/${name}.mjs`, commit: COMMIT, generatedAt: NOW, sources: SOURCES, gaps }), ...rest };
};
const expectValid = (name: string, value: unknown) => expect(check(name, value, schemas)).toEqual({ ok: true, errors: [] });

const dealTiming = { ...wrap('deal-timing', buildDealTiming({ events: onceEvents(), blockTimes: onceBlocks(), crow: new Set([LANE]), nowMs: NOW })), eventLog: EVENT_LOG };
const code = { dealLanes: 3, mintsPerDay: 600, commit: COMMIT };
const throughput = wrap('throughput', buildThroughput({ discovery: json('discovery.json'), agent: json('test-seller-agent.json'), dealTiming, blockTimesMs: [0, 12_000, 24_000], code, nowMs: NOW }));
const opsCost = wrap('ops-cost', buildOpsCost({ dealTiming, prices: config('ops-cost-prices.json'), modelPrices: config('model-prices.json'), discovery: json('discovery.json'), faucetMintGas: ['140171'], effectiveGasPrices: ['999999999'], balances: [{ address: LANE, role: 'deal lane', wei: '12777644593723979' }] }));

const oneClick = sampleRun();

/** The files as they read when no operator served its event log and discovery could not be read. */
const noLog = { ...wrap('deal-timing', buildDealTiming({ events: null, blockTimes: new Map(), crow: new Set([LANE]), nowMs: NOW })), eventLog: null };
const noLogThroughput = wrap('throughput', buildThroughput({ discovery: json('discovery.json'), agent: json('test-seller-agent.json'), dealTiming: noLog, blockTimesMs: [0, 12_000, 24_000], code, nowMs: NOW }));
const noDiscoveryOpsCost = wrap('ops-cost', buildOpsCost({ dealTiming, prices: config('ops-cost-prices.json'), modelPrices: config('model-prices.json'), discovery: null }));

/** The path of every leaf that reads 0 or "0". */
function zeroPaths(value: unknown, path: string[] = []): string[] {
  if (value === 0 || value === '0') return [path.join('.')];
  if (Array.isArray(value)) return value.flatMap((v, i) => zeroPaths(v, [...path, String(i)]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => zeroPaths(v, [...path, k]));
  return [];
}

// A missing source reads unknown (null), never 0 (T-066 brief; PR 215's review found five places that broke it). With
// every source missing, a 0 may appear only where it is a constant or counts the samples behind a null median.
describe('a missing source never reads 0', () => {
  it('deal-timing.json with no event log', () => {
    expect(zeroPaths(buildDealTiming({ events: null, blockTimes: new Map(), crow: new Set(), nowMs: NOW }))).toEqual([]);
  });

  it('throughput.json with no source at all', () => {
    const out = buildThroughput({ discovery: null, agent: null, dealTiming: null, blockTimesMs: [], code: { dealLanes: null, mintsPerDay: null, commit: 'unknown' }, nowMs: NOW });
    // blocks: the block times behind blockTimeMs's null median.
    expect(zeroPaths(out)).toEqual(['config.blockTimeMs.blocks']);
  });

  it('ops-cost.json with no source at all', () => {
    const out = buildOpsCost({ dealTiming: null, prices: null, modelPrices: null, discovery: null });
    expect(zeroPaths(out)).toEqual([
      'perDeal.gas.faucetMintNewVisitor.mints', // the mints behind a null median
      'perDeal.judges.checksOnly.usdMicros', // a constant: a checks-only deal has no panel
      'perDeal.rpc.usdMicros', // a constant: keyless public endpoints
      'perDeal.operatorFee.deals', // the fees behind a null amount
      'runway.effectiveGasPriceWei.txs', // the receipts behind a null median
    ]);
  });
});

describe('metrics schemas', () => {
  it('loads every schema under Ajv strict', () => {
    expect(schemas.names.sort()).toEqual(['deal-timing', 'model-prices', 'one-click', 'one-click-summary', 'ops-cost', 'ops-cost-prices', 'throughput']);
  });

  it('accepts what the scripts write', () => {
    expectValid('deal-timing', dealTiming);
    expectValid('throughput', throughput);
    expectValid('ops-cost', opsCost);
    expectValid('one-click', oneClick);
    expectValid('one-click', sampleRun({ cloudflare: TAIL }));
  });

  it('accepts null counts and an unknown Cloudflare margin, which the scripts write when a source is missing', () => {
    expectValid('deal-timing', noLog);
    expectValid('throughput', noLogThroughput);
    expectValid('ops-cost', noDiscoveryOpsCost);
    expect(noDiscoveryOpsCost.perDeal.cloudflare.usdMicrosAtMargin).toBe(null);
    expect(noDiscoveryOpsCost.perDeal.total.checksOnly.excludes).toContain('adjudicator setup');
  });

  it("refuses a run file whose worker has no request count, so it never prices as 0", () => {
    const bad = sampleRun({ cloudflare: { ...TAIL, workers: { 'holdback-op1': NO_REQUESTS } } });
    expect(check('one-click', bad, schemas).ok).toBe(false);
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
