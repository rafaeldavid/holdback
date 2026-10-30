// Boundary parsers: validate unknown JSON against the real files in spec/schemas, then return typed
// values. Code past the boundary trusts the types.
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { problem, type Problem } from './problem.js';
import { err, ok, type Result } from './result.js';
import type {
  AdjudicatorRegistration,
  AgentRegistration,
  Appeal,
  Club,
  Commitment,
  CommitmentStateView,
  Delivery,
  JudgeVerdict,
  Judgment,
  Mandate,
  SettlementEvent,
  SignedMessage,
} from './types.js';

// Resolves to <repo>/spec/schemas from both src/ and dist/.
const schemaDir = new URL('../../../spec/schemas/', import.meta.url);

// ajv and ajv-formats are CommonJS; under NodeNext their default export arrives as `.default`.
const ajv = new Ajv2020.default({ strict: true, allErrors: true });
addFormats.default(ajv);

const ids = new Map<string, string>();
for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'))) {
  const schema = JSON.parse(readFileSync(new URL(file, schemaDir), 'utf8')) as { $id: string };
  ajv.addSchema(schema);
  ids.set(file.replace('.schema.json', ''), schema.$id);
}

type Parser<T> = (json: unknown) => Result<T, Problem>;

function parserFor<T>(name: string, extra?: (value: T) => string | undefined): Parser<T> {
  const id = ids.get(name);
  const validate = id === undefined ? undefined : ajv.getSchema(id);
  if (!validate) throw new Error(`spec/schemas/${name}.schema.json not found`);
  return (json) => {
    if (!validate(json)) {
      const detail = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`).join('; ');
      return err(problem('invalid_terms', `${name}: ${detail}`));
    }
    const value = json as T;
    const refusal = extra?.(value);
    return refusal === undefined ? ok(value) : err(problem('invalid_terms', `${name}: ${refusal}`));
  };
}

// The schema admits both modes and up to three submissions; Phase 1 admits only these (ADR-0007).
function phase1(c: Commitment): string | undefined {
  const mode: string = c.settlement.mode;
  const max: number = c.timing.maxSubmissions;
  if (mode !== 'guaranteed_on_decision') return `settlement.mode ${mode} is not supported in Phase 1 (guaranteed_on_decision only)`;
  if (max !== 1) return `timing.maxSubmissions ${max} is not supported in Phase 1 (1 only)`;
  return undefined;
}

export const parseAdjudicator = parserFor<AdjudicatorRegistration>('adjudicator');
export const parseAgent = parserFor<AgentRegistration>('agent');
export const parseAppeal = parserFor<Appeal>('appeal');
export const parseClub = parserFor<Club>('club');
export const parseCommitmentState = parserFor<CommitmentStateView>('commitment-state');
export const parseCommitment = parserFor<Commitment>('commitment', phase1);
export const parseDelivery = parserFor<Delivery>('delivery');
export const parseEvent = parserFor<SettlementEvent>('event');
export const parseJudgeVerdict = parserFor<JudgeVerdict>('judge-verdict');
export const parseJudgment = parserFor<Judgment>('judgment');
export const parseMandate = parserFor<Mandate>('mandate');
export const parseMessage = parserFor<SignedMessage>('messages');

/** One parser per schema file, keyed by the file's name. */
export const parsers = {
  adjudicator: parseAdjudicator,
  agent: parseAgent,
  appeal: parseAppeal,
  club: parseClub,
  'commitment-state': parseCommitmentState,
  commitment: parseCommitment,
  delivery: parseDelivery,
  event: parseEvent,
  'judge-verdict': parseJudgeVerdict,
  judgment: parseJudgment,
  mandate: parseMandate,
  messages: parseMessage,
} as const;
