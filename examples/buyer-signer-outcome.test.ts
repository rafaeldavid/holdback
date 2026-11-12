// T-325: the buyer signer follows a funded deal to its outcome, on SimChain through startSimWorld. It reports the
// release, the refund and a missed delivery deadline to the buyer's agent, sends the reclaim itself after deliverBy,
// goes on with one operator offline, and sends one reclaim in all across restarts.
//
// The sim world sends no timeout of its own, and its clock moves only with the wall clock or world.advance, so every
// reclaim here is the signer's. A wrapper around fetch counts the reclaim requests and can lose one answer.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import type { Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadKeys, openDeals, type BuyerSigner, type Report } from './buyer-signer.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PRICE = { token: 'tUSD', amount: '25000000' };
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
const GOOD = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';
const BAD = 'name\nada\n';
const DELIVER_WITHIN_SEC = 120;
/** Each sim account starts with 10,000 tUSD; the adjudication fee is 1 tUSD; this world charges no operator fee. */
const START = '10000000000';
const FEE = 1_000_000n;
/** How often the signer reads the deal in these tests, at most, in ms. */
const POLL_MS = 300;

let world: SimWorld;
const stores: string[] = [];
const realFetch = globalThis.fetch;
/** Every reclaim request the signer sent, with its Idempotency-Key. */
const reclaims: Array<{ url: string; idempotencyKey: string | null }> = [];
/** When set, the next reclaim request reaches the operator and its answer is lost on the way back. */
let loseNextAnswer = false;

