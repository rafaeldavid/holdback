import { relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// CI runs the tests as parallel shards (`vitest run --shard=i/n`, T-022). Vitest's own shard cuts
// files sorted by path hash into equal counts, which put most of the heavy files in one shard. This
// packs them by cost instead, longest first, onto the shard with the least so far. Costs are the
// per-file times, hooks included, in tenths of a second, that the default reporter printed in a
// pull-request CI run (T-313, run 42802205136, 2026-11-10: every file at half a second or more, 57 of
// 134); a file not listed costs 2. Before this table the four shards ran 63, 161, 106 and 224 s of
// tests. A stale table changes only the balance: every file is still assigned to exactly one shard.
// To refresh it, sum the "✓ <file> (<n> tests) <ms>" lines of the four test jobs' logs.
const COST: Record<string, number> = {
  'examples/e2e-scenarios-silent.test.ts': 1189,
  'examples/e2e-scenarios-scripted.test.ts': 592,
  'examples/e2e-round.test.ts': 541,
  'apps/adjudicator/src/service.test.ts': 421,
  'examples/e2e-adjudicator.test.ts': 367,
  'examples/e2e-scenarios-escalation.test.ts': 259,
  'examples/e2e-run.test.ts': 224,
  'packages/judgment/src/screen.test.ts': 132,
  'apps/test-agents/src/try.test.ts': 121,
  'packages/testkit/src/runner.test.ts': 105,
  'apps/demo-cloud/src/world.test.ts': 92,
  'examples/e2e-keys.test.ts': 88,
  'apps/test-agents/src/seller.test.ts': 86,
  'apps/demo/agents/agents.test.ts': 84,
  'apps/adjudicator/src/simchain-adapter.test.ts': 80,
  'packages/settlement/evm/read-after-write.test.ts': 78,
  'examples/try.test.ts': 77,
  'apps/demo/src/cli.test.ts': 75,
  'packages/settlement/sim/properties.test.ts': 69,
  'examples/examples.test.ts': 68,
  'packages/judgment/src/pipeline.test.ts': 59,
  'apps/demo/src/transcript/render.test.ts': 54,
  'apps/demo/src/source/simchain.test.ts': 51,
  'packages/testkit/src/judgment.test.ts': 46,
  'examples/e2e-settle.test.ts': 45,
  'apps/demo/src/transcript/narrate.test.ts': 43,
  'apps/operator/src/sim-world.test.ts': 42,
  'examples/seller-adapter.test.ts': 40, // T-318, measured locally at about 4 s; not yet measured in CI
  'examples/seller-adapter-job-api.test.ts': 35, // T-366, measured locally at about 3.5 s; not yet measured in CI
  'examples/seller-adapter-terms.test.ts': 30, // T-330, measured locally at about 3 s; not yet measured in CI
  'tests/contract/openapi.contract.test.ts': 36,
  'examples/buyer-signer-outcome.test.ts': 50, // T-325, measured locally at about 5 s; not yet measured in CI
  'examples/deal-record.test.ts': 30, // T-333, measured locally at about 2.6 s; not yet measured in CI
  'examples/verify.test.ts': 29,
  'packages/settlement/sim/simchain.test.ts': 23,
  'tools/sim/check.test.ts': 22,
  'examples/early-accept.test.ts': 21,
  'examples/private.test.ts': 21,
  'tools/sim/world.test.ts': 18,
  'apps/operator/src/agent-ready.test.ts': 15,
  'apps/operator/src/registrations.test.ts': 15,
  'packages/core/src/crypto/envelope.test.ts': 15,
  'apps/demo/src/transcript/untrusted.test.ts': 14,
  'examples/e2e-scenarios-direct.test.ts': 14,
  'packages/core/src/validators.test.ts': 14,
  'tests/gen-demo-data.test.ts': 14,
  'apps/operator/src/operator.test.ts': 13,
  'apps/demo-cloud/src/worker.test.ts': 12,
  'packages/core/src/state.test.ts': 12,
  'apps/adjudicator/src/drand.test.ts': 10,
  'packages/judgment/src/redteam.test.ts': 10,
  'apps/operator/src/fee.test.ts': 8,
  'examples/e2e-chain.test.ts': 7,
  'apps/demo-cloud/src/startup.test.ts': 5,
  'apps/operator/src/idempotency.test.ts': 5,
  'packages/core/src/eip712.test.ts': 5,
  'packages/core/src/money/lint.test.ts': 5,
  'packages/core/src/parse.test.ts': 5,
  'packages/judgment/src/sample.test.ts': 5,
  'tests/read-after-write.lint.test.ts': 5,
  'tests/spec.test.ts': 5,
  'tests/cut-feature-alignment.test.ts': 10, // T-354, measured locally at about 1 s; not yet measured in CI
};
const DEFAULT_COST = 2;

/** Splits files into `count` shards by cost; the same input gives the same split in every shard. */
export function balance(files: readonly string[], count: number): string[][] {
  const shards = Array.from({ length: count }, () => ({ cost: 0, files: [] as string[] }));
  const cost = (f: string) => COST[f] ?? DEFAULT_COST;
  const ordered = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const f of ordered) {
    const lightest = shards.reduce((min, s) => (s.cost < min.cost ? s : min));
    lightest.files.push(f);
    lightest.cost += cost(f);
  }
  return shards.map((s) => s.files);
}

class BalancedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { config } = this.ctx;
    if (!config.shard) return files;
    const path = (f: TestSpecification) => relative(config.root, f.moduleId).split('\\').join('/');
    const mine = new Set(balance(files.map(path), config.shard.count)[config.shard.index - 1]);
    return files.filter((f) => mine.has(path(f)));
  }
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'packages/settlement/sim/**/*.test.ts', 'packages/settlement/evm/**/*.test.ts','apps/*/src/**/*.test.ts', 'apps/demo/agents/**/*.test.ts', 'examples/*.test.ts', 'tools/sim/*.test.ts'],
    sequence: { sequencer: BalancedSequencer },
    // Whole-flow tests (demo beats, judged deals) take a few seconds alone and more under a full parallel
    // run; the 5 s default timed them out locally. Tests that need longer still set their own (T-035).
    testTimeout: 30_000,
  },
});
