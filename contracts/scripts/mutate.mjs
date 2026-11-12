// Mutation testing of contracts/src (T-352, refinement package R10, gate VG-7).
//
//   node contracts/scripts/mutate.mjs                          every mutant in mutants.json, on the working tree
//   node contracts/scripts/mutate.mjs --quick                  the quick subset (mutants marked "quick")
//   node contracts/scripts/mutate.mjs --only M001,M035         named mutants
//   node contracts/scripts/mutate.mjs --ref contracts-audit-ready   any branch, tag or commit (fetch it first)
//   node contracts/scripts/mutate.mjs --resume                 skip mutants this run's results file already has
//
// The run never writes to the checkout's contracts/: it copies the contracts to reports/scratch/t-352/mutation-<run>/,
// applies one mutant at a time to that copy, runs forge there, and restores the file before the next mutant. It
// checks the checkout's contracts/src against a hash taken at the start, after every mutant, and stops if it changed.
// A lock file refuses a second run on the same copy.
//
// Reproducible: the list is fixed (mutants.json) and every forge test run uses the same fuzz seed (FUZZ_SEED), so two
// runs on the same commit run the same mutants, in the same order, against the same fuzz inputs. Each mutant's `find`
// must occur exactly once in its file; otherwise the mutant is reported "stale" and never applied, so the list cannot
// silently mutate the wrong line after the source moves. --resume reuses a verdict only when the source, the tests, the
// build, the seed and that mutant's find/replace are all the same as when it was recorded.
//
// Verdicts, and what each requires:
//   killed       the mutated copy compiled (forge build printed a compile of the changed file), forge test ran, and
//                at least one test result line starts with [FAIL. Nothing else counts as a kill.
//   survived     it compiled, forge test exited 0, and it passed as many tests as the unmutated baseline.
//   not-compiled forge build failed: the mutant is not valid Solidity, not a kill.
//   stale        `find` is missing or not unique in the file.
//   timeout      forge build or forge test ran past --timeout-min minutes (default 30).
//   error        anything else (forge test exited non-zero with no [FAIL line, fewer tests than the baseline ran, or
//                the build did not pick up the change).
//
// The main run uses the fast build (--build fast, the default; see FAST_SKIP below) and leaves out the side-by-side
// test (test/differential/SideBySide.t.sol): while src equals the pinned deployed copy that test fails on any change
// of behaviour, so it would kill every mutant and say nothing about what the unit, fuzz, invariant and cross-check
// suites assert. Each survivor then runs once more on the full build with every test, the side-by-side test
// included, and the report gives that second verdict and the test that killed it (--no-full skips that step).
//
// Writes reports/scratch/t-352/mutation-<run>.json (results so far, rewritten after each mutant) and
// mutation-<run>.md (the report), where <run> is the ref (or "worktree") and the build.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAS_CAP_REGEX,
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

/** The fuzz seed of every forge test run: fixed, so a fuzz case cannot kill one mutant and spare its rerun. */
const FUZZ_SEED = '0x352';

const args = flags(process.argv.slice(2), {
  ref: 'value',
  only: 'value',
  quick: 'bool',
  resume: 'bool',
  'no-full': 'bool',
  'timeout-min': 'value',
  build: 'value',
  'match-test': 'value',
  shard: 'value',
  list: 'value',
  check: 'bool',
});
const timeoutMs = Number(args['timeout-min'] ?? 30) * 60_000;
const build = args.build ?? 'fast';
if (!['fast', 'full'].includes(build)) fail('--build is fast or full');

/**
 * The mutant list: mutants.json, or the file --list names. A list with `inherit` takes the inherited file's mutants
 * in their order, drops the ids in `retired`, replaces in place the ids it redefines, and appends its new ones.
 */
