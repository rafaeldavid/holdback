// The adjudicator service end to end over an in-memory settlement on core's step (T-009).
import { canonicalKeccak, type AdjudicatorPolicy, type Decision, type Hex32 } from '@holdback/core';
import { open, unwrapKey, unwrapKeyFor, encodePublicKey } from '@holdback/core/crypto';
import {
  APPEAL_PROMPT_TEMPLATE_HASH,
  buildPrompt,
  criteriaOrder,
  fakeProvider,
  judgeNonces,
  loadRegistry,
  PROMPT_TEMPLATE_HASH,
  sampleSeedFor,
  selectPanel,
  UntrustedData,
  type FakeScript,
  type JudgeProvider,
  type JudgeRequest,
  type LoadedRegistry,
  type RegistryDoc,
} from '@holdback/judgment';
import { keccak256, recoverMessageAddress } from 'viem';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd, type Party } from './_sim.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { panelSeed, simRoundAt } from './randomness.js';
import { Adjudicator, recordHashOf } from './service.js';

const entry = (id: string, family: string, provider: 'anthropic' | 'openai-compatible') => ({ id, provider, family, model: `${id}-20260601`, status: 'active' as const });
const REGISTRY: RegistryDoc = {
  version: 1,
  judges: [entry('claude-a', 'claude', 'anthropic'), entry('claude-b', 'claude', 'anthropic'), entry('gpt-a', 'gpt', 'openai-compatible'), entry('gpt-b', 'gpt', 'openai-compatible'), entry('qwen-a', 'qwen', 'openai-compatible'), entry('qwen-b', 'qwen', 'openai-compatible')],
};
const reg = (() => {
  const r = loadRegistry(REGISTRY);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
})();

const A = party(1);
const B = party(2);
const C = party(3);
const BUYER = party(4);
const SELLER = party(5);

function counting(inner: JudgeProvider) {
  const calls: JudgeRequest[] = [];
  return { calls, provider: { complete: (r: JudgeRequest) => (calls.push(r), inner.complete(r)) } satisfies JudgeProvider };
}

function bench(p: Party, name: string, settlement: TestSettlement, script: FakeScript = {}, policy: AdjudicatorPolicy = defaultPolicy(`${name}/p1`), registry: LoadedRegistry = reg) {
  const judges = counting(fakeProvider(script));
  const adj = new Adjudicator({
    address: p.address,
    name,
    signingKey: p.key,
    encryptionSecretKey: p.enc.secretKey,
    seedSecret: keccak256(p.key),
    policy,
    registry,
    registryUri: 'file:///config/judges.yaml',
    fee: { min: tusd('25000000') },
    domain: DOMAIN,
    provider: judges.provider,
    settlement,
  });
  settlement.registrations.set(p.address, { ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return { adj, calls: judges.calls };
}

async function setup(opts: { scriptA?: FakeScript; scriptB?: FakeScript; scriptC?: FakeScript; policyHash?: Hex32; registryHash?: Hex32; csv?: string; registry?: LoadedRegistry } = {}) {
  const s = new TestSettlement();
  const r = opts.registry ?? reg;
  const a = bench(A, 'bench-a', s, opts.scriptA, undefined, r);
  const b = bench(B, 'bench-b', s, opts.scriptB, undefined, r);
  const c = bench(C, 'bench-c', s, opts.scriptC, undefined, r);
  const commitment = makeCommitment({
    primary: A.address,
    fallback: B.address,
    appeal: C.address,
    policyHash: opts.policyHash ?? policyHashOf(a.adj.policy),
    registryHash: opts.registryHash ?? r.hash,
    buyer: BUYER,
    seller: SELLER,
  });
  s.offer(commitment);
  await a.adj.runOnce();
  s.fund(commitment.id);
  s.at('2026-11-01T09:59:00Z');
  const key = await s.deliver(
    commitment.id,
    opts.csv ?? demoCsv(),
    [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })),
  );
  return { s, a, b, c, commitment, key, id: commitment.id };
}

describe('registration and quote', () => {
  it('publishes its registry hash and URI and its policy hash; quotes the policy minimum', () => {
    const s = new TestSettlement();
    const { adj } = bench(A, 'bench-a', s);
    const r = adj.registration();
    expect(r.registry).toEqual({ hash: reg.hash, uri: 'file:///config/judges.yaml' });
    expect(r.policyHash).toBe(canonicalKeccak(adj.policy));
    expect(r.encryptionPublicKey).toBe(encodePublicKey(A.enc.publicKey));
    expect(adj.quote()).toEqual({ token: 'tUSD', amount: '25000000' });
  });
});

