// T-390 part 2 (T-388's High): an offer whose `createdAt` is far from the operators' clock stops the buyer's one-run
// buy for approval, though every window equals the buyer's own terms. The seller signs the offer itself here, with
// the `createdAt` it chooses; the operators relay it as they relay any signed offer. Nothing is refused (D31): the
// stop shows `createdAt` and every deadline as dates and from now, and a person decides.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { commitmentIdOf, CREATED_AT_BAND, freshNonce, publicOfferTerms, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const PRICE = { token: 'tUSD', amount: '25000000' };
const DELIVERABLE = { kind: 'dataset', description: 'customers.csv', format: 'text/csv' };
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
// The offer stays open an hour, so an offer backdated beyond the band is still live.
const TIMING = { offerExpiresInSec: 3600, fundWithinSec: 7200, deliverWithinSec: 86_400, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
const YEAR = 365 * 86_400;

let demo: TwoOrigins;
let seller: Agent;
let server: Server;
let quoteUrl: string;
let shiftSec = 0; // how far the next offer's createdAt is from settlement time
let lieSec = 0;
let found: J;
const stores: string[] = [];
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 100 });
  // lieSec: how far both operators move the settlementTime their discovery documents report (red team, Medium).
  demo = await serveTwoOrigins(world, {
    tickMs: 100,
    rewrite: (_node, path, body) => {
      if (lieSec === 0 || !path.startsWith('/.well-known/holdback.json')) return undefined;
      const x = JSON.parse(body) as J;
      return JSON.stringify({ ...x, settlementTime: iso(Date.parse(x.settlementTime) + lieSec * 1000) });
    },
  });
  seller = new Agent(demo.urls, generatePrivateKey(), nacl.randomBytes(32));
  await seller.call('POST', '/v1/faucet', { address: seller.address });
  found = await seller.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as J;
    const request = { template: 'checks-only', clubId: found.clubId, seller: seller.address, buyer: { address: body.buyer, encryptionPublicKey: body.buyerEncryptionPublicKey }, adjudicators: adjudicators(), price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING };
    const registration = await seller.registration(request.adjudicators.primary);
    const terms = publicOfferTerms(request, registration, await seller.rulebookHash(found.clubId), iso((await seller.settlementNow()) + shiftSec * 1000), freshNonce().toLowerCase() as Hex);
    const id = commitmentIdOf(terms);
    await seller.call('POST', '/v1/commitments', { ...terms, id, signatures: { seller: await seller.account.signTypedData(typedOf('CommitmentTerms', terms, seller.domain)) } });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commitmentId: id, price: PRICE, fees: null, expiresAt: terms.timing.offerExpiresAt }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  quoteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/quote`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  server.closeAllConnections();
  await demo.close();
  for (const d of stores) rmSync(d, { recursive: true, force: true });
});
const adjudicators = () => {
  const role = (r: string): string => found.adjudicators.find((a: J) => a.role === r).address;
  return { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
};
/** The buyer's own terms, equal to what the seller offers in every window, fee, check and adjudicator. */
async function termsFile(dir: string): Promise<string> {
  const fee = (await seller.registration(adjudicators().primary)).fee.min;
  const path = join(dir, 'my-terms.json');
  writeFileSync(path, JSON.stringify({ deliverable: DELIVERABLE, checks: CHECKS, rubric: { criteria: [], passThreshold: 0 }, timing: TIMING, fee, adjudicators: adjudicators(), maxSubmissions: 1 }));
  return path;
}
/** The one-run buy: --expect-terms makes the file the approval, so an offer that differs in nothing is funded. */
async function buy(shift: number) {
  shiftSec = shift;
  const dir = mkdtempSync(join(tmpdir(), 't390-clock-'));
  stores.push(dir);
  const file = await termsFile(dir);
  const store = join(dir, 'keys');
  return new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, [here('./buy-with-signer.ts'), quoteUrl, store, JSON.stringify('rows'), '99000000', '--expect-terms', file, '--stop-after-funding'], { env: { ...process.env, HOLDBACK_OPERATORS: demo.urls.join(',') } });
    let out = '', err = '';
    child.stdout.on('data', (x: Buffer) => (out += x.toString()));
    child.stderr.on('data', (x: Buffer) => (err += x.toString()));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}
const stateOf = async (id: string) => ((await (await fetch(`${demo.urls[0]}/v1/commitments/${id}`)).json()) as J).escrowState;

describe('an offer whose createdAt is far from the operators\' clock stops the one-run buy for approval (T-390, T-388 H1)', () => {
  it('the band is the one verify.ts holds a prepared offer\'s createdAt to: 600 s behind, 60 s ahead', () => {
    expect(CREATED_AT_BAND).toEqual({ behindSec: 600, aheadSec: 60 });
  });

  it('postdated five years: a createdAt difference, the approval stop (exit status 3), nothing funded, and each deadline shown as a date and from now', async () => {
    const r = await buy(5 * YEAR);
    expect(r.code, r.err).toBe(3);
    const stop = JSON.parse(r.out) as J;
    expect(stop.approval).toBe('needed');
    expect(stop.differences.map((d: J) => d.field)).toContain('createdAt');
    expect(stop.timeline.createdAt.fromNow).toMatch(/^in 5 years/);
    expect(stop.timeline.deliverBy.fromNow).toMatch(/^in 5 years 1 day/);
    for (const k of ['createdAt', 'offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy']) expect(stop.timeline[k].at).toBe(k === 'createdAt' ? stop.createdAt : stop.deadlines[k]);
    expect(await stateOf(stop.commitmentId)).not.toBe('Held');
  }, 60_000);

  it('backdated beyond the band: the same stop, nothing funded', async () => {
    const r = await buy(-(CREATED_AT_BAND.behindSec + 120));
    expect(r.code, r.err).toBe(3);
    const stop = JSON.parse(r.out) as J;
    expect(stop.differences.map((d: J) => d.field)).toContain('createdAt');
    expect(stop.timeline.createdAt.fromNow).toMatch(/ago$/);
    expect(await stateOf(stop.commitmentId)).not.toBe('Held');
  }, 60_000);

  it('both operators report a clock five years ahead and the seller postdates by as much: this machine\'s clock stops the buy', async () => {
    lieSec = 5 * YEAR;
    try {
      const r = await buy(0); // createdAt is the lying operators' "now"
      expect(r.code, r.err).toBe(3);
      const stop = JSON.parse(r.out) as J;
      expect(stop.differences.map((d: J) => d.field)).toContain('createdAt');
      expect(stop.timeline.deliverBy.fromNow).toMatch(/^in 5 years/);
      expect(await stateOf(stop.commitmentId)).not.toBe('Held');
    } finally {
      lieSec = 0;
    }
  }, 60_000);

  it('inside the band: no difference, and the one-run buy funds as before', async () => {
    const r = await buy(-10);
    expect(r.code, r.err).toBe(0);
    const funded = JSON.parse(r.err.trimEnd().split('\n').at(-1)!) as J;
    expect(await stateOf(funded.funded)).toBe('Held');
  }, 60_000);
});
