import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Address, Delivery, Hex32, JudgeVerdict, Sha256 } from '@holdback/core';
import { APPEAL_PROMPT_TEMPLATE_HASH, PROMPT_TEMPLATE_HASH } from '@holdback/judgment';
import { loadTermsFile } from './fixture-files.js';
import { loadJudgeRegistry, runnerPolicy } from './judges-config.js';
import { runJudgment, type RunJudgmentInput } from './judgment.js';
import { FakeJudges, RecordingMissingError, type JudgeProvider, type JudgeRequest } from './recorded.js';

const repo = new URL('../../../', import.meta.url).pathname;
const h = (c: string) => `0x${c.repeat(64)}` as Hex32;
const sha = (b: Uint8Array): Sha256 => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const template = loadTermsFile(join(repo, 'fixtures/terms/clean-customers-2000.yaml'));
const criteria = template.acceptance.rubric.criteria.map((c) => c.id);
const registry = loadJudgeRegistry(repo);

function input(file: string, over: Partial<RunJudgmentInput> = {}): RunJudgmentInput {
  const plaintext = new Uint8Array(readFileSync(join(repo, 'fixtures/data/dataset-cleaning', file)));
  const delivery: Delivery = {
    commitmentId: h('1'),
    attempt: 1,
    ciphertext: { uri: 'sim://blobs/1', sha256: `sha256:${'0'.repeat(64)}`, bytes: plaintext.length + 16, cipher: 'aes-256-gcm' },
    plaintextSha256: sha(plaintext),
    plaintextMime: 'text/csv',
    encryptedKeys: [{ recipient: addr('a'), scheme: 'x25519-xsalsa20poly1305', ciphertext: 'AA' }],
    submittedAt: '2026-10-31T00:00:00Z',
    signature: `0x${'00'.repeat(65)}`,
  };
  return {
    scenario: 'unit',
    adjudicator: 'bench-a',
    adjudicatorAddress: addr('a'),
    role: 'primary',
    terms: { acceptance: template.acceptance, deliverable: template.deliverable } as RunJudgmentInput['terms'],
    commitmentId: h('1'),
    delivery,
    plaintext,
    source: `fixtures/data/dataset-cleaning/${file}`,
    seed: h('3'),
    seedCommitment: null,
    beaconRound: null,
    registry,
    policy: runnerPolicy('bench-a/p1'),
    ...over,
  };
}

/** Counts calls and scripts verdicts per judge; unscripted judges pass with full marks. */
function scripted(script: Record<string, Partial<JudgeVerdict>> = {}): JudgeProvider & { calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = [];
  const fake = new FakeJudges(criteria);
  return {
    kind: 'fake',
    calls,
    judge(req) {
      calls.push(req);
      const r = fake.judge(req);
      return { ...r, verdict: { ...r.verdict, ...script[req.judgeId] } };
    },
  };
}

const fail: Partial<JudgeVerdict> = { overall: 'fail', criteria: criteria.map((id) => ({ id, score: 1, evidence: 'short' })) };