function loadList(path) {
  const own = JSON.parse(readFileSync(path, 'utf8'));
  if (!own.inherit) return own.mutants;
  const base = loadList(join(dirname(path), own.inherit));
  const retired = own.retired ?? {};
  const redefined = new Map(own.mutants.map((m) => [m.id, m]));
  const unknown = [...Object.keys(retired), ...redefined.keys()].filter((id) => !base.some((m) => m.id === id) && !/^L/.test(id));
  if (unknown.length) fail(`${path}: retires or redefines ids its base does not have: ${unknown.join(', ')}`);
  const merged = base.filter((m) => !(m.id in retired)).map((m) => redefined.get(m.id) ?? m);
  const added = own.mutants.filter((m) => !base.some((b) => b.id === m.id));
  return [...merged, ...added];
}
const listPath = args.list ? join(ROOT, args.list) : fileURLToPath(new URL('./mutants.json', import.meta.url));
const list = loadList(listPath);
const ids = list.map((m) => m.id);
const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
if (repeated.length) fail(`${listPath}: duplicate mutant ids: ${repeated.join(', ')}; give each mutant its own id`);
const bad = list.filter((m) => !/^src\/[A-Za-z0-9_]+\.sol$/.test(m.file) || typeof m.find !== 'string' || !m.find);
if (bad.length) fail(`mutants.json: ${bad.map((m) => m.id).join(', ')} name a file outside src/ or have no find`);
let chosen = list;
if (args.only) {
  const ids = args.only.split(',');
  const unknown = ids.filter((id) => !list.some((m) => m.id === id));
  if (unknown.length) fail(`unknown mutant ids: ${unknown.join(', ')}`);
  chosen = list.filter((m) => ids.includes(m.id));
} else if (args.quick) chosen = list.filter((m) => m.quick);
// --shard k/n keeps every n-th mutant of the chosen list from the k-th (1-based), so n runs at once, each in its own
// copy with its own build cache, together run the list once. Each shard writes its own results file.
let shardTag = '';
if (args.shard) {
  const sm = /^(\d+)\/(\d+)$/.exec(args.shard);
  const [k, n] = sm ? [Number(sm[1]), Number(sm[2])] : [0, 0];
  if (!sm || n < 1 || k < 1 || k > n) fail('--shard is k/n with 1 <= k <= n');
  chosen = chosen.filter((_, i) => i % n === k - 1);
  shardTag = `-shard${k}of${n}`;
}

const realSrc = join(ROOT, 'contracts', 'src');
const before = hashTree(realSrc);
const guard = () => {
  if (!sameTree(before, hashTree(realSrc))) fail(`the checkout's contracts/src changed during the run; stopping`);
};

const log = (s) => process.stdout.write(`${s}\n`);
// --match-test runs only the tests whose names match (forge's own filter), to measure what one test kills on its own,
// such as the decision counter. Its baseline and verdicts use the same filter, and survivors get no full-build pass.
const matchTest = args['match-test'];
const listTag = `${args.list ? `-${basename(args.list, '.json')}` : ''}${matchTest ? `-mt-${matchTest.replace(/[^A-Za-z0-9_]+/g, '_')}` : ''}${shardTag}`;
const run = `${(args.ref ?? 'worktree').replace(/[^A-Za-z0-9._-]+/g, '_')}-${build}${listTag}`;
lock(`mutation-${run}`);
const { contracts, label, commit } = prepareCopy(`mutation-${run}`, args.ref ?? null);

// --check: say which mutants apply to this source exactly once, and stop. No forge runs.
if (args.check) {
  const where = { applies: [], missing: [], twice: [] };
  for (const m of chosen) {
    let text = '';
    try {
      text = readFileSync(join(contracts, m.file), 'utf8');
    } catch {
      where.missing.push(`${m.id} (no ${m.file})`);
      continue;
    }
    const at = text.indexOf(m.find);
    if (at < 0) where.missing.push(m.id);
    else if (text.indexOf(m.find, at + 1) >= 0) where.twice.push(m.id);
    else where.applies.push(`${m.id} ${m.file}:${text.slice(0, at).split('\n').length}`);
  }
  log(`check of ${chosen.length} mutants from ${listPath} against ${label}:`);
  log(`  apply once: ${where.applies.length}`);
  log(`  text missing (stale): ${where.missing.length}${where.missing.length ? ` ${where.missing.join(', ')}` : ''}`);
  log(`  text found twice: ${where.twice.length}${where.twice.length ? ` ${where.twice.join(', ')}` : ''}`);
  rmSync(join(SCRATCH, `mutation-${run}`), { recursive: true, force: true });
  process.exit(where.missing.length + where.twice.length === 0 ? 0 : 1);
}
const resultsPath = join(SCRATCH, `mutation-${run}.json`);
const reportPath = join(SCRATCH, `mutation-${run}.md`);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const srcHash = sha(JSON.stringify(hashTree(join(contracts, 'src'))));
const testsHash = sha(JSON.stringify(hashTree(join(contracts, 'test'))));
const mutantHash = (m) => sha(JSON.stringify([m.file, m.find, m.replace]));

