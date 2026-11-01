// EIP-712 domain, typed-data definitions, the commitment ID, and sign/verify helpers.
//
// Encoding choices (EIP-712 has no floats and no optional fields):
// - Timestamps are uint64 Unix seconds; amounts are uint256 base units.
// - `deliverable` and `acceptance` carry fractional weights and open-ended check variants, so the terms
//   bind them as keccak256 of their RFC 8785 canonical JSON (deliverableHash, acceptanceHash).
// - Optional message fields are encoded as empty values when absent (empty string, empty array).
//   Every schema value for those fields is non-empty, so absent and present never collide.
//   Scope.categories may legitimately be empty, so it carries an explicit hasCategories flag.
// - The domain version tracks the signed encoding: it moves when an existing typed-data struct or the terms
//   encoding changes, so a signature made under one encoding never verifies under another. Additive schema
//   versions leave it (ADR-0023: schema 0.7 adds TransferAuthorization and keeps domain version 0.6).
import { hashStruct, hashTypedData, isAddressEqual, recoverTypedDataAddress, type Hex } from 'viem';
import { signTypedData } from 'viem/accounts';
import { canonicalKeccak } from './canonical.js';
import { instant } from './timing.js';
import type {
  Address,
  AnyCommitment,
  AnyCommitmentTerms,
  Appeal,
  Commitment,
  CommitmentTerms,
  CredentialMessage,
  SealedCommitmentTerms,
  Delivery,
  EncryptedKey,
  Hex32,
  Mandate,
  CoSignedMessage,
  MutualSettlement,
  Receipt,
  Scope,
  Signature,
  SignedMessage,
  Timestamp,
  TokenAmount,
} from './types.js';

/** Fixed placeholder verifying contract for SimChain ("HOLD" in ASCII). No contract lives here. */
export const SIMCHAIN_VERIFYING_CONTRACT: Address = '0x00000000000000000000000000000000484f4c44';

export interface HoldbackDomain {
  name: 'Holdback';
  version: '0.6';
  chainId: bigint;
  verifyingContract: Address;
}

export function holdbackDomain(chainId: number | bigint, verifyingContract: Address = SIMCHAIN_VERIFYING_CONTRACT): HoldbackDomain {
  return { name: 'Holdback', version: '0.6', chainId: BigInt(chainId), verifyingContract };
}

const ZERO32: Hex32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS: Address = `0x${'0'.repeat(40)}`;
const field = (name: string, type: string) => ({ name, type });
const stamp = (name: string) => field(name, 'uint64');
const expiring = [field('nonce', 'bytes32'), stamp('expiresAt')];

const structs = {
  TokenAmount: [field('token', 'string'), field('amount', 'uint256')],
  Adjudication: [
    field('adjudicator', 'address'),
    field('fallbackAdjudicator', 'address'),
    field('appealAdjudicator', 'address'),
    field('policyId', 'string'),
    field('fee', 'TokenAmount'),
    field('registryHash', 'bytes32'),
    field('policyHash', 'bytes32'),
  ],
  Timing: [
    stamp('offerExpiresAt'),
    stamp('fundBy'),
    stamp('deliverBy'),
    stamp('judgeBy'),
    stamp('fallbackBy'),
    field('appealWindowSec', 'uint64'),
    field('appealDecideSec', 'uint64'),
    field('maxSubmissions', 'uint8'),
    // Optimistic mode only (ADR-0015). 0 when absent: settlement.mode is bound too, and the schema
    // requires these exactly in optimistic mode with minimums of 1, so 0 never collides with a value.
    stamp('disputeBy'),
    field('disputeJudgeSec', 'uint64'),
    field('disputeFallbackSec', 'uint64'),
  ],
  Settlement: [field('mode', 'string'), field('token', 'string')],
  Remedy: [field('onReject', 'string')],
  SealedKey: [field('scheme', 'string'), field('ciphertext', 'string')],
  Beacon: [field('source', 'string'), field('round', 'uint64'), field('value', 'bytes32'), field('signature', 'bytes')],
  Ciphertext: [field('uri', 'string'), field('sha256', 'string'), field('bytes', 'uint64'), field('cipher', 'string')],
  EncryptedKey: [field('recipient', 'address'), field('scheme', 'string'), field('ciphertext', 'string'), field('unlock', 'KeyUnlock')],
  KeyUnlock: [field('kind', 'string'), field('round', 'uint64')],
  Payout: [field('to', 'address'), field('amount', 'TokenAmount')],
  Disclosure: [field('level', 'string')],
  Scope: [
    field('roles', 'string[]'),
    field('maxPerCommitment', 'TokenAmount'),
    field('maxDaily', 'TokenAmount'),
    field('hasCategories', 'bool'),
    field('categories', 'string[]'),
    stamp('expiresAt'),
  ],
};