beforeAll(async () => {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const reclaim = init?.method === 'POST' && url.endsWith('/triggers/reclaim');
    if (reclaim) reclaims.push({ url, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    const res = await realFetch(input, init);
    if (reclaim && loseNextAnswer) {
      loseNextAnswer = false;
      throw new TypeError('fetch failed: the answer was lost');
    }
    return res;
  };
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await world.close();
  for (const dir of stores) rmSync(dir, { recursive: true, force: true });
});

/** How a proxy in front of one operator misbehaves (T-325 review). */
type Misbehaviour = { silent?: boolean; lieState?: string; clockAheadSec?: number; swallowReclaim?: boolean };
/**
 * An operator as the signer sees it: a proxy in front of a real node that can drop every connection (silent), report
 * another state for the deal (lieState), run its settlement clock ahead (clockAheadSec), or answer a reclaim 200 and
 * relay nothing (swallowReclaim).
 */
async function proxy(target: string): Promise<{ url: string; misbehave: Misbehaviour; close(): Promise<void> }> {
  const misbehave: Misbehaviour = {};
  const server = createServer(async (req, res) => {
    if (misbehave.silent) return void req.socket.destroy();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = req.url ?? '/';
    if (misbehave.swallowReclaim && req.method === 'POST' && path.endsWith('/triggers/reclaim')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"escrowState":"Held"}');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'content-length', 'connection'].includes(k)) headers[k] = v;
    const up = await realFetch(`${target}${path}`, { method: req.method!, headers, ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
    let text = Buffer.from(await up.arrayBuffer()).toString();
    if (up.ok && misbehave.lieState && req.method === 'GET' && /^\/v1\/commitments\/0x[0-9a-f]{64}$/.test(path)) text = JSON.stringify({ ...JSON.parse(text), escrowState: misbehave.lieState });
    if (up.ok && misbehave.clockAheadSec && path === '/.well-known/holdback.json') {
      const d = JSON.parse(text);
      text = JSON.stringify({ ...d, settlementTime: new Date(Date.parse(d.settlementTime) + misbehave.clockAheadSec * 1000).toISOString().replace('.000Z', 'Z') });
    }
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' }).end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    misbehave,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

let deals = 0;
/**
 * A deal this signer funded. The buyer is one of the world's funded accounts, written into a key store the way
 * makeKeys writes one, so it holds a mandate in the sim club. The seller delivers `work`, or nothing when it is null.
 * The signer talks to `operators` (the world's own by default); the seller always to the world's.
 */
async function funded(w: SimWorld, work: string | null, operators: string[] = [...w.info.operators]): Promise<{ signer: BuyerSigner; store: string; id: Hex; terms: J; seller: Agent }> {
  const account = async () => (await (await realFetch(`${w.url}/accounts`, { method: 'POST' })).json()) as J;
  const s = await account();
  const seller = new Agent([...w.info.operators], s.privateKey, Buffer.from(s.encryptionSecretKey, 'base64url'));
  const b = await account();
  const store = mkdtempSync(join(tmpdir(), 'buyer-signer-outcome-'));
  stores.push(store);
  const address = String(b.address).toLowerCase();
  writeFileSync(join(store, `${address}.json`), JSON.stringify({ version: 1, address, privateKey: b.privateKey, encryptionSecretKey: b.encryptionSecretKey, createdAt: new Date().toISOString() }), { mode: 0o600 });
  const signer = await loadKeys(store, address, { operators });
  const a = w.info.adjudicators;
  const offer = await seller.offer({
    template: 'checks-only', clubId: w.info.clubId, seller: seller.address,
    buyer: { address: signer.address, encryptionPublicKey: signer.encryptionPublicKey },
    adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address },
    price: PRICE, deliverable: { kind: 'dataset', description: `customers, deal ${++deals}`, format: 'text/csv' }, checks: CHECKS,
    timing: { offerExpiresInSec: 60, fundWithinSec: 90, deliverWithinSec: DELIVER_WITHIN_SEC },
  });
  await signer.checkOffer(offer.id, await signer.readOffer(offer.id));
  await signer.agreeAndFund(offer.id);
  if (work !== null) await seller.deliver(offer.terms, new TextEncoder().encode(work));
  return { signer, store, id: offer.id, terms: offer.terms, seller };
}

const stateOn = async (api: string, id: string) => ((await (await realFetch(`${api}/v1/commitments/${id}`)).json()) as { escrowState: string }).escrowState;
const balanceOn = async (api: string, address: string) => ((await (await realFetch(`${api}/v1/balances/${address}`)).json()) as { amount: string }).amount;
const reclaimEvents = async (api: string, id: string) => ((await (await realFetch(`${api}/v1/commitments/${id}/events?limit=200`)).json()) as { items: Array<{ type: string }> }).items.filter((e) => e.type === 'settlement.reclaimed').length;
const kinds = (reports: Report[]) => reports.map((r) => r.kind);

describe('buyer-signer.ts follows a funded deal to its outcome (T-325)', () => {
  it('after a missed delivery deadline it reports the deadline, sends the reclaim once, and reports the refund', async () => {
    const d = await funded(world, null);
    const sent = reclaims.length;
    const reports: Report[] = [];
    const watching = d.signer.watch(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS });
    // The signer is watching a Held deal before its deadline; then the seller's delivery window runs out.
    await new Promise((r) => setTimeout(r, 2 * POLL_MS));
    expect(reports).toEqual([]);
    world.advance(DELIVER_WITHIN_SEC + 1);
    const outcome = await watching;

    expect(outcome).toMatchObject({ commitmentId: d.id, outcome: 'Refunded', reclaimed: true });
    expect(kinds(reports)).toEqual(['deliverBy-passed', 'refunded']);
    expect(reports[0]).toMatchObject({ kind: 'deliverBy-passed', commitmentId: d.id, deliverBy: d.terms.timing.deliverBy });
    expect(reports[1]).toMatchObject({ kind: 'refunded', commitmentId: d.id, reclaimed: true });
    const mine = reclaims.slice(sent);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    for (const api of world.info.operators) {
      expect(await stateOn(api, d.id)).toBe('Refunded');
      expect(await reclaimEvents(api, d.id)).toBe(1);
    }
    // The hold came back: the price and the adjudication fee.
    expect(await balanceOn(world.info.operators[1]!, d.signer.address)).toBe(START);
    // The outcome is in the key file: the deal is no longer open, and a second watch sends nothing and reports nothing new.
    expect(await openDeals(d.store, { operators: [...world.info.operators] })).toEqual([]);
    const again: Report[] = [];
    expect(await d.signer.watch(d.id, { onReport: (r) => void again.push(r) })).toEqual(outcome);
    expect(again).toEqual([]);
    expect(reclaims.length).toBe(sent + 1);
  }, 60_000);

  it('with one of the two operators offline, a restarted signer still reclaims through the other, and settles the outcome only at the quorum the buyer sets', async () => {
    const own = await startSimWorld({ env: {}, onError: () => {} });
    try {
      const d = await funded(own, null);
      await own.operators[0]!.close(); // the first operator, the one an agent relays through by default
      own.advance(DELIVER_WITHIN_SEC + 1);
      const sent = reclaims.length;
      const reports: Report[] = [];
      // A new process: only the key store and the commitment ID, and one operator answering.
      const [restarted] = await openDeals(d.store, { operators: [...own.info.operators] });
      expect(restarted!.address).toBe(d.signer.address);
      // By default every configured operator must report the outcome: one answer is reported as unconfirmed.
      const waited = await restarted!.watch(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS, timeoutMs: 3_000 }).then(() => null, (e: Error) => e.message);
      expect(waited).toMatch(/still Refunded/);
      expect(kinds(reports)).toEqual(['deliverBy-passed', 'unconfirmed']);
      expect(reports[1]).toEqual({ kind: 'unconfirmed', commitmentId: d.id, state: 'Refunded', agreeing: 1, answered: 1, required: 2 });
      expect(await openDeals(d.store, { operators: [...own.info.operators] })).toHaveLength(1);
      // A buyer whose second operator is gone for good lowers the quorum to one.
      const outcome = await restarted!.watch(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS, confirmations: 1 });
      expect(outcome).toMatchObject({ outcome: 'Refunded', reclaimed: true });
      expect(kinds(reports)).toEqual(['deliverBy-passed', 'unconfirmed', 'refunded']);
      const mine = reclaims.slice(sent);
      expect(mine.map((r) => new URL(r.url).origin)).toEqual([new URL(own.info.operators[1]!).origin]);
      expect(await stateOn(own.info.operators[1]!, d.id)).toBe('Refunded');
      expect(await balanceOn(own.info.operators[1]!, d.signer.address)).toBe(START);
    } finally {
      await own.close(); // closing the first operator again is a no-op
    }
  }, 60_000);

  it('a restart before the reclaim, and after a reclaim whose answer was lost, sends one reclaim in all', async () => {
    const d = await funded(world, null);
    world.advance(DELIVER_WITHIN_SEC + 1);
    const sent = reclaims.length;
    const operators = { operators: [...world.info.operators] };

    // Run 1 stops as it reports the missed deadline, before it sends anything.
    const first = await d.signer.watch(d.id, { pollMs: POLL_MS, onReport: () => { throw new Error('stopped'); } }).then(() => null, (e: Error) => e.message);
    expect(first).toBe('stopped');
    expect(reclaims.length).toBe(sent);
    expect((await openDeals(d.store, operators)).map((s) => s.address)).toEqual([d.signer.address]);

    // Run 2 sends the reclaim; its answer is lost. It reads the state again, finds the deal refunded, and stops as it reports that.
    const run2: Report[] = [];
    loseNextAnswer = true;
    const second = await (await loadKeys(d.store, d.id, operators)).watch(d.id, { pollMs: POLL_MS, onReport: (r) => {
      run2.push(r);
      if (r.kind === 'refunded') throw new Error('stopped');
    } }).then(() => null, (e: Error) => e.message);
    expect(second).toBe('stopped');
    expect(kinds(run2)).toEqual(['deliverBy-passed', 'refunded']);
    expect(reclaims.length).toBe(sent + 1);

    // Run 3 finds the outcome; the refund was not acknowledged, so it reports that once more, and sends nothing.
    const run3: Report[] = [];
    const third = await (await loadKeys(d.store, d.id, operators)).watch(d.id, { pollMs: POLL_MS, onReport: (r) => void run3.push(r) });
    expect(third).toMatchObject({ outcome: 'Refunded', reclaimed: true });
    expect(kinds(run3)).toEqual(['refunded']);
    expect(reclaims.length).toBe(sent + 1);
    for (const api of world.info.operators) expect(await reclaimEvents(api, d.id)).toBe(1);
    expect(await openDeals(d.store, operators)).toEqual([]);
  }, 60_000);

  it('reports a release, sends no reclaim, and openDelivery then opens the work without a second report', async () => {
    const d = await funded(world, GOOD);
    const sent = reclaims.length;
    const reports: Report[] = [];
    const outcome = await d.signer.watch(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS });
    expect(outcome).toMatchObject({ outcome: 'Released', reclaimed: false });
    expect(reports).toEqual([{ kind: 'released', commitmentId: d.id, finalAt: outcome.finalAt }]);
    const later: Report[] = [];
    const done = await d.signer.openDelivery(d.id, { onReport: (r) => void later.push(r) });
    expect(done.outcome).toBe('Released');
    expect(done.work).toBe(GOOD);
    expect(later).toEqual([]);
    expect(reclaims.length).toBe(sent);
  }, 60_000);

  it('reports a refund the adjudicator decided, and sends no reclaim', async () => {
    const d = await funded(world, BAD);
    const sent = reclaims.length;
    const reports: Report[] = [];
    const done = await d.signer.openDelivery(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS });
    expect(done).toMatchObject({ outcome: 'Refunded', work: null });
    expect(kinds(reports)).toEqual(['refunded']);
    expect(reports[0]).toMatchObject({ commitmentId: d.id, reclaimed: false });
    expect(reclaims.length).toBe(sent);
    // A refund after judgment returns the price; the adjudicator keeps its fee.
    expect(await balanceOn(world.info.operators[0]!, d.signer.address)).toBe((BigInt(START) - FEE).toString());
  }, 60_000);
});

