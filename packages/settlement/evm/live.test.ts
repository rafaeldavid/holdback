// LiveChain refuses to start against a rules contract that signs under another EIP-712 domain (ADR-0029 §8): a 0.7
// build pointed at the deployed 0.6 contract would see every agreeAndFund revert BadSignature. A local JSON-RPC stub
// stands in for the chain, so no node is needed: it serves the chain ID, code at the rules address, and the two reads
// LiveChain.verify makes.
//
// The in-flight rows (T-219) run on anvil with mining held back, so a transaction stays between its broadcast and its
// receipt for as long as a test needs. A second LiveChain opened on a copy of the rows stands in for the restarted
// Durable Object. Needs `anvil` on PATH and `forge build` output in contracts/out.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { holdbackDomain, type Hex32 } from '@holdback/core';
import { decodeFunctionData, encodeFunctionResult, getAddress, keccak256, parseTransaction, stringToBytes, type Hex } from 'viem';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaneRow, RelayNote } from './chain.js';
import { ACCEPTED_TOKENS, domainMismatch, laneOf, LIVE_ABIS, LiveChain, tokenMismatch, type DeploymentFile, type LaneStore } from './live.js';
import { anvilAvailable, EvmWorld } from './world.js';

const RULES = '0x00000000000000000000000000000000000000a1';
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
/** anvil's first well-known dev key (public; guards no value). */
const RELAYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const deployment: DeploymentFile = {
  chainId: 31337,
  fromBlock: 0,
  token: { address: addr(0xbeef), name: 'Crow Test USDC', version: '1', symbol: 'tUSDC', decimals: 6 },
  escrow: addr(1),
  erc3009Collector: addr(2),
  permit2Collector: addr(3),
  multicall: addr(4),
  rules: RULES,
  beacon: addr(6),
  expiryMarginSec: 86_400,
};

/** What the stub's rules contract answers for eip712Domain(). */
let onChain = { name: 'Holdback', version: '0.6' };
let onChainMargin = 0n;
/** The stub chain's ID, its rules contract's TOKEN(), and the addresses that hold no code (T-383). */
let stubChainId = 31337;
let onChainToken: string = deployment.token.address;
const noCode = new Set<string>();

function answer(method: string, params: unknown[]): unknown {
  if (method === 'eth_chainId') return `0x${stubChainId.toString(16)}`;
  if (method === 'eth_getCode') return noCode.has(String(params[0]).toLowerCase()) ? '0x' : '0x6080';
  if (method === 'eth_call') {
    const call = params[0] as { data?: Hex; input?: Hex };
    const { functionName } = decodeFunctionData({ abi: LIVE_ABIS.rules, data: (call.data ?? call.input)! });
    if (functionName === 'eip712Domain') {
      return encodeFunctionResult({ abi: LIVE_ABIS.rules, functionName, result: ['0x0f', onChain.name, onChain.version, BigInt(stubChainId), RULES, `0x${'00'.repeat(32)}`, []] });
    }
    if (functionName === 'TOKEN') return encodeFunctionResult({ abi: LIVE_ABIS.rules, functionName, result: onChainToken as Hex });
    if (functionName === 'EXPIRY_MARGIN') return encodeFunctionResult({ abi: LIVE_ABIS.rules, functionName, result: 86_400n });
    if (functionName === 'BEACON_MARGIN') return encodeFunctionResult({ abi: LIVE_ABIS.rules, functionName, result: onChainMargin });
  }
  throw new Error(`the stub does not answer ${method}`);
}

