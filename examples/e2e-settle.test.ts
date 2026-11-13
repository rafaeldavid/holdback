// The settle command (e2e-settle.ts, `e2e-round.ts settle`), offline. It closes only one of the round's own open deals:
// the terms must hash to the commitment ID and name the round's buyer and seller, and dealOf, read at a pinned block,
// must show a stage a MutualSettlement closes. A dry run signs and sends nothing. Against stand-in operators and a
// stand-in RPC pinned to Sepolia: the refusals, the dry run, and the first operator's refusal with the second relaying
// the same signed message. On anvil, as round 1's scenario 8 left its deal on 2026-11-06 (delivered directly, so both
// operators fall behind the chain and refuse it): the direct send from the buyer's key, and a Held deal settled
// through the API to the seller.
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, numberToHex, parseGwei, recoverTypedDataAddress, type Abi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { SEPOLIA_CHAIN_ID, STAGES, termsTuple } from './e2e-chain.ts';
import { roundKey } from './e2e-keys.ts';
import { fund, get, openDeal, Round, Run, shortWindows, sleep, until } from './e2e-run.ts';
import { CHECKS, CSV, DATASET, PRICE } from './e2e-scenario-kit.ts';
import { deliveryTuple } from './e2e-scenarios-direct.ts';
import { mutualSettleArgs, parseSettle, planSettlement, settleDeal } from './e2e-settle.ts';
import { ANVIL_SKIP, anvilReady, anvilWorld, driver, expectNoSecrets, type AnvilWorld } from './e2e-world.ts';
import { commitmentIdOf, pinOf, Refusal, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// tUSDC on Sepolia. The name is not "token": gitleaks' generic-api-key rule keys on it (PR 219).
const ASSET = SEPOLIA!.token.address.toLowerCase();
const DEMO_PRIMARY = '0x71f8a3e163528c773fb358a718294a0b32697c9e';
const STRANGER = '0x59d794504087069ded88dc3c8f3ff9dda8e44e36';
/** The delivery's hash as deliveryHashOf returns it in the stand-in. */
const POSTED = `0x${'d1'.repeat(32)}` as Hex;
const ZERO32 = `0x${'00'.repeat(32)}` as Hex;
const addressOf = (seed: Hex, role: 'buyer' | 'seller') => privateKeyToAccount(roundKey(seed, role)).address.toLowerCase();

/** Public terms in the shape the operators serve, on Sepolia's token: 25 tUSDC, with a 1 tUSDC adjudication fee. */
const termsOf = (buyer: string, seller: string, nonce = `0x${'44'.repeat(32)}`) => ({
  schemaVersion: '0.8', clubId: 'demo-club', rulebookHash: `0x${'11'.repeat(32)}`, buyer, seller, buyerPaymentAddress: buyer, sellerPayoutAddress: seller,
  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
  acceptance: { deterministicChecks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }], rubric: { criteria: [], passThreshold: 0 } },
  price: { token: ASSET, amount: '25000000' },
  adjudication: { adjudicator: DEMO_PRIMARY, fallbackAdjudicator: '0x0000000000000000000000000000000000000b0b', appealAdjudicator: '0x0000000000000000000000000000000000000c0c', policyId: 'demo-policy', fee: { token: ASSET, amount: '1000000' }, registryHash: `0x${'22'.repeat(32)}`, policyHash: `0x${'33'.repeat(32)}` },
  timing: { offerExpiresAt: '2026-11-06T07:41:41Z', fundBy: '2026-11-06T07:56:41Z', deliverBy: '2026-11-07T07:26:41Z', judgeBy: '2026-11-07T07:27:41Z', fallbackBy: '2026-11-07T07:28:41Z', appealWindowSec: 0, appealDecideSec: 60, maxSubmissions: 1 },
  settlement: { mode: 'guaranteed_on_decision', token: ASSET }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
  buyerEncryptionPublicKey: 'A'.repeat(43), nonce, createdAt: '2026-11-06T07:26:41Z',
});

