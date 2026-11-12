// ADR-0036 (T-377): a deal is judged under the policy and the registry it bound, on every later build. The earlier
// build is an adjudicator configured with the earlier default; the deploy is a new Adjudicator for the same address on
// another default, registered again (the store keeps the earlier policy by hash, ADR-0030 §6).
import { type Hex32 } from '@holdback/core';
import { fakeProvider, loadRegistry, type JudgeProvider, type LoadedRegistry, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd, type Party } from './_sim.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator, type AdjudicatorConfig } from './service.js';

const entry = (id: string, family: string, provider: 'anthropic' | 'openai-compatible', stamp = '20260601') => ({ id, provider, family, model: `${id}-${stamp}`, status: 'active' as const });
const load = (doc: RegistryDoc): LoadedRegistry => {
  const r = loadRegistry(doc);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
};
const families = (stamp: string) => [
  entry('claude-a', 'claude', 'anthropic', stamp),
  entry('claude-b', 'claude', 'anthropic', stamp),
  entry('gpt-a', 'gpt', 'openai-compatible', stamp),
  entry('gpt-b', 'gpt', 'openai-compatible', stamp),
  entry('qwen-a', 'qwen', 'openai-compatible', stamp),
  entry('qwen-b', 'qwen', 'openai-compatible', stamp),
];
/** This build's default registry, and an earlier one with other pinned models. */
const REG = load({ version: 1, judges: families('20260601') });
const EARLIER_REG = load({ version: 1, judges: families('20260301') });

const A = party(1);
const B = party(2);
const C = party(3);
const BUYER = party(4);
const SELLER = party(5);

type Bench = { adj: Adjudicator; calls: () => number; models: () => string[] };

/** One adjudicator build: `over` sets its default policy, registry and kept registries. */
function bench(p: Party, name: string, s: TestSettlement, over: Partial<AdjudicatorConfig> = {}): Bench {
  let calls = 0;
  const models: string[] = [];
  const counting = (inner: JudgeProvider): JudgeProvider => ({ complete: (r) => (calls++, models.push(r.model), inner.complete(r)) });
  const keptRegistries = over.keptRegistries?.map((k) => ({ ...k, provider: counting(k.provider) }));
  const adj = new Adjudicator({
    address: p.address,
    name,
    signingKey: p.key,
    encryptionSecretKey: p.enc.secretKey,
    seedSecret: keccak256(p.key),
    policy: defaultPolicy(`${name}/p1`),
    registry: REG,
    registryUri: 'file:///config/judges.yaml',
    fee: { min: tusd('25000000') },
    domain: DOMAIN,
    settlement: s,
    trustedAdjudicators: [A.address, B.address, C.address],
    ...over,
    provider: counting(over.provider ?? fakeProvider({})),
    ...(keptRegistries ? { keptRegistries } : {}),
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return { adj, calls: () => calls, models: () => models };
}

/** A deal accepted and delivered on the earlier build; then all three adjudicators restart on `next`. */
async function acceptedThenDeployed(earlier: Partial<AdjudicatorConfig>, next: Partial<AdjudicatorConfig>) {
  const s = new TestSettlement();
  const old = bench(A, 'bench-a', s, earlier);
  const bound = old.adj.policy;
  const registryHash = (earlier.registry ?? REG).hash;
  const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(bound), registryHash, buyer: BUYER, seller: SELLER });
  s.offer(c);
  expect((await old.adj.runOnce()).accepted).toEqual([c.id]);
  s.fund(c.id);
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(c.id, demoCsv(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
  const a = bench(A, 'bench-a', s, { ...next, policy: next.policy ?? defaultPolicy('bench-a/p1') });
  const b = bench(B, 'bench-b', s, { ...next, policy: next.policy ? { ...next.policy, id: 'bench-b/p1' } : defaultPolicy('bench-b/p1') });
  const cc = bench(C, 'bench-c', s, { ...next, policy: next.policy ? { ...next.policy, id: 'bench-c/p1' } : defaultPolicy('bench-c/p1') });
  expect(await s.policy(policyHashOf(bound))).toEqual(bound);
  return { s, c, a, b, cc, bound };
}

describe('neutrality.deploy-changes-policy: a deal accepted under one policy is judged under it after a deploy', () => {
  it('the primary on the next build judges under the bound policy, and the deal ends Released', async () => {
    const { s, c, a, bound } = await acceptedThenDeployed({ policy: defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' }) }, {});
    expect(a.adj.policy.screenVersion).toBe('screen-1');
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.refused).toEqual([]);
    expect(r.decided.map((d) => [d.role, d.outcome])).toEqual([['primary', 'accept']]);
    expect(s.state(c.id).kind).toBe('Released');
    const record = [...s.records.values()][0]!;
    expect(record.panel.policyHash).toBe(policyHashOf(bound));
    expect(s.decisions(c.id)[0]!.policyHash).toBe(policyHashOf(bound));
    expect(a.calls()).toBe(3);
  });
});

describe('neutrality.deploy-changes-registry: a deal accepted under one registry is judged under it after a deploy', () => {
  it('the primary on the next build seats the bound registry, through its provider, and the deal ends Released', async () => {
    const { s, c, a } = await acceptedThenDeployed({ registry: EARLIER_REG }, { keptRegistries: [{ registry: EARLIER_REG, uri: 'file:///kept/earlier.yaml', provider: fakeProvider({}) }] });
    expect(a.adj.registration().registry.hash).toBe(REG.hash);
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.refused).toEqual([]);
    expect(r.decided.map((d) => [d.role, d.outcome])).toEqual([['primary', 'accept']]);
    expect(s.state(c.id).kind).toBe('Released');
    expect(s.decisions(c.id)[0]!.registryHash).toBe(EARLIER_REG.hash as Hex32);
    // Every seat is a model of the bound registry.
    expect(a.models().length).toBe(3);
    expect(a.models().every((m) => m.endsWith('-20260301'))).toBe(true);
  });
});
