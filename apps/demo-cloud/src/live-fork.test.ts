// The public world on a fork of Sepolia (D41, ADR-0028): the deal of live.test.ts against the deployed contracts.
// It needs the network (SEPOLIA_FORK_RPC), so it lives apart from live.test.ts, which CI requires to run with no
// skipped test (T-313).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, toHex, type Hex } from 'viem';
import { wholeSecond } from '@holdback/core';
import { GAS_CAP, LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { anvilAvailable } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSV, ENV, Outsider, outsideDeal, RELAYER, root, runTry, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

// The same deal against the deployed Sepolia contracts, forked locally by anvil (chain id 11155111, the real
// HoldbackRules, CPP, tUSDC and drand verifier), with a test relayer funded on the fork only. Needs network: it runs
// when SEPOLIA_FORK_RPC names a Sepolia RPC and contracts/deployments/sepolia.json exists. anvil prices gas by Prague,
// and Sepolia charges new state about 3.5 times that (measured 2026-11-03), so every transaction the fork mined is
// replayed through eth_simulateV1 on the real chain (nothing is sent) and must fit under the relayer's gas cap.
const forkRpc = process.env['SEPOLIA_FORK_RPC'];
const deploymentFile = `${root}contracts/deployments/sepolia.json`;
const forkReady = anvilAvailable() && !!forkRpc && existsSync(deploymentFile);

describe.skipIf(!forkReady)(`the public world on a Sepolia fork${forkReady ? '' : ' (SKIPPED: needs SEPOLIA_FORK_RPC and contracts/deployments/sepolia.json)'}`, () => {
  let anvil: ChildProcess;
  let rpc: string;
  let forkBlock: bigint;
  const deployment = forkReady ? (JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile) : (undefined as never);
  beforeAll(async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    // A few blocks behind the head: a load-balanced public node answers "block not found" for its newest block from a
    // backend that lags, and anvil then fails to start (measured on publicnode, 2026-11-14). Five blocks is a minute.
    const remote = (await (await fetch(forkRpc!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })).json()) as { result?: string };
    if (typeof remote.result !== 'string') throw new Error('SEPOLIA_FORK_RPC answered no block number');
    const pin = String(BigInt(remote.result) - 5n);
    // Prague, as Sepolia runs: the drand verifier needs EIP-2537's BLS precompiles (T-206, measured).
    anvil = spawn('anvil', ['--fork-url', forkRpc!, '--fork-block-number', pin, '--hardfork', 'prague', '--host', '127.0.0.1', '--port', String(port), '--block-time', '2', '--silent'], { stdio: 'ignore' });
    rpc = `http://127.0.0.1:${port}`;
    const call = (method: string, params: unknown[]) => fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json() as Promise<{ result?: unknown }>);
    // anvil forks over the public RPC, which can take a while to answer.
    for (let i = 0; i < 300 && !(await call('eth_chainId', []).catch(() => ({}))).result; i++) await new Promise((r) => setTimeout(r, 200));
    const head = await call('eth_blockNumber', []).catch(() => ({ result: undefined }));
    if (typeof head.result !== 'string') throw new Error(`anvil did not fork ${forkRpc} within 60 s`);
    forkBlock = BigInt(head.result);
    // The fork's copy of the test relayer gets test ETH; nothing touches the real chain.
    await call('anvil_setBalance', [privateKeyToAccount(RELAYER).address, '0x8ac7230489e80000']);
  }, 90_000);
  afterAll(() => {
    anvil?.kill();
  });

  it('runs try.ts, then site/walkthrough.mjs following llms.txt literally, to Released on the deployed contracts', async () => {
    const chain = new LiveChain({ deployment, rpcUrls: [rpc], relayerKey: RELAYER, pollMs: 300, rebroadcastMs: 20_000, mintBatchMs: 300 });
    await chain.verify();
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: ENV, live: { chain } });
    const demo = await serve(world);
    try {
      for (const end = Date.now() + 120_000; !world.ready() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 500));
      expect(world.ready()).toBe(true);
      const run = await runTry({ HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
      // Printed whole (T-410): the runbook's step 4 reads it, and a failure shows what the script said before it.
      console.log(`examples/try.ts (exit ${run.code}):\n${run.out}`);
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.out.split('\n').filter((l) => l.startsWith('chain')).map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
      // The page's own walkthrough: every message built from site/llms.txt alone, under the domain and deployment it pins.
      const walk = await runTry({ OP1: demo.urls[0], OP2: demo.urls[1] }, 'site/walkthrough.mjs');
      console.log(`site/walkthrough.mjs (exit ${walk.code}):\n${walk.out}`);
      expect(walk.out).toMatch(/^walkthrough PASS/m);
      expect(walk.code).toBe(0);
    } finally {
      await demo.close();
    }

    // Setup, faucet, funding, delivery and decision, in the order the fork mined them, on Sepolia's own gas rules.
    const fork = createPublicClient({ transport: http(rpc) });
    const txs: { from: Hex; to: Hex; input: Hex; value: bigint }[] = [];
    for (let b = forkBlock + 1n, latest = await fork.getBlockNumber(); b <= latest; b++) txs.push(...(await fork.getBlock({ blockNumber: b, includeTransactions: true })).transactions.map((t) => ({ from: t.from, to: t.to!, input: t.input, value: t.value })));
    const stateOverrides = Object.fromEntries([...new Set(txs.map((t) => t.from.toLowerCase()))].map((a) => [a, { balance: toHex(10n ** 20n) }]));
    const now = Math.floor(Date.now() / 1000);
    const blockStateCalls = txs.map((t, i) => ({ ...(i === 0 ? { stateOverrides } : {}), blockOverrides: { time: toHex(now + 12 * (i + 1)) }, calls: [{ from: t.from, to: t.to, data: t.input, value: toHex(t.value) }] }));
    const sim = (await (await fetch(forkRpc!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_simulateV1', params: [{ blockStateCalls, validation: false }, 'latest'] }) })).json()) as { result?: { calls: { status: string; gasUsed: string }[] }[]; error?: unknown };
    // Not every RPC serves eth_simulateV1 (Tenderly's gateway did not on 2026-11-14): say what it answered.
    if (!sim.result) throw new Error(`eth_simulateV1 on SEPOLIA_FORK_RPC answered no result: ${JSON.stringify(sim.error ?? sim)}`);
    const gas = sim.result.map((b) => b.calls[0]!);
    expect(gas.map((c) => c.status)).toEqual(txs.map(() => '0x1'));
    for (const c of gas) expect((BigInt(c.gasUsed) * 5n) / 4n).toBeLessThanOrEqual(GAS_CAP);
    console.log(`Sepolia gas per transaction (eth_simulateV1): ${gas.map((c) => BigInt(c.gasUsed)).join(', ')}`);
  }, 600_000);

  // T-221's fork smoke: an outside adjudicator registers through the API, then accepts (bondReserved 0: the phase-one
  // contracts hold no bond, ADR-0031 §8) and decides one deal as primary under the demo's fallback and appeal adjudicators.
  it('an outside adjudicator registers, accepts and decides one deal as primary on the deployed contracts (T-221)', async () => {
    const chain = new LiveChain({ deployment, rpcUrls: [rpc], relayerKey: RELAYER, pollMs: 300, rebroadcastMs: 20_000, mintBatchMs: 300 });
    await chain.verify();
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: ENV, live: { chain }, faucetPerClient: 100 });
    const demo = await serve(world);
    try {
      for (const end = Date.now() + 120_000; !world.ready() && Date.now() < end; ) await sleep(500);
      expect(world.ready()).toBe(true);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
      const outsider = new Outsider(world, demo.urls, 't-221/fork-outsider', { trusted: [fallback, appeal] });
      expect((await outsider.register(wholeSecond(Date.now() - 60_000))).status).toBe(200);
      const deal = await outsideDeal(demo.urls, deployment, outsider, { work: CSV, timing: { judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 0, appealDecideSec: 120 } }); // phase one: no party appeal, so the window is 0 (ADR-0033 §2b)
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: deal.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(deal.buyer, deal.id, ['Released'], 120_000);
      expect(await deal.buyer.openDelivery(deal.id)).toBe(CSV);
    } finally {
      await demo.close();
    }
  }, 600_000);
});
