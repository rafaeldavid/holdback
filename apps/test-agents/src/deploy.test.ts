// T-313: the test seller's deploy checks itself. Its decisions are pure functions (scripts/deploy-checks.mjs), tested
// with plain facts; the run itself is tested with stand-ins for wrangler, git, the network and the clock, so no test
// uploads, fetches or waits.
import { describe, expect, it } from 'vitest';
import { cardProblem, deploy, healthVerdict, liveVersion, recordLine, shouldRollBack } from '../scripts/deploy-checks.mjs';

const BEFORE = '545afdd8-1e1c-40ff-aa35-2eea83d9ec0e';
const AFTER = '6122d260-d59b-41a0-8699-3bc6cacaa354';
const SELLER = 'https://crow.direct/agents/test-seller';
const statusJson = (...versions: [string, number][]) => JSON.stringify({ id: 'd1', versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })) });

describe('the live version, from `wrangler deployments status --json`', () => {
  it('is the one version that serves all traffic', () => {
    expect(liveVersion(statusJson([BEFORE, 100]))).toBe(BEFORE);
  });

  it('is unknown for a split deployment, an empty answer or anything that is not JSON', () => {
    expect(liveVersion(statusJson([BEFORE, 50], [AFTER, 50]))).toBeNull();
    expect(liveVersion(statusJson([BEFORE, 90]))).toBeNull();
    expect(liveVersion(statusJson())).toBeNull();
    expect(liveVersion('{}')).toBeNull();
    expect(liveVersion('')).toBeNull();
    expect(liveVersion('You are not logged in.')).toBeNull();
    expect(liveVersion(JSON.stringify({ versions: [{ version_id: 7, percentage: 100 }] }))).toBeNull();
  });
});

