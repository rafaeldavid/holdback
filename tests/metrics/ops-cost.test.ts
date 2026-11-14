// T-066: ops-cost.mjs on fixtures. Gas is the run-once deal with each step set to the measured values of T-066's
// Context (fund 840,697, deliver 173,131, decide 166,808, appeal expiry 80,792); prices are the operator fee's own
// fictional rates (1 gwei, USD 3,000 an ETH), so every figure below is computed by hand.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { check, loadSchemas } from '../../scripts/metrics/check.mjs';
import { buildDealTiming } from '../../scripts/metrics/deal-timing.mjs';
import { buildOpsCost, dealGas, loadRunCheck, newestTailRun, tokenToUsdMicros, tokensToUsdMicros } from '../../scripts/metrics/ops-cost.mjs';
import { EVENT_LOG, LANE, NOW, NO_REQUESTS, TAIL, config, json, measuredStepEvents, onceBlocks, sampleRun } from './helpers';

const dealTiming = buildDealTiming({ events: measuredStepEvents(), blockTimes: onceBlocks(), crow: new Set([LANE]), nowMs: NOW });
const prices = {
  ...config('ops-cost-prices.json'),
  asOf: '2026-11-05',
  usdMicrosPerEth: { value: '3000000000', source: 'test', readAt: '2026-11-05T00:00:00Z', basis: 'guessed' },
  gas: {
    ethereum: { gasPriceWei: '1000000000', source: 'test', readAt: '2026-11-05T00:00:00Z', basis: 'guessed' },
    base: { gasPriceWei: '10000000', l1Fee: { weiPerTx: '1000000000000', txBytes: 2400, method: 'test', source: 'test', readAt: '2026-11-05T00:00:00Z', basis: 'guessed' }, source: 'test', readAt: '2026-11-05T00:00:00Z', basis: 'guessed' },
  },
};
const modelPrices = config('model-prices.json');
const live = json('discovery.json');
const judges = { ...live.demo.judges, liveCallsToday: 3, tokensToday: { input: 2787, output: 561 } };
/** Discovery with no adjudicators, so no setup gas is spread over the one deal. */
const discovery = { ...live, demo: { ...live.demo, adjudicators: [], judges } };

