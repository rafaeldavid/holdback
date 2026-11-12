// The round's chain helpers, offline: the chain guard (the check docs/team.md pairs with the no-real-money rule), the
// CPP payment key against the buyer's funding nonce, the per-role encryption keys, and, against a stand-in for a
// load-balanced RPC whose nodes lag each other, the evidence reads pinned to the deal's last block, the reads after the
// round's own transactions, the open-deal read after a scenario, the fee cap on its direct sends, a send right after
// another one from the same key, and the check that no other run is sending from the round's keys.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeFunctionData, encodeFunctionResult, keccak256, numberToHex, parseGwei, parseTransaction, recoverTransactionAddress, type Abi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { ANVIL_CHAIN_ID, assertRoundChain, paymentHashOf, RoundChain, SEPOLIA_CHAIN_ID, STAGES, termsTuple } from './e2e-chain.ts';
import { roundEncryptionKey, roundKey } from './e2e-keys.ts';
import { openDeals, refreshBefore, type Deal, type Run } from './e2e-run.ts';
import { commitmentIdOf, fundingNonceOf, pinOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Public terms in the shape the operators serve, on Sepolia's token. */
const terms = {
  schemaVersion: '0.8', clubId: 'demo-club', rulebookHash: `0x${'11'.repeat(32)}`,
  buyer: '0x59d794504087069ded88dc3c8f3ff9dda8e44e36', seller: '0xd89876c20a42ffa707d0bb7a72607a03d5423ed7',
  buyerPaymentAddress: '0x59d794504087069ded88dc3c8f3ff9dda8e44e36', sellerPayoutAddress: '0xd89876c20a42ffa707d0bb7a72607a03d5423ed7',
  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
  acceptance: { deterministicChecks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }], rubric: { criteria: [], passThreshold: 0 } },
  price: { token: SEPOLIA!.token.address.toLowerCase(), amount: '25000000' },
  adjudication: { adjudicator: '0x71f8a3e163528c773fb358a718294a0b32697c9e', fallbackAdjudicator: '0x0000000000000000000000000000000000000b0b', appealAdjudicator: '0x0000000000000000000000000000000000000c0c', policyId: 'demo-policy', fee: { token: SEPOLIA!.token.address.toLowerCase(), amount: '1000000' }, registryHash: `0x${'22'.repeat(32)}`, policyHash: `0x${'33'.repeat(32)}` },
  timing: { offerExpiresAt: '2026-11-04T10:00:00Z', fundBy: '2026-11-04T10:15:00Z', deliverBy: '2026-11-05T10:00:00Z', judgeBy: '2026-11-05T10:01:00Z', fallbackBy: '2026-11-05T10:02:00Z', appealWindowSec: 0, appealDecideSec: 60, maxSubmissions: 1 },
  settlement: { mode: 'guaranteed_on_decision', token: SEPOLIA!.token.address.toLowerCase() }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
  buyerEncryptionPublicKey: 'A'.repeat(43), nonce: `0x${'44'.repeat(32)}`, createdAt: '2026-11-04T09:45:00Z',
};

describe('assertRoundChain', () => {
  it('refuses a mainnet, by name', () => {
    expect(() => assertRoundChain(1, 1)).toThrow(/chain 1 is a mainnet \(hard rule: no real money\)/);
    expect(() => assertRoundChain(8453, SEPOLIA_CHAIN_ID)).toThrow(/mainnet/);
  });
  it('refuses any chain but Sepolia and anvil, and an RPC on another chain than the pin', () => {
    expect(() => assertRoundChain(17000, 17000)).toThrow(/neither Sepolia \(11155111\) nor anvil \(31337\)/);
    expect(() => assertRoundChain(ANVIL_CHAIN_ID, SEPOLIA_CHAIN_ID)).toThrow(/the RPC serves chain 31337, but the pinned deployment is on chain 11155111/);
  });
  it('accepts Sepolia and anvil when the RPC matches the pin', () => {
    expect(() => assertRoundChain(SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID)).not.toThrow();
    expect(() => assertRoundChain(ANVIL_CHAIN_ID, ANVIL_CHAIN_ID)).not.toThrow();
  });
});

