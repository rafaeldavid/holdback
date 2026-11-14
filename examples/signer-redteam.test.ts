// The red team of T-439 (the signer, buying half), as the buying agent: RT-1 to RT-4. Each `it` states the outcome
// the signer gives; each failed on the branch before its fix (PR 555). The last one records a limit that stays: a
// delegation names a deal key, not a deal (ADR-0024 section 7). Keys are made in memory.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cast, cleanup, fundingFileFor, iso, mandateFor, payment, rulesFor, startSigner, stateServer, termsFor, V1, type Cast, type Running } from './signer-test-kit.ts';
import { SIMCHAIN_DOMAIN, verifyDelegation } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const dirs: string[] = [];
let reads: Awaited<ReturnType<typeof stateServer>>;
beforeAll(async () => void (reads = await stateServer()));
afterAll(async () => {
  await reads.close();
  cleanup(dirs);
});
async function signer(o: { rules?: (c: Cast) => J } = {}): Promise<{ c: Cast; s: Running }> {
  const c = cast();
  const s = await startSigner(c, o.rules ? o.rules(c) : rulesFor(c, { reads: [reads.url] }), await mandateFor(c));
  dirs.push(s.dir);
  return { c, s };
}
const sleepUntil = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms - Date.now())));
const ok = (r: { status: number; body: J }) => {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};

describe('RT-1 (B9): "never funded" from one read at fundBy, while the operators have not yet seen a funding mined just before it', () => {
  it('a funded hold the operators still show unfunded keeps counting as open: the fourth deal is refused', async () => {
    const { c, s } = await signer();
    // Deal A: an offer that expires in about 2 s and a funding deadline 1 s later, inside every window (the contract
    // wants offerExpiresAt < fundBy). The agent agrees and funds it straight on the rules contract just before
    // offerExpiresAt (ADR-0005); the operators' book shows the deal unfunded until their next sync pass (at least once a
    // minute, apps/demo-cloud/src/world.ts) or the relayed receipt lands.
    const created = Math.floor(Date.now() / 1000) * 1000 - 297_000;
    const a = termsFor(c, { createdAt: created, timing: { offerExpiresAt: iso(created + 299_000), fundBy: iso(created + 300_000) } });
    const A = ok(await s.post(payment(a))).commitmentId;
    reads.set(A, 'AcceptedByAdjudicator'); // the operators' view: funding not yet indexed
    const B = ok(await s.post(payment(termsFor(c)))).commitmentId, C = ok(await s.post(payment(termsFor(c)))).commitmentId;
    reads.set(B, 'Held');
    reads.set(C, 'Held');
    await sleepUntil(Date.parse(a.timing.fundBy) + 300);
    // At fundBy + 0.3 s the agent asks for a fourth deal. Three holds are funded on chain (A, B, C: 30.00 tUSDC).
    const d = await s.post(payment(termsFor(c)));
    reads.set(A, 'Held'); // the operators' next pass lands A's funding
    const status = (await s.get('/v1/status')).body;
    await s.kill();
    // A sound signer: A is open (only a read made after the operators can have seen every block before fundBy, or the
    // token's authorizationState for A's nonce, can say "never funded"), so the fourth deal breaks B9 and is refused.
    expect({ status: d.status, rule: d.body?.rule, dealsOpen: status.dealsOpen }).toEqual({ status: 403, rule: 'B9', dealsOpen: 3 });
  }, 30_000);
});

describe('RT-2 (B9, SimChain pin): a SimChain deal leaves the open count at fallbackBy + appealDecideSec, a day before SimChain stops paying the seller', () => {
  it('a hold the reads still show Delivered counts as open until SimChain\'s capture expiry (fallbackBy + appealDecideSec + 86,400 s)', async () => {
    const { c, s } = await signer();
    // Deadlines in order and inside every window; the delivery window is short, so the signer's endsBy (margin 0 s on
    // SimChain) comes about 69 s after createdAt. SimChain (DEFAULT_EXPIRY_MARGIN_SEC 86,400 s) still takes an early
    // accept, which pays the listed payout address, for a day after that.
    const created = Math.floor(Date.now() / 1000) * 1000;
    const a = termsFor(c, { createdAt: created, timing: { offerExpiresAt: iso(created + 5_000), fundBy: iso(created + 6_000), deliverBy: iso(created + 7_000), judgeBy: iso(created + 8_000), fallbackBy: iso(created + 9_000) } });
    const A = ok(await s.post(payment(a))).commitmentId;
    for (const id of [A, ok(await s.post(payment(termsFor(c)))).commitmentId, ok(await s.post(payment(termsFor(c)))).commitmentId]) reads.set(id, 'Delivered');
    await sleepUntil(Date.parse(a.timing.fallbackBy) + V1.buying.terms.appealDecideSec * 1000 + 500);
    const d = await s.post(payment(termsFor(c)));
    await s.kill();
    expect({ status: d.status, rule: d.body?.rule }).toEqual({ status: 403, rule: 'B9' });
  }, 120_000);
});

describe('RT-3 (B12): a token that is not the pinned one, letter for letter', () => {
  it('terms in "TUSD" (hashed as another token string than the pinned "tUSD") are refused', async () => {
    const { c, s } = await signer();
    const t = termsFor(c, { token: 'TUSD' });
    const r = await s.post(payment(t));
    await s.kill();
    expect({ status: r.status, rule: r.body?.rule }).toEqual({ status: 403, rule: 'B12' });
  });

  it('terms whose token is a list ["tUSD"] (String() of it reads "tUSD"; EIP-712 hashes it as another value) are refused before anything is signed', async () => {
    const { c, s } = await signer();
    const t = termsFor(c, { token: ['tUSD'] as never });
    let file: J;
    try {
      file = fundingFileFor(t);
    } catch {
      file = fundingFileFor(termsFor(c)); // any file: the terms alone must refuse
    }
    const r = await s.post(payment(t, file));
    await s.kill();
    expect(r.status).not.toBe(200);
    expect(['B12', 'request']).toContain(r.body?.rule);
  });
});

describe('RT-4 (B13): the delegation vouches for the deal key, not for the deal', () => {
  it('a payment asked for again returns the delegation it returned before, not a new one', async () => {
    const { c, s } = await signer();
    const t = termsFor(c);
    const out = ok(await s.post(payment(t)));
    const again = ok(await s.post(payment(t, fundingFileFor(t))));
    await s.kill();
    expect(again.delegation.nonce).toBe(out.delegation.nonce);
  });

  it('a second deal for a deal key the signer already certified for another deal is refused', async () => {
    const { c, s } = await signer();
    const first = termsFor(c);
    ok(await s.post(payment(first)));
    const r = await s.post(payment(termsFor(c, { buyer: first.buyer })));
    await s.kill();
    expect(r.status).toBe(403);
  });

  it('a limit that stays (context, not a defense): the returned delegation verifies for any deal of that key in the club, at or below the price, until the offer expires', async () => {
    const { c, s } = await signer();
    const t = termsFor(c);
    const out = ok(await s.post(payment(t)));
    await s.kill();
    const another = { dealKey: t.buyer, clubId: t.clubId, role: 'buyer' as const, price: { token: 'tUSD', amount: '9000000' }, nowMs: Date.now() };
    await expect(verifyDelegation(out.delegation, another, SIMCHAIN_DOMAIN)).resolves.toBeUndefined(); // passes today: context, not a defense
  });
});
