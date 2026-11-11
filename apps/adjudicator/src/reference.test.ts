// T-327: a deal whose terms name a reference file and make reference_row_match_min required. The adjudicator
// loads the reference from its content store by the hash the terms commit to, never from another source, and
// a reference it cannot read fails the check closed.
import { readFileSync } from 'node:fs';
import { step, type Commitment, type Judgment } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { fakeProvider, loadRegistry, preflightDelivery, type JudgeRequest, type JudgmentCheck, type RegistryDoc } from '@holdback/judgment';
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
const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Commitment;

/** The buyer's reference: 200 customers with the email it already holds for each. */
const REFERENCE_CSV = ['customer_id,email', ...Array.from({ length: 200 }, (_, k) => `${100000 + k},customer${k}@example.com`)].join('\n');
/** The demo CSV with every email on another domain: still valid emails, so only the reference check notices. */
const otherEmails = () => demoCsv().replaceAll('@example.com', '@example.org');

const encode = (s: string) => new TextEncoder().encode(s);

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

interface Opts {
  csv: string;
  /** The reference the terms name; `uri` and `sha256` default to where the store keeps REFERENCE_CSV. */
  reference?: Partial<{ uri: string; sha256: `sha256:${string}` }>;
  /** After acceptance, the store withholds the reference, or hands back other bytes under its hash (default: neither). */
  withhold?: 'missing' | 'other-bytes';
  /** Checks-only (empty rubric), so stage 1 alone decides; default false: the example's rubric and a panel. */
  checksOnly?: boolean;
}

/** An offer whose reference the store holds (`stored`, default true), and the primary's first pass over it. */
async function offer(o: { reference?: Opts['reference']; stored?: boolean } = {}) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s);
  const b = bench(B, 'bench-b', s);
  bench(C, 'bench-c', s);
  const bytes = encode(REFERENCE_CSV);
  const where = o.stored === false ? { uri: `mem://ciphertext/${sha256(bytes)}`, sha256: sha256(bytes) } : s.store(bytes);
  const check: JudgmentCheck = { id: 'ref', type: 'reference_row_match_min', required: true, reference: { ...where, ...o.reference }, keyColumn: 'customer_id', minBps: 9500 };
  return { s, a, b, bytes, uri: where.uri, check };
}

