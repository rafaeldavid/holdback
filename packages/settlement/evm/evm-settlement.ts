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
// - Direct calls (T-218): a party may call the contract past every operator (ADR-0005). `observe` applies a mined
//   transaction this node did not relay, rebuilt from its calldata, as the same mirror step and events with
//   `submittedVia: 'direct'`; ChainSync (sync.ts) finds them in the rules contract's logs. A step it cannot rebuild
//   (a direct delivery it holds no copy of, a call forwarded by another contract) puts the deal behind: the view
//   serves dealOf's stage with a notice, and nothing is invented.
import {
  beaconRoundFor,
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  deliveryHash,
  holdbackDomain,
  mulBps,
  offer,
  postedDeliveryHash,
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
  type AppealGround,
  type Club,
  type CommitmentStateView,
  type Decision,
  type Delivery,
  type EarlyAccept,
  type EncryptedKey,
  type EscrowEvent,
  type EscrowState,
  type EscrowStateKind,
  type FundingAuthorization,
  type Hex32,
  type Mandate,
  type MutualSettlement,
  type Problem,
  type RandomnessSource,
  type Scope,
  type SettlementEvent,
  type SettlementEventType,
  type SignableMessage,
  type Timestamp,
  type TokenAmount,
  type TransferAuthorization,
} from '@holdback/core';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, encodePacked, getAddress, hashTypedData, keccak256, stringToBytes, toHex, type Abi, type AbiEvent, type Hex, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Genesis } from '../sim/simchain.js';
import type { DryRunSubmission, Settlement, Submission, SubmitOptions, SubmitResult, TimeoutKind } from '../src/interface.js';
import { Refusal, refuse, toJson } from '../src/util.js';
import { RelayRefused, type EvmChain, type Mined } from './chain.js';
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
import { problemFromRevert, revertData, revertName } from './errors.js';
import { assertSafeChain } from './guard.js';
import { commitmentTxs, idsOf, rulesCalls, type ChainTx, type RulesCall } from './sync.js';
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
  /** Successful submissions by idempotency key: the body hash and the answer, replayed for the same key and body. */
  replays?: Record<string, { body: Hex32; result: Extract<SubmitResult, { ok: true }> }>;
  appealClosedAt?: Timestamp;
  lastEventSeq: number;
  updatedAt: Timestamp;
  /** Transactions applied to this book, relayed or read from the chain, lowercase (T-218): each applies once. */
  chainTxs?: string[];
  /** Set while the chain has moved this deal in a way the book cannot follow yet (T-218). */
  behind?: Behind;
}

/** A deal the chain moved past its book (T-218). The view serves dealOf's stage with a notice and invents no step. */
export interface Behind {
  /** dealOf's stage (HoldbackRules.Stage name) and appeal state (its enum index), as last read. */
  stage: string;
  appeal: number;
  /** The first transaction the book could not follow, and why. */
  tx: Hex;
  reason: string;
  /**
   * Present when only the seller-signed delivery is missing (the contract keeps its hash alone, T-205): the
   * transactions from `tx` on, applied in order once a party posts that delivery.
   */
  waiting?: ChainTx[];
}

/** What `observe` did with the transactions it was given, per commitment they touch. */
export interface ObserveReport {
  /** Steps rebuilt and applied. */
  applied: number;
  /** Already applied (this node relayed them, or an earlier pass read them). */
  seen: number;
  /** Put a deal behind, or waited behind it. */
  behind: number;
  /** Named a commitment this node never saw (no book: counted and skipped). */
  unknown: number;
}

/** A chain call rebuilt into the core mirror's steps, or why it cannot be yet. */
type Rebuilt = { fn: string; steps: (at: Timestamp) => EscrowEvent[]; actor: Address | 'anyone'; ctx: CallContext } | { wait: string } | { fail: string };

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
/** keccak256 of a string, as the settlement view hashes strings (encode.ts). */
const str = (s: string): Hex32 => keccak256(stringToBytes(s));
/** The values a hashed field of a direct call may take, so the sync can read it back from its hash (T-218). */
const APPEAL_GROUNDS: readonly AppealGround[] = ['wrong-outcome', 'missing-or-wrong-key', 'policy-or-panel-violation', 'mislabeled-model'];
const BEACON_SOURCES: readonly RandomnessSource[] = ['sim', 'drand-quicknet', 'prevrandao'];
const ROLES = ['primary', 'fallback', 'appeal'] as const;
const OUTCOMES = ['accept', 'reject', 'escalate'] as const;
/** A deal stays open for the sync's cadence this long after its last deadline (T-218). */
const OPEN_GRACE_MS = 3_600_000;

export interface DecodedLog {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
}

/**
 * The settlement event types one call's logs produce, in log order. A party appeal's decision is appeal.decided,
 * then bond.slashed when it overturns (the first decider's bond pays the wronged party, T-206 I-8).
 */
