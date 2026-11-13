// `pnpm site:deploy`: deploys the site (the Worker crow-site, crow.direct) and checks what is live afterwards
// (T-313), so a site deploy is one command with a rollback. Deploys wait for Rafa.
//   1. pre-flight (scripts/deploy-lib.mjs): refuse, with exit code 2, a checkout whose tracked files differ from its
//      commit, or one that lacks origin/main's commits after a fresh fetch;
//   2. empty reports/site-out, then build the site with the two crow.direct operators into it: wrangler uploads the
//      whole folder, so a file left from an older build would be published under this commit's name;
//   3. run site/check.mjs. When the build or the check fails, nothing is uploaded;
//   4. read crow-site's live version: its rollback target. When wrangler cannot say, nothing is uploaded;
//   5. upload with `wrangler deploy`;
//   6. every 5 s for at most 120 s, read the live site until https://crow.direct/ answers 200, /llms.txt is the built
//      file, and /try.mjs hashes (SHA-256) to the value the build pinned in the one command;
//   7. when the upload is refused or the check fails, roll back if the live version changed, and exit 1;
//   8. print one Markdown record line for docs/operations.md.
// It takes no arguments. Wrangler uses the Cloudflare login of whoever runs it (its own OAuth; nothing is read from
// the repository). The run takes its shell, network and clock as arguments, so a test runs every path with stand-ins
// (tests/site-deploy.test.ts).
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkout, liveVersion, recordLine, rollback, sh } from '../scripts/deploy-lib.mjs';
import { SITE_URL, TRY_URL, trySha256 } from './build.mjs';

const WORKER = 'crow-site';
const COMMAND = 'pnpm site:deploy';
const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const OUT = 'reports/site-out';
const LLMS_URL = `${SITE_URL}llms.txt`;
/** The live site has this long after the upload to serve the built files. */
const CHECK_TIMEOUT_MS = 120_000;
const POLL_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;

/**
 * What is wrong with the live site, from one read of its page, llms.txt and try.mjs.
 * @param {{ home: Answer, llms: Answer, tryMjs: Answer }} live each `{ status, body }`: the status is 0 when the
 *   request got no answer, and the body is the bytes served
 * @param {{ llms: Buffer, trySha256: string }} built reports/site-out/llms.txt, and the SHA-256 of site/try.mjs that
 *   the one command in llms.txt checks
 * @returns {string | null} null when nothing is.
 * @typedef {{ status: number, body: Buffer, type?: string }} Answer `type` is the content-type header, when the probe read it
 */
export function siteProblem({ home, llms, tryMjs }, built) {
  const not200 = (url, a) => (a.status === 200 ? null : `${url} did not answer 200 (last answer: ${a.status === 0 ? 'no answer' : `HTTP ${a.status}`})`);
  const down = not200(SITE_URL, home) ?? not200(LLMS_URL, llms);
  if (down) return down;
  if (!llms.body.equals(built.llms)) return `${LLMS_URL} answered 200, but its body is not the built ${OUT}/llms.txt`;
  // The guides and the bundles are UTF-8; without the charset a browser reads "Crow’s" as junk (T-400, apps/site/worker.js).
  for (const [url, a] of [[LLMS_URL, llms], [TRY_URL, tryMjs]]) if (a.status === 200 && a.type !== undefined && !/charset=utf-8/i.test(a.type)) return `${url} answered 200 as "${a.type}", with no charset=utf-8`;
  const sha = createHash('sha256').update(tryMjs.body).digest('hex');
  return not200(TRY_URL, tryMjs) ?? (sha === built.trySha256 ? null : `${TRY_URL} answered 200, but its SHA-256 starts ${sha.slice(0, 12)}, and the build pinned ${built.trySha256.slice(0, 12)}`);
}

/**
 * Deploys the site and checks it: the steps at the top of this file.
 *
 * @param {{
 *   args: string[],
 *   sh: (cmd: string, args: string[], o?: { show?: boolean, env?: Record<string, string>, timeoutMs?: number }) => Promise<{ code: number | null, stdout: string, out: string }>,
 *   probe: (url: string, timeoutMs: number) => Promise<Answer>,
 *   clean: () => void,
 *   built: () => { llms: Buffer, trySha256: string },
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   log: (line: string) => void,
 *   error: (line: string) => void,
 * }} effects `args` are the command line's, and any one refuses the deploy; `clean` empties the output folder; `built` reads what the build made, after
 *   the build and the check.
 * @returns {Promise<number>} the exit code: 0 on a pass, 1 on a failure, 2 on a refusal before the build.
 */
