// Adjudicator registrations (ADR-0030): what POST /v1/adjudicators checks, and where a node keeps what it serves.
// A node stores a registration the adjudicator signed and serves it with that signature, so any reader verifies it
// without trusting the node. It refuses only what is malformed, unsigned, out of order or self-contradictory (D31):
// never a fee, a policy value the schema admits, a registry, a bond or untrusted text. Registrations are never
// removed (Rafa, 2026-11-04): a later one replaces the served one, and an expired one stays listed as expired.
import {
  canonicalKeccak,
  messageDigest,
  parseAdjudicator,
  parseMessage,
  registrationBodyHash,
  registrationMessageOf,
  signMessage,
  verifyMessage,
  type Address,
  type HoldbackDomain,
  type RegisteredAdjudicator,
  type RegistrationEnvelope,
  type Timestamp,
  type TokenAmount,
} from '@holdback/core';
import { decodePublicKey } from '@holdback/core/crypto';
import nacl from 'tweetnacl';
import { fieldOf, type ApiProblem, type ApiProblemType } from './problems.js';

/** A bond pool as the settlement layer holds it: junior is the adjudicator's own stake, reserved the open exposure. */
export interface Bond {
  junior: TokenAmount;
  senior: TokenAmount;
  reserved: TokenAmount;
}

export interface StoredRegistration {
  record: RegisteredAdjudicator;
  /** When this node first stored a registration for the address; a replacement keeps it. */
  registeredAt: Timestamp;
}

/** Where a node keeps registrations: one per address. The demo keeps Durable Object rows `ar:<address>` (T-221). */
export interface RegistrationStore {
  get(address: Address): Promise<StoredRegistration | undefined>;
  /** Stores the registration for its address, replacing the one there. */
  put(r: StoredRegistration): Promise<void>;
  /** Every stored registration, in any order; readers sort by registeredAt. */
  list(): Promise<StoredRegistration[]>;
}

const lc = (a: string) => a.toLowerCase();

/** One process's store: `pnpm sim`, the operator tests, and each node of a test world. */
export class MemoryRegistrationStore implements RegistrationStore {
  private readonly rows = new Map<string, StoredRegistration>();
  async get(address: Address): Promise<StoredRegistration | undefined> {
    const r = this.rows.get(lc(address));
    return r && structuredClone(r);
  }
  async put(r: StoredRegistration): Promise<void> {
    this.rows.set(lc(r.record.address), structuredClone(r));
  }
  async list(): Promise<StoredRegistration[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
}

export class RegistrationError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail);
  }
}
const refuse = (type: ApiProblemType, detail: string, field?: string): never => {
  throw new RegistrationError({ type, detail, ...(field ? { field } : {}) });
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const WHOLE_SECOND_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** Half the secp256k1 group order: EIP-2's bound on a signature's s. */
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/** The largest registration body a node reads (ADR-0030 §2): a record with every field at its schema maximum fits. */
export const MAX_REGISTRATION_BYTES = 32_768;

const SHAPE =
  'the body is your adjudicator record (adjudicator.schema.json) as GET /v1/adjudicators/{address} serves it, with `pool` holding only `terms` and the `registration` envelope {keyId, bodyHash, issuedAt, nonce, expiresAt, signature} you signed as AdjudicatorRegistration';

/**
 * ADR-0030 §2, steps 1 to 5: the record and the message it signs are well formed, the key is a 32-byte x25519 key,
 * the hashes recompute, the signature recovers to `address` under this node's domain, and the times are in order.
 */
export async function checkRegistration(raw: unknown, o: { domain: HoldbackDomain; now: Timestamp }): Promise<RegisteredAdjudicator> {
  if (!isObj(raw)) return refuse('invalid_terms', SHAPE);
  const pool = raw['pool'];
  if (isObj(pool) && ['junior', 'senior', 'reserved'].some((k) => k in pool)) {
    refuse('invalid_terms', 'pool holds terms only: the settlement layer holds the balances, and this node serves them beside your record', 'pool');
  }
  if (!isObj(raw['registration'])) refuse('invalid_terms', `registration is required: ${SHAPE}`, 'registration');
  // The posted record validates as the served one would, with zero balances in its fee token.
  const fee = isObj(raw['fee']) && isObj(raw['fee']['min']) ? raw['fee']['min']['token'] : undefined;
  const zero = { token: typeof fee === 'string' ? fee : 'tUSD', amount: '0' };
  const served = parseAdjudicator({ ...raw, pool: { ...(isObj(pool) ? pool : {}), junior: zero, senior: zero, reserved: zero } });
  if (!served.ok) return refuse('invalid_terms', served.error.detail, fieldOf(served.error.detail));
  const record = { ...served.value, pool: { terms: served.value.pool.terms } } as RegisteredAdjudicator;
  const message = registrationMessageOf(record);
  const m = parseMessage(message);
  if (!m.ok) return refuse('invalid_terms', `the AdjudicatorRegistration rebuilt from your record: ${m.error.detail}`);
  // A key no seller can seal to (a low-order point gives an all-zero shared secret) is one settlement cannot process.
  let key: Uint8Array | undefined;
  try {
    key = decodePublicKey(record.encryptionPublicKey);
  } catch {
    refuse('invalid_terms', 'encryptionPublicKey must be a 32-byte x25519 public key, base64url', 'encryptionPublicKey');
  }
  if (nacl.scalarMult(nacl.box.keyPair().secretKey, key!).every((b) => b === 0)) {
    refuse('invalid_terms', 'encryptionPublicKey is a low-order x25519 point: no seller can seal a content key to it', 'encryptionPublicKey');
  }
  // One spelling per registration: whole-second Z times and a low-s signature with v of 27 or 28 (EIP-2), so nobody
  // can store a second spelling of what the adjudicator signed.
  for (const name of ['issuedAt', 'expiresAt'] as const) {
    if (!WHOLE_SECOND_Z.test(record.registration[name])) refuse('invalid_terms', `registration.${name} must be RFC 3339 in whole seconds with Z, such as 2026-11-04T09:00:00Z`, `registration.${name}`);
  }
  const sig = record.registration.signature;
  if (BigInt(`0x${sig.slice(66, 130)}`) > HALF_N || !['1b', '1c'].includes(sig.slice(130).toLowerCase())) {
    refuse('invalid_terms', 'registration.signature must be the canonical form: s at most n/2 and v 27 or 28 (EIP-2), as standard signers produce', 'registration.signature');
  }
  const recompute = (name: string, got: string, want: string, of: string) => {
    if (got !== want) refuse('invalid_terms', `${name} ${got} is not keccak256 of the RFC 8785 JSON of ${of} (${want})`, name);
  };
  recompute('policyHash', record.policyHash, canonicalKeccak(record.policy), 'policy');
  recompute('poolTermsHash', record.poolTermsHash, canonicalKeccak(record.pool.terms), 'pool.terms');
  recompute('registration.bodyHash', record.registration.bodyHash, registrationBodyHash(record), 'your record without `registration`, with `pool` holding only `terms`');
  const { issuedAt, expiresAt } = record.registration;
  if (!(Date.parse(issuedAt) < Date.parse(expiresAt))) refuse('invalid_terms', `registration.issuedAt ${issuedAt} must be before registration.expiresAt ${expiresAt}`, 'registration.issuedAt');
  if (!(await verifyMessage(o.domain, message, record.address))) {
    refuse('invalid_signature', `the registration is not signed by ${record.address} as AdjudicatorRegistration under this node's EIP-712 domain (chainId ${o.domain.chainId}, verifyingContract ${o.domain.verifyingContract})`);
  }
  if (!(Date.parse(o.now) < Date.parse(expiresAt))) refuse('deadline_passed', `the registration expired at ${expiresAt}; sign a new one with a later expiresAt`);
  return record;
}

// One registration at a time per store, so two posts for one address cannot both pass the ordering check.
const queues = new WeakMap<RegistrationStore, Promise<unknown>>();
function serially<T>(store: RegistrationStore, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(store) ?? Promise.resolve()).then(f, f);
  queues.set(store, run.catch(() => undefined));
  return run;
}

