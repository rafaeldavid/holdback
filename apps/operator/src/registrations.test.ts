// ADR-0030: adjudicators register themselves through the API. Any address may: the operator verifies the signature
// and the hashes, refuses only what is malformed, unsigned, out of order or self-contradictory (D31), and serves the
// record with its signature, the bond the settlement layer holds and what it observed.
import { canonicalKeccak, holdbackDomain, registrationMessageOf, verifyMessage, verifyRegistration, type Address, type AdjudicatorRegistration, type Hex32, type RegisteredAdjudicator } from '@holdback/core';
import { requestOf } from '@holdback/sdk';
import { Deal, SimChain, simActor, simCast, simClub, simGenesis } from '@holdback/settlement/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdOf } from './_world.js';
import { testAccount } from './accounts.js';
import type { Prepared } from './prepare.js';
import { signRegistration } from './registrations.js';
import { simRegistry } from './registry.js';
import { startOperator, type RunningOperator } from './server.js';
import { startSimWorld, type SimInfo, type SimWorld } from './sim-world.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let world: SimWorld;
let info: SimInfo;
let api: string;
const domain = holdbackDomain(31337);
const outsider = testAccount('t-221/outsider');
const h = (byte: string): Hex32 => `0x${byte.repeat(32)}`;
/** The high-s twin of a signature: it recovers to the same address over the same digest (EIP-2 refuses it). */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const highS = (sig: string) => `0x${sig.slice(2, 66)}${(N - BigInt(`0x${sig.slice(66, 130)}`)).toString(16).padStart(64, '0')}${sig.slice(130) === '1b' ? '1c' : '1b'}`;

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  info = world.info;
  api = info.operators[0]!;
});
afterAll(() => world.close());

