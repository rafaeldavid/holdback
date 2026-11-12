// The direct group's tests (T-216): scenarios 8 and 11 run through the driver as a separate process, as Rafa runs it,
// against the demo's own world on two origins. On SimChain both stop before any deal: there is no contract to call.
// On the contracts deployed to anvil, 8 settles its deals with the round's own direct calls, and 11 pauses between a
// relayed broadcast and its answer twice: once with no restart, where it must fail the restart checks, and once with
// the world reopened from what it had stored when the broadcast went out, as a Durable Object restarted then reads it.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage, PublicWorld, type WorldStorage } from '@holdback/demo-cloud';
import { toHex } from 'viem';
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roundKey, type Role } from './e2e-keys.ts';
import { typed } from './e2e-scenarios-direct.ts';
import { ANVIL_SKIP, anvilReady, driver, ENV, expectNoSecrets, results, root, simWorld, WORLD, type DriverRun, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** anvil's default mnemonic, published with Foundry: its accounts guard no value (as e2e-world.ts). */
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
/** The names of a record's failed checks, and its stop when it stopped; a missing record says so. */
const failed = (rec: J) => (rec ? [...rec.checks.filter((c: J) => !c.ok).map((c: J) => c.name), ...(rec.error ? [`stopped: ${rec.error}`] : [])] : ['no record written']);

/** Everything in `from`, as a Durable Object restarted now reads it. */
async function copyOf(from: MemoryStorage): Promise<MemoryStorage> {
  const out = new MemoryStorage();
  const all = [...(await from.list({ prefix: '' }))];
  for (let i = 0; i < all.length; i += 100) await out.put(Object.fromEntries(all.slice(i, i + 100)));
  return out;
}

/** World storage that calls `onDeliverRow` when a relayer lane writes its in-flight row for a relayed `deliver` (T-219). */
class Watched implements WorldStorage {
  onDeliverRow: (() => Promise<void>) | null = null;
  readonly inner: MemoryStorage;
  constructor(inner: MemoryStorage) {
    this.inner = inner;
  }
  get<T = unknown>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    await this.inner.put(entries);
    const hook = this.onDeliverRow;
    if (hook && Object.entries(entries).some(([k, v]) => k.startsWith('lane:') && (v as J)?.note?.call === 'deliver')) {
      this.onDeliverRow = null;
      // The broadcast waits for this: the row is stored first, as the lane writes it (T-219).
      await hook();
    }
  }
  delete(keys: string[]): Promise<number> {
    return this.inner.delete(keys);
  }
  list<T = unknown>(o: { prefix: string; end?: string }): Promise<Map<string, T>> {
    return this.inner.list<T>(o);
  }
}

type Node = { world: PublicWorld; storage: Watched; dead: boolean };
type Restartable = Served & {
  rpcUrl: string;
  deployment: J;
  setBalance(address: string, wei: bigint): Promise<void>;
  /** The next relayed delivery's response waits for `release`, as a Sepolia receipt keeps a request open (no restart). */
  holdNextDelivery(): { release(): void };
  /** The world stops when its next relayed delivery's lane row is written; resolves with a reopen on what it had stored then. */
  stopAtNextDelivery(): Promise<() => Promise<void>>;
};

/**
 * The demo's world on anvil, as e2e-world.ts's anvilWorld, served on two origins, that can stop and reopen as a
 * Durable Object restarted mid-step does: a stopped world runs no more passes and its open requests never get an
 * answer (the socket closes), and the next world opens on a copy of the storage taken when the lane row was written.
 */
async function restartableAnvil(): Promise<Restartable> {
  const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
  const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
  const live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
  const anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
  const d = anvil.deployment;
  const deployment = {
    chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
    token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
    escrow: d.escrow, erc3009Collector: d.erc3009Collector, multicall: d.multicall, rules: d.rules, bonds: d.bonds, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
  };
  const relayerKey = toHex(mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 1 }).getHdKey().privateKey!);
  const open = async (inner: MemoryStorage): Promise<Node> => {
    const storage = new Watched(inner);
    const chain = new live.LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    return { world: await PublicWorld.open({ storage, env: ENV, ...WORLD, live: { chain } }), storage, dead: false };
  };
  let current = await open(new MemoryStorage());
  let hold: Promise<void> | null = null;
  const ready = async () => {
    for (const end = Date.now() + 90_000; !current.world.ready() && Date.now() < end; ) await sleep(250);
  };
  const requests: string[] = [];
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    if (body) requests.push(`${req.method} ${req.url}`);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    while (current.dead) await sleep(20);
    const n = current;
    const held = req.method === 'POST' && /\/deliveries$/.test(req.url ?? '') ? hold : null;
    const r = await n.world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node: host.startsWith('localhost') ? 1 : 0, origin: `http://${host}`, client: req.socket.remoteAddress ?? 'unknown' });
    if (held) await held;
    // A world that stopped while serving this request never answers it: the connection drops when the next one opens.
    if (n.dead) {
      while (current === n) await sleep(20);
      return void res.socket?.destroy();
    }
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
  const loop = (async () => {
    while (ticking) {
      const n = current;
      if (!n.dead) await n.world.work();
      await sleep(200);
    }
  })();
  await ready();
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    requests,
    rpcUrl: anvil.rpcUrl,
    deployment,
    setBalance: async (address, wei) => {
      await fetch(anvil.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [address, toHex(wei)] }) });
    },
    holdNextDelivery: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => (release = resolve));
      return { release: () => { hold = null; release(); } }; // prettier-ignore
    },
    stopAtNextDelivery: () =>
      new Promise((resolve) => {
        const n = current;
        n.storage.onDeliverRow = async () => {
          const copy = await copyOf(n.storage.inner);
          n.dead = true;
          resolve(async () => {
            current = await open(copy);
            await ready();
          });
        };
      }),
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await anvil.stop();
    },
  };
}

