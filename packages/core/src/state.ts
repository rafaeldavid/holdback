// The commitment state machine (docs/architecture.md, ADR-0016) as a pure function.
//
// - The escrow state says where the money is; each variant carries only the fields valid in it.
// - The appeal state exists only inside a Released or Refunded reached by a first-instance decision,
//   so "a decision reached through escalation is not appealable" holds by construction.
// - Signatures are verified before step (eip712.ts). Step checks that the signer field names the
//   party whose turn it is. Guards that need outside data (scopes, balances, bond, membership, nonce
//   use) take it as facts on the event, supplied by the settlement layer.
// - Time: an action is on time iff at < deadline; a timeout fires iff at >= deadline. Both comparisons
//   are false for an unparseable time, so a bad clock refuses instead of firing a timeout, and step
//   refuses an unparseable event time outright.
import { keccak256 } from 'viem';
import { rulebookHash } from './canonical.js';
import { commitmentId, termsOf } from './eip712.js';
import { add, gte, tokenAmount, type MoneyError } from './money/index.js';
import { problem, type Problem, type ProblemType } from './problem.js';
import { err, ok, type Result } from './result.js';
import { addSeconds, validateTiming } from './timing.js';
import type {
  AdjudicatorAcceptance,
  Agree,
  Appeal,
  Commitment,
  CommitmentTerms,
  Decision,
  Delivery,
  EarlyAccept,
  FundingAuthorization,
  Hex32,
  Rulebook,
  Scope,
  Signature,
  Timestamp,
  TokenAmount,
} from './types.js';

export interface Hold {
  /** price + fee */
  amount: TokenAmount;
  funding: FundingAuthorization;
  heldAt: Timestamp;
}

export type AppealState =
  | { kind: 'none'; appealBy: Timestamp; appealDecideBy: Timestamp }
  | { kind: 'open'; appeal: Appeal; appealDecideBy: Timestamp }
  | { kind: 'upheld'; appeal: Appeal; decision: Decision }
  | { kind: 'overturned'; appeal: Appeal; decision: Decision }
  | { kind: 'expired'; appeal: Appeal | null };

export interface FirstInstance {
  kind: 'first_instance';
  role: 'primary' | 'fallback';
  decision: Decision;
  appeal: AppealState;
}

export type ReleaseVia = FirstInstance | { kind: 'early_accept'; earlyAccept: EarlyAccept } | { kind: 'escalation'; decision: Decision };

export type RefundVia =
  | FirstInstance
  | { kind: 'reclaim' }
  | { kind: 'escalation'; decision: Decision }
  | { kind: 'default_outcome'; from: 'FallbackJudging' | 'Escalated' };

interface Base {
  id: Hex32;
  terms: CommitmentTerms;
}

interface Funded extends Base {
  acceptance: AdjudicatorAcceptance;
  hold: Hold;
}

export type EscrowState =
  | (Base & { kind: 'Offered'; sellerSignature: Signature })
  | (Base & { kind: 'AcceptedByAdjudicator'; sellerSignature: Signature; acceptance: AdjudicatorAcceptance })
  | (Base & { kind: 'Agreed'; acceptance: AdjudicatorAcceptance; agree: Agree })
  | (Funded & { kind: 'Held' })
  | (Funded & { kind: 'Delivered'; delivery: Delivery })
  | (Funded & { kind: 'FallbackJudging'; delivery: Delivery; fallbackSince: Timestamp })
  | (Funded & { kind: 'Escalated'; delivery: Delivery; escalation: { by: 'primary' | 'fallback'; at: Timestamp; appealDecideBy: Timestamp } })
  | (Funded & { kind: 'Defaulted'; from: 'FallbackJudging' | 'Escalated'; defaultedAt: Timestamp })
  | (Base & { kind: 'Released'; settledAt: Timestamp; via: ReleaseVia })
  | (Base & { kind: 'Refunded'; settledAt: Timestamp; via: RefundVia })
  | (Base & { kind: 'Expired'; from: 'Offered' | 'AcceptedByAdjudicator' | 'Agreed'; expiredAt: Timestamp });