let keys = 0;
async function call(method: 'GET' | 'POST', path: string, body?: unknown, o: { base?: string; key?: string | null; raw?: string } = {}): Promise<{ status: number; body: J }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.key !== null) headers['idempotency-key'] = o.key ?? `reg-${++keys}`;
  const res = await fetch(`${o.base ?? api}${path}`, { method, headers, ...(o.raw !== undefined ? { body: o.raw } : body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
}

const slate = () => ({ primary: info.adjudicators[0]!.address, fallback: info.adjudicators[1]!.address, appeal: info.adjudicators[2]!.address });
const now = () => Date.parse(world.chain.now());
const at = (offsetSec: number) => new Date(Math.floor(now() / 1000) * 1000 + offsetSec * 1000).toISOString().replace('.000Z', 'Z');

/** A registered record as an outside adjudicator writes it: a demo adjudicator's policy under its own id, any fee. */
async function body(over: Partial<RegisteredAdjudicator> = {}): Promise<Omit<RegisteredAdjudicator, 'registration'>> {
  const demo = (await call('GET', `/v1/adjudicators/${slate().primary}`)).body as AdjudicatorRegistration;
  const policy = { ...demo.policy, id: 'outsider/p1' };
  const terms = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 0 };
  return {
    address: outsider.address,
    name: 'Outside adjudicator (test)',
    encryptionPublicKey: outsider.encryptionPublicKey,
    affiliations: [],
    policy,
    registry: { hash: h('ee'), uri: 'https://outsider.example/registry.json' },
    policyHash: canonicalKeccak(policy),
    fee: { min: { token: 'tUSD', amount: '0' } as AdjudicatorRegistration['fee']['min'] },
    status: 'active',
    pool: { terms },
    poolTermsHash: canonicalKeccak(terms),
    ...over,
  };
}
let issued = 0;
async function registration(over: Partial<RegisteredAdjudicator> = {}, envelope: { issuedAt?: string; expiresAt?: string } = {}, key = outsider.privateKey, under = domain): Promise<RegisteredAdjudicator> {
  return signRegistration(key, under, await body(over), { keyId: 'outsider/k1', issuedAt: envelope.issuedAt ?? at(++issued - 3600), nonce: h('1f'), expiresAt: envelope.expiresAt ?? at(365 * 86_400) });
}
const register = (r: unknown, o: Parameters<typeof call>[3] = {}) => call('POST', '/v1/adjudicators', r, o);

describe('POST /v1/adjudicators', () => {
  it('accepts a well-formed registration with a fee of 0, a bond of 0 and an unknown registry hash (D31)', async () => {
    const r = await registration();
    const posted = await register(r);
    expect(posted.status).toBe(200);
    expect(posted.body).toMatchObject({ address: outsider.address, fee: { min: { amount: '0' } }, registry: { hash: h('ee') }, registration: r.registration });
    expect(posted.body.pool).toMatchObject({ junior: { amount: '0' }, senior: { amount: '0' }, reserved: { amount: '0' } });
    expect(posted.body.observed).toMatchObject({ bond: 'none', lastUsedAt: null, expired: false });
    // Any reader verifies the served record (signature and hashes) without trusting the operator.
    const served = (await call('GET', `/v1/adjudicators/${outsider.address}`, undefined, { base: info.operators[1]! })).body;
    expect(await verifyRegistration(domain, served)).toBe(true);
    // The signature alone does not bind the body: a reader recomputes bodyHash too.
    const renamed = { ...served, name: 'Crow (official)' };
    expect(await verifyMessage(domain, registrationMessageOf(renamed), outsider.address)).toBe(true);
    expect(await verifyRegistration(domain, renamed)).toBe(false);
  });

  it('lists the demo adjudicators first, each signed, then registrations oldest first', async () => {
    const page = (await call('GET', '/v1/adjudicators')).body;
    const addresses = page.items.map((a: J) => a.address);
    expect(addresses.slice(0, 3)).toEqual(Object.values(slate()));
    expect(addresses).toContain(outsider.address);
    for (const a of page.items.slice(0, 3)) {
      expect(await verifyMessage(domain, registrationMessageOf(a), a.address)).toBe(true);
      expect(a.observed.bond).toBe('bonded');
    }
    expect(page.items.slice(0, 3).map((a: J) => a.observed.defaultFor)).toEqual([['primary'], ['fallback'], ['appeal']]);
  });

  it.each<[string, (r: J) => J, number, string, string?]>([
    ['a body the schema refuses', (r) => ({ ...r, name: 'x'.repeat(121) }), 400, 'invalid_terms'],
    ['a policy below the mandatory panel minimum', (r) => ({ ...r, policy: { ...r.policy, panelSize: 2 } }), 400, 'invalid_terms'],
    ['a pool with balances', (r) => ({ ...r, pool: { ...r.pool, junior: { token: 'tUSD', amount: '1' } } }), 400, 'invalid_terms', 'pool'],
    ['a key that is not 32 bytes', (r) => ({ ...r, encryptionPublicKey: 'a2V5' }), 400, 'invalid_terms', 'encryptionPublicKey'],
    ['a policyHash that does not recompute', (r) => ({ ...r, policyHash: h('01') }), 400, 'invalid_terms', 'policyHash'],
    ['a poolTermsHash that does not recompute', (r) => ({ ...r, poolTermsHash: h('02') }), 400, 'invalid_terms', 'poolTermsHash'],
    ['a bodyHash that does not recompute', (r) => ({ ...r, registration: { ...r.registration, bodyHash: h('03') } }), 400, 'invalid_terms', 'registration.bodyHash'],
    ['a well-formed signature that does not recover to the address', (r) => ({ ...r, registration: { ...r.registration, signature: `0x${'7'.repeat(4)}${r.registration.signature.slice(6)}` } }), 401, 'invalid_signature'],
    ['a zero signature', (r) => ({ ...r, registration: { ...r.registration, signature: `0x${'00'.repeat(65)}` } }), 401, 'invalid_signature'],
    ['a low-order encryption key', (r) => ({ ...r, encryptionPublicKey: Buffer.alloc(32).toString('base64url') }), 400, 'invalid_terms', 'encryptionPublicKey'],
    ['more than 100 affiliations', (r) => ({ ...r, affiliations: Array.from({ length: 101 }, (_, i) => `m-${i}`) }), 400, 'invalid_terms', 'affiliations'],
    // T-221 review: self-contradictory in a way no panel can process (D31 allows the refusal).
    ['a minValid above panelSize', (r) => ({ ...r, policy: { ...r.policy, minValid: r.policy.panelSize + 1 } }), 400, 'invalid_terms', 'policy.minValid'],
    ['a minValidAppeal above appealPanelSize', (r) => ({ ...r, policy: { ...r.policy, minValidAppeal: r.policy.appealPanelSize + 1 } }), 400, 'invalid_terms', 'policy.minValidAppeal'],
    ['a minFamilies above panelSize', (r) => ({ ...r, policy: { ...r.policy, minFamilies: r.policy.panelSize + 1 } }), 400, 'invalid_terms', 'policy.minFamilies'],
  ])('refuses %s', async (_label, edit, status, type, field) => {
    const r = await register(edit(structuredClone(await registration())));
    expect([r.status, r.body.type]).toEqual([status, type]);
    if (field) expect(r.body.field).toBe(field);
  });

  // One spelling per registration (review of PR 184): another spelling of a time, the high-s twin of the signature or
  // a v of 0 or 1 signs the same digest, so the node stores the canonical form and refuses nothing well signed.
  it('stores the canonical spelling: whole-second Z times, a low-s signature with v 27 or 28', async () => {
    const r = await registration();
    const { issuedAt, expiresAt, signature } = r.registration;
    const v01 = `${signature.slice(0, 130)}${signature.slice(130) === '1b' ? '00' : '01'}`;
    for (const sig of [highS(signature), v01]) {
      const posted = await register({ ...r, registration: { ...r.registration, signature: sig, issuedAt: issuedAt.replace('Z', '.000Z'), expiresAt: expiresAt.replace('Z', '+00:00') } });
      expect(posted.status).toBe(200);
      expect(posted.body.registration).toMatchObject({ signature, issuedAt, expiresAt });
    }
  });

  it('refuses a registration signed under another domain or by another key', async () => {
    const other = await register(await registration({}, {}, outsider.privateKey, holdbackDomain(11155111)));
    expect([other.status, other.body.type]).toEqual([401, 'invalid_signature']);
    const forged = await register(await registration({}, {}, testAccount('t-221/forger').privateKey));
    expect([forged.status, forged.body.type]).toEqual([401, 'invalid_signature']);
  });

  it('refuses an expired registration, and one issued at or after it expires', async () => {
    const expired = await register(await registration({}, { issuedAt: at(-7200), expiresAt: at(-60) }));
    expect([expired.status, expired.body.type]).toEqual([409, 'deadline_passed']);
    const backwards = await register(await registration({}, { issuedAt: at(7200), expiresAt: at(3600) }));
    expect([backwards.status, backwards.body.type, backwards.body.field]).toEqual([400, 'invalid_terms', 'registration.issuedAt']);
  });

  it('serves the latest: refuses an older or equal issuedAt, replaces with a later one, keeps registeredAt', async () => {
    const first = (await call('GET', `/v1/adjudicators/${outsider.address}`)).body;
    const older = await register(await registration({ name: 'older' }, { issuedAt: at(-86_400) }));
    expect([older.status, older.body.type]).toEqual([409, 'invalid_state']);
    expect(older.body.detail).toContain(first.registration.issuedAt);
    const equal = await register(await registration({ name: 'equal' }, { issuedAt: first.registration.issuedAt }));
    expect([equal.status, equal.body.type]).toEqual([409, 'invalid_state']);
    // The served registration posted again (a retry after a restart) answers the served record unchanged.
    const again = await register({ ...first, pool: { terms: first.pool.terms }, observed: undefined, bond: undefined });
    expect(again.status).toBe(200);
    const later = await register(await registration({ name: 'Outside adjudicator, renamed' }, { issuedAt: at(0) }));
    expect([later.status, later.body.name]).toEqual([200, 'Outside adjudicator, renamed']);
    expect(later.body.observed.registeredAt).toBe(first.observed.registeredAt);
  });

  it('replays a stored answer for the same key and body, and refuses the key with another body', async () => {
    const r = await registration({}, { issuedAt: at(1) });
    const a = await register(r, { key: 'same-key' });
    const b = await register(r, { key: 'same-key' });
    expect([a.status, b.status, b.body]).toEqual([200, 200, a.body]);
    const c = await register(await registration({ name: 'other' }, { issuedAt: at(2) }), { key: 'same-key' });
    expect([c.status, c.body.type]).toEqual([409, 'idempotency_conflict']);
    const missing = await register(r, { key: null });
    expect([missing.status, missing.body.field]).toEqual([400, 'Idempotency-Key']);
  });

  it('refuses a registration body over 192 KiB, and takes one at its schema maximum even as escaped JSON', async () => {
    const r = await register(undefined, { raw: JSON.stringify({ name: 'x'.repeat(196_609) }) });
    expect([r.status, r.body.type]).toEqual([413, 'payload_too_large']);
    const wide = testAccount('t-221/wide');
    const astral = '\u{1f600}'.repeat(120);
    const big = await signRegistration(wide.privateKey, domain, { ...(await body()), address: wide.address, encryptionPublicKey: wide.encryptionPublicKey, name: astral, affiliations: Array.from({ length: 100 }, () => astral) }, { keyId: 'wide/k1', issuedAt: at(-5), nonce: h('2d'), expiresAt: at(86_400) });
    // Each astral character as its escaped surrogate pair, 12 bytes.
    const escaped = JSON.stringify(big).replace(/[\u{10000}-\u{10ffff}]/gu, (c) => c.split('').map((u) => `\\u${u.charCodeAt(0).toString(16)}`).join(''));
    expect(Buffer.byteLength(escaped)).toBeGreaterThan(140_000);
    expect((await register(undefined, { raw: escaped })).status).toBe(200);
  });

  it('does not serve an expired registration as current: prepare/offer refuses to name it', async () => {
    const lapsing = testAccount('t-221/lapsing');
    const r = await signRegistration(lapsing.privateKey, domain, { ...(await body()), address: lapsing.address, encryptionPublicKey: lapsing.encryptionPublicKey }, { keyId: 'lapsing/k1', issuedAt: at(-10), nonce: h('2b'), expiresAt: at(30) });
    expect((await register(r)).status).toBe(200);
    world.advance(60);
    const p = await call('POST', '/v1/prepare/offer', {
      nonce: h('2c'), disclosure: 'public', template: 'checks-only', clubId: info.clubId, seller: info.accounts[1]!.address,
      buyer: { address: info.accounts[0]!.address, encryptionPublicKey: info.accounts[0]!.encryptionPublicKey },
      adjudicators: { appeal: lapsing.address }, price: { token: 'tUSD', amount: '1000000' },
      deliverable: { kind: 'dataset', description: 'One row.', format: 'text/csv' }, checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 1, max: 1 }],
    });
    expect([p.status, p.body.type]).toEqual([404, 'not_found']);
    expect(p.body.detail).toMatch(/expired/);
  });

  it('keeps an expired registration listed, marked as expired', async () => {
    const short = testAccount('t-221/short-lived');
    const r = await signRegistration(short.privateKey, domain, { ...(await body()), address: short.address, encryptionPublicKey: short.encryptionPublicKey }, { keyId: 'short/k1', issuedAt: at(-10), nonce: h('2a'), expiresAt: at(60) });
    expect((await register(r)).status).toBe(200);
    world.advance(120);
    const served = await call('GET', `/v1/adjudicators/${short.address}`);
    expect([served.status, served.body.observed.expired]).toEqual([200, true]);
  });
});

