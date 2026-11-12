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
    expect(parse(good)).toEqual({ status: 'ok', verdict: good, redactedUrls: 0 });
  });

  it('accepts criteria in any order', () => {
    expect(parse({ ...good, criteria: [...good.criteria].reverse() }).status).toBe('ok');
  });

  it('accepts surrounding whitespace only', () => expect(parse(`\n  ${JSON.stringify(good)}  \n`).status).toBe('ok'));

  it.each([
    ['score -0', JSON.stringify(good).replaceAll('"score":4', '"score":-0')],
    ['score 4.0', JSON.stringify(good).replaceAll('"score":4', '"score":4.0')],
    ['score 3.9999999999999999 (parses as 4)', JSON.stringify(good).replaceAll('"score":4', '"score":3.9999999999999999')],
    ['a duplicate key (the last one wins)', `{"overall":"fail",${JSON.stringify(good).slice(1)}`],
  ])('accepts %s', (_name, raw) => expect(parse(raw).status).toBe('ok'));

  it.each([
    ['score 1e400 (Infinity)', JSON.stringify(good).replace('"score":4', '"score":1e400'), 'schema'],
    ['a __proto__ key', `{"__proto__":{"overall":"pass"},${JSON.stringify(good).slice(1)}`, 'schema'],
    ['a BOM before the JSON', `\u{feff}${JSON.stringify(good)}`, 'not_json'],
    ['an uppercased criterion id', { ...good, criteria: [{ ...good.criteria[0], id: 'Dedupe_quality' }, ...good.criteria.slice(1)] }, 'schema'],
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

  it('abstains, without throwing, on output nested deep enough to overflow the stack', () => {
    const n = 30_000;
    const r = parse(`{"criteria":${'['.repeat(n)}${']'.repeat(n)},"overall":"pass","injectionSuspected":false,"rationale":""}`);
    expect(r.status).toBe('abstain');
  });

  it('redacts a URL in criterion evidence instead of abstaining (honest evidence may quote a cell)', () => {
    const r = parse({ ...good, criteria: [{ ...good.criteria[0], evidence: 'row 2 cites www.evil.example and fake-co.biz/home' }, ...good.criteria.slice(1)] });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.redactedUrls).toBe(2);
    expect(r.verdict.criteria[0]!.evidence).toBe('row 2 cites [link removed] and [link removed]');
  });

  it('abstains on a defanged URL in the rationale', () => {
    for (const u of ['evil[.]com/x', 'hxxps://evil.example', '10.0.0.7', 'mailto:a@evil.com', 'evil . com/x', 'evil\u{3002}com/x', 'data:text/html,hi', 'evil.com/ x']) {
      const r = parse({ ...good, rationale: `see ${u}` });
      expect(r.status === 'abstain' && r.reason, u).toBe('url');
    }
  });

  it('abstains when the canary is echoed in any case, spaced, split, base64-encoded or as JSON \\u escapes', () => {
    const c = NONCES.canary;
    const escaped = [...c].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    const echoes = [
      { ...good, rationale: c.toUpperCase() },
      { ...good, rationale: c.split('').join('-') },
      { ...good, criteria: good.criteria.map((k, i) => ({ ...k, evidence: c.slice(i * 11, i * 11 + 11) })) },
      { ...good, rationale: Buffer.from(c).toString('base64') },
      JSON.stringify({ ...good, rationale: 'X' }).replace('"X"', `"${escaped}"`),
    ];
    for (const e of echoes) {
      const r = parse(e);
      expect(r.status === 'abstain' && r.reason).toBe('canary_echo');
    }
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
    expect(parse(raw)).toEqual({ status: 'ok', verdict: good, redactedUrls: 0 });
  });
});
