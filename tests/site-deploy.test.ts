// T-313: `pnpm site:deploy` checks itself. The run is tested with stand-ins for git, the build, wrangler, the network
// and the clock, so no test builds, uploads, fetches or waits.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commitOf } from '../site/build.mjs';
import { deploy, siteProblem } from '../site/deploy.mjs';

const BEFORE = '545afdd8-1e1c-40ff-aa35-2eea83d9ec0e';
const AFTER = '6122d260-d59b-41a0-8699-3bc6cacaa354';
const SITE = 'https://crow.direct/';
const LLMS = Buffer.from('# Crow\n\nOP1=https://api.crow.direct\nOP2=https://api2.crow.direct\n');
const TRY = Buffer.from('// try.mjs: one test deal\n');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const BUILT = { llms: LLMS, trySha256: sha256(TRY) };

type Answer = { status: number; body: Buffer };
const ok = (body: Buffer | string = ''): Answer => ({ status: 200, body: Buffer.from(body) });
const GOOD = { home: ok('<!doctype html>'), llms: ok(LLMS), tryMjs: ok(TRY) };

describe('what one read of the live site means', () => {
  it('has no problem when the page answers 200, llms.txt is the built file and try.mjs hashes to the pin', () => {
    expect(siteProblem(GOOD, BUILT)).toBeNull();
  });

  it('names the first file that is not what the build made', () => {
    expect(siteProblem({ ...GOOD, home: { status: 503, body: Buffer.alloc(0) } }, BUILT)).toBe(`${SITE} did not answer 200 (last answer: HTTP 503)`);
    expect(siteProblem({ ...GOOD, llms: { status: 0, body: Buffer.alloc(0) } }, BUILT)).toBe(`${SITE}llms.txt did not answer 200 (last answer: no answer)`);
    expect(siteProblem({ ...GOOD, llms: ok('# Crow\n\nOP1=https://api.escrow.stream\n') }, BUILT)).toBe(`${SITE}llms.txt answered 200, but its body is not the built reports/site-out/llms.txt`);
    // One changed byte in try.mjs breaks the one command's `shasum -c` for every stranger who runs it.
    const other = Buffer.from('// try.mjs: one test deal \n');
    expect(siteProblem({ ...GOOD, tryMjs: ok(other) }, BUILT)).toBe(`${SITE}try.mjs answered 200, but its SHA-256 starts ${sha256(other).slice(0, 12)}, and the build pinned ${BUILT.trySha256.slice(0, 12)}`);
    // A 404 page is not try.mjs, whatever its body.
    expect(siteProblem({ ...GOOD, tryMjs: { status: 404, body: TRY } }, BUILT)).toBe(`${SITE}try.mjs did not answer 200 (last answer: HTTP 404)`);
  });
});

interface Stage {
  args?: string[];
  /** What `git status --porcelain --untracked-files=no` prints: the tracked files that differ from the commit. */
  status?: string;
  build?: number;
  check?: number;
  /** What `wrangler deployments status` answers, call by call; the last answer repeats. null: wrangler cannot say. */
  live?: (string | null)[];
  upload?: { code: number | null; out: string };
  /** What https://crow.direct/try.mjs answers, poll by poll; the last answer repeats. */
  tryMjs?: Answer[];
}
const UPLOADED = { code: 0, out: `Uploaded crow-site (2.10 sec)\nCurrent Version ID: ${AFTER}\n` };

