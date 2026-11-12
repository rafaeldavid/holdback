// Prepare, sign, submit (D30, docs/api.md "Prepare and sign"). For each party message an agent sends, the
// operator turns plain inputs into the exact EIP-712 typed data to sign, its digest, and the body to submit
// with the signature slot(s) named. The operator never signs and never holds a party key: the agent checks the
// typed data (the response says which fields matter), signs it with any EIP-712 library, puts the signature in
// the named slot and POSTs the body to the write route the response names. The typed data is a pure function of
// the inputs and of the defaults the response states (times, and the default adjudicators of ADR-0030), so an
// agent can recompute it. Prepare hides
// nothing (D39): the caller sends every nonce and chooses the disclosure level; the operator derives neither.
import {
  deliveryHash,
  parseDelivery,
  parseCommitment,
  plusSeconds,
  wholeSecond,
  commitmentId,
  isSealed,
  eip712Types,
  messageDigest,
  mulBps,
  operatorFeeDue,
  operatorFeeRule,
  splitBps,
  termsDigest,
  typedDataOf,
  typedTermsOf,
  type AdjudicatorRegistration,
  type AdjudicatorRole,
  type Address,
  type Club,
  type AnyCommitment,
  type AnyCommitmentTerms,
  type DisclosureLevel,
  type CommitmentStateView,
  type CommitmentTerms,
  type DeterministicCheck,
  type Delivery,
  type EncryptedKey,
  type Hex32,
  type HoldbackDomain,
  type MimeType,
  type OperatorFeeSchedule,
  type Payout,
  type RegisteredAdjudicator,
  type Sha256,
  type Timestamp,
  type TokenAmount,
  type UnsignedMessage,
  validateTiming,
  APPEAL_WINDOW_PROBLEM,
  ZERO_HOLD_PROBLEM,
  PHASE_ONE_NO_APPEAL,
} from '@holdback/core';
import type { ApiProblem } from './problems.js';
import { freeBond, hasBond, type Bond } from './registrations.js';
import { checksOnlyTerms, completeTerms, defaultTerms, type AdjudicatorSlate, type RelativeTiming, type TermsDraft } from './terms.js';
import { amountTokenRefusal, tokenRefusal, type AcceptedToken } from './token.js';
import { formatTusd } from './units.js';

export const PREPARE_KINDS = ['offer', 'agree-and-fund', 'delivery', 'early-accept', 'appeal', 'settlement'] as const;
export type PrepareKind = (typeof PREPARE_KINDS)[number];

/**
 * JSON-safe EIP-712 typed data. Every uint/int field of the message is a decimal string (amounts can exceed
 * 2^53); convert them to integers before hashing, then compare the hash with `digest`. domain.chainId is a number.
 */
export interface TypedDataJson {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface Prepared {
  kind: PrepareKind;
  commitmentId: Hex32;
  /** One entry per signature: who signs, where the signature goes in submit.body, what to sign. */
  sign: Array<{ slot: string; signer: Address; typedData: TypedDataJson; digest: Hex32 }>;
  /** POST this body (signatures filled in) with an Idempotency-Key header. */
  submit: { method: 'POST'; path: string; body: Record<string, unknown> };
  /** Verify before you sign: the facts in this message, in words. */
  check: string[];
  /** What the operator filled in because the caller left it out (times, releaseKey, adjudicators; never a nonce), to pass back for the same bytes. */
  defaults: Record<string, unknown>;
  /** Advisory notices from this node (untrusted text): what to know before signing. Absent when there are none. */
  notices?: string[];
}

/** The reason a phase-one settlement gives a party appeal, from core, where it is written once (ADR-0031 §8). */
export { PHASE_ONE_NO_APPEAL };

/** What preparing needs from the operator's view of the settlement layer. Reads only. */
export interface PrepareContext {
  /** True on the phase-one contracts (ADR-0031 §8): no bonds and no party appeals. Absent: the full protocol (SimChain). */
  phaseOne?: boolean;
  domain: HoldbackDomain;
  now(): Timestamp;
  club(id: string): Club | undefined;
  /** A stored registration (ADR-0030), or a world's own record; null when this node has none. */
  registration(address: Address): Promise<AdjudicatorRegistration | RegisteredAdjudicator | null>;
  /** Any address's bond pool read live: undefined when this node has no reader, `unreadable` when the read failed. */
  bond?(address: Address): Promise<Bond | 'unreadable' | undefined>;
  /** ADR-0030 §4: this node's adjudicator for each role an offer leaves out. */
  defaultAdjudicators?: Record<AdjudicatorRole, Address>;
  /**
   * Why this node's own adjudicator at `address` would decline `role` on these terms, from the terms alone (T-221
   * review): null when it would take the role, undefined when `address` is not one of this node's adjudicators.
   */
  declines?(address: Address, role: AdjudicatorRole, commitment: AnyCommitment): Promise<string | null | undefined>;
  /** Either wire form: at private and judgment the bodies are ciphertext this operator cannot read (ADR-0024). */
  commitment(id: Hex32): Promise<AnyCommitment | undefined>;
  /** The last delivery event's payload, if any. */
  delivery(id: Hex32): Promise<{ deliveryHash: Hex32; attempt: number } | undefined>;
  attempt(id: Hex32): Promise<number>;
  /** The commitment's read model, or null when the settlement layer does not know it. */
  state(id: Hex32): Promise<CommitmentStateView | null>;
  /** ADR-0023: this node's published fee schedule, if it charges one. */
  operatorFee?: OperatorFeeSchedule;
  /** On an EVM settlement layer: what the buyer signs to fund and to pay the operator fee (ADR-0025). */
  erc3009?: Erc3009Signing;
  /**
   * This deployment's own contracts, by name (`rules`, `escrow`, `collector`, `token`, `beacon`, `multicall3`): a money
   * address equal to one gets an advisory notice (ADR-0033 §7). Absent: SimChain, which has none.
   */
  contracts?: ReadonlyArray<{ name: string; address: Address }>;
  /** The one token this deployment settles in (the plan's 2c): terms in another are refused before anything is signed. Absent: no check. */
  token?: AcceptedToken;
}

/**
 * On an EVM settlement layer the buyer funds with an ERC-3009 ReceiveWithAuthorization to the escrow's collector, and
 * pays the operator fee with a TransferWithAuthorization, both in the token's own EIP-712 domain, with nonces the
 * terms fix (ADR-0025; ADR-0023 amendment). Absent: SimChain, where both are Holdback-domain messages.
 */
export interface Erc3009Signing {
  funding(terms: AnyCommitmentTerms): { typedData: TypedDataJson; digest: Hex32; nonce: Hex32; validAfter: Timestamp };
  operatorFee(o: { commitmentId: Hex32; from: Address; to: Address; value: string; validAfter: Timestamp; validBefore: Timestamp }): { typedData: TypedDataJson; digest: Hex32; nonce: Hex32 };
}

/** "0.2 tUSD to 0x…: 1 bp of the price rounded up, at least 0.01 tUSD", the fee as check text and 402 details say it. */
export function operatorFeeText(fee: TokenAmount, s: OperatorFeeSchedule): string {
  return `${amountText(fee)} to ${s.to} (${operatorFeeRule(s, (a) => amountText({ token: s.token, amount: a } as TokenAmount))})`;
}

export class PrepareError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail);
  }
}
/** 400 invalid_terms naming the input at fault (a dotted path into the request body). */
function bad(detail: string, field?: string): never {
  throw new PrepareError({ type: 'invalid_terms', detail, ...(field ? { field } : {}) });
}
const notFound = (detail: string): never => {
  throw new PrepareError({ type: 'not_found', detail });
};

// Typed data

const DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];
const ALL = eip712Types as Record<string, ReadonlyArray<{ name: string; type: string }>>;