describe('ops-cost gas', () => {
  it('sums the measured steps to 1,261,428 gas', () => {
    const g = dealGas(dealTiming.deals[0]);
    expect(g.total).toBe(1_261_428n);
    expect(Object.fromEntries(g.bySteps)).toEqual({ fund: 840_697n, deliver: 173_131n, decide: 166_808n, 'appeal expiry': 80_792n });
    expect(g.txs).toBe(4);
  });

  it('prices the deal and a new visitor\'s faucet mint by integer arithmetic', () => {
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery, faucetMintGas: ['130000'] });
    expect(out.perDeal.gas.dealGas.median).toBe('1261428');
    expect(out.perDeal.gas.bySteps.map((s: { step: string; gasUsed: { median: string } }) => [s.step, s.gasUsed.median])).toEqual([
      ['fund', '840697'], ['deliver', '173131'], ['decide', '166808'], ['appeal expiry', '80792'],
    ]);
    // 1,261,428 + 130,000 = 1,391,428 gas × 1 gwei × USD 3,000 = USD 4.174284.
    expect(out.perDeal.gas.totalGas.median).toBe('1391428');
    expect(out.perDeal.gas.usdMicros).toEqual({ sepolia: '0', ethereum: '4174284', base: '56743' });
    // Base: 1,391,428 gas × 0.01 gwei + 5 transactions × 10^12 wei of L1 fee = 1.891428 × 10^13 wei × 3,000 = 56,742.84 µUSD.
    expect(out.perDeal.operatorFee).toMatchObject({ amount: '4710000', decimals: 6, usdMicrosAtPar: '4710000' });
    expect(out.perDeal.feeCoversCost.checksOnly.ethereum).toEqual({ covers: true, marginUsdMicros: '535716' });
  });

  it('spreads the adjudicators\' setup gas over the funded deals', () => {
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery: { ...discovery, demo: { ...discovery.demo, adjudicators: live.demo.adjudicators } } });
    // 3 adjudicators × 372,709 gas over 1 funded deal.
    expect(out.perDeal.gas.adjudicatorSetupPerDeal).toBe('1118127');
  });

  it('spreads the setup over every funded deal in the event log, not only the 7-day window', () => {
    const withLive = { ...discovery, demo: { ...discovery.demo, adjudicators: live.demo.adjudicators } };
    const out = buildOpsCost({ dealTiming: { ...dealTiming, eventLog: { ...EVENT_LOG, fundedDeals: 23 } }, prices, modelPrices, discovery: withLive });
    // 3 × 372,709 = 1,118,127 gas over 23 funded deals = 48,614.2, rounded up to 48,615 (T-066 Evidence).
    expect(out.perDeal.gas.adjudicatorSetupPerDeal).toBe('48615');
    expect(out.gaps.some((g: string) => /reads high/.test(g))).toBe(false);
    // A log read that starts past seq 0 misses older deals, so the share reads high and says so.
    const late = buildOpsCost({ dealTiming: { ...dealTiming, eventLog: { ...EVENT_LOG, from: 4000, fundedDeals: 23 } }, prices, modelPrices, discovery: withLive });
    expect(late.gaps.some((g: string) => /from seq 4000.*reads high/.test(g))).toBe(true);
  });

  it('leaves the setup out, and names it, when discovery cannot be read', () => {
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery: null, faucetMintGas: ['130000'] });
    expect(out.perDeal.gas.adjudicatorSetupPerDeal).toBe(null);
    // 1,261,428 + 130,000: no setup share added as if it were 0.
    expect(out.perDeal.gas.totalGas.median).toBe('1391428');
    expect(out.perDeal.total.checksOnly.excludes).toContain('adjudicator setup');
    expect(out.perDeal.total.rubric.excludes).toContain('adjudicator setup');
    expect(out.gaps).toContain("Discovery could not be read, so the adjudicators' setup gas is left out of the gas.");
  });

  it('reads the setup as 0, not unknown, when discovery lists no adjudicator', () => {
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery, faucetMintGas: ['130000'] });
    expect(out.perDeal.gas.adjudicatorSetupPerDeal).toBe('0');
    // Cloudflare is still out (no run file); the setup is not.
    expect(out.perDeal.total.checksOnly.excludes).toEqual(['cloudflare']);
  });

  it('bounds rubric judge inference at the dearest live model', () => {
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery });
    // (2,787 × USD 4 + 561 × USD 20 per million) ÷ 3 calls × 3 seats = 22,368 µUSD.
    expect(out.perDeal.judges.rubric).toEqual({ basis: 'upper bound', usdMicros: '22368', calls: '3' });
    expect(out.perDeal.total.rubric.ethereum).toBe(String(3_784_284 + 22_368));
  });

  it('prices judges by model once discovery splits the tokens', () => {
    const byModel = { 'claude-sonnet-5-5@2026-09-28': { calls: 2, input: 2000, output: 400 }, 'deepseek-flash@2026-11-01': { calls: 1, input: 787, output: 161 } };
    const d = { ...discovery, demo: { ...discovery.demo, judges: { ...judges, tokensToday: { ...judges.tokensToday, byModel } } } };
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery: d });
    // (2,000 × 2 + 400 × 10 + 787 × 0.30 + 161 × 1.20) USD per million = 8,429.30 µUSD for 3 calls; × 3 seats ÷ 3 calls.
    expect(out.perDeal.judges.rubric).toEqual({ basis: 'by model', usdMicros: '8429', calls: '3' });
  });

  it('prices Cloudflare from a harness run\'s tail counts', () => {
    const oneClick = sampleRun({ cloudflare: TAIL });
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery, oneClick });
    // 50 requests × USD 0.30 + 150 CPU ms × USD 0.02 + 30 DO requests × USD 0.15 per million = 22.5 µUSD; 8,000 DO ms at
    // 128 MB = 1 GB-s × USD 12.50 per million = 12.5 µUSD. 35 µUSD in all.
    expect(out.perDeal.cloudflare).toMatchObject({ basis: 'tail', requests: '50', cpuMs: '150', durableObjectRequests: '30', durationGbS: '1', usdMicrosAtList: '35', usdMicrosAtMargin: '0' });
    expect(out.perDeal.total.checksOnly).toMatchObject({ excludes: ['faucet mint'], ethereum: String(3_784_284 + 35) });
  });

  it('reads Durable Object duration as unknown, not 0 GB-s, when the tail carried no wall time', () => {
    const workers = Object.fromEntries(Object.entries(TAIL.workers).map(([k, w]) => [k, { ...w, durableObjectWallMs: null }]));
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery, oneClick: sampleRun({ cloudflare: { ...TAIL, workers } }) });
    // 22.5 µUSD without the duration, rounded half away from zero: 23.
    expect(out.perDeal.cloudflare).toMatchObject({ basis: 'tail', durationGbS: null, usdMicrosAtList: '23' });
    expect(out.gaps).toContain("The tail carried no Durable Object wall time, so Durable Object duration is left out of Cloudflare's list price.");
  });

  it('reads unknown, never 0, for a missing source', () => {
    const out = buildOpsCost({ dealTiming, prices: null, modelPrices: null, discovery: null });
    expect(out.perDeal.gas.usdMicros).toEqual({ sepolia: '0', ethereum: null, base: null });
    // An unknown Cloudflare cost has no margin either: a card must not show USD 0 for it.
    expect(out.perDeal.cloudflare).toMatchObject({ basis: 'unknown', usdMicrosAtList: null, usdMicrosAtMargin: null });
    expect(out.perDeal.judges.rubric).toMatchObject({ basis: 'unknown', usdMicros: null });
    expect(out.perDeal.total.checksOnly).toMatchObject({ excludes: ['cloudflare', 'faucet mint', 'adjudicator setup'], ethereum: null });
    expect(out.perDeal.operatorFee.usdMicrosAtPar).toBe(null);
    expect(out.perDeal.feeCoversCost.checksOnly.ethereum).toEqual({ covers: null, marginUsdMicros: null });
    const none = buildOpsCost({ dealTiming: null, prices, modelPrices, discovery });
    expect(none.perDeal.gas.dealGas.median).toBe(null);
    expect(none.perDeal.gas.usdMicros.sepolia).toBe(null);
    expect(none.gaps.some((g: string) => /deal-timing.json could not be read/.test(g))).toBe(true);
  });

  it('gives each lane its runway in deals', () => {
    const balances = [
      { address: '0x601137a8de7e195e1426f57c053afa49b20ef555', role: 'funding lane', wei: '1391428000000000' },
      { address: LANE, role: 'deal lane', wei: '2522856000000000' },
      { address: '0xdb940f8613acee33465f62400395262126791879', role: 'deal lane', wei: null },
    ];
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery, faucetMintGas: ['130000'], effectiveGasPrices: ['1000000000', '1000000000', '2000000000'], balances });
    expect(out.runway.effectiveGasPriceWei).toEqual({ median: '1000000000', txs: 3 });
    // The funding lane pays the deal and the mint: 1,391,428 gas at 1 gwei a deal; a deal lane pays 1,261,428.
    expect(out.runway.lanes.map((l: { deals: string | null }) => l.deals)).toEqual(['1', '2', null]);
    expect(out.runway.totalDeals).toBe('2');
  });
});

