// Core messages as the HoldbackRules settlement view (ADR-0024 §8, contracts/src/HoldbackTypes.sol): enforced fields
// in the clear, every other field as its EIP-712 encoding (keccak256 of a string, or a nested struct hash), so the
// contract rebuilds the same struct hashes packages/core signs. Also the CPP PaymentInfo the contract derives from
// the terms (ADR-0025) and the ERC-3009 digests the buyer signs for funding and the operator fee.
import {
  bodyHashes,
  eip712Types,
  typedDataOf,
  typedTermsOf,
  type Agree,
  type AdjudicatorAcceptance,
  type AnyCommitmentTerms,
  type Decision,
  type Delivery,
  type EarlyAccept,
  type EncryptedKey,
  type Hex32,
  type MutualSettlement,
} from '@holdback/core';
import { concat, encodeAbiParameters, getAddress, hashStruct, keccak256, stringToBytes, type Address, type Hex } from 'viem';

type Encoded = Record<string, unknown>;
const str = (s: string): Hex32 => keccak256(stringToBytes(s));
const struct = (primaryType: string, data: Encoded): Hex32 => hashStruct({ primaryType, types: eip712Types, data } as Parameters<typeof hashStruct>[0]);
const enc = <T extends Encoded = Encoded>(m: Parameters<typeof typedDataOf>[0]): T => typedDataOf(m).message as T;

export const ROLE = { primary: 0, fallback: 1, appeal: 2 } as const;
export const OUTCOME = { accept: 0, reject: 1, escalate: 2 } as const;

/**
 * A copy of `value` with every `token` field equal to `from`, and every `allowedTokens` entry, set to `to`: SimChain's
 * tUSD rebound to a deployed token's address (ADR-0025) in a rulebook, terms, scopes or amounts.
 */
export function rebindToken<T>(value: T, from: string, to: string): T {
  if (from === to) return value;
  const walk = (x: unknown, key?: string): unknown => {
    if (Array.isArray(x)) return x.map((v) => (key === 'allowedTokens' && v === from ? to : walk(v)));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'token' && v === from ? to : walk(v, k)]));
    return x;
  };
  return walk(value) as T;
}

/** The ERC-20 a terms object names: its token identifier must be the lowercase 0x-hex address (ADR-0025). */
export function tokenAddressOf(t: AnyCommitmentTerms): Address {
  const token = t.price.token;
  if (!/^0x[0-9a-f]{40}$/.test(token)) throw new RangeError(`token ${token} is not a lowercase ERC-20 address; on EVM settlement the token identifier is the address (ADR-0025)`);
  return getAddress(token);
}

export function termsView(t: AnyCommitmentTerms) {
  const typed = typedTermsOf(t) as { timing: Record<string, bigint | number>; createdAt: bigint };
  const timing = typed.timing;
  return {
    schemaVersionHash: str(t.schemaVersion),
    clubIdHash: str(t.clubId),
    rulebookHash: t.rulebookHash,
    buyer: getAddress(t.buyer),
    seller: getAddress(t.seller),
    buyerPaymentAddress: getAddress(t.buyerPaymentAddress),
    sellerPayoutAddress: getAddress(t.sellerPayoutAddress),
    ...bodyHashes(t),
    token: tokenAddressOf(t),
    price: BigInt(t.price.amount),
    adjudicator: getAddress(t.adjudication.adjudicator),
    fallbackAdjudicator: getAddress(t.adjudication.fallbackAdjudicator),
    appealAdjudicator: getAddress(t.adjudication.appealAdjudicator),
    policyIdHash: str(t.adjudication.policyId),
    fee: BigInt(t.adjudication.fee.amount),
    registryHash: t.adjudication.registryHash,
    policyHash: t.adjudication.policyHash,
    timing: {
      offerExpiresAt: BigInt(timing['offerExpiresAt']!),
      fundBy: BigInt(timing['fundBy']!),
      deliverBy: BigInt(timing['deliverBy']!),
      judgeBy: BigInt(timing['judgeBy']!),
      fallbackBy: BigInt(timing['fallbackBy']!),
      appealWindowSec: BigInt(timing['appealWindowSec']!),
      appealDecideSec: BigInt(timing['appealDecideSec']!),
      maxSubmissions: Number(timing['maxSubmissions']),
      disputeBy: BigInt(timing['disputeBy']!),
      disputeJudgeSec: BigInt(timing['disputeJudgeSec']!),
      disputeFallbackSec: BigInt(timing['disputeFallbackSec']!),
    },
    remedyHash: struct('Remedy', t.remedy as unknown as Encoded),
    disclosureHash: struct('Disclosure', t.disclosure as unknown as Encoded),
    buyerKeyHash: str(t.buyerEncryptionPublicKey),
    nonce: t.nonce,
    createdAt: typed.createdAt,
  };
}
export type TermsView = ReturnType<typeof termsView>;

