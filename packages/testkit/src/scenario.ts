// Scenario fixtures are declarative YAML. The parser builds plain data from the core schema only
// (no custom tags, no functions, bounded aliases) and checks every key against a closed set, so a
// fixture can describe a run but can never carry code.
import { PROBLEM_TYPES, type ProblemType } from '@holdback/core';
import { parseDocument } from 'yaml';
import { parsePragmas, type Pragmas } from './pragma.js';
import { prefixOf, TERMINAL_STATES, type ScenarioExpect } from './prefix.js';

export class ScenarioError extends Error {
  override name = 'ScenarioError';
}

export type Via = 'direct' | string;

export type Step =
  | { kind: 'offer'; by: 'seller'; via: Via; signer?: string }
  | { kind: 'adjudicator_accept'; via: Via }
  | { kind: 'agree_and_fund'; by: 'buyer'; via: Via; signer?: string }
  | { kind: 'deliver'; by: 'seller'; via: Via; file: string; signer?: string; stubBytes?: true }
  | { kind: 'advance_clock'; seconds: number }
  | { kind: 'judge'; adjudicator: string }
  | { kind: 'settle'; trigger: 'anyone' | 'buyer' | 'seller'; via: Via }
  | { kind: 'reclaim'; by: 'buyer'; via: Via }
  | { kind: 'verify_key_release'; by: 'buyer'; via: Via }
  // Outages and permissionless timeouts (neutrality fixtures).
  | { kind: 'offline'; actor: string }
  | { kind: 'operator_refuses'; operator: string }
  | { kind: 'trigger_fallback'; via: Via }
  | { kind: 'trigger_default'; via: Via }
  | { kind: 'apply_default_outcome'; via: Via }
  | { kind: 'expire'; via: Via };

export type StepKind = Step['kind'];

// `signer` names a different actor whose key signs the step's messages (an impersonation attempt);
// the settlement must refuse it with invalid_signature.

export interface Scenario {
  name: string;
  description?: string;
  pragmas: Pragmas;
  club?: string;
  terms?: string;
  parties: { buyer: string; seller: string };
  /** neutrality. fixtures: the actor that refuses or disappears. */
  fails?: string;
  adjudicators: { primary: string; fallback: string; appeal: string };
  operators: string[];
  /** Starting balances in base units (decimal strings). */
  faucet: Record<string, string>;
  steps: Step[];
  expect: ScenarioExpect;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const NAME = /^[a-z0-9][a-z0-9._-]*$|^_[a-z0-9._-]+$/;
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
/** Ledger and routing names the runner uses itself; no actor may take them. */
export const RESERVED_NAMES: readonly string[] = ['escrow', 'anyone', 'direct', 'faucet'];

function fail(path: string, message: string): never {
  throw new ScenarioError(`${path}: ${message}`);
}

function object(v: unknown, path: string, allowed: readonly string[], required: readonly string[] = []): Obj {
  if (!isObj(v)) fail(path, 'must be a mapping');
  for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(path, `unknown key "${k}"; allowed: ${allowed.join(', ') || '(none)'}`);
  for (const k of required) if (!(k in v)) fail(path, `missing key "${k}"`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') fail(path, 'must be a non-empty string');
  return v;
}

function name(v: unknown, path: string): string {
  const s = str(v, path);
  if (!NAME.test(s)) fail(path, `"${s}" must be lowercase letters, digits, ".", "_" or "-"`);
  return s;
}

function literal<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, `must be one of ${allowed.join(', ')}; got ${JSON.stringify(v)}`);
  return v as T;
}

function money(v: unknown, path: string): string {
  if (typeof v !== 'string' || !DECIMAL.test(v)) fail(path, `money must be a quoted decimal string in base units; got ${JSON.stringify(v)}`);
  return v;
}

function moneyMap(v: unknown, path: string): Record<string, string> {
  if (!isObj(v)) fail(path, 'must be a mapping of account to amount');
  return Object.fromEntries(Object.entries(v).map(([k, amount]) => [name(k, `${path}.${k}`), money(amount, `${path}.${k}`)]));
}

function positiveInt(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) fail(path, `must be a positive integer; got ${JSON.stringify(v)}`);
  return v;
}

const STEP_KINDS = [
  'offer',
  'adjudicator_accept',
  'agree_and_fund',
  'deliver',
  'advance_clock',
  'judge',
  'settle',
  'reclaim',
  'verify_key_release',
  'offline',
  'operator_refuses',
  'trigger_fallback',
  'trigger_default',
  'apply_default_outcome',
  'expire',
];

