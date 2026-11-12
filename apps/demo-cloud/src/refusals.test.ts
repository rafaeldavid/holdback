// T-372: what the demo world's state read says about an adjudicator that cannot act on a deal yet. A refusal that is
// not on the terms (the store did not return the delivery's ciphertext, or did not answer in time) was dropped, so a
// deal that was not being judged showed no reason. And a decline the primary later reversed stayed on the state read.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '@holdback/core/crypto';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { MemoryStorage, PublicWorld } from './index.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const closers: Array<() => Promise<void>> = [];
afterEach(async () => void (await Promise.all(closers.splice(0).map((c) => c()))));

/** World storage whose reads of the keys in `failing` throw, with a keyed URL in the message, as a broken store might. */
class FailingStorage extends MemoryStorage {
  readonly failing = new Set<string>();
  override async get<T = unknown>(key: string): Promise<T | undefined> {
    if (this.failing.has(key)) throw new Error('storage read failed: https://store.example/v1/SECRETKEY');
    return super.get<T>(key);
  }
}

/** A world served as two nodes; no pass runs until the test calls `world.work()`. */
async function serve(storage: MemoryStorage) {
  const logged: string[] = [];
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, onError: (e) => void logged.push(e.message) });
  const { urls, close } = await serveTwoOrigins(world, { keepContentLength: true });
  closers.push(close);
  return { world, urls, logged };
}

const agent = (urls: string[]) => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));

async function offerFrom(urls: string[], seller: Agent, buyer: Agent, checks: J[]) {
  const d = (await (await fetch(`${urls[0]}/.well-known/holdback.json`)).json()) as J;
  const [primary, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address);
  return seller.offer({
    template: 'checks-only',
    clubId: d.demo.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
    checks,
    timing: { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 2, appealDecideSec: 2 },
  });
}

const notices = async (a: Agent, id: string): Promise<string> => ((await a.call('GET', `/v1/commitments/${id}`)).notices ?? []).join(' ');
const COLUMNS = { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] };

describe("the demo world's state read and refusals (T-372)", () => {
  it('says why a delivered deal is not judged when the store does not return its ciphertext, names no store error, logs it once, and clears it once judged', async () => {
    const storage = new FailingStorage();
    const { world, urls, logged } = await serve(storage);
    const [seller, buyer] = [agent(urls), agent(urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const offer = await offerFrom(urls, seller, buyer, [COLUMNS]);
    await world.work();
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    await buyer.agreeAndFund(offer.terms, 40_000_000n);
    const { delivery } = await seller.deliverAndShare(offer.terms, new TextEncoder().encode('customer_id,email\n1,a@example.com\n'));
    storage.failing.add(`ct:${delivery.ciphertext.sha256}`);
    await world.work();
    await world.work();
    const said = await notices(buyer, offer.id);
    expect(said).toMatch(/primary adjudicator cannot judge this deal yet/i);
    expect(said).toContain(delivery.ciphertext.sha256);
    expect(said).not.toContain('SECRETKEY');
    const lines = logged.filter((l) => l.includes(offer.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(delivery.ciphertext.sha256);
    expect(lines.join(' ')).not.toContain('SECRETKEY');
    storage.failing.clear();
    await world.work();
    expect((await buyer.waitFor(offer.id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    expect(await notices(buyer, offer.id)).not.toMatch(/cannot judge/i);
  });

  it('clears a decline the primary reverses: a reference uploaded after the offer, then the offer is accepted and reads accepted, not declined', async () => {
    const { world, urls } = await serve(new MemoryStorage());
    const [seller, buyer] = [agent(urls), agent(urls)];
    for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
    const reference = new TextEncoder().encode('customer_id,email\n1,a@example.com\n');
    const id = sha256(reference);
    const check = { id: 'ref', type: 'reference_row_match_min', required: true, reference: { uri: `${urls[0]}/v1/ciphertext/${id}`, sha256: id }, keyColumn: 'customer_id', minBps: 9500 };
    const offer = await offerFrom(urls, seller, buyer, [COLUMNS, check]);
    await world.work();
    expect(await notices(buyer, offer.id)).toMatch(/primary adjudicator declined this offer/);
    await seller.call('POST', '/v1/ciphertext', reference);
    await world.work();
    expect((await buyer.waitFor(offer.id, ['AcceptedByAdjudicator'])).escrowState).toBe('AcceptedByAdjudicator');
    expect(await notices(buyer, offer.id)).not.toMatch(/declined/);
  });
});
