// EvmSettlement: the Settlement interface over the Holdback contracts (HoldbackRules, HoldbackBonds, CPP), on a local
// anvil chain (kind 'local') or a public testnet (kind 'testnet', D41). Agents see amounts, states and receipts,
// never chain mechanics.
//
// What is on chain and what is not (T-202 Decisions, rule 1):
// - The contract has no Offered, AcceptedByAdjudicator or Agreed stage. Offer, adjudicator acceptance and Agree are
//   signatures the contract checks together at `agreeAndFund`. This adapter collects them, and runs the same
//   pre-funding checks SimChain runs (core `offer` and `step`, mandate scope, membership, daily spend, nonces), as
//   the relaying client would; their events carry `source: 'adapter'`.
// - From funding on, every submission is one contract call. The contract is the authority: a revert is the
//   refusal (mapped to SimChain's problem types by errors.ts), and a mined call is the state change.
// - A core-state mirror is stepped for each mined call, at its block's time, so reads keep SimChain's shape
//   (deadlines, finality); after every call the mirror's state must equal the on-chain stage, or the adapter throws
//   a divergence error.
// - Events keep SimChain's payloads (what the operator, the adjudicators and agents read), plus `tx`, `block`,
//   `sender` and `gasUsed` for the transaction that made them. Postings stay SimChain's: the chain's ledger is the
//   token's own balances.
// - Content-key envelopes for the adjudicators never touch the contract (T-202 decision 3). The adapter holds the
//   seller-signed delivery's envelopes and releases each adjudicator's at its turn, as SimChain does (ADR-0020):
//   the primary at delivery, the fallback at takeover, the appeal adjudicator at escalation or a party appeal.
//   The buyer's envelope is released on chain, in the paying transaction.
import {
  beaconRoundFor,
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  deliveryHash,
  holdbackDomain,
  mulBps,
  offer,
  problem,
  step,
  termsOf,
  toTimestamp,
  verifyMessage,
  verifyMutualSettlement,
  verifyTerms,
  type AdjudicatorAcceptance,
  type Agree,
  type Address,
  type AnyCommitmentTerms,
  type Appeal,
  type Club,
  type CommitmentStateView,
  type Decision,
  type Delivery,
  type EncryptedKey,
  type EscrowEvent,
  type EscrowState,
  type EscrowStateKind,
  type Hex32,
  type Mandate,
  type Problem,
  type Scope,
  type SettlementEvent,
  type SettlementEventType,
  type SignableMessage,
  type Timestamp,
  type TokenAmount,
  type TransferAuthorization,
} from '@holdback/core';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, encodePacked, getAddress, hashTypedData, keccak256, toHex, type Abi, type Hex, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Genesis } from '../sim/simchain.js';
import type { DryRunSubmission, Settlement, Submission, SubmitOptions, SubmitResult, TimeoutKind } from '../src/interface.js';
import { Refusal, refuse, toJson } from '../src/util.js';
import type { EvmChain, Mined } from './chain.js';
import {
  acceptanceView,
  agreeView,
  appealView,
  decisionView,
  deliveryView,
  earlyAcceptView,
  keyProof,
  mutualView,
  NO_DELIVERY,
  NO_KEY,
  operatorFeeNonce,
  paymentHash,
  paymentInfo,
  payerAgnosticHash,
  receiveDigest,
  termsView,
  transferDigest,
} from './encode.js';
import { problemFromRevert, revertData } from './errors.js';
import { assertSafeChain } from './guard.js';
import type { EvmWorld } from './world.js';

/** Submit options on EVM: who pays gas. A private key: the agent's own for 'direct'. Absent: the chain's relayer lane for the commitment. */
export interface EvmSubmitOptions extends SubmitOptions {
  sender?: Hex;
}

/** One mined transaction, for gas per deal (D4) and the escape-hatch evidence (who sent it). */
export interface TxRecord {
  commitmentId: Hex32;
  call: string;
  hash: Hex;
  from: Address;
  via: string;
  gasUsed: bigint;
  at: Timestamp;
}

/** Everything the adapter knows about one commitment that the chain does not hold. Plain JSON: a store keeps it. */
export interface Book {
  state: EscrowState;
  club: Club;
  sellerSignature: Hex;
  acceptance?: AdjudicatorAcceptance;
  agree?: Agree;
  delivery?: Delivery;
  /** A seller-signed delivery held off chain, carried by the next decision or early accept (D4: two transactions). */
  carried?: Delivery;
  /** The delivery's envelopes, released to each adjudicator at its turn (ADR-0020). */
  held: EncryptedKey[];
  released: EncryptedKey[];
  /** Pre-funding nonces this commitment used, rebuilt into the nonce set after a restart. */
  nonces: string[];
  /** The buyer's daily-spend key this commitment counted against, and the amount. */
  spent?: { day: string; amount: string };
  appealClosedAt?: Timestamp;
  lastEventSeq: number;
  updatedAt: Timestamp;
}

/** What a store must persist to rebuild a live settlement after a restart (`EvmSettlement.restore`). */
export interface EvmSaved {
  books: ReadonlyArray<readonly [Hex32, Book]>;
  events: readonly SettlementEvent[];
  mandates: readonly Mandate[];
}

/** What changed since the last `drain`: the books to overwrite, the events to append, the mandates admitted. */
export type EvmChanges = { books: Array<[Hex32, Book]>; events: SettlementEvent[]; mandates: Mandate[] };

const GENESIS_HASH: Hex32 = `0x${'00'.repeat(32)}`;
const UINT256_MAX = (2n ** 256n - 1n).toString();
const ALL_BPS = 10000n;
const lc = (a: string) => a.toLowerCase();
const secs = (ts: Timestamp) => Math.floor(Date.parse(ts) / 1000);
/** An envelope as the seller signed it (SimChain's signedEnvelope). */
const signedEnvelope = (k: EncryptedKey): EncryptedKey => ({
  recipient: k.recipient,
  scheme: k.scheme,
  ciphertext: k.ciphertext,
  ...(k.unlock ? { unlock: { kind: k.unlock.kind, ...(k.unlock.round !== undefined ? { round: k.unlock.round } : {}) } } : {}),
});

/** On-chain Stage enum (HoldbackRules.Stage) as core kinds; None is any pre-funding kind. */
const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'] as const;
const APPEAL_STATES = ['none', 'open', 'upheld', 'overturned', 'expired', 'none'] as const;
const PRE_FUNDING: readonly EscrowStateKind[] = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];
/** How long a live chain's balance reads are reused: a block is about 12 s on Sepolia. */
const BALANCE_TTL_MS = 4000;

/** Contract event names as settlement event types, per call. Unlisted logs (CPP, bonds, token) map to nothing. */
const LOG_TYPES: Record<string, Record<string, SettlementEventType>> = {
  agreeAndFund: { JobFunded: 'hold.funded' },
  deliver: { JobSubmitted: 'delivery.submitted' },
  decide: { JobSubmitted: 'delivery.submitted', Decided: 'judgment.decided', PaymentReleased: 'settlement.released', Refunded: 'settlement.refunded', KeyReleased: 'key.released' },
  earlyAccept: { JobSubmitted: 'delivery.submitted', PaymentReleased: 'settlement.released', KeyReleased: 'key.released' },
  mutualSettle: { MutuallySettled: 'commitment.settled', KeyReleased: 'key.released' },
  fileAppeal: { AppealFiled: 'appeal.filed' },
  expireOffer: { JobExpired: 'offer.expired' },
  reclaim: { Refunded: 'settlement.reclaimed' },
  triggerFallback: { FallbackTriggered: 'fallback.triggered' },
  triggerDefault: { Defaulted: 'default.triggered', Refunded: 'settlement.refunded' },
  expireAppeal: { AppealClosed: 'appeal.expired' },
};
const KEY_PATHS = ['decision', 'early_accept', 'mutual settlement', 'appeal decision'];

export interface DecodedLog {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
}