function parseStep(raw: unknown, path: string, operators: readonly string[], actors: readonly string[]): Step {
  if (!isObj(raw) || Object.keys(raw).length !== 1) fail(path, 'each step is a mapping with exactly one key, e.g. "- offer: { by: seller }"');
  const [kind, body] = Object.entries(raw)[0]!;
  const p = `${path}.${kind}`;
  const via = (o: Obj): Via => {
    if (o.via === undefined || o.via === 'direct') return 'direct';
    const op = name(o.via, `${p}.via`);
    if (!operators.includes(op)) fail(`${p}.via`, `operator "${op}" is not in operators [${operators.join(', ')}]`);
    return op;
  };
  const signer = (o: Obj): { signer?: string } => (o.signer === undefined ? {} : { signer: name(o.signer, `${p}.signer`) });
  switch (kind) {
    case 'offer': {
      const o = object(body, p, ['by', 'via', 'signer'], ['by']);
      return { kind, by: literal(o.by, `${p}.by`, ['seller'] as const), via: via(o), ...signer(o) };
    }
    case 'adjudicator_accept': {
      const o = object(body ?? {}, p, ['via']);
      return { kind, via: via(o) };
    }
    case 'agree_and_fund': {
      const o = object(body, p, ['by', 'via', 'signer'], ['by']);
      return { kind, by: literal(o.by, `${p}.by`, ['buyer'] as const), via: via(o), ...signer(o) };
    }
    case 'deliver': {
      const o = object(body, p, ['by', 'via', 'file', 'signer', 'stub_bytes'], ['by', 'file']);
      const file = str(o.file, `${p}.file`);
      if (file.startsWith('/') || file.split('/').includes('..')) fail(`${p}.file`, 'must be a path relative to fixtures/ without ".."');
      if (o.stub_bytes !== undefined && o.stub_bytes !== true) fail(`${p}.stub_bytes`, 'must be true when present');
      return { kind, by: literal(o.by, `${p}.by`, ['seller'] as const), via: via(o), file, ...signer(o), ...(o.stub_bytes === true ? { stubBytes: true as const } : {}) };
    }
    case 'advance_clock': {
      const o = object(body, p, ['seconds'], ['seconds']);
      return { kind, seconds: positiveInt(o.seconds, `${p}.seconds`) };
    }
    case 'judge': {
      const o = object(body, p, ['adjudicator'], ['adjudicator']);
      return { kind, adjudicator: name(o.adjudicator, `${p}.adjudicator`) };
    }
    case 'settle': {
      const o = object(body ?? {}, p, ['trigger', 'via']);
      return { kind, trigger: o.trigger === undefined ? 'anyone' : literal(o.trigger, `${p}.trigger`, ['anyone', 'buyer', 'seller'] as const), via: via(o) };
    }
    case 'reclaim': {
      const o = object(body, p, ['by', 'via'], ['by']);
      return { kind, by: literal(o.by, `${p}.by`, ['buyer'] as const), via: via(o) };
    }
    case 'verify_key_release': {
      const o = object(body, p, ['by', 'via'], ['by']);
      return { kind, by: literal(o.by, `${p}.by`, ['buyer'] as const), via: via(o) };
    }
    case 'offline': {
      const o = object(body, p, ['actor'], ['actor']);
      const actor = name(o.actor, `${p}.actor`);
      if (!actors.includes(actor)) fail(`${p}.actor`, `"${actor}" is not a party, adjudicator or operator of this scenario`);
      return { kind, actor };
    }
    case 'operator_refuses': {
      const o = object(body, p, ['operator'], ['operator']);
      const op = name(o.operator, `${p}.operator`);
      if (!operators.includes(op)) fail(`${p}.operator`, `operator "${op}" is not in operators [${operators.join(', ')}]`);
      return { kind, operator: op };
    }
    case 'trigger_fallback':
    case 'trigger_default':
    case 'apply_default_outcome':
    case 'expire': {
      const o = object(body ?? {}, p, ['via']);
      return { kind, via: via(o) };
    }
    default:
      fail(path, `unknown step "${kind}"; known: ${STEP_KINDS.join(', ')}`);
  }
}

function parseExpect(raw: unknown, shorthand: unknown): ScenarioExpect {
  const out: ScenarioExpect = {};
  if (raw !== undefined) {
    const o = object(raw, 'expect', ['terminal', 'balances', 'problem']);
    if (o.terminal !== undefined) out.terminal = literal(o.terminal, 'expect.terminal', TERMINAL_STATES);
    if (o.balances !== undefined) out.balances = moneyMap(o.balances, 'expect.balances');
    if (o.problem !== undefined) {
      const pr = object(o.problem, 'expect.problem', ['step', 'type'], ['type']);
      out.problem = { type: literal(pr.type, 'expect.problem.type', PROBLEM_TYPES as readonly ProblemType[]) };
      if (pr.step !== undefined) out.problem.step = positiveInt(pr.step, 'expect.problem.step');
    }
  }
  if (shorthand !== undefined) {
    if (out.terminal !== undefined) fail('expect_terminal', 'use expect.terminal or expect_terminal, not both');
    out.terminal = literal(shorthand, 'expect_terminal', TERMINAL_STATES);
  }
  return out;
}

