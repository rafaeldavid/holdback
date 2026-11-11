// `pnpm snap`: runs scenario fixtures against the stub settlement and compares each rendered
// transcript with its .expect.md snapshot. Prints one pass/fail line per fixture and a summary;
// exits 1 when any fixture fails and 2 on a usage error.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createContext } from './context.js';
import { loadTermsFile } from './fixture-files.js';
import { JUDGES, SETTLEMENTS, type JudgeSource, type SettlementBackend } from './pragma.js';
import { evaluate, prefixOf, type Outcome, type RunSummary } from './prefix.js';
import { FakeJudges, migrateRecordings, RecordedJudges, RecordingInvalidError, RecordingJudges, RecordingMismatchError, RecordingMissingError, RecordingOverwriteError, type JudgeProvider } from './recorded.js';
import { renderErrorSnapshot, renderSnapshot } from './render.js';
import { parseScenario } from './scenario.js';
import { EvmWorld } from '@holdback/settlement/evm';
import type { JudgmentView } from './judgment.js';
import { StubSettlement, type StubRun } from './stub-settlement.js';
import { STUB_ACCEPTANCE } from './stub-terms.js';

export interface RunOptions {
  /** Repository root: fixtures are read from <root>/fixtures. */
  root: string;
  name: string;
  judges?: JudgeSource;
  settlement?: SettlementBackend;
  /** Write each verdict as a recording (fake judges only in this build). */
  record?: boolean;
  /** The anvil world for --settlement local; started (and stopped) for this one run when absent. */
  world?: EvmWorld;
  /** Where contracts/out lives for --settlement local; defaults to root. */
  contractsRoot?: string;
  /** --settlement local: reuse these judgments (from the SimChain run of the same fixture) instead of judging again. */
  judgments?: ReadonlyMap<string, JudgmentView>;
}

export interface ScenarioRun {
  /** Judgments by commitment number, role and attempt. */
  judgments: ReadonlyMap<string, JudgmentView>;
  snapshot: string;
  outcome: Outcome;
  summary: RunSummary;
  states: string[];
  /** Comparable lines for the differential report (empty for a todo. fixture that recorded a run error). */
  transcript: string[];
  /** EVM only: mined transactions with gas (D4) and who sent them (the escape hatch, ADR-0005). */
  transactions: Array<{ call: string; gasUsed: bigint; from: string; sentBy: string; via: string }>;
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
  return s === 'testnet' ? '--settlement testnet runs against a public test network, which is T-206’s gate; use --settlement sim or --settlement local (anvil)' : null;
}

/**
 * Fixtures that stay SimChain-only until Phase 4 economics are on chain (T-202 Decisions, question 4). A local run
 * prints this list; nothing else is skipped. Each reason names what the contract does not do yet.
 */
export const LOCAL_EXCLUSIONS: Readonly<Record<string, string>> = {
  'neutrality.adjudicator-and-fallback-offline': 'Phase 4: seller compensation from the primary and fallback bonds on default (triggerDefault refunds the buyer only)',
  'neutrality.appeal-adjudicator-offline-after-escalation': 'Phase 4: seller compensation from the appeal adjudicator’s bond on default',
  'honest-seller-survives-judge-noise-on-appeal': 'Phase 4: the rulebook appeal fee is not collected on chain and the appeal bond rate is not checked',
};

/**
 * One fixture run as comparable lines: the timeline (actor, call, via, result, state), state sequence, balances
 * after each step, event types per step, final state and invariants. No hashes, IDs or times, so SimChain and the
 * contract produce the same lines when they behave the same.
 */
