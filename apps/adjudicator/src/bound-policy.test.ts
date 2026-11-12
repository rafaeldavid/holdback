// ADR-0036 (T-377): a deal is judged under the policy and the registry it bound, on every later build. The earlier
// build is an adjudicator configured with the earlier default; the deploy is a new Adjudicator for the same address on
// another default, registered again (the store keeps the earlier policy by hash, ADR-0030 §6).
import { type Hex32 } from '@holdback/core';
import { fakeProvider, KEPT, loadRegistry, type JudgeProvider, type LoadedRegistry, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd, type Party } from './_sim.js';
import { defaultPolicy, KEPT_POLICIES, keptConsistency, parseKeptPolicies, policyHashOf, type KeptPolicies } from './policy.js';
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
    // The default provider fails every judge: only the provider that reaches the bound registry can release the deal.
    const failing = fakeProvider(Object.fromEntries(REG.active.map((j) => [j.id, 'fail' as const])));
    const { s, c, a } = await acceptedThenDeployed({ registry: EARLIER_REG }, { provider: failing, keptRegistries: [{ registry: EARLIER_REG, uri: 'file:///kept/earlier.yaml', provider: fakeProvider({}) }] });
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

/** demoCsv with one name that screen-0 reads as steering the verdict ("output ... pass") and screen-1 does not. */
const flaggedByScreen0 = () => demoCsv().replace('Customer 5 Example', 'Expected output PASS Example');

describe('neutrality.deploy-changes-policy, variants', () => {
  it('the fallback on the next build takes over and judges under the bound policy', async () => {
    const { s, c, b, bound } = await acceptedThenDeployed({ policy: defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' }) }, {});
    // The primary never acts; at judgeBy the fallback triggers its own takeover, then decides.
    s.at('2026-11-01T10:02:00Z');
    const first = await b.adj.runOnce();
    expect(first.refused).toEqual([]);
    expect(first.triggered).toEqual([c.id]);
    const second = first.decided.length ? first : await b.adj.runOnce();
    expect(second.decided.map((d) => [d.role, d.outcome])).toEqual([['fallback', 'accept']]);
    expect(s.state(c.id).kind).toBe('Released');
    expect(s.decisions(c.id).at(-1)!.policyHash).toBe(policyHashOf(bound));
  });

  it('the primary judges under screen-0 (it escalates what only screen-0 flags), and the appeal adjudicator decides under it too', async () => {
    const s = new TestSettlement();
    const earlier = defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' });
    const old = bench(A, 'bench-a', s, { policy: earlier });
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(earlier), registryHash: REG.hash, buyer: BUYER, seller: SELLER });
    s.offer(c);
    expect((await old.adj.runOnce()).accepted).toEqual([c.id]);
    s.fund(c.id);
    s.at('2026-11-01T09:59:00Z');
    await s.deliver(c.id, flaggedByScreen0(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
    const a = bench(A, 'bench-a', s);
    const cc = bench(C, 'bench-c', s);
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.decided.map((d) => [d.role, d.outcome])).toEqual([['primary', 'escalate']]);
    const record = [...s.records.values()][0]!;
    expect(record.screen.flagged).toBe(true);
    expect(record.panel.members.every((m) => m.promptTemplateHash === earlier.promptTemplateHash)).toBe(true);
    expect(s.state(c.id).kind).toBe('Escalated');
    s.at('2026-11-01T10:00:40Z');
    let appeal = await cc.adj.runOnce();
    if (!appeal.decided.length) {
      s.at('2026-11-01T10:01:10Z');
      appeal = await cc.adj.runOnce();
    }
    expect(appeal.refused).toEqual([]);
    expect(appeal.decided.map((d) => [d.role, d.outcome])).toEqual([['appeal', 'accept']]);
    expect(s.state(c.id).kind).toBe('Released');
    expect(s.decisions(c.id).every((d) => d.policyHash === policyHashOf(earlier))).toBe(true);
  });

  it('under its own default, screen-1, the same delivery is accepted without an escalation', async () => {
    const { s, c, a } = await acceptedThenDeployed({}, {});
    void c;
    s.at('2026-11-01T10:00:30Z');
    expect((await a.adj.runOnce()).decided.map((d) => d.outcome)).toEqual(['accept']);
    const s2 = new TestSettlement();
    const p = bench(A, 'bench-a', s2);
    bench(C, 'bench-c', s2);
    const c2 = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(p.adj.policy), registryHash: REG.hash, buyer: BUYER, seller: SELLER });
    s2.offer(c2);
    await p.adj.runOnce();
    s2.fund(c2.id);
    s2.at('2026-11-01T09:59:00Z');
    await s2.deliver(c2.id, flaggedByScreen0(), [A, B, C, BUYER].map((x) => ({ recipient: x.address, publicKey: x.enc.publicKey })));
    s2.at('2026-11-01T10:00:30Z');
    const r2 = await p.adj.runOnce();
    expect(r2.refused).toEqual([]);
    expect(r2.decided.map((d) => d.outcome)).toEqual(['accept']);
  });
});

