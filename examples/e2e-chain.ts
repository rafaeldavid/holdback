// The chain side of the first full EVM end-to-end round (T-216): what each scenario reads from Sepolia as evidence,
// and the direct calls the round sends from its own keys, past the operators (ADR-0005, the escape hatch).
//
// It reads the deployment the agent pinned itself (examples/deployments.ts, or HOLDBACK_DEPLOYMENT for anvil in the
// tests), never one an operator names, and the contracts' ABIs as this repository builds them
// (packages/settlement/evm/abis.json, kept equal to contracts/out by its own test). It refuses every chain but Sepolia
// and anvil, and any chain other than the pinned one: test tokens only (CLAUDE.md, no real money).
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  hashStruct,
  http,
  keccak256,
  parseAbiParameters,
  toBytes,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import type { DeploymentFile } from './deployments.ts';
import { jcsHash, TYPES } from './verify.ts';

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
  if (MAINNETS.includes(rpcChainId)) throw new RangeError(`refusing: chain ${rpcChainId} is a mainnet (hard rule: no real money)`);
  if (rpcChainId !== SEPOLIA_CHAIN_ID && rpcChainId !== ANVIL_CHAIN_ID) throw new RangeError(`refusing: chain ${rpcChainId} is neither Sepolia (${SEPOLIA_CHAIN_ID}) nor anvil (${ANVIL_CHAIN_ID})`);
  if (rpcChainId !== pinnedChainId) throw new RangeError(`refusing: the RPC serves chain ${rpcChainId}, but the pinned deployment is on chain ${pinnedChainId}`);
}

/** The contracts' ABIs as this repository builds them. */
const ABIS = JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as Record<'rules' | 'bonds' | 'token' | 'escrow' | 'multicall', Abi>;

