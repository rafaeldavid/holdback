// Private deals (ADR-0024, D34), the off-chain parts: the two-part encrypted terms, the settlement projection anyone
// may read, the ReadToken header, and the Delegation check a counterparty or adjudicator runs on a per-deal key.
//
// A terms body is encrypted as the UTF-8 of its RFC 8785 JSON, so its keccak256 is exactly the hash the terms bind
// (deliverableHash, acceptanceHash). AES-256-GCM under a fresh key per part; AAD = the commitment ID's 32 bytes
// followed by the part name, so a part cannot be replayed under another deal or as the other part. The commitment ID
// depends only on the hashes, so it is known before encrypting. Each key is sealed (x25519-xsalsa20poly1305) to each
// reader with the same envelopes as delivery keys (ADR-0012).
import { webcrypto } from 'node:crypto';
import { concat, hexToBytes, isAddressEqual, stringToBytes } from 'viem';
import { canonicalJson, canonicalKeccak } from './canonical.js';
import { ContentKey, CONTENT_KEY_BYTES } from './crypto/content.js';
import { unwrapKeyFor, wrapKeyForRecipients, type Recipient } from './crypto/envelope.js';
import { CryptoError } from './crypto/errors.js';
import { draw, systemRandom, type RandomSource } from './crypto/random.js';
import { bodyHashes, commitmentId, verifyMessage, type HoldbackDomain } from './eip712.js';
import { gte } from './money/index.js';
import { parseMessage } from './parse.js';
import { problem, type Problem } from './problem.js';
import { err, ok, type Result } from './result.js';
import type {
  AcceptanceSpec,
  Address,
  AnyCommitment,
  CommitmentTerms,
  Delegation,
  Deliverable,
  Hex32,
  PartyRole,
  PrivatePart,
  ReadToken,
  SealedCommitmentTerms,
  SettlementProjection,
  Timestamp,
  TokenAmount,
} from './types.js';

export { isSealed } from './eip712.js';

export const PRIVATE_PARTS = ['deliverable', 'acceptance'] as const;
export type PartName = (typeof PRIVATE_PARTS)[number];
export type PartKeys = Record<PartName, ContentKey>;

const IV_BYTES = 12;
const TAG_BITS = 128;

const aad = (id: Hex32, name: PartName): Uint8Array<ArrayBuffer> => Uint8Array.from(concat([hexToBytes(id), stringToBytes(name)]));
const importKey = (key: ContentKey, usage: 'encrypt' | 'decrypt') => webcrypto.subtle.importKey('raw', key.exportBytes(), { name: 'AES-GCM' }, false, [usage]);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** Encrypts one body under `key` for commitment `id`; the plaintext is the body's RFC 8785 JSON. */
export async function encryptPart(body: Deliverable | AcceptanceSpec, id: Hex32, name: PartName, key: ContentKey, random: RandomSource = systemRandom): Promise<string> {
  const iv = draw(random, IV_BYTES);
  const plaintext = Uint8Array.from(Buffer.from(canonicalJson(body), 'utf8'));
  const sealed = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id, name), tagLength: TAG_BITS }, await importKey(key, 'encrypt'), plaintext));
  return b64(Uint8Array.from([...iv, ...sealed]));
}

/**
 * Opens one part with its key and checks the plaintext against the hash the terms bind. AES-GCM is not
 * key-committing, so the hash check is what pins the body the seller signed. Throws CryptoError.
 */
export async function openPart(part: PrivatePart, id: Hex32, name: PartName, key: ContentKey): Promise<unknown> {
  const bytes = Buffer.from(part.ciphertext, 'base64url');
  if (bytes.length < IV_BYTES + TAG_BITS / 8) throw new CryptoError('malformed_ciphertext');
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: aad(id, name), tagLength: TAG_BITS }, await importKey(key, 'decrypt'), bytes.subarray(IV_BYTES)),
    );
  } catch {
    throw new CryptoError('decrypt_failed');
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(plaintext).toString('utf8'));
  } catch {
    throw new CryptoError('plaintext_hash_mismatch');
  }
  // The bytes must be the canonical JSON whose keccak256 the terms bind, not merely an equal value.
  if (canonicalJson(body) !== Buffer.from(plaintext).toString('utf8') || canonicalKeccak(body) !== part.hash) throw new CryptoError('plaintext_hash_mismatch');
  return body;
}

