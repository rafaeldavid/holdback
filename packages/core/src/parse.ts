// Boundary parsers: validate unknown JSON against the real files in spec/schemas, then return typed
// values. Code past the boundary trusts the types, so anything a parser accepts must be safe for the
// rest of core: it can be EIP-712 encoded, stays within uint256, and never makes step or offer throw.
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isAddress } from 'viem';
import { tokenAmount } from './money/index.js';
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
  EncryptedKey,
  JudgeVerdict,
  Judgment,
  Mandate,
  Message,
  OperatorStatus,
  Page,
  Receipt,
  SettlementEvent,
} from './types.js';

/** The schema annotation on party-authored strings: content to read, never instructions (ADR-0017 §9). */
export const UNTRUSTED = 'x-holdback-untrusted';

// Resolves to <repo>/spec/schemas from both src/ and dist/.
const schemaDir = new URL('../../../spec/schemas/', import.meta.url);
const schemas = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.schema.json'))
  .map((file) => ({ name: file.replace('.schema.json', ''), schema: JSON.parse(readFileSync(new URL(file, schemaDir), 'utf8')) as { $id: string } }));

// Signed values are encoded as uint64 Unix seconds, so a signed timestamp must be an exact RFC 3339
// instant in whole seconds, at or after 1970, that Date can represent. The schema's date-time is wider.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function signedTimestamp(s: string): boolean {
  const ms = Date.parse(s);
  return RFC3339.test(s) && Number.isFinite(ms) && ms >= 0 && ms % 1000 === 0;
}

// Two Ajv instances: one where date-time means a signable timestamp (for everything an agent signs),
// one with the schema's ordinary date-time (event log, read model, judgment record, registrations).
// allErrors stays off: input is untrusted, and the first error is enough to refuse it.
// Everything compiles at import, on purpose: a Cloudflare Worker may generate code only at startup, never in a
// request (T-029 measured "Code generation from strings disallowed" when compiling lazily). To keep that startup
// within the Worker's CPU limit, the schemas are not re-validated against the 2020-12 meta-schema here (which
// compiled the large meta-schema once per instance); `pnpm validate:spec` checks them, in strict mode, in CI.
function compile(signed: boolean): Map<string, ReturnType<InstanceType<typeof Ajv2020.default>['compile']>> {
  // ajv and ajv-formats are CommonJS; under NodeNext their default export arrives as `.default`.
  const ajv = new Ajv2020.default({ strict: true, allErrors: false, validateSchema: false, code: { optimize: false } });
  // ADR-0017 §9: marks party-authored strings for consumers; it changes no validation.
  ajv.addKeyword({ keyword: UNTRUSTED, schemaType: 'boolean' });
  if (signed) {
    addFormats.default(ajv, ['uri']);
    ajv.addFormat('date-time', signedTimestamp);
  } else {
    addFormats.default(ajv);
  }
  for (const { schema } of schemas) ajv.addSchema(schema);
  const validators = new Map<string, ReturnType<typeof ajv.compile>>();
  for (const { name, schema } of schemas) validators.set(name, ajv.getSchema(schema.$id)!);
  return validators;
}

const signedValidators = compile(true);
const plainValidators = compile(false);

const UINT32_MAX = 2 ** 32 - 1;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Checks every schema leaves open: amounts within uint256, integers exact, addresses with valid checksums. */
function walk(value: unknown, signed: boolean, path = ''): string | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && !Number.isSafeInteger(value) ? `${path || '/'} is not an exact integer` : undefined;
  }
  if (typeof value === 'string') {
    // Mixed-case addresses are EIP-55 checksums; viem refuses to encode a wrong one.
    return signed && ADDRESS.test(value) && !isAddress(value, { strict: true }) ? `${path || '/'} has an invalid address checksum` : undefined;
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const bad = walk(v, signed, `${path}/${i}`);
      if (bad) return bad;
    }
    return undefined;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    const keys = entries.map(([k]) => k).sort();
    if (keys.length === 2 && keys[0] === 'amount' && keys[1] === 'token') {
      const { token, amount } = value as { token: string; amount: string };
      if (!tokenAmount(token, amount).ok) return `${path}/amount ${amount} is not a uint256 base-units amount`;
    }
    for (const [k, v] of entries) {
      const bad = walk(v, signed, `${path}/${k}`);
      if (bad) return bad;
    }
  }
  return undefined;
}

type Parser<T> = (json: unknown) => Result<T, Problem>;

function parserFor<T>(name: string, signed: boolean, extra?: (value: T) => string | undefined): Parser<T> {
  const validate = (signed ? signedValidators : plainValidators).get(name);
  if (!validate) throw new Error(`spec/schemas/${name}.schema.json not found`);
  return (json) => {
    // Validate and return a private copy, so the caller cannot change the value after it was checked.
    let copy: unknown;
    try {
      copy = structuredClone(json);
    } catch {
      return err(problem('invalid_terms', `${name}: not JSON data`));
    }
    if (!validate(copy)) {
      const e = validate.errors?.[0];
      return err(problem('invalid_terms', `${name}: ${e ? `${e.instancePath || '/'} ${e.message ?? 'is invalid'}` : 'is invalid'}`));
    }
    const refusal = walk(copy, signed) ?? extra?.(copy as T);
    return refusal === undefined ? ok(copy as T) : err(problem('invalid_terms', `${name}: ${refusal}`));
  };
}

