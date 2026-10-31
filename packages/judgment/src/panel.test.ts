// Seat selection by seeded shuffle over the bound registry (ADR-0006, ADR-0016, ADR-0018).
import { canonicalKeccak, type Hex32 } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { RUBRIC } from './_helpers.js';
import { criteriaOrder, judgeNonces, panelPlan, sampleSeedFor, selectPanel } from './panel.js';
import { loadRegistry, type RegistryDoc } from './providers/registry.js';

const CID: Hex32 = `0x${'11'.repeat(32)}`;
const seed = (n: number): Hex32 => `0x${n.toString(16).padStart(64, '0')}`;

const entry = (id: string, family: string, provider: 'anthropic' | 'openai-compatible', status: 'active' | 'candidate' | 'retired' = 'active') => ({
  id,
  provider,
  family,
  model: `${id}-model-20260601`,
  status,
});
const DOC: RegistryDoc = {
  version: 3,
  judges: [
    entry('claude-a', 'claude', 'anthropic'),
    entry('claude-b', 'claude', 'anthropic'),
    entry('claude-c', 'claude', 'anthropic'),
    entry('gpt-a', 'gpt', 'openai-compatible'),
    entry('gpt-b', 'gpt', 'openai-compatible'),
    entry('qwen-a', 'qwen', 'openai-compatible'),
    entry('claude-old', 'claude', 'anthropic', 'retired'),
    entry('gpt-new', 'gpt', 'openai-compatible', 'candidate'),
  ],
};
const loaded = () => {
  const r = loadRegistry(DOC);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
};

describe('registry loader', () => {
  it('hashes the canonical registry document (keccak256 of RFC 8785 JSON)', () => {
    expect(loaded().hash).toBe(canonicalKeccak(DOC));
  });
  it('keeps only active entries for selection, in id order', () => {
    expect(loaded().active.map((e) => e.id)).toEqual(['claude-a', 'claude-b', 'claude-c', 'gpt-a', 'gpt-b', 'qwen-a']);
    expect(loaded().judges.has('claude-old-model-20260601')).toBe(false);
  });
  it.each(['claude-latest', 'gpt-7', 'claude-opus-5-5-preview-20260601', 'model with space-20260601'])('refuses the unpinned or alias model ID %s', (model) => {
    const r = loadRegistry({ ...DOC, judges: [...DOC.judges, { ...entry('bad', 'claude', 'anthropic'), model }] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.detail).toMatch(/unpinned-model-refused/);
  });
  it('refuses an alias even on a retired entry', () => {
    const r = loadRegistry({ ...DOC, judges: [...DOC.judges, { ...entry('bad', 'claude', 'anthropic', 'retired'), model: 'claude-latest' }] });
    expect(r.ok).toBe(false);
  });
  it('refuses duplicate ids and duplicate model IDs', () => {
    expect(loadRegistry({ ...DOC, judges: [...DOC.judges, entry('claude-a', 'claude', 'anthropic')] }).ok).toBe(false);
    expect(loadRegistry({ ...DOC, judges: [...DOC.judges, { ...entry('dup', 'claude', 'anthropic'), model: 'claude-a-model-20260601' }] }).ok).toBe(false);
  });
  it('refuses floats in the hashed body (ADR-0022), unknown keys and unknown statuses', () => {
    expect(loadRegistry({ ...DOC, judges: [{ ...entry('m', 'claude', 'anthropic'), metrics: { falseAcceptBps: 1.2, falseRejectBps: 4, n: 40 } }] }).ok).toBe(false);
    expect(loadRegistry({ ...DOC, judges: [{ ...entry('m', 'claude', 'anthropic'), metrics: { falseAcceptBps: 120, falseRejectBps: 400, n: 40 } }] }).ok).toBe(true);
    expect(loadRegistry({ ...DOC, judges: [{ ...entry('m', 'claude', 'anthropic'), tools: ['web'] }] }).ok).toBe(false);
    expect(loadRegistry({ ...DOC, judges: [{ ...entry('m', 'claude', 'anthropic'), status: 'beta' }] }).ok).toBe(false);
  });
  it('refuses a registry that does not hash to the bound registryHash', () => {
    const r = loadRegistry(DOC, `0x${'00'.repeat(32)}`);
    expect(!r.ok && r.error.type).toBe('registry_mismatch');
    expect(loadRegistry(DOC, canonicalKeccak(DOC)).ok).toBe(true);
  });
});

describe('selectPanel', () => {
  const reg = loaded();
  const pick = (s: Hex32, size = 3, minFamilies = 2, id: Hex32 = CID) => {
    const r = selectPanel({ registry: reg, seed: s, commitmentId: id, size, minFamilies });
    if (!r.ok) throw new Error(r.error);
    return r.value.map((x) => x.judgeId);
  };

  it('anyone can recompute the panel from the seed, the commitment ID and the registry', () => {
    const again = loadRegistry(JSON.parse(JSON.stringify(DOC)) as RegistryDoc);
    if (!again.ok) throw new Error('reload');
    const a = selectPanel({ registry: reg, seed: seed(7), commitmentId: CID, size: 3, minFamilies: 2 });
    const b = selectPanel({ registry: again.value, seed: seed(7), commitmentId: CID, size: 3, minFamilies: 2 });
    expect(a).toEqual(b);
  });

  it('seats carry the registry family, provider and pinned model', () => {
    const r = selectPanel({ registry: reg, seed: seed(1), commitmentId: CID, size: 3, minFamilies: 2 });
    if (!r.ok) throw new Error(r.error);
    for (const s of r.value) {
      const e = reg.active.find((x) => x.id === s.judgeId)!;
      expect(s).toEqual({ judgeId: e.id, provider: e.provider, family: e.family, model: e.model });
    }
  });

  it('meets the family minimum for every seed, and never seats an inactive entry', () => {
    for (let i = 0; i < 300; i++) {
      const p = pick(seed(i));
      expect(p).toHaveLength(3);
      expect(new Set(p).size).toBe(3);
      expect(new Set(p.map((id) => id.split('-')[0])).size).toBeGreaterThanOrEqual(2);
      expect(p).not.toContain('claude-old');
      expect(p).not.toContain('gpt-new');
    }
    for (let i = 0; i < 100; i++) expect(new Set(pick(seed(i), 5, 3).map((id) => id.split('-')[0])).size).toBe(3);
  });

  it('the seed decides: every active entry is seated under some seed, none always', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 600; i++) for (const id of pick(seed(i))) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(reg.active.map((e) => e.id));
    // 6 entries, 3 seats: each about half the time.
    for (const n of counts.values()) expect(n).toBeGreaterThan(150);
    for (const n of counts.values()) expect(n).toBeLessThan(450);
  });

  it('the commitment ID is part of the key', () => {
    const other: Hex32 = `0x${'22'.repeat(32)}`;
    const differs = Array.from({ length: 40 }, (_, i) => pick(seed(i)).join() !== pick(seed(i), 3, 2, other).join()).filter(Boolean).length;
    expect(differs).toBeGreaterThan(10);
  });

  it('refuses when the registry cannot satisfy the size or the family minimum', () => {
    expect(selectPanel({ registry: reg, seed: seed(1), commitmentId: CID, size: 7, minFamilies: 2 }).ok).toBe(false);
    expect(selectPanel({ registry: reg, seed: seed(1), commitmentId: CID, size: 3, minFamilies: 4 }).ok).toBe(false);
  });
});