/** The primary type and every struct it references, and EIP712Domain: what a strict encoder (ethers) accepts. */
export function typesFor(primaryType: string): TypedDataJson['types'] {
  const out: TypedDataJson['types'] = { EIP712Domain: DOMAIN_TYPE };
  const visit = (t: string) => {
    if (out[t] || !ALL[t]) return;
    out[t] = ALL[t]!.map((f) => ({ name: f.name, type: f.type }));
    for (const f of ALL[t]!) visit(f.type.replace(/\[\]$/, ''));
  };
  visit(primaryType);
  return out;
}

/** One rule for agents: every integer in a typed-data message is a decimal string, uint8 included. */
const jsonable = (v: unknown): unknown =>
  typeof v === 'bigint' || typeof v === 'number' ? v.toString() : Array.isArray(v) ? v.map(jsonable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonable(x)])) : v;

function typedData(domain: HoldbackDomain, primaryType: string, message: Record<string, unknown>): TypedDataJson {
  return {
    domain: { name: domain.name, version: domain.version, chainId: Number(domain.chainId), verifyingContract: domain.verifyingContract },
    types: typesFor(primaryType),
    primaryType,
    message: jsonable(message) as Record<string, unknown>,
  };
}

const forMessage = (domain: HoldbackDomain, m: UnsignedMessage) => {
  const t = typedDataOf(m);
  return { typedData: typedData(domain, t.primaryType, t.message as Record<string, unknown>), digest: messageDigest(domain, m) };
};

// Helpers

const lc = (a: string) => a.toLowerCase();
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHex32 = (v: unknown): v is Hex32 => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
const ZERO_NONCE: Hex32 = `0x${'0'.repeat(64)}`;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const TIMING_KEYS: ReadonlyArray<keyof RelativeTiming> = ['offerExpiresInSec', 'fundWithinSec', 'deliverWithinSec', 'judgeWithinSec', 'fallbackWithinSec', 'appealWindowSec', 'appealDecideSec'];

/**
 * Windows are free parameters the parties negotiate (D31): any non-negative whole number of seconds. Only
 * malformed values are refused here; whether the resulting deadlines are representable and consistent is
 * decided by the commitment contract (parseCommitment) below, and the club rulebook's minimums by the
 * settlement layer when the offer is submitted.
 */
function timingIn(v: unknown): Partial<RelativeTiming> | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) bad(`timing is an object of whole-second windows: ${TIMING_KEYS.join(', ')}`, 'timing');
  const out: Partial<RelativeTiming> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!(TIMING_KEYS as readonly string[]).includes(k)) bad(`timing.${k} is not a known window (${TIMING_KEYS.join(', ')})`, `timing.${k}`);
    if (!Number.isSafeInteger(x) || (x as number) < 0) bad(`timing.${k} must be a non-negative whole number of seconds`, `timing.${k}`);
    out[k as keyof RelativeTiming] = x as number;
  }
  return out;
}

/** The completed terms must be a commitment the contract can represent; its own refusal is the 400. */
function representable(build: () => CommitmentTerms): CommitmentTerms {
  let terms: CommitmentTerms;
  try {
    terms = build();
  } catch (e) {
    return bad(`the windows give a deadline that cannot be represented as a timestamp (${(e as Error).message})`, 'timing');
  }
  const r = parseCommitment({ ...terms, id: ZERO_NONCE, signatures: { seller: `0x${'0'.repeat(130)}` } });
  if (!r.ok) bad(`these terms are not a valid commitment: ${r.error.detail}`);
  return terms;
}
/** Symbols for 6-decimal tokens other than tUSD, by lowercase identifier: a chain world names its token (tUSDC). */
const NAMED = new Map<string, string>([['tusd', 'tUSD']]);
export const nameToken = (id: string, symbol: string): void => void NAMED.set(id.toLowerCase(), symbol);
export const amountText = (a: TokenAmount) => {
  const symbol = NAMED.get(a.token.toLowerCase());
  return symbol ? formatTusd(a.amount, symbol) : `${a.amount} base units of ${a.token}`;
};

function timestamp(v: unknown, name: string): Timestamp | undefined {
  if (v === undefined) return undefined;
  // RFC 3339 (the schemas' date-time) has four-digit years, so that is the representable range.
  if (typeof v !== 'string' || !RFC3339.test(v) || !Number.isFinite(Date.parse(v))) bad(`${name} must be an RFC 3339 timestamp, e.g. 2026-11-01T09:00:00Z`, name);
  return wholeSecond(Date.parse(v as Timestamp));
}
/** A nonce is always the caller's own: 32 random bytes it generated and will check in the typed data (D39). */
function nonceIn(v: unknown, name: string): Hex32 {
  if (v === undefined) bad(`${name} is required: generate 32 random bytes yourself, send them as 0x-prefixed hex, and refuse a message with any other`, name);
  if (!isHex32(v)) bad(`${name} must be 32 bytes of hex (0x and 64 hex digits)`, name);
  return v as Hex32;
}
/** A nonce the terms fix (ERC-3009 on EVM): optional, and when sent it must be that one. */
function fixedNonceIn(v: unknown, want: Hex32, name: string): Hex32 {
  if (v === undefined) return want;
  if (!isHex32(v) || lc(v as string) !== lc(want)) bad(`${name} on this settlement layer is fixed by the terms: ${want}; send that, or leave ${name} out`, name);
  return want;
}
function amountIn(v: unknown, name: string): TokenAmount {
  if (!isObj(v) || typeof v['token'] !== 'string' || typeof v['amount'] !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(v['amount'])) {
    return bad(`${name} must be {"token": "<the token identifier>", "amount": "<base units as a decimal string>"}: the identifier is discovery's demo.token.id on these nodes (tUSD on SimChain, the token's lowercase address on a chain), and with 6 decimals 25 is "25000000"`, name);
  }
  return { token: v['token'], amount: v['amount'] } as TokenAmount;
}

async function commitmentIn(ctx: PrepareContext, input: Record<string, unknown>): Promise<AnyCommitment> {
  if (!isHex32(input['commitmentId'])) bad('commitmentId is required', 'commitmentId');
  const c = await ctx.commitment(input['commitmentId'] as Hex32);
  return c ?? notFound(`no commitment ${String(input['commitmentId'])}`);
}

// Each kind

const PLACEHOLDER_BODY = { deliverable: { kind: 'other', description: 'hash-only', format: 'text/plain' }, check: { id: 'hash-only', type: 'row_count_range', required: true, min: 0, max: 0 } } as const;

/**
 * ADR-0024 §4: the hash-only offer. The agent built the terms with the client-side recipe and sends only the bodies'
 * hashes, its nonce, createdAt and the level; this operator never sees a body. It returns the typed data and digest
 * to compare with the agent's own, and the body without privateTerms, which the agent adds (ciphertext and envelopes
 * whose hashes are these). nonce and createdAt are required: the agent encrypted under the commitment ID already.
 */
