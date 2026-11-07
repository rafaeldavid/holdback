// Boundary parsers: validate unknown JSON against the real files in spec/schemas, then return typed
// values. Code past the boundary trusts the types, so anything a parser accepts must be safe for the
// rest of core: it can be EIP-712 encoded, stays within uint256, and never makes step or offer throw.
// The validators are compiled from spec/schemas ahead of time (validators.ts, T-233), so importing core
// generates no code: a Cloudflare Worker may generate none inside a request (T-029), and compiling at
// import took most of the Worker's start-up, which Cloudflare limits to 1 s of CPU.
import { isAddress, sha256 } from 'viem';
import { DRAND_QUICKNET_CHAIN_HASH } from './beacon.js';
import { tokenAmount } from './money/index.js';
import { problem, type Problem } from './problem.js';
import { err, ok, type Result } from './result.js';
import { plainValidators, signedValidators } from './validators.js';
import type {
  AdjudicatorRegistration,
  AgentRegistration,
  AnyCommitment,
  Appeal,
  Club,
  Commitment,
  CommitmentStateView,
  Decision,
  Delivery,
  DisclosureBody,
  SealedCommitment,
  SettlementProjection,
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
// ADR-0017 §9: marks party-authored strings for consumers; it changes no validation.
export const UNTRUSTED = 'x-holdback-untrusted';

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
  const validators = signed ? signedValidators : plainValidators;
  const validate = Object.hasOwn(validators, name) ? validators[name] : undefined;
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

function commitmentRules(c: AnyCommitment): string | undefined {
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
  // ADR-0024: private and judgment carry the bodies as privateTerms (the schema requires the form per level). Body keys
  // that unlock at a beacon round wait for the time-lock slice, as delivery keys do.
  const sealed = (c as Partial<SealedCommitment>).privateTerms;
  if (sealed) return unlockRule([...sealed.deliverable.envelopes, ...sealed.acceptance.envelopes]);
  return undefined;
}

/** ADR-0020: Phase 1 releases keys at once; beacon-round unlocks need a timelock that is not built yet. */
function unlockRule(keys: readonly EncryptedKey[] | undefined): string | undefined {
  const timed = keys?.find((k) => k.unlock?.kind === 'beacon-round');
  return timed ? `key for ${timed.recipient} unlocks at a beacon round, which is not supported in Phase 1 (none only)` : undefined;
}

function clubRules(c: Club): string | undefined {
  // ADR-0018 §6, T-217: sim for SimChain and local chains, drand-quicknet where the rules contract's DrandQuicknetBeacon
  // verifies it. A rulebook names a network by its chain hash, and the verifier holds quicknet's key only.
  const { source, chainHash } = c.rulebook.randomness;
  if (source !== 'sim' && source !== 'drand-quicknet') return `rulebook.randomness.source ${source} has no beacon verifier (sim or drand-quicknet)`;
  if (source === 'drand-quicknet' && chainHash !== DRAND_QUICKNET_CHAIN_HASH) return `rulebook.randomness.chainHash ${chainHash} is not the drand quicknet chain hash ${DRAND_QUICKNET_CHAIN_HASH}`;
  // ADR-0024 §7: pseudonymous (per-deal keys with a Delegation certificate) is admitted from schema v0.8.
  // ADR-0019: the kill fee to the sitting adjudicator is a later option; Phase 1 pays none.
  const share = c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps;
  if (share !== 0) return `rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps ${share} must be 0 in Phase 1`;
  return undefined;
}

/**
 * ADR-0018, T-217: the SimChain beacon is a settlement-layer fact, not a proof. A drand quicknet round carries its
 * 48-byte G1 signature, whose sha256 is the value. Refused here: what no settlement could accept. The pairing itself is
 * checked by the adjudicator before it signs and by the rules contract, not by this parser.
 */
function beaconRule(b: NonNullable<Decision['beacon']>): string | undefined {
  if (b.source === 'sim') return undefined;
  if (b.source !== 'drand-quicknet') return `beacon source ${b.source} has no beacon verifier (sim or drand-quicknet)`;
  if (b.round === 0) return 'beacon round 0 does not exist on drand quicknet (round 1 is its genesis)';
  const bytes = b.signature ? (b.signature.length - 2) / 2 : 0;
  if (bytes !== 48) return `a drand quicknet beacon carries a 48-byte signature, not ${bytes} bytes`;
  if (sha256(b.signature as `0x${string}`) !== b.value) return 'beacon value is not sha256 of the signature';
  return undefined;
}

function messageRules(m: Message): string | undefined {
  if ((m.type === 'EarlyAccept' || m.type === 'Decision' || m.type === 'Dispute') && m.attempt > 255) return `attempt ${m.attempt} exceeds uint8`;
  // value is signed as uint256; one canonical decimal form per amount.
  if (m.type === 'Decision' && m.beacon) {
    const beacon = beaconRule(m.beacon);
    if (beacon) return beacon;
  }
  // ADR-0024: a Publish may name judgment or public; raising only is checked against the current level by its reader.
  if (m.type === 'Publish' && m.level === 'private') return 'a Publish raises the level, so it names judgment or public';
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
/** Either wire form (ADR-0024): plaintext bodies at public, privateTerms at private and judgment. */
export const parseAnyCommitment = parserFor<AnyCommitment>('commitment', true, commitmentRules);
/** The plaintext form only: refuses a sealed commitment, for callers that read the bodies. */
export const parseCommitment: Parser<Commitment> = (json) => {
  const r = parseAnyCommitment(json);
  if (r.ok && 'privateTerms' in r.value) return err(problem('invalid_terms', 'commitment: this reader needs the plaintext bodies; open privateTerms first (ADR-0024)'));
  return r as Result<Commitment, Problem>;
};
export const parseDisclosure = parserFor<DisclosureBody>('disclosure', true);
export const parseProjection = parserFor<SettlementProjection>('projection', false);
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
  commitment: parseAnyCommitment,
  delivery: parseDelivery,
  disclosure: parseDisclosure,
  projection: parseProjection,
  event: parseEvent,
  'judge-verdict': parseJudgeVerdict,
  judgment: parseJudgment,
  mandate: parseMandate,
  messages: parseMessage,
  'operator-status': parseOperatorStatus,
  page: parsePage,
  receipt: parseReceipt,
} as const;
