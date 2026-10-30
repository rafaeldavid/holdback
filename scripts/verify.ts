// One command that runs the product and writes evidence: reports/verify-<branch>.md.
// Runs every step even after a failure, so the report shows the whole picture.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Step = { name: string; command: string[] };
type Result = { name: string; command: string; status: 'pass' | 'fail' | 'placeholder'; ms: number; tail: string };

const root = new URL('..', import.meta.url).pathname;

const steps: Step[] = [
  { name: 'typecheck', command: ['pnpm', 'typecheck'] },
  { name: 'lint', command: ['pnpm', 'lint'] },
  { name: 'test', command: ['pnpm', 'test'] },
  { name: 'spec', command: ['pnpm', 'validate:spec'] },
  { name: 'snap', command: ['pnpm', 'snap'] },
  { name: 'demo', command: ['pnpm', 'demo'] },
];

// Placeholder scripts (scripts/placeholder.mjs) print this marker; they never count as passing.
const PLACEHOLDER = 'not implemented yet';

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function run(step: Step): Result {
  const started = performance.now();
  const r = spawnSync(step.command[0]!, step.command.slice(1), { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
  const ms = Math.round(performance.now() - started);
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const status = r.status !== 0 ? 'fail' : output.includes(PLACEHOLDER) ? 'placeholder' : 'pass';
  return { name: step.name, command: step.command.join(' '), status, ms, tail: output.split('\n').slice(-15).join('\n') };
}

const results: Result[] = [];
for (const step of steps) {
  const result = run(step);
  console.log(`${result.status.padEnd(11)} ${result.name} (${result.ms} ms)`);
  results.push(result);
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'detached';
const commit = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';
const snapshotDiff = git(['diff', 'HEAD', '--', 'fixtures/**/*.expect.md']);
const failed = results.filter((r) => r.status === 'fail');

const report = [
  `# Verify: ${branch}`,
  '',
  `Commit \`${commit}\`${dirty ? ' (uncommitted changes present)' : ''}, ${new Date().toISOString()}.`,
  `Result: **${failed.length ? `FAIL (${failed.map((r) => r.name).join(', ')})` : 'PASS'}**. All values below are measured on this machine.`,
  '',
  '| Step | Command | Status | Time |',
  '| --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | \`${r.command}\` | ${r.status} | ${r.ms} ms |`),
  '',
  '`placeholder` means the command exists but its task has not landed; it is not a pass.',
  '',
  '## Snapshot diffs',
  '',
  snapshotDiff ? ['```diff', snapshotDiff, '```'].join('\n') : 'None against HEAD.',
  '',
  '## Output (last 15 lines per step)',
  '',
  ...results.flatMap((r) => [`### ${r.name}`, '', '```', r.tail || '(no output)', '```', '']),
].join('\n');

const reportPath = join(root, 'reports', `verify-${branch.replaceAll('/', '-')}.md`);
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(reportPath, report);
console.log(`\nReport: ${reportPath}`);
process.exit(failed.length ? 1 : 0);
