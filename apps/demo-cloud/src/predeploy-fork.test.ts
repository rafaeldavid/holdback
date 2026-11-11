// T-220's fork run before the deploy: the one deploy of T-217, T-218, T-219 and T-221 rehearsed on a Sepolia fork, in
// today's world changed in place (D49). A world opens with the deployed build's rulebook (this build's code, with
// `beacon: 'sim'`) and funds a deal; then this build opens the same storage with its default rulebook, as
// holdback-op1's deploy restarts the Durable Object, and the run checks every item of T-220's "fork run" criterion.
// Phase one holds no bond (ADR-0031 §8), so the world posts none; this run needs a phase-one deployment on the fork.
//   1. the setup pass sends nothing;
//   2. the rulebook changes in place: the old deal keeps its rulebookHash and moves on, and an offer bound to the old
//      hash gets 422 rulebook_unknown;
//   3. examples/try.ts reaches Released;
//   4. an outside adjudicator registers through the API and settles a deal as primary (T-221);
//   5. a deal whose primary stays silent is decided by the demo fallback with a drand quicknet proof (T-217);
//   6. a direct `deliver` shows in the view as `submittedVia: "direct"` (T-218);
//   7. a world reopened after a broadcast and before its receipt applies that transaction as its relay (T-219).
//
// It rehearses the rulebook switch, not the upgrade from the deployed build's code (dd0a55a). The live storage has no
// `cursor` row and books without `chainTxs`, so its first sync pass reads from the deployment's fromBlock; T-220's
// Deploy steps in docs/operations.md say what to expect there.
//
// Opt-in, like live.test.ts's fork tests: it needs SEPOLIA_FORK_RPC (any Sepolia JSON-RPC), anvil on PATH,
// contracts/deployments/sepolia.json, and the network for the drand relays. Nothing reaches the real chain: anvil forks
// it, and the relayer is anvil's second dev key, funded on the fork only.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { beaconRoundAt, DRAND_QUICKNET, DRAND_QUICKNET_CHAIN_HASH, wholeSecond, type AnyCommitmentTerms, type Decision, type Delivery } from '@holdback/core';
import { deliveryView, LIVE_ABIS, LiveChain, termsView, type DeploymentFile, type EvmSettlement } from '@holdback/settlement/live';
import { anvilAvailable } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSV, ENV, estimateShim, host, Outsider, outsideDeal, party, PRICE, RELAYER, root, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

const forkRpc = process.env['SEPOLIA_FORK_RPC'];
const deploymentFile = `${root}contracts/deployments/sepolia.json`;
const forkReady = anvilAvailable() && !!forkRpc && existsSync(deploymentFile);

