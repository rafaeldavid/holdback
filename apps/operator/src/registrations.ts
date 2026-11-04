// Adjudicator registrations (ADR-0030): what POST /v1/adjudicators checks, and where a node keeps what it serves.
// A node stores a registration the adjudicator signed and serves it with that signature, so any reader verifies it
// without trusting the node. It refuses only what is malformed, unsigned, out of order or self-contradictory (D31):
// never a fee, a policy value the schema admits, a registry, a bond or untrusted text. Registrations are never
// removed (Rafa, 2026-11-04): a later one replaces the served one, and an expired one stays listed as expired.
import {
  canonicalKeccak,
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
  try {
    decodePublicKey(record.encryptionPublicKey);
  } catch {
    refuse('invalid_terms', 'encryptionPublicKey must be a 32-byte x25519 public key, base64url', 'encryptionPublicKey');
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

/**
 * ADR-0030 §2, steps 6 and 7: checks the registration, then stores it as the one for its address unless the node
 * serves a later or equal `issuedAt`. The served registration posted again answers unchanged. `dryRun` stores nothing.
 */
export function register(store: RegistrationStore, raw: unknown, o: { domain: HoldbackDomain; now: Timestamp; dryRun?: boolean }): Promise<StoredRegistration> {
  return serially(store, async () => {
    const record = await checkRegistration(raw, o);
    const served = await store.get(record.address);
    if (served && lc(served.record.registration.signature) === lc(record.registration.signature)) return served;
    if (served && !(Date.parse(record.registration.issuedAt) > Date.parse(served.record.registration.issuedAt))) {
      refuse('invalid_state', `this node serves a registration for ${record.address} issued at ${served.record.registration.issuedAt}; a replacement needs a later issuedAt`);
    }
    const stored = { record, registeredAt: served?.registeredAt ?? o.now };
    if (!o.dryRun) await store.put(stored);
    return stored;
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
  if (bond.junior.token !== token) return 0n;
  const free = BigInt(bond.junior.amount) + BigInt(bond.senior.amount) - BigInt(bond.reserved.amount);
  return free > 0n ? free : 0n;
}

export const hasBond = (bond: Bond): boolean => BigInt(bond.junior.amount) + BigInt(bond.senior.amount) > 0n;
