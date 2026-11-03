#!/usr/bin/env node
// Records the clone's current commit as the approved cost code (T-052, step 7). It needs no variable, so run it
// without --env-file: `node scripts/costs/approve.mjs`. Read the cost code first; docs/costs.md says how.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVAL_FILE, COVERED, ApprovalRefused, changedSince, cloneRootOf, git } from './approved.mjs';

/** Approves HEAD at `root`. Refuses uncommitted cost code, so the record names exactly what was read. */
export function approve(root) {
  const head = git(['rev-parse', 'HEAD'], root);
  if (head.status !== 0 || !/^[0-9a-f]{40}$/.test(head.stdout)) throw new ApprovalRefused('no commit to approve');
  if (git(['ls-files', '--error-unmatch', '--', APPROVAL_FILE], root).status === 0) {
    throw new ApprovalRefused(`${APPROVAL_FILE} is tracked by git; remove it from the index first`);
  }
  const uncommitted = changedSince(root, 'HEAD');
  if (uncommitted.length) throw new ApprovalRefused('the cost code has uncommitted changes; approve only committed code', uncommitted);
  const file = join(root, APPROVAL_FILE);
  const previous = existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
  writeFileSync(file, `${head.stdout}\n`, { mode: 0o600 });
  return { commit: head.stdout, previous };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const root = cloneRootOf(dirname(fileURLToPath(import.meta.url)));
    const { commit, previous } = approve(root);
    console.log(`approved ${commit} for ${COVERED.join(', ')}`);
    if (previous && previous !== commit) console.log(`previous approval: ${previous}`);
  } catch (e) {
    console.error(e instanceof ApprovalRefused ? `refused: ${e.message}` : 'refused: unexpected error');
    process.exitCode = 1;
  }
}