function runTry(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${root}examples/try.ts`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
  });
}

/** World storage that, once armed, copies itself right after the next lane row is written: before that broadcast. */
class Snapshotting extends MemoryStorage {
  armed = false;
  copy: MemoryStorage | null = null;
  override async put(entries: Record<string, unknown>): Promise<void> {
    await super.put(entries);
    if (!this.armed || !Object.keys(entries).some((k) => k.startsWith('lane:'))) return;
    this.armed = false;
    const copy = new MemoryStorage();
    const all = [...(await this.list({ prefix: '' }))];
    for (let i = 0; i < all.length; i += 100) await copy.put(Object.fromEntries(all.slice(i, i + 100)));
    this.copy = copy;
  }
}

describe.skipIf(!forkReady)(`T-220's fork run: today's world, then this build, on a Sepolia fork${forkReady ? '' : ' (SKIPPED: needs SEPOLIA_FORK_RPC, anvil and contracts/deployments/sepolia.json)'}`, () => {
  let anvil: ChildProcess;
  let rpc: string;
  let shim: Awaited<ReturnType<typeof estimateShim>> | undefined;
  let forkBlock: bigint;
  const deployment = forkReady ? (JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile) : (undefined as never);
  const call = (method: string, params: unknown[]) => fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json() as Promise<{ result?: unknown }>);

  beforeAll(async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    // A load-balanced public RPC can answer "block not found" for the head another of its nodes just served, and anvil
    // then exits while it builds its genesis (T-217 twice, this run once, measured). Fork 8 blocks (about 96 s) behind
    // the head the RPC reports, which every node behind it holds.
    const remote = (await (await fetch(forkRpc!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })).json()) as { result: string };
    const at = BigInt(remote.result) - 8n;
    // Prague, as Sepolia runs: the drand verifier needs EIP-2537's BLS precompiles.
    anvil = spawn('anvil', ['--fork-url', forkRpc!, '--fork-block-number', at.toString(), '--hardfork', 'prague', '--host', '127.0.0.1', '--port', String(port), '--block-time', '2', '--silent'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let anvilError = '';
    anvil.stderr?.on('data', (d) => (anvilError += String(d)));
    rpc = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 400 && !up; i++) up = !!(await call('eth_chainId', []).catch(() => ({ result: undefined }))).result || (await sleep(200), false);
    if (!up) throw new Error(`anvil did not fork ${forkRpc} within 80 s${anvilError ? `: ${anvilError.trim().slice(-300)}` : ''}`);
    // The deadlines are wall-clock times: new blocks must carry the wall clock, not the older fork block's time.
    await call('evm_mine', []);
    const latest = (await call('eth_getBlockByNumber', ['latest', false])).result as { timestamp: string };
    const skew = Math.floor(Date.now() / 1000) - Number(BigInt(latest.timestamp));
    if (skew > 2) {
      await call('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000) + 1]);
      await call('evm_mine', []);
    }
    console.log(`T-220 fork run: forked at block ${at}, block time ${skew} s behind the wall clock after the fork${skew > 2 ? ', set to the wall clock' : ''}`);
    forkBlock = BigInt((await call('eth_blockNumber', [])).result as string);
    await call('anvil_setBalance', [privateKeyToAccount(RELAYER).address, '0x8ac7230489e80000']);
    shim = await estimateShim(rpc);
  }, 90_000);
  afterAll(async () => {
    await shim?.close();
    anvil?.kill();
  });

  it('keeps the world through the rulebook switch, then runs a deal of each kind the four tasks bring', async () => {
    const chainOf = () => new LiveChain({ deployment, rpcUrls: [shim!.url], relayerKey: RELAYER, pollMs: 300, rebroadcastMs: 20_000, mintBatchMs: 300 });
    const fork = createPublicClient({ transport: http(rpc) });
    const head = () => fork.getBlockNumber({ cacheTime: 0 });
    const storage = new Snapshotting();
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    const t0 = Date.now();
    const took: Record<string, number> = {};
    const lap = (name: string) => (took[name] = Math.round((Date.now() - t0) / 1000));
    const timing = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 60 };

    // Today's world, as the deployed build opens it: the rulebook names the sim beacon.
    const today = await PublicWorld.open({ storage, env: ENV, live: { chain: chainOf(), beacon: 'sim' }, faucetPerClient: 100, onError });
    const demo = await host(today);
    try {
      for (const end = Date.now() + 180_000; !today.ready() && Date.now() < end; ) await sleep(500);
      expect(today.ready()).toBe(true);
      lap('today ready');
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const adjudicators = d.demo.adjudicators.map((a: J) => a.address as string) as [string, string, string];
      const [primary, fallback, appeal] = adjudicators;
      const token = deployment.token.address.toLowerCase();
      const [b, s, s2] = [party(demo.urls, deployment), party(demo.urls, deployment), party(demo.urls, deployment)];
      for (const a of [b.agent, s.agent, s2.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
      const before = await s.agent.club(d.demo.clubId);
      expect(before.rulebook.randomness).toEqual({ source: 'sim' });
      const request = (seller: string, extra: J = {}) => ({
        template: 'checks-only',
        clubId: d.demo.clubId,
        seller,
        buyer: { address: b.agent.address, encryptionPublicKey: b.agent.encryptionPublicKey },
        adjudicators: { primary, fallback, appeal },
        price: { token, amount: PRICE },
        deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
        checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }],
        timing,
        ...extra,
      });
      const old = await s.agent.offer(request(s.agent.address));
      await untilBoth(b.agent, old.id, ['AcceptedByAdjudicator'], 60_000);
      expect((await b.agent.agreeAndFund(old.terms, 40_000_000n)).escrowState).toBe('Held');
      const req = { nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`, disclosure: 'public', ...request(s2.agent.address) };
      const stale = await s2.agent.sign(await s2.agent.call('POST', '/v1/prepare/offer', req), { kind: 'offer', request: req, registration: await s2.agent.registration(primary), rulebookHash: before.rulebookHash as Hex });
      lap('old deal held');

      // 1. The deploy: this build opens the same storage and sends nothing.
      const chain = chainOf();
      const switched = await head();
      const funding = await chain.ethBalance(chain.funding);
      const lanes = await Promise.all(chain.lanes.map((l) => chain.ethBalance(l.address)));
      const next = await demo.deploy(() => PublicWorld.open({ storage, env: ENV, live: { chain }, faucetPerClient: 100, onError }));
      for (const end = Date.now() + 60_000; !next.ready() && Date.now() < end; ) await sleep(250);
      expect(next.ready()).toBe(true);
      await sleep(5000);
      let sent = 0;
      for (let n = switched + 1n, end = await head(); n <= end; n++) sent += (await fork.getBlock({ blockNumber: n })).transactions.length;
      expect(sent).toBe(0);
      expect(await chain.ethBalance(chain.funding)).toBe(funding);
      expect(await Promise.all(chain.lanes.map((l) => chain.ethBalance(l.address)))).toEqual(lanes);
      lap('deployed, setup sent nothing');

      // 2. The rulebook changed in place. The old deal keeps its hash and moves on; the stale offer gets 422.
      const after = await s.agent.club('demo-club');
      expect(after.rulebook.randomness).toEqual({ source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH });
      expect(after.rulebookHash).not.toBe(before.rulebookHash);
      expect(((await (await fetch(`${demo.urls[1]}/.well-known/holdback.json`)).json()) as J).demo.adjudicators.map((a: J) => a.address)).toEqual(adjudicators);
      expect(((await s.agent.call('GET', `/v1/commitments/${old.id}/terms`)) as J).rulebookHash).toBe(before.rulebookHash);
      await s.agent.deliver(old.terms, new TextEncoder().encode(CSV));
      await untilBoth(b.agent, old.id, ['Released'], 120_000);
      expect(await b.agent.openDelivery(old.id)).toBe(CSV);
      const res = await fetch(`${demo.urls[0]}${stale.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(stale.body) });
      const problem = (await res.json()) as J;
      expect({ status: res.status, type: problem.type }).toEqual({ status: 422, type: 'rulebook_unknown' });
      lap('old deal released, stale offer refused');

      // 6. A direct deliver: the seller sends it to the contract itself. Within a pass the state read shows the
      // contract's stage with a notice that says to post the delivery (the contract keeps only its hash). The seller
      // posts the same signed delivery; the operator joins it with no second transaction, labelled `direct` with the
      // seller's transaction, the adjudicators get their envelopes, and the primary decides (T-218).
      const evm = next.chain as EvmSettlement;
      const three = await s.agent.offer(request(s.agent.address));
      await untilBoth(b.agent, three.id, ['AcceptedByAdjudicator'], 60_000);
      expect((await b.agent.agreeAndFund(three.terms, 40_000_000n)).escrowState).toBe('Held');
      const { prepared, intent } = await s.agent.prepareDelivery(three.terms, new TextEncoder().encode(CSV));
      const signed = await s.agent.sign(prepared, intent);
      const offered = evm.log().find((e) => e.commitmentId === three.id && e.type === 'commitment.offered')!.payload['terms'] as AnyCommitmentTerms;
      await call('anvil_setBalance', [s.agent.address, '0x56bc75e2d63100000']);
      const wallet = createWalletClient({ account: privateKeyToAccount(s.key), chain: sepolia, transport: http(rpc) });
      const delivery = signed.body as Delivery;
      // A fixed gas limit, as T-218's tests send direct calls (anvil's estimate, T-217 Decision 11).
      const hash = await wallet.sendTransaction({ to: deployment.rules as Hex, data: encodeFunctionData({ abi: LIVE_ABIS.rules, functionName: 'deliver', args: [termsView(offered), deliveryView(delivery), delivery.signature] }), gas: 3_000_000n });
      expect((await fork.waitForTransactionReceipt({ hash })).status).toBe('success');
      let behind: J = null;
      for (const end = Date.now() + 90_000; Date.now() < end; await sleep(500)) {
        behind = await b.agent.call('GET', `/v1/commitments/${three.id}`);
        if ((behind.notices ?? []).some((n: string) => n.startsWith('Behind the chain'))) break;
      }
      const seen = { lastSync: next.lastSync(), errors: errors.slice(-5).map((m) => m.slice(0, 400)) };
      expect(behind.escrowState, JSON.stringify(seen)).toBe('Delivered');
      expect((behind.notices ?? []).join(' '), JSON.stringify(seen)).toMatch(new RegExp(`^Behind the chain: .*${hash}.*POST /v1/commitments/${three.id}/deliveries`));
      await s.agent.call('POST', signed.path, signed.body);
      const direct = evm.log().find((e) => e.commitmentId === three.id && e.type === 'delivery.submitted');
      expect(direct).toMatchObject({ submittedVia: 'direct', payload: { tx: hash } });
      // Joined with no second transaction: the deal's one deliver is the seller's own.
      expect(evm.transactions().filter((t) => t.commitmentId === three.id && t.call === 'deliver').map((t) => [t.hash, t.via])).toEqual([[hash, 'direct']]);
      await untilBoth(b.agent, three.id, ['Released'], 120_000);
      expect(await b.agent.openDelivery(three.id)).toBe(CSV);
      lap('direct deliver shown and decided');

      // 3. The homepage flow, both sides played by examples/try.ts.
      const run = await runTry({ HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.out.split('\n').filter((l) => l.startsWith('chain')).map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
      lap('try.ts released');

      // 4. An outside adjudicator registers through the API and settles a deal as primary.
      const outsider = new Outsider(next, demo.urls, 't-220/fork-outsider', { trusted: [fallback, appeal] });
      const issuedAt = wholeSecond(Date.now() - 60_000);
      expect((await outsider.register(issuedAt)).status).toBe(200);
      const one = await outsideDeal(demo.urls, deployment, outsider, { work: CSV, timing });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: one.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(one.buyer, one.id, ['Released'], 120_000);
      expect(await one.buyer.openDelivery(one.id)).toBe(CSV);
      lap('outside primary released');

      // 5. A primary that accepts and stays silent: at judgeBy the world's fallback takes over and decides from the
      // quicknet round at judgeBy, which the deployed HoldbackRules verifies through DrandQuicknetBeacon.
      const silent = new Outsider(next, demo.urls, 't-220/fork-silent', { trusted: [fallback, appeal] });
      expect((await silent.register(issuedAt)).status).toBe(200);
      const two = await outsideDeal(demo.urls, deployment, silent, { work: CSV, timing: { offerExpiresInSec: 60, fundWithinSec: 90, deliverWithinSec: 120, judgeWithinSec: 60, fallbackWithinSec: 180, appealWindowSec: 60, appealDecideSec: 60 } });
      await untilBoth(two.buyer, two.id, ['Released', 'Refunded'], Date.parse(two.terms.timing.judgeBy) - Date.now() + 150_000);
      const settled = evm.escrowState(two.id);
      const decision = settled?.kind === 'Released' && settled.via.kind === 'first_instance' ? settled.via.decision : (undefined as never as Decision);
      expect(settled?.kind).toBe('Released');
      expect(decision.role).toBe('fallback');
      expect(decision.beacon).toMatchObject({ source: 'drand-quicknet', round: beaconRoundAt(DRAND_QUICKNET, Date.parse(two.terms.timing.judgeBy) / 1000) });
      expect(await two.buyer.openDelivery(two.id)).toBe(CSV);
      lap('silent primary, fallback decided with drand');

      // 7. A restart between a broadcast and its receipt: the passes stop, the seller's delivery is relayed, and the
      // storage as it stood after the lane row was written (before the broadcast) opens under a new instance.
      const four = await s.agent.offer(request(s.agent.address));
      await untilBoth(b.agent, four.id, ['AcceptedByAdjudicator'], 60_000);
      expect((await b.agent.agreeAndFund(four.terms, 40_000_000n)).escrowState).toBe('Held');
      await demo.pause();
      storage.armed = true;
      const relayed = await s.agent.deliver(four.terms, new TextEncoder().encode(CSV));
      expect(relayed.escrowState).toBe('Delivered');
      const copy = storage.copy!;
      expect([...(await copy.list({ prefix: 'lane:' }))]).toHaveLength(1);
      const restarted = await demo.deploy(() => PublicWorld.open({ storage: copy, env: ENV, live: { chain: chainOf() }, faucetPerClient: 100, onError }));
      await untilBoth(b.agent, four.id, ['Released'], 120_000);
      expect(restarted.lastRecovery()).toMatchObject({ failed: 0 });
      const landed = (restarted.chain as EvmSettlement).log().find((e) => e.commitmentId === four.id && e.type === 'delivery.submitted');
      expect(landed?.submittedVia).toBe('demo-op-1');
      expect([...(await copy.list({ prefix: 'lane:' }))]).toEqual([]);
      expect(await b.agent.openDelivery(four.id)).toBe(CSV);
      lap('restart mid-step applied as the relay');

      // The record: every rules-contract call since the fork, with its gas on the fork (anvil prices by Prague).
      const calls: string[] = [];
      for (let n = forkBlock + 1n, end = await head(); n <= end; n++) {
        for (const t of (await fork.getBlock({ blockNumber: n, includeTransactions: true })).transactions) {
          if (t.to?.toLowerCase() !== deployment.rules.toLowerCase()) continue;
          const r = await fork.getTransactionReceipt({ hash: t.hash });
          calls.push(`${decodeFunctionData({ abi: LIVE_ABIS.rules, data: t.input }).functionName} ${r.gasUsed} ${r.status}`);
        }
      }
      console.log(`T-220 fork run: old rulebookHash ${before.rulebookHash}, new ${after.rulebookHash}; stale offer: ${problem.detail}`);
      console.log(`T-220 fork run: fallback decision round ${decision.beacon?.round}, judgeBy ${two.terms.timing.judgeBy}; direct deliver ${hash}; recovery ${JSON.stringify(restarted.lastRecovery())}`);
      console.log(`T-220 fork run, seconds from the start: ${JSON.stringify(took)}`);
      console.log(`T-220 fork run, rules contract calls (function gas status): ${calls.join('; ')}`);
      console.log(`T-220 fork run, world errors: ${JSON.stringify(errors)}`);
      expect(calls.every((c) => c.endsWith('success'))).toBe(true);
    } finally {
      await demo.close();
    }
  }, 1_200_000);
});
