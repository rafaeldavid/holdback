// Test harness: a small in-memory settlement on core's `step` behind the AdjudicatorSettlement port, for
// unit tests that need to skip agreement and funding, inject failures (submission, record store) or open
// an appeal directly. Core checks the seeds (ADR-0018) from the beacon fact this harness supplies; the
// harness holds fallback and appeal envelopes until takeover (ADR-0020) and verifies every signature.
// The end-to-end path runs on the real SimChain through simchain-adapter.ts. Test-only; not exported.
import {
  beaconRoundFor,
  type BeaconFact,
  commitmentId,
  holdbackDomain,
  parseJudgment,
  problem,
  signMessage,
  step,
  termsOf,
  verifyMessage,
  err,
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
import { tusd } from '@holdback/settlement/sim';
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import type { AdjudicatorSettlement, DecisionTask, OfferTask } from './settlement-port.js';
import { simBeacon, simRoundAt, type RandomnessSource } from './randomness.js';

export const DOMAIN = holdbackDomain(31337);
export const SIM_SEED: Hex32 = `0x${'5e'.repeat(32)}`;
export const T0 = '2026-11-01T09:00:00Z';

export { tusd };

export interface Party {
  key: `0x${string}`;
  address: Address;
  enc: EncryptionKeyPair;
}
/** Every party's signing key by address, so the harness can sign a delivery as its seller. */
const KEYS = new Map<string, `0x${string}`>();
export function party(n: number): Party {
  const key = `0x${n.toString(16).padStart(2, '0').repeat(32)}` as `0x${string}`;
  const address = privateKeyToAccount(key).address.toLowerCase() as Address;
  KEYS.set(address, key);
  return { key, address, enc: encryptionKeyPairFromSecretKey(new Uint8Array(32).fill(n + 100)) };
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
  const rest: Omit<Commitment, 'id' | 'signatures' | 'adjudicatorAcceptance'> & Partial<Commitment> = { ...EXAMPLE };
  delete rest.id;
  delete rest.signatures;
  delete rest.adjudicatorAcceptance;
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
  /** Throw on the next N record publications (a transient store failure). */
  failNextPublishes = 0;
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
    const amount = tusd(BigInt(c.state.terms.price.amount) + BigInt(c.state.terms.adjudication.fee.amount));
    c.state = { kind: 'Held', id, terms: c.state.terms, acceptance: c.state.acceptance, hold: { amount, funding: {} as FundingAuthorization, heldAt: this.now() } };
  }

  /**
   * The seller seals the work to the three adjudicators and the buyer, and signs the delivery after `mutate`, as the
   * seller of the commitment. `signer` signs it instead (another key: a delivery the seller never signed).
   */
  async deliver(id: Hex32, plaintext: string, recipients: Array<{ recipient: Address; publicKey: Uint8Array }>, mutate?: (d: Delivery) => Delivery, signer?: `0x${string}`): Promise<ContentKey> {
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
    const key = signer ?? KEYS.get(c.commitment.seller.toLowerCase());
    if (key) {
      const { signature: _s, ...unsigned } = delivery; // eslint-disable-line @typescript-eslint/no-unused-vars
      delivery = { ...unsigned, signature: await signMessage(key, DOMAIN, { ...unsigned, type: 'Delivery' }) };
    }
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

  /**
   * The seller-signed delivery as posted, which a task carries so the adjudicator can check the signature and name
   * its hash (ADR-0029). The fallback and appeal adjudicators still open only the envelope released to them.
   */
  private signedDelivery(c: Case): Delivery {
    return c.delivery!;
  }

  fileAppeal(id: Hex32, ground?: DecisionTask['appealGround']) {
    const c = this.get(id);
    if ((c.state.kind !== 'Released' && c.state.kind !== 'Refunded') || c.state.via.kind !== 'first_instance') throw new Error('nothing to appeal');
    c.appealOpen = { at: this.now(), firstOutcome: c.state.kind === 'Released' ? 'accept' : 'reject', ...(ground ? { ground } : {}) };
    c.state = { ...c.state, via: { ...c.state.via, appeal: { kind: 'open', appeal: {} as never, appealDecideBy: new Date(this.clock + 600_000).toISOString(), openedAt: this.now() } } };
  }

  async offers(adj: Hex32): Promise<OfferTask[]> {
    return [...this.cases.values()]
      .filter((c) => c.state.kind === 'Offered' && c.commitment.adjudication.adjudicator.toLowerCase() === adj.toLowerCase())
      .map((c) => ({ commitment: c.commitment, unencumberedBond: tusd('100000000000') }));
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
        out.push({ ...base, role: 'fallback', delivery: this.signedDelivery(c), ...(env ? { releasedKey: env } : {}), roundFixedAt: s.terms.timing.judgeBy, deadline: s.terms.timing.fallbackBy });
      }
      if (s.kind === 'Escalated' && appealAdjudicator.toLowerCase() === me) {
        const decision = [...this.submitted].reverse().find((m): m is Decision => m.type === 'Decision' && m.commitmentId === c.commitment.id && m.outcome === 'escalate');
        const env = decision?.encryptedKeys?.find((k) => k.recipient.toLowerCase() === me);
        out.push({ ...base, role: 'appeal', delivery: this.signedDelivery(c), ...(env ? { releasedKey: env } : {}), roundFixedAt: s.escalation.at, deadline: s.escalation.appealDecideBy });
      }
      if (c.appealOpen && (s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && appealAdjudicator.toLowerCase() === me) {
        const env = c.held.get(me);
        out.push({
          ...base,
          role: 'appeal',
          delivery: this.signedDelivery(c),
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
    if (this.failNextPublishes > 0) {
      this.failNextPublishes--;
      throw new Error('record store unavailable');
    }
    const parsed = parseJudgment(record);
    if (!parsed.ok) throw new Error(`record does not parse: ${parsed.error.detail}`);
    const uri = `mem://records/${record.recordHash}`;
    this.records.set(uri, record);
    return uri;
  }

  async registration(address: Hex32) {
    return this.registrations.get(address.toLowerCase()) ?? null;
  }

  /** The beacon fact core's step checks for fallback and appeal decisions (ADR-0018), as SimChain supplies it. */
  private async beaconFact(c: Case, m: Decision): Promise<BeaconFact | null | undefined> {
    if (m.role === 'primary') return undefined;
    const round = beaconRoundFor(c.state, m.role);
    if (round === null) return null;
    const value = await this.randomness.value(round);
    return value ? { round, value } : null;
  }

  async submit(m: AdjudicatorAcceptance | Decision): Promise<Result<unknown, Problem>> {
    if (!(await verifyMessage(DOMAIN, m, m.adjudicator))) return err(problem('invalid_signature', 'bad signature'));
    const c = this.get(m.commitmentId);
    if (m.type === 'AdjudicatorAcceptance') {
      const r = this.apply(c, { type: 'adjudicator_accept', at: this.now(), message: m, unencumberedBond: tusd('100000000000') });
      if (r.ok) this.submitted.push(m);
      return r;
    }
    if (this.failNextDecisions > 0) {
      this.failNextDecisions--;
      return err(problem('adjudicator_unavailable', 'transient failure'));
    }
    const beacon = await this.beaconFact(c, m);
    const r = this.apply(c, { type: 'decide', at: this.now(), message: m, ...(beacon !== undefined ? { beacon } : {}) });
    if (r.ok) {
      this.submitted.push(m);
      if (m.role === 'appeal') delete c.appealOpen;
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
