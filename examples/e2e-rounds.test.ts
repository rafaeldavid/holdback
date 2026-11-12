// The round's beacon-round rule against core's (ADR-0032, T-386). The round's scenarios 4 and 5b expect the fallback's
// and the appeal adjudicator's beacon rounds. On anvil the contract's BEACON_MARGIN is 0, where a rule that left the
// margin out would still pass, so this test fixes the rule with Sepolia's 29 s margin and drand quicknet's clock.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { root } from './e2e-world.ts';
import { fallbackRound, QUICKNET, roundAfter, SIM } from './e2e-scenarios-silent.ts';

// examples/ is no workspace package: core is reached through apps/demo-cloud, as send-timeout.test.ts reaches the adapter.
const core = await import(pathToFileURL(createRequire(join(root, 'apps/demo-cloud/package.json')).resolve('@holdback/core')).href);
const DRAND_QUICKNET = core.DRAND_QUICKNET as { genesis: number; period: number };
const coreRoundAfter = core.roundAfter as (c: { genesis: number; period: number }, lastChoiceSec: number, marginSec: number) => number;

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("the round's beacon rounds equal the contract's and core's (ADR-0032)", () => {
  it('uses the same drand quicknet clock as core', () => {
    expect(QUICKNET).toEqual(DRAND_QUICKNET);
  });

  it('with a 29 s margin, the first round after lastChoice + 29 s, as core computes it, for every second of two periods', () => {
    const base = sec('2026-11-12T15:00:00Z');
    for (let t = base; t < base + 6; t++) {
      for (const margin of [0, 29]) {
        expect(roundAfter(QUICKNET, t, margin), `t ${t}, margin ${margin}`).toBe(coreRoundAfter(DRAND_QUICKNET, t, margin));
      }
    }
  });

  it("the fallback's round is the first after judgeBy − 1 + the margin: about ten quicknet rounds later on Sepolia than at a margin of 0", () => {
    const judgeBy = '2026-11-12T15:00:02Z';
    const atZero = fallbackRound(QUICKNET, judgeBy, 0);
    const onSepolia = fallbackRound(QUICKNET, judgeBy, 29);
    expect(onSepolia).toBe(coreRoundAfter(DRAND_QUICKNET, sec(judgeBy) - 1, 29));
    expect(onSepolia - atZero).toBeGreaterThanOrEqual(9);
    expect(onSepolia - atZero).toBeLessThanOrEqual(10);
    // The round's old expectation, the latest round at or before judgeBy, is another round once the margin is 29 s.
    const old = Math.floor((sec(judgeBy) - QUICKNET.genesis) / QUICKNET.period) + 1;
    expect(onSepolia).not.toBe(old);
  });

  it("on SimChain's clock and a 0 s margin the rule equals the round at judgeBy, which is why anvil and SimChain never showed the old rule wrong", () => {
    const judgeBy = '2026-11-12T15:00:02Z';
    expect(fallbackRound(SIM, judgeBy, 0)).toBe(sec(judgeBy));
  });
});
