// T-413: early access's deploy fills BUILD_COMMIT, waits until join.crow.direct/version.json names the commit, and
// rolls back otherwise. Stand-ins for wrangler, git, the network and the clock: no test uploads, fetches or waits.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module without type declarations
import { deploy, versionProblem } from '../apps/early-access/deploy.mjs';

const COMMIT = '016c28e0123456789abcdef0123456789abcdef0';
const BEFORE = '545afdd8-1e1c-40ff-aa35-2eea83d9ec0e';
const AFTER = '6122d260-d59b-41a0-8699-3bc6cacaa354';
type Answer = { status: number; body: string };
const NAMES = (commit: string | null): Answer => ({ status: 200, body: JSON.stringify({ schema: 'crow.build/1', worker: 'crow-early-access', commit, deployedAt: null, versionId: null }) });
const statusJson = (v: string) => JSON.stringify({ id: 'd1', versions: [{ version_id: v, percentage: 100 }] });

async function run({ args = [] as string[], gitStatus = '', live = [BEFORE] as (string | null)[], upload = { code: 0, out: `Current Version ID: ${AFTER}\n` } as { code: number | null; out: string }, answers = [NAMES(COMMIT)] } = {}) {
  const commands: string[] = [], probes: { url: string; at: number }[] = [], out: string[] = [], err: string[] = [];
  const next = <T,>(list: T[]) => (list.length > 1 ? list.shift()! : list[0]!);
  const liveQ = [...live], answerQ = [...answers];
  let clock = Date.parse('2026-11-14T10:00:00Z');
  const t0 = clock;
  const code = await deploy({
    args,
    sh: async (cmd: string, a: string[]) => {
      const line = [cmd, ...a].join(' ');
      commands.push(line);
      if (cmd === 'git' && a[0] === 'status') return { code: 0, stdout: gitStatus, out: gitStatus };
      if (cmd === 'git' && a[0] === 'branch') return { code: 0, stdout: 'main\n', out: '' };
      if (cmd === 'git') return { code: 0, stdout: `${COMMIT}\n`, out: '' };
      if (/ deployments status /.test(line)) {
        const v = next(liveQ);
        return v === null ? { code: 1, stdout: '', out: 'You are not logged in.' } : { code: 0, stdout: statusJson(v), out: '' };
      }
      if (/ rollback /.test(line)) return { code: 0, stdout: '', out: '' };
      if (/ deploy /.test(line)) return { stdout: '', ...upload };
      throw new Error(`unexpected command: ${line}`);
    },
    probe: async (url: string) => (probes.push({ url, at: clock - t0 }), next(answerQ)),
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    log: (s: string) => out.push(s),
    error: (s: string) => err.push(s),
  });
  const wrangler = commands.filter((c) => c.startsWith('npx ')).map((c) => c.replace('npx -y wrangler@4 ', ''));
  return { code, wrangler, probes, err: err.join('\n'), record: out.join('\n').split('\n').find((l) => l.startsWith('**Early access deploy')) };
}
const STATUS = 'deployments status --name crow-early-access --json';
const UPLOAD = `deploy --config apps/early-access/wrangler.jsonc --var BUILD_COMMIT:${COMMIT}`;

describe('what one answer from /version.json means', () => {
  it('passes only when it names the commit', () => {
    expect(versionProblem(NAMES(COMMIT), COMMIT)).toBeNull();
    expect(versionProblem(NAMES(null), COMMIT)).toBe('it names no commit');
    expect(versionProblem(NAMES('a'.repeat(40)), COMMIT)).toBe('it names commit aaaaaaa, not 016c28e');
    expect(versionProblem({ status: 404, body: '{}' }, COMMIT)).toBe('HTTP 404');
    expect(versionProblem({ status: 0, body: '' }, COMMIT)).toBe('no answer');
    expect(versionProblem({ status: 200, body: '<!doctype html>' }, COMMIT)).toBe('HTTP 200, but the body is not JSON');
  });
});

describe("early access's deploy", () => {
  it('uploads with BUILD_COMMIT, waits until version.json names it, and exits 0', async () => {
    const r = await run({ answers: [NAMES('a'.repeat(40)), { status: 0, body: '' }, NAMES(COMMIT)] });
    expect(r.code).toBe(0);
    expect(r.wrangler).toEqual([STATUS, UPLOAD]);
    expect(r.probes.map((p) => p.at)).toEqual([0, 5000, 10_000]);
    expect(r.probes.every((p) => p.url === 'https://join.crow.direct/version.json')).toBe(true);
    expect(r.record).toBe(`**Early access deploy 2026-11-14 10:00 UTC, commit \`016c28e\` on branch \`main\`: pass.** crow-early-access \`${AFTER}\` (rollback target \`${BEFORE}\`).`);
  });

  it('refuses any argument and a checkout with a tracked change, before wrangler runs', async () => {
    expect((await run({ args: ['--dry-run'] })).wrangler).toEqual([]);
    expect((await run({ args: ['--dry-run'] })).code).toBe(2);
    const dirty = await run({ gitStatus: ' M apps/early-access/worker.js' });
    expect(dirty.code).toBe(2);
    expect(dirty.wrangler).toEqual([]);
  });

  it('rolls back when version.json never names the commit within 120 s', async () => {
    const r = await run({ live: [BEFORE, AFTER, BEFORE], answers: [NAMES(null)] });
    expect(r.code).toBe(1);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS, `rollback ${BEFORE} --name crow-early-access --message node apps/early-access/deploy.mjs failed a check --yes`, STATUS]);
    expect(r.err).toContain('did not name commit 016c28e within 120 s (last answer: it names no commit)');
    expect(r.record).toContain('rolled back');
  });

  it('uploads nothing when wrangler cannot say which version is live', async () => {
    const r = await run({ live: [null] });
    expect(r.code).toBe(1);
    expect(r.wrangler).toEqual([STATUS]);
  });
});