// core's EncryptedKey encoding: an absent unlock is an empty kind and round 0.
const keyHash = (k: EncryptedKey): Hex32 =>
  struct('EncryptedKey', { recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext, unlock: { kind: k.unlock?.kind ?? '', round: BigInt(k.unlock?.round ?? 0) } });
const keysHash = (keys: readonly EncryptedKey[]): Hex32 => keccak256(keys.length ? concat(keys.map(keyHash)) : '0x');

export function deliveryView(d: Delivery) {
  const unsigned = { ...d, type: 'Delivery' as const } as Parameters<typeof typedDataOf>[0] & { signature?: unknown };
  delete unsigned.signature;
  const m = enc<{ ciphertext: Encoded; submittedAt: bigint }>(unsigned);
  return {
    attempt: d.attempt,
    ciphertextHash: struct('Ciphertext', m.ciphertext),
    plaintextSha256Hash: str(d.plaintextSha256),
    plaintextMimeHash: str(d.plaintextMime),
    encryptedKeysHash: keysHash(d.encryptedKeys),
    submittedAt: m.submittedAt,
  };
}
export const NO_DELIVERY = { attempt: 0, ciphertextHash: `0x${'00'.repeat(32)}` as Hex32, plaintextSha256Hash: `0x${'00'.repeat(32)}` as Hex32, plaintextMimeHash: `0x${'00'.repeat(32)}` as Hex32, encryptedKeysHash: `0x${'00'.repeat(32)}` as Hex32, submittedAt: 0n };

/** The buyer's envelope in a delivery, with every element hash as the membership proof. Null when absent. */
export function keyProof(d: Delivery, buyer: string) {
  const index = d.encryptedKeys.findIndex((k) => k.recipient.toLowerCase() === buyer.toLowerCase());
  if (index < 0) return null;
  const k = d.encryptedKeys[index]!;
  return {
    scheme: k.scheme,
    ciphertext: k.ciphertext,
    unlockKindHash: str(k.unlock?.kind ?? ''),
    unlockRound: BigInt(k.unlock?.round ?? 0),
    keyHashes: d.encryptedKeys.map(keyHash),
    index: BigInt(index),
  };
}
export const NO_KEY = { scheme: '', ciphertext: '', unlockKindHash: str(''), unlockRound: 0n, keyHashes: [] as Hex32[], index: 0n };

export const acceptanceView = (a: AdjudicatorAcceptance) => ({ seedCommitment: a.seedCommitment, bondReserved: BigInt(a.bondReserved.amount), nonce: a.nonce, expiresAt: enc<{ expiresAt: bigint }>(a).expiresAt, signature: a.signature });
export const agreeView = (a: Agree) => ({ nonce: a.nonce, expiresAt: enc<{ expiresAt: bigint }>(a).expiresAt, signature: a.signature });
export const earlyAcceptView = (m: EarlyAccept) => ({ attempt: m.attempt, deliveryHash: m.deliveryHash, nonce: m.nonce, expiresAt: enc<{ expiresAt: bigint }>(m).expiresAt, signature: m.signature });

export function decisionView(m: Decision) {
  const e = enc<{ beacon: { source: string; round: bigint; value: Hex32; signature: Hex }; expiresAt: bigint }>(m);
  return {
    attempt: m.attempt,
    deliveryHash: m.deliveryHash,
    role: ROLE[m.role],
    outcome: OUTCOME[m.outcome],
    seed: m.seed,
    judgmentRecordHash: m.judgmentRecordHash,
    keyScheme: m.keyForBuyer?.scheme ?? '',
    keyCiphertext: m.keyForBuyer?.ciphertext ?? '',
    appealGroundHash: str(m.appealGround ?? ''),
    beaconSourceHash: str(e.beacon.source),
    beaconRound: e.beacon.round,
    beaconValue: e.beacon.value,
    // The proof bytes themselves; the contract hashes them into the Decision and asks its beacon to verify.
    beaconSignature: e.beacon.signature,
    encryptedKeysHash: keysHash(m.encryptedKeys ?? []),
    nonce: m.nonce,
    expiresAt: e.expiresAt,
    signature: m.signature,
  };
}