describe('paymentHashOf', () => {
  it("with the payer zeroed, equals the buyer's funding nonce (ADR-0025), and differs with the buyer as payer", () => {
    const id = commitmentIdOf(terms);
    const nonce = fundingNonceOf(terms, id, pinOf(SEPOLIA!).chain!);
    expect(paymentHashOf(terms, id, SEPOLIA!, '0x0000000000000000000000000000000000000000')).toBe(nonce);
    expect(paymentHashOf(terms, id, SEPOLIA!)).not.toBe(nonce);
  });
  it('takes the payment address as the payer and the payout address as the receiver, as the contract and fundingNonceOf do (ADR-0033, T-381)', () => {
    const apart = { ...terms, buyerPaymentAddress: '0x7777777777777777777777777777777777777777', sellerPayoutAddress: '0x8888888888888888888888888888888888888888' };
    const id = commitmentIdOf(apart);
    expect(paymentHashOf(apart, id, SEPOLIA!, '0x0000000000000000000000000000000000000000')).toBe(fundingNonceOf(apart, id, pinOf(SEPOLIA!).chain!));
    // The default payer is the payment address: the same hash as naming it, and not the one with the signing address.
    expect(paymentHashOf(apart, id, SEPOLIA!)).toBe(paymentHashOf(apart, id, SEPOLIA!, '0x7777777777777777777777777777777777777777'));
    expect(paymentHashOf(apart, id, SEPOLIA!)).not.toBe(paymentHashOf(apart, id, SEPOLIA!, apart.buyer as `0x${string}`));
  });
});

describe('termsTuple', () => {
  it('carries the enforced fields in the clear and the timing in seconds', () => {
    const t = termsTuple(terms);
    expect(t.price).toBe(25_000_000n);
    expect(t.fee).toBe(1_000_000n);
    expect(t.buyer).toBe('0x59D794504087069Ded88Dc3c8f3FF9dda8E44e36');
    expect(t.timing.deliverBy).toBe(BigInt(Date.parse('2026-11-05T10:00:00Z') / 1000));
    expect(t.timing.maxSubmissions).toBe(1);
    expect(t.timing.disputeBy).toBe(0n);
  });
});

describe('roundEncryptionKey', () => {
  it('is 32 bytes, the same every time, distinct per role and from the signing key', () => {
    const seed = generatePrivateKey();
    const buyer = roundEncryptionKey(seed, 'buyer');
    expect(buyer).toHaveLength(32);
    expect(roundEncryptionKey(seed, 'buyer')).toEqual(buyer);
    expect(roundEncryptionKey(seed, 'seller')).not.toEqual(buyer);
    expect(Buffer.from(buyer).toString('hex')).not.toBe(roundKey(seed, 'buyer').slice(2));
    expect(() => roundEncryptionKey('0x12', 'buyer')).toThrow(/32 bytes/);
  });
});

const ABIS = JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as Record<'rules' | 'token' | 'escrow', Abi>;

/**
 * What the reads return before the deal's last transaction and after it, in base units (round 1's 3d and 10a values).
 * Round 1's 3d read Expired after its block; the phase-one contracts store no expired offer (ADR-0031 §7), so the
 * stand-in reads Settled, a stage they keep.
 */
const BEFORE = { stage: STAGES.indexOf('None'), capturable: 26_000_000n, refundable: 0n, token: 1_000_000n };
const AFTER = { stage: STAGES.indexOf('Settled'), capturable: 0n, refundable: 15_000_000n, token: 12_000_000n };