async function hashOnlyOffer(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  for (const k of ['deliverable', 'acceptance', 'checks', 'rubric', 'template']) if (input[k] !== undefined) bad(`a hash-only offer takes deliverableHash and acceptanceHash, not ${k}: the operator never sees a body`, k);
  for (const k of ['deliverableHash', 'acceptanceHash']) if (!isHex32(input[k])) bad('deliverableHash and acceptanceHash are keccak256 of the RFC 8785 JSON of each body (docs/api.md, the client-side recipe)', k);
  const level = input['disclosure'] as DisclosureLevel;
  if (level !== 'private' && level !== 'judgment') bad('a hash-only offer signs disclosure "private" (the bodies stay sealed to the parties and the adjudicators) or "judgment" (the acceptance is published with the decision); a public offer is prepared from the plain bodies instead', 'disclosure');
  const nonce = nonceIn(input['nonce'], 'nonce');
  const createdAt = timestamp(input['createdAt'], 'createdAt') ?? bad('createdAt is required for a hash-only offer: you encrypted the bodies under the commitment ID', 'createdAt');
  const plain = await offer(ctx, { ...input, hashOnly: undefined, deliverableHash: undefined, acceptanceHash: undefined, disclosure: 'public', template: 'checks-only', deliverable: PLACEHOLDER_BODY.deliverable, checks: [PLACEHOLDER_BODY.check], nonce, createdAt });
  const body = plain.submit.body as unknown as CommitmentTerms;
  const { deliverable: _d, acceptance: _a, id: _i, signatures: _s, ...rest } = body as CommitmentTerms & { id: unknown; signatures: unknown }; // eslint-disable-line @typescript-eslint/no-unused-vars
  const part = (hash: Hex32) => ({ hash, ciphertext: '', envelopes: [] as EncryptedKey[] });
  const terms = { ...rest, disclosure: { level }, privateTerms: { deliverable: part(lc(input['deliverableHash'] as string) as Hex32), acceptance: part(lc(input['acceptanceHash'] as string) as Hex32) } } as AnyCommitmentTerms;
  const id = commitmentId(terms);
  const { privateTerms: _p, ...wire } = terms as AnyCommitmentTerms & { privateTerms: unknown }; // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    kind: 'offer',
    commitmentId: id,
    sign: [{ slot: 'signatures.seller', signer: terms.seller, typedData: typedData(ctx.domain, 'CommitmentTerms', typedTermsOf(terms) as Record<string, unknown>), digest: termsDigest(ctx.domain, terms) }],
    submit: { method: 'POST', path: '/v1/commitments', body: { ...wire, id, signatures: { seller: null } } },
    check: [
      ...plain.check.filter((c) => !c.startsWith('deliverableHash') && !c.startsWith('disclosure.level')),
      `disclosure.level ${level}: add privateTerms {deliverable, acceptance} to submit.body, each {hash, ciphertext, envelopes} with the hashes you sent (${String(input['deliverableHash'])}, ${String(input['acceptanceHash'])}); the operator never saw the bodies`,
      'compare digest with your own: the client-side recipe needs no operator, this answer is a cross-check',
    ],
    defaults: plain.defaults,
    ...(plain.notices ? { notices: plain.notices } : {}),
  };
}

async function offer(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  if (input['hashOnly'] === true) return hashOnlyOffer(ctx, input);
  // D39, C9: the level is the caller's choice, never a default. From plain bodies the operator can only prepare public.
  if (input['disclosure'] !== 'public') {
    bad(
      input['disclosure'] === undefined
        ? 'disclosure is required: "public" (the terms bodies travel in the clear and every operator serves them), or "private" or "judgment" built with the client-side recipe and prepared with hashOnly: true (the operator never sees the bodies)'
        : `disclosure ${JSON.stringify(input['disclosure'])} cannot be prepared from plain bodies: send "public", or build a private or judgment offer with the client-side recipe and prepare it with hashOnly: true`,
      'disclosure',
    );
  }
  const template = input['template'] ?? 'default';
  if (template !== 'default' && template !== 'checks-only') bad('template is "default" (checks, then a judge panel on the rubric) or "checks-only"', 'template');
  if (!isAddress(input['seller'])) bad('seller (your address) is required', 'seller');
  const buyer = input['buyer'];
  if (!isObj(buyer) || !isAddress(buyer['address']) || typeof buyer['encryptionPublicKey'] !== 'string') bad('buyer is {"address", "encryptionPublicKey", "paymentAddress"?}, as the buyer gave them to you', 'buyer');
  // ADR-0033 §6: each party names its own money address; absent, the signing address, said in one notice each.
  if (buyer!['paymentAddress'] !== undefined && !isAddress(buyer!['paymentAddress'])) bad('buyer.paymentAddress, when given, is the address that funds the hold and receives every refund, as the buyer gave it to you', 'buyer.paymentAddress');
  if (input['sellerPayoutAddress'] !== undefined && !isAddress(input['sellerPayoutAddress'])) bad('sellerPayoutAddress, when given, is the address that receives every payment to you; take it from your own configuration', 'sellerPayoutAddress');
  const { slate, filled } = slateIn(ctx, input['adjudicators']);
  if (typeof input['clubId'] !== 'string') bad('clubId is required (GET /v1/clubs/{id})', 'clubId');
  const club = ctx.club(input['clubId'] as string) ?? bad(`no club ${String(input['clubId'])}`, 'clubId');
  if (!isObj(input['deliverable'])) bad('deliverable is {"kind", "description", "format"}', 'deliverable');
  const nonce = nonceIn(input['nonce'], 'nonce');
  // The plan's 2c: a price or a fee the caller names in another token is refused first, before any registration is read.
  // The completed terms are checked again below, for a fee taken from the primary's registration.
  for (const [k, field] of [['price', 'price.token'], ['fee', 'adjudication.fee.token']] as const) {
    const a = input[k];
    const early = isObj(a) && typeof a['token'] === 'string' ? amountTokenRefusal(ctx.token, a as unknown as TokenAmount, field) : null;
    if (early) throw new PrepareError(early);
  }
  // ADR-0030 §3: an expired registration stays listed, but no longer speaks for its adjudicator's policy, fee or key.
  const current = async (role: AdjudicatorRole) => {
    const r = (await ctx.registration(slate[role])) ?? notFound(`the ${role} adjudicator ${slate[role]} has no published registration`);
    const expiresAt = r.registration?.expiresAt;
    if (expiresAt && !(Date.parse(ctx.now()) < Date.parse(expiresAt))) notFound(`the ${role} adjudicator ${slate[role]} has no current registration: it expired at ${expiresAt}, and the adjudicator must register again`);
    return r;
  };
  const primary = await current('primary');
  await current('fallback');
  await current('appeal');
  const base = {
    clubId: club.id,
    buyer: {
      address: lc(buyer!['address'] as string) as Address,
      encryptionPublicKey: buyer!['encryptionPublicKey'] as string,
      ...(buyer!['paymentAddress'] !== undefined ? { paymentAddress: lc(buyer!['paymentAddress'] as string) as Address } : {}),
    },
    adjudicators: slate,
    price: amountIn(input['price'], 'price'),
    deliverable: input['deliverable'] as unknown as TermsDraft['deliverable'],
    ...(input['fee'] !== undefined ? { fee: amountIn(input['fee'], 'fee') } : {}),
    ...(input['timing'] !== undefined ? { timing: timingIn(input['timing'])! } : {}),
  };
  // ADR-0033 §2b: a phase-one deal states an appeal window of 0 (the default); said before the seller signs.
  if (ctx.phaseOne && (base.timing?.appealWindowSec ?? 0) !== 0) bad(APPEAL_WINDOW_PROBLEM, 'timing.appealWindowSec');
  let draft: TermsDraft;
  try {
    draft =
      template === 'checks-only'
        ? checksOnlyTerms({ ...base, checks: (input['checks'] ?? []) as DeterministicCheck[] })
        : defaultTerms({ ...base, ...(input['checks'] ? { checks: input['checks'] as DeterministicCheck[] } : {}), ...(input['rubric'] ? { rubric: input['rubric'] as TermsDraft['acceptance']['rubric'] } : {}) });
  } catch (e) {
    return bad((e as Error).message);
  }
  const givenCreatedAt = timestamp(input['createdAt'], 'createdAt');
  const createdAt = givenCreatedAt ?? ctx.now();
  const resolved = {
    seller: lc(input['seller'] as string) as Address,
    ...(input['sellerPayoutAddress'] !== undefined ? { sellerPayoutAddress: lc(input['sellerPayoutAddress'] as string) as Address } : {}),
    rulebookHash: club.rulebookHash,
    policyId: primary.policy.id,
    policyHash: primary.policyHash,
    registryHash: primary.registry.hash,
    fee: primary.fee.min,
    createdAt,
  };
  const terms: CommitmentTerms = representable(() => completeTerms(draft, { ...resolved, nonce }));
  // The plan's 2c: one token per deployment, refused here before the seller signs terms the contract would refuse at funding.
  const otherToken = tokenRefusal(ctx.token, terms);
  if (otherToken) throw new PrepareError(otherToken);
  // ADR-0031 §6 (SC-5, Rafa 2026-11-11): a phase-one deal holds at least one base unit, as price or as fee; the escrow
  // refuses to hold nothing. Said here, before the seller signs terms no one could fund.
  if (ctx.phaseOne && BigInt(terms.price.amount) === 0n && BigInt(terms.adjudication.fee.amount) === 0n) bad(ZERO_HOLD_PROBLEM, 'price');
  // The same for the deadlines (SC-5, review): core refuses them at submission and the contract at funding, unless all
  // five are in strict order and meet the rulebook's windows. Said here, before the seller signs.
  if (ctx.phaseOne) {
    // The phase-one rule above replaces the rulebook's appeal-window minimum, as in core's phase_one profile.
    const timed = validateTiming(terms.timing, { minWindowsSec: { ...club.rulebook.minWindowsSec, appealWindow: 0 } });
    if (!timed.ok) bad(timed.error.detail, 'timing');
  }
  const id = commitmentId(terms);
  // T-221 review: a default this node fills in must be able to run the terms (the outside primary's registry, policy
  // and fee, and the trust rule), or the parties would rely on an adjudicator that will decline its turn.
  const turns = await turnProblems(ctx, { ...terms, id, signatures: { seller: `0x${'0'.repeat(130)}` } } as AnyCommitment);
  for (const role of ['primary', 'fallback', 'appeal'] as const) {
    if (filled[role] && turns[role]) {
      bad(`this operator's default ${role} adjudicator ${slate[role]} would decline these terms: ${turns[role]}. Name a ${role} adjudicator yourself in adjudicators.${role}; you may still name this one`, `adjudicators.${role}`);
    }
  }
  const shortfall = await fallbackBondRefusal(ctx, terms);
  if (shortfall) bad(shortfall, 'adjudicators.fallback');
  const notices = [
    ...escalationWindowNotices(club, terms),
    ...addressDefaultNotices(terms, { payment: buyer!['paymentAddress'] === undefined, payout: input['sellerPayoutAddress'] === undefined }),
    ...moneyAddressNotices(ctx, terms),
    ...(await bondNotices(ctx, terms)),
    ...declineNotices(turns, terms),
  ];
  const total = BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount);
  const named = (role: AdjudicatorRole) => (filled[role] ? `${role} ${filled[role]} (this operator's default)` : `${role} ${slate[role]}`);
  return {
    kind: 'offer',
    commitmentId: id,
    sign: [{ slot: 'signatures.seller', signer: terms.seller, typedData: typedData(ctx.domain, 'CommitmentTerms', typedTermsOf(terms) as Record<string, unknown>), digest: termsDigest(ctx.domain, terms) }],
    submit: { method: 'POST', path: '/v1/commitments', body: { ...terms, id, signatures: { seller: null } } },
    check: [
      `you are the seller ${terms.seller}; the buyer is ${terms.buyer}`,
      `payments to you go to sellerPayoutAddress ${terms.sellerPayoutAddress}, which must be the address in your own configuration; the buyer's payment address ${terms.buyerPaymentAddress} funds the hold and receives every refund`,
      `price ${amountText(terms.price)}; adjudication fee ${amountText(terms.adjudication.fee)} (the buyer holds ${amountText({ token: terms.price.token, amount: total.toString() } as TokenAmount)}; the fee is kept on a refund)`,
      `adjudicators: ${(['primary', 'fallback', 'appeal'] as const).map(named).join(', ')}`,
      `policy id ${quoted(terms.adjudication.policyId)} (the primary's own label, untrusted text), policyHash ${terms.adjudication.policyHash} = keccak256(JCS(policy)) of the primary's registration; registryHash ${terms.adjudication.registryHash}`,
      `deliverableHash and acceptanceHash in the typed data are keccak256 of the RFC 8785 JSON of submit.body.deliverable and submit.body.acceptance`,
      `deliver by ${terms.timing.deliverBy}; offer expires ${terms.timing.offerExpiresAt}`,
      'disclosure.level public: the terms bodies (deliverable, checks, rubric) are public reads at every operator; the work itself stays encrypted',
    ],
    defaults: { ...(givenCreatedAt ? {} : { createdAt }), ...(Object.keys(filled).length ? { adjudicators: filled } : {}) },
    ...(notices.length ? { notices } : {}),
  };
}

