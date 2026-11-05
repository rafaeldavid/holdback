// Panel seeds for the decider's role (ADR-0018) and the RandomnessSource the service reads rounds
// through: the SimChain beacon here, drand quicknet in drand.ts (T-217), whose proofs the rules contract's
// DrandQuicknetBeacon verifies on chain.
//
// `panelSeed` is core's. `roundFor` computes core's `beaconRoundFor` from the time the port reports, on
// the clock of the commitment's source, since the service sees tasks, not escrow states; `simBeacon` is the
// SimChain beacon for the unit-test settlement. randomness.test.ts pins both against core and SimChain.
import { beaconRoundAt, SIM_BEACON, type AdjudicatorRole, type BeaconClock, type Hex32, type RandomnessSource as RandomnessSourceKind, type Timestamp } from '@holdback/core';
import { concat, keccak256, numberToBytes, toBytes, type Hex } from 'viem';

export { panelSeed } from '@holdback/core';

/** A published round: its value and, for any source but sim, the signature that proves it (the Decision's beacon). */
export interface BeaconRound {
  value: Hex32;
  signature?: Hex;
}

/**
 * Reads beacon rounds on its clock. `value` is null until the round is published, or while no proof of it is at
 * hand; there is no substitute source.
 */
export interface RandomnessSource {
  readonly kind: RandomnessSourceKind;
  readonly clock: BeaconClock;
  value(round: number): Promise<BeaconRound | null>;
}

/** One round per simulated second: round n is published at unix second n. */
export const simRoundAt = (ts: Timestamp): number => Math.floor(Date.parse(ts) / 1000);

/**
 * The round fixed by settlement state (ADR-0018 §2), on `clock`: the round at judgeBy for the fallback; the first
 * round strictly after the escalation or the appeal filing was applied for the appeal adjudicator.
 */
export function roundFor(role: Exclude<AdjudicatorRole, 'primary'>, fixedAt: Timestamp, clock: BeaconClock): number {
  const t = simRoundAt(fixedAt);
  if (!Number.isSafeInteger(t)) throw new RangeError(`not a timestamp: ${fixedAt}`);
  const r = beaconRoundAt(clock, Math.max(0, t));
  return role === 'fallback' ? r : r + 1;
}

/** ADR-0018 phase 1: value(round) = keccak256(simSeed || uint64 round), published once the sim clock reaches it. */
export function simBeacon(simSeed: Hex32, now: () => Timestamp): RandomnessSource {
  return {
    kind: 'sim',
    clock: SIM_BEACON,
    async value(round) {
      if (simRoundAt(now()) < round) return null;
      return { value: keccak256(concat([toBytes(simSeed), numberToBytes(BigInt(round), { size: 8 })])) };
    },
  };
}
