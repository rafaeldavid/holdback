// T-422: the red team's attacks on the operators' limits, kept as regression tests (docs/operator-threat-model.md).
// Each asserts the defence the threat model claims. Written by the red-team pass of 2026-11-14 and adapted after its
// fixes: the replay budget is the write budget, the midnight replay runs through the world, and the shared Cloudflare
// Workers address is a recorded residual, not a test.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { DailyCaps } from './limits.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const closers: Array<() => Promise<void>> = [];
afterEach(async () => void (await Promise.all(closers.splice(0).map((c) => c()))));

async function serveWorld(options: Partial<PublicWorldOptions> = {}, storage = new MemoryStorage()) {
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
  const a = await serveTwoOrigins(world, { tickMs: 100, client: '198.51.100.7' });
  const b = await serveTwoOrigins(world, { client: '203.0.113.9' });
  closers.push(a.close, b.close);
  return { world, urls: a.urls, other: b.urls };
}

const freshAgent = (urls: string[]) => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
const post = (url: string, body: string, key: string, extra: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, ...extra }, body });
const postBytes = (url: string, bytes: Uint8Array, key: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'idempotency-key': key }, body: bytes });

const granted = new Set<string>();
async function acceptedOffer(urls: string[], buyer: Agent) {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const seller = freshAgent(urls);
  for (const a of [buyer, seller]) {
    if (granted.has(a.address)) continue;
    await a.call('POST', '/v1/faucet', { address: a.address });
    granted.add(a.address);
  }
  const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
  const offer = await seller.offer({
    template: 'checks-only',
    clubId: index.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
    checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
    timing: { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 0, appealDecideSec: 2 },
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  return { offer, seller };
}

type Sent = { url: string; key: string; body: string; status: number; answer: J };
/** Records each funded agree an agent sends; the agree the agent sends may be refused, the record keeps its body. */
function captureAgrees(): { sent: Sent[]; restore(): void } {
  const original = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const r = await original(input, init);
    const url = String(input);
    if (init?.method === 'POST' && /\/v1\/commitments\/0x[0-9a-f]+\/agree$/.test(url)) {
      sent.push({ url, key: new Headers(init.headers).get('idempotency-key') ?? '', body: String(init.body), status: r.status, answer: await r.clone().json() });
    }
    return r;
  }) as typeof fetch;
  return { sent, restore: () => void (globalThis.fetch = original) };
}

const stateOf = async (url: string, id: string) => ((await (await fetch(`${url}/v1/commitments/${id}`)).json()) as J).escrowState;

