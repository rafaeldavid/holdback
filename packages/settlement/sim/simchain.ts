// SimChain: the in-process settlement layer for Phase 1 (T-006). It owns the facts core's pure `step` cannot
// know (balances, bond pools and their reserved counter, nonces, mandates, clubs, the clock and the beacon),
// verifies every signature against them, runs `step`, and applies the postings and events of a submission
// atomically, or not at all. `validate` is the same code path with the commit left out (ADR-0017 §7).
//
// Accounts (docs/architecture.md, Hold and settlement postings):
//   {address}                 a party's or adjudicator's own balance (fees land here)
//   escrow:{id}               the hold
//   appealbond:{id}           a party appeal's bond
//   appealfee:{id}            a party appeal's fee, held until decided (D21)
//   bond:{a}:junior           an adjudicator's own stake, first loss (ADR-0014 §2a)
//   bond:{a}:senior           backers' stake, pro rata after junior; empty in Phase 1
// Each pool has one reserved counter; each commitment records what it reserved on which adjudicator, and a
// payout from a pool never exceeds that commitment's reservation, so reserved bond is never counted twice.
import {
  beaconRoundFor,
  canonicalKeccak,
  deliveryHash,
  holdbackDomain,
  mulBps,
  offer,
  problem,
  splitBps,
  step,
  termsOf,
  verifyMessage,
  verifyMutualSettlement,
  verifyTerms,
  type Address,
  type BeaconFact,
  type Club,
  type CommitmentStateView,
  type EncryptedKey,
  type EscrowEvent,
  type EscrowState,
  type Hex32,
  type Mandate,
  type Problem,
  type ProblemType,
  type Scope,
  type SettlementEvent,
  type SettlementEventType,
  type SignableMessage,
  type Timestamp,
  type TokenAmount,
} from '@holdback/core';
import { encodePacked, keccak256 } from 'viem';
import type { DryRunSubmission, Settlement, Submission, SubmitOptions, SubmitResult, TimeoutKind } from '../src/interface.js';

export interface Genesis {
  start: Timestamp;
  /** Seeds the sim beacon: value(round) = keccak256(simSeed ‖ round) (ADR-0018). */
  simSeed: Hex32;
  chainId: number;
  token: string;
  clubs: Club[];
  /** Agent mandates, each signed by its principal; the scope SimChain checks comes from here. */
  mandates: Mandate[];
  /** Admitted members of closed clubs (principal or agent addresses). */
  members: Array<{ clubId: string; member: Address }>;
  balances: Record<Address, string>;
  bonds: Record<Address, { junior: string; senior: string }>;
  /** Kept back from a funding balance check (architecture.md Fund guard); 0 on SimChain by default. */
  gasBuffer?: string;
}

export type JournalEntry =
  | { op: 'submit'; submission: Submission; options: SubmitOptions }
  | { op: 'advance'; seconds: number }
  | { op: 'faucet'; address: Address; amount: string };

/** Mainnet chain IDs SimChain refuses to sign under (hard rule: no real money). */
const MAINNETS = new Set([1, 10, 56, 137, 324, 8453, 42161, 43114, 59144, 534352]);
const GENESIS_HASH: Hex32 = `0x${'00'.repeat(32)}`;
const ALL_BPS = 10000n;
const HALF_BPS = 5000n;

interface Rec {
  state: EscrowState;
  club: Club;
  /** Bond this commitment reserved, per adjudicator (lowercase address). */
  reservations: Record<string, bigint>;
  /** Envelopes from the delivery that SimChain holds until the path that needs them (ADR-0020). */
  held: EncryptedKey[];
  /** Envelopes released, in order. */
  released: EncryptedKey[];
  /** When an appeal was decided or expired (finality, D20). */
  appealClosedAt?: Timestamp;
  lastEventSeq: number;
  updatedAt: Timestamp;
}

type Posting = { from: string; to: string; amount: TokenAmount; why: string };

class Refusal extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail);
  }
}
const refuse = (type: ProblemType, detail: string): never => {
  throw new Refusal(problem(type, detail));
};

const lc = (a: string): string => a.toLowerCase();
const iso = (msTime: number): Timestamp => new Date(msTime).toISOString().replace('.000Z', 'Z');
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
/**
 * Copies only the signed fields of a key envelope (EIP-712 EncryptedKey). A relayer can add fields the
 * signature does not cover; spreading the message would store them, and a smuggled field could override one
 * the settlement layer sets (the recipient of a SealedKey).
 */
const signedEnvelope = (k: EncryptedKey): EncryptedKey => ({
  recipient: k.recipient,
  scheme: k.scheme,
  ciphertext: k.ciphertext,
  ...(k.unlock ? { unlock: { kind: k.unlock.kind, ...(k.unlock.round !== undefined ? { round: k.unlock.round } : {}) } } : {}),
});
/** A SealedKey (scheme and ciphertext signed) addressed to the recipient the terms name. */
const sealedFor = (recipient: Address, k: { scheme: EncryptedKey['scheme']; ciphertext: EncryptedKey['ciphertext'] }): EncryptedKey => ({ recipient, scheme: k.scheme, ciphertext: k.ciphertext });
const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)));

/** The world's mutable stores. A Tx reads through to them and writes to its own overlay. */
interface Stores {
  ledger: Map<string, bigint>;
  recs: Map<Hex32, Rec>;
  nonces: Set<string>;
  reserved: Map<string, bigint>;
  spent: Map<string, bigint>;
  log: SettlementEvent[];
}

class Tx {
  readonly ledger = new Map<string, bigint>();
  readonly recs = new Map<Hex32, Rec>();
  readonly nonces = new Set<string>();
  readonly reserved = new Map<string, bigint>();
  readonly spent = new Map<string, bigint>();
  readonly events: SettlementEvent[] = [];

  constructor(
    private readonly base: Stores,
    readonly at: Timestamp,
    readonly via: string,
    private readonly token: string,
  ) {}