describe('LiveChain refuses a rules contract under another EIP-712 domain (ADR-0029 §8)', () => {
  let server: Server;
  let rpc: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      const one = (r: { id: number; method: string; params?: unknown[] }) => {
        try {
          return { jsonrpc: '2.0', id: r.id, result: answer(r.method, r.params ?? []) };
        } catch (e) {
          return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: (e as Error).message } };
        }
      };
      const out = Array.isArray(body) ? body.map(one) : one(body as { id: number; method: string; params?: unknown[] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    rpc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const chainOf = () => new LiveChain({ deployment, rpcUrls: [rpc], relayerKey: RELAYER });

  it('refuses the deployed 0.6 contract with a message that names the redeploy', async () => {
    onChain = { name: 'Holdback', version: '0.6' };
    await expect(chainOf().verify()).rejects.toThrow(/signs under EIP-712 domain "Holdback" 0\.6, this build under "Holdback" 0\.8: every message would revert BadSignature\. Deploy the 0\.8 contracts/);
  });

  it("starts against a contract under core's domain", async () => {
    onChain = { name: 'Holdback', version: holdbackDomain(31337).version };
    await expect(chainOf().verify()).resolves.toBeUndefined();
  });

  // ADR-0032 (T-380): the fallback and escalation rounds add the contract's BEACON_MARGIN. A deployment file that states
  // another margin would ask the adjudicators for rounds the contract refuses, so the chain does not start.
  it("refuses a deployment file whose beacon margin is not the contract's", async () => {
    onChain = { name: 'Holdback', version: holdbackDomain(31337).version };
    onChainMargin = 29n;
    try {
      await expect(chainOf().verify()).rejects.toThrow(/BEACON_MARGIN is 29, the deployment file says 0/);
      await expect(new LiveChain({ deployment: { ...deployment, beaconMarginSec: 29 }, rpcUrls: [rpc], relayerKey: RELAYER }).verify()).resolves.toBeUndefined();
    } finally {
      onChainMargin = 0n;
    }
  });

  it('refuses a beacon margin that is not whole non-negative seconds before it reads the chain', () => {
    for (const bad of ['29', 29.5, -1, '0x1d']) {
      expect(() => new LiveChain({ deployment: { ...deployment, beaconMarginSec: bad as never }, rpcUrls: [rpc], relayerKey: RELAYER })).toThrow(/beaconMarginSec must be whole non-negative seconds/);
    }
  });

  it('compares the name too', () => {
    expect(domainMismatch({ name: 'Other', version: '0.8' }, holdbackDomain(31337))).toMatch(/"Other" 0\.8/);
    expect(domainMismatch({ name: 'Holdback', version: '0.8' }, holdbackDomain(31337))).toBeNull();
  });

  // T-383: one token, three ways. The table (accepted-tokens.json), the deployment file and TOKEN() must agree, and
  // the token must hold code. A local chain has no table entry and skips that one comparison.
  describe('the token (T-383)', () => {
    const sepoliaToken = ACCEPTED_TOKENS['11155111']!.address;
    const onSepolia = (address: string): DeploymentFile => ({ ...deployment, chainId: 11155111, token: { ...deployment.token, address } });
    beforeEach(() => {
      onChain = { name: 'Holdback', version: holdbackDomain(31337).version };
    });
    afterEach(() => {
      stubChainId = 31337;
      onChainToken = deployment.token.address;
      noCode.clear();
    });

    it("refuses a deployment file whose token is not the rules contract's TOKEN(), naming both", async () => {
      onChainToken = addr(0xdead);
      await expect(chainOf().verify()).rejects.toThrow(`the rules contract's TOKEN() is ${getAddress(addr(0xdead))}, the deployment file says ${getAddress(addr(0xbeef))}`);
    });

    it('refuses a token address that holds no code', async () => {
      noCode.add(addr(0xbeef));
      await expect(chainOf().verify()).rejects.toThrow(/no contract at the token address 0x0{36}BeEF on chain 31337: no deal could fund/i);
    });

    it("on Sepolia, refuses a deployment file and a chain that agree on a token the table does not name, naming both", async () => {
      stubChainId = 11155111;
      onChainToken = addr(0xbeef);
      await expect(new LiveChain({ deployment: onSepolia(addr(0xbeef)), rpcUrls: [rpc], relayerKey: RELAYER }).verify()).rejects.toThrow(
        `the deployment file's token is ${getAddress(addr(0xbeef))}, but Crow's operators accept ${sepoliaToken} (tUSDC) on chain 11155111`,
      );
    });

    it("on Sepolia, refuses a chain whose TOKEN() is not the table's when the file names the table's", async () => {
      stubChainId = 11155111;
      onChainToken = addr(0xbeef);
      await expect(new LiveChain({ deployment: onSepolia(sepoliaToken), rpcUrls: [rpc], relayerKey: RELAYER }).verify()).rejects.toThrow(`the rules contract's TOKEN() is ${getAddress(addr(0xbeef))}, the deployment file says ${sepoliaToken}`);
    });

    it("on Sepolia, starts when the table, the file and TOKEN() name one token, in any letter case", async () => {
      stubChainId = 11155111;
      onChainToken = sepoliaToken.toLowerCase();
      await expect(new LiveChain({ deployment: onSepolia(sepoliaToken), rpcUrls: [rpc], relayerKey: RELAYER }).verify()).resolves.toBeUndefined();
    });

    it("the mainnet entry is data only: a mainnet deployment is still refused before any read", () => {
      expect(ACCEPTED_TOKENS['1']!.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(() => new LiveChain({ deployment: { ...deployment, chainId: 1, token: { ...deployment.token, address: ACCEPTED_TOKENS['1']!.address } }, rpcUrls: [rpc], relayerKey: RELAYER })).toThrow(/mainnet/);
    });

    it('a chain with no entry skips the table', () => {
      expect(ACCEPTED_TOKENS['31337']).toBeUndefined();
      expect(tokenMismatch(31337, addr(0xbeef), addr(0xbeef).toUpperCase().replace('0X', '0x'))).toBeNull();
    });

    // T-383 item 3: no new probe for an old world. The lane's build pointed at the 0.7 deployment (64be1f1, live since
    // 2026-11-04) refuses at start, before any token or margin read, and the error names the domain. The record is read
    // from the repository: sepolia.json until the cutover, its dated copy after it.
    it('refuses the 0.7 deployment record by its domain, and names it', async () => {
      const dir = join(import.meta.dirname, '..', '..', '..', 'contracts', 'deployments');
      const old = readdirSync(dir)
        .filter((f) => /^sepolia.*\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as DeploymentFile & { commit?: string })
        .find((r) => r.commit === '64be1f176ab45cca94a2cd398981c2a6664bc98a');
      expect(old, 'no record of the 64be1f1 deployment in contracts/deployments').toBeDefined();
      stubChainId = 11155111;
      onChain = { name: 'Holdback', version: '0.7' };
      onChainToken = '0x0000000000000000000000000000000000000000'; // the 0.7 contracts have no TOKEN(); it must not be read
      const refused = await new LiveChain({ deployment: old!, rpcUrls: [rpc], relayerKey: RELAYER }).verify().then(() => null, (e: Error) => e.message);
      expect(refused).toMatch(/signs under EIP-712 domain "Holdback" 0\.7, this build under "Holdback" 0\.8: every message would revert BadSignature\. Deploy the 0\.8 contracts/);
      expect(refused).toContain(`(rules contract ${getAddress(old!.rules)} on chain 11155111)`);
    });
  });
});

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
/** A relayer secret for these tests only (anvil; guards no value). */
const LANE_SECRET = keccak256(stringToBytes('t-219/relayer'));
/** An address with no code: a value transfer to it always succeeds. */
const TO = `0x${'5e'.repeat(20)}` as const;
/** Two commitments on the same deal lane, and one on another. */
const DEAL = `0x${'00'.repeat(31)}03` as Hex32;
const SAME_LANE = `0x${'00'.repeat(31)}06` as Hex32;
const OTHER_LANE = `0x${'00'.repeat(31)}04` as Hex32;

/** A lane store in memory that records what it was asked, and what anvil's pool held at each write. */
class Rows implements LaneStore {
  readonly rows = new Map<string, LaneRow>();
  readonly log: Array<{ op: 'write' | 'remove'; row: LaneRow; pooled?: Hex[] }> = [];
  constructor(
    private readonly pool?: () => Promise<Hex[]>,
    rows: readonly LaneRow[] = [],
  ) {
    for (const r of rows) this.rows.set(Rows.key(r), structuredClone(r));
  }
  static key = (r: LaneRow) => `lane:${r.lane}:${r.from.toLowerCase()}:${r.nonce}`;
  async load(): Promise<LaneRow[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async write(row: LaneRow): Promise<void> {
    this.log.push({ op: 'write', row: structuredClone(row), ...(this.pool ? { pooled: await this.pool() } : {}) });
    this.rows.set(Rows.key(row), structuredClone(row));
  }
  async remove(rows: readonly LaneRow[]): Promise<void> {
    for (const r of rows) {
      this.log.push({ op: 'remove', row: structuredClone(r) });
      this.rows.delete(Rows.key(r));
    }
  }
  /** What a Durable Object restarted now would read. */
  copy(): Rows {
    return new Rows(this.pool, [...this.rows.values()]);
  }
}

describe.skipIf(!ready)(`LiveChain's in-flight rows on anvil (T-219)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  /** The hashes in anvil's pool, pending and queued. */
  const pooled = async (): Promise<Hex[]> => {
    const c = await anvil.rpc<{ pending: Record<string, Record<string, { hash: Hex }>>; queued: Record<string, Record<string, { hash: Hex }>> }>('txpool_content', []);
    return [...Object.values(c.pending), ...Object.values(c.queued)].flatMap((byNonce) => Object.values(byNonce).map((t) => t.hash));
  };
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let i = 0; i < 300; i++) {
      if (await ok()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const chainOf = async (store?: LaneStore, o: { rebroadcastMs?: number; receiptTimeoutMs?: number } = {}) => {
    const c = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: LANE_SECRET, pollMs: 25, rebroadcastMs: o.rebroadcastMs ?? 400, receiptTimeoutMs: o.receiptTimeoutMs ?? 3_000 });
    if (store) await c.attach(store);
    return c;
  };
  /** The object that stops after its broadcast: it never rebroadcasts or gives up within a test. */
  const stopped = (store: LaneStore) => chainOf(store, { rebroadcastMs: 60_000, receiptTimeoutMs: 60_000 });
  const note = (id: Hex32, key: string): RelayNote => ({ commitmentId: id, call: 'reclaim', via: 'op-1', submission: { kind: 'trigger', commitmentId: id, timeout: 'reclaim' }, idempotencyKey: key, body: keccak256(stringToBytes(key)) });
  const nonceOf = async (hash: Hex) => (await anvil.publicClient.getTransaction({ hash })).nonce;

  beforeAll(async () => {
    anvil = await EvmWorld.start(root);
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow,
      erc3009Collector: d.erc3009Collector,
      multicall: d.multicall,
      rules: d.rules,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
    for (const lane of (await chainOf()).lanes) await anvil.rpc('anvil_setBalance', [lane.address, '0x56bc75e2d63100000']);
  }, 60_000);
  afterAll(async () => {
    await anvil?.stop();
  });
  afterEach(async () => {
    await anvil.rpc('anvil_dropAllTransactions', []);
    await anvil.rpc('evm_setAutomine', [true]);
  });

  it('writes the row before the broadcast, keeps it after the receipt, and deletes it only when released', async () => {
    const store = new Rows(pooled);
    const chain = await chainOf(store);
    await anvil.rpc('evm_setAutomine', [false]);
    const sending = chain.send({ lane: DEAL, to: TO, data: '0x', value: 1n, note: note(DEAL, 'k-1') });
    await until('the broadcast', async () => (await pooled()).length === 1);
    const [first] = store.log;
    expect(store.log).toHaveLength(1);
    expect(first).toMatchObject({ op: 'write', pooled: [] });
    const row = first!.row;
    const tx = parseTransaction(row.raw);
    expect(row).toMatchObject({ lane: 1 + laneOf(DEAL), from: chain.senderFor(DEAL), nonce: tx.nonce, hashes: [keccak256(row.raw)], note: note(DEAL, 'k-1') });
    expect(await pooled()).toEqual(row.hashes);
    await anvil.rpc('evm_mine', []);
    const mined = await sending;
    expect(mined.hash).toBe(row.hashes[0]);
    // The caller has the receipt; the row stays until the books it changed are written.
    expect(store.rows.size).toBe(1);
    expect(chain.rowOf(mined.hash)).toMatchObject({ nonce: row.nonce });
    expect(chain.inFlight()).toEqual([]);
    await chain.release([mined.hash]);
    expect(store.rows.size).toBe(0);
    expect(chain.rowOf(mined.hash)).toBeUndefined();
    expect(store.log.map((l) => l.op)).toEqual(['write', 'remove']);
  });

  it('a fee bump rewrites the row with both hashes before the replacement goes out', async () => {
    const store = new Rows(pooled);
    const chain = await chainOf(store, { rebroadcastMs: 150, receiptTimeoutMs: 10_000 });
    await anvil.rpc('evm_setAutomine', [false]);
    const sending = chain.send({ lane: DEAL, to: TO, data: '0x', value: 2n });
    await until('the fee bump', async () => store.log.length === 2);
    const [first, bump] = store.log;
    expect(bump!.row.hashes).toEqual([...first!.row.hashes, keccak256(bump!.row.raw)]);
    // Written while the pool still held only the first transaction.
    expect(bump!.pooled).toEqual(first!.row.hashes);
    expect(parseTransaction(bump!.row.raw).nonce).toBe(first!.row.nonce);
    expect(parseTransaction(bump!.row.raw).maxFeePerGas!).toBeGreaterThan(parseTransaction(first!.row.raw).maxFeePerGas!);
    await until('the replacement', async () => (await pooled()).includes(bump!.row.hashes[1]!));
    await anvil.rpc('evm_mine', []);
    expect((await sending).hash).toBe(bump!.row.hashes[1]);
  });

  it('a broadcast the node refuses removes its row: nothing went out', async () => {
    const store = new Rows();
    const chain = await chainOf(store);
    const lane = chain.senderFor(OTHER_LANE);
    await anvil.rpc('anvil_setBalance', [lane, '0x0']);
    try {
      await expect(chain.send({ lane: OTHER_LANE, to: TO, data: '0x' })).rejects.toThrow(/too little test ETH/);
      expect(store.log.map((l) => l.op)).toEqual(['write', 'remove']);
      expect(store.rows.size).toBe(0);
    } finally {
      await anvil.rpc('anvil_setBalance', [lane, '0x56bc75e2d63100000']);
    }
  });

  it('a broadcast that errors after the node took it keeps its row: the lane waits for that transaction (red-team, 2026-11-04)', async () => {
    const store = new Rows();
    const chain = await chainOf(store);
    // The RPC accepts the transaction, then the call times out, as a slow or fallback RPC can.
    const real = chain.publicClient.sendRawTransaction;
    vi.spyOn(chain.publicClient, 'sendRawTransaction').mockImplementationOnce(async (a) => {
      await real(a);
      throw new Error('The request took too long to respond.');
    });
    await expect(chain.send({ lane: DEAL, to: TO, data: '0x', value: 9n, note: note(DEAL, 'k-9') })).rejects.toThrow(/too long/);
    // The transaction went out and mined (automine), and its row stays for the settlement adapter to land.
    const [row] = chain.inFlight();
    expect(row).toMatchObject({ lane: 1 + laneOf(DEAL), note: note(DEAL, 'k-9') });
    expect(store.rows.size).toBe(1);
    expect(store.log.map((l) => l.op)).toEqual(['write']);
    expect((await anvil.publicClient.getTransactionReceipt({ hash: row!.hashes[0]! })).status).toBe('success');
    // The lane's next send resolves that row first and takes the next nonce; pending is never read.
    const pendingReads = vi.spyOn(chain.publicClient, 'getTransactionCount');
    const next = await chain.send({ lane: SAME_LANE, to: TO, data: '0x', value: 10n });
    expect(await nonceOf(next.hash)).toBe(row!.nonce + 1);
    expect(pendingReads).not.toHaveBeenCalled();
    expect(await chain.resume(row!)).toMatchObject({ hash: row!.hashes[0], status: 'success' });
  });

  it('after a restart, a mined row sets the lane nonce to its own plus one; pending is never read while it is open', async () => {
    const store = new Rows();
    const before = await stopped(store);
    await anvil.rpc('evm_setAutomine', [false]);
    // The first object stops waiting for its receipt: only the row and the chain go on.
    void before.send({ lane: DEAL, to: TO, data: '0x', value: 3n, note: note(DEAL, 'k-3') }).catch(() => undefined);
    await until('the broadcast', async () => (await pooled()).length === 1);
    const after = await chainOf(store.copy());
    const [row] = after.inFlight();
    expect(row).toMatchObject({ lane: 1 + laneOf(DEAL), note: note(DEAL, 'k-3') });
    const pendingReads = vi.spyOn(after.publicClient, 'getTransactionCount');
    await anvil.rpc('evm_mine', []);
    await anvil.rpc('evm_setAutomine', [true]);
    // Another deal on the same lane: its send resolves the open row first, then takes the next nonce.
    const next = await after.send({ lane: SAME_LANE, to: TO, data: '0x', value: 4n });
    expect(await nonceOf(next.hash)).toBe(row!.nonce + 1);
    expect(pendingReads).not.toHaveBeenCalled();
    // The settlement adapter then reads the same receipt, without a second broadcast.
    const mined = await after.resume(row!);
    expect(mined).toMatchObject({ hash: row!.hashes[0], status: 'success' });
    expect(after.inFlight()).toEqual([row]);
    await after.release([mined!.hash]);
    expect(after.inFlight()).toEqual([]);
  });

  it('a pending row is rebroadcast as it was, and no other message goes out at its nonce', async () => {
    const store = new Rows();
    const before = await stopped(store);
    await anvil.rpc('evm_setAutomine', [false]);
    void before.send({ lane: DEAL, to: TO, data: '0x', value: 5n }).catch(() => undefined);
    await until('the broadcast', async () => (await pooled()).length === 1);
    // No fee bump within this test: every broadcast is the row's own raw transaction.
    const after = await chainOf(store.copy(), { rebroadcastMs: 5_000, receiptTimeoutMs: 60_000 });
    const [row] = after.inFlight();
    // The node forgot it too, as one that restarted would.
    await anvil.rpc('anvil_dropAllTransactions', []);
    const resumed = after.resume(row!);
    const queued = after.send({ lane: SAME_LANE, to: TO, data: '0x', value: 6n });
    await until('the rebroadcast', async () => (await pooled()).length === 1);
    expect(await pooled()).toEqual(row!.hashes);
    // Still only the row's transaction after several rebroadcast windows.
    await new Promise((r) => setTimeout(r, 1_000));
    expect(await pooled()).toEqual(row!.hashes);
    await anvil.rpc('evm_setAutomine', [true]);
    await anvil.rpc('evm_mine', []);
    expect((await resumed)?.hash).toBe(row!.hashes[0]);
    expect(await nonceOf((await queued).hash)).toBe(row!.nonce + 1);
  });

  it('a row not found after the receipt timeout is rebroadcast, then given up: the row goes and the nonce is read again', async () => {
    const store = new Rows();
    const before = await stopped(store);
    await anvil.rpc('evm_setAutomine', [false]);
    void before.send({ lane: DEAL, to: TO, data: '0x', value: 7n }).catch(() => undefined);
    await until('the broadcast', async () => (await pooled()).length === 1);
    const copy = store.copy();
    for (const r of copy.rows.values()) r.sentAt -= 10 * 60_000;
    await anvil.rpc('anvil_dropAllTransactions', []);
    const after = await chainOf(copy, { rebroadcastMs: 300, receiptTimeoutMs: 2_000 });
    const [row] = after.inFlight();
    const started = Date.now();
    const given = after.resume(row!);
    await until('the rebroadcast', async () => (await pooled()).length === 1);
    expect(await given).toBeNull();
    // One rebroadcast window after the restart, then the existing give-up rule.
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(copy.rows.size).toBe(0);
    expect(after.inFlight()).toEqual([]);
    await anvil.rpc('anvil_dropAllTransactions', []);
    await anvil.rpc('evm_setAutomine', [true]);
    const pendingReads = vi.spyOn(after.publicClient, 'getTransactionCount');
    const next = await after.send({ lane: DEAL, to: TO, data: '0x', value: 8n });
    expect(pendingReads).toHaveBeenCalled();
    expect(await nonceOf(next.hash)).toBe(row!.nonce);
  });
});