describe('parseSettle: the command line', () => {
  const id = `0x${'71'.repeat(32)}`;
  it('takes one commitment ID, pays the buyer back by default, and sends unless --dry-run', () => {
    expect(parseSettle([id])).toEqual({ id, direction: 'to-buyer', dryRun: false });
    expect(parseSettle([id.toUpperCase().replace('0X', '0x'), '--to-buyer'])).toEqual({ id, direction: 'to-buyer', dryRun: false });
    expect(parseSettle(['--to-seller', id, '--dry-run'])).toEqual({ id, direction: 'to-seller', dryRun: true });
  });
  it('refuses both directions, an option it does not know (a mistyped --dry-run would otherwise send), and anything but one ID', () => {
    expect(parseSettle([id, '--to-buyer', '--to-seller'])).toEqual({ error: 'settle takes --to-buyer or --to-seller, not both' });
    expect(parseSettle([id, '--dryrun'])).toEqual({ error: 'settle takes only --to-buyer, --to-seller and --dry-run, not --dryrun' });
    expect(parseSettle([])).toMatchObject({ error: expect.stringMatching(/^settle takes one commitment ID/) });
    expect(parseSettle(['0x12'])).toMatchObject({ error: expect.stringMatching(/^settle takes one commitment ID, 0x and 64 hex digits, not 0x12$/) });
    expect(parseSettle([id, id])).toMatchObject({ error: expect.stringMatching(/^settle takes one commitment ID/) });
  });
});

describe("planSettlement: only the round's own open deal, and exactly the message both keys sign", () => {
  const seed = generatePrivateKey();
  const [buyer, seller] = [addressOf(seed, 'buyer'), addressOf(seed, 'seller')];
  const terms = termsOf(buyer, seller);
  const id = commitmentIdOf(terms);
  const base = { id, terms, buyer, seller, stage: 'Delivered', block: 12_075_100n, deliveryHash: POSTED, direction: 'to-buyer' as const, nonce: `0x${'5a'.repeat(32)}` as Hex, expiresAt: '2026-11-06T12:00:00Z' };

  it('pays the price back to the buyer by default, naming the delivery dealOf holds, with no key released', () => {
    const p = planSettlement(base);
    expect(p.message).toEqual({ type: 'MutualSettlement', commitmentId: id, deliveryHash: POSTED, payouts: [{ to: buyer, amount: { token: ASSET, amount: '25000000' } }], releaseKey: false, nonce: base.nonce, expiresAt: base.expiresAt });
    // The adjudication fee returns to the buyer too: HoldbackRules' MUTUAL_FEE_SHARE_BPS is 0.
    expect([p.toBuyer, p.toSeller]).toEqual([26_000_000n, 0n]);
  });

  it('pays the price to the seller with --to-seller, and names no delivery for a Held deal', () => {
    const p = planSettlement({ ...base, stage: 'Held', deliveryHash: null, direction: 'to-seller' });
    expect(p.message).toMatchObject({ deliveryHash: null, payouts: [{ to: seller, amount: { token: ASSET, amount: '25000000' } }], releaseKey: false });
    expect([p.toBuyer, p.toSeller]).toEqual([1_000_000n, 25_000_000n]);
  });

  it('settles a deal in each stage HoldbackRules.mutualSettle takes', () => {
    for (const stage of ['Delivered', 'FallbackJudging', 'Escalated']) expect(planSettlement({ ...base, stage }).message.deliveryHash).toBe(POSTED);
  });

  it("refuses a deal whose buyer or seller is not the round's, naming both pairs", () => {
    for (const t of [termsOf(STRANGER, seller), termsOf(buyer, STRANGER), termsOf(seller, buyer)]) {
      const other = { ...base, id: commitmentIdOf(t), terms: t };
      expect(() => planSettlement(other)).toThrow(Refusal);
      expect(() => planSettlement(other)).toThrow(new RegExp(`^refusing: ${other.id} is not one of the round's own deals\\. Its terms name the buyer ${t.buyer} and the seller ${t.seller}; the round's keys are the buyer ${buyer} and the seller ${seller}\\.`));
    }
  });

  it('refuses terms that do not hash to the commitment ID: an operator cannot pass off another deal under it', () => {
    const t = termsOf(buyer, seller, `0x${'45'.repeat(32)}`);
    expect(() => planSettlement({ ...base, terms: t })).toThrow(new RegExp(`^refusing: the terms the operators serve for ${id} hash to ${commitmentIdOf(t)}, another commitment ID`));
  });

  it('refuses a deal that holds nothing to settle, by its stage at the block it was read at', () => {
    for (const stage of ['None', 'Released', 'Refunded', 'Settled']) {
      expect(() => planSettlement({ ...base, stage })).toThrow(new RegExp(`^refusing: dealOf reads ${id} ${stage} at block 12075100, and a mutual settlement closes only a Held, Delivered, FallbackJudging or Escalated deal`));
    }
  });

  it('refuses a delivered deal whose deliveryHashOf reads zero, and a price of 0, which no payout can carry', () => {
    expect(() => planSettlement({ ...base, deliveryHash: ZERO32 })).toThrow(/deliveryHashOf reads zero/);
    const free = { ...terms, price: { token: ASSET, amount: '0' } };
    expect(() => planSettlement({ ...base, id: commitmentIdOf(free), terms: free })).toThrow(/price of 0/);
  });
});

