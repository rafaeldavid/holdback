// Test harness: an in-memory settlement on core's `step`, standing in for T-006's SimChain behind the
// AdjudicatorSettlement port. It applies the rules T-006 is to enforce that core does not yet (per-role
// beacon seeds, ADR-0018; fallback and appeal envelopes held until takeover, ADR-0020), and verifies
// every signature. Test-only; not exported from the package.
import {
  commitmentId,
  holdbackDomain,
  parseJudgment,
  problem,
  step,
  termsOf,
  verifyMessage,
  err,
  ok,
  type AdjudicatorAcceptance,
  type AdjudicatorRegistration,
  type Address,
  type Commitment,
  type Decision,
  type Delivery,
  type EncryptedKey,
  type EscrowState,
  type FundingAuthorization,
  type Hex32,
  type Judgment,
  type Problem,
  type Result,
  type Timestamp,
} from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey, seal, wrapKeyForRecipients, type ContentKey, type EncryptionKeyPair } from '@holdback/core/crypto';
import { readFileSync } from 'node:fs';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { AdjudicatorSettlement, DecisionTask, OfferTask } from './settlement-port.js';
import { panelSeed, roundFor, simBeacon, simRoundAt, type RandomnessSource } from './randomness.js';

export const DOMAIN = holdbackDomain(31337);
export const SIM_SEED: Hex32 = `0x${'5e'.repeat(32)}`;
export const T0 = '2026-11-01T09:00:00Z';

export interface Party {
  key: `0x${string}`;
  address: Address;
  enc: EncryptionKeyPair;
}
export function party(n: number): Party {
  const key = `0x${n.toString(16).padStart(2, '0').repeat(32)}` as `0x${string}`;
  return { key, address: privateKeyToAccount(key).address.toLowerCase() as Address, enc: encryptionKeyPairFromSecretKey(new Uint8Array(32).fill(n + 100)) };
}

const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Commitment;

export interface CommitmentOver {
  primary: Address;
  fallback: Address;
  appeal: Address;
  policyHash: Hex32;
  registryHash: Hex32;
  buyer: Party;
  seller: Party;
}
export function makeCommitment(o: CommitmentOver): Commitment {
  const { id: _id, signatures: _s, adjudicatorAcceptance: _a, ...rest } = EXAMPLE;
  const terms = {
    ...rest,
    buyer: o.buyer.address,
    seller: o.seller.address,
    adjudication: { ...rest.adjudication, adjudicator: o.primary, fallbackAdjudicator: o.fallback, appealAdjudicator: o.appeal, policyHash: o.policyHash, registryHash: o.registryHash },
    timing: {
      offerExpiresAt: '2026-11-01T09:30:00Z',
      fundBy: '2026-11-01T09:45:00Z',
      deliverBy: '2026-11-01T10:00:00Z',
      judgeBy: '2026-11-01T10:02:00Z',
      fallbackBy: '2026-11-01T10:04:00Z',
      appealWindowSec: 300,
      appealDecideSec: 300,
      maxSubmissions: 1 as const,
    },
    buyerEncryptionPublicKey: encodePublicKey(o.buyer.enc.publicKey),
    createdAt: T0,
  };
  const id = commitmentId(termsOf({ ...terms, id: `0x${'00'.repeat(32)}`, signatures: { seller: '0x' } } as Commitment));
  return { ...terms, id, signatures: { seller: `0x${'aa'.repeat(65)}` } } as Commitment;
}

/** Roughly the demo's cleaned customer CSV: 9,500 rows, about 0.5 MB, passes the example's checks. */
export const demoCsv = (rows = 9500): string =>
  ['customer_id,name,email,signup_date,email_valid', ...Array.from({ length: rows }, (_, k) => `${100000 + k},Customer ${k} Example,customer${k}@example.com,2024-0${1 + (k % 9)}-1${k % 10},true`)].join('\n');

interface Case {
  commitment: Commitment;
  state: EscrowState;
  delivery?: Delivery;
  ciphertextUri?: string;
  held: Map<string, EncryptedKey>;
  appealOpen?: { at: Timestamp; firstOutcome: 'accept' | 'reject'; ground?: DecisionTask['appealGround'] };
}

export class TestSettlement implements AdjudicatorSettlement {
  clock = Date.parse(T0);
  readonly cases = new Map<Hex32, Case>();
  readonly blobs = new Map<string, Uint8Array>();
  readonly records = new Map<string, Judgment>();
  readonly registrations = new Map<string, AdjudicatorRegistration>();
  readonly submitted: Array<AdjudicatorAcceptance | Decision> = [];
  /** Refuse the next N decision submissions (a transient failure). */
  failNextDecisions = 0;
  readonly randomness: RandomnessSource = simBeacon(SIM_SEED, () => this.now());

  now = (): Timestamp => new Date(this.clock).toISOString();
  at(ts: Timestamp) {
    this.clock = Date.parse(ts);
  }