/** The round's own transaction in the stand-in (a mint from a round key): mined in block `last`. */
const MINT_TX = `0x${'5a'.repeat(32)}` as Hex;
const mined = (last: bigint) => {
  const at = { blockHash: `0x${'b1'.repeat(32)}`, blockNumber: numberToHex(last), from: terms.buyer, to: SEPOLIA!.token.address, transactionIndex: '0x0', type: '0x2' };
  return {
    eth_getTransactionReceipt: { ...at, transactionHash: MINT_TX, status: '0x1', gasUsed: numberToHex(51_234), cumulativeGasUsed: numberToHex(51_234), effectiveGasPrice: numberToHex(parseGwei('2')), logs: [], logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null },
    eth_getTransactionByHash: { ...at, hash: MINT_TX, input: '0x', nonce: '0x0', gas: numberToHex(60_000), value: '0x0', maxFeePerGas: numberToHex(parseGwei('3')), maxPriorityFeePerGas: numberToHex(parseGwei('1')), chainId: numberToHex(SEPOLIA_CHAIN_ID), v: '0x0', yParity: '0x0', r: `0x${'01'.repeat(32)}`, s: `0x${'02'.repeat(32)}` },
  } as Record<string, object>;
};

/**
 * A JSON-RPC stand-in for a load-balanced endpoint such as publicnode: `latest` comes from a node one block behind the
 * deal's last transaction (block `last`), and a read at `last` finds no header the first `misses` times, as on a node
 * that has not caught up yet. The round's own transaction (MINT_TX) is in block `last`; a node behind it has no receipt
 * for it the first `receiptMisses` times. The latest block's base fee is `baseFeeGwei`. `dealOf` reads `stages.before`
 * before block `last` and `stages.after` from it on (None and Settled, unless given). `asked` lists every method.
 */
async function laggingRpc(last: bigint, misses: number, o: { receiptMisses?: number; baseFeeGwei?: string; stages?: { before: (typeof STAGES)[number]; after: (typeof STAGES)[number] } } = {}) {
  const reads: Array<{ fn: string; block: string }> = [];
  const asked: string[] = [];
  const d = SEPOLIA!;
  const contractAt: Record<string, keyof typeof ABIS> = { [d.rules.toLowerCase()]: 'rules', [d.escrow.toLowerCase()]: 'escrow', [d.token.address.toLowerCase()]: 'token' };
  let missed = 0;
  const receiptsMissed: Record<string, number> = {};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: [{ to: string; data: Hex }, string] };
      asked.push(method);
      const reply = (x: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...x }));
      if (method === 'eth_chainId') return reply({ result: numberToHex(SEPOLIA_CHAIN_ID) });
      if (method === 'eth_blockNumber') return reply({ result: numberToHex(last - 1n) });
      if (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash') {
        receiptsMissed[method] = receiptsMissed[method] ?? 0;
        if (receiptsMissed[method]! < (o.receiptMisses ?? 0)) {
          receiptsMissed[method]!++;
          return reply({ result: null });
        }
        return reply({ result: mined(last)[method] });
      }
      if (method === 'eth_getBlockByNumber') return reply({ result: { number: numberToHex(last - 1n), hash: `0x${'b0'.repeat(32)}`, timestamp: numberToHex(1_793_000_000), baseFeePerGas: numberToHex(parseGwei(o.baseFeeGwei ?? '1')), transactions: [] } });
      if (method === 'eth_maxPriorityFeePerGas') return reply({ result: numberToHex(parseGwei('1')) });
      // A relayer lane's mined count (T-232, scenario 11): 4 before the deal's last transaction (its funding), 5 from it on.
      if (method === 'eth_getTransactionCount') {
        const block = (params as unknown as [string, string])[1];
        reads.push({ fn: 'getTransactionCount', block });
        const pinned = block === numberToHex(last);
        if (pinned && missed < misses) {
          missed++;
          return reply({ error: { code: -32000, message: 'header not found' } });
        }
        return reply({ result: numberToHex(pinned ? 5 : 4) });
      }
      if (method !== 'eth_call') return reply({ error: { code: -32601, message: `${method} is not served here` } });
      const abi = ABIS[contractAt[params[0].to.toLowerCase()]!];
      const { functionName } = decodeFunctionData({ abi, data: params[0].data });
      reads.push({ fn: functionName, block: params[1] });
      const pinned = params[1] === numberToHex(last);
      if (pinned && missed < misses) {
        missed++;
        return reply({ error: { code: -32000, message: 'header not found' } });
      }
      const s = pinned ? AFTER : BEFORE;
      const stage = o.stages ? STAGES.indexOf(pinned ? o.stages.after : o.stages.before) : s.stage;
      const result = { dealOf: { stage, attempt: 1, t1: 0, seedTag: 0n, reason: 0, decider: 0 }, paymentState: [false, s.capturable, s.refundable], balanceOf: s.token, approve: true, deliveryHashOf: `0x${'d1'.repeat(32)}` }[functionName];
      reply({ result: encodeFunctionResult({ abi, functionName, result } as never) });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const close = () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, reads, asked, close };
}

