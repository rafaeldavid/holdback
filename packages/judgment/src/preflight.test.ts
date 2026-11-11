// T-316: what a seller's preflight reports for its own bytes is what the adjudicator's first stage reports
// for the same bytes. Every case runs both paths: the encrypted delivery through intake and the pipeline,
// and preflightDelivery on the plaintext.
import { readFileSync } from 'node:fs';
import type { MimeType } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ADJUDICATOR, delivery, fakeUnwrap, GOOD_CSV, NONCES, POLICY, RUBRIC, seal, sha256, utf8 } from './_helpers.js';
import { intake, MAX_PLAINTEXT_BYTES, type IntakeError } from './intake.js';
import { runPipeline, type JudgeProvider, type PanelSeat } from './pipeline.js';
import { preflightDelivery, type Preflight } from './preflight.js';
import type { JudgmentAcceptance, JudgmentCheck } from './terms.js';

const SEATS: PanelSeat[] = [
  { judgeId: 'claude-a', provider: 'anthropic', family: 'claude', model: 'claude-opus-5-5-20260601' },
  { judgeId: 'gpt-a', provider: 'openai-compatible', family: 'gpt', model: 'gpt-7-2026-05-01' },
  { judgeId: 'gemini-a', provider: 'google', family: 'gemini', model: 'gemini-4-pro-001' },
];
/** Every judge passes every criterion, so a panel that sits accepts. */
const passing = (acceptance: JudgmentAcceptance): JudgeProvider => ({
  async complete() {
    const criteria = acceptance.rubric.criteria.map((c) => ({ id: c.id, score: 4, evidence: 'ok' }));
    return { kind: 'ok', text: JSON.stringify({ criteria, overall: 'pass', injectionSuspected: false, rationale: 'r' }) };
  },
});

interface Case {
  plaintext: Uint8Array;
  mime: MimeType;
  acceptance: JudgmentAcceptance;
  format?: MimeType;
  references?: ReadonlyMap<string, Uint8Array>;
}
type Adjudicated =
  | { refused: IntakeError }
  | { refused?: undefined; deterministic: Preflight['deterministic']; decision: string; panelRan: boolean };

