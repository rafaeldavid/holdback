import type { JudgeVerdict } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { criterion, RUBRIC } from './_helpers.js';
import { aggregate, preDecision, SCREEN_FLAGGED_REASON, type AggregateInput, type PanelVerdict } from './aggregate.js';
import type { CheckOutcome } from './checks/index.js';
import type { Fraction, JudgmentRubric } from './terms.js';

const IDS = RUBRIC.criteria.map((c) => c.id);
const v = (family: string, overall: JudgeVerdict['overall'], scores: number[] = [4, 4, 4], injectionSuspected = false): PanelVerdict => ({
  family,
  verdict: {
    criteria: IDS.map((id, i) => ({ id, score: scores[i] as 0 | 1 | 2 | 3 | 4, evidence: '' })),
    overall,
    injectionSuspected,
    rationale: '',
  },
});
const invalid = (family: string): PanelVerdict => ({ family, verdict: null });
const ok = (id: string, required = true): CheckOutcome => ({ checkId: id, required, passed: true });
const bad = (id: string, required = true): CheckOutcome => ({ checkId: id, required, passed: false, detail: 'failed' });
const frac = (numerator: number, denominator: number): Fraction => ({ numerator, denominator });
const T = { minValid: 2, acceptSupermajority: frac(2, 3), rejectSupermajority: frac(2, 3) };
const APPEAL = { minValid: 4, acceptSupermajority: frac(4, 5), rejectSupermajority: frac(4, 5) };
const EMPTY: JudgmentRubric = { criteria: [], passThreshold: 0 };
const input = (over: Partial<AggregateInput>): AggregateInput => ({
  checks: [ok('cols')],
  rubric: RUBRIC,
  screenFlagged: false,
  verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'pass')],
  thresholds: T,
  ...over,
});
const decide = (over: Partial<AggregateInput>) => aggregate(input(over)).decision;
const five = (passes: number) => ['a', 'b', 'c', 'd', 'e'].map((f, i) => (i < passes ? v(f, 'pass') : v(f, 'fail')));

describe('preDecision (the short circuits)', () => {
  it.each([
    ['required check failed', [bad('a')], RUBRIC, [], 'reject'],
    ['required failed, rubric empty', [bad('a')], EMPTY, [], 'reject'],
    ['all passed, rubric empty', [ok('a')], EMPTY, [], 'accept'],
    ['no checks, rubric empty', [], EMPTY, [], 'accept'],
    ['optional failed, rubric empty', [bad('a', false)], EMPTY, [], 'panel'],
    ['all passed, rubric present', [ok('a')], RUBRIC, [], 'panel'],
    ['optional failed, rubric present', [ok('a'), bad('b', false)], RUBRIC, [], 'panel'],
    ['required check inconclusive', [bad('a')], RUBRIC, ['a'], 'escalate'],
    ['inconclusive with an empty rubric', [bad('a', false)], EMPTY, ['a'], 'escalate'],
    ['a definite required failure beats an inconclusive check', [bad('a'), bad('b')], RUBRIC, ['b'], 'reject'],
  ] as const)('%s -> %s', (_n, checks, rubric, inconclusive, expected) => {
    expect(preDecision([...checks], { criteria: [...rubric.criteria], passThreshold: rubric.passThreshold }, [...inconclusive])).toBe(expected);
  });
});