describe('Crow\'s adjudicators are the defaults; others get a warning or, as an unbonded fallback, a refusal', () => {
  let n = 0;
  const offerInput = (adjudicators: Record<string, string> | undefined) => ({
    nonce: `0x${(++n).toString(16).padStart(64, 'a')}`,
    disclosure: 'public',
    template: 'checks-only',
    clubId: info.clubId,
    seller: info.accounts[1]!.address,
    buyer: { address: info.accounts[0]!.address, encryptionPublicKey: info.accounts[0]!.encryptionPublicKey },
    ...(adjudicators ? { adjudicators } : {}),
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: 'Two rows.', format: 'text/csv' },
    checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 1, max: 10 }],
  });

  it('discovery names the defaults, and prepare/offer fills each role the agent leaves out', async () => {
    const doc = (await call('GET', '/.well-known/holdback.json')).body;
    expect(doc.defaultAdjudicators).toEqual(slate());
    const none = await call('POST', '/v1/prepare/offer', offerInput(undefined));
    expect(none.status).toBe(200);
    const p = none.body as Prepared;
    expect(p.defaults['adjudicators']).toEqual(slate());
    expect(p.submit.body['adjudication']).toMatchObject({ adjudicator: slate().primary, fallbackAdjudicator: slate().fallback, appealAdjudicator: slate().appeal });
    const some = (await call('POST', '/v1/prepare/offer', offerInput({ appeal: slate().appeal }))).body as Prepared;
    expect(some.defaults['adjudicators']).toEqual({ primary: slate().primary, fallback: slate().fallback });
  });

  it('warns about a named adjudicator without a bond, and still prepares the offer', async () => {
    const r = await call('POST', '/v1/prepare/offer', offerInput({ ...slate(), appeal: outsider.address }));
    expect(r.status).toBe(200);
    expect(r.body.notices.join(' ')).toMatch(new RegExp(`appeal adjudicator ${outsider.address} has no bond`));
  });

  it('refuses to prepare terms whose fallback has less free bond than the price', async () => {
    const r = await call('POST', '/v1/prepare/offer', offerInput({ ...slate(), fallback: outsider.address }));
    expect([r.status, r.body.type, r.body.field]).toEqual([400, 'invalid_terms', 'adjudicators.fallback']);
    expect(r.body.detail).toMatch(/free bond/);
  });

  // T-221 review: a default filled in under an outside primary's registry, policy or fee, or under an appeal adjudicator
  // it does not trust, would decline its turn, and the buyer would think Crow stood behind the deal.
  it('fills in no default that would decline the terms: the parties may still name it, with a notice', async () => {
    // The outsider binds another registry (0xee…) and a fee of 0: Crow's fallback and appeal adjudicators would decline.
    const asPrimary = await call('POST', '/v1/prepare/offer', offerInput({ primary: outsider.address }));
    expect([asPrimary.status, asPrimary.body.type, asPrimary.body.field]).toEqual([400, 'invalid_terms', 'adjudicators.fallback']);
    expect(asPrimary.body.detail).toMatch(new RegExp(`this operator's default fallback adjudicator ${slate().fallback} would decline these terms: .*name a fallback adjudicator yourself`, 'i'));
    // Crow's primary does not trust an outside appeal adjudicator, so it is not filled in either.
    const asAppeal = await call('POST', '/v1/prepare/offer', offerInput({ appeal: outsider.address }));
    expect([asAppeal.status, asAppeal.body.field]).toEqual([400, 'adjudicators.primary']);
    expect(asAppeal.body.detail).toMatch(/does not trust/);
    // Named by the parties themselves: prepared, with a notice for each of this node's adjudicators that would decline.
    const named = await call('POST', '/v1/prepare/offer', offerInput({ ...slate(), primary: outsider.address }));
    expect(named.status).toBe(200);
    const notices = named.body.notices.join(' ');
    for (const role of ['fallback', 'appeal']) expect(notices).toMatch(new RegExp(`this operator's ${role} adjudicator ${slate()[role as 'fallback']} will decline its ${role} turn on these terms`));
    // Its own three under one another decline nothing.
    expect(((await call('POST', '/v1/prepare/offer', offerInput(undefined))).body.notices ?? []).join(' ')).not.toMatch(/will decline/);
  });

  // attack.default-fallback-declines-silently (T-221 review): an outside primary and an outside appeal adjudicator, with
  // the fallback left to the default. Crow's fallback would decline every turn under an appeal adjudicator it does not
  // trust, so it is not filled in, and the refusal names the appeal adjudicators it trusts, for the parties to check.
  it('attack.default-fallback-declines-silently: fills in no default fallback under an appeal adjudicator it does not trust', async () => {
    const r = await call('POST', '/v1/prepare/offer', offerInput({ primary: outsider.address, appeal: outsider.address }));
    expect([r.status, r.body.type, r.body.field]).toEqual([400, 'invalid_terms', 'adjudicators.fallback']);
    expect(r.body.detail).toMatch(/takes a fallback turn only under an appeal adjudicator it trusts \(.*\), and 0x[0-9a-f]{40} is not one/);
    for (const a of Object.values(slate())) expect(r.body.detail).toContain(a);
  });

  it('keeps every policy a registration carried, by hash, after a later registration replaces it', async () => {
    const keeper = testAccount('t-221/policy-keeper');
    const signed = async (id: string, issuedAt: string) => {
      const b = await body();
      const policy = { ...b.policy, id };
      return signRegistration(keeper.privateKey, domain, { ...b, address: keeper.address, encryptionPublicKey: keeper.encryptionPublicKey, policy, policyHash: canonicalKeccak(policy) }, { keyId: 'keeper/k1', issuedAt, nonce: h('3a'), expiresAt: at(86_400) });
    };
    const first = await signed('keeper/p1', at(-20));
    expect((await register(first)).status).toBe(200);
    expect((await register(await signed('keeper/p2', at(-10)))).status).toBe(200);
    expect((await call('GET', `/v1/adjudicators/${keeper.address}`)).body.policy.id).toBe('keeper/p2');
    // The world's adjudicators read the bound policy by its hash through their settlement port.
    expect(await world.adjudicators.appeal.settlement.policy(first.policyHash)).toEqual(first.policy);
  });
});

