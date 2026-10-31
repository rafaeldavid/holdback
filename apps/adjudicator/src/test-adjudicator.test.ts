import { fakeProvider, type JudgeRequest } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { FAKE_JUDGE_MARK, markedFake, placeholderRegistry } from './test-adjudicator.js';

const req = {
  judgeId: 'claude-a',
  provider: 'anthropic',
  model: 'placeholder-claude-a-20260601',
  system: 'rules\n6. "criteria" must contain each of these ids exactly once: faithful, fluent.\n7. more',
  user: 'data',
  temperature: 0,
  maxOutputTokens: 2048,
} as JudgeRequest;

describe('test adjudicator fake judges', () => {
  it('marks every rationale and evidence string as fake, within the schema limits', async () => {
    const res = await markedFake(fakeProvider({ 'claude-a': 'fail' })).complete(req);
    expect(res.kind).toBe('ok');
    const v = JSON.parse((res as { text: string }).text) as { rationale: string; overall: string; criteria: Array<{ id: string; evidence: string }> };
    expect(v.overall).toBe('fail');
    expect(v.rationale.startsWith(FAKE_JUDGE_MARK)).toBe(true);
    expect(v.criteria.map((c) => c.id)).toEqual(['faithful', 'fluent']);
    for (const c of v.criteria) {
      expect(c.evidence.startsWith(FAKE_JUDGE_MARK)).toBe(true);
      expect(c.evidence.length).toBeLessThanOrEqual(300);
    }
  });

  it('passes timeouts through untouched', async () => {
    expect(await markedFake(fakeProvider({ 'claude-a': 'timeout' })).complete(req)).toEqual({ kind: 'timeout' });
  });

  it('uses the placeholder registry, whose model IDs say they are placeholders', () => {
    expect(placeholderRegistry().active.every((j) => j.model.startsWith('placeholder-'))).toBe(true);
  });
});