/** Offer: the seller's signed terms, plus the facts the guards need. */
export interface OfferInput {
  commitment: Commitment;
  at: Timestamp;
  sellerScope: Scope;
  /** The rulebook registered under terms.rulebookHash, or null when none is. */
  rulebook: Rulebook | null;
  nonceUsed: boolean;
}

export type EscrowEvent =
  | { type: 'adjudicator_accept'; at: Timestamp; message: AdjudicatorAcceptance; unencumberedBond: TokenAmount }
  | { type: 'agree'; at: Timestamp; message: Agree; buyerScope: Scope; spentToday: TokenAmount; memberAdmitted: boolean }
  // The mandate is checked again at funding (docs/architecture.md, Identity and signing).
  | { type: 'fund'; at: Timestamp; message: FundingAuthorization; buyerScope: Scope; balance: TokenAmount; gasBuffer: TokenAmount }
  | { type: 'deliver'; at: Timestamp; delivery: Delivery }
  | { type: 'early_accept'; at: Timestamp; message: EarlyAccept }
  | { type: 'decide'; at: Timestamp; message: Decision }
  // requiredBond is price x the rulebook appealBondRate and requiredFee the rulebook appealFee, both
  // computed by the caller; feePaid is the appeal-fee authorization that accompanies the appeal.
  | { type: 'file_appeal'; at: Timestamp; appeal: Appeal; requiredBond: TokenAmount; requiredFee: TokenAmount; feePaid: TokenAmount }
  // Permissionless timeouts: anyone may trigger them.
  | { type: 'expire'; at: Timestamp }
  | { type: 'reclaim'; at: Timestamp }
  | { type: 'trigger_fallback'; at: Timestamp }
  | { type: 'trigger_default'; at: Timestamp }
  | { type: 'apply_default_outcome'; at: Timestamp }
  | { type: 'expire_appeal'; at: Timestamp };

type R<T = EscrowState> = Result<T, Problem>;

const ms = (ts: Timestamp): number => Date.parse(ts);
const before = (at: Timestamp, deadline: Timestamp): boolean => ms(at) < ms(deadline);
const reached = (at: Timestamp, deadline: Timestamp): boolean => ms(at) >= ms(deadline);
const validTime = (at: Timestamp): boolean => Number.isFinite(ms(at));
const fail = (type: ProblemType, detail: string): R<never> => err(problem(type, detail));
const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function money<T>(r: Result<T, MoneyError>, what: string): R<T> {
  return r.ok ? r : fail('invalid_terms', `${what}: ${r.error.kind}`);
}

function scopeAllows(scope: Scope, role: 'buyer' | 'seller', price: TokenAmount, at: Timestamp): R<true> {
  if (!before(at, scope.expiresAt)) return fail('mandate_expired', `the ${role}'s mandate expired at ${scope.expiresAt}`);
  if (!scope.roles.includes(role)) return fail('scope_exceeded', `scope does not allow the ${role} role`);
  const cap = money(gte(scope.maxPerCommitment, price), 'per-commitment cap');
  if (!cap.ok) return cap;
  if (!cap.value) return fail('scope_exceeded', `price ${price.amount} exceeds the per-commitment cap ${scope.maxPerCommitment.amount}`);
  return ok(true);
}

function messageLive(m: { expiresAt: Timestamp }, at: Timestamp): R<true> {
  return before(at, m.expiresAt) ? ok(true) : fail('deadline_passed', `message expired at ${m.expiresAt}`);
}

