// Crow's buying agent (T-440), the attacks from its red team: a signer that is down or goes away, operators that
// charge a fee, a signer answer for another deal, files swapped in the key store, operators written with a trailing
// slash, a misspelt term in --expect-terms. Each fails on the branch before its fix and names the outcome the defense gives. Keys are made in memory for one run and guard nothing.
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cast, CHECKS, cleanup, DELIVERABLE, mandateFor, payment, startSigner, type Cast, type Running } from './signer-test-kit.ts';
import { balance, rulesForWorld, serveSeller, storeIn, TIMING, topUp, upToPayment, type World } from './signer-world-kit.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// RT-5's disk swap: the first read of a terms file by the command swaps both files in the key store for another deal's.
const swap = vi.hoisted(() => ({ armed: null as null | { terms: unknown; file: unknown } }));
vi.mock('node:fs', async (orig) => {
  const fs = (await orig()) as typeof import('node:fs');
  const readFileSync = ((p: J, ...rest: J[]) => {
    const y = swap.armed;
    if (y && typeof p === 'string' && p.endsWith('.terms.json')) {
      swap.armed = null;
      fs.writeFileSync(p, `${JSON.stringify(y.terms, null, 2)}\n`);
      fs.writeFileSync(p.replace(/\.terms\.json$/, '.funding.typed.json'), `${JSON.stringify(y.file, null, 2)}\n`);
    }
    return (fs.readFileSync as J)(p, ...rest);
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const dirs: string[] = [];
const store = storeIn(dirs);

function ownBuyer(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [here('./own-buyer.ts'), ...args], { env: { PATH: process.env['PATH'] ?? '', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('exit', (code) => ok({ code, out, err }));
  });
}

/** A stand-in on the agent-to-signer channel: GET /v1/status goes to the real signer; POST /v1/sign does `onSign`. */
async function channel(real: Running, onSign: (body: string, res: import('node:http').ServerResponse) => Promise<void> | void): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (req.method === 'GET' && req.url === '/v1/status') {
      const s = await real.get('/v1/status');
      return void res.writeHead(s.status, { 'content-type': 'application/json' }).end(JSON.stringify(s.body));
    }
    await onSign(Buffer.concat(chunks).toString(), res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((ok) => (server.closeAllConnections(), server.close(() => ok()))) };
}

let demo: TwoOrigins, w: World, c: Cast, s: Running, env: Record<string, string>;
beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' }, faucetPerClient: 1000 });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  const found = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
  w = { urls: demo.urls, found, token: 'tUSD', seller: await serveSeller(demo.urls, found, 'tUSD') };
  c = cast();
  s = await startSigner(c, await rulesForWorld(w, c, store), await mandateFor(c));
  dirs.push(s.dir);
  expect((await topUp(w, c.float, '20000000')).status).toBe(200);
  env = { HOLDBACK_OPERATORS: demo.urls.join(',') };
});
afterAll(async () => {
  await s?.kill();
  await w?.seller.close();
  await demo?.close();
  cleanup(dirs);
});

describe('T-440 red team: the buying agent through the signer', () => {
  it('RT-1: a signer that is not running pays nothing and exits 3, naming the signer', async () => {
    const gone = await channel(s, () => undefined);
    const url = gone.url;
    await gone.close(); // nothing listens on this port now
    const before = await balance(w, c.float);
    const r = await ownBuyer([w.seller.quoteUrl, store(), '"rows"', '10000000', '--signer', url], env);
    expect(await balance(w, c.float)).toBe(before);
    expect(r.err).toMatch(/signer/);
    expect(r.code, r.err).toBe(3);
  }, 60_000);

  it('RT-2: a signer that goes away between its status and the signature pays nothing and exits 3, naming the signer', async () => {
    const dying = await channel(s, (_b, res) => void res.socket?.destroy());
    try {
      const before = await balance(w, c.float);
      const r = await ownBuyer([w.seller.quoteUrl, store(), '"rows"', '10000000', '--signer', dying.url], env);
      expect(await balance(w, c.float)).toBe(before);
      expect(r.err).toMatch(/signer/);
      expect(r.code, r.err).toBe(3);
    } finally {
      await dying.close();
    }
  }, 60_000);

  it('RT-3 (AC 3, untested on the branch): operators that charge a fee: nothing is paid, the signer is never asked, exit 3', async () => {
    const feeWorld = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '100', OPERATOR_FEE_MIN: '0' }, faucetPerClient: 1000 });
    const feeDemo = await serveTwoOrigins(feeWorld, { tickMs: 100 });
    const found = (await (await fetch(`${feeDemo.urls[0]}/.well-known/holdback.json`)).json()) as J;
    const seller = await serveSeller(feeDemo.urls, found, 'tUSD');
    try {
      const status = (await s.get('/v1/status')).body;
      const r = await ownBuyer([seller.quoteUrl, store(), '"rows"', '20000000', '--signer', s.url], { HOLDBACK_OPERATORS: feeDemo.urls.join(',') });
      expect(r.code, r.err).toBe(3);
      expect(r.err).toMatch(/operator fee.*B14/);
      expect((await s.get('/v1/status')).body.signedToday).toBe(status.signedToday);
      expect(readdirSync(join(s.statePath)).includes('decisions.jsonl') ? (await import('node:fs')).readFileSync(join(s.statePath, 'decisions.jsonl'), 'utf8') : '').not.toMatch(/B14/);
    } finally {
      await seller.close();
      await feeDemo.close();
    }
  }, 90_000);

  it("RT-4: a signer answer for another deal is refused by deal ID before anything is written or sent, and the float pays nothing", async () => {
    const y = await upToPayment(w, c.float, store); // another deal inside the rules, from the same listed seller
    const swapped = await channel(s, async (_b, res) => {
      const a = await s.post(payment(y.terms, y.file)); // the real signer signs Y, not the deal the agent asked about
      res.writeHead(a.status, { 'content-type': 'application/json' }).end(JSON.stringify(a.body));
    });
    try {
      const before = await balance(w, c.float), dir = store();
      const r = await ownBuyer([w.seller.quoteUrl, dir, '"rows"', '10000000', '--signer', swapped.url], env);
      expect(await balance(w, c.float)).toBe(before);
      expect(r.code, r.err).toBe(3);
      // The defense: compare signed.body.commitmentId and signed.body.digest with the deal and file asked about.
      expect(readdirSync(dir).filter((f) => f.endsWith('.delegation.json')), 'a delegation for another deal key was written into this store').toEqual([]);
      expect(r.err).toMatch(/another deal|commitment ID|digest/);
    } finally {
      await swapped.close();
    }
  }, 90_000);

  it('RT-5: terms and funding files swapped in the key store after fundingFiles: the signer is never asked for the other deal', async () => {
    const { buyThroughSigner } = await import('./own-buyer.ts');
    const y = await upToPayment(w, c.float, store);
    const before = await balance(w, c.float), status = (await s.get('/v1/status')).body;
    swap.armed = { terms: y.terms, file: y.file };
    await expect(buyThroughSigner({ quoteUrl: w.seller.quoteUrl, store: store(), scope: 'rows', most: '10000000', signer: s.url, operators: w.urls, log: () => {} })).rejects.toThrow();
    expect(swap.armed, 'the swap did not run').toBeNull();
    expect(await balance(w, c.float)).toBe(before);
    // The defense: check commitmentIdOf(terms) and the file's digest against the quote and fundingFiles before asking.
    const after = (await s.get('/v1/status')).body;
    expect(after.lastDeal?.commitmentId, 'the signer signed the swapped-in deal').not.toBe(y.id);
    expect(after.signedToday).toBe(status.signedToday);
  }, 90_000);

  it('RT-7: the operators with a trailing slash, which the buyer tools accept, reach the signer (it refuses B3 here, by design)', async () => {
    w.seller.set({ price: { token: 'tUSD', amount: '9000001' } });
    try {
      const r = await ownBuyer([w.seller.quoteUrl, store(), '"rows"', '20000000', '--signer', s.url], { HOLDBACK_OPERATORS: `${demo.urls[0]}/,${demo.urls[1]}/` });
      expect(r.err).toMatch(/the signer refused \(B3\)/);
      expect(r.code, r.err).toBe(3);
    } finally {
      w.seller.set({});
    }
  }, 60_000);

  it('RT-6: an --expect-terms file with a misspelt term is refused, as buy-with-signer.ts refuses it', async () => {
    const role = (k: string) => w.found.demo.adjudicators.find((a: J) => a.role === k).address;
    const own = { deliverable: DELIVERABLE, checks: CHECKS, timing: { ...TIMING }, fee: { token: 'tUSD', amount: '1000000' }, adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') }, maxSubmissions: 1, sellr: '0x000000000000000000000000000000000000dead' };
    const dir = store(), file = join(dir, 'expect.json');
    writeFileSync(file, JSON.stringify(own));
    const before = await balance(w, c.float);
    const r = await ownBuyer([w.seller.quoteUrl, dir, '"rows"', '10000000', '--signer', s.url, '--expect-terms', file, '--stop-after-funding'], env);
    expect(r.err).toMatch(/sellr|not an object of/);
    expect(r.code, r.err).not.toBe(0);
    expect(await balance(w, c.float)).toBe(before);
  }, 60_000);
});
