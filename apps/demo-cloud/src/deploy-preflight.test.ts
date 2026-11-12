// T-313: the pre-flight of `pnpm demo-cloud:deploy`, which every deploy runs. The decision is a pure function
// (scripts/deploy-lib.mjs at the repository root), tested with plain facts. The script itself then runs in temporary git repositories whose `origin` is a local bare
// repository, with stand-ins for pnpm and npx first on the PATH: no network, no build, no wrangler, no upload.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script without type declarations
import { preflight, waitForCommit } from '../../../scripts/deploy-lib.mjs';

type Facts = { command: string; branch: string; status: { code: number | null; out: string }; fetch: { code: number | null; out: string }; ancestor: { code: number | null; out: string } };
const refusal = preflight as (facts: Facts) => string | null;

const ok = { code: 0, out: '' };
const clean: Facts = { command: 'pnpm demo-cloud:deploy', branch: 'main', status: ok, fetch: ok, ancestor: ok };

describe('the deploy pre-flight decision', () => {
  it('lets a clean checkout that holds main deploy', () => {
    expect(refusal(clean)).toBeNull();
    expect(refusal({ ...clean, branch: 't-313-deploy-preflight' })).toBeNull();
  });

  it('refuses tracked files that differ from the commit, and names them', () => {
    const one = refusal({ ...clean, status: { code: 0, out: ' M apps/demo-cloud/src/worker.ts\n' } });
    expect(one).toMatch(/^Refused: 1 tracked file differs from the checked-out commit \(apps\/demo-cloud\/src\/worker\.ts\)/);
    const many = refusal({ ...clean, status: { code: 0, out: ['M  a.ts', ' M b.ts', 'D  c.ts', 'R  old.ts -> d.ts', ' M e.ts', ' M f.ts', ' M g.ts'].join('\n') } });
    expect(many).toMatch(/^Refused: 7 tracked files differ from the checked-out commit \(a\.ts, b\.ts, c\.ts, old\.ts -> d\.ts, e\.ts and 2 more\)/);
    expect(many).toMatch(/commit or stash the change, then run pnpm demo-cloud:deploy again\.$/);
    // Each deploy names its own command.
    expect(refusal({ ...clean, command: 'pnpm site:deploy', status: { code: 0, out: ' M site/llms.txt\n' } })).toMatch(/then run pnpm site:deploy again\.$/);
    expect(many!.split('\n')).toHaveLength(1);
  });

  it('refuses when git cannot read the status', () => {
    expect(refusal({ ...clean, status: { code: 128, out: 'fatal: not a git repository' } })).toMatch(/^Refused: git status failed/);
    expect(refusal({ ...clean, status: { code: null, out: '' } })).toMatch(/^Refused: git status failed/);
  });

  it('refuses when the fetch of main fails, whatever the ancestor check says', () => {
    const r = refusal({ ...clean, fetch: { code: 128, out: "warning: retrying\nfatal: unable to access 'https://github.com/': Could not resolve host\n" } });
    expect(r).toMatch(/^Refused: `git fetch origin main` failed \(fatal: unable to access 'https:\/\/github\.com\/': Could not resolve host\)/);
    expect(r!.split('\n')).toHaveLength(1);
    // A fetch that timed out has no exit code.
    expect(refusal({ ...clean, fetch: { code: null, out: '' } })).toMatch(/^Refused: `git fetch origin main` failed/);
  });

  it("refuses a checkout that lacks main's commits, and names the branch", () => {
    const r = refusal({ ...clean, branch: 't-100-old', ancestor: { code: 1, out: '' } });
    expect(r).toMatch(/^Refused: branch `t-100-old` lacks commits from origin\/main/);
    expect(r).toMatch(/custom domains/);
    expect(refusal({ ...clean, branch: '', ancestor: { code: 1, out: '' } })).toMatch(/^Refused: this detached checkout lacks commits from origin\/main/);
    // Any other exit code means git could not compare: no origin/main ref, say.
    expect(refusal({ ...clean, ancestor: { code: 128, out: 'fatal: Not a valid object name origin/main' } })).toMatch(/^Refused: git cannot compare this checkout with origin\/main/);
  });

  it('reports the tracked change first, then the fetch, then the missing commits', () => {
    const bad = { code: 1, out: '' };
    expect(refusal({ ...clean, branch: 'x', status: { code: 0, out: ' M a.ts' }, fetch: bad, ancestor: bad })).toMatch(/tracked file differs/);
    expect(refusal({ ...clean, branch: 'x', fetch: bad, ancestor: bad })).toMatch(/git fetch origin main/);
  });
});

