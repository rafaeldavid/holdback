// T-325: the buyer signer follows a funded deal to its outcome, on SimChain through startSimWorld. It reports the
// release, the refund and a missed delivery deadline to the buyer's agent, sends the reclaim itself after deliverBy,
// goes on with one operator offline, and sends one reclaim in all across restarts.
//
// The sim world sends no timeout of its own, and its clock moves only with the wall clock or world.advance, so every
// reclaim here is the signer's. A wrapper around fetch counts the reclaim requests and can lose one answer.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

let deals = 0;
/**
 * A deal this signer funded. The buyer is one of the world's funded accounts, written into a key store the way
 * makeKeys writes one, so it holds a mandate in the sim club. The seller delivers `work`, or nothing when it is null.
 */
async function funded(w: SimWorld, work: string | null): Promise<{ signer: BuyerSigner; store: string; id: Hex; terms: J; seller: Agent }> {
  const account = async () => (await (await realFetch(`${w.url}/accounts`, { method: 'POST' })).json()) as J;
  const s = await account();
  const seller = new Agent([...w.info.operators], s.privateKey, Buffer.from(s.encryptionSecretKey, 'base64url'));
  const b = await account();
  const store = mkdtempSync(join(tmpdir(), 'buyer-signer-outcome-'));
  stores.push(store);
  const address = String(b.address).toLowerCase();
  writeFileSync(join(store, `${address}.json`), JSON.stringify({ version: 1, address, privateKey: b.privateKey, encryptionSecretKey: b.encryptionSecretKey, createdAt: new Date().toISOString() }), { mode: 0o600 });
  const signer = await loadKeys(store, address, { operators: [...w.info.operators] });
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

  it('with one of the two operators offline, a restarted signer still reclaims through the other', async () => {
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
      const outcome = await restarted!.watch(d.id, { onReport: (r) => void reports.push(r), pollMs: POLL_MS });
      expect(outcome).toMatchObject({ outcome: 'Refunded', reclaimed: true });
      expect(kinds(reports)).toEqual(['deliverBy-passed', 'refunded']);
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