// neutrality: the operator's bond refusal is a relay refusal. The same signed messages settle when sent directly.
describe('neutrality.operator-refuses-unbonded-fallback: refused at the relay, the direct path stays open', () => {
  const cast = simCast('t-221');
  const club = simClub(simActor('club-operator', 't-221').address);
  let chain: SimChain;
  let op: RunningOperator;
  let deal: Deal;
  const post = async (path: string, b: unknown, key: string) => {
    const res = await fetch(`${op.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(b) });
    return { status: res.status, body: (await res.json()) as J };
  };
  beforeAll(async () => {
    chain = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z', balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: 25_000_000_000n, appeal: 25_000_000_000n } }));
    deal = new Deal(chain, cast, { club });
    op = await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor('op', 'operator').key, operatorId: 'op-t221', env: {} });
  });
  afterAll(() => op.close());

  it('refuses the offer and the agreement it relays, saying why; the settlement layer takes both directly', async () => {
    const offer = await deal.offer();
    if (offer.kind !== 'offer') throw new Error('expected an offer');
    const refused = await post('/v1/commitments', offer.commitment, 'offer-1');
    expect([refused.status, refused.body.type, refused.body.field]).toEqual([400, 'invalid_terms', 'adjudication.fallbackAdjudicator']);
    expect(refused.body.detail).toMatch(/directly to the settlement layer/);
    expect((await chain.submit(offer)).ok).toBe(true);
    expect((await chain.submit(await deal.accept())).ok).toBe(true);
    const af = await deal.agreeAndFund();
    if (af.kind !== 'agree_and_fund') throw new Error('expected agree_and_fund');
    const agree = await post(`/v1/commitments/${deal.id}/agree`, { message: af.agree, fund: af.funding }, 'agree-1');
    expect([agree.status, agree.body.type]).toEqual([400, 'invalid_terms']);
    expect((await chain.submit(af)).ok).toBe(true);
    expect((await chain.state(deal.id))?.escrowState).toBe('Held');
  });

  it('relays the same deal shape when the fallback is bonded', async () => {
    const bonded = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z', balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n } }));
    const node = await startOperator({ settlement: bonded, registry: simRegistry(bonded), signerKey: simActor('op2', 'operator').key, operatorId: 'op-t221-b', env: {} });
    try {
      const offer = await new Deal(bonded, cast, { club }).offer();
      if (offer.kind !== 'offer') throw new Error('expected an offer');
      const r = await fetch(`${node.url}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k' }, body: JSON.stringify(offer.commitment) });
      expect(r.status).toBe(200);
    } finally {
      await node.close();
    }
  });
});

