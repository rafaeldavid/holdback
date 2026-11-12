// Line and branch coverage of contracts/src (T-352, refinement package R10, gate VG-8).
//
//   node contracts/scripts/coverage.mjs                         the working tree as it is
//   node contracts/scripts/coverage.mjs --ref contracts-audit-ready   any branch, tag or commit (fetch it first)
//
// `forge coverage` cannot build these contracts as configured: it turns the optimizer off, and the contracts need the
// IR pipeline with the optimizer (stack depth, T-202). With `--ir-minimum` it builds: the IR pipeline with the minimum
// optimizer steps. foundry.toml stays untouched, since deploy-sepolia.sh --check requires it to equal the deployed
// commit; the run works on a scratch copy under reports/scratch/t-352/coverage/ and never builds the checkout itself.
// Tests that measure gas or code size fail without the full optimizer, so they are listed below and skipped; the
// report states how many tests ran and passed under the coverage build.
//
// Writes reports/scratch/t-352/coverage-report.md and coverage.json, and prints the per-file table.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GAS_CAP_REGEX,
  GAS_CAP_TESTS,
  ROOT,
  SCRATCH,
  assertInScratch,
  fail,
  flags,
  hashTree,
  lock,
  prepareCopy,
  sameTree,
} from './scratch.mjs';

/**
 * Suites that read the build's artifacts in out/, which forge coverage does not write (measured 2026-11-11). Their
 * src coverage is the dispatcher and one accept, which other suites reach too.
 */
const ARTIFACT_READERS = '^(NoAdminFuzzTest|PinnedSourceTest)$';

const args = flags(process.argv.slice(2), { ref: 'value' });
const before = hashTree(join(ROOT, 'contracts', 'src'));
lock('coverage');
const { contracts, label } = prepareCopy('coverage', args.ref ?? null);
process.stdout.write(`coverage of ${label}, in ${contracts}\n`);
// The side-by-side test does not compile under --ir-minimum (stack too deep at SideBySide.t.sol:265, measured
// 2026-11-11), so the coverage copy leaves that one file out. It drives the same handler as the invariant suite,
// against both copies; the rest of test/differential/ stays (StateOracle.t.sol imports Sides.sol).
const harness = join(contracts, 'test', 'differential', 'SideBySide.t.sol');
assertInScratch(harness);
rmSync(harness, { recursive: true, force: true });

const lcov = join(SCRATCH, 'coverage', 'lcov.info');
const forgeArgs = [
  'coverage',
  '--root',
  contracts,
  '--ir-minimum',
  '--fuzz-seed',
  '0x352',
  '--color',
  'never',
  '--report',
  'lcov',
  '--report',
  'summary',
  '--report-file',
  lcov,
  '--no-match-coverage',
  '^(test|script|lib)/',
  '--no-match-test',
  GAS_CAP_REGEX,
  '--no-match-contract',
  ARTIFACT_READERS,
];
const skip = `the side-by-side test (does not compile), ${ARTIFACT_READERS} (read out/), and ${GAS_CAP_TESTS.length} gas-cap tests`;
const t0 = Date.now();
const run = spawnSync('forge', forgeArgs, { encoding: 'utf8', maxBuffer: 1 << 30 });
const seconds = Math.round((Date.now() - t0) / 1000);
writeFileSync(join(SCRATCH, 'coverage-forge.log'), `${run.stdout}\n${run.stderr}`);
if (!sameTree(before, hashTree(join(ROOT, 'contracts', 'src')))) fail('contracts/src of the checkout changed during the run');
if (run.status !== 0 || !existsSync(lcov)) {
  process.stderr.write(run.stdout.slice(-4000) + run.stderr.slice(-4000));
  fail(`forge coverage exited ${run.status} after ${seconds} s; the full log is ${join(SCRATCH, 'coverage-forge.log')}`);
}