export function offer(input: OfferInput): R<Extract<EscrowState, { kind: 'Offered' }>> {
  const { commitment, at, rulebook } = input;
  if (!validTime(at)) return fail('invalid_terms', `offer time ${at} is not a timestamp`);
  const terms = termsOf(commitment);
  if (commitment.id !== commitmentId(terms)) return fail('invalid_terms', 'id is not the struct hash of the terms');
  if (rulebook === null) return fail('rulebook_unknown', `no rulebook registered for ${terms.rulebookHash}`);
  if (rulebookHash(rulebook) !== terms.rulebookHash) return fail('rulebook_unknown', 'the rulebook supplied does not hash to terms.rulebookHash');
  if (input.nonceUsed) return fail('nonce_reused', `nonce ${terms.nonce} was used before`);
  if (!before(at, terms.timing.offerExpiresAt)) return fail('deadline_passed', `offer expired at ${terms.timing.offerExpiresAt}`);
  const scope = scopeAllows(input.sellerScope, 'seller', terms.price, at);
  if (!scope.ok) return scope;

  const timing = validateTiming(terms.timing, rulebook);
  if (!timing.ok) return timing;
  if (!rulebook.allowedSettlementModes.includes(terms.settlement.mode)) return fail('invalid_terms', `the rulebook does not allow ${terms.settlement.mode}`);
  if (terms.timing.maxSubmissions > rulebook.maxSubmissions) return fail('invalid_terms', 'maxSubmissions exceeds the rulebook maximum');
  for (const token of [terms.price.token, terms.adjudication.fee.token, terms.settlement.token]) {
    if (!rulebook.allowedTokens.includes(token)) return fail('invalid_terms', `the rulebook does not allow token ${token}`);
  }
  if (terms.adjudication.fee.token !== terms.price.token || terms.settlement.token !== terms.price.token) {
    return fail('invalid_terms', 'price, fee and settlement must use one token');
  }
  return ok({ kind: 'Offered', id: commitment.id, terms, sellerSignature: commitment.signatures.seller });
}

function adjudicatorAccept(s: Extract<EscrowState, { kind: 'Offered' }>, e: Extract<EscrowEvent, { type: 'adjudicator_accept' }>): R {
  const m = e.message;
  const { adjudication, price, timing } = s.terms;
  if (!sameAddress(m.adjudicator, adjudication.adjudicator)) return fail('not_your_turn', 'only the primary adjudicator accepts');
  if (!before(e.at, timing.offerExpiresAt)) return fail('deadline_passed', `offer expired at ${timing.offerExpiresAt}`);
  const live = messageLive(m, e.at);
  if (!live.ok) return live;
  if (m.commitmentId !== s.id) return fail('acceptance_mismatch', 'acceptance is for another commitment');
  if (m.policyHash !== adjudication.policyHash) return fail('policy_mismatch', 'acceptance policyHash differs from the terms');
  if (m.registryHash !== adjudication.registryHash) return fail('registry_mismatch', 'acceptance registryHash differs from the terms');
  if (m.fee.token !== adjudication.fee.token || m.fee.amount !== adjudication.fee.amount) return fail('acceptance_mismatch', 'acceptance fee differs from the terms');
  // Guaranteed mode: the bond covers 100% of the price until appealDecideBy (ADR-0007).
  for (const [what, amount] of [
    ['bond reserved', m.bondReserved],
    ['unencumbered bond', e.unencumberedBond],
  ] as const) {
    const covered = money(gte(amount, price), what);
    if (!covered.ok) return covered;
    if (!covered.value) return fail('coverage_exceeded', `${what} ${amount.amount} is below the price ${price.amount}`);
  }
  return ok({ kind: 'AcceptedByAdjudicator', id: s.id, terms: s.terms, sellerSignature: s.sellerSignature, acceptance: m });
}