describe('pnpm demo-cloud:deploy, before the build', () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const t of temps) rmSync(t, { recursive: true, force: true });
  });
  const temp = (prefix: string) => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    temps.push(d);
    return d;
  };

  /** Stand-ins for pnpm and npx: each says it ran and fails, so a run that reaches the build stops there. */
  const bin = temp('crow-deploy-bin-');
  for (const name of ['pnpm', 'npx']) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "stand-in ${name} ran: $*"\nexit 1\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const env = { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: bin, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  /** A repository with the deploy and the helper it imports at their real paths, pushed to a local bare `origin`, on branch t-999-deploy. */
  function repo() {
    const origin = temp('crow-deploy-origin-');
    git(origin, 'init', '-q', '--bare', '-b', 'main');
    const root = temp('crow-deploy-repo-');
    git(root, 'init', '-q', '-b', 'main');
    for (const f of ['apps/demo-cloud/scripts/deploy.mjs', 'scripts/deploy-lib.mjs']) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      copyFileSync(fileURLToPath(new URL(`../../../${f}`, import.meta.url)), join(root, f));
    }
    writeFileSync(join(root, 'tracked.txt'), 'one\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    git(root, 'remote', 'add', 'origin', origin);
    git(root, 'push', '-q', 'origin', 'main');
    git(root, 'checkout', '-q', '-b', 't-999-deploy');
    return { root, origin };
  }
  const deploy = (root: string, ...args: string[]) => spawnSync(process.execPath, [join(root, 'apps/demo-cloud/scripts/deploy.mjs'), ...args], { cwd: root, encoding: 'utf8', env, timeout: 60_000 });

  it('passes a clean checkout that holds main on to the build, and the record line names the branch', () => {
    const { root } = repo();
    writeFileSync(join(root, 'untracked.txt'), 'an untracked file does not block a deploy\n');
    const r = deploy(root);
    expect(r.stdout).toContain('stand-in pnpm ran');
    expect(r.stdout).not.toContain('stand-in npx ran');
    expect(r.stderr).toContain('FAIL: the build failed');
    expect(r.stdout).toMatch(new RegExp(`\\*\\*Deploy \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC, commit \`${git(root, 'rev-parse', 'HEAD').slice(0, 7)}\` on branch \`t-999-deploy\`: FAIL, the build failed\\.\\*\\*`));
    expect(r.status).toBe(1);
  });

  it('refuses a tracked change with exit code 2 and one sentence, before the build', () => {
    const { root } = repo();
    writeFileSync(join(root, 'tracked.txt'), 'two\n');
    const r = deploy(root);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toMatch(/^Refused: 1 tracked file differs from the checked-out commit \(tracked\.txt\).*\.$/);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
  });

  it("refuses a checkout that lacks main's commits with exit code 2, before the build", () => {
    const { root } = repo();
    // main moves on at origin; this branch stays behind.
    git(root, 'checkout', '-q', 'main');
    writeFileSync(join(root, 'tracked.txt'), 'two\n');
    git(root, 'commit', '-q', '-am', 'main moves on');
    git(root, 'push', '-q', 'origin', 'main');
    git(root, 'checkout', '-q', 't-999-deploy');
    const r = deploy(root);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toMatch(/^Refused: branch `t-999-deploy` lacks commits from origin\/main.*\.$/);
    expect(r.stdout).toBe('');
    // Merged, the same branch passes on to the build.
    git(root, 'merge', '-q', '--ff-only', 'main');
    expect(deploy(root).stdout).toContain('stand-in pnpm ran');
  });

  it('refuses with exit code 2 when the fetch of main fails, before the build', () => {
    const { root, origin } = repo();
    rmSync(origin, { recursive: true, force: true });
    const r = deploy(root);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toMatch(/^Refused: `git fetch origin main` failed.*\.$/);
    expect(r.stdout).toBe('');
  });

  it('still takes no arguments', () => {
    const { root } = repo();
    const r = deploy(root, '--force');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Refused: pnpm demo-cloud:deploy takes no arguments \(got --force\)/);
    expect(r.stdout).toBe('');
  });
});