describe('attack.t422: get around the daily cap on funded deals', () => {
  it('attack.t422-double-slash-path: a funded agree sent to //x/v1/commitments/<id>/agree is refused at the cap', async () => {
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      const buyer = freshAgent(urls);
      const first = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(first.offer.terms, 30_000_000n);
      expect(capture.sent.at(-1)!.status).toBe(200);
      const second = await acceptedOffer(urls, buyer);
      await expect(buyer.agreeAndFund(second.offer.terms, 30_000_000n)).rejects.toThrow(/rate_limited/);
      const refused = capture.sent.at(-1)!;
      // The same signed funding, at the same operator, under a path the caps do not parse as /v1/...
      const sneaky = refused.url.replace(urls[0], `${urls[0]}//x`);
      const r = await post(sneaky, refused.body, 'sneaky-1');
      const answer = (await r.json()) as J;
      console.log('double-slash agree:', r.status, answer.type ?? answer.escrowState ?? '', 'state now', await stateOf(urls[0], second.offer.id));
      expect(r.status).toBe(429);
    } finally {
      capture.restore();
    }
  }, 60_000);

  it('attack.t422-uncount-by-bad-replay: a malformed copy of an accepted funding gives its count back', async () => {
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      const buyer = freshAgent(urls);
      const first = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(first.offer.terms, 30_000_000n);
      const accepted = capture.sent.at(-1)!;
      expect(accepted.status).toBe(200);
      // The same key and body, with a query the operator refuses: the caps see a seen fingerprint, the operator a 400.
      const bad = await post(`${accepted.url}?validateOnly=nope`, accepted.body, accepted.key);
      console.log('bad replay:', bad.status, ((await bad.json()) as J).type);
      // A second deal the same day must still be refused at the cap of 1.
      const second = await acceptedOffer(urls, buyer);
      let status = 0;
      try {
        await buyer.agreeAndFund(second.offer.terms, 30_000_000n);
        status = capture.sent.at(-1)!.status;
      } catch {
        status = capture.sent.at(-1)!.status;
      }
      console.log('second funding after the bad replay:', status, 'state', await stateOf(urls[0], second.offer.id));
      expect(status).toBe(429);
    } finally {
      capture.restore();
    }
  }, 60_000);

  it('attack.t422-uncount-by-bom: a byte-order mark before an accepted funding gives its count back', async () => {
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      const buyer = freshAgent(urls);
      const first = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(first.offer.terms, 30_000_000n);
      const accepted = capture.sent.at(-1)!;
      const bad = await post(accepted.url, `﻿${accepted.body}`, accepted.key);
      console.log('BOM replay:', bad.status, ((await bad.json()) as J).type);
      const second = await acceptedOffer(urls, buyer);
      let status = 0;
      try {
        await buyer.agreeAndFund(second.offer.terms, 30_000_000n);
      } catch {
        /* refused */
      }
      status = capture.sent.at(-1)!.status;
      console.log('second funding after the BOM replay:', status);
      expect(status).toBe(429);
    } finally {
      capture.restore();
    }
  }, 60_000);

  it('attack.t422-uncount-loop: ten deals fund through one client at a cap of 1 by un-counting each one', async () => {
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1, faucetPerClient: 100 });
    const capture = captureAgrees();
    let funded = 0;
    try {
      const buyer = freshAgent(urls);
      for (let i = 0; i < 10; i++) {
        const deal = await acceptedOffer(urls, buyer);
        try {
          await buyer.agreeAndFund(deal.offer.terms, 30_000_000n);
        } catch {
          break;
        }
        const ok = capture.sent.at(-1)!;
        if (ok.status !== 200) break;
        funded++;
        await post(`${ok.url}?validateOnly=nope`, ok.body, ok.key);
      }
      console.log('deals funded through one client at a cap of 1 a day:', funded);
      expect(funded).toBe(1);
    } finally {
      capture.restore();
    }
  }, 120_000);
});

describe('attack.t422: get around the daily cap on ciphertext', () => {
  it('attack.t422-double-slash-ciphertext: new bytes to //x/v1/ciphertext are refused at the cap', async () => {
    const { urls } = await serveWorld({ ciphertextBytesPerClientPerDay: 100 });
    expect((await postBytes(`${urls[0]}/v1/ciphertext`, new Uint8Array(80).fill(1), 'ct-1')).status).toBe(200);
    expect((await postBytes(`${urls[0]}/v1/ciphertext`, new Uint8Array(80).fill(2), 'ct-2')).status).toBe(429);
    let stored = 0;
    for (let i = 0; i < 10; i++) if ((await postBytes(`${urls[0]}//x/v1/ciphertext`, new Uint8Array(80).fill(10 + i), `ct-x-${i}`)).status === 200) stored += 80;
    console.log('bytes stored past a 100-byte cap through //x/v1/ciphertext:', stored);
    expect(stored).toBe(0);
  });
});

describe('neutrality.t422: no service limit refuses a replay of an accepted request', () => {
  it('neutrality.t422-replay-after-address-change: the same funding, replayed from another client at its cap, is answered', async () => {
    const { urls, other } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      // Client A (198.51.100.7) funds a deal; the answer is lost.
      const buyer = freshAgent(urls);
      const deal = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(deal.offer.terms, 30_000_000n);
      const accepted = capture.sent.at(-1)!;
      expect(accepted.status).toBe(200);
      // Client B (203.0.113.9) has used its own cap of 1.
      const b = freshAgent(other);
      const theirs = await acceptedOffer(other, b);
      await b.agreeAndFund(theirs.offer.terms, 30_000_000n);
      expect(capture.sent.at(-1)!.status).toBe(200);
      // The buyer's agent now runs from B's address (NAT rebinding, a new IPv6 /64, another Worker colo) and replays.
      const again = await post(accepted.url.replace(urls[0], other[0]), accepted.body, accepted.key);
      const answer = (await again.json()) as J;
      console.log('replay from another client at its cap:', again.status, answer.type ?? 'stored answer');
      expect(again.status).toBe(200);
    } finally {
      capture.restore();
    }
  }, 60_000);

  it('neutrality.t422-replay-after-midnight: a replay of yesterday\'s accepted funding is answered after today\'s cap is used', async () => {
    let now = Date.now();
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1, now: () => now });
    const capture = captureAgrees();
    try {
      const buyer = freshAgent(urls);
      const deal = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(deal.offer.terms, 30_000_000n);
      const yesterday = capture.sent.at(-1)!;
      expect(yesterday.status).toBe(200);
      now += 86_400_000;
      const buyer2 = freshAgent(urls);
      const today = await acceptedOffer(urls, buyer2);
      await buyer2.agreeAndFund(today.offer.terms, 30_000_000n);
      expect(capture.sent.at(-1)!.status).toBe(200);
      const replay = await post(yesterday.url, yesterday.body, yesterday.key);
      expect(replay.status).toBe(200);
    } finally {
      capture.restore();
    }
  }, 60_000);
});

