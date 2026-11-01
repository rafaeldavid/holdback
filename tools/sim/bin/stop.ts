// pnpm sim:stop <run-id>: stops the world a run started. It signals the pid in world.json only after the
// run's own audit endpoint (served by that same process) answers with this run id, so a pid the OS has since
// reused for another process is never signalled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR, validRunId, type WorldFile } from '../world.ts';

const runId = process.argv[2] ?? '';
if (!validRunId(runId)) {
  console.error('usage: pnpm sim:stop <run-id>');
  process.exit(2);
}
const f = JSON.parse(readFileSync(join(RUNS_DIR, runId, 'world.json'), 'utf8')) as WorldFile;
let ours = false;
try {
  const res = await fetch(f.coordinator.auditUrl, { signal: AbortSignal.timeout(3000) });
  ours = res.ok && ((await res.json()) as { runId?: string }).runId === runId;
} catch {
  ours = false;
}
if (!ours) {
  console.log(`run ${runId} is not running (its audit endpoint ${f.coordinator.auditUrl} does not answer for it); nothing signalled`);
  process.exit(0);
}
try {
  process.kill(f.pid, 'SIGTERM');
  console.log(`stopped run ${runId} (pid ${f.pid})`);
} catch (e) {
  console.error(`could not signal pid ${f.pid}: ${(e as Error).message}`);
  process.exit(1);
}
