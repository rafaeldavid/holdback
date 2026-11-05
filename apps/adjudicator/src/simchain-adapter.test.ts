// The adjudicator service on T-006's real SimChain, through the settlement adapter: the demo's cleaned
// customer CSV is offered, accepted by the service, funded, delivered sealed, judged and released; the
// seller is paid and the buyer opens the key the decision released.
import { commitmentId, DRAND_QUICKNET_CHAIN_HASH, holdbackDomain, parseJudgment, SIM_BEACON, signTerms, type Address, type AdjudicatorRegistration, type Commitment, type CommitmentTerms, type Delivery, type Judgment, type Rulebook } from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey, open, seal, unwrapKey, wrapKeyForRecipients, type EncryptionKeyPair } from '@holdback/core/crypto';
import { fakeProvider, loadRegistry, type FakeScript, type JudgeProvider, type JudgeRequest, type RegistryDoc } from '@holdback/judgment';
import { SIM_CHAIN_ID, SIM_RULEBOOK, SimChain, sign, simCast, simClub, simGenesis, tusd, type SimActor } from '@holdback/settlement/sim';
import { readFileSync } from 'node:fs';
import { keccak256, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { fakeRelays, RELAYS_AT } from './_sim.js';
import { drandQuicknet } from './drand.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import type { RandomnessSource } from './randomness.js';
import { Adjudicator } from './service.js';
import { SettlementAdapter, type SettlementReads } from './simchain-adapter.js';

const DOMAIN = holdbackDomain(SIM_CHAIN_ID);
const START = '2026-11-01T09:00:00Z';
const entry = (id: string, family: string, provider: 'anthropic' | 'openai-compatible') => ({ id, provider, family, model: `${id}-20260601`, status: 'active' as const });
const REGISTRY: RegistryDoc = {
  version: 1,
  judges: [entry('claude-a', 'claude', 'anthropic'), entry('claude-b', 'claude', 'anthropic'), entry('gpt-a', 'gpt', 'openai-compatible'), entry('gpt-b', 'gpt', 'openai-compatible'), entry('qwen-a', 'qwen', 'openai-compatible'), entry('qwen-b', 'qwen', 'openai-compatible')],
};
const registry = (() => {
  const r = loadRegistry(REGISTRY);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
})();
const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Commitment;
const DEMO_CSV = readFileSync(new URL('../../../fixtures/data/dataset-cleaning/customers.clean.csv', import.meta.url), 'utf8');
const plus = (ts: string, s: number) => new Date(Date.parse(ts) + s * 1000).toISOString().replace('.000Z', 'Z');
const encKeys = (n: number): EncryptionKeyPair => encryptionKeyPairFromSecretKey(new Uint8Array(32).fill(n));

/** T-217: a club whose rulebook names another randomness source, and the drand source the adapter reads it from. */
interface WorldOptions {
  rulebook?: Rulebook;
  drand?: RandomnessSource;
}

async function world(bonds = { primary: 10_000_000_000n, fallback: 10_000_000_000n, appeal: 10_000_000_000n }, o: WorldOptions = {}) {
  const cast = simCast('t009-e2e');
  const club = simClub(cast.appeal.address, o.rulebook);
  const chain = new SimChain(
    await simGenesis({
      cast,
      club,
      start: START,
      balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n },
      bonds,
    }),
  );
  const blobs = new Map<string, Uint8Array>();
  const records = new Map<string, Judgment>();
  const registrations = new Map<string, AdjudicatorRegistration>();
  const settlement = new SettlementAdapter({
    chain,
    store: {
      ciphertext: async (uri) => blobs.get(uri) ?? Promise.reject(new Error(`no blob ${uri}`)),
      publishRecord: async (record) => {
        const parsed = parseJudgment(record);
        if (!parsed.ok) throw new Error(parsed.error.detail);
        records.set(record.recordHash, record);
        return `mem://records/${record.recordHash}`;
      },
    },
    registration: async (a) => registrations.get(a.toLowerCase()) ?? null,
    ...(o.drand ? { drand: o.drand } : {}),
  });
  const calls: JudgeRequest[] = [];
  /** What every judge answers from now on (default: pass). */
  const judges: { script: FakeScript } = { script: {} };
  const provider: JudgeProvider = { complete: (r) => (calls.push(r), fakeProvider(judges.script).complete(r)) };
  const bench = (actor: SimActor, n: number) => {
    const enc = encKeys(n);
    const adj = new Adjudicator({
      address: actor.address,
      name: actor.name,
      signingKey: actor.key,
      encryptionSecretKey: enc.secretKey,
      seedSecret: keccak256(actor.key),
      policy: defaultPolicy(`${actor.name}/p1`),
      registry,
      registryUri: 'file:///config/judges.yaml',
      fee: { min: tusd('25000000') },
      domain: DOMAIN,
      provider,
      settlement,
      trustedAdjudicators: [cast.primary.address, cast.fallback.address, cast.appeal.address],
    });
    registrations.set(adj.address, { ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
    return { adj, enc };
  };
  const primary = bench(cast.primary, 11);
  const fallback = bench(cast.fallback, 12);
  const appeal = bench(cast.appeal, 13);
  const buyerEnc = encKeys(14);

  // The example commitment's deliverable and checks, on the sim club's rules and this bench.
  const now = chain.now();
  const terms: CommitmentTerms = {
    schemaVersion: '0.7',
    clubId: club.id,
    rulebookHash: club.rulebookHash,
    buyer: cast.buyer.address,
    seller: cast.seller.address,
    deliverable: EXAMPLE.deliverable,
    acceptance: EXAMPLE.acceptance,
    price: tusd('2000000000'),
    adjudication: {
      adjudicator: cast.primary.address,
      fallbackAdjudicator: cast.fallback.address,
      appealAdjudicator: cast.appeal.address,
      policyId: primary.adj.policy.id,
      fee: tusd('50000000'),
      registryHash: registry.hash,
      policyHash: policyHashOf(primary.adj.policy),
    },
    timing: { offerExpiresAt: plus(now, 900), fundBy: plus(now, 1800), deliverBy: plus(now, 3600), judgeBy: plus(now, 4200), fallbackBy: plus(now, 4800), appealWindowSec: 300, appealDecideSec: 300, maxSubmissions: 1 },
    settlement: { mode: 'guaranteed_on_decision', token: 'tUSD' },
    remedy: { onReject: 'full_refund' },
    disclosure: { level: 'public' },
    buyerEncryptionPublicKey: encodePublicKey(buyerEnc.publicKey),
    nonce: keccak256(stringToBytes('t009-e2e/terms')),
    createdAt: now,
  };
  const id = commitmentId(terms);
  return { cast, chain, settlement, blobs, records, calls, judges, primary, fallback, appeal, buyerEnc, terms, id };
}

const must = (r: { ok: boolean; problem?: { detail: string } }) => {
  if (!r.ok) throw new Error(r.problem?.detail);
};

/** Offer, acceptance by the primary service, agreement and funding, and the sealed delivery of the demo CSV. */
async function delivered(bonds?: Parameters<typeof world>[0], o: WorldOptions = {}) {
  const w = await world(bonds, o);
  const { cast, chain, terms, id } = w;
    must(await chain.submit({ kind: 'offer', commitment: { ...terms, id, signatures: { seller: await signTerms(cast.seller.key, DOMAIN, terms) } } }));

    // The service finds the offer in the event log and accepts it with its seed commitment.
    const accepted = await w.primary.adj.runOnce();
    expect(accepted.accepted).toEqual([id]);
    expect(chain.escrowState(id)?.kind).toBe('AcceptedByAdjudicator');

    const total = (BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount)).toString();
    const agree = await sign(cast.buyer, { type: 'Agree', commitmentId: id, buyer: cast.buyer.address, nonce: keccak256(stringToBytes('agree')), expiresAt: terms.timing.offerExpiresAt } as const);
    const funding = await sign(cast.buyer, {
      type: 'FundingAuthorization',
      scheme: 'erc3009',
      commitmentId: id,
      from: cast.buyer.address,
      value: total,
      token: 'tUSD',
      validAfter: terms.createdAt,
      validBefore: terms.timing.fundBy,
      nonce: keccak256(stringToBytes('fund')),
      expiresAt: terms.timing.fundBy,
    } as const);
    must(await chain.submit({ kind: 'agree_and_fund', agree, funding }));
    expect(chain.escrowState(id)?.kind).toBe('Held');

    // The seller seals the CSV to the three adjudicators and the buyer.
    chain.advance(600);
    const sealed = await seal(new TextEncoder().encode(DEMO_CSV));
    const uri = `mem://ciphertext/${sealed.ciphertextSha256}`;
    w.blobs.set(uri, sealed.ciphertext);
    const recipients = [
      { recipient: cast.primary.address, publicKey: w.primary.enc.publicKey },
      { recipient: cast.fallback.address, publicKey: w.fallback.enc.publicKey },
      { recipient: cast.appeal.address, publicKey: w.appeal.enc.publicKey },
      { recipient: cast.buyer.address, publicKey: w.buyerEnc.publicKey },
    ];
    const body: Omit<Delivery, 'signature'> = {
      commitmentId: id,
      attempt: 1,
      ciphertext: { uri, sha256: sealed.ciphertextSha256, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' },
      plaintextSha256: sealed.plaintextSha256,
      plaintextMime: 'text/csv',
      encryptedKeys: wrapKeyForRecipients(sealed.key, recipients),
      submittedAt: chain.now(),
    };
    const { signature } = await sign(cast.seller, { ...body, type: 'Delivery' as const });
    must(await chain.submit({ kind: 'deliver', delivery: { ...body, signature } }));
    // ADR-0020: only the primary's envelope is released at delivery.
    expect(await chain.keysFor(id, cast.primary.address as Address)).toHaveLength(1);
    expect(await chain.keysFor(id, cast.fallback.address as Address)).toHaveLength(0);
    return { ...w, sealed };
}

/** Released, price to the seller, record published, and the buyer recovers exactly the delivered CSV. */
async function expectReleased(w: Awaited<ReturnType<typeof delivered>>, sellerBefore: bigint) {
  const { chain, cast, terms, id, sealed } = w;
  const state = chain.escrowState(id)!;
  expect(state.kind).toBe('Released');
  expect((await chain.state(id))?.escrowState).toBe('Released');
  const sellerAfter = BigInt((await chain.balances([cast.seller.address]))[cast.seller.address]!.amount);
  expect(sellerAfter - sellerBefore).toBe(BigInt(terms.price.amount));
  const decision = state.kind === 'Released' && state.via.kind === 'first_instance' ? state.via.decision : null;
  expect(decision && w.records.get(decision.judgmentRecordHash)?.aggregate.decision).toBe('accept');
  const [buyerEnvelope] = await chain.keysFor(id, cast.buyer.address as Address);
  expect(buyerEnvelope).toBeDefined();
  const plaintext = await open(sealed.ciphertext, unwrapKey(buyerEnvelope!, w.buyerEnc.secretKey), sealed.plaintextSha256);
  expect(new TextDecoder().decode(plaintext)).toBe(DEMO_CSV);
  return decision!;
}

const sellerBalance = async (w: Awaited<ReturnType<typeof world>>) => BigInt((await w.chain.balances([w.cast.seller.address]))[w.cast.seller.address]!.amount);

describe('the adjudicator service on the real SimChain (T-006)', () => {
  it("accepts, judges T-012's customers.clean.csv from a seeded sample, and releases the money to the seller and the key to the buyer", async () => {
    const w = await delivered();
    const { chain, id } = w;
    // The fallback and appeal adjudicators have nothing to do; the primary decides.
    chain.advance(30);
    expect((await w.fallback.adj.runOnce()).decided).toEqual([]);
    const sellerBefore = await sellerBalance(w);
    const report = await w.primary.adj.runOnce();
    expect(report.refused).toEqual([]);
    expect(report.decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'accept' }]);
    expect(w.calls).toHaveLength(3);
    expect(w.calls.every((c) => /drawn at random/.test(c.user) && c.user.length < 130_000)).toBe(true);
    const decision = await expectReleased(w, sellerBefore);
    expect(decision.role).toBe('primary');

    // A second run does nothing: no new judge calls, no resubmission.
    const again = await w.primary.adj.runOnce();
    expect(again.decided).toEqual([]);
    expect(w.calls).toHaveLength(3);
  });

  it('a silent primary: the fallback triggers the takeover at judgeBy, opens only its released key, seeds from the beacon and settles', async () => {
    const w = await delivered();
    const { chain, cast, terms, id } = w;
    chain.advance(30);
    expect(await w.fallback.adj.runOnce()).toMatchObject({ triggered: [], decided: [] });
    chain.advanceTo(terms.timing.judgeBy);
    const sellerBefore = await sellerBalance(w);
    const report = await w.fallback.adj.runOnce();
    expect(report.triggered).toEqual([id]);
    expect(report.refused).toEqual([]);
    expect(report.decided).toEqual([{ commitmentId: id, role: 'fallback', outcome: 'accept' }]);
    expect(await chain.keysFor(id, cast.fallback.address as Address)).toHaveLength(1);
    const decision = await expectReleased(w, sellerBefore);
    expect(decision.role).toBe('fallback');
    // SimChain checked the beacon seed through core: the round at judgeBy.
    expect(decision.beacon?.round).toBe(Date.parse(terms.timing.judgeBy) / 1000);
    // The primary, back too late, finds nothing to decide.
    expect((await w.primary.adj.runOnce()).decided).toEqual([]);
  });

  // T-211: SimChain reserves the fallback's bond at takeover (T-210 item 3); the contract only when it decides (T-206 M-3).
  it("a fallback bonded at exactly the price: the bond SimChain reserved at takeover counts once toward the fallback's cover", async () => {
    const price = 2_000_000_000n;
    const w = await delivered({ primary: 10_000_000_000n, fallback: price, appeal: 10_000_000_000n });
    const { chain, cast, terms, id } = w;
    const c = { ...terms, id, signatures: { seller: '0x' } } as Commitment;
    chain.advanceTo(terms.timing.judgeBy);
    expect(await w.settlement.bondCover(cast.fallback.address, c)).toBe(price);
    must(await chain.trigger(id, 'fallback'));
    expect(chain.pool(cast.fallback.address as Address).reserved).toBe(price);
    expect(await w.settlement.bondCover(cast.fallback.address, c)).toBe(price);
    expect(await w.settlement.bondCover(cast.fallback.address, { ...c, id: `0x${'12'.repeat(32)}` })).toBe(0n);
    const report = await w.fallback.adj.runOnce();
    expect(report.refused).toEqual([]);
    expect(report.decided).toEqual([{ commitmentId: id, role: 'fallback', outcome: 'accept' }]);
  });

  // T-211 (T-206 H-2), through the real adapter, whose firstOutcome the key rule reads (review of PR #175).
  it('a seller appeal that overturns a reject: the appeal pays the seller from the bond, and no key reaches the refunded buyer', async () => {
    const w = await delivered();
    const { chain, cast, terms, id } = w;
    w.judges.script = Object.fromEntries(REGISTRY.judges.map((j) => [j.id, 'fail' as const]));
    chain.advance(30);
    expect((await w.primary.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
    chain.advance(10);
    const body = { commitmentId: id, appellant: 'seller' as const, appellantAddress: cast.seller.address, grounds: 'wrong-outcome', bond: tusd('100000000'), filedAt: chain.now() };
    const { signature } = await sign(cast.seller, { ...body, type: 'Appeal' as const });
    must(await chain.submit({ kind: 'appeal', appeal: { ...body, signature } }));
    w.judges.script = {};
    chain.advance(5);
    expect((await w.settlement.tasks(cast.appeal.address)).map((t) => [t.firstOutcome, t.firstDecider?.toLowerCase()])).toEqual([['reject', cast.primary.address.toLowerCase()]]);
    const sellerBefore = await sellerBalance(w);
    expect((await w.appeal.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'appeal', outcome: 'accept' }]);
    const s = chain.escrowState(id)!;
    expect(s.kind === 'Refunded' && s.via.kind === 'first_instance' && s.via.appeal.kind).toBe('overturned');
    expect(s.kind === 'Refunded' && s.via.kind === 'first_instance' && s.via.appeal.kind === 'overturned' && s.via.appeal.decision.keyForBuyer).toBeUndefined();
    expect(await chain.keysFor(id, cast.buyer.address as Address)).toEqual([]);
    // The price from the primary's bond, and the appeal bond back.
    expect((await sellerBalance(w)) - sellerBefore).toBe(BigInt(terms.price.amount) + 100_000_000n);
  });

  it('the accept after an escalation carries the key, and the buyer opens the work', async () => {
    const w = await delivered();
    const { chain, id } = w;
    w.judges.script = { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' };
    chain.advance(30);
    expect((await w.primary.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'escalate' }]);
    w.judges.script = {};
    chain.advance(5);
    expect((await w.settlement.tasks(w.cast.appeal.address)).map((t) => [t.firstOutcome, t.firstDecider])).toEqual([[undefined, w.cast.primary.address]]);
    const sellerBefore = await sellerBalance(w);
    expect((await w.appeal.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'appeal', outcome: 'accept' }]);
    expect(chain.escrowState(id)?.kind).toBe('Released');
    const [envelope] = await chain.keysFor(id, w.cast.buyer.address as Address);
    expect(await open(w.sealed.ciphertext, unwrapKey(envelope!, w.buyerEnc.secretKey), w.sealed.plaintextSha256)).toEqual(new TextEncoder().encode(DEMO_CSV));
    expect((await sellerBalance(w)) - sellerBefore).toBe(BigInt(w.terms.price.amount));
  });

  // Review of PR #175, round 4 nit: the appeal task names whoever escalated as the first decider (T-211, Decision 10).
  it('after the fallback escalates, the appeal task names the fallback as its first decider', async () => {
    const w = await delivered();
    const { chain, cast, terms, id } = w;
    w.judges.script = { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' };
    chain.advanceTo(terms.timing.judgeBy); // the primary is silent
    expect((await w.fallback.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'fallback', outcome: 'escalate' }]);
    chain.advance(5);
    expect((await w.settlement.tasks(cast.appeal.address)).map((t) => [t.role, t.firstDecider?.toLowerCase()])).toEqual([['appeal', cast.fallback.address.toLowerCase()]]);
  });

  it('does not trigger a takeover once fallbackBy has passed', async () => {
    const w = await delivered();
    w.chain.advanceTo(w.terms.timing.fallbackBy);
    expect(await w.fallback.adj.runOnce()).toMatchObject({ triggered: [], refused: [], decided: [] });
  });

  // Red team of PR #175, F3: nobody else closes a sham deal's appeal, so the service expires its own decisions' appeals.
  it("expires the appeal of its own decision once appealBy passes, which releases SimChain's reservation", async () => {
    const w = await delivered();
    const { chain, cast, terms, id } = w;
    chain.advanceTo(terms.timing.judgeBy);
    expect((await w.fallback.adj.runOnce()).decided.map((d) => d.role)).toEqual(['fallback']);
    expect(chain.pool(cast.fallback.address as Address).reserved).toBe(2_000_000_000n);
    chain.advance(299);
    // Not due yet: no trigger sent (on chain each one costs gas), not only one the settlement layer refuses.
    expect(await w.settlement.appealExpiriesDue(cast.fallback.address)).toEqual([]);
    expect((await w.fallback.adj.runOnce()).expired).toEqual([]);
    chain.advance(1);
    expect(await w.settlement.appealExpiriesDue(cast.fallback.address)).toEqual([id]);
    expect((await w.primary.adj.runOnce()).expired).toEqual([]);
    expect((await w.fallback.adj.runOnce()).expired).toEqual([id]);
    expect(chain.pool(cast.fallback.address as Address).reserved).toBe(0n);
  });

  // Red team K5: an unfunded offer that the fallback accepts as primary reserves its bond on SimChain. Draining it at the
  // takeover, so the takeover reserves nothing, must not let a party force the default once the bond is free again.
  it('a fallback drained only at the takeover decides once its bond is free again', async () => {
    const w = await delivered({ primary: 10_000_000_000n, fallback: 2_000_000_000n, appeal: 10_000_000_000n });
    const { chain, cast, terms, id } = w;
    const judgeBy = terms.timing.judgeBy;
    const drain: CommitmentTerms = {
      ...terms,
      adjudication: { ...terms.adjudication, adjudicator: cast.fallback.address, fallbackAdjudicator: cast.primary.address, policyId: w.fallback.adj.policy.id, policyHash: policyHashOf(w.fallback.adj.policy) },
      timing: { ...terms.timing, offerExpiresAt: plus(judgeBy, 60), fundBy: plus(judgeBy, 120), deliverBy: plus(judgeBy, 3600), judgeBy: plus(judgeBy, 4200), fallbackBy: plus(judgeBy, 4800) },
      nonce: keccak256(stringToBytes('t211/drain')),
      createdAt: chain.now(),
    };
    const drainId = commitmentId(drain);
    must(await chain.submit({ kind: 'offer', commitment: { ...drain, id: drainId, signatures: { seller: await signTerms(cast.seller.key, DOMAIN, drain) } } }));
    expect((await w.fallback.adj.runOnce()).accepted).toEqual([drainId]);
    chain.advanceTo(judgeBy);
    must(await chain.trigger(id, 'fallback')); // at the drained moment: SimChain reserves nothing for the fallback
    chain.advanceTo(drain.timing.offerExpiresAt);
    must(await chain.trigger(drainId, 'expire_offer'));
    const sellerBefore = await sellerBalance(w);
    expect((await w.fallback.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'fallback', outcome: 'accept' }]);
    expect((await sellerBalance(w)) - sellerBefore).toBe(BigInt(terms.price.amount));
  });

  it('lists an open appeal of its own decision as due only once appealDecideBy passes', async () => {
    const w = await delivered();
    const { chain, cast, id } = w;
    chain.advance(30);
    expect((await w.primary.adj.runOnce()).decided.map((d) => d.outcome)).toEqual(['accept']);
    chain.advance(10);
    const body = { commitmentId: id, appellant: 'buyer' as const, appellantAddress: cast.buyer.address, grounds: 'wrong-outcome', bond: tusd('100000000'), filedAt: chain.now() };
    const { signature } = await sign(cast.buyer, { ...body, type: 'Appeal' as const });
    must(await chain.submit({ kind: 'appeal', appeal: { ...body, signature } }));
    const s = chain.escrowState(id)!;
    const decideBy = s.kind === 'Released' && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' ? s.via.appeal.appealDecideBy : '';
    chain.advanceTo(plus(decideBy, -1)); // the appeal adjudicator is silent
    expect(await w.settlement.appealExpiriesDue(cast.primary.address)).toEqual([]);
    chain.advanceTo(decideBy);
    expect(await w.settlement.appealExpiriesDue(cast.primary.address)).toEqual([id]);
    expect((await w.primary.adj.runOnce()).expired).toEqual([id]);
  });

  // T-217, T-209 decision 9: SimChain has no BLS verifier, so it keeps sim only. A SimChain club that names drand-quicknet
  // gets drand rounds from the adapter, never SimChain's sim beacon, and SimChain refuses the proven decision, since its
  // beacon fact is a sim value; the deal then takes its default path.
  it('SimChain keeps sim only: a club naming drand-quicknet reads drand rounds, and SimChain refuses the decision it cannot verify', async () => {
    const net = fakeRelays();
    const rulebook: Rulebook = { ...SIM_RULEBOOK, randomness: { source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH } };
    const w = await delivered(undefined, { rulebook, drand: drandQuicknet({ fetch: net.fetch, now: () => RELAYS_AT }) });
    const { chain, terms, id } = w;
    expect(chain.escrowState(id)?.beaconSource).toBe('drand-quicknet');
    chain.advanceTo(terms.timing.judgeBy);
    const report = await w.fallback.adj.runOnce();
    expect(report.triggered).toEqual([id]);
    expect(report.decided).toEqual([]);
    expect(report.refused).toEqual([{ commitmentId: id, problem: expect.objectContaining({ type: 'seed_mismatch', detail: expect.stringContaining('the signed beacon differs from the settlement layer beacon') }) }]);
    // The quicknet round at judgeBy 10:10:00Z, asked once.
    expect(net.requests).toEqual(['https://api2.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/33574812']);
    chain.advanceTo(terms.timing.fallbackBy);
    must(await chain.trigger(id, 'default'));
    expect(chain.escrowState(id)?.kind).toBe('Defaulted');
  });

  describe("the beacon the commitment's rulebook names (T-217)", () => {
    const c = { id: `0x${'12'.repeat(32)}` } as Commitment;
    const published = `0x${'0b'.repeat(32)}` as const;
    const reads = (state: unknown) => ({ escrowState: () => state, beacon: (round: number) => (round <= 5 ? published : null) }) as unknown as SettlementReads;
    const over = (chain: SettlementReads, drand?: RandomnessSource) => new SettlementAdapter({ chain, store: { ciphertext: async () => new Uint8Array(), publishRecord: async () => '' }, registration: async () => null, ...(drand ? { drand } : {}) });
    const drand = drandQuicknet({ fetch: fakeRelays().fetch });

    it.each([
      ['a sim commitment', { kind: 'FallbackJudging', beaconSource: 'sim' }],
      ['a commitment saved before the source was kept', { kind: 'FallbackJudging' }],
    ])("reads the settlement's sim beacon for %s", async (_name, state) => {
      const r = over(reads(state), drand).randomness(c);
      expect(r?.kind).toBe('sim');
      expect(r?.clock).toBe(SIM_BEACON);
      expect(await r?.value(5)).toEqual({ value: published });
      expect(await r?.value(6)).toBeNull();
    });

    it('hands a drand-quicknet commitment the drand source, and nothing in its place when none is configured', () => {
      expect(over(reads({ kind: 'FallbackJudging', beaconSource: 'drand-quicknet' }), drand).randomness(c)).toBe(drand);
      expect(over(reads({ kind: 'FallbackJudging', beaconSource: 'drand-quicknet' })).randomness(c)).toBeNull();
      expect(over(reads({ kind: 'FallbackJudging', beaconSource: 'prevrandao' }), drand).randomness(c)).toBeNull();
      expect(over(reads(null), drand).randomness(c)).toBeNull();
    });

    it('refuses a drand option that is another source', () => {
      expect(() => over(reads(null), { kind: 'sim', clock: SIM_BEACON, value: async () => null })).toThrow(/drand-quicknet/);
    });
  });

  // The contract's test at the decision (free bond plus the deal's own hold), with SimChain's reservations as the hold.
  // Counting only the reservation after the takeover would let a party force the default (red team K5, below).
  describe("on SimChain: the free bond plus the deal's own reservations, counted once", () => {
    const F = `0x${'f1'.repeat(20)}` as Address;
    it.each([
      ['before the takeover', 'Delivered', 0n, 9_000_000_000n],
      ['after the takeover reserved half the price', 'FallbackJudging', 1_000_000_000n, 9_000_000_000n],
      ['after the takeover reserved the price', 'FallbackJudging', 2_000_000_000n, 9_000_000_000n],
    ] as const)('%s', async (_name, kind, held, cover) => {
      const { terms, id } = await world();
      const c = { ...terms, id, signatures: { seller: '0x' } } as Commitment;
      const sim = {
        pool: () => ({ junior: 10_000_000_000n, senior: 0n, reserved: 1_000_000_000n + held }),
        reservations: () => [{ commitmentId: `0x${'12'.repeat(32)}`, adjudicator: F, amount: 1_000_000_000n }, ...(held ? [{ commitmentId: id, adjudicator: F, amount: held }] : [])],
        escrowState: () => ({ kind }),
      } as unknown as SettlementReads;
      const adapter = new SettlementAdapter({ chain: sim, store: { ciphertext: async () => new Uint8Array(), publishRecord: async () => '' }, registration: async () => null });
      expect(await adapter.bondCover(F, c)).toBe(cover);
    });
  });

  // The contract (ADR-0016 §1): freeOf, read fresh, plus the price while the deal still holds this adjudicator's bond. A
  // fallback's decision releases the primary's reservation before it encumbers its own, so a service that is its own
  // fallback needs the price once, not twice.
  describe("on the contract: freeOf plus the deal's own reservation (the EVM adapter)", () => {
    const P = `0x${'a1'.repeat(20)}` as Address;
    const F = `0x${'f1'.repeat(20)}` as Address;
    const appealOpenDecidedBy = (who: Address) => ({ kind: 'Released', via: { kind: 'first_instance', decision: { adjudicator: who }, appeal: { kind: 'open' } } });
    it.each([
      ['a fallback that is also the primary, at its turn', 'FallbackJudging', P, P, 7n + 2_000_000_000n],
      ['a fallback that is also the primary, before the takeover', 'Delivered', P, P, 7n + 2_000_000_000n],
      ['a fallback that is not the primary', 'FallbackJudging', P, F, 7n],
      ['the appeal adjudicator that decided first, its appeal open', appealOpenDecidedBy(P), P, P, 7n + 2_000_000_000n],
      ['an appeal adjudicator after another decided first', appealOpenDecidedBy(F), P, P, 7n],
      ['the appeal adjudicator after an escalation (the escalation released every bond)', 'Escalated', P, P, 7n],
    ] as const)('%s', async (_name, state, primary, me, cover) => {
      const { terms, id } = await world();
      const c = { ...terms, id, signatures: { seller: '0x' }, adjudication: { ...terms.adjudication, adjudicator: primary } } as Commitment;
      const s = typeof state === 'string' ? { kind: state } : state;
      const evmShaped = { pool: () => ({ junior: 9n, senior: 0n, reserved: 0n }), freeBond: async () => 7n, escrowState: () => s } as unknown as SettlementReads;
      const adapter = new SettlementAdapter({ chain: evmShaped, store: { ciphertext: async () => new Uint8Array(), publishRecord: async () => '' }, registration: async () => null });
      expect(await adapter.bondCover(me, c)).toBe(cover);
    });
  });
});