  offer(c: Commitment) {
    this.cases.set(c.id, { commitment: c, state: { kind: 'Offered', id: c.id, terms: termsOf(c), sellerSignature: c.signatures.seller }, held: new Map() });
  }
  private get(id: Hex32) {
    const c = this.cases.get(id);
    if (!c) throw new Error(`no case ${id}`);
    return c;
  }
  private apply(c: Case, e: Parameters<typeof step>[1]): Result<unknown, Problem> {
    const r = step(c.state, e);
    if (r.ok) c.state = r.value;
    return r;
  }

  /** Agreement and funding are not under test: jump to Held after the acceptance. */
  fund(id: Hex32) {
    const c = this.get(id);
    if (c.state.kind !== 'AcceptedByAdjudicator') throw new Error(`fund in ${c.state.kind}`);
    const amount = { token: c.state.terms.price.token, amount: String(BigInt(c.state.terms.price.amount) + BigInt(c.state.terms.adjudication.fee.amount)) };
    c.state = { kind: 'Held', id, terms: c.state.terms, acceptance: c.state.acceptance, hold: { amount, funding: {} as FundingAuthorization, heldAt: this.now() } };
  }

  /** The seller seals the work to the three adjudicators and the buyer. */
  async deliver(id: Hex32, plaintext: string, recipients: Array<{ recipient: Address; publicKey: Uint8Array }>, mutate?: (d: Delivery) => Delivery): Promise<ContentKey> {
    const c = this.get(id);
    const bytes = new TextEncoder().encode(plaintext);
    const sealed = await seal(bytes);
    const uri = `mem://ciphertext/${sealed.ciphertextSha256}`;
    this.blobs.set(uri, sealed.ciphertext);
    let delivery: Delivery = {
      commitmentId: id,
      attempt: 1,
      ciphertext: { uri, sha256: sealed.ciphertextSha256, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' },
      plaintextSha256: sealed.plaintextSha256,
      plaintextMime: 'text/csv',
      encryptedKeys: wrapKeyForRecipients(sealed.key, recipients),
      submittedAt: this.now(),
      signature: `0x${'bb'.repeat(65)}`,
    };
    if (mutate) delivery = mutate(delivery);
    const r = this.apply(c, { type: 'deliver', at: this.now(), delivery });
    if (!r.ok) throw new Error(r.error.detail);
    c.delivery = delivery;
    const { fallbackAdjudicator, appealAdjudicator } = c.commitment.adjudication;
    for (const who of [fallbackAdjudicator, appealAdjudicator]) {
      const env = delivery.encryptedKeys.find((k) => k.recipient.toLowerCase() === who.toLowerCase());
      if (env) c.held.set(who.toLowerCase(), env);
    }
    return sealed.key;
  }

  /** What the public sees of a delivery: the fallback and appeal envelopes are held back (ADR-0020). */
  private publicDelivery(c: Case): Delivery {
    const held = new Set(c.held.keys());
    return { ...c.delivery!, encryptedKeys: c.delivery!.encryptedKeys.filter((k) => !held.has(k.recipient.toLowerCase())) };
  }

  fileAppeal(id: Hex32, ground?: DecisionTask['appealGround']) {
    const c = this.get(id);
    if ((c.state.kind !== 'Released' && c.state.kind !== 'Refunded') || c.state.via.kind !== 'first_instance') throw new Error('nothing to appeal');
    c.appealOpen = { at: this.now(), firstOutcome: c.state.kind === 'Released' ? 'accept' : 'reject', ...(ground ? { ground } : {}) };
    c.state = { ...c.state, via: { ...c.state.via, appeal: { kind: 'open', appeal: {} as never, appealDecideBy: new Date(this.clock + 600_000).toISOString() } } } as EscrowState;
  }

  async offers(adj: Hex32): Promise<OfferTask[]> {
    return [...this.cases.values()]
      .filter((c) => c.state.kind === 'Offered' && c.commitment.adjudication.adjudicator.toLowerCase() === adj.toLowerCase())
      .map((c) => ({ commitment: c.commitment, unencumberedBond: { token: 'tUSD', amount: '100000000000' } }));
  }

  async tasks(adj: Hex32): Promise<DecisionTask[]> {
    const out: DecisionTask[] = [];
    const me = adj.toLowerCase();
    for (const c of this.cases.values()) {
      const { adjudicator, fallbackAdjudicator, appealAdjudicator } = c.commitment.adjudication;
      const s = c.state;
      const base = { commitment: c.commitment, attempt: 1 };
      if (s.kind === 'Delivered' && adjudicator.toLowerCase() === me) out.push({ ...base, role: 'primary', delivery: s.delivery, deadline: s.terms.timing.judgeBy });
      if (s.kind === 'FallbackJudging' && fallbackAdjudicator.toLowerCase() === me) {
        const env = c.held.get(me);
        out.push({ ...base, role: 'fallback', delivery: this.publicDelivery(c), ...(env ? { releasedKey: env } : {}), roundFixedAt: s.terms.timing.judgeBy, deadline: s.terms.timing.fallbackBy });
      }
      if (s.kind === 'Escalated' && appealAdjudicator.toLowerCase() === me) {
        const decision = [...this.submitted].reverse().find((m): m is Decision => m.type === 'Decision' && m.commitmentId === c.commitment.id && m.outcome === 'escalate');
        const env = decision?.encryptedKeys?.find((k) => k.recipient.toLowerCase() === me);
        out.push({ ...base, role: 'appeal', delivery: this.publicDelivery(c), ...(env ? { releasedKey: env } : {}), roundFixedAt: s.escalation.at, deadline: s.escalation.appealDecideBy });
      }
      if (c.appealOpen && (s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && appealAdjudicator.toLowerCase() === me) {
        const env = c.held.get(me);
        out.push({
          ...base,
          role: 'appeal',
          delivery: this.publicDelivery(c),
          ...(env ? { releasedKey: env } : {}),
          roundFixedAt: c.appealOpen.at,
          firstOutcome: c.appealOpen.firstOutcome,
          ...(c.appealOpen.ground ? { appealGround: c.appealOpen.ground } : {}),
          deadline: s.via.appeal.appealDecideBy,
        });
      }
    }
    return out;
  }

  async takeoversDue(adj: Hex32): Promise<Hex32[]> {
    return [...this.cases.values()]
      .filter((c) => c.state.kind === 'Delivered' && c.commitment.adjudication.fallbackAdjudicator.toLowerCase() === adj.toLowerCase() && this.clock >= Date.parse(c.commitment.timing.judgeBy))
      .map((c) => c.commitment.id);
  }

  async triggerFallback(id: Hex32) {
    return this.apply(this.get(id), { type: 'trigger_fallback', at: this.now() });
  }

  async ciphertext(uri: string) {
    const b = this.blobs.get(uri);
    if (!b) throw new Error(`no blob ${uri}`);
    return b;
  }

  async publishRecord(record: Judgment) {
    const parsed = parseJudgment(record);
    if (!parsed.ok) throw new Error(`record does not parse: ${parsed.error.detail}`);
    const uri = `mem://records/${record.recordHash}`;
    this.records.set(uri, record);
    return uri;
  }

  async registration(address: Hex32) {
    return this.registrations.get(address.toLowerCase()) ?? null;
  }

  /** The per-role seed rule T-006 enforces (ADR-0018); core checks only the primary today. */
  private async seedValid(c: Case, m: Decision): Promise<Result<true, Problem>> {
    if (m.role === 'primary') return ok(true);
    const fixedAt = m.role === 'fallback' ? c.commitment.timing.judgeBy : c.state.kind === 'Escalated' ? c.state.escalation.at : c.appealOpen?.at;
    if (!fixedAt) return err(problem('seed_mismatch', 'no round for this role'));
    const round = roundFor(m.role, fixedAt);
    const value = await this.randomness.value(round);
    if (!value || !m.beacon || m.beacon.round !== round || m.beacon.value !== value) return err(problem('seed_mismatch', `beacon round ${round} not proven`));
    if (m.seed !== panelSeed(c.commitment.id, m.role, m.attempt, value)) return err(problem('seed_mismatch', 'seed is not the beacon seed for the role'));
    return ok(true);
  }

  async submit(m: AdjudicatorAcceptance | Decision): Promise<Result<unknown, Problem>> {
    if (!(await verifyMessage(DOMAIN, m, m.adjudicator))) return err(problem('invalid_signature', 'bad signature'));
    const c = this.get(m.commitmentId);
    if (m.type === 'AdjudicatorAcceptance') {
      const r = this.apply(c, { type: 'adjudicator_accept', at: this.now(), message: m, unencumberedBond: { token: 'tUSD', amount: '100000000000' } });
      if (r.ok) this.submitted.push(m);
      return r;
    }
    if (this.failNextDecisions > 0) {
      this.failNextDecisions--;
      return err(problem('adjudicator_unavailable', 'transient failure'));
    }
    const seed = await this.seedValid(c, m);
    if (!seed.ok) return seed;
    if (m.role === 'primary' && keccak256(m.seed) !== (c.state as { acceptance?: AdjudicatorAcceptance }).acceptance?.seedCommitment) return err(problem('seed_mismatch', 'primary seed'));
    const r = this.apply(c, { type: 'decide', at: this.now(), message: m });
    if (r.ok) {
      this.submitted.push(m);
      if (m.role === 'appeal') c.appealOpen = undefined;
    }
    return r;
  }

  decisions(id: Hex32): Decision[] {
    return this.submitted.filter((m): m is Decision => m.type === 'Decision' && m.commitmentId === id);
  }
  state(id: Hex32) {
    return this.get(id).state;
  }
}

export { simRoundAt };
