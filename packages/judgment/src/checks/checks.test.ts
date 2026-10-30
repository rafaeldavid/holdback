import type { DeterministicCheck, MimeType } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { GOOD_CSV, sha256, utf8 } from '../_helpers.js';
import { UntrustedData } from '../untrusted.js';
import { CHECK_TYPES, evaluateChecks, validateCheck } from './index.js';
import { isIso8601 } from './iso8601.js';
import { parseCsv } from './csv.js';

const csv = (text: string): { data: UntrustedData; mime: MimeType } => ({ data: UntrustedData.wrap(text), mime: 'text/csv' });
const json = (value: unknown): { data: UntrustedData; mime: MimeType } => ({ data: UntrustedData.wrap(JSON.stringify(value)), mime: 'application/json' });
const one = (check: DeterministicCheck, input = csv(GOOD_CSV), references?: ReadonlyMap<string, Uint8Array>) => {
  const [r] = evaluateChecks([check], references ? { ...input, references } : input);
  return r!;
};
const base = { id: 'c', required: true } as const;

describe('check registry', () => {
  it('is a closed union of exactly the eight schema check types', () => {
    expect([...CHECK_TYPES].sort()).toEqual(
      ['csv_columns_exact', 'iso8601_date_column', 'json_schema', 'null_rate_max', 'reference_row_match_min', 'regex_match_rate_min', 'row_count_range', 'unique_key'].sort(),
    );
  });

  it('fails closed on an unknown check type', () => {
    const r = one({ ...base, type: 'run_script', code: 'process.exit()' } as unknown as DeterministicCheck);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/unknown check type/);
  });

  it('returns results in declaration order, one per check, with id and required copied', () => {
    const checks: DeterministicCheck[] = [
      { id: 'z-last', required: false, type: 'row_count_range', min: 0, max: 1 },
      { id: 'a-first', required: true, type: 'csv_columns_exact', columns: ['customer_id', 'name', 'email', 'signup_date', 'email_valid'] },
      { id: 'm-mid', required: true, type: 'unique_key', columns: ['customer_id'] },
    ];
    const rs = evaluateChecks(checks, csv(GOOD_CSV));
    expect(rs.map((r) => [r.checkId, r.required, r.passed])).toEqual([
      ['z-last', false, false],
      ['a-first', true, true],
      ['m-mid', true, true],
    ]);
  });

  it('caps detail at 300 characters', () => {
    const r = one({ ...base, type: 'csv_columns_exact', columns: ['x'.repeat(400)] });
    expect(r.detail!.length).toBeLessThanOrEqual(300);
  });
});

describe('csv parser', () => {
  it('parses quoted fields, escaped quotes, CRLF and embedded newlines', () => {
    const r = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",2\r\n');
    expect(r).toEqual({ ok: true, value: { header: ['a', 'b'], rows: [['x, y', 'say "hi"'], ['multi\nline', '2']] } });
  });

  it('refuses ragged rows and unterminated quotes', () => {
    expect(parseCsv('a,b\n1\n').ok).toBe(false);
    expect(parseCsv('a,b\n"1,2\n').ok).toBe(false);
  });

  it('refuses a stray quote inside an unquoted field', () => {
    expect(parseCsv('a,b\n1x"y,2\n').ok).toBe(false);
  });
});

describe('csv_columns_exact', () => {
  const cols = ['customer_id', 'name', 'email', 'signup_date', 'email_valid'];
  it('passes on the exact header', () => expect(one({ ...base, type: 'csv_columns_exact', columns: cols }).passed).toBe(true));
  it('fails on a reordered header', () =>
    expect(one({ ...base, type: 'csv_columns_exact', columns: [...cols].reverse() }).passed).toBe(false));
  it('fails on a missing column', () => expect(one({ ...base, type: 'csv_columns_exact', columns: [...cols, 'extra'] }).passed).toBe(false));
  it('works on JSON arrays of objects', () =>
    expect(one({ ...base, type: 'csv_columns_exact', columns: ['a', 'b'] }, json([{ a: 1, b: 2 }])).passed).toBe(true));
  it('fails on JSON rows with different keys', () =>
    expect(one({ ...base, type: 'csv_columns_exact', columns: ['a', 'b'] }, json([{ a: 1, b: 2 }, { a: 1 }])).passed).toBe(false));
  it('fails when the deliverable does not parse', () =>
    expect(one({ ...base, type: 'csv_columns_exact', columns: ['a'] }, csv('a,b\n"open')).passed).toBe(false));
});