export function eventTypesFor(call: string, logs: readonly DecodedLog[]): Array<{ type: SettlementEventType; log: DecodedLog | null }> {
  const appealClosed = call === 'decide' && logs.some((l) => l.eventName === 'AppealClosed');
  const table = LOG_TYPES[call] ?? {};
  const out: Array<{ type: SettlementEventType; log: DecodedLog | null }> = [];
  for (const l of logs) {
    if (appealClosed) {
      if (l.eventName === 'AppealClosed') out.push({ type: 'appeal.decided', log: l });
      else if (l.eventName === 'BondSlashed') out.push({ type: 'bond.slashed', log: l });
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
  /** Runs once the call is in a block, before its events. */
  mined?: () => void;
  /** Read from the chain, not relayed (T-218): an escalation whose decision envelopes are only a hash hands over the delivery's. */
  synced?: boolean;
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
  /** Per commitment, the transactions applied to its book (T-218), from its `chainTxs` and the events' `tx`. */
  private readonly appliedTxs = new Map<Hex32, Set<string>>();
  /** Per commitment, the log length after this node last recorded a relayed call: a sync pass that read dealOf before it does not check that deal. */
  private readonly relayedAt = new Map<Hex32, number>();

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
      for (const [key, r] of Object.entries(b.replays ?? {})) s.idempotency.set(key, r);
      if (b.spent) s.spent.set(b.spent.day, (s.spent.get(b.spent.day) ?? 0n) + BigInt(b.spent.amount));
      for (const h of b.chainTxs ?? []) s.seen(id, h);
    }
    for (const e of saved.events) {
      if (e.seq !== s.log_.length) throw new Error(`saved event ${e.seq} is out of order (expected ${s.log_.length})`);
      s.log_.push(e);
      if (typeof e.payload['tx'] === 'string') {
        s.onChain.add(e.seq);
        // Books saved before T-218 have no chainTxs: their events name the transactions applied.
        if (e.commitmentId) s.seen(e.commitmentId, e.payload['tx']);
      }
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
      const r = await world.receipt(hash);
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

  /** dealOf's stage and appeal state, at the latest block or at `blockNumber`. */
  async stage(id: Hex32, blockNumber?: bigint): Promise<{ stage: (typeof STAGES)[number]; appeal: number }> {
    const d = (await this.world.publicClient.readContract({ address: this.world.deployment.rules, abi: this.world.abis.rules, functionName: 'dealOf', args: [id], ...(blockNumber !== undefined ? { blockNumber } : {}) })) as { stage: number; appeal: number };
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

  /**
   * The token's EIP-712 domain, which ERC-3009 authorizations are signed under. Addresses in what an agent compares
   * are lowercase, as llms.txt pins them; the hash is the same either way.
   */
  tokenDomain(): Erc3009TypedData['domain'] {
    return { ...this.world.tokenDomain, chainId: this.world.chainId, verifyingContract: lc(this.world.deployment.token) as Address };
  }

  /**
   * The funding as typed data for the buyer to sign (ADR-0025): ReceiveWithAuthorization under the token's domain, its
   * digest, and the nonce and validAfter the FundingAuthorization body carries. Computed from the terms alone.
   */
  fundingTypedData(terms: AnyCommitmentTerms): { typedData: Erc3009TypedData; digest: Hex32; nonce: Hex32; validAfter: Timestamp } {
    const t = termsView(terms);
    const pi = paymentInfo(t, this.world.deployment.rules, commitmentIdOf(terms), this.world.expiryMargin);
    const nonce = payerAgnosticHash(pi, this.world.chainId, this.world.deployment.escrow);
    const message = { from: lc(t.buyer) as Address, to: lc(this.world.deployment.erc3009Collector) as Address, value: pi.maxAmount.toString(), validAfter: '0', validBefore: String(pi.preApprovalExpiry), nonce };
    return { ...erc3009Typed('ReceiveWithAuthorization', this.tokenDomain(), message), nonce, validAfter: '1970-01-01T00:00:00Z' };
  }

  /** The operator fee as typed data: TransferWithAuthorization under the token's domain, nonce bound to the commitment. */
  operatorFeeTypedData(o: { commitmentId: Hex32; from: Address; to: Address; value: string; validAfter: Timestamp; validBefore: Timestamp }): { typedData: Erc3009TypedData; digest: Hex32; nonce: Hex32 } {
    const nonce = operatorFeeNonce(o.commitmentId);
    const message = { from: lc(o.from) as Address, to: lc(o.to) as Address, value: BigInt(o.value).toString(), validAfter: String(secs(o.validAfter)), validBefore: String(secs(o.validBefore)), nonce };
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
  private enqueue<T>(lane: string, f: () => Promise<T>): Promise<T> {
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
    // On a live chain other commitments' calls run while this one waits for its block: only this commitment's events
    // are this submission's.
    const events = this.log_.slice(before).filter((e) => e.commitmentId === id);
    if (events.length) {
      book.lastEventSeq = events.at(-1)!.seq;
      book.updatedAt = this.now();
      this.dirty.add(id);
    }
    const state = await this.view(id, book);
    const signatureCheck = s.kind === 'trigger' ? 'none' : 'verified';
    const result: Extract<SubmitResult, { ok: true }> = { ok: true, commitmentId: id, state, events, replayed: false, dryRun, signatureCheck };
    if (key !== undefined) {
      this.idempotency.set(key, { body, result: structuredClone(result) });
      // Kept with the book, so a retry after a restart still replays the first answer (hard rule: idempotency).
      book.replays = { ...book.replays, [key]: { body, result: structuredClone(result) } };
      this.dirty.add(id);
    }
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
        // T-218: a deal funded on chain before anyone posted its offer here. The world joins the chain's state: the
        // offer is checked as of its terms' createdAt (the contract checked the signatures and deadlines at funding,
        // and this node's mandate checks are its policy for what it relays), then its transactions apply in order.
        // A failed read offers as before: the deal is then most likely not on chain, and the sync's notice covers the rest.
        const onChain = dryRun ? null : await this.stage(c.id).catch(() => null);
        const joining = onChain !== null && STAGES.includes(onChain.stage) && onChain.stage !== 'None';
        const found = joining ? await commitmentTxs(this, c.id) : null;
        const sellerScope: Scope = joining ? { roles: ['seller'], maxPerCommitment: t.price, maxDaily: t.price, expiresAt: '9999-12-31T23:59:59Z' } : this.scopeFor(t.seller, t.clubId, t, club);
        const nonce = `${lc(t.seller)}:terms:${t.nonce}`;
        const r = offer({ commitment: c, at: joining ? t.createdAt : at, sellerScope, rulebook: club?.rulebook ?? null, nonceUsed: this.nonces.has(nonce) });
        if (!r.ok) return refuse(r.error.type, r.error.detail);
        // The contract can represent these terms only if the token is an address (ADR-0025).
        termsView(t);
        if (dryRun) return c.id;
        const book: Book = { state: r.value, club: club!, sellerSignature: c.signatures.seller as Hex, held: [], released: [], nonces: [], lastEventSeq: 0, updatedAt: at };
        this.useNonce(book, nonce, false);
        this.books.set(c.id, book);
        this.emit('commitment.offered', c.id, t.seller, via, { source: 'adapter', termsHash: c.id, terms: t, sellerSignature: c.signatures.seller }, false);
        for (const tx of found?.txs ?? []) this.follow(c.id, tx, found!.stages.get(c.id));
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
        // The signed acceptance in full: agreeAndFund needs it, so anyone holding the terms can fund without an operator.
        this.emit('adjudicator.accepted', m.commitmentId, m.adjudicator, via, { source: 'adapter', seedCommitment: m.seedCommitment, bondRequired: required.value, freeBond: this.amount(free), acceptance: m }, false);
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
        const id = s.agree.commitmentId;
        if (id !== s.funding.commitmentId) refuse('invalid_terms', 'agreement and funding name different commitments');
        if (s.operatorFee && s.operatorFee.commitmentId !== id) refuse('invalid_terms', 'the operator fee names another commitment');
        // T-218: this same signed funding already funded the deal, sent without the fee leg (a copy of the bundle's fund
        // leg, ADR-0028 §11). The fee leg can still go alone until fundBy.
        if (this.fundedBy(id, s.funding.signature)) return this.feeAlone(id, s, options, dryRun);
        await this.check(s.agree, s.agree.buyer, 'Agree');
        const { announce, undo } = this.agree(s.agree, via, dryRun, true);
        if (dryRun) return id;
        try {
          return await this.fund(s.funding, s.operatorFee ?? null, options, announce);
        } catch (e) {
          undo();
          // A copy of the fund leg landed first, and the bundle was refused or reverted: follow the chain, then the fee.
          if (e instanceof Refusal && (await this.stage(id).catch(() => null))?.stage === 'Held') {
            await this.catchUp(id);
            if (this.fundedBy(id, s.funding.signature)) return this.feeAlone(id, s, options, false);
          }
          throw e;
        }
      }
      // On chain
      case 'deliver': {
        const d = s.delivery;
        const book = this.bookOf(d.commitmentId);
        // T-218: the same delivery landed directly, and this node waits for it to follow the chain.
        if (book.behind?.waiting) return this.join(book, d, dryRun);
        const t = termsView(book.state.terms);
        try {
          await this.call(d.commitmentId, 'deliver', [t, deliveryView(d), d.signature], (at) => [{ type: 'deliver', at, delivery: d }], options, dryRun, book.state.terms.seller, { delivery: d });
        } catch (e) {
          // The delivery may have landed directly since this node last read the chain: follow it, with this copy.
          if (e instanceof Refusal && e.revert === 'WrongStage' && !dryRun && book.state.kind === 'Held') {
            await this.catchUp(d.commitmentId, d);
            if (book.behind?.waiting) return this.join(book, d, false);
            if (book.state.kind !== 'Held' && book.delivery && deliveryHash(book.delivery) === deliveryHash(d)) return d.commitmentId;
          }
          // In `deliver`, InvalidMessage comes only from the attempt check, after the stage and deadline checks, as in
          // core; the contract has no bytes left for its own error, so the name core gives it is restored here.
          if (e instanceof Refusal && d.attempt !== 1 && e.revert === 'InvalidMessage') {
            refuse('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${book.state.terms.timing.maxSubmissions} (${e.problem.detail})`);
          }
          throw e;
        }
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
    // The decision or early accept that carries it would revert InvalidMessage; core names this refusal.
    if (d.attempt !== 1) return problem('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${book.state.terms.timing.maxSubmissions}`);
    if (!(await verifyMessage(this.domain, { ...d, type: 'Delivery' }, book.state.terms.seller))) return problem('invalid_signature', 'the delivery is not signed by the seller');
    book.carried = d;
    this.dirty.add(d.commitmentId);
    return null;
  }

  private carrying(book: Book): Delivery | undefined {
    return book.state.kind === 'Held' ? book.carried : undefined;
  }

  /**
   * Records the buyer's agreement. With `deferred` (agree and fund in one step), its event waits for the funding's
   * block (`announce`) and `undo` takes back only this commitment's own changes: other commitments emit events and
   * spend while this one waits on a live chain, so nothing shared is rolled back to a snapshot.
   */
  private agree(m: Agree, via: string, dryRun: boolean, deferred = false): { id: Hex32; announce: () => void; undo: () => void } {
    const book = this.bookOf(m.commitmentId);
    const { terms } = book.state;
    const nonce = `${lc(m.buyer)}:${m.nonce}`;
    this.useNonce(book, nonce, true);
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId, terms, book.club);
    const day = `${lc(terms.buyer)}|${this.now().slice(0, 10)}`;
    const spent = this.spent.get(day) ?? 0n;
    const next = this.stepped(book.state, { type: 'agree', at: this.now(), message: m, buyerScope, spentToday: this.amount(spent), memberAdmitted: this.isMember(book.club, terms.buyer, terms) });
    const none = () => undefined;
    if (dryRun) return { id: m.commitmentId, announce: none, undo: none };
    const prev = book.state;
    const price = BigInt(terms.price.amount);
    this.useNonce(book, nonce, false);
    book.state = next;
    book.agree = m;
    book.spent = { day, amount: terms.price.amount };
    this.spent.set(day, spent + price);
    const announce = () => this.emit('commitment.agreed', m.commitmentId, m.buyer, via, { source: 'adapter', termsHash: m.commitmentId }, false);
    if (!deferred) announce();
    return {
      id: m.commitmentId,
      announce,
      undo: () => {
        book.state = prev;
        delete book.agree;
        delete book.spent;
        this.nonces.delete(nonce);
        book.nonces = book.nonces.filter((n) => n !== nonce);
        this.spent.set(day, (this.spent.get(day) ?? price) - price);
      },
    };
  }

  /**
   * Transaction 1 (D4): agreeAndFund, or the operator-fee bundle (ADR-0023): fee transfer + agreeAndFund, atomic.
   * `mined` runs once the funding is in a block, before its events (the agreement's own event, when deferred).
   */
  private async fund(m: Extract<Submission, { kind: 'fund' }>['message'], fee: TransferAuthorization | null, options: EvmSubmitOptions, mined?: () => void): Promise<Hex32> {
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
    const ctx: CallContext = mined ? { mined } : {};
    if (!fee) {
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options, false, m.from, ctx);
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
    // ADR-0023 (EVM amendment): anyone may relay the fee transfer alone, ahead of the bundle, and the bundle would then
    // revert on the spent nonce. When the transfer that spent it paid this operator, the hold is funded on its own;
    // when it did not (the buyer spent its nonce elsewhere, or on USDC cancelled it), this operator declines to relay.
    if (await this.nonceUsed(m.commitmentId, token, feeCall)) {
      const paid = await this.feePaidEarlier(fee, terms.createdAt);
      if (paid === false) refuse('payment_required', 'the operator fee authorization for this commitment was used, and this node sees no payment to this operator from it (a public RPC can lag a few seconds behind; retry); or relay the agreement through another operator or submit it directly to the settlement layer');
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options, false, m.from, ctx);
      this.emit('fee.operator', m.commitmentId, m.from, options.via ?? 'direct', { source: 'adapter', from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)), paid: paid ? 'by an earlier transaction' : 'unverified' }, false);
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
    await this.send(m.commitmentId, 'agreeAndFund', multicall, bundle, mirror, options, false, m.from, { ...ctx, operatorFee: { from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)) } });
    return m.commitmentId;
  }

  /**
   * Whether the transaction that spent the fee's nonce paid this operator: the token's AuthorizationUsed(buyer, nonce)
   * log, then the token's own Transfer of at least the fee from the buyer to the fee address, as the next log (the order
   * LocalUSDC, TestUSDC and USDC's FiatTokenV2 emit them). A Transfer from another contract, or another one in the same
   * transaction, is not the payment. A spent nonce alone proves nothing: USDC (and LocalUSDC) also spends it for an
   * authorization the buyer cancelled, so without that log the answer is false. Null only when the token's ABI has no
   * AuthorizationUsed event. An RPC failure throws, and the agreement is taken back for a retry.
   */
  private async feePaidEarlier(fee: TransferAuthorization, since: Timestamp): Promise<boolean | null> {
    const event = this.world.abis.token.find((x): x is AbiEvent => x.type === 'event' && x.name === 'AuthorizationUsed');
    if (!event) return null;
    const client = this.world.publicClient;
    const { token, fromBlock } = this.world.deployment;
    const latest = await client.getBlockNumber();
    // On a live chain, only the blocks since the terms were made (about 12 s each), within one RPC range.
    const span = BigInt(Math.min(50_000, Math.ceil(Math.max(0, Date.parse(this.now()) - Date.parse(since)) / 12_000) + 50));
    const from = this.wall && latest - span > fromBlock ? latest - span : fromBlock;
    const used = await client.getLogs({ address: token, event, args: { authorizer: getAddress(fee.from), nonce: fee.nonce }, fromBlock: from, toBlock: latest });
    const at = used[0];
    if (!at) return false;
    const receipt = await client.getTransactionReceipt({ hash: at.transactionHash! });
    const next = receipt.logs.find((l) => l.logIndex === at.logIndex! + 1);
    if (!next || lc(next.address) !== lc(token)) return false;
    const [paid] = this.decode([next]);
    return paid?.eventName === 'Transfer' && lc(String(paid.args['from'])) === lc(fee.from) && lc(String(paid.args['to'])) === lc(fee.to) && BigInt(String(paid.args['amount'] ?? paid.args['value'] ?? 0)) >= BigInt(fee.value);
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
        const closedAt = appealClosedAt(book.state, at);
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
    // The chain moved this deal past the book (T-218): the mirror cannot check a relay against it.
    if (book.behind) refuse('invalid_state', this.lag(id)!);
    const key = options.sender;
    const from = key ? privateKeyToAccount(key).address : this.world.senderFor(id);
    const at = this.now();
    const time = secs(at);
    try {
      await this.world.simulate({ from, to, data }, this.wall ? undefined : time);
    } catch (e) {
      const raw = revertData(e);
      if (raw === undefined && !/revert/i.test(String((e as Error).message))) throw e;
      throw new Refusal(problemFromRevert(this.abi, raw), revertName(this.abi, raw));
    }
    // The mirror must accept what the contract accepted; run it before sending so a divergence changes nothing.
    const before = book.state;
    const next = this.mirrored(before, mirror(at), fn);
    if (dryRun) return;
    let mined: Mined;
    try {
      mined = await this.world.send({ ...(key ? { key } : { lane: id }), to, data }, this.wall ? undefined : time);
    } catch (e) {
      // The relayer declines (out of test ETH, gas above its cap): the signed message stays valid elsewhere (D27).
      if (e instanceof RelayRefused) refuse('relay_refused', `this operator cannot relay it now: ${e.message}; submit the same signed message through another operator or directly to the settlement layer`);
      throw e;
    }
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
    // ADR-0029: the delivery the contract stored is the one the mirror holds, since every later signature names it.
    if (ctx.delivery) {
      const stored = await this.read<Hex32>(this.world.deployment.rules, this.world.abis.rules, 'deliveryHashOf', [id]);
      if (stored !== deliveryHash(ctx.delivery)) throw new Error(`EVM/core divergence after ${fn}: the contract stores delivery ${stored}, core holds ${deliveryHash(ctx.delivery)}`);
    }
    this.record(id, book, fn, before, after, logs, mined, blockAt, options.via ?? 'direct', actor, ctx);
    this.relayedAt.set(id, this.log_.length);
  }

  /**
   * A mined call's effect on its book, relayed or read from the chain: the mirror's new state, the transaction, the
   * call's events at the block's time and the envelopes it hands to the next adjudicator.
   */
  private record(id: Hex32, book: Book, fn: string, before: EscrowState, after: EscrowState, logs: readonly DecodedLog[], mined: Pick<Mined, 'hash' | 'from' | 'blockNumber' | 'gasUsed'>, blockAt: Timestamp, via: string, actor: Address | 'anyone', ctx: CallContext): void {
    book.state = after;
    this.seen(id, mined.hash, book);
    this.txs.push({ commitmentId: id, call: fn, hash: mined.hash, from: mined.from, via, gasUsed: mined.gasUsed, at: blockAt });
    const tx = { tx: mined.hash, block: mined.blockNumber, sender: lc(mined.from), gasUsed: mined.gasUsed };
    ctx.mined?.();
    if (ctx.operatorFee) this.emit('fee.operator', id, actor, via, { ...ctx.operatorFee, ...tx }, true, blockAt);
    for (const { type, log } of eventTypesFor(fn, logs)) {
      if (type === 'key.released' && log) {
        const a = log.args as { recipient: Address; path: number; scheme: string; ciphertext: string };
        const envelope = { recipient: getAddress(a.recipient), scheme: a.scheme, ciphertext: a.ciphertext } as EncryptedKey;
        book.released.push(envelope);
        this.emit(type, id, actor, via, { recipient: envelope.recipient, envelope, path: KEY_PATHS[a.path] ?? String(a.path), ...tx }, true, blockAt);
      } else if (type === 'bond.slashed' && log) {
        // SimChain's payFromBond: the adjudicator's own bond is the junior tranche; backers (senior) are Phase 4. Like
        // every chain event, it carries its transaction (event.schema.json ChainTx, schema v0.9).
        const a = log.args as { adjudicator: Address; amount: bigint };
        this.emit(type, id, 'anyone', via, { adjudicator: getAddress(a.adjudicator), junior: this.amount(a.amount), senior: this.amount(0n), reason: 'overturn', ...tx }, true, blockAt);
      } else {
        this.emit(type, id, actor, via, { ...this.payloadOf(type, before, after, ctx, log), ...tx }, true, blockAt);
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
      // A direct escalation whose envelopes this node holds only as a hash (T-218): the seller's envelope for the
      // appeal adjudicator opens the same content, so the appeal adjudicator can still decide (litmus test 1).
      else if (ctx.synced) this.releaseHeld(book, id, a.appealAdjudicator, ctx.decision.adjudicator, via, 'escalation', at);
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
  private payloadOf(type: SettlementEventType, before: EscrowState, after: EscrowState, c: CallContext, log: DecodedLog | null): Record<string, unknown> {
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
        // The contract's round, from its FallbackTriggered log, so it stays right for any beacon (drand, T-217).
        return { beaconRound: log ? Number(log.args['beaconRound']) : beaconRoundFor(after, 'fallback') };
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

  // Direct calls (T-218): transactions this node did not relay, read from the chain

  /** True when this node holds a book for the commitment (its offer was posted here). */
  follows(id: Hex32): boolean {
    return this.books.has(id);
  }

  /** True when `hash` was applied to the commitment's book, relayed by this node or read by an earlier pass. */
  applied(id: Hex32, hash: string): boolean {
    return this.appliedTxs.get(id)?.has(lc(hash)) ?? false;
  }

  /** How many events the log holds: a sync pass marks it before reading dealOf. */
  eventCount(): number {
    return this.log_.length;
  }

  /** Records `hash` as applied to the commitment; with `book`, also in the book's own row. */
  private seen(id: Hex32, hash: string, book?: Book): void {
    const h = lc(hash);
    let set = this.appliedTxs.get(id);
    if (!set) this.appliedTxs.set(id, (set = new Set()));
    if (set.has(h) && !book) return;
    set.add(h);
    if (book && !(book.chainTxs ?? []).includes(h)) {
      book.chainTxs = [...(book.chainTxs ?? []), h];
      this.dirty.add(id);
    }
  }

  /**
   * Deals whose stage may still change on chain within their terms: from the offer until fundBy, and once funded until
   * an hour after the last deadline ahead of it (deliverBy, judgeBy, fallbackBy, the appeal windows). The world reads
   * the chain at least once a minute while any is open (T-218).
   */
  openDeals(): number {
    const now = Date.parse(this.now());
    let n = 0;
    for (const b of this.books.values()) {
      const s = b.state;
      if (s.kind === 'Expired' || s.kind === 'Settled' || this.finalAt(b) !== null) continue;
      const t = s.terms.timing;
      const deadlines = PRE_FUNDING.includes(s.kind) ? [t.fundBy] : [t.deliverBy, t.judgeBy, t.fallbackBy];
      if (s.kind === 'Escalated') deadlines.push(s.escalation.appealDecideBy);
      if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
        const ap = s.via.appeal;
        if (ap.kind === 'none' || ap.kind === 'open') deadlines.push(ap.appealDecideBy);
      }
      if (now < Math.max(...deadlines.map((d) => Date.parse(d))) + OPEN_GRACE_MS) n++;
    }
    return n;
  }

  /** The state read's notice for a deal the chain moved past this node's book (T-218), or null. */
  lag(id: Hex32): string | null {
    const b = this.books.get(id)?.behind;
    if (!b) return null;
    const shown = `The state shown is the contract's (dealOf: ${b.stage}); this node's events stop before transaction ${b.tx}.`;
    return b.waiting
      ? `Behind the chain: ${b.reason} ${shown} The seller posts the same signed delivery to POST /v1/commitments/${id}/deliveries; this node then joins it to the deal with no second transaction, and the adjudicators get their envelopes.`
      : `Behind the chain: ${b.reason} ${shown}`;
  }

  /**
   * Applies mined transactions this node may not have relayed (ChainSync, T-218), in chain order: for each commitment
   * a transaction's logs name and this node follows, the step rebuilt from its calldata, at the block's time, with
   * `submittedVia: 'direct'`. A transaction already applied changes nothing. `stages`: dealOf for each deal touched,
   * read at the pass's last block; a deal whose book then stands elsewhere, and that no relay moved since `mark` (the
   * event count when the pass began), falls behind. Never throws for one transaction: it puts that deal behind.
   */
  async observe(txs: readonly ChainTx[], stages: ReadonlyMap<Hex32, { stage: string; appeal: number }>, mark = this.log_.length): Promise<ObserveReport> {
    const report: ObserveReport = { applied: 0, seen: 0, behind: 0, unknown: 0 };
    const last = new Map<Hex32, Hex>();
    for (const tx of txs) {
      for (const id of idsOf(this.world, tx.logs)) {
        if (!this.books.has(id)) {
          report.unknown++;
          continue;
        }
        report[await this.enqueue(id, async () => this.follow(id, tx, stages.get(id)))]++;
        last.set(id, tx.hash);
      }
    }
    for (const [id, stage] of stages) {
      const book = this.books.get(id);
      if (!book || book.behind || (this.relayedAt.get(id) ?? -1) >= mark) continue;
      const expect = PRE_FUNDING.includes(book.state.kind) ? 'None' : book.state.kind;
      if (stage.stage !== expect) {
        this.fallBehind(id, book, { hash: last.get(id) ?? ('0x' as Hex) }, stage, `the contract holds this deal ${stage.stage}, while this node's book rebuilt it to ${book.state.kind}.`);
        report.behind++;
      }
    }
    return report;
  }

  /** One transaction for one commitment, inside its lane. */
  private follow(id: Hex32, tx: ChainTx, stage: { stage: string; appeal: number } | undefined, known?: Delivery): keyof Omit<ObserveReport, 'unknown'> {
    const book = this.books.get(id)!;
    if (this.applied(id, tx.hash)) return 'seen';
    this.seen(id, tx.hash, book);
    if (book.behind) {
      if (stage) Object.assign(book.behind, stage);
      book.behind.waiting?.push(tx);
      this.dirty.add(id);
      this.custodyBehind(id, book, tx);
      return 'behind';
    }
    return this.step(id, book, tx, stage, known);
  }

  /**
   * Envelopes for a deal the book cannot follow, from what the chain confirms (T-218): a key the transaction released
   * on chain is served, and each adjudicator whose turn dealOf shows gets its envelope from the delivery, as a relayed
   * takeover, escalation or appeal would hand it. A takeover forwarded by a contract this node cannot read must not
   * strand the fallback, or the deal drifts into the default (litmus test 1).
   */
  private custodyBehind(id: Hex32, book: Book, tx?: ChainTx): void {
    const behind = book.behind!;
    const at = tx ? toTimestamp(tx.timestamp * 1000) : this.now();
    const mine = (tx?.logs ?? []).filter((l) => l.topics[1] === id && lc(l.address) === lc(this.world.deployment.rules));
    for (const l of this.decode(mine as unknown as Log[])) {
      if (l.eventName !== 'KeyReleased') continue;
      const a = l.args as { recipient: Address; path: number; scheme: string; ciphertext: string };
      const envelope = { recipient: getAddress(a.recipient), scheme: a.scheme, ciphertext: a.ciphertext } as EncryptedKey;
      if (book.released.some((k) => lc(k.recipient) === lc(envelope.recipient) && k.ciphertext === envelope.ciphertext)) continue;
      book.released.push(envelope);
      this.emit('key.released', id, 'anyone', 'direct', { recipient: envelope.recipient, envelope, path: KEY_PATHS[a.path] ?? String(a.path), tx: tx!.hash, block: tx!.block, sender: lc(tx!.from), gasUsed: tx!.gasUsed }, true, at);
    }
    const a = book.state.terms.adjudication;
    const turns: Array<[Address, string]> = [];
    if (behind.stage === 'FallbackJudging') turns.push([a.fallbackAdjudicator, 'fallback takeover']);
    if (behind.stage === 'Escalated') turns.push([a.appealAdjudicator, 'escalation']);
    if (APPEAL_STATES[behind.appeal] === 'open') turns.push([a.appealAdjudicator, 'appeal']);
    for (const [recipient, path] of turns) if (!book.released.some((k) => lc(k.recipient) === lc(recipient))) this.releaseHeld(book, id, recipient, 'anyone', 'direct', path, at);
    this.dirty.add(id);
  }

  /** Rebuilds a mined transaction's step for one commitment and records it as a relayed call is recorded. */
  private step(id: Hex32, book: Book, tx: ChainTx, stage: { stage: string; appeal: number } | undefined, known?: Delivery): 'applied' | 'behind' {
    const calls = rulesCalls(this.world, tx);
    if (!calls) return this.fallBehind(id, book, tx, stage, `transaction ${tx.hash} called contract ${tx.to}, which forwarded a call to the rules contract; this node reads calls made to the rules contract or through Multicall3 only.`);
    const view = termsView(book.state.terms);
    const mine = calls.filter((c) => sameView(c.args[0], view));
    if (mine.length !== 1) return this.fallBehind(id, book, tx, stage, `transaction ${tx.hash} made ${mine.length} calls for this deal; this node rebuilds one call per transaction.`);
    const rebuilt = this.rebuild(id, book, mine[0]!, tx, known);
    if ('wait' in rebuilt) return this.fallBehind(id, book, tx, stage, rebuilt.wait, [tx]);
    if ('fail' in rebuilt) return this.fallBehind(id, book, tx, stage, rebuilt.fail);
    const before = book.state;
    const blockAt = toTimestamp(tx.timestamp * 1000);
    let after: EscrowState;
    try {
      after = this.mirrored(before, rebuilt.steps(blockAt), rebuilt.fn);
    } catch (e) {
      return this.fallBehind(id, book, tx, stage, `${(e as Error).message}.`);
    }
    const logs = this.decode(tx.logs.filter((l) => l.topics[1] === id && [lc(this.world.deployment.rules), lc(this.world.deployment.bonds)].includes(lc(l.address))) as unknown as Log[]);
    this.record(id, book, rebuilt.fn, before, after, logs, { hash: tx.hash, from: tx.from, blockNumber: BigInt(tx.block), gasUsed: BigInt(tx.gasUsed) }, blockAt, 'direct', rebuilt.actor, { ...rebuilt.ctx, synced: true });
    if (rebuilt.fn === 'expireAppeal') book.appealClosedAt = appealClosedAt(before, blockAt);
    const events = this.log_.filter((e) => e.commitmentId === id);
    book.lastEventSeq = events.at(-1)?.seq ?? book.lastEventSeq;
    book.updatedAt = this.now();
    this.dirty.add(id);
    return 'applied';
  }

  private fallBehind(id: Hex32, book: Book, tx: Pick<ChainTx, 'hash'> & Partial<ChainTx>, stage: { stage: string; appeal: number } | undefined, reason: string, waiting?: ChainTx[]): 'behind' {
    book.behind = { stage: stage?.stage ?? 'unknown', appeal: stage?.appeal ?? 0, tx: tx.hash, reason, ...(waiting ? { waiting } : {}) };
    this.dirty.add(id);
    this.custodyBehind(id, book, tx.logs ? (tx as ChainTx) : undefined);
    return 'behind';
  }

  /**
   * A rules-contract call as the core mirror's steps. Fields the calldata carries in the clear are copied; fields it
   * carries only as a hash are read back from what this node holds (the delivery, its envelopes) or from a fixed list
   * (appeal grounds, beacon sources), checked against the hash. The seller's delivery is the one field only a party can
   * supply: without it the call waits.
   */
  private rebuild(id: Hex32, book: Book, call: RulesCall, tx: ChainTx, known?: Delivery): Rebuilt {
    const s = book.state;
    const terms = s.terms;
    const a = terms.adjudication;
    const args = call.args as readonly Record<string, unknown>[];
    const ts = (v: unknown) => toTimestamp(Number(v) * 1000);
    const hex = (v: unknown) => v as Hex32;
    // The delivery that landed with this call: the contract's JobSubmitted names its hash.
    const landed = this.decode(tx.logs.filter((l) => l.topics[1] === id && lc(l.address) === lc(this.world.deployment.rules)) as unknown as Log[]).find((l) => l.eventName === 'JobSubmitted')?.args['deliverable'] as Hex32 | undefined;
    const delivery = (): Delivery | null => [known, book.carried, book.delivery].find((d): d is Delivery => !!d && deliveryHash(d) === landed) ?? null;
    const unread = `the seller's delivery landed in transaction ${tx.hash} without passing through this node, and the contract keeps only its hash (${landed}), so this node holds no envelopes for the adjudicators.`;
    const carrying = (): Delivery | null | undefined => (s.kind === 'Held' ? delivery() : undefined);
    switch (call.fn) {
      case 'agreeAndFund': {
        if (!PRE_FUNDING.includes(s.kind)) return { fail: `a funding in transaction ${tx.hash} found this node's book ${s.kind}.` };
        const [, , acc, ag, f] = args as [unknown, unknown, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
        const acceptance: AdjudicatorAcceptance =
          book.acceptance && lc(book.acceptance.signature) === lc(String(acc['signature']))
            ? book.acceptance
            : { type: 'AdjudicatorAcceptance', commitmentId: id, adjudicator: a.adjudicator, seedCommitment: hex(acc['seedCommitment']), policyHash: a.policyHash, registryHash: a.registryHash, fee: a.fee, bondReserved: this.amount(BigInt(acc['bondReserved'] as bigint)), nonce: hex(acc['nonce']), expiresAt: ts(acc['expiresAt']), signature: acc['signature'] as Hex };
        const agree: Agree = book.agree && lc(book.agree.signature) === lc(String(ag['signature'])) ? book.agree : { type: 'Agree', commitmentId: id, buyer: terms.buyer, nonce: hex(ag['nonce']), expiresAt: ts(ag['expiresAt']), signature: ag['signature'] as Hex };
        const typed = this.fundingTypedData(terms);
        const funding: FundingAuthorization = {
          type: 'FundingAuthorization',
          scheme: Number(f['method']) === 1 ? 'permit2' : 'erc3009',
          commitmentId: id,
          from: terms.buyer,
          value: typed.typedData.message['value']!,
          token: this.token,
          validAfter: typed.validAfter,
          validBefore: terms.timing.fundBy,
          nonce: typed.nonce,
          expiresAt: terms.timing.fundBy,
          signature: f['signature'] as Hex,
        };
        // The contract checked the three signatures; the mandate checks are this node's own policy for what it relays.
        const wide: Scope = { roles: ['buyer', 'seller'], maxPerCommitment: terms.price, maxDaily: { token: terms.price.token, amount: UINT256_MAX } as TokenAmount, expiresAt: '9999-12-31T23:59:59Z' };
        const zero = this.amount(0n);
        const steps = (at: Timestamp): EscrowEvent[] => [
          ...(s.kind === 'Offered' ? [{ type: 'adjudicator_accept' as const, at, message: acceptance, unencumberedBond: acceptance.bondReserved }] : []),
          ...(s.kind !== 'Agreed' ? [{ type: 'agree' as const, at, message: agree, buyerScope: wide, spentToday: zero, memberAdmitted: true }] : []),
          { type: 'fund', at, message: funding, buyerScope: wide, balance: this.amount(BigInt(funding.value)), gasBuffer: zero },
        ];
        const mined = () => {
          for (const n of [`${lc(a.adjudicator)}:${acceptance.nonce}`, `${lc(terms.buyer)}:${agree.nonce}`]) {
            if (this.nonces.has(n)) continue;
            this.nonces.add(n);
            book.nonces.push(n);
          }
          book.acceptance = acceptance;
          book.agree = agree;
          if (s.kind === 'Offered') this.emit('adjudicator.accepted', id, a.adjudicator, 'direct', { source: 'chain', seedCommitment: acceptance.seedCommitment, bondReserved: acceptance.bondReserved, acceptance }, false, ts(tx.timestamp));
          if (s.kind !== 'Agreed') this.emit('commitment.agreed', id, terms.buyer, 'direct', { source: 'chain', termsHash: id }, false, ts(tx.timestamp));
        };
        return { fn: call.fn, steps, actor: terms.buyer, ctx: { mined } };
      }
      case 'deliver': {
        if (s.kind !== 'Held') return { fail: `a delivery in transaction ${tx.hash} found this node's book ${s.kind}.` };
        const d = delivery();
        if (!d) return { wait: unread };
        return { fn: call.fn, steps: (at) => [{ type: 'deliver', at, delivery: d }], actor: terms.seller, ctx: { delivery: d } };
      }
      case 'decide': {
        const carry = carrying();
        if (carry === null) return { wait: unread };
        const m = this.decisionFrom(id, book, args[1]!);
        if (typeof m === 'string') return { fail: m };
        const beacon = m.role === 'primary' || !m.beacon ? null : { round: m.beacon.round, value: m.beacon.value };
        const steps = (at: Timestamp): EscrowEvent[] => [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'decide', at, message: m, beacon }];
        return { fn: call.fn, steps, actor: m.adjudicator, ctx: { decision: m, ...(carry ? { delivery: carry } : {}) } };
      }
      case 'earlyAccept': {
        const carry = carrying();
        if (carry === null) return { wait: unread };
        const v = args[1]!;
        const m: EarlyAccept = { type: 'EarlyAccept', commitmentId: id, buyer: terms.buyer, attempt: Number(v['attempt']), deliveryHash: hex(v['deliveryHash']), nonce: hex(v['nonce']), expiresAt: ts(v['expiresAt']), signature: v['signature'] as Hex };
        const steps = (at: Timestamp): EscrowEvent[] => [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'early_accept', at, message: m }];
        return { fn: call.fn, steps, actor: terms.buyer, ctx: carry ? { delivery: carry } : {} };
      }
      case 'fileAppeal': {
        const v = args[1]!;
        const appellant = Number(v['appellant']) === 0 ? 'buyer' : 'seller';
        // Grounds are free text in the schema; this node's adjudicators read one of the four grounds (AppealGround).
        const grounds = APPEAL_GROUNDS.find((g) => str(g) === v['groundsHash']) ?? `unread: filed directly; the contract keeps only the grounds' hash ${String(v['groundsHash'])}`;
        const p: Appeal = { commitmentId: id, appellant, appellantAddress: appellant === 'buyer' ? terms.buyer : terms.seller, grounds, bond: this.amount(BigInt(v['bond'] as bigint)), filedAt: ts(v['filedAt']), signature: v['signature'] as Hex };
        const zero = this.amount(0n);
        return { fn: call.fn, steps: (at) => [{ type: 'file_appeal', at, appeal: p, requiredBond: p.bond, requiredFee: zero, feePaid: zero }], actor: p.appellantAddress, ctx: { appeal: p } };
      }
      case 'mutualSettle': {
        const v = args[1]!;
        const m: MutualSettlement = {
          type: 'MutualSettlement',
          commitmentId: id,
          deliveryHash: v['hasDelivery'] ? hex(v['deliveryHash']) : null,
          payouts: (v['payouts'] as Array<{ to: Address; amount: bigint }>).map((p) => ({ to: getAddress(p.to), amount: this.amount(BigInt(p.amount)) })),
          releaseKey: Boolean(v['releaseKey']),
          nonce: hex(v['nonce']),
          expiresAt: ts(v['expiresAt']),
          buyerSignature: v['buyerSignature'] as Hex,
          sellerSignature: v['sellerSignature'] as Hex,
        };
        return { fn: call.fn, steps: (at) => [{ type: 'mutual_settle', at, message: m, rule: { allowed: true, payoutsTo: 'any' } }], actor: 'anyone', ctx: {} };
      }
      case 'expireOffer':
        return { fn: call.fn, steps: (at) => [{ type: 'expire', at }], actor: 'anyone', ctx: {} };
      case 'reclaim':
        return { fn: call.fn, steps: (at) => [{ type: 'reclaim', at }], actor: 'anyone', ctx: {} };
      case 'triggerFallback':
        return { fn: call.fn, steps: (at) => [{ type: 'trigger_fallback', at }], actor: 'anyone', ctx: {} };
      case 'triggerDefault':
        return { fn: call.fn, steps: (at) => [{ type: 'trigger_default', at }, { type: 'apply_default_outcome', at }], actor: 'anyone', ctx: {} };
      case 'expireAppeal':
        return { fn: call.fn, steps: (at) => [{ type: 'expire_appeal', at }], actor: 'anyone', ctx: {} };
      default:
        return { fail: `transaction ${tx.hash} called ${call.fn}, which this node does not rebuild.` };
    }
  }

  /** A Decision from its settlement view (decisionView): a string says which hashed field could not be read back. */
  private decisionFrom(id: Hex32, book: Book, v: Record<string, unknown>): Decision | string {
    const terms = book.state.terms;
    const role = ROLES[Number(v['role'])];
    const outcome = OUTCOMES[Number(v['outcome'])];
    if (!role || !outcome) return `a decision names role ${String(v['role'])} and outcome ${String(v['outcome'])}, which core does not know.`;
    const adjudicator = role === 'primary' ? terms.adjudication.adjudicator : role === 'fallback' ? terms.adjudication.fallbackAdjudicator : terms.adjudication.appealAdjudicator;
    let beacon: Decision['beacon'];
    if (v['beaconSourceHash'] !== str('')) {
      const source = BEACON_SOURCES.find((x) => str(x) === v['beaconSourceHash']);
      if (!source) return `a decision names a beacon source whose hash ${String(v['beaconSourceHash'])} is none this node knows.`;
      const signature = v['beaconSignature'] as Hex;
      beacon = { source, round: Number(v['beaconRound']), value: v['beaconValue'] as Hex32, ...(signature && signature !== '0x' ? { signature } : {}) };
    }
    const ground = APPEAL_GROUNDS.find((g) => str(g) === v['appealGroundHash']);
    const m: Decision = {
      type: 'Decision',
      commitmentId: id,
      attempt: Number(v['attempt']),
      deliveryHash: v['deliveryHash'] as Hex32,
      adjudicator,
      role,
      outcome,
      seed: v['seed'] as Hex32,
      policyHash: terms.adjudication.policyHash,
      registryHash: terms.adjudication.registryHash,
      judgmentRecordHash: v['judgmentRecordHash'] as Hex32,
      nonce: v['nonce'] as Hex32,
      expiresAt: toTimestamp(Number(v['expiresAt']) * 1000),
      signature: v['signature'] as Hex,
      ...(v['keyScheme'] ? { keyForBuyer: { scheme: v['keyScheme'] as 'x25519-xsalsa20poly1305', ciphertext: String(v['keyCiphertext']) } } : {}),
      ...(ground ? { appealGround: ground } : {}),
      ...(beacon ? { beacon } : {}),
    };
    // On escalate the decision carries the appeal adjudicator's envelope, as a hash on chain: the seller's own envelope
    // for it is the usual one, and is kept when it hashes to the signed list.
    const held = book.held.find((k) => lc(k.recipient) === lc(terms.adjudication.appealAdjudicator));
    if (held && decisionView({ ...m, encryptedKeys: [held] }).encryptedKeysHash === v['encryptedKeysHash']) m.encryptedKeys = [held];
    return m;
  }

  /**
   * Applies this commitment's transactions that this node has not seen, from the deployment's first block (T-218): an
   * offer posted after its deal was funded on chain, or a delivery posted after it landed directly. Inside the
   * commitment's lane. Throws on an RPC error, having applied nothing.
   */
  private async catchUp(id: Hex32, known?: Delivery): Promise<void> {
    const { txs, stages } = await commitmentTxs(this, id);
    for (const tx of txs) this.follow(id, tx, stages.get(id), known);
  }

  /**
   * The seller posts the delivery that landed on chain without this node (T-218): checked against the hash the
   * contract keeps, then the waiting transactions apply in order, with no second relay. The adjudicators get their
   * envelopes as if this node had relayed it.
   */
  private async join(book: Book, d: Delivery, dryRun: boolean): Promise<Hex32> {
    const id = d.commitmentId;
    const behind = book.behind!;
    const waiting = behind.waiting!;
    await this.check({ ...d, type: 'Delivery' }, book.state.terms.seller, 'Delivery');
    const landed = this.decode(waiting[0]!.logs.filter((l) => l.topics[1] === id && lc(l.address) === lc(this.world.deployment.rules)) as unknown as Log[]).find((l) => l.eventName === 'JobSubmitted')?.args['deliverable'];
    if (landed !== deliveryHash(d)) refuse('invalid_state', `the delivery that landed on chain for this deal is ${String(landed)}, not this one (${deliveryHash(d)})`);
    if (dryRun) return id;
    delete book.behind;
    this.dirty.add(id);
    const stage = { stage: behind.stage, appeal: behind.appeal };
    for (const tx of waiting) {
      // A later transaction may put the deal behind again; the rest then wait behind it.
      const again = book.behind as Behind | undefined;
      if (again) again.waiting?.push(tx);
      else this.step(id, book, tx, stage, d);
    }
    return id;
  }

  /** True when the deal's hold came from this funding signature. */
  private fundedBy(id: Hex32, signature: string): boolean {
    const s = this.books.get(id)?.state;
    return !!s && 'hold' in s && lc(s.hold.funding.signature) === lc(signature);
  }

  /**
   * The operator-fee leg alone, after the same signed funding was sent without it (a copy of the bundle's fund leg,
   * ADR-0028 §11): the buyer signed this fee for this commitment, valid until fundBy. Sends nothing when the submission
   * carries no fee or its nonce is already spent.
   */
  private async feeAlone(id: Hex32, s: Extract<Submission, { kind: 'agree_and_fund' }>, options: EvmSubmitOptions, dryRun: boolean): Promise<Hex32> {
    const fee = s.operatorFee;
    if (!fee || dryRun) return id;
    const book = this.bookOf(id);
    if (lc(fee.from) !== lc(book.state.terms.buyer) || lc(fee.token) !== this.token || lc(fee.to) === lc(fee.from) || fee.nonce !== operatorFeeNonce(id)) refuse('invalid_terms', 'the operator fee must come from the buyer, in the price token, with the nonce bound to the commitment');
    const { token } = this.world.deployment;
    const data = encodeFunctionData({ abi: this.world.abis.token, functionName: 'transferWithAuthorization', args: [getAddress(fee.from), getAddress(fee.to), BigInt(fee.value), BigInt(secs(fee.validAfter)), BigInt(secs(fee.validBefore)), fee.nonce, fee.signature] });
    if (await this.nonceUsed(id, token, data)) return id;
    let mined: Mined;
    try {
      mined = await this.world.send({ ...(options.sender ? { key: options.sender } : { lane: id }), to: token, data }, this.wall ? undefined : secs(this.now()));
    } catch (e) {
      if (e instanceof RelayRefused) refuse('relay_refused', `this operator cannot relay the operator fee now: ${e.message}`);
      throw e;
    }
    if (mined.status !== 'success') refuse('invalid_state', `the operator fee transfer reverted on chain in ${mined.hash}; the deal is funded`);
    this.balanceCache.clear();
    const blockAt = toTimestamp(mined.timestamp * 1000);
    const via = options.via ?? 'direct';
    this.txs.push({ commitmentId: id, call: 'transferWithAuthorization', hash: mined.hash, from: mined.from, via, gasUsed: mined.gasUsed, at: blockAt });
    this.emit('fee.operator', id, getAddress(fee.from), via, { from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)), tx: mined.hash, block: mined.blockNumber, sender: lc(mined.from), gasUsed: mined.gasUsed }, true, blockAt);
    return id;
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
    const posted = postedDeliveryHash(s);
    const view: CommitmentStateView = {
      commitmentId: id,
      escrowState: s.kind,
      appealState,
      attempt: s.kind === 'Released' || s.kind === 'Refunded' ? (s.via.kind === 'reclaim' ? 0 : 1) : attempt,
      ...(posted ? { deliveryHash: posted } : {}),
      ...hold,
      deadlines,
      balances: { [s.terms.buyer]: await amount(s.terms.buyer), [s.terms.seller]: await amount(s.terms.seller) },
      settledAt: s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? s.settledAt : null,
      finalAt: this.finalAt(rec),
      lastEventSeq: rec.lastEventSeq,
      updatedAt: rec.updatedAt,
    };
    if (s.kind === 'Settled') view.settled = { payouts: s.payouts, keyReleased: s.keyReleased };
    // Behind the chain (T-218): the contract's stage, with the notice `lag` gives; the rest is the book's last step.
    const behind = rec.behind;
    if (behind && behind.stage !== 'None' && (STAGES as readonly string[]).includes(behind.stage)) {
      view.escrowState = behind.stage as EscrowStateKind;
      view.appealState = APPEAL_STATES[behind.appeal] ?? 'none';
    }
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

/** D20: an appeal expiry is final at the deadline that closed the window, not when someone triggered it. */
function appealClosedAt(s: EscrowState, at: Timestamp): Timestamp {
  if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
    const a = s.via.appeal;
    if (a.kind === 'none') return a.appealBy;
    if (a.kind === 'open') return a.appealDecideBy;
  }
  return at;
}

/** Whether two settlement-view structs are equal: numbers by value, hex and addresses in any case, keys in any order. */
function sameView(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): unknown => {
    if (typeof x === 'bigint' || typeof x === 'number') return String(x);
    if (typeof x === 'string') return x.toLowerCase();
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).sort(([k], [l]) => (k < l ? -1 : 1)).map(([k, v]) => [k, norm(v)]));
    return x;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
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
