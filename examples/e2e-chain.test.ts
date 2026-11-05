// The round's chain helpers, offline: the chain guard (the check docs/team.md pairs with the no-real-money rule), the
// CPP payment key against the buyer's funding nonce, the per-role encryption keys, and, against a stand-in for a
// load-balanced RPC whose nodes lag each other, the evidence reads pinned to the deal's last block, the reads after the
// round's own transactions, and the fee cap on its direct sends.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeFunctionData, encodeFunctionResult, numberToHex, parseGwei, type Abi, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { ANVIL_CHAIN_ID, assertRoundChain, paymentHashOf, RoundChain, SEPOLIA_CHAIN_ID, STAGES, termsTuple } from './e2e-chain.ts';
import { roundEncryptionKey, roundKey } from './e2e-keys.ts';
import { refreshBefore, type Deal, type Run } from './e2e-run.ts';
import { commitmentIdOf, fundingNonceOf, pinOf } from './verify.ts';

/** Public terms in the shape the operators serve, on Sepolia's token. */
const terms = {
  schemaVersion: '0.7', clubId: 'demo-club', rulebookHash: `0x${'11'.repeat(32)}`,
  buyer: '0x59d794504087069ded88dc3c8f3ff9dda8e44e36', seller: '0xd89876c20a42ffa707d0bb7a72607a03d5423ed7',
  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
  acceptance: { deterministicChecks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }], rubric: { criteria: [], passThreshold: 0 } },
  price: { token: SEPOLIA!.token.address.toLowerCase(), amount: '25000000' },
  adjudication: { adjudicator: '0x71f8a3e163528c773fb358a718294a0b32697c9e', fallbackAdjudicator: '0x0000000000000000000000000000000000000b0b', appealAdjudicator: '0x0000000000000000000000000000000000000c0c', policyId: 'demo-policy', fee: { token: SEPOLIA!.token.address.toLowerCase(), amount: '1000000' }, registryHash: `0x${'22'.repeat(32)}`, policyHash: `0x${'33'.repeat(32)}` },
  timing: { offerExpiresAt: '2026-11-04T10:00:00Z', fundBy: '2026-11-04T10:15:00Z', deliverBy: '2026-11-05T10:00:00Z', judgeBy: '2026-11-05T10:01:00Z', fallbackBy: '2026-11-05T10:02:00Z', appealWindowSec: 60, appealDecideSec: 60, maxSubmissions: 1 },
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

const ABIS = JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as Record<'rules' | 'bonds' | 'token' | 'escrow', Abi>;

/** What the reads return before the deal's last transaction and after it, in base units (round 1's 3d and 10a values). */
const BEFORE = { stage: STAGES.indexOf('None'), capturable: 26_000_000n, refundable: 0n, token: 1_000_000n, bond: 25_000_000_000n, free: 24_977_500_000n };
const AFTER = { stage: STAGES.indexOf('Expired'), capturable: 0n, refundable: 15_000_000n, token: 12_000_000n, bond: 25_000_000_000n, free: 25_002_500_000n };

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
 * for it the first `receiptMisses` times. The latest block's base fee is `baseFeeGwei`. `asked` lists every method.
 */
async function laggingRpc(last: bigint, misses: number, o: { receiptMisses?: number; baseFeeGwei?: string } = {}) {
  const reads: Array<{ fn: string; block: string }> = [];
  const asked: string[] = [];
  const d = SEPOLIA!;
  const contractAt: Record<string, keyof typeof ABIS> = { [d.rules.toLowerCase()]: 'rules', [d.escrow.toLowerCase()]: 'escrow', [d.bonds.toLowerCase()]: 'bonds', [d.token.address.toLowerCase()]: 'token' };
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
      const result = { dealOf: { stage: s.stage, attempt: 1, appeal: 0, flags: 0, t1: 0, t2: 0, seedTag: 0n }, paymentState: [false, s.capturable, s.refundable], balanceOf: s.token, bondOf: s.bond, freeOf: s.free, approve: true }[functionName];
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
    expect((await chain.deal(id, last)).stage).toBe('Expired');
    expect(await chain.payment(terms, id, last)).toEqual({ collected: false, capturable: '0', refundable: '15000000' });
    expect((await chain.holdings([terms.buyer], last))[terms.buyer]).toEqual({ token: '12000000', bond: '25000000000', free: '25002500000' });
    expect(reads.filter((r) => r.fn === 'dealOf')).toHaveLength(3);
    expect(reads.filter((r) => r.block !== numberToHex(last))).toEqual([]);
  });

  it('throws once no node serves the block within its tries, and never reports the state before it', async () => {
    const { chain, reads } = await open(Number.POSITIVE_INFINITY);
    await expect(chain.deal(id, last)).rejects.toThrow(/header not found/);
    expect(reads).toHaveLength(4);
    expect(reads.filter((r) => r.block !== numberToHex(last))).toEqual([]);
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
    expect(deal.record.balances.before[buyer]).toEqual({ token: '12000000', bond: '25000000000', free: '25002500000' });
    expect(reads.filter((r) => r.block !== numberToHex(last))).toEqual([]);
  });

  it('send refuses above the 20 gwei fee cap, before it signs anything', async () => {
    const { chain, asked } = await open({ baseFeeGwei: '30' });
    await expect(chain.send(generatePrivateKey(), 'token', 'approve', [SEPOLIA!.bonds, 1n])).rejects.toThrow(/refusing to send approve: the network asks [\d.]+ gwei per gas, above the 20 gwei cap/);
    expect(asked).not.toContain('eth_sendRawTransaction');
    expect(asked).not.toContain('eth_getTransactionCount');
  });
});
