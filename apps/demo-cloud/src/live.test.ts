// The public world settling on a live chain (D41, ADR-0028), with anvil standing in for Sepolia: a block every
// second at wall-clock time, the T-202 contracts deployed from contracts/out, LiveChain sending from relayer lanes
// derived from one key. examples/try.ts runs a deal against it over HTTP in its own process, as against Sepolia,
// with the deployment pinned through HOLDBACK_DEPLOYMENT. Needs `anvil` on PATH and `forge build` output.
// T-221's anvil end to end is in registration.anvil.test.ts, which needs no network, so CI can require it.
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { EvmSettlement, LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { pinOf } from '../../../examples/verify.ts';
import { CSV, deploymentOf, ENV, estimateShim, lc, ready, RELAYER, root, runTry, serve, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

describe.skipIf(!ready)(`the public world on a live chain (anvil for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  const storage = new MemoryStorage();
  const chainOf = (rpcUrl = anvil.rpcUrl) => new LiveChain({ deployment, rpcUrls: [rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
  }, 120_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  it('sets up, runs try.ts to Released with a transaction per money step, and reopens from storage', async () => {
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() } });
    const demo = await serve(world);
    let id = '0x' as Hex;
    try {
      const status = (await (await fetch(`${demo.urls[0]}/v1/status`)).json()) as { settlement: unknown; domain: { chainId: string; verifyingContract: string } };
      expect(status.settlement).toEqual({ kind: 'chain', chainId: String(anvil.chainId) });
      expect(status.domain.verifyingContract.toLowerCase()).toBe(deployment.rules.toLowerCase());
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
      expect(world.ready()).toBe(true);

      const run = await runTry({ HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.code).toBe(0);
      // The buyer pays the gas in the operator fee: 4.71 tUSDC on a 25 tUSDC deal.
      expect(run.out).toMatch(/^fund +Held: 26 tUSDC held \(25 price \+ 1 adjudication fee\), operator fee 4\.71 tUSDC$/m);
      // The funding (with the operator fee in the same transaction), the delivery and the release: three transactions.
      const chainLines = run.out.split('\n').filter((l) => l.startsWith('chain'));
      expect(chainLines.map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
      for (const l of chainLines) expect(l).toMatch(/0x[0-9a-f]{64}$/);

      id = /commitment (0x[0-9a-f]{64}) Released/.exec(run.out)![1]! as Hex;
      const evm = world.chain as EvmSettlement;
      // T-314: the faucet mints the amount a request names: a 2,000 tUSDC deal's price and fees, to a fresh address.
      const fresh = privateKeyToAccount(keccak256(stringToBytes('t-314 fresh buyer'))).address.toLowerCase();
      const asked = await fetch(`${demo.urls[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 't-314' }, body: JSON.stringify({ address: fresh, amount: '2005710000' }) });
      const grant = (await asked.json()) as J;
      expect([asked.status, grant.granted?.amount, grant.balance?.amount]).toEqual([200, '2005710000', '2005710000']);
      expect(grant.notice).toMatch(/minted in 0x[0-9a-f]{64}/);
      expect((await evm.stage(id as `0x${string}`)).stage).toBe('Released');
      // The money moved on chain: the seller holds the price, the hold is empty.
      expect(await evm.heldFor(id as `0x${string}`)).toBe(0n);
      // No route serves a key the world holds, the relayer's lanes included.
      const paths = ['/', '/.well-known/holdback.json', '/llms.txt', '/v1/status', '/v1/adjudicators', '/v1/commitments', `/v1/commitments/${id}`, `/v1/commitments/${id}/events?limit=200`, `/v1/commitments/${id}/terms`];
      const bodies = await Promise.all(demo.urls.flatMap((u) => paths.map(async (p) => (await fetch(`${u}${p}`)).text())));
      const secrets = world.secretsForTest().map((s) => s.toLowerCase().replace(/^0x/, ''));
      expect(secrets).toContain(RELAYER.slice(2));
      for (const body of [...bodies, run.out]) for (const s of secrets) expect(body.toLowerCase().includes(s)).toBe(false);
    } finally {
      await demo.close();
    }

    // A restart (Durable Object eviction): the same storage opens without a replay and serves the same deal. Opening
    // reads no chain; the first pass verifies it.
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    const again = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() }, onError });
    expect(again.ready()).toBe(false);
    // Setup left: a pass is due in 2 s (T-057). Once set up, the Released deal is final at once (ADR-0031 §8): no deal
    // is open and no adjudicator has a turn, so no pass is due (T-057, T-218).
    expect(again.nextPass()! - Date.now()).toBeGreaterThan(1500);
    expect(again.nextPass()! - Date.now()).toBeLessThanOrEqual(2000);
    await again.work();
    expect(again.ready()).toBe(true);
    expect(again.nextPass()).toBeNull();
    expect(errors).toEqual([]);
    // The pass read the chain since the stored cursor (null when no block came since) and applied nothing twice.
    expect(again.lastSync()?.applied ?? 0).toBe(0);

    // Reopened with the RPC down: each failing setup step doubles the wait (4, 8, 16 s), not a retry every 2 s (T-057 review).
    const down = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf('http://127.0.0.1:9') }, onError: () => {} });
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await down.work();
      waits.push(down.nextPass()! - Date.now());
    }
    expect(down.ready()).toBe(false);
    for (const [i, w] of waits.entries()) {
      expect(w).toBeGreaterThan(4000 * 2 ** i - 500);
      expect(w).toBeLessThanOrEqual(4000 * 2 ** i);
    }
    // A takeover wake whose judgeBy passed during the outage (set by hand: this storage holds no Delivered deal) never
    // schedules a pass in the past, and a failing pass still rereads settlement state (T-057 review 4).
    const inside = down as unknown as { wake: number | null };
    inside.wake = Date.now() - 1000;
    expect(down.nextPass()!).toBeGreaterThan(Date.now());
    await down.work();
    expect(inside.wake).toBeNull();
    expect(again.digest()).toBe(world.digest());
    const before = (world.chain as EvmSettlement).log();
    expect((again.chain as EvmSettlement).log()).toEqual(before);
  }, 300_000);

  it('refuses to open a world created on another settlement layer', async () => {
    const sim = new MemoryStorage();
    await PublicWorld.open({ storage: sim, env: {} });
    await expect(PublicWorld.open({ storage: sim, env: {}, live: { chain: chainOf() } })).rejects.toThrow(/settles on sim/);
  });
});

