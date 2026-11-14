// T-425: the network-free parts of scripts/metrics/pitch-evidence.mjs. The events below are the live deal of
// 2026-11-14 10:49 UTC (commitment 0x3040ec75…a1a7), as GET /v1/commitments/<id>/events served them, newest first;
// the try.ts lines follow its own format (examples/try.ts, `say`).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dealTiming, eth, FUNDING_LANE_LOW_WEI, gasBudget, main, nextStep, parseTryOutput, rankOf, render, sec, stats, summarize } from '../../scripts/metrics/pitch-evidence.mjs';

const TX = { fund: `0x70641b81${'0'.repeat(52)}85ca`, deliver: `0x76e847ab${'0'.repeat(52)}3a19`, decide: `0x8cf84b19${'0'.repeat(52)}5099` };
const MORNING = [
  { seq: 213, type: 'key.released', at: '2026-11-14T10:49:36Z', payload: { tx: TX.decide, block: '12132616' } },
  { seq: 212, type: 'settlement.released', at: '2026-11-14T10:49:36Z', payload: { tx: TX.decide, block: '12132616' } },
  { seq: 211, type: 'judgment.decided', at: '2026-11-14T10:49:36Z', payload: { outcome: 'accept', tx: TX.decide, block: '12132616', gasUsed: '166808' } },
  { seq: 210, type: 'key.released', at: '2026-11-14T10:49:24Z', payload: {} },
  { seq: 209, type: 'delivery.submitted', at: '2026-11-14T10:49:24Z', payload: { tx: TX.deliver, block: '12132615', gasUsed: '173131' } },
  { seq: 208, type: 'hold.funded', at: '2026-11-14T10:49:12Z', payload: { tx: TX.fund, block: '12132614', gasUsed: '840697' } },
  { seq: 207, type: 'commitment.agreed', at: '2026-11-14T10:49:12Z', payload: {} },
  { seq: 206, type: 'adjudicator.accepted', at: '2026-11-14T10:49:05Z', payload: {} },
  { seq: 205, type: 'commitment.offered', at: '2026-11-14T10:49:03Z', payload: {} },
];
const ID = `0x3040ec75${'0'.repeat(52)}a1a7`;
const OK_STDOUT = [
  'Crow test deal on https://api.crow.direct and https://api2.crow.direct: test tokens only, nothing here is real money',
  `offered   ${ID.slice(0, 8)}...a1a7 offered by the test seller`,
  "final     Released in 46 s with Crow's test seller as the other party; final at the decision",
  `done      commitment ${ID} Released`,
].join('\n');

describe('dealTiming', () => {
  it("times the morning deal from the operator's events: 9 s, 12 s, 12 s and 33 s", () => {
    const t = dealTiming(MORNING);
    expect(t.ms).toEqual({ offerToFunding: 9000, fundingToDelivery: 12000, deliveryToPayment: 12000, offerToPayment: 33000 });
    expect(t.moments.funded).toEqual({ at: '2026-11-14T10:49:12Z', type: 'hold.funded', tx: TX.fund, block: '12132614' });
    expect(t.moments.paid?.type).toBe('settlement.released');
    expect(t.transactions).toBe(3);
    expect(t.gasUsed).toBe('1180636'); // 840,697 + 173,131 + 166,808, one count per transaction
  });

  it('leaves an interval null when a moment is missing, and takes the first event of a type', () => {
    const t = dealTiming(MORNING.filter((e) => e.type !== 'settlement.released'));
    expect(t.moments.paid).toBeNull();
    expect(t.ms.deliveryToPayment).toBeNull();
    expect(t.ms.offerToFunding).toBe(9000);
    const twice = dealTiming([...MORNING, { seq: 300, type: 'hold.funded', at: '2026-11-14T11:00:00Z', payload: {} }]);
    expect(twice.ms.offerToFunding).toBe(9000);
  });
});

describe('stats and rankOf', () => {
  it('gives the median of an odd count, the mean of the two middle values of an even one, and the range', () => {
    expect(stats([33000, 32000, 44000])).toEqual({ count: 3, medianMs: 33000, minMs: 32000, maxMs: 44000 });
    expect(stats([32000, 33000, 34000, 44000])).toEqual({ count: 4, medianMs: 33500, minMs: 32000, maxMs: 44000 });
    expect(stats([null, undefined, 1.5])).toEqual({ count: 0, medianMs: null, minMs: null, maxMs: null });
  });

  it('counts the values below, equal to and above one value', () => {
    expect(rankOf([32000, 33000, 33000, 44000], 33000)).toEqual({ below: 1, equal: 2, above: 1 });
  });
});

