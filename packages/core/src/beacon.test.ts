import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beaconClockOf, beaconRoundAt, DRAND_QUICKNET, DRAND_QUICKNET_CHAIN_HASH, SIM_BEACON } from './beacon.js';

const vectors = JSON.parse(readFileSync(new URL('../../../fixtures/beacon/drand-quicknet.json', import.meta.url), 'utf8')) as {
  chainHash: string;
  info: { genesisTime: number; period: number };
};

/** The verifier's own constants, read from its Solidity source. */
const sol = readFileSync(new URL('../../../contracts/src/DrandQuicknetBeacon.sol', import.meta.url), 'utf8');
const solConstant = (name: string): number => Number(new RegExp(`uint256 public constant ${name} = (\\d+);`).exec(sol)![1]);

describe('beacon clocks per randomness source (ADR-0018 §6, T-217)', () => {
  it('pins quicknet to the on-chain verifier and the fixture', () => {
    expect(DRAND_QUICKNET).toEqual({ genesis: solConstant('GENESIS'), period: solConstant('PERIOD') });
    expect(DRAND_QUICKNET_CHAIN_HASH).toBe(`0x${vectors.chainHash}`);
  });

  it('gives the sim beacon to sim and to a state saved before the source was kept, quicknet to drand-quicknet, and none to prevrandao', () => {
    expect(beaconClockOf('sim')).toBe(SIM_BEACON);
    expect(beaconClockOf(undefined)).toBe(SIM_BEACON);
    expect(beaconClockOf('drand-quicknet')).toBe(DRAND_QUICKNET);
    expect(beaconClockOf('prevrandao')).toBeNull();
  });
});

describe('beacon round arithmetic (ADR-0018, T-209)', () => {
  it('pins drand quicknet: round 1 at genesis, one round per period', () => {
    expect(DRAND_QUICKNET).toEqual({ genesis: vectors.info.genesisTime, period: vectors.info.period });
    const g = DRAND_QUICKNET.genesis;
    expect(beaconRoundAt(DRAND_QUICKNET, 0)).toBe(0);
    expect(beaconRoundAt(DRAND_QUICKNET, g - 1)).toBe(0);
    expect(beaconRoundAt(DRAND_QUICKNET, g)).toBe(1);
    expect(beaconRoundAt(DRAND_QUICKNET, g + 2)).toBe(1);
    expect(beaconRoundAt(DRAND_QUICKNET, g + 3)).toBe(2);
    expect(beaconRoundAt(DRAND_QUICKNET, g + (20_000_000 - 1) * 3)).toBe(20_000_000);
    // api.drand.sh/public/latest returned round 33600306 at unix time 1793604284 (the fixture's roundFormula.check).
    expect(beaconRoundAt(DRAND_QUICKNET, 1_793_604_284)).toBe(33_600_306);
    // The forge suites' rounds: judgeBy 1790172800 and the round after an escalation at 1790000000.
    expect(beaconRoundAt(DRAND_QUICKNET, 1_790_172_800)).toBe(32_456_478);
    expect(beaconRoundAt(DRAND_QUICKNET, 1_790_000_000) + 1).toBe(32_398_879);
  });

  it('keeps the SimChain beacon at round(t) = t, the old floor(ms / 1000)', () => {
    for (const t of [0, 1, 2, 59, 1_700_000_000, 1_790_172_800]) expect(beaconRoundAt(SIM_BEACON, t)).toBe(t);
  });

  it('refuses a time that is not whole non-negative seconds', () => {
    expect(() => beaconRoundAt(SIM_BEACON, -1)).toThrow(RangeError);
    expect(() => beaconRoundAt(SIM_BEACON, 1.5)).toThrow(RangeError);
  });
});