/** The settlement event types one call's logs produce, in log order. A party appeal's decision is appeal.decided. */
export function eventTypesFor(call: string, logs: readonly DecodedLog[]): Array<{ type: SettlementEventType; log: DecodedLog | null }> {
  const appealClosed = call === 'decide' && logs.some((l) => l.eventName === 'AppealClosed');
  const table = LOG_TYPES[call] ?? {};
  const out: Array<{ type: SettlementEventType; log: DecodedLog | null }> = [];
  for (const l of logs) {
    if (appealClosed) {
      if (l.eventName === 'AppealClosed') out.push({ type: 'appeal.decided', log: l });
      else if (l.eventName === 'KeyReleased') out.push({ type: 'key.released', log: l });
      continue;
    }
    const type = table[l.eventName];
    if (type) out.push({ type, log: l });
  }
  return out;
}

/** The messages a contract call carries, for the events it makes. */
interface CallContext {
  /** The seller-signed delivery that lands on chain with this call (deliver, or carried by a decision or early accept). */
  delivery?: Delivery;
  decision?: Decision;
  appeal?: Appeal;
  operatorFee?: { from: string; to: string; amount: TokenAmount };
}

/** A decision's `decidedBy` payload, as SimChain writes it. */
const decidedBy = (m: Decision) => ({
  role: m.role,
  outcome: m.outcome,
  recordHash: m.judgmentRecordHash,
  ...(m.role === 'primary' ? { seedSource: 'commit-reveal' } : { seedSource: 'beacon', beaconRound: m.beacon?.round }),
});

export class EvmSettlement implements Settlement {
  readonly kind: 'local' | 'testnet';
  readonly domain;
  readonly token: string;
  private readonly books = new Map<Hex32, Book>();
  private readonly nonces = new Set<string>();
  private readonly spent = new Map<string, bigint>();
  private readonly mandates = new Map<string, Mandate>();
  private readonly log_: SettlementEvent[] = [];
  /** Which events came from chain logs (the rest are the adapter's pre-funding and custody records). */
  private readonly onChain = new Set<number>();
  private readonly txs: TxRecord[] = [];
  private readonly idempotency = new Map<string, { body: Hex32; result: Extract<SubmitResult, { ok: true }> }>();
  private readonly abi: Abi;
  /** Per-commitment queues: one call at a time per commitment, so each simulates against its predecessor's state. */
  private readonly lanes = new Map<string, Promise<unknown>>();
  private clockMs: number;
  private domainSeparator: Hex32 | null = null;
  private readonly pools = new Map<string, { bond: bigint; free: bigint }>();
  private readonly balanceCache = new Map<string, { at: number; value: bigint }>();
  private dirty = new Set<Hex32>();
  private drained = 0;
  private admitted: Mandate[] = [];

  private constructor(
    readonly world: EvmChain,
    readonly genesis: Genesis,
    /** The wall clock for a live chain (ms); absent on anvil, where the scenario clock moves only when told. */
    private readonly wall?: () => number,
  ) {
    assertSafeChain(world.chainId);
    this.kind = world.clock === 'wall' ? 'testnet' : 'local';
    const start = Date.parse(genesis.start);
    if (!Number.isFinite(start) || start % 1000 !== 0) throw new RangeError(`genesis start ${genesis.start} must be a whole-second timestamp`);
    this.clockMs = start;
    this.domain = holdbackDomain(world.chainId, world.deployment.rules);
    this.token = lc(world.deployment.token);
    if (lc(genesis.token) !== this.token) throw new RangeError(`genesis token ${genesis.token} is not the deployed token ${this.token} (ADR-0025: token identifiers are addresses)`);
    if (genesis.chainId !== world.chainId) throw new RangeError(`genesis chain id ${genesis.chainId} is not ${world.chainId}`);
    for (const m of genesis.mandates) this.mandates.set(`${lc(m.agent)}|${m.clubId}`, m);
    const { abis } = world;
    this.abi = [...abis.rules, ...abis.bonds, ...abis.escrow, ...abis.collector, ...abis.token, ...abis.multicall] as Abi;
  }

  /**
   * A settlement on a fresh copy of the anvil world (reverted to just after deployment): token balances minted, bonds
   * deposited into HoldbackBonds by each adjudicator, and every party's one-time allowance to HoldbackBonds for
   * appeal bonds. Setup is test-only (anvil impersonation) and never counts toward gas per deal.
   */
  static async create(world: EvmWorld, genesis: Genesis, gasFor: readonly Address[] = []): Promise<EvmSettlement> {
    await world.fresh(genesis.simSeed);
    const s = new EvmSettlement(world, genesis);
    for (const m of genesis.mandates) {
      if (!(await verifyMessage(s.domain, { ...m, type: 'Mandate' }, m.principal))) throw new Error(`the mandate for ${m.agent} is not signed by ${m.principal}`);
    }
    await s.setup(world, gasFor);
    return s;
  }

  /**
   * A settlement on a live chain whose time is the wall clock (kind 'testnet'), rebuilt from what a store saved:
   * the books, the event log and the admitted mandates. Nothing is sent: the chain already holds what was mined.
   */
  static async restore(chain: EvmChain, genesis: Genesis, saved: EvmSaved = { books: [], events: [], mandates: [] }, wall: () => number = Date.now): Promise<EvmSettlement> {
    if (chain.clock !== 'wall') throw new RangeError('restore is for a live chain; an anvil world starts fresh with create');
    const s = new EvmSettlement(chain, genesis, wall);
    for (const m of genesis.mandates) {
      if (!(await verifyMessage(s.domain, { ...m, type: 'Mandate' }, m.principal))) throw new Error(`the mandate for ${m.agent} is not signed by ${m.principal}`);
    }
    // Saved mandates were checked when admitted; a restart does not pay a signature recovery for each again.
    for (const m of saved.mandates) s.mandates.set(`${lc(m.agent)}|${m.clubId}`, m);
    for (const [id, b] of saved.books) {
      s.books.set(id, structuredClone(b) as Book);
      for (const n of b.nonces) s.nonces.add(n);
      if (b.spent) s.spent.set(b.spent.day, (s.spent.get(b.spent.day) ?? 0n) + BigInt(b.spent.amount));
    }
    for (const e of saved.events) {
      if (e.seq !== s.log_.length) throw new Error(`saved event ${e.seq} is out of order (expected ${s.log_.length})`);
      s.log_.push(e);
      if (typeof e.payload['tx'] === 'string') s.onChain.add(e.seq);
    }
    s.drained = s.log_.length;
    return s;
  }

  private async setup(world: EvmWorld, gasFor: readonly Address[]): Promise<void> {
    const { token, bonds } = world.deployment;
    const parties = Object.keys(this.genesis.balances) as Address[];
    const adjudicators = Object.keys(this.genesis.bonds) as Address[];
    const everyone = [...new Set([...parties, ...adjudicators, ...gasFor].map(lc))] as Address[];
    for (const a of everyone) await world.rpc('anvil_setBalance', [a, toHex(10n ** 21n)]);
    const send = async (from: Address, to: Address, data: Hex) => {
      await world.rpc('anvil_impersonateAccount', [from]);
      await world.rpc('evm_setNextBlockTimestamp', [secs(this.genesis.start)]);
      const hash = await world.rpc<Hex>('eth_sendTransaction', [{ from, to, data, gas: toHex(3_000_000n) }]);
      const r = await world.publicClient.waitForTransactionReceipt({ hash });
      await world.rpc('anvil_stopImpersonatingAccount', [from]);
      if (r.status !== 'success') throw new Error(`setup transaction ${hash} reverted`);
    };
    const mint = (to: Address, amount: bigint) => send(to, token, encodeFunctionData({ abi: world.abis.token, functionName: 'mint', args: [to, amount] }));
    for (const [a, v] of Object.entries(this.genesis.balances)) if (BigInt(v) > 0n) await mint(a as Address, BigInt(v));
    for (const [a, b] of Object.entries(this.genesis.bonds)) {
      if (BigInt(b.senior) !== 0n) throw new RangeError('senior (backer) bond is Phase 4; HoldbackBonds takes the adjudicator’s own bond only');
      const amount = BigInt(b.junior);
      if (amount === 0n) continue;
      await mint(a as Address, amount);
      await send(a as Address, token, encodeFunctionData({ abi: world.abis.token, functionName: 'approve', args: [bonds, amount] }));
      await send(a as Address, bonds, encodeFunctionData({ abi: world.abis.bonds, functionName: 'deposit', args: [token, amount] }));
    }
    for (const a of parties) await send(a, token, encodeFunctionData({ abi: world.abis.token, functionName: 'approve', args: [bonds, 2n ** 256n - 1n] }));
  }