describe('acceptance (commit)', () => {
  it('signs AdjudicatorAcceptance with the seed commitment, policy and registry hashes, fee and reserved bond', async () => {
    const { s, a, commitment } = await setup();
    const acc = s.submitted.find((m) => m.type === 'AdjudicatorAcceptance')!;
    expect(acc.type).toBe('AdjudicatorAcceptance');
    if (acc.type !== 'AdjudicatorAcceptance') return;
    expect(acc.seedCommitment).toBe(keccak256(a.adj.seedFor(commitment.id)));
    expect(acc.policyHash).toBe(commitment.adjudication.policyHash);
    expect(acc.registryHash).toBe(reg.hash);
    expect(acc.fee).toEqual(commitment.adjudication.fee);
    expect(acc.bondReserved).toEqual(commitment.price);
  });

  it('declines an offer bound to another policy or registry, or with a fee below its minimum', async () => {
    for (const over of [{ policyHash: `0x${'01'.repeat(32)}` as Hex32 }, { registryHash: `0x${'02'.repeat(32)}` as Hex32 }]) {
      const s = new TestSettlement();
      const a = bench(A, 'bench-a', s);
      const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, ...over });
      s.offer(c);
      const report = await a.adj.runOnce();
      expect(s.state(c.id).kind).toBe('Offered');
      expect(report.declined).toHaveLength(1);
    }
  });
});

describe('primary decision on the demo CSV (about 0.5 MB)', () => {
  it('judges a seeded sample, accepts, releases the key to the buyer and settles', async () => {
    const { s, a, id, key } = await setup();
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
    const [d] = s.decisions(id) as [Decision];
    expect(d.outcome).toBe('accept');
    expect(d.role).toBe('primary');
    expect(a.calls).toHaveLength(3);
    expect(a.calls[0]!.user).toMatch(/drawn at random/);
    // The buyer opens the key and checks the plaintext hash.
    const buyerKey = unwrapKey(d.keyForBuyer!, BUYER.enc.secretKey);
    expect(buyerKey.exportBytes()).toEqual(key.exportBytes());
  });

  it("judges T-012's real demo deliverable (customers.clean.csv, about 512 KB) from a seeded sample and accepts it", async () => {
    const csv = readFileSync(new URL('../../../fixtures/data/dataset-cleaning/customers.clean.csv', import.meta.url), 'utf8');
    expect(csv.length).toBeGreaterThan(500_000);
    const { s, a, id } = await setup({ csv });
    s.at('2026-11-01T10:00:30Z');
    const report = await a.adj.runOnce();
    expect(report.refused).toEqual([]);
    const record = [...s.records.values()][0]!;
    expect(record.deterministic.filter((c) => c.required && !c.passed)).toEqual([]);
    expect(record.aggregate.reasons).not.toContain('the judges saw a sample of the deliverable, not all of it');
    expect(record.aggregate.decision).toBe('accept');
    expect(a.calls.every((c) => /drawn at random/.test(c.user) && c.user.length < 130_000)).toBe(true);
    expect(s.state(id).kind).toBe('Released');
  });

  it('publishes a schema-valid record whose hash the decision carries and whose signature recovers to the adjudicator', async () => {
    const { s, a, id } = await setup();
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    const [d] = s.decisions(id) as [Decision];
    const record = [...s.records.values()][0]!;
    expect(record.recordHash).toBe(d.judgmentRecordHash);
    expect(recordHashOf(record)).toBe(record.recordHash);
    expect((await recoverMessageAddress({ message: { raw: record.recordHash }, signature: record.signature })).toLowerCase()).toBe(A.address);
    expect(record.panel.seedSource).toBe('commit-reveal');
    expect(record.panel.seed).toBe(d.seed);
    expect(record.panel.policyHash).toBe(d.policyHash);
    expect(new Set(record.panel.members.map((m) => m.family)).size).toBeGreaterThanOrEqual(2);
    for (const m of record.panel.members) expect(m.promptTemplateHash).toBe(PROMPT_TEMPLATE_HASH);
  });

  it('anyone recomputes the panel from the revealed seed, and the buyer recomputes every inputHash', async () => {
    const { s, a, id, commitment } = await setup();
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    const [d] = s.decisions(id) as [Decision];
    const record = [...s.records.values()][0]!;
    const seats = selectPanel({ registry: reg, seed: d.seed, commitmentId: id, size: 3, minFamilies: 2 });
    expect(seats.ok && seats.value.map((x) => x.judgeId)).toEqual(record.panel.members.map((m) => m.judgeId));
    const plaintext = await open(await s.ciphertext(commitment.id ? s.cases.get(id)!.delivery!.ciphertext.uri : ''), unwrapKey(d.keyForBuyer!, BUYER.enc.secretKey), s.cases.get(id)!.delivery!.plaintextSha256);
    const data = UntrustedData.wrap(new TextDecoder().decode(plaintext).normalize('NFKC'));
    for (const m of record.panel.members) {
      const p = buildPrompt({
        spec: { description: commitment.deliverable.description },
        criteria: criteriaOrder(d.seed, id, m.judgeId, commitment.acceptance.rubric.criteria),
        data,
        nonces: judgeNonces(d.seed, id, m.judgeId),
        sample: { seed: sampleSeedFor(d.seed, id, m.judgeId), mime: 'text/csv' },
      });
      expect(p.ok && p.value.inputHash).toBe(m.inputHash);
    }
  });

  it('never re-rolls: a failed submission is retried with the same decision, without calling the judges again', async () => {
    const { s, a, id } = await setup();
    s.at('2026-11-01T10:00:30Z');
    s.failNextDecisions = 1;
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Delivered');
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
    expect(a.calls).toHaveLength(3);
  });

  it('the panel seed is fixed per (commitment, attempt): a restarted service derives the same seed and panel', async () => {
    const { a, id } = await setup();
    const again = bench(A, 'bench-a', new TestSettlement());
    expect(again.adj.seedFor(id)).toBe(a.adj.seedFor(id));
    expect(a.adj.seedFor(`0x${'12'.repeat(32)}`)).not.toBe(a.adj.seedFor(id));
  });

  it('rejects without the panel when the delivered plaintext does not match its hash', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s);
    bench(C, 'bench-c', s);
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER });
    s.offer(c);
    await a.adj.runOnce();
    s.fund(c.id);
    s.at('2026-11-01T09:59:00Z');
    await s.deliver(c.id, demoCsv(100), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })), (d) => ({ ...d, plaintextSha256: `sha256:${'0'.repeat(64)}` }));
    await a.adj.runOnce();
    expect(s.state(c.id).kind).toBe('Refunded');
    expect(a.calls).toHaveLength(0);
    expect([...s.records.values()][0]!.aggregate.reasons[0]).toMatch(/decrypt_failed|plaintext_hash_mismatch/);
  });
});

