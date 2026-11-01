// pnpm sim:check <run-id>: reads the run's live world (the audit endpoint and every operator), checks the
// invariants, writes runs/<run-id>/check.json (and the audit it checked, audit.json), prints a summary and
// exits 1 on any violation. Party reports in runs/<run-id>/reports/ are compared, never trusted.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAudit, readReports, readRun, type Audit } from '../audit.ts';
import { checkRun } from '../check.ts';
import { RUNS_DIR, validRunId, type WorldFile } from '../world.ts';

// --audit <file> checks a saved audit against the live operators instead (a re-check, or a tampered copy to
// see the check catch it); it then writes check.json and audit.json nowhere.
const runId = process.argv[2] ?? '';
const ai = process.argv.indexOf('--audit');
const auditFile = ai >= 0 ? process.argv[ai + 1] : undefined;
if (!validRunId(runId) || (ai >= 0 && !auditFile)) {
  console.error('usage: pnpm sim:check <run-id> [--audit <saved audit.json>]');
  process.exit(2);
}
const dir = join(RUNS_DIR, runId);
const world = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldFile;
let audit: Audit;
try {
  audit = auditFile ? (JSON.parse(readFileSync(auditFile, 'utf8')) as Audit) : await fetchAudit(world.coordinator.auditUrl);
} catch (e) {
  console.error(`run ${runId}'s world is not answering at ${world.coordinator.auditUrl} (${(e as Error).message}). sim:check reads the live world: run it before pnpm sim:stop.`);
  process.exit(2);
}
const { reports, unreadable } = readReports(world.coordinator.reports);
const result = await checkRun(await readRun(world, audit, reports));
result.findings.push(...unreadable.map((u) => `unreadable party report ${u}`));
if (!auditFile) {
  writeFileSync(join(dir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(world.coordinator.check, `${JSON.stringify(result, null, 2)}\n`);
}

const lines = [`sim:check ${runId}: ${result.ok ? 'OK' : 'VIOLATION'} at settlement time ${result.now}`];
for (const inv of result.invariants) {
  lines.push(`  ${inv.ok ? 'ok  ' : 'FAIL'} ${inv.id}: ${inv.title}`);
  for (const x of inv.violations) lines.push(`         - ${x}`);
}
lines.push(`  commitments (${result.commitments.length}):`);
for (const c of result.commitments) lines.push(`    ${c.id.slice(0, 12)}… ${c.escrowState.padEnd(22)} ${c.status.padEnd(11)} ${c.explanation}`);
for (const t of result.totals) lines.push(`  ${t.token}: minted ${t.minted}, ledger ${t.ledger}`);
if (result.findings.length) lines.push('  findings (party reports vs the record):', ...result.findings.map((x) => `    - ${x}`));
lines.push(auditFile ? `  checked the saved audit ${auditFile}; wrote nothing` : `  wrote ${world.coordinator.check}`);
console.log(lines.join('\n'));
process.exit(result.ok ? 0 : 1);