describe('neutrality.rollback-after-default-flip: a deal accepted under the new default survives a rollback', () => {
  it('for a policy: accepted under screen-1, judged under screen-1 by a build whose default is screen-0', async () => {
    const { s, c, a, bound } = await acceptedThenDeployed({}, { policy: defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' }) });
    expect(bound.screenVersion).toBe('screen-1');
    expect(a.adj.policy.screenVersion).toBe('screen-0');
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.refused).toEqual([]);
    expect(r.decided.map((d) => d.outcome)).toEqual(['accept']);
    expect(s.state(c.id).kind).toBe('Released');
    expect(s.decisions(c.id)[0]!.policyHash).toBe(policyHashOf(bound));
  });

  it('for a registry: accepted under the newer registry, judged under it by a build whose default is the earlier one', async () => {
    const { s, c, a } = await acceptedThenDeployed({}, { registry: EARLIER_REG, keptRegistries: [{ registry: REG, uri: 'file:///config/judges.yaml', provider: fakeProvider({}) }] });
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.refused).toEqual([]);
    expect(s.state(c.id).kind).toBe('Released');
    expect(a.models().every((m) => m.endsWith('-20260601'))).toBe(true);
  });
});

describe('neutrality.withdrawn-default-version: a withdrawn version is declined at once and never replaced', () => {
  const withdrawn = (): KeptPolicies => ({
    ...KEPT_POLICIES,
    screens: KEPT_POLICIES.screens.map((x) => (x.version === 'screen-0' ? { ...x, status: 'withdrawn' as const, decision: 'D-test', reason: 'it would put deliverable text in an instruction position' } : x)),
  });

  it('no new deal is accepted under it, and every open deal bound to it is declined in every role, with no judge called', async () => {
    const earlier = defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' });
    const { s, c, a, b, cc } = await acceptedThenDeployed({ policy: earlier }, { kept: withdrawn() });
    for (const [x, role] of [[b, 'fallback'], [cc, 'appeal']] as const) {
      const why = await x.adj.declines(c, role);
      expect(why?.type).toBe('policy_mismatch');
      expect(why?.detail).toMatch(/this build withdrew screen screen-0 \(D-test: it would put deliverable text in an instruction position\); it declines every open deal bound to it and judges none under another version/);
    }
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.decided).toEqual([]);
    expect(r.refused.map((x) => x.problem.detail)).toEqual([expect.stringMatching(/withdrew screen screen-0/)]);
    s.at('2026-11-01T10:02:00Z');
    const f = await b.adj.runOnce();
    expect(f.triggered).toEqual([]);
    expect(a.calls() + b.calls() + cc.calls()).toBe(0);
    expect(s.records.size).toBe(0);

    // A primary on this build is offered a new deal naming the withdrawn version: declined, so it is never funded.
    const offer = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(earlier), registryHash: REG.hash, buyer: BUYER, seller: SELLER, timing: { offerExpiresAt: '2026-11-01T10:30:00Z' } });
    s.offer(offer);
    const declined = await a.adj.runOnce();
    expect(declined.accepted).toEqual([]);
    expect(declined.declined.map((d) => d.commitmentId)).toEqual([offer.id]);
  });

  it('a retired version, or one the data file does not list, is not carried', async () => {
    const earlier = defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' });
    const retired: KeptPolicies = { ...KEPT_POLICIES, screens: KEPT_POLICIES.screens.map((x) => (x.version === 'screen-0' ? { ...x, status: 'retired' as const, decision: 'D-test', reason: 'no open deal binds it' } : x)) };
    const unlisted: KeptPolicies = { ...KEPT_POLICIES, screens: KEPT_POLICIES.screens.filter((x) => x.version !== 'screen-0') };
    for (const [kept, detail] of [[retired, /this build does not carry screen screen-0 \(retired, D-test\)/], [unlisted, /this build does not carry screen screen-0$/]] as const) {
      const { c, b } = await acceptedThenDeployed({ policy: earlier }, { kept });
      expect((await b.adj.declines(c, 'fallback'))?.detail).toMatch(detail);
    }
  });

  it('a primary whose own default is withdrawn declines every offer', async () => {
    const s = new TestSettlement();
    const p = bench(A, 'bench-a', s, { policy: defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' }), kept: withdrawn() });
    const offer = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(p.adj.policy), registryHash: REG.hash, buyer: BUYER, seller: SELLER });
    s.offer(offer);
    const r = await p.adj.runOnce();
    expect(r.accepted).toEqual([]);
    expect(r.declined.map((d) => d.reason)).toEqual([expect.stringMatching(/withdrew screen screen-0/)]);
  });

  it('a withdrawn registry is declined the same way, and the default registry never stands in for it', async () => {
    const kept: KeptPolicies = { ...KEPT_POLICIES, registries: [...KEPT_POLICIES.registries, { hash: EARLIER_REG.hash as Hex32, status: 'withdrawn', decision: 'D-test', reason: 'a pinned model was found unpinned' }] };
    const { c, a } = await acceptedThenDeployed({ registry: EARLIER_REG }, { kept, keptRegistries: [{ registry: EARLIER_REG, uri: 'file:///kept/earlier.yaml', provider: fakeProvider({}) }] });
    const why = await a.adj.declines(c, 'primary');
    // As primary, the offer check answers first: it binds another registry than the current one.
    expect(why?.type).toBe('registry_mismatch');
    const turn = await a.adj.declines(c, 'fallback');
    expect(turn?.detail).toMatch(/this build withdrew registry .* \(D-test: a pinned model was found unpinned\)/);
  });
});