// ADR-0031 §8 points 6 and 7: every chain settlement runs the phase-one contracts, which hold no bond and take no party
// appeal. A SimChain that reports kind 'local' stands in for one: the operator reads only `kind` to tell them apart.
describe('phase one on a chain settlement: no unbonded-fallback refusal, no appeal (ADR-0031 §8)', () => {
  const cast = simCast('t-349');
  const club = simClub(simActor('club-operator', 't-349').address);
  const asChain = (chain: SimChain) =>
    new Proxy(chain, {
      get(target, prop) {
        if (prop === 'kind') return 'local';
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as SimChain;
  const post = async (url: string, path: string, b: unknown) => {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `t-349-${++keys}` }, body: JSON.stringify(b) });
    return { status: res.status, body: (await res.json()) as J };
  };
  const unbonded = () => simGenesis({ cast, club, start: '2026-11-04T09:00:00Z', balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: 25_000_000_000n, appeal: 25_000_000_000n } });

  it('relays an offer whose fallback holds no bond, and lists every adjudicator with bond none', async () => {
    const sim = new SimChain(await unbonded());
    const chain = asChain(sim);
    const node = await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor('op', 'operator').key, operatorId: 'op-t349', env: {} });
    try {
      const offer = await new Deal(sim, cast, { club }).offer();
      if (offer.kind !== 'offer') throw new Error('expected an offer');
      const relayed = await post(node.url, '/v1/commitments', offer.commitment);
      expect(relayed.status, JSON.stringify(relayed.body)).toBe(200);
      // `observed.bond` reads none on a chain world: registration.anvil.test.ts asserts it on registered adjudicators.
    } finally {
      await node.close();
    }
  });

  // A party appeal is not in phase one (ADR-0031 §8): a chain settlement refuses it, and SimChain keeps it.
  it('answers POST /v1/prepare/appeal with invalid_state naming phase one, and names no state to wait for', async () => {
    const sim = new SimChain(await unbonded());
    const deal = new Deal(sim, cast, { club });
    const onChain = await startOperator({ settlement: asChain(sim), registry: simRegistry(sim), signerKey: simActor('op', 'operator').key, operatorId: 'op-t349-a', env: {} });
    try {
      // A party appeal is not in phase one (ADR-0031 §8): the chain settlement refuses it, and SimChain keeps it.
      const body = { commitmentId: deal.id, appellant: cast.buyer.address };
      const refused = await post(onChain.url, '/v1/prepare/appeal', body);
      expect([refused.status, String(refused.body.type).split('/').at(-1)]).toEqual([409, 'invalid_state']);
      expect(refused.body.detail).toMatch(/phase-one contracts, which have no party appeals and no bonds \(ADR-0031, D57\)/);
      expect(refused.body.needs).toBeUndefined();
      // SimChain keeps the full protocol: sim-world.test.ts prepares and files a party appeal end to end.
    } finally {
      await onChain.close();
    }
  });
});

