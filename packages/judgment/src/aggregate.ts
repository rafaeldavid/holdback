// Stage 5, aggregation: the rule in docs/judgment-and-defenses.md, with D17 and D18 applied.
//
//   if any required deterministic check failed            -> REJECT  (no panel)
//   if a check ran out of its work budget                 -> ESCALATE (no panel)
//   if all checks passed and rubric is empty              -> ACCEPT  (no panel; a screen flag adds a reason, D17)
//   verdicts = run panel
//   flagged = screen.flagged or any verdict.injectionSuspected
//   if appeal after escalation and (flagged or a filter abstention or a sampled read)
//                                                         -> ACCEPT only if every seat returned a valid pass on
//                                                            the whole file, passes span appealFamilies, no
//                                                            injectionSuspected, score met; else REJECT (D27a/b)
//   if flagged                                            -> ESCALATE (primary, fallback, party appeal: D27c)
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

// agg-3: the flagged-appeal rule (L3-1, D27a). The policy hash binds this string; aggregate.test.ts pins a
// digest of the decision table to it, so a change of semantics without a new version fails the tests.
export const AGGREGATION_VERSION = 'agg-3';
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
  /**
   * Which appeal this panel sits for (ADR-0021 amendment; D27). Never set for the primary or the fallback.
   * - `escalated`: the appeal after an escalation (no first decision). There is no instance after it, and an
   *   escalation means no decision and the default outcome, so any seller-controllable condition (screen flag,
   *   injection suspicion, filter abstention, sampled data) accepts only on a whole, unanimous panel from
   *   `appealFamilies` families with no injection suspected, and otherwise rejects (D27a, D27b).
   * - `party`: a party's appeal against a first decision. Those conditions escalate as at first instance, so
   *   one judge's noise cannot overturn the first decision; signedOutcome keeps it (D27c).
   */
  appeal?: 'escalated' | 'party';
  /** Families the passes of a flagged appeal must span (the appeal panel's family minimum; at least 2). */
  appealFamilies?: number;
  /** Judges whose output a filter rejected (also listed in `escalate`); at the appeal they flag the case. */
  filterAbstentions?: number;
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

/**
 * What a role may sign for the panel's decision (the adjudicator service and the snap runner both call this).
 * The primary and fallback sign what aggregation decided, escalation included. At the appeal there is no
 * instance after it: an appeal panel that cannot decide leaves a party appeal's first decision standing
 * (`firstOutcome`), and signs nothing after an escalation (null: the default outcome applies). A flag alone
 * no longer makes the appeal panel escalate (L3-1); `aggregate` with `appeal: true` decides it.
 */
export function signedOutcome(
  decision: Aggregate['decision'],
  role: { appeal: boolean; firstOutcome?: 'accept' | 'reject' },
): Aggregate['decision'] | null {
  if (role.appeal && decision === 'escalate') return role.firstOutcome ?? null;
  return decision;
}

export type PreDecision ='reject' | 'escalate' | 'accept' | 'panel';
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

  const injection = parsed.some((v) => v.verdict.injectionSuspected);
  const filtered = input.filterAbstentions ?? 0;
  const scoreOk = rubric.criteria.length === 0 || sumWS * 100 >= rubric.passThreshold * totalWeight * n;

  // Escalation reasons other than filter abstentions: the judges saw an even-stride sample (seller-forceable).
  const sampled = (input.escalate?.length ?? 0) > filtered;

  // D27a/b: the appeal after an escalation with a seller-controllable condition. It never escalates: accept only
  // on a whole, unanimous, cross-family, full-file panel with no injection suspected and the score met;
  // otherwise reject (refund; the key is not released). A party appeal (D27c) falls through to the
  // first-instance handling below.
  if (input.appeal === 'escalated' && (input.screenFlagged || injection || filtered > 0 || sampled)) {
    const flags = [
      ...(input.screenFlagged ? [SCREEN_FLAGGED_REASON] : []),
      ...(injection ? ['a judge suspected injection'] : []),
      ...(filtered > 0 ? [`${filtered} judge output${filtered === 1 ? '' : 's'} rejected by a filter`] : []),
      ...(sampled ? ['the judges saw a sample of the deliverable, not all of it'] : []),
    ];
    const seats = input.verdicts.length;
    const needFamilies = Math.max(MIN_PASS_FAMILIES, input.appealFamilies ?? MIN_PASS_FAMILIES);
    const missing = [
      ...(seats === 0 ? ['no seat returned a verdict'] : []),
      ...(n < seats ? [`${seats - n} of ${seats} seats returned no valid verdict`] : []),
      ...(fail.length > 0 ? [`${fail.length} failed`] : []),
      ...(passFamilies.length < needFamilies ? [`passes span ${passFamilies.length} of the ${needFamilies} families required`] : []),
      ...(injection ? ['a judge suspected injection'] : []),
      ...(!scoreOk ? ['score below the pass threshold'] : []),
      ...(sampled ? ['the judges saw a sample, not all of the delivery'] : []),
    ];
    if (missing.length === 0) {
      return { decision: 'accept', ...stats, reasons: [cap(`flagged appeal: ${pass.length} of ${seats} seats pass, from ${passFamilies.length} families, no injection suspected`), ...flags] };
    }
    return { decision: 'reject', ...stats, reasons: [cap(`flagged appeal: rejected, a flagged case is accepted only unanimously (${missing.join('; ')})`), ...flags] };
  }

  if (input.screenFlagged) return { decision: 'escalate', ...stats, reasons: ['the screen flagged the delivery'] };
  if (injection) return { decision: 'escalate', ...stats, reasons: ['a judge suspected injection'] };
  if (input.escalate?.length) return { decision: 'escalate', ...stats, reasons: input.escalate.slice(0, 5).map(cap) };
  if (n < thresholds.minValid || n === 0) {
    return { decision: 'escalate', ...stats, reasons: [`${n} valid verdicts; the policy needs ${Math.max(1, thresholds.minValid)}`] };
  }

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
