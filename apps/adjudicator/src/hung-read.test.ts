// T-372: a store read that never returns. T-347 made a read that fails cost only its own deal; a read that hangs
// stalled the whole pass, so every later deal went unjudged. Every read the pass awaits now has a time limit
// (`storeReadTimeoutMs`). Past it, the deal is refused as an unreadable delivery is: nothing is judged, signed or
// published, it is never reported as declined, the pass goes on, and the deal is tried again on a later pass.
import { readFileSync } from 'node:fs';
import type { Commitment, Hex32 } from '@holdback/core';
import { fakeProvider, loadRegistry, type JudgeRequest, type JudgmentCheck, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd } from './_sim.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator, DEFAULT_STORE_READ_TIMEOUT_MS, type RunReport } from './service.js';

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
const SELLERS = [party(5), party(6), party(7), party(8), party(9), party(10)];
const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Commitment;
/** The example's checks with an empty rubric, so stage 1 alone decides and no judge is called. */
const CHECKS_ONLY = { deterministicChecks: EXAMPLE.acceptance.deterministicChecks, rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];
/** The limit these tests run under, in milliseconds: short, so a hung read costs the test little. */
const LIMIT_MS = 40;
const never = <T>() => new Promise<T>(() => {});

function bench(p: typeof A, name: string, s: TestSettlement, storeReadTimeoutMs: number | undefined = LIMIT_MS) {
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
    ...(storeReadTimeoutMs !== undefined ? { storeReadTimeoutMs } : {}),
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return { adj, calls };
}

const recipients = () => [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey }));

/** A pass that must return within `ms`: today's hung read would leave it pending, and the test fails with a reason. */
async function pass(adj: Adjudicator, ms = 2_000): Promise<RunReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`the pass did not return within ${ms} ms: a store read stalled it`)), ms)));
  try {
    return await Promise.race([adj.runOnce(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** `n` funded, delivered deals with one primary, in task-list order. Returns their ciphertext URIs too. */
async function deals(n: number, acceptance: Commitment['acceptance'] = CHECKS_ONLY) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s);
  bench(B, 'bench-b', s);
  bench(C, 'bench-c', s);
  const cs = SELLERS.slice(0, n).map((seller) => makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller, acceptance }));
  for (const c of cs) s.offer(c);
  await pass(a.adj);
  for (const c of cs) s.fund(c.id);
  s.at('2026-11-01T09:59:00Z');
  for (const c of cs) await s.deliver(c.id, demoCsv(), recipients());
  s.at('2026-11-01T10:00:30Z');
  const uris = cs.map((c) => s.cases.get(c.id)!.delivery!.ciphertext.uri);
  return { s, a, cs, uris };
}

/** Makes the store hang forever on the URIs in `stuck`, counting each read it is asked for. */
function hang(s: TestSettlement, stuck: Set<string>) {
  const inner = s.ciphertext.bind(s);
  const reads = new Map<string, number>();
  s.ciphertext = (uri: string) => {
    reads.set(uri, (reads.get(uri) ?? 0) + 1);
    return stuck.has(uri) ? never<Uint8Array>() : inner(uri);
  };
  return reads;
}

