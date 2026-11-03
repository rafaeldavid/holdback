// What EvmSettlement needs from a chain: reads, a simulation and a sender. Two implementations:
// - EvmWorld (world.ts): anvil on this machine. The adapter's scenario clock sets each block's second, and any key sends.
// - LiveChain (live.ts): a public testnet. Blocks come at their own pace, and a relayer key, with its own nonces,
//   pays gas for the transactions an operator relays. It authors nothing: every call carries the parties' or an
//   adjudicator's signatures, which the contract checks, or is a permissionless timeout (ADR-0005).
import type { Abi, Address, Hex, Log, PublicClient } from 'viem';

export interface Deployment {
  token: Address;
  escrow: Address;
  erc3009Collector: Address;
  permit2Collector: Address;
  multicall: Address;
  rules: Address;
  bonds: Address;
  /** The beacon behind the rules contract: SimBeacon on anvil, DrandQuicknetBeacon on a shared chain. */
  beacon: Address;
  /** The first block after deployment; logs before it are setup. */
  fromBlock: bigint;
}

export interface Abis {
  rules: Abi;
  bonds: Abi;
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
  /** The token's EIP-712 domain name and version, which ERC-3009 authorizations are signed under. */
  readonly tokenDomain: { name: string; version: string };
  /** eth_call from `from`; throws the RPC error on a revert. `at` (scenario clock): the pending block's second. */
  simulate(tx: { from: Address; to: Address; data: Hex }, at?: number): Promise<void>;
  /** Sends and waits for the receipt. `key` absent: `senderFor(lane)`. `at` (scenario clock): the block's second. */
  send(tx: { key?: Hex; lane?: string; to: Address; data: Hex; value?: bigint }, at?: number): Promise<Mined>;
}
