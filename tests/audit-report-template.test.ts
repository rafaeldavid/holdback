// The audit-report deal template (T-317): the terms file, its sample reports, the worked example in
// spec/examples and the "Writing checks for a report" section of site/llms.txt. Every check here runs
// through @holdback/judgment's own check library, the one an adjudicator runs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitmentId } from '../packages/core/src/index.ts';
import {
  compileJsonSchema,
  DEFAULT_MAX_DATA_CHARS,
  runChecks,
  UntrustedData,
  validateCheck,
  validateRubric,
  validateTerms,
  type JudgmentCheck,
} from '../packages/judgment/src/index.ts';
import { loadTermsFile } from '../packages/testkit/src/fixture-files.ts';
// @ts-expect-error -- plain ESM helper without type declarations
import { loadSpec } from '../scripts/spec.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const terms = loadTermsFile(join(root, 'fixtures/terms/audit-report.yaml'));
const checks = terms.acceptance.deterministicChecks;
const report = (name: string) => read(`fixtures/data/audit-report/${name}`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = { commit: string; filesReviewed: string[]; findings: any[] };
const base = (): Report => JSON.parse(report('report.json'));

/** The ids of the required checks a report fails, as an adjudicator's stage 1 would report them. */
const failed = (text: string, cs: readonly JudgmentCheck[] = checks) =>
  runChecks(cs, { data: UntrustedData.wrap(text), mime: 'application/json' })
    .outcomes.filter((o) => o.required && !o.passed)
    .map((o) => o.checkId);
const failedJson = (value: unknown, cs: readonly JudgmentCheck[] = checks) => failed(JSON.stringify(value), cs);

describe('the audit-report terms (fixtures/terms/audit-report.yaml)', () => {
  it('is a checks-only deal for one JSON document, with four required checks the library accepts', () => {
    expect(terms.deliverable.kind).toBe('document');
    expect(terms.deliverable.format).toBe('application/json');
    expect(terms.acceptance.rubric).toEqual({ passThreshold: 0, criteria: [] });
    expect(checks.map((c) => [c.id, c.type, c.required])).toEqual([
      ['report', 'json_schema', true],
      ['scope', 'json_schema', true],
      ['coverage', 'json_schema', true],
      ['hidden', 'hidden_characters_max', true],
    ]);
    for (const c of checks) expect(validateCheck(c), c.id).toBeUndefined();
    expect(checks[3]).toMatchObject({ max: { total: 0 } });
  });

  it('names the commit and the scope in the description as the checks hold them', () => {
    const scope = checks.find((c) => c.id === 'scope') as Extract<JudgmentCheck, { type: 'json_schema' }>;
    const coverage = checks.find((c) => c.id === 'coverage') as Extract<JudgmentCheck, { type: 'json_schema' }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = scope.schema as any, c = coverage.schema as any;
    const files: string[] = c.properties.filesReviewed.items.enum;
    expect(s.properties.findings.items.properties.file.enum).toEqual(files);
    expect(c.properties.filesReviewed).toMatchObject({ uniqueItems: true, minItems: files.length, maxItems: files.length });
    expect(new Set(files).size).toBe(files.length);
    expect(terms.deliverable.description).toContain(s.properties.commit.const);
    for (const f of files) expect(terms.deliverable.description).toContain(f);
  });

  it('passes the sample report, the same files in another order, and a report with no findings', () => {
    expect(failed(report('report.json'))).toEqual([]);
    expect(failed(report('report.reordered.json'))).toEqual([]);
    expect(failed(report('report.no-findings.json'))).toEqual([]);
    const reordered: Report = JSON.parse(report('report.reordered.json'));
    expect(reordered.filesReviewed).not.toEqual(base().filesReviewed);
    expect([...reordered.filesReviewed].sort()).toEqual([...base().filesReviewed].sort());
    expect(reordered.findings).toEqual(base().findings);
    expect(JSON.parse(report('report.no-findings.json'))).toEqual({ ...base(), findings: [] });
  });

  it('fails coverage, and only coverage, for a report that misses one file in scope', () => {
    expect(failed(report('report.missing-file.json'))).toEqual(['coverage']);
    const missing: Report = JSON.parse(report('report.missing-file.json'));
    expect(base().filesReviewed.filter((f) => !missing.filesReviewed.includes(f))).toEqual(['contracts/InterestModel.sol']);
  });

  it('fails coverage for a repeated file or a file outside the scope', () => {
    const r = base();
    expect(failedJson({ ...r, filesReviewed: [r.filesReviewed[0], r.filesReviewed[0], r.filesReviewed[1]] })).toEqual(['coverage']);
    expect(failedJson({ ...r, filesReviewed: [r.filesReviewed[0], r.filesReviewed[1], 'contracts/Other.sol'] })).toEqual(['coverage']);
    expect(failedJson({ ...r, filesReviewed: [...r.filesReviewed, 'contracts/Other.sol'] })).toEqual(['coverage']);
  });

  it('fails scope for another commit or a finding in a file outside the scope', () => {
    const r = base();
    expect(failedJson({ ...r, commit: 'a'.repeat(40) })).toEqual(['scope']);
    r.findings[2].file = 'contracts/Other.sol';
    expect(failedJson(r)).toEqual(['scope']);
  });

  it.each(['Critical', 'High', 'Medium'])('fails the report check for a %s finding without proof-of-concept files', (severity) => {
    const r = base();
    r.findings[2].severity = severity;
    expect(failedJson(r)).toEqual(['report']);
    r.findings[2].pocFiles = [];
    expect(failedJson(r)).toEqual(['report']);
    r.findings[2].pocFiles = [{ path: 'test/poc/F-03.t.sol', content: 'contract T {}' }];
    expect(failedJson(r)).toEqual([]);
  });

  it.each(['Low', 'Info'])('passes a %s finding without proof-of-concept files', (severity) => {
    const r = base();
    r.findings[2].severity = severity;
    expect(failedJson(r)).toEqual([]);
  });

  it.each(['id', 'severity', 'title', 'file', 'lines', 'excerpt', 'rootCause', 'impact', 'recommendedFix'])('fails the report check for a finding without %s', (field) => {
    const r = base();
    delete r.findings[2][field];
    expect(failedJson(r)).toContain('report');
  });

  it('fails the report check for an unknown severity, an unknown property, and text that is not JSON', () => {
    const r = base();
    r.findings[2].severity = 'Severe';
    expect(failedJson(r)).toEqual(['report']);
    expect(failedJson({ ...base(), notes: 'x' })).toEqual(['report']);
    expect(failed('not json')).toEqual(['report', 'scope', 'coverage']);
  });

  it('fails the hidden check for one zero-width character', () => {
    const r = base();
    r.findings[2].title += '​';
    expect(failedJson(r)).toEqual(['hidden']);
  });

  it('keeps the sample reports inside what the judges read whole', () => {
    for (const name of ['report.json', 'report.reordered.json', 'report.missing-file.json', 'report.no-findings.json']) {
      expect(report(name).length, name).toBeLessThan(DEFAULT_MAX_DATA_CHARS);
    }
  });
});

describe('the worked example (spec/examples/commitment.audit-report.example.json)', () => {
  const example = JSON.parse(read('spec/examples/commitment.audit-report.example.json'));

  it('is a valid commitment whose id is the commitment ID of its terms', () => {
    const { ajv, schemas } = loadSpec();
    const validate = ajv.getSchema(schemas.get('commitment'));
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    const { id, signatures, ...body } = example;
    expect(signatures.seller).toMatch(/^0x[0-9a-f]{130}$/);
    expect(commitmentId(body)).toBe(id);
  });

  it('carries the deliverable and the checks of the terms file', () => {
    expect(example.deliverable).toEqual(terms.deliverable);
    expect(example.acceptance.deterministicChecks).toEqual(checks);
    expect(example.price).toEqual(terms.price);
  });

  it('adds the optional rubric: five criteria a judge scores from the report alone', () => {
    const rubric = example.acceptance.rubric;
    expect(rubric.criteria.map((c: { id: string }) => c.id)).toEqual(['root_cause', 'impact', 'severity', 'fix', 'distinct']);
    expect(validateRubric(rubric)).toBeUndefined();
    expect(rubric.passThreshold).toBeGreaterThan(0);
    expect(validateTerms(example.acceptance, example.deliverable.description)).toEqual([]);
  });
});

// Every keyword of JSON Schema 2020-12 and the older drafts an agent may reach for.
const VOCABULARY = [
  '$schema', '$id', '$ref', '$anchor', '$dynamicRef', '$dynamicAnchor', '$vocabulary', '$comment', '$defs', '$recursiveRef', '$recursiveAnchor', 'id',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'prefixItems', 'items', 'additionalItems', 'contains', 'properties',
  'patternProperties', 'additionalProperties', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties',
  'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems',
  'minItems', 'uniqueItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties', 'required', 'dependentRequired', 'dependencies', 'definitions',
  'format', 'contentEncoding', 'contentMediaType', 'contentSchema', 'title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly', 'examples',
];
const SAMPLES: unknown[] = [true, 1, 'string', ['a'], [{}], {}, { a: {} }];
const compiles = (k: string, v: unknown) => compileJsonSchema({ [k]: v });
/** The interpreter knows the keyword: some value compiles, or is refused for its value and not for the keyword. */
const supported = (k: string) => SAMPLES.some((v) => { const r = compiles(k, v); return r.ok || !/is not supported$/.test(r.error); });
/** The interpreter ignores the keyword: any value compiles, and the result accepts anything. */
const ignored = (k: string) =>
  SAMPLES.every((v) => { const r = compiles(k, v); return r.ok && ['other', 1, {}, []].every((x) => r.value(x) === undefined); });

describe('site/llms.txt, "Writing checks for a report"', () => {
  const md = read('site/llms.txt');
  const start = md.indexOf('\n## Writing checks for a report\n');
  const section = start < 0 ? '' : md.slice(start + 1, md.indexOf('\n## ', start + 1));
  const listed = (label: string) => {
    const line = section.split('\n').find((l) => l.startsWith(label)) ?? '';
    return [...line.slice(label.length).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  };
  const recipes: JudgmentCheck[] = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!));
  const recipe = (id: string) => recipes.filter((c) => c.id === id);

  it('exists, between the buyer checks section and Encodings', () => {
    expect(start).toBeGreaterThan(md.indexOf('\n## Writing checks that protect a buyer\n'));
    expect(start).toBeLessThan(md.indexOf('\n## Encodings\n'));
  });

  it('lists exactly the keywords the json_schema interpreter supports', () => {
    const keywords = listed('Supported keywords:');
    const annotations = listed('Ignored annotations:');
    expect(new Set(keywords).size).toBe(keywords.length);
    expect([...keywords].sort()).toEqual(VOCABULARY.filter((k) => supported(k) && !ignored(k)).sort());
    expect([...annotations].sort()).toEqual(VOCABULARY.filter(ignored).sort());
    // The vocabulary above covers what the docs list, so a keyword added to both is still compared.
    for (const k of [...keywords, ...annotations]) expect(VOCABULARY, k).toContain(k);
  });

  it('names keywords the interpreter refuses, each of which it does refuse', () => {
    const refused = listed('Not supported:');
    expect(refused).toEqual(expect.arrayContaining(['contains', 'if', '$ref', 'format']));
    for (const k of refused) expect(supported(k), k).toBe(false);
  });

  it('shows three recipes, each a check the library and the commitment schema accept', () => {
    expect(recipes.map((c) => c.id)).toEqual(['commit', 'proof', 'coverage']);
    const { ajv, schemas } = loadSpec();
    const validate = ajv.getSchema(`${schemas.get('commitment')}#/$defs/DeterministicCheck`);
    for (const c of recipes) {
      expect(c.type).toBe('json_schema');
      expect(validateCheck(c), c.id).toBeUndefined();
      expect(validate(c), `${c.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('pins a commit', () => {
    const commit = base().commit;
    expect(section).toContain(commit);
    expect(failedJson({ commit }, recipe('commit'))).toEqual([]);
    expect(failedJson({ commit: 'b'.repeat(40) }, recipe('commit'))).toEqual(['commit']);
    expect(failedJson({}, recipe('commit'))).toEqual(['commit']);
  });

  it('requires proof by severity', () => {
    const poc = [{ path: 'test/poc/F-01.t.sol', content: 'contract T {}' }];
    expect(failedJson({ findings: [] }, recipe('proof'))).toEqual([]);
    expect(failedJson({ findings: [{ severity: 'Low' }, { severity: 'High', pocFiles: poc }] }, recipe('proof'))).toEqual([]);
    expect(failedJson({ findings: [{ severity: 'Medium' }] }, recipe('proof'))).toEqual(['proof']);
    expect(failedJson({ findings: [{ severity: 'Medium', pocFiles: [] }] }, recipe('proof'))).toEqual(['proof']);
    expect(failedJson({ findings: [{ pocFiles: poc }] }, recipe('proof'))).toEqual(['proof']);
  });

  it('matches a file list in any order', () => {
    const files = base().filesReviewed;
    const r = recipe('coverage');
    expect(failedJson({ filesReviewed: files }, r)).toEqual([]);
    expect(failedJson({ filesReviewed: [...files].reverse() }, r)).toEqual([]);
    expect(failedJson({ filesReviewed: files.slice(1) }, r)).toEqual(['coverage']);
    expect(failedJson({ filesReviewed: [files[0], files[0], files[1]] }, r)).toEqual(['coverage']);
    expect(failedJson({ filesReviewed: [...files.slice(1), 'README.md'] }, r)).toEqual(['coverage']);
    expect(failedJson({}, r)).toEqual(['coverage']);
  });

  it('says what the subset cannot express and where the worked example is', () => {
    expect(section).toContain('spec/examples/commitment.audit-report.example.json');
    expect(section).toMatch(/100,000 characters/);
  });
});
