// `pnpm snap`: runs scenario fixtures against the stub settlement and compares each rendered
// transcript with its .expect.md snapshot. Prints one pass/fail line per fixture and a summary;
// exits 1 when any fixture fails and 2 on a usage error.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from './context.js';
import { loadTermsFile } from './fixture-files.js';
import { JUDGES, SETTLEMENTS, type JudgeSource, type SettlementBackend } from './pragma.js';
import { evaluate, prefixOf, type Outcome, type RunSummary } from './prefix.js';
import { FakeJudges, RecordedJudges, RecordingInvalidError, RecordingJudges, RecordingMismatchError, RecordingMissingError, RecordingOverwriteError, type JudgeProvider } from './recorded.js';
import { renderErrorSnapshot, renderSnapshot } from './render.js';
import { parseScenario } from './scenario.js';
import { StubSettlement } from './stub-settlement.js';
import { STUB_ACCEPTANCE } from './stub-terms.js';

export interface RunOptions {
  /** Repository root: fixtures are read from <root>/fixtures. */
  root: string;
  name: string;
  judges?: JudgeSource;
  settlement?: SettlementBackend;
  /** Write each verdict as a recording (fake judges only in this build). */
  record?: boolean;
}

export interface ScenarioRun {
  snapshot: string;
  outcome: Outcome;
  summary: RunSummary;
  states: string[];
}

/** A refusal the user must act on: printed as-is, exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

const LIVE_REFUSAL =
  'live judges are unavailable in this build: T-005 ships recorded and fake judges only and makes no network calls or model API requests. Use --judges recorded (the default) or --judges fake.';

const scenarioDir = (root: string) => join(root, 'fixtures', 'scenarios');
const recordingsDir = (root: string) => join(root, 'fixtures', 'recordings');

function settlementRefusal(s: SettlementBackend): string | null {
  return s === 'sim' ? null : `--settlement ${s} runs the same fixtures against the EVM contract, which arrives in Phase 2; use --settlement sim`;
}

function provider(root: string, judges: JudgeSource, record: boolean, termsFile: string | undefined): JudgeProvider {
  if (judges === 'live') throw new UsageError(LIVE_REFUSAL);
  // Fake judges score the rubric the commitment will carry: the terms file's when it exists, else the stub's.
  const acceptance = termsFile !== undefined && existsSync(join(root, termsFile)) ? loadTermsFile(join(root, termsFile)).acceptance : STUB_ACCEPTANCE;
  const criteria = acceptance.rubric.criteria.map((c) => c.id);
  if (judges === 'fake') return record ? new RecordingJudges(new FakeJudges(criteria), recordingsDir(root)) : new FakeJudges(criteria);
  if (record) throw new UsageError('--record needs --judges live (or --judges fake for stub recordings)');
  return new RecordedJudges(recordingsDir(root));
}

/** Errors that must always fail a run, even for todo. fixtures. */
const LOUD = [UsageError, RecordingMismatchError, RecordingMissingError, RecordingInvalidError, RecordingOverwriteError];

/**
 * Runs one fixture and renders its snapshot. Throws on fixture, recording or usage errors, except that a
 * todo. fixture records a fixture or run error in its snapshot (docs/testing.md: todo records today's behavior).
 */
export async function runScenario(options: RunOptions): Promise<ScenarioRun> {
  try {
    return await runOnce(options);
  } catch (e) {
    const error = e as Error;
    if (prefixOf(options.name) !== 'todo' || LOUD.some((k) => error instanceof k)) throw error;
    return {
      snapshot: renderErrorSnapshot(options.name, error),
      outcome: { pass: true, label: 'todo', reasons: [] },
      summary: { finalState: null, problems: [], outages: [], judgments: [], invariants: [], autoAccepted: false, balances: {}, runError: `${error.name}: ${error.message}` },
      states: [],
    };
  }
}

async function runOnce(options: RunOptions): Promise<ScenarioRun> {
  const file = join(scenarioDir(options.root), `${options.name}.scenario.yaml`);
  const scenario = parseScenario(readFileSync(file, 'utf8'), options.name);
  if (options.judges) scenario.pragmas.judges = options.judges;
  if (options.settlement) scenario.pragmas.settlement = options.settlement;
  const refusal = settlementRefusal(scenario.pragmas.settlement);
  if (refusal) throw new UsageError(refusal);

  const ctx = createContext({ seed: scenario.pragmas.seed });
  const judges = provider(options.root, scenario.pragmas.judges, options.record ?? false, scenario.terms);
  const run = await new StubSettlement(ctx, scenario, judges, options.root).run();
  const summary: RunSummary = {
    finalState: run.finalState,
    problems: run.problems,
    outages: run.outages,
    judgments: run.judgments.map((j) => j.aggregate.decision),
    invariants: run.invariants.map(({ name, ok }) => ({ name, ok })),
    autoAccepted: run.autoAccepted,
    balances: run.balances,
  };
  const prefix = prefixOf(scenario.name);
  const outcome = evaluate(prefix, summary, scenario.expect, scenario.fails);
  return { snapshot: renderSnapshot(scenario, prefix, run, outcome), outcome, summary, states: run.states };
}

