#!/usr/bin/env node
// The benchmark harness (T-412, roadmap B1): runs one of the six outsider scenarios (scenarios.mjs) with a fresh agent
// and writes one record, `crow.metrics.one-click/2` (bench-record.mjs builds it; scripts/metrics/schemas/
// one-click.schema.json checks it). A record that fails its schema is kept as <runId>.json.invalid.
//
//   node tools/one-click/bench.mjs --scenario s1                 scripted: no key, no model, no network beyond 127.0.0.1
//   node tools/one-click/bench.mjs --scenario all                scripted, the six in turn
//   node tools/one-click/bench.mjs --scenario s1 --live          live: a fresh Claude Code on Sepolia; Rafa starts it
//
// Scripted runs play the scenario in the public demo's own world in this process, against Crow's test seller and test
// buyer (bench-local.mjs): they prove the harness and the scenario path, and never fill a headline number. A scenario
// Crow's test agents cannot play yet writes a record with the state "blocked" and what is missing.
//
// Live runs read the agent key from HOLDBACK_AGENT_ANTHROPIC_API_KEY and refuse to start without it (bench-live.mjs).
// Options (live only): --model (claude-opus-5-5), --effort (medium), --max-replies (4), --timeout-min (40),
// --idle-min (5), --unsandboxed, --logs <dir> (raw messages, scrubbed, outside git).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { check } from '../../scripts/metrics/check.mjs';
import { ROOT, gitCommit } from '../../scripts/metrics/lib.mjs';
import { benchRunId, buildBenchRecord, scrubSecrets } from './bench-record.mjs';
import { EFFORTS, REQUESTED_MODEL_ID } from './metrics.mjs';
import { readCalls, writeFetchProbe } from './probes.mjs';
import { DOCS, SCENARIOS, SCENARIO_IDS } from './scenarios.mjs';

const KEY_VAR = 'HOLDBACK_AGENT_ANTHROPIC_API_KEY';

function fail(message, code = 2) {
  console.error(`bench: ${message}`);
  process.exit(code);
}

let args;
try {
  args = parseArgs({
    options: {
      scenario: { type: 'string' },
      live: { type: 'boolean', default: false },
      out: { type: 'string' },
      model: { type: 'string', default: 'claude-opus-5-5' },
      effort: { type: 'string', default: 'medium' },
      'max-replies': { type: 'string', default: '4' },
      'timeout-min': { type: 'string', default: '40' },
      'idle-min': { type: 'string', default: '5' },
      unsandboxed: { type: 'boolean', default: false },
      logs: { type: 'string' },
    },
    strict: true,
  }).values;
} catch (e) {
  fail(String(e?.message ?? e));
}
const ids = args.scenario === 'all' ? SCENARIO_IDS : [args.scenario];
if (!args.scenario || !ids.every((id) => SCENARIOS[id])) fail(`--scenario is one of ${SCENARIO_IDS.join(', ')}${args.live ? '' : ', or all'}`);
if (args.live && ids.length !== 1) fail('--live runs one scenario at a time');

// The key check comes before anything else a live run does, the SDK import included. The key is never printed.
const key = args.live ? (process.env[KEY_VAR] ?? '').trim() : '';
if (args.live && !key) fail(`a live run needs ${KEY_VAR} in the environment (the agents' own key, never the judges'), and it is not set; nothing was sent`);
if (!args.live && process.env[KEY_VAR]) console.error(`bench: scripted run; ${KEY_VAR} is set and is not used`);
if (args.live && !REQUESTED_MODEL_ID.test(args.model)) fail('--model is a model ID: lower-case letters, digits, dots and dashes');
if (args.live && !EFFORTS.includes(args.effort)) fail(`--effort is one of ${EFFORTS.join(', ')}`);
const whole = (name) => {
  const n = Number.parseInt(args[name], 10);
  if (!Number.isSafeInteger(n) || n < 0 || String(n) !== args[name]) fail(`--${name} takes a whole number`);
  return n;
};
const maxReplies = whole('max-replies');
const timeoutMs = whole('timeout-min') * 60_000;
const idleMs = whole('idle-min') * 60_000;
const logsDir = args.logs ? resolve(args.logs) : null;
if (logsDir && (logsDir === ROOT || logsDir.startsWith(ROOT + sep)) && !logsDir.startsWith(join(ROOT, 'reports') + sep)) fail('--logs must be outside the repository or under reports/, so raw logs stay out of git');
// Scripted and live records never share a folder, so a scripted file is never collected as a measurement.
const outDir = resolve(args.out ?? join(ROOT, 'reports/scratch/one-click-bench', args.live ? 'live' : 'scripted'));