const ABIS = JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as Record<'rules' | 'token' | 'escrow', Abi>;
/** The settlement transaction in the stand-in, mined in block SETTLED_AT once an operator relays it. */
const SETTLE_TX = `0x${'5e'.repeat(32)}` as Hex;
const PLANNED_AT = 12_075_100n;
const SETTLED_AT = PLANNED_AT + 1n;
const STORE = '0x9467f22ec7623b17a1f1c34d2575eec90caaa162';
const BEHIND = "Behind the chain: the seller's delivery landed in transaction 0xc9c0…fa0a without passing through this node, and the contract keeps only its hash, so this node holds no envelopes for the adjudicators. The state shown is the contract's.";

/** How a stand-in operator answers a posted settlement: refuse it, relay it, or relay it and then answer an error. */
type Answer = 'refuse' | 'relay' | 'relay-then-fail';
interface StandIn {
  urls: string[];
  rpcUrl: string;
  posts: Array<{ node: number; body: J }>;
  calls: Array<{ fn: string; block: string }>;
  asked: string[];
  close(): Promise<void>;
}

/**
 * Two operator origins (127.0.0.1 is node 0, localhost node 1) serving discovery for Sepolia's pinned deployment, the
 * deal's terms and view, and answering a posted settlement as `answers` says; and an RPC on Sepolia's chain whose
 * latest block is PLANNED_AT. dealOf reads `stage`; once an operator relays, block SETTLED_AT holds the settlement:
 * dealOf Settled, CPP's capturable 0, and the transaction's logs (the hold back to the buyer).
 */