describe('a store read that never returns (T-372)', () => {
  it('neutrality.store-hangs: the store never answers for one deal, and the two other deals in the same pass are judged', async () => {
    const { s, a, cs, uris } = await deals(3);
    const [first, stuck, last] = cs as [Commitment, Commitment, Commitment];
    hang(s, new Set([uris[1]!]));
    const report = await pass(a.adj);
    expect(report.decided).toEqual([
      { commitmentId: first.id, role: 'primary', outcome: 'accept' },
      { commitmentId: last.id, role: 'primary', outcome: 'accept' },
    ]);
    expect(s.state(first.id).kind).toBe('Released');
    expect(s.state(last.id).kind).toBe('Released');
    expect(report.refused).toEqual([{ commitmentId: stuck.id, problem: { type: 'adjudicator_unavailable', detail: expect.stringContaining(`did not answer within ${LIMIT_MS} ms`) } }]);
  });

  it('never decides on the timeout: nothing is judged, signed or published, it is not declined, and the deal stays Delivered', async () => {
    const { s, a, cs, uris } = await deals(2, EXAMPLE.acceptance);
    hang(s, new Set([uris[0]!]));
    const report = await pass(a.adj);
    const stuck = cs[0]!.id;
    expect(report.declined).toEqual([]);
    expect(s.decisions(stuck)).toEqual([]);
    expect([...s.records.values()].some((r) => r.commitmentId === stuck)).toBe(false);
    expect(s.state(stuck).kind).toBe('Delivered');
    const detail = report.refused.find((r) => r.commitmentId === stuck)?.problem.detail ?? '';
    expect(detail).toContain(uris[0]);
    expect(detail).toMatch(/not judged, retrying/);
  });

  it('a store that answers after the timeout: a later pass judges the bytes, and the judges were asked once', async () => {
    const { s, a, cs, uris } = await deals(1, EXAMPLE.acceptance);
    const inner = s.ciphertext.bind(s);
    let release: (() => void) | undefined;
    const late = new Promise<void>((r) => (release = r));
    let slow = true;
    s.ciphertext = async (uri: string) => {
      if (slow && uri === uris[0]) {
        slow = false;
        await late;
      }
      return inner(uri);
    };
    const first = await pass(a.adj);
    expect(first.refused.map((r) => r.commitmentId)).toEqual([cs[0]!.id]);
    release!();
    await new Promise((r) => setTimeout(r, 5));
    s.at('2026-11-01T10:01:00Z');
    const second = await pass(a.adj);
    expect(second.decided).toEqual([{ commitmentId: cs[0]!.id, role: 'primary', outcome: 'accept' }]);
    expect(new Set(a.calls.map((c) => c.judgeId)).size).toBe(a.calls.length);
  });

  it('many stuck deals: a later pass waits for none of their reads again, asks the store once each, and judges the healthy deal first', async () => {
    const { s, a, cs, uris } = await deals(6);
    const stuck = new Set(uris.slice(0, 5));
    const reads = hang(s, stuck);
    const first = await pass(a.adj, 5_000);
    expect(first.refused).toHaveLength(5);
    expect(first.decided.map((d) => d.commitmentId)).toEqual([cs[5]!.id]);
    const started = Date.now();
    const second = await pass(a.adj);
    // Each read still in flight from the first pass is joined, not asked again, and it has already used its limit.
    expect(Date.now() - started).toBeLessThan(LIMIT_MS * 5);
    expect(second.refused).toHaveLength(5);
    for (const uri of stuck) expect(reads.get(uri)).toBe(1);
  });

  it('a read in flight longer than its retire age is asked again, so a store that dropped one request is read anew', async () => {
    const { s, a, uris } = await deals(1);
    const reads = hang(s, new Set([uris[0]!]));
    await pass(a.adj);
    await new Promise((r) => setTimeout(r, LIMIT_MS * 7));
    await pass(a.adj);
    expect(reads.get(uris[0]!)).toBe(2);
  });

  it('a deal whose read timed out goes after the others on the next pass', async () => {
    const { s, a, cs, uris } = await deals(3);
    hang(s, new Set([uris[0]!]));
    // The first pass: the stuck deal is first in the list; the two others are judged, but their submissions fail, so
    // all three are still tasks on the next pass.
    s.failNextDecisions = 2;
    await pass(a.adj);
    const order: Hex32[] = [];
    const decide = a.adj.decideTask.bind(a.adj);
    a.adj.decideTask = (task) => (order.push(task.commitment.id), decide(task));
    await pass(a.adj);
    expect(order).toEqual([cs[1]!.id, cs[2]!.id, cs[0]!.id]);
  });

  it('a reference read that hangs at acceptance is refused and retried, never declined; the offer is accepted once the store answers', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s);
    bench(B, 'bench-b', s);
    bench(C, 'bench-c', s);
    const ref = new TextEncoder().encode('customer_id,email\n100000,customer0@example.com');
    const where = s.store(ref);
    const check: JudgmentCheck = { id: 'ref', type: 'reference_row_match_min', required: true, reference: where, keyColumn: 'customer_id', minBps: 9500 };
    const acceptance = { deterministicChecks: [...EXAMPLE.acceptance.deterministicChecks, check], rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLERS[0]!, acceptance });
    s.offer(c);
    const reads = hang(s, new Set([where.uri]));
    const first = await pass(a.adj);
    expect(first.declined).toEqual([]);
    expect(first.accepted).toEqual([]);
    expect(first.refused).toEqual([{ commitmentId: c.id, problem: { type: 'adjudicator_unavailable', detail: expect.stringContaining(`did not answer within ${LIMIT_MS} ms`) } }]);
    expect(reads.get(where.uri)).toBe(1);
    s.ciphertext = async (uri: string) => (uri === where.uri ? ref : never());
    await new Promise((r) => setTimeout(r, LIMIT_MS * 7));
    expect((await pass(a.adj)).accepted).toEqual([c.id]);
  });

  it('a task list that never answers: the offers in the same pass are still accepted, and the report says which list timed out', async () => {
    const { s, a } = await deals(1);
    const late = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLERS[5]!, acceptance: CHECKS_ONLY });
    s.offer(late);
    s.tasks = () => never();
    const report = await pass(a.adj);
    expect(report.accepted).toEqual([late.id]);
    expect(report.unavailable).toEqual([{ step: 'tasks', problem: { type: 'adjudicator_unavailable', detail: expect.stringContaining(`did not answer within ${LIMIT_MS} ms`) } }]);
  });

  it('a registration or bond read that never answers costs only its own deal', async () => {
    const { s, a, cs } = await deals(2);
    const bad = cs[0]!.id as Hex32;
    const inner = s.registration.bind(s);
    let calls = 0;
    s.registration = (addr: Hex32) => (calls++ === 0 ? never() : inner(addr));
    const report = await pass(a.adj);
    expect(report.refused.map((r) => r.commitmentId)).toEqual([bad]);
    expect(report.decided.map((d) => d.commitmentId)).toEqual([cs[1]!.id]);
  });

  it('the limit is a setting: the default is DEFAULT_STORE_READ_TIMEOUT_MS, and a limit that is not a positive number is refused at start', () => {
    expect(DEFAULT_STORE_READ_TIMEOUT_MS).toBe(10_000);
    const s = new TestSettlement();
    expect(() => bench(A, 'bench-a', s, undefined)).not.toThrow();
    for (const bad of [0, -1, Number.NaN]) expect(() => bench(A, 'bench-a', new TestSettlement(), bad)).toThrow(/storeReadTimeoutMs/);
  });

  it('names no store or relay error text in a refusal, since the demo publishes refusals on its state read', async () => {
    const { s, a } = await deals(1, EXAMPLE.acceptance);
    s.publishRecord = async () => {
      throw new Error('HTTP request failed. URL: https://rpc.example/v2/SECRETKEY');
    };
    const report = await pass(a.adj);
    expect(report.refused).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('SECRETKEY');
  });
});
