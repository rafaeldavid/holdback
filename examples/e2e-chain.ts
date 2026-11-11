// The chain side of the first full EVM end-to-end round (T-216): what each scenario reads from Sepolia as evidence,
// and the direct calls the round sends from its own keys, past the operators (ADR-0005, the escape hatch).
//
// It reads the deployment the agent pinned itself (examples/deployments.ts, or HOLDBACK_DEPLOYMENT for anvil in the
// tests), never one an operator names, and the contracts' ABIs as this repository builds them
// (packages/settlement/evm/abis.json, kept equal to contracts/out by its own test). It refuses every chain but Sepolia
// and anvil, and any chain other than the pinned one: test tokens only (CLAUDE.md, no real money).
import { readFileSync } from 'node:fs';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  formatGwei,
  getAddress,
  hashStruct,
  http,
  keccak256,
  numberToHex,
  parseAbiParameters,
  toBytes,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import type { DeploymentFile } from './deployments.ts';
import { MAX_FEE_PER_GAS } from './e2e-keys.ts';
import { jcsHash, Refusal, TYPES } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SEPOLIA_CHAIN_ID = 11155111;
export const ANVIL_CHAIN_ID = 31337;
/** Mainnet chain IDs, refused by name so the message says why (the list packages/settlement/evm/guard.ts refuses). */
const MAINNETS = [1, 10, 25, 56, 100, 130, 137, 250, 324, 1101, 5000, 8453, 34443, 42161, 42170, 42220, 43114, 59144, 81457, 534352, 7777777];

/**
 * The round runs on Sepolia; its offline tests run on anvil. Refuses a mainnet, any other chain, and an RPC whose
 * chain is not the one the agent pinned.
 */
export function assertRoundChain(rpcChainId: number, pinnedChainId: number): void {
  if (MAINNETS.includes(rpcChainId)) throw new Refusal(`refusing: chain ${rpcChainId} is a mainnet (hard rule: no real money)`);
  if (rpcChainId !== SEPOLIA_CHAIN_ID && rpcChainId !== ANVIL_CHAIN_ID) throw new Refusal(`refusing: chain ${rpcChainId} is neither Sepolia (${SEPOLIA_CHAIN_ID}) nor anvil (${ANVIL_CHAIN_ID})`);
  if (rpcChainId !== pinnedChainId) throw new Refusal(`refusing: the RPC serves chain ${rpcChainId}, but the pinned deployment is on chain ${pinnedChainId}`);
}

/** The contracts' ABIs as this repository builds them. */
const ABIS = JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as Record<'rules' | 'token' | 'escrow' | 'multicall', Abi>;

/** HoldbackRules' stages, in the contract's enum order. The phase-one contracts keep no appeal state (ADR-0031 §8). */
export const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'] as const;

const str = (s: string): Hex => keccak256(toBytes(s));
const secs = (ts: string) => BigInt(Date.parse(ts) / 1000);
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Public terms as HoldbackRules takes them (`HoldbackTypes.Terms`): enforced fields in the clear, every other field
 * as its EIP-712 encoding, so the contract rebuilds the commitment ID the parties signed. Public deals only: the
 * round's deals carry their bodies.
 */