/** Untrusted text inside a check line: JSON-quoted, with everything outside printable ASCII escaped (review of PR 184). */
const quoted = (s: string): string => JSON.stringify(s).replace(/[^\x20-\x7e]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);

/**
 * ADR-0030 §4: the adjudicators the agent named, and this node's default for each role it left out. Naming others
 * is the parties' choice; a node with no defaults needs all three.
 */
function slateIn(ctx: PrepareContext, adj: unknown): { slate: AdjudicatorSlate; filled: Partial<Record<AdjudicatorRole, Address>> } {
  if (adj !== undefined && !isObj(adj)) bad('adjudicators is {"primary", "fallback", "appeal"} addresses (GET /v1/adjudicators)', 'adjudicators');
  const given = (adj ?? {}) as Record<string, unknown>;
  const slate = {} as AdjudicatorSlate;
  const filled: Partial<Record<AdjudicatorRole, Address>> = {};
  for (const role of ['primary', 'fallback', 'appeal'] as const) {
    const v = given[role];
    if (v !== undefined && !isAddress(v)) bad(`adjudicators.${role} is an address (GET /v1/adjudicators)`, `adjudicators.${role}`);
    const d = ctx.defaultAdjudicators?.[role];
    if (v === undefined && !d) bad('adjudicators is {"primary", "fallback", "appeal"} addresses (GET /v1/adjudicators); this operator has no default adjudicators', 'adjudicators');
    slate[role] = ((v as Address | undefined) ?? d)!;
    if (v === undefined) filled[role] = slate[role];
  }
  return { slate, filled };
}

/**
 * ADR-0030 §5: in guaranteed mode an overturned decision pays the price from the decider's bond (D43), and a fallback
 * reserves its bond only when it decides. So this node prepares and relays no terms whose fallback has less free bond
 * than the price. The settlement layer and other operators still take them. Undefined when the terms can pay, or when
 * this node cannot read the bond.
 */
export async function fallbackBondRefusal(ctx: Pick<PrepareContext, 'bond'>, t: Pick<AnyCommitmentTerms, 'price' | 'adjudication' | 'settlement'>): Promise<string | undefined> {
  if (t.settlement.mode !== 'guaranteed_on_decision') return undefined;
  const fallback = t.adjudication.fallbackAdjudicator;
  const bond = await ctx.bond?.(fallback);
  if (!bond || bond === 'unreadable') return undefined;
  const free = freeBond(bond, t.price.token);
  if (free >= BigInt(t.price.amount)) return undefined;
  return (
    `the fallback adjudicator ${fallback} has ${amountText({ token: t.price.token, amount: free.toString() } as TokenAmount)} of free bond, less than the price of ${amountText(t.price)}. ` +
    'An overturned fallback decision pays the price from its bond (D43), so this operator relays no terms that name it. ' +
    'Name a fallback with free bond for the price, or send the same signed message to another operator or directly to the settlement layer'
  );
}

const ROLE_OF: ReadonlyArray<[AdjudicatorRole, 'adjudicator' | 'fallbackAdjudicator' | 'appealAdjudicator']> = [
  ['primary', 'adjudicator'],
  ['fallback', 'fallbackAdjudicator'],
  ['appeal', 'appealAdjudicator'],
];

/** Per role, why this node's own adjudicator named there would decline it (T-221 review); absent when it would not or is not this node's. */
async function turnProblems(ctx: Pick<PrepareContext, 'declines'>, c: AnyCommitment): Promise<Partial<Record<AdjudicatorRole, string>>> {
  const out: Partial<Record<AdjudicatorRole, string>> = {};
  if (!ctx.declines) return out;
  for (const [role, field] of ROLE_OF) {
    const why = await ctx.declines(c.adjudication[field], role, c);
    if (why) out[role] = why;
  }
  return out;
}

