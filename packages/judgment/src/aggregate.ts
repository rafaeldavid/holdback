// Stage 5, aggregation: the rule in docs/judgment-and-defenses.md, line for line.
//
//   if any required deterministic check failed            -> REJECT  (no panel)
//   if all checks passed and rubric is empty              -> ACCEPT  (no panel)
//   verdicts = run panel
//   if screen.flagged or any verdict.injectionSuspected   -> ESCALATE
//   valid = verdicts where overall != "abstain"
//   if len(valid) < policy.minValid                       -> ESCALATE
//   score = weighted mean of criterion scores across valid verdicts (0–4)
//   passFamilies = distinct families among valid verdicts with overall == "pass"
//   if share(pass) >= acceptSupermajority and len(passFamilies) >= 2 and score >= rubric.passThreshold -> ACCEPT
//   if share(fail) >= rejectSupermajority                 -> REJECT
//   otherwise                                             -> ESCALATE
//
// Interpretations (see the task's Decisions): a schema-invalid output is a null verdict and counts
// as an abstention; an empty valid set escalates even when minValid is 0; with an empty rubric the
// score condition holds vacuously; shares are compared to the policy Rate literally, with a 1e-9
// tolerance for float rounding only. Sealed checks are not scored here (no sealed-check evaluator yet).
import type { AcceptanceSpec, Judgment, JudgeVerdict } from '@holdback/core';
import type { CheckOutcome } from './checks/index.js';

export const AGGREGATION_VERSION = 'agg-1';
const EPS = 1e-9;
/** Cross-family agreement required for accept (threat T8). Fixed by the rule, not by policy. */
export const MIN_PASS_FAMILIES = 2;

export interface PanelVerdict {
  family: string;
  /** null when the judge produced no schema-valid verdict (invalid output, timeout, error). */
  verdict: JudgeVerdict | null;
}

export interface Thresholds {
  minValid: number;
  acceptSupermajority: number;
  rejectSupermajority: number;
}

export interface AggregateInput {
  checks: readonly CheckOutcome[];
  rubric: AcceptanceSpec['rubric'];
  screenFlagged: boolean;
  verdicts: readonly PanelVerdict[];
  thresholds: Thresholds;
}

export type Aggregate = Judgment['aggregate'];

const cap = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…` : s);

/** The short circuits: whether the panel runs at all. */
export function preDecision(checks: readonly CheckOutcome[], rubric: AcceptanceSpec['rubric']): 'reject' | 'accept' | 'panel' {
  if (checks.some((c) => c.required && !c.passed)) return 'reject';
  if (checks.every((c) => c.passed) && rubric.criteria.length === 0) return 'accept';
  return 'panel';
}

/** Weighted mean over the rubric's criteria, weights normalized to sum to 1. */
function verdictScore(v: JudgeVerdict, rubric: AcceptanceSpec['rubric']): number {
  const total = rubric.criteria.reduce((s, c) => s + c.weight, 0);
  const sum = rubric.criteria.reduce((s, c) => s + c.weight * (v.criteria.find((k) => k.id === c.id)?.score ?? 0), 0);
  return total > 0 ? sum / total : 0;
}

export function aggregate(input: AggregateInput): Aggregate {
  const { checks, rubric, thresholds } = input;
  const pre = preDecision(checks, rubric);
  if (pre === 'reject') {
    const failed = checks.filter((c) => c.required && !c.passed).map((c) => c.checkId);
    return { decision: 'reject', weightedScore: null, reasons: [cap(`required deterministic check failed: ${failed.join(', ')}`)] };
  }
  if (pre === 'accept') {
    return { decision: 'accept', weightedScore: null, reasons: ['all deterministic checks passed and the rubric is empty'] };
  }

  const parsed = input.verdicts.filter((v): v is { family: string; verdict: JudgeVerdict } => v.verdict !== null);
  const valid = parsed.filter((v) => v.verdict.overall !== 'abstain');
  const pass = valid.filter((v) => v.verdict.overall === 'pass');
  const fail = valid.filter((v) => v.verdict.overall === 'fail');
  const passFamilies = [...new Set(pass.map((v) => v.family))].sort();
  const score = valid.length ? valid.reduce((s, v) => s + verdictScore(v.verdict, rubric), 0) / valid.length : null;
  const stats = {
    weightedScore: rubric.criteria.length ? score : null,
    ...(valid.length ? { passShare: pass.length / valid.length, failShare: fail.length / valid.length } : {}),
    passFamilies,
  };

  if (input.screenFlagged) return { decision: 'escalate', ...stats, reasons: ['the screen flagged the delivery'] };
  if (parsed.some((v) => v.verdict.injectionSuspected)) return { decision: 'escalate', ...stats, reasons: ['a judge suspected injection'] };
  if (valid.length < thresholds.minValid || valid.length === 0) {
    return { decision: 'escalate', ...stats, reasons: [`${valid.length} valid verdicts; the policy needs ${thresholds.minValid}`] };
  }

  const scoreOk = rubric.criteria.length === 0 || (score !== null && score + EPS >= rubric.passThreshold);
  const acceptShare = pass.length + EPS >= thresholds.acceptSupermajority * valid.length;
  if (acceptShare && passFamilies.length >= MIN_PASS_FAMILIES && scoreOk) {
    return { decision: 'accept', ...stats, reasons: [cap(`${pass.length} of ${valid.length} valid verdicts pass, from ${passFamilies.length} families, score at or above ${rubric.passThreshold}`)] };
  }
  if (fail.length + EPS >= thresholds.rejectSupermajority * valid.length) {
    return { decision: 'reject', ...stats, reasons: [cap(`${fail.length} of ${valid.length} valid verdicts fail`)] };
  }
  const why = !acceptShare ? 'no supermajority' : passFamilies.length < MIN_PASS_FAMILIES ? `pass verdicts from ${passFamilies.length} family` : 'score below the pass threshold';
  return { decision: 'escalate', ...stats, reasons: [cap(`${pass.length} pass, ${fail.length} fail of ${valid.length} valid: ${why}`)] };
}
