// The round's chain helpers, offline: the chain guard (the check docs/team.md pairs with the no-real-money rule), the
// CPP payment key against the buyer's funding nonce, the per-role encryption keys, and the evidence reads pinned to the
// deal's last block against a stand-in for a load-balanced RPC whose nodes lag each other.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeFunctionData, encodeFunctionResult, numberToHex, type Abi, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { ANVIL_CHAIN_ID, assertRoundChain, paymentHashOf, RoundChain, SEPOLIA_CHAIN_ID, STAGES, termsTuple } from './e2e-chain.ts';
import { roundEncryptionKey, roundKey } from './e2e-keys.ts';
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

/**
 * A JSON-RPC stand-in for a load-balanced endpoint such as publicnode: `latest` comes from a node one block behind the
 * deal's last transaction (block `last`), and a read at `last` finds no header the first `misses` times, as on a node
 * that has not caught up yet.
 */
async function laggingRpc(last: bigint, misses: number) {
  const reads: Array<{ fn: string; block: string }> = [];
  const d = SEPOLIA!;
  const contractAt: Record<string, keyof typeof ABIS> = { [d.rules.toLowerCase()]: 'rules', [d.escrow.toLowerCase()]: 'escrow', [d.bonds.toLowerCase()]: 'bonds', [d.token.address.toLowerCase()]: 'token' };
  let missed = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: [{ to: string; data: Hex }, string] };
      const reply = (x: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...x }));
      if (method === 'eth_chainId') return reply({ result: numberToHex(SEPOLIA_CHAIN_ID) });
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
      const result = { dealOf: { stage: s.stage, attempt: 1, appeal: 0, flags: 0, t1: 0, t2: 0, seedTag: 0n }, paymentState: [false, s.capturable, s.refundable], balanceOf: s.token, bondOf: s.bond, freeOf: s.free }[functionName];
      reply({ result: encodeFunctionResult({ abi, functionName, result } as never) });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const close = () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, reads, close };
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