const termsType = [
  field('schemaVersion', 'string'),
  field('clubId', 'string'),
  field('rulebookHash', 'bytes32'),
  field('buyer', 'address'),
  field('seller', 'address'),
  field('deliverableHash', 'bytes32'),
  field('acceptanceHash', 'bytes32'),
  field('price', 'TokenAmount'),
  field('adjudication', 'Adjudication'),
  field('timing', 'Timing'),
  field('settlement', 'Settlement'),
  field('remedy', 'Remedy'),
  field('disclosure', 'Disclosure'),
  field('buyerEncryptionPublicKey', 'string'),
  field('nonce', 'bytes32'),
  stamp('createdAt'),
];

/** Primary types for every message in messages.schema.json plus Delivery, Appeal, Receipt and Mandate. */
export const messageTypes = {
  Offer: [field('commitmentId', 'bytes32'), field('seller', 'address'), ...expiring],
  Agree: [field('commitmentId', 'bytes32'), field('buyer', 'address'), ...expiring],
  AdjudicatorAcceptance: [
    field('commitmentId', 'bytes32'),
    field('adjudicator', 'address'),
    field('seedCommitment', 'bytes32'),
    field('policyHash', 'bytes32'),
    field('registryHash', 'bytes32'),
    field('fee', 'TokenAmount'),
    field('bondReserved', 'TokenAmount'),
    ...expiring,
  ],
  FundingAuthorization: [
    field('scheme', 'string'),
    field('commitmentId', 'bytes32'),
    field('from', 'address'),
    field('value', 'uint256'),
    field('token', 'string'),
    stamp('validAfter'),
    stamp('validBefore'),
    ...expiring,
  ],
  // ADR-0023: the buyer's operator fee, bound to one commitment and paid to one address.
  TransferAuthorization: [
    field('scheme', 'string'),
    field('purpose', 'string'),
    field('commitmentId', 'bytes32'),
    field('from', 'address'),
    field('to', 'address'),
    field('value', 'uint256'),
    field('token', 'string'),
    stamp('validAfter'),
    stamp('validBefore'),
    ...expiring,
  ],
  EarlyAccept: [field('commitmentId', 'bytes32'), field('buyer', 'address'), field('attempt', 'uint8'), ...expiring],
  Decision: [
    field('commitmentId', 'bytes32'),
    field('attempt', 'uint8'),
    field('adjudicator', 'address'),
    field('role', 'string'),
    field('outcome', 'string'),
    field('seed', 'bytes32'),
    field('policyHash', 'bytes32'),
    field('registryHash', 'bytes32'),
    field('judgmentRecordHash', 'bytes32'),
    field('keyForBuyer', 'SealedKey'),
    field('appealGround', 'string'),
    field('beacon', 'Beacon'),
    field('encryptedKeys', 'EncryptedKey[]'),
    ...expiring,
  ],
  AgentRevocation: [field('agent', 'address'), field('principal', 'address'), ...expiring],
  MemberAdmission: [field('clubId', 'string'), field('member', 'address'), field('operator', 'address'), stamp('validUntil'), ...expiring],
  MemberRevocation: [field('clubId', 'string'), field('member', 'address'), field('operator', 'address'), ...expiring],
  Dispute: [
    field('commitmentId', 'bytes32'),
    field('buyer', 'address'),
    field('attempt', 'uint8'),
    field('grounds', 'string'),
    field('bond', 'TokenAmount'),
    field('fee', 'TokenAmount'),
    field('encryptedKeys', 'EncryptedKey[]'),
    ...expiring,
  ],
  Delivery: [
    field('commitmentId', 'bytes32'),
    field('attempt', 'uint8'),
    field('ciphertext', 'Ciphertext'),
    field('plaintextSha256', 'string'),
    field('plaintextMime', 'string'),
    field('encryptedKeys', 'EncryptedKey[]'),
    stamp('submittedAt'),
  ],
  Appeal: [
    field('commitmentId', 'bytes32'),
    field('appellant', 'string'),
    field('appellantAddress', 'address'),
    field('grounds', 'string'),
    field('bond', 'TokenAmount'),
    stamp('filedAt'),
  ],
  MutualSettlement: [
    field('commitmentId', 'bytes32'),
    field('hasDelivery', 'bool'),
    field('deliveryHash', 'bytes32'),
    field('payouts', 'Payout[]'),
    field('releaseKey', 'bool'),
    ...expiring,
  ],
  Publish: [field('commitmentId', 'bytes32'), field('level', 'string'), ...expiring],
  // ADR-0024: new types, so no existing struct changes and the domain stays 0.6. A flag marks an absent audience.
  ReadToken: [field('viewer', 'address'), field('commitmentId', 'bytes32'), field('hasAudience', 'bool'), field('audience', 'address'), ...expiring],
  Delegation: [
    field('principal', 'address'),
    field('agent', 'address'),
    field('dealKey', 'address'),
    field('dealEncryptionKey', 'string'),
    field('clubId', 'string'),
    field('scope', 'Scope'),
    ...expiring,
  ],
  KeyRegistration: [field('adjudicator', 'address'), field('encryptionPublicKey', 'string'), field('keyId', 'string'), ...expiring],
  Receipt: [field('operator', 'address'), field('eventSeq', 'uint64'), field('eventHash', 'bytes32'), field('hasCommitment', 'bool'), field('commitmentId', 'bytes32')],
  Mandate: [field('principal', 'address'), field('agent', 'address'), field('clubId', 'string'), field('scope', 'Scope'), field('nonce', 'bytes32'), stamp('issuedAt')],
};