/** The adjudicator's path: the delivery as the seller would post it, through intake and then the pipeline. */
async function adjudicate(c: Case): Promise<Adjudicated> {
  const ciphertext = seal(c.plaintext);
  const intaken = await intake({
    delivery: delivery(c.plaintext, ciphertext, { plaintextMime: c.mime }),
    ciphertext,
    recipient: ADJUDICATOR,
    unwrapKey: fakeUnwrap,
    ...(c.format ? { format: c.format } : {}),
  });
  if (!intaken.ok) return { refused: intaken.error };
  const run = await runPipeline({
    intake: intaken.value,
    acceptance: c.acceptance,
    deliverable: { description: 'The agreed work.', ...(c.format ? { format: c.format } : {}) },
    policy: POLICY,
    seats: SEATS,
    provider: passing(c.acceptance),
    nonces: (_seat, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
    ...(c.references ? { references: c.references } : {}),
  });
  if (!run.ok) throw new Error(run.error.detail);
  return { deterministic: run.value.deterministic, decision: run.value.aggregate.decision, panelRan: run.value.panel.ran };
}

/** Runs both paths and holds the preflight to the adjudicator's result. Returns the preflight. */
async function agree(c: Case): Promise<Preflight> {
  const theirs = await adjudicate(c);
  const mine = preflightDelivery(c);
  expect(mine.plaintextSha256).toBe(sha256(c.plaintext));
  expect(mine.bytes).toBe(c.plaintext.length);
  if (theirs.refused) {
    expect(mine.refused?.code).toBe(theirs.refused.code);
    expect(mine.deterministic).toEqual([]);
    expect(mine.result).toBe('reject');
    return mine;
  }
  expect(mine.refused).toBeUndefined();
  expect(mine.deterministic).toEqual(theirs.deterministic);
  // When the checks decide alone, the preflight's result is the adjudicator's decision; otherwise the panel sat.
  if (mine.result === 'panel') expect(theirs.panelRan).toBe(true);
  else {
    expect(theirs.panelRan).toBe(false);
    expect(mine.result).toBe(theirs.decision);
  }
  return mine;
}

const NO_RUBRIC = { passThreshold: 0, criteria: [] };
const example = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.audit-report.example.json', import.meta.url), 'utf8'));
const AUDIT_CHECKS: JudgmentCheck[] = example.acceptance.deterministicChecks;
const AUDIT: JudgmentAcceptance = { deterministicChecks: AUDIT_CHECKS, rubric: NO_RUBRIC };
const AUDIT_RUBRIC: JudgmentAcceptance = { deterministicChecks: AUDIT_CHECKS, rubric: example.acceptance.rubric };
const report = (name: string) => new Uint8Array(readFileSync(new URL(`../../../fixtures/data/audit-report/${name}`, import.meta.url)));
const json = (plaintext: Uint8Array, acceptance: JudgmentAcceptance = AUDIT): Case => ({ plaintext, mime: 'application/json', format: 'application/json', acceptance });

const CSV_CHECKS: JudgmentCheck[] = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'name', 'email', 'signup_date', 'email_valid'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 1, max: 10 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
  { id: 'emails', type: 'regex_match_rate_min', required: false, column: 'email', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', minBps: 9700 },
  { id: 'hidden', type: 'hidden_characters_max', required: true, max: { total: 0 } },
];
/** GOOD_CSV with an email in every row, so the optional `emails` check passes too. */
const CLEAN_CSV = GOOD_CSV.replace('3,Alan Turing,,', '3,Alan Turing,alan@example.com,');
const csv = (text: string, acceptance: JudgmentAcceptance = { deterministicChecks: CSV_CHECKS, rubric: NO_RUBRIC }): Case => ({ plaintext: utf8(text), mime: 'text/csv', format: 'text/csv', acceptance });

describe('preflightDelivery: the audit-report sample deal (T-317)', () => {
  it.each(['report.json', 'report.reordered.json', 'report.no-findings.json'])('accepts %s on a checks-only deal, as the adjudicator does', async (name) => {
    const p = await agree(json(report(name)));
    expect(p.result).toBe('accept');
    expect(p.deterministic.map((o) => [o.checkId, o.passed])).toEqual([['report', true], ['scope', true], ['coverage', true], ['hidden', true]]);
  });

  it('rejects the report that misses one file in scope, with the adjudicator\'s detail', async () => {
    const p = await agree(json(report('report.missing-file.json')));
    expect(p.result).toBe('reject');
    expect(p.deterministic.filter((o) => !o.passed)).toEqual([{ checkId: 'coverage', required: true, passed: false, detail: 'schema: /filesReviewed: fewer than 3 items' }]);
  });

  it('says the panel decides next when a rubric deal passes its checks, and rejects before the panel when it does not', async () => {
    expect((await agree(json(report('report.json'), AUDIT_RUBRIC))).result).toBe('panel');
    expect((await agree(json(report('report.missing-file.json'), AUDIT_RUBRIC))).result).toBe('reject');
  });

  it('agrees on every report with one change', async () => {
    const base = JSON.parse(new TextDecoder().decode(report('report.json')));
    const edits: Array<(r: typeof base) => void> = [
      (r) => r.filesReviewed.pop(),
      (r) => r.filesReviewed.push('contracts/Other.sol'),
      (r) => (r.filesReviewed[1] = r.filesReviewed[0]),
      (r) => (r.commit = 'a'.repeat(40)),
      (r) => delete r.findings[1].pocFiles,
      (r) => (r.findings[2].severity = 'High'),
      (r) => (r.findings[0].file = 'contracts/Other.sol'),
      (r) => (r.findings[2].title += '​'),
      (r) => (r.notes = 'extra'),
      (r) => delete r.findings,
      (r) => (r.findings = []),
    ];
    await fc.assert(
      fc.asyncProperty(fc.subarray(edits.map((_, i) => i)), fc.boolean(), async (picked, rubric) => {
        const r = structuredClone(base);
        for (const i of picked) edits[i]!(r);
        await agree(json(utf8(JSON.stringify(r)), rubric ? AUDIT_RUBRIC : AUDIT));
      }),
      { numRuns: 60 },
    );
  });
});

describe('preflightDelivery: any bytes', () => {
  it('agrees on arbitrary text delivered as JSON or CSV', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.json(), fc.string({ unit: 'grapheme' })), fc.boolean(), async (text, asJson) => {
        await agree(asJson ? json(utf8(text)) : csv(text));
      }),
      { numRuns: 60 },
    );
  });

  it('agrees on arbitrary bytes, valid UTF-8 or not', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 200 }), async (bytes) => {
        await agree({ ...csv(''), plaintext: bytes });
      }),
      { numRuns: 60 },
    );
  });

  it('agrees on a CSV that passes, one that fails a required check, and one that fails only an optional check', async () => {
    expect((await agree(csv(CLEAN_CSV))).result).toBe('accept');
    const dup = await agree(csv(`${CLEAN_CSV}\n3,Alan Turing,alan@example.com,2024-03-04,false`));
    expect(dup.result).toBe('reject');
    expect(dup.deterministic.find((o) => o.checkId === 'uniq')).toMatchObject({ passed: false, detail: 'duplicate key at row 4' });
    // A failed optional check does not reject. It seats the panel, on a rubric deal and on a checks-only deal alike.
    for (const rubric of [RUBRIC, NO_RUBRIC]) {
      const optional = await agree(csv(GOOD_CSV, { deterministicChecks: CSV_CHECKS, rubric }));
      expect(optional.deterministic.find((o) => o.checkId === 'emails')).toMatchObject({ required: false, passed: false });
      expect(optional.result).toBe('panel');
    }
  });

  it('runs the checks on the bytes as delivered: a byte order mark is dropped, fullwidth digits are not folded', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(CLEAN_CSV)]);
    expect((await agree({ ...csv(''), plaintext: bom })).result).toBe('accept');
    const p = await agree(csv('customer_id\n１\n', { deterministicChecks: [{ id: 'digits', type: 'regex_match_rate_min', required: true, column: 'customer_id', pattern: '^[0-9]+$', minBps: 10000 }], rubric: NO_RUBRIC }));
    expect(p.result).toBe('reject');
  });

  it('agrees on a reference check, with and without the reference bytes', async () => {
    const reference = utf8('customer_id,name\n1,Ada Lovelace\n2,Grace Hopper\n');
    const check: JudgmentCheck = { id: 'ref', type: 'reference_row_match_min', required: true, reference: { uri: 'file:///ref.csv', sha256: sha256(reference) }, keyColumn: 'customer_id', minBps: 10000 };
    const acceptance = { deterministicChecks: [check], rubric: NO_RUBRIC };
    expect((await agree({ ...csv(GOOD_CSV, acceptance), references: new Map([[sha256(reference), reference]]) })).result).toBe('accept');
    const without = await agree(csv(GOOD_CSV, acceptance));
    expect(without.result).toBe('reject');
    expect(without.deterministic[0]!.detail).toBe('reference not available');
  });

  it('escalates, as the adjudicator does, when a check runs out of its work budget', async () => {
    const rows = Array.from({ length: 300 }, () => 'a'.repeat(9000)).join('\n');
    const slow: JudgmentCheck = { id: 'slow', type: 'regex_match_rate_min', required: true, column: 'v', pattern: '[a-z]{0,1000}[a-z]{0,1000}Z', minBps: 0 };
    const p = await agree(csv(`v\n${rows}`, { deterministicChecks: [slow], rubric: RUBRIC }));
    expect(p.result).toBe('escalate');
    expect(p.inconclusive).toEqual(['slow']);
    expect(p.deterministic[0]!.detail).toMatch(/budget/);
  });
});

