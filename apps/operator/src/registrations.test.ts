// ADR-0030: adjudicators register themselves through the API. Any address may: the operator verifies the signature
// and the hashes, refuses only what is malformed, unsigned, out of order or self-contradictory (D31), and serves the
// record with its signature, the bond the settlement layer holds and what it observed.
import { canonicalKeccak, holdbackDomain, registrationMessageOf, verifyMessage, type Address, type AdjudicatorRegistration, type Hex32, type RegisteredAdjudicator } from '@holdback/core';
import { Deal, SimChain, simActor, simCast, simClub, simGenesis } from '@holdback/settlement/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    // Any reader verifies the served record against the adjudicator's own address, without trusting the operator.
    const served = (await call('GET', `/v1/adjudicators/${outsider.address}`, undefined, { base: info.operators[1]! })).body;
    expect(await verifyMessage(domain, registrationMessageOf(served), outsider.address)).toBe(true);
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
    ['a signature that does not recover to the address', (r) => ({ ...r, registration: { ...r.registration, signature: `0x${'00'.repeat(65)}` } }), 401, 'invalid_signature'],
  ])('refuses %s', async (_label, edit, status, type, field) => {
    const r = await register(edit(structuredClone(await registration())));
    expect([r.status, r.body.type]).toEqual([status, type]);
    if (field) expect(r.body.field).toBe(field);
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

  it('refuses a body over 1 MiB', async () => {
    const r = await register(undefined, { raw: JSON.stringify({ name: 'x'.repeat(1_048_577) }) });
    expect([r.status, r.body.type]).toEqual([413, 'payload_too_large']);
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

describe('the route is a write under the throttle, and lastUsedAt follows the adjudicator', () => {
  const cast = simCast('t-221-b');
  const club = simClub(simActor('club-operator', 't-221-b').address);

  it('spends the signer\'s write budget, so a second registration in the window is 429', async () => {
    const chain = new SimChain(await simGenesis({ cast, club, start: '2026-11-04T09:00:00Z' }));
    const op = await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor('op3', 'operator').key, operatorId: 'op-t221-c', env: {}, rateLimit: { writes: 1, reads: 100, windowMs: 60_000 } });
    try {
      const sim = holdbackDomain(31337);
      const reg = (issuedAt: string) => signRegistration(outsider.privateKey, sim, { ...offline(), address: outsider.address }, { keyId: 'k', issuedAt, nonce: h('3a'), expiresAt: '2027-11-04T09:00:00Z' });
      const send = async (r: unknown, key: string) => (await fetch(`${op.url}/v1/adjudicators`, { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify(r) })).status;
      expect(await send(await reg('2026-11-04T08:00:00Z'), 'a')).toBe(200);
      expect(await send(await reg('2026-11-04T08:30:00Z'), 'b')).toBe(429);
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
