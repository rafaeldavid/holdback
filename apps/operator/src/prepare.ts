// Prepare, sign, submit (D30, docs/api.md "Prepare and sign"). For each party message an agent sends, the
// operator turns plain inputs into the exact EIP-712 typed data to sign, its digest, and the body to submit
// with the signature slot(s) named. The operator never signs and never holds a party key: the agent checks the
// typed data (the response says which fields matter), signs it with any EIP-712 library, puts the signature in
// the named slot and POSTs the body to the write route the response names. The typed data is a pure function of
// the inputs and of the defaults the response states (nonce, times), so an agent can recompute it.
import {
  canonicalJson,
  commitmentId,
  eip712Types,
  messageDigest,
  mulBps,
  problem,
  splitBps,
  termsDigest,
  typedDataOf,
  typedTermsOf,
  type AdjudicatorRegistration,
  type Address,
  type Club,
  type Commitment,
  type CommitmentTerms,
  type DeterministicCheck,
  type EncryptedKey,
  type Hex32,
  type HoldbackDomain,
  type MimeType,
  type Payout,
  type Problem,
  type Sha256,
  type Timestamp,
  type TokenAmount,
  type UnsignedMessage,
} from '@holdback/core';
import { keccak256, stringToBytes } from 'viem';
import { checksOnlyTerms, completeTerms, defaultTerms, type AdjudicatorSlate, type RelativeTiming, type TermsDraft } from './terms.js';
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
  /** Defaults the operator filled in (nonce, times), so a caller can pass them back and get the same bytes. */
  defaults: Record<string, unknown>;
}

/** What preparing needs from the operator's view of the settlement layer. Reads only. */
export interface PrepareContext {
  domain: HoldbackDomain;
  now(): Timestamp;
  club(id: string): Club | undefined;
  registration(address: Address): AdjudicatorRegistration | null;
  commitment(id: Hex32): Promise<Commitment | undefined>;
  /** The last delivery event's payload, if any. */
  delivery(id: Hex32): Promise<{ deliveryHash: Hex32; attempt: number } | undefined>;
  attempt(id: Hex32): Promise<number>;
}

export class PrepareError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail);
  }
}
function bad(detail: string): never {
  throw new PrepareError(problem('invalid_terms', detail));
}

// ---- typed data ------------------------------------------------------------------------------------

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

const jsonable = (v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(jsonable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonable(x)])) : v;

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

// ---- helpers ---------------------------------------------------------------------------------------

const plus = (ts: Timestamp, seconds: number): Timestamp => new Date(Date.parse(ts) + seconds * 1000).toISOString().replace('.000Z', 'Z');
const wholeSecond = (ts: Timestamp): Timestamp => new Date(Math.floor(Date.parse(ts) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const lc = (a: string) => a.toLowerCase();
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHex32 = (v: unknown): v is Hex32 => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
/** A default nonce: keccak256 of the kind, the canonical inputs and a label. Same inputs, same nonce. */
const nonceOf = (kind: string, input: unknown, label: string): Hex32 => keccak256(stringToBytes(`holdback/prepare/v1/${kind}/${label}/${canonicalJson(input)}`)) as Hex32;
const amountText = (a: TokenAmount) => (a.token === 'tUSD' ? formatTusd(a.amount) : `${a.amount} base units of ${a.token}`);

function timestamp(v: unknown, name: string): Timestamp | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) bad(`${name} must be an RFC 3339 timestamp`);
  return wholeSecond(v as Timestamp);
}
function nonceIn(v: unknown, name: string): Hex32 | undefined {
  if (v === undefined) return undefined;
  if (!isHex32(v)) bad(`${name} must be 32 bytes of hex`);
  return v as Hex32;
}
function amountIn(v: unknown, name: string): TokenAmount {
  if (!isObj(v) || typeof v['token'] !== 'string' || typeof v['amount'] !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(v['amount'])) {
    return bad(`${name} must be {"token": "tUSD", "amount": "<base units as a decimal string>"}; tUSD has 6 decimals, so 25 tUSD is "25000000"`);
  }
  return { token: v['token'], amount: v['amount'] } as TokenAmount;
}

async function commitmentIn(ctx: PrepareContext, input: Record<string, unknown>): Promise<Commitment> {
  if (!isHex32(input['commitmentId'])) bad('commitmentId is required');
  const c = await ctx.commitment(input['commitmentId'] as Hex32);
  if (!c) throw new PrepareError(problem('not_found', `no commitment ${String(input['commitmentId'])}`));
  return c;
}

// ---- each kind -------------------------------------------------------------------------------------