function agree(s: Extract<EscrowState, { kind: 'AcceptedByAdjudicator' }>, e: Extract<EscrowEvent, { type: 'agree' }>): R {
  const m = e.message;
  const { terms } = s;
  if (!sameAddress(m.buyer, terms.buyer)) return fail('invalid_signature', 'agreement is not from the buyer');
  if (m.commitmentId !== s.id) return fail('invalid_terms', 'buyer signed a different terms hash');
  if (!before(e.at, terms.timing.offerExpiresAt)) return fail('deadline_passed', `offer expired at ${terms.timing.offerExpiresAt}`);
  const live = messageLive(m, e.at);
  if (!live.ok) return live;
  const scope = scopeAllows(e.buyerScope, 'buyer', terms.price, e.at);
  if (!scope.ok) return scope;
  const today = money(add(e.spentToday, terms.price), 'daily spend');
  if (!today.ok) return today;
  const withinDaily = money(gte(e.buyerScope.maxDaily, today.value), 'daily cap');
  if (!withinDaily.ok) return withinDaily;
  if (!withinDaily.value) return fail('scope_exceeded', `daily spend ${today.value.amount} would exceed the cap ${e.buyerScope.maxDaily.amount}`);
  if (!e.memberAdmitted) return fail('member_not_admitted', 'the buyer principal is not an admitted member of the club');
  return ok({ kind: 'Agreed', id: s.id, terms, acceptance: s.acceptance, agree: m });
}

function fund(s: Extract<EscrowState, { kind: 'Agreed' }>, e: Extract<EscrowEvent, { type: 'fund' }>): R {
  const m = e.message;
  const { terms } = s;
  if (!sameAddress(m.from, terms.buyer)) return fail('invalid_signature', 'funding authorization is not from the buyer');
  if (m.commitmentId !== s.id) return fail('invalid_terms', 'funding authorization is for another commitment');
  if (!before(e.at, terms.timing.fundBy)) return fail('deadline_passed', `fundBy passed at ${terms.timing.fundBy}`);
  const live = messageLive(m, e.at);
  if (!live.ok) return live;
  if (!reached(e.at, m.validAfter) || !before(e.at, m.validBefore)) return fail('deadline_passed', 'outside the authorization validity window');
  const scope = scopeAllows(e.buyerScope, 'buyer', terms.price, e.at);
  if (!scope.ok) return scope;

  const total = money(add(terms.price, terms.adjudication.fee), 'price + fee');
  if (!total.ok) return total;
  const authorized = money(tokenAmount(m.token, m.value), 'authorized value');
  if (!authorized.ok) return authorized;
  const covers = money(gte(authorized.value, total.value), 'authorized value');
  if (!covers.ok) return covers;
  if (!covers.value) return fail('insufficient_funds', `authorization ${m.value} is below price + fee ${total.value.amount}`);
  const needed = money(add(total.value, e.gasBuffer), 'price + fee + gas buffer');
  if (!needed.ok) return needed;
  const funded = money(gte(e.balance, needed.value), 'balance');
  if (!funded.ok) return funded;
  if (!funded.value) return fail('insufficient_funds', `balance ${e.balance.amount} is below ${needed.value.amount}`);

  return ok({ kind: 'Held', id: s.id, terms, acceptance: s.acceptance, hold: { amount: total.value, funding: m, heldAt: e.at } });
}