export interface SnapArgs {
  names: string[];
  update: boolean;
  record: boolean;
  judges?: JudgeSource;
  settlement?: SettlementBackend;
}

export function parseArgs(argv: readonly string[]): SnapArgs {
  const args: SnapArgs = { names: [], update: false, record: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    const [flag, inline] = arg.startsWith('--') ? (arg.split(/=(.*)/s, 2) as [string, string | undefined]) : [arg, undefined];
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--update':
        args.update = true;
        break;
      case '--record':
        args.record = true;
        break;
      case '--judges': {
        const v = value();
        if (!(JUDGES as readonly string[]).includes(v)) throw new UsageError(`--judges must be one of ${JUDGES.join(', ')}; got "${v}"`);
        args.judges = v as JudgeSource;
        break;
      }
      case '--settlement': {
        const v = value();
        if (!(SETTLEMENTS as readonly string[]).includes(v)) throw new UsageError(`--settlement must be one of ${SETTLEMENTS.join(', ')}; got "${v}"`);
        args.settlement = v as SettlementBackend;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown flag ${arg}; usage: pnpm snap [name...] [--update] [--settlement sim] [--judges recorded|fake] [--record]`);
        args.names.push(arg);
    }
  }
  if (args.record && args.judges !== 'live' && args.judges !== 'fake') throw new UsageError('--record needs --judges live (or --judges fake for stub recordings)');
  if (args.judges === 'live') throw new UsageError(LIVE_REFUSAL);
  if (args.settlement) {
    const refusal = settlementRefusal(args.settlement);
    if (refusal) throw new UsageError(refusal);
  }
  if (args.record && args.names.length === 0) throw new UsageError('--record needs a fixture name, so recordings are rewritten one fixture at a time');
  if (args.update && args.names.length === 0) throw new UsageError('--update needs a fixture name, so every snapshot rewrite is a deliberate, reviewed change');
  return args;
}

/** The first differing line, shown as - expected / + actual. */
function firstDiff(expected: string, actual: string): string {
  const e = expected.split('\n');
  const a = actual.split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i++) {
    if (e[i] !== a[i]) return `snapshot differs at line ${i + 1}\n    - ${e[i] ?? '(end of file)'}\n    + ${a[i] ?? '(end of file)'}`;
  }
  return 'snapshot differs';
}

export interface SnapIO {
  root: string;
  out: (line: string) => void;
}

export async function main(argv: readonly string[], io: SnapIO): Promise<number> {
  let args: SnapArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.out(`snap: ${(e as Error).message}`);
    return 2;
  }

  const dir = scenarioDir(io.root);
  const all = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.scenario.yaml'))
        .map((f) => f.slice(0, -'.scenario.yaml'.length))
        .sort()
    : [];
  const names = args.names.length ? args.names : all;
  let passed = 0;
  let failed = 0;
  const fail = (name: string, why: string) => {
    failed++;
    io.out(`fail  ${name}: ${why}`);
  };

  for (const name of names) {
    if (!all.includes(name)) {
      fail(name, `no fixture fixtures/scenarios/${name}.scenario.yaml`);
      continue;
    }
    let run: ScenarioRun;
    try {
      const options: RunOptions = { root: io.root, name, record: args.record };
      if (args.judges) options.judges = args.judges;
      if (args.settlement) options.settlement = args.settlement;
      run = await runScenario(options);
    } catch (e) {
      const err = e as Error;
      fail(name, `${err.name}: ${err.message}`);
      continue;
    }

    const expectPath = join(dir, `${name}.expect.md`);
    let note = '';
    if (args.update) {
      writeFileSync(expectPath, run.snapshot);
      note = ' (snapshot updated)';
    } else if (!existsSync(expectPath)) {
      fail(name, `no snapshot; run pnpm snap --update ${name} and review it`);
      continue;
    } else {
      const expected = readFileSync(expectPath, 'utf8');
      if (expected !== run.snapshot) {
        fail(name, `${firstDiff(expected, run.snapshot)}\n    review with: pnpm snap --update ${name} && git diff fixtures/scenarios/${name}.expect.md`);
        continue;
      }
    }
    if (!run.outcome.pass) {
      fail(name, `${run.outcome.reasons.join('; ')}${note}`);
      continue;
    }
    passed++;
    io.out(`${run.outcome.label === 'todo' ? 'pass' : 'pass'}  ${name}${run.outcome.label === 'todo' ? ' (todo)' : ''}${note}`);
  }
  io.out(`snap: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}
