// The report converter (T-323): a mapping file, which is data, turns a seller's own report into the audit
// template's JSON. Two differently shaped reports convert to the sample report, and the seller's check run
// (preflightDelivery, T-316) accepts both. A report the mapping cannot convert is refused, naming the field.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightDelivery } from '@holdback/judgment';
import { loadTermsFile } from '@holdback/testkit';
import { describe, expect, it } from 'vitest';
import { convertReport, loadReportMapping, parseReportMapping, ReportNotConverted, type ReportMapping } from './report-converter.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const data = (f: string) => here(`../fixtures/data/audit-report/${f}`);
const json = (f: string): J => JSON.parse(readFileSync(data(f), 'utf8'));
const SAMPLE = json('report.json');
const ACCEPTANCE = loadTermsFile(here('../fixtures/terms/audit-report.yaml')).acceptance;
const SHAPES = ['seller-shape-a', 'seller-shape-b'] as const;

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const convert = (mapping: ReportMapping, report: unknown) => JSON.parse(textOf(convertReport(mapping, bytesOf(report))));
const check = (bytes: Uint8Array) => preflightDelivery({ plaintext: bytes, mime: 'application/json', format: 'application/json', acceptance: ACCEPTANCE });
const mapping = (shape: string) => loadReportMapping(data(`${shape}.mapping.json`));