  // Clock and beacon

  now(): Timestamp {
    return toTimestamp(this.wall ? Math.floor(this.wall() / 1000) * 1000 : this.clockMs);
  }

  /** Moves the scenario clock (anvil). A live chain keeps the wall clock, so there is nothing to move. */
  advance(seconds: number): void {
    if (this.wall) throw new RangeError('a live chain keeps the wall clock; it cannot be advanced');
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new RangeError(`advance takes whole non-negative seconds, got ${seconds}`);
    this.clockMs += seconds * 1000;
  }

  advanceTo(ts: Timestamp): void {
    if (this.wall) return;
    const target = Math.ceil(Date.parse(ts) / 1000) * 1000;
    if (target > this.clockMs) this.clockMs = target;
  }

  /** The sim beacon (same values as SimChain's); the rules contract asks the deployed SimBeacon for the same value. */
  beacon(round: number): Hex32 | null {
    if (!Number.isSafeInteger(round) || round < 0 || round > Math.floor(Date.parse(this.now()) / 1000)) return null;
    return keccak256(encodePacked(['bytes32', 'uint64'], [this.genesis.simSeed, BigInt(round)]));
  }

  // Reads

  escrowState(id: Hex32): EscrowState | null {
    return this.books.get(id)?.state ?? null;
  }

  log(): SettlementEvent[] {
    return [...this.log_];
  }

  /** Every mined transaction of this settlement since it started (setup excluded). */
  transactions(): TxRecord[] {
    return [...this.txs];
  }

  /** Mandates from genesis and every one admitted since (the faucet's), as SimChain's agentMandates. */
  agentMandates(): Mandate[] {
    return [...this.mandates.values()];
  }

  /**
   * Admits a mandate its principal signed under this settlement's domain, as SimChain.admit does. The scope checks
   * read it at offer and agree; on chain nothing changes (mandates are an adapter-side check, T-205 decision 1).
   */
  async admit(m: Mandate): Promise<Problem | null> {
    if (!this.genesis.clubs.some((c) => c.id === m.clubId)) return problem('rulebook_unknown', `no club ${m.clubId}`);
    if (!(await verifyMessage(this.domain, { ...m, type: 'Mandate' }, m.principal))) return problem('invalid_signature', `the mandate for ${m.agent} is not signed by ${m.principal}`);
    this.mandates.set(`${lc(m.agent)}|${m.clubId}`, m);
    this.admitted.push(m);
    return null;
  }

  async stage(id: Hex32): Promise<{ stage: (typeof STAGES)[number]; appeal: number }> {
    const d = (await this.world.publicClient.readContract({ address: this.world.deployment.rules, abi: this.world.abis.rules, functionName: 'dealOf', args: [id] })) as { stage: number; appeal: number };
    return { stage: STAGES[d.stage]!, appeal: d.appeal };
  }

  private async read<T>(address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<T> {
    return (await this.world.publicClient.readContract({ address, abi, functionName, args })) as T;
  }

  /** A token balance. On a live chain reads are reused for a few seconds unless `fresh`; a check that gates a step is fresh. */
  async tokenBalance(a: Address, fresh = false): Promise<bigint> {
    if (!this.wall) return this.read<bigint>(this.world.deployment.token, this.world.abis.token, 'balanceOf', [getAddress(a)]);
    const hit = this.balanceCache.get(lc(a));
    const now = this.wall();
    if (hit && !fresh && now - hit.at < BALANCE_TTL_MS) return hit.value;
    const value = await this.read<bigint>(this.world.deployment.token, this.world.abis.token, 'balanceOf', [getAddress(a)]);
    this.balanceCache.set(lc(a), { at: now, value });
    return value;
  }

  /** Drops cached balances: a transfer this adapter did not send (the faucet's mint) moved them. */
  forgetBalances(addresses?: readonly Address[]): void {
    if (!addresses) return this.balanceCache.clear();
    for (const a of addresses) this.balanceCache.delete(lc(a));
  }

  async bondOf(a: Address): Promise<bigint> {
    const { bonds, token } = this.world.deployment;
    return this.read<bigint>(bonds, this.world.abis.bonds, 'bondOf', [getAddress(a), token]);
  }

  async freeBond(a: Address): Promise<bigint> {
    const { bonds, token } = this.world.deployment;
    return this.read<bigint>(bonds, this.world.abis.bonds, 'freeOf', [getAddress(a), token]);
  }

  /** Reads each adjudicator's bond and free bond from chain into the cache `pool` serves. */
  async refreshPools(adjudicators: readonly Address[]): Promise<void> {
    for (const a of adjudicators) this.pools.set(lc(a), { bond: await this.bondOf(a), free: await this.freeBond(a) });
  }

  /**
   * An adjudicator's pool as SimChain shapes it, from the last `refreshPools`: junior is its own bond in
   * HoldbackBonds, reserved what the contract has encumbered. Backers (senior) are Phase 4.
   */
  pool(adjudicator: Address): { junior: bigint; senior: bigint; reserved: bigint } {
    const p = this.pools.get(lc(adjudicator)) ?? { bond: 0n, free: 0n };
    return { junior: p.bond, senior: 0n, reserved: p.bond - p.free };
  }

  /** Token balance plus own bond, per address; what CPP holds for this operator; appeal bonds held. */
  async holdings(addresses: readonly Address[], ids: readonly Hex32[]): Promise<{ parties: Record<string, bigint>; escrow: bigint; appealHold: bigint }> {
    const { escrow, rules, bonds } = this.world.deployment;
    const parties: Record<string, bigint> = {};
    for (const a of addresses) parties[lc(a)] = (await this.tokenBalance(a)) + (await this.bondOf(a));
    const store = await this.read<Address>(escrow, this.world.abis.escrow, 'getTokenStore', [rules]);
    let appealHold = 0n;
    for (const id of ids) {
      const b = await this.read<readonly [Address, bigint]>(bonds, this.world.abis.bonds, 'appealBondOf', [id]);
      appealHold += BigInt(b[1]);
    }
    return { parties, escrow: await this.tokenBalance(store), appealHold };
  }

  /** What CPP still holds for one commitment (capturable amount); 0 for an unknown or never-funded one. */
  async heldFor(id: Hex32): Promise<bigint> {
    const book = this.books.get(id);
    if (!book) return 0n;
    const pi = paymentInfo(termsView(book.state.terms), this.world.deployment.rules, id, this.world.expiryMargin);
    const hash = paymentHash(pi, this.world.chainId, this.world.deployment.escrow);
    const s = await this.read<readonly [boolean, bigint, bigint]>(this.world.deployment.escrow, this.world.abis.escrow, 'paymentState', [hash]);
    return BigInt(s[1]);
  }

  /** A commitment's settledAt and finalAt from its book alone (no chain read), for counting deals. */
  finality(id: Hex32): { settledAt: Timestamp | null; finalAt: Timestamp | null } | null {
    const b = this.books.get(id);
    if (!b) return null;
    const s = b.state;
    return { settledAt: s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? s.settledAt : null, finalAt: this.finalAt(b) };
  }

  async state(id: Hex32): Promise<CommitmentStateView | null> {
    const b = this.books.get(id);
    return b ? this.view(id, b) : null;
  }

  async *events(fromSeq = 0): AsyncIterable<SettlementEvent> {
    for (const e of this.log_.slice(fromSeq)) yield e;
  }

  async balances(addresses: readonly Address[]): Promise<Record<Address, TokenAmount>> {
    const out: Record<Address, TokenAmount> = {};
    for (const a of addresses) out[a] = { token: this.token, amount: (await this.tokenBalance(a)).toString() as TokenAmount['amount'] };
    return out;
  }

  async keysFor(id: Hex32, recipient: Address): Promise<EncryptedKey[]> {
    return (this.books.get(id)?.released ?? []).filter((k) => lc(k.recipient) === lc(recipient));
  }

  /**
   * Commitments an adjudicator still has a turn on, within its window: offers to accept, deliveries to judge,
   * takeovers and escalations to decide, open appeals. A live world paces its adjudicator passes by it.
   */
  awaitingAdjudicator(): number {
    const now = Date.parse(this.now());
    const within = (ts: Timestamp) => now < Date.parse(ts) + 60_000;
    let n = 0;
    for (const { state: s } of this.books.values()) {
      const t = s.terms.timing;
      if (s.kind === 'Offered' && within(t.offerExpiresAt)) n++;
      else if ((s.kind === 'Delivered' || s.kind === 'FallbackJudging') && within(t.fallbackBy)) n++;
      else if (s.kind === 'Escalated' && within(s.escalation.appealDecideBy)) n++;
      else if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && within(s.via.appeal.appealDecideBy)) n++;
    }
    return n;
  }