describe('preflightDelivery: what intake refuses', () => {
  it('refuses a format outside the allowlist', async () => {
    const p = await agree({ plaintext: utf8(GOOD_CSV), mime: 'application/pdf' as MimeType, acceptance: { deterministicChecks: CSV_CHECKS, rubric: NO_RUBRIC } });
    expect(p.refused?.code).toBe('mime_not_allowed');
  });

  it('refuses a file in another format than the terms agreed', async () => {
    const p = await agree({ ...json(report('report.json')), mime: 'text/plain' });
    expect(p.refused).toEqual({ code: 'mime_mismatch', detail: 'delivered text/plain; the commitment agreed application/json' });
  });

  it('refuses a file over the 10 MB cap', async () => {
    const p = await agree({ ...csv(''), plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES + 1).fill(0x61) });
    expect(p.refused?.code).toBe('payload_too_large');
    expect(p.bytes).toBe(MAX_PLAINTEXT_BYTES + 1);
  });

  it('refuses bytes that are not UTF-8', async () => {
    const p = await agree({ ...csv(''), plaintext: new Uint8Array([0x63, 0x6f, 0xff, 0xfe]) });
    expect(p.refused).toEqual({ code: 'not_utf8', detail: 'plaintext is not valid UTF-8' });
  });

  it('accepts a file of exactly 10 MB at intake', async () => {
    const p = await agree({ ...csv('', { deterministicChecks: [], rubric: NO_RUBRIC }), plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES).fill(0x61) });
    expect(p.refused).toBeUndefined();
    expect(p.result).toBe('accept');
  });
});
