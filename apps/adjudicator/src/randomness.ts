// Panel seeds for the decider's role (ADR-0018) and the RandomnessSource the service reads rounds
// through. Phase 1 has the SimChain beacon only; drand quicknet comes with Phase 2.
//
// `panelSeed` is core's (T-006). `roundFor` computes core's `beaconRoundFor` from the time the port
// reports, since the service sees tasks, not escrow states; `simBeacon` is the SimChain beacon for the
// unit-test settlement. randomness.test.ts pins both against core and SimChain.
import { concat, keccak256, numberToBytes, toBytes } from 'viem';
import type { AdjudicatorRole, Hex32, RandomnessSource as RandomnessSourceKind, Timestamp } from '@holdback/core';

export { panelSeed } from '@holdback/core';

export interface BeaconRound {
  source: RandomnessSourceKind;
  round: number;
  value: Hex32;
}

/** Reads beacon rounds. `value` is null until the round is published; there is no substitute source. */
export interface RandomnessSource {
  readonly kind: RandomnessSourceKind;
  value(round: number): Promise<Hex32 | null>;
}

/** One round per simulated second: round n is published at unix second n. */
export const simRoundAt = (ts: Timestamp): number => Math.floor(Date.parse(ts) / 1000);

/**
 * The round fixed by settlement state (ADR-0018 §2): the round at judgeBy for the fallback; the first
 * round strictly after the escalation or the appeal filing was applied for the appeal adjudicator.
 */
export function roundFor(role: Exclude<AdjudicatorRole, 'primary'>, fixedAt: Timestamp): number {
  const r = simRoundAt(fixedAt);
  if (!Number.isSafeInteger(r)) throw new RangeError(`not a timestamp: ${fixedAt}`);
  return role === 'fallback' ? r : r + 1;
}

/** ADR-0018 phase 1: value(round) = keccak256(simSeed || uint64 round), published once the sim clock reaches it. */
export function simBeacon(simSeed: Hex32, now: () => Timestamp): RandomnessSource {
  return {
    kind: 'sim',
    async value(round) {
      if (simRoundAt(now()) < round) return null;
      return keccak256(concat([toBytes(simSeed), numberToBytes(BigInt(round), { size: 8 })]));
    },
  };
}