describe('attack.t422: the replay budget floods the one World object', () => {
  it('attack.t422-replay-cpu: replays of one accepted 1 MiB write cost the object far more than the write budget allowed', async () => {
    const { urls, other } = await serveWorld({ rateLimit: { writes: 120, reads: 1200, windowMs: 60_000 } });
    const a = freshAgent(urls);
    // The faucet ignores fields it does not know, so one grant can carry a body of about 1 MiB of small objects.
    const pad = Array.from({ length: 17_000 }, (_, i) => ({ k: 'v'.repeat(40), i }));
    const body = JSON.stringify({ address: a.address, pad });
    console.log('accepted body bytes:', body.length);
    const first = await post(`${urls[0]}/v1/faucet`, body, 'heavy-1');
    expect(first.status).toBe(200);
    const n = 30;
    const t0 = performance.now();
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await post(`${urls[0]}/v1/faucet`, body, 'heavy-1')).status);
    const msPer = (performance.now() - t0) / n;
    // Meanwhile, how long does a stranger's read take while 20 replays are in flight at once?
    const burst = Array.from({ length: 20 }, () => post(`${urls[0]}/v1/faucet`, body, 'heavy-1'));
    const r0 = performance.now();
    await fetch(`${other[0]}/v1/commitments?limit=1`);
    const strangerMs = performance.now() - r0;
    await Promise.all(burst);
    const perMinute = 120; // the replay budget: the write budget, 120 a minute
    console.log(`replays answered: ${statuses.filter((s) => s === 200).length}/${n}; ms per replay: ${msPer.toFixed(0)}; object-seconds per second at ${perMinute} replays a minute: ${((perMinute / 60) * msPer / 1000).toFixed(2)}; a stranger's read during a 20-replay burst: ${strangerMs.toFixed(0)} ms`);
    // The defence the threat model claims: one client cannot fill the object. Allow it half of one object-second a second.
    expect(((perMinute / 60) * msPer) / 1000).toBeLessThan(0.5);
  }, 120_000);
});

describe('attack.t422: variants the caps hold against (expected to pass)', () => {
  it('attack.t422-path-and-query-variants: none of them funds a deal past the cap', async () => {
    const { urls } = await serveWorld({ fundedDealsPerClientPerDay: 1 });
    const capture = captureAgrees();
    try {
      const buyer = freshAgent(urls);
      const first = await acceptedOffer(urls, buyer);
      await buyer.agreeAndFund(first.offer.terms, 30_000_000n);
      const second = await acceptedOffer(urls, buyer);
      await expect(buyer.agreeAndFund(second.offer.terms, 30_000_000n)).rejects.toThrow(/rate_limited/);
      const refused = capture.sent.at(-1)!;
      const body = JSON.parse(refused.body) as J;
      const variants: Array<[string, string, string]> = [
        ['trailing slash', `${refused.url}/`, refused.body],
        ['repeated validateOnly', `${refused.url}?validateOnly=true&validateOnly=false`, refused.body],
        ['validateOnly=TRUE', `${refused.url}?validateOnly=TRUE`, refused.body],
        ['validateOnly=false', `${refused.url}?validateOnly=false`, refused.body],
        ['encoded segment', refused.url.replace(/\/agree$/, '/%61gree'), refused.body],
        ['upper-case segment', refused.url.replace(/\/agree$/, '/AGREE'), refused.body],
        ['fund null', refused.url, JSON.stringify({ ...body, fund: null })],
        ['fund a string', refused.url, JSON.stringify({ ...body, fund: 'x' })],
        ['BOM on a fresh funding', refused.url, `﻿${refused.body}`],
        ['whitespace', refused.url, ` ${refused.body} `],
      ];
      const out: string[] = [];
      for (const [name, url, b] of variants) {
        const r = await post(url, b, `v-${name}`);
        out.push(`${name}: ${r.status} ${((await r.json()) as J).type ?? 'ok'}`);
      }
      console.log(out.join('\n'));
      expect(await stateOf(urls[0], second.offer.id)).not.toBe('Held');
    } finally {
      capture.restore();
    }
  }, 60_000);
});

