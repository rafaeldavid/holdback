// Judgment inputs in the schema v0.5 shapes (D17, D18; ADR-0021, ADR-0022), as aliases of core's
// types. Judgment needs only these parts of the commitment and the adjudicator policy.
import type { AcceptanceSpec, AdjudicatorPolicy, Bps, Criterion, DeterministicCheck, Fraction, HiddenCharacterMax } from '@holdback/core';

export type { Bps, Fraction };
export type HiddenCharacterLimits = HiddenCharacterMax;
export type JudgmentCheck = DeterministicCheck;
export type JudgmentCriterion = Criterion;
/** passThreshold in hundredths (0..400); criterion weights are integers 1..10000. */
export type JudgmentRubric = AcceptanceSpec['rubric'];
export type JudgmentAcceptance = Pick<AcceptanceSpec, 'deterministicChecks' | 'rubric'>;
/** The policy fields the pipeline uses. */
export type JudgmentPolicy = Pick<AdjudicatorPolicy, 'minValid' | 'minFamilies' | 'rationaleMaxChars' | 'acceptSupermajority' | 'rejectSupermajority'>;

const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= lo && n <= hi;

/** A supermajority must be a strict majority, so accept and reject can never both hold. */
export function validateFraction(f: Fraction, name: string): string | undefined {
  if (!isInt(f.denominator, 1, 100) || !isInt(f.numerator, 1, f.denominator)) return `${name} must be integers with 0 < numerator <= denominator <= 100`;
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