/** Runs the deploy against stand-ins and a clock that only `sleep` moves. */
async function run(stage: Stage = {}) {
  const commands: string[] = [], probes: { url: string; at: number }[] = [], out: string[] = [], err: string[] = [];
  const next = <T,>(list: T[]) => (list.length > 1 ? list.shift()! : list[0]!);
  const live = [...(stage.live ?? [BEFORE])], tryMjs = [...(stage.tryMjs ?? [ok(TRY)])];
  let clock = Date.parse('2026-11-11T09:05:59Z');
  const t0 = clock;
  const code = await deploy({
    args: stage.args ?? [],
    clean: () => void commands.push('empty reports/site-out'),
    sh: async (cmd: string, args: string[]) => {
      const line = [cmd === process.execPath ? 'node' : cmd, ...args].join(' ');
      commands.push(line);
      if (cmd === 'git' && args[0] === 'status') return { code: 0, stdout: stage.status ?? '', out: stage.status ?? '' };
      if (cmd === 'git' && args[0] === 'branch') return { code: 0, stdout: 't-313-deploy-lib\n', out: '' };
      if (cmd === 'git') return { code: 0, stdout: '016c28e0123456789abcdef0123456789abcdef0\n', out: '' };
      if (line.startsWith('node site/build.mjs ')) return { code: stage.build ?? 0, stdout: '', out: '' };
      if (line === 'node site/check.mjs') return { code: stage.check ?? 0, stdout: '', out: '' };
      if (/ deployments status /.test(line)) {
        const v = next(live);
        return v === null ? { code: 1, stdout: '', out: 'You are not logged in.' } : { code: 0, stdout: JSON.stringify({ versions: [{ version_id: v, percentage: 100 }] }), out: '' };
      }
      if (/ rollback /.test(line)) return { code: 0, stdout: '', out: '' };
      if (/ deploy /.test(line)) return { stdout: '', ...(stage.upload ?? UPLOADED) };
      throw new Error(`the deploy ran a command the test does not expect: ${line}`);
    },
    probe: async (url: string) => {
      probes.push({ url, at: clock - t0 });
      return url === SITE ? ok('<!doctype html>') : url.endsWith('/llms.txt') ? ok(LLMS) : next(tryMjs);
    },
    built: () => BUILT,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    log: (s: string) => out.push(s),
    error: (s: string) => err.push(s),
  });
  const ran = commands.filter((c) => !c.startsWith('git ')).map((c) => c.replace('npx -y wrangler@4 ', ''));
  return { code, commands, ran, probes, out: out.join('\n'), err: err.join('\n'), record: out.join('\n').split('\n').find((l) => l.startsWith('**Site deploy')) };
}
const BUILD = 'node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/site-out';
const CHECK = 'node site/check.mjs';
// The output folder is emptied first: wrangler uploads all of it, and an older build's files must not ride along.
const CLEAN = 'empty reports/site-out';
const STATUS = 'deployments status --name crow-site --json';
const UPLOAD = 'deploy --config apps/site/wrangler.jsonc';
const ROLLBACK = `rollback ${BEFORE} --name crow-site --message pnpm site:deploy failed a check --yes`;

