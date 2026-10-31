// Stage 5, aggregation: the rule in docs/judgment-and-defenses.md, with D17 and D18 applied.
//
//   if any required deterministic check failed            -> REJECT  (no panel)
//   if a check ran out of its work budget                 -> ESCALATE (no panel)
//   if all checks passed and rubric is empty              -> ACCEPT  (no panel; a screen flag adds a reason, D17)
//   verdicts = run panel
//   if screen.flagged or any verdict.injectionSuspected   -> ESCALATE
//   if a judge's output was rejected by a filter, or the judges saw a sample  -> ESCALATE
//   valid = verdicts where overall != "abstain"
//   if len(valid) < policy.minValid or len(valid) == 0    -> ESCALATE
//   accept if pass x den >= num x valid and pass > fail and >= 2 pass families
//             and sum(w*s) x 100 >= passThreshold x sum(w) x valid
//   reject if fail x den >= num x valid and fail > pass
//   otherwise                                             -> ESCALATE
//
// All arithmetic is on integers (D18): thresholds are fractions compared by cross-multiplication,
// weights are integers 1..10000, scores and passThreshold are hundredths of a point (0..400).
import type { JudgeVerdict } from '@holdback/core';
import type { CheckOutcome } from './checks/index.js';
import type { Fraction, JudgmentRubric } from './terms.js';

export const AGGREGATION_VERSION = 'agg-2';
/** Cross-family agreement required for accept (threat T8). Fixed by the rule, not by policy. */
export const MIN_PASS_FAMILIES = 2;
export const SCREEN_FLAGGED_REASON = 'screen flagged; see screen.signals';

export interface PanelVerdict {
  family: string;
  /** null when the judge produced no schema-valid verdict (invalid output, timeout, error). */
  verdict: JudgeVerdict | null;
}

export interface Thresholds {
  minValid: number;
  acceptSupermajority: Fraction;
  rejectSupermajority: Fraction;
}

export interface AggregateInput {
  checks: readonly CheckOutcome[];
  /** Ids of checks that ran out of budget: neither passed nor failed. */
  inconclusive?: readonly string[];
  rubric: JudgmentRubric;
  screenFlagged: boolean;
  verdicts: readonly PanelVerdict[];
  thresholds: Thresholds;
  /** Reasons that force escalation once the panel ran: filter abstentions, sampled data. */
  escalate?: readonly string[];
}

/** judgment.schema.json `aggregate`, v0.5 shape (D18): counts instead of shares, integer score. */
export interface Aggregate {
  decision: 'accept' | 'reject' | 'escalate';
  /** Integer hundredths of a point, 0..400; null when no panel score applies. */
  weightedScore: number | null;
  passCount?: number;
  failCount?: number;
  validCount?: number;
  passFamilies?: string[];
  reasons: string[];
}

export type PreDecision = 'reject' | 'escalate' | 'accept' | 'panel';
const cap = (s: string) => (s.length > 200 ? `${s.slice(0, 197)}...` : s);

/** The short circuits: whether the panel runs at all. */
export function preDecision(checks: readonly CheckOutcome[], rubric: JudgmentRubric, inconclusive: readonly string[] = []): PreDecision {
  const open = new Set(inconclusive);
  if (checks.some((c) => c.required && !c.passed && !open.has(c.checkId))) return 'reject';
  if (open.size > 0) return 'escalate';
  if (checks.every((c) => c.passed) && rubric.criteria.length === 0) return 'accept';
  return 'panel';
}

/** sum over the rubric of weight x score for one verdict (missing criteria score 0). */
function weightedSum(v: JudgeVerdict, rubric: JudgmentRubric): number {
  return rubric.criteria.reduce((s, c) => s + c.weight * (v.criteria.find((k) => k.id === c.id)?.score ?? 0), 0);
}

const meets = (count: number, f: Fraction, total: number) => count * f.denominator >= f.numerator * total;

export function aggregate(input: AggregateInput): Aggregate {
  const { checks, rubric, thresholds } = input;
  const inconclusive = input.inconclusive ?? [];
  const pre = preDecision(checks, rubric, inconclusive);
  if (pre === 'reject') {
    const failed = checks.filter((c) => c.required && !c.passed && !inconclusive.includes(c.checkId)).map((c) => c.checkId);
    return { decision: 'reject', weightedScore: null, reasons: [cap(`required deterministic check failed: ${failed.join(', ')}`)] };
  }
  if (pre === 'escalate') {
    return { decision: 'escalate', weightedScore: null, reasons: [cap(`check work budget ran out: ${inconclusive.join(', ')}`)] };
  }
  if (pre === 'accept') {
    const reasons = ['all deterministic checks passed and the rubric is empty'];
    if (input.screenFlagged) reasons.push(SCREEN_FLAGGED_REASON);
    return { decision: 'accept', weightedScore: null, reasons };
  }

  const parsed = input.verdicts.filter((v): v is { family: string; verdict: JudgeVerdict } => v.verdict !== null);
  const valid = parsed.filter((v) => v.verdict.overall !== 'abstain');
  const pass = valid.filter((v) => v.verdict.overall === 'pass');
  const fail = valid.filter((v) => v.verdict.overall === 'fail');
  const passFamilies = [...new Set(pass.map((v) => v.family))].sort();
  const totalWeight = rubric.criteria.reduce((s, c) => s + c.weight, 0);
  const sumWS = valid.reduce((s, v) => s + weightedSum(v.verdict, rubric), 0);
  const n = valid.length;
  const stats = {
    weightedScore: rubric.criteria.length && n ? Math.floor((sumWS * 100) / (totalWeight * n)) : null,
    passCount: pass.length,
    failCount: fail.length,
    validCount: n,
    passFamilies,
  };

  if (input.screenFlagged) return { decision: 'escalate', ...stats, reasons: ['the screen flagged the delivery'] };
  if (parsed.some((v) => v.verdict.injectionSuspected)) return { decision: 'escalate', ...stats, reasons: ['a judge suspected injection'] };
  if (input.escalate?.length) return { decision: 'escalate', ...stats, reasons: input.escalate.slice(0, 5).map(cap) };
  if (n < thresholds.minValid || n === 0) {
    return { decision: 'escalate', ...stats, reasons: [`${n} valid verdicts; the policy needs ${Math.max(1, thresholds.minValid)}`] };
  }

  const scoreOk = rubric.criteria.length === 0 || sumWS * 100 >= rubric.passThreshold * totalWeight * n;
  const acceptShare = meets(pass.length, thresholds.acceptSupermajority, n) && pass.length > fail.length;
  if (acceptShare && passFamilies.length >= MIN_PASS_FAMILIES && scoreOk) {
    return { decision: 'accept', ...stats, reasons: [cap(`${pass.length} of ${n} valid verdicts pass, from ${passFamilies.length} families, score at or above ${rubric.passThreshold / 100}`)] };
  }
  if (meets(fail.length, thresholds.rejectSupermajority, n) && fail.length > pass.length) {
    return { decision: 'reject', ...stats, reasons: [cap(`${fail.length} of ${n} valid verdicts fail`)] };
  }
  const why = !acceptShare ? 'no supermajority' : passFamilies.length < MIN_PASS_FAMILIES ? `pass verdicts from ${passFamilies.length} family` : 'score below the pass threshold';
  return { decision: 'escalate', ...stats, reasons: [cap(`${pass.length} pass, ${fail.length} fail of ${n} valid: ${why}`)] };
}