describe('aggregate: table', () => {
  const cases: Array<[string, Partial<AggregateInput>, 'accept' | 'reject' | 'escalate']> = [
    // Line 1: required deterministic failure rejects before anything else.
    ['required check failed beats unanimous pass', { checks: [bad('cols')] }, 'reject'],
    ['required check failed beats screen flag', { checks: [bad('cols')], screenFlagged: true }, 'reject'],
    ['optional check failed does not reject', { checks: [bad('cols', false)] }, 'accept'],
    // Line 2: a check out of budget escalates without the panel.
    ['inconclusive check escalates', { checks: [bad('cols')], inconclusive: ['cols'] }, 'escalate'],
    // Line 3: all checks passed and rubric empty accepts without the panel (D17 keeps it with a flag).
    ['rubric empty, checks pass, no verdicts', { rubric: EMPTY, verdicts: [] }, 'accept'],
    ['rubric empty, screen flagged, still accepts', { rubric: EMPTY, screenFlagged: true, verdicts: [] }, 'accept'],
    // Line 5: screen flag or any injectionSuspected escalates.
    ['screen flagged, unanimous pass', { screenFlagged: true }, 'escalate'],
    ['one judge suspects injection', { verdicts: [v('claude', 'pass'), v('gpt', 'pass', [4, 4, 4], true), v('gemini', 'pass')] }, 'escalate'],
    ['an abstaining judge suspects injection', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'abstain', [0, 0, 0], true)] }, 'escalate'],
    ['injection beats unanimous fail', { verdicts: [v('claude', 'fail', [0, 0, 0], true), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'fail', [0, 0, 0])] }, 'escalate'],
    // Line 6: filter abstentions and sampled data escalate.
    ['a filter abstention escalates a unanimous pass', { escalate: ['judge x output rejected by a filter (url)'] }, 'escalate'],
    ['a filter abstention escalates a unanimous fail', { escalate: ['judge x output rejected by a filter (schema)'], verdicts: [v('a', 'fail'), v('b', 'fail'), v('c', 'fail')] }, 'escalate'],
    // Line 8: too few valid verdicts escalates.
    ['one valid of three', { verdicts: [v('claude', 'pass'), invalid('gpt'), v('gemini', 'abstain')] }, 'escalate'],
    ['no verdicts at all', { verdicts: [] }, 'escalate'],
    ['two valid is enough', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), invalid('gemini')] }, 'accept'],
    ['minValid 0 with no verdicts escalates', { thresholds: { ...T, minValid: 0 }, verdicts: [] }, 'escalate'],
    // Line 9: accept.
    ['unanimous pass, three families', {}, 'accept'],
    ['2 of 3 pass at 2/3 from two families accepts', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'fail', [1, 1, 1])] }, 'accept'],
    ['unanimous pass, one family', { verdicts: [v('claude', 'pass'), v('claude', 'pass'), v('claude', 'pass')] }, 'escalate'],
    ['3 pass but only one pass family', { verdicts: [v('claude', 'pass'), v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0])] }, 'escalate'],
    ['unanimous pass, score below threshold', { verdicts: [v('claude', 'pass', [3, 3, 2]), v('gpt', 'pass', [3, 3, 2]), v('gemini', 'pass', [3, 3, 2])] }, 'escalate'],
    ['score exactly at threshold', { verdicts: [v('claude', 'pass', [3, 3, 3]), v('gpt', 'pass', [3, 3, 3])] }, 'accept'],
    // Line 10: reject.
    ['unanimous fail', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'fail', [0, 0, 0])] }, 'reject'],
    ['2 of 3 fail', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'pass')] }, 'reject'],
    ['2 of 3 fail from one family still rejects', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'pass')] }, 'reject'],
    ['fail with high scores still rejects', { verdicts: [v('claude', 'fail'), v('gpt', 'fail'), v('gemini', 'fail')] }, 'reject'],
    // Line 11: otherwise escalate; ties never decide.
    ['1 pass, 1 fail, 1 abstain', { verdicts: [v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'abstain')] }, 'escalate'],
    ['2-2 tie escalates', { verdicts: [v('a', 'pass'), v('b', 'pass'), v('c', 'fail'), v('d', 'fail')] }, 'escalate'],
    // Appeal policy 4/5.
    ['appeal 4/5: 3 of 5 pass escalates', { thresholds: APPEAL, verdicts: five(3) }, 'escalate'],
    ['appeal 4/5: 4 of 5 pass accepts', { thresholds: APPEAL, verdicts: five(4) }, 'accept'],
    ['appeal 4/5: 4 of 5 fail rejects', { thresholds: APPEAL, verdicts: five(1) }, 'reject'],
  ];
  it.each(cases)('%s', (_name, over, expected) => expect(decide(over)).toBe(expected));
});

