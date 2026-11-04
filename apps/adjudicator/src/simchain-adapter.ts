// The adapter from the settlement layer (packages/settlement) to the adjudicator's port. It reads the
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
 * state and an adjudicator's bond pool. An EVM adapter would supply the same reads from the chain.
 */
export interface SettlementReads extends Settlement {
  now(): Timestamp;
  beacon(round: number): Hex32 | null;
  escrowState(id: Hex32): EscrowState | null;
  pool(adjudicator: Address): { junior: bigint; senior: bigint; reserved: bigint };
  /** The contract's `freeOf`, read fresh (the EVM adapter); it also marks the contract's bond rules (`bondCover`). */
  freeBond?(adjudicator: Address): Promise<bigint>;
  /** Bond each commitment holds reserved, per adjudicator (SimChain). */
  reservations?(): Array<{ commitmentId: Hex32; adjudicator: string; amount: bigint }>;
}

/** Content-addressed blobs and records, off the settlement layer. */
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
  /** Commitments seen in the event log. */
  readonly #commitments = new Map<Hex32, Commitment>();
  #seq = 0;

  constructor(o: AdapterOptions) {
    this.#o = o;
    this.randomness = { kind: 'sim', value: async (round) => o.chain.beacon(round) };
  }

  now(): Timestamp {
    return this.#o.chain.now();
  }

  /** Reads new events: offers give the signed commitment; the delivery comes from the escrow state. */
  async #sync(): Promise<void> {
    for await (const e of this.#o.chain.events(this.#seq)) {
      this.#seq = e.seq + 1;
      if (!e.commitmentId) continue;
      if (e.type === 'commitment.offered') {
        const p = e.payload as { terms: CommitmentTerms; sellerSignature: Signature };
        this.#commitments.set(e.commitmentId, { ...p.terms, id: e.commitmentId, signatures: { seller: p.sellerSignature } });
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
   * The seller-signed delivery the task is about, as posted: the adjudicator checks the seller's signature on it and
   * names its hash (ADR-0029). It opens only the envelope it is entitled to: the primary its own, the fallback and
   * appeal adjudicators the one released to them (`releasedKey`, ADR-0020), and a task exists only at their turn. A
   * settled case keeps the delivery its first decision judged, for a party appeal.
   */
  #delivery(s: EscrowState): Delivery | null {
    if ('delivery' in s) return s.delivery;
    if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') return s.via.delivery;
    return null;
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
      else if (s.kind === 'Escalated' && lc(appealAdjudicator) === me) task = { role: 'appeal', roundFixedAt: s.escalation.at, firstDecider: s.escalation.by === 'fallback' ? fallbackAdjudicator : primary, deadline: s.escalation.appealDecideBy };
      else if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && lc(appealAdjudicator) === me) {
        const grounds = s.via.appeal.appeal.grounds as AppealGround;
        task = {
          role: 'appeal',
          roundFixedAt: s.via.appeal.openedAt,
          firstOutcome: s.kind === 'Released' ? 'accept' : 'reject',
          firstDecider: s.via.decision.adjudicator,
          ...(APPEAL_GROUNDS.includes(grounds) ? { appealGround: grounds } : {}),
          deadline: s.via.appeal.appealDecideBy,
        };
      }
      if (!task) continue;
      const released = await this.#o.chain.keysFor(c.id, adjudicator as Address);
      const delivery = this.#delivery(s);
      if (!delivery) continue;
      const releasedKey = task.role === 'primary' ? undefined : released.at(-1);
      out.push({ ...task, commitment: c, attempt: delivery.attempt, delivery, ...(releasedKey ? { releasedKey } : {}) });
    }
    return out;
  }

  async takeoversDue(adjudicator: Hex32): Promise<Commitment[]> {
    const now = Date.parse(this.now());
    return (await this.#cases())
      .filter(({ c, s }) => s.kind === 'Delivered' && lc(c.adjudication.fallbackAdjudicator) === lc(adjudicator) && now >= Date.parse(c.timing.judgeBy) && now < Date.parse(c.timing.fallbackBy))
      .map(({ c }) => c);
  }

  async triggerFallback(commitmentId: Hex32): Promise<Result<unknown, Problem>> {
    return fromSubmit(await this.#o.chain.trigger(commitmentId, 'fallback'));
  }

  /**
   * The contract's test at the decision, on both chains: the free bond plus what the commitment already holds on this
   * adjudicator.
   * - The contract, which `freeBond` (its `freeOf`) marks: plus the price while the commitment still holds this
   *   adjudicator's bond (ADR-0016 §1), as primary in Delivered and FallbackJudging, since a fallback's decision releases
   *   the primary's reservation before it encumbers its own, and as the first decider while its appeal is open.
   * - SimChain: plus the commitment's own reservations on it (at acceptance and takeover). SimChain adds nothing when the
   *   fallback decides, so a decision covered by free bond can be under-reserved there (T-210 item 3). Counting only the
   *   reservation would be worse: a party could drain the bond at the takeover and so force the default (red team K5).
   */
  async bondCover(adjudicator: Hex32, c: Commitment): Promise<bigint> {
    const { chain } = this.#o;
    const a = adjudicator as Address;
    const s = chain.escrowState(c.id);
    const pool = chain.pool(a);
    const pooled = pool.junior + pool.senior - pool.reserved;
    let free: bigint;
    let held: bigint;
    if (!chain.freeBond) {
      free = pooled;
      held = chain.reservations?.().find((r) => r.commitmentId === c.id && lc(r.adjudicator) === lc(a))?.amount ?? 0n;
    } else {
      free = await chain.freeBond(a);
      const holder =
        s?.kind === 'Delivered' || s?.kind === 'FallbackJudging'
          ? c.adjudication.adjudicator
          : (s?.kind === 'Released' || s?.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open'
            ? s.via.decision.adjudicator
            : null;
      held = holder && lc(holder) === lc(a) ? BigInt(c.price.amount) : 0n;
    }
    return (free > 0n ? free : 0n) + held;
  }

  async appealExpiriesDue(adjudicator: Hex32): Promise<Hex32[]> {
    const now = Date.parse(this.now());
    return (await this.#cases())
      .filter(({ s }) => {
        if ((s.kind !== 'Released' && s.kind !== 'Refunded') || s.via.kind !== 'first_instance' || lc(s.via.decision.adjudicator) !== lc(adjudicator)) return false;
        const a = s.via.appeal;
        return (a.kind === 'none' && now >= Date.parse(a.appealBy)) || (a.kind === 'open' && now >= Date.parse(a.appealDecideBy));
      })
      .map(({ c }) => c.id);
  }

  async expireAppeal(commitmentId: Hex32): Promise<Result<unknown, Problem>> {
    return fromSubmit(await this.#o.chain.trigger(commitmentId, 'appeal_expiry'));
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
