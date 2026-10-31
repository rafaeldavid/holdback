// The seed encodings must match T-006's SimChain and core: a mismatch would make every fallback and
// appeal decision fail the settlement layer's seed check.
import { beaconRoundFor, type EscrowState, type Hex32 } from '@holdback/core';
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
    const round = simRoundAt(now);
    expect(await b.value(round)).toBe(keccak256(concat([toBytes(SIM), numberToBytes(BigInt(round), { size: 8 })])));
    expect(await b.value(round + 1)).toBeNull();
    now = '2026-11-01T10:02:01Z';
    expect(await b.value(round + 1)).not.toBeNull();
  });
  it('rounds: judgeBy for the fallback; strictly after for the appeal', () => {
    expect(roundFor('fallback', '2026-11-01T10:02:00Z')).toBe(simRoundAt('2026-11-01T10:02:00Z'));
    expect(roundFor('appeal', '2026-11-01T10:02:00.999Z')).toBe(simRoundAt('2026-11-01T10:02:00Z') + 1);
  });
  it("roundFor agrees with core's beaconRoundFor for the times the port reports", () => {
    const judgeBy = '2026-11-01T10:02:00Z';
    const at = '2026-11-01T10:01:30Z';
    const fallback = { kind: 'Delivered', terms: { timing: { judgeBy } } } as unknown as EscrowState;
    const escalated = { kind: 'Escalated', escalation: { at } } as unknown as EscrowState;
    expect(roundFor('fallback', judgeBy)).toBe(beaconRoundFor(fallback, 'fallback'));
    expect(roundFor('appeal', at)).toBe(beaconRoundFor(escalated, 'appeal'));
  });
  it("simBeacon matches T-006's SimChain beacon round for round", async () => {
    const cast = simCast('t009-beacon');
    const chain = new SimChain(await simGenesis({ cast, club: simClub(cast.appeal.address), start: '2026-11-01T09:00:00Z', simSeed: SIM }));
    const b = simBeacon(SIM, () => chain.now());
    const round = simRoundAt(chain.now());
    for (const r of [round - 100, round - 1, round]) expect(await b.value(r)).toBe(chain.beacon(r));
    expect(chain.beacon(round + 1)).toBeNull();
    expect(await b.value(round + 1)).toBeNull();
  });
});
