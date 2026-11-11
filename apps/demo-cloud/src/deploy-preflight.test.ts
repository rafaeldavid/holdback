// T-313: the pre-flight of `pnpm demo-cloud:deploy`. The decision is a pure function (scripts/preflight.mjs), tested
// with plain facts. The script itself then runs in temporary git repositories whose `origin` is a local bare
// repository, with stand-ins for pnpm and npx first on the PATH: no network, no build, no wrangler, no upload.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script without type declarations
import { preflight } from '../scripts/preflight.mjs';

type Facts = { branch: string; status: { code: number | null; out: string }; fetch: { code: number | null; out: string }; ancestor: { code: number | null; out: string } };
const refusal = preflight as (facts: Facts) => string | null;

const ok = { code: 0, out: '' };
const clean: Facts = { branch: 'main', status: ok, fetch: ok, ancestor: ok };

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
    expect(many).toMatch(/commit or stash/);
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
    expect(refusal({ branch: 'x', status: { code: 0, out: ' M a.ts' }, fetch: bad, ancestor: bad })).toMatch(/tracked file differs/);
    expect(refusal({ branch: 'x', status: ok, fetch: bad, ancestor: bad })).toMatch(/git fetch origin main/);
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

  /** A repository with the two scripts at their real paths, pushed to a local bare `origin`, on branch t-999-deploy. */
  function repo() {
    const origin = temp('crow-deploy-origin-');
    git(origin, 'init', '-q', '--bare', '-b', 'main');
    const root = temp('crow-deploy-repo-');
    git(root, 'init', '-q', '-b', 'main');
    mkdirSync(join(root, 'apps/demo-cloud/scripts'), { recursive: true });
    for (const f of ['deploy.mjs', 'preflight.mjs']) copyFileSync(fileURLToPath(new URL(`../scripts/${f}`, import.meta.url)), join(root, 'apps/demo-cloud/scripts', f));
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