  /** The books, events and mandates that changed since the last call, for a store to write. */
  drain(): EvmChanges {
    const books = [...this.dirty].map((id) => [id, structuredClone(this.books.get(id)!)] as [Hex32, Book]);
    const out = { books, events: this.log_.slice(this.drained), mandates: this.admitted };
    this.dirty = new Set();
    this.drained = this.log_.length;
    this.admitted = [];
    return out;
  }

  // Funding digests (ADR-0025)

  private async separator(): Promise<Hex32> {
    this.domainSeparator ??= await this.read<Hex32>(this.world.deployment.token, this.world.abis.token, 'DOMAIN_SEPARATOR', []);
    return this.domainSeparator;
  }

  /**
   * What the buyer signs to fund on EVM (ADR-0025, Proposed): ERC-3009 ReceiveWithAuthorization to CPP's collector
   * for price + fee, valid from the epoch until fundBy, with the payer-agnostic PaymentInfo hash as nonce. The
   * FundingAuthorization carries this signature (scheme erc3009) with these values in its fields.
   */
  async fundingAuthorization(terms: AnyCommitmentTerms): Promise<{ digest: Hex32; nonce: Hex32; value: bigint; validAfter: Timestamp; validBefore: Timestamp; to: Address }> {
    const t = termsView(terms);
    const id = commitmentIdOf(terms);
    const pi = paymentInfo(t, this.world.deployment.rules, id, this.world.expiryMargin);
    const nonce = payerAgnosticHash(pi, this.world.chainId, this.world.deployment.escrow);
    const to = this.world.deployment.erc3009Collector;
    const auth = { from: t.buyer, to, value: pi.maxAmount, validAfter: 0n, validBefore: BigInt(pi.preApprovalExpiry), nonce };
    return { digest: receiveDigest(await this.separator(), auth), nonce, value: pi.maxAmount, validAfter: '1970-01-01T00:00:00Z', validBefore: terms.timing.fundBy, to: getAddress(to) };
  }

  /** The token's EIP-712 domain, which ERC-3009 authorizations are signed under. */
  tokenDomain(): Erc3009TypedData['domain'] {
    return { ...this.world.tokenDomain, chainId: this.world.chainId, verifyingContract: getAddress(this.world.deployment.token) };
  }

  /**
   * The funding as typed data for the buyer to sign (ADR-0025): ReceiveWithAuthorization under the token's domain, its
   * digest, and the nonce and validAfter the FundingAuthorization body carries. Computed from the terms alone.
   */
  fundingTypedData(terms: AnyCommitmentTerms): { typedData: Erc3009TypedData; digest: Hex32; nonce: Hex32; validAfter: Timestamp } {
    const t = termsView(terms);
    const pi = paymentInfo(t, this.world.deployment.rules, commitmentIdOf(terms), this.world.expiryMargin);
    const nonce = payerAgnosticHash(pi, this.world.chainId, this.world.deployment.escrow);
    const message = { from: t.buyer, to: getAddress(this.world.deployment.erc3009Collector), value: pi.maxAmount.toString(), validAfter: '0', validBefore: String(pi.preApprovalExpiry), nonce };
    return { ...erc3009Typed('ReceiveWithAuthorization', this.tokenDomain(), message), nonce, validAfter: '1970-01-01T00:00:00Z' };
  }

  /** The operator fee as typed data: TransferWithAuthorization under the token's domain, nonce bound to the commitment. */
  operatorFeeTypedData(o: { commitmentId: Hex32; from: Address; to: Address; value: string; validAfter: Timestamp; validBefore: Timestamp }): { typedData: Erc3009TypedData; digest: Hex32; nonce: Hex32 } {
    const nonce = operatorFeeNonce(o.commitmentId);
    const message = { from: getAddress(o.from), to: getAddress(o.to), value: BigInt(o.value).toString(), validAfter: String(secs(o.validAfter)), validBefore: String(secs(o.validBefore)), nonce };
    return { ...erc3009Typed('TransferWithAuthorization', this.tokenDomain(), message), nonce };
  }

  /** What the buyer signs for the operator fee: ERC-3009 TransferWithAuthorization, nonce bound to the commitment. */
  async operatorFeeAuthorization(commitmentId: Hex32, from: Address, to: Address, value: bigint, validAfter: Timestamp, validBefore: Timestamp): Promise<{ digest: Hex32; nonce: Hex32 }> {
    const nonce = operatorFeeNonce(commitmentId);
    const digest = transferDigest(await this.separator(), { from: getAddress(from), to: getAddress(to), value, validAfter: BigInt(secs(validAfter)), validBefore: BigInt(secs(validBefore)), nonce });
    return { digest, nonce };
  }

  // Submission

  submit(submission: Submission, options: EvmSubmitOptions = {}): Promise<SubmitResult> {
    return this.enqueue(laneOf(submission), () => this.process(submission, options, false));
  }

  validate(submission: DryRunSubmission): Promise<SubmitResult> {
    return this.enqueue(laneOf(submission as Submission), () => this.process(submission as Submission, {}, true));
  }

  trigger(commitmentId: Hex32, timeout: TimeoutKind, options: EvmSubmitOptions = {}): Promise<SubmitResult> {
    return this.submit({ kind: 'trigger', commitmentId, timeout }, options);
  }

  /**
   * One call at a time per commitment. Anvil runs every call in one lane, so a scenario's order is the order of its
   * steps; on a live chain different commitments wait for their own receipts side by side.
   */
  private enqueue(lane: string, f: () => Promise<SubmitResult>): Promise<SubmitResult> {
    const key = this.wall ? lane : '';
    const prev = this.lanes.get(key) ?? Promise.resolve();
    const next = prev.then(f, f);
    const settled = next.catch(() => undefined);
    this.lanes.set(key, settled);
    void settled.then(() => {
      if (this.lanes.get(key) === settled) this.lanes.delete(key);
    });
    return next;
  }

