// Shared fixtures for the T-066 metrics tests. No network: every source is a file in tests/metrics/fixtures/ or a
// fake fetch. The run-once deal (0xa93a4a1d…) was read live from api.escrow.stream and Sepolia on 2026-11-05.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const json = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
export const config = (name: string) => JSON.parse(readFileSync(join(ROOT, 'config', name), 'utf8'));

export const ONCE = '0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93';
/** Deal lane 1, which sent every transaction of the run-once deal. */
export const LANE = '0x5e7f1a8c06f357e8e321ba33a3ffb0b4a0fd3243';
/** 2026-11-05T15:00:00Z: after the run-once deal, inside its 7-day window. */
export const NOW = Date.parse('2026-11-05T15:00:00Z');

type Event = { seq: number; type: string; at: string; commitmentId?: string; actor?: string; payload: Record<string, unknown> };

export function onceEvents(): Event[] {
  return json('deal-once.events.json');
}

export function onceBlocks(): Map<string, number> {
  const raw = json('deal-once.blocks.json') as Record<string, number>;
  return new Map(Object.entries(raw).map(([b, s]) => [b, s * 1000]));
}

/** The run-once deal with each step's gas set to the measured values of T-066's Context (1,261,428 in all). */
export function measuredStepEvents(): Event[] {
  const gas: Record<string, string> = { 'hold.funded': '840697', 'fee.operator': '840697', 'delivery.submitted': '173131', 'judgment.decided': '166808', 'settlement.released': '166808', 'key.released': '166808', 'appeal.expired': '80792' };
  return onceEvents().map((e) => (typeof e.payload.gasUsed === 'string' ? { ...e, payload: { ...e.payload, gasUsed: gas[e.type] } } : e));
}

/** A copy of an event list as another deal: a new commitment id and every time moved by `shiftMs`. */
export function asDeal(events: Event[], n: number, shiftMs: number, overrides: Partial<Record<string, number>> = {}): Event[] {
  const id = `0x${n.toString(16).padStart(64, '0')}`;
  return events.map((e) => {
    const extra = overrides[e.type] ?? 0;
    return { ...e, seq: e.seq + n * 100, commitmentId: id, at: new Date(Date.parse(e.at) + shiftMs + extra).toISOString().replace(/\.\d{3}Z$/, 'Z'), payload: { ...e.payload } };
  });
}