/** What a registration did to the store: `unchanged` for the served one posted again, `new` for a first address. */
export type RegistrationChange = 'unchanged' | 'new' | 'replaced';

const digestOf = (domain: HoldbackDomain, r: RegisteredAdjudicator): string => {
  const { signature: _s, ...unsigned } = registrationMessageOf(r);
  void _s;
  return messageDigest(domain, unsigned);
};

/**
 * ADR-0030 §2, steps 6 and 7: checks the registration, then stores it as the one for its address unless the node
 * serves a later or equal `issuedAt`. The served registration posted again (the same signed digest) answers unchanged.
 * `dryRun` stores nothing.
 */
export function register(
  store: RegistrationStore,
  raw: unknown,
  o: { domain: HoldbackDomain; now: Timestamp; dryRun?: boolean },
): Promise<{ stored: StoredRegistration; change: RegistrationChange }> {
  return serially(store, async () => {
    const record = await checkRegistration(raw, o);
    const served = await store.get(record.address);
    if (served && digestOf(o.domain, served.record) === digestOf(o.domain, record)) return { stored: served, change: 'unchanged' };
    if (served && !(Date.parse(record.registration.issuedAt) > Date.parse(served.record.registration.issuedAt))) {
      refuse('invalid_state', `this node serves a registration for ${record.address} issued at ${served.record.registration.issuedAt}; a replacement needs a later issuedAt`);
    }
    const stored = { record, registeredAt: served?.registeredAt ?? o.now };
    if (!o.dryRun) await store.put(stored);
    return { stored, change: served ? 'replaced' : 'new' };
  });
}

/** Signs a record as its adjudicator: fills bodyHash and the signature. For worlds that register their own adjudicators, and tests. */
export async function signRegistration(
  privateKey: `0x${string}`,
  domain: HoldbackDomain,
  body: Omit<RegisteredAdjudicator, 'registration'>,
  envelope: Omit<RegistrationEnvelope, 'bodyHash' | 'signature'>,
): Promise<RegisteredAdjudicator> {
  const draft = { ...body, registration: { ...envelope, bodyHash: registrationBodyHash(body), signature: '0x' as const } };
  const { signature: _unsigned, ...message } = registrationMessageOf(draft);
  void _unsigned;
  return { ...draft, registration: { ...draft.registration, signature: await signMessage(privateKey, domain, message) } };
}

/** Free bond in a token: junior plus senior less what open deals reserve; zero in another token. */
export function freeBond(bond: Bond, token: string): bigint {
  if (lc(bond.junior.token) !== lc(token)) return 0n;
  const free = BigInt(bond.junior.amount) + BigInt(bond.senior.amount) - BigInt(bond.reserved.amount);
  return free > 0n ? free : 0n;
}

export const hasBond = (bond: Bond): boolean => BigInt(bond.junior.amount) + BigInt(bond.senior.amount) > 0n;