export function normalizedTranscript(run: StubRun): string[] {
  const lines: string[] = [];
  for (const r of run.rows) lines.push(`step ${r.step}: ${r.actor} | ${r.call} | ${r.via} | ${r.result} | ${r.state}`);
  lines.push(`states: ${run.states.join(' > ')}`);
  for (const b of run.balanceRows) lines.push(`balances after ${b.after}: ${Object.entries(b.balances).filter(([, v]) => v !== 0n).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const bySteps = new Map<number, string[]>();
  for (const e of run.events) bySteps.set(e.step, [...(bySteps.get(e.step) ?? []), e.type]);
  for (const [step, types] of [...bySteps].sort(([a], [b]) => a - b)) lines.push(`events step ${step}: ${types.join(', ')}`);
  lines.push(`final: ${run.finalState ?? '—'}`);
  for (const i of run.invariants) lines.push(`invariant ${i.name}: ${i.ok ? 'ok' : 'FAILED'}${i.note ? ` (${i.note})` : ''}`);
  return lines;
}

/** Lines only in `a` (-) and only in `b` (+), in order, by longest common subsequence. */
export function diffLines(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out;
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
      transcript: [`run error: ${error.name}: ${error.message}`],
      transactions: [],
      judgments: new Map(),
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
  const local = scenario.pragmas.settlement === 'local';
  const world = local ? (options.world ?? (await EvmWorld.start(options.contractsRoot ?? options.root))) : null;
  let run: StubRun;
  let driver: StubSettlement;
  try {
    driver = new StubSettlement(ctx, scenario, judges, options.root, world ? { kind: 'local', world, ...(options.judgments ? { judgments: options.judgments } : {}) } : { kind: 'sim' });
    run = await driver.run();
  } finally {
    if (world && !options.world) await world.stop();
  }
  const summary: RunSummary = {
    finalState: run.finalState,
    problems: run.problems,
    outages: run.outages,
    judgments: run.judgments.map((j) => j.aggregate.decision),
    invariants: run.invariants.map(({ name, ok }) => ({ name, ok })),
    autoAccepted: run.autoAccepted,
    stubBytes: scenario.steps.some((s) => s.kind === 'deliver' && s.stubBytes === true),
    balances: run.balances,
  };
  const prefix = prefixOf(scenario.name);
  const outcome = evaluate(prefix, summary, scenario.expect, scenario.fails);
  return { snapshot: renderSnapshot(scenario, prefix, run, outcome), outcome, summary, states: run.states, transcript: normalizedTranscript(run), transactions: driver.transactions(), judgments: driver.judgmentsBySlot() };
}

export interface SnapArgs {
  names: string[];
  update: boolean;
  record: boolean;
  /** Move v0 recordings to the role-keyed layout and exit. */
  migrateRecordings?: boolean;
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
      case '--migrate-recordings':
        args.migrateRecordings = true;
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
        if (arg.startsWith('-')) throw new UsageError(`unknown flag ${arg}; usage: pnpm snap [name...] [--update] [--settlement sim|local] [--judges recorded|fake] [--record] | pnpm snap --migrate-recordings`);
        args.names.push(arg);
    }
  }
  if (args.migrateRecordings && (args.names.length || args.update || args.record || args.judges || args.settlement)) {
    throw new UsageError('--migrate-recordings runs on its own: it moves every v0 recording and exits');
  }
  if (args.migrateRecordings) return args;
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
  /** Where contracts/out lives for --settlement local; defaults to root. */
  contractsRoot?: string;
}

/**
 * --settlement local: every fixture not on LOCAL_EXCLUSIONS runs against the contracts on anvil and, for the
 * differential, on SimChain. A fixture passes when its expectations hold on the contract; the .expect.md snapshot
 * is not compared, because commitment IDs, hashes and the token identifier differ by design (ADR-0025).
 */
async function mainLocal(names: readonly string[], all: readonly string[], full: boolean, io: SnapIO, judges: JudgeSource | undefined): Promise<number> {
  io.out('snap: settlement local (anvil, chain id 31337, 127.0.0.1). Each fixture is compared with its SimChain run, not with .expect.md.');
  for (const [name, reason] of Object.entries(LOCAL_EXCLUSIONS)) io.out(`excluded until Phase 4 (SimChain-only)  ${name}: ${reason}`);
  let world: EvmWorld;
  try {
    world = await EvmWorld.start(io.contractsRoot ?? io.root);
  } catch (e) {
    io.out(`snap: cannot start the local EVM world: ${(e as Error).message}`);
    return 1;
  }
  let passed = 0;
  let failed = 0;
  let excluded = 0;
  const report: DifferentialRow[] = [];
  try {
    for (const name of names) {
      if (!all.includes(name)) {
        failed++;
        io.out(`fail  ${name}: no fixture fixtures/scenarios/${name}.scenario.yaml`);
        continue;
      }
      if (LOCAL_EXCLUSIONS[name]) {
        excluded++;
        io.out(`excluded  ${name}: ${LOCAL_EXCLUSIONS[name]}`);
        report.push({ name, excluded: LOCAL_EXCLUSIONS[name]! });
        continue;
      }
      const base: RunOptions = { root: io.root, name, ...(judges ? { judges } : {}) };
      let local: ScenarioRun;
      let sim: ScenarioRun;
      try {
        sim = await runScenario({ ...base, settlement: 'sim' });
        local = await runScenario({ ...base, settlement: 'local', world, judgments: sim.judgments });
      } catch (e) {
        failed++;
        const err = e as Error;
        io.out(`fail  ${name}: ${err.name}: ${err.message}`);
        report.push({ name, error: `${err.name}: ${err.message}` });
        continue;
      }
      const diff = diffLines(sim.transcript, local.transcript);
      const gas = local.transactions.reduce((a, t) => a + t.gasUsed, 0n);
      const row: DifferentialRow = { name, pass: local.outcome.pass, reasons: local.outcome.reasons, diff, gas, txs: local.transactions, label: local.outcome.label };
      report.push(row);
      const note = `gas ${gas.toLocaleString('en-US')} over ${local.transactions.length} tx; ${diff.length ? `${diff.length} transcript lines differ from SimChain` : 'transcript identical to SimChain'}`;
      if (!local.outcome.pass) {
        failed++;
        io.out(`fail  ${name} on the contract: ${local.outcome.reasons.join('; ')} (${note})`);
        continue;
      }
      passed++;
      io.out(`pass  ${name} on the contract${local.outcome.label === 'todo' ? ' (todo)' : ''} (${note})`);
    }
  } finally {
    await world.stop();
  }
  io.out(`snap: settlement local: ${passed} passed, ${failed} failed, ${excluded} excluded until Phase 4`);
  if (full) {
    const path = join(io.root, 'reports', 'differential-local.md');
    mkdirSync(join(io.root, 'reports'), { recursive: true });
    writeFileSync(path, renderDifferential(report));
    io.out(`snap: differential report written to ${relative(io.root, path)}`);
  }
  return failed ? 1 : 0;
}

export type DifferentialRow =
  | { name: string; excluded: string }
  | { name: string; error: string }
  | { name: string; pass: boolean; reasons: string[]; diff: string[]; gas: bigint; txs: ScenarioRun['transactions']; label: string };

/** reports/differential-local.md: per fixture, the result on the contract, gas, and the transcript lines that differ. */
export function renderDifferential(rows: readonly DifferentialRow[]): string {
  const ran = rows.filter((r): r is Extract<DifferentialRow, { pass: boolean }> => 'pass' in r);
  const out = [
    '# Differential report: SimChain vs the contract on anvil',
    '',
    'Generated by `pnpm snap --settlement=local` (T-205). Each fixture runs on SimChain and on HoldbackRules/HoldbackBonds',
    'through `EvmSettlement` on anvil (chain id 31337). Lines are the normalised transcripts (`normalizedTranscript` in',
    '`packages/testkit/src/runner.ts`): timeline rows, states, balances, event types per step, final state and invariants.',
    '`-` is SimChain only, `+` is the contract only. Explanations and the decision on each difference: T-205 Decisions',
    '(docs/tasks/T-205-evm-settlement.md). All values measured.',
    '',
    `Fixtures: ${rows.length}; run on the contract: ${ran.length}; passing on the contract: ${ran.filter((r) => r.pass).length}; identical transcripts: ${ran.filter((r) => r.diff.length === 0).length}; excluded until Phase 4: ${rows.filter((r) => 'excluded' in r).length}; errors: ${rows.filter((r) => 'error' in r).length}.`,
    '',
    '| Fixture | On the contract | Transactions | Gas | Differing lines |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      'excluded' in r
        ? `| \`${r.name}\` | excluded until Phase 4 | | | |`
        : 'error' in r
          ? `| \`${r.name}\` | error | | | |`
          : `| \`${r.name}\` | ${r.pass ? 'pass' : 'FAIL'}${r.label === 'todo' ? ' (todo)' : ''} | ${r.txs.length} | ${r.gas.toLocaleString('en-US')} | ${r.diff.length} |`,
    ),
    '',
  ];
  for (const r of rows) {
    out.push(`## \`${r.name}\``, '');
    if ('excluded' in r) out.push(`Excluded: ${r.excluded}`, '');
    else if ('error' in r) out.push(`Error: ${r.error}`, '');
    else {
      if (!r.pass) out.push(`Fails on the contract: ${r.reasons.join('; ')}`, '');
      if (r.txs.length) {
        out.push('| Transaction | Relayed via | Sent by (pays gas) | Gas |', '| --- | --- | --- | --- |');
        for (const t of r.txs) out.push(`| ${t.call} | ${t.via} | ${t.sentBy} | ${t.gasUsed.toLocaleString('en-US')} |`);
        out.push('');
      }
      out.push(...(r.diff.length ? ['```diff', ...r.diff, '```'] : ['Identical.']), '');
    }
  }
  return out.join('\n');
}