export const eip712Types = { ...structs, CommitmentTerms: termsType, ...messageTypes };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Everything an agent or operator signs. Delivery, Appeal, Receipt and Mandate have no `type` in their schemas; it is
 * added here to pick the primary type. Receipts are signed by an operator (ADR-0017), everything else by a party.
 */
export type SignableMessage =
  | SignedMessage
  | CredentialMessage
  | (Delivery & { type: 'Delivery' })
  | (Appeal & { type: 'Appeal' })
  | (Receipt & { type: 'Receipt' })
  | (Mandate & { type: 'Mandate' });
/** MutualSettlement and Publish carry a buyer and a seller signature over the identical struct (ADR-0019, ADR-0020). */
export type UnsignedCoSigned = DistributiveOmit<CoSignedMessage, 'buyerSignature' | 'sellerSignature'>;
export type UnsignedMutualSettlement = Omit<MutualSettlement, 'buyerSignature' | 'sellerSignature'>;
export type UnsignedMessage = DistributiveOmit<SignableMessage, 'signature'> | UnsignedCoSigned;

type Encoded = Record<string, unknown>;

function seconds(ts: Timestamp): bigint {
  const ms = instant(ts);
  if (ms === undefined) throw new RangeError(`cannot encode timestamp ${ts}: need RFC 3339 in whole seconds`);
  return BigInt(ms / 1000);
}

const amount = (a: TokenAmount): Encoded => ({ token: a.token, amount: BigInt(a.amount) });
// An absent unlock encodes as an empty kind, which the schema never admits.
const key = (k: EncryptedKey): Encoded => ({
  recipient: k.recipient,
  scheme: k.scheme,
  ciphertext: k.ciphertext,
  unlock: k.unlock ? { kind: k.unlock.kind, round: BigInt(k.unlock.round ?? 0) } : { kind: '', round: 0n },
});
const scope = (s: Scope): Encoded => ({
  roles: s.roles,
  maxPerCommitment: amount(s.maxPerCommitment),
  maxDaily: amount(s.maxDaily),
  hasCategories: s.categories !== undefined,
  categories: s.categories ?? [],
  expiresAt: seconds(s.expiresAt),
});

/** True for the sealed wire form (private and judgment levels, ADR-0024): bodies as privateTerms ciphertext. */
export const isSealed = (t: AnyCommitmentTerms): t is SealedCommitmentTerms => (t as Partial<SealedCommitmentTerms>).privateTerms !== undefined;

/** The bodies' hashes as the struct binds them: from the plaintext, or from privateTerms in the sealed form. */
export function bodyHashes(t: AnyCommitmentTerms): { deliverableHash: Hex32; acceptanceHash: Hex32 } {
  return isSealed(t)
    ? { deliverableHash: t.privateTerms.deliverable.hash, acceptanceHash: t.privateTerms.acceptance.hash }
    : { deliverableHash: canonicalKeccak(t.deliverable), acceptanceHash: canonicalKeccak(t.acceptance) };
}

