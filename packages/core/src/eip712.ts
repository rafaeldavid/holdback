// EIP-712 domain, typed-data definitions, the commitment ID, and sign/verify helpers.
//
// Encoding choices (EIP-712 has no floats and no optional fields):
// - Timestamps are uint64 Unix seconds; amounts are uint256 base units.
// - `deliverable` and `acceptance` carry fractional weights and open-ended check variants, so the terms
//   bind them as keccak256 of their RFC 8785 canonical JSON (deliverableHash, acceptanceHash).
// - Optional message fields are encoded as empty values when absent (empty string, empty array).
//   Every schema value for those fields is non-empty, so absent and present never collide.
import { hashStruct, isAddressEqual, recoverTypedDataAddress, type Hex } from 'viem';
import { signTypedData } from 'viem/accounts';
import { canonicalKeccak } from './canonical.js';
import { instant } from './timing.js';
import type {
  Address,
  Appeal,
  Commitment,
  CommitmentTerms,
  Delivery,
  Hex32,
  Mandate,
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
  version: '0.4';
  chainId: bigint;
  verifyingContract: Address;
}

export function holdbackDomain(chainId: number | bigint, verifyingContract: Address = SIMCHAIN_VERIFYING_CONTRACT): HoldbackDomain {
  return { name: 'Holdback', version: '0.4', chainId: BigInt(chainId), verifyingContract };
}

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
  ],
  Settlement: [field('mode', 'string'), field('token', 'string')],
  Remedy: [field('onReject', 'string')],
  SealedKey: [field('scheme', 'string'), field('ciphertext', 'string')],
  Ciphertext: [field('uri', 'string'), field('sha256', 'string'), field('bytes', 'uint64'), field('cipher', 'string')],
  EncryptedKey: [field('recipient', 'address'), field('scheme', 'string'), field('ciphertext', 'string')],
  Scope: [
    field('roles', 'string[]'),
    field('maxPerCommitment', 'TokenAmount'),
    field('maxDaily', 'TokenAmount'),
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
  field('buyerEncryptionPublicKey', 'string'),
  field('nonce', 'bytes32'),
  stamp('createdAt'),
];

/** Primary types for every message in messages.schema.json plus Delivery, Appeal and Mandate. */
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
    ...expiring,
  ],
  AgentRevocation: [field('agent', 'address'), field('principal', 'address'), ...expiring],
  MemberAdmission: [field('clubId', 'string'), field('member', 'address'), field('operator', 'address'), stamp('validUntil'), ...expiring],
  MemberRevocation: [field('clubId', 'string'), field('member', 'address'), field('operator', 'address'), ...expiring],
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
  Mandate: [field('principal', 'address'), field('agent', 'address'), field('clubId', 'string'), field('scope', 'Scope'), field('nonce', 'bytes32'), stamp('issuedAt')],
};

export const eip712Types = { ...structs, CommitmentTerms: termsType, ...messageTypes };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Everything an agent signs. Delivery, Appeal and Mandate have no `type` in their schemas; it is added here to pick the primary type. */
export type SignableMessage = SignedMessage | (Delivery & { type: 'Delivery' }) | (Appeal & { type: 'Appeal' }) | (Mandate & { type: 'Mandate' });
export type UnsignedMessage = DistributiveOmit<SignableMessage, 'signature'>;

type Encoded = Record<string, unknown>;

function seconds(ts: Timestamp): bigint {
  const ms = instant(ts);
  if (ms === undefined) throw new RangeError(`cannot encode timestamp ${ts}: need RFC 3339 in whole seconds`);
  return BigInt(ms / 1000);
}

const amount = (a: TokenAmount): Encoded => ({ token: a.token, amount: BigInt(a.amount) });
const scope = (s: Scope): Encoded => ({
  roles: s.roles,
  maxPerCommitment: amount(s.maxPerCommitment),
  maxDaily: amount(s.maxDaily),
  categories: s.categories ?? [],
  expiresAt: seconds(s.expiresAt),
});

/** The terms of a commitment: every field except id, signatures and adjudicatorAcceptance. */
export function termsOf(c: Commitment): CommitmentTerms {
  return {
    schemaVersion: c.schemaVersion,
    clubId: c.clubId,
    rulebookHash: c.rulebookHash,
    buyer: c.buyer,
    seller: c.seller,
    deliverable: c.deliverable,
    acceptance: c.acceptance,
    price: c.price,
    adjudication: c.adjudication,
    timing: c.timing,
    settlement: c.settlement,
    remedy: c.remedy,
    buyerEncryptionPublicKey: c.buyerEncryptionPublicKey,
    nonce: c.nonce,
    createdAt: c.createdAt,
  };
}

function encodeTerms(t: CommitmentTerms): Encoded {
  return {
    schemaVersion: t.schemaVersion,
    clubId: t.clubId,
    rulebookHash: t.rulebookHash,
    buyer: t.buyer,
    seller: t.seller,
    deliverableHash: canonicalKeccak(t.deliverable),
    acceptanceHash: canonicalKeccak(t.acceptance),
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
    },
    settlement: t.settlement,
    remedy: t.remedy,
    buyerEncryptionPublicKey: t.buyerEncryptionPublicKey,
    nonce: t.nonce,
    createdAt: seconds(t.createdAt),
  };
}

const expiry = (m: { nonce: Hex32; expiresAt: Timestamp }): Encoded => ({ nonce: m.nonce, expiresAt: seconds(m.expiresAt) });

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
        ...expiry(m),
      };
    case 'AgentRevocation':
      return { agent: m.agent, principal: m.principal, ...expiry(m) };
    case 'MemberAdmission':
      return { clubId: m.clubId, member: m.member, operator: m.operator, validUntil: seconds(m.validUntil), ...expiry(m) };
    case 'MemberRevocation':
      return { clubId: m.clubId, member: m.member, operator: m.operator, ...expiry(m) };
    case 'Delivery':
      return {
        commitmentId: m.commitmentId,
        attempt: m.attempt,
        ciphertext: { ...m.ciphertext, bytes: BigInt(m.ciphertext.bytes) },
        plaintextSha256: m.plaintextSha256,
        plaintextMime: m.plaintextMime,
        encryptedKeys: m.encryptedKeys,
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
export function commitmentId(terms: CommitmentTerms): Hex32 {
  return hashStruct({ primaryType: 'CommitmentTerms', types: eip712Types, data: encodeTerms(terms) });
}

// viem's typed-data generics need literal types; these values are built dynamically and checked by the encoders above.
type Typed = { domain: HoldbackDomain; types: typeof eip712Types; primaryType: string; message: Encoded };
const typed = (domain: HoldbackDomain, primaryType: string, message: Encoded): Typed => ({ domain, types: eip712Types, primaryType, message });

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
export const signTerms = (privateKey: Hex, domain: HoldbackDomain, terms: CommitmentTerms): Promise<Signature> =>
  sign(privateKey, typed(domain, 'CommitmentTerms', encodeTerms(terms)));

export function verifyTerms(domain: HoldbackDomain, terms: CommitmentTerms, signature: Signature, expected: Address): Promise<boolean> {
  return recoversTo(typed(domain, 'CommitmentTerms', encodeTerms(terms)), signature, expected);
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
