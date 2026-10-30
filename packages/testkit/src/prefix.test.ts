import { describe, expect, it } from 'vitest';
import { evaluate, prefixOf, type RunSummary } from './prefix.js';

const base: RunSummary = {
  finalState: 'Released',
  problems: [],
  invariants: [{ name: 'conservation', ok: true }],
  autoAccepted: false,
  balances: { buyer: 1n },
};
const run = (over: Partial<RunSummary> = {}): RunSummary => ({ ...base, ...over });

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

  it('normal: needs a terminal state, no refused step and holding invariants', () => {
    expect(evaluate('normal', run(), {}).pass).toBe(true);
    expect(evaluate('normal', run({ finalState: 'Held' }), {}).reasons.join()).toMatch(/terminal/);
    expect(evaluate('normal', run({ problems: [{ step: 2, call: 'deliver', type: 'invalid_state' }] }), {}).pass).toBe(false);
    expect(evaluate('normal', run({ invariants: [{ name: 'conservation', ok: false }] }), {}).reasons.join()).toMatch(/conservation/);
    expect(evaluate('normal', run({ runError: 'boom' }), {}).pass).toBe(false);
  });

  it('error: needs a refusal, matching the expected step and problem type when given', () => {
    const refused = run({ finalState: 'Held', problems: [{ step: 3, call: 'deliver', type: 'deadline_passed' }] });
    expect(evaluate('error', run(), {}).reasons.join()).toMatch(/refuse/);
    expect(evaluate('error', refused, {}).pass).toBe(true);
    expect(evaluate('error', refused, { problem: { type: 'deadline_passed', step: 3 } }).pass).toBe(true);
    expect(evaluate('error', refused, { problem: { type: 'invalid_state' } }).reasons.join()).toMatch(/invalid_state/);
    expect(evaluate('error', refused, { problem: { type: 'deadline_passed', step: 2 } }).reasons.join()).toMatch(/step 2/);
    expect(evaluate('error', { ...refused, invariants: [{ name: 'no negative balances', ok: false }] }, {}).pass).toBe(false);
  });

  it('attack: fails on an auto-accept', () => {
    expect(evaluate('attack', run({ autoAccepted: true }), {}).reasons.join()).toMatch(/auto-accept/);
    expect(evaluate('attack', run({ finalState: 'Refunded' }), {}).pass).toBe(true);
  });

  it('neutrality: needs a terminal state despite refusals along the way', () => {
    const refusedThenDone = run({ finalState: 'Released', problems: [{ step: 1, call: 'offer', type: 'invalid_state' }] });
    expect(evaluate('neutrality', refusedThenDone, {}).pass).toBe(true);
    expect(evaluate('neutrality', run({ finalState: 'Delivered' }), {}).pass).toBe(false);
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
