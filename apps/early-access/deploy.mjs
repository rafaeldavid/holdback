// `node apps/early-access/deploy.mjs` (T-413): deploys crow-early-access, the sign-ups at join.crow.direct, and checks
// what is live afterwards, as the site's and the test agents' deploys do (scripts/deploy-lib.mjs). Deploys wait for Rafa.
//   1. pre-flight: refuse, with exit code 2, a checkout whose tracked files differ from its commit, or one that lacks
//      origin/main's commits after a fresh fetch;
//   2. read the Worker's live version: its rollback target. When wrangler cannot say, nothing is uploaded;
//   3. upload with `wrangler deploy`, with the commit as the variable BUILD_COMMIT, which /version.json names;
//   4. every 5 s for at most 120 s, read https://join.crow.direct/version.json until it names that commit;
//   5. when the upload is refused or the check fails, roll back if the live version changed, and exit 1;
//   6. print one Markdown record line for docs/operations.md.
// It takes no arguments. Wrangler uses the Cloudflare login of whoever runs it (its own OAuth; nothing is read from
// the repository). The run takes its shell, network and clock as arguments, so a test runs every path with stand-ins
// (tests/early-access-deploy.test.ts).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkout, liveVersion, recordLine, rollback, sh } from '../../scripts/deploy-lib.mjs';

export const WORKER = 'crow-early-access';
export const VERSION_URL = 'https://join.crow.direct/version.json';
const COMMAND = 'node apps/early-access/deploy.mjs';
const CONFIG = 'apps/early-access/wrangler.jsonc';
export const CHECK_TIMEOUT_MS = 120_000;
export const POLL_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;

/**
 * What is wrong with one answer from /version.json, or null when it names `commit`.
 * @param {{ status: number, body: string }} answer `status` is 0 when the request got no answer
 */
export function versionProblem({ status, body }, commit) {
  if (status !== 200) return status === 0 ? 'no answer' : `HTTP ${status}`;
  let named;
  try {
    named = JSON.parse(body)?.commit;
  } catch {
    return 'HTTP 200, but the body is not JSON';
  }
  if (named === commit) return null;
  return typeof named === 'string' && /^[0-9a-f]{40}$/.test(named) ? `it names commit ${named.slice(0, 7)}, not ${commit.slice(0, 7)}` : 'it names no commit';
}

/**
 * Deploys early access and checks it: the steps at the top of this file.
 * @param {{
 *   args: string[],
 *   sh: (cmd: string, args: string[], o?: object) => Promise<{ code: number | null, stdout: string, out: string }>,
 *   probe: (url: string, timeoutMs: number) => Promise<{ status: number, body: string }>,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   log: (line: string) => void,
 *   error: (line: string) => void,
 * }} effects
 * @returns {Promise<number>} 0 on a pass, 1 on a failure, 2 on a refusal before the upload.
 */
export async function deploy({ args, sh, probe, sleep, now, log, error }) {
  if (args.length > 0) {
    error(`Refused: ${COMMAND} takes no arguments (got ${args.join(' ')}), and it deploys for real.`);
    return 2;
  }
  const { refused, branch, commit } = await checkout(COMMAND, sh);
  if (refused) {
    error(refused);
    return 2;
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    error(`Refused: git did not name this checkout's commit (got "${commit}"), so /version.json could not name it.`);
    return 2;
  }
  const fail = (why) => {
    throw new Error(why);
  };
  const startedAt = new Date(now());
  let before = null, version = null, uploaded = false, failure = null, rolledBack;
  try {
    before = (await liveVersion(WORKER, sh)) ?? fail(`wrangler cannot read ${WORKER}'s live version (is it logged in?), so nothing was uploaded`);
    log(`${WORKER} serves \`${before}\` now: the rollback target. Uploading.`);
    uploaded = true;
    const r = await sh('npx', ['-y', 'wrangler@4', 'deploy', '--config', CONFIG, '--var', `BUILD_COMMIT:${commit}`]);
    version = /Current Version ID:\s*([0-9a-f-]{36})/.exec(r.out)?.[1] ?? null;
    if (r.code !== 0 || !version) fail(`${WORKER}'s upload was refused`);

    log(`\nUploaded \`${version}\`. Reading ${VERSION_URL} every ${POLL_MS / 1000} s, for at most ${CHECK_TIMEOUT_MS / 1000} s.`);
    const deadline = now() + CHECK_TIMEOUT_MS;
    const timeout = () => Math.max(1000, Math.min(PROBE_TIMEOUT_MS, deadline - now()));
    for (;;) {
      const problem = versionProblem(await probe(VERSION_URL, timeout()), commit);
      if (!problem) break;
      if (now() + POLL_MS > deadline) fail(`${VERSION_URL} did not name commit ${commit.slice(0, 7)} within ${CHECK_TIMEOUT_MS / 1000} s (last answer: ${problem})`);
      await sleep(POLL_MS);
    }
    log(`${VERSION_URL} names commit ${commit.slice(0, 7)}, ${Math.round((now() - (deadline - CHECK_TIMEOUT_MS)) / 1000)} s after the upload.`);
  } catch (e) {
    failure = e.message;
    error(`\nFAIL: ${failure}`);
    const current = uploaded ? await liveVersion(WORKER, sh) : before;
    if (uploaded && before !== null && current !== before) {
      version ??= current ?? 'unknown';
      rolledBack = await rollback(WORKER, before, `${COMMAND} failed a check`, sh);
      if (!rolledBack) error(`ROLLBACK FAILED for ${WORKER}. Run: npx wrangler@4 rollback ${before} --name ${WORKER}`);
    }
  }
  log(`\nThe record line for docs/operations.md:\n\n${recordLine({ title: 'Early access deploy', startedAt, commit, branch, failure, workers: [{ name: WORKER, version, before, rolledBack }] })}\n`);
  return failure ? 1 : 0;
}

/** One GET, never followed past a redirect: the status and the body, or status 0 when there is no answer in time. */
async function probe(url, timeoutMs) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

// Run as a command, not imported by a test. Node resolves the script's symbolic links, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(
    await deploy({ args: process.argv.slice(2), sh, probe, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, log: console.log, error: console.error }),
  );
}