// Tests run under the coverage build, from forge's own result lines.
const out = run.stdout;
const ran = [...out.matchAll(/Ran (\d+) tests? for /g)].reduce((n, m) => n + Number(m[1]), 0);
const passed = [...out.matchAll(/Suite result: \w+\. (\d+) passed; (\d+) failed; (\d+) skipped/g)];
const sum = (i) => passed.reduce((n, m) => n + Number(m[i]), 0);

// lcov: SF file, DA line,hits; BRDA line,block,branch,taken ('-' = never reached); LF/LH, BRF/BRH totals.
const files = [];
let cur = null;
for (const raw of readFileSync(lcov, 'utf8').split('\n')) {
  const line = raw.trim();
  if (line.startsWith('SF:')) {
    cur = { file: line.slice(3).replace(/^.*?\/contracts\//, ''), lines: new Map(), branches: [] };
    files.push(cur);
  } else if (cur && line.startsWith('DA:')) {
    const [ln, hits] = line.slice(3).split(',').map(Number);
    cur.lines.set(ln, (cur.lines.get(ln) ?? 0) + hits);
  } else if (cur && line.startsWith('BRDA:')) {
    const [ln, block, branch, taken] = line.slice(5).split(',');
    cur.branches.push({ line: Number(ln), block, branch, taken: taken === '-' ? 0 : Number(taken) });
  } else if (line === 'end_of_record') cur = null;
}
const src = files.filter((f) => f.file.startsWith('src/')).sort((a, b) => a.file.localeCompare(b.file));
const pct = (h, n) => (n === 0 ? 'n/a' : `${((100 * h) / n).toFixed(1)}%`);
const rows = src.map((f) => {
  const lines = [...f.lines.values()];
  const missedLines = [...f.lines.entries()].filter(([, h]) => h === 0).map(([l]) => l);
  const missedBranches = f.branches.filter((b) => b.taken === 0);
  return {
    file: f.file,
    lines: { hit: lines.filter((h) => h > 0).length, total: lines.length },
    branches: { hit: f.branches.length - missedBranches.length, total: f.branches.length },
    missedLines,
    missedBranches: missedBranches.map((b) => ({ line: b.line, branch: Number(b.branch) })),
  };
});

const srcText = (file) => readFileSync(join(contracts, file), 'utf8').split('\n');
const md = [
  `# Coverage of contracts/src: ${label}`,
  '',
  `forge coverage --ir-minimum, ${seconds} s wall time. Under that build ${ran} tests ran: ${sum(1)} passed, ${sum(2)} failed, ${sum(3)} skipped. Left out: ${skip}.`,
  '',
  '| File | Lines | Branches |',
  '| --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.file} | ${r.lines.hit}/${r.lines.total} (${pct(r.lines.hit, r.lines.total)}) | ${r.branches.hit}/${r.branches.total} (${pct(r.branches.hit, r.branches.total)}) |`,
  ),
  '',
  '## Uncovered',
  '',
];
for (const r of rows) {
  if (r.missedLines.length === 0 && r.missedBranches.length === 0) continue;
  const text = srcText(r.file);
  md.push(`### ${r.file}`, '');
  for (const l of r.missedLines) md.push(`- line ${l} never ran: \`${text[l - 1]?.trim()}\``);
  for (const b of r.missedBranches) md.push(`- line ${b.line}, branch ${b.branch} never taken: \`${text[b.line - 1]?.trim()}\``);
  md.push('');
}
writeFileSync(join(SCRATCH, 'coverage-report.md'), md.join('\n'));
writeFileSync(
  join(SCRATCH, 'coverage.json'),
  JSON.stringify({ label, seconds, tests: { ran, passed: sum(1), failed: sum(2), skipped: sum(3) }, skip, rows }, null, 2),
);
process.stdout.write(`${md.slice(0, 6 + rows.length).join('\n')}\n\nreport: ${join(SCRATCH, 'coverage-report.md')}\n`);
if (sum(2) > 0) fail(`${sum(2)} tests failed under the coverage build; see ${join(SCRATCH, 'coverage-forge.log')}`);
