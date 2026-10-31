// The adapter from T-006's settlement layer (packages/settlement) to the adjudicator's port. It reads the
// event log for commitments, the escrow state for what is due, and `keysFor` for the envelopes this
// adjudicator may open (ADR-0020), and it submits acceptances and decisions as Submissions. The ciphertext
// store, the record store and the adjudicator registry are not part of the Settlement interface, so the
// caller supplies them.
import {
  err,
  ok,
  type AdjudicatorAcceptance,
  type AdjudicatorRegistration,
  type Address,
  type AppealGround,
  type Commitment,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type EncryptedKey,
  type EscrowState,
  type Hex32,
  type Judgment,
  type Problem,
  type Result,
  type Signature,
  type Timestamp,
  type TokenAmount,
} from '@holdback/core';
import type { Settlement, SubmitResult } from '@holdback/settlement';
import type { AdjudicatorSettlement, DecisionTask, OfferTask } from './settlement-port.js';
import type { RandomnessSource } from './randomness.js';

/**
 * The Settlement interface plus the reads SimChain offers beyond it: the clock, the beacon, the full escrow
 * state and an adjudicator's bond pool. A Phase 2 chain adapter supplies the same reads from the chain.
 */
export interface SettlementReads extends Settlement {
  now(): Timestamp;
  beacon(round: number): Hex32 | null;
  escrowState(id: Hex32): EscrowState | null;
  pool(adjudicator: Address): { junior: bigint; senior: bigint; reserved: bigint };
}

/** Content-addressed blobs and records; off the settlement layer (T-007 or T-014 own the real ones). */
export interface ContentStore {
  ciphertext(uri: string): Promise<Uint8Array>;
  publishRecord(record: Judgment): Promise<string>;
}

export interface AdapterOptions {
  chain: SettlementReads;
  store: ContentStore;
  registration(address: Address): Promise<AdjudicatorRegistration | null>;
}

const APPEAL_GROUNDS: readonly AppealGround[] = ['wrong-outcome', 'missing-or-wrong-key', 'policy-or-panel-violation', 'mislabeled-model'];
const lc = (a: string): string => a.toLowerCase();
const fromSubmit = (r: SubmitResult): Result<unknown, Problem> => (r.ok ? ok(r.state) : err(r.problem));

export class SettlementAdapter implements AdjudicatorSettlement {
  readonly randomness: RandomnessSource;
  readonly #o: AdapterOptions;
  /** Commitments seen in the event log, with the delivery records needed after the state drops them. */
  readonly #commitments = new Map<Hex32, Commitment>();
  readonly #deliveries = new Map<Hex32, { attempt: number; ciphertext: Delivery['ciphertext']; plaintextSha256: Delivery['plaintextSha256']; at: Timestamp }>();
  #seq = 0;

  constructor(o: AdapterOptions) {
    this.#o = o;
    this.randomness = { kind: 'sim', value: async (round) => o.chain.beacon(round) };
  }

  now(): Timestamp {
    return this.#o.chain.now();
  }

