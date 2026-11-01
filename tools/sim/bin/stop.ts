// pnpm sim:stop <run-id>: stops the world a run started (SIGTERM to the pid in its world.json).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR, validRunId, type WorldFile } from '../world.ts';

const runId = process.argv[2] ?? '';
if (!validRunId(runId)) {
  console.error('usage: pnpm sim:stop <run-id>');
  process.exit(2);
}
const f = JSON.parse(readFileSync(join(RUNS_DIR, runId, 'world.json'), 'utf8')) as WorldFile;
try {
  process.kill(f.pid, 'SIGTERM');
  console.log(`stopped run ${runId} (pid ${f.pid})`);
} catch {
  console.log(`run ${runId} (pid ${f.pid}) was not running`);
}