describe('attack.t422: smaller faults', () => {
  it('attack.t422-ciphertext-recount: bytes the store already holds are counted again while under the cap', async () => {
    const caps = new DailyCaps(new MemoryStorage(), () => Date.parse('2026-11-14T12:00:00Z'), 'secret', { fundedDeals: 1, ciphertextBytes: 200 });
    expect((await caps.takeBytes(0, 'c', 60, async () => false)).ok).toBe(true);
    const again = await caps.takeBytes(0, 'c', 60, async () => true); // the same 60 bytes, already stored
    const third = await caps.takeBytes(0, 'c', 90, async () => false); // 90 new bytes: 150 new in all, under the cap of 200
    console.log('re-upload of stored bytes:', JSON.stringify(again), 'then 90 new bytes:', JSON.stringify(third));
    expect(third.ok).toBe(true);
  });

  it('attack.t422-flood-binding-hangs: a flood binding that never answers stops the Worker', async () => {
    const worker = (await import('./worker.js')).default;
    const WORLD = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
    const FLOOD = { limit: () => new Promise<{ success: boolean }>(() => undefined) };
    const env = { WORLD, NODE_INDEX: '0', SETTLEMENT: 'sim', FLOOD } as never;
    const req = new Request('https://api.crow.direct/v1/status', { headers: { 'cf-connecting-ip': '198.51.100.7' } });
    const r = await Promise.race([worker.fetch(req, env).then((x: Response) => x.status), new Promise((res) => setTimeout(() => res('no answer in 2 s'), 2000))]);
    console.log('with a hanging flood binding:', r);
    expect(r).toBe(200);
  });
});

describe('attack.t422: a known key with another body does the body work before the throttle refuses', () => {
  it('attack.t422-known-key-cpu: a client with no write budget left still costs the object a parse and a hash per request', async () => {
    const { urls } = await serveWorld({ rateLimit: { writes: 2, reads: 1200, windowMs: 60_000 } });
    const a = freshAgent(urls);
    expect((await post(`${urls[0]}/v1/faucet`, JSON.stringify({ address: a.address }), 'known-1')).status).toBe(200);
    expect((await post(`${urls[0]}/v1/faucet`, JSON.stringify({ address: freshAgent(urls).address }), 'known-2')).status).toBe(200);
    // The write budget is spent. Now heavy bodies under the known key, each another request than the key's.
    const pad = Array.from({ length: 17_000 }, (_, i) => ({ k: 'v'.repeat(40), i }));
    const n = 30;
    const statuses: number[] = [];
    // The replay budget (the write budget, 2) admits two known-key requests to the body work; the rest are refused at entry.
    for (let i = 0; i < 2; i++) await post(`${urls[0]}/v1/faucet`, JSON.stringify({ address: a.address, pad, i }), 'known-1');
    const t0 = performance.now();
    for (let i = 0; i < n; i++) statuses.push((await post(`${urls[0]}/v1/faucet`, JSON.stringify({ address: a.address, pad, i }), 'known-1')).status);
    const heavy = (performance.now() - t0) / n;
    const t1 = performance.now();
    for (let i = 0; i < n; i++) await post(`${urls[0]}/v1/faucet`, JSON.stringify({ address: a.address, pad, i }), 'unknown-key');
    const fresh = (performance.now() - t1) / n;
    console.log(`statuses: ${[...new Set(statuses)].join(',')}; ms per known-key request: ${heavy.toFixed(0)}; ms per unknown-key request (refused at entry): ${fresh.toFixed(0)}`);
    expect(heavy).toBeLessThan(fresh * 2);
  }, 120_000);
});
