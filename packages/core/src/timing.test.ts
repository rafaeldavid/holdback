import { describe, expect, it } from 'vitest';
import { validateTiming } from './timing.js';
import type { Rulebook, Timing } from './types.js';

const minWindowsSec: Rulebook['minWindowsSec'] = { judge: 120, fallback: 120, appealWindow: 300, appealDecide: 300 };

const timing: Timing = {
  offerExpiresAt: '2026-10-30T10:15:00Z',
  fundBy: '2026-10-30T10:30:00Z',
  deliverBy: '2026-11-01T10:00:00Z',
  judgeBy: '2026-11-01T10:02:00Z',
  fallbackBy: '2026-11-01T10:04:00Z',
  appealWindowSec: 300,
  appealDecideSec: 300,
  maxSubmissions: 1,
};

describe('validateTiming', () => {
  it('accepts the example timing and derives the latest appeal deadlines', () => {
    expect(validateTiming(timing, { minWindowsSec })).toEqual({
      ok: true,
      value: { latestAppealBy: '2026-11-01T10:09:00.000Z', latestAppealDecideBy: '2026-11-01T10:14:00.000Z' },
    });
  });

  it.each([
    ['offerExpiresAt = fundBy', { fundBy: '2026-10-30T10:15:00Z' }, 'offerExpiresAt < fundBy'],
    ['fundBy after deliverBy', { fundBy: '2026-11-02T00:00:00Z' }, 'fundBy < deliverBy'],
    ['deliverBy after judgeBy', { deliverBy: '2026-11-01T10:03:00Z' }, 'deliverBy < judgeBy'],
    ['judgeBy = fallbackBy', { judgeBy: '2026-11-01T10:04:00Z' }, 'judgeBy < fallbackBy'],
  ])('refuses %s', (_name, patch, rule) => {
    const r = validateTiming({ ...timing, ...patch }, { minWindowsSec });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('invalid_terms');
      expect(r.error.detail).toContain(rule);
    }
  });

  it.each([
    ['judge window', { judgeBy: '2026-11-01T10:01:59Z' }, 'judge window'],
    ['fallback window', { fallbackBy: '2026-11-01T10:03:59Z' }, 'fallback window'],
    ['appeal window', { appealWindowSec: 299 }, 'appeal window'],
    ['appeal decision window', { appealDecideSec: 299 }, 'appeal decision window'],
  ])('refuses a %s below the rulebook minimum', (_name, patch, rule) => {
    const r = validateTiming({ ...timing, ...patch }, { minWindowsSec });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail).toContain(rule);
  });

  it('accepts windows exactly at the rulebook minimum', () => {
    expect(validateTiming(timing, { minWindowsSec }).ok).toBe(true);
  });

  it('reports every violation, not just the first', () => {
    const r = validateTiming({ ...timing, fundBy: '2026-10-30T10:00:00Z', appealWindowSec: 1 }, { minWindowsSec });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.detail).toContain('offerExpiresAt < fundBy');
      expect(r.error.detail).toContain('appeal window');
    }
  });

  it.each([
    ['an unparseable timestamp', { fundBy: 'tomorrow' }],
    ['sub-second precision, which the signed uint64 seconds cannot carry', { fundBy: '2026-10-30T10:30:00.500Z' }],
  ])('refuses %s', (_name, patch) => {
    expect(validateTiming({ ...timing, ...patch }, { minWindowsSec }).ok).toBe(false);
  });
});