/**
 * ADR-0032: on a chain whose rules contract takes drand quicknet's rounds with a 29 s margin (Sepolia, Ethereum mainnet),
 * the appeal adjudicator cannot decide an escalation in a window below 37 s: no block inside it is built after the round
 * is public, and every escalation under those terms defaults to a refund. The local chain and SimChain run the sim beacon,
 * whose floor is 2 s, so a club on it gets no warning.
 */
export const SMALLEST_DECIDABLE_ESCALATION_SEC = 37;

/** ADR-0032 §5, gate line BR-5: an advisory notice, never a refusal (D31), for an escalation window below the chain's floor. */
export function escalationWindowNotices(club: Pick<Club, 'rulebook'>, t: Pick<AnyCommitmentTerms, 'timing'>): string[] {
  if (club.rulebook.randomness?.source !== 'drand-quicknet') return [];
  const w = t.timing.appealDecideSec;
  if (w >= SMALLEST_DECIDABLE_ESCALATION_SEC) return [];
  return [
    `timing.appealDecideSec is ${w} s, below the ${SMALLEST_DECIDABLE_ESCALATION_SEC} s the appeal adjudicator needs on this chain to decide an escalation after the beacon's round is public (ADR-0032): every escalation under these terms would end in the default outcome, a refund. A panel needs more; the repository's terms use 300 s. You may still choose it`,
  ];
}

/** ADR-0033 §7: one line for each money address the request left out, so the party knows its signing address holds the money. */
function addressDefaultNotices(t: Pick<AnyCommitmentTerms, 'buyer' | 'seller'>, absent: { payment: boolean; payout: boolean }): string[] {
  return [
    ...(absent.payment ? [`Payment address: not set. The buyer's signing address ${t.buyer} funds the hold, and refunds return to it; the buyer may name buyer.paymentAddress`] : []),
    ...(absent.payout ? [`Payout address: not set. Payments go to the seller's signing address ${t.seller}; name sellerPayoutAddress so the key that signs never holds the income`] : []),
  ];
}

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

/**
 * ADR-0033 §7: advisory warnings, never refusals (D31), for a money address that would lose or strand the money or hand
 * it to a decider: the zero address, one of this deployment's own contracts, Multicall3, or one of the deal's three
 * adjudicators. The contract compares none of them (ADR-0033 §2).
 */
export function moneyAddressNotices(ctx: Pick<PrepareContext, 'contracts'>, t: Pick<AnyCommitmentTerms, 'buyerPaymentAddress' | 'sellerPayoutAddress' | 'adjudication'>): string[] {
  const out: string[] = [];
  const contracts = ctx.contracts ?? [];
  const adjudicators = ROLE_OF.map(([role, field]) => [role, t.adjudication[field]] as const);
  const check = (field: 'buyerPaymentAddress' | 'sellerPayoutAddress', a: Address) => {
    const payout = field === 'sellerPayoutAddress';
    if (lc(a) === ZERO_ADDRESS) out.push(payout ? `${field} is the zero address: payments to the seller would be lost or would revert, depending on the token` : `${field} is the zero address: no signature can fund this deal`);
    const own = contracts.find((c) => lc(c.address) === lc(a));
    if (own?.name === 'multicall3' && payout) out.push(`${field} ${a} is Multicall3: anyone could take the seller's payment, because Multicall3 makes any call it is asked to`);
    else if (own) out.push(payout ? `${field} ${a} is this deployment's ${own.name}: payments to the seller would be stranded there` : `${field} ${a} is this deployment's ${own.name}: no signature can fund this deal`);
    for (const [role, adj] of adjudicators) {
      if (lc(adj) === lc(a)) out.push(`${field} ${a} is the ${role} adjudicator: the adjudicator that decides would receive the price on ${payout ? 'an accept' : 'a reject'}`);
    }
  };
  check('sellerPayoutAddress', t.sellerPayoutAddress);
  check('buyerPaymentAddress', t.buyerPaymentAddress);
  return out.map((n) => `${n}. You may still choose it`);
}

const declineNotices = (turns: Partial<Record<AdjudicatorRole, string>>, c: Pick<AnyCommitmentTerms, 'adjudication'>): string[] =>
  ROLE_OF.filter(([role]) => turns[role]).map(([role, field]) => `this operator's ${role} adjudicator ${c.adjudication[field]} will decline its ${role} turn on these terms: ${turns[role]}. You may still choose it`);

/**
 * T-221 review: an advisory notice on relayed terms for each of this node's own adjudicators that would decline its
 * role on them, so the parties do not rely on it (D31: the parties chose it; nothing is refused). `primaryAccepted`:
 * the primary has already taken its turn, so only the fallback and the appeal adjudicator are asked.
 */
export async function turnNotices(ctx: Pick<PrepareContext, 'declines'>, c: AnyCommitment, o: { primaryAccepted?: boolean } = {}): Promise<string[]> {
  const turns = await turnProblems(ctx, c);
  if (o.primaryAccepted) delete turns.primary;
  return declineNotices(turns, c);
}

/**
 * ADR-0030 §5: an advisory notice for each named adjudicator with no bond, or less free bond than the price (D31).
 * `primaryAccepted`: the primary already accepted these terms. Whether its free bond still counts this deal's price
 * depends on the settlement layer (SimChain reserves at acceptance, the contract at funding), so the primary is then
 * warned about only when it has no bond at all; the settlement layer refuses the funding if it cannot cover the price.
 */
export async function bondNotices(ctx: Pick<PrepareContext, 'bond'>, t: Pick<AnyCommitmentTerms, 'price' | 'adjudication'>, o: { primaryAccepted?: boolean } = {}): Promise<string[]> {
  if (!ctx.bond) return [];
  const a = t.adjudication;
  const out: string[] = [];
  for (const [role, address] of [['primary', a.adjudicator], ['fallback', a.fallbackAdjudicator], ['appeal', a.appealAdjudicator]] as const) {
    const bond = await ctx.bond(address);
    if (!bond) continue;
    if (bond === 'unreadable') {
      out.push(`this operator could not read the bond of the ${role} adjudicator ${address}; no bond check was made. Read it from the settlement layer yourself`);
      continue;
    }
    const free = role === 'primary' && o.primaryAccepted ? BigInt(t.price.amount) : freeBond(bond, t.price.token);
    const why = role === 'appeal' ? 'its decision is final, and no appeal adjudicator has a bond at stake on chain yet' : 'nothing it holds pays the wronged party if its decision is overturned';
    if (!hasBond(bond)) out.push(`the ${role} adjudicator ${address} has no bond: ${why}. You may still choose it`);
    else if (free < BigInt(t.price.amount)) out.push(`the ${role} adjudicator ${address} has ${amountText({ token: t.price.token, amount: free.toString() } as TokenAmount)} of free bond, less than the price of ${amountText(t.price)}. You may still choose it`);
  }
  return out;
}