// The fast build (default): the IR pipeline with the minimum optimizer steps, the settings `forge coverage
// --ir-minimum` uses. The copy compiles in about 52 s instead of 308 s (measured on main, 2026-11-11). It changes gas
// and code size, not behaviour, so the tests that assert gas budgets are left out of the fast run (FAST_SKIP and the
// gas-cap tests); a mutant only they would kill survives the fast run and gets its verdict on the full build.
const FAST_SKIP = 'test/unit/GasPerDeal.t.sol';
const toml = join(contracts, 'foundry.toml');
assertInScratch(toml);
const fullToml = readFileSync(toml, 'utf8');
// The side-by-side test does not compile under the fast build (stack too deep at SideBySide.t.sol:265), so the
// main run leaves it out of the copy; the full-build step below puts it back.
const SIDE_BY_SIDE = 'test/differential/SideBySide.t.sol';
const testFilter = [
  ...(build === 'fast' ? ['--no-match-path', FAST_SKIP, '--no-match-test', GAS_CAP_REGEX] : []),
  ...(matchTest ? ['--match-test', matchTest] : []),
];
if (build === 'fast') {
  if (!/^optimizer = true$/m.test(fullToml) || !/^via_ir = true$/m.test(fullToml)) {
    fail(`${toml} has no optimizer or via_ir line to adjust`);
  }
  writeFileSync(
    toml,
    `${fullToml.replace(/^optimizer = true$/m, 'optimizer = false')}
# T-352 fast mutation build, in the scratch copy only: forge coverage's --ir-minimum settings.
[profile.default.optimizer_details]
peephole = false
inliner = false
jumpdestRemover = false
orderLiterals = false
deduplicate = false
cse = false
constantOptimizer = false
yul = true

[profile.default.optimizer_details.yulDetails]
stackAllocation = true
optimizerSteps = ""
`,
  );
}
// The rest of test/differential/ stays in the copy: StateOracle.t.sol imports its Sides.sol.
const sideBySide = join(contracts, SIDE_BY_SIDE);
const harness = join(SCRATCH, `mutation-${run}-SideBySide.t.sol`);
assertInScratch(sideBySide);
assertInScratch(harness);
const hasHarness = existsSync(sideBySide);
if (hasHarness) cpSync(sideBySide, harness);
rmSync(sideBySide, { force: true });

