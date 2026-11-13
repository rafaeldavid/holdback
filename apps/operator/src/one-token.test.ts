// T-378, the contract plan's 2c (Rafa, 2026-11-12): every route that takes terms refuses a token other than the
// deployment's, before it prepares or relays anything, and names the accepted token's identifier, symbol and decimals.
// Discovery states the same token. One test per route, over HTTP against a SimChain node; then the 37 s notice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClub, parseCommitment, rulebookHash, type TokenAmount } from '@holdback/core';
import { Deal } from '@holdback/settlement/sim';
import { requestOf } from '@holdback/sdk';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testAccount } from './accounts.js';
import { holdOf, world, type World } from './_world.js';
import { beaconWindowNotices, escalationFloorSec, fallbackFloorSec, prepare, type PrepareContext } from './prepare.js';
import { startSimWorld, type SimWorld } from './sim-world.js';
import { tokenRefusal, type AcceptedToken } from './token.js';

const TUSD: AcceptedToken = { id: 'tUSD', symbol: 'tUSD', decimals: 6 };
const NAMED = /this deployment settles only in tUSD \(identifier tUSD, 6 decimals\)/;
let w: World;
let base: string;

beforeEach(async () => {
  w = await world();
  base = (await w.operator('op-1', { token: TUSD })).url;
});
afterEach(async () => w.close());

const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const other = (amount = '2000000000') => ({ token: 'USDX', amount }) as TokenAmount;
/** A deal on the same chain whose price is in another token, signed by the same cast. */
const usdxDeal = () => new Deal(w.chain, w.cast, { club: w.club, price: other() });
const offerInput = (over: Record<string, unknown> = {}) => ({
  disclosure: 'public',
  template: 'checks-only',
  seller: w.cast.seller.address,
  buyer: { address: w.cast.buyer.address, encryptionPublicKey: testAccount('one-token-buyer').encryptionPublicKey },
  adjudicators: { primary: w.cast.primary.address, fallback: w.cast.fallback.address, appeal: w.cast.appeal.address },
  clubId: w.club.id,
  deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
  checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 1, max: 9 }],
  price: { token: 'tUSD', amount: '2000000000' },
  nonce: `0x${'01'.repeat(32)}`,
  ...over,
});

describe('one token: every route that takes terms refuses another (the plan, 2c)', () => {
  it('discovery states the token the refusals name', async () => {
    const d = (await (await fetch(`${base}/.well-known/holdback.json`)).json()) as { token: AcceptedToken };
    expect(d.token).toEqual(TUSD);
  });

  it('POST /v1/commitments: refuses signed terms in another token, a dry run too, and relays nothing', async () => {
    const offer = await usdxDeal().offer();
    if (offer.kind !== 'offer') throw new Error('expected an offer');
    const before = w.chain.log().length;
    for (const path of ['/v1/commitments', '/v1/commitments?validateOnly=true']) {
      expect((await post(path, offer.commitment)).body, path).toMatchObject({ type: 'invalid_terms', field: 'price.token', detail: expect.stringMatching(NAMED) });
    }
    expect(w.chain.log().length).toBe(before);
    // The same deal in tUSD is relayed.
    const ok = await w.deal.offer();
    if (ok.kind !== 'offer') throw new Error('expected an offer');
    expect((await post('/v1/commitments', ok.commitment)).status).toBe(200);
  });

  it('POST /v1/holds: refuses a one-shot hold whose terms are in another token, naming the field under commitment', async () => {
    const { path, body } = requestOf(await holdOf(usdxDeal()));
    expect(path).toBe('/v1/holds');
    expect((await post(path, body)).body).toMatchObject({ type: 'invalid_terms', field: 'commitment.price.token', detail: expect.stringMatching(NAMED) });
    const good = requestOf(await holdOf(w.deal));
    expect((await post(good.path, good.body)).status).toBe(200);
  });

  it('POST /v1/prepare/settlement: refuses payouts in another token', async () => {
    const good = requestOf(await holdOf(w.deal));
    expect((await post(good.path, good.body)).status).toBe(200);
    const r = await post('/v1/prepare/settlement', { commitmentId: w.deal.id, nonce: `0x${'05'.repeat(32)}`, payouts: [{ to: w.cast.seller.address, amount: other() }] });
    expect(r.body).toMatchObject({ type: 'invalid_terms', field: 'payouts.0.amount.token', detail: expect.stringMatching(NAMED) });
  });

  it('matches the identifier without regard to case, as chain addresses are compared, and checks nothing when no token is set', () => {
    const t = { price: { token: '0xABCDEF0000000000000000000000000000000001' }, adjudication: { fee: { token: '0xabcdef0000000000000000000000000000000001' } }, settlement: { token: '0xAbcdef0000000000000000000000000000000001' } } as never;
    expect(tokenRefusal({ id: '0xabcdef0000000000000000000000000000000001', symbol: 'tUSDC', decimals: 6 }, t)).toBeNull();
    expect(tokenRefusal(undefined, { price: other(), adjudication: { fee: other() }, settlement: { token: 'USDX' } } as never)).toBeNull();
    expect(tokenRefusal(TUSD, { price: { token: 'tUSD' }, adjudication: { fee: { token: 'tUSD' } }, settlement: { token: 'USDX' } } as never)).toMatchObject({ field: 'settlement.token' });
  });
});