/**
 * The driver as a separate process with its stdin open (e2e-world.ts's `driver` closes it): `onLine` sees each line it
 * prints, and may answer on its stdin, as Rafa types `deployed` at scenario 11's pause. The answer starts with a stray
 * Enter, as one typed earlier in a long run would still be buffered: the driver must ignore it.
 */
function interactive(args: string[], env: Record<string, string>, onLine: (line: string, answer: () => void) => void): Promise<DriverRun> {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['E2E_SEPOLIA_SEED', 'HOLDBACK_DEPLOYMENT', 'SEPOLIA_RPC_URL'].includes(k)));
    const child = spawn(process.execPath, [here('./e2e-round.ts'), ...args], { env: { ...clean, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let partial = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      partial += d.toString();
      for (let i = partial.indexOf('\n'); i >= 0; i = partial.indexOf('\n')) {
        const line = partial.slice(0, i);
        partial = partial.slice(i + 1);
        onLine(line, () => {
          child.stdin.write('\n');
          child.stdin.end('deployed\n');
        });
      }
    });
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

describe("typed: scenario 11's pause", () => {
  it('ignores an Enter typed earlier and any other line, and ends on the word', async () => {
    const input = new PassThrough();
    // An Enter typed earlier in the run, still buffered when the pause starts reading.
    input.write('\n');
    const other: string[] = [];
    let done = false;
    const ended = typed('deployed', input, (line) => other.push(line)).then(() => (done = true));
    input.write('yes\n');
    await sleep(50);
    expect(done).toBe(false);
    input.write(' Deployed \n');
    await ended;
    expect(other).toEqual(['', 'yes']);
  });

  it('stops with an error when its input closes before the word', async () => {
    const input = new PassThrough();
    const ended = typed('deployed', input);
    input.end('\n');
    await expect(ended).rejects.toThrow(/stdin closed before "deployed" was typed: scenario 11 waits for Rafa at a terminal/);
  });
});

describe('e2e-scenarios-direct.ts', () => {
  it('lists 8 and 11 as built, with what they wait for and no "needs" line', async () => {
    const r = await driver(['list'], {});
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^ {2}8 +The escape hatch: direct calls on API deals; waits for T-218, T-217, T-221\n {2}9 /m);
    expect(r.out).toMatch(/^ {2}11 +A restart between broadcast and receipt \(live holdback-op1 redeploy\); waits for T-219\n(?! {6}needs)/m);
  });

  describe('against the demo world on SimChain', () => {
    let demo: Served;
    beforeAll(async () => {
      demo = await simWorld();
    });
    afterAll(() => demo.close());

    it('stops 8 and 11 before any deal: SimChain has no contract to call', async () => {
      const seed = generatePrivateKey();
      const out = mkdtempSync(join(tmpdir(), 'e2e-direct-sim-'));
      const r = await driver(['run', '8', '11', '--t220'], { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), E2E_OUT: out });
      expect(r.out).toMatch(/^results: 8 error, 11 error$/m);
      const { folder, byId } = results(out);
      for (const id of ['8', '11']) {
        expect(byId[id].deals).toEqual([]);
        expect(byId[id].error).toMatch(/SimChain has (none|neither)/);
      }
      expectNoSecrets(seed, r.out, folder);
    }, 120_000);
  });

  describe.skipIf(!anvilReady)(`against the demo world on anvil${ANVIL_SKIP}`, () => {
    let demo: Restartable;
    const seed = generatePrivateKey();
    let env: Record<string, string>;
    beforeAll(async () => {
      demo = await restartableAnvil();
      env = { E2E_SEPOLIA_SEED: seed, HOLDBACK_OPERATORS: demo.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(demo.deployment), SEPOLIA_RPC_URL: demo.rpcUrl };
      // The buyer, the seller and the round's adjudicator pay their own gas for direct calls, approvals and the bond.
      for (const role of ['buyer', 'seller', 'adjudicator-1'] as Role[]) await demo.setBalance(privateKeyToAccount(roundKey(seed, role)).address, 10n ** 18n);
    }, 180_000);
    afterAll(async () => {
      await demo?.close();
    });

    it('records 8 and 11 as waiting until --t220 says T-218 and T-219 are deployed', async () => {
      const out = mkdtempSync(join(tmpdir(), 'e2e-direct-wait-'));
      const r = await driver(['run', '8', '11'], { ...env, E2E_OUT: out });
      expect(r.out).toMatch(/^results: 8 waits, 11 waits$/m);
      const { byId } = results(out);
      expect(byId['8']).toMatchObject({ status: 'waits', waitsFor: ['T-218'], deals: [] });
      expect(byId['11']).toMatchObject({ status: 'waits', waitsFor: ['T-219'], deals: [] });
    }, 120_000);

    it('8: funds and delivers an API deal directly and takes over a silent primary directly, each step shown as direct on both operators; waits for T-217 for the fallback decision', async () => {
      const out = mkdtempSync(join(tmpdir(), 'e2e-direct-8-'));
      const r = await driver(['run', '8', '--t220', '--no-homepage'], { ...env, E2E_OUT: out });
      const { folder, byId } = results(out);
      const rec = byId['8'];
      // anvil's club names the sim beacon, so the demo fallback signs no decision here (T-217 needs drand on a chain): the
      // takeover deal ends by its default, every check up to it holds, and the scenario waits for T-217.
      expect(rec?.checks.filter((c: J) => !c.ok).map((c: J) => c.name), r.out).toEqual([]);
      expect(rec).toMatchObject({ status: 'waits', waitsFor: ['T-217'], stoppedAt: 'outcome' });
      expect(r.out).toMatch(/^results: 8 waits$/m);
      expect(r.code, r.out).toBe(0);
      expect(rec.deals.map((d: J) => d.chain?.stage)).toEqual(['Released', 'Refunded']);
      // The round's own transactions, read back from the chain: the funding and the delivery from the parties' keys,
      // then the takeover from the buyer's.
      const sent = (deal: number) => rec.deals[deal].transactions.filter((t: J) => t.sentBy === 'round').map((t: J) => t.calls[0]?.fn);
      expect(sent(0)).toEqual(expect.arrayContaining(['agreeAndFund', 'deliver']));
      expect(sent(1)).toEqual(expect.arrayContaining(['triggerFallback']));
      for (const type of ['hold.funded', 'delivery.submitted', 'fallback.triggered']) expect(rec.checks.find((c: J) => c.name.startsWith(`${type} shows on both operators as submittedVia "direct"`))?.ok, type).toBe(true);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);

    it('11 without a restart: pauses after the broadcast, waits for "deployed", and fails only the restart checks', async () => {
      const out = mkdtempSync(join(tmpdir(), 'e2e-direct-11-plain-'));
      // A Sepolia block keeps the relayed request open for seconds; here the response waits until the answer.
      const held = demo.holdNextDelivery();
      let pausedLines: string[] = [];
      const r = await interactive(['run', '11', '--t220', '--no-homepage'], { ...env, E2E_OUT: out }, (line, answer) => {
        if (/\[11\] PAUSED/.test(line)) pausedLines.push(line);
        if (/Then type deployed and press Enter here/.test(line)) {
          answer();
          held.release();
        }
      });
      const { folder, byId } = results(out);
      // What Rafa reads at the pause: the lane and nonce in flight, and the exact deploy command.
      pausedLines = pausedLines.map((l) => l.replace(/^\[11\] PAUSED +/, ''));
      expect(pausedLines.join('\n')).toMatch(/broadcast the delivery from lane 0x[0-9a-f]{40} at nonce \d+ and has not answered yet/);
      expect(pausedLines.join('\n')).toContain(`npx -y wrangler@4 deploy -c ${root.replace(/\/+$/, '')}/apps/demo-cloud/wrangler.op1.jsonc`);
      // The stray Enter before the word does not end the pause.
      expect(pausedLines.join('\n')).toMatch(/ignored a line that is not "deployed"/);
      expect(failed(byId['11']), r.out).toEqual(['holdback-op1 restarted during the pause', 'the restart cut the relayed delivery before holdback-op1 answered it']);
      expect(r.out).toMatch(/^results: 11 fail$/m);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);

    it('11 with a restart between the broadcast and its receipt: the step lands as the relay, and the buyer reads its key', async () => {
      const out = mkdtempSync(join(tmpdir(), 'e2e-direct-11-restart-'));
      const reopen = demo.stopAtNextDelivery();
      const r = await interactive(['run', '11', '--t220', '--no-homepage'], { ...env, E2E_OUT: out }, (line, answer) => {
        // At the pause, the redeploy: the world restarts on what it stored when the lane row was written, then the answer.
        if (/Then type deployed and press Enter here/.test(line)) void reopen.then((again) => again()).then(answer);
      });
      const { folder, byId } = results(out);
      expect(failed(byId['11']), r.out).toEqual([]);
      expect(r.out).toMatch(/^results: 11 pass$/m);
      expect(r.code, r.out).toBe(0);
      expect(byId['11'].checks.find((c: J) => c.name === 'the restart cut the relayed delivery before holdback-op1 answered it').detail).toMatch(/no answer/);
      expectNoSecrets(seed, r.out, folder);
    }, 600_000);
  });
});