// The scripted world imports TypeScript that Node's default type stripping does not take (constructor parameter
// properties), so a scripted run starts itself again with --experimental-transform-types.
if (!args.live && !process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

let prices = null;
try {
  prices = JSON.parse(readFileSync(join(ROOT, 'config/model-prices.json'), 'utf8'));
} catch {
  prices = null;
}
const commit = gitCommit(ROOT);

/** Checks and writes one record; returns whether it passed its schema. */
function write(record, secrets = []) {
  const clean = scrubSecrets(record, secrets);
  const ok = check('one-click', clean);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${clean.runId}.json`);
  writeFileSync(`${file}.invalid`, `${JSON.stringify(clean, null, 2)}\n`);
  if (ok.ok) renameSync(`${file}.invalid`, file);
  const o = clean.outcome;
  console.error(`bench: ${clean.scenario.id} ${clean.mode} ${o.state}${o.success ? ' (success)' : ''}${o.blockedBy ? `: ${o.blockedBy}` : ''}; ${clean.approvals.total} approvals, ${clean.apiCalls.total} API calls, ${clean.time.wallMs} ms`);
  console.error(`bench: record ${ok.ok ? `valid: ${file}` : `INVALID: ${file}.invalid\n${ok.errors.join('\n')}`}`);
  return ok.ok;
}

async function scripted(id) {
  const scenario = { id, ...SCENARIOS[id] };
  const startedAtMs = Date.now();
  const base = { mode: 'scripted', scenario, world: { engine: 'local', docs: 'the in-process world: no docs are read by a scripted agent' }, prices, startedAtMs, commit };
  if ('blockedBy' in scenario.scripted) {
    return { record: buildBenchRecord({ ...base, agent: {}, outcome: { state: 'blocked', blockedBy: scenario.scripted.blockedBy }, book: { wallMs: 0 }, generatedAtMs: Date.now() }), complete: false };
  }
  const { script, args: argv, needs } = scenario.scripted;
  const { operatorState, runScripted, scriptedOutcome, startLocal } = await import('./bench-local.mjs');
  const probeDir = mkdtempSync(join(tmpdir(), 'crow-bench-scripted-'));
  const probe = writeFetchProbe(probeDir);
  const world = await startLocal(needs);
  let run;
  let outcome;
  try {
    run = await runScripted({ script, args: argv, operators: world.operators, party: world.party, needs, probe: probe.path });
    outcome = scriptedOutcome(run, scenario);
    // The script's own "done" line is not enough: the operator must report the same end state for the same commitment.
    if (outcome.commitmentId && ['Released', 'Refunded'].includes(outcome.state)) {
      const seen = await operatorState(world.operators[0], outcome.commitmentId);
      if (seen !== outcome.state) {
        outcome.errors.push(`the script said ${outcome.state}, the operator reports ${seen ?? 'nothing'}`);
        outcome.stoppedAt = 'the operator does not report the end state the script printed';
        outcome.state = 'stopped';
      }
    }
  } finally {
    await world.close();
  }
  const calls = readCalls({ fetchLog: probe.log });
  rmSync(probeDir, { recursive: true, force: true });
  const record = buildBenchRecord({ ...base, agent: { script }, outcome, book: { wallMs: run.wallMs, errors: outcome.errors, timedOut: run.timedOut }, calls, generatedAtMs: Date.now() });
  if (!record.outcome.success) console.error(run.out.split('\n').slice(-15).join('\n'));
  return { record, complete: true };
}

async function live(id) {
  const scenario = { id, ...SCENARIOS[id] };
  const startedAtMs = Date.now();
  const runId = benchRunId(startedAtMs, id);
  const note = (s) => console.error(`[${String(Math.round((Date.now() - startedAtMs) / 1000)).padStart(5)} s] ${s}`);
  note(`scenario ${id} live: ${scenario.name}; model ${args.model}, effort ${args.effort}${args.unsandboxed ? ', unsandboxed' : ', in the OS sandbox'}`);
  const { runLive } = await import('./bench-live.mjs');
  const r = await runLive({ scenario, key, model: args.model, effort: args.effort, maxReplies, timeoutMs, idleMs, sandboxed: !args.unsandboxed, logsDir, runId, note });
  const record = buildBenchRecord({ mode: 'live', scenario, world: { engine: 'sepolia', docs: DOCS }, agent: r.agent, outcome: r.outcome, book: r.book, results: r.results, calls: r.calls, texts: r.texts, prices, startedAtMs, generatedAtMs: Date.now(), commit, sources: r.sources, gaps: r.gaps });
  return { record, secrets: r.secrets };
}

let allValid = true;
let allComplete = true;
for (const id of ids) {
  if (args.live) {
    const { record, secrets } = await live(id);
    allValid = write(record, secrets) && allValid;
    allComplete = record.outcome.success && allComplete;
  } else {
    const { record, complete } = await scripted(id);
    allValid = write(record) && allValid;
    if (complete) allComplete = record.outcome.success && allComplete;
  }
}
// 0: every record valid, and every scenario that can run reached its end state; 1: otherwise.
process.exit(allValid && allComplete ? 0 : 1);