describe('parseTryOutput and nextStep', () => {
  it('reads a released deal with the test seller and goes on', () => {
    const p = parseTryOutput(OK_STDOUT, '');
    expect(p).toMatchObject({ commitmentId: ID, state: 'Released', reportedSec: 46, withTestSeller: true, stoppedAt: null, rateLimited: false });
    expect(nextStep(p, 0)).toEqual({ action: 'next' });
    // A deal that stops after the offer keeps the short ID try printed.
    expect(parseTryOutput(OK_STDOUT.split('\n').slice(0, 2).join('\n'), 'stopped at outcome: still Held').idPrefix).toBe('0x3040ec...a1a7');
  });

  it('waits out a faucet refusal, as the faucet says', () => {
    const p = parseTryOutput('', 'stopped at faucet: POST /v1/faucet: rate_limited: too many faucet grants from this client; retry later');
    expect(p.stoppedAt).toBe('faucet');
    expect(nextStep(p, 1)).toEqual({ action: 'wait-faucet' });
  });

  it("stops, and does not wait, when the faucet refuses the seller's grant after the test seller was busy or silent", () => {
    for (const why of ['it is busy: one deal at a time', 'https://crow.direct/agents/test-seller/agent.json did not answer (fetch failed)']) {
      const p = parseTryOutput(`seller    the test seller is unavailable: ${why}. Playing both sides instead`, 'stopped at faucet: POST /v1/faucet: rate_limited: too many faucet grants from this client; retry later');
      expect(nextStep(p, 1)).toMatchObject({ action: 'stop' });
    }
  });

  it('names a run it stopped at the time limit', () => {
    expect(nextStep(parseTryOutput('', ''), 1, true)).toMatchObject({ action: 'stop', why: expect.stringContaining('ran past 6 min') });
  });

  it('stops the series at a 429 anywhere else, a busy test seller, a refusal or a failed deal', () => {
    const throttled = parseTryOutput('', 'stopped at fund: POST /v1/prepare/agree-and-fund: rate_limited: slow down');
    expect(nextStep(throttled, 1)).toMatchObject({ action: 'stop', why: expect.stringContaining('429') });
    const busy = parseTryOutput(`seller    the test seller is unavailable: it is busy: one deal at a time. Playing both sides instead\n${OK_STDOUT.replace("with Crow's test seller as the other party", 'with both sides played here, since the test seller was unavailable')}`, '');
    expect(busy.sellerUnavailable).toMatch(/busy/);
    expect(nextStep(busy, 0)).toMatchObject({ action: 'stop' });
    const both = parseTryOutput(OK_STDOUT.replace("with Crow's test seller as the other party", 'with both sides played here'), '');
    expect(nextStep(both, 0)).toMatchObject({ action: 'stop', why: expect.stringContaining('both sides') });
    expect(nextStep(parseTryOutput('', 'refused at check: refusing to agree: price is 30'), 3)).toMatchObject({ action: 'stop', why: expect.stringContaining('exited 3 at check') });
    expect(nextStep(parseTryOutput('', 'stopped at outcome: still Held / Held after 180 s'), 1)).toMatchObject({ action: 'stop' });
  });
});

describe('gasBudget and eth', () => {
  it('passes when the deals leave the funding lane above the low mark, and fails when they would not', () => {
    // 2026-11-14 11:28 UTC (measured): 2.784514 ETH in the funding lane, three deal lanes, a gas price of 17 wei.
    const live = gasBudget({ fundingWei: 2784514516735066124n, laneWei: [10431418830265356n, 29193263376683148n, 13617594100513706n], gasPriceWei: 17n, count: 20 });
    expect(live.ok).toBe(true);
    expect(eth(live.needWei)).toBe('0.031200');
    expect(eth(live.afterWei)).toBe('2.753314'); // the funding lane alone: the deal lanes are not counted
    expect(gasBudget({ fundingWei: 10n ** 18n, laneWei: [], gasPriceWei: 0n, count: 1, lowWei: 10n ** 18n }).ok).toBe(false);
    const low = gasBudget({ fundingWei: FUNDING_LANE_LOW_WEI, laneWei: [], gasPriceWei: 0n, count: 1 });
    expect(low.ok).toBe(false);
    expect(eth(low.afterWei)).toBe('0.298440');
  });

  it('prints wei as ETH and milliseconds as seconds without floats', () => {
    expect(eth(1_500_000_000_000_000_000n)).toBe('1.500000');
    expect(eth(-1n * 10n ** 15n)).toBe('-0.001000');
    expect(sec(33000)).toBe('33 s');
    expect(sec(33500)).toBe('33.5 s');
    expect(sec(null)).toBe('missing');
  });
});

describe('summarize and render', () => {
  it('summarizes completed deals only and says how typical 33 s is', () => {
    const t = dealTiming(MORNING);
    const items = [
      { outcome: 'Released', timing: t, wallMs: 46000 },
      { outcome: 'Released', timing: { ...t, ms: { ...t.ms, offerToPayment: 44000 } }, wallMs: 61000 },
      { outcome: null, timing: null, wallMs: 5000 },
    ];
    const s = summarize(items);
    expect(s).toMatchObject({ completed: 2, attempted: 3, morningDeal: { ms: 33000, below: 0, equal: 1, above: 1 } });
    expect(s.intervals.offerToPayment).toEqual({ count: 2, medianMs: 38500, minMs: 33000, maxMs: 44000 });
    const text = render({ deals: { summary: s, stopped: 'deal 3: try exited 1' } });
    expect(text).toContain('| offer to payment | 38.5 s | 33 s | 44 s | 2 |');
    expect(text).toContain('stopped: deal 3: try exited 1');
  });
});

describe('the command line', () => {
  it('answers --help with the usage and exit 0, and refuses an unknown measurement with exit 2', async () => {
    const help = spawnSync(process.execPath, [join(__dirname, '../../scripts/metrics/pitch-evidence.mjs'), '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/^pitch-evidence: three measurements/);
    expect(help.stdout).toContain('deals  [--count 20]');
    expect(await main(['nothing'])).toBe(2);
    await expect(main(['deals', '--count', '0'])).rejects.toThrow(/--count/);
  });
});