function deliver(s: Extract<EscrowState, { kind: 'Held' }>, e: Extract<EscrowEvent, { type: 'deliver' }>): R {
  const d = e.delivery;
  const { terms } = s;
  if (d.commitmentId !== s.id) return fail('invalid_terms', 'delivery is for another commitment');
  if (!before(e.at, terms.timing.deliverBy)) return fail('deadline_passed', `deliverBy passed at ${terms.timing.deliverBy}`);
  if (d.attempt !== 1) return fail('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${terms.timing.maxSubmissions}`);
  // Every adjudicator who may have to judge must be able to read the work (ADR-0012, ADR-0016), and the
  // buyer's key must be there for early acceptance, which releases it with the payment (architecture.md
  // Two-sided hold, step 5). Checking at delivery means early acceptance can never strand the buyer.
  const { adjudicator, fallbackAdjudicator, appealAdjudicator } = terms.adjudication;
  for (const recipient of [adjudicator, fallbackAdjudicator, appealAdjudicator, terms.buyer]) {
    if (!d.encryptedKeys.some((k) => sameAddress(k.recipient, recipient))) return fail('invalid_terms', `no content key for ${recipient}`);
  }
  return ok({ ...s, kind: 'Delivered', delivery: d });
}

/** Checks shared by every decision (ADR-0016 §4), apart from the seed. */
function decisionBindings(s: Base, m: Decision, at: Timestamp, adjudicator: string, deadline: Timestamp): R<true> {
  if (!sameAddress(m.adjudicator, adjudicator)) return fail('not_your_turn', `${m.adjudicator} is not the ${m.role} adjudicator`);
  if (!before(at, deadline)) return fail('deadline_passed', `the ${m.role} deadline passed at ${deadline}`);
  const live = messageLive(m, at);
  if (!live.ok) return live;
  if (m.commitmentId !== s.id) return fail('invalid_terms', 'decision is for another commitment');
  if (m.policyHash !== s.terms.adjudication.policyHash) return fail('policy_mismatch', 'decision policyHash differs from the terms');
  if (m.registryHash !== s.terms.adjudication.registryHash) return fail('registry_mismatch', 'decision registryHash differs from the terms');
  return ok(true);
}

function firstInstance(s: Extract<EscrowState, { kind: 'Delivered' | 'FallbackJudging' }>, m: Decision, at: Timestamp): R {
  const role = s.kind === 'Delivered' ? 'primary' : 'fallback';
  if (m.role !== role) return fail('not_your_turn', `it is the ${role} adjudicator's turn`);
  const { adjudication, timing } = s.terms;
  const bound = decisionBindings(
    s,
    m,
    at,
    role === 'primary' ? adjudication.adjudicator : adjudication.fallbackAdjudicator,
    role === 'primary' ? timing.judgeBy : timing.fallbackBy,
  );
  if (!bound.ok) return bound;
  if (m.attempt !== s.delivery.attempt) return fail('invalid_terms', `decision is for attempt ${m.attempt}, delivery is attempt ${s.delivery.attempt}`);
  if (m.appealGround !== undefined) return fail('invalid_terms', 'appealGround belongs to appeal decisions only');
  // Only the primary committed to a seed. Contract gap recorded in T-004 Handoff: the fallback cannot know it.
  if (role === 'primary' && keccak256(m.seed) !== s.acceptance.seedCommitment) return fail('seed_mismatch', 'seed does not hash to the acceptance seedCommitment');

  const base = { id: s.id, terms: s.terms, settledAt: at };
  if (m.outcome === 'escalate') {
    return ok({ ...s, kind: 'Escalated', escalation: { by: role, at, appealDecideBy: addSeconds(at, timing.appealDecideSec) } });
  }
  const appealBy = addSeconds(at, timing.appealWindowSec);
  const via: FirstInstance = {
    kind: 'first_instance',
    role,
    decision: m,
    appeal: { kind: 'none', appealBy, appealDecideBy: addSeconds(appealBy, timing.appealDecideSec) },
  };
  return ok(m.outcome === 'accept' ? { ...base, kind: 'Released', via } : { ...base, kind: 'Refunded', via });
}

function escalationDecision(s: Extract<EscrowState, { kind: 'Escalated' }>, m: Decision, at: Timestamp): R {
  if (m.role !== 'appeal') return fail('not_your_turn', "it is the appeal adjudicator's turn");
  const bound = decisionBindings(s, m, at, s.terms.adjudication.appealAdjudicator, s.escalation.appealDecideBy);
  if (!bound.ok) return bound;
  if (m.outcome === 'escalate') return fail('invalid_terms', 'the appeal adjudicator decides accept or reject; it cannot escalate');
  const base = { id: s.id, terms: s.terms, settledAt: at };
  const via = { kind: 'escalation' as const, decision: m };
  return ok(m.outcome === 'accept' ? { ...base, kind: 'Released', via } : { ...base, kind: 'Refunded', via });
}

export interface AppealContext {
  id: Hex32;
  terms: CommitmentTerms;
  firstOutcome: 'accept' | 'reject';
}

export type AppealEvent = Extract<EscrowEvent, { type: 'file_appeal' | 'decide' | 'expire_appeal' }>;

/** The appeal state machine. An overturn moves bond money, not escrow money, so the escrow state is unchanged. */
export function stepAppeal(a: AppealState, e: AppealEvent, ctx: AppealContext): R<AppealState> {
  const { terms } = ctx;
  switch (e.type) {
    case 'file_appeal': {
      if (a.kind !== 'none') return fail('invalid_state', `appeal state is ${a.kind}`);
      const p = e.appeal;
      if (p.commitmentId !== ctx.id) return fail('invalid_terms', 'appeal is for another commitment');
      if (!before(e.at, a.appealBy)) return fail('deadline_passed', `appealBy passed at ${a.appealBy}`);
      if (!sameAddress(p.appellantAddress, p.appellant === 'buyer' ? terms.buyer : terms.seller)) {
        return fail('invalid_signature', `appellant address is not the ${p.appellant}`);
      }
      for (const [what, paid, required] of [
        ['appeal bond', p.bond, e.requiredBond],
        ['appeal fee', e.feePaid, e.requiredFee],
      ] as const) {
        const enough = money(gte(paid, required), what);
        if (!enough.ok) return enough;
        if (!enough.value) return fail('insufficient_funds', `${what} ${paid.amount} is below the required ${required.amount}`);
      }
      return ok({ kind: 'open', appeal: p, appealDecideBy: a.appealDecideBy });
    }
    case 'decide': {
      const m = e.message;
      if (a.kind !== 'open') return fail('invalid_state', `appeal state is ${a.kind}`);
      if (m.role !== 'appeal') return fail('not_your_turn', "it is the appeal adjudicator's turn");
      const bound = decisionBindings(ctx, m, e.at, terms.adjudication.appealAdjudicator, a.appealDecideBy);
      if (!bound.ok) return bound;
      if (m.outcome === 'escalate') return fail('invalid_terms', 'an appeal decision is accept or reject');
      return ok({ kind: m.outcome === ctx.firstOutcome ? 'upheld' : 'overturned', appeal: a.appeal, decision: m });
    }
    case 'expire_appeal': {
      if (a.kind === 'none' && reached(e.at, a.appealBy)) return ok({ kind: 'expired', appeal: null });
      if (a.kind === 'open' && reached(e.at, a.appealDecideBy)) return ok({ kind: 'expired', appeal: a.appeal });
      return fail('invalid_state', a.kind === 'none' || a.kind === 'open' ? 'the appeal deadline has not passed' : `appeal state is ${a.kind}`);
    }
  }
}

function settled(s: Extract<EscrowState, { kind: 'Released' | 'Refunded' }>, e: EscrowEvent): R {
  if (e.type !== 'file_appeal' && e.type !== 'expire_appeal' && e.type !== 'decide') return fail('invalid_state', `commitment is ${s.kind}`);
  if (s.via.kind !== 'first_instance') {
    return fail('invalid_state', s.via.kind === 'escalation' ? 'a decision reached through escalation is not appealable' : `nothing to appeal after ${s.via.kind}`);
  }
  const ctx = { id: s.id, terms: s.terms, firstOutcome: s.kind === 'Released' ? ('accept' as const) : ('reject' as const) };
  const next = stepAppeal(s.via.appeal, e as AppealEvent, ctx);
  if (!next.ok) return next;
  const via: FirstInstance = { ...s.via, appeal: next.value };
  return ok(s.kind === 'Released' ? { ...s, via } : { ...s, via });
}

const wrongState = (s: EscrowState, e: EscrowEvent): R => fail('invalid_state', `${e.type} is not allowed in ${s.kind}`);
const tooEarly = (deadline: Timestamp): R => fail('invalid_state', `deadline ${deadline} has not passed`);

export function step(s: EscrowState, e: EscrowEvent): R {
  if (!validTime(e.at)) return fail('invalid_terms', `event time ${e.at} is not a timestamp`);
  switch (s.kind) {
    case 'Offered':
      if (e.type === 'adjudicator_accept') return adjudicatorAccept(s, e);
      if (e.type === 'agree') return fail('acceptance_missing', 'the primary adjudicator has not accepted yet');
      break;
    case 'AcceptedByAdjudicator':
      if (e.type === 'agree') return agree(s, e);
      break;
    case 'Agreed':
      if (e.type === 'fund') return fund(s, e);
      if (e.type === 'expire') {
        if (!reached(e.at, s.terms.timing.fundBy)) return tooEarly(s.terms.timing.fundBy);
        return ok({ kind: 'Expired', id: s.id, terms: s.terms, from: s.kind, expiredAt: e.at });
      }
      break;
    case 'Held':
      if (e.type === 'deliver') return deliver(s, e);
      if (e.type === 'reclaim') {
        if (!reached(e.at, s.terms.timing.deliverBy)) return tooEarly(s.terms.timing.deliverBy);
        return ok({ kind: 'Refunded', id: s.id, terms: s.terms, settledAt: e.at, via: { kind: 'reclaim' } });
      }
      break;
    case 'Delivered':
      if (e.type === 'decide') return firstInstance(s, e.message, e.at);
      if (e.type === 'early_accept') {
        const m = e.message;
        if (!sameAddress(m.buyer, s.terms.buyer)) return fail('invalid_signature', 'early acceptance is not from the buyer');
        if (m.commitmentId !== s.id || m.attempt !== s.delivery.attempt) return fail('invalid_terms', 'early acceptance is for another commitment or attempt');
        const live = messageLive(m, e.at);
        if (!live.ok) return live;
        return ok({ kind: 'Released', id: s.id, terms: s.terms, settledAt: e.at, via: { kind: 'early_accept', earlyAccept: m } });
      }
      if (e.type === 'trigger_fallback') {
        if (!reached(e.at, s.terms.timing.judgeBy)) return tooEarly(s.terms.timing.judgeBy);
        return ok({ ...s, kind: 'FallbackJudging', fallbackSince: e.at });
      }
      break;
    case 'FallbackJudging':
      if (e.type === 'decide') return firstInstance(s, e.message, e.at);
      if (e.type === 'trigger_default') {
        if (!reached(e.at, s.terms.timing.fallbackBy)) return tooEarly(s.terms.timing.fallbackBy);
        return ok({ kind: 'Defaulted', id: s.id, terms: s.terms, acceptance: s.acceptance, hold: s.hold, from: s.kind, defaultedAt: e.at });
      }
      break;
    case 'Escalated':
      if (e.type === 'decide') return escalationDecision(s, e.message, e.at);
      if (e.type === 'trigger_default') {
        if (!reached(e.at, s.escalation.appealDecideBy)) return tooEarly(s.escalation.appealDecideBy);
        return ok({ kind: 'Defaulted', id: s.id, terms: s.terms, acceptance: s.acceptance, hold: s.hold, from: s.kind, defaultedAt: e.at });
      }
      break;
    case 'Defaulted':
      // The default outcome refunds the buyer; seller compensation from bonds is a settlement posting.
      if (e.type === 'apply_default_outcome') {
        return ok({ kind: 'Refunded', id: s.id, terms: s.terms, settledAt: e.at, via: { kind: 'default_outcome', from: s.from } });
      }
      break;
    case 'Released':
    case 'Refunded':
      return settled(s, e);
    case 'Expired':
      break;
  }
  if ((s.kind === 'Offered' || s.kind === 'AcceptedByAdjudicator') && e.type === 'expire') {
    if (!reached(e.at, s.terms.timing.offerExpiresAt)) return tooEarly(s.terms.timing.offerExpiresAt);
    return ok({ kind: 'Expired', id: s.id, terms: s.terms, from: s.kind, expiredAt: e.at });
  }
  return wrongState(s, e);
}