async function offer(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const template = input['template'] ?? 'default';
  if (template !== 'default' && template !== 'checks-only') bad('template is "default" (checks, then a judge panel on the rubric) or "checks-only"');
  if (!isAddress(input['seller'])) bad('seller (your address) is required');
  const buyer = input['buyer'];
  if (!isObj(buyer) || !isAddress(buyer['address']) || typeof buyer['encryptionPublicKey'] !== 'string') bad('buyer is {"address", "encryptionPublicKey"}, as the buyer gave them to you');
  const adj = input['adjudicators'];
  if (!isObj(adj) || !isAddress(adj['primary']) || !isAddress(adj['fallback']) || !isAddress(adj['appeal'])) bad('adjudicators is {"primary", "fallback", "appeal"} addresses (GET /v1/adjudicators)');
  if (typeof input['clubId'] !== 'string') bad('clubId is required (GET /v1/clubs/{id})');
  const club = ctx.club(input['clubId'] as string) ?? bad(`no club ${String(input['clubId'])}`);
  if (!isObj(input['deliverable'])) bad('deliverable is {"kind", "description", "format"}');
  const slate = adj as unknown as AdjudicatorSlate;
  const primary = ctx.registration(slate.primary);
  if (!primary) throw new PrepareError(problem('not_found', `the primary adjudicator ${slate.primary} has no published registration`));
  for (const role of ['fallback', 'appeal'] as const) if (!ctx.registration(slate[role])) throw new PrepareError(problem('not_found', `the ${role} adjudicator ${slate[role]} has no published registration`));
  const base = {
    clubId: club.id,
    buyer: { address: lc(buyer!['address'] as string) as Address, encryptionPublicKey: buyer!['encryptionPublicKey'] as string },
    adjudicators: slate,
    price: amountIn(input['price'], 'price'),
    deliverable: input['deliverable'] as unknown as TermsDraft['deliverable'],
    ...(input['fee'] !== undefined ? { fee: amountIn(input['fee'], 'fee') } : {}),
    ...(isObj(input['timing']) ? { timing: input['timing'] as Partial<RelativeTiming> } : {}),
  };
  let draft: TermsDraft;
  try {
    draft =
      template === 'checks-only'
        ? checksOnlyTerms({ ...base, checks: (input['checks'] ?? []) as DeterministicCheck[] })
        : defaultTerms({ ...base, ...(input['checks'] ? { checks: input['checks'] as DeterministicCheck[] } : {}), ...(input['rubric'] ? { rubric: input['rubric'] as TermsDraft['acceptance']['rubric'] } : {}) });
  } catch (e) {
    return bad((e as Error).message);
  }
  const createdAt = timestamp(input['createdAt'], 'createdAt') ?? ctx.now();
  const nonce = nonceIn(input['nonce'], 'nonce') ?? nonceOf('offer', { ...input, createdAt }, 'terms');
  const terms: CommitmentTerms = completeTerms(draft, {
    seller: lc(input['seller'] as string) as Address,
    rulebookHash: club.rulebookHash,
    policyId: primary.policy.id,
    policyHash: primary.policyHash,
    registryHash: primary.registry.hash,
    fee: primary.fee.min,
    nonce,
    createdAt,
  });
  const id = commitmentId(terms);
  const total = BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount);
  return {
    kind: 'offer',
    commitmentId: id,
    sign: [{ slot: 'signatures.seller', signer: terms.seller, typedData: typedData(ctx.domain, 'CommitmentTerms', typedTermsOf(terms) as Record<string, unknown>), digest: termsDigest(ctx.domain, terms) }],
    submit: { method: 'POST', path: '/v1/commitments', body: { ...terms, id, signatures: { seller: null } } },
    check: [
      `you are the seller ${terms.seller}; the buyer is ${terms.buyer}`,
      `price ${amountText(terms.price)}; adjudication fee ${amountText(terms.adjudication.fee)} (the buyer holds ${amountText({ token: terms.price.token, amount: total.toString() } as TokenAmount)}; the fee is kept on a refund)`,
      `adjudicators: primary ${terms.adjudication.adjudicator}, fallback ${terms.adjudication.fallbackAdjudicator}, appeal ${terms.adjudication.appealAdjudicator}`,
      `policy ${terms.adjudication.policyId}, policyHash ${terms.adjudication.policyHash} = keccak256(JCS(policy)) of the primary's registration; registryHash ${terms.adjudication.registryHash}`,
      `deliverableHash and acceptanceHash in the typed data are keccak256 of the RFC 8785 JSON of submit.body.deliverable and submit.body.acceptance`,
      `deliver by ${terms.timing.deliverBy}; offer expires ${terms.timing.offerExpiresAt}`,
    ],
    defaults: { nonce, createdAt },
  };
}