  /** Reads new events: offers give the signed commitment, deliveries the public delivery record. */
  async #sync(): Promise<void> {
    for await (const e of this.#o.chain.events(this.#seq)) {
      this.#seq = e.seq + 1;
      if (!e.commitmentId) continue;
      if (e.type === 'commitment.offered') {
        const p = e.payload as { terms: CommitmentTerms; sellerSignature: Signature };
        this.#commitments.set(e.commitmentId, { ...p.terms, id: e.commitmentId, signatures: { seller: p.sellerSignature } });
      } else if (e.type === 'delivery.submitted') {
        const p = e.payload as { attempt: number; ciphertext: Delivery['ciphertext']; plaintextSha256: Delivery['plaintextSha256'] };
        this.#deliveries.set(e.commitmentId, { attempt: p.attempt, ciphertext: p.ciphertext, plaintextSha256: p.plaintextSha256, at: e.at });
      }
    }
  }

  async #cases(): Promise<Array<{ c: Commitment; s: EscrowState }>> {
    await this.#sync();
    const out: Array<{ c: Commitment; s: EscrowState }> = [];
    for (const [id, c] of this.#commitments) {
      const s = this.#o.chain.escrowState(id);
      if (s) out.push({ c, s });
    }
    return out;
  }

  /**
   * The delivery as this adjudicator sees it: its envelopes are only those released to it (ADR-0020). The
   * state drops the delivery once the case settles, so a party appeal rebuilds it from the delivery event.
   */
  #delivery(c: Commitment, s: EscrowState, released: EncryptedKey[]): Delivery | null {
    if ('delivery' in s) return { ...s.delivery, encryptedKeys: released };
    const d = this.#deliveries.get(c.id);
    if (!d || !c.deliverable.format) return null;
    return { commitmentId: c.id, attempt: d.attempt, ciphertext: d.ciphertext, plaintextSha256: d.plaintextSha256, plaintextMime: c.deliverable.format, encryptedKeys: released, submittedAt: d.at, signature: '0x' };
  }

  async offers(adjudicator: Hex32): Promise<OfferTask[]> {
    const me = lc(adjudicator);
    const pool = this.#o.chain.pool(adjudicator as Address);
    const free = pool.junior + pool.senior - pool.reserved;
    const bond = (token: string) => ({ token, amount: (free > 0n ? free : 0n).toString() }) as TokenAmount;
    return (await this.#cases())
      .filter(({ c, s }) => s.kind === 'Offered' && lc(c.adjudication.adjudicator) === me)
      .map(({ c }) => ({ commitment: c, unencumberedBond: bond(c.price.token) }));
  }

  async tasks(adjudicator: Hex32): Promise<DecisionTask[]> {
    const me = lc(adjudicator);
    const out: DecisionTask[] = [];
    for (const { c, s } of await this.#cases()) {
      const { adjudicator: primary, fallbackAdjudicator, appealAdjudicator } = c.adjudication;
      let task: Omit<DecisionTask, 'commitment' | 'attempt' | 'delivery'> | null = null;
      if (s.kind === 'Delivered' && lc(primary) === me) task = { role: 'primary', deadline: c.timing.judgeBy };
      else if (s.kind === 'FallbackJudging' && lc(fallbackAdjudicator) === me) task = { role: 'fallback', roundFixedAt: c.timing.judgeBy, deadline: c.timing.fallbackBy };
      else if (s.kind === 'Escalated' && lc(appealAdjudicator) === me) task = { role: 'appeal', roundFixedAt: s.escalation.at, deadline: s.escalation.appealDecideBy };
      else if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && lc(appealAdjudicator) === me) {
        const grounds = s.via.appeal.appeal.grounds as AppealGround;
        task = {
          role: 'appeal',
          roundFixedAt: s.via.appeal.openedAt,
          firstOutcome: s.kind === 'Released' ? 'accept' : 'reject',
          ...(APPEAL_GROUNDS.includes(grounds) ? { appealGround: grounds } : {}),
          deadline: s.via.appeal.appealDecideBy,
        };
      }
      if (!task) continue;
      const released = await this.#o.chain.keysFor(c.id, adjudicator as Address);
      const delivery = this.#delivery(c, s, task.role === 'primary' ? released : []);
      if (!delivery) continue;
      const releasedKey = task.role === 'primary' ? undefined : released.at(-1);
      out.push({ ...task, commitment: c, attempt: delivery.attempt, delivery, ...(releasedKey ? { releasedKey } : {}) });
    }
    return out;
  }

  async takeoversDue(adjudicator: Hex32): Promise<Hex32[]> {
    const now = Date.parse(this.now());
    return (await this.#cases())
      .filter(({ c, s }) => s.kind === 'Delivered' && lc(c.adjudication.fallbackAdjudicator) === lc(adjudicator) && now >= Date.parse(c.timing.judgeBy))
      .map(({ c }) => c.id);
  }

  async triggerFallback(commitmentId: Hex32): Promise<Result<unknown, Problem>> {
    return fromSubmit(await this.#o.chain.trigger(commitmentId, 'fallback'));
  }

  ciphertext(uri: string): Promise<Uint8Array> {
    return this.#o.store.ciphertext(uri);
  }

  publishRecord(record: Judgment): Promise<string> {
    return this.#o.store.publishRecord(record);
  }

  /** The idempotency key is the message's own nonce, so a resubmission after a lost reply replays the first result. */
  async submit(message: AdjudicatorAcceptance | Decision): Promise<Result<unknown, Problem>> {
    const idempotencyKey = `${message.type}:${message.commitmentId}:${message.nonce}`;
    const r =
      message.type === 'AdjudicatorAcceptance'
        ? await this.#o.chain.submit({ kind: 'adjudicator_accept', message }, { idempotencyKey })
        : await this.#o.chain.submit({ kind: 'decide', message }, { idempotencyKey });
    return fromSubmit(r);
  }

  registration(address: Hex32): Promise<AdjudicatorRegistration | null> {
    return this.#o.registration(address as Address);
  }
}
