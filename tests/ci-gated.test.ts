// T-313: a test file that skips without a tool or a variable runs somewhere in CI, or says here why not
// (docs/team.md, "A test that needs Foundry runs somewhere in CI"). CI's anvil job fails when one of its tests skips,
// so a gated file is safe only when that job names it. A gated file elsewhere skips in the test shards, which have
// no Foundry, and merges green: T-221's anvil end to end did, and seven suites of the demo world did until PR 263.
//
// So every gated test file is either named in .github/workflows/ci.yml or listed in EXEMPT with its reason. A new
// gated file fails this test until someone does one of the two. An entry that no longer applies fails it too.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ciAnvilPaths, gatedOutsideCi } from '../scripts/health.mjs';

const root = new URL('../', import.meta.url).pathname;

/** Gated test files that no CI step names, each with the reason CI does not have to run its gated part. */
const EXEMPT: Record<string, string> = {
  // A fork of Sepolia needs a Sepolia RPC, and CI configures no public endpoint. Each runs before a deploy.
  'apps/adjudicator/src/drand-fork.test.ts': 'needs SEPOLIA_FORK_RPC: a public RPC, which CI does not configure',
  'apps/demo-cloud/src/live-fork.test.ts': 'needs SEPOLIA_FORK_RPC: a public RPC, which CI does not configure',
  'apps/demo-cloud/src/predeploy-fork.test.ts': 'needs SEPOLIA_FORK_RPC: a public RPC, which CI does not configure',
  // Round 1's driver against the demo world on anvil. Each file's other suites run in the test shards. The anvil
  // halves take minutes, and one check is sensitive to machine load (docs/team.md, the row from T-231), so a job that
  // must not skip would fail on a slow runner. They run locally, with Foundry, in `pnpm test`.
  'examples/e2e-round.test.ts': "the round driver's anvil half: minutes long and load-sensitive; runs locally",
  'examples/e2e-scenarios-direct.test.ts': "the round driver's anvil half: minutes long and load-sensitive; runs locally",
  'examples/e2e-scenarios-escalation.test.ts': "the round driver's anvil half: minutes long and load-sensitive; runs locally",
  'examples/e2e-scenarios-scripted.test.ts': "the round driver's anvil half: minutes long and load-sensitive; runs locally",
  'examples/e2e-scenarios-silent.test.ts': "the round driver's anvil half: minutes long and load-sensitive; runs locally",
  'examples/e2e-settle.test.ts': "the round driver's anvil half: minutes long and load-sensitive; runs locally",
  // T-365: the anvil half takes about 85 s and runs locally, with Foundry, in `pnpm test`. Naming it in the anvil
  // job's world leg is a CI change (kind 11), which Rafa approves; until then its offline tests run in the shards.
  'examples/send-timeout.test.ts': "send-timeout's anvil half: runs locally until CI's anvil job names it (kind 11, Rafa)",
  // Gated on the platform, not on a tool: the cases run in the test shards, on Linux as a user who is not root.
  'packages/core/src/store/store.test.ts': 'gated on mkfifo and on not being root: both hold on the CI runners',
  // A wall-clock run at 10 MB, off unless HOLDBACK_PERF=1: tests do not assert on wall-clock time (docs/team.md).
  'packages/judgment/src/redteam.test.ts': 'an opt-in performance run (HOLDBACK_PERF=1), off by design',
};

const tracked = execFileSync('git', ['ls-files', 'apps/', 'packages/', 'examples/', 'tools/', 'tests/'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n')
  .filter((p) => p.endsWith('.test.ts'));
const tests = tracked.map((path) => ({ path, text: readFileSync(`${root}${path}`, 'utf8') }));
const named = ciAnvilPaths(readFileSync(`${root}.github/workflows/ci.yml`, 'utf8'));

describe('gated test files and CI', () => {
  it('CI names test paths that exist, so a renamed file cannot drop out of the anvil job unseen', () => {
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((p) => !existsSync(`${root}${p}`))).toEqual([]);
  });

  it('every gated test file is named in CI or exempt here with a reason', () => {
    const outside = gatedOutsideCi(tests, named).sort();
    // A file in the first list is gated and runs nowhere in CI: name it in the anvil job, or exempt it with a reason.
    expect(outside.filter((p) => !(p in EXEMPT))).toEqual([]);
    // A file in the second list is exempt for nothing: CI names it now, its gate is gone, or the file is.
    expect(Object.keys(EXEMPT).filter((p) => !outside.includes(p))).toEqual([]);
    for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(20);
  });
});
