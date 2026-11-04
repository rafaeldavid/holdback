// The seed encodings must match T-006's SimChain and core: a mismatch would make every fallback and
// appeal decision fail the settlement layer's seed check.
import { beaconRoundFor, DRAND_QUICKNET, SIM_BEACON, type EscrowState, type Hex32 } from '@holdback/core';
import { SimChain, simCast, simClub, simGenesis } from '@holdback/settlement/sim';
import { concat, keccak256, numberToBytes, stringToBytes, toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { panelSeed, roundFor, simBeacon, simRoundAt } from './randomness.js';

const ID: Hex32 = `0x${'11'.repeat(32)}`;
const V: Hex32 = `0x${'22'.repeat(32)}`;
const SIM: Hex32 = `0x${'33'.repeat(32)}`;

describe('ADR-0018 encodings', () => {
  it('panelSeed = keccak256(id || role || uint8 attempt || value)', () => {
    expect(panelSeed(ID, 'fallback', 1, V)).toBe(keccak256(concat([toBytes(ID), stringToBytes('fallback'), new Uint8Array([1]), toBytes(V)])));
  });
  it('sim beacon value = keccak256(simSeed || uint64 round), published once the clock reaches the round', async () => {
    let now = '2026-11-01T10:02:00Z';
    const b = simBeacon(SIM, () => now);
    expect(b.kind).toBe('sim');
    expect(b.clock).toBe(SIM_BEACON);
    const round = simRoundAt(now);
    expect(await b.value(round)).toEqual({ value: keccak256(concat([toBytes(SIM), numberToBytes(BigInt(round), { size: 8 })])) });
    expect(await b.value(round + 1)).toBeNull();
    now = '2026-11-01T10:02:01Z';
    expect(await b.value(round + 1)).not.toBeNull();
  });
  it('rounds: judgeBy for the fallback; strictly after for the appeal', () => {
    expect(roundFor('fallback', '2026-11-01T10:02:00Z', SIM_BEACON)).toBe(simRoundAt('2026-11-01T10:02:00Z'));
    expect(roundFor('appeal', '2026-11-01T10:02:00.999Z', SIM_BEACON)).toBe(simRoundAt('2026-11-01T10:02:00Z') + 1);
  });
  it.each([
    ['the sim beacon', 'sim', SIM_BEACON],
    ['drand quicknet (T-217)', 'drand-quicknet', DRAND_QUICKNET],
  ] as const)("roundFor agrees with core's beaconRoundFor for the times the port reports, on %s", (_name, beaconSource, clock) => {
    for (const [judgeBy, at] of [
      ['2026-11-01T10:02:00Z', '2026-11-01T10:01:30Z'],
      ['2026-11-01T10:02:01Z', '2026-11-01T10:01:32Z'],
      ['2023-08-23T15:09:26Z', '2023-08-23T15:09:27Z'], // a second before quicknet's genesis, and genesis itself
    ] as const) {
      const fallback = { kind: 'Delivered', beaconSource, terms: { timing: { judgeBy } } } as unknown as EscrowState;
      const escalated = { kind: 'Escalated', beaconSource, escalation: { at } } as unknown as EscrowState;
      expect(roundFor('fallback', judgeBy, clock)).toBe(beaconRoundFor(fallback, 'fallback'));
      expect(roundFor('appeal', at, clock)).toBe(beaconRoundFor(escalated, 'appeal'));
    }
  });
  it("simBeacon matches T-006's SimChain beacon round for round", async () => {
    const cast = simCast('t009-beacon');
    const chain = new SimChain(await simGenesis({ cast, club: simClub(cast.appeal.address), start: '2026-11-01T09:00:00Z', simSeed: SIM }));
    const b = simBeacon(SIM, () => chain.now());
    const round = simRoundAt(chain.now());
    for (const r of [round - 100, round - 1, round]) expect((await b.value(r))?.value).toBe(chain.beacon(r));
    expect(chain.beacon(round + 1)).toBeNull();
    expect(await b.value(round + 1)).toBeNull();
  });
});
