// The adapter from the settlement layer (packages/settlement) to the adjudicator's port. It reads the
// event log for commitments, the escrow state for what is due, and `keysFor` for the envelopes this
// adjudicator may open (ADR-0020), and it submits acceptances and decisions as Submissions. The ciphertext
// store, the record store and the adjudicator registry are not part of the Settlement interface, so the
// caller supplies them.
import {
  err,
  ok,
  SIM_BEACON,
  type AdjudicatorAcceptance,
  type AdjudicatorPolicy,
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
 * The Settlement interface plus the reads SimChain offers beyond it: the clock, the sim beacon, the full escrow
 * state and an adjudicator's bond pool. An EVM adapter would supply the same reads from the chain. A commitment whose
 * rulebook names drand-quicknet reads its rounds from the adapter's drand source instead (T-217).
 */
export interface SettlementReads extends Settlement {
  now(): Timestamp;
  beacon(round: number): Hex32 | null;
  escrowState(id: Hex32): EscrowState | null;
  pool(adjudicator: Address): { junior: bigint; senior: bigint; reserved: bigint };
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
  /** Every policy a registration carried, by hash (AdjudicatorSettlement.policy, T-221 review). Absent: none kept. */
  policy?(hash: Hex32): Promise<AdjudicatorPolicy | null>;
  /**
   * Where rounds come from for a commitment whose rulebook names drand-quicknet (drand.ts, T-217). Absent: such a
   * commitment gets no source, so its fallback and appeal turns wait and the deal takes its default path.
   */
  drand?: RandomnessSource;
}

const APPEAL_GROUNDS: readonly AppealGround[] = ['wrong-outcome', 'missing-or-wrong-key', 'policy-or-panel-violation', 'mislabeled-model'];
const lc = (a: string): string => a.toLowerCase();
const fromSubmit = (r: SubmitResult): Result<unknown, Problem> => (r.ok ? ok(r.state) : err(r.problem));

export class SettlementAdapter implements AdjudicatorSettlement {
  readonly #o: AdapterOptions;
  /** The settlement layer's own sim beacon. */
  readonly #sim: RandomnessSource;
  /** Commitments seen in the event log. */
  readonly #commitments = new Map<Hex32, Commitment>();
  #seq = 0;

  constructor(o: AdapterOptions) {
    if (o.drand && o.drand.kind !== 'drand-quicknet') throw new RangeError(`the drand option is a drand-quicknet source, not ${o.drand.kind}`);
    this.#o = o;
    this.#sim = {
      kind: 'sim',
      clock: SIM_BEACON,
      value: async (round) => {
        const value = o.chain.beacon(round);
        return value ? { value } : null;
      },
    };
  }

  /**
   * Every chain settlement runs the phase-one contracts, which have no bonds and no party appeals (ADR-0031 §8). A SimChain
   * runs them too when its genesis chose the `phase_one` profile (T-378), as the local worlds partners rehearse on do.
   */
  get phaseOne(): boolean {
    const chain = this.#o.chain as SettlementReads & { profile?: string };
    return chain.kind !== 'sim' || chain.profile === 'phase_one';
  }

  /** The source the commitment's rulebook names, which core keeps in the escrow state from the offer (T-217). */
  randomness(c: Commitment): RandomnessSource | null {
    const s = this.#o.chain.escrowState(c.id);
    if (!s) return null;
    // A state saved before the source was kept has none: every such commitment named sim.
    const source = s.beaconSource ?? 'sim';
    return source === 'sim' ? this.#sim : source === 'drand-quicknet' ? (this.#o.drand ?? null) : null;
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
   * SimChain's test at the decision: the free bond plus the commitment's own reservations on this adjudicator (at
   * acceptance and takeover). SimChain adds nothing when the fallback decides, so a decision covered by free bond can be
   * under-reserved there (T-210 item 3). Counting only the reservation would be worse: a party could drain the bond at
   * the takeover and so force the default (red team K5). A chain settlement holds no bond (ADR-0031 §8): the service
   * checks no cover there, and this reads its empty pool.
   */
  async bondCover(adjudicator: Hex32, c: Commitment): Promise<bigint> {
    const { chain } = this.#o;
    const a = adjudicator as Address;
    const pool = chain.pool(a);
    const free = pool.junior + pool.senior - pool.reserved;
    const held = chain.reservations?.().find((r) => r.commitmentId === c.id && lc(r.adjudicator) === lc(a))?.amount ?? 0n;
    return (free > 0n ? free : 0n) + held;
  }

  async appealExpiriesDue(adjudicator: Hex32): Promise<Hex32[]> {
    // Phase one: a first decision is final at once, so no appeal window is left to close.
    if (this.phaseOne) return [];
    const now = Date.parse(this.now());
    return (await this.#cases())
      .filter(({ s }) => {
        if ((s.kind !== 'Released' && s.kind !== 'Refunded') || s.via.kind !== 'first_instance' || lc(s.via.decision.adjudicator) !== lc(adjudicator)) return false;
        const a = s.via.appeal;
        return (a.kind === 'none' && now >= Date.parse(a.appealBy)) || (a.kind === 'open' && now >= Date.parse(a.appealDecideBy));
      })
      .map(({ c }) => c.id);
  }

  // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
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

  async policy(hash: Hex32): Promise<AdjudicatorPolicy | null> {
    return (await this.#o.policy?.(hash)) ?? null;
  }
}