describe('the deploy waits until discovery names the deployed commit (T-370)', () => {
  const NEW = '8d20405af9407d37ed790a2b533d3e52728f4b0b';
  const OLD = '00be274000000000000000000000000000000000';
  const NODES = ['https://op1.test', 'https://op2.test'];
  type Wait = (o: { nodes: string[]; commit: string; deadline: number; fetchImpl: unknown; sleep: (ms: number) => Promise<void>; now: () => number; everyMs?: number }) => Promise<{ failure: string | null; seconds: number }>;
  const wait = waitForCommit as Wait;
  /** A fake clock and a fetch that answers each node from a script of commits, one per read; the last repeats. */
  function world(answers: Record<string, Array<string | null | 'error'>>) {
    let t = 0;
    const reads: string[] = [];
    const fetchImpl = async (url: string) => {
      const node = url.replace(/\/$/, '');
      reads.push(node);
      const list = answers[node] ?? [];
      const a = list.length > 1 ? list.shift() : list[0];
      if (a === 'error') throw new Error('network');
      return new Response(JSON.stringify({ demo: { build: { commit: a ?? null } } }), { status: 200 });
    };
    return { reads, opts: { fetchImpl, now: () => t, sleep: async (ms: number) => void (t += ms), deadline: 600_000, nodes: NODES, commit: NEW, everyMs: 5000 } };
  }

  it('goes on at once when both nodes already name the commit', async () => {
    const w = world({ 'https://op1.test': [NEW], 'https://op2.test': [NEW] });
    expect(await wait(w.opts)).toEqual({ failure: null, seconds: 0 });
    expect(w.reads).toEqual(NODES);
  });

  it('waits through the previous commit, a failed read and a missing field until both name it', async () => {
    const w = world({ 'https://op1.test': [OLD, 'error', null, OLD, NEW], 'https://op2.test': [NEW] });
    expect(await wait(w.opts)).toEqual({ failure: null, seconds: 20 });
    expect(w.reads).toEqual([...Array(5).fill('https://op1.test'), 'https://op2.test']);
  });

  it('fails with the commit it saw once the deadline passes, so the deploy rolls back', async () => {
    const w = world({ 'https://op1.test': [NEW], 'https://op2.test': [OLD] });
    const r = await wait(w.opts);
    expect(r.failure).toBe('https://op2.test still names commit 00be274 in discovery, not 8d20405, after 605 s');
  });

  it('refuses to wait without a commit to look for', async () => {
    const w = world({});
    expect((await wait({ ...w.opts, commit: '' })).failure).toMatch(/no commit to look for/);
    expect(w.reads).toEqual([]);
  });
});

// ADR-0036 section 4 (T-377): the deal guard's decision, with plain facts. No network, no git.
// @ts-expect-error -- a plain ESM script without type declarations
import { guardDecision as guardDecisionUntyped } from '../../../scripts/deploy-lib.mjs';
import { defaultPolicy, KEPT_POLICIES, type KeptPolicies } from '@holdback/adjudicator';
import { policyHash, type AdjudicatorPolicy } from '@holdback/core';

type Deal = { id: string; state: string; nextDeadline?: string; policyHash: string; registryHash: string };
type Guarded = { refused: string | null; warnings: string[]; orphans: Deal[]; withdrawnOrphans: Deal[]; checked?: number };
const guardDecision = guardDecisionUntyped as (facts: {
  live: { kept: KeptPolicies | null; registrations: Array<{ policy: AdjudicatorPolicy; registryHash: string }> };
  next: KeptPolicies;
  deals: Deal[] | null;
  readError?: string;
  hashOf: (p: AdjudicatorPolicy) => string;
  override?: string | null;
}) => Guarded;

