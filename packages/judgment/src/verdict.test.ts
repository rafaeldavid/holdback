import { describe, expect, it } from 'vitest';
import { NONCES } from './_helpers.js';
import { parseVerdict } from './verdict.js';

const IDS = ['dedupe_quality', 'no_fabrication', 'notes'];
const good = {
  criteria: IDS.map((id) => ({ id, score: 4, evidence: 'ok' })),
  overall: 'pass',
  injectionSuspected: false,
  rationale: 'Sampled rows match.',
};
const parse = (raw: unknown, over: Partial<Parameters<typeof parseVerdict>[1]> = {}) =>
  parseVerdict(typeof raw === 'string' ? raw : JSON.stringify(raw), { criterionIds: IDS, canary: NONCES.canary, rationaleMaxChars: 600, ...over });

describe('parseVerdict', () => {
  it('accepts a schema-valid verdict with exactly the rubric criteria', () => {
    expect(parse(good)).toEqual({ status: 'ok', verdict: good });
  });

  it('accepts criteria in any order', () => {
    expect(parse({ ...good, criteria: [...good.criteria].reverse() }).status).toBe('ok');
  });

  it('accepts surrounding whitespace only', () => expect(parse(`\n  ${JSON.stringify(good)}  \n`).status).toBe('ok'));

  it.each([
    ['not JSON', 'Sure! Here is my verdict: pass', 'not_json'],
    ['markdown fenced', `\`\`\`json\n${JSON.stringify(good)}\n\`\`\``, 'not_json'],
    ['extra property', { ...good, approved: true }, 'schema'],
    ['score out of range', { ...good, criteria: [{ ...good.criteria[0], score: 5 }, ...good.criteria.slice(1)] }, 'schema'],
    ['score not integer', { ...good, criteria: [{ ...good.criteria[0], score: 3.5 }, ...good.criteria.slice(1)] }, 'schema'],
    ['bad overall', { ...good, overall: 'accept' }, 'schema'],
    ['missing injectionSuspected', { criteria: good.criteria, overall: 'pass', rationale: 'x' }, 'schema'],
    ['rationale over 600', { ...good, rationale: 'x'.repeat(601) }, 'schema'],
    ['array', [good], 'schema'],
    ['null', 'null', 'schema'],
    ['missing criterion', { ...good, criteria: good.criteria.slice(1) }, 'criteria_mismatch'],
    ['extra criterion', { ...good, criteria: [...good.criteria, { id: 'bonus', score: 4, evidence: '' }] }, 'criteria_mismatch'],
    ['duplicate criterion', { ...good, criteria: [good.criteria[0], good.criteria[0], good.criteria[1]] }, 'criteria_mismatch'],
    ['renamed criterion', { ...good, criteria: [{ ...good.criteria[0], id: 'dedupe' }, ...good.criteria.slice(1)] }, 'criteria_mismatch'],
    ['URL in rationale', { ...good, rationale: 'see https://evil.example/x' }, 'url'],
    ['URL in evidence', { ...good, criteria: [{ ...good.criteria[0], evidence: 'www.evil.example' }, ...good.criteria.slice(1)] }, 'url'],
    ['URL in injectionEvidence', { ...good, injectionEvidence: 'ftp://x.y/z' }, 'url'],
    ['canary echoed', { ...good, rationale: `token ${NONCES.canary}` }, 'canary_echo'],
  ])('abstains on %s', (_name, raw, reason) => {
    const r = parse(raw);
    expect(r.status).toBe('abstain');
    if (r.status === 'abstain') expect(r.reason).toBe(reason);
  });

  it('abstains when the canary appears anywhere in the raw output, even outside valid JSON', () => {
    const r = parse(`${JSON.stringify(good)}${NONCES.canary}`);
    expect(r.status === 'abstain' && r.reason).toBe('canary_echo');
  });

  it('abstains on output over the size cap without parsing it', () => {
    const r = parse(' '.repeat(70_000) + JSON.stringify(good));
    expect(r.status === 'abstain' && r.reason).toBe('too_long');
  });

  it('applies a tighter policy rationale cap', () => {
    const r = parse({ ...good, rationale: 'x'.repeat(200) }, { rationaleMaxChars: 100 });
    expect(r.status === 'abstain' && r.reason).toBe('schema');
  });

  it('an empty rubric expects an empty criteria list', () => {
    expect(parse({ ...good, criteria: [] }, { criterionIds: [] }).status).toBe('ok');
    expect(parse(good, { criterionIds: [] }).status).toBe('abstain');
  });

  it('keeps a model-chosen abstain as a valid verdict with overall abstain', () => {
    const r = parse({ ...good, overall: 'abstain' });
    expect(r.status === 'ok' && r.verdict.overall).toBe('abstain');
  });

  it('returns a private copy', () => {
    const raw = JSON.stringify(good);
    const r = parse(raw);
    if (r.status !== 'ok') throw new Error('expected ok');
    r.verdict.criteria[0]!.score = 0;
    expect(parse(raw)).toEqual({ status: 'ok', verdict: good });
  });
});