describe("RoundChain's evidence reads at the deal's last block (round 1's 3d and 10a, 2026-11-05)", () => {
  const id = commitmentIdOf(terms) as Hex;
  const last = 12_069_856n;
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  const open = async (misses: number) => {
    const rpc = await laggingRpc(last, misses);
    close = rpc.close;
    const chain = await RoundChain.open(rpc.url, SEPOLIA!);
    chain.pinnedRetry = { tries: 4, gapMs: 10 };
    return { chain, reads: rpc.reads };
  };

  it('reads the latest block when given none, as before', async () => {
    const { chain, reads } = await open(0);
    expect((await chain.deal(id)).stage).toBe('None');
    expect(reads).toEqual([{ fn: 'dealOf', block: 'latest' }]);
  });

  it("retries a node that does not have the deal's last block yet, and reports the state after that block", async () => {
    const { chain, reads } = await open(2);
    expect((await chain.deal(id, last)).stage).toBe('Settled');
    expect(await chain.payment(terms, id, last)).toEqual({ collected: false, capturable: '0', refundable: '15000000' });
    expect((await chain.holdings([terms.buyer], last))[terms.buyer]).toEqual({ token: '12000000', bond: '0', free: '0' });
    expect(reads.filter((r) => r.fn === 'dealOf')).toHaveLength(3);
    expect(reads.filter((r) => r.block !== numberToHex(last))).toEqual([]);
  });

  it("reads deliveryHashOf at the deal's last block when given it (PR 220 review)", async () => {
    const { chain, reads } = await open(0);
    expect(await chain.deliveryHashOf(id, last)).toBe(`0x${'d1'.repeat(32)}`);
    expect(reads).toEqual([{ fn: 'deliveryHashOf', block: numberToHex(last) }]);
  });

  it('throws once no node serves the block within its tries, and never reports the state before it', async () => {
    const { chain, reads } = await open(Number.POSITIVE_INFINITY);
    await expect(chain.deal(id, last)).rejects.toThrow(/header not found/);
    expect(reads).toHaveLength(4);
    expect(reads.filter((r) => r.block !== numberToHex(last))).toEqual([]);
  });

  it("openDeals reads each deal at its last block or later, so a deal that has just closed is not open (round 1's 5a)", async () => {
    // 5a's deal 0x3a279b…dfb2 read Escalated through block 12,071,609 and Refunded from 12,071,610, its default's block;
    // the gate after 5a read the latest block from a node behind it and stopped the eleven scenarios after 5a.
    const rpc = await laggingRpc(last, 1, { stages: { before: 'Escalated', after: 'Refunded' } });
    close = rpc.close;
    const chain = await RoundChain.open(rpc.url, SEPOLIA!);
    chain.pinnedRetry = { tries: 4, gapMs: 10 };
    const run = { round: { chain }, deals: [{ id, chain: { stage: 'Refunded', block: Number(last) } }] } as unknown as Run;
    expect(await openDeals(run)).toEqual([]);
    expect(rpc.reads.filter((r) => r.fn === 'dealOf').map((r) => r.block)).toEqual([numberToHex(last), numberToHex(last)]);
  });
});

