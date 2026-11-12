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

export type StepBody =
  | { kind: 'offer'; by: 'seller'; via: Via; signer?: string }
  | { kind: 'adjudicator_accept'; via: Via }
  | { kind: 'agree_and_fund'; by: 'buyer'; via: Via; signer?: string }
  // buyerEnvelope 'wrong_key': the seller seals the buyer's envelope to a key the buyer does not hold, naming the
  // right recipient (sim batch 1, F2). Settlement cannot tell; only the buyer's open fails.
  | { kind: 'deliver'; by: 'seller'; via: Via; file: string; signer?: string; stubBytes?: true; attempt?: number; buyerEnvelope?: 'wrong_key' }
  | { kind: 'advance_clock'; seconds: number }
  | { kind: 'judge'; adjudicator: string }
  | { kind: 'settle'; trigger: 'anyone' | 'buyer' | 'seller'; via: Via }
  | { kind: 'reclaim'; by: 'buyer'; via: Via }
  | { kind: 'verify_key_release'; by: 'buyer'; via: Via }
  // The buyer accepts the delivery before any decision (releases price and key; the fee returns to the buyer).
  // `opened`: the buyer names a second delivery of that file, which the seller signed and handed it off chain, not
  // the posted one (seller equivocation, ADR-0029); settlement refuses it.
  | { kind: 'early_accept'; by: 'buyer'; via: Via; signer?: string; opened?: string }
  // A party appeals a first-instance decision, posting the rulebook's appeal bond (or `bond`) and fee. SimChain only:
  // the phase-one contracts have no party appeal, and the EVM adapter refuses the step (ADR-0031 §8).
  | { kind: 'appeal'; by: 'buyer' | 'seller'; via: Via; grounds: string; bond?: string; signer?: string }
  // ADR-0019, D23: both parties sign payouts (actor name to amount) that sum to the price.
  // `carry` (late work, ADR-0031 SC-5b): the settlement carries a seller-signed delivery of that file that was never
  // posted, names it and may release its key. `names`: it signs the hash of a delivery of another file instead.
  | { kind: 'mutual_settle'; via: Via; payouts: Record<string, string>; releaseKey: boolean; signer?: string; carry?: string; names?: string }
  // Outages and permissionless timeouts (neutrality fixtures).
  | { kind: 'offline'; actor: string }
  | { kind: 'operator_refuses'; operator: string }
  // ADR-0036: a deploy. The three adjudicators restart on a build whose default screen version or registry differs; the
  // build keeps every version and registry it carried, so a deal judges under what it bound.
  | { kind: 'restart_adjudicators'; screenVersion?: string; registry?: string }
  | { kind: 'trigger_fallback'; via: Via }
  | { kind: 'trigger_default'; via: Via }
  | { kind: 'apply_default_outcome'; via: Via }
  | { kind: 'expire'; via: Via }
  | { kind: 'expire_appeal'; via: Via };

/**
 * Deliberate faults in the messages a step signs, for error. fixtures. Each must be refused by settlement:
 * - reuse_nonce: the signer reuses its previous nonce (terms nonce for an offer) -> nonce_reused;
 * - wrong_seed: a Decision reveals a seed that is not the committed or beacon seed -> seed_mismatch;
 * - wrong_seed_commitment: the acceptance commits to another seed, so the honest reveal fails -> seed_mismatch;
 * - wrong_policy_hash / wrong_registry_hash: the message names another policy or registry -> *_mismatch;
 * - wrong_commitment_id: the acceptance names another commitment -> acceptance_mismatch;
 * - wrong_attempt: a Decision names the next attempt, with that attempt's panel seed for a beacon role (T-206 H-1)
 *   -> invalid_terms;
 * - buyer_key: a Decision carries the buyer's key where an honest one carries none: with a reject or an escalate, or
 *   on a refunded deal (T-206 H-2) -> invalid_terms.
 */
export const TAMPERS = ['reuse_nonce', 'wrong_seed', 'wrong_seed_commitment', 'wrong_policy_hash', 'wrong_registry_hash', 'wrong_commitment_id', 'wrong_attempt', 'buyer_key'] as const;
export type Tamper = (typeof TAMPERS)[number];

/** Which tampers each step's messages can carry. */
const TAMPERABLE: Record<string, readonly Tamper[]> = {
  offer: ['reuse_nonce'],
  adjudicator_accept: ['reuse_nonce', 'wrong_seed_commitment', 'wrong_policy_hash', 'wrong_registry_hash', 'wrong_commitment_id'],
  agree_and_fund: ['reuse_nonce'],
  early_accept: ['reuse_nonce'],
  judge: ['reuse_nonce', 'wrong_seed', 'wrong_policy_hash', 'wrong_registry_hash', 'wrong_attempt', 'buyer_key'],
};