async function agreeAndFund(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const agreeNonce = nonceIn(input['agreeNonce'], 'agreeNonce') ?? nonceOf('agree', c.id, 'agree');
  const fundingNonce = nonceIn(input['fundingNonce'], 'fundingNonce') ?? nonceOf('agree', c.id, 'funding');
  const total = (BigInt(c.price.amount) + BigInt(c.adjudication.fee.amount)).toString();
  const agree = { type: 'Agree', commitmentId: c.id, buyer: c.buyer, nonce: agreeNonce, expiresAt: c.timing.offerExpiresAt } as const;
  const funding = {
    type: 'FundingAuthorization',
    scheme: 'erc3009',
    commitmentId: c.id,
    from: c.buyer,
    value: total,
    token: c.price.token,
    validAfter: c.createdAt,
    validBefore: c.timing.fundBy,
    nonce: fundingNonce,
    expiresAt: c.timing.fundBy,
  } as const;
  return {
    kind: 'agree-and-fund',
    commitmentId: c.id,
    sign: [
      { slot: 'signature', signer: c.buyer, ...forMessage(ctx.domain, agree) },
      { slot: 'fund.signature', signer: c.buyer, ...forMessage(ctx.domain, funding) },
    ],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/agree`, body: { ...agree, signature: null, fund: { ...funding, signature: null } } },
    check: [
      `you are the buyer ${c.buyer}; the seller is ${c.seller}`,
      `you authorize ${amountText({ token: c.price.token, amount: total } as TokenAmount)}: price ${amountText(c.price)} plus fee ${amountText(c.adjudication.fee)}; the fee is kept on a refund`,
      `the work is sealed to your encryption key ${c.buyerEncryptionPublicKey}`,
      `adjudicators: primary ${c.adjudication.adjudicator}, fallback ${c.adjudication.fallbackAdjudicator}, appeal ${c.adjudication.appealAdjudicator}`,
      'the primary adjudicator must have accepted the offer first (escrowState AcceptedByAdjudicator)',
    ],
    defaults: { agreeNonce, fundingNonce },
  };
}

async function delivery(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const ct = input['ciphertext'];
  if (!isObj(ct) || typeof ct['uri'] !== 'string' || typeof ct['sha256'] !== 'string' || !Number.isSafeInteger(ct['bytes'])) bad('ciphertext is {"uri", "sha256", "bytes"} as POST /v1/ciphertext answered');
  if (typeof input['plaintextSha256'] !== 'string') bad('plaintextSha256 ("sha256:<hex>" of the plaintext) is required');
  const keys = input['encryptedKeys'];
  if (!Array.isArray(keys)) bad('encryptedKeys is one envelope per recipient (GET /v1/commitments/{id}/recipients)');
  const need = [c.adjudication.adjudicator, c.adjudication.fallbackAdjudicator, c.adjudication.appealAdjudicator, c.buyer].map(lc);
  const have = (keys as EncryptedKey[]).map((k) => lc(String(k?.recipient)));
  const missing = need.filter((a) => !have.includes(a));
  if (missing.length) bad(`encryptedKeys has no envelope for ${missing.join(', ')}; seal the content key to every recipient GET /v1/commitments/${c.id}/recipients lists`);
  const submittedAt = timestamp(input['submittedAt'], 'submittedAt') ?? ctx.now();
  const body = {
    commitmentId: c.id,
    attempt: Number.isSafeInteger(input['attempt']) ? (input['attempt'] as number) : 1,
    ciphertext: { uri: ct!['uri'] as string, sha256: ct!['sha256'] as Sha256, bytes: ct!['bytes'] as number, cipher: 'aes-256-gcm' as const },
    plaintextSha256: input['plaintextSha256'] as Sha256,
    plaintextMime: (input['plaintextMime'] ?? c.deliverable.format) as MimeType,
    encryptedKeys: (keys as EncryptedKey[]).map((k) => ({ recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext })),
    submittedAt,
  };
  return {
    kind: 'delivery',
    commitmentId: c.id,
    sign: [{ slot: 'signature', signer: c.seller, ...forMessage(ctx.domain, { ...body, type: 'Delivery' }) }],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/deliveries`, body: { ...body, signature: null } },
    check: [`you are the seller ${c.seller}`, `ciphertext ${body.ciphertext.sha256} (${body.ciphertext.bytes} bytes) at ${body.ciphertext.uri}`, `plaintext ${body.plaintextSha256}`, `envelopes for ${need.join(', ')}`],
    defaults: { submittedAt },
  };
}