async function deal(o: Opts) {
  const { s, a, b, bytes, uri, check } = await offer(o.reference ? { reference: o.reference } : {});
  const acceptance: Commitment['acceptance'] = {
    deterministicChecks: [...EXAMPLE.acceptance.deterministicChecks, check],
    rubric: o.checksOnly ? { criteria: [], passThreshold: 0 } : EXAMPLE.acceptance.rubric,
  } as Commitment['acceptance'];
  const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance });
  s.offer(c);
  await a.adj.runOnce();
  s.fund(c.id);
  if (o.withhold === 'missing') s.blobs.delete(uri);
  if (o.withhold === 'other-bytes') s.blobs.set(uri, encode(REFERENCE_CSV.replace('customer0@', 'someone@')));
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(c.id, o.csv, [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
  s.at('2026-11-01T10:00:30Z');
  await a.adj.runOnce();
  const record = [...s.records.values()][0] as Judgment | undefined;
  return { s, a, b, c, id: c.id, uri, record, ref: record?.deterministic.find((d) => d.checkId === 'ref'), referenceBytes: bytes, acceptance };
}

describe('a required reference_row_match_min check on the adjudicator service (T-327)', () => {
  it('a delivery that matches the reference passes the check, and the deal ends Released', async () => {
    const { s, id, ref } = await deal({ csv: demoCsv() });
    expect(ref).toEqual({ checkId: 'ref', required: true, passed: true, detail: 'reference match 200/200' });
    expect(s.state(id).kind).toBe('Released');
  });

  it('a checks-only deal that matches ends Released with no panel', async () => {
    const { s, a, id, ref } = await deal({ csv: demoCsv(), checksOnly: true });
    expect(ref?.passed).toBe(true);
    expect(a.calls).toHaveLength(0);
    expect(s.state(id).kind).toBe('Released');
  });

  it('a delivery that does not match fails the check, rejects with no panel, and the deal ends Refunded', async () => {
    const { s, a, id, ref } = await deal({ csv: otherEmails() });
    expect(ref).toEqual({ checkId: 'ref', required: true, passed: false, detail: 'reference match 0/200 below 9500 bps' });
    expect(a.calls).toHaveLength(0);
    expect(s.state(id).kind).toBe('Refunded');
  });

  // Red team H1: a reference the store withholds or corrupts is the store's fault, like a ciphertext that does not
  // match its delivery. It is never judged: no record, no decision, no judge called; the turn is retried, and once
  // the store returns the committed bytes the deal settles by the terms. So no store decides a deal by one read.
  it('a reference the store does not return is not judged, and the retry settles once the store has it', async () => {
    const { s, a, id, record, referenceBytes } = await deal({ csv: demoCsv(), withhold: 'missing' });
    expect(record).toBeUndefined();
    expect(a.calls).toHaveLength(0);
    expect(s.state(id).kind).toBe('Delivered');
    const report = await a.adj.runOnce();
    expect(report.refused[0]?.problem.detail).toMatch(/reference files unavailable from this adjudicator's store: sha256:[0-9a-f]{64} \(the store did not return it\); not judged, retrying/);
    s.store(referenceBytes);
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
  });

  it('a store that hands back other bytes under the committed hash is not judged, then settles once it is right', async () => {
    const { s, a, id, record, referenceBytes, uri } = await deal({ csv: demoCsv(), withhold: 'other-bytes' });
    const report = await a.adj.runOnce();
    expect(record).toBeUndefined();
    expect(report.refused[0]?.problem.detail).toContain('(the store returned other bytes)');
    expect(s.records.size).toBe(0);
    expect(s.state(id).kind).toBe('Delivered');
    s.blobs.set(uri, referenceBytes);
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Released');
  });

  it('terms that commit to a hash no URI ends in fail the check closed, the same on every adjudicator', async () => {
    // The URI names the stored bytes, the committed hash is another: the hash is never looked up, so the check
    // fails with "reference not available" whatever any store holds. A party sees this in the terms before signing.
    const { s, id, ref } = await deal({ csv: demoCsv(), reference: { sha256: `sha256:${'0'.repeat(64)}` } });
    expect(ref).toEqual({ checkId: 'ref', required: true, passed: false, detail: 'reference not available' });
    expect(s.state(id).kind).toBe('Refunded');
  });

  it('a reference URI that does not end in the committed hash is never looked up', async () => {
    const asked: string[] = [];
    const s = new TestSettlement();
    const inner = s.ciphertext.bind(s);
    s.ciphertext = async (uri: string) => (asked.push(uri), inner(uri));
    const a = bench(A, 'bench-a', s);
    bench(B, 'bench-b', s);
    bench(C, 'bench-c', s);
    const where = s.store(encode(REFERENCE_CSV));
    const check: JudgmentCheck = { id: 'ref', type: 'reference_row_match_min', required: true, reference: { uri: 'https://buyer.example/reference.csv', sha256: where.sha256 }, keyColumn: 'customer_id', minBps: 9500 };
    const acceptance = { deterministicChecks: [check], rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance });
    s.offer(c);
    await a.adj.runOnce();
    s.fund(c.id);
    s.at('2026-11-01T09:59:00Z');
    await s.deliver(c.id, demoCsv(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    expect(asked.some((u) => u.includes('buyer.example'))).toBe(false);
    const ref = [...s.records.values()][0]!.deterministic.find((d) => d.checkId === 'ref');
    expect(ref).toEqual({ checkId: 'ref', required: true, passed: false, detail: 'reference not available' });
    expect(s.state(c.id).kind).toBe('Refunded');
  });
});

// T-327 review, finding 1 (High): an adjudicator that accepted a deal whose reference its store never held would
// refuse every turn, so a buyer and seller acting together could send the deal to its default outcome and take
// the bonds. An adjudicator agrees to serve a deal only when its store returns every reference the terms name.
describe('an adjudicator serves a deal only when its store holds the references (T-327 review)', () => {
  const acceptanceWith = (check: JudgmentCheck) => ({ deterministicChecks: [check], rubric: { criteria: [], passThreshold: 0 } }) as unknown as Commitment['acceptance'];

  it('the primary declines an offer whose reference its store does not return, and accepts it once the store has it', async () => {
    const { s, a, bytes, check } = await offer({ stored: false });
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance: acceptanceWith(check) });
    s.offer(c);
    const report = await a.adj.runOnce();
    expect(report.accepted).toEqual([]);
    expect(report.declined).toEqual([{ commitmentId: c.id, reason: expect.stringMatching(/reference .*not return/) }]);
    expect(s.state(c.id).kind).toBe('Offered');
    s.store(bytes);
    expect((await a.adj.runOnce()).accepted).toEqual([c.id]);
  });

  it('the primary declines an offer whose store hands back other bytes under the committed hash', async () => {
    const { s, a, uri, check } = await offer();
    s.blobs.set(uri, encode(REFERENCE_CSV.replace('customer0@', 'someone@')));
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance: acceptanceWith(check) });
    s.offer(c);
    const report = await a.adj.runOnce();
    expect(report.declined).toEqual([{ commitmentId: c.id, reason: expect.stringContaining('the store returned other bytes') }]);
  });

  it('declines() answers the same for every role before any deal exists', async () => {
    const { a, b, check } = await offer({ stored: false });
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance: acceptanceWith(check) });
    expect((await a.adj.declines(c, 'primary'))?.detail).toMatch(/reference/);
    expect((await b.adj.declines(c, 'fallback'))?.detail).toMatch(/reference/);
  });

  // Finding 2 (Medium): the store withholds the reference after acceptance. Nobody judges, the fallback does not take
  // a turn it cannot run, and the deal reaches its default outcome at fallbackBy: the path the terms already set.
  it('a reference withheld after acceptance: no decision, the fallback declines the takeover, and the default outcome applies', async () => {
    const { s, a, b, c, id } = await deal({ csv: demoCsv(), withhold: 'missing' });
    expect(s.records.size).toBe(0);
    expect(s.decisions(id)).toEqual([]);
    s.at(c.timing.judgeBy);
    const report = await b.adj.runOnce();
    expect(report.triggered).toEqual([]);
    expect(report.refused).toEqual([{ commitmentId: id, problem: { type: 'adjudicator_unavailable', detail: expect.stringMatching(/reference/) } }]);
    expect(b.calls).toHaveLength(0);
    expect(a.calls).toHaveLength(0);
    s.at(c.timing.fallbackBy);
    const kept = s.cases.get(id)!;
    for (const e of [{ type: 'trigger_default' as const, at: s.now() }, { type: 'apply_default_outcome' as const, at: s.now() }]) {
      const r = step(kept.state, e);
      if (!r.ok) throw new Error(r.error.detail);
      kept.state = r.value;
    }
    expect(s.state(id)).toMatchObject({ via: { kind: 'default_outcome' } });
    expect(s.decisions(id)).toEqual([]);
  });
});

describe("the seller's preflight gives the adjudicator's stage 1 for the same reference (T-327 parity)", () => {
  for (const [name, csv] of [
    ['matching', demoCsv()],
    ['not matching', otherEmails()],
  ] as const) {
    it(`${name}: the same outcome for every check, in order, and the same decision`, async () => {
      const { s, id, record, referenceBytes, acceptance } = await deal({ csv, checksOnly: true });
      const pre = preflightDelivery({
        plaintext: encode(csv),
        mime: 'text/csv',
        format: 'text/csv',
        acceptance,
        references: new Map([[(acceptance.deterministicChecks.find((c) => c.id === 'ref') as Extract<JudgmentCheck, { type: 'reference_row_match_min' }>).reference.sha256, referenceBytes]]),
      });
      expect(pre.deterministic).toEqual(record!.deterministic);
      expect(pre.result).toBe(s.state(id).kind === 'Released' ? 'accept' : 'reject');
    });
  }
});