/** A step, which of the scenario's commitments it acts on (1 when absent), and any deliberate message faults. */
export type Step = StepBody & { commitment?: number; tamper?: Tamper[] };
/** A scenario drives at most this many commitments. */
export const MAX_COMMITMENTS = 4;

// `signer` names a different actor whose key signs the step's messages (an impersonation attempt);
// the settlement must refuse it with invalid_signature.

export interface Scenario {
  name: string;
  description?: string;
  pragmas: Pragmas;
  club?: string;
  terms?: string;
  /** ADR-0033: `buyerPayment` funds the hold and is refunded, `sellerPayout` is paid; each defaults to its party. */
  parties: { buyer: string; seller: string; buyerPayment?: string; sellerPayout?: string };
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
export const RESERVED_NAMES: readonly string[] = ['escrow', 'appeal-hold', 'anyone', 'direct', 'faucet'];

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
  'restart_adjudicators',
  'trigger_fallback',
  'trigger_default',
  'apply_default_outcome',
  'expire',
  'expire_appeal',
  'early_accept',
  'appeal',
  'mutual_settle',
];

/** Steps the scenario index names that need settlement support this build does not have. */
const UNSUPPORTED: Record<string, string> = {
  dispute: 'a dispute belongs to optimistic mode (settle_after_window, D19, Phase 4); SimChain accepts no Dispute submission yet',
  revoke_member: 'SimChain has no member revocation: club membership is fixed at genesis (needs a settlement submission; see the T-016 Handoff)',
  revoke_mandate: 'SimChain has no mandate revocation: mandates are fixed at genesis (needs a settlement submission; see the T-016 Handoff)',
};

/** Steps that do not act on a commitment, so `commitment:` makes no sense on them. */
const NO_COMMITMENT = ['advance_clock', 'offline', 'operator_refuses', 'restart_adjudicators'];

function parseStep(raw: unknown, path: string, operators: readonly string[], actors: readonly string[]): Step {
  if (!isObj(raw) || Object.keys(raw).length !== 1) fail(path, 'each step is a mapping with exactly one key, e.g. "- offer: { by: seller }"');
  const [kind, rawBody] = Object.entries(raw)[0]!;
  const p = `${path}.${kind}`;
  if (kind in UNSUPPORTED) fail(path, `step "${kind}" is not supported: ${UNSUPPORTED[kind]}`);
  if (!isObj(rawBody) || !('commitment' in rawBody || 'tamper' in rawBody)) return parseStepBody(kind, rawBody, path, operators, actors);
  const extra: { commitment?: number; tamper?: Tamper[] } = {};
  if ('commitment' in rawBody) {
    if (NO_COMMITMENT.includes(kind)) fail(`${p}.commitment`, `${kind} does not act on a commitment`);
    const n = positiveInt(rawBody.commitment, `${p}.commitment`);
    if (n > MAX_COMMITMENTS) fail(`${p}.commitment`, `a scenario drives at most ${MAX_COMMITMENTS} commitments`);
    extra.commitment = n;
  }
  if ('tamper' in rawBody) {
    const allowed = TAMPERABLE[kind] ?? [];
    if (!allowed.length) fail(`${p}.tamper`, `${kind} signs nothing that can be tampered with`);
    const list = Array.isArray(rawBody.tamper) ? rawBody.tamper : [rawBody.tamper];
    if (!list.length) fail(`${p}.tamper`, 'needs at least one fault');
    extra.tamper = list.map((t, i) => literal(t, `${p}.tamper[${i}]`, allowed));
  }
  const rest = { ...rawBody };
  delete rest.commitment;
  delete rest.tamper;
  return { ...parseStepBody(kind, Object.keys(rest).length ? rest : undefined, path, operators, actors), ...extra };
}

