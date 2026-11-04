// The relayer lanes' in-flight rows (T-219) in the world's storage, and the cutover case: a Durable Object restarted
// between a broadcast and its receipt, for a funding, a delivery and a decision, as seen live at the T-213 cutover.
//
// The cutover case runs on anvil with a block every second (standing in for Sepolia), the contracts from contracts/out,
// and examples/try.ts as the agents in their own process. Each world reaches the chain through its own JSON-RPC proxy.
// Right after a deal lane's broadcast, the test copies the world's storage, cuts that world off from the chain and opens
// a new world on the copy: what a deploy or an eviction leaves. A request the old world was serving is sent again to
// the new one with the same Idempotency-Key and body, as a client retries. Needs `anvil` on PATH and `forge build`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AnyCommitmentTerms, Hex32, SettlementEvent } from '@holdback/core';
import { EvmSettlement, LiveChain, type DeploymentFile, type LaneRow } from '@holdback/settlement/live';
import { anvilAvailable, EvmWorld } from '@holdback/settlement/evm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { laneRowKey, StorageLanes } from './lanes.js';
import { MemoryStorage, type WorldStorage } from './storage.js';
import { Telemetry } from './telemetry.js';
import { PublicWorld } from './world.js';

const row = (lane: number, nonce: number): LaneRow => ({ lane, from: `0x${'0a'.repeat(20)}`, nonce, hashes: [`0x${'1'.repeat(64)}`], raw: '0x02', sentAt: 0 });

