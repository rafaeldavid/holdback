import type { JudgeVerdict } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { criterion, RUBRIC } from './_helpers.js';
import { aggregate, preDecision, type AggregateInput, type PanelVerdict } from './aggregate.js';
import type { CheckOutcome } from './checks/index.js';

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
const T = { minValid: 2, acceptSupermajority: 0.66, rejectSupermajority: 0.66 };
const input = (over: Partial<AggregateInput>): AggregateInput => ({
  checks: [ok('cols')],
  rubric: RUBRIC,
  screenFlagged: false,
  verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'pass')],
  thresholds: T,
  ...over,
});
const decide = (over: Partial<AggregateInput>) => aggregate(input(over)).decision;

describe('preDecision (the short circuits)', () => {
  it.each([
    ['required check failed', [bad('a')], RUBRIC, 'reject'],
    ['required failed, rubric empty', [bad('a')], { criteria: [], passThreshold: 0 }, 'reject'],
    ['all passed, rubric empty', [ok('a')], { criteria: [], passThreshold: 0 }, 'accept'],
    ['no checks, rubric empty', [], { criteria: [], passThreshold: 0 }, 'accept'],
    ['optional failed, rubric empty', [bad('a', false)], { criteria: [], passThreshold: 0 }, 'panel'],
    ['all passed, rubric present', [ok('a')], RUBRIC, 'panel'],
    ['optional failed, rubric present', [ok('a'), bad('b', false)], RUBRIC, 'panel'],
  ] as const)('%s -> %s', (_n, checks, rubric, expected) => {
    expect(preDecision([...checks], { criteria: [...rubric.criteria], passThreshold: rubric.passThreshold })).toBe(expected);
  });
});

describe('aggregate: table', () => {
  const cases: Array<[string, Partial<AggregateInput>, 'accept' | 'reject' | 'escalate']> = [
    // Line 1: required deterministic failure rejects before anything else.
    ['required check failed beats unanimous pass', { checks: [bad('cols')] }, 'reject'],
    ['required check failed beats screen flag', { checks: [bad('cols')], screenFlagged: true }, 'reject'],
    ['optional check failed does not reject', { checks: [bad('cols', false)] }, 'accept'],
    // Line 2: all checks passed and rubric empty accepts without the panel.
    ['rubric empty, checks pass, no verdicts', { rubric: { criteria: [], passThreshold: 0 }, verdicts: [] }, 'accept'],
    ['rubric empty, screen flagged, accepts (no model reads it)', { rubric: { criteria: [], passThreshold: 0 }, screenFlagged: true, verdicts: [] }, 'accept'],
    // Line 4: screen flag or any injectionSuspected escalates.
    ['screen flagged, unanimous pass', { screenFlagged: true }, 'escalate'],
    ['one judge suspects injection', { verdicts: [v('claude', 'pass'), v('gpt', 'pass', [4, 4, 4], true), v('gemini', 'pass')] }, 'escalate'],
    ['an abstaining judge suspects injection', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'abstain', [0, 0, 0], true)] }, 'escalate'],
    ['injection beats unanimous fail', { verdicts: [v('claude', 'fail', [0, 0, 0], true), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'fail', [0, 0, 0])] }, 'escalate'],
    // Line 6: too few valid verdicts escalates.
    ['one valid of three', { verdicts: [v('claude', 'pass'), invalid('gpt'), v('gemini', 'abstain')] }, 'escalate'],
    ['no verdicts at all', { verdicts: [] }, 'escalate'],
    ['two valid is enough', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), invalid('gemini')] }, 'accept'],
    // Line 9: accept needs supermajority, two pass families and the score.
    ['unanimous pass, three families', {}, 'accept'],
    ['2 of 3 pass from two families', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'fail', [1, 1, 1])] }, 'accept'],
    ['unanimous pass, one family', { verdicts: [v('claude', 'pass'), v('claude', 'pass'), v('claude', 'pass')] }, 'escalate'],
    ['3 pass but only one pass family (other family fails)', { verdicts: [v('claude', 'pass'), v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0])] }, 'escalate'],
    ['unanimous pass, score below threshold', { verdicts: [v('claude', 'pass', [3, 3, 2]), v('gpt', 'pass', [3, 3, 2]), v('gemini', 'pass', [3, 3, 2])] }, 'escalate'],
    ['score exactly at threshold', { verdicts: [v('claude', 'pass', [3, 3, 3]), v('gpt', 'pass', [3, 3, 3])] }, 'accept'],
    // Line 10: reject supermajority.
    ['unanimous fail', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'fail', [0, 0, 0])] }, 'reject'],
    ['2 of 3 fail', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'pass')] }, 'reject'],
    ['2 of 3 fail from one family still rejects', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'pass')] }, 'reject'],
    ['fail with high scores still rejects', { verdicts: [v('claude', 'fail'), v('gpt', 'fail'), v('gemini', 'fail')] }, 'reject'],
    // Line 11: otherwise escalate.
    ['1 pass, 1 fail, 1 abstain', { verdicts: [v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'abstain')] }, 'escalate'],
    ['1 pass, 1 fail, 1 invalid', { verdicts: [v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0]), invalid('gemini')] }, 'escalate'],
    // Thresholds are compared literally against the policy Rate.
    ['policy 0.667: 2 of 3 pass is not a supermajority', { thresholds: { ...T, acceptSupermajority: 0.667 }, verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'fail', [1, 1, 1])] }, 'escalate'],
    ['policy 0.6: 3 of 5 pass despite 0.6*5 float error', { thresholds: { ...T, acceptSupermajority: 0.6 }, verdicts: [v('a', 'pass'), v('b', 'pass'), v('c', 'pass'), v('d', 'fail'), v('e', 'fail')] }, 'accept'],
    ['accept is tested before reject', { thresholds: { ...T, acceptSupermajority: 0.5, rejectSupermajority: 0.5 }, verdicts: [v('a', 'pass'), v('b', 'pass'), v('c', 'fail'), v('d', 'fail')] }, 'accept'],
    ['minValid 0 with no verdicts escalates (no share)', { thresholds: { ...T, minValid: 0 }, verdicts: [] }, 'escalate'],
  ];
  it.each(cases)('%s', (_name, over, expected) => expect(decide(over)).toBe(expected));
});

