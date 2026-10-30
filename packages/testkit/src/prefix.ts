// Filename prefixes (docs/testing.md): what each kind of fixture must show beyond its snapshot.
import type { DecisionOutcome, EscrowStateKind, ProblemType } from '@holdback/core';

export type Prefix = 'normal' | 'error' | 'attack' | 'neutrality' | 'todo';

export const TERMINAL_STATES: readonly EscrowStateKind[] = ['Released', 'Refunded', 'Expired'];

export interface StepProblem {
  /** 1-based index of the fixture step. */
  step: number;
  call: string;
  /** The actor whose call was refused. */
  actor: string;
  type: ProblemType;
}

/** An actor failing to act: offline, an operator refusing to relay, or a timeout fired in its place. */
export interface Outage {
  step: number;
  actor: string;
  kind: 'offline' | 'operator_refused' | 'timeout';
}

/** Escrow states that show an attack was escalated or rejected rather than paid out. */
export const NOT_PAID_OUT: readonly EscrowStateKind[] = ['Escalated', 'FallbackJudging', 'Refunded'];

export interface RunSummary {
  /** The last escrow state reached, or null when no commitment was created. */
  finalState: EscrowStateKind | null;
  problems: StepProblem[];
  outages: Outage[];
  /** Aggregate decisions of every judgment that ran, in order. */
  judgments: DecisionOutcome[];
  invariants: Array<{ name: string; ok: boolean }>;
  /** True when a first-instance judgment released the funds without escalation or a buyer's early accept. */
  autoAccepted: boolean;
  balances: Record<string, bigint>;
  /** The scenario could not run to the end (a fixture or recording error). */
  runError?: string;
}

export interface ScenarioExpect {
  terminal?: EscrowStateKind;
  balances?: Record<string, string>;
  problem?: { step?: number; type: ProblemType };
}

export interface Outcome {
  pass: boolean;
  /** 'pass', 'fail' or 'todo'. */
  label: 'pass' | 'fail' | 'todo';
  reasons: string[];
}

export function prefixOf(name: string): Prefix {
  for (const p of ['error', 'attack', 'neutrality', 'todo'] as const) if (name.startsWith(`${p}.`)) return p;
  return 'normal';
}

export function evaluate(prefix: Prefix, run: RunSummary, expect: ScenarioExpect, fails?: string): Outcome {
  // todo: the snapshot records today's behavior, whatever it is.
  if (prefix === 'todo') return { pass: true, label: 'todo', reasons: [] };

  const reasons: string[] = [];
  if (run.runError !== undefined) reasons.push(run.runError);
  for (const inv of run.invariants) if (!inv.ok) reasons.push(`invariant violated: ${inv.name}`);
  const terminal = run.finalState !== null && TERMINAL_STATES.includes(run.finalState);
  const first = run.problems[0];
  const hasExpect = expect.terminal !== undefined || expect.balances !== undefined || expect.problem !== undefined;

  switch (prefix) {
    case 'normal':
      if (!terminal) reasons.push(`expected a terminal state, ended in ${run.finalState ?? 'no commitment'}`);
      if (first) reasons.push(`step ${first.step} (${first.call}) was refused with ${first.type}; use the error. prefix for expected refusals`);
      if (run.outages.length) reasons.push(`${run.outages[0]!.actor} failed at step ${run.outages[0]!.step}; use the neutrality. prefix for actor failures`);
      break;
    case 'error':
      if (!expect.problem || expect.problem.step === undefined) reasons.push('error. fixtures must set expect.problem with both type and step');
      if (!first) reasons.push('expected the system to refuse a step, but every step succeeded');
      break;
    case 'attack': {
      if (run.autoAccepted) reasons.push('an attack fixture must not auto-accept, but a first-instance judgment released the funds');
      const stopped = (run.finalState !== null && NOT_PAID_OUT.includes(run.finalState)) || run.judgments.some((d) => d === 'escalate' || d === 'reject');
      if (!stopped && !hasExpect) {
        reasons.push(`an attack fixture must end escalated or rejected (Escalated, FallbackJudging, Refunded, or an escalate/reject judgment), or state an expect block the run meets; ended in ${run.finalState ?? 'no commitment'}`);
      }
      break;
    }
    case 'neutrality':
      if (fails === undefined) reasons.push('neutrality. fixtures must name the failing actor with fails:');
      else if (!run.outages.some((o) => o.actor === fails) && !run.problems.some((p) => p.actor === fails)) {
        reasons.push(`the fixture names ${fails} as the failing actor, but no step shows ${fails} offline, refusing, refused or timed out`);
      }
      if (!terminal) reasons.push(`expected a terms-compliant terminal state despite the failure, ended in ${run.finalState ?? 'no commitment'}`);
      break;
  }

  if (expect.problem) {
    if (!first) reasons.push(`expected ${expect.problem.type}, but no step was refused`);
    else {
      if (first.type !== expect.problem.type) reasons.push(`expected the first refusal to be ${expect.problem.type}, got ${first.type} at step ${first.step}`);
      if (expect.problem.step !== undefined && first.step !== expect.problem.step) reasons.push(`expected the refusal at step ${expect.problem.step}, got step ${first.step}`);
    }
  }
  if (expect.terminal !== undefined && run.finalState !== expect.terminal) reasons.push(`expected terminal ${expect.terminal}, ended in ${run.finalState ?? 'no commitment'}`);
  for (const [who, amount] of Object.entries(expect.balances ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const actual = run.balances[who];
    if (actual === undefined) reasons.push(`expected a balance for ${who}, who has no account`);
    else if (actual !== BigInt(amount)) reasons.push(`expected ${who} to hold ${amount}, holds ${actual}`);
  }
  return reasons.length ? { pass: false, label: 'fail', reasons } : { pass: true, label: 'pass', reasons };
}