const TOP = ['name', 'description', 'club', 'terms', 'parties', 'fails', 'adjudicators', 'operators', 'faucet', 'steps', 'expect', 'expect_terminal'] as const;

/** Parses a scenario file. Throws ScenarioError with a path for anything it does not understand. */
export function parseScenario(source: string, fileName: string): Scenario {
  const pragmas = parsePragmas(source);
  if (!pragmas.ok) fail('pragmas', pragmas.error);

  // core schema: strings, numbers, booleans, null, maps and sequences only. Unknown tags are errors.
  const doc = parseDocument(source, { schema: 'core', customTags: [], uniqueKeys: true, prettyErrors: false, strict: true });
  if (doc.errors.length) fail('yaml', doc.errors[0]!.message);
  if (doc.warnings.length) fail('yaml', doc.warnings[0]!.message);
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 20 });
  } catch (e) {
    fail('yaml', (e as Error).message);
  }

  const top = object(data, fileName, TOP, ['name', 'parties', 'adjudicators', 'steps']);
  const scenarioName = name(top.name, 'name');
  if (scenarioName !== fileName) fail('name', `"${scenarioName}" must match the file name "${fileName}"`);
  const partiesObj = object(top.parties, 'parties', ['buyer', 'seller'], ['buyer', 'seller']);
  const adjObj = object(top.adjudicators, 'adjudicators', ['primary', 'fallback', 'appeal'], ['primary', 'fallback', 'appeal']);
  const operators = top.operators === undefined ? [] : Array.isArray(top.operators) ? top.operators.map((o, i) => name(o, `operators[${i}]`)) : fail('operators', 'must be a list');
  if (!Array.isArray(top.steps)) fail('steps', 'must be a list');
  const parties = { buyer: name(partiesObj.buyer, 'parties.buyer'), seller: name(partiesObj.seller, 'parties.seller') };
  const adjudicators = {
    primary: name(adjObj.primary, 'adjudicators.primary'),
    fallback: name(adjObj.fallback, 'adjudicators.fallback'),
    appeal: name(adjObj.appeal, 'adjudicators.appeal'),
  };
  const actors = [parties.buyer, parties.seller, ...Object.values(adjudicators), ...operators];
  for (const a of actors) if (RESERVED_NAMES.includes(a)) fail('parties', `"${a}" is reserved for the runner (${RESERVED_NAMES.join(', ')})`);
  if (new Set(actors).size !== actors.length) fail('parties', 'buyer, seller, adjudicators and operators must all have distinct names');

  const faucet = top.faucet === undefined ? {} : moneyMap(top.faucet, 'faucet');
  for (const who of Object.keys(faucet)) if (!actors.includes(who)) fail(`faucet.${who}`, 'not a party, adjudicator or operator of this scenario');

  const scenario: Scenario = {
    name: scenarioName,
    pragmas: pragmas.value,
    parties,
    adjudicators,
    operators,
    faucet,
    steps: top.steps.map((s, i) => parseStep(s, `steps[${i + 1}]`, operators, actors)),
    expect: parseExpect(top.expect, top.expect_terminal),
  };
  if (top.description !== undefined) scenario.description = str(top.description, 'description');
  if (top.club !== undefined) scenario.club = str(top.club, 'club');
  if (top.terms !== undefined) scenario.terms = str(top.terms, 'terms');

  const prefix = prefixOf(scenarioName);
  if (top.fails !== undefined) {
    if (prefix !== 'neutrality') fail('fails', 'only neutrality. fixtures name a failing actor');
    const failing = name(top.fails, 'fails');
    if (!actors.includes(failing)) fail('fails', `"${failing}" is not a party, adjudicator or operator of this scenario`);
    scenario.fails = failing;
  } else if (prefix === 'neutrality') {
    fail('fails', 'neutrality. fixtures must name the actor that refuses or disappears, e.g. "fails: bench-a"');
  }
  if (prefix === 'error') {
    if (!scenario.expect.problem) fail('expect.problem', 'error. fixtures must state the refused step and problem type, e.g. "expect: { problem: { step: 2, type: invalid_state } }"');
    if (scenario.expect.problem.step === undefined) fail('expect.problem.step', 'error. fixtures must state which step is refused');
  }
  return scenario;
}
