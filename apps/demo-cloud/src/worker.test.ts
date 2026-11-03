// T-039: the World Durable Object (worker.ts) in Node, behind both Workers. A fake Durable Object state over memory
// storage holds the alarm in a field the test fires, on a fake clock. Cloudflare bills each setAlarm as a row written
// and each alarm as a request, so the alarm is what an idle world must not cost.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { MemoryStorage } from './storage.js';
import worker, { World, type Env } from './worker.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const URLS = ['http://127.0.0.1:8787', 'http://localhost:8788'];
const MINUTE = 60_000;
/** Live-judge variables (no real key; no call is made): the adjudicators bind another registry and refuse older deals. */
const LIVE = { HOLDBACK_ANTHROPIC_API_KEY: 'test', HOLDBACK_OPENAI_COMPATIBLE_API_KEY: 'test', HOLDBACK_OPENAI_COMPATIBLE_BASE_URL: 'https://judges.invalid/v1' };

/** One World behind holdback-op1 (127.0.0.1) and holdback-op2 (localhost); `restart` is an eviction, or a redeploy with `env`. */
function deploy() {
  const alarm = { at: null as number | null, sets: 0, fired: 0 };
  const storage = Object.assign(new MemoryStorage(), {
    getAlarm: async () => alarm.at,
    setAlarm: async (at: number) => void ((alarm.at = at), alarm.sets++),
  });
  const state = { storage, blockConcurrencyWhile: <T>(f: () => Promise<T>) => f() };
  let object: World;
  const WORLD = { idFromName: (name: string) => name, get: () => object };
  const envs: Env[] = ['0', '1'].map((NODE_INDEX) => ({ WORLD, NODE_INDEX, MIN_WINDOW_SEC: '2' }));
  const restart = (env: Record<string, string> = {}) => void (object = new World(state, { ...envs[0]!, ...env }));
  restart();
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => worker.fetch(new Request(input, init), envs[input.startsWith(URLS[1]!) ? 1 : 0]!));
  return {
    alarm,
    restart,
    /** Fires each alarm due by `until`, as the runtime does: cleared, then the handler, with the clock at its time. */
    async fire(until: number) {
      while (alarm.at !== null && alarm.at <= until) {
        vi.setSystemTime(Math.max(alarm.at, Date.now()));
        alarm.at = null;
        alarm.fired++;
        await object.alarm();
      }
    },
  };
}

const agent = () => new Agent(URLS, generatePrivateKey(), nacl.randomBytes(32));

/** Two funded agents and a checks-only offer between them. */
async function offered(timing: Record<string, number> = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 60 }) {
  const d = ((await (await fetch(`${URLS[0]}/`)).json()) as J).demo;
  const [seller, buyer] = [agent(), agent()];
  for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
  const [primary, fallback, appeal] = d.adjudicators.map((a: J) => a.address);
  const offer = await seller.offer({
    template: 'checks-only',
    clubId: d.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
    checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
    timing,
  });
  const state = async () => (await buyer.call('GET', `/v1/commitments/${offer.id}`)).escrowState as string;
  return { seller, buyer, offer, state };
}
const CSV = new TextEncoder().encode('customer_id,email\n1,ada@example.com\n');

beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the adjudicator alarm (T-039)', () => {
  it('reads and faucet grants arm no alarm; a deal arms one per adjudicator step, and none after it', async () => {
    const dep = deploy();
    const { seller, buyer, offer, state } = await offered();
    // Discovery, registrations, the club and two faucet grants came first: none of them armed an alarm.
    expect(dep.alarm.sets).toBe(1);
    expect(dep.alarm.at).toBe(Date.now() + 1000);
    await dep.fire(Date.now() + 15 * MINUTE);
    expect([await state(), dep.alarm.fired, dep.alarm.at]).toEqual(['AcceptedByAdjudicator', 1, null]);

    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    expect(dep.alarm.sets).toBe(1);
    await seller.deliver(offer.terms, CSV);
    await dep.fire(Date.now() + 15 * MINUTE);
    expect([await state(), dep.alarm.fired, dep.alarm.sets, dep.alarm.at]).toEqual(['Released', 2, 2, null]);
  });

  it('a stuck case slows down; a write brings the alarm forward, and the fallback takes over at judgeBy', async () => {
    const dep = deploy();
    const timing = { offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 60 };
    const { seller, buyer, offer, state } = await offered(timing);
    await dep.fire(Date.now() + 2000);
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    await seller.deliver(offer.terms, CSV);
    // Redeployed with live judges before the primary's pass: it refuses the delivery on every pass (registry_mismatch).
    dep.restart(LIVE);
    const start = Date.now();
    await dep.fire(start + 40_000);
    expect(await state()).toBe('Delivered');
    // Passes at 1, 3, 7, 15 and 31 s; the next waits 32 s.
    expect(dep.alarm.at! - Date.now()).toBe(32_000);

    // A new deal is a settlement event: the alarm comes forward to a second, and its primary accepts.
    const fresh = await offered();
    expect(dep.alarm.at).toBe(Date.now() + 1000);
    await dep.fire(Date.now() + 1000);
    expect(await fresh.state()).toBe('AcceptedByAdjudicator');

    // The stuck case's fallback takes over at judgeBy, not at the slow cadence's next pass.
    const { deadlines } = await buyer.call('GET', `/v1/commitments/${offer.id}`);
    await dep.fire(Date.parse(deadlines.judgeBy) + 5000);
    const events = (await buyer.call('GET', `/v1/commitments/${offer.id}/events?limit=200`)).items as J[];
    const takeover = events.find((e) => e.type === 'fallback.triggered');
    expect(Date.parse(takeover.at) - Date.parse(deadlines.judgeBy)).toBeLessThanOrEqual(1000);
  });

  it('a restart mid-deal resumes on the next request, and a restart with nothing due arms nothing', async () => {
    const dep = deploy();
    const { state } = await offered();
    // Evicted with the offer pending and its alarm lost: the next request, a plain read, arms it again.
    dep.alarm.at = null;
    dep.restart();
    expect(await state()).toBe('Offered');
    expect(dep.alarm.at).toBe(Date.now() + 1000);
    await dep.fire(Date.now() + MINUTE);
    expect(await state()).toBe('AcceptedByAdjudicator');

    dep.restart();
    const sets = dep.alarm.sets;
    expect(await state()).toBe('AcceptedByAdjudicator');
    expect([dep.alarm.sets, dep.alarm.at]).toEqual([sets, null]);
  });
});