describe('the route is a write under the throttle, and lastUsedAt follows the adjudicator', () => {
  const cast = simCast('t-221-b');
  const club = simClub(simActor('club-operator', 't-221-b').address);

  const sim = holdbackDomain(31337);
  const regOf = (who: ReturnType<typeof testAccount>, issuedAt: string) =>
    signRegistration(who.privateKey, sim, { ...offline(), address: who.address, encryptionPublicKey: who.encryptionPublicKey }, { keyId: 'k', issuedAt, nonce: h('3a'), expiresAt: '2027-11-04T09:00:00Z' });
  const send = async (url: string, r: unknown, key: string) => (await fetch(`${url}/v1/adjudicators`, { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify(r) })).status;
  const limited = async (writes: number, id: string) => {
    const chain = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z' }));
    return startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor(id, 'operator').key, operatorId: id, env: {}, rateLimit: { writes, reads: 100, windowMs: 60_000 } });
  };
  /** A write bucket's count this window: the throttle's own state, since every test request comes from one client. */
  const spent = (op: RunningOperator, bucket: string) => (op.operator as unknown as { windows: Map<string, { count: number }> }).windows.get(bucket)?.count ?? 0;

  it('keeps a new address\'s registration on the client, so fresh keys are bounded by the client\'s write budget', async () => {
    const op = await limited(2, 'op-t221-c');
    try {
      expect(await send(op.url, await regOf(testAccount('t-221/sybil-1'), '2026-11-04T08:00:00Z'), 'a')).toBe(200);
      expect(await send(op.url, await regOf(testAccount('t-221/sybil-2'), '2026-11-04T08:00:00Z'), 'b')).toBe(200);
      expect(await send(op.url, await regOf(testAccount('t-221/sybil-3'), '2026-11-04T08:00:00Z'), 'c')).toBe(429);
    } finally {
      await op.close();
    }
  });

  // attack.registration-replay-spends-adjudicator-write-budget and attack.registration-history-replacements-fill-budget
  // (review of PR 184): anyone can copy a served registration, or post an adjudicator's older ones in order at a node
  // that lacks the latest. Every registration write stays on the client that sent it.
  it('spends nothing of the adjudicator\'s budget when anyone posts its registrations, served, again or in order', async () => {
    const op = await limited(10, 'op-t221-e');
    try {
      const history = [await regOf(outsider, '2026-11-04T08:00:00Z'), await regOf(outsider, '2026-11-04T08:10:00Z'), await regOf(outsider, '2026-11-04T08:20:00Z')];
      for (const [i, reg] of history.entries()) expect(await send(op.url, reg, `step-${i}`)).toBe(200);
      for (const k of ['copy-1', 'copy-2']) expect(await send(op.url, history[2], k)).toBe(200);
      expect(spent(op, `w:${outsider.address}`)).toBe(0);
    } finally {
      await op.close();
    }
  });

  it('shows when the adjudicator last accepted or decided, from the events this node indexed', async () => {
    const chain = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z', balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n } }));
    const op = await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor('op4', 'operator').key, operatorId: 'op-t221-d', env: {} });
    try {
      const primary = cast.primary.address.toLowerCase() as Address;
      const r = await signRegistration(cast.primary.key, holdbackDomain(31337), { ...offline(), address: primary }, { keyId: 'k', issuedAt: '2026-11-04T08:00:00Z', nonce: h('4a'), expiresAt: '2027-11-04T09:00:00Z' });
      expect((await fetch(`${op.url}/v1/adjudicators`, { method: 'POST', headers: { 'idempotency-key': 'r' }, body: JSON.stringify(r) })).status).toBe(200);
      const read = async () => (await (await fetch(`${op.url}/v1/adjudicators/${primary}`)).json()) as J;
      expect((await read()).observed).toMatchObject({ lastUsedAt: null, bond: 'bonded' });
      const deal = new Deal(chain, cast, { club });
      await chain.submit(await deal.offer());
      const accepted = await chain.submit(await deal.accept());
      if (!accepted.ok) throw new Error('acceptance refused');
      expect((await read()).observed.lastUsedAt).toBe(accepted.events.at(-1)!.at);
    } finally {
      await op.close();
    }
  });
});