export function termsTuple(t: J) {
  const time = (k: string) => secs(t.timing[k]);
  return {
    schemaVersionHash: str(t.schemaVersion),
    clubIdHash: str(t.clubId),
    rulebookHash: t.rulebookHash as Hex,
    buyer: getAddress(t.buyer),
    seller: getAddress(t.seller),
    deliverableHash: jcsHash(t.deliverable),
    acceptanceHash: jcsHash(t.acceptance),
    token: getAddress(t.price.token),
    price: BigInt(t.price.amount),
    adjudicator: getAddress(t.adjudication.adjudicator),
    fallbackAdjudicator: getAddress(t.adjudication.fallbackAdjudicator),
    appealAdjudicator: getAddress(t.adjudication.appealAdjudicator),
    policyIdHash: str(t.adjudication.policyId),
    fee: BigInt(t.adjudication.fee.amount),
    registryHash: t.adjudication.registryHash as Hex,
    policyHash: t.adjudication.policyHash as Hex,
    timing: {
      offerExpiresAt: time('offerExpiresAt'), fundBy: time('fundBy'), deliverBy: time('deliverBy'), judgeBy: time('judgeBy'), fallbackBy: time('fallbackBy'),
      appealWindowSec: BigInt(t.timing.appealWindowSec), appealDecideSec: BigInt(t.timing.appealDecideSec), maxSubmissions: Number(t.timing.maxSubmissions),
      disputeBy: 0n, disputeJudgeSec: 0n, disputeFallbackSec: 0n,
    },
    remedyHash: hashStruct({ types: TYPES, primaryType: 'Remedy', data: t.remedy }),
    disclosureHash: hashStruct({ types: TYPES, primaryType: 'Disclosure', data: t.disclosure }),
    buyerKeyHash: str(t.buyerEncryptionPublicKey),
    nonce: t.nonce as Hex,
    createdAt: secs(t.createdAt),
  };
}

const PAYMENT_INFO_TYPEHASH = keccak256(toBytes('PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)'));

/**
 * The key of CPP's `paymentState` for a deal (AuthCaptureEscrow.getHash), from the terms and the pinned deployment
 * alone, as HoldbackRules derives its PaymentInfo (ADR-0025). With `payer` zeroed it is the buyer's funding nonce.
 */
export function paymentHashOf(t: J, id: Hex, d: DeploymentFile, payer: Address = getAddress(t.buyer)): Hex {
  const expiry = Number(secs(t.timing.fallbackBy)) + Number(t.timing.appealDecideSec) + (d.expiryMarginSec ?? 86_400);
  const inner = keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, address, address, address, address, uint120, uint48, uint48, uint48, uint16, uint16, address, uint256'), [
      PAYMENT_INFO_TYPEHASH, getAddress(d.rules), payer, getAddress(t.seller), getAddress(t.price.token), BigInt(t.price.amount) + BigInt(t.adjudication.fee.amount),
      Number(secs(t.timing.fundBy)), expiry, expiry, 0, 10_000, ZERO_ADDRESS, BigInt(id),
    ]),
  );
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256, address, bytes32'), [BigInt(d.chainId), getAddress(d.escrow), inner]));
}

/** A transaction as the round records it: enough to link it, price it, and re-read its block for finality. */
export interface TxRecord {
  tx: Hex;
  status: 'success' | 'reverted';
  from: Address;
  to: Address | null;
  block: number;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPrice: string;
  /** The calls to HoldbackRules it carries, directly or through Multicall3's aggregate3. */
  calls: Array<{ fn: string; args: J }>;
  /** Every log it emitted that a deployment contract's ABI decodes. */
  logs: Array<{ contract: string; event: string; args: J }>;
}

/** The gas limit of a direct call whose estimate the RPC refused: a limit only, the receipt records what it used. */
const DIRECT_GAS_LIMIT = 1_000_000n;

/**
 * Whether a failed simulation or gas estimate is worth trying again: a node with no header for the block, a rate
 * limit or a network error is; the contract's revert is not, and neither is anvil's calldata-floor refusal, which
 * `send` answers with a fixed gas limit.
 */
const tryAgain = (e: unknown): boolean => {
  const reverted = e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError && x.raw !== undefined) !== null;
  return !reverted && !/gas floor exceeds the gas limit/.test(String((e as Error)?.message));
};