describe("what one answer from the seller's /health means", () => {
  it('passes on 200 with status operational, whatever else the body carries', () => {
    expect(healthVerdict({ status: 200, body: '{"status":"operational","open":0}' })).toEqual({ verdict: 'pass' });
    expect(healthVerdict({ status: 200, body: '{"status":"operational","open":3}' })).toEqual({ verdict: 'pass' });
  });

  it('fails on degraded, and gives the reason on one line', () => {
    const v = healthVerdict({ status: 200, body: JSON.stringify({ status: 'degraded', open: 0, reason: 'its mandate has expired and the faucet did not renew it' }) });
    expect(v).toEqual({ verdict: 'fail', why: 'the seller reports degraded: its mandate has expired and the faucet did not renew it' });
    expect(healthVerdict({ status: 200, body: '{"status":"degraded"}' })).toEqual({ verdict: 'fail', why: 'the seller reports degraded' });
    // The reason is text from the network: it cannot break the record line's Markdown or run on.
    const odd = healthVerdict({ status: 200, body: JSON.stringify({ status: 'degraded', reason: `x\`**\n| [a](b) ${'y'.repeat(400)}` }) });
    expect(odd.why).toMatch(/^the seller reports degraded: [A-Za-z0-9 .,:;'()/-]{1,200}$/);
  });

  it('waits on anything else: no answer, another status code, a body that is not JSON or reads otherwise', () => {
    expect(healthVerdict({ status: 0, body: '' })).toEqual({ verdict: 'wait', why: 'no answer' });
    expect(healthVerdict({ status: 500, body: 'TEST_AGENTS_SEED is not set' })).toEqual({ verdict: 'wait', why: 'HTTP 500' });
    expect(healthVerdict({ status: 404, body: '{"status":"operational"}' })).toEqual({ verdict: 'wait', why: 'HTTP 404' });
    expect(healthVerdict({ status: 200, body: '<!doctype html>' })).toEqual({ verdict: 'wait', why: 'HTTP 200, but the body is not JSON' });
    expect(healthVerdict({ status: 200, body: '{"status":"starting"}' })).toEqual({ verdict: 'wait', why: 'HTTP 200, but the body does not read operational' });
    expect(healthVerdict({ status: 200, body: 'null' })).toEqual({ verdict: 'wait', why: 'HTTP 200, but the body does not read operational' });
    expect(healthVerdict({ status: 200, body: '"operational"' })).toEqual({ verdict: 'wait', why: 'HTTP 200, but the body does not read operational' });
  });
});

describe("what the answer from the seller's /agent.json means", () => {
  it('has no problem on 200 with a JSON object', () => {
    expect(cardProblem({ status: 200, body: '{"type":"crow-agent"}' })).toBeNull();
  });

  it('names the problem otherwise', () => {
    expect(cardProblem({ status: 0, body: '' })).toBe('no answer');
    expect(cardProblem({ status: 404, body: '{}' })).toBe('HTTP 404');
    expect(cardProblem({ status: 200, body: '<!doctype html>' })).toBe('HTTP 200, but the body is not a JSON object');
    expect(cardProblem({ status: 200, body: '[]' })).toBe('HTTP 200, but the body is not a JSON object');
    expect(cardProblem({ status: 200, body: 'null' })).toBe('HTTP 200, but the body is not a JSON object');
  });
});

describe('whether a failed deploy rolls back', () => {
  it('does not when nothing was uploaded, or the live version is still the one from before', () => {
    expect(shouldRollBack({ uploaded: false, before: BEFORE, now: AFTER })).toBe(false);
    expect(shouldRollBack({ uploaded: true, before: BEFORE, now: BEFORE })).toBe(false);
    expect(shouldRollBack({ uploaded: true, before: null, now: AFTER })).toBe(false);
  });

  it('does when the live version changed, or wrangler can no longer say which is live', () => {
    expect(shouldRollBack({ uploaded: true, before: BEFORE, now: AFTER })).toBe(true);
    expect(shouldRollBack({ uploaded: true, before: BEFORE, now: null })).toBe(true);
  });
});

describe('the record line for docs/operations.md', () => {
  const startedAt = new Date('2026-11-11T09:05:59Z');
  const commit = '016c28e0123456789abcdef0123456789abcdef0';

  it('gives the time in UTC, the commit, the new version, the rollback target and pass', () => {
    expect(recordLine({ startedAt, commit, version: AFTER, before: BEFORE, failure: null })).toBe(
      `**Test seller deploy 2026-11-11 09:05 UTC, commit \`016c28e\`: pass.** crow-test-agents \`${AFTER}\` (rollback target \`${BEFORE}\`).`,
    );
  });

  it('says FAIL with the reason, and whether the rollback worked', () => {
    const failure = 'https://crow.direct/agents/test-seller/health did not read operational within 120 s (last answer: HTTP 500)';
    expect(recordLine({ startedAt, commit, version: AFTER, before: BEFORE, failure, rolledBack: true })).toBe(
      `**Test seller deploy 2026-11-11 09:05 UTC, commit \`016c28e\`: FAIL, ${failure}.** crow-test-agents \`${AFTER}\` (rollback target \`${BEFORE}\`, rolled back).`,
    );
    expect(recordLine({ startedAt, commit, version: AFTER, before: BEFORE, failure, rolledBack: false })).toContain(`(rollback target \`${BEFORE}\`, ROLLBACK FAILED).`);
    expect(recordLine({ startedAt, commit, version: null, before: null, failure: 'x' })).toContain('crow-test-agents `not deployed` (rollback target `unknown`).');
    expect(recordLine({ startedAt, commit: '', version: null, before: BEFORE, failure: 'x' })).toContain('commit `unknown`');
  });
});

type Answer = { status: number; body: string };
interface Stage {
  args?: string[];
  /** What `wrangler deployments status` answers, call by call; the last answer repeats. null: wrangler cannot say. */
  live?: (string | null)[];
  upload?: { code: number | null; out: string };
  rollback?: { code: number | null };
  health?: Answer[];
  card?: Answer[];
}
const OPERATIONAL: Answer = { status: 200, body: '{"status":"operational","open":0}' };
const CARD: Answer = { status: 200, body: '{"type":"crow-agent"}' };
const UPLOADED = { code: 0, out: `Uploaded crow-test-agents (3.21 sec)\nCurrent Version ID: ${AFTER}\n` };

/** Runs the deploy against stand-ins and a clock that only `sleep` moves. */
async function run(stage: Stage) {
  const commands: string[] = [], probes: { url: string; at: number }[] = [], out: string[] = [], err: string[] = [];
  const next = <T,>(list: T[]) => (list.length > 1 ? list.shift()! : list[0]!);
  const live = [...(stage.live ?? [BEFORE])], health = [...(stage.health ?? [OPERATIONAL])], card = [...(stage.card ?? [CARD])];
  let clock = Date.parse('2026-11-11T09:05:59Z');
  const t0 = clock;
  const code = await deploy({
    args: stage.args ?? [],
    config: '/repo/apps/test-agents/wrangler.jsonc',
    sh: async (cmd: string, args: string[]) => {
      const line = [cmd, ...args].join(' ');
      commands.push(line);
      if (cmd === 'git') return { code: 0, stdout: '016c28e0123456789abcdef0123456789abcdef0\n', out: '' };
      if (/ deployments status /.test(line)) {
        const v = next(live);
        return v === null ? { code: 1, stdout: '', out: 'You are not logged in.' } : { code: 0, stdout: statusJson([v, 100]), out: '' };
      }
      if (/ rollback /.test(line)) return { code: (stage.rollback ?? { code: 0 }).code, stdout: '', out: '' };
      if (/ deploy /.test(line)) return { stdout: '', ...(stage.upload ?? UPLOADED) };
      throw new Error(`the deploy ran a command the test does not expect: ${line}`);
    },
    probe: async (url: string) => {
      probes.push({ url, at: clock - t0 });
      return url.endsWith('/health') ? next(health) : next(card);
    },
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    log: (s: string) => out.push(s),
    error: (s: string) => err.push(s),
  });
  const wrangler = commands.filter((c) => c.startsWith('npx ')).map((c) => c.replace('npx -y wrangler@4 ', ''));
  return { code, wrangler, probes, out: out.join('\n'), err: err.join('\n'), record: out.join('\n').split('\n').find((l) => l.startsWith('**Test seller deploy')) };
}
const STATUS = 'deployments status --name crow-test-agents --json';
const UPLOAD = 'deploy -c /repo/apps/test-agents/wrangler.jsonc';
const ROLLBACK = `rollback ${BEFORE} --name crow-test-agents --message apps/test-agents/scripts/deploy.mjs failed a check --yes`;

describe("the test seller's deploy", () => {
  it('reads the live version, uploads, waits for operational and the agent card, and exits 0', async () => {
    const r = await run({ health: [{ status: 500, body: '' }, { status: 0, body: '' }, OPERATIONAL] });
    expect(r.code).toBe(0);
    expect(r.wrangler).toEqual([STATUS, UPLOAD]);
    // One poll every 5 s; the card is read once the seller is operational.
    expect(r.probes).toEqual([
      { url: `${SELLER}/health`, at: 0 },
      { url: `${SELLER}/health`, at: 5000 },
      { url: `${SELLER}/health`, at: 10_000 },
      { url: `${SELLER}/agent.json`, at: 10_000 },
    ]);
    expect(r.record).toBe(`**Test seller deploy 2026-11-11 09:05 UTC, commit \`016c28e\`: pass.** crow-test-agents \`${AFTER}\` (rollback target \`${BEFORE}\`).`);
    expect(r.err).toBe('');
  });

  it('refuses before the upload when wrangler cannot say which version is live', async () => {
    const r = await run({ live: [null] });
    expect(r.code).toBe(1);
    expect(r.wrangler).toEqual([STATUS]);
    expect(r.probes).toEqual([]);
    expect(r.err).toMatch(/FAIL: wrangler cannot read crow-test-agents's live version/);
    expect(r.record).toContain('FAIL, wrangler cannot read crow-test-agents\'s live version');
    expect(r.record).toContain('crow-test-agents `not deployed` (rollback target `unknown`).');
  });

  it('exits 1 without a rollback when the upload is refused and the live version did not change', async () => {
    const r = await run({ upload: { code: 1, out: 'Authentication error [code: 10000]' } });
    expect(r.code).toBe(1);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS]);
    expect(r.probes).toEqual([]);
    expect(r.record).toBe(`**Test seller deploy 2026-11-11 09:05 UTC, commit \`016c28e\`: FAIL, crow-test-agents's upload was refused.** crow-test-agents \`not deployed\` (rollback target \`${BEFORE}\`).`);
  });

  it('rolls back an upload that failed after it changed the live version', async () => {
    const r = await run({ upload: { code: 1, out: `Current Version ID: ${AFTER}\nA route could not be set` }, live: [BEFORE, AFTER, BEFORE] });
    expect(r.code).toBe(1);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS, ROLLBACK, STATUS]);
    expect(r.record).toContain(`crow-test-agents \`${AFTER}\` (rollback target \`${BEFORE}\`, rolled back).`);
  });

  it('rolls back when the seller is not operational within 120 s, polling every 5 s', async () => {
    const r = await run({ health: [{ status: 500, body: 'TEST_AGENTS_SEED is not set' }], live: [BEFORE, AFTER, BEFORE] });
    expect(r.code).toBe(1);
    expect(r.probes.map((p) => p.at)).toEqual(Array.from({ length: 25 }, (_, i) => i * 5000));
    expect(r.probes.every((p) => p.url === `${SELLER}/health`)).toBe(true);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS, ROLLBACK, STATUS]);
    expect(r.err).toMatch(/FAIL: https:\/\/crow\.direct\/agents\/test-seller\/health did not read operational within 120 s \(last answer: HTTP 500\)/);
    expect(r.record).toBe(
      `**Test seller deploy 2026-11-11 09:05 UTC, commit \`016c28e\`: FAIL, ${SELLER}/health did not read operational within 120 s (last answer: HTTP 500).** crow-test-agents \`${AFTER}\` (rollback target \`${BEFORE}\`, rolled back).`,
    );
  });

  it('rolls back at once when the seller reports degraded', async () => {
    const r = await run({ health: [{ status: 200, body: '{"status":"degraded","open":0,"reason":"its mandate has expired and the faucet did not renew it"}' }], live: [BEFORE, AFTER, BEFORE] });
    expect(r.code).toBe(1);
    expect(r.probes).toHaveLength(1);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS, ROLLBACK, STATUS]);
    expect(r.record).toContain('FAIL, the seller reports degraded: its mandate has expired and the faucet did not renew it.**');
  });

  it('rolls back when the agent card never answers 200 with JSON', async () => {
    const r = await run({ card: [{ status: 200, body: '<!doctype html><title>Crow</title>' }], live: [BEFORE, AFTER, BEFORE] });
    expect(r.code).toBe(1);
    expect(r.probes).toHaveLength(50);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS, ROLLBACK, STATUS]);
    expect(r.record).toContain(`FAIL, ${SELLER}/agent.json did not answer 200 with a JSON object within 120 s (last answer: HTTP 200, but the body is not a JSON object).**`);
  });

  it('passes when the agent card answers on a later poll', async () => {
    const r = await run({ card: [{ status: 0, body: '' }, CARD] });
    expect(r.code).toBe(0);
    expect(r.probes.map((p) => p.at)).toEqual([0, 0, 5000, 5000]);
    expect(r.wrangler).toEqual([STATUS, UPLOAD]);
  });

  it('says so, and gives the command, when the rollback fails', async () => {
    const stuck = await run({ health: [{ status: 500, body: '' }], live: [BEFORE, AFTER, AFTER] });
    expect(stuck.code).toBe(1);
    expect(stuck.err).toContain(`ROLLBACK FAILED for crow-test-agents. Run: npx wrangler@4 rollback ${BEFORE} --name crow-test-agents`);
    expect(stuck.record).toContain(`(rollback target \`${BEFORE}\`, ROLLBACK FAILED).`);
    const refused = await run({ health: [{ status: 500, body: '' }], live: [BEFORE, AFTER, BEFORE], rollback: { code: 1 } });
    expect(refused.record).toContain('ROLLBACK FAILED');
  });

  it('rolls back when wrangler can no longer say which version is live', async () => {
    const r = await run({ health: [{ status: 500, body: '' }], live: [BEFORE, null, BEFORE] });
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS, ROLLBACK, STATUS]);
    expect(r.record).toContain(`crow-test-agents \`${AFTER}\` (rollback target \`${BEFORE}\`, rolled back).`);
  });

  it('treats an upload that names no new version as refused', async () => {
    const r = await run({ upload: { code: 0, out: 'Total Upload: 512.00 KiB' } });
    expect(r.code).toBe(1);
    expect(r.wrangler).toEqual([STATUS, UPLOAD, STATUS]);
    expect(r.record).toContain("FAIL, crow-test-agents's upload was refused.**");
  });

  it('passes its other arguments on to wrangler deploy', async () => {
    const r = await run({ args: ['--minify'] });
    expect(r.code).toBe(0);
    expect(r.wrangler).toEqual([STATUS, `${UPLOAD} --minify`]);
  });

  it('keeps --dry-run as it was: wrangler bundles, and nothing is read, checked or recorded', async () => {
    const ok = await run({ args: ['--dry-run'], upload: { code: 0, out: '--dry-run: exiting now.' } });
    expect(ok.code).toBe(0);
    expect(ok.wrangler).toEqual([`${UPLOAD} --dry-run`]);
    expect(ok.probes).toEqual([]);
    expect(ok.out).toBe('');
    expect((await run({ args: ['--dry-run'], upload: { code: 3, out: 'Build failed' } })).code).toBe(3);
    expect((await run({ args: ['--dry-run'], upload: { code: null, out: '' } })).code).toBe(1);
  });
});
