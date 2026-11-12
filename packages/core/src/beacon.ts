// Beacon round arithmetic (ADR-0018). One formula for every beacon, drand's: no round before genesis,
// round 1 at genesis, then one round per period. The rules contract's beacons (contracts/script/SimBeacon.sol and
// contracts/src/DrandQuicknetBeacon.sol) use the same formula, so SimChain, the EVM adapter and the contract agree on every round.
import type { Hex32, RandomnessSource } from './types.js';

export interface BeaconClock {
  /** Unix seconds of round 1. */
  genesis: number;
  /** Seconds per round. */
  period: number;
}

/** drand quicknet (chain hash 52db9ba7…c84e971): https://api.drand.sh/<chain hash>/info. */
export const DRAND_QUICKNET: BeaconClock = { genesis: 1692803367, period: 3 };

/** The drand network DrandQuicknetBeacon verifies, which a rulebook naming drand-quicknet must name (T-217). */
export const DRAND_QUICKNET_CHAIN_HASH: Hex32 = '0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

/**
 * The SimChain beacon: genesis 1 s, period 1 s, so round(t) = t in whole seconds, which is SimChain's original
 * floor(ms / 1000) for every t >= 0.
 */
export const SIM_BEACON: BeaconClock = { genesis: 1, period: 1 };

/**
 * The clock of a club rulebook's randomness source (ADR-0018 §6), or null when nothing here verifies that source. A
 * state saved before the offer kept its source has none: every such commitment named `sim` (T-217).
 */
export function beaconClockOf(source: RandomnessSource | undefined): BeaconClock | null {
  if (source === undefined || source === 'sim') return SIM_BEACON;
  return source === 'drand-quicknet' ? DRAND_QUICKNET : null;
}

/** The latest round published at or before unix second `t`: 0 before genesis, else floor((t - genesis) / period) + 1. */
export function beaconRoundAt(clock: BeaconClock, t: number): number {
  if (!Number.isSafeInteger(t) || t < 0) throw new RangeError(`beacon time must be whole non-negative seconds, got ${t}`);
  return t < clock.genesis ? 0 : Math.floor((t - clock.genesis) / clock.period) + 1;
}
