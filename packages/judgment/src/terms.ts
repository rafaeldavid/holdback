// Judgment inputs in the v0.5 shapes decided in D17 and D18. Core's types still describe v0.4
// (commitment.schema.json without hidden_characters_max, Rate thresholds and fractional weights),
// so judgment declares the shapes it codes against here. They must match spec/schemas v0.5 when
// PR 23 lands; then these become aliases of core's types (see the task's Handoff).
import type { ContentRef } from '@holdback/core';

/** Integer basis points, 0..10000. */
export type Bps = number;

/** An inclusive threshold compared by cross-multiplication: count x denominator >= numerator x total. */
export interface Fraction {
  numerator: number;
  denominator: number;
}

interface CheckBase {
  id: string;
  required: boolean;
}

/** Per-class maxima for hidden_characters_max (D17). Omitted classes are unlimited. */
export interface HiddenCharacterLimits {
  tag?: number;
  bidi?: number;
  variationSelector?: number;
  invisible?: number;
  total?: number;
}

export type JudgmentCheck =
  | (CheckBase & { type: 'csv_columns_exact'; columns: string[] })
  | (CheckBase & { type: 'row_count_range'; min: number; max: number })
  | (CheckBase & { type: 'unique_key'; columns: string[] })
  | (CheckBase & { type: 'null_rate_max'; column: string; maxBps: Bps })
  | (CheckBase & { type: 'regex_match_rate_min'; column: string; pattern: string; minBps: Bps })
  | (CheckBase & { type: 'iso8601_date_column'; column: string })
  | (CheckBase & { type: 'json_schema'; schema: Record<string, unknown> })
  | (CheckBase & { type: 'reference_row_match_min'; reference: ContentRef; keyColumn: string; minBps: Bps })
  | (CheckBase & { type: 'hidden_characters_max'; max: HiddenCharacterLimits });

export interface JudgmentCriterion {
  id: string;
  description: string;
  /** Integer 1..10000. */
  weight: number;
  anchors: { '0': string; '1'?: string; '2': string; '3'?: string; '4': string };
}

export interface JudgmentRubric {
  criteria: JudgmentCriterion[];
  /** Integer hundredths of a point, 0..400. */
  passThreshold: number;
}

export interface JudgmentAcceptance {
  deterministicChecks: JudgmentCheck[];
  rubric: JudgmentRubric;
}

/** The policy fields the pipeline uses (adjudicator.schema.json `policy`, v0.5). */
export interface JudgmentPolicy {
  minValid: number;
  minFamilies: number;
  rationaleMaxChars: number;
  acceptSupermajority: Fraction;
  rejectSupermajority: Fraction;
}

const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= lo && n <= hi;

/** A supermajority must be a strict majority, so accept and reject can never both hold. */
export function validateFraction(f: Fraction, name: string): string | undefined {
  if (!isInt(f.denominator, 1, 1_000_000) || !isInt(f.numerator, 1, f.denominator)) return `${name} must be integers with 0 < numerator <= denominator`;
  if (!(2 * f.numerator > f.denominator)) return `${name} ${f.numerator}/${f.denominator} is not a strict majority`;
  return undefined;
}

export function validatePolicy(p: JudgmentPolicy): string | undefined {
  return (
    validateFraction(p.acceptSupermajority, 'acceptSupermajority') ??
    validateFraction(p.rejectSupermajority, 'rejectSupermajority') ??
    (isInt(p.minValid, 0, 1000) && isInt(p.minFamilies, 1, 1000) && isInt(p.rationaleMaxChars, 0, 600) ? undefined : 'minValid, minFamilies or rationaleMaxChars out of range')
  );
}

export function validateRubric(r: JudgmentRubric): string | undefined {
  if (!isInt(r.passThreshold, 0, 400)) return 'passThreshold must be an integer 0..400 (hundredths)';
  for (const c of r.criteria) if (!isInt(c.weight, 1, 10_000)) return `criterion ${c.id} weight must be an integer 1..10000`;
  if (new Set(r.criteria.map((c) => c.id)).size !== r.criteria.length) return 'duplicate criterion id';
  return undefined;
}