/**
 * The terms of a commitment: every field except id, signatures and adjudicatorAcceptance. The sealed form keeps
 * privateTerms (outside the ID, which binds only its hashes).
 */
export function termsOf(c: Commitment): CommitmentTerms;
export function termsOf(c: AnyCommitment): AnyCommitmentTerms;
export function termsOf(c: AnyCommitment): AnyCommitmentTerms {
  const bodies = isSealed(c) ? { privateTerms: c.privateTerms } : { deliverable: c.deliverable, acceptance: c.acceptance };
  return {
    schemaVersion: c.schemaVersion,
    clubId: c.clubId,
    rulebookHash: c.rulebookHash,
    buyer: c.buyer,
    seller: c.seller,
    ...bodies,
    price: c.price,
    adjudication: c.adjudication,
    timing: c.timing,
    settlement: c.settlement,
    remedy: c.remedy,
    disclosure: c.disclosure,
    buyerEncryptionPublicKey: c.buyerEncryptionPublicKey,
    nonce: c.nonce,
    createdAt: c.createdAt,
  } as AnyCommitmentTerms;
}

/** The terms as EIP-712 typed values (primary type CommitmentTerms). Either form gives the same values. */
export function typedTermsOf(t: AnyCommitmentTerms): Encoded {
  return {
    schemaVersion: t.schemaVersion,
    clubId: t.clubId,
    rulebookHash: t.rulebookHash,
    buyer: t.buyer,
    seller: t.seller,
    ...bodyHashes(t),
    price: amount(t.price),
    adjudication: { ...t.adjudication, fee: amount(t.adjudication.fee) },
    timing: {
      offerExpiresAt: seconds(t.timing.offerExpiresAt),
      fundBy: seconds(t.timing.fundBy),
      deliverBy: seconds(t.timing.deliverBy),
      judgeBy: seconds(t.timing.judgeBy),
      fallbackBy: seconds(t.timing.fallbackBy),
      appealWindowSec: BigInt(t.timing.appealWindowSec),
      appealDecideSec: BigInt(t.timing.appealDecideSec),
      maxSubmissions: t.timing.maxSubmissions,
      disputeBy: t.timing.disputeBy === undefined ? 0n : seconds(t.timing.disputeBy),
      disputeJudgeSec: BigInt(t.timing.disputeJudgeSec ?? 0),
      disputeFallbackSec: BigInt(t.timing.disputeFallbackSec ?? 0),
    },
    settlement: t.settlement,
    remedy: t.remedy,
    disclosure: t.disclosure,
    buyerEncryptionPublicKey: t.buyerEncryptionPublicKey,
    nonce: t.nonce,
    createdAt: seconds(t.createdAt),
  };
}

const expiry = (m: { nonce: Hex32; expiresAt: Timestamp }): Encoded => ({ nonce: m.nonce, expiresAt: seconds(m.expiresAt) });

/** A message as EIP-712 typed values; the primary type is its `type`. Throws RangeError on unencodable values. */
export function typedDataOf(m: UnsignedMessage): { primaryType: UnsignedMessage['type']; message: Encoded } {
  return { primaryType: m.type, message: encodeMessage(m) };
}

