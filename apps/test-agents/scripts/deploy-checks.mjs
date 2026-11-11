// The test seller's deploy (T-313), without its effects: deploy.mjs passes in the shell, the network and the clock,
// so a test runs every path with stand-ins (apps/test-agents/src/deploy.test.ts). The decisions are pure functions:
// what a health answer means, whether to roll back, and the record line. The pre-flight, the live version and the
// rollback are the ones every deploy uses (scripts/deploy-lib.mjs).
import { checkout, liveVersion, recordLine as line, rollback } from '../../../scripts/deploy-lib.mjs';

export const WORKER = 'crow-test-agents';
export const SELLER = 'https://crow.direct/agents/test-seller';
/** The seller has this long after the upload to read operational and serve its agent card. */
export const CHECK_TIMEOUT_MS = 120_000;
export const POLL_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
const COMMAND = 'node apps/test-agents/scripts/deploy.mjs';

/** Text from the network, made safe for one console line and the Markdown record: plain characters, 200 at most. */
const plain = (text) => String(text).replace(/[^A-Za-z0-9 .,:;'()/-]+/g, ' ').replace(/ +/g, ' ').trim().slice(0, 200);

const parsed = (body) => {
  try {
    return { json: JSON.parse(body) };
  } catch {
    return null;
  }
};

/**
 * What one answer from the seller's /health means (src/seller.ts: `{status: 'operational' | 'degraded', open, reason?}`).
 * A degraded seller could not renew its mandate and stays degraded for up to an hour, so the wait stops there.
 * @param {{ status: number, body: string }} answer `status` is 0 when the request got no answer
 * @returns {{ verdict: 'pass' } | { verdict: 'wait' | 'fail', why: string }}
 */
export function healthVerdict({ status, body }) {
  if (status !== 200) return { verdict: 'wait', why: status === 0 ? 'no answer' : `HTTP ${status}` };
  const p = parsed(body);
  if (!p) return { verdict: 'wait', why: 'HTTP 200, but the body is not JSON' };
  if (p.json?.status === 'operational') return { verdict: 'pass' };
  if (p.json?.status === 'degraded') {
    const reason = p.json.reason === undefined ? '' : plain(p.json.reason);
    return { verdict: 'fail', why: `the seller reports degraded${reason ? `: ${reason}` : ''}` };
  }
  return { verdict: 'wait', why: 'HTTP 200, but the body does not read operational' };
}

/**
 * What is wrong with the answer from the seller's /agent.json: it must be 200 with a JSON object.
 * @param {{ status: number, body: string }} answer
 * @returns {string | null} null when nothing is.
 */
export function cardProblem({ status, body }) {
  if (status !== 200) return status === 0 ? 'no answer' : `HTTP ${status}`;
  const p = parsed(body);
  return p && typeof p.json === 'object' && p.json !== null && !Array.isArray(p.json) ? null : 'HTTP 200, but the body is not a JSON object';
}

/**
 * Whether a failed deploy rolls back. A Worker that still serves the version from before has nothing to roll back;
 * one whose live version wrangler can no longer read goes back to the last version known to work.
 * @param {{ uploaded: boolean, before: string | null, now: string | null }} facts `uploaded`: the upload was started
 */
export function shouldRollBack({ uploaded, before, now }) {
  return uploaded && before !== null && now !== before;
}

/**
 * The Markdown line for docs/operations.md.
 * @param {{ startedAt: Date, commit: string, version: string | null, before: string | null, failure: string | null, rolledBack?: boolean }} run
 */
export function recordLine({ startedAt, commit, version, before, failure, rolledBack }) {
  return line({ title: 'Test seller deploy', startedAt, commit, failure, workers: [{ name: WORKER, version, before, rolledBack }] });
}

/**
 * Deploys the test seller and checks it:
 *   1. pre-flight: refuse a checkout with a tracked change, or one without origin/main's commits;
 *   2. read the live version, the rollback target; refuse when wrangler cannot say;
 *   3. upload with `wrangler deploy`;
 *   4. every 5 s for at most 120 s, read /health until it says operational, then /agent.json until it is JSON;
 *   5. on a refused upload or a failed check, roll back when the live version changed;
 *   6. print the record line.
 * `--dry-run` stays as it was: wrangler bundles without an upload, and steps 1, 2 and 4 to 6 do not run.
 *
 * @param {{
 *   args: string[],
 *   config: string,
 *   sh: (cmd: string, args: string[], o?: { show?: boolean, env?: Record<string, string>, timeoutMs?: number }) => Promise<{ code: number | null, stdout: string, out: string }>,
 *   probe: (url: string, timeoutMs: number) => Promise<{ status: number, body: string }>,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   log: (line: string) => void,
 *   error: (line: string) => void,
 * }} effects `args` is empty or `--dry-run` alone, and anything else is refused; `config` is the wrangler file's path.
 * @returns {Promise<number>} the exit code: 0 on a pass, 1 on a failure, 2 on a pre-flight refusal, wrangler's own for
 *   a dry run.
 */
export async function deploy({ args, config, sh, probe, sleep, now, log, error }) {
  // --dry-run or nothing. Any other argument would reach wrangler unchecked: `--dry-run --no-dry-run` would upload
  // with no pre-flight, health check or rollback, and `--name` would upload a Worker these checks never read.
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
    error(`Refused: ${COMMAND} takes --dry-run or no argument (got ${args.join(' ')}), and it deploys for real.`);
    return 2;
  }
  const upload = ['npx', ['-y', 'wrangler@4', 'deploy', '-c', config, ...args]];
  if (args.includes('--dry-run')) {
    const r = await sh(...upload);
    return r.code === 0 ? 0 : (r.code ?? 1);
  }
  const { refused, commit } = await checkout(COMMAND, sh);
  if (refused) {
    error(refused);
    return 2;
  }
  const live = () => liveVersion(WORKER, sh);
  const fail = (why) => {
    throw new Error(why);
  };
  const startedAt = new Date(now());
  let before = null, version = null, uploaded = false, failure = null, rolledBack;

  try {
    before = (await live()) ?? fail(`wrangler cannot read ${WORKER}'s live version (is it logged in?), so nothing was uploaded`);
    log(`${WORKER} serves \`${before}\` now: the rollback target. Uploading.`);
    uploaded = true;
    const r = await sh(...upload);
    version = /Current Version ID:\s*([0-9a-f-]{36})/.exec(r.out)?.[1] ?? null;
    if (r.code !== 0 || !version) fail(`${WORKER}'s upload was refused`);

    log(`\nUploaded \`${version}\`. Reading ${SELLER}/health every ${POLL_MS / 1000} s, for at most ${CHECK_TIMEOUT_MS / 1000} s.`);
    const deadline = now() + CHECK_TIMEOUT_MS;
    const timeout = () => Math.max(1000, Math.min(PROBE_TIMEOUT_MS, deadline - now()));
    for (;;) {
      let pending;
      const health = healthVerdict(await probe(`${SELLER}/health`, timeout()));
      if (health.verdict === 'fail') fail(health.why);
      if (health.verdict === 'wait') pending = `${SELLER}/health did not read operational within ${CHECK_TIMEOUT_MS / 1000} s (last answer: ${health.why})`;
      else {
        const card = cardProblem(await probe(`${SELLER}/agent.json`, timeout()));
        if (!card) break;
        pending = `${SELLER}/agent.json did not answer 200 with a JSON object within ${CHECK_TIMEOUT_MS / 1000} s (last answer: ${card})`;
      }
      if (now() + POLL_MS > deadline) fail(pending);
      await sleep(POLL_MS);
    }
    log(`The seller reads operational and serves its agent card, ${Math.round((now() - (deadline - CHECK_TIMEOUT_MS)) / 1000)} s after the upload.`);
  } catch (e) {
    failure = e.message;
    error(`\nFAIL: ${failure}`);
    const current = uploaded ? await live() : before;
    if (shouldRollBack({ uploaded, before, now: current })) {
      version ??= current ?? 'unknown';
      rolledBack = await rollback(WORKER, before, 'apps/test-agents/scripts/deploy.mjs failed a check', sh);
      if (!rolledBack) error(`ROLLBACK FAILED for ${WORKER}. Run: npx wrangler@4 rollback ${before} --name ${WORKER}`);
    }
  }

  log(`\nThe record line for docs/operations.md:\n\n${recordLine({ startedAt, commit, version, before, failure, rolledBack })}\n`);
  return failure ? 1 : 0;
}
