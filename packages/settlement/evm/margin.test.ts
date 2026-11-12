// ADR-0032 (T-380, R8 fix 2) on anvil: the rules contract deployed with a beacon margin of 7 s, the EVM adapter and
// core's mirror counting the same margin. A fallback decision and an escalation's decision settle for the margin
// rounds (judgeBy + 7 and t1 + 8 on the sim beacon, whose round(t) = t), and the rounds of the rule before ADR-0032
// (judgeBy and t1 + 1) are refused. With a margin of 0, as every other anvil suite runs, the rounds do not move.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beaconRoundFor } from '@holdback/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { must, newSettlement } from './gas.js';
import { EvmDeal } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
const MARGIN = 7;
const secs = (ts: string) => Math.floor(Date.parse(ts) / 1000);

describe.skipIf(!ready)(`the beacon margin on anvil (ADR-0032)${ready ? '' : ' (SKIPPED: needs anvil and contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root, { beaconMarginSec: MARGIN });
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  it('deploys the margin and the adapter counts it', async () => {
    const margin = await world.publicClient.readContract({ address: world.deployment.rules, abi: world.abis.rules, functionName: 'BEACON_MARGIN' });
    expect(Number(margin)).toBe(MARGIN);
    expect(world.beaconMarginSec).toBe(MARGIN);
  });

  it('settles the fallback for the round after judgeBy − 1 + margin, and refuses the round at judgeBy', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'margin-fallback');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    await must(chain, cast, d.agreeAndFund());
    await must(chain, cast, d.deliver());
    chain.advanceTo(d.terms.timing.judgeBy);
    await must(chain, cast, d.trigger('fallback'));
    const judgeBy = secs(d.terms.timing.judgeBy);
    const triggered = chain.log().find((e) => e.type === 'fallback.triggered' && e.commitmentId === d.id)!;
    expect((triggered.payload as { beaconRound: number }).beaconRound).toBe(judgeBy + MARGIN);
    expect(beaconRoundFor(chain.escrowState(d.id)!, 'fallback', MARGIN)).toBe(judgeBy + MARGIN);

    chain.advanceTo(new Date((judgeBy + MARGIN) * 1000).toISOString());
    const old = await chain.submit(await d.decide('fallback', 'accept', judgeBy), { via: 'op-1', sender: cast.operator.key });
    expect(old.ok ? 'settled' : old.problem.type).toBe('seed_mismatch');
    await must(chain, cast, d.decide('fallback', 'accept', judgeBy + MARGIN));
    expect(chain.escrowState(d.id)!.kind).toBe('Released');
  }, 60_000);

  it("settles an escalation for the round after its block + margin, and refuses the next round's", async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'margin-escalation');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    await must(chain, cast, d.agreeAndFund());
    await must(chain, cast, d.deliver());
    await must(chain, cast, d.decide('primary', 'escalate'));
    const s = chain.escrowState(d.id)!;
    if (s.kind !== 'Escalated') throw new Error(`expected Escalated, got ${s.kind}`);
    const at = secs(s.escalation.at);
    expect(beaconRoundFor(s, 'appeal', MARGIN)).toBe(at + MARGIN + 1);

    chain.advanceTo(new Date((at + MARGIN + 1) * 1000).toISOString());
    const old = await chain.submit(await d.decide('appeal', 'accept', at + 1), { via: 'op-1', sender: cast.operator.key });
    expect(old.ok ? 'settled' : old.problem.type).toBe('seed_mismatch');
    await must(chain, cast, d.decide('appeal', 'accept', at + MARGIN + 1));
    expect(chain.escrowState(d.id)!.kind).toBe('Released');
  }, 60_000);
});
