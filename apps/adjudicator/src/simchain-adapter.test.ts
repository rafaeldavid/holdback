// The adjudicator service on T-006's real SimChain, through the settlement adapter: the demo's cleaned
// customer CSV is offered, accepted by the service, funded, delivered sealed, judged and released; the
// seller is paid and the buyer opens the key the decision released.
import { commitmentId, holdbackDomain, parseJudgment, signTerms, type Address, type AdjudicatorRegistration, type Commitment, type CommitmentTerms, type Delivery, type Judgment } from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey, open, seal, unwrapKey, wrapKeyForRecipients, type EncryptionKeyPair } from '@holdback/core/crypto';
import { fakeProvider, loadRegistry, type JudgeProvider, type JudgeRequest, type RegistryDoc } from '@holdback/judgment';
import { SIM_CHAIN_ID, SimChain, sign, simCast, simClub, simGenesis, tusd, type SimActor } from '@holdback/settlement/sim';
import { readFileSync } from 'node:fs';
import { keccak256, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator } from './service.js';
import { SettlementAdapter } from './simchain-adapter.js';

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

async function world() {
  const cast = simCast('t009-e2e');
  const club = simClub(cast.appeal.address);
  const chain = new SimChain(
    await simGenesis({
      cast,
      club,
      start: START,
      balances: { buyer: 10_000_000_000n },
      bonds: { primary: 10_000_000_000n, fallback: 10_000_000_000n, appeal: 10_000_000_000n },
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
  });
  const calls: JudgeRequest[] = [];
  const inner = fakeProvider({});
  const provider: JudgeProvider = { complete: (r) => (calls.push(r), inner.complete(r)) };
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
    schemaVersion: '0.6',
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
  return { cast, chain, blobs, records, calls, primary, fallback, appeal, buyerEnc, terms, id };
}

const must = (r: { ok: boolean; problem?: { detail: string } }) => {
  if (!r.ok) throw new Error(r.problem?.detail);
};

/** Offer, acceptance by the primary service, agreement and funding, and the sealed delivery of the demo CSV. */
async function delivered() {
  const w = await world();
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
});
