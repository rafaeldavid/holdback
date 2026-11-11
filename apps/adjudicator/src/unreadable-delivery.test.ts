// T-347 (N80): a seller-signed delivery whose ciphertext no store returns. The seller never uploaded it, or the store
// lost or withholds it; the adjudicator cannot tell which. It follows the rule a ciphertext that does not match its
// delivery already has (mapIntakeError): the store, not only the seller, may be at fault, so the turn is not judged,
// nothing is signed or published, and it is retried on each pass. If the bytes never come, the fallback and then the
// default outcome follow, as for a reference the store withholds (T-327). One such deal never stops the pass for the
// others, and the pass's report names the missing ciphertext.
import { readFileSync } from 'node:fs';
import { step, type Commitment } from '@holdback/core';
import { fakeProvider, loadRegistry, type JudgeRequest, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd } from './_sim.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator } from './service.js';

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
const OTHER_SELLER = party(6);
const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Commitment;
/** The example's checks with an empty rubric, so stage 1 alone decides and no judge is called. */
const CHECKS_ONLY = { deterministicChecks: EXAMPLE.acceptance.deterministicChecks, rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];

function bench(p: typeof A, name: string, s: TestSettlement) {
  const calls: JudgeRequest[] = [];
  const inner = fakeProvider({});
  const adj = new Adjudicator({
    address: p.address,
    name,
    signingKey: p.key,
    encryptionSecretKey: p.enc.secretKey,
    seedSecret: keccak256(p.key),
    policy: defaultPolicy(`${name}/p1`),
    registry: reg,
    registryUri: 'file:///config/judges.yaml',
    fee: { min: tusd('25000000') },
    domain: DOMAIN,
    provider: { complete: (r: JudgeRequest) => (calls.push(r), inner.complete(r)) },
    settlement: s,
    trustedAdjudicators: [A.address, B.address, C.address],
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return { adj, calls };
}

const recipients = () => [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey }));

/**
 * Two funded deals with the same primary, the unreadable one first in the task list. Each seller signs its delivery;
 * then the store drops the first one's ciphertext, so no store returns it (`acceptance`: the deals' acceptance, default
 * checks only).
 */
async function twoDeals(acceptance: Commitment['acceptance'] = CHECKS_ONLY) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s);
  const b = bench(B, 'bench-b', s);
  bench(C, 'bench-c', s);
  const terms = (seller: typeof A) => makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller, acceptance });
  const bad = terms(SELLER);
  const good = terms(OTHER_SELLER);
  s.offer(bad);
  s.offer(good);
  await a.adj.runOnce();
  s.fund(bad.id);
  s.fund(good.id);
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(bad.id, demoCsv(), recipients());
  await s.deliver(good.id, demoCsv(), recipients());
  const delivery = s.cases.get(bad.id)!.delivery!;
  const bytes = s.blobs.get(delivery.ciphertext.uri)!;
  s.blobs.delete(delivery.ciphertext.uri);
  s.at('2026-11-01T10:00:30Z');
  return { s, a, b, bad, good, delivery, bytes };
}

describe('a delivery whose ciphertext no store returns (T-347)', () => {
  it('does not stop the pass: the other deal in the same pass is judged and settles', async () => {
    const { s, a, bad, good } = await twoDeals();
    const report = await a.adj.runOnce();
    expect(report.decided).toEqual([{ commitmentId: good.id, role: 'primary', outcome: 'accept' }]);
    expect(s.state(good.id).kind).toBe('Released');
    expect(report.refused.map((r) => r.commitmentId)).toEqual([bad.id]);
  });

  it('is not judged: no judge is called, nothing is published or signed, and the deal stays Delivered', async () => {
    const { s, a, bad, good } = await twoDeals(EXAMPLE.acceptance);
    await a.adj.runOnce();
    expect(s.decisions(bad.id)).toEqual([]);
    expect([...s.records.values()].map((r) => r.commitmentId)).toEqual([good.id]);
    expect(s.state(bad.id).kind).toBe('Delivered');
    // The good deal's panel ran; the bad deal called no judge (every request names its own commitment's input).
    const panel = a.calls.length;
    expect(panel).toBeGreaterThan(0);
    await a.adj.runOnce();
    expect(a.calls).toHaveLength(panel);
  });

  it("names the missing ciphertext in the pass's report: its URI and SHA-256, and that it was not judged", async () => {
    const { a, bad, delivery } = await twoDeals();
    const report = await a.adj.runOnce();
    const refusal = report.refused.find((r) => r.commitmentId === bad.id);
    expect(refusal?.problem.type).toBe('adjudicator_unavailable');
    expect(refusal?.problem.detail).toContain(delivery.ciphertext.uri);
    expect(refusal?.problem.detail).toContain(delivery.ciphertext.sha256);
    expect(refusal?.problem.detail).toMatch(/not judged, retrying/);
  });

  it('a ciphertext that arrives before judgeBy is judged normally on the next pass', async () => {
    const { s, a, bad, delivery, bytes } = await twoDeals();
    await a.adj.runOnce();
    expect(s.state(bad.id).kind).toBe('Delivered');
    s.blobs.set(delivery.ciphertext.uri, bytes);
    s.at('2026-11-01T10:01:30Z');
    const report = await a.adj.runOnce();
    expect(report.decided).toEqual([{ commitmentId: bad.id, role: 'primary', outcome: 'accept' }]);
    expect(s.state(bad.id).kind).toBe('Released');
  });

  it('never arrives: the fallback does not judge either, and the default outcome applies at fallbackBy', async () => {
    const { s, a, b, bad } = await twoDeals();
    await a.adj.runOnce();
    s.at(bad.timing.judgeBy);
    // Anyone may trigger the takeover; the fallback reads the same missing bytes and does not judge them.
    if (s.state(bad.id).kind === 'Delivered') expect((await s.triggerFallback(bad.id)).ok).toBe(true);
    const turn = await b.adj.runOnce();
    expect(turn.decided).toEqual([]);
    expect(turn.refused).toEqual([{ commitmentId: bad.id, problem: { type: 'adjudicator_unavailable', detail: expect.stringMatching(/ciphertext .* not judged, retrying/) } }]);
    expect(b.calls).toHaveLength(0);
    expect(s.decisions(bad.id)).toEqual([]);
    expect([...s.records.values()].some((r) => r.commitmentId === bad.id)).toBe(false);
    s.at(bad.timing.fallbackBy);
    const kept = s.cases.get(bad.id)!;
    for (const e of [{ type: 'trigger_default' as const, at: s.now() }, { type: 'apply_default_outcome' as const, at: s.now() }]) {
      const r = step(kept.state, e);
      if (!r.ok) throw new Error(r.error.detail);
      kept.state = r.value;
    }
    expect(s.state(bad.id)).toMatchObject({ via: { kind: 'default_outcome' } });
    expect(s.decisions(bad.id)).toEqual([]);
  });

  it('a store that returns other bytes under the URI is not judged either (the existing rule), and the pass goes on', async () => {
    const { s, a, bad, good, delivery, bytes } = await twoDeals();
    s.blobs.set(delivery.ciphertext.uri, bytes.map((x, i) => (i === 40 ? x ^ 1 : x)));
    const report = await a.adj.runOnce();
    expect(report.refused).toEqual([{ commitmentId: bad.id, problem: { type: 'invalid_state', detail: expect.stringMatching(/stored ciphertext does not match/) } }]);
    expect(s.decisions(bad.id)).toEqual([]);
    expect(s.state(good.id).kind).toBe('Released');
  });
});
