// EvmSettlement: the Settlement interface over the Holdback contracts (HoldbackRules, CPP), on a local
// anvil chain (kind 'local') or a public testnet (kind 'testnet', D41). Agents see amounts, states and receipts,
// never chain mechanics.
//
// The phase-one contracts (ADR-0031 §8, D57) have no party appeals and no bonds. The first decision by the primary or
// the fallback adjudicator is final at once; the appeal adjudicator decides escalations only. So this adapter takes
// no appeal and no appeal expiry: each is refused before any transaction, with a problem that names phase one. An
// acceptance must reserve 0. SimChain keeps both features as the full protocol's reference.
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
//   the primary at delivery, the fallback at takeover, the appeal adjudicator at escalation.
//   The buyer's envelope is released on chain, in the paying transaction.
// - Direct calls (T-218): a party may call the contract past every operator (ADR-0005). `observe` applies a mined
//   transaction this node did not relay, rebuilt from its calldata, as the same mirror step and events with
//   `submittedVia: 'direct'`; ChainSync (sync.ts) finds them in the rules contract's logs. A step it cannot rebuild
//   (a direct delivery it holds no copy of, a call forwarded by another contract) puts the deal behind: the view
//   serves dealOf's stage with a notice, and nothing is invented.
// - A delivery already on chain (T-230): the seller's posted copy of a delivery it sent directly joins whether or not a
//   pass has read that transaction. The relay reads `deliveryHashOf` first, and again at the block of a relay that
//   reverted; a copy the node cannot join yet stays on the book (`posted`) until the next pass reads the transaction.
// - Restarts mid-flight (T-219): each relayed call's submission rides in its relayer lane's in-flight row (live.ts). A
//   transaction this node broadcast before a restart is applied through the same path as a direct call, but labelled
//   as the relay was, with the messages the row holds (the delivery's envelopes, the decision's keys), and its
//   Idempotency-Key answers a retry with the mined result (`recover`).
import {
  beaconRoundFor,
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  deliveryHash,
  holdbackDomain,
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
  PHASE_ONE_NO_APPEAL,
} from '@holdback/core';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, encodePacked, getAddress, hashTypedData, keccak256, parseTransaction, stringToBytes, toHex, type Abi, type AbiEvent, type Hex, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Genesis } from '../sim/simchain.js';
import type { DryRunSubmission, Settlement, Submission, SubmitOptions, SubmitResult, TimeoutKind } from '../src/interface.js';
import { Refusal, refuse, toJson } from '../src/util.js';
import { RelayRefused, type EvmChain, type LaneRow, type Mined, type RelayNote } from './chain.js';
import {
  acceptanceView,
  agreeView,
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
import { commitmentTxs, embeddedCalls, feeLegs, idsOf, rulesCalls, type ChainTx, type RulesCall } from './sync.js';
import type { EvmWorld } from './world.js';

/** Submit options on EVM: who pays gas. A private key: the agent's own for 'direct'. Absent: the chain's relayer lane for the commitment. */
export interface EvmSubmitOptions extends SubmitOptions {
  sender?: Hex;
}

/**
 * Inside the adapter: the options and what the relayer lane's row keeps for the submission (T-219). `landed` collects
 * the hashes of the relayed transactions whose receipts this submission applied: `process` releases their rows only
 * once the submission's answer is stored with its book (review, 2026-11-04).
 */
type Relay = EvmSubmitOptions & { note?: RelayNote; landed?: string[] };

/** What `recover` did with the rows a restart left open, one count per row. */
export interface RecoverReport {
  /** Applied as this node's relay. */
  applied: number;
  /** Already applied (an earlier pass, or the books were written before the restart). */
  seen: number;
  /** Put its deal behind the chain. */
  behind: number;
  /** Mined and reverted: only gas was spent. */
  reverted: number;
  /** Never mined: given up, and the lane reads its nonce again. */
  dropped: number;
  /** Mined for a commitment this node holds no book for. */
  unknown: number;
  /** An RPC error: the row stays open for the next pass. */
  failed: number;
  errors: string[];
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
  lastEventSeq: number;
  updatedAt: Timestamp;
  /** Transactions applied to this book, relayed or read from the chain, lowercase (T-218): each applies once. */
  chainTxs?: string[];
  /** Set while the chain has moved this deal in a way the book cannot follow yet (T-218). */
  behind?: Behind;
  /** The seller's posted delivery, held while this node has not read the transaction that landed it (T-230). */
  posted?: PostedCopy;
}

/**
 * A seller-signed delivery posted to this node while it could not read the transaction that landed it (T-230). The
 * next pass that reads a `JobSubmitted` naming its hash joins it with no relay, and stores the answer under each
 * Idempotency-Key it was posted under. Kept only with the seller's signature checked. Plain JSON: a store keeps it.
 */
export interface PostedCopy {
  /** The first post, as `process` noted it. */
  note: RelayNote;
  /** Other Idempotency-Keys the same copy was posted under, at most POSTED_KEYS_MAX. */
  keys: Array<{ idempotencyKey: string; body: Hex32 }>;
  /** A read of the contract showed this delivery's hash. An unconfirmed copy goes an hour after deliverBy. */
  confirmed: boolean;
  /** This node's relay of it reverted, or the contract refused it: a repost reads the chain again and sends nothing. */
  asked: boolean;
}

/** What a read of `deliveryHashOf` found (T-230): the hash and its block, no delivery, or no answer within the budget. */
type Landed = { kind: 'landed'; hash: Hex32; block: bigint } | { kind: 'none' } | { kind: 'unread' };
/** What keeping a posted copy did: kept it (or its key), kept it with no room for its key, or kept none of it (another copy is held). */
type Kept = 'kept' | 'full' | 'other';

/** A deal the chain moved past its book (T-218). The view serves dealOf's stage with a notice and invents no step. */
export interface Behind {
  /** dealOf's stage (HoldbackRules.Stage name), as last read. */
  stage: string;
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

/**
 * A chain call rebuilt into the core mirror's steps, or why it cannot be yet. `signed` checks the rebuilt messages'
 * signatures, for a call read out of another contract's calldata, which may never have run as written.
 */
type Rebuilt = { fn: string; steps: (at: Timestamp) => EscrowEvent[]; actor: Address | 'anyone'; ctx: CallContext; signed: () => Promise<boolean>; settlement?: MutualSettlement } | { wait: string } | { fail: string };

/** What a store must persist to rebuild a live settlement after a restart (`EvmSettlement.restore`). */
export interface EvmSaved {
  books: ReadonlyArray<readonly [Hex32, Book]>;
  events: readonly SettlementEvent[];
  mandates: readonly Mandate[];
}

/**
 * What changed since the last `drain`: the books to overwrite, the events to append, the mandates admitted, and the
 * relayed transactions whose receipts these changes apply (T-219): their lane rows go once the rest is written.
 */
export type EvmChanges = { books: Array<[Hex32, Book]>; events: SettlementEvent[]; mandates: Mandate[]; relayed: string[] };

/**
 * A relayed call whose simulation passed and whose transaction the chain reverted (on a live chain): the state or a
 * deadline moved in between. `block` is the revert's block, for reads pinned to it (T-230).
 */
class Reverted extends Refusal {
  constructor(
    problem: Problem,
    readonly block: bigint,
    /** The block's time, unix seconds. */
    readonly at: number,
  ) {
    super(problem);
  }
}

/**
 * `submit`'s answer on this adapter. `reverted` marks a refusal whose relayed transaction went out and reverted on
 * chain (`Reverted`, thrown in `send`): it cost gas, where every other refusal comes before the broadcast. The
 * operators' own timeouts read it (timeouts.ts). No API answer and no stored row carries it: both are built from
 * `problem` alone. A delivery's refusal that `deliver` rewrites with its kept-copy notice answers without the flag;
 * nothing reads it for a delivery.
 */
export type EvmSubmitResult = Extract<SubmitResult, { ok: true }> | (Extract<SubmitResult, { ok: false }> & { reverted?: true });

const GENESIS_HASH: Hex32 = `0x${'00'.repeat(32)}`;
const UINT256_MAX = (2n ** 256n - 1n).toString();
const lc = (a: string) => a.toLowerCase();
const secs = (ts: Timestamp) => Math.floor(Date.parse(ts) / 1000);
/** An envelope as the seller signed it (SimChain's signedEnvelope). */
const signedEnvelope = (k: EncryptedKey): EncryptedKey => ({
  recipient: k.recipient,
  scheme: k.scheme,
  ciphertext: k.ciphertext,
  ...(k.unlock ? { unlock: { kind: k.unlock.kind, ...(k.unlock.round !== undefined ? { round: k.unlock.round } : {}) } } : {}),
});

/** On-chain Stage enum (HoldbackRules.Stage) as core kinds; None is any pre-funding kind, and an expired offer. */
const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled'] as const;
/** The reason a phase-one settlement gives a party appeal, from core, where it is written once (ADR-0031 §8). */
export { PHASE_ONE_NO_APPEAL };
const PRE_FUNDING: readonly EscrowStateKind[] = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];
/** The chain's stage for a book's kind: None for a pre-funding kind and for an expired offer, which the phase-one
 *  contracts never record (ADR-0031 §7, SC-6); the kind itself otherwise. */
const chainStageOf = (kind: EscrowStateKind): string => (PRE_FUNDING.includes(kind) || kind === 'Expired' ? 'None' : kind);
/** How long a live chain's balance reads are reused: a block is about 12 s on Sepolia. */
const BALANCE_TTL_MS = 4000;
/**
 * The waits before each retry of a read pinned to a receipt's block (7.5 s in all, five tries): an RPC node that has
 * not seen the block yet fails the read, and each try walks the chain's RPC list again. No try starts after a wait that
 * would end past the budget, so the retries add at most 10 s to the reads themselves (each up to 8 s per RPC when an
 * RPC hangs, live.ts).
 */
const RECEIPT_READ_RETRY_MS = [500, 1_000, 2_000, 4_000];
const RECEIPT_READ_BUDGET_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Contract event names as settlement event types, per call. Unlisted logs (CPP, token) map to nothing. */
const LOG_TYPES: Record<string, Record<string, SettlementEventType>> = {
  agreeAndFund: { JobFunded: 'hold.funded' },
  deliver: { JobSubmitted: 'delivery.submitted' },
  decide: { JobSubmitted: 'delivery.submitted', Decided: 'judgment.decided', PaymentReleased: 'settlement.released', Refunded: 'settlement.refunded', KeyReleased: 'key.released' },
  earlyAccept: { JobSubmitted: 'delivery.submitted', PaymentReleased: 'settlement.released', KeyReleased: 'key.released' },
  mutualSettle: { MutuallySettled: 'commitment.settled', KeyReleased: 'key.released' },
  reclaim: { Refunded: 'settlement.reclaimed' },
  triggerFallback: { FallbackTriggered: 'fallback.triggered' },
  triggerDefault: { Defaulted: 'default.triggered', Refunded: 'settlement.refunded' },
};
const KEY_PATHS = ['decision', 'early_accept', 'mutual settlement'];
/** keccak256 of a string, as the settlement view hashes strings (encode.ts). */
const str = (s: string): Hex32 => keccak256(stringToBytes(s));
/** The values a hashed field of a direct call may take, so the sync can read it back from its hash (T-218). */
const APPEAL_GROUNDS: readonly AppealGround[] = ['wrong-outcome', 'missing-or-wrong-key', 'policy-or-panel-violation', 'mislabeled-model'];
const BEACON_SOURCES: readonly RandomnessSource[] = ['sim', 'drand-quicknet', 'prevrandao'];
const ROLES = ['primary', 'fallback', 'appeal'] as const;
const OUTCOMES = ['accept', 'reject', 'escalate'] as const;
/** A deal stays open for the sync's cadence this long after its last deadline (T-218). */
const OPEN_GRACE_MS = 3_600_000;
/** A deal whose book moved this recently counts as recent for the sync's cadence. */
const RECENT_MS = 86_400_000;
/** The most extra Idempotency-Keys a kept copy answers (T-230): the same copy posted again, under other keys, before it joins. */
const POSTED_KEYS_MAX = 16;
/** Permissionless timeouts: the sync reads them from the logs alone, never from calldata (T-218). */
const TIMEOUTS: ReadonlySet<string> = new Set(['reclaim', 'triggerFallback', 'triggerDefault']);
/** The event each timeout leaves in its deal's log: a trigger that comes after it sends nothing (T-231). */
const RAN: Partial<Record<TimeoutKind, SettlementEventType>> = { expire_offer: 'offer.expired', reclaim: 'settlement.reclaimed', fallback: 'fallback.triggered', default: 'default.triggered' };
/** 9999-12-31T23:59:59Z: a later chain time (the contract takes any uint64) reads as never expiring (review H2). */
const LATEST_SECONDS = 253_402_300_799;
/** A contract time in seconds as a timestamp, clamped to what a timestamp holds; the contract already enforced it. */
const chainTime = (v: unknown): Timestamp => toTimestamp(Math.min(Number(v), LATEST_SECONDS) * 1000);

export interface DecodedLog {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
}

/** The settlement event types one call's logs produce, in log order. */
export function eventTypesFor(call: string, logs: readonly DecodedLog[]): Array<{ type: SettlementEventType; log: DecodedLog | null }> {
  const table = LOG_TYPES[call] ?? {};
  const out: Array<{ type: SettlementEventType; log: DecodedLog | null }> = [];
  for (const l of logs) {
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
  operatorFee?: { from: string; to: string; amount: TokenAmount };
  /** Runs once the call is in a block, before its events, with the block's time. */
  mined?: (at: Timestamp) => void;
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
  /** ADR-0032: the rules contract's BEACON_MARGIN(), as the chain read it (`EvmChain.beaconMarginSec`). */
  get beaconMarginSec(): number {
    return this.world.beaconMarginSec;
  }
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
  /** Live balance reads, reused for a few seconds while the chain's floor stays where it was at the read (T-232). */
  private readonly balanceCache = new Map<string, { at: number; value: bigint; floor: bigint }>();
  private dirty = new Set<Hex32>();
  private drained = 0;
  private admitted: Mandate[] = [];
  /** Per commitment, the transactions applied to its book (T-218), from its `chainTxs` and the events' `tx`. */
  private readonly appliedTxs = new Map<Hex32, Set<string>>();
  /** Per commitment, the log length after this node last recorded a relayed call: a sync pass that read dealOf before it does not check that deal. */
  private readonly relayedAt = new Map<Hex32, number>();
  /** Relayed transactions whose receipts are applied since the last `drain` (T-219): their lane rows may go once written. */
  private relayed: string[] = [];

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
    this.abi = [...abis.rules, ...abis.escrow, ...abis.collector, ...abis.token, ...abis.multicall] as Abi;
  }

  /**
   * A settlement on a fresh copy of the anvil world (reverted to just after deployment): token balances minted and
   * gas for every party and adjudicator. The phase-one contracts hold no bond (ADR-0031 §8), so each adjudicator's
   * genesis bond is minted to it as a plain balance it keeps: the world holds the same money as SimChain's, and a
   * scenario's conservation check compares like with like. Setup is test-only (anvil impersonation) and never counts
   * toward gas per deal.
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
    let last = 0n;
    for (const e of saved.events) {
      if (e.seq !== s.log_.length) throw new Error(`saved event ${e.seq} is out of order (expected ${s.log_.length})`);
      s.log_.push(e);
      if (typeof e.payload['tx'] === 'string') {
        s.onChain.add(e.seq);
        // Books saved before T-218 have no chainTxs: their events name the transactions applied.
        if (e.commitmentId) s.seen(e.commitmentId, e.payload['tx']);
      }
      const b = e.payload['block'];
      if ((typeof b === 'string' && /^[0-9]+$/.test(b)) || (typeof b === 'number' && Number.isSafeInteger(b))) last = BigInt(b) > last ? BigInt(b) : last;
    }
    // T-232: after a restart, no read of the state answers from before the last transaction the books hold.
    chain.saw?.(last);
    s.drained = s.log_.length;
    return s;
  }

  private async setup(world: EvmWorld, gasFor: readonly Address[]): Promise<void> {
    const { token } = world.deployment;
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
      const amount = BigInt(b.junior) + BigInt(b.senior);
      if (amount > 0n) await mint(a as Address, amount);
    }
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

  /** For a deal behind the chain (T-218), dealOf's stage as this node last applied it; null otherwise. */
  behindStage(id: Hex32): { stage: string } | null {
    const b = this.books.get(id)?.behind;
    return b ? { stage: b.stage } : null;
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

  /** dealOf's stage, at `blockNumber`, or the state now (`read`). */
  async stage(id: Hex32, blockNumber?: bigint): Promise<{ stage: (typeof STAGES)[number] }> {
    const d = await this.read<{ stage: number }>(this.world.deployment.rules, this.world.abis.rules, 'dealOf', [id], blockNumber);
    return { stage: STAGES[d.stage]! };
  }

  /**
   * A contract read at `blockNumber`. Without one, the state now: on a live chain pinned to the chain's newest block,
   * never before the last block this node wrote at or read (T-232: a node a block behind still shows the state before
   * this node's own last transaction); asked again within the chain's bound, then thrown. Anvil, one node that mines
   * each transaction before its receipt returns, reads its latest block.
   */
  private async read<T>(address: Address, abi: Abi, functionName: string, args: unknown[], blockNumber?: bigint): Promise<T> {
    // `block` undefined is anvil's latest block (viem then names none). Named in the call itself, so the read rule sees it.
    const at = async (block: bigint | undefined) => (await this.world.publicClient.readContract({ address, abi, functionName, args, blockNumber: block })) as T;
    if (blockNumber !== undefined || !this.world.pinned) return at(blockNumber);
    return this.world.pinned(at);
  }

  /**
   * A read pinned to a mined block, until `settled` accepts its answer. On the chain that holds the receipt the answer
   * is fixed, so a failure or another answer means the node lags or follows another fork: the read is tried again,
   * after RECEIPT_READ_RETRY_MS on a live chain, within RECEIPT_READ_BUDGET_MS. Then the last answer or failure stands,
   * with no read after the budget.
   */
  private async atReceipt<T>(read: () => Promise<T>, settled: (answer: T) => boolean): Promise<T> {
    const deadline = Date.now() + RECEIPT_READ_BUDGET_MS;
    for (let tries = 0; ; tries++) {
      const last = await read().then((value) => ({ value }), (error: unknown) => ({ error }));
      if ('value' in last && settled(last.value)) return last.value;
      const ms = RECEIPT_READ_RETRY_MS[tries];
      if (ms === undefined || Date.now() + ms > deadline) {
        if ('error' in last) throw last.error;
        return last.value;
      }
      if (this.wall) await sleep(ms);
    }
  }

  /**
   * A token balance. On a live chain reads are reused for a few seconds unless `fresh`; a check that gates a step is
   * fresh. A read is reused only while the chain's floor has not moved since (T-232): once this node has a receipt, or a
   * pass has read the chain, past it, the balance is read again at that block or later. Otherwise a second operator
   * could serve a balance from before a release its pass already applied (try.mjs's balances step on two operators).
   */
  async tokenBalance(a: Address, fresh = false): Promise<bigint> {
    if (!this.wall) return this.read<bigint>(this.world.deployment.token, this.world.abis.token, 'balanceOf', [getAddress(a)]);
    const hit = this.balanceCache.get(lc(a));
    const now = this.wall();
    const floor = this.world.floor?.() ?? 0n;
    if (hit && !fresh && now - hit.at < BALANCE_TTL_MS && hit.floor >= floor) return hit.value;
    const value = await this.read<bigint>(this.world.deployment.token, this.world.abis.token, 'balanceOf', [getAddress(a)]);
    this.balanceCache.set(lc(a), { at: now, value, floor });
    return value;
  }

  /** Drops cached balances: a transfer this adapter did not send (the faucet's mint) moved them. */
  forgetBalances(addresses?: readonly Address[]): void {
    if (!addresses) return this.balanceCache.clear();
    for (const a of addresses) this.balanceCache.delete(lc(a));
  }

  /**
   * An adjudicator's pool as SimChain shapes it. The phase-one contracts hold no bond (ADR-0031 §8), so every pool is
   * empty: nothing backs a decision, and nothing is reserved.
   */
  pool(_adjudicator: Address): { junior: bigint; senior: bigint; reserved: bigint } { // eslint-disable-line @typescript-eslint/no-unused-vars
    return { junior: 0n, senior: 0n, reserved: 0n };
  }

  /**
   * Token balance per address and what CPP holds for this operator. `appealHold` is SimChain's appeal-bond account,
   * always 0 here: the phase-one contracts take no appeal and hold no appeal bond (ADR-0031 §8).
   */
  async holdings(addresses: readonly Address[], _ids: readonly Hex32[]): Promise<{ parties: Record<string, bigint>; escrow: bigint; appealHold: bigint }> { // eslint-disable-line @typescript-eslint/no-unused-vars
    const { escrow, rules } = this.world.deployment;
    const parties: Record<string, bigint> = {};
    for (const a of addresses) parties[lc(a)] = await this.tokenBalance(a);
    const store = await this.read<Address>(escrow, this.world.abis.escrow, 'getTokenStore', [rules]);
    return { parties, escrow: await this.tokenBalance(store), appealHold: 0n };
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

  /** The books, events and mandates that changed since the last call, for a store to write. */
  drain(): EvmChanges {
    const books = [...this.dirty].map((id) => [id, structuredClone(this.books.get(id)!)] as [Hex32, Book]);
    const out = { books, events: this.log_.slice(this.drained), mandates: this.admitted, relayed: this.relayed };
    this.dirty = new Set();
    this.drained = this.log_.length;
    this.admitted = [];
    this.relayed = [];
    return out;
  }

  /**
   * A relayed transaction's receipt is applied, and the answer a retry replays is stored: its lane row may go with the
   * next drain's writes (T-219). With `options.landed` (a submission in `process`), the hash waits there until
   * `process` has stored the answer.
   */
  private done(hash: string, options?: Relay): void {
    if (options?.landed) options.landed.push(lc(hash));
    else if (this.world.release) this.relayed.push(lc(hash));
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
    const auth = { from: t.buyerPaymentAddress, to, value: pi.maxAmount, validAfter: 0n, validBefore: BigInt(pi.preApprovalExpiry), nonce };
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
    const message = { from: lc(t.buyerPaymentAddress) as Address, to: lc(this.world.deployment.erc3009Collector) as Address, value: pi.maxAmount.toString(), validAfter: '0', validBefore: String(pi.preApprovalExpiry), nonce };
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

  submit(submission: Submission, options: EvmSubmitOptions = {}): Promise<EvmSubmitResult> {
    return this.enqueue(submissionCommitmentId(submission), () => this.process(submission, options, false));
  }

  validate(submission: DryRunSubmission): Promise<EvmSubmitResult> {
    return this.enqueue(submissionCommitmentId(submission as Submission), () => this.process(submission as Submission, {}, true));
  }

  trigger(commitmentId: Hex32, timeout: TimeoutKind, options: EvmSubmitOptions = {}): Promise<EvmSubmitResult> {
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

  private async process(s: Submission, options: EvmSubmitOptions, dryRun: boolean): Promise<EvmSubmitResult> {
    const key = dryRun ? undefined : options.idempotencyKey;
    const body = canonicalKeccak(toJson(s));
    const lane = submissionCommitmentId(s) as Hex32;
    // T-219: this commitment's transaction that a restart left in flight lands first, so a retry of it replays the
    // mined result instead of meeting the state that transaction moved.
    if (!dryRun) for (const row of this.world.inFlight?.() ?? []) if (row.note && lc(row.note.commitmentId) === lc(lane)) await this.land(row);
    if (key !== undefined) {
      const conflict = { ok: false, problem: problem('idempotency_conflict', `idempotency key ${key} was used with another body`) } as const;
      // An open row's key is taken, for any commitment, until its pass lands it and records the answer (red-team,
      // 2026-11-04). The same key and body name the same commitment, whose rows landed just above.
      if ((this.world.inFlight?.() ?? []).some((r) => r.note?.idempotencyKey === key && r.note.body !== body)) return conflict;
      // So is a kept copy's key, for any commitment, until its delivery joins and the answer is stored (T-230, red team).
      if (this.postedKey(key, body)) return conflict;
      const seen = this.idempotency.get(key);
      if (seen) return seen.body === body ? { ...structuredClone(seen.result), replayed: true } : conflict;
    }
    const before = this.log_.length;
    // The rows of the transactions this submission lands go once its answer is stored with the book, below.
    const landed: string[] = [];
    const release = () => {
      for (const h of landed) this.done(h);
    };
    let id: Hex32;
    try {
      const note: RelayNote = { commitmentId: lane, call: '', via: options.via ?? 'direct', submission: s, ...(key !== undefined ? { idempotencyKey: key, body } : {}) };
      id = await this.apply(s, { ...options, note, landed }, dryRun);
    } catch (e) {
      // A refusal after a receipt (a revert on chain) has no answer to replay. Any other error keeps the row: the sync
      // or a restart lands that receipt with its answer.
      if (e instanceof Refusal) {
        release();
        // The revert as a fact, beside the words that describe it: `Reverted` is thrown where that message is written.
        return e instanceof Reverted ? { ok: false, problem: e.problem, reverted: true } : { ok: false, problem: e.problem };
      }
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
    // The book has moved: the answer is stored and the lane row goes whatever a balance read does (T-232, T-409).
    const state = await this.view(id, book, { bestEffort: true });
    const signatureCheck = s.kind === 'trigger' ? 'none' : 'verified';
    const result: Extract<SubmitResult, { ok: true }> = { ok: true, commitmentId: id, state, events, replayed: false, dryRun, signatureCheck };
    if (key !== undefined) {
      this.idempotency.set(key, { body, result: structuredClone(result) });
      // Kept with the book, so a retry after a restart still replays the first answer (hard rule: idempotency).
      book.replays = { ...book.replays, [key]: { body, result: structuredClone(result) } };
      this.dirty.add(id);
    }
    // T-230: a copy kept for this deal's delivery, posted under other keys, gets its answers once the delivery is in the
    // book. A failed read keeps the copy for the next pass.
    if (book.posted) await this.settlePosted(id, book).catch(() => undefined);
    release();
    return result;
  }

  /** True when a kept copy holds Idempotency-Key `key` with another body (T-230). */
  private postedKey(key: string, body: Hex32): boolean {
    for (const b of this.books.values()) {
      if (!b.posted) continue;
      if ([b.posted.note, ...b.posted.keys].some((k) => k.idempotencyKey === key && k.body !== body)) return true;
    }
    return false;
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
    // ADR-0031 §8: every chain runs the phase-one contracts, so core steps their profile.
    const r = step(state, e, 'phase_one', this.world.beaconMarginSec);
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

  private async apply(s: Submission, options: Relay, dryRun: boolean): Promise<Hex32> {
    const at = this.now();
    const via = options.via ?? 'direct';
    switch (s.kind) {
      // Pre-funding: signatures collected by the adapter, checked on chain at agreeAndFund
      case 'offer': {
        const c = s.commitment;
        const t = termsOf(c);
        if (!(await verifyTerms(this.domain, t, c.signatures.seller, t.seller))) refuse('invalid_signature', 'the seller did not sign these terms');
        if (this.books.has(c.id)) refuse('invalid_state', `commitment ${c.id} was already offered`);
        // ADR-0031 §2 (SC-1): a deployment serves one token, and agreeAndFund refuses terms in any other. Refused here,
        // before the club's and the mandates' checks and before the buyer and the adjudicator sign terms the contract
        // would never fund. Core requires the price, fee and settlement tokens to be one (state.ts), and the contract
        // checks the one token the commitment ID hashes, so each of the three must be the deployment's.
        for (const token of [t.price.token, t.adjudication.fee.token, t.settlement.token]) {
          if (lc(token) !== this.token) {
            refuse('invalid_terms', `the terms are in ${token}; this deployment's contracts serve one token, ${this.token} (ADR-0031 §2). Offer the terms in that token, or use a deployment for the other one`);
          }
        }
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
        // ADR-0031 §6 (SC-5): core checks the offer against what the phase-one contracts refuse at funding.
        const r = offer({ commitment: c, at: joining ? t.createdAt : at, sellerScope, rulebook: club?.rulebook ?? null, nonceUsed: this.nonces.has(nonce), profile: 'phase_one' });
        if (!r.ok) return refuse(r.error.type, r.error.detail);
        // The contract can represent these terms only if the token is an address (ADR-0025).
        termsView(t);
        if (dryRun) return c.id;
        const book: Book = { state: r.value, club: club!, sellerSignature: c.signatures.seller as Hex, held: [], released: [], nonces: [], lastEventSeq: 0, updatedAt: at };
        this.useNonce(book, nonce, false);
        this.books.set(c.id, book);
        this.emit('commitment.offered', c.id, t.seller, via, { source: 'adapter', termsHash: c.id, terms: t, sellerSignature: c.signatures.seller }, false);
        for (const tx of found?.txs ?? []) await this.follow(c.id, tx, found!.stages.get(c.id));
        if (found) this.relayedAt.set(c.id, this.log_.length);
        return c.id;
      }
      case 'adjudicator_accept': {
        const m = s.message;
        await this.check(m, m.adjudicator, 'AdjudicatorAcceptance');
        const book = this.bookOf(m.commitmentId);
        this.useNonce(book, `${lc(m.adjudicator)}:${m.nonce}`, true);
        // ADR-0031 §8 point 2: the phase-one contracts hold no bond, and agreeAndFund refuses an acceptance that says
        // otherwise. Refused here, before the buyer signs a funding the contract would revert, with the problem type
        // core's phase-one rule gives the same acceptance (T-349 review).
        if (BigInt(m.bondReserved.amount) !== 0n) {
          refuse('acceptance_mismatch', `the acceptance reserves a bond of ${m.bondReserved.amount}; this settlement runs the phase-one contracts, which hold no bonds, so bondReserved must be 0 (ADR-0031 §8). Ask the adjudicator to sign its acceptance again with bondReserved 0`);
        }
        const next = this.stepped(book.state, { type: 'adjudicator_accept', at, message: m, unencumberedBond: this.amount(0n) });
        if (dryRun) return m.commitmentId;
        this.useNonce(book, `${lc(m.adjudicator)}:${m.nonce}`, false);
        book.state = next;
        book.acceptance = m;
        // The signed acceptance in full: agreeAndFund needs it, so anyone holding the terms can fund without an operator.
        this.emit('adjudicator.accepted', m.commitmentId, m.adjudicator, via, { source: 'adapter', seedCommitment: m.seedCommitment, bondRequired: m.bondReserved, acceptance: m }, false);
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
        return this.deliver(book, d, options, dryRun);
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
      case 'appeal':
        // ADR-0031 §8: no party appeal on the phase-one contracts. Refused before any transaction, with the reason.
        this.bookOf(s.appeal.commitmentId);
        return refuse('invalid_state', PHASE_ONE_NO_APPEAL);
      case 'mutual_settle': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const t = book.state.terms;
        if (!(await verifyMutualSettlement(this.domain, m, t.buyer, t.seller))) refuse('invalid_signature', 'the settlement is not signed by both the buyer and the seller');
        // SC-5b (T-357): in Held the settlement carries the unposted delivery it names, as the contract's `dv` and key
        // proof; core checks it first, as the contract does (:380-381). The contract stores no delivery for it.
        const late = book.state.kind === 'Held' && m.releaseKey ? s.delivery : undefined;
        const d = book.state.kind === 'Held' ? late : book.delivery;
        const proof = m.releaseKey && d ? (keyProof(d, t.buyer) ?? NO_KEY) : NO_KEY;
        // ADR-0031 §4 (SC-3): the phase-one contracts pay the parties only (core's phase-one profile says the same, whatever
        // the rulebook's payoutsTo). Checked first, so a payout to a third address is refused with its reason before any
        // simulation or transaction; the contract would revert InvalidMessage, which names no reason.
        const other = m.payouts.find((p) => lc(p.to) !== lc(t.buyerPaymentAddress) && lc(p.to) !== lc(t.sellerPayoutAddress));
        if (other) refuse('invalid_terms', `payout recipient ${other.to} is neither the buyer's payment address nor the seller's payout address: the phase-one contracts pay a mutual settlement to those two only (ADR-0031 §4, ADR-0033)`);
        const settle = (at: Timestamp): EscrowEvent[] => [{ type: 'mutual_settle', at, message: m, rule: { allowed: true, payoutsTo: 'parties' }, ...(late ? { delivery: late } : {}) }];
        await this.call(m.commitmentId, 'mutualSettle', [termsView(t), mutualView(m), m.releaseKey && d ? deliveryView(d) : NO_DELIVERY, proof], settle, options, dryRun, 'anyone');
        return m.commitmentId;
      }
      case 'trigger':
        return this.timeout(s.commitmentId, s.timeout, options, dryRun);
    }
  }

  /**
   * The seller's delivery for a deal whose book is not waiting for one (T-230). The seller may have sent it straight to
   * the contract before any pass read that transaction, so the node reads `deliveryHashOf` first and joins a match with
   * no relay. Otherwise it relays, and the contract decides: a read that names a hash the chain does not hold (a lying
   * or forked node) still delivers, and a relay the contract refuses because the deal moved reads the chain again,
   * pinned to the revert's block. A copy the node cannot join yet stays on the book (`posted`) for the next pass, and a
   * repost of a copy the contract already refused sends nothing.
   */
  private async deliver(book: Book, d: Delivery, options: Relay, dryRun: boolean): Promise<Hex32> {
    const id = d.commitmentId;
    const want = deliveryHash(d);
    const following = book.state.kind === 'Held' && !book.behind;
    // A repost of a copy whose relay the contract already refused: read the chain once more, and relay nothing (red team round 2).
    if (following && book.posted?.asked && this.sameCopy(book.posted, want)) {
      await this.check({ ...d, type: 'Delivery' }, book.state.terms.seller, 'Delivery');
      if (dryRun) return id;
      const kept = options.note ? this.keepPosted(id, book, options.note, false) : 'kept';
      await this.catchUp(id, d).catch(() => undefined);
      if (book.behind?.waiting) return this.join(book, d, false);
      if (this.joined(book, want)) return id;
      return refuse('invalid_state', this.keptNotice(d, kept));
    }
    let tried: Kept | undefined;
    if (following) {
      const landed = await this.landedDelivery(id);
      if (landed.kind === 'landed' && lc(landed.hash) === lc(want)) {
        const r = await this.joinLanded(book, d, landed, options, dryRun);
        if (r === 'joined') return id;
        tried = r;
      }
    }
    try {
      await this.call(id, 'deliver', [termsView(book.state.terms), deliveryView(d), d.signature], (at) => [{ type: 'deliver', at, delivery: d }], options, dryRun, book.state.terms.seller, { delivery: d });
      return id;
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      // The deal moved since this node last read the chain. A node a block behind can pass the simulation and see the
      // transaction revert (round 1, scenario 8): the read pinned to the revert's block says what the chain holds.
      let keep = false;
      if (!dryRun && following && book.state.kind === 'Held' && !book.behind && (e instanceof Reverted || e.revert === 'WrongStage')) {
        // The read before the relay saw this delivery and kept the copy: the contract's refusal confirms it.
        if (tried && book.posted && this.sameCopy(book.posted, want)) {
          book.posted.asked = true;
          refuse('invalid_state', this.keptNotice(d, tried));
        }
        const landed = await this.landedDelivery(id, e instanceof Reverted ? e.block : undefined, true);
        if (landed.kind === 'landed') {
          // Another hash is refused there, after the seller's signature.
          const r = await this.joinLanded(book, d, landed, options, false);
          if (r === 'joined') return id;
          if (book.posted && this.sameCopy(book.posted, want)) book.posted.asked = true;
          refuse('invalid_state', this.keptNotice(d, r, landed.block));
        }
        // No read showed a delivery. After this node's own relay reverted, the contract most likely holds one, and the read
        // failed or came from a fork; the signed copy then stays until deliverBy, unconfirmed (red team round 2). After a
        // WrongStage only a read that never answered leaves it open: one that answered saw the deal leave Held with none.
        keep = e instanceof Reverted ? e.at < secs(book.state.terms.timing.deliverBy) : landed.kind === 'unread';
      }
      // Only a copy the seller signed may stand in for the delivery the chain holds (red team: a forged copy joined here
      // when the hash reads trailed).
      const signed = !dryRun && book.state.kind === 'Held' && (await verifyMessage(this.domain, { ...d, type: 'Delivery' }, book.state.terms.seller));
      // A deal that moved some other way (a reclaim), or a hash read that failed: follow it, then refuse.
      if (e.revert === 'WrongStage' && !dryRun && book.state.kind === 'Held') {
        await this.catchUp(id, signed ? d : undefined);
        if (book.behind?.waiting) return this.join(book, d, false);
        if (signed && this.joined(book, want)) return id;
      }
      if (keep && signed && options.note && book.state.kind === 'Held' && !book.behind) {
        const kept = this.keepPosted(id, book, options.note, false);
        if (book.posted && this.sameCopy(book.posted, want)) book.posted.asked = true;
        refuse(e.problem.type, `${e.problem.detail}. ${this.unconfirmedNotice(kept)}`);
      }
      // In `deliver`, InvalidMessage comes only from the attempt check, after the stage and deadline checks, as in
      // core; the contract has no bytes left for its own error, so the name core gives it is restored here.
      if (d.attempt !== 1 && e.revert === 'InvalidMessage') {
        refuse('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${book.state.terms.timing.maxSubmissions} (${e.problem.detail})`);
      }
      throw e;
    }
  }

  /** True when the book holds delivery `want`, joined. */
  private joined(book: Book, want: Hex32): boolean {
    return book.state.kind !== 'Held' && !!book.delivery && lc(deliveryHash(book.delivery)) === lc(want);
  }

  /** True when a kept copy is delivery `want`. */
  private sameCopy(p: PostedCopy, want: Hex32): boolean {
    return lc(deliveryHash(deliveryOf(p.note)!)) === lc(want);
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
  private agree(m: Agree, via: string, dryRun: boolean, deferred = false): { id: Hex32; announce: (at?: Timestamp) => void; undo: () => void } {
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
    // Deferred, at the funding's block: a restart before the receipt rebuilds the same event (T-219).
    const announce = (at?: Timestamp) => this.emit('commitment.agreed', m.commitmentId, m.buyer, via, { source: 'adapter', termsHash: m.commitmentId }, false, at);
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
  private async fund(m: Extract<Submission, { kind: 'fund' }>['message'], fee: TransferAuthorization | null, options: Relay, mined?: (at: Timestamp) => void): Promise<Hex32> {
    const book = this.bookOf(m.commitmentId);
    if (book.state.kind !== 'Agreed' || !book.acceptance || !book.agree) return refuse(book.state.kind === 'Offered' ? 'acceptance_missing' : 'invalid_state', `funding needs an agreed commitment; it is ${book.state.kind}`);
    const terms = book.state.terms;
    const t = termsView(terms);
    const expected = await this.fundingAuthorization(terms);
    // ADR-0033: the token checks the payer the terms name and ignores `from`, so check it here, as core does.
    if (lc(m.from) !== lc(terms.buyerPaymentAddress)) refuse('invalid_signature', `funding authorization is not from the buyer's payment address ${terms.buyerPaymentAddress}`);
    if (lc(m.token) !== this.token || BigInt(m.value) !== expected.value || m.nonce !== expected.nonce || m.scheme !== 'erc3009') {
      refuse('invalid_terms', 'on EVM the funding is an ERC-3009 authorization of price + fee to the CPP collector, nonce = the payer-agnostic PaymentInfo hash (ADR-0025)');
    }
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId, terms, book.club);
    // ADR-0033: the payment address funds the hold, so its balance covers it; the mandate stays on the buyer.
    const balance = await this.tokenBalance(terms.buyerPaymentAddress, true);
    const args = [t, book.sellerSignature, acceptanceView(book.acceptance), agreeView(book.agree), { signature: m.signature }];
    const mirror = (at: Timestamp): EscrowEvent[] => [{ type: 'fund', at, message: m, buyerScope, balance: this.amount(balance), gasBuffer: this.amount(0n) }];
    const ctx: CallContext = mined ? { mined } : {};
    if (!fee) {
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options, false, m.from, ctx);
      return m.commitmentId;
    }
    if (lc(fee.from) !== lc(terms.buyerPaymentAddress)) refuse('invalid_terms', `the operator fee must come from the buyer's payment address ${terms.buyerPaymentAddress}`);
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
      const feePaid = paid ? 'by an earlier transaction' : 'unverified';
      // The row keeps how this node saw the earlier payment, so a restart records the same fee line (T-219).
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options.note ? { ...options, note: { ...options.note, feePaid } } : options, false, m.from, ctx);
      this.emit('fee.operator', m.commitmentId, m.from, options.via ?? 'direct', { source: 'adapter', from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)), paid: feePaid }, false);
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
    const { token, fromBlock } = this.world.deployment;
    const latest = await this.world.publicClient.getBlockNumber();
    // On a live chain, only the blocks since the terms were made (about 12 s each), within one RPC range.
    const span = BigInt(Math.min(50_000, Math.ceil(Math.max(0, Date.parse(this.now()) - Date.parse(since)) / 12_000) + 50));
    const from = this.wall && latest - span > fromBlock ? latest - span : fromBlock;
    const used = await this.world.publicClient.getLogs({ address: token, event, args: { authorizer: getAddress(fee.from), nonce: fee.nonce }, fromBlock: from, toBlock: latest });
    const at = used[0];
    if (!at) return false;
    const receipt = await this.world.publicClient.getTransactionReceipt({ hash: at.transactionHash! });
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

  private async timeout(id: Hex32, timeout: TimeoutKind, options: Relay, dryRun: boolean): Promise<Hex32> {
    const book = this.bookOf(id);
    // T-231: the operators send due timeouts on their own, so a party's trigger can arrive after the timeout ran. It
    // answers the state that timeout left and sends nothing, as `apply_default` does. A deal behind the chain logs no
    // event for its later steps, so the contract still answers for it. Each timeout runs at most once per deal while the
    // contract takes one delivery attempt (maxSubmissions 1, ADR-0007); a resubmission would need this check per attempt.
    const ran = RAN[timeout];
    if (ran && !book.behind && this.log_.some((e) => e.commitmentId === id && e.type === ran)) return id;
    const t = termsView(book.state.terms);
    switch (timeout) {
      case 'expire_offer': {
        // ADR-0031 §7 (SC-6): the phase-one contracts keep no record of an unfunded offer's expiry, and from its
        // deadline agreeAndFund refuses it. So the expiry is this node's own record, by its clock: core steps it, the
        // log says `offer.expired`, and no transaction goes out. The contract still holds the deal as None.
        // Behind the chain (T-218), the contract has moved this deal: it is no unfunded offer.
        if (book.behind) refuse('invalid_state', this.lag(id)!);
        const at = this.now();
        const before = book.state;
        const next = this.stepped(before, { type: 'expire', at });
        // Before SC-6 the contract closed two races by refusing expireOffer: a funding this node has not synced (relayed by
        // another operator, or sent directly), and a node clock ahead of the chain's. One free read of one block closes
        // both: the deal is None there, and on a live chain that block's own time has passed the deadline after which
        // agreeAndFund refuses it (min of offerExpiresAt and fundBy), so no later block can fund it.
        const block = await this.world.publicClient.getBlock({ blockTag: 'latest' });
        const timing = before.terms.timing;
        const due = Math.min(Date.parse(timing.offerExpiresAt), Date.parse(timing.fundBy));
        if (this.wall && Number(block.timestamp) * 1000 < due) {
          refuse('invalid_state', `the chain's latest block (${toTimestamp(Number(block.timestamp) * 1000)}) is still before this offer's deadline ${toTimestamp(due)}, so it can still be funded; ask again after that block time`);
        }
        const onChain = await this.stage(id, block.number ?? undefined);
        if (onChain.stage !== 'None') {
          refuse('invalid_state', `the contract holds this deal ${onChain.stage}: it was funded, so it is not an expired offer. This node applies the funding at its next sync`);
        }
        if (dryRun) return id;
        book.state = next;
        this.emit('offer.expired', id, 'anyone', options.via ?? 'direct', { from: before.kind }, false, at);
        return id;
      }
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
      case 'appeal_expiry':
        // ADR-0031 §8: a first decision is final at once on the phase-one contracts, so no appeal window is left to close.
        return refuse('invalid_state', PHASE_ONE_NO_APPEAL);
      case 'settle':
        return refuse('invalid_state', 'settle applies to settle_after_window (Phase 4); guaranteed_on_decision settles at the decision');
    }
  }

  private async call(id: Hex32, fn: string, args: unknown[], mirror: (at: Timestamp) => EscrowEvent[], options: Relay, dryRun: boolean, actor: Address | 'anyone', ctx: CallContext = {}): Promise<void> {
    const data = encodeFunctionData({ abi: this.world.abis.rules, functionName: fn, args });
    await this.send(id, fn, this.world.deployment.rules, data, mirror, options, dryRun, actor, ctx);
  }

  /** Steps the core mirror through what the contract accepted; a refusal there is a divergence, never a refusal. */
  private mirrored(state: EscrowState, events: readonly EscrowEvent[], fn: string): EscrowState {
    let next = state;
    for (const e of events) {
      const r = step(next, e, 'phase_one', this.world.beaconMarginSec);
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
  private async send(id: Hex32, fn: string, to: Address, data: Hex, mirror: (at: Timestamp) => EscrowEvent[], options: Relay, dryRun: boolean, actor: Address | 'anyone', ctx: CallContext = {}): Promise<void> {
    const book = this.bookOf(id);
    // The chain moved this deal past the book (T-218): the mirror cannot check a relay against it. A timeout carries no
    // signed message, and the contract checks it against dealOf and the terms' deadlines in the simulation below, so it
    // is still relayed and a party with no gas can close the deal (T-228). Signed steps wait for T-227.
    if (book.behind && !TIMEOUTS.has(fn)) refuse('invalid_state', this.lag(id)!);
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
    // The mirror must accept what the contract accepted; run it before sending so a divergence changes nothing. A deal
    // behind has no mirror step: its receipt moves it as a transaction read from the chain does (`landBehind`).
    const before = book.state;
    const next = book.behind ? before : this.mirrored(before, mirror(at), fn);
    if (dryRun) return;
    let mined: Mined;
    // T-219: what the relayer lane's row keeps, so a restart before the receipt applies this call as this relay.
    const note: RelayNote | undefined = key || !options.note ? undefined : { ...options.note, call: fn, ...(ctx.delivery && options.note.submission.kind !== 'deliver' ? { delivery: ctx.delivery } : {}) };
    try {
      mined = await this.world.send({ ...(key ? { key } : { lane: id }), to, data, ...(note ? { note } : {}) }, this.wall ? undefined : time);
    } catch (e) {
      // The relayer declines (out of test ETH, gas above its cap): the signed message stays valid elsewhere (D27).
      if (e instanceof RelayRefused) refuse('relay_refused', `this operator cannot relay it now: ${e.message}; submit the same signed message through another operator or directly to the settlement layer`);
      throw e;
    }
    if (mined.status !== 'success') {
      if (!this.wall) throw new Error(`${fn} reverted on chain after a passing simulation: ${mined.hash}`);
      this.done(mined.hash, options);
      // On a live chain the state or a deadline can move between the simulation and the block; only gas was spent.
      throw new Reverted(problem('invalid_state', `${fn} reverted on chain in ${mined.hash} after a passing simulation (the state or a deadline moved in between); nothing changed`), mined.blockNumber, mined.timestamp);
    }
    this.balanceCache.clear();
    if (book.behind) return this.landBehind(id, book, fn, to, data, mined, options);
    const blockAt = toTimestamp(mined.timestamp * 1000);
    const after = blockAt === at ? next : this.mirrored(before, mirror(blockAt), fn);
    const logs = this.decode(mined.logs);
    // The book moves in record, after these reads: a read that fails leaves it untouched, so the next pass applies the
    // mined call as a missed receipt (review M2). Both read at the receipt's block: at the latest block, an RPC node a
    // block behind can answer the state before this call, and the call's events are lost (the inferred cause of T-216
    // round 1's lost delivery, 2026-11-04).
    const expect = chainStageOf(after.kind);
    const onChain = await this.atReceipt(() => this.stage(id, mined.blockNumber), (s) => s.stage === expect);
    if (onChain.stage !== expect) throw new Error(`EVM/core divergence after ${fn}: the contract is ${onChain.stage}, core is ${after.kind}`);
    // ADR-0029: the delivery the contract stored is the one the mirror holds, since every later signature names it.
    if (ctx.delivery) {
      const want = deliveryHash(ctx.delivery);
      const stored = await this.atReceipt(() => this.read<Hex32>(this.world.deployment.rules, this.world.abis.rules, 'deliveryHashOf', [id], mined.blockNumber), (h) => h === want);
      if (stored !== want) throw new Error(`EVM/core divergence after ${fn}: the contract stores delivery ${stored}, core holds ${want}`);
    }
    this.record(id, book, fn, before, after, logs, mined, blockAt, options.via ?? 'direct', actor, ctx);
    this.relayedAt.set(id, this.log_.length);
    this.done(mined.hash, options);
  }

  /**
   * A timeout this node relayed for a deal behind the chain is mined (T-228). It moves the deal as a transaction read
   * from the chain does (`stillBehind`): dealOf's stage at the receipt's block, the keys its logs release, and no rebuilt
   * step. A read that fails, or still shows the stage before the timeout, leaves the book and the lane row as they were,
   * and the next pass applies the receipt with its own dealOf read (as `send`, review M2).
   */
  private async landBehind(id: Hex32, book: Book, fn: string, to: Address, data: Hex, mined: Mined, options: Relay): Promise<void> {
    const was = book.behind!;
    // Every timeout moves the stage: an answer that did not move it comes from a node that lags or follows another fork
    // (red-team on PR 207, attack.t228-stale-receipt-read).
    const stage = await this.atReceipt(() => this.stage(id, mined.blockNumber), (s) => s.stage !== was.stage);
    if (stage.stage === was.stage) throw new Error(`dealOf at ${fn}'s block (${mined.hash}) still shows ${was.stage}; the next sync pass applies the receipt`);
    const tx = chainTx(mined, to, data);
    this.seen(id, mined.hash, book);
    // A deal waiting for its posted delivery records the transaction when it joins.
    if (!was.waiting) this.txs.push({ commitmentId: id, call: fn, hash: mined.hash, from: mined.from, via: options.via ?? 'direct', gasUsed: mined.gasUsed, at: toTimestamp(mined.timestamp * 1000) });
    this.stillBehind(id, book, tx, stage);
    this.relayedAt.set(id, this.log_.length);
    this.done(mined.hash, options);
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
    ctx.mined?.(blockAt);
    if (ctx.operatorFee) this.emit('fee.operator', id, actor, via, { ...ctx.operatorFee, ...tx }, true, blockAt);
    for (const { type, log } of eventTypesFor(fn, logs)) {
      if (type === 'key.released' && log) {
        const a = log.args as { recipient: Address; path: number; scheme: string; ciphertext: string };
        const envelope = { recipient: getAddress(a.recipient), scheme: a.scheme, ciphertext: a.ciphertext } as EncryptedKey;
        // A node behind the chain recorded this envelope already when it read the transaction (`behind`); the join
        // records it once, as that path does (T-357 review, L4).
        if (book.released.some((k) => lc(k.recipient) === lc(envelope.recipient) && k.ciphertext === envelope.ciphertext)) continue;
        book.released.push(envelope);
        this.emit(type, id, actor, via, { recipient: envelope.recipient, envelope, path: KEY_PATHS[a.path] ?? String(a.path), ...tx }, true, blockAt);
      } else {
        this.emit(type, id, actor, via, { ...this.payloadOf(type, before, after, ctx, log), ...tx }, true, blockAt);
      }
      if (type === 'delivery.submitted' && ctx.delivery) this.landDelivery(book, ctx.delivery, id, actor, via, blockAt);
    }
    this.custody(fn, before, after, ctx, id, via, blockAt);
  }

  /** The delivery is on chain: its envelopes are held here, and the primary's is released for it to judge (ADR-0020). */
  private landDelivery(book: Book, d: Delivery, id: Hex32, actor: Address | 'anyone', via: string, at: Timestamp): void {
    book.delivery = d;
    delete book.carried;
    book.held = d.encryptedKeys.map(signedEnvelope);
    this.releaseHeld(book, id, book.state.terms.adjudication.adjudicator, actor, via, 'delivery', at);
  }

  /** Envelopes a call hands to the next adjudicator, as SimChain releases them: at takeover or escalation. */
  private custody(fn: string, before: EscrowState, after: EscrowState, ctx: CallContext, id: Hex32, via: string, at: Timestamp): void {
    const book = this.books.get(id)!;
    const a = after.terms.adjudication;
    if (fn === 'triggerFallback') this.releaseHeld(book, id, a.fallbackAdjudicator, 'anyone', via, 'fallback takeover', at);
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
      case 'settlement.released':
        return c.decision ? {} : { via: 'early_accept' };
      case 'settlement.refunded':
        return c.decision ? {} : { via: 'default_outcome', from: before.kind };
      case 'commitment.settled':
        return after.kind === 'Settled' ? { payouts: after.payouts, keyReleased: after.keyReleased } : {};
      case 'offer.expired':
      case 'default.triggered':
        return { from: before.kind };
      case 'fallback.triggered':
        // The contract's round, from its FallbackTriggered log, so it stays right for any beacon (drand, T-217).
        return { beaconRound: log ? Number(log.args['beaconRound']) : beaconRoundFor(after, 'fallback', this.world.beaconMarginSec) };
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
   * Deals whose stage a direct call may still change within their terms, for the world's cadence (T-218):
   * - an accepted offer until the earlier of offerExpiresAt and fundBy (after that nothing can fund it), and a funded deal until
   *   an hour after the last deadline ahead of it (deliverBy, judgeBy, fallbackBy, an escalation's appealDecideBy);
   * - `recent`: its book moved in the last day, or one of its deadlines is within an hour of now; the world reads the
   *   chain at least once a minute while any is. `idle`: open but quiet, read every 15 minutes, so far-off deadlines
   *   (D31 allows any) do not keep a world polling every minute (red-team 2026-11-04, finding 3).
   * A timeout sent after the window shows at the next pass anything else starts.
   */
  openDeals(): { recent: number; idle: number } {
    const now = Date.parse(this.now());
    const out = { recent: 0, idle: 0 };
    for (const b of this.books.values()) {
      const s = b.state;
      // An offer the primary has not accepted cannot be funded: posting offers alone keeps no cadence (red-team round 2, E).
      if (s.kind === 'Offered' || s.kind === 'Expired' || s.kind === 'Settled' || this.finalAt(b) !== null) continue;
      const t = s.terms.timing;
      const deadlines = PRE_FUNDING.includes(s.kind) ? [Math.min(Date.parse(t.offerExpiresAt), Date.parse(t.fundBy))] : [t.deliverBy, t.judgeBy, t.fallbackBy].map(Date.parse);
      if (s.kind === 'Escalated') deadlines.push(Date.parse(s.escalation.appealDecideBy));
      if (now >= Math.max(...deadlines) + OPEN_GRACE_MS) continue;
      // An accepted offer is recent only for an hour after it last moved: offers whose deadlines chain one after
      // another must not keep a world on the minute cadence (red-team round 3, H3). A funded deal is recent near any
      // of its deadlines, or for a day after it last moved.
      const quiet = now - Date.parse(b.updatedAt);
      // A copy the contract was read to hold (T-230) waits for the next pass, which its notice says comes within about a
      // minute. An unconfirmed one keeps the usual cadence: a far-off deliverBy (D31) must not keep a world polling.
      const recent = PRE_FUNDING.includes(s.kind) ? quiet < OPEN_GRACE_MS : deadlines.some((d) => Math.abs(now - d) < OPEN_GRACE_MS) || quiet < RECENT_MS || !!b.posted?.confirmed;
      if (recent) out.recent++;
      else out.idle++;
    }
    return out;
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
  async observe(txs: readonly ChainTx[], stages: ReadonlyMap<Hex32, { stage: string }>, mark = this.log_.length): Promise<ObserveReport> {
    const report: ObserveReport = { applied: 0, seen: 0, behind: 0, unknown: 0 };
    // T-230: a deal holding a kept copy reads its own transactions first, in chain order, so a pass whose log read trailed
    // past the copy's block still joins it, before any later step of the same deal in this pass (a direct takeover, red
    // team round 2). An answer a failed read left unstored is stored. Best effort: the pass goes on either way.
    for (const [id, book] of this.books) {
      if (!book.posted) continue;
      await this.enqueue(id, async () => {
        if (book.state.kind === 'Held' && !book.behind) {
          const r = await this.catchUp(id).catch(() => null);
          if (r) for (const k of ['applied', 'behind'] as const) report[k] += r[k];
        }
        await this.settlePosted(id, book).catch(() => undefined);
      });
    }
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
      if (!book || book.behind || (this.relayedAt.get(id) ?? -1) > mark) continue;
      const s = book.state;
      const expect = chainStageOf(s.kind);
      if (stage.stage !== expect) {
        this.fallBehind(id, book, { hash: last.get(id) ?? ('0x' as Hex) }, stage, `the contract holds this deal ${stage.stage}, while this node's book rebuilt it to ${s.kind}.`);
        report.behind++;
      }
    }
    return report;
  }

  /**
   * One transaction for one commitment, inside its lane. Never throws for what the transaction holds: the deal falls
   * behind. A transaction this node relayed before a restart (its lane row is still open, T-219) is applied as that
   * relay, with the row's messages, and the row's Idempotency-Key then answers a retry with the mined result.
   */
  private async follow(id: Hex32, tx: ChainTx, stage: { stage: string } | undefined, known?: Delivery): Promise<keyof Omit<ObserveReport, 'unknown'>> {
    const book = this.books.get(id)!;
    const note = this.noteOf(tx.hash, id);
    if (this.applied(id, tx.hash)) {
      if (note) {
        await this.answer(id, book, note, this.log_.filter((e) => e.commitmentId === id && lc(String(e.payload['tx'])) === lc(tx.hash)));
        this.done(tx.hash);
      }
      // T-230: a kept copy whose answer an earlier read failed to store.
      if (book.posted) await this.settlePosted(id, book).catch(() => undefined);
      return 'seen';
    }
    this.seen(id, tx.hash, book);
    if (book.behind) {
      const mark = this.log_.length;
      this.stillBehind(id, book, tx, stage);
      if (note) {
        // The contract took the relayed call: a retry with its Idempotency-Key replays this answer (red-team on PR 207).
        await this.answer(id, book, note, this.log_.slice(mark).filter((e) => e.commitmentId === id));
        this.done(tx.hash);
      }
      return 'behind';
    }
    const from = this.log_.length;
    let r: 'applied' | 'behind';
    try {
      r = await this.step(id, book, tx, stage, known ?? (note ? deliveryOf(note) : undefined), note);
    } catch (e) {
      // A value core cannot represent (an expiry past year 275760, review H2) or any other rebuild failure.
      r = this.fallBehind(id, book, tx, stage, `this node could not rebuild transaction ${tx.hash}: ${(e as Error).message}.`);
    }
    if (note) {
      if (r === 'applied') {
        this.feeNote(id, note);
        await this.answer(id, book, note, this.log_.slice(from).filter((e) => e.commitmentId === id));
      }
      this.done(tx.hash);
    }
    // T-230: the seller's kept copy joined with this transaction; a retry of that post replays this answer. A failed read
    // keeps the copy for the next pass.
    if (book.posted) await this.settlePosted(id, book).catch(() => undefined);
    return r;
  }

  /**
   * A mined transaction for a deal already behind the chain (T-218): dealOf's stage, the transaction queued when only
   * the posted delivery is missing, and the keys it releases.
   */
  private stillBehind(id: Hex32, book: Book, tx: ChainTx, stage: { stage: string } | undefined): void {
    if (stage) Object.assign(book.behind!, stage);
    book.behind!.waiting?.push(tx);
    this.dirty.add(id);
    this.custodyBehind(id, book, tx);
  }

  /** The note of this node's own open lane row that sent `hash` for this commitment (T-219), if any. */
  private noteOf(hash: string, id: Hex32): RelayNote | undefined {
    const note = this.world.rowOf?.(hash)?.note;
    return note && lc(note.commitmentId) === lc(id) ? note : undefined;
  }

  /** The funding went alone after an earlier fee payment: the fee line `fund` writes after it (T-219). */
  private feeNote(id: Hex32, note: RelayNote): void {
    const s = note.submission;
    if (note.feePaid === undefined || s.kind !== 'agree_and_fund' || !s.operatorFee) return;
    const fee = s.operatorFee;
    this.emit('fee.operator', id, s.funding.from, note.via, { source: 'adapter', from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)), paid: note.feePaid }, false);
  }

  /**
   * The answer `process` would have kept for the relayed submission (hard rule: idempotency): a retry with the same
   * Idempotency-Key and body replays it, and another body under that key is idempotency_conflict.
   */
  private async answer(id: Hex32, book: Book, note: RelayNote, events: SettlementEvent[]): Promise<void> {
    const key = note.idempotencyKey;
    if (key === undefined || note.body === undefined || this.idempotency.has(key)) return;
    const result: Extract<SubmitResult, { ok: true }> = { ok: true, commitmentId: id, state: await this.view(id, book, { bestEffort: true }), events, replayed: false, dryRun: false, signatureCheck: note.submission.kind === 'trigger' ? 'none' : 'verified' };
    this.idempotency.set(key, { body: note.body, result: structuredClone(result) });
    book.replays = { ...book.replays, [key]: { body: note.body, result: structuredClone(result) } };
    this.dirty.add(id);
  }

  /**
   * Lands the transactions this node broadcast before a restart (T-219), each inside its commitment's lane: the row's
   * receipt (rebroadcast while it is not mined), then T-218's path with the relay's label and messages. The world calls
   * it on its first pass after opening, before the sync and the adjudicators. The relayer lanes resolve side by side,
   * each in nonce order, so a pass waits for its slowest lane, not for the sum of their receipt waits (review,
   * 2026-11-04). Never throws: a row an RPC error left open counts as failed and waits for the next pass.
   */
  async recover(): Promise<RecoverReport> {
    const report: RecoverReport = { applied: 0, seen: 0, behind: 0, reverted: 0, dropped: 0, unknown: 0, failed: 0, errors: [] };
    const bySender = new Map<string, LaneRow[]>();
    for (const row of this.world.inFlight?.() ?? []) bySender.set(lc(row.from), [...(bySender.get(lc(row.from)) ?? []), row]);
    await Promise.all(
      [...bySender.values()].map(async (rows) => {
        for (const row of rows) {
          try {
            report[await this.enqueue(row.note?.commitmentId ?? '', () => this.land(row))]++;
          } catch (e) {
            report.failed++;
            report.errors.push((e as Error).message);
          }
        }
      }),
    );
    return report;
  }

  /** One open row, inside its commitment's lane. Throws on an RPC error, having applied nothing. */
  private async land(row: LaneRow): Promise<Exclude<keyof RecoverReport, 'failed' | 'errors'>> {
    const mined = await this.world.resume!(row);
    if (!mined) return 'dropped';
    const note = row.note;
    const id = note?.commitmentId;
    const book = id ? this.books.get(id) : undefined;
    if (mined.status !== 'success' || !note || !id || !book) {
      if (mined.status !== 'success' && note?.call === 'deliver' && id && book) await this.keepLanded(id, book, note, mined).catch(() => undefined);
      this.done(mined.hash);
      return mined.status !== 'success' ? 'reverted' : 'unknown';
    }
    if (note.call === 'transferWithAuthorization') {
      // The operator fee alone leaves no rules-contract log for the sync to find: the row is its only record.
      const s = note.submission;
      if (this.applied(id, mined.hash) || s.kind !== 'agree_and_fund' || !s.operatorFee) {
        this.done(mined.hash);
        return 'seen';
      }
      const from = this.log_.length;
      this.landFee(id, s.operatorFee, mined, note.via);
      await this.answer(id, book, note, this.log_.slice(from).filter((e) => e.commitmentId === id));
      // After the answer, as `follow` does: the row goes only with the book that holds it.
      this.done(mined.hash);
      return 'applied';
    }
    const t = parseTransaction(row.raw);
    const tx = chainTx(mined, t.to ? getAddress(t.to) : null, t.data ?? '0x');
    const r = await this.follow(id, tx, await this.stage(id).catch(() => undefined));
    // Outside a pass: a pass that read dealOf before this does not check the deal (as catchUp).
    this.relayedAt.set(id, this.log_.length);
    return r;
  }

  /**
   * Envelopes for a deal the book cannot follow, from what the chain confirms (T-218): a key the transaction released
   * on chain is served, and each adjudicator whose turn dealOf shows gets its envelope from the delivery, as a relayed
   * takeover or escalation would hand it. A takeover forwarded by a contract this node cannot read must not
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
    for (const [recipient, path] of turns) if (!book.released.some((k) => lc(k.recipient) === lc(recipient))) this.releaseHeld(book, id, recipient, 'anyone', 'direct', path, at);
    this.dirty.add(id);
  }

  /**
   * Rebuilds what a mined transaction did to one commitment and records it as a relayed call is recorded. Three ways,
   * tried in order (review and red-team, 2026-11-04):
   * - timeouts, from the logs alone: they carry no signed message, so any wrapper or bundle shape is followed;
   * - the one rules call a readable transaction ran for this deal (`rulesCalls`: top level, or a bundle whose calls
   *   all ran);
   * - the one rules call written in another contract's calldata (`embeddedCalls`) whose signatures verify.
   * Each rebuilt call must match the receipt's logs. Anything else puts the deal behind.
   */
  private async step(id: Hex32, book: Book, tx: ChainTx, stage: { stage: string } | undefined, known?: Delivery, note?: RelayNote): Promise<'applied' | 'behind'> {
    const logs = this.decode(tx.logs.filter((l) => l.topics[1] === id && lc(l.address) === lc(this.world.deployment.rules)) as unknown as Log[]);
    const timeouts = this.timeoutsFromLogs(book.state, logs);
    if (timeouts) {
      for (const t of timeouts) {
        const r = this.applyRebuilt(id, book, tx, stage, { fn: t.fn, steps: t.steps, actor: 'anyone', ctx: {}, signed: async () => true }, t.logs, note);
        if (r === 'behind') return r;
      }
      return 'applied';
    }
    // A delivery alone is read from its JobSubmitted log too, whatever sent it: the seller's posted copy can then always
    // join (red-team round 2, G3).
    const rulesLogs = logs.filter((l) => lc(l.address) === lc(this.world.deployment.rules));
    if (rulesLogs.length === 1 && rulesLogs[0]!.eventName === 'JobSubmitted' && book.state.kind === 'Held') {
      const landed = rulesLogs[0]!.args['deliverable'] as Hex32;
      const d = [known, book.carried, book.delivery, postedOf(book)].find((x): x is Delivery => !!x && deliveryHash(x) === landed);
      if (!d) return this.fallBehind(id, book, tx, stage, `the seller's delivery landed in transaction ${tx.hash} without passing through this node, and the contract keeps only its hash (${landed}), so this node holds no envelopes for the adjudicators.`, [tx]);
      return this.applyRebuilt(id, book, tx, stage, { fn: 'deliver', steps: (at) => [{ type: 'deliver', at, delivery: d }], actor: book.state.terms.seller, ctx: { delivery: d }, signed: async () => true }, logs, note);
    }
    const view = termsView(book.state.terms);
    const readable = rulesCalls(this.world, tx);
    const seenCall = new Set<string>();
    // Timeouts come from the logs alone (above): one read from calldata may never have run (red-team round 2, A and B).
    const candidates = (readable ?? embeddedCalls(this.world, tx.input, view)).filter((c) => {
      const k = JSON.stringify(toJson(c));
      if (TIMEOUTS.has(c.fn) || !sameView(c.args[0], view) || seenCall.has(k)) return false;
      seenCall.add(k);
      return true;
    });
    if (readable && candidates.length !== 1) return this.fallBehind(id, book, tx, stage, `transaction ${tx.hash} made ${candidates.length} signed calls for this deal; this node rebuilds one signed call per transaction.`);
    const accepted: Array<Exclude<Rebuilt, { wait: string } | { fail: string }>> = [];
    const waits: string[] = [];
    let why = readable ? '' : `transaction ${tx.hash} called contract ${tx.to}, and its calldata shows no call for this deal that its logs and signatures confirm.`;
    for (const c of candidates) {
      const r = this.rebuild(id, book, c, tx, known, note);
      if ('wait' in r) {
        // A call that carries a delivery this node never held waits for it, but only once the logs and (for a call read
        // out of another contract) its signature say it ran: a planted call must not cancel the join (red-team round 3).
        if (this.waitUnconfirmed(c, logs, book.state.terms) || (!readable && !(await this.waitSigned(id, book, c)))) continue;
        waits.push(r.wait);
      }
      else if ('fail' in r) why = r.fail;
      else {
        const off = this.unconfirmed(r, logs, book.state.terms);
        if (off) why = `transaction ${tx.hash}'s logs do not show the ${r.fn} this node read from its calldata: ${off}.`;
        else if (!readable && !(await r.signed())) why = `the ${r.fn} written in transaction ${tx.hash}'s calldata does not carry valid signatures this node can check (contract signers, ERC-1271, are not read).`;
        else accepted.push(r);
      }
    }
    if (accepted.length === 1) {
      const r = accepted[0]!;
      // The operators' own fee leg rides in the same bundle (ADR-0023): a missed receipt still records it (review L4),
      // when the buyer's own transfer moved it (red-team round 2, D: anyone can spend a nonce of their own).
      const fee = this.feeLeg(id, book.state.terms.buyerPaymentAddress, tx);
      if (fee) r.ctx = { ...r.ctx, operatorFee: fee };
      return this.applyRebuilt(id, book, tx, stage, r, logs, note);
    }
    // Candidates the logs or signatures rejected do not count: a planted call cannot stop a delivery from joining.
    if (accepted.length === 0 && waits.length === 1) return this.fallBehind(id, book, tx, stage, waits[0]!, [tx]);
    return this.fallBehind(id, book, tx, stage, accepted.length > 1 ? `transaction ${tx.hash} carries ${accepted.length} calls for this deal that its logs confirm; this node cannot tell which ran.` : why);
  }

  /** Why a call that carries a delivery (a decision or an early accept in Held) does not match the logs, or null. */
  private waitUnconfirmed(c: RulesCall, logs: readonly DecodedLog[], terms: AnyCommitmentTerms): string | null {
    const has = (name: string) => logs.find((l) => l.eventName === name && lc(l.address) === lc(this.world.deployment.rules));
    const v = c.args[1] as Record<string, unknown>;
    if (c.fn === 'decide') {
      const d = has('Decided');
      return d && Number(d.args['role']) === Number(v['role']) && Number(d.args['outcome']) === Number(v['outcome']) && lc(String(d.args['judgmentRecordHash'])) === lc(String(v['judgmentRecordHash'])) && lc(String(d.args['seed'])) === lc(String(v['seed'])) ? null : 'no matching Decided';
    }
    if (c.fn === 'earlyAccept') {
      const done = has('JobCompleted');
      return done && !has('Decided') && lc(String(done.args['evaluator'])) === lc(terms.buyer) ? null : 'no early acceptance by the buyer';
    }
    // SC-5b (T-357): a settlement in Held that released the key of a delivery nobody posted.
    if (c.fn === 'mutualSettle') {
      const s = has('MutuallySettled');
      return s && s.args['keyReleased'] === true && v['releaseKey'] === true && v['hasDelivery'] === true ? null : 'no settlement that released a key';
    }
    return `${c.fn} carries no delivery`;
  }

  /** Whether a waiting call's own signed message verifies (the delivery it carries is checked when posted). */
  private async waitSigned(id: Hex32, book: Book, c: RulesCall): Promise<boolean> {
    const v = c.args[1] as Record<string, unknown>;
    if (c.fn === 'decide') {
      const m = this.decisionFrom(id, book, v);
      return typeof m !== 'string' && verifyMessage(this.domain, m, m.adjudicator);
    }
    if (c.fn === 'earlyAccept') {
      const buyer = book.state.terms.buyer;
      const m: EarlyAccept = { type: 'EarlyAccept', commitmentId: id, buyer, attempt: Number(v['attempt']), deliveryHash: v['deliveryHash'] as Hex32, nonce: v['nonce'] as Hex32, expiresAt: chainTime(v['expiresAt']), signature: v['signature'] as Hex };
      return verifyMessage(this.domain, m, buyer);
    }
    if (c.fn === 'mutualSettle') {
      const { buyer, seller } = book.state.terms;
      const m: MutualSettlement = {
        type: 'MutualSettlement',
        commitmentId: id,
        deliveryHash: v['hasDelivery'] ? (v['deliveryHash'] as Hex32) : null,
        payouts: (v['payouts'] as Array<{ to: Address; amount: bigint }>).map((p) => ({ to: getAddress(p.to), amount: this.amount(BigInt(p.amount)) })),
        releaseKey: Boolean(v['releaseKey']),
        nonce: v['nonce'] as Hex32,
        expiresAt: chainTime(v['expiresAt']),
        buyerSignature: v['buyerSignature'] as Hex,
        sellerSignature: v['sellerSignature'] as Hex,
      };
      return verifyMutualSettlement(this.domain, m, buyer, seller);
    }
    return false;
  }

  /** The operator fee a readable bundle paid for this deal: the buyer's payment address's own ERC-3009 transfer, shown by the token's Transfer log. */
  private feeLeg(id: Hex32, payer: Address, tx: ChainTx): { from: string; to: string; amount: TokenAmount } | null {
    const leg = feeLegs(this.world, tx).find((f) => f.nonce === operatorFeeNonce(id) && lc(f.from) === lc(payer));
    if (!leg) return null;
    const moved = this.decode(tx.logs.filter((l) => lc(l.address) === lc(this.world.deployment.token)) as unknown as Log[]).some(
      (l) => l.eventName === 'Transfer' && lc(String(l.args['from'])) === lc(payer) && lc(String(l.args['to'])) === lc(leg.to) && BigInt(String(l.args['amount'] ?? l.args['value'] ?? 0)) === leg.value,
    );
    return moved ? { from: lc(leg.from), to: lc(leg.to), amount: this.amount(leg.value) } : null;
  }

  /**
   * Steps the mirror through one rebuilt call at the block's time and records it with its own logs: labelled
   * `direct`, or as this node's relay when its lane row holds the note (T-219).
   */
  private applyRebuilt(id: Hex32, book: Book, tx: ChainTx, stage: { stage: string } | undefined, r: Exclude<Rebuilt, { wait: string } | { fail: string }>, logs: readonly DecodedLog[], note?: RelayNote): 'applied' | 'behind' {
    const before = book.state;
    const blockAt = toTimestamp(tx.timestamp * 1000);
    let after: EscrowState;
    try {
      after = this.mirrored(before, r.steps(blockAt), r.fn);
    } catch (e) {
      return this.fallBehind(id, book, tx, stage, `${(e as Error).message}.`);
    }
    this.record(id, book, r.fn, before, after, logs, { hash: tx.hash, from: tx.from, blockNumber: BigInt(tx.block), gasUsed: BigInt(tx.gasUsed) }, blockAt, note?.via ?? 'direct', r.actor, { ...r.ctx, synced: !note });
    const events = this.log_.filter((e) => e.commitmentId === id);
    book.lastEventSeq = events.at(-1)?.seq ?? book.lastEventSeq;
    book.updatedAt = this.now();
    this.dirty.add(id);
    return 'applied';
  }

  /**
   * The timeouts a transaction ran for this deal, read from its rules-contract logs alone, in order; null when the logs
   * show any other step. A timeout carries no signed message, so whatever forwarded or bundled it, the logs say it all.
   */
  private timeoutsFromLogs(state: EscrowState, logs: readonly DecodedLog[]): Array<{ fn: string; steps: (at: Timestamp) => EscrowEvent[]; logs: DecodedLog[] }> | null {
    const rules = logs.filter((l) => lc(l.address) === lc(this.world.deployment.rules));
    if (rules.length === 0) return null;
    const out: Array<{ fn: string; steps: (at: Timestamp) => EscrowEvent[]; logs: DecodedLog[] }> = [];
    let kind: EscrowStateKind = state.kind;
    for (let i = 0; i < rules.length; i++) {
      const l = rules[i]!;
      const next = rules[i + 1];
      if (l.eventName === 'FallbackTriggered') {
        out.push({ fn: 'triggerFallback', steps: (at) => [{ type: 'trigger_fallback', at }], logs: [l] });
        kind = 'FallbackJudging';
      } else if (l.eventName === 'Defaulted') {
        // _refundAll emits Refunded unless CPP's hold was already reclaimed after authorizationExpiry.
        const refunded = next?.eventName === 'Refunded' ? [next] : [];
        out.push({ fn: 'triggerDefault', steps: (at) => [{ type: 'trigger_default', at }, { type: 'apply_default_outcome', at }], logs: [l, ...refunded] });
        i += refunded.length;
        kind = 'Refunded';
      } else if (kind === 'Held' && (l.eventName === 'JobExpired' || (l.eventName === 'Refunded' && next?.eventName === 'JobExpired'))) {
        const pair = l.eventName === 'Refunded' ? [l, next!] : [l];
        out.push({ fn: 'reclaim', steps: (at) => [{ type: 'reclaim', at }], logs: pair });
        i += pair.length - 1;
        kind = 'Refunded';
      } else {
        return null;
      }
    }
    return out;
  }

  /**
   * Why a rebuilt call does not match its transaction's logs, or null when it does. The logs are what ran: a call read
   * from calldata that never ran (a reverted bundle call, a decoy in a wrapper's calldata) does not match them.
   */
  private unconfirmed(r: Exclude<Rebuilt, { wait: string } | { fail: string }>, logs: readonly DecodedLog[], terms: AnyCommitmentTerms): string | null {
    const has = (name: string) => logs.find((l) => l.eventName === name && lc(l.address) === lc(this.world.deployment.rules));
    const same = (a: unknown, b: unknown) => lc(String(a)) === lc(String(b));
    switch (r.fn) {
      case 'agreeAndFund':
        return has('JobFunded') ? null : 'no JobFunded';
      case 'deliver':
        return has('JobSubmitted') ? null : 'no JobSubmitted';
      case 'decide': {
        const d = has('Decided');
        const m = r.ctx.decision!;
        if (!d) return 'no Decided';
        const a = d.args;
        return same(a['adjudicator'], m.adjudicator) && Number(a['role']) === ROLES.indexOf(m.role) && Number(a['outcome']) === OUTCOMES.indexOf(m.outcome) && same(a['judgmentRecordHash'], m.judgmentRecordHash) && same(a['seed'], m.seed) ? null : 'its Decided names another decision';
      }
      case 'earlyAccept': {
        const c = has('JobCompleted');
        return c && !has('Decided') && same(c.args['evaluator'], terms.buyer) ? null : 'no early acceptance by the buyer';
      }
      case 'mutualSettle': {
        const s = has('MutuallySettled');
        const m = r.settlement!;
        if (!s || Boolean(s.args['keyReleased']) !== m.releaseKey) return 'no matching MutuallySettled';
        // The payouts as the contract paid them: PaymentReleased for those to the seller's payout address (checked
        // first, as the contract does), the rest back to the buyer's payment address. The phase-one contracts pay those
        // two only (ADR-0031 §4, ADR-0033), so a payout to anyone else cannot have landed.
        const toSeller = m.payouts.filter((p) => same(p.to, terms.sellerPayoutAddress)).reduce((n, p) => n + BigInt(p.amount.amount), 0n);
        const released = logs.find((l) => l.eventName === 'PaymentReleased');
        if ((released ? BigInt(released.args['amount'] as bigint) : 0n) !== toSeller) return 'its payout to the seller differs';
        return m.payouts.every((p) => same(p.to, terms.sellerPayoutAddress) || same(p.to, terms.buyerPaymentAddress)) ? null : "it names a payee other than the buyer's payment address and the seller's payout address";
      }
      // Timeouts are read from the logs alone; one read from calldata is checked against its own log all the same.
      case 'reclaim':
        return has('JobExpired') ? null : 'no JobExpired';
      case 'triggerFallback':
        return has('FallbackTriggered') ? null : 'no FallbackTriggered';
      case 'triggerDefault':
        return has('Defaulted') ? null : 'no Defaulted';
      default:
        return `this node does not check ${r.fn} against logs`;
    }
  }

  private fallBehind(id: Hex32, book: Book, tx: Pick<ChainTx, 'hash'> & Partial<ChainTx>, stage: { stage: string } | undefined, reason: string, waiting?: ChainTx[]): 'behind' {
    book.behind = { stage: stage?.stage ?? 'unknown', tx: tx.hash, reason, ...(waiting ? { waiting } : {}) };
    // Behind for a reason other than a missing delivery (T-227): a kept copy can no longer join (T-230, red team).
    if (!waiting) delete book.posted;
    this.dirty.add(id);
    this.custodyBehind(id, book, tx.logs ? (tx as ChainTx) : undefined);
    return 'behind';
  }

  /**
   * A rules-contract call as the core mirror's steps. Fields the calldata carries in the clear are copied; fields it
   * carries only as a hash are read back from what this node holds (the delivery, its envelopes) or from a fixed list
   * (appeal grounds, beacon sources), checked against the hash. The seller's delivery is the one field only a party can
   * supply: without it the call waits. With `note` (this node relayed it, T-219), the relayed messages stand in for the
   * rebuilt ones when their signatures are the calldata's, so the step is the relay's own.
   */
  private rebuild(id: Hex32, book: Book, call: RulesCall, tx: ChainTx, known?: Delivery, note?: RelayNote): Rebuilt {
    const s = book.state;
    const terms = s.terms;
    const a = terms.adjudication;
    const args = call.args as readonly Record<string, unknown>[];
    const ts = chainTime;
    const hex = (v: unknown) => v as Hex32;
    const sub = note?.submission;
    const signedAs = (m: { signature: string } | undefined, v: unknown) => !!m && lc(m.signature) === lc(String(v));
    const via = note?.via ?? 'direct';
    // The delivery that landed with this call: the contract's JobSubmitted names its hash.
    const landed = this.decode(tx.logs.filter((l) => l.topics[1] === id && lc(l.address) === lc(this.world.deployment.rules)) as unknown as Log[]).find((l) => l.eventName === 'JobSubmitted')?.args['deliverable'] as Hex32 | undefined;
    const delivery = (): Delivery | null => [known, book.carried, book.delivery, postedOf(book)].find((d): d is Delivery => !!d && deliveryHash(d) === landed) ?? null;
    const unread = `the seller's delivery landed in transaction ${tx.hash} without passing through this node, and the contract keeps only its hash (${landed}), so this node holds no envelopes for the adjudicators.`;
    const carrying = (): Delivery | null | undefined => (s.kind === 'Held' ? delivery() : undefined);
    const yes = async () => true;
    switch (call.fn) {
      case 'agreeAndFund': {
        if (!PRE_FUNDING.includes(s.kind)) return { fail: `a funding in transaction ${tx.hash} found this node's book ${s.kind}.` };
        const [, , acc, ag, f] = args as [unknown, unknown, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
        const acceptance: AdjudicatorAcceptance =
          book.acceptance && lc(book.acceptance.signature) === lc(String(acc['signature']))
            ? book.acceptance
            : { type: 'AdjudicatorAcceptance', commitmentId: id, adjudicator: a.adjudicator, seedCommitment: hex(acc['seedCommitment']), policyHash: a.policyHash, registryHash: a.registryHash, fee: a.fee, bondReserved: this.amount(BigInt(acc['bondReserved'] as bigint)), nonce: hex(acc['nonce']), expiresAt: ts(acc['expiresAt']), signature: acc['signature'] as Hex };
        // This node's relay (T-219): the agreement and funding it collected, as the relay stepped them.
        const relayed = sub?.kind === 'agree_and_fund' ? { agree: sub.agree, funding: sub.funding } : sub?.kind === 'fund' ? { funding: sub.message } : undefined;
        const agree: Agree =
          relayed?.agree && signedAs(relayed.agree, ag['signature'])
            ? relayed.agree
            : book.agree && lc(book.agree.signature) === lc(String(ag['signature']))
              ? book.agree
              : { type: 'Agree', commitmentId: id, buyer: terms.buyer, nonce: hex(ag['nonce']), expiresAt: ts(ag['expiresAt']), signature: ag['signature'] as Hex };
        const typed = this.fundingTypedData(terms);
        const funding: FundingAuthorization = signedAs(relayed?.funding, f['signature'])
          ? relayed!.funding
          : {
              type: 'FundingAuthorization',
              scheme: 'erc3009', // the phase-one contracts fund by ERC-3009 only (ADR-0031 §3)
              commitmentId: id,
              from: terms.buyerPaymentAddress, // ADR-0033: the payment address signed the funding
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
          ...(s.kind === 'Offered' ? [{ type: 'adjudicator_accept' as const, at, message: acceptance, unencumberedBond: this.amount(0n) }] : []),
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
          if (s.kind === 'Offered') this.emit('adjudicator.accepted', id, a.adjudicator, via, { source: 'chain', seedCommitment: acceptance.seedCommitment, bondRequired: acceptance.bondReserved, acceptance }, false, ts(tx.timestamp));
          if (s.kind !== 'Agreed') this.emit('commitment.agreed', id, agree.buyer, via, { source: relayed?.agree ? 'adapter' : 'chain', termsHash: agree.commitmentId }, false, ts(tx.timestamp));
          // The buyer's daily spend, as the relay's agreement counted it.
          if (relayed?.agree && !book.spent) {
            const day = `${lc(terms.buyer)}|${ts(tx.timestamp).slice(0, 10)}`;
            book.spent = { day, amount: terms.price.amount };
            this.spent.set(day, (this.spent.get(day) ?? 0n) + BigInt(terms.price.amount));
          }
        };
        const signed = async () => (await verifyMessage(this.domain, acceptance, a.adjudicator)) && (await verifyMessage(this.domain, agree, terms.buyer));
        // ADR-0033 §4: the funding's actor is the payment address, whichever route sent it.
        return { fn: call.fn, steps, actor: relayed ? funding.from : terms.buyerPaymentAddress, ctx: { mined }, signed };
      }
      case 'deliver': {
        if (s.kind !== 'Held') return { fail: `a delivery in transaction ${tx.hash} found this node's book ${s.kind}.` };
        const d = delivery();
        if (!d) return { wait: unread };
        // The delivery is one this node checked against the seller's signature when it was posted or carried.
        return { fn: call.fn, steps: (at) => [{ type: 'deliver', at, delivery: d }], actor: terms.seller, ctx: { delivery: d }, signed: yes };
      }
      case 'decide': {
        const carry = carrying();
        if (carry === null) return { wait: unread };
        // The relayed decision carries what the calldata holds only as hashes (its envelopes, its appeal ground).
        const m = sub?.kind === 'decide' && signedAs(sub.message, args[1]!['signature']) ? sub.message : this.decisionFrom(id, book, args[1]!);
        if (typeof m === 'string') return { fail: m };
        const beacon = m.role === 'primary' || !m.beacon ? null : { round: m.beacon.round, value: m.beacon.value };
        const steps = (at: Timestamp): EscrowEvent[] => [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'decide', at, message: m, beacon }];
        return { fn: call.fn, steps, actor: m.adjudicator, ctx: { decision: m, ...(carry ? { delivery: carry } : {}) }, signed: () => verifyMessage(this.domain, m, m.adjudicator) };
      }
      case 'earlyAccept': {
        const carry = carrying();
        if (carry === null) return { wait: unread };
        const v = args[1]!;
        const m: EarlyAccept =
          sub?.kind === 'early_accept' && signedAs(sub.message, v['signature'])
            ? sub.message
            : { type: 'EarlyAccept', commitmentId: id, buyer: terms.buyer, attempt: Number(v['attempt']), deliveryHash: hex(v['deliveryHash']), nonce: hex(v['nonce']), expiresAt: ts(v['expiresAt']), signature: v['signature'] as Hex };
        const steps = (at: Timestamp): EscrowEvent[] => [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'early_accept', at, message: m }];
        return { fn: call.fn, steps, actor: m.buyer, ctx: carry ? { delivery: carry } : {}, signed: () => verifyMessage(this.domain, m, terms.buyer) };
      }
      case 'mutualSettle': {
        const v = args[1]!;
        const m: MutualSettlement = sub?.kind === 'mutual_settle' && lc(sub.message.buyerSignature) === lc(String(v['buyerSignature'])) ? sub.message : {
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
        // SC-5b (T-357): a settlement in Held that released a key carried an unposted delivery. The calldata holds it only
        // as hashes, so core steps it from a copy this node holds (its own relay, a carried or kept copy) that hashes to
        // the signed deliveryHash; without one the node waits, as for a carried decision it never saw (residual 13).
        let late: Delivery | undefined;
        if (s.kind === 'Held' && m.releaseKey && m.deliveryHash) {
          const want = lc(m.deliveryHash);
          const copies = [known, sub?.kind === 'mutual_settle' ? sub.delivery : undefined, book.carried, book.delivery, postedOf(book)];
          late = copies.find((d): d is Delivery => !!d && lc(deliveryHash(d)) === want);
          if (!late) return { wait: `a settlement in transaction ${tx.hash} released the key of delivery ${m.deliveryHash}, which was never posted and did not pass through this node, so this node holds no copy of it.` };
        }
        const carriedBy = late;
        return { fn: call.fn, steps: (at) => [{ type: 'mutual_settle', at, message: m, rule: { allowed: true, payoutsTo: 'parties' }, ...(carriedBy ? { delivery: carriedBy } : {}) }], actor: 'anyone', ctx: {}, signed: () => verifyMutualSettlement(this.domain, m, terms.buyer, terms.seller), settlement: m };
      }
      case 'reclaim':
        return { fn: call.fn, steps: (at) => [{ type: 'reclaim', at }], actor: 'anyone', ctx: {}, signed: yes };
      case 'triggerFallback':
        return { fn: call.fn, steps: (at) => [{ type: 'trigger_fallback', at }], actor: 'anyone', ctx: {}, signed: yes };
      case 'triggerDefault':
        return { fn: call.fn, steps: (at) => [{ type: 'trigger_default', at }, { type: 'apply_default_outcome', at }], actor: 'anyone', ctx: {}, signed: yes };
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
      expiresAt: chainTime(v['expiresAt']),
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
  private async catchUp(id: Hex32, known?: Delivery, atLeast?: bigint): Promise<Omit<ObserveReport, 'unknown'>> {
    const { txs, stages } = await commitmentTxs(this, id, atLeast);
    const report = { applied: 0, seen: 0, behind: 0 };
    for (const tx of txs) report[await this.follow(id, tx, stages.get(id), known)]++;
    // Outside a pass: a pass that read dealOf before this does not check the deal (review L1).
    this.relayedAt.set(id, this.log_.length);
    return report;
  }

  /**
   * The delivery hash the contract holds for a deal (`deliveryHashOf`) and the block it was read at; `none` when it holds
   * none, `unread` when no read answered (T-230). The read is pinned to the node's latest block, or to `atLeast` when that
   * block trails it, so a node without the block is asked again and never read past (docs/team.md, a read after a
   * write). With `retry`, a failed read is asked again within the read budget, and so is an unpinned zero answer from a
   * deal still Held: after a WrongStage the deal has moved on chain, and a node that trails the chain still answers Held.
   * A deal that left Held with no delivery (a reclaim) answers at once.
   */
  private async landedDelivery(id: Hex32, atLeast?: bigint, retry = false): Promise<Landed> {
    const zero = (h: Hex32) => BigInt(h) === 0n;
    const read = async () => {
      const latest = await this.world.publicClient.getBlockNumber({ cacheTime: 0 });
      const block = atLeast !== undefined && latest < atLeast ? atLeast : latest;
      const hash = await this.read<Hex32>(this.world.deployment.rules, this.world.abis.rules, 'deliveryHashOf', [id], block);
      const held = retry && zero(hash) ? (await this.stage(id, block)).stage === 'Held' : false;
      return { hash, block, held };
    };
    try {
      // A read pinned to a revert's block or later answers for good: the deal was Held there with no delivery, so the
      // revert had another cause (a deadline). An unpinned one may come from a node that trails the chain.
      const r = retry ? await this.atReceipt(read, (x) => !zero(x.hash) || !x.held || atLeast !== undefined) : await read();
      if (!zero(r.hash)) return { kind: 'landed', hash: r.hash, block: r.block };
      // Still Held at the end of the budget: the node may trail the chain, so the answer stays open.
      return retry && r.held && atLeast === undefined ? { kind: 'unread' } : { kind: 'none' };
    } catch {
      return { kind: 'unread' };
    }
  }

  /**
   * The seller posts a delivery that the contract already holds, sent there directly, before any pass has read the
   * transaction that landed it (T-230). It joins as `join` does, with no relay: checked against the seller's signature
   * and the hash the contract holds, then the commitment's transactions are read from the chain (pinned to the block of
   * the read that saw the hash, asked again within the read budget) and applied with this copy. 'joined' once joined (a
   * dry run: once checked); otherwise the node cannot read the transaction yet, and the answer says what it kept: the
   * copy then stays on the book, the next pass joins it, and stores the answer under the post's Idempotency-Key.
   */
  private async joinLanded(book: Book, d: Delivery, landed: { hash: Hex32; block: bigint }, options: Relay, dryRun: boolean): Promise<'joined' | Kept> {
    const id = d.commitmentId;
    await this.check({ ...d, type: 'Delivery' }, book.state.terms.seller, 'Delivery');
    const want = deliveryHash(d);
    if (lc(landed.hash) !== lc(want)) refuse('invalid_state', `the delivery that landed on chain for this deal is ${landed.hash}, not this one (${want})`);
    if (dryRun) return 'joined';
    const kept = options.note ? this.keepPosted(id, book, options.note, true) : 'kept';
    const deadline = Date.now() + RECEIPT_READ_BUDGET_MS;
    for (let tries = 0; ; tries++) {
      // An RPC error or a node behind the block is asked again; the copy stays either way.
      await this.catchUp(id, d, landed.block).catch(() => undefined);
      if (book.behind?.waiting) {
        await this.join(book, d, false);
        return 'joined';
      }
      if (this.joined(book, want)) return 'joined';
      // Behind for another reason (T-227): this copy cannot join, and the notice says why.
      if (book.behind) return refuse('invalid_state', this.lag(id)!);
      const ms = RECEIPT_READ_RETRY_MS[tries];
      if (ms === undefined || Date.now() + ms > deadline) return kept;
      if (this.wall) await sleep(ms);
    }
  }

  /** The answer to a post of a delivery the contract holds, while this node cannot read the transaction that landed it (T-230). */
  private keptNotice(d: Delivery, kept: Kept, block?: bigint): string {
    const held = `the contract holds this delivery (deliveryHashOf is ${deliveryHash(d)}${block !== undefined ? ` at block ${block}` : ''}), and this node has not read the transaction that landed it yet.`;
    return kept === 'kept'
      ? `${held} It keeps this signed copy and joins it at its next pass over the chain, within about a minute; the adjudicators then get their envelopes. Retry with the same Idempotency-Key for that answer.`
      : `${held} It keeps a signed copy of it and joins it at its next pass over the chain, within about a minute, but it already holds ${POSTED_KEYS_MAX} other Idempotency-Keys for that copy, so this key gets no stored answer: read the deal's state after the next pass.`;
  }

  /** What a relay that reverted adds when no read of the contract confirmed the delivery (T-230). */
  private unconfirmedNotice(kept: Kept): string {
    if (kept === 'other') return 'This node could not confirm the deal at that block, and it already keeps another signed copy for this deal, so it keeps none of this one: if the contract holds this delivery, post it again after its next pass over the chain';
    const retry = kept === 'kept' ? 'a retry with the same Idempotency-Key then answers it' : `this Idempotency-Key gets no stored answer (${POSTED_KEYS_MAX} others are held for this copy)`;
    return `This node could not confirm the deal at that block, and keeps this signed copy: if the contract holds this delivery, its next pass over the chain joins it, and ${retry}`;
  }

  /**
   * Keeps the seller's posted copy, signature checked, until a pass reads the transaction that landed it (T-230). A copy
   * whose hash a read of the contract confirmed replaces any other; one no read confirmed never replaces another, and
   * the answer says so ('other'). The same copy posted again under another Idempotency-Key adds that key, up to
   * POSTED_KEYS_MAX ('full' past it).
   */
  private keepPosted(id: Hex32, book: Book, note: RelayNote, confirmed: boolean): Kept {
    const want = deliveryHash(deliveryOf(note)!);
    const held = book.posted;
    this.dirty.add(id);
    if (!held || (confirmed && !this.sameCopy(held, want))) {
      book.posted = { note: { ...note, call: 'deliver' }, keys: [], confirmed, asked: false };
      return 'kept';
    }
    if (!this.sameCopy(held, want)) return 'other';
    if (confirmed) held.confirmed = true;
    const k = note.idempotencyKey;
    if (k === undefined || note.body === undefined || [held.note, ...held.keys].some((x) => x.idempotencyKey === k)) return 'kept';
    if (held.keys.length >= POSTED_KEYS_MAX) return 'full';
    held.keys.push({ idempotencyKey: k, body: note.body });
    return 'kept';
  }

  /**
   * A kept copy once its deal has left Held (T-230). When the deal's delivery is the copy, each Idempotency-Key the copy
   * was posted under replays the delivery's events as its answer; a copy of another body, or of a deal that ended with no
   * delivery (a reclaim), goes unanswered. The copy stays until the answers are stored: a read that fails leaves it for
   * the next pass. An unconfirmed copy of a deal still Held goes an hour after deliverBy, since the contract takes no
   * delivery after it (red team round 2).
   */
  private async settlePosted(id: Hex32, book: Book): Promise<void> {
    const p = book.posted;
    if (!p) return;
    if (book.state.kind === 'Held' && !book.behind) {
      if (!p.confirmed && Date.parse(this.now()) >= Date.parse(book.state.terms.timing.deliverBy) + OPEN_GRACE_MS) {
        delete book.posted;
        this.dirty.add(id);
      }
      return;
    }
    if (book.delivery && this.sameCopy(p, deliveryHash(book.delivery))) {
      const events = this.log_.filter((e) => e.commitmentId === id && (e.type === 'delivery.submitted' || (e.type === 'key.released' && e.payload['path'] === 'delivery')));
      for (const k of [p.note, ...p.keys.map((x) => ({ ...p.note, idempotencyKey: x.idempotencyKey, body: x.body }))]) await this.answer(id, book, k, events);
    }
    delete book.posted;
    this.dirty.add(id);
  }

  /**
   * This node's relayed delivery reverted, found after a restart (T-219): the seller most likely sent it another way
   * first. The signed copy stays on the book, so the next pass joins it and answers the relay's Idempotency-Key (T-230):
   * confirmed when the contract holds its hash at the revert's block, unconfirmed when no read there showed a delivery
   * and the revert came before deliverBy. Nothing stays when the contract holds another delivery.
   */
  private async keepLanded(id: Hex32, book: Book, note: RelayNote, mined: Pick<Mined, 'blockNumber' | 'timestamp'>): Promise<void> {
    const d = deliveryOf(note);
    if (!d || book.state.kind !== 'Held' || book.behind) return;
    const landed = await this.landedDelivery(id, mined.blockNumber, true);
    if (landed.kind === 'landed' ? lc(landed.hash) !== lc(deliveryHash(d)) : mined.timestamp >= secs(book.state.terms.timing.deliverBy)) return;
    if (!(await verifyMessage(this.domain, { ...d, type: 'Delivery' }, book.state.terms.seller))) return;
    this.keepPosted(id, book, note, landed.kind === 'landed');
    if (book.posted && this.sameCopy(book.posted, deliveryHash(d))) book.posted.asked = true;
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
    // A settlement in Held that released a key (SC-5b, T-357) lands no delivery: its rebuild checks the copy against the
    // signed deliveryHash instead, and waits again for another copy when it does not match.
    if (landed !== undefined && landed !== deliveryHash(d)) refuse('invalid_state', `the delivery that landed on chain for this deal is ${String(landed)}, not this one (${deliveryHash(d)})`);
    if (dryRun) return id;
    delete book.behind;
    this.dirty.add(id);
    const stage = { stage: behind.stage };
    // In chain order: a timeout this node relayed joins the queue when mined, ahead of an earlier direct call no pass has
    // read yet (red-team on PR 207, attack.t228-waiting-order).
    const chainOrder = (x: ChainTx, y: ChainTx) => Number(BigInt(x.block) - BigInt(y.block)) || (x.logs[0]?.logIndex ?? 0) - (y.logs[0]?.logIndex ?? 0);
    for (const tx of [...waiting].sort(chainOrder)) {
      // A later transaction may put the deal behind again; the rest then wait behind it.
      const again = book.behind as Behind | undefined;
      if (again) again.waiting?.push(tx);
      else await this.step(id, book, tx, stage, d).catch((e: unknown) => this.fallBehind(id, book, tx, stage, `this node could not rebuild transaction ${tx.hash}: ${(e as Error).message}.`));
    }
    this.relayedAt.set(id, this.log_.length);
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
  private async feeAlone(id: Hex32, s: Extract<Submission, { kind: 'agree_and_fund' }>, options: Relay, dryRun: boolean): Promise<Hex32> {
    const fee = s.operatorFee;
    if (!fee || dryRun) return id;
    const book = this.bookOf(id);
    if (lc(fee.from) !== lc(book.state.terms.buyerPaymentAddress) || lc(fee.token) !== this.token || lc(fee.to) === lc(fee.from) || fee.nonce !== operatorFeeNonce(id)) refuse('invalid_terms', "the operator fee must come from the buyer's payment address, in the price token, with the nonce bound to the commitment");
    const { token } = this.world.deployment;
    const data = encodeFunctionData({ abi: this.world.abis.token, functionName: 'transferWithAuthorization', args: [getAddress(fee.from), getAddress(fee.to), BigInt(fee.value), BigInt(secs(fee.validAfter)), BigInt(secs(fee.validBefore)), fee.nonce, fee.signature] });
    if (await this.nonceUsed(id, token, data)) return id;
    let mined: Mined;
    try {
      const note = options.sender || !options.note ? undefined : { ...options.note, call: 'transferWithAuthorization' };
      mined = await this.world.send({ ...(options.sender ? { key: options.sender } : { lane: id }), to: token, data, ...(note ? { note } : {}) }, this.wall ? undefined : secs(this.now()));
    } catch (e) {
      if (e instanceof RelayRefused) refuse('relay_refused', `this operator cannot relay the operator fee now: ${e.message}`);
      throw e;
    }
    // The row goes with process's answer (`landed`), after the books.
    this.done(mined.hash, options);
    if (mined.status !== 'success') refuse('invalid_state', `the operator fee transfer reverted on chain in ${mined.hash}; the deal is funded`);
    this.landFee(id, fee, mined, options.via ?? 'direct');
    return id;
  }

  /**
   * The operator fee sent alone is mined: its record and its event, relayed or recovered after a restart (T-219). Its
   * row stays: the caller marks it done once the answer is stored.
   */
  private landFee(id: Hex32, fee: TransferAuthorization, mined: Pick<Mined, 'hash' | 'from' | 'blockNumber' | 'gasUsed' | 'timestamp'>, via: string): void {
    this.balanceCache.clear();
    const blockAt = toTimestamp(mined.timestamp * 1000);
    this.seen(id, mined.hash, this.books.get(id));
    this.txs.push({ commitmentId: id, call: 'transferWithAuthorization', hash: mined.hash, from: mined.from, via, gasUsed: mined.gasUsed, at: blockAt });
    this.emit('fee.operator', id, getAddress(fee.from), via, { from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)), tx: mined.hash, block: mined.blockNumber, sender: lc(mined.from), gasUsed: mined.gasUsed }, true, blockAt);
    this.relayedAt.set(id, this.log_.length);
  }

  // Read model (as SimChain's view)

  /**
   * The state read. With `bestEffort` (an answer to a write that already moved the book, T-232), the parties' balances
   * are left out when their read fails: the answer and its replay are stored whatever a balance read does, so a retry
   * with the same Idempotency-Key replays it and the lane row goes (red team of PR 239, finding 2; T-409). Without it,
   * such a read throws, as any read of the state does (GET /v1/commitments/<id>).
   */
  private async view(id: Hex32, rec: Book, o: { bestEffort?: boolean } = {}): Promise<CommitmentStateView> {
    const s = rec.state;
    const t = s.terms.timing;
    const deadlines: Record<string, Timestamp> = { offerExpiresAt: t.offerExpiresAt, fundBy: t.fundBy, deliverBy: t.deliverBy, judgeBy: t.judgeBy, fallbackBy: t.fallbackBy };
    // ADR-0031 §8 point 7: no appeal follows a decision on the phase-one contracts, so the view names no appeal window.
    const appealState: CommitmentStateView['appealState'] = 'none';
    if (s.kind === 'Escalated') deadlines['appealDecideBy'] = s.escalation.appealDecideBy;
    const hold = 'hold' in s ? { hold: { amount: s.hold.amount, railRef: `evm:${this.world.chainId}:${lc(this.world.deployment.rules)}:${id}` } } : {};
    const attempt = 'delivery' in s ? s.delivery.attempt : s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? 1 : 0;
    const amount = async (a: Address): Promise<TokenAmount> => ({ token: this.token, amount: (await this.tokenBalance(a)).toString() as TokenAmount['amount'] });
    const posted = postedDeliveryHash(s);
    // ADR-0033 §4: the parties' money is at the payment and payout addresses.
    let balances: Record<Address, TokenAmount> | undefined;
    try {
      balances = { [s.terms.buyerPaymentAddress]: await amount(s.terms.buyerPaymentAddress), [s.terms.sellerPayoutAddress]: await amount(s.terms.sellerPayoutAddress) };
    } catch (e) {
      if (!o.bestEffort) throw e;
    }
    const view: CommitmentStateView = {
      commitmentId: id,
      escrowState: s.kind,
      appealState,
      attempt: s.kind === 'Released' || s.kind === 'Refunded' ? (s.via.kind === 'reclaim' ? 0 : 1) : attempt,
      ...(posted ? { deliveryHash: posted } : {}),
      ...hold,
      deadlines,
      ...(balances ? { balances } : {}),
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
    }
    return view;
  }

  /**
   * D20, as the phase-one contracts settle (ADR-0031 §8 point 7): every Released or Refunded deal is final when it
   * settled, a first-instance decision included, since no appeal can reopen it.
   */
  private finalAt(rec: Book): Timestamp | null {
    const s = rec.state;
    switch (s.kind) {
      case 'Expired':
        return s.expiredAt;
      case 'Settled':
      case 'Released':
      case 'Refunded':
        return s.settledAt;
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

/** A mined transaction as the sync reads one (sync.ts). */
function chainTx(mined: Mined, to: Address | null, input: Hex): ChainTx {
  const logs = mined.logs.map((l) => ({ address: getAddress(l.address), topics: [...l.topics] as Hex[], data: l.data, logIndex: Number(l.logIndex) }));
  return { hash: mined.hash, from: getAddress(mined.from), to, input, block: mined.blockNumber.toString(), timestamp: mined.timestamp, gasUsed: mined.gasUsed.toString(), logs };
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

/** The seller-signed delivery a relayed call carried (T-219): the submission's own, or the one carried beside it. */
function deliveryOf(note: RelayNote): Delivery | undefined {
  return note.delivery ?? (note.submission.kind === 'deliver' ? note.submission.delivery : undefined);
}

/** The seller's posted copy a book holds while it waits to read the transaction that landed it (T-230). */
function postedOf(book: Book): Delivery | undefined {
  return book.posted ? deliveryOf(book.posted.note) : undefined;
}

/** The ID of the commitment a submission touches. Its queue and its relayer lane (live.ts `laneOf`) are keyed by it. */
function submissionCommitmentId(s: Submission): string {
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
