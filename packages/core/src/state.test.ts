import { readFileSync } from 'node:fs';
import { keccak256, type Hex } from 'viem';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DRAND_QUICKNET_CHAIN_HASH } from './beacon.js';
import { rulebookHash } from './canonical.js';
import { commitmentId, deliveryHash, termsOf } from './eip712.js';
import type { TokenAmount } from './money/index.js';
import { parseAppeal, parseClub, parseCommitment, parseDelivery, parseMessage } from './parse.js';
import { PROBLEM_TYPES, type ProblemType } from './problem.js';
import { beaconRoundFor, offer, panelSeed, postedDeliveryHash, step, type EscrowEvent, type EscrowState, type OfferInput } from './state.js';
import type { AdjudicatorAcceptance, Agree, Appeal, Commitment, CommitmentTerms, Decision, Delivery, EarlyAccept, FundingAuthorization, MutualSettlement, Rulebook, Scope } from './types.js';

function load(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../spec/examples/${file}`, import.meta.url), 'utf8'));
}
const parsedCommitment = parseCommitment(load('commitment.example.json'));
const parsedClub = parseClub(load('club.example.json'));
if (!parsedCommitment.ok || !parsedClub.ok) throw new Error('examples must parse');
const exampleCommitment = parsedCommitment.value;

const SIG: Hex = `0x${'ab'.repeat(65)}`;
const ZERO32: Hex = `0x${'00'.repeat(32)}`;
const tusd = (amount: string): TokenAmount => ({ token: 'tUSD', amount: amount as TokenAmount['amount'] });

// The example's hashes are placeholders, so derive a self-consistent commitment from its terms.
const rulebook = parsedClub.value.rulebook;
function commitmentFor(rb: Rulebook, patch: Partial<CommitmentTerms> = {}): Commitment {
  const t = { ...termsOf(exampleCommitment), ...patch, rulebookHash: rulebookHash(rb) };
  return { ...t, id: commitmentId(t), signatures: { seller: SIG } };
}
const commitment = commitmentFor(rulebook);
const terms = termsOf(commitment);
const id = commitment.id;
const withRulebook = (rb: Rulebook, patch: Partial<CommitmentTerms> = {}): Partial<OfferInput> => ({ rulebook: rb, commitment: commitmentFor(rb, patch) });
const { buyer, seller } = terms;
const { adjudicator: primary, fallbackAdjudicator: fallback, appealAdjudicator: appealAdj, policyHash, registryHash } = terms.adjudication;
const seed: Hex = `0x${'5e'.repeat(32)}`;
const far = '2027-01-01T00:00:00Z';

const T = {
  offer: '2026-10-30T10:00:00Z',
  accept: '2026-10-30T10:05:00Z',
  agree: '2026-10-30T10:06:00Z',
  fund: '2026-10-30T10:07:00Z',
  offerExpiry: '2026-10-30T10:15:00Z',
  fundBy: '2026-10-30T10:30:00Z',
  deliver: '2026-11-01T09:00:00Z',
  deliverBy: '2026-11-01T10:00:00Z',
  decide: '2026-11-01T10:01:00Z',
  judgeBy: '2026-11-01T10:02:00Z',
  fallbackDecide: '2026-11-01T10:03:00Z',
  fallbackBy: '2026-11-01T10:04:00Z',
  appealFiled: '2026-11-01T10:05:00Z',
  appealDecided: '2026-11-01T10:07:00Z',
  // decide + 300 s appeal window, then + 300 s decision window
  appealBy: '2026-11-01T10:06:00Z',
  appealDecideBy: '2026-11-01T10:11:00Z',
};

const scope = (roles: Scope['roles'], over: Partial<Scope> = {}): Scope => ({
  roles,
  maxPerCommitment: tusd('5000000000'),
  maxDaily: tusd('9000000000'),
  expiresAt: far,
  ...over,
});

const offerInput = (over: Partial<OfferInput> = {}): OfferInput => ({
  commitment,
  at: T.offer,
  sellerScope: scope(['seller']),
  rulebook,
  nonceUsed: false,
  ...over,
});

const acceptance = (over: Partial<AdjudicatorAcceptance> = {}): AdjudicatorAcceptance => ({
  type: 'AdjudicatorAcceptance',
  commitmentId: id,
  adjudicator: primary,
  seedCommitment: keccak256(seed),
  policyHash,
  registryHash,
  fee: terms.adjudication.fee,
  bondReserved: terms.price,
  nonce: ZERO32,
  expiresAt: T.offerExpiry,
  signature: SIG,
  ...over,
});

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  commitmentId: id,
  attempt: 1,
  ciphertext: { uri: 'file:///store/x', sha256: `sha256:${'a'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' },
  plaintextSha256: `sha256:${'b'.repeat(64)}`,
  plaintextMime: 'text/csv',
  encryptedKeys: [primary, fallback, appealAdj, buyer].map((recipient) => ({ recipient, scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: 'a2V5' })),
  submittedAt: T.deliver,
  signature: SIG,
  ...over,
});