export function mutualView(m: MutualSettlement) {
  const e = enc<{ expiresAt: bigint }>({ ...m, type: 'MutualSettlement' } as unknown as Parameters<typeof typedDataOf>[0]);
  return {
    hasDelivery: m.deliveryHash !== null,
    deliveryHash: m.deliveryHash ?? (`0x${'00'.repeat(32)}` as Hex32),
    payouts: m.payouts.map((p) => ({ to: getAddress(p.to), amount: BigInt(p.amount.amount) })),
    releaseKey: m.releaseKey,
    nonce: m.nonce,
    expiresAt: e.expiresAt,
    buyerSignature: m.buyerSignature,
    sellerSignature: m.sellerSignature,
  };
}

// CPP (ADR-0025)

const PAYMENT_INFO_TYPEHASH = str(
  'PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)',
);
const PAYMENT_INFO_FIELDS = [
  { type: 'bytes32' },
  { type: 'address' },
  { type: 'address' },
  { type: 'address' },
  { type: 'address' },
  { type: 'uint120' },
  { type: 'uint48' },
  { type: 'uint48' },
  { type: 'uint48' },
  { type: 'uint16' },
  { type: 'uint16' },
  { type: 'address' },
  { type: 'uint256' },
] as const;

export interface PaymentInfo {
  operator: Address;
  payer: Address;
  receiver: Address;
  token: Address;
  maxAmount: bigint;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: Address;
  salt: bigint;
}

/** HoldbackRules._paymentInfo: nothing chosen after the terms. authorizationExpiry = fallbackBy + appealDecideSec + margin. */
export function paymentInfo(t: TermsView, rules: Address, commitmentId: Hex32, expiryMargin: bigint): PaymentInfo {
  const expiry = Number(t.timing.fallbackBy + t.timing.appealDecideSec + expiryMargin);
  return {
    operator: rules,
    payer: t.buyerPaymentAddress, // ADR-0033: funds the hold, receives every void
    receiver: t.sellerPayoutAddress, // ADR-0033: receives every capture net of the fee
    token: t.token,
    maxAmount: t.price + t.fee,
    preApprovalExpiry: Number(t.timing.fundBy),
    authorizationExpiry: expiry,
    refundExpiry: expiry,
    minFeeBps: 0,
    maxFeeBps: 10_000,
    feeReceiver: `0x${'00'.repeat(20)}`,
    salt: BigInt(commitmentId),
  };
}

/** AuthCaptureEscrow.getHash with payer zeroed: the ERC-3009 and Permit2 nonce (payer-agnostic). */
export const payerAgnosticHash = (pi: PaymentInfo, chainId: number, escrow: Address): Hex32 => paymentHash({ ...pi, payer: `0x${'00'.repeat(20)}` as Address }, chainId, escrow);

/** AuthCaptureEscrow.getHash: the key of CPP's paymentState. */
export function paymentHash(p: PaymentInfo, chainId: number, escrow: Address): Hex32 {
  const inner = keccak256(
    encodeAbiParameters(PAYMENT_INFO_FIELDS, [PAYMENT_INFO_TYPEHASH, p.operator, p.payer, p.receiver, p.token, p.maxAmount, p.preApprovalExpiry, p.authorizationExpiry, p.refundExpiry, p.minFeeBps, p.maxFeeBps, p.feeReceiver, p.salt]),
  );
  return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }], [BigInt(chainId), escrow, inner]));
}

const RECEIVE_WITH_AUTHORIZATION_TYPEHASH: Hex32 = '0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8';
const TRANSFER_WITH_AUTHORIZATION_TYPEHASH: Hex32 = '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267';
const AUTH_FIELDS = [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }] as const;

export interface Erc3009Auth {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex32;
}

const authDigest = (typehash: Hex32, domainSeparator: Hex32, a: Erc3009Auth): Hex32 =>
  keccak256(concat(['0x1901', domainSeparator, keccak256(encodeAbiParameters(AUTH_FIELDS, [typehash, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce]))]));

/** The digest the buyer signs to fund through CPP's ERC-3009 collector (ReceiveWithAuthorization). */
export const receiveDigest = (domainSeparator: Hex32, a: Erc3009Auth): Hex32 => authDigest(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, domainSeparator, a);
/** The digest the buyer signs for the operator fee (TransferWithAuthorization, ADR-0023 EVM mechanism). */
export const transferDigest = (domainSeparator: Hex32, a: Erc3009Auth): Hex32 => authDigest(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, domainSeparator, a);

/** The operator fee's ERC-3009 nonce: keccak256(abi.encode(commitmentId, "operator_fee")) (ADR-0023 amendment). */
export const operatorFeeNonce = (commitmentId: Hex32): Hex32 => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'string' }], [commitmentId, 'operator_fee']));
