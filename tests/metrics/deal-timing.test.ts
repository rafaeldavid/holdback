// T-066: deal-timing.mjs on fixtures. The run-once deal's events and blocks were read live once (2026-11-05); the
// multi-deal sets are synthetic, timed by `at` alone, so every median and p90 below is computed by hand.
import { describe, expect, it } from 'vitest';
import { buildDealTiming, primaryEvent, stepOf, templateOf } from '../../scripts/metrics/deal-timing.mjs';
import { LANE, NOW, ONCE, onceBlocks, onceEvents } from './helpers';

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-05T10:00:00Z');

/** One synthetic deal, timed by `at`: each stage's length in ms, in order. */
function synthDeal(n: number, startMs: number, ms: { accept: number; agree: number; fund: number; deliver: number; decide: number; settle: number; final: number }) {
  const id = `0x${n.toString(16).padStart(64, '0')}`;
  const seq = n * 100;
  let t = startMs;
  const at = () => iso(t);
  const out = [];
  const tx = (k: number) => `0x${(n * 10 + k).toString(16).padStart(64, '0')}`;
  out.push({ seq, type: 'commitment.offered', commitmentId: id, at: at(), payload: { terms: { acceptance: { rubric: { criteria: [] } } } } });
  t += ms.accept;
  out.push({ seq: seq + 1, type: 'adjudicator.accepted', commitmentId: id, at: at(), payload: {} });
  t += ms.agree;
  out.push({ seq: seq + 2, type: 'commitment.agreed', commitmentId: id, at: at(), actor: '0x4bb29b65206d3eb3b8a6de8abe3f4e5911df0cfc', payload: {} });
  t += ms.fund;
  out.push({ seq: seq + 3, type: 'hold.funded', commitmentId: id, at: at(), payload: { tx: tx(1), sender: LANE, gasUsed: '840697' } });
  t += ms.deliver;
  out.push({ seq: seq + 4, type: 'delivery.submitted', commitmentId: id, at: at(), payload: { tx: tx(2), sender: LANE, gasUsed: '173131' } });
  t += ms.decide;
  out.push({ seq: seq + 5, type: 'judgment.decided', commitmentId: id, at: at(), payload: { tx: tx(3), sender: LANE, gasUsed: '166808' } });
  t += ms.settle;
  out.push({ seq: seq + 6, type: 'settlement.released', commitmentId: id, at: at(), payload: { tx: tx(3), sender: LANE, gasUsed: '166808' } });
  t += ms.final;
  out.push({ seq: seq + 7, type: 'appeal.expired', commitmentId: id, at: at(), payload: { tx: tx(4), sender: '0x00000000000000000000000000000000000000aa', gasUsed: '80792' } });
  return out;
}

describe('deal-timing on the run-once deal (read live, 2026-11-05)', () => {
  const out = buildDealTiming({ events: onceEvents(), blockTimes: onceBlocks(), crow: new Set([LANE]), nowMs: NOW });
  const stage = (id: string) => out.stages.find((s: { id: string }) => s.id === id);

  it('times chain events by their block and the rest by `at`', () => {
    const deal = out.deals[0];
    expect(deal.commitmentId).toBe(ONCE);
    expect(deal.times).toEqual({
      offered: '2026-11-05T13:36:04Z', accepted: '2026-11-05T13:36:06Z', agreed: '2026-11-05T13:36:12Z', funded: '2026-11-05T13:36:12Z',
      delivered: '2026-11-05T13:36:36Z', decided: '2026-11-05T13:36:48Z', settled: '2026-11-05T13:36:48Z', final: '2026-11-05T13:38:00Z',
    });
  });

  it('gives each stage its hand-computed length', () => {
    expect(out.deals[0].stagesMs).toEqual({ accept: 2000, agree: 6000, fund: 0, deliver: 24000, decide: 12000, settle: 0, final: 72000 });
    expect(stage('accept')).toMatchObject({ deals: 1, medianMs: 2000, p90Ms: 2000, crow: true });
    expect(stage('agree')).toMatchObject({ crow: false });
    // Crow's processing: accept + fund + decide + settle = 2 + 0 + 12 + 0 s; party time: agree + deliver = 6 + 24 s.
    expect(out.totals.crowProcessingMs).toEqual({ deals: 1, medianMs: 14000, p90Ms: 14000 });
    expect(out.totals.partyMs).toEqual({ deals: 1, medianMs: 30000, p90Ms: 30000 });
    expect(out.totals.offeredToSettledMs).toEqual({ deals: 1, medianMs: 44000, p90Ms: 44000 });
  });

  it('reads the fund stage as 0: commitment.agreed is recorded when its funding transaction lands', () => {
    // agreed.at 13:36:12 equals block 12069814's timestamp: the chain's wait shows in "agree" (T-066 Context, limit 2).
    expect(stage('fund')).toMatchObject({ medianMs: 0, clamped: 0 });
  });

  it('lists each transaction once, named by its step, with its gas and sender', () => {
    const txs = out.deals[0].txs;
    expect(txs.map((t: { step: string }) => t.step)).toEqual(['fund', 'deliver', 'decide', 'appeal expiry']);
    expect(txs.map((t: { gasUsed: string }) => t.gasUsed)).toEqual(['644881', '173131', '173295', '80792']);
    expect(txs.every((t: { crowSent: boolean; sender: string }) => t.crowSent && t.sender === LANE)).toBe(true);
    expect(out.deals[0]).toMatchObject({ outcome: 'Released', template: 'checks-only', fee: { amount: '4710000' } });
  });

  it('measures the index lag as `at` minus the block time', () => {
    expect(out.indexLagMs.events).toBeGreaterThan(0);
    expect(out.indexLagMs.medianMs).toBe(0);
  });
});