describe('aggregate: reported fields', () => {
  it('weighted score is integer hundredths of the mean over valid verdicts', () => {
    const r = aggregate(input({ verdicts: [v('claude', 'pass', [4, 4, 3]), v('gpt', 'pass', [2, 2, 2]), v('gemini', 'abstain', [0, 0, 0]), invalid('x')] }));
    // (4*4000+4*4000+3*2000)/10000 = 3.8 ; 2 ; mean 2.9 -> 290
    expect(r.weightedScore).toBe(290);
    expect(r.decision).toBe('escalate');
  });

  it('floors the score and compares it exactly by cross-multiplication', () => {
    const rubric: JudgmentRubric = { criteria: [criterion('a', 1), criterion('b', 2)], passThreshold: 334 };
    const mk = (f: string, a: number, b: number): PanelVerdict => ({ family: f, verdict: { criteria: [{ id: 'a', score: a as 4, evidence: '' }, { id: 'b', score: b as 4, evidence: '' }], overall: 'pass', injectionSuspected: false, rationale: '' } });
    // (1*4 + 2*3) / 3 = 3.333... -> 333, below 334 -> no accept.
    const r = aggregate(input({ rubric, verdicts: [mk('f', 4, 3), mk('g', 4, 3)] }));
    expect(r.weightedScore).toBe(333);
    expect(r.decision).toBe('escalate');
    expect(aggregate(input({ rubric: { ...rubric, passThreshold: 333 }, verdicts: [mk('f', 4, 3), mk('g', 4, 3)] })).decision).toBe('accept');
  });

  it('reports counts among valid verdicts and sorted distinct pass families', () => {
    const r = aggregate(input({ verdicts: [v('gpt', 'pass'), v('claude', 'pass'), v('claude', 'pass'), v('gemini', 'fail', [0, 0, 0]), invalid('z')] }));
    expect([r.passCount, r.failCount, r.validCount]).toEqual([3, 1, 4]);
    expect(r.passFamilies).toEqual(['claude', 'gpt']);
  });

  it('has a null score and no counts when the panel did not run', () => {
    const r = aggregate(input({ checks: [bad('cols')] }));
    expect(r).toEqual({ decision: 'reject', weightedScore: null, reasons: ['required deterministic check failed: cols'] });
  });

  it('an empty-rubric accept with a flagged screen says so (D17)', () => {
    const r = aggregate(input({ rubric: EMPTY, screenFlagged: true, verdicts: [] }));
    expect(r.decision).toBe('accept');
    expect(r.reasons).toEqual(['all deterministic checks passed and the rubric is empty', SCREEN_FLAGGED_REASON]);
    expect(SCREEN_FLAGGED_REASON).toBe('screen flagged; see screen.signals');
  });

  it('always gives at least one reason, each at most 200 characters', () => {
    const long = 'x'.repeat(40);
    const all: Array<Partial<AggregateInput>> = [{}, { screenFlagged: true }, { verdicts: [] }, { escalate: ['y'.repeat(300)] }, { checks: [bad(long), bad(`${long}2`), bad(`${long}3`), bad(`${long}4`), bad(`${long}5`)] }];
    for (const over of all) {
      const r = aggregate(input(over));
      expect(r.reasons.length).toBeGreaterThan(0);
      for (const reason of r.reasons) expect(reason.length).toBeLessThanOrEqual(200);
    }
  });
});

// An independent, literal transcription of the rule (docs pseudo-code plus D17 and D18), as an oracle.
function oracle(i: AggregateInput): 'accept' | 'reject' | 'escalate' {
  const inc = new Set(i.inconclusive ?? []);
  if (i.checks.some((c) => c.required && !c.passed && !inc.has(c.checkId))) return 'reject';
  if (inc.size) return 'escalate';
  if (i.checks.every((c) => c.passed) && i.rubric.criteria.length === 0) return 'accept';
  if (i.screenFlagged || i.verdicts.some((x) => x.verdict?.injectionSuspected)) return 'escalate';
  if (i.escalate?.length) return 'escalate';
  const valid = i.verdicts.filter((x) => x.verdict && x.verdict.overall !== 'abstain');
  if (valid.length < i.thresholds.minValid || valid.length === 0) return 'escalate';
  const W = i.rubric.criteria.reduce((s, c) => s + c.weight, 0);
  const sum = valid.reduce((s, x) => s + i.rubric.criteria.reduce((t, c) => t + c.weight * x.verdict!.criteria.find((k) => k.id === c.id)!.score, 0), 0);
  const pass = valid.filter((x) => x.verdict!.overall === 'pass').length;
  const fail = valid.filter((x) => x.verdict!.overall === 'fail').length;
  const fams = new Set(valid.filter((x) => x.verdict!.overall === 'pass').map((x) => x.family)).size;
  const n = valid.length;
  const scoreOk = i.rubric.criteria.length === 0 || sum * 100 >= i.rubric.passThreshold * W * n;
  const a = i.thresholds.acceptSupermajority;
  const r = i.thresholds.rejectSupermajority;
  if (pass * a.denominator >= a.numerator * n && pass > fail && fams >= 2 && scoreOk) return 'accept';
  if (fail * r.denominator >= r.numerator * n && fail > pass) return 'reject';
  return 'escalate';
}