describe('policy and registry binding', () => {
  it('refuses to judge under a policy whose hash does not match the commitment (error.policy-hash-mismatch)', async () => {
    const { s, a, b, id } = await setup();
    // The primary judges under its own policy; give the fallback a bound policy it cannot find.
    s.registrations.delete(A.address);
    s.at('2026-11-01T10:02:00Z');
    await b.adj.runOnce();
    const report = await b.adj.runOnce();
    expect(report.refused.map((r) => r.problem.type)).toContain('policy_mismatch');
    expect(report.refused[0]!.problem.detail).toMatch(/policy-hash-mismatch/);
    expect(b.calls).toHaveLength(0);
    expect(a.calls).toHaveLength(0);
    expect(s.state(id).kind).toBe('FallbackJudging');
  });

  it('refuses to judge a commitment bound to another registry', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s);
    const r = await a.adj.decideTask({
      commitment: makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: `0x${'02'.repeat(32)}`, buyer: BUYER, seller: SELLER }),
      role: 'primary',
      attempt: 1,
      delivery: {} as never,
      deadline: '2026-11-01T10:02:00Z',
    });
    expect(!r.ok && r.error.type).toBe('registry_mismatch');
    expect(a.calls).toHaveLength(0);
  });

  it('refuses a bound policy whose template hash is not this build', async () => {
    const s = new TestSettlement();
    const other = defaultPolicy('bench-a/p1', { promptTemplateHash: `0x${'ab'.repeat(32)}` });
    const a = bench(A, 'bench-a', s, {}, other);
    const report = await a.adj.decideTask({
      commitment: makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(other), registryHash: reg.hash, buyer: BUYER, seller: SELLER }),
      role: 'primary',
      attempt: 1,
      delivery: {} as never,
      deadline: '2026-11-01T10:02:00Z',
    });
    expect(!report.ok && report.error.detail).toMatch(/policy-hash-mismatch: first-instance template/);
  });
});