// The first pilot wave's fee (T-389, Rafa 2026-11-12): the operators charge nothing, and Crow's relayer pays the gas.
// The world opens with the fee variables exactly as wrangler.op1.jsonc sets them for both nodes, on anvil standing in
// for Sepolia. Two deals, each funded from a payment address apart from the buyer's signing key, as an outside wallet
// funds one: one Released, one Refunded. The buyer signs the agreement and the funding only, with no operator-fee
// message, and pays the price plus the adjudication fee and nothing else; the seller receives the price.
// The non-zero fee keeps its own tests (fee.test.ts, live.test.ts, world.test.ts), with their own values.
// Needs `anvil` on PATH and `forge build` output.
/** The fee variables of the live nodes' config (holdback-op1's vars; holdback-op2 reads op1's World). */
function pilotFeeEnv(): Record<string, string> {
  const text = readFileSync(`${root}apps/demo-cloud/wrangler.op1.jsonc`, 'utf8');
  const config = JSON.parse(text.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')) as { vars: Record<string, string> };
  return Object.fromEntries(Object.entries(config.vars).filter(([k]) => k.startsWith('OPERATOR_FEE_')));
}

const PRICE = '25000000'; // 25 tUSDC
const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n'; // 2 rows: fails the rows check
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };

describe.skipIf(!ready)(`the first pilots' zero operator fee on a live chain (anvil for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  let shim: { url: string; close(): Promise<void> };
  let demo: { urls: [string, string]; close(): Promise<void> };
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
    shim = await estimateShim(anvil.rpcUrl);
    const chain = new LiveChain({ deployment, rpcUrls: [shim.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: pilotFeeEnv(), live: { chain } });
    demo = await serve(world);
    for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
    expect(world.ready()).toBe(true);
  }, 180_000);
  afterAll(async () => {
    await demo?.close();
    await shim?.close();
    await anvil?.stop();
  });

  it('the live config sets every fee variable to 0, and both nodes publish the schedule at 0', async () => {
    expect(pilotFeeEnv()).toEqual({ OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0', OPERATOR_FEE_GAS: '0' });
    for (const url of demo.urls) {
      const d = (await (await fetch(`${url}/.well-known/holdback.json`)).json()) as J;
      expect(d.fees.operator).toMatchObject({ bps: 0, min: '0', max: null, appliesAt: 'agree-and-fund', refundable: false });
      expect(d.notes.join(' ')).toMatch(/Operator fee: published at 0 .* relay a funded agreement free for now/);
      expect(d.notes.join(' ')).not.toMatch(/4\.70|4\.71/);
    }
  });

  /** One deal funded from a payment address apart; `work` decides Released or Refunded. */
  async function deal(work: string, outcome: 'Released' | 'Refunded'): Promise<void> {
    const pin = pinOf(deployment);
    const fresh = () => new Agent([...demo.urls], generatePrivateKey(), nacl.randomBytes(32), pin.domain, pin.chain);
    const [buyer, seller] = [fresh(), fresh()];
    const payer = privateKeyToAccount(generatePrivateKey());
    const payment = lc(payer.address);
    const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
    const role = (r: string): string => d.demo.adjudicators.find((a: J) => a.role === r).address;
    // The faucet admits both signing keys to the club; the buyer's key's own grant pays for nothing in this deal.
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const balance = async (a: string) => BigInt(((await (await fetch(`${demo.urls[1]}/v1/balances/${a}`)).json()) as { amount: string }).amount);
    const offer = await seller.offer({
      template: 'checks-only', clubId: d.demo.clubId, seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey, paymentAddress: payment },
      adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
      price: { token: lc(deployment.token.address), amount: PRICE },
      deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' }, checks: CHECKS, timing: TIMING,
    });
    const adjudicationFee = BigInt(offer.terms.adjudication.fee.amount);
    expect(adjudicationFee).toBeGreaterThan(0n); // the adjudication fee is not waived: only the operator's
    // The payment address gets exactly the price plus the adjudication fee: any other charge would fail the funding.
    const grant = await buyer.call('POST', '/v1/faucet', { address: payment, amount: (BigInt(PRICE) + adjudicationFee).toString() });
    expect(grant.balance.amount).toBe((BigInt(PRICE) + adjudicationFee).toString());
    const sellerBefore = await balance(seller.address);
    await untilBoth(buyer, offer.id, ['AcceptedByAdjudicator'], 60_000);

    // What the buyer is asked to sign: the agreement (its signing key) and the funding (the payment address). No fee.
    const { prepared, intent, slots } = await buyer.prepareAgreeAndFund(offer.terms, BigInt(PRICE) + adjudicationFee, { paymentAddress: payment });
    expect(slots.map((s) => [s.slot, s.signer])).toEqual([['signature', buyer.address], ['fund.signature', payment]]);
    expect(prepared.sign.map((s: J) => s.slot)).toEqual(['signature', 'fund.signature']);
    expect(prepared.submit.body).not.toHaveProperty('operatorFee');
    expect(prepared.check.join(' ')).not.toMatch(/operator fee/);
    const fundSlot = slots.find((s) => s.slot === 'fund.signature')!;
    const held = await buyer.submitAgreeAndFund(prepared, intent, { 'fund.signature': await payer.signTypedData(fundSlot.typed as never) });
    expect(held.escrowState).toBe('Held');
    expect(held.hold.amount.amount).toBe((BigInt(PRICE) + adjudicationFee).toString());

    await untilBoth(seller, offer.id, ['Held'], 60_000);
    await seller.deliver(offer.terms, new TextEncoder().encode(work));
    const done = await untilBoth(buyer, offer.id, ['Released', 'Refunded'], 180_000);
    expect(done.escrowState).toBe(outcome);

    const events = (await buyer.call('GET', `/v1/commitments/${offer.id}/events?limit=200`)).items as J[];
    expect(events.map((e) => e.type)).not.toContain('fee.operator');
    if (outcome === 'Released') {
      // The buyer paid the price and the adjudication fee and nothing else; the seller received the price.
      expect(await balance(payment)).toBe(0n);
      expect((await balance(seller.address)) - sellerBefore).toBe(BigInt(PRICE));
    } else {
      // The price came back to the payment address; the adjudication fee is spent; the seller received nothing.
      expect(await balance(payment)).toBe(BigInt(PRICE));
      expect(await balance(seller.address)).toBe(sellerBefore);
    }
  }

  it('a Released deal: the buyer pays the price plus the adjudication fee, the seller receives the price', () => deal(CSV, 'Released'), 300_000);
  it('a Refunded deal: the buyer gets the price back and is down only the adjudication fee', () => deal(BAD_CSV, 'Refunded'), 300_000);
});