describe('aggregate: properties', () => {
  // Strict-majority fractions only (the pipeline refuses others).
  const arbFraction = fc.integer({ min: 1, max: 20 }).chain((den) => fc.integer({ min: Math.floor(den / 2) + 1, max: den }).map((num) => frac(num, den)));
  const arbVerdict = fc.record({
    family: fc.constantFrom('claude', 'gpt', 'gemini'),
    kind: fc.constantFrom('pass', 'fail', 'abstain', 'invalid'),
    scores: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 3, maxLength: 3 }),
    inj: fc.boolean(),
  });
  const arbInput = fc.record({
    checks: fc.array(fc.record({ checkId: fc.constantFrom('a', 'b'), required: fc.boolean(), passed: fc.boolean() }), { maxLength: 3 }),
    inconclusive: fc.subarray(['a', 'b']),
    emptyRubric: fc.boolean(),
    passThreshold: fc.integer({ min: 0, max: 400 }),
    screenFlagged: fc.boolean(),
    escalate: fc.boolean(),
    verdicts: fc.array(arbVerdict, { maxLength: 7 }),
    minValid: fc.integer({ min: 0, max: 4 }),
    accept: arbFraction,
    reject: arbFraction,
  });
  type ArbIn = typeof arbInput extends fc.Arbitrary<infer T> ? T : never;
  const build = (a: ArbIn): AggregateInput => {
    const i: AggregateInput = {
      checks: a.checks,
      inconclusive: a.inconclusive.filter((id) => a.checks.some((c) => c.checkId === id && !c.passed)),
      rubric: a.emptyRubric ? { criteria: [], passThreshold: a.passThreshold } : { ...RUBRIC, passThreshold: a.passThreshold },
      screenFlagged: a.screenFlagged,
      verdicts: a.verdicts.map((x) => (x.kind === 'invalid' ? invalid(x.family) : v(x.family, x.kind as JudgeVerdict['overall'], x.scores, x.inj))),
      thresholds: { minValid: a.minValid, acceptSupermajority: a.accept, rejectSupermajority: a.reject },
      escalate: a.escalate ? ['forced'] : [],
    };
    if (a.emptyRubric) for (const x of i.verdicts) if (x.verdict) x.verdict.criteria = [];
    return i;
  };

  it('agrees with the oracle for 2000 seeded random inputs', () => {
    fc.assert(fc.property(arbInput, (a) => {
      const i = build(a);
      expect(aggregate(i).decision).toBe(oracle(i));
    }), { seed: 6, numRuns: 2000 });
  });

  it('accept and reject conditions never both hold (strict-majority fractions)', () => {
    fc.assert(fc.property(arbFraction, arbFraction, fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }), (a, r, pass, fail) => {
      const n = pass + fail;
      if (n === 0) return;
      const acceptHolds = pass * a.denominator >= a.numerator * n && pass > fail;
      const rejectHolds = fail * r.denominator >= r.numerator * n && fail > pass;
      expect(acceptHolds && rejectHolds).toBe(false);
      // Even without the tie guard, strict majorities cannot both hold.
      expect(pass * a.denominator >= a.numerator * n && fail * r.denominator >= r.numerator * n).toBe(false);
    }), { seed: 7, numRuns: 2000 });
  });
});

describe('aggregate: the tie guard is defense in depth', () => {
  it('a 2-2 split escalates even under a non-majority fraction (which the pipeline refuses)', () => {
    const half = { minValid: 2, acceptSupermajority: frac(1, 2), rejectSupermajority: frac(1, 2) };
    expect(decide({ thresholds: half, verdicts: [v('a', 'pass'), v('b', 'pass'), v('c', 'fail'), v('d', 'fail')] })).toBe('escalate');
  });
});