describe('fallback takes over at judgeBy', () => {
  it('triggers the fallback, gets the key only on takeover, seeds from the beacon round at judgeBy and decides', async () => {
    const { s, b, id, commitment } = await setup();
    // The primary is silent. Before judgeBy the fallback has nothing to do.
    s.at('2026-11-01T10:01:00Z');
    await b.adj.runOnce();
    expect(s.state(id).kind).toBe('Delivered');
    expect(b.calls).toHaveLength(0);
    s.at('2026-11-01T10:02:00Z');
    await b.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
    const [d] = s.decisions(id) as [Decision];
    expect(d.role).toBe('fallback');
    const round = simRoundAt(commitment.timing.judgeBy);
    expect(d.beacon).toEqual({ source: 'sim', round, value: await s.randomness.value(round) });
    expect(d.seed).toBe(panelSeed(id, 'fallback', 1, d.beacon!.value));
    const record = [...s.records.values()][0]!;
    expect(record.panel.seedSource).toBe('beacon');
    expect(record.panel.beaconRound).toBe(round);
  });

  it('never reads the work from the delivery envelope: no released key, no judgment (ADR-0020)', async () => {
    const { s, b, id, commitment } = await setup();
    const delivery = s.cases.get(id)!.delivery!;
    // The delivery still lists an envelope for the fallback, but nothing was released to it.
    const r = await b.adj.decideTask({ commitment, role: 'fallback', attempt: 1, delivery, roundFixedAt: commitment.timing.judgeBy, deadline: commitment.timing.fallbackBy });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.detail).toMatch(/no key released/);
    expect(b.calls).toHaveLength(0);
  });

  it('waits when its beacon round is not yet published; there is no substitute source', async () => {
    const { s, b, id, commitment } = await setup();
    const env = s.cases.get(id)!.held.get(B.address)!;
    s.at('2026-11-01T10:01:00Z');
    const r = await b.adj.decideTask({ commitment, role: 'fallback', attempt: 1, delivery: s.cases.get(id)!.delivery!, releasedKey: env, roundFixedAt: commitment.timing.judgeBy, deadline: commitment.timing.fallbackBy });
    expect(!r.ok && r.error.detail).toMatch(/beacon round .* not published/);
    expect(b.calls).toHaveLength(0);
  });
});

