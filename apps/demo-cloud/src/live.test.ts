// The public world settling on a live chain (D41, ADR-0028), with anvil standing in for Sepolia: a block every
// second at wall-clock time, the T-202 contracts deployed from contracts/out, LiveChain sending from relayer lanes
// derived from one key. examples/try.ts runs a deal against it over HTTP in its own process, as against Sepolia,
// with the deployment pinned through HOLDBACK_DEPLOYMENT. Needs `anvil` on PATH and `forge build` output.
// T-221's anvil end to end is in registration.anvil.test.ts, which needs no network, so CI can require it.
import { privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, keccak256, stringToBytes, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import type { AnyCommitmentTerms } from '@holdback/core';
import { EvmSettlement, LiveChain, termsView, type Cursor, type DeploymentFile } from '@holdback/settlement/live';
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

  it('sets up its adjudicators, runs try.ts to Released with a transaction per money step, and reopens from storage', async () => {
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
    // reads no chain; the first pass verifies it, and the bonds recorded in storage are not sent again.
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    const again = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() }, onError });
    expect(again.ready()).toBe(false);
    // Setup left: a pass is due in 2 s (T-057). Once set up, the Released deal awaits no adjudicator, but it is still
    // open (its appeal window, then an hour): a pass reads the chain within a minute (T-218).
    expect(again.nextPass()! - Date.now()).toBeGreaterThan(1500);
    expect(again.nextPass()! - Date.now()).toBeLessThanOrEqual(2000);
    await again.work();
    expect(again.ready()).toBe(true);
    expect(again.nextPass()! - Date.now()).toBeLessThanOrEqual(60_000);
    expect(errors).toEqual([]);
    // The pass read the chain since the stored cursor (null when no block came since) and applied nothing twice.
    expect(again.lastSync()?.applied ?? 0).toBe(0);

    // T-218: a call sent straight to the contract shows after one pass. The appeal window closes (anvil's clock and the
    // reopened world's move two minutes on), and a stranger closes it on the contract, past both operators.
    const skew = 120_000;
    await anvil.rpc('evm_increaseTime', [skew / 1000]);
    const later = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf() }, now: () => Date.now() + skew, onError });
    const terms =(later.chain as EvmSettlement).log().find((e) => e.commitmentId === id && e.type === 'commitment.offered')!.payload['terms'] as AnyCommitmentTerms;
    const strangerKey = keccak256(stringToBytes('t-218/stranger'));
    const stranger = anvil.wallet(strangerKey);
    await anvil.rpc('anvil_setBalance', [stranger.account!.address, '0x56bc75e2d63100000']);
    // A fixed gas limit: anvil's estimate fails for a cheap call under Prague's calldata floor (sync.test.ts).
    const hash = await stranger.sendTransaction({ account: stranger.account!, chain: foundry, to: deployment.rules as Hex, data: encodeFunctionData({ abi: anvil.abis.rules, functionName: 'expireAppeal', args: [termsView(terms)] }), gas: 3_000_000n });
    const mined = await anvil.receipt(hash);
    expect(mined.status).toBe('success');
    const usage = { ...later.telemetry.usage() };
    const t0 = Date.now();
    await later.work();
    const passMs = Date.now() - t0;
    const state = await (later.chain as EvmSettlement).state(id as `0x${string}`);
    expect(state).toMatchObject({ escrowState: 'Released', appealState: 'expired' });
    expect((later.chain as EvmSettlement).log().at(-1)).toMatchObject({ type: 'appeal.expired', submittedVia: 'direct', payload: { tx: hash } });
    expect(later.lastSync()).toMatchObject({ applied: 1, behind: 0, unknown: 0 });
    // The cursor row moved past the stranger's block, after the books and events.
    expect(BigInt((await storage.get<Cursor>('cursor'))!.block)).toBeGreaterThanOrEqual(mined.blockNumber);
    const busy = { read: later.telemetry.usage().rowsRead - usage.rowsRead, written: later.telemetry.usage().rowsWritten - usage.rowsWritten };
    // An idle pass after it writes no row: no log read, and the cursor row is less than 300 blocks behind.
    const quiet = { ...later.telemetry.usage() };
    await later.work();
    const idle = { read: later.telemetry.usage().rowsRead - quiet.rowsRead, written: later.telemetry.usage().rowsWritten - quiet.rowsWritten };
    expect(idle.written).toBe(0);
    console.log(`T-218 pass with a direct call: ${passMs} ms, rows read ${busy.read}, written ${busy.written}; idle pass: rows read ${idle.read}, written ${idle.written}; ${JSON.stringify(later.lastSync())}`);
    // The deal is final now: no deal is open and no adjudicator has a turn, so no pass is due (T-057 unchanged).
    expect(later.nextPass()).toBeNull();

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