  bal(account: string): bigint {
    return this.ledger.get(account) ?? this.base.ledger.get(account) ?? 0n;
  }
  rec(id: Hex32): Rec | undefined {
    return this.recs.get(id) ?? this.base.recs.get(id);
  }
  setRec(id: Hex32, r: Rec): void {
    this.recs.set(id, r);
  }
  nonceUsed(key: string): boolean {
    return this.nonces.has(key) || this.base.nonces.has(key);
  }
  useNonce(key: string): void {
    if (this.nonceUsed(key)) refuse('nonce_reused', `nonce ${key} was used before`);
    this.nonces.add(key);
  }
  reservedOf(a: string): bigint {
    return this.reserved.get(lc(a)) ?? this.base.reserved.get(lc(a)) ?? 0n;
  }
  spentOf(key: string): bigint {
    return this.spent.get(key) ?? this.base.spent.get(key) ?? 0n;
  }
  amount(v: bigint): TokenAmount {
    return { token: this.token, amount: v.toString() as TokenAmount['amount'] };
  }

  /** One posting. Never leaves a negative balance; a zero posting is skipped. */
  post(from: string, to: string, amount: bigint, why: string, into: Posting[]): void {
    if (amount < 0n) refuse('invalid_terms', `negative posting ${why}`);
    if (amount === 0n) return;
    const have = this.bal(from);
    if (have < amount) refuse('insufficient_funds', `${from} holds ${have}, needs ${amount} for ${why}`);
    this.ledger.set(from, have - amount);
    this.ledger.set(to, this.bal(to) + amount);
    into.push({ from, to, amount: this.amount(amount), why });
  }

  emit(type: SettlementEventType, commitmentId: Hex32 | undefined, actor: Address | 'anyone', payload: Record<string, unknown>): SettlementEvent {
    const prev = this.events.at(-1) ?? this.base.log.at(-1);
    const body = {
      seq: (prev?.seq ?? -1) + 1,
      type,
      ...(commitmentId ? { commitmentId } : {}),
      at: this.at,
      actor,
      submittedVia: this.via,
      payload: toJson(payload) as Record<string, unknown>,
      prevHash: prev?.hash ?? GENESIS_HASH,
    };
    const event = { ...body, hash: canonicalKeccak(body) } as SettlementEvent;
    this.events.push(event);
    return event;
  }

  commit(): void {
    for (const [k, v] of this.ledger) this.base.ledger.set(k, v);
    for (const [k, v] of this.recs) this.base.recs.set(k, v);
    for (const k of this.nonces) this.base.nonces.add(k);
    for (const [k, v] of this.reserved) this.base.reserved.set(k, v);
    for (const [k, v] of this.spent) this.base.spent.set(k, v);
    this.base.log.push(...this.events);
  }
}

export const account = {
  party: (a: string) => lc(a),
  escrow: (id: Hex32) => `escrow:${id}`,
  appealBond: (id: Hex32) => `appealbond:${id}`,
  appealFee: (id: Hex32) => `appealfee:${id}`,
  junior: (a: string) => `bond:${lc(a)}:junior`,
  senior: (a: string) => `bond:${lc(a)}:senior`,
};

const PARTY_KINDS = new Set<Submission['kind']>(['offer', 'agree', 'fund', 'agree_and_fund', 'deliver', 'early_accept', 'appeal', 'mutual_settle']);

const TRIGGER_EVENT: Record<Exclude<TimeoutKind, 'settle'>, EscrowEvent['type']> = {
  expire_offer: 'expire',
  reclaim: 'reclaim',
  fallback: 'trigger_fallback',
  default: 'trigger_default',
  apply_default: 'apply_default_outcome',
  appeal_expiry: 'expire_appeal',
};

export class SimChain implements Settlement {
  readonly kind = 'sim' as const;
  private readonly domain;
  private readonly w: Stores = { ledger: new Map(), recs: new Map(), nonces: new Set(), reserved: new Map(), spent: new Map(), log: [] };
  private readonly idempotency = new Map<string, { body: Hex32; result: Extract<SubmitResult, { ok: true }> }>();
  private readonly entries: JournalEntry[] = [];
  private readonly mandates = new Map<string, Mandate>();
  private readonly ready: Promise<Problem | null>;
  private queue: Promise<unknown> = Promise.resolve();
  private clockMs: number;
  private mintedTotal = 0n;

  constructor(readonly genesis: Genesis) {
    if (MAINNETS.has(genesis.chainId)) throw new RangeError(`SimChain refuses mainnet chain ID ${genesis.chainId} (hard rule: no real money)`);
    const start = Date.parse(genesis.start);
    if (!Number.isFinite(start) || start % 1000 !== 0) throw new RangeError(`genesis start ${genesis.start} must be a whole-second timestamp`);
    this.clockMs = start;
    this.domain = holdbackDomain(genesis.chainId);
    for (const [a, v] of Object.entries(genesis.balances)) this.mint(account.party(a), BigInt(v));
    for (const [a, b] of Object.entries(genesis.bonds)) {
      this.mint(account.junior(a), BigInt(b.junior));
      this.mint(account.senior(a), BigInt(b.senior));
    }
    for (const m of genesis.mandates) this.mandates.set(`${lc(m.agent)}|${m.clubId}`, m);
    this.ready = this.verifyGenesis();
  }

  private async verifyGenesis(): Promise<Problem | null> {
    for (const m of this.genesis.mandates) {
      if (!(await verifyMessage(this.domain, { ...m, type: 'Mandate' }, m.principal))) return problem('invalid_signature', `the mandate for ${m.agent} is not signed by ${m.principal}`);
    }
    return null;
  }

  private mint(acct: string, amount: bigint): void {
    if (amount < 0n) throw new RangeError('cannot mint a negative amount');
    this.w.ledger.set(acct, (this.w.ledger.get(acct) ?? 0n) + amount);
    this.mintedTotal += amount;
  }

  // ---- clock, beacon, faucet --------------------------------------------------------------------

  now(): Timestamp {
    return iso(this.clockMs);
  }

  advance(seconds: number): void {
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new RangeError(`advance takes whole non-negative seconds, got ${seconds}`);
    this.clockMs += seconds * 1000;
    this.entries.push({ op: 'advance', seconds });
  }

  advanceTo(ts: Timestamp): void {
    const target = Math.ceil(Date.parse(ts) / 1000) * 1000;
    if (target > this.clockMs) this.advance((target - this.clockMs) / 1000);
  }

  /** Test only: mints test tokens to an address (postings table: external:faucet -> buyer). */
  faucet(address: Address, amount: bigint): void {
    this.mint(account.party(address), amount);
    this.entries.push({ op: 'faucet', address, amount: amount.toString() });
  }