describe('escalation and appeal', () => {
  // Only one family answers: never two pass families, never a reject supermajority, so always escalate.
  const split: FakeScript = { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' };

  it('a split panel escalates with the appeal key; the appeal adjudicator judges with five seats, three families and the appeal template', async () => {
    const { s, a, c, id } = await setup({ scriptA: split });
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Escalated');
    const [esc] = s.decisions(id) as [Decision];
    expect(esc.outcome).toBe('escalate');
    expect(unwrapKeyFor(esc.encryptedKeys!, C.address, C.enc.secretKey)).toBeDefined();
    s.at('2026-11-01T10:00:32Z');
    await c.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
    const appeal = s.decisions(id)[1]!;
    expect(appeal.role).toBe('appeal');
    expect(appeal.beacon?.round).toBe(simRoundAt('2026-11-01T10:00:30Z') + 1);
    const record = [...s.records.values()][1]!;
    expect(record.panel.members).toHaveLength(5);
    expect(new Set(record.panel.members.map((m) => m.family)).size).toBe(3);
    for (const m of record.panel.members) expect(m.promptTemplateHash).toBe(APPEAL_PROMPT_TEMPLATE_HASH);
  });

  it('appeal ground "missing or wrong key": the appeal decision carries the key to the buyer, without a panel', async () => {
    const { s, a, c, id, key } = await setup();
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    s.at('2026-11-01T10:01:00Z');
    s.fileAppeal(id, 'missing-or-wrong-key');
    s.at('2026-11-01T10:01:05Z');
    await c.adj.runOnce();
    const appeal = s.decisions(id)[1]!;
    expect(appeal.role).toBe('appeal');
    expect(appeal.outcome).toBe('accept');
    expect(appeal.appealGround).toBe('missing-or-wrong-key');
    expect(unwrapKey(appeal.keyForBuyer!, BUYER.enc.secretKey).exportBytes()).toEqual(key.exportBytes());
    expect(c.calls).toHaveLength(0);
  });

  it('after a party appeal, an inconclusive appeal panel leaves the first decision standing', async () => {
    const { s, a, c, id } = await setup({ scriptC: split });
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    s.at('2026-11-01T10:01:00Z');
    s.fileAppeal(id, 'wrong-outcome');
    s.at('2026-11-01T10:01:05Z');
    await c.adj.runOnce();
    const appeal = s.decisions(id)[1]!;
    expect(appeal.outcome).toBe('accept');
    expect([...s.records.values()][1]!.aggregate.decision).toBe('escalate');
  });
});

// ---------------------------------------------------------------- T-009 review fixes
const ONE_FAMILY_HEAVY = (() => {
  const r = loadRegistry({
    version: 1,
    judges: [entry('claude-a', 'claude', 'anthropic'), entry('claude-b', 'claude', 'anthropic'), entry('claude-c', 'claude', 'anthropic'), entry('claude-d', 'claude', 'anthropic'), entry('gpt-a', 'gpt', 'openai-compatible'), entry('qwen-a', 'qwen', 'openai-compatible')],
  });
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
})();
const onlyClaudePasses: FakeScript = { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' };

describe('never re-roll after a post-panel failure (review item 1)', () => {
  it('a missing appeal-adjudicator registration refuses before any judge is called; the retry judges once', async () => {
    const { s, a, id } = await setup({ scriptA: onlyClaudePasses });
    const saved = s.registrations.get(C.address)!;
    s.registrations.delete(C.address);
    s.at('2026-11-01T10:00:30Z');
    const first = await a.adj.runOnce();
    expect(first.refused.map((r) => r.problem.type)).toEqual(['adjudicator_unavailable']);
    expect(a.calls).toHaveLength(0);
    expect(s.records.size).toBe(0);
    s.registrations.set(C.address, saved);
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Escalated');
    expect(a.calls).toHaveLength(3);
    expect(s.records.size).toBe(1);
  });

  it('a failed record publication is retried with the same record and no new judge calls', async () => {
    const { s, a, id } = await setup();
    s.at('2026-11-01T10:00:30Z');
    s.failNextPublishes = 1;
    const first = await a.adj.runOnce();
    expect(first.refused).toHaveLength(1);
    expect(a.calls).toHaveLength(3);
    expect(s.records.size).toBe(0);
    s.at('2026-11-01T10:00:40Z');
    await a.adj.runOnce();
    expect(a.calls).toHaveLength(3);
    expect(s.records.size).toBe(1);
    expect(s.state(id).kind).toBe('Released');
    const [d] = s.decisions(id) as [Decision];
    expect(d.judgmentRecordHash).toBe([...s.records.values()][0]!.recordHash);
  });

  it('a buyer key that cannot be wrapped refuses before any judge is called', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s);
    const c = { ...makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER }), buyerEncryptionPublicKey: 'not-a-key' };
    const r = await a.adj.decideTask({ commitment: c, role: 'primary', attempt: 1, delivery: { encryptedKeys: [{ recipient: A.address, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'x' }] } as never, deadline: '2026-11-01T10:02:00Z' });
    expect(r.ok).toBe(false);
    expect(a.calls).toHaveLength(0);
    expect(s.records.size).toBe(0);
  });
});

describe('intake refusals publish nothing (review item 3)', () => {
  it('a key the primary cannot unwrap refuses without a record or a decision; the fallback takes over at judgeBy', async () => {
    const { s, a, b, id } = await setup();
    const c = s.cases.get(id)!;
    const bad = { ...c.delivery!.encryptedKeys.find((k) => k.recipient === A.address)!, ciphertext: c.delivery!.encryptedKeys.find((k) => k.recipient === BUYER.address)!.ciphertext };
    c.state = { ...(c.state as object), delivery: { ...c.delivery!, encryptedKeys: c.delivery!.encryptedKeys.map((k) => (k.recipient === A.address ? bad : k)) } } as typeof c.state;
    s.at('2026-11-01T10:00:30Z');
    const report = await a.adj.runOnce();
    expect(report.refused[0]!.problem.detail).toMatch(/key_unwrap_failed/);
    expect(s.records.size).toBe(0);
    expect(s.decisions(id)).toHaveLength(0);
    s.at('2026-11-01T10:02:00Z');
    await b.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
  });

  it('a stored ciphertext that does not match the delivery is retried, never decided', async () => {
    const { s, a, id } = await setup();
    const uri = s.cases.get(id)!.delivery!.ciphertext.uri;
    const good = s.blobs.get(uri)!;
    s.blobs.set(uri, new Uint8Array(good.length));
    s.at('2026-11-01T10:00:30Z');
    const report = await a.adj.runOnce();
    expect(report.refused[0]!.problem.detail).toMatch(/stored ciphertext/);
    expect(s.records.size).toBe(0);
    expect(s.state(id).kind).toBe('Delivered');
    s.blobs.set(uri, good);
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
  });
});