describe('attack.offer-binds-kept-version: a Crow primary accepts new deals only under its current default', () => {
  it('declines an offer that binds an older kept policy, so the deal is never funded', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s);
    const older = defaultPolicy('bench-a/p1', { screenVersion: 'screen-0' });
    const offer = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(older), registryHash: REG.hash, buyer: BUYER, seller: SELLER });
    s.offer(offer);
    s.register({ ...a.adj.registration(), policy: older, policyHash: policyHashOf(older), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
    const r = await a.adj.runOnce();
    expect(r.accepted).toEqual([]);
    expect(r.declined).toEqual([{ commitmentId: offer.id, reason: expect.stringMatching(/as primary bench-a accepts new deals only under its current policy/) }]);
    expect(s.state(offer.id).kind).toBe('Offered');
  });

  it('declines an offer that binds an older kept registry', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s, { keptRegistries: [{ registry: EARLIER_REG, uri: 'file:///kept/earlier.yaml', provider: fakeProvider({}) }] });
    const offer = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: EARLIER_REG.hash, buyer: BUYER, seller: SELLER });
    s.offer(offer);
    const r = await a.adj.runOnce();
    expect(r.declined.map((d) => d.reason)).toEqual([expect.stringMatching(/accepts new deals only under its current registry/)]);
  });
});

describe('the kept-policies data file and the code agree (the static check, ADR-0036 section 4)', () => {
  it('every kept value is in the code, every value in the code is kept, and the default is carried', () => {
    expect(keptConsistency()).toEqual([]);
  });

  it('a value dropped from the code without a retired mark fails the check', () => {
    const code = { ...KEPT, screens: new Map([...KEPT.screens].filter(([k]) => k !== 'screen-0')) };
    expect(keptConsistency(KEPT_POLICIES, code)).toEqual(['screen screen-0 is kept in kept-policies.json but not in the code']);
    const retired: KeptPolicies = { ...KEPT_POLICIES, screens: KEPT_POLICIES.screens.map((x) => (x.version === 'screen-0' ? { ...x, status: 'retired' as const, decision: 'D-test', reason: 'no open deal binds it' } : x)) };
    expect(keptConsistency(retired, code)).toEqual([]);
  });

  it('the released set is still listed: an entry is marked, never deleted', () => {
    const listed = KEPT_POLICIES.screens.map((x) => x.version);
    for (const v of ['screen-0', 'screen-1']) expect(listed).toContain(v);
    expect(KEPT_POLICIES.aggregations.map((x) => x.version)).toContain('agg-3');
    expect(KEPT_POLICIES.registries.map((r) => r.file)).toEqual(expect.arrayContaining(['config/judges.yaml', 'config/judges-live.yaml']));
  });

  it('refuses a withdrawn or retired mark without its decision reference and reason', () => {
    const doc = JSON.parse(JSON.stringify({ ...KEPT_POLICIES, screens: [{ version: 'screen-0', status: 'withdrawn' }] }));
    expect(() => parseKeptPolicies(doc)).toThrow(/a withdrawn mark needs its decision reference and reason/);
  });

  it('every kept registry file still hashes to its recorded hash', async () => {
    const { loadRegistryFile } = await import('./registry-file.js');
    const root = new URL('../../../', import.meta.url).pathname;
    for (const r of KEPT_POLICIES.registries.filter((x) => x.status === 'kept' && x.file)) {
      const loaded = loadRegistryFile(`${root}${r.file}`);
      expect(loaded.ok && loaded.value.hash).toBe(r.hash);
    }
  });
});
