// The visitor's path (D47): `node try.mjs --seller <url>` plays only the buyer, and Crow's test seller is the other
// party. Both run as a stranger would run them: try.ts in a separate Node process, the seller served over HTTP, the
// public demo's own world on two origins, all in this process, so CI needs no network. examples/try.test.ts covers
// the self-play deal and the published bundle.
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@holdback/demo-cloud';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knownPins } from '../../../examples/verify.ts';
import { TestSeller } from './seller.ts';
import { serveWorld, type TestWorld } from './test-world.ts';

const TRY = fileURLToPath(new URL('../../../examples/try.ts', import.meta.url));

/** The test seller over HTTP at http://127.0.0.1:<port>/agents/test-seller, worked as its Durable Object's alarm works it. */
async function serveSeller(operators: readonly string[]): Promise<{ url: string; close(): Promise<void> }> {
  // The handler runs only after `seller` below exists: the seller's URL needs the port first.
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const r = await seller.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method ?? 'GET', headers: req.headers as Record<string, string>, ...(body ? { body } : {}) }), req.socket.remoteAddress ?? 'unknown');
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agents/test-seller`;
  const seller = new TestSeller({ storage: new MemoryStorage(), operators: [...operators], seed: generatePrivateKey(), pin: knownPins()[0]!, base: url, log: () => {} });
  let running = true;
  const loop = (async () => {
    while (running) {
      await seller.work();
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

type Run = { code: number | null; out: string };
function node(args: string[], operators: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, HOLDBACK_OPERATORS: operators.join(',') } });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
    child.stdin.end();
  });
}

/** What a run with --seller prints when the test seller is the other party. */
function expectWithSeller(r: Run, state: 'Released' | 'Refunded'): void {
  expect(r.code, r.out).toBe(0);
  for (const step of ['keys', 'faucet', 'seller', 'propose', 'offered', 'accepted', 'check', 'fund', 'deliver', 'outcome', 'balances', 'final']) expect(r.out, step).toMatch(new RegExp(`^${step} +\\S`, 'm'));
  expect(r.out).toMatch(/^faucet +1000 tUSD, admitted to demo-club$/m);
  expect(r.out).toMatch(/^seller +Crow's test seller at http:\/\/127\.0\.0\.1:\d+\/agents\/test-seller: it offers from 0x[0-9a-f]{6}…[0-9a-f]{4}, 26\.01 tUSD in all for this deal$/m);
  expect(r.out).toMatch(/^offered +0x[0-9a-f]{6}…[0-9a-f]{4} offered by the test seller$/m);
  expect(r.out).toMatch(/^fund +Held: 26 tUSD held \(25 price \+ 1 adjudication fee\), operator fee 0\.01 tUSD$/m);
  expect(r.out).toMatch(/with Crow's test seller as the other party/);
  expect(r.out).toMatch(new RegExp(`\\ndone +commitment 0x[0-9a-f]{64} ${state}\\n$`));
}

let demo: TestWorld;
let seller: Awaited<ReturnType<typeof serveSeller>>;
beforeAll(async () => {
  demo = await serveWorld();
  seller = await serveSeller(demo.urls);
});
afterAll(async () => {
  await seller.close();
  await demo.close();
});

describe('try.ts --seller', () => {
  it("buys from Crow's test seller as the buyer only, and opens the work", async () => {
    const r = await node([TRY, '--seller', seller.url], demo.urls);
    expectWithSeller(r, 'Released');
    expect(r.out).toMatch(/^outcome +Released: checks cols pass, rows pass, uniq pass; decision accept$/m);
    expect(r.out).toContain('3 rows, 1,ada@example.com | 2,alan@example.com | 3,grace@example.com');
    expect(r.out).toMatch(/^balances +buyer 973\.99 tUSD$/m);
  }, 60_000);

  it('asks for a refund with --outcome refund, and sees the rows check fail and the price come back', async () => {
    const r = await node([TRY, '--seller', seller.url, '--outcome', 'refund'], demo.urls);
    expectWithSeller(r, 'Refunded');
    expect(r.out).toMatch(/^outcome +Refunded: checks cols pass, rows FAIL, uniq pass; decision reject$/m);
    expect(r.out).toMatch(/^refund +the price came back to the buyer; no key was released/m);
    expect(r.out).toMatch(/^balances +buyer 998\.99 tUSD$/m);
    expect(r.out).not.toMatch(/^open /m);
  }, 60_000);

  it('plays both sides, and says why, when the test seller does not answer', async () => {
    const r = await node([TRY, '--seller', 'http://127.0.0.1:9/agents/test-seller'], demo.urls);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^seller +the test seller is unavailable: http:\/\/127\.0\.0\.1:9\/agents\/test-seller\/agent\.json did not answer .*Playing both sides instead$/m);
    expect(r.out).toMatch(/^outcome +Released: checks cols pass, rows pass, uniq pass; decision accept$/m);
    expect(r.out).toMatch(/since the test seller was unavailable/);
    expect(r.out).toMatch(/\ndone +commitment 0x[0-9a-f]{64} Released\n$/);
  }, 60_000);
});