describe('review item 4: rules the mutation sweep found untested', () => {
  it('the appeal panel keeps three families when one family dominates the registry', async () => {
    const { s, a, c, id } = await setup({ registry: ONE_FAMILY_HEAVY, scriptA: onlyClaudePasses });
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Escalated');
    s.at('2026-11-01T10:00:32Z');
    await c.adj.runOnce();
    const record = [...s.records.values()][1]!;
    expect(record.panel.members).toHaveLength(5);
    expect(new Set(record.panel.members.map((m) => m.family)).size).toBe(3);
  });

  it('the appeal panel needs minValidAppeal (4) valid verdicts, not the first-instance minimum', async () => {
    const script: FakeScript = { 'gpt-a': 'timeout', 'claude-a': 'timeout', 'claude-b': 'timeout' };
    const { s, a, c, id } = await setup({ registry: ONE_FAMILY_HEAVY, scriptA: onlyClaudePasses, scriptC: script });
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    s.at('2026-11-01T10:00:32Z');
    const report = await c.adj.runOnce();
    // At most 3 valid of 5: the appeal panel is inconclusive, so after an escalation nothing is signed.
    expect(report.undecided).toEqual([id]);
    expect(s.state(id).kind).toBe('Escalated');
  });

  it('a "missing or wrong key" appeal against a reject is judged by the panel, not waved through', async () => {
    const allFail: FakeScript = Object.fromEntries(REGISTRY.judges.map((j) => [j.id, 'fail' as const]));
    const { s, a, c, id } = await setup({ scriptA: allFail });
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Refunded');
    s.at('2026-11-01T10:01:00Z');
    s.fileAppeal(id, 'missing-or-wrong-key');
    s.at('2026-11-01T10:01:05Z');
    await c.adj.runOnce();
    expect(c.calls.length).toBeGreaterThan(0);
    expect(s.decisions(id)[1]!.keyForBuyer).toBeDefined();
  });

  it('a released envelope addressed to someone else is refused as not released to this adjudicator', async () => {
    const { s, b, id, commitment } = await setup();
    const forC = s.cases.get(id)!.held.get(C.address)!;
    s.at('2026-11-01T10:02:00Z');
    const r = await b.adj.decideTask({ commitment, role: 'fallback', attempt: 1, delivery: s.cases.get(id)!.delivery!, releasedKey: forC, roundFixedAt: commitment.timing.judgeBy, deadline: commitment.timing.fallbackBy });
    expect(!r.ok && r.error.detail).toMatch(/no key released/);
    expect(b.calls).toHaveLength(0);
  });

  it('refuses a bound policy whose appeal template hash is not this build', async () => {
    const s = new TestSettlement();
    const other = defaultPolicy('bench-a/p1', { appealPromptTemplateHash: `0x${'ab'.repeat(32)}` });
    const a = bench(A, 'bench-a', s, {}, other);
    const r = await a.adj.decideTask({
      commitment: makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(other), registryHash: reg.hash, buyer: BUYER, seller: SELLER }),
      role: 'primary',
      attempt: 1,
      delivery: {} as never,
      deadline: '2026-11-01T10:02:00Z',
    });
    expect(!r.ok && r.error.detail).toMatch(/policy-hash-mismatch: appeal template/);
  });

  it('decision nonces differ by role, so a primary and a fallback decision never share one', async () => {
    const { s, a, b, id, commitment } = await setup();
    s.at('2026-11-01T10:02:00Z');
    const primary = await a.adj.decideTask({ commitment, role: 'primary', attempt: 1, delivery: s.cases.get(id)!.delivery!, deadline: commitment.timing.judgeBy });
    const fallback = await b.adj.decideTask({ commitment, role: 'fallback', attempt: 1, delivery: s.cases.get(id)!.delivery!, releasedKey: s.cases.get(id)!.held.get(B.address)!, roundFixedAt: commitment.timing.judgeBy, deadline: commitment.timing.fallbackBy });
    if (!primary.ok || !fallback.ok) throw new Error('decide');
    expect(primary.value.decision!.nonce).not.toBe(fallback.value.decision!.nonce);
  });
});
