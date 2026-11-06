// T-066: throughput.mjs on fixtures: live discovery and agent.json saved once (2026-11-05), and a deal-timing file
// built from the run-once deal.
import { describe, expect, it } from 'vitest';
import { buildDealTiming } from '../../scripts/metrics/deal-timing.mjs';
import { buildThroughput, constantFrom } from '../../scripts/metrics/throughput.mjs';
import { EVENT_LOG, LANE, NOW, json, onceBlocks, onceEvents } from './helpers';

const dealTiming = { ...buildDealTiming({ events: onceEvents(), blockTimes: onceBlocks(), crow: new Set([LANE]), nowMs: NOW }), eventLog: EVENT_LOG };
/** 101 blocks 12 s apart, but one 24 s gap: the median gap is 12 s. */
const blocks = Array.from({ length: 101 }, (_, i) => 1_793_885_000_000 + i * 12_000 + (i > 50 ? 12_000 : 0));
const code = { dealLanes: 3, mintsPerDay: 600, commit: '7639613453bc367ed3ac0122cdb38e4e4553765d' };

describe('throughput', () => {
  const out = buildThroughput({ discovery: json('discovery.json'), agent: json('test-seller-agent.json'), dealTiming, blockTimesMs: blocks, code, nowMs: NOW });

  it('reads each value with its source', () => {
    expect(out.config.dealLanes).toEqual({ value: 3, source: 'DEAL_LANES in packages/settlement/evm/live.ts at 7639613453bc, not confirmed live' });
    expect(out.config.txPerHonestDeal.value).toBe(4);
    expect(out.config.blockTimeMs).toEqual({ medianMs: 12000, p90Ms: 12000, blocks: 101 });
    expect(out.config.secondsPerTx.value).toBe(12);
    expect(out.config.testSeller).toMatchObject({ open: 10, perHour: 20, perDay: 100, perClientPerHour: 3, perClientPerDay: 10 });
    expect(out.config.faucet).toMatchObject({ perAddressEverySec: 3600, perClientPerWindow: 10, mintsPerDay: 600 });
    expect(out.config.liveJudges).toMatchObject({ callsPerDay: 30, seatsPerPanel: 3 });
  });

  it('computes relay capacity and deals in progress by hand', () => {
    // 3 lanes × 3,600 s ÷ (4 transactions × 12 s) = 225 deals an hour.
    expect(out.capacity.relayDealsPerHour).toBe(225);
    // Little's law: 225 an hour × 44 s from offered to settled = 2.75, rounded up to 3.
    expect(out.capacity.medianLifetimeMs).toBe(44000);
    expect(out.capacity.inProgressAtRelayCapacity).toBe(3);
  });

  it("names the test seller's 20 an hour as the binding limit, and its 100 a day", () => {
    expect(out.capacity.binding).toMatchObject({ id: 'testSeller.perHour', dealsPerHour: 20, perDay: { id: 'testSeller.perDay', dealsPerDay: 100 } });
    expect(out.capacity.limits.find((l: { id: string }) => l.id === 'liveJudges')).toMatchObject({ dealsPerDay: 10, appliesTo: 'rubric' });
  });

  it('counts funded deals per clock hour over 168 hours', () => {
    expect(out.observed.dealsPerHour).toEqual({ medianPerHour: 0, peakPerHour: 1, hours: 168 });
    // 1 deal in the peak hour ÷ 20 an hour = 500 basis points.
    expect(out.observed.utilizationBps).toBe(500);
  });

  it('reads unknown, not 0, when a source is missing', () => {
    const bare = buildThroughput({ discovery: null, agent: null, dealTiming: null, blockTimesMs: [], code: { dealLanes: null, mintsPerDay: null, commit: 'unknown' }, nowMs: NOW });
    expect(bare.capacity.relayDealsPerHour).toBe(null);
    expect(bare.config.testSeller.perHour).toBe(null);
    expect(bare.observed.utilizationBps).toBe(null);
    expect(bare.gaps.some((g: string) => /Relay capacity is unknown/.test(g))).toBe(true);
  });

  it('reads the observed deals as unknown, not 0, when only deal-timing.json is missing', () => {
    const noTiming = buildThroughput({ discovery: json('discovery.json'), agent: json('test-seller-agent.json'), dealTiming: null, blockTimesMs: blocks, code, nowMs: NOW });
    // The binding limit still comes from agent.json, so only the observed side is unknown.
    expect(noTiming.capacity.binding).toMatchObject({ id: 'testSeller.perHour', dealsPerHour: 20 });
    expect(noTiming.observed.dealsPerHour).toEqual({ medianPerHour: null, peakPerHour: null, hours: 168 });
    expect(noTiming.observed.utilizationBps).toBe(null);
    expect(noTiming.gaps).toContain('deal-timing.json could not be read, so the observed deals read unknown.');
  });

  it('reads the observed deals as unknown, not 0, when deal-timing.json has no event log', () => {
    const noLog = { ...buildDealTiming({ events: null, blockTimes: new Map(), crow: new Set([LANE]), nowMs: NOW }), eventLog: null };
    const blind = buildThroughput({ discovery: json('discovery.json'), agent: json('test-seller-agent.json'), dealTiming: noLog, blockTimesMs: blocks, code, nowMs: NOW });
    expect(blind.observed.dealsPerHour).toEqual({ medianPerHour: null, peakPerHour: null, hours: 168 });
    expect(blind.observed.utilizationBps).toBe(null);
    expect(blind.gaps).toContain('No operator node served its event log, so the observed deals read unknown.');
  });

  it('prefers the lanes discovery publishes over the code', () => {
    const discovery = { ...json('discovery.json'), demo: { ...json('discovery.json').demo, relayer: { fundingLane: LANE, dealLanes: [LANE, LANE] } } };
    const two = buildThroughput({ discovery, agent: null, dealTiming, blockTimesMs: blocks, code, nowMs: NOW });
    expect(two.config.dealLanes).toEqual({ value: 2, source: 'discovery demo.relayer.dealLanes' });
    expect(two.capacity.relayDealsPerHour).toBe(150);
  });

  it('reads a whole-number constant from source text', () => {
    expect(constantFrom('export const DEAL_LANES = 3;', 'DEAL_LANES')).toBe(3);
    expect(constantFrom('const FAUCET_MINTS_PER_DAY = 600;', 'FAUCET_MINTS_PER_DAY')).toBe(600);
    expect(constantFrom('const DEAL_LANES = Number(x);', 'DEAL_LANES')).toBe(null);
  });
});
