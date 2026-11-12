// Panel seeds for the decider's role (ADR-0018) and the RandomnessSource the service reads rounds
// through: the SimChain beacon here, drand quicknet in drand.ts (T-217), whose proofs the rules contract's
// DrandQuicknetBeacon verifies on chain.
//
// `panelSeed` is core's. `roundFor` computes core's `beaconRoundFor` from the time the port reports, on
// the clock of the commitment's source, since the service sees tasks, not escrow states; `simBeacon` is the
// SimChain beacon for the unit-test settlement. randomness.test.ts pins both against core and SimChain.
import { roundAfter, SIM_BEACON, type AdjudicatorRole, type BeaconClock, type Hex32, type RandomnessSource as RandomnessSourceKind, type Timestamp } from '@holdback/core';
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
  /** The rules contract's `BEACON_MARGIN()` in seconds (ADR-0032), which `roundFor` adds. Absent: 0. */
  readonly marginSec?: number;
  value(round: number): Promise<BeaconRound | null>;
}

/** One round per simulated second: round n is published at unix second n. */
export const simRoundAt = (ts: Timestamp): number => Math.floor(Date.parse(ts) / 1000);

/**
 * The round fixed by settlement state (ADR-0018 §2, ADR-0032), on `clock`, through core's `roundAfter`, the rule the
 * rules contract runs: for the fallback (`fixedAt` = judgeBy), the first round published strictly after
 * `judgeBy − 1 + marginSec`; for the appeal adjudicator (`fixedAt` = when the escalation or the appeal filing was
 * applied), the first strictly after `fixedAt + marginSec`. `marginSec` is the rules contract's `BEACON_MARGIN()`,
 * which the settlement port carries on the source (`RandomnessSource.marginSec`); 0 on SimChain and a local chain.
 */
export function roundFor(role: Exclude<AdjudicatorRole, 'primary'>, fixedAt: Timestamp, clock: BeaconClock, marginSec = 0): number {
  const t = simRoundAt(fixedAt);
  if (!Number.isSafeInteger(t)) throw new RangeError(`not a timestamp: ${fixedAt}`);
  return roundAfter(clock, Math.max(0, role === 'fallback' ? t - 1 : t), marginSec);
}

/** `source` with the settlement layer's beacon margin (ADR-0032) on it, for `roundFor`; the same source when it has it. */
export function withMargin(source: RandomnessSource | null, marginSec: number): RandomnessSource | null {
  if (!source || (source.marginSec ?? 0) === marginSec) return source;
  return { kind: source.kind, clock: source.clock, marginSec, value: (round) => source.value(round) };
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
