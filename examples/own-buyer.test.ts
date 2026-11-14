// Crow's buying agent (T-440) against the public demo's own world on SimChain: the agent runs as its own process
// (node examples/own-buyer.ts) and pays from the float only through the signer (its own process too); the float gets
// nothing from the faucet. A10: a deal funded from a fresh key with faucet money funds, as on this network anyone's
// can; it is not paid from Crow's float and the signer's ledger does not hold it.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeKeys } from './buyer-signer.ts';
import { cast, cleanup, mandateFor, startSigner, type Cast, type Running } from './signer-test-kit.ts';
import { balance, rulesForWorld, serveSeller, storeIn, topUp, type World } from './signer-world-kit.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const dirs: string[] = [];
const store = storeIn(dirs);

/** Runs the buying agent as its own process, as Crow's agents' machine would. */
function ownBuyer(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [here('./own-buyer.ts'), ...args], { env: { PATH: process.env['PATH'] ?? '', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('exit', (code) => ok({ code, out, err }));
  });
}

let demo: TwoOrigins, w: World, c: Cast, s: Running;
beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' }, faucetPerClient: 1000 });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  const found = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
  w = { urls: demo.urls, found, token: 'tUSD', seller: await serveSeller(demo.urls, found, 'tUSD') };
  c = cast();
  s = await startSigner(c, await rulesForWorld(w, c, store), await mandateFor(c));
  dirs.push(s.dir);
  expect((await topUp(w, c.float, '20000000')).status).toBe(200);
});
afterAll(async () => {
  await s?.kill();
  await w?.seller.close();
  await demo?.close();
  cleanup(dirs);
});

describe('the buying agent pays only through the signer', () => {
  it('buys one deal: the float pays the total and nothing more, it gets nothing from the faucet, and the deal releases to the listed payout address', async () => {
    const before = await balance(w, c.float);
    const dir = store();
    const r = await ownBuyer([w.seller.quoteUrl, dir, '"rows"', '10000000', '--signer', s.url], { HOLDBACK_OPERATORS: demo.urls.join(',') });
    expect(r.code, r.err).toBe(0);
    const bought = JSON.parse(r.out.trim().split('\n').at(-1)!);
    expect(bought).toMatchObject({ paid: '10000000', from: c.float, outcome: 'Released' });
    expect(await balance(w, c.float)).toBe(before - 10_000_000n);
    expect(await balance(w, w.seller.payout)).toBe(9_000_000n);
    expect((await s.get('/v1/status')).body).toMatchObject({ lastDeal: { commitmentId: bought.commitmentId } });
  }, 60_000);

  it('stops with nothing paid when the signer refuses: above the most a deal, and after the stop', async () => {
    const before = await balance(w, c.float);
    w.seller.set({ price: { token: 'tUSD', amount: '9000001' } });
    try {
      const r = await ownBuyer([w.seller.quoteUrl, store(), '"rows"', '20000000', '--signer', s.url], { HOLDBACK_OPERATORS: demo.urls.join(',') });
      expect(r.code).toBe(3);
      expect(r.err).toMatch(/the signer refused \(B3\)/);
    } finally {
      w.seller.set({});
    }
    writeFileSync(s.flagPath, 'stop\n');
    const stopped = await ownBuyer([w.seller.quoteUrl, store(), '"rows"', '20000000', '--signer', s.url], { HOLDBACK_OPERATORS: demo.urls.join(',') });
    expect(stopped.code).toBe(3);
    expect(stopped.err).toMatch(/the signer's state is "stopped", not running: nothing is asked or paid/);
    writeFileSync(s.flagPath, 'run\n');
    expect(await balance(w, c.float)).toBe(before);
  }, 60_000);

  it('A10: a deal funded from a fresh key with faucet money funds; it is not paid from Crow\'s float, and the signer\'s ledger does not hold it', async () => {
    const before = await balance(w, c.float), status = (await s.get('/v1/status')).body;
    const dir = store();
    const stranger = await makeKeys(dir, { operators: demo.urls, log: () => {} }); // no payment address: the key pays itself
    const q = await stranger.quote(w.seller.quoteUrl, 'rows');
    const offer = await stranger.readOffer(q.commitmentId);
    await stranger.checkOffer(q.commitmentId, offer);
    await stranger.testFunds(offer.fees.total.amount);
    const paid = await stranger.agreeAndFund(q.commitmentId);
    expect(paid.total.amount).toBe('10000000');
    const terms = (await (await fetch(`${demo.urls[1]}/v1/commitments/${q.commitmentId}/terms`)).json()) as J;
    expect(terms.buyerPaymentAddress).toBe(stranger.address);
    expect(terms.buyerPaymentAddress).not.toBe(c.float);
    expect(await balance(w, c.float)).toBe(before);
    const after = (await s.get('/v1/status')).body;
    expect(after.signedToday).toBe(status.signedToday);
    expect(after.dealsToday).toBe(status.dealsToday);
    expect(readFileSync(join(s.statePath, 'ledger.json'), 'utf8')).not.toContain(q.commitmentId);
  }, 60_000);
});