/** JSON-safe: bigints become decimal strings. */
const plain = (v: J): J => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export class RoundChain {
  readonly client: PublicClient;
  readonly rpcUrl: string;
  readonly deployment: DeploymentFile;
  readonly explorer: string | undefined;
  private readonly contracts: Record<string, keyof typeof ABIS>;

  private constructor(rpcUrl: string, deployment: DeploymentFile, explorer: string | undefined) {
    this.rpcUrl = rpcUrl;
    this.deployment = deployment;
    this.explorer = explorer;
    this.client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
    const d = deployment;
    this.contracts = { [d.rules.toLowerCase()]: 'rules', [d.token.address.toLowerCase()]: 'token', [d.escrow.toLowerCase()]: 'escrow', [d.multicall.toLowerCase()]: 'multicall' };
  }

  /** Connects to `rpcUrl` and refuses unless it serves the pinned deployment's chain, Sepolia or anvil. */
  static async open(rpcUrl: string, deployment: DeploymentFile, explorer?: string): Promise<RoundChain> {
    const chain = new RoundChain(rpcUrl, deployment, explorer);
    assertRoundChain(await chain.client.getChainId(), deployment.chainId);
    return chain;
  }

  link = (tx: string) => (this.explorer ? `${this.explorer}/tx/${tx}` : tx);

  /**
   * How a read pinned to a block is retried. A load-balanced RPC (publicnode) can route it to a node that does not have
   * the block yet, which answers an error ("header not found") instead of a state. Sepolia makes a block every 12 s, so
   * 8 tries 2 s apart, 14 s of waiting, outlast a node one block behind [inferred].
   */
  pinnedRetry = { tries: 8, gapMs: 2000 };

  /** The newest block this round has read a receipt from: its own sends, and the deals' transactions it read back. */
  private seen = 0n;

  /** `call`, tried again `pinnedRetry.gapMs` apart while `again` says its error is a node behind, up to `pinnedRetry.tries` times. */
  private async behind<T>(call: () => Promise<T>, again: (e: unknown) => boolean = () => true): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        if (attempt >= this.pinnedRetry.tries || !again(e)) throw e;
        await new Promise((r) => setTimeout(r, this.pinnedRetry.gapMs));
      }
    }
  }

  /**
   * A view call at the latest block, or at block `at`: the state after that block. Evidence read at the deal's last
   * block is never the state from before its last transaction, as a node one block behind served it in round 1's
   * 2026-11-05 run (3d and 10a). A pinned read that fails is tried again, and after its tries it throws: it never falls
   * back to the latest block.
   */
  private read = async <T>(contract: keyof typeof ABIS, address: string, functionName: string, args: unknown[], at?: bigint): Promise<T> => {
    const call = () => this.client.readContract({ address: getAddress(address), abi: ABIS[contract], functionName, args, ...(at === undefined ? {} : { blockNumber: at }) }) as Promise<T>;
    return at === undefined ? call() : this.behind(call);
  };

  /**
   * The block a read of the state now is pinned to: the latest block the RPC reports, or, when the node that answers is
   * behind it, the block of the newest transaction this round has read a receipt from. A deal's starting balances read
   * right after the round's own mint then include the mint, as its closing balances will [inferred from 3d and 10a].
   */
  async fresh(): Promise<bigint> {
    const latest = await this.client.getBlockNumber({ cacheTime: 0 });
    return latest > this.seen ? latest : this.seen;
  }
  private get token() {
    return getAddress(this.deployment.token.address);
  }

  /** `dealOf(id)`: the stage and the attempt, at the latest block or after block `at`. */
  async deal(id: Hex, at?: bigint): Promise<{ stage: string; attempt: number }> {
    const d = await this.read<{ stage: number; attempt: number }>('rules', this.deployment.rules, 'dealOf', [id], at);
    return { stage: STAGES[d.stage] ?? `stage ${d.stage}`, attempt: d.attempt };
  }

  /** CPP's payment state for the deal: what the escrow can still capture or refund, in base units, at the latest block or after block `at`. */
  async payment(terms: J, id: Hex, at?: bigint): Promise<{ collected: boolean; capturable: string; refundable: string }> {
    const [collected, capturable, refundable] = await this.read<readonly [boolean, bigint, bigint]>('escrow', this.deployment.escrow, 'paymentState', [paymentHashOf(terms, id, this.deployment)], at);
    return { collected, capturable: capturable.toString(), refundable: refundable.toString() };
  }

  /** `deliveryHashOf(id)`, at the latest block or after block `at` (the deal's last transaction's, once `finish` has read it). */
  async deliveryHashOf(id: Hex, at?: bigint): Promise<Hex> {
    return this.read<Hex>('rules', this.deployment.rules, 'deliveryHashOf', [id], at);
  }

  /**
   * The transactions that touched deal `id` from block `from` to block `to`, by the chain's own logs: every
   * HoldbackRules event carries the deal's ID as its first topic. So a step that neither the operators' events nor the
   * round's own sends name still reaches the deal's record and its money (`flowOf`). A node behind `to` answers fewer
   * logs, so the answer must hold every transaction in `known` (the deal's transactions with a HoldbackRules event);
   * otherwise it is asked again (`pinnedRetry`), then this throws.
   */
  async dealTransactions(id: Hex, from: bigint, to: bigint, known: readonly Hex[]): Promise<Hex[]> {
    const ask = async () => {
      const logs = (await this.client.request({ method: 'eth_getLogs', params: [{ address: getAddress(this.deployment.rules), fromBlock: numberToHex(from), toBlock: numberToHex(to), topics: [null, id] }] } as never)) as Array<{ transactionHash: Hex }>;
      const txs = [...new Set(logs.map((l) => l.transactionHash.toLowerCase() as Hex))];
      const missing = known.filter((k) => !txs.includes(k.toLowerCase() as Hex));
      if (missing.length) throw new Error(`the node's logs for ${id} from block ${from} to ${to} lack ${missing.join(', ')}: it is behind`);
      return txs;
    };
    return this.behind(ask);
  }

  /**
   * Each address's test-token balance, in base units, at the latest block or after block `at`. The phase-one contracts
   * hold no bond (ADR-0031 §8), so bond and free bond read 0: the fields stay for SimChain, which keeps bonds.
   */
  async holdings(addresses: readonly string[], at?: bigint): Promise<Record<string, { token: string; bond: string; free: string }>> {
    const out: Record<string, { token: string; bond: string; free: string }> = {};
    for (const a of addresses) {
      const token = await this.read<bigint>('token', this.token, 'balanceOf', [getAddress(a)], at);
      out[a.toLowerCase()] = { token: token.toString(), bond: '0', free: '0' };
    }
    return out;
  }

  async ethBalance(a: string): Promise<bigint> {
    return this.client.getBalance({ address: getAddress(a) });
  }

  /**
   * How many transactions `address` has mined as of block `atLeast` or later (`fresh`): the nonce it sends with next
   * once that block is in. A node behind the block still counts the transaction before it (T-232), so the count is
   * pinned there, asked again while a node has no header for it (`pinnedRetry`), and never read at the latest block.
   */
  async nonceAfter(address: string, atLeast: bigint): Promise<number> {
    const at = await this.fresh();
    const blockNumber = at > atLeast ? at : atLeast;
    return this.behind(() => this.client.getTransactionCount({ address: getAddress(address), blockNumber }));
  }

  /**
   * A mined transaction with its gas, block, the HoldbackRules calls it carried and its decoded logs. A node behind the
   * transaction's block has no receipt for it yet, even right after waitForTransactionReceipt saw one on another node:
   * a read that finds none is tried again (`pinnedRetry`), then throws.
   */
  async transaction(tx: Hex): Promise<TxRecord> {
    const notYet = (e: unknown) => e instanceof TransactionReceiptNotFoundError || e instanceof TransactionNotFoundError;
    const [receipt, sent] = await this.behind(() => Promise.all([this.client.getTransactionReceipt({ hash: tx }), this.client.getTransaction({ hash: tx })]), notYet);
    if (receipt.blockNumber > this.seen) this.seen = receipt.blockNumber;
    const logs: TxRecord['logs'] = [];
    for (const log of receipt.logs) {
      const contract = this.contracts[log.address.toLowerCase()];
      if (!contract) continue;
      try {
        const e = decodeEventLog({ abi: ABIS[contract], data: log.data, topics: log.topics }) as { eventName: string; args: J };
        logs.push({ contract, event: e.eventName, args: plain(e.args) });
      } catch {
        // A log no ABI here describes: left out of the decoded list, still on Etherscan.
      }
    }
    return {
      tx, status: receipt.status, from: receipt.from, to: receipt.to, block: Number(receipt.blockNumber), blockHash: receipt.blockHash,
      gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), calls: this.rulesCalls(sent.to, sent.input), logs,
    };
  }

  /** The HoldbackRules calls in a transaction's input: sent to the rules contract, or bundled in aggregate3. */
  private rulesCalls(to: Address | null, input: Hex): TxRecord['calls'] {
    const rules = this.deployment.rules.toLowerCase();
    const one = (data: Hex) => {
      const c = decodeFunctionData({ abi: ABIS.rules, data }) as { functionName: string; args: readonly unknown[] };
      return { fn: c.functionName, args: plain(c.args) };
    };
    try {
      if (to?.toLowerCase() === rules) return [one(input)];
      if (to?.toLowerCase() === this.deployment.multicall.toLowerCase()) {
        const m = decodeFunctionData({ abi: ABIS.multicall, data: input }) as unknown as { args: readonly [ReadonlyArray<{ target: Address; callData: Hex }>] };
        return m.args[0].filter((c) => c.target.toLowerCase() === rules).map((c) => one(c.callData));
      }
    } catch {
      // Input this ABI does not decode: no calls listed.
    }
    return [];
  }

  /**
   * The block hash a transaction is in now, or null when the chain has no receipt for it: re-read for finality. A
   * network error or a rate limit is retried, then thrown, so it never reads as a reorg.
   */
  async blockHashOf(tx: Hex): Promise<Hex | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        return (await this.client.getTransactionReceipt({ hash: tx })).blockHash;
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null;
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  /** The nonce each round key sends with next, after its last send here: a node behind that send still counts the one before. */
  private readonly nonces = new Map<string, number>();

  /**
   * Sends one call from a round key, past the operators, and waits for its receipt. It simulates the call first, so a
   * refusal reads as the contract's revert, then estimates its gas. Both read the state after the round's own last
   * transaction (`fresh`), never a node's older latest block: in round 1's 2026-11-05 runs, 3b's bond deposit was
   * simulated within 3 s of its approval on a node that had not seen the approval, and reverted TransferFromFailed
   * (0x7939f424) in both runs. A node with no header for that block is tried again (`pinnedRetry`); a revert is not.
   * The nonce is the larger of the pending count and the one after this key's last send here, for the same reason.
   * The key pays the gas from its own Sepolia ETH, at most MAX_FEE_PER_GAS a unit (20 gwei, the cap `e2e-keys.ts
   * topup` and the operators' funding lane use): above it the send is refused before it is signed, so a fee spike
   * stops a scenario instead of draining the key's 0.04 Sepolia ETH.
   */
  async send(key: Hex, contract: keyof typeof ABIS, functionName: string, args: unknown[]): Promise<TxRecord> {
    const account = privateKeyToAccount(key);
    const chain = this.deployment.chainId === SEPOLIA_CHAIN_ID ? sepolia : foundry;
    const address = getAddress(contract === 'token' ? this.deployment.token.address : (this.deployment as J)[contract]);
    const abi = ABIS[contract];
    const at = await this.fresh();
    // The sender as an address: no nonce or fee is filled in for a simulation or an estimate. A node checks an
    // eth_call's fee fields against the key's balance, so the fees go on the send alone.
    const call = { account: account.address, address, abi, functionName, args, blockNumber: at };
    await this.behind(() => this.client.simulateContract(call), tryAgain);
    const fees = await this.client.estimateFeesPerGas({ chain });
    if (fees.maxFeePerGas > MAX_FEE_PER_GAS) throw new Refusal(`refusing to send ${functionName}: the network asks ${formatGwei(fees.maxFeePerGas)} gwei per gas, above the ${formatGwei(MAX_FEE_PER_GAS)} gwei cap; run the scenario again once fees fall`);
    let gas: bigint;
    try {
      // A fifth more than the estimate: the call runs a block or more after the state it was estimated on.
      gas = ((await this.behind(() => this.client.estimateContractGas(call), tryAgain)) * 6n) / 5n;
    } catch (e) {
      // anvil 1.0.0's eth_estimateGas refuses a call that costs less to run than its calldata floor (EIP-7623), such as
      // a timeout with the terms as input; the simulation above passed, so send it with a fixed limit instead.
      if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
      gas = DIRECT_GAS_LIMIT;
    }
    const pending = await this.client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const nonce = Math.max(pending, this.nonces.get(account.address) ?? 0);
    const wallet = createWalletClient({ account, chain, transport: http(this.rpcUrl) });
    const hash = await wallet.writeContract({ address, abi, functionName, args, chain, gas, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    this.nonces.set(account.address, nonce + 1);
    await this.client.waitForTransactionReceipt({ hash });
    return this.transaction(hash);
  }

  /**
   * Resolves once none of `keys` (role → address) has a transaction pending, and refuses after `waitMs` while one
   * has: another process may be sending from the round's keys. Round 1's 2026-11-05 runs from 19:07 and 19:35 UTC
   * overlapped on the same keys, and each counted the other's deals. Two reads a node apart can show a transaction
   * mined a moment ago as pending, so a pending send must last the whole wait.
   */
  async untilIdle(keys: Record<string, string>, o: { waitMs: number; gapMs: number } = { waitMs: 60_000, gapMs: 5000 }): Promise<void> {
    for (const end = Date.now() + o.waitMs; ; await new Promise((r) => setTimeout(r, o.gapMs))) {
      const busy: string[] = [];
      for (const [role, address] of Object.entries(keys)) {
        const [mined, pending] = await Promise.all([this.client.getTransactionCount({ address: getAddress(address), blockTag: 'latest' }), this.client.getTransactionCount({ address: getAddress(address), blockTag: 'pending' })]);
        if (pending > mined) busy.push(`the ${role} ${address} has ${pending - mined} transaction(s) pending (nonce ${mined} mined, ${pending} pending)`);
      }
      if (!busy.length) return;
      if (Date.now() >= end) throw new Refusal(`refusing to start: ${busy.join('; ')}, and still after ${Math.round(o.waitMs / 1000)} s; another run may be sending from the round's keys. Run again once it ends`);
    }
  }

  /**
   * A timeout trigger sent directly: `reclaim`, `triggerFallback`, `triggerDefault`, `expireOffer`.
   * The contract judges the deadline by the latest block's time, which trails the wall by up to a block (12 s on
   * Sepolia), so a `TooEarly` refusal is retried every 3 s for up to `timeoutMs`.
   */
  async trigger(key: Hex, fn: 'reclaim' | 'triggerFallback' | 'triggerDefault' | 'expireOffer', terms: J, timeoutMs = 120_000): Promise<TxRecord> {
    for (const end = Date.now() + timeoutMs; ; await new Promise((r) => setTimeout(r, 3000))) {
      try {
        return await this.send(key, 'rules', fn, [termsTuple(terms)]);
      } catch (e) {
        if (!/TooEarly/.test(String((e as Error).message)) || Date.now() > end) throw e;
      }
    }
  }

  /** tUSDC is open-mint on Sepolia: a key with gas mints its own test tokens when the faucet is spent. */
  mint(key: Hex, to: string, amount: bigint): Promise<TxRecord> {
    return this.send(key, 'token', 'mint', [getAddress(to), amount]);
  }
}