// The offer prepare route reads the primary's registration, which the full sim world publishes (`pnpm sim`'s world).
describe('one token at the offer prepare route, on the sim world', () => {
  let sim: SimWorld;
  beforeAll(async () => {
    sim = await startSimWorld({ accounts: ['buyer-1', 'seller-1'], env: {}, onError: () => {} });
  });
  afterAll(() => sim.close());
  const simPost = async (path: string, body: unknown) => {
    const r = await fetch(`${sim.info.operators[0]}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const simOffer = (over: Record<string, unknown> = {}) => {
    const acct = (l: string) => sim.info.accounts.find((a) => a.label === l)!;
    const [p, f, a] = sim.info.adjudicators;
    return {
      ...offerInput(),
      seller: acct('seller-1').address,
      buyer: { address: acct('buyer-1').address, encryptionPublicKey: acct('buyer-1').encryptionPublicKey },
      adjudicators: { primary: p!.address, fallback: f!.address, appeal: a!.address },
      clubId: sim.info.clubId,
      ...over,
    };
  };

  it('discovery of the sim world states tUSD', async () => {
    expect(((await (await fetch(`${sim.info.operators[0]}/.well-known/holdback.json`)).json()) as { token: AcceptedToken }).token).toEqual(TUSD);
  });

  it('POST /v1/prepare/offer: refuses a price in another token, prepares one in tUSD', async () => {
    const r = await simPost('/v1/prepare/offer', simOffer({ price: other() }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ type: 'invalid_terms', field: 'price.token', detail: expect.stringMatching(NAMED) });
    expect((await simPost('/v1/prepare/offer', simOffer())).status).toBe(200);
  });

  it('POST /v1/prepare/offer: refuses an adjudication fee in another token', async () => {
    const r = await simPost('/v1/prepare/offer', simOffer({ fee: other('1000000') }));
    expect(r.body).toMatchObject({ type: 'invalid_terms', field: 'adjudication.fee.token', detail: expect.stringMatching(NAMED) });
  });

  it('POST /v1/prepare/offer with hashOnly: the same refusal', async () => {
    const hashOnly = simOffer({ hashOnly: true, disclosure: 'private', template: undefined, deliverable: undefined, checks: undefined, deliverableHash: `0x${'11'.repeat(32)}`, acceptanceHash: `0x${'22'.repeat(32)}`, createdAt: sim.chain.now(), price: other() });
    expect((await simPost('/v1/prepare/offer', hashOnly)).body).toMatchObject({ type: 'invalid_terms', field: 'price.token', detail: expect.stringMatching(NAMED) });
  });

});

describe('the escalation and fallback windows below what the deployment can decide (ADR-0032): notices, never refusals (T-378 part 6)', () => {
  const examples = join(import.meta.dirname, '..', '..', '..', 'spec', 'examples');
  const load = (f: string): unknown => JSON.parse(readFileSync(join(examples, f), 'utf8'));
  const c = parseCommitment(load('commitment.example.json'));
  const k = parseClub(load('club.example.json'));
  if (!c.ok || !k.ok) throw new Error('the spec examples must parse');
  const ex = c.value as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  // A club that lets the parties choose a short escalation window, on the drand beacon a Sepolia rules contract reads.
  const drand = { ...k.value, rulebook: { ...k.value.rulebook, minWindowsSec: { ...k.value.rulebook.minWindowsSec, appealDecide: 1 }, randomness: { source: 'drand-quicknet' } } } as typeof k.value;
  // A fallback window of 120 s (the repository's), so only the escalation's notice shows unless a test shortens it.
  const timing = (appealDecideSec: number, fallbackSec = 120) => ({ ...ex['timing'], appealDecideSec, fallbackBy: new Date(Date.parse(ex['timing'].judgeBy) + fallbackSec * 1000).toISOString().replace('.000Z', 'Z') });
  const at = (club: typeof drand, appealDecideSec: number, margin: number, fallbackSec?: number) => beaconWindowNotices(club, { timing: timing(appealDecideSec, fallbackSec) }, margin);

  it('the floors follow ADR-0032: 37 s and 44 s at the 29 s margin on drand quicknet', () => {
    expect([escalationFloorSec(29, 3), fallbackFloorSec(29, 3)]).toEqual([37, 44]);
    // A larger margin moves both: three slots instead of two at a 41 s margin (ADR-0032 §4's table: 49 s).
    expect(escalationFloorSec(41, 3)).toBe(49);
  });

  it('warns below the floors the margin of the deployment gives, not at them, and not at a margin of 0', () => {
    expect(at(drand, 36, 29)).toEqual([expect.stringMatching(/^timing\.appealDecideSec is 36 s, below the 37 s .*its beacon margin is 29 s.* You may still choose it$/)]);
    expect(at(drand, 37, 29)).toEqual([]);
    expect(at(drand, 37, 29, 43)).toEqual([expect.stringMatching(/^the fallback window \(fallbackBy − judgeBy\) is 43 s, below the 44 s .* You may still choose it$/)]);
    expect(at(drand, 37, 29, 44)).toEqual([]);
    // SimChain and a local chain report a margin of 0: no floor to warn about, whatever the windows.
    expect(at(drand, 5, 0, 5)).toEqual([]);
    // The margin, not the beacon, decides: a sim-beacon club on a contract with a margin is warned for that margin.
    const sim = { ...drand, rulebook: { ...drand.rulebook, randomness: { source: 'sim' } } } as typeof drand;
    expect(at(sim, 5, 7)).toEqual([expect.stringMatching(/below the 13 s/)]);
  });

  it('the offer prepare route still prepares the terms and carries the notice', async () => {
    const ctx = {
      phaseOne: true,
      domain: { name: 'Holdback', version: '0.8', chainId: 31337, verifyingContract: '0x00000000000000000000000000000000000000f1' },
      now: () => '2026-11-12T00:00:00Z',
      club: (id: string) => (id === drand.id ? { ...drand, rulebookHash: rulebookHash(drand.rulebook) } : undefined),
      registration: async () => ({ policy: { id: 'p' }, policyHash: ex['adjudication'].policyHash, registry: { hash: ex['adjudication'].registryHash }, fee: { min: { token: 'tUSD', amount: '50000000' } } }),
      commitment: async () => undefined,
      delivery: async () => undefined,
      attempt: async () => 0,
      state: async () => null,
      beaconMarginSec: 29,
    } as unknown as PrepareContext;
    const body = {
      disclosure: 'public', template: 'checks-only', seller: ex['seller'], clubId: drand.id, nonce: `0x${'01'.repeat(32)}`, createdAt: '2026-11-12T00:00:00Z',
      buyer: { address: ex['buyer'], encryptionPublicKey: ex['buyerEncryptionPublicKey'] },
      adjudicators: { primary: ex['adjudication'].adjudicator, fallback: ex['adjudication'].fallbackAdjudicator, appeal: ex['adjudication'].appealAdjudicator },
      deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' }, checks: [ex['acceptance'].deterministicChecks[1]],
      price: { token: 'tUSD', amount: '2000000000' }, fee: { token: 'tUSD', amount: '50000000' }, timing: { appealDecideSec: 20 },
    };
    const p = await prepare('offer', ctx, body);
    expect((p.submit.body as { timing: { appealDecideSec: number } }).timing.appealDecideSec).toBe(20);
    // PR 412 review, Info 3: a fee the caller left out comes from the primary's registration, and the refusal says so.
    const usdxPrimary = { ...ctx, token: TUSD, registration: async () => ({ ...(await ctx.registration('0x' as never))!, fee: { min: { token: 'USDX', amount: '1' } } }) } as unknown as PrepareContext;
    const { fee: _fee, ...noFee } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
    const r = await prepare('offer', usdxPrimary, noFee).then(() => null, (e: { problem: unknown }) => e.problem);
    expect(r).toMatchObject({ type: 'invalid_terms', field: 'adjudicators.primary', detail: expect.stringMatching(/registers its minimum fee in USDX; this deployment settles only in tUSD/) });
    expect(p.notices).toEqual(expect.arrayContaining([expect.stringMatching(/appealDecideSec is 20 s, below the 37 s/)]));
  });
});