describe('the run files ops-cost reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 't066-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const schemas = loadSchemas();
  const isValid = (f: unknown) => check('one-click', f, schemas).ok;
  const noRequests = NO_REQUESTS;
  const put = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));
  put('2026-11-05T13-35-12Z-buyer.json', sampleRun({ cloudflare: TAIL }));
  // Newer, but a worker has no request count: it fails the schema and must not price as 0 requests.
  put('2026-11-05T14-00-00Z-buyer.json', sampleRun({ runId: '2026-11-05T14-00-00Z-buyer', cloudflare: { ...TAIL, workers: { 'holdback-op1': noRequests } } }));
  // Newest and valid, but with no tail counts: passed over, not counted as a failure.
  put('2026-11-05T14-30-00Z-buyer.json', sampleRun({ runId: '2026-11-05T14-30-00Z-buyer' }));
  put('notes.json', { note: 'not a run file' });

  it('takes the newest run file that passes the one-click schema and carries tail counts', () => {
    const { run, skipped } = newestTailRun(dir, isValid);
    expect(run?.runId).toBe('2026-11-05T13-35-12Z-buyer');
    expect(skipped).toBe(1);
  });

  it('takes no run file when nothing can check it', () => {
    expect(newestTailRun(dir, () => false)).toEqual({ run: null, skipped: 3 });
    expect(newestTailRun(undefined, isValid)).toEqual({ run: null, skipped: 0 });
  });

  it('loads the schema check when Ajv is installed', async () => {
    const loaded = await loadRunCheck();
    expect(loaded).not.toBe(null);
    expect(loaded?.(sampleRun({ cloudflare: TAIL }))).toBe(true);
    expect(loaded?.(sampleRun({ cloudflare: { ...TAIL, workers: { 'holdback-op1': noRequests } } }))).toBe(false);
  });
});