function encodeMessage(m: UnsignedMessage): Encoded {
  switch (m.type) {
    case 'Offer':
      return { commitmentId: m.commitmentId, seller: m.seller, ...expiry(m) };
    case 'Agree':
      return { commitmentId: m.commitmentId, buyer: m.buyer, ...expiry(m) };
    case 'AdjudicatorAcceptance':
      return {
        commitmentId: m.commitmentId,
        adjudicator: m.adjudicator,
        seedCommitment: m.seedCommitment,
        policyHash: m.policyHash,
        registryHash: m.registryHash,
        fee: amount(m.fee),
        bondReserved: amount(m.bondReserved),
        ...expiry(m),
      };
    case 'FundingAuthorization':
      return {
        scheme: m.scheme,
        commitmentId: m.commitmentId,
        from: m.from,
        value: BigInt(m.value),
        token: m.token,
        validAfter: seconds(m.validAfter),
        validBefore: seconds(m.validBefore),
        ...expiry(m),
      };
    case 'TransferAuthorization':
      return {
        scheme: m.scheme,
        purpose: m.purpose,
        commitmentId: m.commitmentId,
        from: m.from,
        to: m.to,
        value: BigInt(m.value),
        token: m.token,
        validAfter: seconds(m.validAfter),
        validBefore: seconds(m.validBefore),
        ...expiry(m),
      };
    case 'EarlyAccept':
      return { commitmentId: m.commitmentId, buyer: m.buyer, attempt: m.attempt, ...expiry(m) };
    case 'Decision':
      return {
        commitmentId: m.commitmentId,
        attempt: m.attempt,
        adjudicator: m.adjudicator,
        role: m.role,
        outcome: m.outcome,
        seed: m.seed,
        policyHash: m.policyHash,
        registryHash: m.registryHash,
        judgmentRecordHash: m.judgmentRecordHash,
        keyForBuyer: m.keyForBuyer ?? { scheme: '', ciphertext: '' },
        appealGround: m.appealGround ?? '',
        // Absent encodes as an empty source, which the schema never admits, so absent and present never collide.
        beacon: m.beacon
          ? { source: m.beacon.source, round: BigInt(m.beacon.round), value: m.beacon.value, signature: m.beacon.signature ?? '0x' }
          : { source: '', round: 0n, value: ZERO32, signature: '0x' },
        // Absent encodes as an empty list; the schema requires at least one key when present.
        encryptedKeys: (m.encryptedKeys ?? []).map(key),
        ...expiry(m),
      };
    case 'AgentRevocation':
      return { agent: m.agent, principal: m.principal, ...expiry(m) };
    case 'MemberAdmission':
      return { clubId: m.clubId, member: m.member, operator: m.operator, validUntil: seconds(m.validUntil), ...expiry(m) };
    case 'MemberRevocation':
      return { clubId: m.clubId, member: m.member, operator: m.operator, ...expiry(m) };
    case 'Dispute':
      return {
        commitmentId: m.commitmentId,
        buyer: m.buyer,
        attempt: m.attempt,
        grounds: m.grounds,
        bond: amount(m.bond),
        fee: amount(m.fee),
        encryptedKeys: m.encryptedKeys.map(key),
        ...expiry(m),
      };
    case 'Publish':
      return { commitmentId: m.commitmentId, level: m.level, ...expiry(m) };
    case 'ReadToken':
      return { viewer: m.viewer, commitmentId: m.commitmentId, hasAudience: m.audience !== undefined, audience: m.audience ?? ZERO_ADDRESS, ...expiry(m) };
    case 'Delegation':
      return {
        principal: m.principal,
        agent: m.agent,
        dealKey: m.dealKey,
        dealEncryptionKey: m.dealEncryptionKey,
        clubId: m.clubId,
        scope: scope(m.scope),
        ...expiry(m),
      };
    case 'KeyRegistration':
      return { adjudicator: m.adjudicator, encryptionPublicKey: m.encryptionPublicKey, keyId: m.keyId, ...expiry(m) };
    case 'MutualSettlement':
      // A null deliveryHash (settled before delivery) is flagged, so it never collides with a zero hash.
      return {
        commitmentId: m.commitmentId,
        hasDelivery: m.deliveryHash !== null,
        deliveryHash: m.deliveryHash ?? ZERO32,
        payouts: m.payouts.map((p) => ({ to: p.to, amount: amount(p.amount) })),
        releaseKey: m.releaseKey,
        ...expiry(m),
      };
    case 'Receipt':
      // A flag, not a zero hash, marks a receipt for an event with no commitment.
      return { operator: m.operator, eventSeq: BigInt(m.eventSeq), eventHash: m.eventHash, hasCommitment: m.commitmentId !== undefined, commitmentId: m.commitmentId ?? ZERO32 };
    case 'Delivery':
      return {
        commitmentId: m.commitmentId,
        attempt: m.attempt,
        ciphertext: { ...m.ciphertext, bytes: BigInt(m.ciphertext.bytes) },
        plaintextSha256: m.plaintextSha256,
        plaintextMime: m.plaintextMime,
        encryptedKeys: m.encryptedKeys.map(key),
        submittedAt: seconds(m.submittedAt),
      };
    case 'Appeal':
      return {
        commitmentId: m.commitmentId,
        appellant: m.appellant,
        appellantAddress: m.appellantAddress,
        grounds: m.grounds,
        bond: amount(m.bond),
        filedAt: seconds(m.filedAt),
      };
    case 'Mandate':
      return { principal: m.principal, agent: m.agent, clubId: m.clubId, scope: scope(m.scope), nonce: m.nonce, issuedAt: seconds(m.issuedAt) };
  }
}

