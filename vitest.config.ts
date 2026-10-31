import { relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// CI runs the tests as parallel shards (`vitest run --shard=i/n`, T-022). Vitest's own shard cuts
// files sorted by path hash into equal counts, which put most of the heavy files in one shard. This
// packs them by cost instead, longest first, onto the shard with the least so far. Costs are the
// per-file times, hooks included, in tenths of a second, that the default reporter printed in a
// pull-request CI run (T-022, run 41227571431); a file not listed costs 2. A stale table changes
// only the balance: every file is still assigned to exactly one shard.
const COST: Record<string, number> = {
  'packages/testkit/src/runner.test.ts': 151,
  'packages/judgment/src/screen.test.ts': 141,
  'apps/adjudicator/src/service.test.ts': 139,
  'apps/demo/agents/agents.test.ts': 99,
  'apps/demo/src/cli.test.ts': 82,
  'packages/testkit/src/judgment.test.ts': 72,
  'examples/examples.test.ts': 68,
  'packages/settlement/sim/properties.test.ts': 64,
  'apps/demo/src/transcript/render.test.ts': 52,
  'apps/demo/src/transcript/narrate.test.ts': 51,
  'apps/demo/src/source/simchain.test.ts': 51,
  'packages/judgment/src/pipeline.test.ts': 48,
  'packages/judgment/src/redteam.test.ts': 45,
  'apps/operator/src/sim-world.test.ts': 20,
  'examples/verify.test.ts': 20,
  'tests/gen-demo-data.test.ts': 18,
  'packages/settlement/sim/simchain.test.ts': 18,
  'apps/demo/src/transcript/untrusted.test.ts': 13,
  'apps/operator/src/operator.test.ts': 13,
  'packages/core/src/crypto/envelope.test.ts': 12,
  'apps/adjudicator/src/simchain-adapter.test.ts': 11,
  'packages/core/src/parse.test.ts': 6,
  'packages/core/src/money/lint.test.ts': 6,
  'apps/operator/src/neutrality.test.ts': 6,
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
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'packages/settlement/sim/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/demo/agents/**/*.test.ts', 'examples/*.test.ts'],
    sequence: { sequencer: BalancedSequencer },
  },
});
