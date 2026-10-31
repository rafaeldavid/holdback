import { relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// CI runs the tests as parallel shards (`vitest run --shard=i/n`, T-022). Vitest's own shard cuts
// files sorted by path hash into equal counts, which put most of the heavy files in one shard. This
// packs them by cost instead, longest first, onto the shard with the least so far. Costs are local
// per-file times in tenths of a second (`vitest run --reporter=json`, T-022, with the pull-request
// property cap); a file not listed costs 2. A stale table changes only the balance: every file is
// still assigned to exactly one shard.
const COST: Record<string, number> = {
  'apps/adjudicator/src/service.test.ts': 145,
  'packages/testkit/src/runner.test.ts': 141,
  'packages/judgment/src/screen.test.ts': 109,
  'apps/demo/agents/agents.test.ts': 105,
  'apps/demo/src/cli.test.ts': 82,
  'packages/testkit/src/judgment.test.ts': 79,
  'packages/judgment/src/pipeline.test.ts': 62,
  'packages/judgment/src/redteam.test.ts': 57,
  'examples/examples.test.ts': 56,
  'packages/settlement/sim/properties.test.ts': 50,
  'tests/gen-demo-data.test.ts': 19,
  'packages/settlement/sim/simchain.test.ts': 19,
  'apps/operator/src/sim-world.test.ts': 17,
  'packages/core/src/crypto/envelope.test.ts': 16,
  'examples/verify.test.ts': 15,
  'apps/operator/src/operator.test.ts': 13,
  'apps/demo/src/transcript/untrusted.test.ts': 13,
  'apps/adjudicator/src/simchain-adapter.test.ts': 12,
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