describe('row_count_range', () => {
  it('counts data rows, not the header', () => {
    expect(one({ ...base, type: 'row_count_range', min: 3, max: 3 }).passed).toBe(true);
    expect(one({ ...base, type: 'row_count_range', min: 4, max: 9 }).passed).toBe(false);
    expect(one({ ...base, type: 'row_count_range', min: 0, max: 2 }).passed).toBe(false);
  });
  it('ignores a trailing newline', () => expect(one({ ...base, type: 'row_count_range', min: 3, max: 3 }, csv(`${GOOD_CSV}\n`)).passed).toBe(true));
  it('is invalid when min > max', () => expect(validateCheck({ ...base, type: 'row_count_range', min: 5, max: 1 })).toMatch(/min/));
});

describe('unique_key', () => {
  it('passes on unique keys', () => expect(one({ ...base, type: 'unique_key', columns: ['customer_id'] }).passed).toBe(true));
  it('fails on a duplicate key', () =>
    expect(one({ ...base, type: 'unique_key', columns: ['customer_id'] }, csv(`${GOOD_CSV}\n1,Dup,d@x.io,2024-01-01,true`)).passed).toBe(false));
  it('uses the tuple of columns', () => {
    const t = 'a,b\n1,x\n1,y\n';
    expect(one({ ...base, type: 'unique_key', columns: ['a'] }, csv(t)).passed).toBe(false);
    expect(one({ ...base, type: 'unique_key', columns: ['a', 'b'] }, csv(t)).passed).toBe(true);
  });
  it('does not confuse tuples that join to the same string', () => {
    const t = 'a,b\n"x,","y"\n"x",",y"\n';
    expect(one({ ...base, type: 'unique_key', columns: ['a', 'b'] }, csv(t)).passed).toBe(true);
  });
  it('fails on a missing column', () => expect(one({ ...base, type: 'unique_key', columns: ['nope'] }).passed).toBe(false));
});

describe('null_rate_max', () => {
  it('treats empty CSV cells as null', () => {
    expect(one({ ...base, type: 'null_rate_max', column: 'email', max: 0.34 }).passed).toBe(true);
    expect(one({ ...base, type: 'null_rate_max', column: 'email', max: 0.33 }).passed).toBe(false);
  });
  it('treats JSON null, missing-free empty strings as null', () => {
    const r = one({ ...base, type: 'null_rate_max', column: 'a', max: 0.5 }, json([{ a: null }, { a: '' }, { a: 1 }, { a: 2 }]));
    expect(r.passed).toBe(true);
  });
  it('fails on a missing column', () => expect(one({ ...base, type: 'null_rate_max', column: 'nope', max: 1 }).passed).toBe(false));
});