describe('pnpm site:deploy', () => {
  it('builds, checks, reads the live version, uploads, waits for the live files, and exits 0', async () => {
    // The old try.mjs is still served on the first poll.
    const r = await run({ tryMjs: [ok('// the try.mjs from before\n'), ok(TRY)] });
    expect(r.code).toBe(0);
    expect(r.ran).toEqual([CLEAN, BUILD, CHECK, STATUS, UPLOAD]);
    // The pre-flight ignores files changed inside a submodule: no deploy uploads from one.
    expect(r.commands).toContain('git status --porcelain --untracked-files=no --ignore-submodules=dirty');
    expect(r.probes).toEqual([0, 0, 0, 5000, 5000, 5000].map((at, i) => ({ url: [SITE, `${SITE}llms.txt`, `${SITE}try.mjs`][i % 3], at })));
    expect(r.record).toBe(`**Site deploy 2026-11-11 09:05 UTC, commit \`016c28e\` on branch \`t-313-deploy-lib\`: pass.** crow-site \`${AFTER}\` (rollback target \`${BEFORE}\`).`);
    expect(r.err).toBe('');
  });

  it('takes no arguments, and refuses a tracked change in the pre-flight: exit code 2, nothing built or uploaded', async () => {
    const args = await run({ args: ['--dry-run'] });
    expect(args.code).toBe(2);
    expect(args.commands).toEqual([]);
    expect(args.err).toBe('Refused: pnpm site:deploy takes no arguments (got --dry-run), and it deploys for real.');
    const changed = await run({ status: ' M site/llms.txt\n' });
    expect(changed.code).toBe(2);
    expect(changed.ran).toEqual([]);
    expect(changed.err).toMatch(/^Refused: 1 tracked file differs from the checked-out commit \(site\/llms\.txt\).* then run pnpm site:deploy again\.$/);
    expect(changed.out).toBe('');
  });

  it('uploads nothing when the build or site/check.mjs fails, and exits 1', async () => {
    const check = await run({ check: 1 });
    expect(check.code).toBe(1);
    expect(check.ran).toEqual([CLEAN, BUILD, CHECK]);
    expect(check.probes).toEqual([]);
    expect(check.record).toContain('FAIL, site/check.mjs failed, so nothing was uploaded.** crow-site `not deployed` (rollback target `unknown`).');
    const build = await run({ build: 1 });
    expect(build.code).toBe(1);
    expect(build.ran).toEqual([CLEAN, BUILD]);
  });

  it('uploads nothing when wrangler cannot say which version is live', async () => {
    const r = await run({ live: [null] });
    expect(r.code).toBe(1);
    expect(r.ran).toEqual([CLEAN, BUILD, CHECK, STATUS]);
    expect(r.record).toContain("FAIL, wrangler cannot read crow-site's live version");
  });

  it('exits 1 after a refused upload without a check or a rollback, when the live version did not change', async () => {
    const r = await run({ upload: { code: 1, out: 'Authentication error [code: 10000]' } });
    expect(r.code).toBe(1);
    expect(r.ran).toEqual([CLEAN, BUILD, CHECK, STATUS, UPLOAD, STATUS]);
    expect(r.probes).toEqual([]);
    expect(r.record).toContain(`FAIL, crow-site's upload was refused.** crow-site \`not deployed\` (rollback target \`${BEFORE}\`).`);
  });

  it('rolls back when the live try.mjs does not hash to the pin within 120 s, polling every 5 s', async () => {
    const stale = Buffer.from('// the try.mjs from before\n');
    const r = await run({ tryMjs: [ok(stale)], live: [BEFORE, AFTER, BEFORE] });
    expect(r.code).toBe(1);
    expect(r.probes.filter((p) => p.url === SITE).map((p) => p.at)).toEqual(Array.from({ length: 25 }, (_, i) => i * 5000));
    expect(r.ran).toEqual([CLEAN, BUILD, CHECK, STATUS, UPLOAD, STATUS, ROLLBACK, STATUS]);
    const why = `the live site did not pass its check within 120 s: ${SITE}try.mjs answered 200, but its SHA-256 starts ${sha256(stale).slice(0, 12)}, and the build pinned ${BUILT.trySha256.slice(0, 12)}`;
    expect(r.err).toContain(`FAIL: ${why}`);
    expect(r.record).toBe(`**Site deploy 2026-11-11 09:05 UTC, commit \`016c28e\` on branch \`t-313-deploy-lib\`: FAIL, ${why}.** crow-site \`${AFTER}\` (rollback target \`${BEFORE}\`, rolled back).`);
  });

  it('runs as a command: an argument is refused with exit code 2, before git or wrangler', () => {
    // Stand-ins first on the PATH say they ran and fail, so this run cannot reach git, the build or wrangler.
    const bin = mkdtempSync(join(tmpdir(), 'crow-site-deploy-bin-'));
    try {
      for (const name of ['git', 'npx', 'pnpm']) {
        writeFileSync(join(bin, name), `#!/bin/sh\necho "stand-in ${name} ran: $*"\nexit 1\n`);
        chmodSync(join(bin, name), 0o755);
      }
      const r = spawnSync(process.execPath, [fileURLToPath(new URL('../site/deploy.mjs', import.meta.url)), '--force'], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: bin }, timeout: 60_000 });
      expect(r.status).toBe(2);
      expect(r.stderr.trim()).toBe('Refused: pnpm site:deploy takes no arguments (got --force), and it deploys for real.');
      expect(r.stdout).toBe('');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('says so, and gives the command, when the rollback does not take', async () => {
    const r = await run({ tryMjs: [{ status: 404, body: Buffer.alloc(0) }], live: [BEFORE, AFTER, AFTER] });
    expect(r.code).toBe(1);
    expect(r.err).toContain(`ROLLBACK FAILED for crow-site. Run: npx wrangler@4 rollback ${BEFORE} --name crow-site`);
    expect(r.record).toContain(`(rollback target \`${BEFORE}\`, ROLLBACK FAILED).`);
  });
});

describe("version.json names the build's commit only when git says so (T-066, T-370)", () => {
  const HEAD = '0123456789abcdef0123456789abcdef01234567';
  const ok = (stdout: string) => ({ status: 0, stdout });
  it('names a clean checkout and nothing else', () => {
    expect(commitOf(ok(`${HEAD}\n`), ok(''))).toBe(HEAD);
    expect(commitOf({ status: 128, stdout: '' }, ok(''))).toBe(null);
    expect(commitOf(ok(HEAD), { status: 128, stdout: '' })).toBe(null);
    expect(commitOf(ok(HEAD), { status: null, stdout: '', error: new Error('git not found') })).toBe(null);
    expect(commitOf(ok(HEAD), ok(' M site/llms.txt\n'))).toBe(null);
    expect(commitOf(ok('main'), ok(''))).toBe(null);
  });
});
