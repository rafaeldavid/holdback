import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScenario, ScenarioError } from './scenario.js';

const example = readFileSync(new URL('../../../fixtures/scenarios/_example.scenario.yaml', import.meta.url), 'utf8');
const minimal = (body: string) => `# @seed 1
name: t
parties: { buyer: b, seller: s }
adjudicators: { primary: p, fallback: f, appeal: a }
${body}`;

describe('scenario parser', () => {
  it('parses the _example fixture into typed steps', () => {
    const s = parseScenario(example, '_example');
    expect(s.pragmas).toEqual({ settlement: 'sim', judges: 'recorded', mode: 'guaranteed_on_decision', seed: 7 });
    expect(s.parties).toEqual({ buyer: 'atlas-buyer', seller: 'tidewater-seller' });
    expect(s.operators).toEqual(['op-1', 'op-2']);
    expect(s.faucet['atlas-buyer']).toBe('10000000000');
    expect(s.steps.map((x) => x.kind)).toEqual(['offer', 'agree_and_fund', 'deliver', 'advance_clock', 'judge', 'settle', 'verify_key_release']);
    expect(s.steps[2]).toEqual({ kind: 'deliver', by: 'seller', via: 'op-1', file: 'data/customers.cleaned.good.csv' });
    expect(s.steps[3]).toEqual({ kind: 'advance_clock', seconds: 5 });
    expect(s.steps[6]).toEqual({ kind: 'verify_key_release', by: 'buyer', via: 'direct' });
    expect(s.expect).toEqual({ terminal: 'Released', balances: { 'atlas-buyer': '7950000000', 'tidewater-seller': '2000000000', 'bench-a': '25050000000' } });
  });

  it('requires the name to match the file name', () => {
    expect(() => parseScenario(example, 'other')).toThrow(/name/);
  });

  it('rejects unknown steps and unknown keys, so typos cannot pass silently', () => {
    expect(() => parseScenario(minimal('steps:\n  - teleport: {}\n'), 't')).toThrow(/unknown step "teleport"/);
    expect(() => parseScenario(minimal('steps:\n  - offer: { by: seller, viaa: op-1 }\n'), 't')).toThrow(/viaa/);
    expect(() => parseScenario(minimal('colour: red\nsteps: []\n'), 't')).toThrow(/colour/);
    expect(() => parseScenario(minimal('steps:\n  - offer: { by: buyer }\n'), 't')).toThrow(/by/);
  });

  it('rejects money written as a YAML number', () => {
    expect(() => parseScenario(minimal('faucet: { b: 10000 }\nsteps: []\n'), 't')).toThrow(/decimal string/);
    expect(() => parseScenario(minimal('faucet: { b: "1.5" }\nsteps: []\n'), 't')).toThrow(/decimal string/);
  });

  it('rejects an operator the fixture does not declare', () => {
    expect(() => parseScenario(minimal('operators: [op-1]\nsteps:\n  - offer: { by: seller, via: op-9 }\n'), 't')).toThrow(/op-9/);
  });

  it('never executes or constructs anything from YAML tags', () => {
    expect(() => parseScenario(minimal('steps: !!js/function "function(){ return 1 }"\n'), 't')).toThrow(ScenarioError);
    expect(() => parseScenario(minimal('steps: !custom []\n'), 't')).toThrow(ScenarioError);
  });

  it('refuses alias expansion bombs', () => {
    const bomb = minimal(`a: &a ["x","x","x","x","x","x","x","x","x","x"]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]
steps: []
`);
    expect(() => parseScenario(bomb, 't')).toThrow(ScenarioError);
  });

  it('accepts expect_terminal as a shorthand (docs/testing.md example)', () => {
    expect(parseScenario(minimal('steps: []\nexpect_terminal: Refunded\n'), 't').expect).toEqual({ terminal: 'Refunded' });
  });

  it('reads an expected problem for error fixtures', () => {
    const s = parseScenario(minimal('steps: []\nexpect: { problem: { step: 2, type: deadline_passed } }\n'), 't');
    expect(s.expect.problem).toEqual({ step: 2, type: 'deadline_passed' });
    expect(() => parseScenario(minimal('steps: []\nexpect: { problem: { type: oops } }\n'), 't')).toThrow(/oops/);
  });
});
