// `pnpm -C apps/test-agents deploy` (T-222, D47): deploys crow-test-agents, Crow's test seller, to the Cloudflare
// account wrangler is logged in to (wrangler's own OAuth; nothing is read from the repository). Deploys wait for Rafa.
// The deploy checks itself (T-313; the steps and their decisions are in deploy-checks.mjs):
//   1. read the Worker's live version: its rollback target. When wrangler cannot say, nothing is uploaded;
//   2. upload the Worker and its routes on crow.direct/agents/test-seller* and escrow.stream/agents/test-seller*;
//   3. every 5 s for at most 120 s, read https://crow.direct/agents/test-seller/health until it says operational
//      (degraded fails at once), then /agent.json until it answers 200 with JSON;
//   4. when the upload is refused or a check fails, roll back if the live version changed, and exit 1;
//   5. print one Markdown record line for docs/operations.md.
// Arguments go to `wrangler deploy` as they are. With --dry-run wrangler bundles without an upload, and steps 1 and
// 3 to 5 do not run. The secret TEST_AGENTS_SEED is set once, by scripts/seed.mjs (docs/operations.md, "Crow's test
// seller"); a Worker that was never deployed has no live version, so its first upload is `wrangler deploy` by hand.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deploy } from './deploy-checks.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Runs a command from the repository root, shows its output unless told not to, and keeps it. The code is null after a timeout. */
function sh(cmd, args, { show = true, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', out = '';
    const child = spawn(cmd, args, { cwd: here('../../../'), env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