describe('the lanes store (T-219)', () => {
  it('keeps one row per lane and nonce under lane:, and costs what T-031 counts', async () => {
    const telemetry = await Telemetry.open({ storage: new MemoryStorage(), now: () => 0, log: () => undefined });
    const lanes = new StorageLanes(telemetry.storage);
    const used = () => ({ read: telemetry.usage().rowsRead, written: telemetry.usage().rowsWritten });
    let at = used();
    const since = () => {
      const now = used();
      const d = { read: now.read - at.read, written: now.written - at.written };
      at = now;
      return d;
    };
    // Opening with no row open: one row read (the list).
    expect(await lanes.load()).toEqual([]);
    expect(since()).toEqual({ read: 1, written: 0 });
    // One row written per broadcast, and the same row again for a fee bump.
    await lanes.write(row(1, 7));
    expect(since()).toEqual({ read: 0, written: 1 });
    await lanes.write({ ...row(1, 7), hashes: [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`] });
    await lanes.write(row(3, 2));
    since();
    // Opening with one row open on each of two lanes: one row read each.
    const open = await lanes.load();
    expect(open.map((r) => [r.lane, r.nonce, r.hashes.length])).toEqual([
      [1, 7, 2],
      [3, 2, 1],
    ]);
    expect(since()).toEqual({ read: 2, written: 0 });
    // One row deleted per applied receipt.
    await lanes.remove([row(1, 7)]);
    expect(since()).toEqual({ read: 0, written: 1 });
    await lanes.remove([]);
    expect(since()).toEqual({ read: 0, written: 0 });
    expect((await lanes.load()).map((r) => r.lane)).toEqual([3]);
  });

  it('lists rows in nonce order within a lane and sender', () => {
    expect([laneRowKey(row(2, 10)), laneRowKey(row(2, 9))].sort()).toEqual([laneRowKey(row(2, 9)), laneRowKey(row(2, 10))]);
    expect(laneRowKey(row(2, 9))).toBe(`lane:2:0x${'0a'.repeat(20)}:000000000009`);
  });

  it('keeps a rotated relayer key’s row apart from the old key’s at the same lane and nonce (red-team, 2026-11-04)', async () => {
    const lanes = new StorageLanes(new MemoryStorage());
    const old = row(3, 5);
    // A new SEPOLIA_RELAYER_KEY deployed while the old key's row is open: its lane 3 sends at the same nonce.
    const rotated: LaneRow = { ...row(3, 5), from: `0x${'0B'.repeat(20)}`, hashes: [`0x${'2'.repeat(64)}`] };
    await lanes.write(old);
    await lanes.write(rotated);
    expect((await lanes.load()).map((r) => r.from)).toEqual([old.from, rotated.from]);
    // Releasing the old row leaves the new one for a restart to land.
    await lanes.remove([old]);
    expect(await lanes.load()).toEqual([rotated]);
  });
});

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ready = anvilAvailable() && existsSync(`${root}contracts/out/HoldbackRules.sol/HoldbackRules.json`);
/** A relayer secret for this test only (anvil; guards no value). */
const RELAYER = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
/** The demo's fee: 1 bp, minimum 0.01 tUSDC plus the 4.70 tUSDC gas quote a chain world adds (D33 as amended). */
const ENV = { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000', OPERATOR_FEE_GAS: '4700000' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lc = (s: string) => s.toLowerCase();

/** World storage that reports each lane row written, and counts the lane rows written, deleted and read. */
class Watched implements WorldStorage {
  readonly lanes = { written: 0, deleted: 0, read: 0 };
  onLaneWrite: (() => void) | null = null;
  constructor(readonly inner: MemoryStorage) {}
  get<T = unknown>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }
  /** The call in the last lane row written. */
  lastCall: string | undefined;
  async put(entries: Record<string, unknown>): Promise<void> {
    await this.inner.put(entries);
    const lanes = Object.keys(entries).filter((k) => k.startsWith('lane:'));
    this.lanes.written += lanes.length;
    for (const k of lanes) this.lastCall = (entries[k] as LaneRow).note?.call;
    if (lanes.length > 0) this.onLaneWrite?.();
  }
  async delete(keys: string[]): Promise<number> {
    this.lanes.deleted += keys.filter((k) => k.startsWith('lane:')).length;
    return this.inner.delete(keys);
  }
  async list<T = unknown>(o: { prefix: string; end?: string }): Promise<Map<string, T>> {
    const found = await this.inner.list<T>(o);
    if (o.prefix === 'lane:') this.lanes.read += found.size;
    return found;
  }
}

/** Everything in `from`, as a Durable Object restarted now reads it. */
async function copyOf(from: MemoryStorage): Promise<MemoryStorage> {
  const out = new MemoryStorage();
  const all = [...(await from.list({ prefix: '' }))];
  for (let i = 0; i < all.length; i += 100) await out.put(Object.fromEntries(all.slice(i, i + 100)));
  return out;
}

/**
 * A JSON-RPC proxy to anvil for one world. Once `armed`, it answers the next broadcast, then calls `cut`. Once `dead`,
 * it answers every request 503, as a stopped Durable Object reaches nothing.
 */
class Proxy {
  dead = false;
  armed = false;
  cut: (() => Promise<void>) | null = null;
  url = '';
  private readonly server: Server;
  private constructor(target: string) {
    this.server = createServer(async (req, res) => {
      const body = await read(req);
      if (this.dead) {
        res.writeHead(503).end();
        return;
      }
      const answer = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then((r) => r.text());
      if (this.armed && body.includes('eth_sendRawTransaction')) {
        this.armed = false;
        await this.cut?.();
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(answer);
    });
  }
  static async start(target: string): Promise<Proxy> {
    const p = new Proxy(target);
    await new Promise<void>((resolve) => p.server.listen(0, '127.0.0.1', resolve));
    p.url = `http://127.0.0.1:${(p.server.address() as AddressInfo).port}`;
    return p;
  }
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }
}

const bytes = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};
const read = async (req: IncomingMessage): Promise<string> => (await bytes(req)).toString('utf8');

/** A request the test server sent again to the next world, as the client's retry. */
interface Retried {
  path: string;
  headers: Record<string, string>;
  body: Buffer;
}

interface Node {
  world: PublicWorld;
  chain: LiveChain;
  storage: Watched;
  proxy: Proxy;
  dead: boolean;
  errors: string[];
}

/** One deal's events, with each party's address replaced by its role: two runs of try.ts compare as one shape. */
function shape(log: readonly SettlementEvent[], id: string): unknown[] {
  const mine = log.filter((e) => e.commitmentId === id);
  const terms = mine.find((e) => e.type === 'commitment.offered')!.payload['terms'] as AnyCommitmentTerms;
  const a = terms.adjudication;
  const roles = new Map([
    [lc(terms.buyer), 'buyer'],
    [lc(terms.seller), 'seller'],
    [lc(a.adjudicator), 'primary'],
    [lc(a.fallbackAdjudicator), 'fallback'],
    [lc(a.appealAdjudicator), 'appeal'],
  ]);
  return mine.map((e) => [e.type, e.submittedVia, roles.get(lc(String(e.actor))) ?? e.actor, e.payload['source'] ?? null, e.payload['path'] ?? null, roles.get(lc(String(e.payload['recipient'] ?? ''))) ?? null]);
}

function runTry(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${root}examples/try.ts`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe.skipIf(!ready)(`a restart between broadcast and receipt (T-219; anvil for Sepolia)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  const proxies: Proxy[] = [];
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
    const lanes = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER }).lanes;
    for (const l of lanes) await anvil.rpc('anvil_setBalance', [l.address, '0x56bc75e2d63100000']);
  }, 120_000);
  afterAll(async () => {
    for (const p of proxies) await p.close();
    await anvil?.stop();
  });

  /** A world on `storage`, reaching anvil through a proxy of its own. */
  async function node(storage: MemoryStorage): Promise<Node> {
    const proxy = await Proxy.start(anvil.rpcUrl);
    proxies.push(proxy);
    const watched = new Watched(storage);
    const errors: string[] = [];
    const chain = new LiveChain({ deployment, rpcUrls: [proxy.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const world = await PublicWorld.open({ storage: watched, env: ENV, live: { chain }, onError: (e) => errors.push(e.message), telemetryLog: () => undefined });
    return { world, chain, storage: watched, proxy, dead: false, errors };
  }

  /**
   * Serves `first` on two origins (node 0 and node 1, as live.test.ts does) and runs its passes, always on the current
   * world. A request the world died serving is sent again to the next world, with the same headers and body.
   */
  async function serve(first: Node, replayed: Retried[]) {
    let current = first;
    const server = createServer(async (req, res) => {
      const host = req.headers.host ?? '';
      const via = { node: (host.startsWith('localhost') ? 1 : 0) as 0 | 1, origin: `http://${host}`, client: '127.0.0.1' };
      const body = await bytes(req);
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      const method = req.method ?? 'GET';
      for (;;) {
        const n = current;
        const r = await n.world.fetch(new Request(`http://${host}${req.url}`, { method, headers, ...(['GET', 'HEAD'].includes(method) ? {} : { body }) }), via).catch(() => null);
        if (r && !n.dead) {
          res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
          res.end(Buffer.from(await r.arrayBuffer()));
          return;
        }
        if (method === 'POST') replayed.push({ path: req.url ?? '', headers, body });
        while (current === n) await sleep(20);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let ticking = true;
    const loop = (async () => {
      while (ticking) {
        // A stopped world's pass is left behind: its reads fail slowly, and the next world's passes start at once.
        const n = current;
        let done = false;
        void n.world.work().catch((e: Error) => n.errors.push(`work: ${e.message}`)).finally(() => (done = true));
        while (!done && current === n) await sleep(20);
        await sleep(200);
      }
    })();
    return {
      urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`] as const,
      current: () => current,
      /** Each deal-lane row written arms the world's proxy: the broadcast after it stops that world. */
      interrupt: (times: number, after: (n: Node) => Promise<Node>) => {
        let left = times;
        const arm = (n: Node) => {
          n.storage.onLaneWrite = () => {
            if (left <= 0 || n.dead) return;
            n.proxy.armed = true;
            n.proxy.cut = async () => {
              left--;
              n.dead = true;
              n.proxy.dead = true;
              const next = await after(n);
              arm(next);
              current = next;
            };
          };
        };
        arm(current);
      },
      close: async () => {
        ticking = false;
        await loop;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  it('reopens from the same storage after each money step, and ends with the uninterrupted run’s log; the buyer reads its key', async () => {
    const tryEnv = (urls: readonly string[]) => ({ HOLDBACK_OPERATORS: urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(deployment) });
    const until = async (n: Node) => {
      for (const end = Date.now() + 90_000; !n.world.ready() && Date.now() < end; ) await sleep(250);
      expect(n.world.ready()).toBe(true);
    };

    // The uninterrupted run.
    const plain = await node(new MemoryStorage());
    const replayedPlain: Retried[] = [];
    const a = await serve(plain, replayedPlain);
    let baseline: { id: string; shape: unknown[] };
    try {
      await until(plain);
      const run = await runTry(tryEnv(a.urls));
      expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
      const id = /commitment (0x[0-9a-f]{64}) Released/.exec(run.out)![1]!;
      baseline = { id, shape: shape((plain.world.chain as EvmSettlement).log(), id) };
    } finally {
      await a.close();
    }
    // One row written and one deleted per transaction: the funding, the delivery and the decision.
    expect(plain.storage.lanes).toMatchObject({ written: 3, deleted: 3 });
    expect([...(await plain.storage.inner.list({ prefix: 'lane:' }))]).toEqual([]);

    // The interrupted run: the world stops right after each of the three broadcasts, and the next opens on a copy.
    const first = await node(new MemoryStorage());
    const replayed: Retried[] = [];
    const b = await serve(first, replayed);
    const worlds: Node[] = [first];
    const opened: Array<{ laneRowsRead: number; rows: number }> = [];
    /** The call each stopped world had just broadcast. */
    const kills: string[] = [];
    let run: { code: number | null; out: string };
    try {
      await until(first);
      b.interrupt(3, async (dead) => {
        const copy = await copyOf(dead.storage.inner);
        const next = await node(copy);
        opened.push({ laneRowsRead: next.storage.lanes.read, rows: next.chain.inFlight().length });
        kills.push(dead.storage.lastCall ?? 'none');
        worlds.push(next);
        return next;
      });
      run = await runTry(tryEnv(b.urls));
    } finally {
      await b.close();
    }
    const last = worlds.at(-1)!;
    expect(run.code, run.out).toBe(0);
    expect(run.out).toMatch(/^done\s+commitment 0x[0-9a-f]{64} Released$/m);
    // The buyer read its key: its released envelope opened the content key, and the hashes checked.
    expect(run.out).toMatch(/the buyer decrypted its copy, sha256 checked/);
    expect(worlds).toHaveLength(4);
    expect(kills).toEqual(['agreeAndFund', 'deliver', 'decide']);
    // Each restarted world read one lane row when it opened, the transaction in flight.
    expect(opened).toEqual([
      { laneRowsRead: 1, rows: 1 },
      { laneRowsRead: 1, rows: 1 },
      { laneRowsRead: 1, rows: 1 },
    ]);
    // The funding and the delivery were requests in flight; the client's retries got the mined results. A request in
    // flight across two stops is retried twice.
    expect(new Set(replayed.map((r) => r.path.split('/').at(-1)))).toEqual(new Set(['agree', 'deliveries']));
    const id = /commitment (0x[0-9a-f]{64}) Released/.exec(run.out)![1]! as Hex32;
    const evm = last.world.chain as EvmSettlement;
    // The same log as the uninterrupted run: the operator's labels, the adapter's records and every key at its turn.
    expect(shape(evm.log(), id)).toEqual(baseline!.shape);
    expect(evm.log().filter((e) => e.commitmentId === id && e.submittedVia === 'demo-op-1').map((e) => e.type)).toEqual(['commitment.offered', 'commitment.agreed', 'fee.operator', 'hold.funded', 'delivery.submitted', 'key.released']);
    expect(await evm.keysFor(id, (evm.log().find((e) => e.commitmentId === id && e.type === 'commitment.offered')!.payload['terms'] as AnyCommitmentTerms).buyer)).toHaveLength(1);
    // Every row is gone once its receipt is applied and written.
    expect([...(await last.storage.inner.list({ prefix: 'lane:' }))]).toEqual([]);
    // Each restarted world landed its row: on its first pass, or first in the retried request for the same deal.
    for (const w of worlds.slice(1)) expect(w.world.lastRecovery()?.failed ?? 0).toBe(0);

    // The same key with the same body replays; with another body it is 409 (hard rule: idempotency).
    const funding = replayed.find((r) => r.path.endsWith('/agree'))!;
    const again = await last.world.fetch(new Request(`http://127.0.0.1${funding.path}`, { method: 'POST', headers: funding.headers, body: funding.body }), { node: 0, origin: 'http://127.0.0.1', client: '127.0.0.1' });
    expect(again.status).toBe(200);
    // The agreement's own nonce, at the top of the agree body: still well formed, now another request.
    const body = JSON.parse(funding.body.toString('utf8')) as { nonce: string };
    body.nonce = `0x${'ab'.repeat(32)}`;
    const other = await last.world.fetch(new Request(`http://127.0.0.1${funding.path}`, { method: 'POST', headers: funding.headers, body: JSON.stringify(body) }), { node: 0, origin: 'http://127.0.0.1', client: '127.0.0.1' });
    expect(other.status).toBe(409);
    expect(((await other.json()) as { type: string }).type).toBe('idempotency_conflict');
    console.log(`T-219 cutover case: stopped after ${kills.join(', ')}; retried ${replayed.map((r) => r.path.split('/').at(-1)).join(', ')}; lane rows per world ${JSON.stringify(worlds.map((w) => w.storage.lanes))}; recoveries ${JSON.stringify(worlds.map((w) => w.world.lastRecovery()))}; uninterrupted run's lane rows ${JSON.stringify(plain.storage.lanes)}`);
  }, 600_000);
});