async function agreeAndFund(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const total = (BigInt(c.price.amount) + BigInt(c.adjudication.fee.amount)).toString();
  const agreeBody = { type: 'Agree', commitmentId: c.id, buyer: c.buyer, expiresAt: c.timing.offerExpiresAt } as const;
  // On EVM the funding is the token's ERC-3009 authorization, valid from the epoch, nonce fixed by the terms (ADR-0025).
  const evm = ctx.erc3009;
  const funded = evm?.funding(c);
  const fundingBody = {
    type: 'FundingAuthorization',
    scheme: 'erc3009',
    commitmentId: c.id,
    from: c.buyerPaymentAddress, // ADR-0033 §3: the payment address signs the funding and the operator fee
    value: total,
    token: c.price.token,
    validAfter: funded ? funded.validAfter : c.createdAt,
    validBefore: c.timing.fundBy,
    expiresAt: c.timing.fundBy,
  } as const;
  const agreeNonce = nonceIn(input['agreeNonce'], 'agreeNonce');
  const fundingNonce = funded ? fixedNonceIn(input['fundingNonce'], funded.nonce, 'fundingNonce') : nonceIn(input['fundingNonce'], 'fundingNonce');
  const agree = { ...agreeBody, nonce: agreeNonce };
  const funding = { ...fundingBody, nonce: fundingNonce };
  // ADR-0023: this node's fee, a third signature, only when it asks for more than zero.
  const schedule = ctx.operatorFee;
  const due = schedule ? operatorFeeDue(c.price, schedule) : undefined;
  const feeBody =
    schedule && due && due.amount !== '0'
      ? ({
          type: 'TransferAuthorization',
          scheme: 'erc3009',
          purpose: 'operator_fee',
          commitmentId: c.id,
          from: c.buyerPaymentAddress,
          to: schedule.to,
          value: due.amount,
          token: due.token,
          // On EVM from the epoch, as the funding: a simulation runs on a block that may predate createdAt (ADR-0028).
          validAfter: funded ? funded.validAfter : c.createdAt,
          validBefore: c.timing.fundBy,
          expiresAt: c.timing.fundBy,
        } as const)
      : undefined;
  // Sent always is fine: a node that charges nothing ignores it. A node that charges needs it (fees.operator in discovery).
  const feeSigned = feeBody && evm ? evm.operatorFee({ commitmentId: c.id, from: c.buyerPaymentAddress, to: feeBody.to, value: feeBody.value, validAfter: feeBody.validAfter, validBefore: feeBody.validBefore }) : undefined;
  const feeNonce = feeBody ? (feeSigned ? fixedNonceIn(input['operatorFeeNonce'], feeSigned.nonce, 'operatorFeeNonce') : nonceIn(input['operatorFeeNonce'], 'operatorFeeNonce')) : undefined;
  const fee = feeBody ? { ...feeBody, nonce: feeNonce! } : undefined;
  const fixed = {
    ...(funded && input['fundingNonce'] === undefined ? { fundingNonce } : {}),
    ...(feeSigned && input['operatorFeeNonce'] === undefined ? { operatorFeeNonce: feeNonce } : {}),
  };
  // ADR-0030 §5: the buyer who agrees gets the bond warning too, not only the seller who chose the adjudicators.
  const state = await ctx.state(c.id);
  const notices = await bondNotices(ctx, c, { primaryAccepted: state !== null && state.escrowState !== 'Offered' });
  return {
    kind: 'agree-and-fund',
    commitmentId: c.id,
    sign: [
      { slot: 'signature', signer: c.buyer, ...forMessage(ctx.domain, agree) },
      { slot: 'fund.signature', signer: c.buyerPaymentAddress, ...(funded ? { typedData: funded.typedData, digest: funded.digest } : forMessage(ctx.domain, funding)) },
      ...(fee ? [{ slot: 'operatorFee.signature', signer: c.buyerPaymentAddress, ...(feeSigned ? { typedData: feeSigned.typedData, digest: feeSigned.digest } : forMessage(ctx.domain, fee)) }] : []),
    ],
    submit: {
      method: 'POST',
      path: `/v1/commitments/${c.id}/agree`,
      body: { ...agree, signature: null, fund: { ...funding, signature: null }, ...(fee ? { operatorFee: { ...fee, signature: null } } : {}) },
    },
    check: [
      `you are the buyer ${c.buyer}; the seller is ${c.seller}`,
      `you authorize ${amountText({ token: c.price.token, amount: total } as TokenAmount)}: price ${amountText(c.price)} plus fee ${amountText(c.adjudication.fee)}; the fee is kept on a refund`,
      `the payment address ${c.buyerPaymentAddress} signs fund.signature${fee ? ' and operatorFee.signature' : ''}, funds the hold and receives every refund; it must be your own. The signing address ${c.buyer} signs the agreement. Payments to the seller go to its payout address ${c.sellerPayoutAddress}, which must be the one in the offer you approved (ADR-0033 §6)`,
      ...(fee && due
        ? [
            `you also pay this operator's operator fee of ${operatorFeeText(due, schedule!)}, the schedule in its discovery document's fees.operator; it is a separate transfer, never part of the hold, and not refunded, even on a refund. Another operator, or direct submission to the settlement layer, relays this agreement without it`,
          ]
        : []),
      `the terms name buyerEncryptionPublicKey ${c.buyerEncryptionPublicKey}: the seller seals the work's key to it, so confirm you hold the secret key for it (this operator cannot know your key)`,
      `adjudicators: primary ${c.adjudication.adjudicator}, fallback ${c.adjudication.fallbackAdjudicator}, appeal ${c.adjudication.appealAdjudicator}`,
      'the primary adjudicator must have accepted the offer first (escrowState AcceptedByAdjudicator)',
      ...(funded
        ? [
            `on this chain fund.signature is an ERC-3009 ReceiveWithAuthorization under the token's own EIP-712 domain (${funded.typedData.domain.name} ${funded.typedData.domain.version}, the token contract ${funded.typedData.domain.verifyingContract}): to the escrow's collector ${String(funded.typedData.message['to'])}, value price plus fee, valid from 0 until fundBy, nonce ${funding.nonce}, the payer-agnostic PaymentInfo hash of these terms, so it can fund this commitment only`,
          ]
        : []),
    ],
    defaults: fixed,
    ...(notices.length ? { notices } : {}),
  };
}

async function delivery(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const ct = input['ciphertext'];
  if (!isObj(ct) || typeof ct['uri'] !== 'string' || typeof ct['sha256'] !== 'string' || !Number.isSafeInteger(ct['bytes'])) bad('ciphertext is {"uri", "sha256", "bytes"} as POST /v1/ciphertext answered', 'ciphertext');
  if (typeof input['plaintextSha256'] !== 'string') bad('plaintextSha256 ("sha256:<hex>" of the plaintext) is required', 'plaintextSha256');
  const keys = input['encryptedKeys'];
  if (!Array.isArray(keys)) bad('encryptedKeys is one envelope per recipient (GET /v1/commitments/{id}/recipients)', 'encryptedKeys');
  const need = [c.adjudication.adjudicator, c.adjudication.fallbackAdjudicator, c.adjudication.appealAdjudicator, c.buyer].map(lc);
  const have = (keys as EncryptedKey[]).map((k) => lc(String(k?.recipient)));
  const missing = need.filter((a) => !have.includes(a));
  if (missing.length) bad(`encryptedKeys has no envelope for ${missing.join(', ')}; seal the content key to every recipient GET /v1/commitments/${c.id}/recipients lists`, 'encryptedKeys');
  const givenAt = timestamp(input['submittedAt'], 'submittedAt');
  const submittedAt = givenAt ?? ctx.now();
  const body = {
    commitmentId: c.id,
    attempt: Number.isSafeInteger(input['attempt']) ? (input['attempt'] as number) : 1,
    ciphertext: { uri: ct!['uri'] as string, sha256: ct!['sha256'] as Sha256, bytes: ct!['bytes'] as number, cipher: 'aes-256-gcm' as const },
    plaintextSha256: input['plaintextSha256'] as Sha256,
    // A sealed deal's format is in its ciphertext body, which this operator cannot read (ADR-0024): the seller names it.
    plaintextMime: (input['plaintextMime'] ?? (isSealed(c) ? bad('plaintextMime is required for a private or judgment deal: the operator cannot read the deliverable format', 'plaintextMime') : c.deliverable.format)) as MimeType,
    encryptedKeys: (keys as EncryptedKey[]).map((k) => ({ recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext })),
    submittedAt,
  };
  return {
    kind: 'delivery',
    commitmentId: c.id,
    sign: [{ slot: 'signature', signer: c.seller, ...forMessage(ctx.domain, { ...body, type: 'Delivery' }) }],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/deliveries`, body: { ...body, signature: null } },
    check: [
      `you are the seller ${c.seller}`,
      `ciphertext ${body.ciphertext.sha256} (${body.ciphertext.bytes} bytes) at ${body.ciphertext.uri}; plaintext ${body.plaintextSha256}: the hashes you computed`,
      `envelopes for ${need.join(', ')}: the buyer's sealed to buyerEncryptionPublicKey ${c.buyerEncryptionPublicKey} from the terms you signed, not a key from this operator`,
      "each adjudicator's envelope sealed to the encryption key in its registration as a source you trust gives it (a second operator, or the adjudicator itself), not only this operator's /recipients",
    ],
    defaults: givenAt ? {} : { submittedAt },
  };
}