  private async process(s: Submission, options: EvmSubmitOptions, dryRun: boolean): Promise<SubmitResult> {
    const key = dryRun ? undefined : options.idempotencyKey;
    const body = canonicalKeccak(toJson(s));
    if (key !== undefined) {
      const seen = this.idempotency.get(key);
      if (seen) return seen.body === body ? { ...structuredClone(seen.result), replayed: true } : { ok: false, problem: problem('idempotency_conflict', `idempotency key ${key} was used with another body`) };
    }
    const before = this.log_.length;
    let id: Hex32;
    try {
      id = await this.apply(s, options, dryRun);
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, problem: e.problem };
      throw e;
    }
    const book = this.books.get(id)!;
    const events = this.log_.slice(before);
    if (events.length) {
      book.lastEventSeq = events.at(-1)!.seq;
      book.updatedAt = this.now();
      this.dirty.add(id);
    }
    const state = await this.view(id, book);
    const signatureCheck = s.kind === 'trigger' ? 'none' : 'verified';
    const result: Extract<SubmitResult, { ok: true }> = { ok: true, commitmentId: id, state, events, replayed: false, dryRun, signatureCheck };
    if (key !== undefined) this.idempotency.set(key, { body, result: structuredClone(result) });
    return result;
  }

  private emit(type: SettlementEventType, id: Hex32, actor: Address | 'anyone', via: string, payload: Record<string, unknown>, onChain: boolean, at: Timestamp = this.now()): void {
    const prev = this.log_.at(-1);
    const body = { seq: (prev?.seq ?? -1) + 1, type, commitmentId: id, at, actor, submittedVia: via, payload: toJson(payload) as Record<string, unknown>, prevHash: prev?.hash ?? GENESIS_HASH };
    const event = { ...body, hash: canonicalKeccak(body) } as SettlementEvent;
    this.log_.push(event);
    if (onChain) this.onChain.add(event.seq);
  }

  private bookOf(id: Hex32): Book {
    return this.books.get(id) ?? refuse('not_found', `no commitment ${id}`);
  }

  private async check(m: SignableMessage, signer: Address, what: string): Promise<void> {
    if (!(await verifyMessage(this.domain, m, signer))) refuse('invalid_signature', `${what} signature does not recover to ${signer}`);
  }

  private stepped(state: EscrowState, e: EscrowEvent): EscrowState {
    const r = step(state, e);
    return r.ok ? r.value : refuse(r.error.type, r.error.detail);
  }

  private amount(v: bigint): TokenAmount {
    return { token: this.token, amount: v.toString() as TokenAmount['amount'] };
  }

  private scopeFor(agent: Address, clubId: string, terms: AnyCommitmentTerms, club: Club | undefined): Scope {
    const m = this.mandates.get(`${lc(agent)}|${clubId}`);
    if (m) return m.scope;
    if (terms.disclosure.level !== 'public' && club?.rulebook.identityModes.includes('pseudonymous')) {
      return { roles: ['buyer', 'seller'], maxPerCommitment: terms.price, maxDaily: { token: terms.price.token, amount: UINT256_MAX } as TokenAmount, expiresAt: '9999-12-31T23:59:59Z' };
    }
    return refuse('scope_exceeded', `${agent} has no mandate in club ${clubId}`);
  }

  private isMember(club: Club, agent: Address, terms: AnyCommitmentTerms): boolean {
    if (club.rulebook.open) return true;
    if (!this.mandates.has(`${lc(agent)}|${club.id}`) && terms.disclosure.level !== 'public' && club.rulebook.identityModes.includes('pseudonymous')) return true;
    const principal = this.mandates.get(`${lc(agent)}|${club.id}`)?.principal;
    return this.genesis.members.some((m) => m.clubId === club.id && (lc(m.member) === lc(agent) || (principal !== undefined && lc(m.member) === lc(principal))));
  }

  private useNonce(book: Book | null, key: string, dryRun: boolean): void {
    if (this.nonces.has(key)) refuse('nonce_reused', `nonce ${key} was used before`);
    if (dryRun) return;
    this.nonces.add(key);
    book?.nonces.push(key);
  }

  private async apply(s: Submission, options: EvmSubmitOptions, dryRun: boolean): Promise<Hex32> {
    const at = this.now();
    const via = options.via ?? 'direct';
    switch (s.kind) {
      // Pre-funding: signatures collected by the adapter, checked on chain at agreeAndFund
      case 'offer': {
        const c = s.commitment;
        const t = termsOf(c);
        if (!(await verifyTerms(this.domain, t, c.signatures.seller, t.seller))) refuse('invalid_signature', 'the seller did not sign these terms');
        if (this.books.has(c.id)) refuse('invalid_state', `commitment ${c.id} was already offered`);
        const club = this.genesis.clubs.find((k) => k.id === t.clubId && k.rulebookHash === t.rulebookHash);
        const sellerScope = this.scopeFor(t.seller, t.clubId, t, club);
        const nonce = `${lc(t.seller)}:terms:${t.nonce}`;
        const r = offer({ commitment: c, at, sellerScope, rulebook: club?.rulebook ?? null, nonceUsed: this.nonces.has(nonce) });
        if (!r.ok) return refuse(r.error.type, r.error.detail);
        // The contract can represent these terms only if the token is an address (ADR-0025).
        termsView(t);
        if (dryRun) return c.id;
        const book: Book = { state: r.value, club: club!, sellerSignature: c.signatures.seller as Hex, held: [], released: [], nonces: [], lastEventSeq: 0, updatedAt: at };
        this.useNonce(book, nonce, false);
        this.books.set(c.id, book);
        this.emit('commitment.offered', c.id, t.seller, via, { source: 'adapter', termsHash: c.id, terms: t, sellerSignature: c.signatures.seller }, false);
        return c.id;
      }
      case 'adjudicator_accept': {
        const m = s.message;
        await this.check(m, m.adjudicator, 'AdjudicatorAcceptance');
        const book = this.bookOf(m.commitmentId);
        this.useNonce(book, `${lc(m.adjudicator)}:${m.nonce}`, true);
        // A read, not a reservation: on chain the bond is encumbered at agreeAndFund (T-202 rule 2).
        const free = await this.freeBond(m.adjudicator);
        const next = this.stepped(book.state, { type: 'adjudicator_accept', at, message: m, unencumberedBond: this.amount(free) });
        const required = mulBps(next.terms.price, ALL_BPS, 'ceil');
        if (!required.ok) return refuse('invalid_terms', required.error.kind);
        if (free < BigInt(required.value.amount)) refuse('coverage_exceeded', `free bond ${free} is below ${required.value.amount}`);
        if (dryRun) return m.commitmentId;
        this.useNonce(book, `${lc(m.adjudicator)}:${m.nonce}`, false);
        book.state = next;
        book.acceptance = m;
        this.emit('adjudicator.accepted', m.commitmentId, m.adjudicator, via, { source: 'adapter', seedCommitment: m.seedCommitment, bondRequired: required.value, freeBond: this.amount(free) }, false);
        return m.commitmentId;
      }
      case 'agree':
        await this.check(s.message, s.message.buyer, 'Agree');
        return this.agree(s.message, via, dryRun).id;
      case 'fund':
        // On EVM the signature is the ERC-3009 one (ADR-0025); the token checks it inside agreeAndFund.
        if (dryRun) return s.message.commitmentId;
        return this.fund(s.message, null, options);
      case 'agree_and_fund': {
        if (s.agree.commitmentId !== s.funding.commitmentId) refuse('invalid_terms', 'agreement and funding name different commitments');
        if (s.operatorFee && s.operatorFee.commitmentId !== s.agree.commitmentId) refuse('invalid_terms', 'the operator fee names another commitment');
        await this.check(s.agree, s.agree.buyer, 'Agree');
        const { undo } = this.agree(s.agree, via, dryRun);
        if (dryRun) return s.agree.commitmentId;
        try {
          return await this.fund(s.funding, s.operatorFee ?? null, options);
        } catch (e) {
          undo();
          throw e;
        }
      }
      // On chain
      case 'deliver': {
        const d = s.delivery;
        const book = this.bookOf(d.commitmentId);
        // As core refuses it: the contract's generic InvalidMessage would name the wrong problem.
        if (d.attempt > book.state.terms.timing.maxSubmissions) refuse('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${book.state.terms.timing.maxSubmissions}`);
        const t = termsView(book.state.terms);
        await this.call(d.commitmentId, 'deliver', [t, deliveryView(d), d.signature], (at) => [{ type: 'deliver', at, delivery: d }], options, dryRun, book.state.terms.seller, { delivery: d });
        return d.commitmentId;
      }
      case 'early_accept': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const carry = this.carrying(book);
        const d = carry ?? book.delivery ?? refuse('invalid_state', 'no delivery was relayed through this adapter; the early accept carries it on chain');
        const proof = keyProof(d, book.state.terms.buyer) ?? NO_KEY;
        const mirror = (at: Timestamp): EscrowEvent[] => [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'early_accept', at, message: m }];
        await this.call(m.commitmentId, 'earlyAccept', [termsView(book.state.terms), earlyAcceptView(m), deliveryView(d), d.signature, proof], mirror, options, dryRun, m.buyer, carry ? { delivery: carry } : {});
        return m.commitmentId;
      }
      case 'decide': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const carry = this.carrying(book);
        const d = carry ?? book.delivery;
        const beacon = m.role === 'primary' || !m.beacon ? null : { round: m.beacon.round, value: m.beacon.value };
        const mirror = (at: Timestamp): EscrowEvent[] => [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'decide', at, message: m, beacon }];
        await this.call(m.commitmentId, 'decide', [termsView(book.state.terms), decisionView(m), d ? deliveryView(d) : NO_DELIVERY, d?.signature ?? '0x'], mirror, options, dryRun, m.adjudicator, { decision: m, ...(carry ? { delivery: carry } : {}) });
        return m.commitmentId;
      }
      case 'appeal': {
        const p = s.appeal;
        const book = this.bookOf(p.commitmentId);
        // The contract does not check the bond against the rulebook rate or collect the appeal fee (T-202 rule 9).
        const zero = this.amount(0n);
        await this.call(p.commitmentId, 'fileAppeal', [termsView(book.state.terms), appealView(p)], (at) => [{ type: 'file_appeal', at, appeal: p, requiredBond: p.bond, requiredFee: zero, feePaid: zero }], options, dryRun, p.appellantAddress, { appeal: p });
        return p.commitmentId;
      }
      case 'mutual_settle': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const t = book.state.terms;
        if (!(await verifyMutualSettlement(this.domain, m, t.buyer, t.seller))) refuse('invalid_signature', 'the settlement is not signed by both the buyer and the seller');
        const d = book.delivery;
        const proof = m.releaseKey && d ? (keyProof(d, t.buyer) ?? NO_KEY) : NO_KEY;
        await this.call(m.commitmentId, 'mutualSettle', [termsView(t), mutualView(m), m.releaseKey && d ? deliveryView(d) : NO_DELIVERY, proof], (at) => [{ type: 'mutual_settle', at, message: m, rule: { allowed: true, payoutsTo: 'any' } }], options, dryRun, 'anyone');
        return m.commitmentId;
      }
      case 'trigger':
        return this.timeout(s.commitmentId, s.timeout, options, dryRun, at);
    }
  }

  /**
   * D4's two-transaction happy path: the relayer keeps the seller-signed delivery off chain and the next decision or
   * early accept carries it (T-202 decision 1). Nothing is sent; a reclaim stays possible until it lands. A seller who
   * wants to stop a reclaim submits `deliver` instead.
   */
  async carryDelivery(d: Delivery): Promise<Problem | null> {
    const book = this.books.get(d.commitmentId);
    if (!book) return problem('not_found', `no commitment ${d.commitmentId}`);
    if (book.state.kind !== 'Held') return problem('invalid_state', `a carried delivery needs a held commitment; it is ${book.state.kind}`);
    if (!(await verifyMessage(this.domain, { ...d, type: 'Delivery' }, book.state.terms.seller))) return problem('invalid_signature', 'the delivery is not signed by the seller');
    book.carried = d;
    this.dirty.add(d.commitmentId);
    return null;
  }

  private carrying(book: Book): Delivery | undefined {
    return book.state.kind === 'Held' ? book.carried : undefined;
  }

  private agree(m: Agree, via: string, dryRun: boolean): { id: Hex32; undo: () => void } {
    const book = this.bookOf(m.commitmentId);
    const { terms } = book.state;
    const nonce = `${lc(m.buyer)}:${m.nonce}`;
    this.useNonce(book, nonce, true);
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId, terms, book.club);
    const day = `${lc(terms.buyer)}|${this.now().slice(0, 10)}`;
    const spent = this.spent.get(day) ?? 0n;
    const next = this.stepped(book.state, { type: 'agree', at: this.now(), message: m, buyerScope, spentToday: this.amount(spent), memberAdmitted: this.isMember(book.club, terms.buyer, terms) });
    if (dryRun) return { id: m.commitmentId, undo: () => undefined };
    const prev = book.state;
    const seq = this.log_.length;
    this.useNonce(book, nonce, false);
    book.state = next;
    book.agree = m;
    book.spent = { day, amount: terms.price.amount };
    this.spent.set(day, spent + BigInt(terms.price.amount));
    this.emit('commitment.agreed', m.commitmentId, m.buyer, via, { source: 'adapter', termsHash: m.commitmentId }, false);
    return {
      id: m.commitmentId,
      undo: () => {
        book.state = prev;
        delete book.agree;
        delete book.spent;
        this.nonces.delete(nonce);
        book.nonces = book.nonces.filter((n) => n !== nonce);
        this.spent.set(day, spent);
        this.log_.splice(seq);
      },
    };
  }

  /** Transaction 1 (D4): agreeAndFund, or the operator-fee bundle (ADR-0023): fee transfer + agreeAndFund, atomic. */
  private async fund(m: Extract<Submission, { kind: 'fund' }>['message'], fee: TransferAuthorization | null, options: EvmSubmitOptions): Promise<Hex32> {
    const book = this.bookOf(m.commitmentId);
    if (book.state.kind !== 'Agreed' || !book.acceptance || !book.agree) return refuse(book.state.kind === 'Offered' ? 'acceptance_missing' : 'invalid_state', `funding needs an agreed commitment; it is ${book.state.kind}`);
    const terms = book.state.terms;
    const t = termsView(terms);
    const expected = await this.fundingAuthorization(terms);
    if (lc(m.token) !== this.token || BigInt(m.value) !== expected.value || m.nonce !== expected.nonce || m.scheme !== 'erc3009') {
      refuse('invalid_terms', 'on EVM the funding is an ERC-3009 authorization of price + fee to the CPP collector, nonce = the payer-agnostic PaymentInfo hash (ADR-0025)');
    }
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId, terms, book.club);
    const balance = await this.tokenBalance(terms.buyer, true);
    const args = [t, book.sellerSignature, acceptanceView(book.acceptance), agreeView(book.agree), { method: 0, signature: m.signature }];
    const mirror = (at: Timestamp): EscrowEvent[] => [{ type: 'fund', at, message: m, buyerScope, balance: this.amount(balance), gasBuffer: this.amount(0n) }];
    if (!fee) {
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options, false, m.from);
      return m.commitmentId;
    }
    if (lc(fee.from) !== lc(terms.buyer)) refuse('invalid_terms', `the operator fee must come from the buyer ${terms.buyer}`);
    if (lc(fee.token) !== this.token) refuse('invalid_terms', `the operator fee is in ${fee.token}, not the price token`);
    if (lc(fee.to) === lc(fee.from)) refuse('invalid_terms', 'the operator fee pays its own payer');
    if (fee.nonce !== operatorFeeNonce(m.commitmentId)) refuse('invalid_terms', 'the operator fee nonce must be keccak256(abi.encode(commitmentId, "operator_fee"))');
    const { token, rules, multicall } = this.world.deployment;
    const feeCall = encodeFunctionData({
      abi: this.world.abis.token,
      functionName: 'transferWithAuthorization',
      args: [getAddress(fee.from), getAddress(fee.to), BigInt(fee.value), BigInt(secs(fee.validAfter)), BigInt(secs(fee.validBefore)), fee.nonce, fee.signature],
    });
    // ADR-0023 (EVM amendment): anyone may relay the fee transfer alone, ahead of the bundle. The fee has then reached
    // this operator already, and the bundle would revert on the spent nonce, so the hold is funded on its own.
    if (await this.nonceUsed(m.commitmentId, token, feeCall)) {
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options, false, m.from);
      this.emit('fee.operator', m.commitmentId, m.from, options.via ?? 'direct', { source: 'adapter', from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)), paid: 'by an earlier transaction' }, false);
      return m.commitmentId;
    }
    const fundCall = encodeFunctionData({ abi: this.world.abis.rules, functionName: 'agreeAndFund', args });
    const bundle = encodeFunctionData({
      abi: this.world.abis.multicall,
      functionName: 'aggregate3',
      args: [
        [
          { target: token, allowFailure: false, callData: feeCall },
          { target: rules, allowFailure: false, callData: fundCall },
        ],
      ],
    });
    await this.send(m.commitmentId, 'agreeAndFund', multicall, bundle, mirror, options, false, m.from, { operatorFee: { from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)) } });
    return m.commitmentId;
  }

  /** True when the token refuses an ERC-3009 call because its nonce is already used. Any other answer is false. */
  private async nonceUsed(id: Hex32, token: Address, data: Hex): Promise<boolean> {
    try {
      await this.world.simulate({ from: this.world.senderFor(id), to: token, data }, this.wall ? undefined : secs(this.now()));
      return false;
    } catch (e) {
      return problemFromRevert(this.abi, revertData(e)).type === 'nonce_reused';
    }
  }

  private async timeout(id: Hex32, timeout: TimeoutKind, options: EvmSubmitOptions, dryRun: boolean, at: Timestamp): Promise<Hex32> {
    const book = this.bookOf(id);
    const t = termsView(book.state.terms);
    switch (timeout) {
      case 'expire_offer':
        await this.call(id, 'expireOffer', [t], (at) => [{ type: 'expire', at }], options, dryRun, 'anyone');
        return id;
      case 'reclaim':
        await this.call(id, 'reclaim', [t], (at) => [{ type: 'reclaim', at }], options, dryRun, 'anyone');
        return id;
      case 'fallback':
        await this.call(id, 'triggerFallback', [t], (at) => [{ type: 'trigger_fallback', at }], options, dryRun, 'anyone');
        return id;
      case 'default':
        // One call on chain (T-204 finding 2): default and apply-default, price + fee back to the buyer.
        await this.call(id, 'triggerDefault', [t], (at) => [{ type: 'trigger_default', at }, { type: 'apply_default_outcome', at }], options, dryRun, 'anyone');
        return id;
      case 'apply_default': {
        const s = book.state;
        // Already applied by triggerDefault in the same transaction; nothing to send.
        if (s.kind === 'Refunded' && s.via.kind === 'default_outcome') return id;
        return refuse('invalid_state', 'no default to apply');
      }
      case 'appeal_expiry': {
        // D20: finality is the deadline that closed the window, not the moment someone triggered the expiry.
        const s = book.state;
        let closedAt: Timestamp = at;
        if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
          const a = s.via.appeal;
          if (a.kind === 'none') closedAt = a.appealBy;
          if (a.kind === 'open') closedAt = a.appealDecideBy;
        }
        await this.call(id, 'expireAppeal', [t], (at) => [{ type: 'expire_appeal', at }], options, dryRun, 'anyone');
        if (!dryRun) book.appealClosedAt = closedAt;
        return id;
      }
      case 'settle':
        return refuse('invalid_state', 'settle applies to settle_after_window (Phase 4); guaranteed_on_decision settles at the decision');
    }
  }

  private async call(id: Hex32, fn: string, args: unknown[], mirror: (at: Timestamp) => EscrowEvent[], options: EvmSubmitOptions, dryRun: boolean, actor: Address | 'anyone', ctx: CallContext = {}): Promise<void> {
    const data = encodeFunctionData({ abi: this.world.abis.rules, functionName: fn, args });
    await this.send(id, fn, this.world.deployment.rules, data, mirror, options, dryRun, actor, ctx);
  }

  /** Steps the core mirror through what the contract accepted; a refusal there is a divergence, never a refusal. */
  private mirrored(state: EscrowState, events: readonly EscrowEvent[], fn: string): EscrowState {
    let next = state;
    for (const e of events) {
      const r = step(next, e);
      if (!r.ok) throw new Error(`EVM/core divergence: the contract accepts ${fn} but core refuses ${e.type} in ${next.kind}: ${r.error.type}: ${r.error.detail}`);
      next = r.value;
    }
    return next;
  }

  /**
   * Simulates the call; a revert is the refusal and nothing is sent. Otherwise sends it (on anvil, mined at the
   * scenario clock's second; on a live chain, whenever its block comes), steps the core mirror at the block's time,
   * checks it against the stage, and records the call's events and the envelopes it releases.
   */
  private async send(id: Hex32, fn: string, to: Address, data: Hex, mirror: (at: Timestamp) => EscrowEvent[], options: EvmSubmitOptions, dryRun: boolean, actor: Address | 'anyone', ctx: CallContext = {}): Promise<void> {
    const book = this.bookOf(id);
    const key = options.sender;
    const from = key ? privateKeyToAccount(key).address : this.world.senderFor(id);
    const at = this.now();
    const time = secs(at);
    try {
      await this.world.simulate({ from, to, data }, this.wall ? undefined : time);
    } catch (e) {
      const raw = revertData(e);
      if (raw === undefined && !/revert/i.test(String((e as Error).message))) throw e;
      throw new Refusal(problemFromRevert(this.abi, raw));
    }
    // The mirror must accept what the contract accepted; run it before sending so a divergence changes nothing.
    const before = book.state;
    const next = this.mirrored(before, mirror(at), fn);
    if (dryRun) return;
    const mined: Mined = await this.world.send({ ...(key ? { key } : { lane: id }), to, data }, this.wall ? undefined : time);
    if (mined.status !== 'success') {
      if (!this.wall) throw new Error(`${fn} reverted on chain after a passing simulation: ${mined.hash}`);
      // On a live chain the state or a deadline can move between the simulation and the block; only gas was spent.
      refuse('invalid_state', `${fn} reverted on chain in ${mined.hash} after a passing simulation (the state or a deadline moved in between); nothing changed`);
    }
    this.balanceCache.clear();
    const blockAt = toTimestamp(mined.timestamp * 1000);
    const after = blockAt === at ? next : this.mirrored(before, mirror(blockAt), fn);
    const logs = this.decode(mined.logs);
    book.state = after;
    const onChain = await this.stage(id);
    const expect = PRE_FUNDING.includes(after.kind) ? 'None' : after.kind;
    if (onChain.stage !== expect) throw new Error(`EVM/core divergence after ${fn}: the contract is ${onChain.stage}, core is ${after.kind}`);
    const via = options.via ?? 'direct';
    this.txs.push({ commitmentId: id, call: fn, hash: mined.hash, from: mined.from, via, gasUsed: mined.gasUsed, at: blockAt });
    const tx = { tx: mined.hash, block: mined.blockNumber, sender: lc(mined.from), gasUsed: mined.gasUsed };
    if (ctx.operatorFee) this.emit('fee.operator', id, actor, via, { ...ctx.operatorFee, ...tx }, true, blockAt);
    for (const { type, log } of eventTypesFor(fn, logs)) {
      if (type === 'key.released' && log) {
        const a = log.args as { recipient: Address; path: number; scheme: string; ciphertext: string };
        const envelope = { recipient: getAddress(a.recipient), scheme: a.scheme, ciphertext: a.ciphertext } as EncryptedKey;
        book.released.push(envelope);
        this.emit(type, id, actor, via, { recipient: envelope.recipient, envelope, path: KEY_PATHS[a.path] ?? String(a.path), ...tx }, true, blockAt);
      } else {
        this.emit(type, id, actor, via, { ...this.payloadOf(type, before, after, ctx), ...tx }, true, blockAt);
      }
      if (type === 'delivery.submitted' && ctx.delivery) this.landDelivery(book, ctx.delivery, id, actor, via, blockAt);
    }
    this.custody(fn, before, after, ctx, id, via, blockAt);
    if (fn === 'decide' && logs.some((l) => l.eventName === 'AppealClosed')) book.appealClosedAt = blockAt;
  }

  /** The delivery is on chain: its envelopes are held here, and the primary's is released for it to judge (ADR-0020). */
  private landDelivery(book: Book, d: Delivery, id: Hex32, actor: Address | 'anyone', via: string, at: Timestamp): void {
    book.delivery = d;
    delete book.carried;
    book.held = d.encryptedKeys.map(signedEnvelope);
    this.releaseHeld(book, id, book.state.terms.adjudication.adjudicator, actor, via, 'delivery', at);
  }

  /** Envelopes a call hands to the next adjudicator, as SimChain releases them: at takeover, escalation or appeal. */
  private custody(fn: string, before: EscrowState, after: EscrowState, ctx: CallContext, id: Hex32, via: string, at: Timestamp): void {
    const book = this.books.get(id)!;
    const a = after.terms.adjudication;
    if (fn === 'triggerFallback') this.releaseHeld(book, id, a.fallbackAdjudicator, 'anyone', via, 'fallback takeover', at);
    if (fn === 'fileAppeal' && ctx.appeal) this.releaseHeld(book, id, a.appealAdjudicator, ctx.appeal.appellantAddress, via, 'appeal', at);
    if (fn === 'decide' && after.kind === 'Escalated' && before.kind !== 'Escalated' && ctx.decision) {
      const env = (ctx.decision.encryptedKeys ?? []).find((k) => lc(k.recipient) === lc(a.appealAdjudicator));
      if (env) this.release(book, id, signedEnvelope(env), ctx.decision.adjudicator, via, 'escalation', at);
    }
  }

  private releaseHeld(book: Book, id: Hex32, recipient: Address, actor: Address | 'anyone', via: string, path: string, at: Timestamp): void {
    const env = book.held.find((k) => lc(k.recipient) === lc(recipient));
    if (env) this.release(book, id, env, actor, via, path, at);
  }

  private release(book: Book, id: Hex32, envelope: EncryptedKey, actor: Address | 'anyone', via: string, path: string, at: Timestamp): void {
    book.released.push(envelope);
    this.emit('key.released', id, actor, via, { source: 'adapter', recipient: envelope.recipient, envelope, path }, false, at);
  }

  /** A chain event's payload as SimChain writes it for the same step (without postings). */
  private payloadOf(type: SettlementEventType, before: EscrowState, after: EscrowState, c: CallContext): Record<string, unknown> {
    switch (type) {
      case 'hold.funded':
        return { amount: 'hold' in after ? after.hold.amount : null };
      case 'delivery.submitted': {
        const d = c.delivery;
        return d ? { attempt: d.attempt, deliveryHash: deliveryHash(d), plaintextSha256: d.plaintextSha256, ciphertext: d.ciphertext } : {};
      }
      case 'judgment.decided':
        return c.decision ? decidedBy(c.decision) : {};
      case 'appeal.decided': {
        const verdict = (after.kind === 'Released' || after.kind === 'Refunded') && after.via.kind === 'first_instance' ? after.via.appeal.kind : 'none';
        return { ...(c.decision ? decidedBy(c.decision) : {}), appealState: verdict };
      }
      case 'settlement.released':
        return c.decision ? {} : { via: 'early_accept' };
      case 'settlement.refunded':
        return c.decision ? {} : { via: 'default_outcome', from: before.kind };
      case 'appeal.filed': {
        const p = c.appeal;
        return p ? { appellant: p.appellant, grounds: p.grounds, bond: p.bond, fee: this.amount(0n) } : {};
      }
      case 'commitment.settled':
        return after.kind === 'Settled' ? { payouts: after.payouts, keyReleased: after.keyReleased } : {};
      case 'offer.expired':
      case 'default.triggered':
        return { from: before.kind };
      case 'fallback.triggered':
        return { beaconRound: beaconRoundFor(after, 'fallback') };
      default:
        return {};
    }
  }

  private decode(logs: readonly Log[]): DecodedLog[] {
    const out: DecodedLog[] = [];
    for (const l of logs) {
      try {
        const d = decodeEventLog({ abi: this.abi, data: l.data, topics: l.topics });
        out.push({ address: l.address, eventName: d.eventName ?? '', args: (d.args ?? {}) as Record<string, unknown> });
      } catch {
        // A log from a contract whose ABI is not loaded (none expected); it maps to no settlement event.
      }
    }
    return out;
  }

  /**
   * Rebuilds the on-chain events from the chain alone: every rules-contract transaction since deployment, its call
   * read from calldata, its logs mapped as at submission. Must equal the on-chain events in this adapter's log.
   */
  async replayCheck(): Promise<{ ok: boolean; events: number; detail?: string }> {
    const { rules, multicall, fromBlock } = this.world.deployment;
    const latest = await this.world.publicClient.getBlockNumber();
    const rebuilt: SettlementEventType[] = [];
    let txCount = 0;
    for (let n = fromBlock; n <= latest; n++) {
      const block = await this.world.publicClient.getBlock({ blockNumber: n, includeTransactions: true });
      for (const tx of block.transactions) {
        if (typeof tx === 'string' || !tx.to) continue;
        let fn: string | null = null;
        if (lc(tx.to) === lc(rules)) fn = decodeFunctionData({ abi: this.world.abis.rules, data: tx.input }).functionName;
        else if (lc(tx.to) === lc(multicall)) fn = 'agreeAndFund';
        if (!fn) continue;
        const receipt = await this.world.publicClient.getTransactionReceipt({ hash: tx.hash });
        if (receipt.status !== 'success') continue;
        txCount++;
        if (lc(tx.to) === lc(multicall)) rebuilt.push('fee.operator');
        rebuilt.push(...eventTypesFor(fn, this.decode(receipt.logs)).map((e) => e.type));
      }
    }
    const recorded = this.log_.filter((e) => this.onChain.has(e.seq)).map((e) => e.type);
    const ok = txCount === this.txs.length && rebuilt.length === recorded.length && rebuilt.every((t, i) => t === recorded[i]);
    return ok ? { ok, events: rebuilt.length } : { ok, events: rebuilt.length, detail: `chain: ${rebuilt.join(',')} / adapter: ${recorded.join(',')}` };
  }

  // Read model (as SimChain's view)

  private async view(id: Hex32, rec: Book): Promise<CommitmentStateView> {
    const s = rec.state;
    const t = s.terms.timing;
    const deadlines: Record<string, Timestamp> = { offerExpiresAt: t.offerExpiresAt, fundBy: t.fundBy, deliverBy: t.deliverBy, judgeBy: t.judgeBy, fallbackBy: t.fallbackBy };
    let appealState: CommitmentStateView['appealState'] = 'none';
    if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
      // Anvil reads the contract's appeal state; a live chain serves the mirror's, which every mined call checked.
      const chain = this.wall ? null : await this.stage(id);
      appealState = chain ? (APPEAL_STATES[chain.appeal] ?? 'none') : s.via.appeal.kind;
      const a = s.via.appeal;
      if (a.kind === 'none') {
        deadlines['appealBy'] = a.appealBy;
        deadlines['appealDecideBy'] = a.appealDecideBy;
      }
      if (a.kind === 'open') deadlines['appealDecideBy'] = a.appealDecideBy;
    }
    if (s.kind === 'Escalated') deadlines['appealDecideBy'] = s.escalation.appealDecideBy;
    const hold = 'hold' in s ? { hold: { amount: s.hold.amount, railRef: `evm:${this.world.chainId}:${lc(this.world.deployment.rules)}:${id}` } } : {};
    const attempt = 'delivery' in s ? s.delivery.attempt : s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? 1 : 0;
    const amount = async (a: Address): Promise<TokenAmount> => ({ token: this.token, amount: (await this.tokenBalance(a)).toString() as TokenAmount['amount'] });
    const view: CommitmentStateView = {
      commitmentId: id,
      escrowState: s.kind,
      appealState,
      attempt: s.kind === 'Released' || s.kind === 'Refunded' ? (s.via.kind === 'reclaim' ? 0 : 1) : attempt,
      ...hold,
      deadlines,
      balances: { [s.terms.buyer]: await amount(s.terms.buyer), [s.terms.seller]: await amount(s.terms.seller) },
      settledAt: s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? s.settledAt : null,
      finalAt: this.finalAt(rec),
      lastEventSeq: rec.lastEventSeq,
      updatedAt: rec.updatedAt,
    };
    if (s.kind === 'Settled') view.settled = { payouts: s.payouts, keyReleased: s.keyReleased };
    return view;
  }

  private finalAt(rec: Book): Timestamp | null {
    const s = rec.state;
    const passed = (ts: Timestamp) => Date.parse(this.now()) >= Date.parse(ts);
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
        return rec.appealClosedAt ?? null;
      }
      default:
        return null;
    }
  }
}