/** This reader's key for one part, from its envelope. Throws CryptoError when none opens. */
export const partKey = (part: PrivatePart, recipient: Address, secretKey: Uint8Array): ContentKey => unwrapKeyFor(part.envelopes, recipient, secretKey);

export interface SealOptions {
  random?: RandomSource;
}

/**
 * The sealed wire form of plaintext terms (ADR-0024 §2): each body under its own fresh key, each key sealed to every
 * reader (at offer: the buyer and the primary). Returns the keys too, for the seller to keep for later disclosure.
 */
export async function sealTerms(terms: CommitmentTerms, readers: readonly Recipient[], options: SealOptions = {}): Promise<{ sealed: SealedCommitmentTerms; id: Hex32; keys: PartKeys }> {
  const random = options.random ?? systemRandom;
  const id = commitmentId(terms);
  const keys = { deliverable: ContentKey.fromBytes(draw(random, CONTENT_KEY_BYTES)), acceptance: ContentKey.fromBytes(draw(random, CONTENT_KEY_BYTES)) };
  const hashes = bodyHashes(terms);
  const part = async (name: PartName, body: Deliverable | AcceptanceSpec, hash: Hex32): Promise<PrivatePart> => ({
    hash,
    ciphertext: await encryptPart(body, id, name, keys[name], random),
    envelopes: wrapKeyForRecipients(keys[name], readers, { random }),
  });
  const { deliverable, acceptance, ...rest } = terms;
  const sealed: SealedCommitmentTerms = {
    ...rest,
    privateTerms: { deliverable: await part('deliverable', deliverable, hashes.deliverableHash), acceptance: await part('acceptance', acceptance, hashes.acceptanceHash) },
  };
  return { sealed, id, keys };
}

/** A reader opens both parts with its own envelopes and gets the plaintext form back (same ID). Throws CryptoError. */
export async function openTerms(sealed: SealedCommitmentTerms, id: Hex32, recipient: Address, secretKey: Uint8Array): Promise<CommitmentTerms> {
  if (commitmentId(sealed) !== id) throw new CryptoError('plaintext_hash_mismatch');
  const { privateTerms, ...rest } = sealed;
  const deliverable = (await openPart(privateTerms.deliverable, id, 'deliverable', partKey(privateTerms.deliverable, recipient, secretKey))) as Deliverable;
  const acceptance = (await openPart(privateTerms.acceptance, id, 'acceptance', partKey(privateTerms.acceptance, recipient, secretKey))) as AcceptanceSpec;
  return { ...rest, deliverable, acceptance } as CommitmentTerms;
}

/** Decodes a 32-byte body key from a disclosure body (base64url); throws CryptoError on any other shape. */
export function bodyKey(text: string): ContentKey {
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.length !== CONTENT_KEY_BYTES || bytes.toString('base64url') !== text) throw new CryptoError('invalid_key');
  return ContentKey.fromBytes(new Uint8Array(bytes));
}
export const encodeBodyKey = (key: ContentKey): string => b64(key.exportBytes());

/**
 * The settlement projection (ADR-0024 §3, §8): what anyone may read about a private deal. The per-deal parties,
 * money, adjudicators, mode and deadlines in the clear; hashes for the rest. `disclosed` holds only bodies whose keys
 * were published and checked against their hashes.
 */