async function earlyAccept(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  const nonce = nonceIn(input['nonce'], 'nonce') ?? nonceOf('early-accept', c.id, 'accept');
  const expiresAt = timestamp(input['expiresAt'], 'expiresAt') ?? plus(ctx.now(), 3600);
  const m = { type: 'EarlyAccept', commitmentId: c.id, buyer: c.buyer, attempt: await ctx.attempt(c.id), nonce, expiresAt } as const;
  return {
    kind: 'early-accept',
    commitmentId: c.id,
    sign: [{ slot: 'signature', signer: c.buyer, ...forMessage(ctx.domain, m) }],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/accept`, body: { ...m, signature: null } },
    check: [`you are the buyer ${c.buyer}`, `you accept the delivery and release ${amountText(c.price)} to the seller ${c.seller} now`],
    defaults: { nonce, expiresAt },
  };
}

async function appeal(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  if (!isAddress(input['appellant'])) bad('appellant (your address) is required');
  const who = lc(input['appellant'] as string);
  const appellant: 'buyer' | 'seller' = who === lc(c.buyer) ? 'buyer' : who === lc(c.seller) ? 'seller' : bad(`${who} is neither party to ${c.id}`);
  const rulebook = ctx.club(c.clubId)?.rulebook ?? bad(`no club ${c.clubId}`);
  const bond = mulBps(c.price, BigInt(rulebook.appealBondRateBps), 'ceil');
  if (!bond.ok) return bad('cannot compute the appeal bond');
  const filedAt = timestamp(input['filedAt'], 'filedAt') ?? ctx.now();
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
    defaults: { filedAt },
  };
}

async function settlement(ctx: PrepareContext, input: Record<string, unknown>): Promise<Prepared> {
  const c = await commitmentIn(ctx, input);
  let payouts: Payout[];
  if (input['payouts'] !== undefined) {
    if (!Array.isArray(input['payouts'])) bad('payouts is a list of {"to", "amount"}');
    payouts = (input['payouts'] as unknown[]).map((p, i) => {
      if (!isObj(p) || !isAddress(p['to'])) return bad(`payouts[${i}].to must be an address`);
      return { to: p['to'] as Address, amount: amountIn(p['amount'], `payouts[${i}].amount`) };
    });
  } else {
    const bps = input['toSellerBps'];
    if (!Number.isSafeInteger(bps) || (bps as number) < 0 || (bps as number) > 10_000) bad('give payouts, or toSellerBps (0 to 10000): the seller gets that share of the price, the buyer the rest');
    const split = splitBps(c.price, BigInt(bps as number));
    if (!split.ok) return bad('cannot split the price');
    payouts = [
      { to: c.seller, amount: split.value.share },
      { to: c.buyer, amount: split.value.remainder },
    ].filter((p) => p.amount.amount !== '0');
  }
  const delivered = await ctx.delivery(c.id);
  const nonce = nonceIn(input['nonce'], 'nonce') ?? nonceOf('settlement', { id: c.id, payouts }, 'settle');
  const expiresAt = timestamp(input['expiresAt'], 'expiresAt') ?? plus(ctx.now(), 3600);
  const releaseKey = typeof input['releaseKey'] === 'boolean' ? input['releaseKey'] : delivered !== undefined;
  const m = { type: 'MutualSettlement', commitmentId: c.id, deliveryHash: delivered?.deliveryHash ?? null, payouts, releaseKey, nonce, expiresAt } as const;
  const signed = forMessage(ctx.domain, m);
  return {
    kind: 'settlement',
    commitmentId: c.id,
    sign: [
      { slot: 'buyerSignature', signer: c.buyer, ...signed },
      { slot: 'sellerSignature', signer: c.seller, ...signed },
    ],
    submit: { method: 'POST', path: `/v1/commitments/${c.id}/settlements`, body: { ...m, buyerSignature: null, sellerSignature: null } },
    check: [
      `payouts: ${payouts.map((p) => `${amountText(p.amount)} to ${p.to}${lc(p.to) === lc(c.seller) ? ' (seller)' : lc(p.to) === lc(c.buyer) ? ' (buyer)' : ''}`).join('; ')} (they must sum to the price ${amountText(c.price)})`,
      `the fee ${amountText(c.adjudication.fee)} returns to the buyer`,
      releaseKey ? 'the buyer receives the content key' : 'the content key is not released',
      'both parties sign the identical typed data; either may submit once both signatures are in',
    ],
    defaults: { nonce, expiresAt, releaseKey },
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

export function prepare(kind: string, ctx: PrepareContext, input: unknown): Promise<Prepared> {
  if (!(PREPARE_KINDS as readonly string[]).includes(kind)) throw new PrepareError(problem('not_found', `nothing to prepare for ${kind}; kinds: ${PREPARE_KINDS.join(', ')}`));
  if (!isObj(input)) bad('the body must be a JSON object');
  return PREPARERS[kind as PrepareKind](ctx, input as Record<string, unknown>);
}