export async function deploy({ args, sh, probe, clean, built, sleep, now, log, error }) {
  if (args.length > 0) {
    error(`Refused: ${COMMAND} takes no arguments (got ${args.join(' ')}), and it deploys for real.`);
    return 2;
  }
  const { refused, branch, commit } = await checkout(COMMAND, sh);
  if (refused) {
    error(refused);
    return 2;
  }
  const fail = (why) => {
    throw new Error(why);
  };
  const startedAt = new Date(now());
  let before = null, version = null, uploaded = false, failure = null, rolledBack;

  try {
    clean();
    if ((await sh(process.execPath, ['site/build.mjs', '--op1', OPERATORS[0], '--op2', OPERATORS[1], '--out', OUT])).code !== 0) fail('the build failed, so nothing was uploaded');
    if ((await sh(process.execPath, ['site/check.mjs'])).code !== 0) fail('site/check.mjs failed, so nothing was uploaded');
    const expected = built();
    before = (await liveVersion(WORKER, sh)) ?? fail(`wrangler cannot read ${WORKER}'s live version (is it logged in?), so nothing was uploaded`);
    log(`${WORKER} serves \`${before}\` now: the rollback target. Uploading.`);
    uploaded = true;
    const r = await sh('npx', ['-y', 'wrangler@4', 'deploy', '--config', 'apps/site/wrangler.jsonc']);
    version = /Current Version ID:\s*([0-9a-f-]{36})/.exec(r.out)?.[1] ?? null;
    if (r.code !== 0 || !version) fail(`${WORKER}'s upload was refused`);

    log(`\nUploaded \`${version}\`. Reading ${SITE_URL}, llms.txt and try.mjs every ${POLL_MS / 1000} s, for at most ${CHECK_TIMEOUT_MS / 1000} s.`);
    const deadline = now() + CHECK_TIMEOUT_MS;
    const timeout = () => Math.max(1000, Math.min(PROBE_TIMEOUT_MS, deadline - now()));
    for (;;) {
      const problem = siteProblem({ home: await probe(SITE_URL, timeout()), llms: await probe(LLMS_URL, timeout()), tryMjs: await probe(TRY_URL, timeout()) }, expected);
      if (!problem) break;
      if (now() + POLL_MS > deadline) fail(`the live site did not pass its check within ${CHECK_TIMEOUT_MS / 1000} s: ${problem}`);
      await sleep(POLL_MS);
    }
    log(`The live site serves the built llms.txt and the pinned try.mjs, ${Math.round((now() - (deadline - CHECK_TIMEOUT_MS)) / 1000)} s after the upload.`);
  } catch (e) {
    failure = e.message;
    error(`\nFAIL: ${failure}`);
    // A Worker that still serves the version from before has nothing to roll back.
    const current = uploaded ? await liveVersion(WORKER, sh) : before;
    if (uploaded && current !== before) {
      version ??= current ?? 'unknown';
      rolledBack = await rollback(WORKER, before, `${COMMAND} failed a check`, sh);
      if (!rolledBack) error(`ROLLBACK FAILED for ${WORKER}. Run: npx wrangler@4 rollback ${before} --name ${WORKER}`);
    }
  }

  log(`\nThe record line for docs/operations.md:\n\n${recordLine({ title: 'Site deploy', startedAt, commit, branch, failure, workers: [{ name: WORKER, version, before, rolledBack }] })}\n`);
  return failure ? 1 : 0;
}

/** One GET, never followed past a redirect: the status, the content type and the bytes, or status 0 when there is no answer in time. */
async function probe(url, timeoutMs) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, type: r.headers.get('content-type') ?? '', body: Buffer.from(await r.arrayBuffer()) };
  } catch {
    return { status: 0, body: Buffer.alloc(0) };
  }
}

// Run as a command, not imported by a test. Node resolves the script's symbolic links, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(
    await deploy({
      args: process.argv.slice(2),
      sh,
      probe,
      clean: () => rmSync(new URL(`../${OUT}`, import.meta.url), { recursive: true, force: true }),
      built: () => ({ llms: readFileSync(new URL(`../${OUT}/llms.txt`, import.meta.url)), trySha256: trySha256() }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      log: console.log,
      error: console.error,
    }),
  );
}