// Review of PR 184: the relay checks read the bond at the moment that matters, and never override an idempotent replay.
describe('bond reads in the relay: replays, the buyer\'s notice, a hold\'s own reservation, stable pages', () => {
  const cast = simCast('t-221-c');
  const club = simClub(simActor('club-operator', 't-221-c').address);
  const PRICE = 2_000_000_000n; // Deal's default price, 2,000 tUSD
  const funded = { buyer: 10_000_000_000n, seller: 1_000_000_000n };
  const ids = { n: 0 };
  async function node(bonds: Partial<Record<'primary' | 'fallback' | 'appeal', bigint>>, drained?: () => boolean) {
    const chain = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z', balances: funded, bonds }));
    const base = simRegistry(chain);
    const zero = { token: 'tUSD', amount: '0' } as AdjudicatorRegistration['fee']['min'];
    const pool = async (a: Address) => (drained?.() && a.toLowerCase() === cast.fallback.address.toLowerCase() ? { junior: zero, senior: zero, reserved: zero } : base.pool!(a));
    const op = await startOperator({ settlement: chain, registry: { ...base, pool }, signerKey: simActor(`op-c${++ids.n}`, 'operator').key, operatorId: `op-c${ids.n}`, env: {} });
    const post = async (path: string, b: unknown, key: string) => {
      const res = await fetch(`${op.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(b) });
      return { status: res.status, body: (await res.json()) as J };
    };
    return { chain, op, post };
  }
  const all = { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n };

  it('replays a relayed offer under its key after the fallback\'s bond is gone; a new key is refused', async () => {
    let drained = false;
    const { chain, op, post } = await node(all, () => drained);
    try {
      const offer = await new Deal(chain, cast, { club }).offer();
      if (offer.kind !== 'offer') throw new Error('expected an offer');
      const first = await post('/v1/commitments', offer.commitment, 'offer-K');
      expect(first.status).toBe(200);
      drained = true;
      const retry = await post('/v1/commitments', offer.commitment, 'offer-K');
      expect([retry.status, retry.body]).toEqual([200, first.body]);
      expect((await post('/v1/commitments', offer.commitment, 'offer-L')).status).toBe(400);
    } finally {
      await op.close();
    }
  });

  it('warns the buyer at agree about an unbonded adjudicator, without counting the primary\'s reservation for this deal', async () => {
    const { chain, op, post } = await node({ primary: PRICE, fallback: 25_000_000_000n });
    try {
      const deal = new Deal(chain, cast, { club });
      expect((await chain.submit(await deal.offer())).ok).toBe(true);
      expect((await chain.submit(await deal.accept())).ok).toBe(true);
      const n = (s: string) => `0x${s.repeat(32)}`;
      const p = await post('/v1/prepare/agree-and-fund', { commitmentId: deal.id, agreeNonce: n('6a'), fundingNonce: n('6b') }, 'p');
      expect(p.status).toBe(200);
      expect(p.body.notices.join(' ')).toMatch(new RegExp(`appeal adjudicator ${cast.appeal.address} has no bond`, 'i'));
      expect(p.body.notices.join(' ')).not.toMatch(/primary adjudicator/);
    } finally {
      await op.close();
    }
  });

  // attack.bond-read-failure-silent (review of PR 184): a failed read neither refuses nor stays silent.
  it('relays when a bond read fails, and says that no bond check was made', async () => {
    const chain = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z', balances: funded, bonds: { primary: 25_000_000_000n } }));
    const failing = { ...simRegistry(chain), pool: async (): Promise<never> => Promise.reject(new Error('rpc limit')) };
    const op = await startOperator({ settlement: chain, registry: failing, signerKey: simActor('op-fail', 'operator').key, operatorId: 'op-fail', env: {} });
    try {
      const offer = await new Deal(chain, cast, { club }).offer();
      if (offer.kind !== 'offer') throw new Error('expected an offer');
      const res = await fetch(`${op.url}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k' }, body: JSON.stringify(offer.commitment) });
      const b = (await res.json()) as J;
      expect([res.status, b.escrowState]).toEqual([200, 'Offered']);
      expect(b.notices.join(' ')).toMatch(new RegExp(`could not read the bond of the fallback adjudicator ${cast.fallback.address}; no bond check was made`, 'i'));
    } finally {
      await op.close();
    }
  });

  it('gives a relayed hold no notice from its own reservation of the primary\'s bond', async () => {
    const { chain, op, post } = await node({ primary: PRICE, fallback: 25_000_000_000n, appeal: 25_000_000_000n });
    try {
      const { path, body: hold } = requestOf(await holdOf(new Deal(chain, cast, { club })));
      const r = await post(path, hold, 'hold');
      expect([r.status, r.body.escrowState]).toEqual([200, 'Held']);
      expect(r.body.notices).toBeUndefined();
    } finally {
      await op.close();
    }
  });

  it('pages the adjudicator list without a skip when a genesis adjudicator registers between pages', async () => {
    const { op } = await node(all);
    try {
      const page = async (cursor?: string) => (await (await fetch(`${op.url}/v1/adjudicators?limit=2${cursor ? `&cursor=${cursor}` : ''}`)).json()) as J;
      const one = await page();
      const primary = cast.primary.address.toLowerCase() as Address;
      const r = await signRegistration(cast.primary.key, holdbackDomain(31337), { ...offline(), address: primary }, { keyId: 'k', issuedAt: '2026-11-04T08:00:00Z', nonce: h('5a'), expiresAt: '2027-11-04T09:00:00Z' });
      expect((await fetch(`${op.url}/v1/adjudicators`, { method: 'POST', headers: { 'idempotency-key': 'r' }, body: JSON.stringify(r) })).status).toBe(200);
      const two = await page(one.nextCursor);
      expect([...one.items, ...two.items].map((a: J) => a.address.toLowerCase())).toEqual([cast.primary, cast.fallback, cast.appeal].map((a) => a.address.toLowerCase()));
    } finally {
      await op.close();
    }
  });
});