describe('integer money', () => {
  it('prices tokens exactly where floats would not', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; one million tokens each at USD 0.10 and USD 0.20 per million is exact.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(tokensToUsdMicros([[1_000_000, 100_000], [1_000_000, 200_000]])).toBe(300_000n);
    // The run-once Opus tokens: 12 input, 13,201 one-hour writes, 125,536 reads, 2,331 output = 177,383.2 µUSD.
    expect(tokensToUsdMicros([[12, 4_000_000], [13_201, 8_000_000], [125_536, 200_000], [2_331, 20_000_000]])).toBe(177_383n);
  });

  it('values the fee at par from base units', () => {
    expect(tokenToUsdMicros('4710000', 6)).toBe(4_710_000n);
    expect(tokenToUsdMicros('4710000000000000000', 18)).toBe(4_710_000n);
    expect(tokenToUsdMicros('4710000', 6, 1n, 2n)).toBe(2_355_000n);
  });
});

// T-413: the gas a deal uses comes from each transaction's Sepolia receipt, the primary source, where the build read
// it, and from the operators' event log otherwise; perDeal.gas.source says which, for how many, and when.
describe('where the gas per deal comes from', () => {
  const txs = dealTiming.deals[0]!.txs.filter((t: { crowSent: boolean }) => t.crowSent).map((t: { tx: string; gasUsed: string }) => [t.tx, t.gasUsed] as const);

  it('reads the event log alone when no receipt was read, with the window and the newest deal beside the number', () => {
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery });
    expect(out.perDeal.gas.dealGas.median).toBe('1261428');
    expect(out.perDeal.gas.source).toEqual({
      basis: 'measured', from: 'event log', deals: 1, receiptTxs: 0, eventLogTxs: 4, mismatches: 0,
      window: { from: dealTiming.window.from, to: dealTiming.window.to }, newestDealAt: dealTiming.deals[0]!.times.settled,
    });
  });

  it('takes the receipt where it differs from the event log, and names the mismatch in a gap', () => {
    const receiptGas = new Map(txs.map(([tx, g], i) => [tx.toLowerCase(), i === 0 ? String(BigInt(g) + 100n) : g]));
    const out = buildOpsCost({ dealTiming, prices, modelPrices, discovery, receiptGas });
    expect(out.perDeal.gas.dealGas.median).toBe('1261528');
    expect(out.perDeal.gas.source).toMatchObject({ from: 'receipts', receiptTxs: 4, eventLogTxs: 0, mismatches: 1 });
    expect(out.gaps.some((g: string) => /1 transaction's gas in the event log differs from its Sepolia receipt/.test(g))).toBe(true);
  });

  it('mixes the two when only some receipts were read', () => {
    const receiptGas = new Map([[txs[0]![0].toLowerCase(), txs[0]![1]]]);
    expect(buildOpsCost({ dealTiming, prices, modelPrices, discovery, receiptGas }).perDeal.gas.source).toMatchObject({ from: 'receipts and event log', receiptTxs: 1, eventLogTxs: 3, mismatches: 0 });
  });

  it('has no source when no deal was measured', () => {
    expect(buildOpsCost({ dealTiming: null, prices, modelPrices, discovery }).perDeal.gas.source).toBeNull();
  });
});

// T-413 review: a deal whose transactions carry no gas (no receipt read, no payload.gasUsed) is unknown, never a
// measured 0, and it stays out of the median and the count beside it.
describe('a deal with no gas figure', () => {
  const blank = { ...dealTiming, deals: dealTiming.deals.map((d: { txs: { gasUsed: string | null }[] }) => ({ ...d, txs: d.txs.map((t) => ({ ...t, gasUsed: null })) })) };

  it('reads unknown with no source, and says why', () => {
    const out = buildOpsCost({ dealTiming: blank, prices, modelPrices, discovery });
    expect(out.perDeal.gas.dealGas.median).toBeNull();
    expect(out.perDeal.gas.totalGas.median).toBeNull();
    expect(out.perDeal.gas.source).toBeNull();
    expect(out.gaps.some((g: string) => /1 Released deal has no gas figure/.test(g))).toBe(true);
  });

  it('leaves such a deal out of the median beside the measured ones', () => {
    const both = { ...dealTiming, deals: [...dealTiming.deals, ...blank.deals] };
    const out = buildOpsCost({ dealTiming: both, prices, modelPrices, discovery });
    expect(out.perDeal.gas.dealGas.median).toBe('1261428');
    expect(out.perDeal.gas.source).toMatchObject({ deals: 1 });
  });
});
