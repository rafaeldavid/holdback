#!/usr/bin/env node
// `pnpm health`: counts the things that make the demo fail silently or a change slow, so a cleanup round has a
// before and an after (T-313). A pure script: it reads tracked source files and, with --gh, GitHub's run and pull
// request lists. No model, no network otherwise. A count is a signal, not a rule: a site that is right stays.
//
//   node scripts/health.mjs                 the table, from the working tree
//   node scripts/health.mjs --json          the same as JSON on stdout
//   node scripts/health.mjs --out <file>    writes the JSON to a file as well
//   node scripts/health.mjs --gh            adds CI wall time and files per merged pull request (needs gh)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCHEMA_VERSION = 1;

const SOURCE_DIRS = ['apps/', 'packages/', 'examples/', 'scripts/', 'site/', 'tools/'];
const SOURCE_FILE = /\.(ts|mjs|js)$/;
/**
 * Tests, generated code and bundles are not counted: they are not what runs the demo, or nobody edits them. Nor is
 * this script, whose patterns would count themselves.
 */
const NOT_SOURCE = /^scripts\/health\.mjs$|\.test\.ts$|\.generated\.ts$|^site\/try\.mjs$|\/test\/|\/fixtures?\/|(^|\/)_[^/]+\.ts$|\.fixture\.ts$|^apps\/demo-cloud\/worker\/generated-files\.js$/;
/** A source file over this many lines counts as large. */
export const LARGE_LINES = 800;

export const isSource = (path) => SOURCE_DIRS.some((d) => path.startsWith(d)) && SOURCE_FILE.test(path) && !NOT_SOURCE.test(path);

/** Facts that must agree wherever they are written. Each counts the source files that state it; one is the aim. */
export const FACTS = [
  { id: 'operator-url-1', what: 'operator node 1 URL', pattern: /https:\/\/api\.crow\.direct/ },
  { id: 'operator-url-2', what: 'operator node 2 URL', pattern: /https:\/\/api2\.crow\.direct/ },
  { id: 'old-host', what: 'escrow.stream, outside the forwarding Workers', pattern: /escrow\.stream/, skip: /^apps\/(site|early-access)\/worker\.js$|^apps\/test-agents\/src\/worker\.ts$/ },
  { id: 'chain-sepolia', what: 'the Sepolia chain ID', pattern: /\b11155111\b/ },
  { id: 'chain-anvil', what: 'the local chain ID', pattern: /\b31337\b/ },
  { id: 'mainnet-list', what: 'a mainnet deny list', pattern: /\b42161\b/ },
  { id: 'world-name', what: 'a demo world name', pattern: /holdback-public-demo/ },
  { id: 'sepolia-rpc', what: 'the public Sepolia RPC URL', pattern: /ethereum-sepolia-rpc\.publicnode\.com/ },
  { id: 'day-seconds', what: 'a day in seconds as a literal (the expiry margin, among others)', pattern: /\b86[_,]?400\b/ },
  { id: 'far-future', what: 'the far-future timestamp', pattern: /9999-12-31T23:59:59Z/ },
];

