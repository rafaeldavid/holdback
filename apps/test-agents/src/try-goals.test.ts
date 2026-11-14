// The goal commands (T-441), as a stranger runs them: each published bundle (site/try-sell.mjs, try-judged.mjs,
// try-reclaim.mjs) in its own Node process, against the public demo's own world on two origins and Crow's test seller
// or test buyer served over HTTP, all in this process, so CI needs no network. These are the scripted runs of
// benchmark scenarios s2, s3, s5 and s6 through the one command each.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@holdback/demo-cloud';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knownPins } from '../../../examples/verify.ts';
import { TestBuyer } from './buyer.ts';
import { TestSeller } from './seller.ts';
import { serveWorld, type TestWorld } from './test-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const bundle = (name: string) => fileURLToPath(new URL(`../../../site/${name}.mjs`, import.meta.url));
const pin = knownPins()[0]!; // SimChain

/** A test agent's fetch(request, client) over HTTP at <path>, worked as its Durable Object's alarm works it. */
async function serveAgent(path: string, make: (base: string) => { fetch(r: Request, client: string): Promise<Response>; work(): Promise<unknown> }): Promise<{ url: string; close(): Promise<void> }> {
  // The handler runs only after the agent below exists: the agent's base URL needs the port first.
  const held: { agent?: ReturnType<typeof make> } = {};
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const r = await held.agent!.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method ?? 'GET', headers: req.headers as Record<string, string>, ...(body ? { body } : {}) }), req.socket.remoteAddress ?? 'unknown');
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
  const agent = (held.agent = make(url));
  let running = true;
  const loop = (async () => {
    while (running) {
      await agent.work().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return {
    url,
    close: async () => {
      running = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}
const seller = (world: TestWorld) => serveAgent('/agents/test-seller', (base) => new TestSeller({ storage: new MemoryStorage(), operators: [...world.urls], seed: generatePrivateKey(), pin, base, log: () => {} }));
const buyer = (world: TestWorld) => serveAgent('/agents/test-buyer', (base) => new TestBuyer({ storage: new MemoryStorage(), operators: [...world.urls], seed: generatePrivateKey(), pin, base, log: () => {} }));

type Run = { code: number | null; out: string };
function start(args: string[], operators: readonly string[], onLine: (line: string) => void = () => {}): { child: ChildProcess; done: Promise<Run> } {
  // Only PATH and the operators: the command reads nothing else from the environment.
  const child = spawn(process.execPath, args, { env: { PATH: process.env['PATH'] ?? '', HOLDBACK_OPERATORS: operators.join(',') } });
  let out = '';
  const take = (d: Buffer) => {
    out += d.toString();
    for (const l of d.toString().split('\n')) if (l) onLine(l);
  };
  child.stdout!.on('data', take);
  child.stderr!.on('data', take);
  child.stdin!.end();
  return { child, done: new Promise((resolve) => child.on('exit', (code) => resolve({ code, out }))) };
}
const node = (args: string[], operators: readonly string[]) => start(args, operators).done;

/** What every goal command prints: ASCII step lines, no key material, and the `done` line with the end state. */
function expectDone(r: Run, state: 'Released' | 'Refunded'): void {
  expect(r.code, r.out).toBe(0);
  expect(r.out).not.toMatch(/[^\x00-\x7f]/);
  expect(r.out).not.toMatch(/0x[0-9a-f]{64}(?![0-9a-f])(?<!commitment 0x[0-9a-f]{64})/); // no 32-byte hex but the commitment ID
  expect(r.out).toMatch(new RegExp(`\\ndone +commitment 0x[0-9a-f]{64} ${state}\\n$`));
}

// A panel that stands in for the live models, as seller.test.ts's: it fails a text that says the seller is paid at
// once (the test seller's honest bad summary) and passes the rest.
const IDS = '6. "criteria" must contain each of these ids exactly once: ';
const standIn = { complete: async (req: { system: string; user: string }) => {
  const ids = (req.system.split('\n').find((l) => l.startsWith(IDS)) ?? IDS).slice(IDS.length).replace(/\.$/, '').split(', ').filter((x) => x && x !== '(none)');
  const fails = /paid at once/.test(req.user);
  return { kind: 'ok' as const, text: JSON.stringify({ criteria: ids.map((id) => ({ id, score: fails ? 0 : 4, evidence: fails ? 'It contradicts the facts.' : 'It states the facts.' })), overall: fails ? 'fail' : 'pass', injectionSuspected: false, rationale: fails ? 'stand-in: fail' : 'stand-in: pass' }), latencyMs: 1 };
} };

describe('try-judged.mjs (scenario s2)', () => {
  let world: TestWorld;
  let s: Awaited<ReturnType<typeof seller>>;
  beforeAll(async () => {
    world = await serveWorld({ judgeProvider: standIn, liveCallsPerDay: 1000 });
    s = await seller(world);
  });
  afterAll(async () => {
    await s.close();
    await world.close();
  });

  it('buys the rubric-judged text, prints the rubric, sees the panel pass it, and opens it', async () => {
    const r = await node([bundle('try-judged'), '--seller', s.url], world.urls);
    expectDone(r, 'Released');
    expect(r.out).toMatch(/^seller +rubric: accurate \(weight 60\), complete \(weight 40\); passes at 300/m);
    expect(r.out).toMatch(/^offered +0x[0-9a-f]{6}\.\.\.[0-9a-f]{4} offered by the test seller$/m);
    expect(r.out).toMatch(/^outcome +Released: checks hidden pass; panel .*pass.*; decision accept$/m);
    expect(r.out).toMatch(/^open +the buyer decrypted its copy, sha256 checked: \d+ words: When a buyer funds a deal on Crow/m);
  }, 90_000);

  it('buys the text the panel rejects with --outcome refund, and sees the price come back', async () => {
    const r = await node([bundle('try-judged'), '--seller', s.url, '--outcome', 'refund'], world.urls);
    expectDone(r, 'Refunded');
    expect(r.out).toMatch(/decision reject$/m);
    expect(r.out).not.toMatch(/^open /m);
  }, 90_000);
});

describe('try-reclaim.mjs (scenario s5)', () => {
  let skew = 0;
  let world: TestWorld;
  let s: Awaited<ReturnType<typeof seller>>;
  beforeAll(async () => {
    world = await serveWorld({ now: () => Date.now() + skew });
    s = await seller(world);
  });
  afterAll(async () => {
    await s.close();
    await world.close();
  });

  it('funds the silent offer, waits for deliverBy by settlement time, and reclaims the hold', async () => {
    // Settlement time jumps past deliverBy (5 minutes) once the hold is funded, so the test takes seconds, not minutes.
    const run = start([bundle('try-reclaim'), '--seller', s.url], world.urls, (line) => {
      if (/^wait +nothing is delivered/.test(line)) skew = 310_000;
    });
    const r = await run.done;
    expectDone(r, 'Refunded');
    expect(r.out).toMatch(/^wait +nothing is delivered; deliverBy is \S+, judged by the block's timestamp/m);
    expect(r.out).toMatch(/^(reclaim|refunded) /m);
    expect(r.out).toMatch(/^refunded +Refunded on every operator: the price and the adjudication fee came back/m);
  }, 90_000);

  it('refuses, and exits 3 before it funds, when the seller offers a longer delivery window than it accepts', async () => {
    const slow = await serveAgent('/agents/test-seller', (base) => new TestSeller({ storage: new MemoryStorage(), operators: [...world.urls], seed: generatePrivateKey(), pin, base, log: () => {}, silentTiming: { offerExpiresInSec: 180, fundWithinSec: 240, deliverWithinSec: 1200, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 } }));
    try {
      const r = await node([bundle('try-reclaim'), '--seller', slow.url], world.urls);
      expect(r.code, r.out).toBe(3);
      expect(r.out).toMatch(/^refused at check: refusing to agree: the offer's deliverBy window is 1200 s, longer than the 600 s this buyer accepts$/m);
      expect(r.out).not.toMatch(/^fund /m);
    } finally {
      await slow.close();
    }
  }, 60_000);
});

describe('try-sell.mjs (scenarios s3 and s6)', () => {
  let world: TestWorld;
  let b: Awaited<ReturnType<typeof buyer>>;
  beforeAll(async () => {
    world = await serveWorld();
    b = await buyer(world);
  });
  afterAll(async () => {
    await b.close();
    await world.close();
  });

  it('sells the customer list to the test buyer and is paid (s3)', async () => {
    const r = await node([bundle('try-sell'), '--buyer', b.url], world.urls);
    expectDone(r, 'Released');
    expect(r.out).toMatch(/^outcome +Released: checks cols pass, rows pass, uniq pass; decision accept$/m);
    expect(r.out).toMatch(/^outcome +the test buyer reports released/m);
  }, 90_000);

  it("sells a robot's joint log under checks that state its format (s6)", async () => {
    const r = await node([bundle('try-sell'), '--buyer', b.url, '--sample', 'robot-log'], world.urls);
    expectDone(r, 'Released');
    expect(r.out).toMatch(/^outcome +Released: checks format pass, rows pass, one-reading pass, positions pass, joints pass; decision accept$/m);
  }, 90_000);

  it('delivers work that fails a check with --outcome refund, and the buyer is refunded', async () => {
    const r = await node([bundle('try-sell'), '--buyer', b.url, '--sample', 'robot-log', '--outcome', 'refund'], world.urls);
    expectDone(r, 'Refunded');
    expect(r.out).toMatch(/rows FAIL/);
  }, 90_000);

  it('sells your own work under your own checks with --work and --terms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-try-sell-'));
    writeFileSync(join(dir, 'work.csv'), 'sku,qty\nA1,3\nB2,5\n');
    writeFileSync(join(dir, 'terms.json'), JSON.stringify({ price: '5000000', deliverable: { kind: 'dataset', description: 'stock.csv, one row per SKU', format: 'text/csv' }, checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['sku', 'qty'] }] }));
    const r = await node([bundle('try-sell'), '--buyer', b.url, '--work', join(dir, 'work.csv'), '--terms', join(dir, 'terms.json')], world.urls);
    expectDone(r, 'Released');
    expect(r.out).toMatch(/for 5 tUSD, checks cols$/m);
  }, 90_000);

  it('refuses wrong calls before it makes a key: exit 2 for an unknown flag, 1 for --work without --terms', async () => {
    expect((await node([bundle('try-sell'), '--key', '0x01'], world.urls)).code).toBe(2);
    const half = await node([bundle('try-sell'), '--work', 'x.csv'], world.urls);
    expect(half.code).toBe(1);
    expect(half.out).toMatch(/--work and --terms go together/);
    expect(half.out).not.toMatch(/^keys /m);
  }, 30_000);
});

describe('the goal bundles', () => {
  it('answer --help with what they do, and exit 0', async () => {
    for (const name of ['try-sell', 'try-judged', 'try-reclaim']) {
      const r = await node([bundle(name), '--help'], []);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(new RegExp(`^${name}: `));
    }
  }, 30_000);

  it("read only the four settings try.mjs reads from the environment (the operators, and a local chain's pins), and write no file", () => {
    for (const name of ['try-sell', 'try-judged', 'try-reclaim']) {
      const src = readFileSync(bundle(name), 'utf8');
      const envs = [...new Set([...src.matchAll(/process\.env\[?["'.]?([A-Z_]+)/g)].map((m: J) => m[1]))].sort();
      expect(envs, name).toEqual(['HOLDBACK_CHAIN_ID', 'HOLDBACK_DEPLOYMENT', 'HOLDBACK_OPERATORS', 'HOLDBACK_VERIFYING_CONTRACT']);
      expect(src, name).not.toMatch(/\b(writeFileSync|appendFileSync|createWriteStream|writeFile)\b/);
    }
  });
});
