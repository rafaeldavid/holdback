import { describe, expect, it } from 'vitest';
import type { JudgeVerdict } from '@holdback/core';
import { aggregate, stubJudgment, type JudgeInput, type PanelMemberView } from './judgment-stub.js';
import type { JudgeProvider } from './recorded.js';
import { STUB_ACCEPTANCE, STUB_PRICE } from './stub-terms.js';

const m = (judgeId: string, family: string, overall: PanelMemberView['overall'], scores: number[], injectionSuspected = false): PanelMemberView => ({
  judgeId,
  provider: family === 'claude' ? 'anthropic' : 'openai-compatible',
  family,
  model: `${judgeId}-pinned`,
  status: 'ok',
  overall,
  scores,
  injectionSuspected,
});
const W = [0.4, 0.4, 0.2];

describe('stub aggregation', () => {
  const cases: Array<[string, PanelMemberView[], 'accept' | 'reject' | 'escalate', RegExp]> = [
    ['all pass across two families above the threshold', [m('a', 'claude', 'pass', [4, 4, 4]), m('b', 'claude', 'pass', [4, 4, 3]), m('c', 'fam2', 'pass', [3, 4, 4])], 'accept', /3\/3 pass across 2 families/],
    ['all pass but one family only', [m('a', 'claude', 'pass', [4, 4, 4]), m('b', 'claude', 'pass', [4, 4, 4]), m('c', 'claude', 'pass', [4, 4, 4])], 'escalate', /1 family/],
    ['all pass but below the threshold', [m('a', 'claude', 'pass', [2, 2, 2]), m('b', 'claude', 'pass', [3, 2, 2]), m('c', 'fam2', 'pass', [2, 3, 2])], 'escalate', /threshold/],
    ['one judge suspects injection, the rest pass', [m('a', 'claude', 'pass', [4, 4, 4]), m('b', 'claude', 'pass', [4, 4, 4], true), m('c', 'fam2', 'pass', [4, 4, 4])], 'escalate', /injection/],
    ['all fail', [m('a', 'claude', 'fail', [0, 1, 0]), m('b', 'claude', 'fail', [1, 0, 0]), m('c', 'fam2', 'fail', [0, 0, 1])], 'reject', /0\/3 pass/],
    ['split panel', [m('a', 'claude', 'pass', [4, 4, 4]), m('b', 'claude', 'fail', [1, 1, 1]), m('c', 'fam2', 'pass', [4, 4, 4])], 'escalate', /split/],
    ['fewer than two valid verdicts', [m('a', 'claude', 'pass', [4, 4, 4]), m('b', 'claude', 'abstain', []), m('c', 'fam2', 'abstain', [])], 'escalate', /only 1 valid/],
    ['abstentions are excluded, the rest pass across two families', [m('a', 'claude', 'pass', [4, 4, 4]), m('b', 'claude', 'abstain', []), m('c', 'fam2', 'pass', [4, 4, 4])], 'accept', /2\/3 pass across 2 families/],
  ];
  for (const [label, members, decision, reason] of cases) {
    it(`${label} → ${decision}`, () => {
      const r = aggregate(members, W, 3);
      expect(r.decision).toBe(decision);
      expect(r.reasons.join('; ')).toMatch(reason);
    });
  }

  it('weights criteria by the rubric weights', () => {
    expect(aggregate([m('a', 'claude', 'pass', [4, 4, 0]), m('c', 'fam2', 'pass', [4, 4, 0])], W, 3).weightedScore).toBe('3.20');
  });
});

describe('stub judgment', () => {
  const h = (c: string) => `0x${c.repeat(64)}` as const;
  const input: JudgeInput = {
    scenario: 'demo',
    adjudicator: 'bench-a',
    role: 'primary',
    terms: { acceptance: STUB_ACCEPTANCE, deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' }, price: STUB_PRICE } as unknown as JudgeInput['terms'],
    commitmentId: h('1'),
    attempt: 1,
    plaintextSha256: `sha256:${'2'.repeat(64)}`,
    plaintextVerified: true,
    mime: 'text/csv',
    bytes: 10,
    source: 'test',
    seed: h('3'),
    seedCommitment: null,
  };
  const provider = (criteria: (judgeId: string) => JudgeVerdict['criteria']): JudgeProvider => ({
    kind: 'fake',
    judge: (req) => ({ status: 'ok', verdict: { criteria: criteria(req.judgeId), overall: 'pass', injectionSuspected: false, rationale: 'r' } }),
  });
  const full = (score: 0 | 4) => STUB_ACCEPTANCE.rubric.criteria.map((c) => ({ id: c.id, score, evidence: 'e' }));

  it('makes a judge abstain when its criterion IDs do not match the rubric', () => {
    const view = stubJudgment(input, provider((id) => (id === 'claude-b' ? [{ id: 'made_up', score: 4, evidence: 'e' }, ...full(4).slice(1)] : full(4))));
    const b = view.panel.members.find((x) => x.judgeId === 'claude-b')!;
    expect(b.overall).toBe('abstain');
    expect(b.abstainReason).toMatch(/made_up|dedupe_quality/);
    expect(view.aggregate.decision).toBe('accept');
  });

  it('abstains on a missing or duplicated criterion too', () => {
    const missing = stubJudgment(input, provider(() => full(4).slice(1)));
    expect(missing.panel.members.every((x) => x.overall === 'abstain')).toBe(true);
    expect(missing.aggregate.decision).toBe('escalate');
    const dup = stubJudgment(input, provider(() => [...full(4), full(4)[0]!]));
    expect(dup.panel.members.every((x) => x.overall === 'abstain')).toBe(true);
  });

  it('records no seed match for a judge with no seed commitment (fallback)', () => {
    const view = stubJudgment({ ...input, role: 'fallback' }, provider(() => full(4)));
    expect(view.panel.seedCommitment).toBeNull();
    expect(view.panel.seedMatches).toBeNull();
  });
});