const SWALLOW = /\.catch\(\s*(?:\(\s*\)|_\w*)\s*=>\s*(?:undefined|null|\{\s*\}|void 0)\s*\)/g;
const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const MODULE_LET = /^(?:export\s+)?let\s+\w+/;
const MODULE_COLLECTION = /^(?:export\s+)?const\s+\w+\s*(?::\s*[^=]+)?=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b[^(]*\(\s*\)/;
const TEST_HOOK = /\b(\w+ForTest|dropResponses)\b\s*[?(:=]/g;

const sites = (files, find) => files.flatMap((f) => find(f).map((line) => `${f.path}:${line}`));
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const matches = (text, pattern) => [...text.matchAll(pattern)].map((m) => lineOf(text, m.index));

/** Errors dropped with no log: `.catch(() => undefined)` and an empty `catch {}`. */
export const swallowedErrors = (files) => sites(files, (f) => [...matches(f.text, SWALLOW), ...matches(f.text, EMPTY_CATCH)].sort((a, b) => a - b));

/**
 * State that outlives a call and belongs to no object: a top-level `let`, or a top-level Map or Set that starts empty.
 * A collection built from a literal list is a lookup table, not state, and is not counted.
 */
export const moduleState = (files) =>
  sites(files, (f) => f.text.split('\n').flatMap((line, i) => (MODULE_LET.test(line) || MODULE_COLLECTION.test(line) ? [i + 1] : [])));

/** Members that exist for tests inside code that runs the demo. */
export const testHooks = (files) => sites(files, (f) => matches(f.text, TEST_HOOK));

/** For each fact, the source files that state it. */
export const duplicatedFacts = (files) =>
  FACTS.map((fact) => {
    const where = files.filter((f) => !(fact.skip && fact.skip.test(f.path)) && fact.pattern.test(f.text)).map((f) => f.path);
    return { id: fact.id, what: fact.what, files: where.length, extra: Math.max(0, where.length - 1), where };
  });

export const largeFiles = (files) =>
  files
    .map((f) => ({ path: f.path, lines: f.text.split('\n').length }))
    .filter((f) => f.lines > LARGE_LINES)
    .sort((a, b) => b.lines - a.lines);

/**
 * Test files whose suites skip on a missing tool or variable (`skipIf`, `runIf`) and that no CI step names. `ciPaths`
 * are the paths CI's must-not-skip step runs; a file under one of them runs there.
 */
export function gatedOutsideCi(tests, ciPaths) {
  return tests
    .filter((t) => /^\s*(?:describe|it|test)\.(?:skipIf|runIf)\(/m.test(t.text))
    .map((t) => t.path)
    .filter((p) => !ciPaths.some((c) => p === c || p.startsWith(c.endsWith('/') ? c : `${c}/`)));
}

/**
 * The test paths the workflow names: every word in it that is a path under a source folder. The must-not-skip
 * jobs list theirs in a matrix or after `vitest run`, and nothing else in the workflow is a bare path.
 */
export function ciAnvilPaths(workflow) {
  return [...new Set(workflow.split(/\s+/).filter((w) => /^(?:apps|packages|examples|tests|tools)\/[\w./-]+$/.test(w)))];
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** The whole report from file contents; `gh` adds what GitHub knows. */
export function report({ sources, tests, workflow, gh = null, commit = 'unknown', generatedAt = new Date().toISOString() }) {
  const facts = duplicatedFacts(sources);
  const swallowed = swallowedErrors(sources);
  const state = moduleState(sources);
  const hooks = testHooks(sources);
  const large = largeFiles(sources);
  const gated = gatedOutsideCi(tests, ciAnvilPaths(workflow));
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    commit,
    files: { sources: sources.length, tests: tests.length },
    counts: {
      swallowedErrors: swallowed.length,
      moduleState: state.length,
      testHooks: hooks.length,
      duplicatedFacts: facts.reduce((n, f) => n + f.extra, 0),
      largeFiles: large.length,
      gatedSuitesOutsideCi: gated.length,
    },
    detail: { swallowedErrors: swallowed, moduleState: state, testHooks: hooks, duplicatedFacts: facts, largeFiles: large, gatedSuitesOutsideCi: gated },
    ...(gh ? { github: gh } : {}),
  };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function readTracked() {
  const paths = git(['ls-files', ...SOURCE_DIRS, 'tests/']).split('\n').filter(Boolean);
  const read = (path) => ({ path, text: readFileSync(new URL(path, `file://${ROOT}`), 'utf8') });
  return {
    sources: paths.filter(isSource).map(read),
    tests: paths.filter((p) => p.endsWith('.test.ts')).map(read),
  };
}

/** CI wall time on pull requests and files per merged pull request, from gh. Null fields when gh cannot say. */
function github() {
  const gh = (args) => JSON.parse(execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' }));
  const out = { ciWallSecondsMedian: null, ciRuns: 0, filesPerMergedPrMedian: null, mergedPrs: 0 };
  try {
    const runs = gh(['run', 'list', '--workflow', 'ci', '--event', 'pull_request', '--status', 'success', '--limit', '20', '--json', 'createdAt,updatedAt']);
    const seconds = runs.map((r) => Math.round((Date.parse(r.updatedAt) - Date.parse(r.createdAt)) / 1000)).filter((s) => s > 0);
    out.ciWallSecondsMedian = median(seconds);
    out.ciRuns = seconds.length;
  } catch {
    out.ciWallSecondsMedian = null;
  }
  try {
    const prs = gh(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', 'changedFiles']);
    out.filesPerMergedPrMedian = median(prs.map((p) => p.changedFiles));
    out.mergedPrs = prs.length;
  } catch {
    out.filesPerMergedPrMedian = null;
  }
  return out;
}

export function table(r) {
  const rows = [
    ['Errors dropped with no log', r.counts.swallowedErrors],
    ['Module-level mutable state', r.counts.moduleState],
    ['Test hooks in demo code', r.counts.testHooks],
    ['Copies of facts beyond one each', r.counts.duplicatedFacts],
    [`Source files over ${LARGE_LINES} lines`, r.counts.largeFiles],
    ['Gated test files no CI step names', r.counts.gatedSuitesOutsideCi],
  ];
  if (r.github) {
    rows.push(['CI wall time on a pull request, median s', r.github.ciWallSecondsMedian ?? 'unknown']);
    rows.push(['Files per merged pull request, median', r.github.filesPerMergedPrMedian ?? 'unknown']);
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  const facts = r.detail.duplicatedFacts.filter((f) => f.files > 1).map((f) => `  ${f.what}: ${f.files} files`);
  return [`Health at ${r.commit} (${r.files.sources} source files, ${r.files.tests} test files)`, ...rows.map(([name, n]) => `  ${name.padEnd(width)}  ${n}`), 'Facts written in more than one file:', ...facts].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const { sources, tests } = readTracked();
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', `file://${ROOT}`), 'utf8');
  const r = report({ sources, tests, workflow, gh: args.includes('--gh') ? github() : null, commit: git(['rev-parse', '--short', 'HEAD']).trim() });
  if (outAt >= 0 && args[outAt + 1]) writeFileSync(args[outAt + 1], `${JSON.stringify(r, null, 2)}\n`);
  console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : table(r));
}
