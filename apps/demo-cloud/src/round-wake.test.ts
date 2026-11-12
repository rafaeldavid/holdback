// T-378 part 6 (ADR-0032 §3.5): the demo world wakes the fallback adjudicator, and the appeal adjudicator after an
// escalation, when the beacon round that seeds their panel is public, not at judgeBy or at once. With the 29 s margin of
// Sepolia the round is public 29 to 31 s after judgeBy; a wake at judgeBy and retries at 2, 6, 14 and 30 s can miss
// a short fallback window. With a margin of 0 (SimChain, a local chain) nothing moves.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAND_QUICKNET, parseCommitment, type EscrowState } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { ROUND_WAKE_MS, roundPublicAt, workAt } from './world.js';

const example = parseCommitment(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'spec', 'examples', 'commitment.example.json'), 'utf8')));
if (!example.ok) throw new Error('the spec example must parse');
const terms = example.value as unknown as EscrowState['terms'];
const judgeBy = Date.parse(terms.timing.judgeBy);
const fallback = terms.adjudication.fallbackAdjudicator.toLowerCase();
const appeal = terms.adjudication.appealAdjudicator.toLowerCase();
const ours = (who: string) => (a: string) => a.toLowerCase() === who;
const state = (over: Record<string, unknown>) => ({ id: '0x' + '0'.repeat(64), terms, beaconSource: 'drand-quicknet', ...over }) as unknown as EscrowState;
/** When drand quicknet publishes round `r`, in ms. */
const published = (r: number) => (DRAND_QUICKNET.genesis + (r - 1) * DRAND_QUICKNET.period) * 1000;
const roundAt = (t: number) => Math.floor((t - DRAND_QUICKNET.genesis) / DRAND_QUICKNET.period) + 1;

describe('the round wake (ADR-0032 §3.5, T-378 part 6)', () => {
  it('wakes the fallback when its round is public, 29 to 31 s after judgeBy at the 29 s margin, plus the wake slack', () => {
    const s = state({ kind: 'Delivered' });
    const [wake] = workAt(s, ours(fallback), judgeBy - 60_000, 29)!;
    // ADR-0032 §3.1: the first round published strictly after judgeBy − 1 + margin.
    const round = roundAt(judgeBy / 1000 - 1 + 29) + 1;
    expect(wake).toBe(published(round) + ROUND_WAKE_MS);
    expect(wake! - judgeBy).toBeGreaterThanOrEqual(29_000 + ROUND_WAKE_MS);
    expect(wake! - judgeBy).toBeLessThanOrEqual(31_000 + ROUND_WAKE_MS);
    // FallbackJudging (taken over already): not before the round either.
    expect(workAt(state({ kind: 'FallbackJudging' }), ours(fallback), judgeBy, 29)).toEqual([published(round) + ROUND_WAKE_MS]);
  });

  it('wakes the appeal adjudicator when the escalation round is public, not at once', () => {
    const at = '2026-11-02T10:00:00Z';
    const s = state({ kind: 'Escalated', escalation: { by: 'primary', at, appealDecideBy: '2026-11-02T10:05:00Z' } });
    const round = roundAt(Date.parse(at) / 1000 + 29) + 1;
    expect(workAt(s, ours(appeal), Date.parse(at), 29)).toEqual([published(round) + ROUND_WAKE_MS]);
    // A pass after the round is public acts at once.
    const later = published(round) + 10_000;
    expect(workAt(s, ours(appeal), later, 29)).toEqual([later]);
  });

  it('changes nothing at a margin of 0: the fallback at judgeBy, the appeal adjudicator at once', () => {
    expect(workAt(state({ kind: 'Delivered' }), ours(fallback), judgeBy - 60_000, 0)).toEqual([judgeBy]);
    const at = '2026-11-02T10:00:00Z';
    const s = state({ kind: 'Escalated', escalation: { by: 'primary', at, appealDecideBy: '2026-11-02T10:05:00Z' } });
    expect(workAt(s, ours(appeal), Date.parse(at), 0)).toEqual([Date.parse(at)]);
    expect(roundPublicAt(s, 'appeal', 0)).toBeNull();
  });
});