async function standIn(o: { terms: J; stage: string; answers?: [Answer, Answer] }): Promise<StandIn> {
  const pin = pinOf(SEPOLIA!);
  const id = commitmentIdOf(o.terms);
  const served = { ...o.terms, id, signatures: { seller: `0x${'00'.repeat(65)}` } };
  const posts: StandIn['posts'] = [];
  const calls: StandIn['calls'] = [];
  const asked: string[] = [];
  let settled = false;
  /** The settlement an operator relayed: the settlement transaction's input carries it. */
  let relayed: J | undefined;
  const discovery = () => ({ domain: pin.domain, demo: { clubId: 'demo-club', token: { id: pin.token.id }, minWindowSec: 60, adjudicators: ['primary', 'fallback', 'appeal'].map((role, i) => ({ role, address: `0x${String(i + 1).repeat(40)}` })) }, fees: { operator: null }, settlementTime: new Date().toISOString() });
  const operators: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const node = (req.headers.host ?? '').startsWith('localhost') ? 1 : 0;
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const url = req.url ?? '';
    if (url === '/.well-known/holdback.json') return send(200, discovery());
    if (url === '/v1/status') return send(200, { schemaVersion: '0.11', domain: pin.domain });
    if (url === `/v1/commitments/${id}/terms`) return send(200, served);
    if (url === `/v1/commitments/${id}`) return send(200, { commitmentId: id, escrowState: settled ? 'Settled' : o.stage, updatedAt: '2026-11-06T07:26:50Z', notices: [BEHIND] });
    if (req.method === 'POST' && url === `/v1/commitments/${id}/settlements`) {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      posts.push({ node, body });
      const answer = o.answers?.[node] ?? 'refuse';
      if (answer === 'refuse') return send(409, { type: 'invalid_state', detail: BEHIND });
      settled = true;
      relayed = body;
      if (answer === 'relay-then-fail') return send(500, { type: 'internal', detail: 'the stand-in relayed it, then failed before answering' });
      return send(200, { commitmentId: id, escrowState: 'Settled' });
    }
    send(404, { type: 'not_found', detail: 'stand-in' });
  });
  const d = SEPOLIA!;
  const contractAt: Record<string, keyof typeof ABIS> = { [d.rules.toLowerCase()]: 'rules', [d.escrow.toLowerCase()]: 'escrow', [d.token.address.toLowerCase()]: 'token' };
  const hold = BigInt(o.terms.price.amount) + BigInt(o.terms.adjudication.fee.amount);
  const log = (contract: keyof typeof ABIS, address: string, eventName: string, args: J, data: Hex, i: number) => ({
    address: address.toLowerCase(), topics: encodeEventTopics({ abi: ABIS[contract], eventName, args } as never), data,
    blockNumber: numberToHex(SETTLED_AT), transactionHash: SETTLE_TX, transactionIndex: '0x0', blockHash: `0x${'b1'.repeat(32)}`, logIndex: numberToHex(i), removed: false,
  });
  const uint = (v: bigint) => encodeAbiParameters([{ type: 'uint256' }], [v]);
  const logs = () => [
    log('token', d.token.address, 'Transfer', { from: STORE, to: o.terms.buyer }, uint(hold), 1),
    log('rules', d.rules, 'Refunded', { jobId: id, client: o.terms.buyer }, uint(hold), 2),
    log('rules', d.rules, 'MutuallySettled', { id }, encodeAbiParameters([{ type: 'bool' }], [false]), 3),
  ];
  const at = { blockHash: `0x${'b1'.repeat(32)}`, blockNumber: numberToHex(SETTLED_AT), from: o.terms.buyer, to: d.rules, transactionIndex: '0x0', type: '0x2' };
  const rpc: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const { id: rid, method, params } = JSON.parse(body) as { id: number; method: string; params: J[] };
      asked.push(method);
      const reply = (x: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rid, ...x }));
      switch (method) {
        case 'eth_chainId':
          return reply({ result: numberToHex(SEPOLIA_CHAIN_ID) });
        case 'eth_blockNumber':
          return reply({ result: numberToHex(settled ? SETTLED_AT : PLANNED_AT) });
        case 'eth_getTransactionCount':
          return reply({ result: '0x0' });
        case 'eth_getLogs':
          return reply({ result: settled ? [logs()[2]] : [] });
        case 'eth_getTransactionReceipt':
          return reply({ result: settled && params[0] === SETTLE_TX ? { ...at, transactionHash: SETTLE_TX, status: '0x1', gasUsed: numberToHex(158_825), cumulativeGasUsed: numberToHex(158_825), effectiveGasPrice: numberToHex(parseGwei('2')), logs: logs(), logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null } : null });
        case 'eth_getTransactionByHash':
          return reply({ result: settled && params[0] === SETTLE_TX ? { ...at, hash: SETTLE_TX, input: encodeFunctionData({ abi: ABIS.rules, functionName: 'mutualSettle', args: mutualSettleArgs(o.terms, relayed) } as never), nonce: '0x0', gas: numberToHex(300_000), value: '0x0', maxFeePerGas: numberToHex(parseGwei('3')), maxPriorityFeePerGas: numberToHex(parseGwei('1')), chainId: numberToHex(SEPOLIA_CHAIN_ID), v: '0x0', yParity: '0x0', r: `0x${'01'.repeat(32)}`, s: `0x${'02'.repeat(32)}` } : null });
        case 'eth_call': {
          const call = params[0] as { to: string; data: Hex };
          const abi = ABIS[contractAt[call.to.toLowerCase()]!];
          const { functionName } = decodeFunctionData({ abi, data: call.data });
          calls.push({ fn: functionName, block: params[1] });
          const after = settled && params[1] !== 'latest' && BigInt(params[1]) >= SETTLED_AT;
          const result = {
            dealOf: { stage: STAGES.indexOf(after ? 'Settled' : (o.stage as (typeof STAGES)[number])), attempt: 1, t1: 0, seedTag: 0n, reason: after ? 3 : 0, decider: 0 },
            deliveryHashOf: o.stage === 'Held' ? ZERO32 : POSTED,
            paymentState: [true, after ? 0n : hold, 0n],
          }[functionName];
          return reply({ result: encodeFunctionResult({ abi, functionName, result } as never) });
        }
        default:
          // eth_estimateGas, eth_sendRawTransaction and the rest: the stand-in never sends anything.
          return reply({ error: { code: -32601, message: `${method} is not served here` } });
      }
    });
  });
  await Promise.all([operators, rpc].map((s) => new Promise<void>((done) => s.listen(0, '127.0.0.1', done))));
  const port = (operators.address() as AddressInfo).port;
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    rpcUrl: `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`,
    posts, calls, asked,
    close: async () => {
      for (const s of [operators, rpc]) {
        s.closeAllConnections();
        await new Promise<void>((done) => s.close(() => done()));
      }
    },
  };
}