describe('deal-timing quantiles, caps and gaps', () => {
  // Ten deals; deal k (1..10) takes k s to accept, 10·k s to decide, and the rest fixed.
  const events = Array.from({ length: 10 }, (_, i) => synthDeal(i + 1, T0 + i * 60_000, { accept: (i + 1) * 1000, agree: 5000, fund: 12000, deliver: 20000, decide: (i + 1) * 10_000, settle: 0, final: 60000 })).flat();
  const crow = new Set([LANE]);

  it('takes nearest-rank medians and 90th percentiles', () => {
    const out = buildDealTiming({ events, blockTimes: new Map(), crow, nowMs: NOW });
    const stage = (id: string) => out.stages.find((s: { id: string }) => s.id === id);
    // Ten values 1..10 s: the median is the 5th (5 s) and the p90 the 9th (9 s).
    expect(stage('accept')).toMatchObject({ deals: 10, medianMs: 5000, p90Ms: 9000 });
    expect(stage('decide')).toMatchObject({ deals: 10, medianMs: 50000, p90Ms: 90000 });
    expect(stage('fund')).toMatchObject({ medianMs: 12000, p90Ms: 12000 });
    // Crow's processing per deal = k + 12 + 10k + 0 s = 11k + 12 s: the 5th is 67 s and the 9th 111 s.
    expect(out.totals.crowProcessingMs).toEqual({ deals: 10, medianMs: 67000, p90Ms: 111000 });
    expect(out.outcomes).toEqual({ Released: 10, Refunded: 0, other: 0 });
  });

  it('marks only Crow accounts as crowSent', () => {
    const out = buildDealTiming({ events, blockTimes: new Map(), crow, nowMs: NOW });
    const expiry = out.deals[0].txs.find((t: { step: string }) => t.step === 'appeal expiry');
    expect(expiry.crowSent).toBe(false);
  });

  it('keeps the newest deals when the window is over its cap, and says so in gaps', () => {
    const out = buildDealTiming({ events, blockTimes: new Map(), crow, nowMs: NOW, cap: 4 });
    expect(out.window.deals).toBe(4);
    expect(out.window.from).toBe(iso(T0 + 6 * 60_000));
    expect(out.gaps.some((g: string) => /holds 10 deals; the newest 4 are kept/.test(g))).toBe(true);
  });

  it('counts a stage that reads below 0 as 0 and says so', () => {
    const backwards = synthDeal(42, T0, { accept: 1000, agree: 5000, fund: -3000, deliver: 20000, decide: 10000, settle: 0, final: 60000 });
    const out = buildDealTiming({ events: backwards, blockTimes: new Map(), crow, nowMs: NOW });
    expect(out.stages.find((s: { id: string }) => s.id === 'fund')).toMatchObject({ medianMs: 0, clamped: 1 });
    expect(out.gaps.some((g: string) => /fund stage read below 0 on 1 deals/.test(g))).toBe(true);
  });

  it('leaves out deals older than 7 days and reads unknown, not 0, with no deal', () => {
    const old = synthDeal(7, NOW - 8 * 86_400_000, { accept: 1000, agree: 1000, fund: 1000, deliver: 1000, decide: 1000, settle: 0, final: 1000 });
    const out = buildDealTiming({ events: old, blockTimes: new Map(), crow, nowMs: NOW });
    expect(out.window.deals).toBe(0);
    expect(out.totals.crowProcessingMs).toEqual({ deals: 0, medianMs: null, p90Ms: null });
    expect(out.stages.every((s: { medianMs: number | null }) => s.medianMs === null)).toBe(true);
  });

  it('falls back to `at` when a block cannot be read, and says so', () => {
    const out = buildDealTiming({ events: onceEvents(), blockTimes: new Map(), crow, nowMs: NOW });
    expect(out.gaps.some((g: string) => /chain events are timed by their `at`/.test(g))).toBe(true);
  });
});

describe('deal-timing helpers', () => {
  it('names a transaction by its primary event', () => {
    expect(primaryEvent(['fee.operator', 'hold.funded'])).toBe('hold.funded');
    expect(primaryEvent(['key.released', 'settlement.released', 'judgment.decided'])).toBe('judgment.decided');
    expect(stepOf('appeal.expired')).toBe('appeal expiry');
    expect(stepOf('bond.paid')).toBe('other');
  });

  it('reads the template from public terms only', () => {
    expect(templateOf({ acceptance: { rubric: { criteria: [] } } })).toBe('checks-only');
    expect(templateOf({ acceptance: { rubric: { criteria: [{ id: 'x' }] } } })).toBe('rubric');
    expect(templateOf(undefined)).toBe(null);
  });
});