describe('aggregate: reported fields', () => {
  it('weighted score is the mean over valid verdicts of the weight-normalized criterion scores', () => {
    const r = aggregate(input({ verdicts: [v('claude', 'pass', [4, 4, 3]), v('gpt', 'pass', [2, 2, 2]), v('gemini', 'abstain', [0, 0, 0]), invalid('x')] }));
    // (4*.4+4*.4+3*.2) = 3.8 ; 2 ; mean 2.9
    expect(r.weightedScore).toBeCloseTo(2.9, 10);
    expect(r.decision).toBe('escalate');
  });

  it('normalizes weights that do not sum to 1', () => {
    const rubric = { criteria: [criterion('a', 1), criterion('b', 0.5)], passThreshold: 0 };
    const verdict: PanelVerdict = { family: 'f', verdict: { criteria: [{ id: 'b', score: 1, evidence: '' }, { id: 'a', score: 4, evidence: '' }], overall: 'pass', injectionSuspected: false, rationale: '' } };
    const r = aggregate(input({ rubric, verdicts: [verdict, { ...verdict, family: 'g' }] }));
    expect(r.weightedScore).toBeCloseTo(3, 10);
  });

  it('reports shares among valid verdicts and sorted distinct pass families', () => {
    const r = aggregate(input({ verdicts: [v('gpt', 'pass'), v('claude', 'pass'), v('claude', 'pass'), v('gemini', 'fail', [0, 0, 0]), invalid('z')] }));
    expect(r.passShare).toBe(0.75);
    expect(r.failShare).toBe(0.25);
    expect(r.passFamilies).toEqual(['claude', 'gpt']);
  });

  it('has null score and no shares when the panel did not run', () => {
    const r = aggregate(input({ checks: [bad('cols')] }));
    expect(r).toEqual({ decision: 'reject', weightedScore: null, reasons: ['required deterministic check failed: cols'] });
  });

  it('always gives at least one reason, each at most 200 characters', () => {
    const long = 'x'.repeat(40);
    const all: Array<Partial<AggregateInput>> = [{}, { screenFlagged: true }, { verdicts: [] }, { checks: [bad(long), bad(`${long}2`), bad(`${long}3`), bad(`${long}4`), bad(`${long}5`)] }];
    for (const over of all) {
      const r = aggregate(input(over));
      expect(r.reasons.length).toBeGreaterThan(0);
      for (const reason of r.reasons) expect(reason.length).toBeLessThanOrEqual(200);
    }
  });
});