describe("the round's own transactions and the reads after them (PR 210 review: a mint, then a lagging node)", () => {
  const last = 12_069_856n;
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  const open = async (o: { receiptMisses?: number; baseFeeGwei?: string } = {}) => {
    const rpc = await laggingRpc(last, 0, o);
    close = rpc.close;
    const chain = await RoundChain.open(rpc.url, SEPOLIA!);
    chain.pinnedRetry = { tries: 4, gapMs: 10 };
    return { chain, reads: rpc.reads, asked: rpc.asked };
  };
  const receiptReads = (asked: string[]) => asked.filter((m) => m === 'eth_getTransactionReceipt').length;

  it('reads a receipt again while the node has none, as right after waitForTransactionReceipt', async () => {
    const { chain, asked } = await open({ receiptMisses: 2 });
    const rec = await chain.transaction(MINT_TX);
    expect(rec).toMatchObject({ tx: MINT_TX, status: 'success', block: Number(last), gasUsed: '51234', calls: [], logs: [] });
    expect(receiptReads(asked)).toBe(3);
  });

  it('throws a receipt no node serves within its tries', async () => {
    const { chain, asked } = await open({ receiptMisses: Number.POSITIVE_INFINITY });
    await expect(chain.transaction(MINT_TX)).rejects.toThrow(/could not be found/);
    expect(receiptReads(asked)).toBe(4);
  });

  it("fresh() is the latest block, or the block of the round's newest transaction when the node is behind it", async () => {
    const { chain } = await open();
    expect(await chain.fresh()).toBe(last - 1n);
    await chain.transaction(MINT_TX);
    expect(await chain.fresh()).toBe(last);
  });

  it("refreshBefore reads a party's balance after the round's own mint, where the latest block still shows the balance before it", async () => {
    const { chain, reads } = await open();
    const buyer = terms.buyer;
    const run = { round: { chain } } as unknown as Run;
    const deal = { record: { balances: { before: { [buyer]: { token: '1000000', bond: '0', free: '0' } } } } } as unknown as Deal;
    // The mint's receipt, as send() reads it after waitForTransactionReceipt.
    await chain.transaction(MINT_TX);
    await refreshBefore(run, deal, buyer);
    expect(deal.record.balances.before[buyer]).toEqual({ token: '12000000', bond: '0', free: '0' });
    expect(reads.filter((r) => r.block !== numberToHex(last))).toEqual([]);
  });

  it("counts a relayer lane's nonce at its funding's block, where the latest block still counts the one before (scenario 11, T-232)", async () => {
    const rpc = await laggingRpc(last, 1);
    close = rpc.close;
    const chain = await RoundChain.open(rpc.url, SEPOLIA!);
    chain.pinnedRetry = { tries: 4, gapMs: 10 };
    const lane = '0x00000000000000000000000000000000000000a1';
    // The latest block trails the funding: a read there counts the nonce before it, which the delivery's broadcast then seems to move.
    expect(await chain.client.getTransactionCount({ address: lane, blockTag: 'latest' })).toBe(4);
    rpc.reads.length = 0;
    expect(await chain.nonceAfter(lane, last)).toBe(5);
    // Pinned at the funding's block, asked again once while the node had no header for it, never at the latest block.
    expect(rpc.reads).toEqual([
      { fn: 'getTransactionCount', block: numberToHex(last) },
      { fn: 'getTransactionCount', block: numberToHex(last) },
    ]);
  });

  it('send refuses above the 20 gwei fee cap, before it signs anything', async () => {
    const { chain, asked } = await open({ baseFeeGwei: '30' });
    await expect(chain.send(generatePrivateKey(), 'token', 'approve', [SEPOLIA!.bonds, 1n])).rejects.toThrow(/refusing to send approve: the network asks [\d.]+ gwei per gas, above the 20 gwei cap/);
    expect(asked).not.toContain('eth_sendRawTransaction');
    expect(asked).not.toContain('eth_getTransactionCount');
  });
});

