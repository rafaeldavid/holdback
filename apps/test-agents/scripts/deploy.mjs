// `pnpm -C apps/test-agents deploy` (T-222, D47): deploys crow-test-agents, Crow's test seller, to the Cloudflare
// account wrangler is logged in to (wrangler's own OAuth; nothing is read from the repository). Deploys wait for Rafa.
// The deploy checks itself (T-313; the steps and their decisions are in deploy-checks.mjs, and what it shares with
// the other deploys in scripts/deploy-lib.mjs):
//   1. pre-flight: refuse, with exit code 2, a checkout whose tracked files differ from its commit, or one that lacks
//      origin/main's commits after a fresh fetch;
//   2. read the Worker's live version: its rollback target. When wrangler cannot say, nothing is uploaded;
//   3. upload the Worker and its routes on crow.direct/agents/test-seller* and escrow.stream/agents/test-seller*;
//   4. every 5 s for at most 120 s, read https://crow.direct/agents/test-seller/health until it says operational
//      (degraded fails at once), then /agent.json until it answers 200 with JSON;
//   5. when the upload is refused or a check fails, roll back if the live version changed, and exit 1;
//   6. print one Markdown record line for docs/operations.md.
// Arguments go to `wrangler deploy` as they are. With --dry-run wrangler bundles without an upload, and steps 1, 2
// and 4 to 6 do not run. The secret TEST_AGENTS_SEED is set once, by scripts/seed.mjs (docs/operations.md, "Crow's test
// seller"); a Worker that was never deployed has no live version, so its first upload is `wrangler deploy` by hand.
import { fileURLToPath } from 'node:url';
import { sh } from '../../../scripts/deploy-lib.mjs';
import { deploy } from './deploy-checks.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** One GET, never followed past a redirect: the status and the body, or status 0 when there is no answer in time. */
async function probe(url, timeoutMs) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

process.exit(
  await deploy({
    args: process.argv.slice(2),
    config: here('../wrangler.jsonc'),
    sh,
    probe,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    log: console.log,
    error: console.error,
  }),
);