/**
 * The commitment ID: the EIP-712 struct hash of the terms only (ADR-0016). It has no domain, so it
 * is the same on every chain; signatures over the terms add the domain.
 */
export function commitmentId(terms: AnyCommitmentTerms): Hex32 {
  return hashStruct({ primaryType: 'CommitmentTerms', types: eip712Types, data: typedTermsOf(terms) });
}

// viem's typed-data generics need literal types; these values are built dynamically and checked by the encoders above.
type Typed = { domain: HoldbackDomain; types: typeof eip712Types; primaryType: string; message: Encoded };
const typed = (domain: HoldbackDomain, primaryType: string, message: Encoded): Typed => ({ domain, types: eip712Types, primaryType, message });

/**
 * The delivery hash a MutualSettlement names (ADR-0019): the EIP-712 struct hash of the delivery without
 * its signature. Like the commitment ID it has no domain, so it is the same on every chain.
 */
export function deliveryHash(d: Delivery): Hex32 {
  const unsigned: Omit<Delivery, 'signature'> & { signature?: unknown } = { ...d };
  delete unsigned.signature;
  return hashStruct({ primaryType: 'Delivery', types: eip712Types, data: encodeMessage({ ...unsigned, type: 'Delivery' }) });
}

/** The EIP-712 digest an agent signs for a message, e.g. for a contract or relayer to compare. */
export const messageDigest = (domain: HoldbackDomain, message: UnsignedMessage): Hex32 =>
  hashTypedData(typed(domain, message.type, encodeMessage(message)) as Parameters<typeof hashTypedData>[0]);

/** The EIP-712 digest a party signs for the terms. */
export const termsDigest = (domain: HoldbackDomain, terms: AnyCommitmentTerms): Hex32 =>
  hashTypedData(typed(domain, 'CommitmentTerms', typedTermsOf(terms)) as Parameters<typeof hashTypedData>[0]);

async function sign(privateKey: Hex, t: Typed): Promise<Signature> {
  return signTypedData({ privateKey, ...t } as Parameters<typeof signTypedData>[0]);
}

async function recoversTo(t: Typed, signature: Signature, expected: Address): Promise<boolean> {
  try {
    const signer = await recoverTypedDataAddress({ ...t, signature } as Parameters<typeof recoverTypedDataAddress>[0]);
    return isAddressEqual(signer, expected);
  } catch {
    return false;
  }
}

/** A party's signature over the full terms, as held in commitment.signatures. */
export const signTerms = (privateKey: Hex, domain: HoldbackDomain, terms: AnyCommitmentTerms): Promise<Signature> =>
  sign(privateKey, typed(domain, 'CommitmentTerms', typedTermsOf(terms)));

export function verifyTerms(domain: HoldbackDomain, terms: AnyCommitmentTerms, signature: Signature, expected: Address): Promise<boolean> {
  return recoversTo(typed(domain, 'CommitmentTerms', typedTermsOf(terms)), signature, expected);
}

export const signMessage = (privateKey: Hex, domain: HoldbackDomain, message: UnsignedMessage): Promise<Signature> =>
  sign(privateKey, typed(domain, message.type, encodeMessage(message)));

/** True when the message's signature recovers to `expected`. Never throws on malformed input. */
export async function verifyMessage(domain: HoldbackDomain, message: SignableMessage, expected: Address): Promise<boolean> {
  const { signature, ...unsigned } = message;
  let encoded: Encoded;
  try {
    encoded = encodeMessage(unsigned as UnsignedMessage);
  } catch {
    return false;
  }
  return recoversTo(typed(domain, message.type, encoded), signature, expected);
}

/** True when buyer and seller both signed the identical struct. Never throws on malformed input. */
export async function verifyCoSigned(domain: HoldbackDomain, m: CoSignedMessage, buyer: Address, seller: Address): Promise<boolean> {
  const { buyerSignature, sellerSignature, ...unsigned } = m;
  let encoded: Encoded;
  try {
    encoded = encodeMessage(unsigned as UnsignedCoSigned);
  } catch {
    return false;
  }
  const t = typed(domain, m.type, encoded);
  return (await recoversTo(t, buyerSignature, buyer)) && (await recoversTo(t, sellerSignature, seller));
}

/** A mutual settlement is valid only when both parties signed it (ADR-0019). */
export const verifyMutualSettlement = (domain: HoldbackDomain, m: MutualSettlement, buyer: Address, seller: Address): Promise<boolean> =>
  verifyCoSigned(domain, m, buyer, seller);