export function projectionOf(c: AnyCommitment, disclosed?: SettlementProjection['disclosed']): SettlementProjection {
  const a = c.adjudication;
  return {
    commitmentId: c.id,
    disclosure: { level: c.disclosure.level },
    buyer: c.buyer,
    seller: c.seller,
    price: c.price,
    adjudication: { adjudicator: a.adjudicator, fallbackAdjudicator: a.fallbackAdjudicator, appealAdjudicator: a.appealAdjudicator, fee: a.fee },
    timing: c.timing,
    settlement: c.settlement,
    hashes: { ...bodyHashes(c), rulebookHash: c.rulebookHash, registryHash: a.registryHash, policyHash: a.policyHash },
    ...(disclosed && Object.keys(disclosed).length > 0 ? { disclosed } : {}),
  };
}

// ReadToken header (ADR-0024 §3)

export const READ_TOKEN_SCHEME = 'Holdback-ReadToken';

/** `Authorization` header value for a signed ReadToken: the scheme and the base64url of its JSON. */
export const readTokenHeader = (t: ReadToken): string => `${READ_TOKEN_SCHEME} ${Buffer.from(JSON.stringify(t), 'utf8').toString('base64url')}`;

/** Parses the header back to a schema-valid ReadToken. Does not check the signature, expiry or audience. */
export function parseReadTokenHeader(header: string): Result<ReadToken, Problem> {
  const m = /^Holdback-ReadToken ([A-Za-z0-9_-]{1,8192})$/.exec(header);
  if (!m) return err(problem('unauthorized', `Authorization must be "${READ_TOKEN_SCHEME} <base64url of a signed ReadToken>"`));
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8'));
  } catch {
    return err(problem('unauthorized', 'the read token is not base64url JSON'));
  }
  const r = parseMessage(json);
  if (!r.ok) return err(problem('unauthorized', `the read token is malformed: ${r.error.detail}`));
  if (r.value.type !== 'ReadToken') return err(problem('unauthorized', `expected a ReadToken, got ${r.value.type}`));
  return ok(r.value);
}

// Delegation check (ADR-0024 §7)

export interface DelegationExpectation {
  /** The per-deal address that appears as buyer or seller in the terms. */
  dealKey: Address;
  /** The per-deal x25519 key in the terms (buyerEncryptionPublicKey or deliverable.sellerEncryptionPublicKey), when known. */
  dealEncryptionKey?: string;
  clubId: string;
  role: PartyRole;
  price: TokenAmount;
  at: Timestamp;
}

/**
 * The counterparty's and the adjudicator's check of a per-deal key certificate: signed by the named long-term agent,
 * for this deal key (and encryption key), club and role, with the price within the per-commitment cap, unexpired.
 * Settlement does not run it (ADR-0024 §7); whether `agent` holds a mandate from `principal` is read from the club's
 * registry by the checker, as for a long-term key.
 */
export async function verifyDelegation(domain: HoldbackDomain, d: Delegation, want: DelegationExpectation): Promise<Result<true, Problem>> {
  const no = (detail: string) => err(problem('scope_exceeded', `delegation: ${detail}`));
  if (!(await verifyMessage(domain, d, d.agent))) return err(problem('invalid_signature', 'delegation: not signed by the agent it names'));
  if (!isAddressEqual(d.dealKey, want.dealKey)) return no(`certifies ${d.dealKey}, not ${want.dealKey}`);
  if (want.dealEncryptionKey !== undefined && d.dealEncryptionKey !== want.dealEncryptionKey) return no('certifies another encryption key');
  if (d.clubId !== want.clubId) return no(`is for club ${d.clubId}, not ${want.clubId}`);
  if (!d.scope.roles.includes(want.role)) return no(`does not allow the ${want.role} role`);
  if (!(Date.parse(want.at) < Date.parse(d.expiresAt)) || !(Date.parse(want.at) < Date.parse(d.scope.expiresAt))) return mandateExpired();
  const cap = gte(d.scope.maxPerCommitment, want.price);
  if (!cap.ok || !cap.value) return no(`price ${want.price.amount} exceeds the per-commitment cap ${d.scope.maxPerCommitment.amount}`);
  return ok(true);
}
const mandateExpired = () => err(problem('mandate_expired', 'delegation: expired'));