// An independent, literal transcription of the pseudo-code in docs/judgment-and-defenses.md, used as an oracle.
function oracle(i: AggregateInput): 'accept' | 'reject' | 'escalate' {
  if (i.checks.some((c) => c.required && !c.passed)) return 'reject';
  if (i.checks.every((c) => c.passed) && i.rubric.criteria.length === 0) return 'accept';
  if (i.screenFlagged || i.verdicts.some((x) => x.verdict?.injectionSuspected)) return 'escalate';
  const valid = i.verdicts.filter((x) => x.verdict && x.verdict.overall !== 'abstain');
  if (valid.length < i.thresholds.minValid || valid.length === 0) return 'escalate';
  const wsum = i.rubric.criteria.reduce((s, c) => s + c.weight, 0);
  const per = valid.map((x) => i.rubric.criteria.reduce((s, c) => s + c.weight * x.verdict!.criteria.find((k) => k.id === c.id)!.score, 0) / (wsum || 1));
  const score = per.reduce((a, b) => a + b, 0) / per.length;
  const pass = valid.filter((x) => x.verdict!.overall === 'pass');
  const fail = valid.filter((x) => x.verdict!.overall === 'fail');
  const passFamilies = new Set(pass.map((x) => x.family));
  const eps = 1e-9;
  const scoreOk = i.rubric.criteria.length === 0 || score + eps >= i.rubric.passThreshold;
  if (pass.length + eps >= i.thresholds.acceptSupermajority * valid.length && passFamilies.size >= 2 && scoreOk) return 'accept';
  if (fail.length + eps >= i.thresholds.rejectSupermajority * valid.length) return 'reject';
  return 'escalate';
}

describe('aggregate: agrees with a literal transcription of the pseudo-code (property)', () => {
  const arbVerdict = fc.record({
    family: fc.constantFrom('claude', 'gpt', 'gemini'),
    kind: fc.constantFrom('pass', 'fail', 'abstain', 'invalid'),
    scores: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 3, maxLength: 3 }),
    inj: fc.boolean(),
  });
  const arbInput = fc.record({
    checks: fc.array(fc.record({ checkId: fc.constantFrom('a', 'b'), required: fc.boolean(), passed: fc.boolean() }), { maxLength: 3 }),
    emptyRubric: fc.boolean(),
    passThreshold: fc.constantFrom(0, 2, 2.5, 3, 3.5, 4),
    screenFlagged: fc.boolean(),
    verdicts: fc.array(arbVerdict, { maxLength: 5 }),
    minValid: fc.integer({ min: 0, max: 4 }),
    accept: fc.constantFrom(0.5, 0.6, 0.66, 0.667, 0.8, 1),
    reject: fc.constantFrom(0.5, 0.6, 0.66, 0.667, 0.8, 1),
  });
  it('for 2000 seeded random inputs', () => {
    fc.assert(
      fc.property(arbInput, (a) => {
        const i: AggregateInput = {
          checks: a.checks,
          rubric: a.emptyRubric ? { criteria: [], passThreshold: a.passThreshold } : { ...RUBRIC, passThreshold: a.passThreshold },
          screenFlagged: a.screenFlagged,
          verdicts: a.verdicts.map((x) => (x.kind === 'invalid' ? invalid(x.family) : v(x.family, x.kind as JudgeVerdict['overall'], x.scores, x.inj && x.kind !== 'pass' ? true : x.inj))),
          thresholds: { minValid: a.minValid, acceptSupermajority: a.accept, rejectSupermajority: a.reject },
        };
        if (a.emptyRubric) for (const x of i.verdicts) if (x.verdict) x.verdict.criteria = [];
        expect(aggregate(i).decision).toBe(oracle(i));
      }),
      { seed: 6, numRuns: 2000 },
    );
  });
});