describe("the chain's own list of a deal's transactions (PR 220 review)", () => {
  const id = commitmentIdOf(terms) as Hex;
  const known = `0x${'aa'.repeat(32)}` as Hex;
  const unnamed = `0x${'bb'.repeat(32)}` as Hex;
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  /** eth_getLogs answers the deal's logs; the first `misses` answers come from a node behind, without the known transaction. */
  const logsRpc = async (misses: number) => {
    const asked: Array<{ address: string; fromBlock: string; toBlock: string; topics: Array<string | null> }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const { id: rid, method, params } = JSON.parse(body) as { id: number; method: string; params: J[] };
        const reply = (x: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rid, ...x }));
        if (method === 'eth_chainId') return reply({ result: numberToHex(SEPOLIA_CHAIN_ID) });
        if (method !== 'eth_getLogs') return reply({ error: { code: -32601, message: `${method} is not served here` } });
        asked.push(params[0]);
        const log = (tx: Hex) => ({ address: SEPOLIA!.rules.toLowerCase(), topics: [`0x${'01'.repeat(32)}`, id], data: '0x', blockNumber: '0x1', transactionHash: tx, transactionIndex: '0x0', blockHash: `0x${'0b'.repeat(32)}`, logIndex: '0x0', removed: false });
        reply({ result: asked.length <= misses ? [log(unnamed)] : [log(known), log(unnamed), log(known)] });
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    close = () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
    const chain = await RoundChain.open(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, SEPOLIA!);
    chain.pinnedRetry = { tries: 3, gapMs: 10 };
    return { chain, asked };
  };

  it('lists every transaction whose HoldbackRules logs name the deal, once each, asking again while a node lacks a known one', async () => {
    const { chain, asked } = await logsRpc(1);
    expect(await chain.dealTransactions(id, 12_071_560n, 12_071_600n, [known])).toEqual([known, unnamed]);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toEqual({ address: SEPOLIA!.rules, fromBlock: numberToHex(12_071_560n), toBlock: numberToHex(12_071_600n), topics: [null, id] });
  });

  it('throws once no node serves a known transaction within its tries', async () => {
    const { chain, asked } = await logsRpc(Number.POSITIVE_INFINITY);
    await expect(chain.dealTransactions(id, 12_071_560n, 12_071_600n, [known])).rejects.toThrow(/lack 0xaaaa.*: it is behind/);
    expect(asked).toHaveLength(3);
  });
});

/** The token's revert when it refuses `transferFrom` (SafeTransferLib's TransferFromFailed()), as round 1's bond deposit met it. */
const TRANSFER_FROM_FAILED = '0x7939f424';

/**
 * A JSON-RPC stand-in for a load-balanced endpoint that also takes the round's own sends. Each sent transaction is
 * mined at once in the next block, but the node that answers `latest` (the block number, nonce counts, and calls and
 * gas estimates with no block) is one block behind the newest of them, as publicnode was when 3b's bond deposit
 * followed its approval in round 1's 2026-11-05 runs. A call or estimate at a block that node lacks finds no header the
 * first `misses` times, then another node answers it. The token's `transferFrom` from the sender's own balance passes
 * only on a state that holds the sender's approval, and otherwise reverts TransferFromFailed, as the bond deposit did
 * before phase one removed the vault (ADR-0031 §8). A node takes a transaction only with the sender's next
 * nonce. `pending` adds transactions in flight to an address's pending count, as another run sending from it would.
 */