/** The ReportNotConverted a conversion throws. */
function refusal(m: ReportMapping, report: unknown): ReportNotConverted {
  try {
    convertReport(m, typeof report === 'string' ? new TextEncoder().encode(report) : bytesOf(report));
  } catch (e) {
    if (e instanceof ReportNotConverted) return e;
    throw e;
  }
  throw new Error('the report converted');
}
/** The message parseReportMapping throws. */
function mappingError(m: unknown): string {
  try {
    parseReportMapping(m);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('the mapping loaded');
}

describe('report converter: two report shapes to the template', () => {
  for (const shape of SHAPES) {
    it(`${shape} converts to the sample report, and the check run accepts it`, () => {
      const bytes = convertReport(mapping(shape), readFileSync(data(`${shape}.report.json`)));
      expect(JSON.parse(textOf(bytes))).toEqual(SAMPLE);
      const pre = check(bytes);
      expect(pre.refused).toBeUndefined();
      expect(pre.deterministic.map((o) => [o.checkId, o.passed])).toEqual([['report', true], ['proof', true], ['scope', true], ['coverage', true], ['hidden', true]]);
      expect(pre.result).toBe('accept');
    });
  }

  it('the two shapes give the same bytes, and a conversion gives the same bytes every time', () => {
    const [a, b] = SHAPES.map((s) => textOf(convertReport(mapping(s), readFileSync(data(`${s}.report.json`)))));
    expect(a).toBe(textOf(convertReport(mapping('seller-shape-a'), readFileSync(data('seller-shape-a.report.json')))));
    expect(JSON.parse(a!)).toEqual(JSON.parse(b!));
    expect(a!.endsWith('}\n')).toBe(true);
  });

  it('the check run still decides: a converted report that leaves out a file in scope fails coverage', () => {
    const report = json('seller-shape-a.report.json');
    report.audit.inScope.pop();
    const pre = check(convertReport(mapping('seller-shape-a'), bytesOf(report)));
    expect(pre.result).toBe('reject');
    expect(pre.deterministic.filter((o) => !o.passed).map((o) => o.checkId)).toEqual(['coverage']);
  });

  it('a report with no findings converts with the default list', () => {
    const report = json('seller-shape-b.report.json');
    delete report.vulnerabilities;
    expect(convert(mapping('seller-shape-b'), report).findings).toEqual([]);
  });
});

describe('report converter: a report the mapping cannot convert is refused, naming the field', () => {
  const a = () => json('seller-shape-a.report.json');
  const b = () => json('seller-shape-b.report.json');

  it('a required field that is missing', () => {
    const report = a();
    delete report.issues[1].name;
    const e = refusal(mapping('seller-shape-a'), report);
    expect(e.field).toBe('findings[1].title');
    expect(e.message).toBe('findings[1].title: the report has no issues[1].name');
  });

  it('a value the value map does not list', () => {
    const report = a();
    report.issues[0].risk = 'severe';
    const e = refusal(mapping('seller-shape-a'), report);
    expect(e.field).toBe('findings[0].severity');
    expect(e.message).toBe('findings[0].severity: issues[0].risk is "severe", which the mapping does not list (it lists "critical", "high", "medium", "low", "informational")');
  });

  it('text that is not a whole number where the mapping wants one', () => {
    const report = b();
    report.vulnerabilities[2].line_end = '65a';
    const e = refusal(mapping('seller-shape-b'), report);
    expect(e.field).toBe('findings[2].locations[0].lines.end');
    expect(e.message).toBe('findings[2].locations[0].lines.end: vulnerabilities[2].line_end is "65a", not a whole number');
  });

  it('a number that is not a whole number, copied from the report', () => {
    const report = a();
    report.issues[0].affected[0].span.from = 88.5;
    const e = refusal(mapping('seller-shape-a'), report);
    expect(e.field).toBe('findings[0].locations[0].lines.start');
    expect(e.message).toBe('findings[0].locations[0].lines.start: the converted report would hold 88.5, a number that is not a whole number');
  });

  it('a list that is not a list', () => {
    const report = a();
    report.issues = { 'F-01': report.issues[0] };
    const e = refusal(mapping('seller-shape-a'), report);
    expect(e.field).toBe('findings');
    expect(e.message).toBe('findings: issues is an object, not a list');
  });

  it('a report that is not JSON, or not an object', () => {
    expect(refusal(mapping('seller-shape-a'), '{"audit": ').message).toBe('the report is not JSON');
    expect(refusal(mapping('seller-shape-a'), '["F-01"]').message).toBe('commit: the report has no audit.revision.sha');
  });

  it('a field the report hides under __proto__ is missing, and nothing leaks onto Object', () => {
    const report = '{"audit": {"__proto__": {"revision": {"sha": "7c1e4b9a2d3f5068a1b2c3d4e5f60718293a4b5c"}}}, "issues": []}';
    expect(refusal(mapping('seller-shape-a'), report).message).toBe('commit: the report has no audit.revision.sha');
    expect(({} as J).revision).toBeUndefined();
  });

  it('a value from the report that looks like a mapping stays data', () => {
    const m = parseReportMapping({ version: 1, report: { commit: { $path: 'c' }, findings: { $path: 'f' } } });
    const hostile = { c: '{{commit}} ${process.exit(1)}', f: [{ $path: 'c', $const: 'x', $each: 'f' }] };
    expect(convert(m, hostile)).toEqual({ commit: hostile.c, findings: hostile.f });
  });
});

describe('report converter: a mapping is data, checked when it loads', () => {
  const ok = { version: 1, report: { commit: { $path: 'c' } } };

  it('loads the two fixture mappings', () => {
    for (const shape of SHAPES) expect(() => mapping(shape)).not.toThrow();
  });

  it('keeps a constant as written, even one that looks like code or a placeholder', () => {
    const m = parseReportMapping({ version: 1, report: { a: '${process.exit(1)}', b: '{{commit}}', c: { $const: { $path: 'x' } }, d: [1, true, null] } });
    expect(convert(m, {})).toEqual({ a: '${process.exit(1)}', b: '{{commit}}', c: { $path: 'x' }, d: [1, true, null] });
  });

  it('refuses anything that is not one of its directives', () => {
    expect(mappingError({ version: 1, report: { a: { $eval: 'process.exit(1)' } } })).toBe('mapping report.a: $eval is not a directive (use $path, $const, $each, $concat, $value, $item, $map, $as, $optional, $default, $when)');
    expect(mappingError({ version: 1, report: { a: { $path: 'x', $as: 'function' } } })).toBe('mapping report.a: $as is "string" or "integer"');
    expect(mappingError({ version: 1, report: { a: { $path: 'x', $const: 1 } } })).toBe('mapping report.a: name one source: $path, $const, $each, $concat or $value');
    expect(mappingError({ version: 1, report: { a: { $map: { x: 'y' } } } })).toBe('mapping report.a: name one source: $path, $const, $each, $concat or $value');
    expect(mappingError({ version: 1, report: { a: { $each: 'x' } } })).toBe('mapping report.a: $each needs $item');
    expect(mappingError({ version: 1, report: { a: { $const: 'x', $map: { x: 'y' } } } })).toBe('mapping report.a: $map and $as go with $path only');
    expect(mappingError({ version: 1, report: { a: { $concat: 'x' } } })).toBe('mapping report.a: $concat is a list of nodes');
  });

  it('refuses a path it cannot read, and a key that could reach a prototype', () => {
    expect(mappingError({ version: 1, report: { a: { $path: 'x..y' } } })).toBe('mapping report.a: "x..y" is not a path (keys of letters, digits, _ and -, joined by dots, with [n] for an item; "." is the item itself; "$." starts at the report)');
    expect(mappingError({ version: 1, report: { a: { $path: 'x.__proto__' } } })).toBe('mapping report.a: "x.__proto__" names __proto__, constructor or prototype');
    expect(mappingError(JSON.parse('{"version": 1, "report": {"__proto__": {"$path": "x"}}}'))).toBe('mapping report: the key __proto__ is not allowed');
    expect(mappingError({ version: 1, report: { a: { $when: 'constructor', $value: 1 } } })).toBe('mapping report.a: "constructor" names __proto__, constructor or prototype');
  });

  it('refuses a number that is not a whole number, and a file that is not a mapping', () => {
    expect(mappingError({ version: 1, report: { a: 1.5 } })).toBe('mapping report.a: 1.5 is not a whole number');
    expect(mappingError({ ...ok, version: 2 })).toBe('mapping: version must be 1');
    expect(mappingError({ ...ok, extra: true })).toBe('mapping: extra is not a field of a mapping (version, description, report)');
    expect(mappingError({ version: 1 })).toBe('mapping: report is missing');
    expect(mappingError('report')).toBe('mapping: a mapping is a JSON object');
  });

  it('names the file when a mapping file does not load', () => {
    const dir = mkdtempSync(join(tmpdir(), 't323-'));
    writeFileSync(join(dir, 'bad.json'), '{"version": 1, ');
    expect(() => loadReportMapping(join(dir, 'bad.json'))).toThrow(`${join(dir, 'bad.json')} is not JSON`);
    writeFileSync(join(dir, 'eval.json'), JSON.stringify({ version: 1, report: { $eval: 'x' } }));
    expect(() => loadReportMapping(join(dir, 'eval.json'))).toThrow(`${join(dir, 'eval.json')}: mapping report: $eval is not a directive`);
  });

  it('reaches the report root from inside a list with "$."', () => {
    const m = parseReportMapping({ version: 1, report: { rows: { $each: 'items', $item: { name: { $path: '.' }, commit: { $path: '$.commit' } } } } });
    expect(convert(m, { commit: 'abc', items: ['x', 'y'] })).toEqual({ rows: [{ name: 'x', commit: 'abc' }, { name: 'y', commit: 'abc' }] });
  });
});
