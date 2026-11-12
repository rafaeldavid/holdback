// T-057: the World Durable Object (worker.ts) in Node, behind both Workers. A fake Durable Object state over memory
// storage holds the alarm in a field the test fires, on a fake clock. Cloudflare bills each setAlarm as a row written
// and each alarm as a request, so the alarm is what an idle world must not cost.
import { readFileSync } from 'node:fs';
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
  const envs: Env[] = ['0', '1'].map((NODE_INDEX) => ({ WORLD, NODE_INDEX, SETTLEMENT: 'sim', MIN_WINDOW_SEC: '2' }));
  const restart = (env: Record<string, string> = {}) => void (object = new World(state, { ...envs[0]!, ...env }));
  restart();
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => worker.fetch(new Request(input, init), envs[input.startsWith(URLS[1]!) ? 1 : 0]!));
  return {
    alarm,
    storage,
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
async function offered(timing: Record<string, number> = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }) {
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

describe('the adjudicator alarm (T-057)', () => {
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
    // Accepted under the live registry, then redeployed without the live judges' keys before the primary's pass: no
    // provider reaches the registry the deal bound, so it refuses the delivery on every pass (registry_mismatch, ADR-0036).
    dep.restart(LIVE);
    const timing = { offerExpiresInSec: 30, fundWithinSec: 45, deliverWithinSec: 60, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
    const { seller, buyer, offer, state } = await offered(timing);
    await dep.fire(Date.now() + 2000);
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    await seller.deliver(offer.terms, CSV);
    dep.restart();
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

    // The stuck case's fallback takes its turn at judgeBy, not at the slow cadence's next pass. On this build it cannot
    // judge the bound registry either, so it declines the takeover at once instead of triggering one it would refuse
    // (T-221 review). The state read has said so since the restart, before judgeBy (ADR-0036 section 5).
    const { deadlines } = await buyer.call('GET', `/v1/commitments/${offer.id}`);
    const judgeBy = Date.parse(deadlines.judgeBy);
    const said = async () => (((await buyer.call('GET', `/v1/commitments/${offer.id}`)).notices ?? []) as string[]).some((n) => /primary adjudicator .* cannot judge this deal: this build does not carry registry .*fallback adjudicator .* cannot judge it either/.test(n));
    await dep.fire(judgeBy - 1);
    expect(await said()).toBe(true);
    expect(dep.alarm.at).toBe(judgeBy);
    await dep.fire(judgeBy + 1000);
    expect(await said()).toBe(true);
    const events = (await buyer.call('GET', `/v1/commitments/${offer.id}/events?limit=200`)).items as J[];
    expect(events.some((e) => e.type === 'fallback.triggered')).toBe(false);
  });

  it('an overdue alarm (its handler threw) is retried within a second, not moved to a later takeover', async () => {
    const dep = deploy();
    dep.restart(LIVE);
    const { seller, buyer, offer } = await offered();
    await dep.fire(Date.now() + 2000);
    await buyer.agreeAndFund(offer.terms, 30_000_000n);
    await seller.deliver(offer.terms, CSV);
    // Redeployed without the live judges' keys: the live registry the deal bound has no provider here.
    dep.restart();
    // The primary refuses on every pass; 15 minutes on, only the takeover a day away stays scheduled.
    await dep.fire(Date.now() + 20 * MINUTE);
    const { deadlines } = await buyer.call('GET', `/v1/commitments/${offer.id}`);
    expect(dep.alarm.at).toBe(Date.parse(deadlines.judgeBy));
    // A handler that throws leaves its alarm set, overdue, while the runtime backs off; the next request re-arms it.
    dep.alarm.at = Date.now() - 10_000;
    await buyer.call('GET', `/v1/commitments/${offer.id}`);
    expect(dep.alarm.at).toBe(Date.now() + 1000);
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

// T-313: a world whose storage write was rejected stays failed (world.ts, `broken`). The Durable Object drops it, so
// the next request or alarm opens a fresh world from storage, as a restart does.
describe('a failed storage write (T-313)', () => {
  it('fails the request or the alarm that hit it; the next one runs on a fresh world with no restart, and the journal has no gap', async () => {
    const dep = deploy();
    const { state } = await offered();
    const put = dep.storage.put.bind(dep.storage);
    let failures = 0;
    dep.storage.put = async (entries) => {
      if (failures > 0 && Object.keys(entries).some((k) => k.startsWith('j:'))) {
        failures--;
        throw new Error('storage put failed (test)');
      }
      return put(entries);
    };

    // A request whose journal write is rejected fails with the storage error, as before.
    const [unlucky, third] = [agent(), agent()];
    const grant = (a: Agent) => fetch(`${URLS[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `grant-${a.address}` }, body: JSON.stringify({ address: a.address }) });
    failures = 1;
    await expect(grant(unlucky)).rejects.toThrow('storage put failed (test)');
    // The next request, with no restart: a fresh world serves it and writes it. The pending offer is still there, and
    // the grant no one was answered for is not.
    expect((await grant(third)).status).toBe(200);
    expect(await state()).toBe('Offered');
    const granted = (await third.call('GET', `/v1/balances/${third.address}`)).amount as string;
    expect(BigInt(granted)).toBeGreaterThan(0n);
    expect((await third.call('GET', `/v1/balances/${unlucky.address}`)).amount).toBe('0');

    // An alarm whose pass hits a rejected write throws, as before. The runtime keeps a thrown alarm set and retries it:
    // the retry opens a fresh world, and its pass accepts the offer.
    const at = dep.alarm.at!;
    expect(at).not.toBeNull();
    failures = 1;
    await expect(dep.fire(at)).rejects.toThrow('storage put failed (test)');
    dep.alarm.at = at;
    await dep.fire(at);
    expect(await state()).toBe('AcceptedByAdjudicator');

    // The stored journal has every entry in order, and a restart replays it to the same state.
    const keys = [...(await dep.storage.list({ prefix: 'j:' })).keys()];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(keys.map((_, i) => `j:${String(i).padStart(12, '0')}`));
    dep.restart();
    expect(await state()).toBe('AcceptedByAdjudicator');
    expect((await third.call('GET', `/v1/balances/${third.address}`)).amount).toBe(granted);
  });
});

// T-313: SETTLEMENT has no default. A typo or a missing variable used to serve the SimChain world on the production
// hostname; now the Worker answers 500 and forwards nothing.
describe('the SETTLEMENT variable (T-313)', () => {
  /** A Worker environment whose Durable Object binding records each world name asked for and each request forwarded. */
  function binding() {
    const names: string[] = [];
    const forwarded: Request[] = [];
    const WORLD = {
      idFromName: (name: string) => (names.push(name), name),
      get: () => ({ fetch: async (r: Request) => (forwarded.push(r), new Response('from the world')) }),
    };
    return { names, forwarded, env: (SETTLEMENT?: string): Env => ({ WORLD, NODE_INDEX: '0', ...(SETTLEMENT === undefined ? {} : { SETTLEMENT }) }) };
  }
  const refused = async (r: Response) => {
    expect(r.status).toBe(500);
    expect(r.headers.get('content-type')).toBe('application/problem+json');
    const body = (await r.json()) as J;
    expect(body).toMatchObject({ type: 'internal', status: 500 });
    expect(body.detail).toMatch(/SETTLEMENT/);
    expect(body.detail).toMatch(/`sim`/);
    expect(body.detail).toMatch(/`sepolia`/);
    return body;
  };

  it('`sim` and `sepolia` each forward to their own world, and name the settlement to it', async () => {
    // T-383: the Sepolia world's name is the record's rules address, so a new record is a new world.
    const record = JSON.parse(readFileSync(new URL('../../../contracts/deployments/sepolia.json', import.meta.url), 'utf8')) as { rules: string };
    for (const [value, name] of [['sim', 'holdback-public-demo-sim-2026-11-12'], ['sepolia', `holdback-public-demo-sepolia-${record.rules.toLowerCase()}`]] as const) {
      const b = binding();
      const r = await worker.fetch(new Request('https://api.crow.direct/v1/status', { headers: { 'x-holdback-settlement': 'spoofed' } }), b.env(value));
      expect(await r.text()).toBe('from the world');
      expect(b.names).toEqual([name]);
      expect(b.forwarded.map((f) => f.headers.get('x-holdback-settlement'))).toEqual([value]);
    }
  });

  it('a missing or unknown value answers 500, names the variable and its two values, and forwards nothing', async () => {
    for (const value of [undefined, '', 'Sepolia', 'sepolia ', 'sepola', 'simchain', 'testnet', 'mainnet']) {
      const b = binding();
      const body = await refused(await worker.fetch(new Request('https://api.crow.direct/v1/status'), b.env(value)));
      expect(body.detail).toMatch(value === undefined ? /is not set/ : /is neither/);
      expect([b.names, b.forwarded]).toEqual([[], []]);
    }
    // A caller cannot supply the settlement the Worker lacks.
    const b = binding();
    await refused(await worker.fetch(new Request('https://api.crow.direct/v1/status', { headers: { 'x-holdback-settlement': 'sim' } }), b.env()));
    expect([b.names, b.forwarded]).toEqual([[], []]);
  });

  it('the Durable Object refuses a request without a known settlement, and opens no world for it', async () => {
    let reads = 0;
    const storage = Object.assign(new MemoryStorage(), { getAlarm: async () => null, setAlarm: async () => undefined });
    const get = storage.get.bind(storage);
    storage.get = ((key: string) => (reads++, get(key))) as typeof storage.get;
    const state = { storage, blockConcurrencyWhile: <T>(f: () => Promise<T>) => (reads++, f()) };
    const object = new World(state, { WORLD: undefined as never, NODE_INDEX: '0', SETTLEMENT: 'sim' });
    for (const headers of [{}, { 'x-holdback-settlement': '' }, { 'x-holdback-settlement': 'Sepolia' }, { 'x-holdback-settlement': 'simchain' }]) {
      await refused(await object.fetch(new Request('http://127.0.0.1:8787/v1/status', { headers })));
    }
    expect(reads).toBe(0);
    // The same object then serves a request that names its settlement.
    const r = await object.fetch(new Request('http://127.0.0.1:8787/v1/status', { headers: { 'x-holdback-settlement': 'sim' } }));
    expect(r.status).toBe(200);
    expect(reads).toBeGreaterThan(0);
  });
});