describe('regex_match_rate_min', () => {
  const email = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
  it('computes the rate over all rows (empty cells do not match)', () => {
    expect(one({ ...base, type: 'regex_match_rate_min', column: 'email', pattern: email, min: 0.66 }).passed).toBe(true);
    expect(one({ ...base, type: 'regex_match_rate_min', column: 'email', pattern: email, min: 0.67 }).passed).toBe(false);
  });
  it('uses full-match semantics', () => {
    expect(one({ ...base, type: 'regex_match_rate_min', column: 'customer_id', pattern: '\\d', min: 1 }).passed).toBe(true);
    expect(one({ ...base, type: 'regex_match_rate_min', column: 'name', pattern: 'Ada', min: 0.3 }).passed).toBe(false);
  });
  it('fails closed on an unsupported pattern (backreference)', () => {
    const r = one({ ...base, type: 'regex_match_rate_min', column: 'email', pattern: '(a)\\1', min: 0 });
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/pattern/);
  });
  it('stays linear on a classic catastrophic pattern', () => {
    const rows = Array.from({ length: 50 }, () => `${'a'.repeat(3000)}!`).join('\n');
    const started = performance.now();
    const r = one({ ...base, type: 'regex_match_rate_min', column: 'v', pattern: '^(a+)+$', min: 0 }, csv(`v\n${rows}`));
    expect(r.passed).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('iso8601_date_column', () => {
  it('passes on valid dates', () => expect(one({ ...base, type: 'iso8601_date_column', column: 'signup_date' }).passed).toBe(true));
  it('fails on a non-ISO date', () =>
    expect(one({ ...base, type: 'iso8601_date_column', column: 'signup_date' }, csv('signup_date\n2024-01-02\n01/02/2024')).passed).toBe(false));
  it('skips empty cells (null rate is a separate check)', () =>
    expect(one({ ...base, type: 'iso8601_date_column', column: 'd' }, csv('d\n2024-01-02\n\n')).passed).toBe(true));
  it('validates the calendar and date-time forms', () => {
    expect(isIso8601('2024-02-29')).toBe(true);
    expect(isIso8601('2023-02-29')).toBe(false);
    expect(isIso8601('2024-13-01')).toBe(false);
    expect(isIso8601('2024-01-02T03:04:05Z')).toBe(true);
    expect(isIso8601('2024-01-02T03:04:05.123+05:30')).toBe(true);
    expect(isIso8601('2024-01-02T24:00:00Z')).toBe(false);
    expect(isIso8601('2024-01-02 03:04:05')).toBe(false);
    expect(isIso8601('20240102')).toBe(false);
  });
});

describe('json_schema', () => {
  const schema = { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } };
  it('passes a conforming JSON deliverable', () => expect(one({ ...base, type: 'json_schema', schema }, json([{ id: 1 }])).passed).toBe(true));
  it('fails a non-conforming deliverable', () => expect(one({ ...base, type: 'json_schema', schema }, json([{ id: 0 }])).passed).toBe(false));
  it('fails a deliverable that is not JSON', () => expect(one({ ...base, type: 'json_schema', schema }).passed).toBe(false));
  it('fails closed on an unsupported keyword', () => {
    const r = one({ ...base, type: 'json_schema', schema: { $ref: 'https://evil.example/s.json' } }, json([]));
    expect(r.passed).toBe(false);
    expect(validateCheck({ ...base, type: 'json_schema', schema: { $ref: 'x' } })).toMatch(/\$ref/);
  });
});

describe('reference_row_match_min', () => {
  const ref = utf8('customer_id,name\n1,Ada Lovelace\n2,Grace Hopper\n3,Wrong Name\n');
  const refHash = sha256(ref);
  const check = (min: number): DeterministicCheck => ({
    ...base,
    type: 'reference_row_match_min',
    reference: { uri: 'file:///ref.csv', sha256: refHash },
    keyColumn: 'customer_id',
    min,
  });
  it('matches reference rows by key on the reference columns', () => {
    const refs = new Map([[refHash, ref]]);
    expect(one(check(0.66), csv(GOOD_CSV), refs).passed).toBe(true);
    expect(one(check(0.67), csv(GOOD_CSV), refs).passed).toBe(false);
  });
  it('fails when the reference is missing', () => expect(one(check(0)).passed).toBe(false));
  it('fails when the reference bytes do not match the committed hash', () => {
    const refs = new Map([[refHash, utf8('customer_id,name\n')]]);
    const r = one(check(0), csv(GOOD_CSV), refs);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/hash/);
  });
});

describe('validateCheck', () => {
  it('accepts every check in the example commitment', () => {
    const checks: DeterministicCheck[] = [
      { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] },
      { id: 'rows', type: 'row_count_range', required: true, min: 9400, max: 9600 },
      { id: 'emails', type: 'regex_match_rate_min', required: false, column: 'email', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', min: 0.97 },
    ];
    for (const c of checks) expect(validateCheck(c), c.id).toBeUndefined();
  });
});