async function earlyAccept(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const nonce = nonceIn(input['nonce'], 'nonce');
  const givenExpiry = timestamp(input['expiresAt'], 'expiresAt');
  const expiresAt = givenExpiry ?? plusSeconds(ctx.now(), 3600);
  // ADR-0029: the accept names the posted delivery; the settlement layer refuses it relayed with any other.
  const posted = (await ctx.delivery(c.id)) ?? bad(`no delivery is posted for ${c.id}; an early accept names the delivery it accepts`);
  const body = { type: 'EarlyAccept', commitmentId: c.id, buyer: c.buyer, attempt: posted.attempt, deliveryHash: posted.deliveryHash, expiresAt } as const;
  const m = { ...body, nonce };
  return {
    kind: 'early-accept',
    commitmentId: c.id,
    sign: [{ slot: 'signature', signer: c.buyer, ...forMessage(ctx.domain, m) }],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/accept`, body: { ...m, signature: null } },
    check: [
      `you are the buyer ${c.buyer}`,
      `you accept the delivery and release ${amountText(c.price)} to the seller's payout address ${c.sellerPayoutAddress} now; the fee ${amountText(c.adjudication.fee)} returns to your payment address ${c.buyerPaymentAddress}`,
      `deliveryHash ${posted.deliveryHash} is the hash of the delivery you opened, computed yourself from the seller-signed delivery (EIP-712 struct hash without its signature); the settlement layer refuses an accept for any other delivery`,
      'open your envelope first: get the signed delivery from the seller, check it is the one the settlement layer holds (its deliveryHash in delivery.submitted, as at least two operators serve it), open your envelope with your own key, decrypt the ciphertext and check the plaintext hash; the envelope the seller supplied is what an early accept releases, and nothing else checks it',
      'no appeal follows an early accept (D32): if your envelope does not open, do not accept early; an adjudicator\'s decision re-seals the key to your terms key',
    ],
    defaults: givenExpiry ? {} : { expiresAt },
  };
}

async function appeal(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  if (!isAddress(input['appellant'])) bad('appellant (your address) is required', 'appellant');
  const who = lc(input['appellant'] as string);
  const appellant: 'buyer' | 'seller' = who === lc(c.buyer) ? 'buyer' : who === lc(c.seller) ? 'seller' : bad(`${who} is neither party to ${c.id}`, 'appellant');
  // T-206 L-7: only the party the decision went against appeals, so do not prepare a message settlement refuses.
  const s = await ctx.state(c.id);
  const against = s?.escrowState === 'Released' ? 'buyer' : s?.escrowState === 'Refunded' ? 'seller' : undefined;
  if (against && appellant !== against) bad(`the decision went against the ${against}, so only the ${against} may appeal`, 'appellant');
  const rulebook = ctx.club(c.clubId)?.rulebook ?? bad(`no club ${c.clubId}`);
  const bond = mulBps(c.price, BigInt(rulebook.appealBondRateBps), 'ceil');
  if (!bond.ok) return bad('cannot compute the appeal bond');
  const givenAt = timestamp(input['filedAt'], 'filedAt');
  const filedAt = givenAt ?? ctx.now();
  const body = { commitmentId: c.id, appellant, appellantAddress: who as Address, grounds: typeof input['grounds'] === 'string' ? input['grounds'] : 'wrong-outcome', bond: bond.value, filedAt };
  const fee = rulebook.appealFee;
  return {
    kind: 'appeal',
    commitmentId: c.id,
    sign: [{ slot: 'signature', signer: body.appellantAddress, ...forMessage(ctx.domain, { ...body, type: 'Appeal' }) }],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/appeals`, body: { ...body, signature: null } },
    check: [
      `you appeal as the ${appellant}`,
      `you post a bond of ${amountText(bond.value)} (${rulebook.appealBondRateBps} bps of the price, rounded up) and a fee of ${amountText(fee)}, ${amountText({ token: fee.token, amount: (BigInt(bond.value.amount) + BigInt(fee.amount)).toString() } as TokenAmount)} in all, from your balance; you lose the bond if the decision is upheld`,
    ],
    defaults: givenAt ? {} : { filedAt },
  };
}

/**
 * The late delivery an agent names for a settlement in Held (SC-5b), checked as core and the contract check it when it
 * releases a key: a delivery for this commitment with an envelope for the buyer. Undefined when none is given.
 */
function lateDeliveryIn(c: AnyCommitment, v: unknown): Delivery | undefined {
  if (v === undefined) return undefined;
  const r = parseDelivery(v);
  if (!r.ok) return bad(`delivery is the seller-signed delivery you hold (delivery.schema.json): ${r.error.detail}`, 'delivery');
  const d = r.value;
  if (lc(d.commitmentId) !== lc(c.id)) bad(`delivery is for ${d.commitmentId}, not ${c.id}`, 'delivery.commitmentId');
  return d;
}

/** Which money address a payout names, for the check line; both roles when the two addresses are one (ADR-0033 §8). */
function payeeLabel(c: Pick<AnyCommitmentTerms, 'sellerPayoutAddress' | 'buyerPaymentAddress'>, to: Address): string {
  const payout = lc(to) === lc(c.sellerPayoutAddress);
  const payment = lc(to) === lc(c.buyerPaymentAddress);
  return payout && payment ? " (the seller's payout address and the buyer's payment address)" : payout ? " (the seller's payout address)" : payment ? " (the buyer's payment address)" : '';
}

async function settlement(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const nonce = nonceIn(input['nonce'], 'nonce');
  let payouts: Payout[];
  if (input['payouts'] !== undefined) {
    if (!Array.isArray(input['payouts'])) bad('payouts is a list of {"to", "amount"}', 'payouts');
    payouts = (input['payouts'] as unknown[]).map((p, i) => {
      if (!isObj(p) || !isAddress(p['to'])) return bad(`payouts[${i}].to must be an address`, `payouts.${i}.to`);
      const amount = amountIn(p['amount'], `payouts.${i}.amount`);
      const otherToken = amountTokenRefusal(ctx.token, amount, `payouts.${i}.amount.token`);
      if (otherToken) throw new PrepareError(otherToken);
      return { to: p['to'] as Address, amount };
    });
  } else {
    const bps = input['toSellerBps'];
    if (!Number.isSafeInteger(bps) || (bps as number) < 0 || (bps as number) > 10_000) bad('give payouts, or toSellerBps (0 to 10000): the seller gets that share of the price, the buyer the rest', 'toSellerBps');
    const split = splitBps(c.price, BigInt(bps as number));
    if (!split.ok) return bad('cannot split the price');
    // ADR-0033: the money goes to the seller's payout address and back to the buyer's payment address; with the two
    // equal, one payout of the whole price (the parser refuses a recipient named twice).
    payouts = (
      lc(c.sellerPayoutAddress) === lc(c.buyerPaymentAddress)
        ? [{ to: c.sellerPayoutAddress, amount: c.price }]
        : [
            { to: c.sellerPayoutAddress, amount: split.value.share },
            { to: c.buyerPaymentAddress, amount: split.value.remainder },
          ]
    ).filter((p) => p.amount.amount !== '0');
  }
  // ADR-0031 §4 (SC-3), ADR-0033: the phase-one contracts pay a settlement to the buyer's payment address and the
  // seller's payout address only. Said here, before either party signs a settlement the contract would refuse.
  if (ctx.phaseOne) {
    const i = payouts.findIndex((p) => lc(p.to) !== lc(c.sellerPayoutAddress) && lc(p.to) !== lc(c.buyerPaymentAddress));
    if (i >= 0) bad(`payouts[${i}].to ${payouts[i]!.to} is neither the buyer's payment address nor the seller's payout address: the phase-one contracts pay a mutual settlement to those two only (ADR-0031 §4, ADR-0033)`, `payouts.${i}.to`);
  }
  const posted = await ctx.delivery(c.id);
  // SC-5b (T-357): with nothing posted, the agent may name the late delivery it holds, as the seller signed it. Its hash
  // is rebuilt here from that delivery, never taken from the caller, and the agent recomputes it before signing.
  const late = posted ? undefined : lateDeliveryIn(c, input['delivery']);
  const named = posted?.deliveryHash ?? (late ? deliveryHash(late) : null);
  if (posted && input['delivery'] !== undefined) bad(`a delivery is posted for ${c.id} (${posted.deliveryHash}); the settlement names that one, so leave delivery out`, 'delivery');
  const givenExpiry = timestamp(input['expiresAt'], 'expiresAt');
  const expiresAt = givenExpiry ?? plusSeconds(ctx.now(), 3600);
  const givenRelease = typeof input['releaseKey'] === 'boolean';
  const releaseKey = givenRelease ? (input['releaseKey'] as boolean) : named !== null;
  if (releaseKey && named === null) bad('releaseKey needs a delivery: nothing is posted, so give the late delivery you hold as delivery, or set releaseKey false', 'releaseKey');
  // The key proof reads only the buyer's envelope (HoldbackRules :381), so it is needed only when the key is released.
  if (late && releaseKey && !late.encryptedKeys.some((k) => lc(k.recipient) === lc(c.buyer))) bad(`delivery has no envelope for the buyer ${c.buyer}, so there is no key to release`, 'delivery.encryptedKeys');
  const body = { type: 'MutualSettlement', commitmentId: c.id, deliveryHash: named, payouts, releaseKey, expiresAt } as const;
  const m = { ...body, nonce };
  const signed = forMessage(ctx.domain, m);
  return {
    kind: 'settlement',
    commitmentId: c.id,
    sign: [
      { slot: 'buyerSignature', signer: c.buyer, ...signed },
      { slot: 'sellerSignature', signer: c.seller, ...signed },
    ],
    // SC-5b (T-378): the late delivery travels in the body when the settlement releases its key, as the contract call
    // mutualSettle(terms, settlement, delivery, keyProof) takes it; the route checks it and the settlement layer settles it.
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/settlements`, body: { ...m, buyerSignature: null, sellerSignature: null, ...(late && releaseKey ? { delivery: late } : {}) } },
    check: [
      `payouts: ${payouts.map((p) => `${amountText(p.amount)} to ${p.to}${payeeLabel(c, p.to)}`).join('; ')} (they must sum to the price ${amountText(c.price)})`,
      `the fee ${amountText(c.adjudication.fee)} returns to the buyer's payment address ${c.buyerPaymentAddress}`,
      releaseKey ? 'the buyer receives the content key' : 'the content key is not released',
      'both parties sign the identical typed data; either may submit once both signatures are in',
      ...(late
        ? [
            `deliveryHash ${named} is the hash of the late delivery you gave, which was never posted: compute it yourself from the seller-signed delivery (EIP-712 struct hash without its signature) before you sign. Both signatures over this hash are what endorse that delivery; nothing checks the seller's signature on it`,
            releaseKey
              ? "the settlement layer releases the buyer's first envelope in that delivery with the payment, and no appeal follows a settlement. The buyer already holds that envelope in the delivery it was handed, so the exchange rests on the ciphertext: as seller, hand over the delivery but keep the ciphertext at its uri until the settlement lands; as buyer, check the ciphertext's sha256 and the hashes before you sign"
              : 'the key stays with the seller: the settlement names the delivery and pays for it, and the work changes hands outside the protocol',
            ...(releaseKey ? ['submit.body carries that delivery as delivery: the settlement travels with it, and the settlement layer checks that it hashes to deliveryHash and holds the buyer\'s envelope before it releases the key'] : []),
          ]
        : []),
    ],
    defaults: { ...(givenExpiry ? {} : { expiresAt }), ...(givenRelease ? {} : { releaseKey }) },
  };
}