/** HoldbackRules' stages and appeal states, in the contract's enum order. */
export const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'] as const;
export const APPEAL_STATES = ['none', 'open', 'upheld', 'overturned', 'expired', 'closed'] as const;

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
    this.contracts = { [d.rules.toLowerCase()]: 'rules', [d.bonds.toLowerCase()]: 'bonds', [d.token.address.toLowerCase()]: 'token', [d.escrow.toLowerCase()]: 'escrow', [d.multicall.toLowerCase()]: 'multicall' };
  }

  /** Connects to `rpcUrl` and refuses unless it serves the pinned deployment's chain, Sepolia or anvil. */
  static async open(rpcUrl: string, deployment: DeploymentFile, explorer?: string): Promise<RoundChain> {
    const chain = new RoundChain(rpcUrl, deployment, explorer);
    assertRoundChain(await chain.client.getChainId(), deployment.chainId);
    return chain;
  }

  link = (tx: string) => (this.explorer ? `${this.explorer}/tx/${tx}` : tx);
  private read = <T>(contract: keyof typeof ABIS, address: string, functionName: string, args: unknown[]): Promise<T> =>
    this.client.readContract({ address: getAddress(address), abi: ABIS[contract], functionName, args }) as Promise<T>;
  private get token() {
    return getAddress(this.deployment.token.address);
  }

  /** `dealOf(id)`: the stage, the appeal state and the attempt. */
  async deal(id: Hex): Promise<{ stage: string; appeal: string; attempt: number }> {
    const d = await this.read<{ stage: number; appeal: number; attempt: number }>('rules', this.deployment.rules, 'dealOf', [id]);
    return { stage: STAGES[d.stage] ?? `stage ${d.stage}`, appeal: APPEAL_STATES[d.appeal] ?? `appeal ${d.appeal}`, attempt: d.attempt };
  }

  /** CPP's payment state for the deal: what the escrow can still capture or refund, in base units. */
  async payment(terms: J, id: Hex): Promise<{ collected: boolean; capturable: string; refundable: string }> {
    const [collected, capturable, refundable] = await this.read<readonly [boolean, bigint, bigint]>('escrow', this.deployment.escrow, 'paymentState', [paymentHashOf(terms, id, this.deployment)]);
    return { collected, capturable: capturable.toString(), refundable: refundable.toString() };
  }

  async deliveryHashOf(id: Hex): Promise<Hex> {
    return this.read<Hex>('rules', this.deployment.rules, 'deliveryHashOf', [id]);
  }

  /** Each address's test-token balance, bond and free bond in HoldbackBonds, in base units. */
  async holdings(addresses: readonly string[]): Promise<Record<string, { token: string; bond: string; free: string }>> {
    const out: Record<string, { token: string; bond: string; free: string }> = {};
    for (const a of addresses) {
      const [token, bond, free] = await Promise.all([
        this.read<bigint>('token', this.token, 'balanceOf', [getAddress(a)]),
        this.read<bigint>('bonds', this.deployment.bonds, 'bondOf', [getAddress(a), this.token]),
        this.read<bigint>('bonds', this.deployment.bonds, 'freeOf', [getAddress(a), this.token]),
      ]);
      out[a.toLowerCase()] = { token: token.toString(), bond: bond.toString(), free: free.toString() };
    }
    return out;
  }

  async ethBalance(a: string): Promise<bigint> {
    return this.client.getBalance({ address: getAddress(a) });
  }

  /** A mined transaction with its gas, block, the HoldbackRules calls it carried and its decoded logs. */
  async transaction(tx: Hex): Promise<TxRecord> {
    const [receipt, sent] = await Promise.all([this.client.getTransactionReceipt({ hash: tx }), this.client.getTransaction({ hash: tx })]);
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

  /** The block hash a transaction is in now, or null when no receipt is found: re-read for finality. */
  async blockHashOf(tx: Hex): Promise<Hex | null> {
    try {
      return (await this.client.getTransactionReceipt({ hash: tx })).blockHash;
    } catch {
      return null;
    }
  }

  /**
   * Sends one call from a round key, past the operators, after simulating it so a refusal reads as the contract's
   * revert, and waits for its receipt. The key pays the gas from its own Sepolia ETH.
   */
  async send(key: Hex, contract: keyof typeof ABIS, functionName: string, args: unknown[]): Promise<TxRecord> {
    const account = privateKeyToAccount(key);
    const chain = this.deployment.chainId === SEPOLIA_CHAIN_ID ? sepolia : foundry;
    const address = getAddress(contract === 'token' ? this.deployment.token.address : (this.deployment as J)[contract]);
    const { request } = await this.client.simulateContract({ account, address, abi: ABIS[contract], functionName, args, chain });
    const wallet = createWalletClient({ account, chain, transport: http(this.rpcUrl) });
    let hash: Hex;
    try {
      hash = await wallet.writeContract(request);
    } catch (e) {
      // anvil 1.0.0's eth_estimateGas refuses a call that costs less to run than its calldata floor (EIP-7623), such as
      // expireAppeal with the terms as input; the simulation above passed, so send it with a fixed limit instead.
      if (!/gas floor exceeds the gas limit/.test(String((e as Error).message))) throw e;
      hash = await wallet.writeContract({ ...request, gas: DIRECT_GAS_LIMIT });
    }
    await this.client.waitForTransactionReceipt({ hash });
    return this.transaction(hash);
  }

  /** A timeout trigger sent directly: `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal`, `expireOffer`. */
  trigger(key: Hex, fn: 'reclaim' | 'triggerFallback' | 'triggerDefault' | 'expireAppeal' | 'expireOffer', terms: J): Promise<TxRecord> {
    return this.send(key, 'rules', fn, [termsTuple(terms)]);
  }

  /** tUSDC is open-mint on Sepolia: a key with gas mints its own test tokens when the faucet is spent. */
  mint(key: Hex, to: string, amount: bigint): Promise<TxRecord> {
    return this.send(key, 'token', 'mint', [getAddress(to), amount]);
  }

  /** An adjudicator's own bond (HoldbackBonds bonds the sender): approve, then deposit, from its key. */
  async depositBond(key: Hex, amount: bigint): Promise<TxRecord[]> {
    const approved = await this.send(key, 'token', 'approve', [getAddress(this.deployment.bonds), amount]);
    return [approved, await this.send(key, 'bonds', 'deposit', [this.token, amount])];
  }

  /** The appellant's token approval for its appeal bond (llms.txt: appeals need your own Sepolia ETH). */
  approveBonds(key: Hex, amount: bigint): Promise<TxRecord> {
    return this.send(key, 'token', 'approve', [getAddress(this.deployment.bonds), amount]);
  }
}