async function walletRpc(o: { misses?: number; pending?: Record<string, number> } = {}) {
  const d = SEPOLIA!;
  const contractAt: Record<string, keyof typeof ABIS> = { [d.token.address.toLowerCase()]: 'token' };
  const START = 12_071_530n;
  let head = START;
  const mined: Array<{ hash: Hex; from: string; to: string; nonce: number; block: bigint; fn: string; tx: ReturnType<typeof parseTransaction> }> = [];
  const calls: Array<{ method: string; fn: string; block: string }> = [];
  const asked: string[] = [];
  let missed = 0;
  /** The block the lagging node calls latest: one behind the newest mined transaction. */
  const latest = () => (head > START ? head - 1n : head);
  const sent = (from: string, upTo: bigint) => mined.filter((t) => t.from === from && t.block <= upTo).length;
  const blockOf = (tag: string | undefined) => (tag === undefined || tag === 'latest' || tag === 'pending' ? latest() : BigInt(tag));
  const txJson = (t: (typeof mined)[number]) => ({
    hash: t.hash, from: t.from, to: t.to, nonce: numberToHex(t.nonce), blockNumber: numberToHex(t.block), blockHash: keccak256(numberToHex(t.block)), transactionIndex: '0x0', type: '0x2',
    input: t.tx.data ?? '0x', gas: numberToHex(t.tx.gas ?? 0n), value: '0x0', maxFeePerGas: numberToHex(t.tx.maxFeePerGas ?? 0n), maxPriorityFeePerGas: numberToHex(t.tx.maxPriorityFeePerGas ?? 0n),
    chainId: numberToHex(SEPOLIA_CHAIN_ID), accessList: [], v: '0x0', yParity: '0x0', r: `0x${'01'.repeat(32)}`, s: `0x${'02'.repeat(32)}`,
  });
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', async () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: J[] };
      asked.push(method);
      const reply = (x: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...x }));
      const find = (hash: string) => mined.find((t) => t.hash === hash.toLowerCase());
      switch (method) {
        case 'eth_chainId':
          return reply({ result: numberToHex(SEPOLIA_CHAIN_ID) });
        case 'eth_blockNumber':
          return reply({ result: numberToHex(latest()) });
        case 'eth_getBlockByNumber':
          return reply({ result: { number: numberToHex(latest()), hash: keccak256(numberToHex(latest())), timestamp: numberToHex(1_793_000_000), baseFeePerGas: numberToHex(parseGwei('1')), transactions: [] } });
        case 'eth_maxPriorityFeePerGas':
          return reply({ result: numberToHex(parseGwei('1')) });
        case 'eth_getTransactionCount': {
          const a = String(params[0]).toLowerCase();
          return reply({ result: numberToHex(sent(a, blockOf(params[1])) + (params[1] === 'pending' ? (o.pending?.[a] ?? 0) : 0)) });
        }
        case 'eth_call':
        case 'eth_estimateGas': {
          const call = params[0] as { from?: string; to: string; data: Hex };
          const { functionName } = decodeFunctionData({ abi: ABIS[contractAt[call.to.toLowerCase()]!], data: call.data });
          calls.push({ method, fn: functionName, block: params[1] ?? 'latest' });
          const at = blockOf(params[1]);
          if (at > head || (at > latest() && missed < (o.misses ?? 0))) {
            missed++;
            return reply({ error: { code: -32000, message: 'header not found' } });
          }
          const from = String(call.from).toLowerCase();
          if (functionName === 'transferFrom' && !mined.some((t) => t.from === from && t.fn === 'approve' && t.block <= at)) return reply({ error: { code: 3, message: 'execution reverted', data: TRANSFER_FROM_FAILED } });
          if (method === 'eth_estimateGas') return reply({ result: numberToHex(60_000) });
          return reply({ result: encodeFunctionResult({ abi: ABIS.token, functionName, result: true } as never) });
        }
        case 'eth_sendRawTransaction': {
          const raw = params[0] as Hex;
          const tx = parseTransaction(raw);
          const from = (await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase();
          const next = sent(from, head);
          const nonce = tx.nonce ?? 0;
          if (nonce !== next) return reply({ error: { code: -32000, message: `nonce ${nonce < next ? 'too low' : 'too high'}: next nonce ${next}, tx nonce ${nonce}` } });
          head++;
          const { functionName } = decodeFunctionData({ abi: ABIS[contractAt[tx.to!.toLowerCase()]!], data: tx.data! });
          const t = { hash: keccak256(raw), from, to: tx.to!.toLowerCase(), nonce, block: head, fn: functionName, tx };
          mined.push(t);
          return reply({ result: t.hash });
        }
        case 'eth_getTransactionByHash': {
          const t = find(params[0]);
          return reply({ result: t ? txJson(t) : null });
        }
        case 'eth_getTransactionReceipt': {
          const t = find(params[0]);
          if (!t) return reply({ result: null });
          return reply({ result: { transactionHash: t.hash, transactionIndex: '0x0', blockHash: keccak256(numberToHex(t.block)), blockNumber: numberToHex(t.block), from: t.from, to: t.to, cumulativeGasUsed: numberToHex(50_000), gasUsed: numberToHex(50_000), effectiveGasPrice: numberToHex(parseGwei('2')), logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', type: '0x2', contractAddress: null } });
        }
        default:
          return reply({ error: { code: -32601, message: `${method} is not served here` } });
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const close = () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, mined, calls, asked, close };
}

describe("the round's own sends from one key in a row (round 1's 3b, 2026-11-05)", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  const open = async (o: Parameters<typeof walletRpc>[0] = {}) => {
    const rpc = await walletRpc(o);
    close = rpc.close;
    const chain = await RoundChain.open(rpc.url, SEPOLIA!);
    chain.pinnedRetry = { tries: 4, gapMs: 10 };
    return { chain, rpc };
  };

  /** An approval, then a transferFrom that needs it, from one key: the shape of round 1's 3b (a bond deposit then). */
  const approveThenMove = async (chain: RoundChain, key: Hex) => {
    const self = privateKeyToAccount(key).address;
    const approved = await chain.send(key, 'token', 'approve', [self, 25_000_000n]);
    const moved = await chain.send(key, 'token', 'transferFrom', [self, SEPOLIA!.rules, 25_000_000n]);
    return [approved, moved] as const;
  };

  it("sends a call right after the approval it needs: the simulation and the gas estimate read the approval's block, and the call takes the next nonce", async () => {
    // Before the fix the second call was simulated at the latest block of a node that had not seen the approval, and
    // reverted TransferFromFailed: adjudicator-1's bond deposit in run 2026-11-05T190711Z, adjudicator-2's in 2026-11-05T193705Z.
    const { chain, rpc } = await open();
    const [approved, moved] = await approveThenMove(chain, generatePrivateKey());
    expect(moved.block).toBe(approved.block + 1);
    expect(rpc.calls.filter((c) => c.fn === 'transferFrom')).toEqual([
      { method: 'eth_call', fn: 'transferFrom', block: numberToHex(approved.block) },
      { method: 'eth_estimateGas', fn: 'transferFrom', block: numberToHex(approved.block) },
    ]);
    // The lagging node still counts the approval's nonce as pending: the call takes the one after it anyway.
    expect(rpc.mined.map((t) => [t.fn, t.nonce])).toEqual([['approve', 0], ['transferFrom', 1]]);
  });

  it("tries a simulation at the round's last block again while the node answering has no header for it", async () => {
    const { chain, rpc } = await open({ misses: 2 });
    await approveThenMove(chain, generatePrivateKey());
    expect(rpc.calls.filter((c) => c.fn === 'transferFrom' && c.method === 'eth_call')).toHaveLength(3);
    expect(rpc.mined.map((t) => t.fn)).toEqual(['approve', 'transferFrom']);
  });

  it("refuses at the contract's first revert, without trying again and without sending", async () => {
    const { chain, rpc } = await open();
    const key = generatePrivateKey();
    await expect(chain.send(key, 'token', 'transferFrom', [privateKeyToAccount(key).address, SEPOLIA!.rules, 25_000_000n])).rejects.toThrow(/reverted with the following signature:\s+0x7939f424/);
    expect(rpc.calls).toEqual([{ method: 'eth_call', fn: 'transferFrom', block: numberToHex(12_071_530n) }]);
    expect(rpc.asked).not.toContain('eth_sendRawTransaction');
  });

  it('starts once no round key has a transaction pending, and refuses after its wait while one has, naming the key', async () => {
    const seed = generatePrivateKey();
    const keys = { buyer: privateKeyToAccount(roundKey(seed, 'buyer')).address, seller: privateKeyToAccount(roundKey(seed, 'seller')).address };
    const idle = await open();
    await expect(idle.chain.untilIdle(keys, { waitMs: 50, gapMs: 10 })).resolves.toBeUndefined();
    await close?.();
    const busy = await open({ pending: { [keys.seller.toLowerCase()]: 1 } });
    await expect(busy.chain.untilIdle(keys, { waitMs: 50, gapMs: 10 })).rejects.toThrow(new RegExp(`refusing to start: the seller ${keys.seller} has 1 transaction\\(s\\) pending .*another run may be sending from the round's keys`));
    expect(busy.rpc.asked).not.toContain('eth_sendRawTransaction');
  });
});
