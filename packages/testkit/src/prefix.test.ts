import { describe, expect, it } from 'vitest';
import { evaluate, prefixOf, type RunSummary } from './prefix.js';

const base: RunSummary = {
  finalState: 'Released',
  problems: [],
  outages: [],
  judgments: ['accept'],
  invariants: [{ name: 'conservation', ok: true }],
  autoAccepted: false,
  balances: { buyer: 1n },
};
const run = (over: Partial<RunSummary> = {}): RunSummary => ({ ...base, ...over });
const refusal = (step: number, type: RunSummary['problems'][number]['type'], actor = 'seller') => ({ step, call: 'deliver', actor, type });

describe('filename prefixes', () => {
  it('classifies names by prefix', () => {
    expect(prefixOf('happy-path')).toBe('normal');
    expect(prefixOf('_example')).toBe('normal');
    expect(prefixOf('error.scope-exceeded')).toBe('error');
    expect(prefixOf('attack.injection')).toBe('attack');
    expect(prefixOf('neutrality.operator-refuses')).toBe('neutrality');
    expect(prefixOf('todo.milestones')).toBe('todo');
    expect(prefixOf('errors-are-fine')).toBe('normal');
  });

  it('normal: needs a terminal state, no refused step, no outage and holding invariants', () => {
    expect(evaluate('normal', run(), {}).pass).toBe(true);
    expect(evaluate('normal', run({ finalState: 'Held' }), {}).reasons.join()).toMatch(/terminal/);
    expect(evaluate('normal', run({ problems: [refusal(2, 'invalid_state')] }), {}).pass).toBe(false);
    expect(evaluate('normal', run({ outages: [{ step: 2, actor: 'op-1', kind: 'operator_refused' }] }), {}).reasons.join()).toMatch(/neutrality\./);
    expect(evaluate('normal', run({ invariants: [{ name: 'conservation', ok: false }] }), {}).reasons.join()).toMatch(/conservation/);
    expect(evaluate('normal', run({ runError: 'boom' }), {}).pass).toBe(false);
  });

  it('error: needs expect.problem with type and step, and a matching first refusal', () => {
    const refused = run({ finalState: 'Held', problems: [refusal(3, 'deadline_passed')] });
    expect(evaluate('error', refused, {}).reasons.join()).toMatch(/expect\.problem/);
    expect(evaluate('error', refused, { problem: { type: 'deadline_passed' } }).reasons.join()).toMatch(/expect\.problem/);
    expect(evaluate('error', refused, { problem: { type: 'deadline_passed', step: 3 } }).pass).toBe(true);
    expect(evaluate('error', run(), { problem: { type: 'deadline_passed', step: 3 } }).reasons.join()).toMatch(/refuse/);
    expect(evaluate('error', refused, { problem: { type: 'invalid_state', step: 3 } }).reasons.join()).toMatch(/invalid_state/);
    expect(evaluate('error', refused, { problem: { type: 'deadline_passed', step: 2 } }).reasons.join()).toMatch(/step 2/);
    expect(evaluate('error', { ...refused, invariants: [{ name: 'no negative balances', ok: false }] }, { problem: { type: 'deadline_passed', step: 3 } }).pass).toBe(false);
  });

  it('attack: fails on an auto-accept', () => {
    expect(evaluate('attack', run({ autoAccepted: true }), {}).reasons.join()).toMatch(/auto-accept/);
  });

  it('attack: needs an escalation or rejection, or a non-empty expect block the run meets', () => {
    expect(evaluate('attack', run({ finalState: null, judgments: [] }), {}).reasons.join()).toMatch(/escalat|reject/);
    expect(evaluate('attack', run({ finalState: 'Held', judgments: [] }), {}).pass).toBe(false);
    for (const finalState of ['Escalated', 'FallbackJudging', 'Refunded'] as const) {
      expect(evaluate('attack', run({ finalState, judgments: [] }), {}).pass).toBe(true);
    }
    expect(evaluate('attack', run({ finalState: 'Delivered', judgments: ['escalate'] }), {}).pass).toBe(true);
    expect(evaluate('attack', run({ finalState: 'Delivered', judgments: ['reject'] }), {}).pass).toBe(true);
    const refused = run({ finalState: 'AcceptedByAdjudicator', judgments: [], problems: [refusal(2, 'invalid_signature', 'buyer')] });
    expect(evaluate('attack', refused, { problem: { type: 'invalid_signature', step: 2 } }).pass).toBe(true);
    expect(evaluate('attack', refused, { problem: { type: 'invalid_state', step: 2 } }).pass).toBe(false);
  });

  it('neutrality: needs the failing actor named, an outage or refusal for it, and a terminal state', () => {
    const outage = { step: 4, actor: 'bench-a', kind: 'timeout' as const };
    expect(evaluate('neutrality', run(), {}).reasons.join()).toMatch(/fails/);
    expect(evaluate('neutrality', run(), {}, 'bench-a').reasons.join()).toMatch(/bench-a/);
    expect(evaluate('neutrality', run({ outages: [outage] }), {}, 'bench-a').pass).toBe(true);
    expect(evaluate('neutrality', run({ outages: [{ ...outage, actor: 'bench-b' }] }), {}, 'bench-a').pass).toBe(false);
    expect(evaluate('neutrality', run({ problems: [refusal(1, 'invalid_state', 'bench-a')] }), {}, 'bench-a').pass).toBe(true);
    expect(evaluate('neutrality', run({ finalState: 'Delivered', outages: [outage] }), {}, 'bench-a').pass).toBe(false);
  });

  it('todo: records current behavior and passes whatever happened', () => {
    const r = evaluate('todo', run({ finalState: 'Held', runError: 'unsupported', invariants: [{ name: 'x', ok: false }] }), {});
    expect(r.pass).toBe(true);
    expect(r.label).toBe('todo');
  });

  it('checks the fixture expect block for every prefix', () => {
    expect(evaluate('normal', run(), { terminal: 'Refunded' }).reasons.join()).toMatch(/Refunded/);
    expect(evaluate('normal', run(), { balances: { buyer: '1' } }).pass).toBe(true);
    expect(evaluate('normal', run(), { balances: { buyer: '2' } }).reasons.join()).toMatch(/buyer/);
    expect(evaluate('normal', run(), { balances: { nobody: '0' } }).reasons.join()).toMatch(/nobody/);
  });
});