const PREPARERS: Record<PrepareKind, (ctx: PrepareContext, input: Record<string, unknown>) => Promise<Prepared>> = {
  offer,
  'agree-and-fund': agreeAndFund,
  delivery,
  'early-accept': earlyAccept,
  appeal,
  settlement,
};

/**
 * Kinds whose submit only one set of states can take: preparing them in another state would collect a signature
 * the settlement layer refuses (sim batch 1, F5), so prepare answers 409 invalid_state with the state it saw.
 * The settlement layer still decides: a state can change between prepare and submit.
 */
const STATE_GATES: Partial<Record<PrepareKind, { needs: string; states: string[]; open(s: CommitmentStateView): boolean }>> = {
  'early-accept': { needs: 'early-accept needs Delivered (a delivery no adjudicator has decided yet)', states: ['Delivered'], open: (s) => s.escrowState === 'Delivered' },
  appeal: {
    needs: 'an appeal needs a first-instance decision (Released or Refunded) whose appeal window is open and unused; escalated decisions are final',
    states: ['Released', 'Refunded'],
    open: (s) => (s.escrowState === 'Released' || s.escrowState === 'Refunded') && s.appealState === 'none' && !s.finalAt,
  },
  settlement: { needs: 'a settlement needs Held, Delivered, FallbackJudging or Escalated', states: ['Held', 'Delivered', 'FallbackJudging', 'Escalated'], open: (s) => ['Held', 'Delivered', 'FallbackJudging', 'Escalated'].includes(s.escrowState) },
};

async function stateGate(kind: PrepareKind, ctx: PrepareContext, input: Record<string, unknown>): Promise<void> {
  const gate = STATE_GATES[kind];
  if (!gate || !isHex32(input['commitmentId'])) return; // the preparer reports a missing or malformed id
  const s = await ctx.state(input['commitmentId'] as Hex32);
  if (!s || gate.open(s)) return;
  const why = s.finalAt ? `, final since ${s.finalAt}` : s.appealState !== 'none' ? `, appeal ${s.appealState}` : '';
  // `needs` only when the escrow state is what refuses (an appeal can also be closed by its window or a past appeal).
  const needs = gate.states.includes(s.escrowState) ? {} : { needs: gate.states };
  throw new PrepareError({ type: 'invalid_state', detail: `commitment ${s.commitmentId} is ${s.escrowState}${why}; ${gate.needs}`, state: s.escrowState, ...needs });
}

export function prepare(kind: string, ctx: PrepareContext, input: unknown): Promise<Prepared> {
  if (!(PREPARE_KINDS as readonly string[]).includes(kind)) notFound(`nothing to prepare for ${kind}; kinds: ${PREPARE_KINDS.join(', ')}`);
  if (!isObj(input)) bad('the body must be a JSON object');
  const run = async () => {
    if (kind === 'appeal' && ctx.phaseOne) throw new PrepareError({ type: 'invalid_state', detail: PHASE_ONE_NO_APPEAL });
    await stateGate(kind as PrepareKind, ctx, input as Record<string, unknown>);
    return PREPARERS[kind as PrepareKind](ctx, input as Record<string, unknown>);
  };
  // A value the EIP-712 encoders cannot represent is the caller's malformed input: 400, never 500.
  return run().catch((e: unknown) => {
    if (e instanceof RangeError || e instanceof TypeError) bad(`a value cannot be encoded: ${e.message}`);
    throw e;
  });
}