describe('settleDeal against stand-in operators and a stand-in RPC pinned to Sepolia', () => {
  let world: StandIn | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await world?.close();
    world = undefined;
  });
  /** A round on the stand-ins, with both party keys' signing spied on, and its printed lines. */
  const open = async (seed: Hex, o: Parameters<typeof standIn>[0]) => {
    world = await standIn(o);
    const lines: string[] = [];
    const round = await Round.open({ operators: world.urls, seed, rpcUrl: world.rpcUrl, log: (l) => lines.push(l) });
    round.chain!.pinnedRetry = { tries: 2, gapMs: 10 };
    const signed = (['buyer', 'seller'] as const).map((role) => vi.spyOn(round.agent(role).account, 'signTypedData'));
    return { round, lines, signed, id: commitmentIdOf(o.terms) as Hex };
  };
  const sends = () => world!.asked.filter((m) => ['eth_estimateGas', 'eth_sendRawTransaction', 'eth_getTransactionCount'].includes(m));

  it("refuses a deal of another buyer before any signature, post or send, though the round's seller is in it", async () => {
    const seed = generatePrivateKey();
    const { round, signed, id } = await open(seed, { terms: termsOf(STRANGER, addressOf(seed, 'seller')), stage: 'Delivered', answers: ['relay', 'relay'] });
    await expect(settleDeal(round, id, { direction: 'to-buyer', dryRun: false })).rejects.toThrow(new RegExp(`^refusing: ${id} is not one of the round's own deals`));
    for (const s of signed) expect(s).not.toHaveBeenCalled();
    expect(world!.posts).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it('refuses a Settled deal, with dealOf read at a pinned block number, never "latest"', async () => {
    const seed = generatePrivateKey();
    const { round, signed, id } = await open(seed, { terms: termsOf(addressOf(seed, 'buyer'), addressOf(seed, 'seller')), stage: 'Settled', answers: ['relay', 'relay'] });
    await expect(settleDeal(round, id, { direction: 'to-buyer', dryRun: false })).rejects.toThrow(new RegExp(`^refusing: dealOf reads ${id} Settled at block ${PLANNED_AT}`));
    expect(world!.calls.filter((c) => c.fn === 'dealOf')).toEqual([{ fn: 'dealOf', block: numberToHex(PLANNED_AT) }]);
    for (const s of signed) expect(s).not.toHaveBeenCalled();
    expect(world!.posts).toEqual([]);
  });

  it('--dry-run prints exactly what the keys would sign, then signs, posts and sends nothing', async () => {
    const seed = generatePrivateKey();
    const [buyer, seller] = [addressOf(seed, 'buyer'), addressOf(seed, 'seller')];
    const { round, lines, signed, id } = await open(seed, { terms: termsOf(buyer, seller), stage: 'Delivered', answers: ['relay', 'relay'] });
    expect(await settleDeal(round, id, { direction: 'to-buyer', dryRun: true })).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain(`commitmentId ${id}`);
    expect(text).toMatch(/hasDelivery +true/);
    expect(text).toContain(`deliveryHash ${POSTED}`);
    // The signed values themselves: base units and the token's address, with the amount in tUSDC beside them.
    expect(text).toMatch(new RegExp(`payouts +25000000 base units of ${ASSET} \\(25 tUSDC\\) to the buyer ${buyer}; the seller ${seller} gets 0 tUSDC of the price`));
    expect(text).toMatch(/releaseKey +false/);
    expect(text).toContain(`dealOf reads Delivered at block ${PLANNED_AT}`);
    expect(text).toContain('the operators show it behind the chain');
    expect(text).toMatch(/dry run: nothing signed, nothing sent$/);
    for (const s of signed) expect(s).not.toHaveBeenCalled();
    expect(world!.posts).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it('posts to the first operator, then the same signed message to the second, which relays it; reads the settlement at its block', async () => {
    const seed = generatePrivateKey();
    const [buyer, seller] = [addressOf(seed, 'buyer'), addressOf(seed, 'seller')];
    const { round, lines, signed, id } = await open(seed, { terms: termsOf(buyer, seller), stage: 'Delivered', answers: ['refuse', 'relay'] });
    expect(await settleDeal(round, id, { direction: 'to-buyer', dryRun: false, waitMs: 5000 }), lines.join('\n')).toBe(0);
    for (const s of signed) expect(s).toHaveBeenCalledTimes(1);
    expect(world!.posts.map((p) => p.node)).toEqual([0, 1]);
    expect(world!.posts[1]!.body).toEqual(world!.posts[0]!.body);
    const { buyerSignature, sellerSignature, ...message } = world!.posts[1]!.body;
    expect(message).toMatchObject({ type: 'MutualSettlement', commitmentId: id, deliveryHash: POSTED, payouts: [{ to: buyer, amount: { token: ASSET, amount: '25000000' } }], releaseKey: false });
    const typed = typedOf('MutualSettlement', message, round.pin.domain);
    expect((await recoverTypedDataAddress({ ...typed, signature: buyerSignature })).toLowerCase()).toBe(buyer);
    expect((await recoverTypedDataAddress({ ...typed, signature: sellerSignature })).toLowerCase()).toBe(seller);
    // Nothing went to the chain from the round's keys: the second operator relayed it.
    expect(world!.asked).not.toContain('eth_sendRawTransaction');
    const text = lines.join('\n');
    expect(text).toMatch(/127\.0\.0\.1:\d+ refused it: .*invalid_state: Behind the chain/);
    expect(text).toMatch(/localhost:\d+ relayed it: Settled/);
    expect(text).not.toMatch(/FAIL/);
    for (const name of [`dealOf reads Settled after block ${SETTLED_AT}`, 'the buyer receives 26 tUSDC', 'the seller receives 0 tUSDC', 'CPP holds nothing to capture for the deal']) expect(text).toContain(`ok   ${name}`);
    // The evidence reads are pinned to the settlement's block.
    expect(world!.calls.filter((c) => c.fn === 'paymentState').map((c) => c.block)).toEqual([numberToHex(PLANNED_AT), numberToHex(SETTLED_AT)]);
    expect(text).toContain(`https://sepolia.etherscan.io/tx/${SETTLE_TX}`);
    expect(text).toContain('ok   the settlement is this one, with no key released: mutualSettle with this nonce');
  });

  it('sends nothing itself when an operator relayed it and then answered an error: the chain already reads Settled (PR review)', async () => {
    const seed = generatePrivateKey();
    const { round, lines, id } = await open(seed, { terms: termsOf(addressOf(seed, 'buyer'), addressOf(seed, 'seller')), stage: 'Delivered', answers: ['relay-then-fail', 'refuse'] });
    expect(await settleDeal(round, id, { direction: 'to-buyer', dryRun: false, waitMs: 5000 }), lines.join('\n')).toBe(0);
    expect(world!.posts.map((p) => p.node)).toEqual([0, 1]);
    expect(sends().filter((m) => m !== 'eth_getTransactionCount')).toEqual([]);
    const text = lines.join('\n');
    expect(text).toMatch(/127\.0\.0\.1:\d+ refused it: .*internal: the stand-in relayed it, then failed before answering/);
    expect(text).toContain(`dealOf reads Settled at block ${SETTLED_AT}: the settlement may have landed through an operator`);
    expect(text).toContain('ok   the settlement is this one, with no key released: mutualSettle with this nonce');
    expect(text).not.toMatch(/FAIL/);
  });

  it('runs as Rafa runs it: a dry run from the command line prints the plan and no key', async () => {
    const seed = generatePrivateKey();
    world = await standIn({ terms: termsOf(addressOf(seed, 'buyer'), addressOf(seed, 'seller')), stage: 'Delivered' });
    const out = mkdtempSync(join(tmpdir(), 'e2e-settle-dry-'));
    const id = commitmentIdOf(termsOf(addressOf(seed, 'buyer'), addressOf(seed, 'seller')));
    const r = await driver(['settle', id, '--dry-run'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: world.urls.join(','), SEPOLIA_RPC_URL: world.rpcUrl, E2E_OUT: out });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`commitmentId ${id}`);
    expect(r.out).toMatch(/dry run: nothing signed, nothing sent$/m);
    expect(world.posts).toEqual([]);
    expectNoSecrets(seed, r.out, out);
  }, 60_000);
});

describe('e2e-round.ts settle: usage', () => {
  // Unreachable operators: a call to them would stop with exit 1, so exit 2 shows nothing was asked of them.
  const env = { E2E_SEPOLIA_SEED: generatePrivateKey(), HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9' };
  it('refuses a bad command line with exit 2 and the usage, before any network call', async () => {
    for (const args of [['settle'], ['settle', '0x12'], ['settle', `0x${'71'.repeat(32)}`, '--to-buyer', '--to-seller'], ['settle', `0x${'71'.repeat(32)}`, '--dryrun']]) {
      const r = await driver(args, env);
      expect(r.code, `${args.join(' ')}: ${r.out}`).toBe(2);
      expect(r.out).toMatch(/^usage error: settle takes /m);
      expect(r.out).toMatch(/settle <commitmentId> \[--to-buyer\|--to-seller\] \[--dry-run\]/);
    }
  });
  it('refuses without the seed', async () => {
    const r = await driver(['settle', `0x${'71'.repeat(32)}`, '--dry-run'], { HOLDBACK_OPERATORS: env.HOLDBACK_OPERATORS });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/E2E_SEPOLIA_SEED is not set/);
  });
});

// anvil for Sepolia (e2e-world.ts): the T-202 contracts, the world's relayer lanes, a block a second.
describe.skipIf(!anvilReady)(`settle against the demo world on anvil${ANVIL_SKIP}`, () => {
  let demo: AnvilWorld;
  const seed = generatePrivateKey();
  let env: Record<string, string>;
  let round: Round;
  beforeAll(async () => {
    demo = await anvilWorld();
    process.env['HOLDBACK_DEPLOYMENT'] = JSON.stringify(demo.deployment);
    env = { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(demo.deployment), SEPOLIA_RPC_URL: demo.rpcUrl, E2E_OUT: mkdtempSync(join(tmpdir(), 'e2e-settle-anvil-')) };
    // The seller delivers directly and the buyer settles directly: each pays its own gas.
    for (const role of ['buyer', 'seller'] as const) await demo.setBalance(privateKeyToAccount(roundKey(seed, role)).address, 10n ** 18n);
    round = await Round.open({ operators: [...demo.urls], seed, rpcUrl: demo.rpcUrl, log: () => undefined });
  }, 180_000);
  afterAll(async () => {
    delete process.env['HOLDBACK_DEPLOYMENT'];
    await demo?.close();
  });
  const settlementPosts = (id: string) => demo.requests.filter((q) => q === `POST /v1/commitments/${id}/settlements`);
  /** A funded deal through the API, its delivery due in 10 minutes and its judging an hour after that, so no timeout moves it during the test. */
  const funded = async (label: string) => {
    const r = new Run(round, 'setup', label);
    const deal = await openDeal(r, { label, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing: shortWindows(r, { offerExpiresInSec: 60, fundWithinSec: 90, deliverWithinSec: 600, judgeWithinSec: 3600 }) }, [round.address('buyer'), round.address('seller')]);
    await fund(r, deal);
    await until(r, deal.seller, deal.id, ['Held'], 60_000);
    return { r, deal };
  };

  it("closes scenario 8's stuck shape: both operators refuse a deal behind the chain, and the buyer sends the same signed settlement directly", async () => {
    const { deal } = await funded('delivered directly, with no copy to the operators');
    const chain = round.chain!;
    // The seller delivers from its own key and posts no copy: neither operator holds the envelopes, so both fall behind
    // the chain, as with round 1's deal 0x71f767…1197 on 2026-11-06.
    const { prepared, intent } = await deal.seller.prepareDelivery(deal.terms, new TextEncoder().encode(CSV));
    const { body } = await deal.seller.sign(prepared, intent);
    await chain.send(round.key('seller'), 'rules', 'deliver', [termsTuple(deal.terms), deliveryTuple(body), body.signature]);
    for (const end = Date.now() + 60_000; ; await sleep(500)) {
      const views = await Promise.all(deal.buyer.sources().map((api) => get(deal.buyer, `/v1/commitments/${deal.id}`, api)));
      if (views.every((v) => v.escrowState === 'Delivered' && (v.notices ?? []).some((n: string) => n.startsWith('Behind the chain')))) break;
      if (Date.now() > end) throw new Error(`the operators did not fall behind: ${JSON.stringify(views.map((v) => [v.escrowState, v.notices]))}`);
    }
    const posted = await chain.deliveryHashOf(deal.id, await chain.fresh());
    const nonce = () => chain.client.getTransactionCount({ address: round.address('buyer') as Hex });
    const nonceBefore = await nonce();

    // The dry run prints the plan and sends nothing.
    const dry = await driver(['settle', deal.id, '--dry-run'], env);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toContain(`deliveryHash ${posted}`);
    expect(dry.out).toContain('the operators show it behind the chain');
    expect(dry.out).toMatch(/dry run: nothing signed, nothing sent$/m);
    expect(settlementPosts(deal.id)).toEqual([]);
    expect(await nonce()).toBe(nonceBefore);

    // Another round's keys: refused, nothing posted or sent.
    const other = await driver(['settle', deal.id], { ...env, E2E_SEPOLIA_SEED: generatePrivateKey() });
    expect(other.code, other.out).toBe(3);
    expect(other.out).toMatch(new RegExp(`^refused: refusing: ${deal.id} is not one of the round's own deals`, 'm'));
    expect(settlementPosts(deal.id)).toEqual([]);
    expect((await chain.deal(deal.id, await chain.fresh())).stage).toBe('Delivered');

    // The settlement: both operators refuse it, and the buyer sends it directly.
    const done = await driver(['settle', deal.id], env);
    expect(done.code, done.out).toBe(0);
    expect(settlementPosts(deal.id)).toHaveLength(2);
    // Each operator refused because the deal is behind the chain, not for a fault in the body (PR review).
    for (const origin of demo.urls.map((u) => new URL(u).origin)) {
      const line = done.out.split('\n').find((l) => l.includes(`${origin} refused it: `));
      expect(line, `${origin} in ${done.out}`).toContain('invalid_state: Behind the chain');
    }
    expect(done.out).toMatch(/both operators refused it; the buyer sends mutualSettle to HoldbackRules directly/);
    const hold = BigInt(deal.terms.price.amount) + BigInt(deal.terms.adjudication.fee.amount);
    for (const name of ['dealOf reads Settled after block', `the buyer receives ${round.amount(hold)}`, 'the seller receives 0 tUSDC', 'CPP holds nothing to capture for the deal', 'the settlement is this one']) expect(done.out).toContain(`ok   ${name}`);
    expect(done.out).not.toMatch(/FAIL/);
    expect((await chain.deal(deal.id, await chain.fresh())).stage).toBe('Settled');
    expect(await nonce()).toBe(nonceBefore + 1);

    // Run again, it refuses: the deal is closed.
    const again = await driver(['settle', deal.id], env);
    expect(again.code, again.out).toBe(3);
    expect(again.out).toMatch(new RegExp(`^refused: refusing: dealOf reads ${deal.id} Settled at block \\d+`, 'm'));
    expectNoSecrets(seed, [dry.out, other.out, done.out, again.out].join('\n'), env['E2E_OUT']!);
  }, 300_000);

  it('settles a Held deal through the first operator, the price to the seller with --to-seller, the fee back to the buyer', async () => {
    const { deal } = await funded('funded through the API, nothing delivered');
    const done = await driver(['settle', deal.id, '--to-seller'], env);
    expect(done.code, done.out).toBe(0);
    expect(settlementPosts(deal.id)).toHaveLength(1);
    expect(done.out).toMatch(/127\.0\.0\.1:\d+ relayed it/);
    expect(done.out).toMatch(/hasDelivery +false/);
    expect(done.out).toContain('deliveryHash none');
    for (const name of [`the buyer receives ${round.amount(deal.terms.adjudication.fee.amount)}`, `the seller receives ${round.amount(deal.terms.price.amount)}`, 'CPP holds nothing to capture for the deal']) expect(done.out).toContain(`ok   ${name}`);
    expect(done.out).not.toMatch(/FAIL/);
    expect((await round.chain!.deal(deal.id, await round.chain!.fresh())).stage).toBe('Settled');
  }, 300_000);
});