/** The posted delivery's hash, which every decision and early accept names (ADR-0029). */
const DH = deliveryHash(delivery());
/** The hash of another seller-signed attempt-1 delivery: a seller that equivocates. */
const OTHER_DH = deliveryHash(delivery({ ciphertext: { uri: 'file:///store/y', sha256: `sha256:${'c'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' } }));

const decision = (role: Decision['role'], outcome: Decision['outcome'], over: Partial<Decision> = {}): Decision => ({
  type: 'Decision',
  commitmentId: id,
  attempt: 1,
  deliveryHash: DH,
  adjudicator: role === 'primary' ? primary : role === 'fallback' ? fallback : appealAdj,
  role,
  outcome,
  seed,
  policyHash,
  registryHash,
  judgmentRecordHash: `0x${'d0'.repeat(32)}`,
  nonce: ZERO32,
  expiresAt: far,
  signature: SIG,
  ...over,
});

const appeal = (over: Partial<Appeal> = {}): Appeal => ({
  commitmentId: id,
  appellant: 'buyer',
  appellantAddress: buyer,
  grounds: 'wrong-outcome',
  bond: tusd('100000000'),
  filedAt: T.appealFiled,
  signature: SIG,
  ...over,
});

/** D23 payouts of the price: to the seller, then to the buyer; zero amounts left out. */
const split = (toSeller: string, toBuyer: string) =>
  [
    { to: seller, amount: tusd(toSeller) },
    { to: buyer, amount: tusd(toBuyer) },
  ].filter((p) => p.amount.amount !== '0');
const outsider: Hex = '0x00000000000000000000000000000000000000ab';

const ev = {
  accept: (over: Partial<AdjudicatorAcceptance> = {}, at = T.accept, bond = tusd('10000000000')): EscrowEvent => ({
    type: 'adjudicator_accept',
    at,
    message: acceptance(over),
    unencumberedBond: bond,
  }),
  agree: (at = T.agree, over: { buyerScope?: Scope; spentToday?: TokenAmount; memberAdmitted?: boolean; commitmentId?: Hex; message?: Partial<Agree> } = {}): EscrowEvent => ({
    type: 'agree',
    at,
    message: { type: 'Agree', commitmentId: over.commitmentId ?? id, buyer, nonce: ZERO32, expiresAt: far, signature: SIG, ...over.message },
    buyerScope: over.buyerScope ?? scope(['buyer']),
    spentToday: over.spentToday ?? tusd('0'),
    memberAdmitted: over.memberAdmitted ?? true,
  }),
  fund: (at = T.fund, over: { from?: Hex; value?: string; balance?: TokenAmount; gasBuffer?: TokenAmount; buyerScope?: Scope; message?: Partial<FundingAuthorization> } = {}): EscrowEvent => ({
    type: 'fund',
    at,
    message: {
      type: 'FundingAuthorization',
      scheme: 'erc3009',
      commitmentId: id,
      from: over.from ?? buyer,
      value: over.value ?? '2050000000',
      token: 'tUSD',
      validAfter: T.offer,
      validBefore: T.fundBy,
      nonce: ZERO32,
      expiresAt: T.fundBy,
      signature: SIG,
      ...over.message,
    },
    buyerScope: over.buyerScope ?? scope(['buyer']),
    balance: over.balance ?? tusd('3000000000'),
    gasBuffer: over.gasBuffer ?? tusd('1000000'),
  }),
  deliver: (at = T.deliver, over: Partial<Delivery> = {}): EscrowEvent => ({ type: 'deliver', at, delivery: delivery(over) }),
  earlyAccept: (at = T.decide, by: Hex = buyer, over: Partial<EarlyAccept> = {}): EscrowEvent => ({
    type: 'early_accept',
    at,
    message: { type: 'EarlyAccept', commitmentId: id, buyer: by, attempt: 1, deliveryHash: DH, nonce: ZERO32, expiresAt: far, signature: SIG, ...over },
  }),
  decide: (role: Decision['role'], outcome: Decision['outcome'], at: string, over: Partial<Decision> = {}): EscrowEvent => ({
    type: 'decide',
    at,
    message: decision(role, outcome, over),
  }),
  // Required bond: 5% of the 2000 tUSD price (example rulebook appealBondRateBps); fee: the rulebook appealFee.
  fileAppeal: (at = T.appealFiled, over: Partial<Appeal> = {}, facts: { requiredBond?: TokenAmount; requiredFee?: TokenAmount; feePaid?: TokenAmount } = {}): EscrowEvent => ({
    type: 'file_appeal',
    at,
    appeal: appeal(over),
    requiredBond: facts.requiredBond ?? tusd('100000000'),
    requiredFee: facts.requiredFee ?? tusd('25000000'),
    feePaid: facts.feePaid ?? tusd('25000000'),
  }),
  mutual: (at: string, over: Partial<MutualSettlement> = {}, rule: { allowed: boolean; payoutsTo: 'parties' | 'any' } = { allowed: true, payoutsTo: 'parties' }): EscrowEvent => ({
    type: 'mutual_settle',
    at,
    message: {
      type: 'MutualSettlement',
      commitmentId: id,
      deliveryHash: null,
      payouts: split('1400000000', '600000000'),
      releaseKey: false,
      nonce: ZERO32,
      expiresAt: far,
      buyerSignature: SIG,
      sellerSignature: SIG,
      ...over,
    },
    rule,
  }),
  at: (type: 'reclaim' | 'trigger_fallback' | 'trigger_default' | 'expire' | 'apply_default_outcome' | 'expire_appeal', at: string): EscrowEvent => ({ type, at }),
};

// A stand-in beacon for core tests; SimChain's real one is keccak256(simSeed || round) (ADR-0018).
const testBeacon = (round: number): Hex => keccak256(`0x${round.toString(16).padStart(16, '0')}`);
const secondsOf = (ts: string): number => Math.floor(Date.parse(ts) / 1000);

/**
 * Supplies the beacon fact a settlement layer would, and the seed an honest fallback or appeal adjudicator
 * derives from it, for a decision that names neither (the default `seed`). Tests of the seed rule build
 * their events explicitly.
 */
function fill(s: EscrowState, e: EscrowEvent): EscrowEvent {
  if (e.type !== 'decide' || e.beacon !== undefined || e.message.role === 'primary' || e.message.seed !== seed) return e;
  const round = beaconRoundFor(s, e.message.role);
  if (round === null) return e;
  const value = testBeacon(round);
  return { ...e, beacon: { round, value }, message: { ...e.message, seed: panelSeed(e.message.commitmentId, e.message.role, e.message.attempt, value) } };
}
const stepF = (s: EscrowState, e: EscrowEvent) => step(s, fill(s, e));

function offered(): EscrowState {
  const start = offer(offerInput());
  if (!start.ok) throw new Error(`offer failed: ${start.error.detail}`);
  return start.value;
}

function run(events: EscrowEvent[], from: EscrowState = offered()): EscrowState {
  let s = from;
  for (const e of events) {
    const r = stepF(s, e);
    if (!r.ok) throw new Error(`setup step ${e.type} failed in ${s.kind}: ${r.error.type} ${r.error.detail}`);
    s = r.value;
  }
  return s;
}

const toAccepted = [ev.accept()];
const toAgreed = [...toAccepted, ev.agree()];
const toHeld = [...toAgreed, ev.fund()];
const toDelivered = [...toHeld, ev.deliver()];
const toFallback = [...toDelivered, ev.at('trigger_fallback', T.judgeBy)];
const toEscalated = [...toDelivered, ev.decide('primary', 'escalate', T.decide)];
const escalatedAt = '2026-11-01T10:01:00Z';
const escalationDecideBy = '2026-11-01T10:06:00Z'; // escalatedAt + appealDecideSec
const toReleased = [...toDelivered, ev.decide('primary', 'accept', T.decide)];
const toRefunded = [...toDelivered, ev.decide('primary', 'reject', T.decide)];
const toAppealOpen = [...toReleased, ev.fileAppeal()];
const toDefaulted = [...toFallback, ev.at('trigger_default', T.fallbackBy)];

function appealKind(s: EscrowState): string | undefined {
  if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') return s.via.appeal.kind;
  return undefined;
}

describe('offer', () => {
  it('opens an Offered commitment', () => {
    expect(offer(offerInput())).toMatchObject({ ok: true, value: { kind: 'Offered', id } });
  });

  it.each<[string, Partial<OfferInput>, ProblemType]>([
    ['an ID that is not the terms hash', { commitment: { ...commitment, id: ZERO32 } }, 'invalid_terms'],
    ['an unknown rulebook', { rulebook: null }, 'rulebook_unknown'],
    ['a used nonce', { nonceUsed: true }, 'nonce_reused'],
    ['a scope without the seller role', { sellerScope: scope(['buyer']) }, 'scope_exceeded'],
    ['a price above the seller cap', { sellerScope: scope(['seller'], { maxPerCommitment: tusd('1') }) }, 'scope_exceeded'],
    ['an expired seller mandate', { sellerScope: scope(['seller'], { expiresAt: T.offer }) }, 'mandate_expired'],
    ['an offer after its expiry', { at: T.offerExpiry }, 'deadline_passed'],
    ['timing below the rulebook minimum', withRulebook({ ...rulebook, minWindowsSec: { ...rulebook.minWindowsSec, judge: 121 } }), 'invalid_terms'],
    ['a settlement mode the rulebook does not allow', withRulebook({ ...rulebook, allowedSettlementModes: ['settle_after_window'] }), 'invalid_terms'],
    ['a token the rulebook does not allow', withRulebook({ ...rulebook, allowedTokens: ['tEUR'] }), 'invalid_terms'],
    ['maxSubmissions above the rulebook maximum', withRulebook({ ...rulebook, maxSubmissions: 0 }), 'invalid_terms'],
    ['a fee in another allowed token', withRulebook({ ...rulebook, allowedTokens: ['tUSD', 'tEUR'] }, { adjudication: { ...exampleCommitment.adjudication, fee: { token: 'tEUR', amount: '50000000' as TokenAmount['amount'] } } }), 'invalid_terms'],
    ['an unparseable offer time', { at: 'not a time' }, 'invalid_terms'],
    ['a seller cap in another token', { sellerScope: scope(['seller'], { maxPerCommitment: { token: 'tEUR', amount: '5000000000' as TokenAmount['amount'] } }) }, 'invalid_terms'],
    ['a rulebook whose hash is not the one the terms bind', { rulebook: { ...rulebook, appealBondRateBps: 600 } }, 'rulebook_unknown'],
    [
      'optimistic mode in Phase 1, even when the rulebook allows it',
      withRulebook(
        { ...rulebook, allowedSettlementModes: ['guaranteed_on_decision', 'optimistic'] },
        {
          settlement: { mode: 'optimistic', token: 'tUSD' } as never,
          timing: { ...exampleCommitment.timing, disputeBy: '2026-11-06T17:00:00Z', disputeJudgeSec: 86400, disputeFallbackSec: 86400 } as never,
        },
      ),
      'invalid_terms',
    ],
    ['a private disclosure level in Phase 1', withRulebook(rulebook, { disclosure: { level: 'private' } as never }), 'invalid_terms'],
  ])('refuses %s', (_name, over, type) => {
    expect(offer(offerInput(over))).toMatchObject({ ok: false, error: { type } });
  });
});

type Legal = [name: string, path: EscrowEvent[], event: EscrowEvent, to: EscrowState['kind'], appeal?: string];

// One row per transition in docs/architecture.md (escrow and appeal diagrams).
const legal: Legal[] = [
  ['Offered -> AcceptedByAdjudicator (primary accepts)', [], ev.accept(), 'AcceptedByAdjudicator'],
  ['Offered -> Expired (offer expiry)', [], ev.at('expire', T.offerExpiry), 'Expired'],
  ['AcceptedByAdjudicator -> Agreed (buyer signs)', toAccepted, ev.agree(), 'Agreed'],
  ['AcceptedByAdjudicator -> Expired (offer expiry)', toAccepted, ev.at('expire', T.offerExpiry), 'Expired'],
  ['Agreed -> Held (fund)', toAgreed, ev.fund(), 'Held'],
  ['Agreed -> Expired (fund deadline)', toAgreed, ev.at('expire', T.fundBy), 'Expired'],
  ['Held -> Delivered (seller delivers)', toHeld, ev.deliver(), 'Delivered'],
  ['Held -> Refunded (reclaim after deliverBy)', toHeld, ev.at('reclaim', T.deliverBy), 'Refunded'],
  ['Delivered -> Released (buyer accepts early)', toDelivered, ev.earlyAccept(), 'Released'],
  ['Delivered -> Released (primary accepts)', toDelivered, ev.decide('primary', 'accept', T.decide), 'Released', 'none'],
  ['Delivered -> Refunded (primary rejects)', toDelivered, ev.decide('primary', 'reject', T.decide), 'Refunded', 'none'],
  ['Delivered -> Escalated (primary escalates)', toDelivered, ev.decide('primary', 'escalate', T.decide), 'Escalated'],
  ['Delivered -> FallbackJudging (judgeBy passed)', toDelivered, ev.at('trigger_fallback', T.judgeBy), 'FallbackJudging'],
  ['FallbackJudging -> Released (fallback accepts)', toFallback, ev.decide('fallback', 'accept', T.fallbackDecide), 'Released', 'none'],
  ['FallbackJudging -> Refunded (fallback rejects)', toFallback, ev.decide('fallback', 'reject', T.fallbackDecide), 'Refunded', 'none'],
  ['FallbackJudging -> Escalated (fallback escalates)', toFallback, ev.decide('fallback', 'escalate', T.fallbackDecide), 'Escalated'],
  ['FallbackJudging -> Defaulted (fallbackBy passed)', toFallback, ev.at('trigger_default', T.fallbackBy), 'Defaulted'],
  ['Escalated -> Released (appeal adjudicator accepts)', toEscalated, ev.decide('appeal', 'accept', T.fallbackDecide), 'Released'],
  ['Escalated -> Refunded (appeal adjudicator rejects)', toEscalated, ev.decide('appeal', 'reject', T.fallbackDecide), 'Refunded'],
  ['Escalated -> Defaulted (appealDecideBy passed)', toEscalated, ev.at('trigger_default', escalationDecideBy), 'Defaulted'],
  ['Defaulted -> Refunded (default outcome)', toDefaulted, ev.at('apply_default_outcome', T.fallbackBy), 'Refunded'],
  ['appeal none -> open (party appeals before appealBy)', toReleased, ev.fileAppeal(), 'Released', 'open'],
  ['appeal none -> expired (appealBy passed)', toRefunded, ev.at('expire_appeal', T.appealBy), 'Refunded', 'expired'],
  ['appeal open -> upheld (appeal adjudicator upholds)', toAppealOpen, ev.decide('appeal', 'accept', T.appealDecided), 'Released', 'upheld'],
  ['appeal open -> overturned (appeal adjudicator overturns)', toAppealOpen, ev.decide('appeal', 'reject', T.appealDecided), 'Released', 'overturned'],
  ['appeal open -> expired (appealDecideBy passed)', toAppealOpen, ev.at('expire_appeal', T.appealDecideBy), 'Released', 'expired'],
];

describe('legal transitions', () => {
  it.each(legal)('%s', (_name, path, event, to, appealState) => {
    const r = stepF(run(path), event);
    if (!r.ok) throw new Error(`${r.error.type}: ${r.error.detail}`);
    expect(r.value.kind).toBe(to);
    expect(appealKind(r.value)).toBe(appealState);
  });

  it.each([
    ['FallbackJudging', toDefaulted],
    ['Escalated', [...toEscalated, ev.at('trigger_default', escalationDecideBy)]],
  ] as const)('records that the default came from %s through to the refund', (from, path) => {
    const r = stepF(run([...path]), ev.at('apply_default_outcome', far));
    if (!r.ok) throw new Error(r.error.detail);
    expect(r.value.kind === 'Refunded' && r.value.via).toEqual({ kind: 'default_outcome', from });
  });

  it('refuses to fund when price plus fee overflows uint256', () => {
    const MAX = tusd((2n ** 256n - 1n).toString());
    const huge = commitmentFor(rulebook, { price: MAX });
    const big = scope(['seller', 'buyer'], { maxPerCommitment: MAX, maxDaily: MAX });
    const start = offer(offerInput({ commitment: huge, sellerScope: big }));
    if (!start.ok) throw new Error(start.error.detail);
    const hid = huge.id;
    const events: EscrowEvent[] = [
      { type: 'adjudicator_accept', at: T.accept, message: acceptance({ commitmentId: hid, bondReserved: MAX }), unencumberedBond: MAX },
      { type: 'agree', at: T.agree, message: { type: 'Agree', commitmentId: hid, buyer, nonce: ZERO32, expiresAt: far, signature: SIG }, buyerScope: big, spentToday: tusd('0'), memberAdmitted: true },
    ];
    let s: EscrowState = start.value;
    for (const e of events) {
      const r = step(s, e);
      if (!r.ok) throw new Error(r.error.detail);
      s = r.value;
    }
    const f = ev.fund(T.fund, { buyerScope: big, message: { commitmentId: hid } });
    expect(step(s, f)).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
  });

  it('records the hold as price plus fee', () => {
    const s = run(toHeld);
    expect(s.kind === 'Held' && s.hold.amount).toEqual(tusd('2050000000'));
  });

  it('opens the appeal window at the first-instance decision', () => {
    const s = run(toReleased);
    expect(s.kind === 'Released' && s.via.kind === 'first_instance' && s.via.appeal).toEqual({
      kind: 'none',
      appealBy: T.appealBy.replace('Z', '.000Z'),
      appealDecideBy: T.appealDecideBy.replace('Z', '.000Z'),
    });
  });

  it('gives an escalated case appealDecideSec from the escalation', () => {
    const s = run(toEscalated);
    expect(s.kind === 'Escalated' && s.escalation).toEqual({ by: 'primary', at: escalatedAt, appealDecideBy: escalationDecideBy.replace('Z', '.000Z') });
  });
});

type Illegal = [name: string, path: EscrowEvent[], event: EscrowEvent, problem: ProblemType];

const illegal: Illegal[] = [
  // ordering: adjudicator acceptance before agreement and funding (ADR-0016)
  ['buyer agrees before the adjudicator accepts', [], ev.agree(), 'acceptance_missing'],
  ['funding an offer', [], ev.fund(), 'invalid_state'],
  ['funding before the buyer agrees', toAccepted, ev.fund(), 'invalid_state'],
  // adjudicator acceptance guards
  ['acceptance under another policy', [], ev.accept({ policyHash: ZERO32 }), 'policy_mismatch'],
  ['acceptance under another registry', [], ev.accept({ registryHash: ZERO32 }), 'registry_mismatch'],
  ['acceptance with another fee', [], ev.accept({ fee: tusd('1') }), 'acceptance_mismatch'],
  ['acceptance for another commitment', [], ev.accept({ commitmentId: ZERO32 }), 'acceptance_mismatch'],
  ['acceptance by the fallback adjudicator', [], ev.accept({ adjudicator: fallback }), 'not_your_turn'],
  ['acceptance reserving less bond than the price', [], ev.accept({ bondReserved: tusd('1999999999') }), 'coverage_exceeded'],
  ['acceptance without enough unencumbered bond', [], ev.accept({}, T.accept, tusd('1999999999')), 'coverage_exceeded'],
  // agree guards
  ['agreement to other terms', toAccepted, ev.agree(T.agree, { commitmentId: ZERO32 }), 'invalid_terms'],
  ['agreement without the buyer role', toAccepted, ev.agree(T.agree, { buyerScope: scope(['seller']) }), 'scope_exceeded'],
  ['agreement above the daily cap', toAccepted, ev.agree(T.agree, { spentToday: tusd('7000000001') }), 'scope_exceeded'],
  ['agreement under an expired mandate', toAccepted, ev.agree(T.agree, { buyerScope: scope(['buyer'], { expiresAt: T.agree }) }), 'mandate_expired'],
  ['agreement by a non-member', toAccepted, ev.agree(T.agree, { memberAdmitted: false }), 'member_not_admitted'],
  ['agreement after offer expiry', toAccepted, ev.agree(T.offerExpiry), 'deadline_passed'],
  // fund guards
  ['funding below price plus fee', toAgreed, ev.fund(T.fund, { value: '2049999999' }), 'insufficient_funds'],
  ['funding without the gas buffer', toAgreed, ev.fund(T.fund, { balance: tusd('2050000000') }), 'insufficient_funds'],
  ['funding from someone other than the buyer', toAgreed, ev.fund(T.fund, { from: seller }), 'invalid_signature'],
  // deliver and reclaim guards
  ['delivery after deliverBy', toHeld, ev.deliver(T.deliverBy), 'deadline_passed'],
  ['a second submission (maxSubmissions = 1)', toHeld, ev.deliver(T.deliver, { attempt: 2 }), 'submission_limit_reached'],
  ['delivery without a key for the fallback adjudicator', toHeld, ev.deliver(T.deliver, { encryptedKeys: delivery().encryptedKeys.filter((k) => k.recipient !== fallback) }), 'invalid_terms'],
  ['delivery for another commitment', toHeld, ev.deliver(T.deliver, { commitmentId: ZERO32 }), 'invalid_terms'],
  ['reclaim before deliverBy', toHeld, ev.at('reclaim', T.deliver), 'invalid_state'],
  ['reclaim after delivery', toDelivered, ev.at('reclaim', T.deliverBy), 'invalid_state'],
  ['a second delivery', toDelivered, ev.deliver(), 'invalid_state'],
  // early accept
  ['early acceptance before delivery', toHeld, ev.earlyAccept(), 'invalid_state'],
  ['early acceptance by the seller', toDelivered, ev.earlyAccept(T.decide, seller), 'invalid_signature'],
  ['early acceptance during fallback judging', toFallback, ev.earlyAccept(T.fallbackDecide), 'invalid_state'],
  // decide guards
  ['the fallback deciding before judgeBy', toDelivered, ev.decide('fallback', 'accept', T.decide), 'not_your_turn'],
  ['an impostor signing as primary', toDelivered, ev.decide('primary', 'accept', T.decide, { adjudicator: seller }), 'not_your_turn'],
  ['the primary deciding at judgeBy', toDelivered, ev.decide('primary', 'accept', T.judgeBy), 'deadline_passed'],
  ['a seed that does not hash to the seed commitment', toDelivered, ev.decide('primary', 'accept', T.decide, { seed: ZERO32 }), 'seed_mismatch'],
  ['a decision under another policy', toDelivered, ev.decide('primary', 'accept', T.decide, { policyHash: ZERO32 }), 'policy_mismatch'],
  ['a decision under another registry', toDelivered, ev.decide('primary', 'accept', T.decide, { registryHash: ZERO32 }), 'registry_mismatch'],
  ['a decision on another attempt', toDelivered, ev.decide('primary', 'accept', T.decide, { attempt: 2 }), 'invalid_terms'],
  ['an expired decision message', toDelivered, ev.decide('primary', 'accept', T.decide, { expiresAt: T.deliver }), 'deadline_passed'],
  ['the primary deciding after fallback started', toFallback, ev.decide('primary', 'accept', T.fallbackDecide), 'not_your_turn'],
  ['the fallback deciding at fallbackBy', toFallback, ev.decide('fallback', 'accept', T.fallbackBy), 'deadline_passed'],
  ['the appeal adjudicator escalating again', toEscalated, ev.decide('appeal', 'escalate', T.fallbackDecide), 'invalid_terms'],
  ['the appeal adjudicator deciding an escalation late', toEscalated, ev.decide('appeal', 'accept', escalationDecideBy), 'deadline_passed'],
  ['a decision before any delivery', toHeld, ev.decide('primary', 'accept', T.deliver), 'invalid_state'],
  // timeouts
  ['fallback before judgeBy', toDelivered, ev.at('trigger_fallback', T.decide), 'invalid_state'],
  ['default before fallbackBy', toFallback, ev.at('trigger_default', T.fallbackDecide), 'invalid_state'],
  ['default of an escalation before appealDecideBy', toEscalated, ev.at('trigger_default', T.fallbackDecide), 'invalid_state'],
  ['expiring a held commitment', toHeld, ev.at('expire', T.deliverBy), 'invalid_state'],
  ['expiring an offer early', [], ev.at('expire', T.accept), 'invalid_state'],
  ['expiring an agreed commitment before fundBy', toAgreed, ev.at('expire', T.offerExpiry), 'invalid_state'],
  ['applying a default outcome without a default', toFallback, ev.at('apply_default_outcome', T.fallbackBy), 'invalid_state'],
  // appeals
  ['appealing a decision reached through escalation', [...toEscalated, ev.decide('appeal', 'accept', T.fallbackDecide)], ev.fileAppeal(), 'invalid_state'],
  ['appealing an early acceptance', [...toDelivered, ev.earlyAccept()], ev.fileAppeal(), 'invalid_state'],
  ['appealing a reclaim', [...toHeld, ev.at('reclaim', T.deliverBy)], ev.fileAppeal(T.deliverBy), 'invalid_state'],
  ['appealing at appealBy', toReleased, ev.fileAppeal(T.appealBy), 'deadline_passed'],
  ['appealing twice', toAppealOpen, ev.fileAppeal(), 'invalid_state'],
  ['appealing as the buyer from the seller address', toReleased, ev.fileAppeal(T.appealFiled, { appellantAddress: seller }), 'invalid_signature'],
  // T-206 L-7: only the party the decision went against appeals.
  ['appealing an accept as the seller it favoured', toReleased, ev.fileAppeal(T.appealFiled, { appellant: 'seller', appellantAddress: seller }), 'invalid_terms'],
  ['appealing a reject as the buyer it refunded', toRefunded, ev.fileAppeal(T.appealFiled, { appellant: 'buyer', appellantAddress: buyer }), 'invalid_terms'],
  ['an appeal decision with no appeal open', toReleased, ev.decide('appeal', 'reject', T.appealFiled), 'invalid_state'],
  ['an appeal decision by the primary', toAppealOpen, ev.decide('primary', 'reject', T.appealDecided), 'not_your_turn'],
  ['an appeal decision at appealDecideBy', toAppealOpen, ev.decide('appeal', 'reject', T.appealDecideBy), 'deadline_passed'],
  ['expiring an open appeal before appealDecideBy', toAppealOpen, ev.at('expire_appeal', T.appealDecided), 'invalid_state'],
  ['expiring the appeal window early', toReleased, ev.at('expire_appeal', T.appealFiled), 'invalid_state'],
  // guards the first mutation sweep showed were untested (T-004 review item 2)
  ['acceptance message already expired', [], ev.accept({ expiresAt: T.offer }), 'deadline_passed'],
  ['agreement signed by the seller', toAccepted, ev.agree(T.agree, { message: { buyer: seller } }), 'invalid_signature'],
  ['an expired agreement message', toAccepted, ev.agree(T.agree, { message: { expiresAt: T.accept } }), 'deadline_passed'],
  ['funding for another commitment', toAgreed, ev.fund(T.fund, { message: { commitmentId: ZERO32 } }), 'invalid_terms'],
  ['an expired funding authorization', toAgreed, ev.fund(T.fund, { message: { expiresAt: T.agree } }), 'deadline_passed'],
  ['funding before validAfter', toAgreed, ev.fund(T.fund, { message: { validAfter: T.offerExpiry } }), 'deadline_passed'],
  ['funding at validBefore', toAgreed, ev.fund(T.fund, { message: { validBefore: T.fund } }), 'deadline_passed'],
  ['funding under an expired buyer mandate', toAgreed, ev.fund(T.fund, { buyerScope: scope(['buyer'], { expiresAt: T.fund }) }), 'mandate_expired'],
  ['funding under a scope without the buyer role', toAgreed, ev.fund(T.fund, { buyerScope: scope(['seller']) }), 'scope_exceeded'],
  ['early acceptance for another commitment', toDelivered, ev.earlyAccept(T.decide, buyer, { commitmentId: ZERO32 }), 'invalid_terms'],
  ['early acceptance of another attempt', toDelivered, ev.earlyAccept(T.decide, buyer, { attempt: 2 }), 'invalid_terms'],
  ['an expired early acceptance', toDelivered, ev.earlyAccept(T.decide, buyer, { expiresAt: T.deliver }), 'deadline_passed'],
  // ADR-0029: every paying or judging signature names the posted delivery; a seller's second signed body never settles
  ['early acceptance of another signed delivery', toDelivered, ev.earlyAccept(T.decide, buyer, { deliveryHash: OTHER_DH }), 'invalid_terms'],
  ['a primary decision about another signed delivery', toDelivered, ev.decide('primary', 'accept', T.decide, { deliveryHash: OTHER_DH }), 'invalid_terms'],
  ['a fallback decision about another signed delivery', toFallback, ev.decide('fallback', 'reject', T.fallbackDecide, { deliveryHash: OTHER_DH }), 'invalid_terms'],
  ['an escalation decision about another signed delivery', toEscalated, ev.decide('appeal', 'accept', T.fallbackDecide, { deliveryHash: OTHER_DH }), 'invalid_terms'],
  ['an appeal decision about another body than the first instance judged', toAppealOpen, ev.decide('appeal', 'reject', T.appealDecided, { deliveryHash: OTHER_DH }), 'invalid_terms'],
  ['a decision for another commitment', toDelivered, ev.decide('primary', 'accept', T.decide, { commitmentId: ZERO32 }), 'invalid_terms'],
  ['an appeal ground on a first-instance decision', toDelivered, ev.decide('primary', 'reject', T.decide, { appealGround: 'wrong-outcome' }), 'invalid_terms'],
  ['the appeal adjudicator signing as primary on an escalation', toEscalated, ev.decide('primary', 'accept', T.fallbackDecide, { adjudicator: appealAdj }), 'not_your_turn'],
  ['the appeal adjudicator signing as fallback on an open appeal', toAppealOpen, ev.decide('fallback', 'reject', T.appealDecided, { adjudicator: appealAdj }), 'not_your_turn'],
  ['an appeal decision that escalates', toAppealOpen, ev.decide('appeal', 'escalate', T.appealDecided), 'invalid_terms'],
  ['an appeal for another commitment', toReleased, ev.fileAppeal(T.appealFiled, { commitmentId: ZERO32 }), 'invalid_terms'],
  ['an appeal bond in another token', toReleased, ev.fileAppeal(T.appealFiled, { bond: { token: 'tEUR', amount: '100000000' as TokenAmount['amount'] } }), 'invalid_terms'],
  ['a zero appeal bond', toReleased, ev.fileAppeal(T.appealFiled, { bond: tusd('0') }), 'insufficient_funds'],
  ['an appeal bond below the rulebook rate', toReleased, ev.fileAppeal(T.appealFiled, { bond: tusd('99999999') }), 'insufficient_funds'],
  ['an appeal fee below the rulebook fee', toReleased, ev.fileAppeal(T.appealFiled, {}, { feePaid: tusd('24999999') }), 'insufficient_funds'],
  ['a delivery without a key for the buyer', toHeld, ev.deliver(T.deliver, { encryptedKeys: delivery().encryptedKeys.filter((k) => k.recipient !== buyer) }), 'invalid_terms'],
  // second sweep: money-comparison error branches and the fundBy guard
  ['funding at fundBy with a message valid beyond it', toAgreed, ev.fund(T.fundBy, { message: { expiresAt: far, validBefore: far } }), 'deadline_passed'],
  ['the primary signing as fallback before judgeBy', toDelivered, ev.decide('fallback', 'accept', T.decide, { adjudicator: primary }), 'not_your_turn'],
  ['acceptance after offer expiry with a message valid beyond it', [], ev.accept({ expiresAt: far }, T.offerExpiry), 'deadline_passed'],
  ['a gas buffer in another token', toAgreed, ev.fund(T.fund, { gasBuffer: { token: 'tEUR', amount: '1' as TokenAmount['amount'] } }), 'invalid_terms'],
  ['a balance in another token', toAgreed, ev.fund(T.fund, { balance: { token: 'tEUR', amount: '3000000000' as TokenAmount['amount'] } }), 'invalid_terms'],
  ['an acceptance bond in another token', [], ev.accept({ bondReserved: { token: 'tEUR', amount: '2000000000' as TokenAmount['amount'] } }), 'invalid_terms'],
  ['a daily spend in another token', toAccepted, ev.agree(T.agree, { spentToday: { token: 'tEUR', amount: '0' as TokenAmount['amount'] } }), 'invalid_terms'],
  ['a daily cap in another token', toAccepted, ev.agree(T.agree, { buyerScope: scope(['buyer'], { maxDaily: { token: 'tEUR', amount: '9000000000' as TokenAmount['amount'] } }) }), 'invalid_terms'],
  ['a funding value that is not canonical base units', toAgreed, ev.fund(T.fund, { message: { value: '02050000000' } }), 'invalid_terms'],
  ['a funding authorization in another token', toAgreed, ev.fund(T.fund, { message: { token: 'tEUR' } }), 'invalid_terms'],
  // an unparseable clock must refuse, never fire a timeout (T-004 review item 5)
  ['expiring an offer with an unparseable time', [], ev.at('expire', 'garbage'), 'invalid_terms'],
  ['reclaiming with an unparseable time', toHeld, ev.at('reclaim', 'garbage'), 'invalid_terms'],
  ['triggering fallback with an unparseable time', toDelivered, ev.at('trigger_fallback', 'garbage'), 'invalid_terms'],
  ['triggering default with an empty time', toFallback, ev.at('trigger_default', ''), 'invalid_terms'],
  ['expiring an appeal with an unparseable time', toReleased, ev.at('expire_appeal', 'garbage'), 'invalid_terms'],
  ['deciding with an unparseable time', toDelivered, ev.decide('primary', 'accept', 'garbage'), 'invalid_terms'],
  // terminal states
  ['any event after expiry', [ev.at('expire', T.offerExpiry)], ev.accept(), 'invalid_state'],
  ['deciding a released commitment again as primary', toReleased, ev.decide('primary', 'reject', T.decide), 'invalid_state'],
];

describe('illegal transitions', () => {
  it.each(illegal)('refuses %s', (_name, path, event, problem) => {
    const r = stepF(run(path), event);
    expect(r.ok ? `ok: ${r.value.kind}` : r.error.type).toBe(problem);
  });
});

describe('totality', () => {
  const states: Array<[string, EscrowEvent[]]> = [
    ['Offered', []],
    ['AcceptedByAdjudicator', toAccepted],
    ['Agreed', toAgreed],
    ['Held', toHeld],
    ['Delivered', toDelivered],
    ['FallbackJudging', toFallback],
    ['Escalated', toEscalated],
    ['Released', toReleased],
    ['Refunded', toRefunded],
    ['Defaulted', toDefaulted],
    ['Expired', [ev.at('expire', T.offerExpiry)]],
    ['Settled', [...toHeld, ev.mutual(T.deliver)]],
  ];
  const events: EscrowEvent[] = [
    ev.accept(),
    ev.agree(),
    ev.fund(),
    ev.deliver(),
    ev.earlyAccept(),
    ev.decide('primary', 'accept', T.decide),
    ev.decide('fallback', 'reject', T.fallbackDecide),
    ev.decide('appeal', 'accept', T.appealDecided),
    ev.fileAppeal(),
    ev.mutual(T.deliver),
    ...(['reclaim', 'trigger_fallback', 'trigger_default', 'expire', 'apply_default_outcome', 'expire_appeal'] as const).map((t) => ev.at(t, far)),
  ];

  it('reaches every escrow state kind', () => {
    expect(new Set(states.map(([, p]) => run(p).kind)).size).toBe(12);
  });

  it.each(states)('every event on %s returns a state or a known problem type, never throws', (_name, path) => {
    const s = run(path);
    for (const e of events) {
      const r = stepF(s, e);
      if (!r.ok) expect(PROBLEM_TYPES).toContain(r.error.type);
    }
  });

  it('never mutates the input state', () => {
    const s = run(toDelivered);
    const snapshot = structuredClone(s);
    step(s, ev.decide('primary', 'accept', T.decide));
    expect(s).toEqual(snapshot);
  });
});

describe('panel seed per role (ADR-0018)', () => {
  const judgeByRound = secondsOf(T.judgeBy);
  const chosen = (role: Decision['role'], outcome: Decision['outcome'], at: string): EscrowEvent => ({ type: 'decide', at, message: decision(role, outcome), beacon: null });
  const decideWith = (role: 'fallback' | 'appeal', outcome: Decision['outcome'], at: string, round: number | null, over: Partial<Decision> = {}): EscrowEvent => {
    const value = round === null ? ZERO32 : testBeacon(round);
    return {
      type: 'decide',
      at,
      message: decision(role, outcome, { seed: panelSeed(id, role, 1, value), ...over }),
      beacon: round === null ? null : { round, value },
    };
  };

  it('fixes the fallback round at judgeBy, the escalation round one after the escalation, and the appeal round one after filing', () => {
    expect(beaconRoundFor(run(toDelivered), 'fallback')).toBe(judgeByRound);
    expect(beaconRoundFor(run(toFallback), 'fallback')).toBe(judgeByRound);
    expect(beaconRoundFor(run(toEscalated), 'appeal')).toBe(secondsOf(escalatedAt) + 1);
    expect(beaconRoundFor(run(toAppealOpen), 'appeal')).toBe(secondsOf(T.appealFiled) + 1);
    expect(beaconRoundFor(run(toReleased), 'appeal')).toBeNull();
    expect(beaconRoundFor(run(toHeld), 'fallback')).toBeNull();
  });

  it('records when the settlement layer opened the appeal', () => {
    const s = run(toAppealOpen);
    expect(s.kind === 'Released' && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && s.via.appeal.openedAt).toBe(T.appealFiled);
  });

  it.each<[string, EscrowEvent[], EscrowEvent, ProblemType | EscrowState['kind']]>([
    ['the fallback with the beacon seed for judgeBy', toFallback, decideWith('fallback', 'accept', T.fallbackDecide, judgeByRound), 'Released'],
    ['the fallback with a seed it chose', toFallback, chosen('fallback', 'accept', T.fallbackDecide), 'seed_mismatch'],
    ['the fallback with no beacon fact', toFallback, decideWith('fallback', 'accept', T.fallbackDecide, null), 'seed_mismatch'],
    ['the fallback at a later round it picked', toFallback, decideWith('fallback', 'accept', T.fallbackDecide, judgeByRound + 1), 'seed_mismatch'],
    ['the fallback whose signed beacon differs from the fact', toFallback, decideWith('fallback', 'accept', T.fallbackDecide, judgeByRound, { beacon: { source: 'sim', round: judgeByRound + 1, value: ZERO32 } }), 'seed_mismatch'],
    ['the appeal adjudicator after escalation with its round', toEscalated, decideWith('appeal', 'reject', T.fallbackDecide, secondsOf(escalatedAt) + 1), 'Refunded'],
    ['the appeal adjudicator after escalation with the fallback round', toEscalated, decideWith('appeal', 'reject', T.fallbackDecide, judgeByRound), 'seed_mismatch'],
    ['the appeal adjudicator after escalation with a seed it chose', toEscalated, chosen('appeal', 'reject', T.fallbackDecide), 'seed_mismatch'],
    ['the appeal adjudicator on a party appeal with its round', toAppealOpen, decideWith('appeal', 'reject', T.appealDecided, secondsOf(T.appealFiled) + 1), 'Released'],
    ['the appeal adjudicator on a party appeal with a seed it chose', toAppealOpen, chosen('appeal', 'reject', T.appealDecided), 'seed_mismatch'],
    ['the appeal adjudicator on a party appeal with the round at filing', toAppealOpen, decideWith('appeal', 'reject', T.appealDecided, secondsOf(T.appealFiled)), 'seed_mismatch'],
  ])('%s', (_name, path, event, expected) => {
    const r = step(run(path), event);
    expect(r.ok ? r.value.kind : r.error.type).toBe(expected);
  });

  // T-206 H-1: panelSeed hashes the attempt, so a free attempt would give every beacon role 256 valid seeds to pick from.
  it.each<[string, EscrowEvent[], 'fallback' | 'appeal', string, number]>([
    ['the fallback', toFallback, 'fallback', T.fallbackDecide, judgeByRound],
    ['the appeal adjudicator after escalation', toEscalated, 'appeal', T.fallbackDecide, secondsOf(escalatedAt) + 1],
    ['the appeal adjudicator on a party appeal', toAppealOpen, 'appeal', T.appealDecided, secondsOf(T.appealFiled) + 1],
  ])('binds %s to the delivered attempt, even with the matching seed for another', (_name, path, role, at, round) => {
    const s = run(path);
    const value = testBeacon(round);
    const onAttempt = (attempt: number) => step(s, { type: 'decide', at, message: decision(role, 'reject', { attempt, seed: panelSeed(id, role, attempt, value) }), beacon: { round, value } });
    expect(onAttempt(1).ok).toBe(true);
    const refused = new Set<string>();
    for (let attempt = 0; attempt <= 255; attempt++) {
      if (attempt === 1) continue;
      const r = onAttempt(attempt);
      refused.add(r.ok ? `ok: ${r.value.kind}` : r.error.type);
    }
    expect([...refused]).toEqual(['invalid_terms']);
  });

  it('derives the seed from the commitment, role, attempt and beacon only, never from what the decider controls', () => {
    const s = run(toFallback);
    const value = testBeacon(judgeByRound);
    const expected = panelSeed(id, 'fallback', 1, value);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 59 }), fc.constantFrom<Decision['outcome']>('accept', 'reject', 'escalate'), fc.uint8Array({ minLength: 32, maxLength: 32 }), (sec, outcome, nonceBytes) => {
        const at = new Date(Date.parse(T.judgeBy) + sec * 1000).toISOString();
        const nonce = `0x${Buffer.from(nonceBytes).toString('hex')}` as Hex;
        expect(beaconRoundFor(s, 'fallback')).toBe(judgeByRound);
        const ok = step(s, { type: 'decide', at, message: decision('fallback', outcome, { seed: expected, nonce }), beacon: { round: judgeByRound, value } });
        expect(ok.ok).toBe(true);
        const other = step(s, { type: 'decide', at, message: decision('fallback', outcome, { seed: keccak256(nonce), nonce }), beacon: { round: judgeByRound, value } });
        expect(other.ok ? 'ok' : other.error.type).toBe('seed_mismatch');
      }),
      { numRuns: 100, seed: 20261031 },
    );
  });
});

// T-217: a commitment counts its beacon rounds on the clock of the source its club rulebook names, so core agrees with
// the rules contract's beacon (DrandQuicknetBeacon on Sepolia) on every round.
describe('beacon rounds on the clock the rulebook names (ADR-0018 §6, T-217)', () => {
  const drandRulebook: Rulebook = { ...rulebook, randomness: { source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH } };
  // DrandQuicknetBeacon.roundAt as the contract computes it, with the constants read from its source.
  const sol = readFileSync(new URL('../../../contracts/src/DrandQuicknetBeacon.sol', import.meta.url), 'utf8');
  const constant = (name: string) => BigInt(new RegExp(`uint256 public constant ${name} = (\\d+);`).exec(sol)![1]!);
  const GENESIS = constant('GENESIS');
  const PERIOD = constant('PERIOD');
  const roundAt = (t: number): number => Number(BigInt(t) < GENESIS ? 0n : (BigInt(t) - GENESIS) / PERIOD + 1n);
  const atSecond = (t: number): string => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
  const drandOffered = (): EscrowState => ({ ...offered(), beaconSource: 'drand-quicknet' });
  const g = Number(GENESIS);

  it('keeps the rulebook source from the offer, and refuses a source with no beacon clock', () => {
    expect(offered().beaconSource).toBe('sim');
    const drand = offer(offerInput(withRulebook(drandRulebook)));
    expect(drand.ok && drand.value.beaconSource).toBe('drand-quicknet');
    const r = offer(offerInput(withRulebook({ ...rulebook, randomness: { source: 'prevrandao' } })));
    expect(r.ok ? 'ok' : r.error.type).toBe('invalid_terms');
    if (!r.ok) expect(r.error.detail).toContain('prevrandao');
  });

  it.each<[string, EscrowEvent[]]>([
    ['AcceptedByAdjudicator', toAccepted],
    ['Agreed', toAgreed],
    ['Held', toHeld],
    ['Delivered', toDelivered],
    ['FallbackJudging', toFallback],
    ['Escalated', toEscalated],
    ['Released by the primary', toReleased],
    ['Refunded by the primary', toRefunded],
    ['an open appeal', toAppealOpen],
    ['an overturning appeal', [...toAppealOpen, ev.decide('appeal', 'reject', T.appealDecided)]],
    ['an expired appeal', [...toReleased, ev.at('expire_appeal', far)]],
    ['Released by the fallback', [...toFallback, ev.decide('fallback', 'accept', T.fallbackDecide)]],
    ['Refunded after an escalation', [...toEscalated, ev.decide('appeal', 'reject', T.fallbackDecide)]],
    ['Defaulted', toDefaulted],
    ['Refunded by the default outcome', [...toDefaulted, ev.at('apply_default_outcome', T.fallbackBy)]],
    ['Expired', [ev.at('expire', T.offerExpiry)]],
    ['Settled', [...toHeld, ev.mutual(T.deliver)]],
    ['Released by an early accept', [...toDelivered, ev.earlyAccept()]],
    ['Refunded by a reclaim', [...toHeld, ev.at('reclaim', T.deliverBy)]],
  ])('keeps the source through %s', (_name, path) => {
    expect(run(path, drandOffered()).beaconSource).toBe('drand-quicknet');
  });

  it('counts the fallback and appeal rounds on the quicknet clock, and the sim rounds as before', () => {
    expect(beaconRoundFor(run(toFallback, drandOffered()), 'fallback')).toBe(roundAt(secondsOf(T.judgeBy)));
    expect(beaconRoundFor(run(toEscalated, drandOffered()), 'appeal')).toBe(roundAt(secondsOf(escalatedAt)) + 1);
    expect(beaconRoundFor(run(toAppealOpen, drandOffered()), 'appeal')).toBe(roundAt(secondsOf(T.appealFiled)) + 1);
    expect(beaconRoundFor(run(toFallback), 'fallback')).toBe(secondsOf(T.judgeBy));
    // A state saved before T-217 has no source: it counts on the sim clock, as it did.
    const { beaconSource: _, ...saved } = run(toFallback); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(beaconRoundFor(saved as EscrowState, 'fallback')).toBe(secondsOf(T.judgeBy));
  });

  it.each([
    ['the epoch', 0],
    ['a second before genesis', g - 1],
    ['genesis, round 1', g],
    ['a second into round 1', g + 1],
    ['the last second of round 1', g + 2],
    ['exactly on round 2', g + 3],
    ['exactly on round 33666095', g + (33_666_095 - 1) * 3],
    ['a second before round 33666095', g + (33_666_095 - 1) * 3 - 1],
  ])('agrees with DrandQuicknetBeacon.roundAt at %s', (_name, t) => {
    const fallback = run(toFallback, drandOffered());
    if (fallback.kind !== 'FallbackJudging') throw new Error('setup');
    expect(beaconRoundFor({ ...fallback, terms: { ...fallback.terms, timing: { ...fallback.terms.timing, judgeBy: atSecond(t) } } }, 'fallback')).toBe(roundAt(t));
    const escalated = run(toEscalated, drandOffered());
    if (escalated.kind !== 'Escalated') throw new Error('setup');
    expect(beaconRoundFor({ ...escalated, escalation: { ...escalated.escalation, at: atSecond(t) } }, 'appeal')).toBe(roundAt(t) + 1);
    const filed = run(toAppealOpen, drandOffered());
    if (filed.kind !== 'Released' || filed.via.kind !== 'first_instance' || filed.via.appeal.kind !== 'open') throw new Error('setup');
    expect(beaconRoundFor({ ...filed, via: { ...filed.via, appeal: { ...filed.via.appeal, openedAt: atSecond(t) } } }, 'appeal')).toBe(roundAt(t) + 1);
  });

  it('settles a fallback decision seeded from the quicknet round, and refuses one seeded from the sim round', () => {
    const s = run(toFallback, drandOffered());
    const withRound = (round: number): EscrowEvent => {
      const value = testBeacon(round);
      return { type: 'decide', at: T.fallbackDecide, message: decision('fallback', 'accept', { seed: panelSeed(id, 'fallback', 1, value), beacon: { source: 'drand-quicknet', round, value, signature: `0x${'8f'.repeat(48)}` } }), beacon: { round, value } };
    };
    const ok = step(s, withRound(roundAt(secondsOf(T.judgeBy))));
    expect(ok.ok ? ok.value.kind : ok.error.type).toBe('Released');
    const sim = step(s, withRound(secondsOf(T.judgeBy)));
    expect(sim.ok ? sim.value.kind : sim.error.type).toBe('seed_mismatch');
  });
});

// ADR-0029: the read model's deliveryHash, exactly as commitment-state.schema.json describes it.
describe('postedDeliveryHash', () => {
  it.each<[string, EscrowEvent[], Hex | undefined]>([
    ['Held, before a delivery', toHeld, undefined],
    ['Delivered', toDelivered, DH],
    ['FallbackJudging', toFallback, DH],
    ['Escalated', toEscalated, DH],
    ['Released by the primary', toReleased, DH],
    ['an open appeal', toAppealOpen, DH],
    ['Released by an early accept', [...toDelivered, ev.earlyAccept()], DH],
    ['Settled after a delivery', [...toDelivered, ev.mutual(T.decide, { deliveryHash: DH })], DH],
    ['Settled before a delivery', [...toHeld, ev.mutual(T.deliver)], undefined],
    ['Defaulted', toDefaulted, undefined],
    ['Refunded by the default outcome', [...toDefaulted, ev.at('apply_default_outcome', T.fallbackBy)], undefined],
    ['Refunded by a reclaim', [...toHeld, ev.at('reclaim', T.deliverBy)], undefined],
  ])('%s', (_name, path, expected) => {
    expect(postedDeliveryHash(run(path))).toBe(expected);
  });
});

describe('mutual settlement (ADR-0019, D23 payouts)', () => {
  const dh = DH;
  const settledView = (s: EscrowState) => (s.kind === 'Settled' ? { payouts: s.payouts, keyReleased: s.keyReleased, settledAt: s.settledAt } : s.kind);

  it.each<[string, EscrowEvent[], EscrowEvent, { payouts: ReturnType<typeof split>; keyReleased: boolean }]>([
    ['refund-before-delivery split in Held', toHeld, ev.mutual(T.deliver), { payouts: split('1400000000', '600000000'), keyReleased: false }],
    ['discounted acceptance in Delivered', toDelivered, ev.mutual(T.decide, { deliveryHash: dh, releaseKey: true }), { payouts: split('1400000000', '600000000'), keyReleased: true }],
    ['full price, key kept, during fallback judging', toFallback, ev.mutual(T.fallbackDecide, { deliveryHash: dh, payouts: split('2000000000', '0') }), { payouts: split('2000000000', '0'), keyReleased: false }],
    ['all to the buyer while escalated', toEscalated, ev.mutual(T.fallbackDecide, { deliveryHash: dh, payouts: split('0', '2000000000') }), { payouts: split('0', '2000000000'), keyReleased: false }],
    [
      'a third-party payout when the rulebook allows any recipient',
      toHeld,
      ev.mutual(T.deliver, { payouts: [...split('1000000000', '500000000'), { to: outsider, amount: tusd('500000000') }] }, { allowed: true, payoutsTo: 'any' }),
      { payouts: [...split('1000000000', '500000000'), { to: outsider, amount: tusd('500000000') }], keyReleased: false },
    ],
  ])('settles: %s', (_name, path, event, expected) => {
    const r = step(run(path), event);
    if (!r.ok) throw new Error(`${r.error.type}: ${r.error.detail}`);
    expect(settledView(r.value)).toEqual({ ...expected, settledAt: event.at });
  });

  it.each<[string, EscrowEvent[], EscrowEvent, ProblemType]>([
    ['releasing a key that does not exist yet', toHeld, ev.mutual(T.deliver, { releaseKey: true }), 'invalid_terms'],
    ['a stale delivery hash', toDelivered, ev.mutual(T.decide, { deliveryHash: ZERO32 }), 'invalid_terms'],
    ['a null delivery hash after delivery', toDelivered, ev.mutual(T.decide), 'invalid_terms'],
    ['payouts above the price', toHeld, ev.mutual(T.deliver, { payouts: split('1400000001', '600000000') }), 'invalid_terms'],
    ['payouts below the price', toHeld, ev.mutual(T.deliver, { payouts: split('1400000000', '599999999') }), 'invalid_terms'],
    ['a payout in another token', toHeld, ev.mutual(T.deliver, { payouts: [{ to: seller, amount: { token: 'tEUR', amount: '2000000000' as TokenAmount['amount'] } }] }), 'invalid_terms'],
    ['a third-party payout when the rulebook allows the parties only', toHeld, ev.mutual(T.deliver, { payouts: [...split('1000000000', '500000000'), { to: outsider, amount: tusd('500000000') }] }), 'invalid_terms'],
    ['a rulebook that does not allow it', toHeld, ev.mutual(T.deliver, {}, { allowed: false, payoutsTo: 'parties' }), 'invalid_terms'],
    ['an expired settlement message', toHeld, ev.mutual(T.deliver, { expiresAt: T.fund }), 'deadline_passed'],
    ['a settlement for another commitment', toHeld, ev.mutual(T.deliver, { commitmentId: ZERO32 }), 'invalid_terms'],
    ['settling after a decision moved the funds', toReleased, ev.mutual(T.decide, { deliveryHash: dh }), 'invalid_state'],
    ['settling in Defaulted', toDefaulted, ev.mutual(T.fallbackBy, { deliveryHash: dh }), 'invalid_state'],
    ['settling before funding', toAgreed, ev.mutual(T.fund), 'invalid_state'],
    ['settling twice', [...toHeld, ev.mutual(T.deliver)], ev.mutual(T.deliver), 'invalid_state'],
    ['a decision after the settlement (race: settlement applied first)', [...toDelivered, ev.mutual(T.decide, { deliveryHash: dh })], ev.decide('primary', 'accept', T.decide), 'invalid_state'],
    ['a settlement after the decision (race: decision applied first)', [...toDelivered, ev.decide('primary', 'accept', T.decide)], ev.mutual(T.decide, { deliveryHash: dh }), 'invalid_state'],
    ['appealing a settlement', [...toHeld, ev.mutual(T.deliver)], ev.fileAppeal(), 'invalid_state'],
  ])('refuses %s', (_name, path, event, type) => {
    const r = stepF(run(path), event);
    expect(r.ok ? `ok: ${r.value.kind}` : r.error.type).toBe(type);
  });
});

// T-357, ADR-0031 SC-5b, ADR-0019 as amended 2026-11-12: in Held, a settlement both parties signed may name a delivery
// nobody posted and release its key, under exactly the checks of HoldbackRules.mutualSettle (:370-382). The late
// delivery travels with the settlement, as the contract's `dv` and key proof do.
describe('late-work settlement in Held (SC-5b)', () => {
  const late = '2026-11-01T11:00:00Z'; // after deliverBy: no delivery can land any more
  const lateDelivery = delivery({ submittedAt: late, ciphertext: { uri: 'file:///store/late', sha256: `sha256:${'e'.repeat(64)}`, bytes: 120, cipher: 'aes-256-gcm' } });
  const LATE_DH = deliveryHash(lateDelivery);
  const carried = (at: string, over: Partial<MutualSettlement>, d: Delivery | undefined): EscrowEvent => {
    const e = ev.mutual(at, over) as Extract<EscrowEvent, { type: 'mutual_settle' }>;
    return d ? { ...e, delivery: d } : e;
  };
  const settledView = (s: EscrowState) => (s.kind === 'Settled' ? { from: s.from, keyReleased: s.keyReleased, deliveryHash: postedDeliveryHash(s) } : s.kind);

  it.each<[string, EscrowEvent, { from: string; keyReleased: boolean; deliveryHash: Hex | undefined }]>([
    ['late work after deliverBy, key released from the delivery it names', carried(late, { deliveryHash: LATE_DH, releaseKey: true }, lateDelivery), { from: 'Held', keyReleased: true, deliveryHash: LATE_DH }],
    ['the same before deliverBy: the contract sets no deadline on a settlement', carried(T.deliver, { deliveryHash: LATE_DH, releaseKey: true }, lateDelivery), { from: 'Held', keyReleased: true, deliveryHash: LATE_DH }],
    ['a delivery named and its key kept: the contract checks nothing more (:370, :379)', carried(late, { deliveryHash: LATE_DH, releaseKey: false }, undefined), { from: 'Held', keyReleased: false, deliveryHash: LATE_DH }],
    ['a carried delivery with only the buyer envelope: the key proof reads only that one (:381)', carried(late, { deliveryHash: deliveryHash(delivery({ encryptedKeys: [{ recipient: buyer, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }] })), releaseKey: true }, delivery({ encryptedKeys: [{ recipient: buyer, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }] })), { from: 'Held', keyReleased: true, deliveryHash: deliveryHash(delivery({ encryptedKeys: [{ recipient: buyer, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }] })) }],
  ])('settles: %s', (_name, event, expected) => {
    const r = step(run(toHeld), event);
    if (!r.ok) throw new Error(`${r.error.type}: ${r.error.detail}`);
    expect(settledView(r.value)).toEqual(expected);
  });

  // Each refusal is one the contract makes too, named by its revert.
  it.each<[string, EscrowEvent, ProblemType, RegExp]>([
    ['releasing a key with no delivery named (InvalidMessage, :370)', carried(late, { releaseKey: true }, lateDelivery), 'invalid_terms', /releaseKey needs a delivery/],
    ['releasing a key with no delivery carried (BadKeyProof, :380)', carried(late, { deliveryHash: LATE_DH, releaseKey: true }, undefined), 'invalid_terms', /carries no delivery/],
    ['a carried delivery that is not the one both signed (BadKeyProof, :380)', carried(late, { deliveryHash: LATE_DH, releaseKey: true }, delivery()), 'invalid_terms', /does not hash to/],
    ['a delivery for another commitment (BadKeyProof, :380: the contract hashes with this id)', carried(late, { deliveryHash: deliveryHash(delivery({ commitmentId: ZERO32 })), releaseKey: true }, delivery({ commitmentId: ZERO32 })), 'invalid_terms', /another commitment/],
    ['a carried delivery with no envelope for the buyer (BadKeyProof, :381)', carried(late, { deliveryHash: deliveryHash(delivery({ encryptedKeys: [{ recipient: primary, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }] })), releaseKey: true }, delivery({ encryptedKeys: [{ recipient: primary, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }] })), 'invalid_terms', /no envelope for the buyer/],
    ['an expired settlement message (MessageExpired, :369)', carried(late, { deliveryHash: LATE_DH, releaseKey: true, expiresAt: late }, lateDelivery), 'deadline_passed', /expired/],
    ['payouts that do not sum to the price (InvalidMessage, _payOut :408)', carried(late, { deliveryHash: LATE_DH, releaseKey: true, payouts: split('1400000001', '600000000') }, lateDelivery), 'invalid_terms', /must equal the price/],
  ])('refuses %s', (_name, event, type, detail) => {
    const r = step(run(toHeld), event);
    expect(r.ok ? `ok: ${r.value.kind}` : r.error.type).toBe(type);
    if (!r.ok) expect(r.error.detail).toMatch(detail);
  });

  it('reads the carried delivery only in Held: after a delivery the settlement names the posted one (:374)', () => {
    const r = step(run(toDelivered), carried(T.decide, { deliveryHash: LATE_DH, releaseKey: true }, lateDelivery));
    expect(r.ok ? `ok: ${r.value.kind}` : r.error.detail).toMatch(/does not name the current delivery/);
  });

  it('a reclaim that lands first ends the deal: the late settlement is refused (settle once)', () => {
    const r = step(run([...toHeld, ev.at('reclaim', T.deliverBy)]), carried(late, { deliveryHash: LATE_DH, releaseKey: true }, lateDelivery));
    expect(r.ok ? `ok: ${r.value.kind}` : r.error.type).toBe('invalid_state');
  });
});

// A small valid-looking change to the current value, so most mutants still parse and reach core.
const NUDGE = Symbol('nudge');
function nudge(v: unknown): unknown {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v + 1;
  if (typeof v !== 'string') return v;
  if (/^0x[0-9a-fA-F]+$/.test(v)) return v.slice(0, -1) + (v.endsWith('0') ? '1' : '0');
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(Date.parse(v) + 1000).toISOString().replace('.000Z', 'Z');
  if (/^\d+$/.test(v)) return (BigInt(v) + 1n).toString();
  return `${v}x`;
}
// Fixed seed: property runs are reproducible, so the suite and the mutation sweep are deterministic.
const SEED = 20261030;

// Every message a parser accepts, in every reachable state, gives a state or a problem: never a throw.
describe('step never throws on parsed input', () => {
  const states: EscrowEvent[][] = [[], toAccepted, toAgreed, toHeld, toDelivered, toFallback, toEscalated, toReleased, toAppealOpen, toDefaulted];
  const built = states.map((path) => run(path));
  const anyValue = fc.oneof(
    fc.constant(NUDGE),
    fc.constant(NUDGE),
    fc.constantFrom<unknown>('2026-11-01T10:01:00Z', '2026-10-30T10:30:00.500Z', '1969-12-31T23:59:59Z', 0, 1, 2, 255, 2 ** 60, '0', (2n ** 256n).toString(), buyer, seller, primary, appealAdj, ZERO32, 'escalate', 'appeal', 'fallback'),
    fc.string(),
    fc.integer(),
    fc.double(),
    fc.boolean(),
  );
  const edits = fc.array(fc.tuple(fc.nat(), anyValue), { minLength: 1, maxLength: 3 });

  function leafPaths(value: unknown, path: string[] = []): string[][] {
    if (Array.isArray(value)) return value.flatMap((v, i) => leafPaths(v, [...path, String(i)]));
    if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...path, k]));
    return [path];
  }
  function mutated(base: unknown, e: Array<[number, unknown]>): unknown {
    const copy = structuredClone(base) as Record<string, unknown>;
    const paths = leafPaths(copy);
    for (const [i, v] of e) {
      const path = paths[i % paths.length]!;
      let cur = copy;
      for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
      const key = path[path.length - 1]!;
      cur[key] = v === NUDGE ? nudge(cur[key]) : v;
    }
    return copy;
  }

  const fundEvent = ev.fund();
  const agreeEvent = ev.agree();
  const acceptEvent = ev.accept();
  const appealEvent = ev.fileAppeal();
  type Case = [string, unknown, (json: unknown) => EscrowEvent | undefined];
  const cases: Case[] = [
    ['Decision', decision('primary', 'accept'), (j) => { const r = parseMessage(j); return r.ok && r.value.type === 'Decision' ? { type: 'decide', at: T.decide, message: r.value } : undefined; }],
    ['EarlyAccept', (ev.earlyAccept() as Extract<EscrowEvent, { type: 'early_accept' }>).message, (j) => { const r = parseMessage(j); return r.ok && r.value.type === 'EarlyAccept' ? { type: 'early_accept', at: T.decide, message: r.value } : undefined; }],
    ['Agree', (agreeEvent as Extract<EscrowEvent, { type: 'agree' }>).message, (j) => { const r = parseMessage(j); return r.ok && r.value.type === 'Agree' ? { ...(agreeEvent as Extract<EscrowEvent, { type: 'agree' }>), message: r.value } : undefined; }],
    ['AdjudicatorAcceptance', acceptance(), (j) => { const r = parseMessage(j); return r.ok && r.value.type === 'AdjudicatorAcceptance' ? { ...(acceptEvent as Extract<EscrowEvent, { type: 'adjudicator_accept' }>), message: r.value } : undefined; }],
    ['FundingAuthorization', (fundEvent as Extract<EscrowEvent, { type: 'fund' }>).message, (j) => { const r = parseMessage(j); return r.ok && r.value.type === 'FundingAuthorization' ? { ...(fundEvent as Extract<EscrowEvent, { type: 'fund' }>), message: r.value } : undefined; }],
    ['Delivery', delivery(), (j) => { const r = parseDelivery(j); return r.ok ? { type: 'deliver', at: T.deliver, delivery: r.value } : undefined; }],
    ['Appeal', appeal(), (j) => { const r = parseAppeal(j); return r.ok ? { ...(appealEvent as Extract<EscrowEvent, { type: 'file_appeal' }>), appeal: r.value } : undefined; }],
  ];

  it.each(cases)('%s', (_name, base, toEvent) => {
    expect(toEvent(base)).toBeDefined(); // the baseline itself parses
    let accepted = 0;
    fc.assert(
      fc.property(edits, (e) => {
        const event = toEvent(mutated(base, e));
        if (!event) return;
        accepted++;
        for (const s of built) {
          const r = step(s, event);
          if (!r.ok) expect(PROBLEM_TYPES).toContain(r.error.type);
        }
      }),
      { numRuns: 300, seed: SEED },
    );
    expect(accepted).toBeGreaterThan(20);
  });
});

// T-346 (SC-7, ADR-0031 §8): the phase-one profile refuses what the phase-one contracts refuse. The full
// protocol, above, is unchanged and stays the default.
describe('phase_one profile', () => {
  const phaseOne = (events: EscrowEvent[], from: EscrowState = offered()): EscrowState => {
    let s = from;
    for (const e of events) {
      const r = step(s, fill(s, e), 'phase_one');
      if (!r.ok) throw new Error(`phase-one step ${e.type} failed in ${s.kind}: ${r.error.type} ${r.error.detail}`);
      s = r.value;
    }
    return s;
  };
  const zeroBond = { bondReserved: tusd('0') };
  const toHeldP1 = [ev.accept(zeroBond, T.accept, tusd('0')), ev.agree(), ev.fund()];
  const toDeliveredP1 = [...toHeldP1, ev.deliver()];

  it('takes an acceptance that reserves 0 and reads no free bond', () => {
    expect(phaseOne([ev.accept(zeroBond, T.accept, tusd('0'))]).kind).toBe('AcceptedByAdjudicator');
  });

  it.each([
    ['the price', terms.price],
    ['one base unit', tusd('1')],
    ['0 in another token', { token: 'tEUR', amount: '0' as TokenAmount['amount'] }],
  ])('refuses an acceptance that reserves %s', (_, bondReserved) => {
    const r = step(offered(), ev.accept({ bondReserved }), 'phase_one');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('acceptance_mismatch');
  });

  it('keeps the full rule by default: an acceptance reserving 0 is below the price', () => {
    const r = step(offered(), ev.accept(zeroBond));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('coverage_exceeded');
  });

  it.each([
    ['primary accept', ev.decide('primary', 'accept', T.decide), 'Released'],
    ['primary reject', ev.decide('primary', 'reject', T.decide), 'Refunded'],
  ])('a %s is final at the decision: its appeal state is closed with no appeal', (_, decide, kind) => {
    const s = phaseOne([...toDeliveredP1, decide]);
    expect(s.kind).toBe(kind);
    if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
      // Red team RT-3: not `none` with appealBy reached, which readers take for an appeal expiry due now.
      expect(s.via.appeal).toEqual({ kind: 'expired', appeal: null });
    } else {
      throw new Error('not a first-instance decision');
    }
  });

  it("the fallback's decision is final at the decision too", () => {
    const s = phaseOne([...toDeliveredP1, ev.at('trigger_fallback', T.judgeBy), ev.decide('fallback', 'accept', T.fallbackDecide)]);
    expect(s.kind).toBe('Released');
    if (s.kind === 'Released' && s.via.kind === 'first_instance') {
      expect(s.via.appeal).toEqual({ kind: 'expired', appeal: null });
    }
  });

  it.each([
    ['a party appeal', ev.fileAppeal(T.decide)],
    ['an appeal expiry', ev.at('expire_appeal', T.appealBy)],
    ['an appeal decision', ev.decide('appeal', 'reject', T.appealFiled)],
  ])('refuses %s on a decided deal', (_, e) => {
    const s = phaseOne([...toDeliveredP1, ev.decide('primary', 'accept', T.decide)]);
    const r = step(s, fill(s, e), 'phase_one');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('invalid_state');
      expect(r.error.detail).toContain('phase one has no party appeal');
    }
  });

  it('an escalation is still decided by the appeal adjudicator, finally', () => {
    const s = phaseOne([...toDeliveredP1, ev.decide('primary', 'escalate', escalatedAt), ev.decide('appeal', 'accept', escalationDecideBy.replace('10:06', '10:02'))]);
    expect(s.kind).toBe('Released');
    if (s.kind === 'Released') expect(s.via.kind).toBe('escalation');
  });
});