export async function main(argv: readonly string[], io: SnapIO): Promise<number> {
  let args: SnapArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.out(`snap: ${(e as Error).message}`);
    return 2;
  }
  if (args.migrateRecordings) {
    try {
      const moved = migrateRecordings(recordingsDir(io.root));
      for (const m of moved) io.out(`moved  ${relative(io.root, m.from)} -> ${relative(io.root, m.to)}`);
      io.out(`snap: migrated ${moved.length} recordings to <scenario>/<role>/<judgeId>.json`);
      return 0;
    } catch (e) {
      io.out(`snap: ${(e as Error).name}: ${(e as Error).message}`);
      return 1;
    }
  }

  const dir = scenarioDir(io.root);
  const all = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.scenario.yaml'))
        .map((f) => f.slice(0, -'.scenario.yaml'.length))
        .sort()
    : [];
  const names = args.names.length ? args.names : all;
  if (args.settlement === 'local') {
    if (args.update || args.record) {
      io.out('snap: --update and --record run on SimChain only; --settlement local compares with the SimChain run instead of writing snapshots');
      return 2;
    }
    return mainLocal(names, all, args.names.length === 0, io, args.judges);
  }
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
    io.out(`pass  ${name}${run.outcome.label === 'todo' ? ' (todo)' : ''}${note}`);
  }
  io.out(`snap: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}