describe('the deal guard (ADR-0036 section 4)', () => {
  const REG = KEPT_POLICIES.registries[0]!.hash;
  const OTHER_REG = KEPT_POLICIES.registries[1]!.hash;
  const primary = defaultPolicy('demo-primary/p1');
  const registrations = [{ policy: primary, registryHash: REG }];
  const on = (screenVersion: string): string => policyHash({ ...primary, screenVersion });
  const deal = (id: string, screenVersion: string, registryHash = REG): Deal => ({ id, state: 'Held', nextDeadline: 'deliverBy 2026-11-20T10:00:00Z', policyHash: on(screenVersion), registryHash });
  const without = (k: KeptPolicies, version: string): KeptPolicies => ({ ...k, screens: k.screens.filter((s) => s.version !== version) });
  const withdraw = (k: KeptPolicies, version: string): KeptPolicies => ({ ...k, screens: k.screens.map((s) => (s.version === version ? { ...s, status: 'withdrawn' as const, decision: 'D-test', reason: 'a hard rule' } : s)) });
  const live = { kept: KEPT_POLICIES, registrations };
  const facts = { live, next: KEPT_POLICIES, deals: [deal('0x01', 'screen-0'), deal('0x02', 'screen-1')], hashOf: policyHash as (p: AdjudicatorPolicy) => string };

  it('passes a deploy that carries every version an open deal binds', () => {
    expect(guardDecision(facts)).toEqual({ refused: null, warnings: [], orphans: [], withdrawnOrphans: [], checked: 2 });
  });

  it('refuses a deploy that drops a version an open deal binds, and names the deal, its state and its next deadline', () => {
    const r = guardDecision({ ...facts, next: without(KEPT_POLICIES, 'screen-0') });
    expect(r.refused).toMatch(/^Refused: after this deploy the adjudicators could not judge 1 open deal the live build can judge:\n {2}0x01 Held, next deadline deliverBy 2026-11-20T10:00:00Z: the new build does not carry screen-0\n/);
    expect(r.orphans.map((o) => o.id)).toEqual(['0x01']);
  });

  it('refuses a deploy that drops a registry an open deal binds', () => {
    const next = { ...KEPT_POLICIES, registries: KEPT_POLICIES.registries.filter((x) => x.hash !== OTHER_REG) };
    const r = guardDecision({ ...facts, next, deals: [deal('0x03', 'screen-1', OTHER_REG)] });
    expect(r.refused).toMatch(/0x03 Held.*does not carry registry 0x6dc7342b/);
  });

  it('refuses a new default the live build does not carry: a new default ships in two deploys', () => {
    const next = { ...KEPT_POLICIES, default: { ...KEPT_POLICIES.default, screenVersion: 'screen-2' }, screens: [...KEPT_POLICIES.screens, { version: 'screen-2', status: 'kept' as const }] };
    expect(guardDecision({ ...facts, next }).refused).toMatch(/^Refused: the new default names screen-2, which the live build does not carry, so a rollback could not judge a deal accepted under it\. Ship it in two deploys/);
    // The second deploy, once the live build carries it, passes.
    expect(guardDecision({ ...facts, live: { ...live, kept: next }, next }).refused).toBeNull();
  });

  it('warns and goes on when the open deals cannot be read', () => {
    const r = guardDecision({ ...facts, next: without(KEPT_POLICIES, 'screen-0'), deals: null, readError: 'GET /v1/adjudicators answered 503' });
    expect(r.refused).toBeNull();
    expect(r.warnings).toEqual([expect.stringMatching(/^WARNING: the open deals could not be read \(GET \/v1\/adjudicators answered 503\)/)]);
  });

  it('honours the override for its named withdrawal only', () => {
    const next = withdraw(KEPT_POLICIES, 'screen-0');
    // Without the override the withdrawal still orphans the deal.
    expect(guardDecision({ ...facts, next }).refused).toMatch(/0x01 Held/);
    const ok = guardDecision({ ...facts, next, override: 'screen-0' });
    expect(ok.refused).toBeNull();
    expect(ok.withdrawnOrphans.map((o) => o.id)).toEqual(['0x01']);
    // A deal orphaned for another reason still refuses under the override.
    const both = { ...next, registries: next.registries.filter((x) => x.hash !== OTHER_REG) };
    expect(guardDecision({ ...facts, next: both, deals: [deal('0x01', 'screen-0'), deal('0x04', 'screen-1', OTHER_REG)], override: 'screen-0' }).refused).toMatch(/0x04 Held.*registry 0x6dc7342b/);
    // An override naming a version the file does not mark withdrawn is refused outright.
    expect(guardDecision({ ...facts, override: 'screen-1' }).refused).toMatch(/^Refused: HOLDBACK_DEPLOY_WITHDRAWN names "screen-1", which kept-policies\.json does not mark withdrawn/);
  });

  it('a deal the live build cannot judge either is not the deploy\'s to orphan', () => {
    const r = guardDecision({ ...facts, live: { ...live, kept: without(KEPT_POLICIES, 'screen-0') }, next: without(KEPT_POLICIES, 'screen-0') });
    expect(r.refused).toBeNull();
  });

  it('a policy neither build registered is reported, not checked', () => {
    const r = guardDecision({ ...facts, deals: [{ ...deal('0x05', 'screen-1'), policyHash: `0x${'ee'.repeat(32)}` }] });
    expect(r.refused).toBeNull();
    expect(r.warnings).toEqual([expect.stringMatching(/^WARNING: deal 0x05 \(Held\) binds policy 0xeeee.*which neither build registered; not checked\./)]);
  });

  it('the first deploy carrying both screens: a live build from before kept-policies.json carries exactly its registered defaults', () => {
    const first = { live: { kept: null, registrations }, next: KEPT_POLICIES, hashOf: policyHash as (p: AdjudicatorPolicy) => string };
    // Every open deal binds screen-1 on the live build today; the new build carries it: the guard passes.
    expect(guardDecision({ ...first, deals: [deal('0x06', 'screen-1')] })).toEqual({ refused: null, warnings: [], orphans: [], withdrawnOrphans: [], checked: 1 });
    // A deal still bound to screen-0 cannot be judged by the live build; the new build can, so nothing is orphaned.
    expect(guardDecision({ ...first, deals: [deal('0x07', 'screen-0')] }).refused).toBeNull();
  });
});
