import { readFileSync } from 'node:fs';
import { keccak256, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { rulebookHash } from './canonical.js';
import { commitmentId, termsOf } from './eip712.js';
import type { TokenAmount } from './money/index.js';
import { parseClub, parseCommitment } from './parse.js';
import { PROBLEM_TYPES, type ProblemType } from './problem.js';
import { offer, step, type EscrowEvent, type EscrowState, type OfferInput } from './state.js';
import type { AdjudicatorAcceptance, Appeal, Commitment, Decision, Delivery, Rulebook, Scope } from './types.js';

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
function commitmentFor(rb: Rulebook): Commitment {
  const t = { ...termsOf(exampleCommitment), rulebookHash: rulebookHash(rb) };
  return { ...t, id: commitmentId(t), signatures: { seller: SIG } };
}
const commitment = commitmentFor(rulebook);
const terms = termsOf(commitment);
const id = commitment.id;
const withRulebook = (rb: Rulebook): Partial<OfferInput> => ({ rulebook: rb, commitment: commitmentFor(rb) });
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

const decision = (role: Decision['role'], outcome: Decision['outcome'], over: Partial<Decision> = {}): Decision => ({
  type: 'Decision',
  commitmentId: id,
  attempt: 1,
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

const ev = {
  accept: (over: Partial<AdjudicatorAcceptance> = {}, at = T.accept, bond = tusd('10000000000')): EscrowEvent => ({
    type: 'adjudicator_accept',
    at,
    message: acceptance(over),
    unencumberedBond: bond,
  }),
  agree: (at = T.agree, over: { buyerScope?: Scope; spentToday?: TokenAmount; memberAdmitted?: boolean; commitmentId?: Hex } = {}): EscrowEvent => ({
    type: 'agree',
    at,
    message: { type: 'Agree', commitmentId: over.commitmentId ?? id, buyer, nonce: ZERO32, expiresAt: far, signature: SIG },
    buyerScope: over.buyerScope ?? scope(['buyer']),
    spentToday: over.spentToday ?? tusd('0'),
    memberAdmitted: over.memberAdmitted ?? true,
  }),
  fund: (at = T.fund, over: { from?: Hex; value?: string; balance?: TokenAmount } = {}): EscrowEvent => ({
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
    },
    balance: over.balance ?? tusd('3000000000'),
    gasBuffer: tusd('1000000'),
  }),
  deliver: (at = T.deliver, over: Partial<Delivery> = {}): EscrowEvent => ({ type: 'deliver', at, delivery: delivery(over) }),
  earlyAccept: (at = T.decide, by: Hex = buyer): EscrowEvent => ({
    type: 'early_accept',
    at,
    message: { type: 'EarlyAccept', commitmentId: id, buyer: by, attempt: 1, nonce: ZERO32, expiresAt: far, signature: SIG },
  }),
  decide: (role: Decision['role'], outcome: Decision['outcome'], at: string, over: Partial<Decision> = {}): EscrowEvent => ({
    type: 'decide',
    at,
    message: decision(role, outcome, over),
  }),
  fileAppeal: (at = T.appealFiled, over: Partial<Appeal> = {}): EscrowEvent => ({ type: 'file_appeal', at, appeal: appeal(over) }),
  at: (type: 'reclaim' | 'trigger_fallback' | 'trigger_default' | 'expire' | 'apply_default_outcome' | 'expire_appeal', at: string): EscrowEvent => ({ type, at }),
};

function run(events: EscrowEvent[]): EscrowState {
  const start = offer(offerInput());
  if (!start.ok) throw new Error(`offer failed: ${start.error.detail}`);
  let s: EscrowState = start.value;
  for (const e of events) {
    const r = step(s, e);
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
    ['a rulebook whose hash is not the one the terms bind', { rulebook: { ...rulebook, appealBondRate: 0.06 } }, 'rulebook_unknown'],
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
    const r = step(run(path), event);
    if (!r.ok) throw new Error(`${r.error.type}: ${r.error.detail}`);
    expect(r.value.kind).toBe(to);
    expect(appealKind(r.value)).toBe(appealState);
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
  ['acceptance after offer expiry', [], ev.accept({}, T.offerExpiry), 'deadline_passed'],
  // agree guards
  ['agreement to other terms', toAccepted, ev.agree(T.agree, { commitmentId: ZERO32 }), 'invalid_terms'],
  ['agreement without the buyer role', toAccepted, ev.agree(T.agree, { buyerScope: scope(['seller']) }), 'scope_exceeded'],
  ['agreement above the daily cap', toAccepted, ev.agree(T.agree, { spentToday: tusd('7000000001') }), 'scope_exceeded'],
  ['agreement under an expired mandate', toAccepted, ev.agree(T.agree, { buyerScope: scope(['buyer'], { expiresAt: T.agree }) }), 'mandate_expired'],
  ['agreement by a non-member', toAccepted, ev.agree(T.agree, { memberAdmitted: false }), 'member_not_admitted'],
  ['agreement after offer expiry', toAccepted, ev.agree(T.offerExpiry), 'deadline_passed'],
  // fund guards
  ['funding after fundBy', toAgreed, ev.fund(T.fundBy), 'deadline_passed'],
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
  ['an appeal decision with no appeal open', toReleased, ev.decide('appeal', 'reject', T.appealFiled), 'invalid_state'],
  ['an appeal decision by the primary', toAppealOpen, ev.decide('primary', 'reject', T.appealDecided), 'not_your_turn'],
  ['an appeal decision at appealDecideBy', toAppealOpen, ev.decide('appeal', 'reject', T.appealDecideBy), 'deadline_passed'],
  ['expiring an open appeal before appealDecideBy', toAppealOpen, ev.at('expire_appeal', T.appealDecided), 'invalid_state'],
  ['expiring the appeal window early', toReleased, ev.at('expire_appeal', T.appealFiled), 'invalid_state'],
  // terminal states
  ['any event after expiry', [ev.at('expire', T.offerExpiry)], ev.accept(), 'invalid_state'],
  ['deciding a released commitment again as primary', toReleased, ev.decide('primary', 'reject', T.decide), 'invalid_state'],
];

describe('illegal transitions', () => {
  it.each(illegal)('refuses %s', (_name, path, event, problem) => {
    const r = step(run(path), event);
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
    ...(['reclaim', 'trigger_fallback', 'trigger_default', 'expire', 'apply_default_outcome', 'expire_appeal'] as const).map((t) => ev.at(t, far)),
  ];

  it('reaches every escrow state kind', () => {
    expect(new Set(states.map(([, p]) => run(p).kind)).size).toBe(11);
  });

  it.each(states)('every event on %s returns a state or a known problem type, never throws', (_name, path) => {
    const s = run(path);
    for (const e of events) {
      const r = step(s, e);
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
