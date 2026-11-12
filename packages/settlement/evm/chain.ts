// What EvmSettlement needs from a chain: reads, a simulation and a sender. Two implementations:
// - EvmWorld (world.ts): anvil on this machine. The adapter's scenario clock sets each block's second, and any key sends.
// - LiveChain (live.ts): a public testnet. Blocks come at their own pace, and a relayer key, with its own nonces,
//   pays gas for the transactions an operator relays. It authors nothing: every call carries the parties' or an
//   adjudicator's signatures, which the contract checks, or is a permissionless timeout (ADR-0005).
import type { Delivery, Hex32 } from '@holdback/core';
import type { Abi, Address, Hex, Log, PublicClient } from 'viem';
import type { Submission } from '../src/interface.js';

export interface Deployment {
  token: Address;
  escrow: Address;
  /** The one funding collector: phase one funds by ERC-3009 only (ADR-0031 §3). */
  erc3009Collector: Address;
  multicall: Address;
  rules: Address;
  /** The beacon behind the rules contract: SimBeacon on anvil, DrandQuicknetBeacon on a shared chain. */
  beacon: Address;
  /** The first block after deployment; logs before it are setup. */
  fromBlock: bigint;
}

export interface Abis {
  rules: Abi;
  token: Abi;
  escrow: Abi;
  multicall: Abi;
  collector: Abi;
}

/** A mined transaction. */
export interface Mined {
  hash: Hex;
  from: Address;
  status: 'success' | 'reverted';
  gasUsed: bigint;
  blockNumber: bigint;
  /** The block's timestamp, unix seconds. */
  timestamp: number;
  logs: readonly Log[];
}

/** The operator declines to relay (D27, ADR-0005): the signed message stays valid for another operator or a direct call. */
export class RelayRefused extends Error {}

/**
 * What the settlement adapter relayed in one transaction (T-219), kept in its lane's in-flight row. After a restart
 * the node applies the mined transaction as this relay: the operator's label, the messages the calldata holds only as
 * hashes (a delivery's envelopes), and the answer a retry with the same Idempotency-Key replays.
 */
export interface RelayNote {
  commitmentId: Hex32;
  /** The contract call: a HoldbackRules function, or 'transferWithAuthorization' for the operator fee sent alone. */
  call: string;
  /** The operator that relayed it, or 'direct'. */
  via: string;
  submission: Submission;
  /** The submission's Idempotency-Key and its body hash (canonical keccak of the submission). */
  idempotencyKey?: string;
  body?: Hex32;
  /** A seller-signed delivery the call carries beside the submission (a decision or early accept carrying it, D4). */
  delivery?: Delivery;
  /** Set when the funding went alone because an earlier transaction paid the operator fee: how this node saw that payment. */
  feePaid?: string;
}

/**
 * One deal-lane transaction from just before its first broadcast until its receipt is applied (T-219, ADR-0028 §3).
 * Plain JSON: a store keeps it. A lane sends one transaction at a time, so a lane has one open row at a time, except
 * for the moment between one receipt and the write of the books it changed.
 */
export interface LaneRow {
  /** The deal lane, 1 to DEAL_LANES, and its sender. */
  lane: number;
  from: Address;
  nonce: number;
  /** Every hash sent at this nonce: the first broadcast, then each fee bump. */
  hashes: Hex[];
  /** The latest signed transaction at this nonce, rebroadcast as it is after a restart. */
  raw: Hex;
  /** When the first broadcast went out, ms since the epoch. */
  sentAt: number;
  note?: RelayNote;
}

export interface EvmChain {
  readonly chainId: number;
  readonly deployment: Deployment;
  readonly abis: Abis;
  readonly publicClient: PublicClient;
  /** 'scenario': the adapter's clock sets each block's second (anvil). 'wall': blocks keep their own time (a testnet). */
  readonly clock: 'scenario' | 'wall';
  /** The account a transaction for `lane` (a commitment ID) comes from when it names no key: anvil's deployer, or a testnet relayer lane. */
  senderFor(lane: string): Address;
  /** The rules contract's CPP authorizationExpiry margin after fallbackBy + appealDecideSec, in seconds (ADR-0025). */
  readonly expiryMargin: bigint;
  /**
   * The rules contract's `BEACON_MARGIN()` in seconds (ADR-0032): how far after the last choice the fallback and
   * escalation rounds are taken. 0 on a local chain; 29 on Ethereum mainnet and Sepolia.
   */
  readonly beaconMarginSec: number;
  /** The token's EIP-712 domain name and version, which ERC-3009 authorizations are signed under. */
  readonly tokenDomain: { name: string; version: string };
  /** eth_call from `from`; throws the RPC error on a revert. `at` (scenario clock): the pending block's second. */
  simulate(tx: { from: Address; to: Address; data: Hex }, at?: number): Promise<void>;
  /**
   * Sends and waits for the receipt. `key` absent: `senderFor(lane)`. `at` (scenario clock): the block's second.
   * `note` (a live chain with a lane store): kept in the lane's in-flight row until the receipt is applied (T-219).
   */
  send(tx: { key?: Hex; lane?: string; to: Address; data: Hex; value?: bigint; note?: RelayNote }, at?: number): Promise<Mined>;
  /** T-219, a live chain only. The rows no caller waits on: left open by a restart, or by an RPC error after the broadcast. */
  inFlight?(): readonly LaneRow[];
  /** The open row that sent `hash`, if any. */
  rowOf?(hash: string): LaneRow | undefined;
  /**
   * T-231, a live chain only. Every row written and not yet released: a relay waiting for its receipt, one mined whose
   * receipt is not applied yet (a read after it failed), and the rows a restart left open.
   */
  openRows?(): readonly LaneRow[];
  /** The row's receipt: the same raw transaction rebroadcast while it is not mined; null once given up. Throws on an RPC error. */
  resume?(row: LaneRow): Promise<Mined | null>;
  /** Deletes the rows that sent these hashes: their receipts are applied, and the books they changed are written. */
  release?(hashes: readonly string[]): Promise<void>;
  /**
   * T-232, a live chain only. The newest block this node has a receipt from, or has read the chain up to (a sync pass's
   * head, a restored log's last block): no read of the state now answers from an earlier block (docs/team.md, a chain
   * read after a transaction sees that transaction).
   */
  floor?(): bigint;
  /** Raises the floor to `block`, when it is newer. */
  saw?(block: bigint): void;
  /**
   * The block a read of the state now is pinned to: the node's latest, or the floor when the node trails it. `head`
   * 'now' asks the node each time; 'cached' takes a head of up to a second ago.
   */
  newest?(head?: 'now' | 'cached'): Promise<bigint>;
  /**
   * `read` at `newest(head)`, a cached head by default. A node without that block answers an error, which is asked again
   * within a bound (five tries in about five receipt polls), then thrown: it never answers from the latest block
   * instead. `again` says which errors are worth asking again; a revert is not.
   */
  pinned?<T>(read: (block: bigint) => Promise<T>, again?: (e: unknown) => boolean, head?: 'now' | 'cached'): Promise<T>;
}