function commitmentRules(c: Commitment): string | undefined {
  // The schema admits both modes and up to three submissions; Phase 1 admits only these (ADR-0007).
  const mode: string = c.settlement.mode;
  const max: number = c.timing.maxSubmissions;
  if (mode !== 'guaranteed_on_decision') return `settlement.mode ${mode} is not supported in Phase 1 (guaranteed_on_decision only)`;
  if (max !== 1) return `timing.maxSubmissions ${max} is not supported in Phase 1 (1 only)`;
  // Window lengths are added to deadlines; uint32 seconds (136 years) keeps every derived deadline representable.
  for (const key of ['appealWindowSec', 'appealDecideSec'] as const) {
    if (c.timing[key] > UINT32_MAX) return `timing.${key} ${c.timing[key]} exceeds ${UINT32_MAX}`;
  }
  if (!(Date.parse(c.createdAt) < Date.parse(c.timing.offerExpiresAt))) return 'createdAt must be before timing.offerExpiresAt';
  // ADR-0020: Phase 1 commitments are public; private bodies arrive with Phase 2 reads.
  const level: string = c.disclosure.level;
  if (level !== 'public') return `disclosure.level ${level} is not supported in Phase 1 (public only)`;
  if ('privateTerms' in c) return 'privateTerms is not supported in Phase 1';
  return undefined;
}

/** ADR-0020: Phase 1 releases keys at once; beacon-round unlocks need a timelock that is not built yet. */
function unlockRule(keys: readonly EncryptedKey[] | undefined): string | undefined {
  const timed = keys?.find((k) => k.unlock?.kind === 'beacon-round');
  return timed ? `key for ${timed.recipient} unlocks at a beacon round, which is not supported in Phase 1 (none only)` : undefined;
}

function clubRules(c: Club): string | undefined {
  const source: string = c.rulebook.randomness.source;
  if (source !== 'sim') return `rulebook.randomness.source ${source} is not supported in Phase 1 (sim only)`;
  const other = c.rulebook.identityModes.find((m) => m !== 'long-term');
  if (other) return `rulebook.identityModes ${other} is not supported in Phase 1 (long-term only)`;
  // ADR-0019: the kill fee to the sitting adjudicator is a later option; Phase 1 pays none.
  const share = c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps;
  if (share !== 0) return `rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps ${share} must be 0 in Phase 1`;
  return undefined;
}

function messageRules(m: Message): string | undefined {
  if ((m.type === 'EarlyAccept' || m.type === 'Decision' || m.type === 'Dispute') && m.attempt > 255) return `attempt ${m.attempt} exceeds uint8`;
  // value is signed as uint256; one canonical decimal form per amount.
  // ADR-0018: Phase 1 admits only the SimChain beacon, which is a settlement-layer fact, not a proof.
  if (m.type === 'Decision' && m.beacon && m.beacon.source !== 'sim') return `beacon source ${m.beacon.source} is not supported in Phase 1 (sim only)`;
  // ADR-0020: Phase 1 commitments are public, so the only level a Publish can name is public.
  if (m.type === 'Publish' && m.level !== 'public') return `Publish level ${m.level} is not supported in Phase 1 (public only)`;
  if (m.type === 'Decision' || m.type === 'Dispute') {
    const timed = unlockRule(m.encryptedKeys);
    if (timed) return timed;
  }
  if ((m.type === 'FundingAuthorization' || m.type === 'TransferAuthorization') && !tokenAmount(m.token, m.value).ok) return `value ${m.value} is not a canonical uint256 decimal`;
  if (m.type === 'MutualSettlement') {
    // D23: payouts may name any address, but each recipient once and all in one token. Sum and token
    // against the price are checked with the terms (mutualSettlementProblem).
    const seen = new Set<string>();
    for (const p of m.payouts) {
      const to = p.to.toLowerCase();
      if (seen.has(to)) return `payout recipient ${p.to} appears more than once`;
      seen.add(to);
    }
    if (new Set(m.payouts.map((p) => p.amount.token)).size > 1) return 'payouts must all be in one token';
  }
  return undefined;
}

/** ADR-0022: a supermajority is an exact fraction strictly above one half and at most one. */
function adjudicatorRules(a: AdjudicatorRegistration): string | undefined {
  for (const key of ['acceptSupermajority', 'rejectSupermajority'] as const) {
    const { numerator: n, denominator: d } = a.policy[key];
    if (n > d) return `policy.${key} ${n}/${d} is above one`;
    if (2 * n <= d) return `policy.${key} ${n}/${d} is not more than one half`;
  }
  return undefined;
}

export const parseAdjudicator = parserFor<AdjudicatorRegistration>('adjudicator', false, adjudicatorRules);
export const parseAgent = parserFor<AgentRegistration>('agent', true);
export const parseAppeal = parserFor<Appeal>('appeal', true);
export const parseClub = parserFor<Club>('club', false, clubRules);
export const parseCommitmentState = parserFor<CommitmentStateView>('commitment-state', false);
export const parseCommitment = parserFor<Commitment>('commitment', true, commitmentRules);
export const parseDelivery = parserFor<Delivery>('delivery', true, (d) => unlockRule(d.encryptedKeys));
export const parseEvent = parserFor<SettlementEvent>('event', false);
export const parseJudgeVerdict = parserFor<JudgeVerdict>('judge-verdict', false);
export const parseJudgment = parserFor<Judgment>('judgment', false, (j) =>
  // ADR-0020: private records arrive with Phase 2 reads.
  'privateRecord' in j ? 'privateRecord is not supported in Phase 1' : undefined,
);
export const parseMandate = parserFor<Mandate>('mandate', true);
export const parseMessage = parserFor<Message>('messages', true, messageRules);
export const parseOperatorStatus = parserFor<OperatorStatus>('operator-status', false);
export const parsePage = parserFor<Page>('page', false);
export const parseReceipt = parserFor<Receipt>('receipt', true);

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
  'operator-status': parseOperatorStatus,
  page: parsePage,
  receipt: parseReceipt,
} as const;