describe('per-judge derivations from the seed', () => {
  it('criteria order is a seeded permutation, fixed per judge', () => {
    const a = criteriaOrder(seed(3), CID, 'claude-a', RUBRIC.criteria);
    expect(a.map((c) => c.id).sort()).toEqual(RUBRIC.criteria.map((c) => c.id).sort());
    expect(criteriaOrder(seed(3), CID, 'claude-a', RUBRIC.criteria)).toEqual(a);
    const orders = new Set(Array.from({ length: 40 }, (_, i) => criteriaOrder(seed(i), CID, 'claude-a', RUBRIC.criteria).map((c) => c.id).join()));
    expect(orders.size).toBeGreaterThan(3);
  });

  it('nonces are 128-bit hex, fixed per judge, and differ across judges', () => {
    const a = judgeNonces(seed(3), CID, 'claude-a');
    expect(a.boundary).toMatch(/^[0-9a-f]{32}$/);
    expect(a.canary).toMatch(/^[0-9a-f]{32}$/);
    expect(a.canary).not.toBe(a.boundary);
    expect(judgeNonces(seed(3), CID, 'claude-a')).toEqual(a);
    expect(judgeNonces(seed(3), CID, 'gpt-a').boundary).not.toBe(a.boundary);
  });

  it('sample seeds differ per judge so the panel covers more of a large file', () => {
    expect(sampleSeedFor(seed(3), CID, 'claude-a')).not.toBe(sampleSeedFor(seed(3), CID, 'gpt-a'));
  });

  it('panelPlan bundles seats, nonces, criteria order and sample seeds for runPipeline', () => {
    const plan = panelPlan({ registry: loaded(), seed: seed(9), commitmentId: CID, size: 3, minFamilies: 2, criteria: RUBRIC.criteria });
    if (!plan.ok) throw new Error(plan.error);
    const s = plan.value.seats[0]!;
    expect(plan.value.nonces(s, 0)).toEqual(judgeNonces(seed(9), CID, s.judgeId));
    expect(plan.value.criteriaFor(s, 0)).toEqual(criteriaOrder(seed(9), CID, s.judgeId, RUBRIC.criteria));
    expect(plan.value.sampleSeed(s, 0)).toBe(sampleSeedFor(seed(9), CID, s.judgeId));
    expect(plan.value.registry.get(s.model)?.family).toBe(s.family);
  });
});