  /** The sim beacon's value for a round, or null until the clock reaches it (ADR-0018). */
  beacon(round: number): Hex32 | null {
    if (!Number.isSafeInteger(round) || round < 0 || round > Math.floor(this.clockMs / 1000)) return null;
    return keccak256(encodePacked(['bytes32', 'uint64'], [this.genesis.simSeed, BigInt(round)]));
  }

  // ---- reads ------------------------------------------------------------------------------------

  escrowState(id: Hex32): EscrowState | null {
    return this.w.recs.get(id)?.state ?? null;
  }

  pool(a: Address): { junior: bigint; senior: bigint; reserved: bigint } {
    return { junior: this.w.ledger.get(account.junior(a)) ?? 0n, senior: this.w.ledger.get(account.senior(a)) ?? 0n, reserved: this.w.reserved.get(lc(a)) ?? 0n };
  }

  /** Every non-zero account. */
  ledger(): Record<string, bigint> {
    return Object.fromEntries([...this.w.ledger].filter(([, v]) => v !== 0n));
  }

  /** Total minted at genesis and by the faucet; conservation says the ledger always sums to it. */
  minted(): bigint {
    return this.mintedTotal;
  }

  /** Bond each commitment holds reserved, per adjudicator. */
  reservations(): Array<{ commitmentId: Hex32; adjudicator: string; amount: bigint }> {
    return [...this.w.recs].flatMap(([commitmentId, r]) => Object.entries(r.reservations).map(([adjudicator, amount]) => ({ commitmentId, adjudicator, amount })));
  }

  log(): SettlementEvent[] {
    return [...this.w.log];
  }

  journal(): JournalEntry[] {
    return structuredClone(this.entries);
  }

  /** A hash over every store a submission can change: ledger, commitments, nonces, reservations, spend, idempotency, log head. */
  digest(): Hex32 {
    const sorted = <V>(m: Map<string, V>) => [...m].sort(([a], [b]) => (a < b ? -1 : 1));
    return canonicalKeccak(
      toJson({
        clock: this.clockMs,
        ledger: sorted(this.w.ledger),
        recs: sorted(this.w.recs),
        nonces: [...this.w.nonces].sort(),
        reserved: sorted(this.w.reserved),
        spent: sorted(this.w.spent),
        idempotency: sorted(this.idempotency).map(([k, v]) => [k, v.body]),
        head: this.w.log.at(-1)?.hash ?? GENESIS_HASH,
        events: this.w.log.length,
      }),
    );
  }

  /** True when every event links to the previous one and hashes to its own hash. */
  static verifyLog(events: readonly SettlementEvent[]): boolean {
    let prev: Hex32 = GENESIS_HASH;
    for (const [i, e] of events.entries()) {
      const { hash, ...body } = e;
      if (e.seq !== i || e.prevHash !== prev || canonicalKeccak(body) !== hash) return false;
      prev = hash;
    }
    return true;
  }

  /** Rebuilds a chain from its genesis and journal. The replay must reproduce the same digest. */
  static async replay(genesis: Genesis, journal: readonly JournalEntry[]): Promise<SimChain> {
    const chain = new SimChain(genesis);
    for (const [i, e] of journal.entries()) {
      if (e.op === 'advance') chain.advance(e.seconds);
      else if (e.op === 'faucet') chain.faucet(e.address, BigInt(e.amount));
      else {
        const r = await chain.submit(e.submission, e.options);
        if (!r.ok) throw new Error(`replay entry ${i} (${e.submission.kind}) was refused: ${r.problem.type}: ${r.problem.detail}`);
      }
    }
    return chain;
  }

  async state(id: Hex32): Promise<CommitmentStateView | null> {
    const r = this.w.recs.get(id);
    return r ? this.view(id, r, (a) => this.w.ledger.get(a) ?? 0n) : null;
  }

  async *events(fromSeq = 0): AsyncIterable<SettlementEvent> {
    for (const e of this.w.log.slice(fromSeq)) yield e;
  }

  async balances(addresses: readonly Address[]): Promise<Record<Address, TokenAmount>> {
    return Object.fromEntries(addresses.map((a) => [a, { token: this.genesis.token, amount: (this.w.ledger.get(account.party(a)) ?? 0n).toString() as TokenAmount['amount'] }]));
  }

  async keysFor(id: Hex32, recipient: Address): Promise<EncryptedKey[]> {
    return (this.w.recs.get(id)?.released ?? []).filter((k) => lc(k.recipient) === lc(recipient));
  }

  // ---- submission ---------------------------------------------------------------------------------

  submit(submission: Submission, options: SubmitOptions = {}): Promise<SubmitResult> {
    return this.enqueue(() => this.process(submission, options, false));
  }

  validate(submission: DryRunSubmission): Promise<SubmitResult> {
    return this.enqueue(() => this.process(submission as Submission, {}, true));
  }

  trigger(commitmentId: Hex32, timeout: TimeoutKind, options: SubmitOptions = {}): Promise<SubmitResult> {
    return this.submit({ kind: 'trigger', commitmentId, timeout }, options);
  }