const forge = (sub, extra = []) => {
  const t0 = Date.now();
  const seed = sub === 'test' ? ['--fuzz-seed', FUZZ_SEED] : [];
  const r = spawnSync('forge', [sub, '--root', contracts, '--color', 'never', ...seed, ...extra], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    timeout: timeoutMs,
  });
  return {
    ...r,
    timedOut: r.error?.code === 'ETIMEDOUT',
    out: `${r.stdout ?? ''}\n${r.stderr ?? ''}`,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
};
/** Totals from forge test's last line: "Ran N test suites in …: P tests passed, F failed, S skipped (T total tests)". */
const totals = (out) => {
  const m = [...out.matchAll(/(\d+) tests passed, (\d+) failed, (\d+) skipped \((\d+) total tests\)/g)].pop();
  return m ? { passed: Number(m[1]), failed: Number(m[2]), skipped: Number(m[3]), total: Number(m[4]) } : null;
};
/** How many result lines start with [FAIL, and the test names forge printed on them. */
const failures = (out) => ({
  count: [...out.matchAll(/^\[FAIL/gm)].length,
  names: [...new Set([...out.matchAll(/^\[FAIL[^\n]*\]\s+((?:test|invariant|setUp)\w*)\(/gm)].map((m) => m[1]))],
});
const compiledSomething = (out) => /Compiling \d+ files? with/.test(out) && /Compiler run successful/.test(out);

// Results and the report, written after every mutant and before any stop.
const meta = { label, commit, srcHash, testsHash, build, fuzzSeed: FUZZ_SEED };
let previous = {};
if (args.resume && existsSync(resultsPath)) {
  const old = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const same = ['srcHash', 'testsHash', 'build', 'fuzzSeed'].every((k) => old.meta?.[k] === meta[k]);
  if (!same) {
    fail(`--resume: ${resultsPath} was recorded on other source or tests, another build or another seed; run without --resume`);
  }
  previous = old.results ?? {};
}
const results = {};
for (const m of chosen) {
  if (previous[m.id] && previous[m.id].mutantHash === mutantHash(m)) results[m.id] = previous[m.id];
}
let base = null;
let b0 = null;
let t0 = null;
const save = () =>
  writeFileSync(
    resultsPath,
    JSON.stringify({ meta, baseline: base && { ...base, buildSeconds: b0.seconds, testSeconds: t0.seconds }, results }, null, 2),
  );
const report = () => {
  const rows = chosen.map((m) => results[m.id]).filter(Boolean);
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const scored = count('killed') + count('survived');
  const finalSurvivors = rows.filter((r) => r.verdict === 'survived' && r.full !== 'killed').length;
  const md = [
    `# Mutation run: ${label}`,
    '',
    base
      ? `Baseline (${build} build): ${base.passed} tests passed; the unmutated copy built in ${b0.seconds} s and tested in ${t0.seconds} s. Fuzz seed ${FUZZ_SEED}.`
      : 'No baseline: the run stopped before it.',
    '',
    `${rows.length} mutants: ${count('killed')} killed, ${count('survived')} survived the ${build} run, ${count('not-compiled')} not compiled, ${count('stale')} stale, ${count('timeout')} timed out, ${count('error')} errors. Score ${scored ? ((100 * count('killed')) / scored).toFixed(1) : 'n/a'}% of the ${scored} that compiled and ran. After the full build: ${finalSurvivors} survive.`,
    '',
    'Survivors of the main run ran again on the full build with every test, the side-by-side test included; that verdict is the "Full build" column.',
    '',
    '| Mutant | Verdict | Where | Change | Killed by | Full build | Seconds |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.id}${r.money ? ' (money)' : ''} | ${r.verdict} | ${r.file}${r.line ? `:${r.line}` : ''} | ${r.op}: ${r.what} | ${(r.killedBy ?? [])[0] ?? r.detail ?? ''} | ${r.full ?? ''}${r.fullKilledBy?.length ? ` (${r.fullKilledBy[0]})` : ''} | ${r.seconds} |`,
    ),
    '',
    `## Survivors, with the mutated text`,
    '',
    `Line numbers are those of commit ${commit}; the text below finds the line after comments move it.`,
    '',
  ];
  const oneLine = (s) => s.replace(/\s+/g, ' ').trim() || '(nothing)';
  for (const r of rows.filter((x) => x.verdict === 'survived' && x.full !== 'killed')) {
    const m = chosen.find((x) => x.id === r.id);
    md.push(`- **${r.id}**, ${r.file}:${r.line}, ${r.what}: \`${oneLine(m.find)}\` became \`${oneLine(m.replace)}\``);
  }
  md.push('');
  writeFileSync(reportPath, md.join('\n'));
  return md[4];
};
const stop = (message) => {
  save();
  report();
  fail(message);
};

// Baseline: the unmutated copy must build and pass every test, or no verdict below would mean anything.
log(`mutation run on ${label}: ${chosen.length} mutants, ${build} build; copy at ${contracts}`);
b0 = forge('build');
if (b0.status !== 0) stop(`the unmutated copy does not build:\n${b0.out.slice(-3000)}`);
t0 = forge('test', testFilter);
base = totals(t0.out);
if (t0.status !== 0 || !base || base.failed !== 0 || base.passed === 0) {
  base = null;
  stop(`the unmutated copy does not pass its tests (exit ${t0.status}):\n${t0.out.slice(-3000)}`);
}
log(`baseline: built in ${b0.seconds} s; ${base.passed} tests passed in ${t0.seconds} s`);
guard();

const pristine = new Map();
const original = (file) => {
  if (!pristine.has(file)) pristine.set(file, readFileSync(join(contracts, file), 'utf8'));
  return pristine.get(file);
};
const restore = (file) => {
  const path = join(contracts, file);
  assertInScratch(path);
  writeFileSync(path, original(file));
  if (sha(readFileSync(path, 'utf8')) !== sha(original(file))) fail(`could not restore ${path}`);
};

/** Applies m to the copy; returns its line number, or null when `find` is not exactly once in the file. */
function apply(m) {
  const text = original(m.file);
  const at = text.indexOf(m.find);
  if (at < 0 || text.indexOf(m.find, at + 1) >= 0) return null;
  const mutated = text.slice(0, at) + m.replace + text.slice(at + m.find.length);
  if (mutated === text) return null;
  const path = join(contracts, m.file);
  assertInScratch(path);
  writeFileSync(path, mutated);
  return text.slice(0, at).split('\n').length;
}

/** Builds and tests the applied mutant; returns { verdict, killedBy?, detail?, seconds }. */
function judge(extra, expectPassed) {
  const b = forge('build');
  if (b.timedOut) return { verdict: 'timeout', detail: 'forge build', seconds: b.seconds };
  if (b.status !== 0) {
    return { verdict: 'not-compiled', detail: (b.out.match(/Error[^\n]*\n[^\n]*/) ?? [''])[0].trim(), seconds: b.seconds };
  }
  if (!compiledSomething(b.out)) return { verdict: 'error', detail: 'forge build did not recompile the mutated file', seconds: b.seconds };
  const t = forge('test', [...extra, '--fail-fast']);
  const seconds = b.seconds + t.seconds;
  const f = failures(t.out);
  const tt = totals(t.out);
  if (t.timedOut) return { verdict: 'timeout', detail: 'forge test', seconds };
  if (t.status !== 0 && f.count > 0) return { verdict: 'killed', killedBy: f.names.length ? f.names.slice(0, 5) : ['(see the forge log)'], seconds };
  if (t.status === 0 && tt && tt.failed === 0 && tt.passed === expectPassed) return { verdict: 'survived', seconds };
  return { verdict: 'error', detail: `forge test exit ${t.status}, ${tt ? `${tt.passed} passed, ${tt.failed} failed` : 'no totals line'}`, seconds };
}

for (const m of chosen) {
  if (results[m.id]) continue;
  const r = { id: m.id, file: m.file, op: m.op, money: !!m.money, what: m.what, mutantHash: mutantHash(m) };
  const started = Date.now();
  try {
    r.line = apply(m);
    if (r.line === null) r.verdict = 'stale';
    else Object.assign(r, judge(testFilter, base.passed));
  } finally {
    restore(m.file);
    guard();
  }
  r.seconds = Math.round((Date.now() - started) / 1000);
  results[m.id] = r;
  save();
  report();
  log(`${m.id} ${r.verdict}${r.line ? ` ${m.file}:${r.line}` : ''} (${r.seconds} s) ${m.what}${r.killedBy ? ` <- ${r.killedBy[0]}` : ''}`);
}

// Survivors again, on the full build with every test: the side-by-side test and, after a fast run, the gas tests.
// `full` records that second verdict, by the same rules as the first.
const survivors = chosen.filter((m) => results[m.id]?.verdict === 'survived' && results[m.id].full === undefined);
if (survivors.length && !args['no-full'] && !matchTest) {
  log(`running ${survivors.length} survivors again on the full build with every test`);
  if (hasHarness) cpSync(harness, sideBySide);
  writeFileSync(toml, fullToml);
  const db = forge('build');
  if (db.status !== 0) stop(`the copy does not build in full:\n${db.out.slice(-3000)}`);
  const dt = forge('test');
  const fullBase = totals(dt.out);
  if (dt.status !== 0 || !fullBase || fullBase.failed !== 0) stop(`the full suite fails on the unmutated copy:\n${dt.out.slice(-3000)}`);
  meta.fullBaseline = { passed: fullBase.passed, buildSeconds: db.seconds, testSeconds: dt.seconds };
  log(`full baseline: built in ${db.seconds} s; ${fullBase.passed} tests passed in ${dt.seconds} s`);
  for (const m of survivors) {
    const r = results[m.id];
    try {
      if (apply(m) === null) stop(`${m.id} no longer applies`);
      const j = judge([], fullBase.passed);
      r.full = j.verdict;
      r.fullKilledBy = j.killedBy;
      r.fullDetail = j.detail;
      r.fullSeconds = j.seconds;
    } finally {
      restore(m.file);
      guard();
    }
    save();
    report();
    log(`${m.id} on the full build: ${r.full}${r.fullKilledBy ? ` <- ${r.fullKilledBy[0]}` : ''}`);
  }
}

save();
log(`\n${report()}\nreport: ${reportPath}\nresults: ${resultsPath}`);
guard();
