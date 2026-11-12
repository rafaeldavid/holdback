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
import { encodePacked, keccak256 } from 'viem';
import { beaconClockOf, beaconRoundAt, type BeaconClock } from './beacon.js';
import { rulebookHash } from './canonical.js';
import { commitmentId, deliveryHash, isSealed, termsOf } from './eip712.js';
import { add, gte, tokenAmount, type MoneyError } from './money/index.js';
import { mutualSettlementProblem } from './mutual.js';
import { problem, type Problem, type ProblemType } from './problem.js';
import { err, ok, type Result } from './result.js';
import { addSeconds, validateTiming } from './timing.js';
import type {
  AdjudicatorAcceptance,
  Agree,
  AnyCommitment,
  AnyCommitmentTerms,
  Appeal,
  Decision,
  DisclosureLevel,
  Delivery,
  EarlyAccept,
  FundingAuthorization,
  Hex32,
  MutualSettlement,
  Payout,
  RandomnessSource,
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
  /** openedAt: when the settlement layer applied the appeal; it fixes the appeal panel's beacon round (ADR-0018). */
  | { kind: 'open'; appeal: Appeal; appealDecideBy: Timestamp; openedAt: Timestamp }
  | { kind: 'upheld'; appeal: Appeal; decision: Decision }
  | { kind: 'overturned'; appeal: Appeal; decision: Decision }
  | { kind: 'expired'; appeal: Appeal | null };

export interface FirstInstance {
  kind: 'first_instance';
  role: 'primary' | 'fallback';
  decision: Decision;
  /** The seller-signed delivery the decision judged: a party appeal judges the same body (ADR-0029). */
  delivery: Delivery;
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
  /** At private and judgment the sealed form: settlement reads money, deadlines and hashes only (ADR-0024). */
  terms: AnyCommitmentTerms;
  /**
   * The club rulebook's randomness.source, kept from the offer: its clock counts the fallback and appeal rounds
   * (ADR-0018 §6, T-217). A state saved before T-217 has none, and reads as sim.
   */
  beaconSource: RandomnessSource;
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
  | (Base & { kind: 'Expired'; from: 'Offered' | 'AcceptedByAdjudicator' | 'Agreed'; expiredAt: Timestamp })
  // ADR-0019, D23: closed by a settlement both parties signed. Terminal, not appealable. The payouts split the
  // price; the fee returns to the buyer (Phase 1).
  | (Base & { kind: 'Settled'; settledAt: Timestamp; from: 'Held' | 'Delivered' | 'FallbackJudging' | 'Escalated'; settlement: MutualSettlement; payouts: Payout[]; keyReleased: boolean });

/** A beacon round and its value, supplied by the settlement layer as a fact (ADR-0018). */
export interface BeaconFact {
  round: number;
  value: Hex32;
}

/** Disclosure levels in order: a rulebook's disclosureMin is a floor, and a Publish only raises (ADR-0020). */
export const LEVEL_RANK: Readonly<Record<DisclosureLevel, number>> = { private: 0, judgment: 1, public: 2 };

/** Offer: the seller's signed terms, plus the facts the guards need. */
export interface OfferInput {
  /** Either wire form: settlement needs only the bodies' hashes (ADR-0024). */
  commitment: AnyCommitment;
  at: Timestamp;
  sellerScope: Scope;
  /** The rulebook registered under terms.rulebookHash, or null when none is. */
  rulebook: Rulebook | null;
  nonceUsed: boolean;
  /** The protocol the settlement layer enforces (`full` unless it says otherwise). */
  profile?: SettlementProfile;
}

/**
 * ADR-0031 §6 (SC-5; Rafa, 2026-11-11): on the phase-one contracts a deal holds at least one base unit, as price or as
 * fee. The escrow refuses to hold nothing (`AuthCaptureEscrow` reverts `ZeroAmount`; pinned by
 * `contracts/test/unit/ZeroPrice.t.sol`, `test_zeroPriceZeroFee_cannotFund_escrowRefusesZeroAmount`).
 */
export const ZERO_HOLD_PROBLEM =
  'price and adjudication fee are both 0, and the phase-one contracts cannot fund a deal that holds nothing: the escrow refuses to hold 0 (AuthCaptureEscrow ZeroAmount; ADR-0031 §6). A zero price is allowed with a fee above 0; give the deal a price or a fee of at least one base unit';

export type EscrowEvent =
  | { type: 'adjudicator_accept'; at: Timestamp; message: AdjudicatorAcceptance; unencumberedBond: TokenAmount }
  | { type: 'agree'; at: Timestamp; message: Agree; buyerScope: Scope; spentToday: TokenAmount; memberAdmitted: boolean }
  // The mandate is checked again at funding (docs/architecture.md, Identity and signing).
  | { type: 'fund'; at: Timestamp; message: FundingAuthorization; buyerScope: Scope; balance: TokenAmount; gasBuffer: TokenAmount }
  | { type: 'deliver'; at: Timestamp; delivery: Delivery }
  | { type: 'early_accept'; at: Timestamp; message: EarlyAccept }
  // beacon: the settlement layer's value for the round beaconRoundFor fixes; required for fallback and appeal
  // decisions, ignored for the primary (ADR-0018). null when the round cannot be proven.
  | { type: 'decide'; at: Timestamp; message: Decision; beacon?: BeaconFact | null }
  // ADR-0019, D23. Both signatures are verified before step; rule is the club rulebook's mutualSettlement.
  // T-357 (SC-5b): in Held, `delivery` is the unposted delivery the settlement names and whose key it releases; it is
  // read only there, as the contract reads its `dv` and key proof only with releaseKey.
  | { type: 'mutual_settle'; at: Timestamp; message: MutualSettlement; rule: Pick<Rulebook['mutualSettlement'], 'allowed' | 'payoutsTo'>; delivery?: Delivery }
  // requiredBond is price x the rulebook appealBondRateBps and requiredFee the rulebook appealFee, both
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

/**
 * Which protocol a step is checked against (ADR-0031). `full` is the whole protocol, which SimChain runs: party
 * appeals and adjudicator bonds. `phase_one` is what the phase-one contracts settle (SC-7, D57): no party appeal and
 * no bond. On `phase_one` the primary's acceptance must reserve 0 and no free bond is read; the first decision of the
 * primary or the fallback is final at once (its appeal state is `expired` with no appeal from the decision on); and a party appeal,
 * an appeal decision or an appeal expiry is refused. A settlement layer passes the profile its contracts enforce.
 */
export type SettlementProfile = 'full' | 'phase_one';

const NO_PARTY_APPEAL = 'phase one has no party appeal: the first decision is final (ADR-0031)';

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

  // Phase 1 limits hold here too, not only in the parser, for callers that build terms in code.
  const mode: string = terms.settlement.mode;
  if (mode !== 'guaranteed_on_decision') return fail('invalid_terms', `settlement.mode ${mode} is not supported in Phase 1 (guaranteed_on_decision only)`);
  // ADR-0024: any level at or above the rulebook's floor; the body form must match the level.
  const level = terms.disclosure.level;
  if (LEVEL_RANK[level] < LEVEL_RANK[rulebook.disclosureMin]) return fail('invalid_terms', `disclosure.level ${level} is below the rulebook minimum ${rulebook.disclosureMin}`);
  if ((level === 'public') === isSealed(terms)) return fail('invalid_terms', level === 'public' ? 'a public commitment carries its bodies in the clear, not privateTerms' : `a ${level} commitment carries its bodies only as privateTerms`);

  const timing = validateTiming(terms.timing, rulebook);
  if (!timing.ok) return timing;
  // ADR-0031 §6 (SC-5): what the phase-one contracts refuse at funding, refused at the offer, before the buyer and the
  // adjudicator sign (the operator's prepare route says it before the seller signs). The strict deadline order is
  // validateTiming's, which the contract copies.
  if (input.profile === 'phase_one') {
    if (terms.timing.maxSubmissions !== 1) return fail('invalid_terms', `timing.maxSubmissions ${terms.timing.maxSubmissions}: the phase-one contracts take one delivery (1 only)`);
    if (terms.timing.appealDecideSec < 1) return fail('invalid_terms', 'timing.appealDecideSec must be at least 1: with 0 no escalation could be decided');
    if (BigInt(terms.price.amount) === 0n && BigInt(terms.adjudication.fee.amount) === 0n) return fail('invalid_terms', ZERO_HOLD_PROBLEM);
  }
  if (!rulebook.allowedSettlementModes.includes(terms.settlement.mode)) return fail('invalid_terms', `the rulebook does not allow ${terms.settlement.mode}`);
  if (terms.timing.maxSubmissions > rulebook.maxSubmissions) return fail('invalid_terms', 'maxSubmissions exceeds the rulebook maximum');
  for (const token of [terms.price.token, terms.adjudication.fee.token, terms.settlement.token]) {
    if (!rulebook.allowedTokens.includes(token)) return fail('invalid_terms', `the rulebook does not allow token ${token}`);
  }
  if (terms.adjudication.fee.token !== terms.price.token || terms.settlement.token !== terms.price.token) {
    return fail('invalid_terms', 'price, fee and settlement must use one token');
  }
  // ADR-0018 §5: a fallback or appeal round on a clock nothing here counts could never be proven.
  const beaconSource = rulebook.randomness.source;
  if (!beaconClockOf(beaconSource)) return fail('invalid_terms', `the rulebook's randomness source ${beaconSource} has no beacon verifier (sim or drand-quicknet)`);
  return ok({ kind: 'Offered', id: commitment.id, terms, beaconSource, sellerSignature: commitment.signatures.seller });
}

function adjudicatorAccept(s: Extract<EscrowState, { kind: 'Offered' }>, e: Extract<EscrowEvent, { type: 'adjudicator_accept' }>, profile: SettlementProfile): R {
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
  if (profile === 'phase_one') {
    // ADR-0031 §8, point 2: phase one has no bond, so the acceptance says that nothing is reserved, as the
    // contract requires. The contract hashes bondReserved in the price token.
    if (m.bondReserved.token !== price.token || m.bondReserved.amount !== '0') {
      return fail('acceptance_mismatch', `phase one has no bond: bondReserved must be 0 ${price.token}, not ${m.bondReserved.amount} ${m.bondReserved.token}`);
    }
    return ok({ kind: 'AcceptedByAdjudicator', id: s.id, terms: s.terms, beaconSource: s.beaconSource, sellerSignature: s.sellerSignature, acceptance: m });
  }
  // Guaranteed mode: the bond covers 100% of the price until appealDecideBy (ADR-0007).
  for (const [what, amount] of [
    ['bond reserved', m.bondReserved],
    ['unencumbered bond', e.unencumberedBond],
  ] as const) {
    const covered = money(gte(amount, price), what);
    if (!covered.ok) return covered;
    if (!covered.value) return fail('coverage_exceeded', `${what} ${amount.amount} is below the price ${price.amount}`);
  }
  return ok({ kind: 'AcceptedByAdjudicator', id: s.id, terms: s.terms, beaconSource: s.beaconSource, sellerSignature: s.sellerSignature, acceptance: m });
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
  return ok({ kind: 'Agreed', id: s.id, terms, beaconSource: s.beaconSource, acceptance: s.acceptance, agree: m });
}

function fund(s: Extract<EscrowState, { kind: 'Agreed' }>, e: Extract<EscrowEvent, { type: 'fund' }>, profile: SettlementProfile): R {
  const m = e.message;
  const { terms } = s;
  // ADR-0031 §3 (SC-2): the phase-one contracts fund by ERC-3009 only.
  if (profile === 'phase_one' && m.scheme !== 'erc3009') {
    return fail('invalid_terms', `the phase-one contracts fund by ERC-3009 only, not ${m.scheme} (ADR-0031 §3)`);
  }
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

  return ok({ kind: 'Held', id: s.id, terms, beaconSource: s.beaconSource, acceptance: s.acceptance, hold: { amount: total.value, funding: m, heldAt: e.at } });
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

// A beacon's round at a timestamp, in drand's arithmetic (the sim beacon: genesis 1 s, period 1 s, round(t) = t).
const roundAt = (clock: BeaconClock, ts: Timestamp): number => beaconRoundAt(clock, Math.max(0, Math.floor(ms(ts) / 1000)));

/**
 * The beacon round that fixes a fallback or appeal panel's seed (ADR-0018), or null when that role has no
 * turn in this state. Fallback: the round at judgeBy. Appeal: the first round strictly after the settlement
 * layer applied the escalation or the appeal. Message and trigger times never set it. Rounds count on the clock
 * of the source the commitment's rulebook names, as the rules contract's beacon counts them (T-217).
 */
export function beaconRoundFor(s: EscrowState, role: 'fallback' | 'appeal'): number | null {
  const clock = beaconClockOf(s.beaconSource);
  if (!clock) return null;
  if (role === 'fallback') return s.kind === 'Delivered' || s.kind === 'FallbackJudging' ? roundAt(clock, s.terms.timing.judgeBy) : null;
  if (s.kind === 'Escalated') return roundAt(clock, s.escalation.at) + 1;
  if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open') return roundAt(clock, s.via.appeal.openedAt) + 1;
  return null;
}

/** panelSeed(role) = keccak256(commitmentId ‖ role ‖ attempt ‖ beaconValue(round)) (ADR-0018). */
export function panelSeed(id: Hex32, role: 'fallback' | 'appeal', attempt: number, beaconValue: Hex32): Hex32 {
  return keccak256(encodePacked(['bytes32', 'string', 'uint8', 'bytes32'], [id, role, attempt, beaconValue]));
}

/** The beacon seed check for fallback and appeal decisions. There is no substitute source: no fact, no decision. */
function beaconSeed(s: EscrowState, m: Decision, beacon: BeaconFact | null | undefined): R<true> {
  if (m.role === 'primary') return ok(true);
  const round = beaconRoundFor(s, m.role);
  if (round === null) return fail('not_your_turn', `the ${m.role} adjudicator has no turn in ${s.kind}`);
  if (!beacon) return fail('seed_mismatch', `no beacon value for round ${round}`);
  if (beacon.round !== round) return fail('seed_mismatch', `the ${m.role} seed comes from round ${round}, not ${beacon.round}`);
  if (m.beacon && (m.beacon.round !== beacon.round || m.beacon.value !== beacon.value)) return fail('seed_mismatch', 'the signed beacon differs from the settlement layer beacon');
  if (m.seed !== panelSeed(s.id, m.role, m.attempt, beacon.value)) return fail('seed_mismatch', `seed is not the panel seed for beacon round ${round}`);
  return ok(true);
}

/**
 * ADR-0029: a decision or early accept names the posted delivery by its hash. A seller that signed two deliveries
 * for one attempt cannot settle a signature about one with the other.
 */
function namesTheDelivery(m: { deliveryHash: Hex32 }, d: Delivery | Hex32): R<true> {
  const posted = typeof d === 'string' ? d : deliveryHash(d);
  return m.deliveryHash === posted ? ok(true) : fail('invalid_terms', `the message names delivery ${m.deliveryHash}, not the posted delivery ${posted}`);
}

/**
 * The posted delivery's hash, from Delivered on (the read model's `deliveryHash`, ADR-0029): from the delivery while
 * the state holds it, then from the signature that settled the deal, which named it. Undefined before a delivery,
 * after a reclaim, after a default (no signature named it) and after any mutual settlement in Held: one that named an
 * unposted delivery (SC-5b) posted nothing, and the contract's deliveryHashOf stays zero too.
 */
export function postedDeliveryHash(s: EscrowState): Hex32 | undefined {
  if ('delivery' in s) return deliveryHash(s.delivery);
  if (s.kind === 'Settled') return s.from === 'Held' ? undefined : (s.settlement.deliveryHash ?? undefined);
  if (s.kind !== 'Released' && s.kind !== 'Refunded') return undefined;
  const via = s.via;
  if (via.kind === 'first_instance' || via.kind === 'escalation') return via.decision.deliveryHash;
  if (via.kind === 'early_accept') return via.earlyAccept.deliveryHash;
  return undefined;
}

/** Every role judges the delivered attempt. panelSeed hashes it, so a free attempt would be a free seed (T-206 H-1). */
function sameAttempt(m: Decision, delivered: number): R<true> {
  return m.attempt === delivered ? ok(true) : fail('invalid_terms', `decision is for attempt ${m.attempt}, delivery is attempt ${delivered}`);
}

/** Checks shared by every decision (ADR-0016 §4), apart from the seed. */
function decisionBindings(s: Pick<Base, 'id' | 'terms'>, m: Decision, at: Timestamp, adjudicator: string, deadline: Timestamp): R<true> {
  if (!sameAddress(m.adjudicator, adjudicator)) return fail('not_your_turn', `${m.adjudicator} is not the ${m.role} adjudicator`);
  if (!before(at, deadline)) return fail('deadline_passed', `the ${m.role} deadline passed at ${deadline}`);
  const live = messageLive(m, at);
  if (!live.ok) return live;
  if (m.commitmentId !== s.id) return fail('invalid_terms', 'decision is for another commitment');
  if (m.policyHash !== s.terms.adjudication.policyHash) return fail('policy_mismatch', 'decision policyHash differs from the terms');
  if (m.registryHash !== s.terms.adjudication.registryHash) return fail('registry_mismatch', 'decision registryHash differs from the terms');
  return ok(true);
}

function firstInstance(
  s: Extract<EscrowState, { kind: 'Delivered' | 'FallbackJudging' }>,
  m: Decision,
  at: Timestamp,
  beacon: BeaconFact | null | undefined,
  profile: SettlementProfile,
): R {
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
  const attempt = sameAttempt(m, s.delivery.attempt);
  if (!attempt.ok) return attempt;
  const named = namesTheDelivery(m, s.delivery);
  if (!named.ok) return named;
  if (m.appealGround !== undefined) return fail('invalid_terms', 'appealGround belongs to appeal decisions only');
  // ADR-0018: the primary reveals its committed seed; the fallback takes the beacon seed for judgeBy.
  if (role === 'primary' && keccak256(m.seed) !== s.acceptance.seedCommitment) return fail('seed_mismatch', 'seed does not hash to the acceptance seedCommitment');
  const seeded = beaconSeed(s, m, beacon);
  if (!seeded.ok) return seeded;

  const base = { id: s.id, terms: s.terms, beaconSource: s.beaconSource, settledAt: at };
  if (m.outcome === 'escalate') {
    return ok({ ...s, kind: 'Escalated', escalation: { by: role, at, appealDecideBy: addSeconds(at, timing.appealDecideSec) } });
  }
  // Phase one: final at the decision (ADR-0031 §8, point 7). The appeal state is closed with no appeal at once, so no
  // reader schedules an appeal expiry; the API still reports appealState `none` (the settlement layer's view).
  const appealBy = addSeconds(at, timing.appealWindowSec);
  const via: FirstInstance = {
    kind: 'first_instance',
    role,
    decision: m,
    delivery: s.delivery,
    appeal:
      profile === 'phase_one'
        ? { kind: 'expired', appeal: null }
        : { kind: 'none', appealBy, appealDecideBy: addSeconds(appealBy, timing.appealDecideSec) },
  };
  return ok(m.outcome === 'accept' ? { ...base, kind: 'Released', via } : { ...base, kind: 'Refunded', via });
}

function escalationDecision(s: Extract<EscrowState, { kind: 'Escalated' }>, m: Decision, at: Timestamp, beacon: BeaconFact | null | undefined): R {
  if (m.role !== 'appeal') return fail('not_your_turn', "it is the appeal adjudicator's turn");
  const bound = decisionBindings(s, m, at, s.terms.adjudication.appealAdjudicator, s.escalation.appealDecideBy);
  if (!bound.ok) return bound;
  const attempt = sameAttempt(m, s.delivery.attempt);
  if (!attempt.ok) return attempt;
  const named = namesTheDelivery(m, s.delivery);
  if (!named.ok) return named;
  const seeded = beaconSeed(s, m, beacon);
  if (!seeded.ok) return seeded;
  if (m.outcome === 'escalate') return fail('invalid_terms', 'the appeal adjudicator decides accept or reject; it cannot escalate');
  const base = { id: s.id, terms: s.terms, beaconSource: s.beaconSource, settledAt: at };
  const via = { kind: 'escalation' as const, decision: m };
  return ok(m.outcome === 'accept' ? { ...base, kind: 'Released', via } : { ...base, kind: 'Refunded', via });
}

export interface AppealContext {
  id: Hex32;
  terms: AnyCommitmentTerms;
  firstOutcome: 'accept' | 'reject';
  /** The delivery the first decision named: the appeal judges the same body (ADR-0029). */
  deliveryHash: Hex32;
  /** That delivery's attempt, which the appeal decision names too. */
  attempt: number;
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
      // T-206 L-7: only the party the decision went against appeals. Outcomes are binary, and the one slot taken by
      // the favoured party would shut out the party with something to win.
      const against = ctx.firstOutcome === 'accept' ? 'buyer' : 'seller';
      if (p.appellant !== against) return fail('invalid_terms', `the decision went against the ${against}, so only the ${against} may appeal`);
      for (const [what, paid, required] of [
        ['appeal bond', p.bond, e.requiredBond],
        ['appeal fee', e.feePaid, e.requiredFee],
      ] as const) {
        const enough = money(gte(paid, required), what);
        if (!enough.ok) return enough;
        if (!enough.value) return fail('insufficient_funds', `${what} ${paid.amount} is below the required ${required.amount}`);
      }
      return ok({ kind: 'open', appeal: p, appealDecideBy: a.appealDecideBy, openedAt: e.at });
    }
    case 'decide': {
      const m = e.message;
      if (a.kind !== 'open') return fail('invalid_state', `appeal state is ${a.kind}`);
      if (m.role !== 'appeal') return fail('not_your_turn', "it is the appeal adjudicator's turn");
      const bound = decisionBindings(ctx, m, e.at, terms.adjudication.appealAdjudicator, a.appealDecideBy);
      if (!bound.ok) return bound;
      const attempt = sameAttempt(m, ctx.attempt);
      if (!attempt.ok) return attempt;
      const named = namesTheDelivery(m, ctx.deliveryHash);
      if (!named.ok) return named;
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

function settled(s: Extract<EscrowState, { kind: 'Released' | 'Refunded' }>, e: EscrowEvent, profile: SettlementProfile): R {
  if (e.type !== 'file_appeal' && e.type !== 'expire_appeal' && e.type !== 'decide') return fail('invalid_state', `commitment is ${s.kind}`);
  if (profile === 'phase_one') return fail('invalid_state', NO_PARTY_APPEAL);
  if (s.via.kind !== 'first_instance') {
    return fail('invalid_state', s.via.kind === 'escalation' ? 'a decision reached through escalation is not appealable' : `nothing to appeal after ${s.via.kind}`);
  }
  const ctx = {
    id: s.id,
    terms: s.terms,
    firstOutcome: s.kind === 'Released' ? ('accept' as const) : ('reject' as const),
    deliveryHash: s.via.decision.deliveryHash,
    attempt: s.via.delivery.attempt,
  };
  const next = stepAppeal(s.via.appeal, e as AppealEvent, ctx);
  if (next.ok && e.type === 'decide') {
    const seeded = beaconSeed(s, e.message, e.beacon);
    if (!seeded.ok) return seeded;
  }
  if (!next.ok) return next;
  const via: FirstInstance = { ...s.via, appeal: next.value };
  return ok(s.kind === 'Released' ? { ...s, via } : { ...s, via });
}

type Settleable = Extract<EscrowState, { kind: 'Held' | 'Delivered' | 'FallbackJudging' | 'Escalated' }>;

/**
 * ADR-0031 SC-5b, ADR-0019 as amended 2026-11-12 (T-357): a settlement in Held, where nothing is posted, exactly as
 * HoldbackRules.mutualSettle takes it, no looser and no stricter:
 * - no delivery named: no key released (:370, InvalidMessage);
 * - a delivery named and its key kept: nothing more is checked (:379);
 * - a delivery named and its key released: the carried delivery is for this commitment and hashes to the hash both
 *   parties signed (:380, the contract hashes `dv` with this commitment's id), and it holds an envelope for the buyer,
 *   the first of which is released (:381, BadKeyProof). Both parties' signatures over the settlement, which names that
 *   hash, are what endorse the delivery: like the contract, core reads no seller signature, attempt or submittedAt.
 */
function lateDelivery(s: Extract<Settleable, { kind: 'Held' }>, m: MutualSettlement, d: Delivery | undefined): R<true> {
  if (m.deliveryHash === null) return m.releaseKey ? fail('invalid_terms', 'releaseKey needs a delivery') : ok(true);
  if (!m.releaseKey) return ok(true);
  if (!d) return fail('invalid_terms', `the settlement releases the key of delivery ${m.deliveryHash}, but carries no delivery`);
  // Hex compared in any letter case: the contract hashes the id as bytes32 (:380).
  if (d.commitmentId.toLowerCase() !== s.id.toLowerCase()) return fail('invalid_terms', 'the carried delivery is for another commitment');
  if (deliveryHash(d) !== m.deliveryHash) return fail('invalid_terms', `the carried delivery does not hash to the signed deliveryHash ${m.deliveryHash}; it hashes to ${deliveryHash(d)}`);
  if (!d.encryptedKeys.some((k) => sameAddress(k.recipient, s.terms.buyer))) return fail('invalid_terms', 'the carried delivery has no envelope for the buyer, so there is no key to release');
  return ok(true);
}

/** ADR-0019: a settlement both parties signed closes a funded, undecided commitment. Signatures are checked before step. */
function mutualSettle(s: Settleable, e: Extract<EscrowEvent, { type: 'mutual_settle' }>, profile: SettlementProfile): R {
  const m = e.message;
  if (m.commitmentId !== s.id) return fail('invalid_terms', 'settlement is for another commitment');
  // ADR-0031 §4 (SC-3): the phase-one contracts pay a settlement to the buyer and the seller only, whatever the
  // rulebook's payoutsTo says; D23's payouts to other addresses are deferred past phase one.
  if (profile === 'phase_one') {
    const other = m.payouts.find((p) => !sameAddress(p.to, s.terms.buyer) && !sameAddress(p.to, s.terms.seller));
    if (other) return fail('invalid_terms', `payout recipient ${other.to} is neither the buyer nor the seller: the phase-one contracts pay a mutual settlement to the parties only (ADR-0031 §4)`);
  }
  const live = messageLive(m, e.at);
  if (!live.ok) return live;
  if (s.kind === 'Held') {
    const late = lateDelivery(s, m, e.delivery);
    if (!late.ok) return late;
  } else if (m.deliveryHash !== deliveryHash(s.delivery)) {
    return fail('invalid_terms', 'deliveryHash does not name the current delivery');
  }
  // D23: rulebook allows it, payouts in the price token sum to the price, recipients as payoutsTo allows.
  const why = mutualSettlementProblem(m, s.terms, e.rule);
  if (why !== undefined) return fail('invalid_terms', why);
  return ok({
    kind: 'Settled',
    id: s.id,
    terms: s.terms,
    beaconSource: s.beaconSource,
    settledAt: e.at,
    from: s.kind,
    settlement: m,
    payouts: m.payouts,
    keyReleased: m.releaseKey,
  });
}

const wrongState = (s: EscrowState, e: EscrowEvent): R => fail('invalid_state', `${e.type} is not allowed in ${s.kind}`);
const tooEarly = (deadline: Timestamp): R => fail('invalid_state', `deadline ${deadline} has not passed`);

/** One transition. `profile` is the protocol the settlement layer enforces (`full` unless it says otherwise). */
export function step(s: EscrowState, e: EscrowEvent, profile: SettlementProfile = 'full'): R {
  if (!validTime(e.at)) return fail('invalid_terms', `event time ${e.at} is not a timestamp`);
  if (e.type === 'mutual_settle' && (s.kind === 'Held' || s.kind === 'Delivered' || s.kind === 'FallbackJudging' || s.kind === 'Escalated')) return mutualSettle(s, e, profile);
  switch (s.kind) {
    case 'Offered':
      if (e.type === 'adjudicator_accept') return adjudicatorAccept(s, e, profile);
      if (e.type === 'agree') return fail('acceptance_missing', 'the primary adjudicator has not accepted yet');
      break;
    case 'AcceptedByAdjudicator':
      if (e.type === 'agree') return agree(s, e);
      break;
    case 'Agreed':
      if (e.type === 'fund') return fund(s, e, profile);
      if (e.type === 'expire') {
        if (!reached(e.at, s.terms.timing.fundBy)) return tooEarly(s.terms.timing.fundBy);
        return ok({ kind: 'Expired', id: s.id, terms: s.terms, beaconSource: s.beaconSource, from: s.kind, expiredAt: e.at });
      }
      break;
    case 'Held':
      if (e.type === 'deliver') return deliver(s, e);
      if (e.type === 'reclaim') {
        if (!reached(e.at, s.terms.timing.deliverBy)) return tooEarly(s.terms.timing.deliverBy);
        return ok({ kind: 'Refunded', id: s.id, terms: s.terms, beaconSource: s.beaconSource, settledAt: e.at, via: { kind: 'reclaim' } });
      }
      break;
    case 'Delivered':
      if (e.type === 'decide') return firstInstance(s, e.message, e.at, e.beacon, profile);
      if (e.type === 'early_accept') {
        const m = e.message;
        if (!sameAddress(m.buyer, s.terms.buyer)) return fail('invalid_signature', 'early acceptance is not from the buyer');
        if (m.commitmentId !== s.id || m.attempt !== s.delivery.attempt) return fail('invalid_terms', 'early acceptance is for another commitment or attempt');
        const named = namesTheDelivery(m, s.delivery);
        if (!named.ok) return named;
        const live = messageLive(m, e.at);
        if (!live.ok) return live;
        return ok({ kind: 'Released', id: s.id, terms: s.terms, beaconSource: s.beaconSource, settledAt: e.at, via: { kind: 'early_accept', earlyAccept: m } });
      }
      if (e.type === 'trigger_fallback') {
        if (!reached(e.at, s.terms.timing.judgeBy)) return tooEarly(s.terms.timing.judgeBy);
        return ok({ ...s, kind: 'FallbackJudging', fallbackSince: e.at });
      }
      break;
    case 'FallbackJudging':
      if (e.type === 'decide') return firstInstance(s, e.message, e.at, e.beacon, profile);
      if (e.type === 'trigger_default') {
        if (!reached(e.at, s.terms.timing.fallbackBy)) return tooEarly(s.terms.timing.fallbackBy);
        return ok({ kind: 'Defaulted', id: s.id, terms: s.terms, beaconSource: s.beaconSource, acceptance: s.acceptance, hold: s.hold, from: s.kind, defaultedAt: e.at });
      }
      break;
    case 'Escalated':
      if (e.type === 'decide') return escalationDecision(s, e.message, e.at, e.beacon);
      if (e.type === 'trigger_default') {
        if (!reached(e.at, s.escalation.appealDecideBy)) return tooEarly(s.escalation.appealDecideBy);
        return ok({ kind: 'Defaulted', id: s.id, terms: s.terms, beaconSource: s.beaconSource, acceptance: s.acceptance, hold: s.hold, from: s.kind, defaultedAt: e.at });
      }
      break;
    case 'Defaulted':
      // The default outcome refunds the buyer; seller compensation from bonds is a settlement posting.
      if (e.type === 'apply_default_outcome') {
        return ok({ kind: 'Refunded', id: s.id, terms: s.terms, beaconSource: s.beaconSource, settledAt: e.at, via: { kind: 'default_outcome', from: s.from } });
      }
      break;
    case 'Released':
    case 'Refunded':
      return settled(s, e, profile);
    case 'Expired':
    case 'Settled':
      break;
  }
  if ((s.kind === 'Offered' || s.kind === 'AcceptedByAdjudicator') && e.type === 'expire') {
    if (!reached(e.at, s.terms.timing.offerExpiresAt)) return tooEarly(s.terms.timing.offerExpiresAt);
    return ok({ kind: 'Expired', id: s.id, terms: s.terms, beaconSource: s.beaconSource, from: s.kind, expiredAt: e.at });
  }
  return wrongState(s, e);
}