/** A record with a fixed policy, for nodes that run no demo adjudicator to copy one from. */
function offline(): Omit<RegisteredAdjudicator, 'registration'> {
  const policy: AdjudicatorRegistration['policy'] = {
    id: 'offline/p1',
    panelSize: 3,
    appealPanelSize: 5,
    minFamilies: 2,
    minFamiliesAppeal: 2,
    minValid: 2,
    minValidAppeal: 3,
    acceptSupermajority: { numerator: 2, denominator: 3 },
    rejectSupermajority: { numerator: 2, denominator: 3 },
    judgeTimeoutSec: 60,
    rationaleMaxChars: 600,
    promptTemplateHash: h('0a'),
    appealPromptTemplateHash: h('0b'),
    aggregationVersion: 'agg-1',
    screenVersion: 'screen-1',
    providerPrivacy: 'zdr',
    disclosureMin: 'public',
  };
  const terms = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 0 };
  return {
    address: outsider.address,
    name: 'Offline',
    encryptionPublicKey: outsider.encryptionPublicKey,
    affiliations: [],
    policy,
    registry: { hash: h('ee'), uri: 'https://offline.example/registry.json' },
    policyHash: canonicalKeccak(policy),
    fee: { min: { token: 'tUSD', amount: '1' } as AdjudicatorRegistration['fee']['min'] },
    status: 'active',
    pool: { terms },
    poolTermsHash: canonicalKeccak(terms),
  };
}
