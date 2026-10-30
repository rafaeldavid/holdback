// Timing rules (docs/architecture.md): fixed deadline order plus rulebook minimum windows.
import { problem, type Problem } from './problem.js';
import { err, ok, type Result } from './result.js';
import type { Rulebook, Timestamp, Timing } from './types.js';

/**
 * The commitment fixes appealWindowSec and appealDecideSec, not absolute appeal deadlines: the window
 * opens at the first-instance decision. These are the latest values they can take (decision at
 * fallbackBy), which bound bond encumbrance and complete the order fallbackBy < appealBy < appealDecideBy.
 */
export interface TimingBounds {
  latestAppealBy: Timestamp;
  latestAppealDecideBy: Timestamp;
}

/** Milliseconds since epoch, or undefined for an unparseable or sub-second timestamp (signed as uint64 seconds). */
export function instant(ts: Timestamp): number | undefined {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) || ms % 1000 !== 0 ? undefined : ms;
}

export const addSeconds = (ts: Timestamp, seconds: number): Timestamp => new Date(Date.parse(ts) + seconds * 1000).toISOString();

const ORDER = ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'] as const;

export function validateTiming(timing: Timing, rulebook: Pick<Rulebook, 'minWindowsSec'>): Result<TimingBounds, Problem> {
  const violations: string[] = [];
  const at = new Map<string, number>();
  for (const key of ORDER) {
    const ms = instant(timing[key]);
    if (ms === undefined) violations.push(`${key} must be an RFC 3339 timestamp in whole seconds`);
    else at.set(key, ms);
  }
  if (violations.length) return err(problem('invalid_terms', violations.join('; ')));

  const ms = (key: (typeof ORDER)[number]): number => at.get(key)!;
  for (let i = 1; i < ORDER.length; i++) {
    const [a, b] = [ORDER[i - 1]!, ORDER[i]!];
    if (!(ms(a) < ms(b))) violations.push(`${a} < ${b} violated`);
  }

  const min = rulebook.minWindowsSec;
  const windows: Array<[name: string, seconds: number, minimum: number]> = [
    ['judge window (judgeBy - deliverBy)', (ms('judgeBy') - ms('deliverBy')) / 1000, min.judge],
    ['fallback window (fallbackBy - judgeBy)', (ms('fallbackBy') - ms('judgeBy')) / 1000, min.fallback],
    ['appeal window (appealWindowSec)', timing.appealWindowSec, min.appealWindow],
    ['appeal decision window (appealDecideSec)', timing.appealDecideSec, min.appealDecide],
  ];
  for (const [name, seconds, minimum] of windows) {
    if (seconds < minimum) violations.push(`${name} is ${seconds}s, below the rulebook minimum ${minimum}s`);
  }
  if (violations.length) return err(problem('invalid_terms', violations.join('; ')));

  const latestAppealBy = addSeconds(timing.fallbackBy, timing.appealWindowSec);
  return ok({ latestAppealBy, latestAppealDecideBy: addSeconds(latestAppealBy, timing.appealDecideSec) });
}
