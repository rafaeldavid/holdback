// T-313: `pnpm health` counts what it says it counts, on small samples, and its report keeps one shape.
import { describe, expect, it } from 'vitest';
import { ciAnvilPaths, duplicatedFacts, gatedOutsideCi, isSource, largeFiles, moduleState, report, swallowedErrors, table, testHooks, LARGE_LINES, SCHEMA_VERSION } from '../scripts/health.mjs';

const file = (path: string, text: string) => ({ path, text });

describe('health: which files count', () => {
  it('counts source that runs the demo, and leaves out tests, generated code, bundles and test helpers', () => {
    expect(isSource('apps/operator/src/server.ts')).toBe(true);
    expect(isSource('scripts/health.mjs')).toBe(true);
    expect(isSource('apps/operator/src/server.test.ts')).toBe(false);
    expect(isSource('packages/core/src/validators.generated.ts')).toBe(false);
    expect(isSource('site/try.mjs')).toBe(false);
    expect(isSource('apps/adjudicator/src/_sim.ts')).toBe(false);
    expect(isSource('apps/demo-cloud/test/anvil.ts')).toBe(false);
    expect(isSource('docs/api.md')).toBe(false);
  });
});

describe('health: the counters', () => {
  it('finds an error dropped with no log, by file and line', () => {
    const f = file('a.ts', 'const x = 1;\nawait put().catch(() => undefined);\ntry { go(); } catch {}\nawait get().catch((e) => log(e));\n');
    expect(swallowedErrors([f])).toEqual(['a.ts:2', 'a.ts:3']);
  });

  it('finds module-level state, and not state inside a class or a function', () => {
    const f = file('b.ts', 'let count = 0;\nconst names = new Map<string, string>();\nclass A {\n  private seen = new Set();\n}\nfunction g() {\n  let n = 0;\n}\nexport const LIMIT = 3;\nconst KNOWN = new Set([1, 2]);\n');
    expect(moduleState([f])).toEqual(['b.ts:1', 'b.ts:2']);
  });

  it('finds members that exist for tests', () => {
    const f = file('c.ts', 'class W {\n  secretsForTest(): string[] { return []; }\n  dropResponses = 0;\n  run() {}\n}\n');
    expect(testHooks([f])).toEqual(['c.ts:2', 'c.ts:3']);
  });

  it('counts the files that state one fact, and skips the Workers whose job is to forward the old host', () => {
    const files = [
      file('apps/demo-cloud/scripts/deploy.mjs', "const NODES = ['https://api.crow.direct'];"),
      file('examples/try.ts', "const op = 'https://api.crow.direct';"),
      file('apps/site/worker.js', "if (host === 'escrow.stream') redirect();"),
      file('scripts/x.mjs', "const old = 'https://api.escrow.stream';"),
    ];
    const facts = duplicatedFacts(files);
    expect(facts.find((f) => f.id === 'operator-url-1')).toMatchObject({ files: 2, extra: 1 });
    expect(facts.find((f) => f.id === 'old-host')).toMatchObject({ files: 1, where: ['scripts/x.mjs'] });
  });

  it('lists files over the line limit, largest first', () => {
    const big = file('big.ts', 'x\n'.repeat(LARGE_LINES + 5));
    const small = file('small.ts', 'x\n'.repeat(10));
    expect(largeFiles([small, big])).toEqual([{ path: 'big.ts', lines: LARGE_LINES + 6 }]);
  });

  it('reads the must-not-skip paths from the workflow, and lists gated test files outside them', () => {
    const workflow = '      - run: |\n          pnpm vitest run packages/settlement/evm packages/testkit/src/runner.test.ts --reporter=verbose | tee anvil-tests.log\n';
    expect(ciAnvilPaths(workflow)).toEqual(['packages/settlement/evm', 'packages/testkit/src/runner.test.ts']);
    const tests = [
      file('packages/settlement/evm/sync.test.ts', 'describe.skipIf(!ready)("x", () => {});'),
      file('packages/testkit/src/runner.test.ts', 'describe.skipIf(!ready)("x", () => {});'),
      file('apps/demo-cloud/src/live.test.ts', 'describe.skipIf(!ready)("x", () => {});'),
      file('apps/operator/src/operator.test.ts', 'describe("x", () => {});'),
    ];
    expect(gatedOutsideCi(tests, ciAnvilPaths(workflow))).toEqual(['apps/demo-cloud/src/live.test.ts']);
  });
});

describe('health: the report', () => {
  it('sums the counters under one schema version and prints a table', () => {
    const r = report({
      sources: [file('a.ts', 'let n = 0;\nawait put().catch(() => null);\n')],
      tests: [],
      workflow: '',
      commit: 'abc1234',
      generatedAt: '2026-11-11T00:00:00Z',
    });
    expect(r.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.counts).toEqual({ swallowedErrors: 1, moduleState: 1, testHooks: 0, duplicatedFacts: 0, largeFiles: 0, gatedSuitesOutsideCi: 0 });
    expect(table(r)).toContain('Errors dropped with no log');
    expect(table(r)).toContain('abc1234');
  });
});