/** JSON-safe EIP-712 typed data, the operator's prepare shape: integers in the message are decimal strings. */
export interface Erc3009TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, string>;
}

/** ERC-3009's two authorizations share one field list (EIP-3009). */
export const ERC3009_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
];
const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

function erc3009Typed(primaryType: 'ReceiveWithAuthorization' | 'TransferWithAuthorization', domain: Erc3009TypedData['domain'], message: Record<string, string>): { typedData: Erc3009TypedData; digest: Hex32 } {
  const typedData = { domain, types: { EIP712Domain: DOMAIN_FIELDS, [primaryType]: ERC3009_FIELDS }, primaryType, message };
  const m = { ...message, value: BigInt(message['value']!), validAfter: BigInt(message['validAfter']!), validBefore: BigInt(message['validBefore']!) };
  const digest = hashTypedData({ domain, types: { [primaryType]: ERC3009_FIELDS }, primaryType, message: m } as Parameters<typeof hashTypedData>[0]);
  return { typedData, digest };
}

/** The commitment a submission touches, for its lane. */
function laneOf(s: Submission): string {
  switch (s.kind) {
    case 'offer':
      return s.commitment.id;
    case 'agree_and_fund':
      return s.agree.commitmentId;
    case 'deliver':
      return s.delivery.commitmentId;
    case 'appeal':
      return s.appeal.commitmentId;
    case 'trigger':
      return s.commitmentId;
    default:
      return s.message.commitmentId;
  }
}