  /** Submissions apply one at a time, in arrival order, so concurrent callers can never double spend. */
  private enqueue(f: () => Promise<SubmitResult>): Promise<SubmitResult> {
    const next = this.queue.then(f, f);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async process(submission: Submission, options: SubmitOptions, dryRun: boolean): Promise<SubmitResult> {
    const genesisProblem = await this.ready;
    if (genesisProblem) return { ok: false, problem: genesisProblem };
    const key = dryRun ? undefined : options.idempotencyKey;
    const body = canonicalKeccak(toJson(submission));
    if (key !== undefined) {
      const seen = this.idempotency.get(key);
      if (seen) return seen.body === body ? { ...structuredClone(seen.result), replayed: true } : { ok: false, problem: problem('idempotency_conflict', `idempotency key ${key} was used with another body`) };
    }
    let signatureCheck: 'verified' | 'skipped' | 'none';
    try {
      signatureCheck = await this.verifySignatures(submission, dryRun);
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, problem: e.problem };
      throw e;
    }
    const tx = new Tx(this.w, this.now(), options.via ?? 'direct', this.genesis.token);
    let id: Hex32;
    try {
      id = this.apply(tx, submission);
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, problem: e.problem };
      throw e;
    }
    const rec = tx.rec(id)!;
    const finalRec = { ...rec, lastEventSeq: tx.events.at(-1)?.seq ?? rec.lastEventSeq, updatedAt: tx.at };
    tx.setRec(id, finalRec);
    const state = this.view(id, finalRec, (a) => tx.bal(a));
    if (dryRun) return { ok: true, commitmentId: id, state, events: [], replayed: false, dryRun: true, signatureCheck };
    this.assertConserved(tx);
    tx.commit();
    this.entries.push({ op: 'submit', submission: structuredClone(submission), options: { ...options } });
    const result: Extract<SubmitResult, { ok: true }> = { ok: true, commitmentId: id, state, events: tx.events, replayed: false, dryRun: false, signatureCheck };
    if (key !== undefined) this.idempotency.set(key, { body, result: structuredClone(result) });
    return result;
  }

  /** A transaction may move units between accounts; it never creates or destroys one. */
  private assertConserved(tx: Tx): void {
    let delta = 0n;
    for (const [k, v] of tx.ledger) delta += v - (this.w.ledger.get(k) ?? 0n);
    if (delta !== 0n) throw new Error(`SimChain bug: a submission changed the token total by ${delta}`);
  }

  // ---- signatures --------------------------------------------------------------------------------

  private async verifySignatures(s: Submission, dryRun: boolean): Promise<'verified' | 'skipped' | 'none'> {
    if (s.kind === 'trigger') return 'none';
    const unsignedParty = dryRun && PARTY_KINDS.has(s.kind) && this.missingSignature(s);
    if (unsignedParty) return 'skipped';
    const check = async (m: SignableMessage, signer: Address, what: string) => {
      if (!(await verifyMessage(this.domain, m, signer))) refuse('invalid_signature', `${what} signature does not recover to ${signer}`);
    };
    const terms = (id: Hex32) => this.w.recs.get(id)?.state.terms ?? refuse('not_found', `no commitment ${id}`);
    switch (s.kind) {
      case 'offer': {
        const t = termsOf(s.commitment);
        if (!(await verifyTerms(this.domain, t, s.commitment.signatures.seller, t.seller))) refuse('invalid_signature', 'the seller did not sign these terms');
        break;
      }
      case 'adjudicator_accept':
        await check(s.message, s.message.adjudicator, 'AdjudicatorAcceptance');
        break;
      case 'agree':
        await check(s.message, s.message.buyer, 'Agree');
        break;
      case 'fund':
        await check(s.message, s.message.from, 'FundingAuthorization');
        break;
      case 'agree_and_fund':
        await check(s.agree, s.agree.buyer, 'Agree');
        await check(s.funding, s.funding.from, 'FundingAuthorization');
        break;
      case 'deliver':
        await check({ ...s.delivery, type: 'Delivery' }, terms(s.delivery.commitmentId).seller, 'Delivery');
        break;
      case 'early_accept':
        await check(s.message, s.message.buyer, 'EarlyAccept');
        break;
      case 'decide':
        await check(s.message, s.message.adjudicator, 'Decision');
        break;
      case 'appeal':
        await check({ ...s.appeal, type: 'Appeal' }, s.appeal.appellantAddress, 'Appeal');
        break;
      case 'mutual_settle': {
        const t = terms(s.message.commitmentId);
        if (!(await verifyMutualSettlement(this.domain, s.message, t.buyer, t.seller))) refuse('invalid_signature', 'the settlement is not signed by both the buyer and the seller');
        break;
      }
    }
    return 'verified';
  }

  private missingSignature(s: Submission): boolean {
    const blank = (sig: unknown) => typeof sig !== 'string' || sig === '' || sig === '0x';
    switch (s.kind) {
      case 'offer':
        return blank(s.commitment.signatures?.seller);
      case 'agree_and_fund':
        return blank(s.agree.signature) || blank(s.funding.signature);
      case 'deliver':
        return blank(s.delivery.signature);
      case 'appeal':
        return blank(s.appeal.signature);
      case 'mutual_settle':
        return blank(s.message.buyerSignature) || blank(s.message.sellerSignature);
      case 'agree':
      case 'fund':
      case 'early_accept':
        return blank(s.message.signature);
      default:
        return false;
    }
  }

  // ---- the rules ---------------------------------------------------------------------------------

  private scopeFor(agent: Address, clubId: string): Scope {
    const m = this.mandates.get(`${lc(agent)}|${clubId}`);
    return m ? m.scope : refuse('scope_exceeded', `${agent} has no mandate in club ${clubId}`);
  }

  private admitted(club: Club, agent: Address): boolean {
    if (club.rulebook.open) return true;
    const principal = this.mandates.get(`${lc(agent)}|${club.id}`)?.principal;
    return this.genesis.members.some((m) => m.clubId === club.id && (lc(m.member) === lc(agent) || (principal !== undefined && lc(m.member) === lc(principal))));
  }

  private stepped(state: EscrowState, e: EscrowEvent): EscrowState {
    const r = step(state, e);
    return r.ok ? r.value : refuse(r.error.type, r.error.detail);
  }

  private reserve(tx: Tx, id: Hex32, a: string, amount: bigint): void {
    if (amount === 0n) return;
    const r = tx.rec(id)!;
    tx.setRec(id, { ...r, reservations: { ...r.reservations, [lc(a)]: (r.reservations[lc(a)] ?? 0n) + amount } });
    tx.reserved.set(lc(a), tx.reservedOf(a) + amount);
  }

  private available(tx: Tx, a: string): bigint {
    return tx.bal(account.junior(a)) + tx.bal(account.senior(a)) - tx.reservedOf(a);
  }

  /** On takeover, reserve up to the price from what the pool has free (shortfall: docs/backlog.md, F5). */
  private reserveUpTo(tx: Tx, id: Hex32, a: string, price: bigint): void {
    const free = this.available(tx, a);
    this.reserve(tx, id, a, min(price, free > 0n ? free : 0n));
  }

  private release(tx: Tx, id: Hex32, a: string): void {
    const r = tx.rec(id)!;
    const held = r.reservations[lc(a)] ?? 0n;
    if (held === 0n) return;
    const rest = { ...r.reservations };
    delete rest[lc(a)];
    tx.setRec(id, { ...r, reservations: rest });
    tx.reserved.set(lc(a), tx.reservedOf(a) - held);
  }

  private releaseAll(tx: Tx, id: Hex32): void {
    for (const a of Object.keys(tx.rec(id)!.reservations)) this.release(tx, id, a);
  }

  /**
   * Pays from an adjudicator's pool, junior first, then senior (ADR-0014 §2a), never more than this commitment
   * reserved on it. Amounts were rounded down by the caller; the pool keeps any dust.
   */
  private payFromBond(tx: Tx, id: Hex32, a: string, to: string, amount: bigint, reason: 'overturn' | 'default', postings: Posting[]): void {
    const r = tx.rec(id)!;
    const cap = min(amount, r.reservations[lc(a)] ?? 0n);
    const fromJunior = min(cap, tx.bal(account.junior(a)));
    const fromSenior = min(cap - fromJunior, tx.bal(account.senior(a)));
    tx.post(account.junior(a), to, fromJunior, `${reason} payout from junior`, postings);
    tx.post(account.senior(a), to, fromSenior, `${reason} payout from senior`, postings);
    const paid = fromJunior + fromSenior;
    tx.setRec(id, { ...r, reservations: { ...r.reservations, [lc(a)]: (r.reservations[lc(a)] ?? 0n) - paid } });
    tx.reserved.set(lc(a), tx.reservedOf(a) - paid);
    tx.emit('bond.slashed', id, 'anyone', { adjudicator: a, junior: tx.amount(fromJunior), senior: tx.amount(fromSenior), reason });
  }

  private releaseKey(tx: Tx, id: Hex32, envelope: EncryptedKey, actor: Address | 'anyone', path: string): void {
    const r = tx.rec(id)!;
    tx.setRec(id, { ...r, released: [...r.released, envelope] });
    tx.emit('key.released', id, actor, { recipient: envelope.recipient, envelope, path });
  }

  private releaseHeld(tx: Tx, id: Hex32, recipient: Address, actor: Address | 'anyone', path: string): void {
    const env = tx.rec(id)!.held.find((k) => lc(k.recipient) === lc(recipient));
    if (env) this.releaseKey(tx, id, env, actor, path);
  }

  private recOf(tx: Tx, id: Hex32): Rec {
    return tx.rec(id) ?? refuse('not_found', `no commitment ${id}`);
  }

  private setState(tx: Tx, id: Hex32, state: EscrowState): void {
    tx.setRec(id, { ...tx.rec(id)!, state });
  }

  private beaconFact(tx: Tx, state: EscrowState, role: 'primary' | 'fallback' | 'appeal'): BeaconFact | null {
    if (role === 'primary') return null;
    const round = beaconRoundFor(state, role);
    const value = round === null ? null : this.beacon(round);
    return round === null || value === null ? null : { round, value };
  }

  /** Applies a verified submission inside a transaction and returns its commitment ID; throws a Refusal. */
  private apply(tx: Tx, s: Submission): Hex32 {
    const at = tx.at;
    switch (s.kind) {
      case 'offer': {
        const c = s.commitment;
        const t = termsOf(c);
        if (tx.rec(c.id)) refuse('invalid_state', `commitment ${c.id} was already offered`);
        const club = this.genesis.clubs.find((k) => k.id === t.clubId && k.rulebookHash === t.rulebookHash);
        const sellerScope = this.scopeFor(t.seller, t.clubId);
        const nonce = `${lc(t.seller)}:terms:${t.nonce}`;
        const r = offer({ commitment: c, at, sellerScope, rulebook: club?.rulebook ?? null, nonceUsed: tx.nonceUsed(nonce) });
        if (!r.ok) refuse(r.error.type, r.error.detail);
        tx.useNonce(nonce);
        tx.setRec(c.id, { state: r.ok ? r.value : (undefined as never), club: club!, reservations: {}, held: [], released: [], lastEventSeq: 0, updatedAt: at });
        tx.emit('commitment.offered', c.id, t.seller, { termsHash: c.id, terms: t, sellerSignature: c.signatures.seller });
        return c.id;
      }
      case 'adjudicator_accept': {
        const m = s.message;
        const rec = this.recOf(tx, m.commitmentId);
        tx.useNonce(`${lc(m.adjudicator)}:${m.nonce}`);
        const unencumbered = this.available(tx, m.adjudicator);
        const next = this.stepped(rec.state, { type: 'adjudicator_accept', at, message: m, unencumberedBond: tx.amount(unencumbered > 0n ? unencumbered : 0n) });
        this.setState(tx, m.commitmentId, next);
        // Guaranteed mode: 100% of the price, rounded up (ADR-0007, ADR-0022 rule 1).
        const required = mulBps(next.terms.price, ALL_BPS, 'ceil');
        if (!required.ok) refuse('invalid_terms', required.error.kind);
        const need = BigInt(required.ok ? required.value.amount : '0');
        if (unencumbered < need) refuse('coverage_exceeded', `free bond ${unencumbered} is below ${need}`);
        this.reserve(tx, m.commitmentId, m.adjudicator, need);
        tx.emit('adjudicator.accepted', m.commitmentId, m.adjudicator, { seedCommitment: m.seedCommitment, bondReserved: tx.amount(need) });
        return m.commitmentId;
      }
      case 'agree':
        return this.agree(tx, s.message);
      case 'fund':
        return this.fund(tx, s.message);
      case 'agree_and_fund':
        if (s.agree.commitmentId !== s.funding.commitmentId) refuse('invalid_terms', 'agreement and funding name different commitments');
        this.agree(tx, s.agree);
        return this.fund(tx, s.funding);
      case 'deliver': {
        const d = s.delivery;
        const rec = this.recOf(tx, d.commitmentId);
        const next = this.stepped(rec.state, { type: 'deliver', at, delivery: d });
        tx.setRec(d.commitmentId, { ...rec, state: next, held: d.encryptedKeys.map(signedEnvelope) });
        const primary = next.terms.adjudication.adjudicator;
        tx.emit('delivery.submitted', d.commitmentId, next.terms.seller, {
          attempt: d.attempt,
          deliveryHash: deliveryHash(d),
          plaintextSha256: d.plaintextSha256,
          ciphertext: d.ciphertext,
        });
        // ADR-0020: the primary judges first, so its envelope is released at delivery; the others wait.
        this.releaseHeld(tx, d.commitmentId, primary, next.terms.seller, 'delivery');
        return d.commitmentId;
      }
      case 'early_accept': {
        const m = s.message;
        const rec = this.recOf(tx, m.commitmentId);
        tx.useNonce(`${lc(m.buyer)}:${m.nonce}`);
        const next = this.stepped(rec.state, { type: 'early_accept', at, message: m });
        this.setState(tx, m.commitmentId, next);
        const { price, adjudication, seller, buyer } = next.terms;
        const postings: Posting[] = [];
        tx.post(account.escrow(m.commitmentId), account.party(seller), BigInt(price.amount), 'price to the seller', postings);
        tx.post(account.escrow(m.commitmentId), account.party(buyer), BigInt(adjudication.fee.amount), 'fee back to the buyer: no adjudicator judged', postings);
        this.releaseAll(tx, m.commitmentId);
        tx.emit('settlement.released', m.commitmentId, buyer, { via: 'early_accept', postings });
        this.releaseHeld(tx, m.commitmentId, buyer, buyer, 'early_accept');
        return m.commitmentId;
      }
      case 'decide':
        return this.decide(tx, s.message);
      case 'appeal': {
        const p = s.appeal;
        const rec = this.recOf(tx, p.commitmentId);
        const { price } = rec.state.terms;
        const rulebook = rec.club.rulebook;
        // ADR-0022 rule 1: a requirement rounds up.
        const bond = mulBps(price, BigInt(rulebook.appealBondRateBps), 'ceil');
        if (!bond.ok) refuse('invalid_terms', bond.error.kind);
        const next = this.stepped(rec.state, { type: 'file_appeal', at, appeal: p, requiredBond: bond.ok ? bond.value : price, requiredFee: rulebook.appealFee, feePaid: rulebook.appealFee });
        this.setState(tx, p.commitmentId, next);
        const postings: Posting[] = [];
        tx.post(account.party(p.appellantAddress), account.appealBond(p.commitmentId), BigInt(p.bond.amount), 'appeal bond', postings);
        tx.post(account.party(p.appellantAddress), account.appealFee(p.commitmentId), BigInt(rulebook.appealFee.amount), 'appeal fee, held until decided (D21)', postings);
        tx.emit('appeal.filed', p.commitmentId, p.appellantAddress, { appellant: p.appellant, grounds: p.grounds, bond: p.bond, fee: rulebook.appealFee, postings });
        this.releaseHeld(tx, p.commitmentId, next.terms.adjudication.appealAdjudicator, p.appellantAddress, 'appeal');
        return p.commitmentId;
      }
      case 'mutual_settle':
        return this.mutualSettle(tx, s.message);
      case 'trigger':
        return this.trigger_(tx, s.commitmentId, s.timeout);
    }
  }

  private agree(tx: Tx, m: Extract<Submission, { kind: 'agree' }>['message']): Hex32 {
    const rec = this.recOf(tx, m.commitmentId);
    const { terms } = rec.state;
    tx.useNonce(`${lc(m.buyer)}:${m.nonce}`);
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId);
    const day = `${lc(terms.buyer)}|${tx.at.slice(0, 10)}`;
    const next = this.stepped(rec.state, { type: 'agree', at: tx.at, message: m, buyerScope, spentToday: tx.amount(tx.spentOf(day)), memberAdmitted: this.admitted(rec.club, terms.buyer) });
    this.setState(tx, m.commitmentId, next);
    tx.spent.set(day, tx.spentOf(day) + BigInt(terms.price.amount));
    tx.emit('commitment.agreed', m.commitmentId, m.buyer, { termsHash: m.commitmentId });
    return m.commitmentId;
  }

  private fund(tx: Tx, m: Extract<Submission, { kind: 'fund' }>['message']): Hex32 {
    const rec = this.recOf(tx, m.commitmentId);
    const { terms } = rec.state;
    tx.useNonce(`${lc(m.from)}:${m.nonce}`);
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId);
    const next = this.stepped(rec.state, {
      type: 'fund',
      at: tx.at,
      message: m,
      buyerScope,
      balance: tx.amount(tx.bal(account.party(m.from))),
      gasBuffer: tx.amount(BigInt(this.genesis.gasBuffer ?? '0')),
    });
    if (next.kind !== 'Held') refuse('invalid_state', `funding led to ${next.kind}`);
    this.setState(tx, m.commitmentId, next);
    const postings: Posting[] = [];
    tx.post(account.party(m.from), account.escrow(m.commitmentId), BigInt(next.kind === 'Held' ? next.hold.amount.amount : '0'), 'hold: price + fee', postings);
    tx.emit('hold.funded', m.commitmentId, m.from, { amount: next.kind === 'Held' ? next.hold.amount : null, postings });
    return m.commitmentId;
  }

  private decide(tx: Tx, m: Extract<Submission, { kind: 'decide' }>['message']): Hex32 {
    const id = m.commitmentId;
    const rec = this.recOf(tx, id);
    const prev = rec.state;
    tx.useNonce(`${lc(m.adjudicator)}:${m.nonce}`);
    const beacon = this.beaconFact(tx, prev, m.role);
    const next = this.stepped(prev, { type: 'decide', at: tx.at, message: m, beacon });
    const { terms } = next;
    const { price, adjudication, buyer, seller } = terms;
    const seedSource = m.role === 'primary' ? { seedSource: 'commit-reveal' } : { seedSource: 'beacon', beaconRound: beacon?.round };
    const decidedBy = { role: m.role, outcome: m.outcome, recordHash: m.judgmentRecordHash, ...seedSource };

    // Party appeal decided: the escrow already moved; this moves bond money and the held fee (D21).
    if ((prev.kind === 'Released' || prev.kind === 'Refunded') && prev.via.kind === 'first_instance' && prev.via.appeal.kind === 'open') {
      if (next.kind !== 'Released' && next.kind !== 'Refunded') refuse('invalid_state', 'appeal decision changed the escrow state');
      const after = (next as typeof prev).via;
      const verdict = after.kind === 'first_instance' ? after.appeal.kind : 'none';
      tx.setRec(id, { ...rec, state: next, appealClosedAt: tx.at });
      const postings: Posting[] = [];
      const first = prev.via.decision.adjudicator;
      const appeal = prev.via.appeal.appeal;
      tx.post(account.appealFee(id), account.party(adjudication.appealAdjudicator), tx.bal(account.appealFee(id)), 'appeal fee to the appeal adjudicator', postings);
      if (verdict === 'upheld') {
        tx.post(account.appealBond(id), account.junior(first), tx.bal(account.appealBond(id)), 'forfeited appeal bond to junior (ADR-0014 §2a)', postings);
      } else {
        tx.post(account.appealBond(id), account.party(appeal.appellantAddress), tx.bal(account.appealBond(id)), 'appeal bond back to the appellant', postings);
      }
      tx.emit('appeal.decided', id, m.adjudicator, { ...decidedBy, appealState: verdict, postings });
      if (verdict === 'overturned') {
        const wronged = prev.kind === 'Released' ? buyer : seller;
        const bondPostings: Posting[] = [];
        this.payFromBond(tx, id, first, account.party(wronged), BigInt(price.amount), 'overturn', bondPostings);
      }
      this.releaseAll(tx, id);
      if (m.keyForBuyer) this.releaseKey(tx, id, sealedFor(buyer, m.keyForBuyer), m.adjudicator, 'appeal decision');
      return id;
    }

    // First instance or an escalated case: the decision moves the escrow (guaranteed_on_decision).
    if (m.outcome === 'accept' && !m.keyForBuyer) refuse('invalid_terms', 'an accept must carry the content key for the buyer (two-sided hold)');
    if (m.outcome === 'escalate' && !(m.encryptedKeys ?? []).some((k) => lc(k.recipient) === lc(adjudication.appealAdjudicator))) {
      refuse('invalid_terms', 'an escalate decision must carry the appeal adjudicator content key (ADR-0020)');
    }
    tx.setRec(id, { ...rec, state: next });
    const postings: Posting[] = [];
    const escrow = account.escrow(id);
    if (next.kind === 'Released' || next.kind === 'Refunded') {
      const payee = next.kind === 'Released' ? seller : buyer;
      tx.post(escrow, account.party(payee), BigInt(price.amount), next.kind === 'Released' ? 'price to the seller' : 'price back to the buyer', postings);
      tx.post(escrow, account.party(m.adjudicator), BigInt(adjudication.fee.amount), `fee to the ${m.role} adjudicator, whose decision settles`, postings);
      tx.emit('judgment.decided', id, m.adjudicator, decidedBy);
      tx.emit(next.kind === 'Released' ? 'settlement.released' : 'settlement.refunded', id, m.adjudicator, { postings });
      if (m.role === 'appeal') this.releaseAll(tx, id);
      else for (const a of Object.keys(tx.rec(id)!.reservations)) if (a !== lc(m.adjudicator)) this.release(tx, id, a);
      if (next.kind === 'Released') this.releaseKey(tx, id, sealedFor(buyer, m.keyForBuyer!), m.adjudicator, 'decision');
      return id;
    }
    if (next.kind === 'Escalated') {
      this.releaseAll(tx, id);
      this.reserveUpTo(tx, id, adjudication.appealAdjudicator, BigInt(price.amount));
      tx.emit('judgment.decided', id, m.adjudicator, decidedBy);
      const env = (m.encryptedKeys ?? []).find((k) => lc(k.recipient) === lc(adjudication.appealAdjudicator))!;
      this.releaseKey(tx, id, signedEnvelope(env), m.adjudicator, 'escalation');
      return id;
    }
    return refuse('invalid_state', `a decision led to ${next.kind}`);
  }

  private mutualSettle(tx: Tx, m: Extract<Submission, { kind: 'mutual_settle' }>['message']): Hex32 {
    const id = m.commitmentId;
    const rec = this.recOf(tx, id);
    tx.useNonce(`mutual:${id}:${m.nonce}`);
    const prev = rec.state;
    const next = this.stepped(prev, { type: 'mutual_settle', at: tx.at, message: m, rule: rec.club.rulebook.mutualSettlement });
    if (next.kind !== 'Settled') return refuse('invalid_state', `settlement led to ${next.kind}`);
    this.setState(tx, id, next);
    const { price, adjudication, buyer } = next.terms;
    // D23: one posting per payout. Core already checked the sum, token and recipients; this re-checks the sum
    // so a posting can never take more than the price out of escrow.
    const payouts = next.payouts.map((p) => ({ to: p.to, amount: BigInt(p.amount.amount) }));
    if (payouts.some((p) => p.amount <= 0n) || payouts.reduce((a, p) => a + p.amount, 0n) !== BigInt(price.amount)) refuse('invalid_terms', 'payouts must be positive and sum to the price');
    const postings: Posting[] = [];
    const escrow = account.escrow(id);
    for (const p of payouts) tx.post(escrow, account.party(p.to), p.amount, 'agreed payout', postings);
    // Fee share to the sitting adjudicator, rounded down, remainder to the buyer (ADR-0022); 0 bps in Phase 1.
    const sitting = prev.kind === 'FallbackJudging' ? adjudication.fallbackAdjudicator : prev.kind === 'Escalated' ? adjudication.appealAdjudicator : adjudication.adjudicator;
    const fee = splitBps(adjudication.fee, BigInt(rec.club.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps));
    if (!fee.ok) refuse('invalid_terms', fee.error.kind);
    if (fee.ok) {
      tx.post(escrow, account.party(sitting), BigInt(fee.value.share.amount), 'fee share to the sitting adjudicator', postings);
      tx.post(escrow, account.party(buyer), BigInt(fee.value.remainder.amount), 'fee back to the buyer', postings);
    }
    this.releaseAll(tx, id);
    tx.emit('commitment.settled', id, 'anyone', { payouts: next.payouts, keyReleased: next.keyReleased });
    if (next.keyReleased) this.releaseHeld(tx, id, buyer, 'anyone', 'mutual settlement');
    return id;
  }

  private trigger_(tx: Tx, id: Hex32, timeout: TimeoutKind): Hex32 {
    const rec = this.recOf(tx, id);
    if (timeout === 'settle') refuse('invalid_state', 'settle applies to settle_after_window (Phase 4); guaranteed_on_decision settles at the decision');
    const prev = rec.state;
    const type = TRIGGER_EVENT[timeout as Exclude<TimeoutKind, 'settle'>];
    const next = this.stepped(prev, { type, at: tx.at } as EscrowEvent);
    this.setState(tx, id, next);
    const { price, adjudication, buyer, seller } = next.terms;
    const escrow = account.escrow(id);
    const postings: Posting[] = [];
    switch (type) {
      case 'expire':
        this.releaseAll(tx, id);
        tx.emit('offer.expired', id, 'anyone', { from: prev.kind });
        break;
      case 'reclaim':
        tx.post(escrow, account.party(buyer), tx.bal(escrow), 'price + fee back to the buyer: nothing delivered', postings);
        this.releaseAll(tx, id);
        tx.emit('settlement.reclaimed', id, 'anyone', { postings });
        break;
      case 'trigger_fallback':
        this.reserveUpTo(tx, id, adjudication.fallbackAdjudicator, BigInt(price.amount));
        tx.emit('fallback.triggered', id, 'anyone', { beaconRound: beaconRoundFor(next, 'fallback') });
        this.releaseHeld(tx, id, adjudication.fallbackAdjudicator, 'anyone', 'fallback takeover');
        break;
      case 'trigger_default':
        tx.emit('default.triggered', id, 'anyone', { from: prev.kind });
        break;
      case 'apply_default_outcome': {
        if (prev.kind !== 'Defaulted') return refuse('invalid_state', 'no default to apply');
        tx.post(escrow, account.party(buyer), tx.bal(escrow), 'price + fee back to the buyer: default outcome', postings);
        tx.emit('settlement.refunded', id, 'anyone', { via: 'default_outcome', from: prev.from, postings });
        // ADR-0022 rule 3: a payout from a bond rounds down; the bond keeps the dust.
        const comp = mulBps(price, BigInt(rec.club.rulebook.defaultOutcome.judged.sellerCompensationRateBps), 'floor');
        if (!comp.ok) return refuse('invalid_terms', comp.error.kind);
        const bondPostings: Posting[] = [];
        if (prev.from === 'Escalated') {
          this.payFromBond(tx, id, adjudication.appealAdjudicator, account.party(seller), BigInt(comp.value.amount), 'default', bondPostings);
        } else {
          // Both adjudicators missed their windows: the fallback pays half rounded down, the primary the rest.
          const split = splitBps(comp.value, HALF_BPS);
          if (!split.ok) return refuse('invalid_terms', split.error.kind);
          this.payFromBond(tx, id, adjudication.adjudicator, account.party(seller), BigInt(split.value.remainder.amount), 'default', bondPostings);
          this.payFromBond(tx, id, adjudication.fallbackAdjudicator, account.party(seller), BigInt(split.value.share.amount), 'default', bondPostings);
        }
        this.releaseAll(tx, id);
        break;
      }
      case 'expire_appeal': {
        // D20: finality is the deadline that closed the window, not the moment someone triggered the expiry.
        let closedAt: Timestamp = tx.at;
        if ((prev.kind === 'Released' || prev.kind === 'Refunded') && prev.via.kind === 'first_instance') {
          const a = prev.via.appeal;
          if (a.kind === 'none') closedAt = a.appealBy;
          if (a.kind === 'open') {
            closedAt = a.appealDecideBy;
            const appellant = a.appeal.appellantAddress;
            tx.post(account.appealBond(id), account.party(appellant), tx.bal(account.appealBond(id)), 'appeal bond back: undecided', postings);
            tx.post(account.appealFee(id), account.party(appellant), tx.bal(account.appealFee(id)), 'appeal fee back: undecided (D21)', postings);
          }
        }
        this.releaseAll(tx, id);
        tx.setRec(id, { ...tx.rec(id)!, appealClosedAt: closedAt });
        tx.emit('appeal.expired', id, 'anyone', { postings });
        break;
      }
    }
    return id;
  }

  // ---- read model ---------------------------------------------------------------------------------

  private view(id: Hex32, rec: Rec, bal: (account: string) => bigint): CommitmentStateView {
    const s = rec.state;
    const t = s.terms.timing;
    const deadlines: Record<string, Timestamp> = { offerExpiresAt: t.offerExpiresAt, fundBy: t.fundBy, deliverBy: t.deliverBy, judgeBy: t.judgeBy, fallbackBy: t.fallbackBy };
    let appealState: CommitmentStateView['appealState'] = 'none';
    if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
      const a = s.via.appeal;
      appealState = a.kind;
      if (a.kind === 'none') {
        deadlines['appealBy'] = a.appealBy;
        deadlines['appealDecideBy'] = a.appealDecideBy;
      }
      if (a.kind === 'open') deadlines['appealDecideBy'] = a.appealDecideBy;
    }
    if (s.kind === 'Escalated') deadlines['appealDecideBy'] = s.escalation.appealDecideBy;
    const hold = 'hold' in s ? { hold: { amount: s.hold.amount, railRef: `sim:${account.escrow(id)}` } } : {};
    const attempt = 'delivery' in s ? s.delivery.attempt : s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? 1 : 0;
    const token = this.genesis.token;
    const amount = (a: Address): TokenAmount => ({ token, amount: bal(account.party(a)).toString() as TokenAmount['amount'] });
    const view: CommitmentStateView = {
      commitmentId: id,
      escrowState: s.kind,
      appealState,
      attempt: s.kind === 'Released' || s.kind === 'Refunded' ? (s.via.kind === 'reclaim' ? 0 : 1) : attempt,
      ...hold,
      deadlines,
      balances: { [s.terms.buyer]: amount(s.terms.buyer), [s.terms.seller]: amount(s.terms.seller) },
      settledAt: s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? s.settledAt : null,
      finalAt: this.finalAt(rec),
      lastEventSeq: rec.lastEventSeq,
      updatedAt: rec.updatedAt,
    };
    if (s.kind === 'Settled') view.settled = { payouts: s.payouts, keyReleased: s.keyReleased };
    return view;
  }

  /**
   * D20: the moment no protocol step can change who got what. Derived from state, terms and the clock, so a
   * window that closed is final without anyone triggering appeal-expiry.
   */
  private finalAt(rec: Rec): Timestamp | null {
    const s = rec.state;
    const now = this.clockMs;
    const passed = (ts: Timestamp) => now >= Date.parse(ts);
    switch (s.kind) {
      case 'Expired':
        return s.expiredAt;
      case 'Settled':
        return s.settledAt;
      case 'Released':
      case 'Refunded': {
        if (s.via.kind !== 'first_instance') return s.settledAt;
        const a = s.via.appeal;
        if (a.kind === 'none') return passed(a.appealBy) ? a.appealBy : null;
        if (a.kind === 'open') return passed(a.appealDecideBy) ? a.appealDecideBy : null;
        if (a.kind === 'expired') return rec.appealClosedAt ?? null;
        return rec.appealClosedAt ?? null;
      }
      default:
        return null;
    }
  }
}
