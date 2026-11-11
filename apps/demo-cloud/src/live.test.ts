// The public world settling on a live chain (D41, ADR-0028), with anvil standing in for Sepolia: a block every
// second at wall-clock time, the T-202 contracts deployed from contracts/out, LiveChain sending from relayer lanes
// derived from one key. examples/try.ts runs a deal against it over HTTP in its own process, as against Sepolia,
// with the deployment pinned through HOLDBACK_DEPLOYMENT. Needs `anvil` on PATH and `forge build` output.
// T-221's anvil end to end is in registration.anvil.test.ts, which needs no network, so CI can require it.
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { EvmSettlement, LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deploymentOf, ENV, ready, RELAYER, root, runTry, serve } from '../test/anvil.ts';
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
