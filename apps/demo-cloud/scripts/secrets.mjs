// `pnpm demo-cloud:secrets`: sets the three live-judge variables as Worker secrets on holdback-op1, the
// Worker whose Durable Object runs the adjudicators. The values come from this process's environment, loaded by
// Node's --env-file-if-exists from the git-ignored .env at the repository root (or --env-file=<path>); the JSON
// is built in memory and piped to `wrangler secret bulk` on stdin. Nothing is written to disk and no value is
// printed: a missing variable is named, never shown. Redeploying is not needed for secrets to apply, but the
// running Durable Object reads its environment when it starts.
import { spawn } from 'node:child_process';

const NAMES = ['HOLDBACK_ANTHROPIC_API_KEY', 'HOLDBACK_OPENAI_COMPATIBLE_API_KEY', 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL'];
const WORKER = 'holdback-op1';

const missing = NAMES.filter((n) => !process.env[n]);
if (missing.length) {
  console.error(`refusing: ${missing.join(', ')} not set. Run with node --env-file=<path to .env> (values are never printed).`);
  process.exit(2);
}
if (!process.env.HOLDBACK_OPENAI_COMPATIBLE_BASE_URL.startsWith('https://')) {
  console.error('refusing: HOLDBACK_OPENAI_COMPATIBLE_BASE_URL is not an https URL.');
  process.exit(2);
}

const child = spawn('npx', ['-y', 'wrangler@4', 'secret', 'bulk', '--name', WORKER], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, process.env[n]]))));
child.on('exit', (code) => {
  console.log(code === 0 ? `Set ${NAMES.join(', ')} on ${WORKER}.` : `wrangler secret bulk exited with ${code}`);
  process.exit(code ?? 1);
});
