// Panel seeds for the decider's role (ADR-0018) and the RandomnessSource the service reads rounds
// through. Phase 1 has the SimChain beacon only; drand quicknet comes with Phase 2.
//
// SEAM (T-006): core's state.ts is to gain `panelSeed` and `beaconRoundFor`, and T-006 the SimChain
// beacon. Until they exist this module defines them; the encodings below must match T-006's, and the
// adjudicator should import T-006's once packages/settlement/src/interface.ts lands.
import { concat, encodePacked, keccak256, numberToBytes, toBytes } from 'viem';
import type { AdjudicatorRole, Hex32, RandomnessSource as RandomnessSourceKind, Timestamp } from '@holdback/core';

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

/** panelSeed(role) = keccak256(commitmentId || role || attempt || beaconValue(round)) (ADR-0018 §1). */
export const panelSeed = (commitmentId: Hex32, role: AdjudicatorRole, attempt: number, beaconValue: Hex32): Hex32 =>
  keccak256(encodePacked(['bytes32', 'string', 'uint32', 'bytes32'], [commitmentId, role, attempt, beaconValue]));