describe('runJudgment: @holdback/judgment in the runner', () => {
  it('rejects on a failed required deterministic check without calling any judge', async () => {
    const judges = scripted();
    const r = await runJudgment(input('customers.clean.row-drop.csv'), judges);
    if (!r.ok) throw new Error(r.error.detail);
    expect(judges.calls).toHaveLength(0);
    expect(r.value.checks.find((c) => c.id === 'rows')).toMatchObject({ required: true, passed: false });
    expect(r.value.panel.ran).toBe(false);
    expect(r.value.aggregate.decision).toBe('reject');
    expect(r.value.aggregate.reasons.join()).toMatch(/required deterministic check failed: rows/);
    expect(r.value.outcome).toBe('reject');
  });

  it('seats three registry judges from at least two families and accepts a clean delivery', async () => {
    const judges = scripted();
    const r = await runJudgment(input('customers.clean.csv'), judges);
    if (!r.ok) throw new Error(r.error.detail);
    const members = r.value.panel.members;
    expect(members).toHaveLength(3);
    expect(new Set(members.map((m) => m.family)).size).toBeGreaterThanOrEqual(2);
    const models = new Map(registry.active.map((e) => [e.id, e.model]));
    for (const m of members) expect(m.model).toBe(models.get(m.judgeId));
    expect(judges.calls.every((c) => c.promptTemplateHash === PROMPT_TEMPLATE_HASH)).toBe(true);
    expect(r.value.checks.every((c) => c.passed)).toBe(true);
    expect(r.value.screen.flagged).toBe(false);
    expect(r.value.aggregate).toMatchObject({ decision: 'accept', weightedScore: 400 });
    expect(r.value.outcome).toBe('accept');
  });

  it('draws the same panel from the same seed, and another from another seed', async () => {
    const ids = async (seed: Hex32) => {
      const r = await runJudgment(input('customers.clean.csv', { seed }), scripted());
      if (!r.ok) throw new Error(r.error.detail);
      return r.value.panel.members.map((m) => m.judgeId);
    };
    expect(await ids(h('3'))).toEqual(await ids(h('3')));
    const all = await Promise.all(['4', '5', '6', '7', '8', '9'].map((c) => ids(h(c))));
    expect(new Set(all.map((x) => x.join())).size).toBeGreaterThan(1);
  });

  it('seats an appeal panel of five over three families under the appeal template', async () => {
    const judges = scripted();
    const r = await runJudgment(input('customers.clean.csv', { role: 'appeal', beaconRound: 12 }), judges);
    if (!r.ok) throw new Error(r.error.detail);
    expect(r.value.panel.members).toHaveLength(5);
    expect(new Set(r.value.panel.members.map((m) => m.family)).size).toBe(3);
    expect(r.value.panel).toMatchObject({ template: 'appeal', promptTemplateHash: APPEAL_PROMPT_TEMPLATE_HASH, seedSource: 'beacon', beaconRound: 12 });
    expect(judges.calls.every((c) => c.promptTemplateHash === APPEAL_PROMPT_TEMPLATE_HASH)).toBe(true);
  });

  it('rejects when two of three judges fail, and escalates a split it cannot resolve', async () => {
    const first = await runJudgment(input('customers.clean.csv'), scripted());
    if (!first.ok) throw new Error(first.error.detail);
    const [a, b, c] = first.value.panel.members.map((m) => m.judgeId) as [string, string, string];
    const rejected = await runJudgment(input('customers.clean.csv'), scripted({ [a]: fail, [b]: fail }));
    expect(rejected.ok && rejected.value.aggregate.decision).toBe('reject');
    const split = await runJudgment(input('customers.clean.csv'), scripted({ [c]: { overall: 'abstain' }, [b]: fail }));
    expect(split.ok && split.value.aggregate.decision).toBe('escalate');
  });

  it('escalates when a judge suspects injection', async () => {
    const first = await runJudgment(input('customers.clean.csv'), scripted());
    if (!first.ok) throw new Error(first.error.detail);
    const a = first.value.panel.members[0]!.judgeId;
    const r = await runJudgment(input('customers.clean.csv'), scripted({ [a]: { injectionSuspected: true } }));
    expect(r.ok && r.value.aggregate.decision).toBe('escalate');
    expect(r.ok && r.value.aggregate.reasons.join()).toMatch(/injection/);
  });

  it('maps an inconclusive appeal panel after escalation to no decision, and after a party appeal to the first outcome', async () => {
    const first = await runJudgment(input('customers.clean.csv', { role: 'appeal', beaconRound: 1 }), scripted());
    if (!first.ok) throw new Error(first.error.detail);
    const [a, b] = first.value.panel.members.map((m) => m.judgeId) as [string, string];
    const split = { [a]: fail, [b]: fail };
    const afterEscalation = await runJudgment(input('customers.clean.csv', { role: 'appeal', beaconRound: 1 }), scripted(split));
    expect(afterEscalation.ok && afterEscalation.value.aggregate.decision).toBe('escalate');
    expect(afterEscalation.ok && afterEscalation.value.outcome).toBeNull();
    const partyAppeal = await runJudgment(input('customers.clean.csv', { role: 'appeal', beaconRound: 1, firstOutcome: 'reject' }), scripted(split));
    expect(partyAppeal.ok && partyAppeal.value.outcome).toBe('reject');
  });

  it('rejects a delivery whose plaintext does not match its hash, without a panel', async () => {
    const i = input('customers.clean.csv');
    const judges = scripted();
    const r = await runJudgment({ ...i, delivery: { ...i.delivery, plaintextSha256: `sha256:${'f'.repeat(64)}` } }, judges);
    if (!r.ok) throw new Error(r.error.detail);
    expect(judges.calls).toHaveLength(0);
    expect(r.value.intake.hashVerified).toBe(false);
    expect(r.value.aggregate).toMatchObject({ decision: 'reject' });
    expect(r.value.aggregate.reasons.join()).toMatch(/plaintext_hash_mismatch/);
  });

  it('refuses a panel the registry cannot seat, as a problem rather than a verdict', async () => {
    const one = { ...registry, active: registry.active.filter((e) => e.family === 'claude') };
    const r = await runJudgment(input('customers.clean.csv', { registry: one }), scripted());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.type).toBe('invalid_terms');
  });

  it('lets a recording error escape the pipeline instead of becoming a judge error', async () => {
    const missing: JudgeProvider = {
      kind: 'recorded',
      judge: (req) => {
        throw new RecordingMissingError('/nowhere.json', req);
      },
    };
    await expect(runJudgment(input('customers.clean.csv'), missing)).rejects.toBeInstanceOf(RecordingMissingError);
  });
});
