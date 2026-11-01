// pnpm sim:world <run-id> [--parties buyer-1,seller-1]: starts an isolated world for one run on free ports and
// writes tools/sim/runs/<run-id>/world.json. Keeps running until Ctrl-C or `pnpm sim:stop <run-id>`.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR, startRunWorld, validRunId } from '../world.ts';

const args = process.argv.slice(2);
const runId = args[0] ?? '';
const i = args.indexOf('--parties');
const parties = i >= 0 && args[i + 1] ? args[i + 1]!.split(',') : undefined;
if (!validRunId(runId)) {
  console.error('usage: pnpm sim:world <run-id> [--parties buyer-1,seller-1,...]   (run id: lowercase letters, digits, dashes)');
  process.exit(2);
}
mkdirSync(join(RUNS_DIR, runId), { recursive: true });
const log = join(RUNS_DIR, runId, 'world.log');
let run;
try {
  run = await startRunWorld({ runId, ...(parties ? { parties } : {}), onError: (e) => appendFileSync(log, `${new Date().toISOString()} ${e.message}\n`) });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const f = run.file;
console.log(
  [
    `Holdback sim run ${runId}: SimChain, tUSD (6 decimals), fake judges. No real money.`,
    `  world.json   ${join(run.dir, 'world.json')}`,
    `  operators    ${f.operators.join('  ')}`,
    `  sim service  ${f.sim}`,
    `  audit        ${f.coordinator.auditUrl}   (coordinator and sim:check only)`,
    `  parties      ${Object.keys(f.parties).join(', ')}`,
    `  adjudicator log ${log}`,
    `Next: pnpm sim:brief ${runId} <party> ... ; afterwards pnpm sim:check ${runId}; stop with pnpm sim:stop ${runId}.`,
  ].join('\n'),
);
const stop = async () => {
  await run.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