function parseStepBody(kind: string, body: unknown, path: string, operators: readonly string[], actors: readonly string[]): StepBody {
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
      const o = object(body, p, ['by', 'via', 'file', 'signer', 'stub_bytes', 'attempt', 'buyer_envelope'], ['by', 'file']);
      const file = str(o.file, `${p}.file`);
      if (file.startsWith('/') || file.split('/').includes('..')) fail(`${p}.file`, 'must be a path relative to fixtures/ without ".."');
      if (o.stub_bytes !== undefined && o.stub_bytes !== true) fail(`${p}.stub_bytes`, 'must be true when present');
      return {
        kind,
        by: literal(o.by, `${p}.by`, ['seller'] as const),
        via: via(o),
        file,
        ...signer(o),
        ...(o.stub_bytes === true ? { stubBytes: true as const } : {}),
        ...(o.attempt !== undefined ? { attempt: positiveInt(o.attempt, `${p}.attempt`) } : {}),
        ...(o.buyer_envelope !== undefined ? { buyerEnvelope: literal(o.buyer_envelope, `${p}.buyer_envelope`, ['wrong_key'] as const) } : {}),
      };
    }
    case 'early_accept': {
      const o = object(body, p, ['by', 'via', 'signer', 'opened'], ['by']);
      let opened: string | undefined;
      if (o.opened !== undefined) {
        opened = str(o.opened, `${p}.opened`);
        if (opened.startsWith('/') || opened.split('/').includes('..')) fail(`${p}.opened`, 'must be a path relative to fixtures/ without ".."');
      }
      return { kind, by: literal(o.by, `${p}.by`, ['buyer'] as const), via: via(o), ...signer(o), ...(opened !== undefined ? { opened } : {}) };
    }
    case 'appeal': {
      const o = object(body, p, ['by', 'via', 'grounds', 'bond', 'signer'], ['by']);
      return {
        kind,
        by: literal(o.by, `${p}.by`, ['buyer', 'seller'] as const),
        via: via(o),
        grounds: o.grounds === undefined ? 'wrong-outcome' : str(o.grounds, `${p}.grounds`),
        ...(o.bond !== undefined ? { bond: money(o.bond, `${p}.bond`) } : {}),
        ...signer(o),
      };
    }
    case 'mutual_settle': {
      const o = object(body, p, ['via', 'payouts', 'release_key', 'signer', 'carry', 'names'], ['payouts']);
      const payouts = moneyMap(o.payouts, `${p}.payouts`);
      for (const who of Object.keys(payouts)) if (!actors.includes(who)) fail(`${p}.payouts.${who}`, 'not a party, adjudicator or operator of this scenario');
      if (Object.keys(payouts).length === 0) fail(`${p}.payouts`, 'needs at least one payout');
      if (o.release_key !== undefined && typeof o.release_key !== 'boolean') fail(`${p}.release_key`, 'must be true or false');
      const file = (k: 'carry' | 'names'): { carry?: string } | { names?: string } => {
        if (o[k] === undefined) return {};
        const f = str(o[k], `${p}.${k}`);
        if (f.startsWith('/') || f.split('/').includes('..')) fail(`${p}.${k}`, 'must be a path relative to fixtures/ without ".."');
        return { [k]: f };
      };
      if (o.names !== undefined && o.carry === undefined) fail(`${p}.names`, 'names needs carry: it names another delivery than the one carried');
      return { kind, via: via(o), payouts, releaseKey: o.release_key === true, ...signer(o), ...file('carry'), ...file('names') };
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
    case 'restart_adjudicators': {
      const o = object(body, p, ['screen', 'registry']);
      if (!('screen' in o) && !('registry' in o)) fail(p, 'name the new default: screen, registry or both');
      const registry = 'registry' in o ? str(o.registry, `${p}.registry`) : undefined;
      if (registry !== undefined && !/^config\/[a-z0-9-]+\.yaml$/.test(registry)) fail(`${p}.registry`, `must be a registry file under config/, e.g. config/judges-live.yaml; got ${JSON.stringify(registry)}`);
      return { kind, ...('screen' in o ? { screenVersion: name(o.screen, `${p}.screen`) } : {}), ...(registry ? { registry } : {}) };
    }
    case 'trigger_fallback':
    case 'trigger_default':
    case 'apply_default_outcome':
    case 'expire':
    case 'expire_appeal': {
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
  const partiesObj = object(top.parties, 'parties', ['buyer', 'seller', 'buyer_payment', 'seller_payout'], ['buyer', 'seller']);
  const adjObj = object(top.adjudicators, 'adjudicators', ['primary', 'fallback', 'appeal'], ['primary', 'fallback', 'appeal']);
  const operators = top.operators === undefined ? [] : Array.isArray(top.operators) ? top.operators.map((o, i) => name(o, `operators[${i}]`)) : fail('operators', 'must be a list');
  if (!Array.isArray(top.steps)) fail('steps', 'must be a list');
  const parties = {
    buyer: name(partiesObj.buyer, 'parties.buyer'),
    seller: name(partiesObj.seller, 'parties.seller'),
    ...(partiesObj.buyer_payment !== undefined ? { buyerPayment: name(partiesObj.buyer_payment, 'parties.buyer_payment') } : {}),
    ...(partiesObj.seller_payout !== undefined ? { sellerPayout: name(partiesObj.seller_payout, 'parties.seller_payout') } : {}),
  };
  const adjudicators = {
    primary: name(adjObj.primary, 'adjudicators.primary'),
    fallback: name(adjObj.fallback, 'adjudicators.fallback'),
    appeal: name(adjObj.appeal, 'adjudicators.appeal'),
  };
  const money = [parties.buyerPayment, parties.sellerPayout].filter((n): n is string => n !== undefined);
  const actors = [parties.buyer, parties.seller, ...money, ...Object.values(adjudicators), ...operators];
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
