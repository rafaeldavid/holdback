// What the three deploys share (T-313): `pnpm demo-cloud:deploy` (the operators), apps/test-agents/scripts/deploy.mjs
// (the test seller) and `pnpm site:deploy` (the site). Each one runs the pre-flight, reads the live version as its
// rollback target, uploads, checks what is live, rolls back on a failed check, and prints one record line. The checks
// themselves differ and stay with each deploy.
//
// Every function that runs a command takes the runner as its last argument, so a test passes a stand-in for the
// shell: no test runs wrangler.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WRANGLER = ['-y', 'wrangler@4'];

/**
 * Runs a command from the repository root, shows its output unless told not to, and keeps it.
 * @returns {Promise<{ code: number | null, stdout: string, out: string }>} `out` is stdout and stderr together; the
 *   code is null after a timeout.
 */
export function sh(cmd, args, { show = true, env = {}, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', out = '';
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const done = (code) => (clearTimeout(timer), resolve({ code, stdout, out }));
    child.stdout.on('data', (d) => {
      stdout += d;
      out += d;
      if (show) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d;
      if (show) process.stderr.write(d);
    });
    child.on('error', (e) => {
      out += e.message;
      done(1);
    });
    child.on('close', (code, signal) => done(signal ? null : code));
  });
}

/**
 * The version that serves all of a Worker's traffic.
 * @param {string} stdout what `wrangler deployments status --json` printed
 * @returns {string | null} null when wrangler does not say: it is logged out, the Worker does not exist, or two
 *   versions split the traffic.
 */
export function versionAt100(stdout) {
  try {
    const v = JSON.parse(stdout).versions;
    return v.length === 1 && v[0].percentage === 100 && typeof v[0].version_id === 'string' ? v[0].version_id : null;
  } catch {
    return null;
  }
}

/** The version the Worker `name` serves to all traffic, or null when wrangler cannot say. */
export async function liveVersion(name, run = sh) {
  return versionAt100((await run('npx', [...WRANGLER, 'deployments', 'status', '--name', name, '--json'], { show: false })).stdout);
}

/**
 * Puts the Worker `name` back on `version`.
 * @returns {Promise<boolean>} true when wrangler accepted the rollback and the Worker serves `version` again.
 */
export async function rollback(name, version, message, run = sh) {
  const r = await run('npx', [...WRANGLER, 'rollback', version, '--name', name, '--message', message, '--yes']);
  return r.code === 0 && (await liveVersion(name, run)) === version;
}

const lastLine = (out) => String(out ?? '').trim().split('\n').at(-1)?.trim() ?? '';
const said = (out) => (lastLine(out) ? ` (${lastLine(out)})` : '');

/**
 * The pre-flight decision, as a pure function. Wrangler uploads whatever tree is checked out. A tracked change makes
 * the upload differ from the commit the record line names, and a checkout without main's commits can upload an old
 * wrangler file and drop the custom domains (docs/operations.md). Untracked files are fine: the builds read tracked
 * sources.
 *
 * @param {{
 *   command: string,
 *   branch: string,
 *   status: { code: number | null, out: string },
 *   fetch: { code: number | null, out: string },
 *   ancestor: { code: number | null, out: string },
 * }} facts `command` is the deploy to run again, as its user types it; `branch` is `git branch --show-current` (empty
 *   on a detached HEAD); `status` is `git status --porcelain --untracked-files=no`; `fetch` is `git fetch origin main`;
 *   `ancestor` is `git merge-base --is-ancestor origin/main HEAD`. A code of null means the command timed out.
 * @returns {string | null} null when the deploy may go on; otherwise the one sentence that refuses it.
 */
export function preflight({ command, branch, status, fetch, ancestor }) {
  if (status.code !== 0) return `Refused: git status failed${said(status.out)}, so the deploy cannot tell whether tracked files differ from the commit; run it from the repository's checkout.`;
  const changed = status.out.split('\n').filter((l) => l.trim()).map((l) => l.slice(3));
  if (changed.length > 0) {
    const shown = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');
    return `Refused: ${changed.length} tracked ${changed.length === 1 ? 'file differs' : 'files differ'} from the checked-out commit (${shown}), so the upload would not match the commit the record names; commit or stash the change, then run ${command} again.`;
  }
  if (fetch.code !== 0) return `Refused: \`git fetch origin main\` failed${said(fetch.out)}, so the deploy cannot tell whether this checkout holds main's commits; check the network and the origin remote, then run ${command} again.`;
  const here = branch ? `branch \`${branch}\`` : 'this detached checkout';
  if (ancestor.code === 1) return `Refused: ${here} lacks commits from origin/main, and a deploy without them can drop the custom domains; merge or rebase onto origin/main, then run ${command} again.`;
  if (ancestor.code !== 0) return `Refused: git cannot compare this checkout with origin/main${said(ancestor.out)}, so the deploy cannot tell whether it holds main's commits; run it from a checkout whose origin is the repository.`;
  return null;
}

/**
 * Reads the checkout with git and runs the pre-flight on it.
 * @param {string} command the deploy to run again, as its user types it
 * @returns {Promise<{ refused: string | null, branch: string, commit: string }>} `refused` is the sentence that
 *   refuses the deploy, or null; `branch` is empty on a detached HEAD; `commit` is HEAD's full hash.
 */
export async function checkout(command, run = sh) {
  const git = async (...args) => {
    const r = await run('git', args, { show: false, env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 120_000 });
    return { code: r.code, out: r.out, stdout: r.stdout.trim() };
  };
  const branch = (await git('branch', '--show-current')).stdout;
  const refused = preflight({
    command,
    branch,
    status: await git('status', '--porcelain', '--untracked-files=no'),
    fetch: await git('fetch', 'origin', 'main'),
    ancestor: await git('merge-base', '--is-ancestor', 'origin/main', 'HEAD'),
  });
  return { refused, branch, commit: (await git('rev-parse', 'HEAD')).stdout };
}

/**
 * The Markdown line for docs/operations.md.
 * @param {{
 *   title: string,
 *   startedAt: Date,
 *   commit: string,
 *   branch?: string,
 *   failure: string | null,
 *   workers: { name: string, version?: string | null, before?: string | null, rolledBack?: boolean }[],
 *   note?: string,
 * }} run `title` opens the line ("Deploy"); the line names the branch when `branch` is given (empty: a detached
 *   HEAD); `rolledBack` is true or false after a rollback was tried; `note` follows the versions.
 */
export function recordLine({ title, startedAt, commit, branch, failure, workers, note = '' }) {
  const when = `${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const on = branch === undefined ? '' : ` on ${branch ? `branch \`${branch}\`` : 'a detached HEAD'}`;
  const versions = workers.map((w) => {
    const back = w.rolledBack === true ? ', rolled back' : w.rolledBack === false ? ', ROLLBACK FAILED' : '';
    return `${w.name} \`${w.version ?? 'not deployed'}\` (rollback target \`${w.before ?? 'unknown'}\`${back})`;
  });
  return `**${title} ${when}, commit \`${commit.slice(0, 7) || 'unknown'}\`${on}: ${failure ? `FAIL, ${failure}` : 'pass'}.** ${versions.join(', ')}.${note}`;
}
