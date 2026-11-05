// The public world settling on a live chain (D41, ADR-0028), with anvil standing in for Sepolia: a block every
// second at wall-clock time, the T-202 contracts deployed from contracts/out, LiveChain sending from relayer lanes
// derived from one key. examples/try.ts runs a deal against it over HTTP in its own process, as against Sepolia,
// with the deployment pinned through HOLDBACK_DEPLOYMENT. Needs `anvil` on PATH and `forge build` output.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, stringToBytes, toHex, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { canonicalKeccak, holdbackDomain, verifyRegistration, wholeSecond, type Address, type AnyCommitmentTerms, type Hex32, type RegisteredAdjudicator } from '@holdback/core';
import { FAIL_MARKER, LIVE_REGISTRY_URI, liveRegistry, markedFake, markerFake, placeholderRegistry, testAdjudicator, type SettlementReads, type TestAdjudicator, type TestAdjudicatorOptions } from '@holdback/adjudicator';
import { signRegistration, testAccount, type TestAccount } from '@holdback/operator';
import type { Submission } from '@holdback/settlement';
import { ensureBond, EvmSettlement, GAS_CAP, LiveChain, termsView, type Cursor, type DeploymentFile } from '@holdback/settlement/live';
import { anvilAvailable, EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { pinOf } from '../../../examples/verify.ts';
import { MemoryStorage, PublicWorld } from './index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ready = anvilAvailable() && existsSync(`${root}contracts/out/HoldbackRules.sol/HoldbackRules.json`);
/** anvil's second well-known dev key (public; guards no value): the relayer's funding lane here. */
const RELAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
/** The demo's fee: 1 bp, minimum 0.01 tUSDC plus the 4.70 tUSDC gas quote a chain world adds (D33 as amended). */
const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000', OPERATOR_FEE_GAS: '4700000' };

async function serve(world: PublicWorld): Promise<{ urls: [string, string]; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const node = host.startsWith('localhost') ? 1 : 0;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node, origin: `http://${host}`, client: req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
  const loop = (async () => {
    while (ticking) {
      await world.work();
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const lc = (a: string) => a.toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The terms a registration binds for its own bond pool: the adjudicator alone, no backers (ADR-0014 is Phase 4). */
const OWN_POOL = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 0 };
const PRICE = '25000000'; // 25 tUSDC
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
const DATASET = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];

/**
 * An outside adjudicator (T-221, ADR-0030), as an agent runs one: the reference adjudicator's code under its own key,
 * registered through POST /v1/adjudicators, bonded in HoldbackBonds from that key, and sending its acceptances,
 * decisions and triggers through the operators' HTTP API. It reads the deals from the world's settlement view, as it
 * would from an operator's reads, and its own bond live from the contract.
 */
class Outsider {
  readonly account: TestAccount;
  adj: TestAdjudicator;
  private readonly bonds = new Map<string, { junior: bigint; senior: bigint; reserved: bigint }>();

  constructor(
    private readonly world: PublicWorld,
    private readonly urls: readonly string[],
    label: string,
    private readonly o: { trusted: readonly string[]; provider?: TestAdjudicatorOptions['provider'] },
  ) {
    this.account = testAccount(label);
    this.adj = this.build(placeholderRegistry(), 'file:///config/judges.yaml');
  }

  get address(): Address {
    return this.account.address;
  }

  /** Runs the same adjudicator with another registry (the registry_mismatch case): a new registration must bind it. */
  rebind(registry: NonNullable<TestAdjudicatorOptions['registry']>, uri: string): void {
    this.adj = this.build(registry, uri);
  }

  private build(registry: NonNullable<TestAdjudicatorOptions['registry']>, registryUri: string): TestAdjudicator {
    const evm = this.world.chain as EvmSettlement;
    const api = this.urls[0]!;
    const post = async (path: string, body: unknown, key: string): Promise<J> => {
      const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
      const out = (await res.json()) as J;
      return res.ok ? { ok: true, state: out } : { ok: false, problem: out };
    };
    const bonds = this.bonds;
    // The world's settlement view for reads; every write goes through the operator, as an outside agent's would.
    const reads = new Proxy(evm, {
      get(target, prop) {
        if (prop === 'pool') return (a: Address) => bonds.get(lc(a)) ?? target.pool(a);
        if (prop === 'submit') {
          return (s: Submission, opts?: { idempotencyKey?: string }) => {
            const key = opts?.idempotencyKey ?? crypto.randomUUID();
            if (s.kind === 'adjudicator_accept') return post(`/v1/commitments/${s.message.commitmentId}/acceptance`, s.message, key);
            if (s.kind === 'decide') return post(`/v1/commitments/${s.message.commitmentId}/decisions`, s.message, key);
            throw new Error(`an outside adjudicator sends no ${s.kind}`);
          };
        }
        if (prop === 'trigger') return (id: Hex32, timeout: string) => post(`/v1/commitments/${id}/triggers/${timeout.replace(/_/g, '-')}`, {}, crypto.randomUUID());
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as unknown as SettlementReads;
    const token = lc((this.world.chain as EvmSettlement).world.deployment.token);
    return testAdjudicator({
      name: 'Outside adjudicator (test)',
      label: this.account.label,
      signingKey: this.account.privateKey,
      encryptionSecretKey: this.account.encryptionSecretKey,
      chain: reads,
      store: {
        ciphertext: async (uri) => new Uint8Array(await (await fetch(uri)).arrayBuffer()),
        publishRecord: async (record) => `https://outsider.test/judgments/${record.commitmentId}`,
      },
      registration: async (address) => {
        const res = await fetch(`${api}/v1/adjudicators/${address}`);
        return res.ok ? ((await res.json()) as J) : null;
      },
      domain: holdbackDomain(evm.world.chainId, lc(evm.world.deployment.rules) as Address),
      // The demo adjudicators' quote: as fallback or appeal adjudicator they decline a deal whose fee is below theirs.
      fee: { token, amount: '1000000' } as TestAdjudicatorOptions['fee'],
      registry,
      registryUri,
      trustedAdjudicators: this.o.trusted as Address[],
      ...(this.o.provider ? { provider: this.o.provider } : {}),
    });
  }

  /** Its signed registration, as the llms.txt recipe builds it: the record with `pool` holding only `terms`. */
  async registration(issuedAt: string): Promise<RegisteredAdjudicator> {
    const body = { ...this.adj.registration(), pool: { terms: { ...OWN_POOL } }, poolTermsHash: canonicalKeccak(OWN_POOL), status: 'active' as const };
    const evm = this.world.chain as EvmSettlement;
    const envelope = { keyId: `${this.account.label}/${issuedAt}`, issuedAt: issuedAt as RegisteredAdjudicator['registration']['issuedAt'], nonce: canonicalKeccak({ outsider: this.address, issuedAt }), expiresAt: wholeSecond(Date.parse(issuedAt) + 30 * 86_400_000) };
    return signRegistration(this.account.privateKey, holdbackDomain(evm.world.chainId, lc(evm.world.deployment.rules) as Address), body, envelope);
  }

  async register(issuedAt: string): Promise<{ status: number; body: J }> {
    const res = await fetch(`${this.urls[0]}/v1/adjudicators`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(await this.registration(issuedAt)) });
    return { status: res.status, body: await res.json() };
  }

  /** One pass, after reading its own bond from the contract (the reference service reads `pool` for offers). */
  async runOnce() {
    const evm = this.world.chain as EvmSettlement;
    const held = await evm.bondOf(this.address);
    const free = await evm.freeBond(this.address);
    this.bonds.set(lc(this.address), { junior: held, senior: 0n, reserved: held - free });
    return this.adj.runOnce();
  }
}

/** A buyer or a seller with fresh keys, pinned to the world's deployment as try.ts pins Sepolia's. */
function party(urls: readonly string[], deployment: DeploymentFile): { agent: Agent; key: Hex } {
  const key = generatePrivateKey();
  const pin = pinOf(deployment);
  return { key, agent: new Agent([...urls], key, crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain) };
}

/** Polls both nodes until each reports one of `states` under `field` (escrowState by default). */
async function untilBoth(agent: Agent, id: string, states: string[], timeoutMs: number, field = 'escrowState'): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(250)) {
    seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (seen.every((s) => states.includes(s[field]))) return seen[0];
  }
  throw new Error(`${id} is ${seen.map((s) => `${s.escrowState}/${s.appealState}`).join(' and ')} after ${timeoutMs / 1000} s, not ${states.join(' or ')} (${field}); notices: ${seen.flatMap((s) => s.notices ?? []).join(' | ')}`);
}

/**
 * One deal with `outsider` as primary and the demo's fallback and appeal adjudicators (unless `adjudicators` names
 * others): the seller offers, the outsider accepts with an acceptance it builds itself, the buyer funds, the seller
 * delivers. Returns once Delivered on both nodes; the outsider has not decided.
 */
async function outsideDeal(
  world: PublicWorld,
  urls: readonly string[],
  deployment: DeploymentFile,
  outsider: Outsider,
  o: { work: string; rubric?: boolean; timing: Record<string, number>; adjudicators?: { fallback: string; appeal: string } },
): Promise<{ id: Hex32; terms: J; buyer: Agent; buyerKey: Hex; seller: Agent }> {
  const d = (await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J;
  const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
  const [b, s] = [party(urls, deployment), party(urls, deployment)];
  for (const a of [b.agent, s.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
  const token = lc(deployment.token.address);
  const offer = await s.agent.offer({
    template: o.rubric ? 'default' : 'checks-only',
    clubId: d.demo.clubId,
    seller: s.agent.address,
    buyer: { address: b.agent.address, encryptionPublicKey: b.agent.encryptionPublicKey },
    adjudicators: { primary: outsider.address, fallback: o.adjudicators?.fallback ?? fallback, appeal: o.adjudicators?.appeal ?? appeal },
    price: { token, amount: PRICE },
    ...(o.rubric
      ? {
          deliverable: { kind: 'document', description: 'A one-paragraph product summary', format: 'text/plain' },
          checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
          rubric: { passThreshold: 300, criteria: [{ id: 'clear', description: 'The summary is clear and accurate.', weight: 100, anchors: { '0': 'Unclear', '2': 'Partly', '4': 'Clear' } }] },
        }
      : { deliverable: DATASET, checks: CHECKS }),
    timing: o.timing,
  });
  const accepted = await outsider.runOnce();
  expect(accepted.accepted).toContain(offer.id);
  await untilBoth(b.agent, offer.id, ['AcceptedByAdjudicator'], 30_000);
  const held = await b.agent.agreeAndFund(offer.terms, 40_000_000n);
  expect(held.escrowState).toBe('Held');
  await untilBoth(s.agent, offer.id, ['Held'], 60_000);
  await s.agent.deliver(offer.terms, new TextEncoder().encode(o.work));
  await untilBoth(b.agent, offer.id, ['Delivered'], 60_000);
  return { id: offer.id as Hex32, terms: offer.terms, buyer: b.agent, buyerKey: b.key, seller: s.agent };
}

function runTry(env: Record<string, string>, script = 'examples/try.ts'): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${root}${script}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe.skipIf(!ready)(`the public world on a live chain (anvil for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  const storage = new MemoryStorage();
  const chainOf = (rpcUrl = anvil.rpcUrl) => new LiveChain({ deployment, rpcUrls: [rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow,
      erc3009Collector: d.erc3009Collector,
      permit2Collector: d.permit2Collector,
      multicall: d.multicall,
      rules: d.rules,
      bonds: d.bonds,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
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

// T-221 end to end (ADR-0030): an adjudicator no one at Crow runs registers through the API, bonds from its own key,
// and is named primary under the demo's fallback and appeal adjudicators. The contracts are the ones deployed to anvil,
// with the sim beacon reseeded to the world's own seed so the demo appeal adjudicator's beacon proofs verify.
describe.skipIf(!ready)(`an outside adjudicator on a live chain (anvil; T-221)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow,
      erc3009Collector: d.erc3009Collector,
      permit2Collector: d.permit2Collector,
      multicall: d.multicall,
      rules: d.rules,
      bonds: d.bonds,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
  }, 120_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  it('registers, bonds, accepts and decides as primary; a wrong accept is overturned from its bond; another registry is refused; the demo fallback declines under its appeal adjudicator', async () => {
    const storage = new MemoryStorage();
    const chain = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain }, minWindowSec: 5, faucetPerClient: 100, onError: (e) => errors.push(e.message) });
    // Opening reads no chain: reseed the sim beacon now, before the world's first pass sends anything.
    const { start } = (await storage.get<{ start: string }>('meta'))!;
    await anvil.fresh(canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }));
    const demo = await serve(world);
    const t0 = Date.now();
    const took: Record<string, number> = {};
    const lap = (name: string) => (took[name] = Math.round((Date.now() - t0) / 1000));
    try {
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
      expect(world.ready()).toBe(true);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
      const evm = world.chain as EvmSettlement;
      // The outside appeal adjudicator a party controls (D44): registered, never bonded (L-5: no clause pays from it).
      const attackers = new Outsider(world, demo.urls, 't-221/live-attackers-appeal', { trusted: [] });
      // The outsider judges blind to the scripted fail marker, so it accepts work the demo's panel rejects: a wrong accept.
      const outsider = new Outsider(world, demo.urls, 't-221/live-outsider', { trusted: [fallback, appeal], provider: markedFake(markerFake({}, 'NO-DELIVERY-CARRIES-THIS')) });
      const silent = new Outsider(world, demo.urls, 't-221/live-silent', { trusted: [fallback, attackers.address] });
      const issuedAt = wholeSecond(Date.now() - 60_000);

      // Registration through the API, before any bond: listed, signed, and plainly unbonded (Rafa: "be clear").
      const posted = await outsider.register(issuedAt);
      expect(posted.status).toBe(200);
      expect(posted.body.observed).toMatchObject({ bond: 'none', expired: false });
      for (const o of [silent, attackers]) expect((await o.register(issuedAt)).status).toBe(200);
      lap('registered');

      // The bond, from the outsider's own key (approve, then deposit); the relayer only pays its gas and mints its tUSDC.
      const BOND = 100_000_000n;
      for (const o of [outsider, silent]) await ensureBond(chain, o.account.privateKey, BOND, 100_000_000_000_000_000n);
      expect(await evm.bondOf(outsider.address)).toBe(BOND);
      // Both nodes serve the live bond once the per-block cache turns over (about 12 s): the read is HoldbackBonds'.
      let served: J = null;
      for (const end = Date.now() + 30_000; Date.now() < end; await sleep(500)) {
        const views = await Promise.all(demo.urls.map(async (u) => (await (await fetch(`${u}/v1/adjudicators/${outsider.address}`)).json()) as J));
        if (views.every((v) => v.observed?.bond === 'bonded')) {
          served = views[0];
          break;
        }
      }
      expect(served?.pool).toMatchObject({ junior: { amount: BOND.toString() }, reserved: { amount: '0' } });
      expect(await verifyRegistration(holdbackDomain(anvil.chainId, lc(deployment.rules) as Address), served)).toBe(true);
      lap('bonded');

      // Deal 1: the outsider accepts and decides by script; the deal is Released and the buyer opens its copy.
      const timing = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 120 };
      const one = await outsideDeal(world, demo.urls, deployment, outsider, { work: CSV, timing });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: one.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(one.buyer, one.id, ['Released'], 60_000);
      expect(await one.buyer.openDelivery(one.id)).toBe(CSV);
      const decided = evm.log().find((e) => e.commitmentId === one.id && e.type === 'judgment.decided')!;
      expect({ actor: lc(String(decided.actor)), via: decided.submittedVia }).toEqual({ actor: outsider.address, via: 'demo-op-1' });
      lap('deal 1 released');

      // Deal 4 (D44's second path): the silent outsider is primary, the demo fallback is named under an appeal
      // adjudicator it does not trust. Past judgeBy it neither triggers nor decides, and the state read says why.
      // judgeBy is deliverBy plus the judge window, so this deal's deliverBy is near too: about a minute from now.
      const four = await outsideDeal(world, demo.urls, deployment, silent, { work: CSV, timing: { ...timing, offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 5 }, adjudicators: { fallback, appeal: attackers.address } });
      const fallbackBond = await evm.freeBond(fallback as Address);

      // Deal 2: the outsider accepts work that fails the rubric (the scripted panel's fail marker); the buyer appeals.
      const two = await outsideDeal(world, demo.urls, deployment, outsider, { work: `${FAIL_MARKER}: a summary that says nothing about the product.`, rubric: true, timing });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: two.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(two.buyer, two.id, ['Released'], 60_000);
      const outsiderBond = await evm.bondOf(outsider.address);
      const buyerBefore = await evm.tokenBalance(two.buyer.address, true);
      const { rulebook } = await two.buyer.club(d.demo.clubId);
      const appealBond = (BigInt(PRICE) * BigInt(rulebook.appealBondRateBps) + 9_999n) / 10_000n;
      await anvil.rpc('anvil_setBalance', [two.buyer.address, '0x56bc75e2d63100000']);
      const approved = await anvil.send({ key: two.buyerKey, to: deployment.token.address as Hex, data: encodeFunctionData({ abi: anvil.abis.token, functionName: 'approve', args: [deployment.bonds, appealBond] }) });
      expect(approved.status).toBe('success');
      const prepared = await two.buyer.call('POST', '/v1/prepare/appeal', { commitmentId: two.id, appellant: two.buyer.address });
      await two.buyer.signAndSubmit(prepared, { kind: 'appeal', terms: two.terms, me: two.buyer.address, appealBondRateBps: rulebook.appealBondRateBps });
      const overturned = await untilBoth(two.buyer, two.id, ['overturned', 'upheld'], 180_000, 'appealState');
      // The release paid the seller at the first decision and stands; the overturn pays the buyer the price from the
      // outsider's bond instead (D43, T-206 I-8): bond.slashed names the outsider.
      expect(overturned).toMatchObject({ appealState: 'overturned', escrowState: 'Released' });
      const slashed = evm.log().filter((e) => e.commitmentId === two.id && e.type === 'bond.slashed');
      expect(slashed.map((e) => e.payload)).toMatchObject([{ adjudicator: getAddress(outsider.address), junior: { amount: PRICE }, reason: 'overturn' }]);
      expect(outsiderBond - (await evm.bondOf(outsider.address))).toBe(BigInt(PRICE));
      // The buyer gets the price from the bond and its appeal bond back.
      expect((await evm.tokenBalance(two.buyer.address, true)) - buyerBefore).toBe(BigInt(PRICE));
      lap('deal 2 overturned');

      // Deal 4, continued: judgeBy has passed; the demo fallback declined its turn, and nothing reserved its bond.
      let notices: string[] = [];
      for (const end = Date.parse(four.terms.timing.judgeBy) + 30_000; Date.now() < end; await sleep(500)) {
        notices = ((await four.buyer.call('GET', `/v1/commitments/${four.id}`)) as J).notices ?? [];
        if (notices.some((n) => /fallback adjudicator declined/.test(n))) break;
      }
      expect(notices.join(' ')).toMatch(new RegExp(`fallback adjudicator declined this deal's fallback turn: .*does not trust ${attackers.address} as the appeal adjudicator`, 'i'));
      expect(((await four.buyer.call('GET', `/v1/commitments/${four.id}`)) as J).escrowState).toBe('Delivered');
      expect(await evm.freeBond(fallback as Address)).toBe(fallbackBond);
      lap('deal 4 declined');

      // Deal 3: the same outsider re-registers binding another registry (a later issuedAt replaces the record). The
      // demo appeal adjudicator judges only under its own registry, so it refuses the appeal with registry_mismatch.
      outsider.rebind(liveRegistry(), LIVE_REGISTRY_URI);
      const again = await outsider.register(wholeSecond(Date.now()));
      expect(again.status).toBe(200);
      expect(again.body.registry.hash).toBe(liveRegistry().hash);
      const three = await outsideDeal(world, demo.urls, deployment, outsider, { work: CSV, timing });
      expect(((await three.buyer.call('GET', `/v1/commitments/${three.id}/terms`)) as J).adjudication.registryHash).toBe(liveRegistry().hash);
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: three.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(three.buyer, three.id, ['Released'], 60_000);
      await anvil.rpc('anvil_setBalance', [three.buyer.address, '0x56bc75e2d63100000']);
      expect((await anvil.send({ key: three.buyerKey, to: deployment.token.address as Hex, data: encodeFunctionData({ abi: anvil.abis.token, functionName: 'approve', args: [deployment.bonds, appealBond] }) })).status).toBe('success');
      const appealing = await three.buyer.call('POST', '/v1/prepare/appeal', { commitmentId: three.id, appellant: three.buyer.address });
      await three.buyer.signAndSubmit(appealing, { kind: 'appeal', terms: three.terms, me: three.buyer.address, appealBondRateBps: rulebook.appealBondRateBps });
      await untilBoth(three.buyer, three.id, ['open'], 60_000, 'appealState');
      const judge = world.adjudicators.appeal;
      const task = (await judge.settlement.tasks(judge.address)).find((t) => t.commitment.id === three.id);
      expect(task?.role).toBe('appeal');
      const refused = await judge.service.decideTask(task!);
      expect(refused.ok ? 'decided' : refused.error.type).toBe('registry_mismatch');
      // The world's own passes refuse it too: the appeal stays open.
      await sleep(3000);
      expect(((await three.buyer.call('GET', `/v1/commitments/${three.id}`)) as J).appealState).toBe('open');
      lap('deal 3 refused');
      expect(errors).toEqual([]);
      console.log(`T-221 anvil end to end, seconds from the world's start: ${JSON.stringify(took)}`);
    } finally {
      await demo.close();
    }
  }, 600_000);
});

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
    // Prague, as Sepolia runs: the drand verifier needs EIP-2537's BLS precompiles (T-206, measured).
    anvil = spawn('anvil', ['--fork-url', forkRpc!, '--hardfork', 'prague', '--host', '127.0.0.1', '--port', String(port), '--block-time', '2', '--silent'], { stdio: 'ignore' });
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
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      expect(run.out.split('\n').filter((l) => l.startsWith('chain')).map((l) => l.split(/\s+/)[1])).toEqual(['funded', 'delivered', 'decided']);
      // The page's own walkthrough: every message built from site/llms.txt alone, under the domain and deployment it pins.
      const walk = await runTry({ OP1: demo.urls[0], OP2: demo.urls[1] }, 'site/walkthrough.mjs');
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
    const sim = (await (await fetch(forkRpc!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_simulateV1', params: [{ blockStateCalls, validation: false }, 'latest'] }) })).json()) as { result: { calls: { status: string; gasUsed: string }[] }[] };
    const gas = sim.result.map((b) => b.calls[0]!);
    expect(gas.map((c) => c.status)).toEqual(txs.map(() => '0x1'));
    for (const c of gas) expect((BigInt(c.gasUsed) * 5n) / 4n).toBeLessThanOrEqual(GAS_CAP);
    console.log(`Sepolia gas per transaction (eth_simulateV1): ${gas.map((c) => BigInt(c.gasUsed)).join(', ')}`);
  }, 600_000);

  // T-221's fork smoke: an outside adjudicator registers through the API, bonds in the deployed HoldbackBonds from its
  // own key, then accepts and decides one deal as primary under the demo's fallback and appeal adjudicators.
  it('an outside adjudicator registers, bonds, accepts and decides one deal as primary on the deployed contracts (T-221)', async () => {
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
      await ensureBond(chain, outsider.account.privateKey, 100_000_000n, 100_000_000_000_000_000n);
      const deal = await outsideDeal(world, demo.urls, deployment, outsider, { work: CSV, timing: { judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 60, appealDecideSec: 120 } });
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: deal.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(deal.buyer, deal.id, ['Released'], 120_000);
      expect(await deal.buyer.openDelivery(deal.id)).toBe(CSV);
    } finally {
      await demo.close();
    }
  }, 600_000);
});