describe('buyer-signer.ts against operators that lie, stall or swallow the reclaim (T-325 review)', () => {
  const two = async () => [await proxy(world.info.operators[0]!), await proxy(world.info.operators[1]!)] as const;

  it('one operator silent and the other reporting a false refund: the deal stays open and the reclaim armed (finding 1)', async () => {
    const [a, b] = await two();
    try {
      const d = await funded(world, null, [a.url, b.url]);
      b.misbehave.silent = true;
      a.misbehave.lieState = 'Refunded';
      const first: Report[] = [];
      const waited = await d.signer.watch(d.id, { onReport: (r) => void first.push(r), pollMs: POLL_MS, timeoutMs: 2_000 }).then(() => null, (e: Error) => e.message);
      expect(waited).toMatch(/still Refunded/);
      expect(first).toEqual([{ kind: 'unconfirmed', commitmentId: d.id, state: 'Refunded', agreeing: 1, answered: 1, required: 2 }]);
      expect(await stateOn(world.info.operators[0]!, d.id)).toBe('Held'); // the truth
      expect(await openDeals(d.store, { operators: [a.url, b.url] })).toHaveLength(1);

      // The honest operator returns and the deadline passes: the signer reclaims through the operator that reports Held.
      b.misbehave.silent = false;
      world.advance(DELIVER_WITHIN_SEC + 1);
      const sent = reclaims.length;
      const second: Report[] = [];
      const outcome = await d.signer.watch(d.id, { onReport: (r) => void second.push(r), pollMs: POLL_MS });
      expect(outcome).toMatchObject({ outcome: 'Refunded', reclaimed: true });
      expect(kinds(second)).toEqual(['unconfirmed', 'deliverBy-passed', 'refunded']);
      expect(second[0]).toMatchObject({ agreeing: 1, answered: 2, required: 2 });
      expect(reclaims.slice(sent).map((r) => new URL(r.url).origin)).toEqual([new URL(b.url).origin]);
      for (const api of world.info.operators) expect(await reclaimEvents(api, d.id)).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  }, 60_000);

  it('an operator that answers the reclaim 2xx and relays nothing: the next operator gets it (finding 2)', async () => {
    const [a, b] = await two();
    try {
      const d = await funded(world, null, [a.url, b.url]);
      a.misbehave.swallowReclaim = true;
      world.advance(DELIVER_WITHIN_SEC + 1);
      const sent = reclaims.length;
      const outcome = await d.signer.watch(d.id, { pollMs: POLL_MS, reclaimRetryMs: 500 });
      expect(outcome).toMatchObject({ outcome: 'Refunded', reclaimed: true });
      expect(reclaims.slice(sent).map((r) => new URL(r.url).origin)).toEqual([new URL(a.url).origin, new URL(b.url).origin]);
      for (const api of world.info.operators) expect(await reclaimEvents(api, d.id)).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  }, 60_000);

  it('a restart after a reclaim was answered and nothing came of it tries the next operator; the watch state has its own file (findings 2 and 6)', async () => {
    const [a, b] = await two();
    try {
      const d = await funded(world, null, [a.url, b.url]);
      const keyFile = join(d.store, `${d.signer.address}.json`);
      const keyBefore = readFileSync(keyFile, 'utf8');
      a.misbehave.swallowReclaim = true;
      world.advance(DELIVER_WITHIN_SEC + 1);
      const sent = reclaims.length;
      // Run 1: the first operator takes the reclaim and relays nothing; the run stops with the deal still Held.
      const waited = await d.signer.watch(d.id, { pollMs: POLL_MS, timeoutMs: 1_500 }).then(() => null, (e: Error) => e.message);
      expect(waited).toMatch(/still Held/);
      expect(reclaims.slice(sent).map((r) => new URL(r.url).origin)).toEqual([new URL(a.url).origin]);
      expect(readFileSync(keyFile, 'utf8')).toBe(keyBefore); // the key file is untouched
      expect(readdirSync(d.store).sort()).toEqual([`${d.signer.address}.json`, `${d.signer.address}.watch.json`]);
      const watched = JSON.parse(readFileSync(join(d.store, `${d.signer.address}.watch.json`), 'utf8')) as J;
      expect(watched.reclaim.answeredBy).toBe(a.url);
      expect(JSON.stringify(watched)).not.toContain(JSON.parse(keyBefore).privateKey.slice(2));

      // Run 2, a new process: the deal is still Held after the answer, so the next operator gets the reclaim.
      const outcome = await (await loadKeys(d.store, d.id, { operators: [a.url, b.url] })).watch(d.id, { pollMs: POLL_MS, reclaimRetryMs: 0 });
      expect(outcome).toMatchObject({ outcome: 'Refunded', reclaimed: true });
      expect(reclaims.slice(sent).map((r) => new URL(r.url).origin)).toEqual([new URL(a.url).origin, new URL(b.url).origin]);
      for (const api of world.info.operators) expect(await reclaimEvents(api, d.id)).toBe(1);
      expect(readFileSync(keyFile, 'utf8')).toBe(keyBefore);
    } finally {
      await a.close();
      await b.close();
    }
  }, 60_000);

  it('one operator with a fast clock does not report the missed deadline early (finding 3)', async () => {
    const [a, b] = await two();
    try {
      const d = await funded(world, null, [a.url, b.url]);
      a.misbehave.clockAheadSec = 3600;
      const reports: Report[] = [];
      const watching = d.signer.watch(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS });
      await new Promise((r) => setTimeout(r, 4 * POLL_MS));
      expect(reports).toEqual([]);
      expect(await stateOn(world.info.operators[0]!, d.id)).toBe('Held');
      world.advance(DELIVER_WITHIN_SEC + 1);
      const outcome = await watching;
      expect(outcome).toMatchObject({ outcome: 'Refunded', reclaimed: true });
      expect(kinds(reports)).toEqual(['deliverBy-passed', 'refunded']);
      // The report names the slower clock, not the fast one.
      const at = Date.parse((reports[0] as Extract<Report, { kind: 'deliverBy-passed' }>).settlementTime);
      expect(at).toBeGreaterThan(Date.parse(d.terms.timing.deliverBy));
      expect(at).toBeLessThan(Date.parse(d.terms.timing.deliverBy) + 600_000);
      for (const api of world.info.operators) expect(await reclaimEvents(api, d.id)).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  }, 60_000);
});
