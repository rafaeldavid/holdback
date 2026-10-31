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
    expect(s.steps[2]).toEqual({ kind: 'deliver', by: 'seller', via: 'op-1', file: 'data/dataset-cleaning/customers.clean.csv' });
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

  it('requires error. fixtures to name the refused step and problem type', () => {
    const errorFixture = (body: string) => minimal(body).replace('name: t', 'name: error.t');
    expect(() => parseScenario(errorFixture('steps: []\n'), 'error.t')).toThrow(/expect\.problem/);
    expect(() => parseScenario(errorFixture('steps: []\nexpect: { problem: { type: invalid_state } }\n'), 'error.t')).toThrow(/step/);
    expect(parseScenario(errorFixture('steps: []\nexpect: { problem: { type: invalid_state, step: 1 } }\n'), 'error.t').expect.problem).toEqual({ type: 'invalid_state', step: 1 });
  });

  it('requires neutrality. fixtures to name a declared failing actor', () => {
    const n = (body: string) => minimal(body).replace('name: t', 'name: neutrality.t');
    expect(() => parseScenario(n('steps: []\n'), 'neutrality.t')).toThrow(/fails/);
    expect(() => parseScenario(n('fails: nobody\nsteps: []\n'), 'neutrality.t')).toThrow(/nobody/);
    expect(parseScenario(n('fails: p\nsteps: []\n'), 'neutrality.t').fails).toBe('p');
    expect(() => parseScenario(minimal('fails: p\nsteps: []\n'), 't')).toThrow(/neutrality\./);
  });

  it('parses timeout, offline and operator-refusal steps', () => {
    const s = parseScenario(
      minimal(`operators: [op-1]
steps:
  - offline: { actor: p }
  - operator_refuses: { operator: op-1 }
  - trigger_fallback: {}
  - trigger_default: { via: op-1 }
  - apply_default_outcome:
  - expire: {}
`),
      't',
    );
    expect(s.steps).toEqual([
      { kind: 'offline', actor: 'p' },
      { kind: 'operator_refuses', operator: 'op-1' },
      { kind: 'trigger_fallback', via: 'direct' },
      { kind: 'trigger_default', via: 'op-1' },
      { kind: 'apply_default_outcome', via: 'direct' },
      { kind: 'expire', via: 'direct' },
    ]);
    expect(() => parseScenario(minimal('steps:\n  - offline: { actor: ghost }\n'), 't')).toThrow(/ghost/);
    expect(() => parseScenario(minimal('steps:\n  - operator_refuses: { operator: op-9 }\n'), 't')).toThrow(/op-9/);
  });

  it('reads the stub_bytes opt-in on deliver', () => {
    const s = parseScenario(minimal('steps:\n  - deliver: { by: seller, file: data/x.csv, stub_bytes: true }\n'), 't');
    expect(s.steps[0]).toEqual({ kind: 'deliver', by: 'seller', via: 'direct', file: 'data/x.csv', stubBytes: true });
    expect(() => parseScenario(minimal('steps:\n  - deliver: { by: seller, file: data/x.csv, stub_bytes: "yes" }\n'), 't')).toThrow(/stub_bytes/);
  });

  it('reserves ledger account names and checks faucet accounts', () => {
    for (const reserved of ['escrow', 'anyone', 'direct']) {
      expect(() => parseScenario(minimal('steps: []\n').replace('buyer: b', `buyer: ${reserved}`), 't')).toThrow(/reserved/);
    }
    expect(() => parseScenario(minimal('operators: [escrow]\nsteps: []\n'), 't')).toThrow(/reserved/);
    expect(() => parseScenario(minimal('faucet: { stranger: "1" }\nsteps: []\n'), 't')).toThrow(/stranger/);
  });

  it('accepts only terminal states in expect_terminal, like expect.terminal', () => {
    expect(() => parseScenario(minimal('steps: []\nexpect_terminal: Held\n'), 't')).toThrow(/Held/);
    expect(() => parseScenario(minimal('steps: []\nexpect: { terminal: Held }\n'), 't')).toThrow(/Held/);
  });

  it('accepts expect_terminal as a shorthand (docs/testing.md example)', () => {
    expect(parseScenario(minimal('steps: []\nexpect_terminal: Refunded\n'), 't').expect).toEqual({ terminal: 'Refunded' });
  });

  it('reads an expected problem for error fixtures', () => {
    const s = parseScenario(minimal('steps: []\nexpect: { problem: { step: 2, type: deadline_passed } }\n').replace('name: t', 'name: error.t'), 'error.t');
    expect(s.expect.problem).toEqual({ step: 2, type: 'deadline_passed' });
    expect(() => parseScenario(minimal('steps: []\nexpect: { problem: { type: oops, step: 1 } }\n'), 't')).toThrow(/oops/);
  });
});
