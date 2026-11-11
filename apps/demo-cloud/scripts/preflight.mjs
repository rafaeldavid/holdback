// The pre-flight decision of `pnpm demo-cloud:deploy` (T-313), as a pure function: deploy.mjs runs git and passes the
// results in, so a test calls this without git or the network (apps/demo-cloud/src/deploy-preflight.test.ts).
//
// Wrangler uploads whatever tree is checked out. A tracked change makes the upload differ from the commit the record
// line names, and a checkout without main's commits can upload an old wrangler file and drop the custom domains
// (docs/operations.md). Untracked files are fine: the build reads tracked sources.

const lastLine = (out) => String(out ?? '').trim().split('\n').at(-1)?.trim() ?? '';
const said = (out) => (lastLine(out) ? ` (${lastLine(out)})` : '');

/**
 * @param {{
 *   branch: string,
 *   status: { code: number | null, out: string },
 *   fetch: { code: number | null, out: string },
 *   ancestor: { code: number | null, out: string },
 * }} facts `branch` is `git branch --show-current` (empty on a detached HEAD); `status` is
 *   `git status --porcelain --untracked-files=no`; `fetch` is `git fetch origin main`; `ancestor` is
 *   `git merge-base --is-ancestor origin/main HEAD`. A code of null means the command timed out.
 * @returns {string | null} null when the deploy may go on; otherwise the one sentence that refuses it.
 */
export function preflight({ branch, status, fetch, ancestor }) {
  if (status.code !== 0) return `Refused: git status failed${said(status.out)}, so the deploy cannot tell whether tracked files differ from the commit; run it from the repository's checkout.`;
  const changed = status.out.split('\n').filter((l) => l.trim()).map((l) => l.slice(3));
  if (changed.length > 0) {
    const shown = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');
    return `Refused: ${changed.length} tracked ${changed.length === 1 ? 'file differs' : 'files differ'} from the checked-out commit (${shown}), so the upload would not match the commit the record names; commit or stash the change, then run pnpm demo-cloud:deploy again.`;
  }
  if (fetch.code !== 0) return `Refused: \`git fetch origin main\` failed${said(fetch.out)}, so the deploy cannot tell whether this checkout holds main's commits; check the network and the origin remote, then run pnpm demo-cloud:deploy again.`;
  const here = branch ? `branch \`${branch}\`` : 'this detached checkout';
  if (ancestor.code === 1) return `Refused: ${here} lacks commits from origin/main, and a deploy without them can drop the custom domains; merge or rebase onto origin/main, then run pnpm demo-cloud:deploy again.`;
  if (ancestor.code !== 0) return `Refused: git cannot compare this checkout with origin/main${said(ancestor.out)}, so the deploy cannot tell whether it holds main's commits; run it from a checkout whose origin is the repository.`;
  return null;
}
