// The approval check (T-052, step 4): every cost script that loads billing keys first checks that the cost
// code is unchanged since the commit Rafa approved, recorded in `.costs-approved` at the clone's root.
//
// Limit: a check written in this repository cannot defend against a change to itself. The defense is that the
// dedicated clone only moves forward after Rafa reviews the diff (docs/costs.md, "Running the collector"); this
// check catches the ordinary case, a pull nobody approved.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The cost code the approval covers. A path that does not exist yet (model-prices.json before T-053) is fine.
 * `.gitattributes` is covered because it can change what `git diff` shows a reviewer.
 */
export const COVERED = ['scripts/costs', 'config/costs.template.json', 'config/model-prices.json', '.gitattributes'];
export const APPROVAL_FILE = '.costs-approved';

/** Git runs with this environment only, so no hook or helper it starts can see a billing variable. */
const SAFE_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];

export function safeEnv(env = process.env) {
  return Object.fromEntries(SAFE_ENV.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}

/** Runs git with the allowlisted environment; returns its status and trimmed output. */
export function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, env: safeEnv(), encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: (r.stdout ?? '').trim() };
}

/** The top of the git work tree that holds `dir`. */
export function cloneRootOf(dir) {
  const r = git(['rev-parse', '--show-toplevel'], dir);
  if (r.status !== 0 || !r.stdout) throw new ApprovalRefused('the cost scripts are not in a git checkout');
  return r.stdout;
}

export class ApprovalRefused extends Error {
  constructor(reason, files = []) {
    super(files.length ? `${reason}: ${files.join(', ')}` : reason);
    this.name = 'ApprovalRefused';
    this.files = files;
  }
}

/** Cost files that differ from `commit`, or exist untracked. */
export function changedSince(root, commit) {
  const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', commit, '--', ...COVERED], root);
  if (diff.status !== 0) throw new ApprovalRefused('git could not compare the cost code with the approved commit');
  const untracked = git(['ls-files', '--others', '--', ...COVERED], root);
  return [...diff.stdout.split('\n'), ...untracked.stdout.split('\n')].filter(Boolean);
}

/** Tracked symlinks under the covered paths: an approved link would let its target change unseen. */
export function symlinksIn(root) {
  const staged = git(['ls-files', '-s', '--', ...COVERED], root);
  return staged.stdout.split('\n').filter((l) => l.startsWith('120000 ')).map((l) => l.split('\t')[1]);
}

/** Throws ApprovalRefused unless the cost code at `root` is the approved commit's. Returns that commit. */
export function checkApproved(root) {
  const file = join(root, APPROVAL_FILE);
  if (!existsSync(file)) throw new ApprovalRefused(`no ${APPROVAL_FILE}: read the cost code, then run node scripts/costs/approve.mjs`);
  if (git(['ls-files', '--error-unmatch', '--', APPROVAL_FILE], root).status === 0) {
    throw new ApprovalRefused(`${APPROVAL_FILE} is tracked by git, so a commit could supply its own approval`);
  }
  const commit = readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new ApprovalRefused(`${APPROVAL_FILE} does not hold a commit`);
  if (git(['cat-file', '-e', `${commit}^{commit}`], root).status !== 0) throw new ApprovalRefused('the approved commit is not in this clone');
  const links = symlinksIn(root);
  if (links.length) throw new ApprovalRefused('the cost code holds symlinks, whose targets the approval cannot cover', links);
  const changed = changedSince(root, commit);
  if (changed.length) throw new ApprovalRefused('the cost code changed since the approved commit; review it, then run node scripts/costs/approve.mjs', changed);
  return commit;
}
