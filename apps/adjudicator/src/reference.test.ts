// T-327: a deal whose terms name a reference file and make reference_row_match_min required. The adjudicator
// loads the reference from its content store by the hash the terms commit to, never from another source, and
// a reference it cannot read fails the check closed.
import { readFileSync } from 'node:fs';
import type { Commitment, Judgment } from '@holdback/core';
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
  /** Whether the reference's bytes are in the adjudicator's store (default true). */
  stored?: boolean;
  /** Checks-only (empty rubric), so stage 1 alone decides; default false: the example's rubric and a panel. */
  checksOnly?: boolean;
}

async function deal(o: Opts) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s);
  bench(B, 'bench-b', s);
  bench(C, 'bench-c', s);
  const bytes = encode(REFERENCE_CSV);
  const where = o.stored === false ? { uri: `mem://ciphertext/${sha256(bytes)}`, sha256: sha256(bytes) } : s.store(bytes);
  const check: JudgmentCheck = { id: 'ref', type: 'reference_row_match_min', required: true, reference: { ...where, ...o.reference }, keyColumn: 'customer_id', minBps: 9500 };
  const acceptance: Commitment['acceptance'] = {
    deterministicChecks: [...EXAMPLE.acceptance.deterministicChecks, check],
    rubric: o.checksOnly ? { criteria: [], passThreshold: 0 } : EXAMPLE.acceptance.rubric,
  } as Commitment['acceptance'];
  const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance });
  s.offer(c);
  await a.adj.runOnce();
  s.fund(c.id);
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(c.id, o.csv, [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
  s.at('2026-11-01T10:00:30Z');
  await a.adj.runOnce();
  const record = [...s.records.values()][0] as Judgment | undefined;
  return { s, a, c, id: c.id, record, ref: record?.deterministic.find((d) => d.checkId === 'ref'), referenceBytes: bytes, acceptance };
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

  it('a reference the store does not hold fails the check closed: Refunded, never a pass', async () => {
    const { s, id, ref } = await deal({ csv: demoCsv(), stored: false });
    expect(ref).toEqual({ checkId: 'ref', required: true, passed: false, detail: 'reference not available' });
    expect(s.state(id).kind).toBe('Refunded');
  });

  it('stored bytes that do not hash to the committed sha256 fail the check closed', async () => {
    // The terms commit to another hash, while the URI names the stored bytes: the adjudicator looks up only the
    // committed hash, so it finds nothing, and the bytes at the URI never reach the check.
    const { s, id, ref } = await deal({ csv: demoCsv(), reference: { sha256: `sha256:${'0'.repeat(64)}` } });
    expect(ref?.passed).toBe(false);
    expect(s.state(id).kind).toBe('Refunded');
  });

  it('a store that hands back other bytes under the committed hash fails the check closed', async () => {
    const s0 = await deal({ csv: demoCsv(), checksOnly: true });
    // A second deal over a tampered store: the same URI now holds other bytes.
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s);
    bench(B, 'bench-b', s);
    bench(C, 'bench-c', s);
    const check = s0.acceptance.deterministicChecks.find((c) => c.id === 'ref') as Extract<JudgmentCheck, { type: 'reference_row_match_min' }>;
    s.blobs.set(check.reference.uri, encode(REFERENCE_CSV.replace('customer0@', 'someone@')));
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance: s0.acceptance });
    s.offer(c);
    await a.adj.runOnce();
    s.fund(c.id);
    s.at('2026-11-01T09:59:00Z');
    await s.deliver(c.id, demoCsv(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
    s.at('2026-11-01T10:00:30Z');
    await a.adj.runOnce();
    const ref = [...s.records.values()][0]!.deterministic.find((d) => d.checkId === 'ref');
    expect(ref).toEqual({ checkId: 'ref', required: true, passed: false, detail: 'reference bytes do not match the committed hash' });
    expect(s.state(c.id).kind).toBe('Refunded');
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
