// Stage 1, deterministic checks. The registry is a closed union: exactly the check types in
// commitment.schema.json, each evaluated by built-in code over data. Nothing from a commitment or a
// deliverable is executed. A check that cannot be evaluated (bad pattern, unsupported schema
// keyword, missing reference, unknown type) fails closed with a detail saying why.
import { createHash } from 'node:crypto';
import type { DeterministicCheck, MimeType, Sha256 } from '@holdback/core';
import { normalizeText } from '../normalize.js';
import type { UntrustedData } from '../untrusted.js';
import { isIso8601 } from './iso8601.js';
import { compileJsonSchema } from './json-schema.js';
import { compileSafeRegex } from './safe-regex.js';
import { toTable, type Table } from './table.js';

export type CheckType = DeterministicCheck['type'];

/** judgment.schema.json `deterministic[]`. */
export interface CheckOutcome {
  checkId: string;
  required: boolean;
  passed: boolean;
  detail?: string;
}

export interface CheckInput {
  data: UntrustedData;
  mime: MimeType;
  /** Reference files by committed sha256, as fetched (unverified) bytes. */
  references?: ReadonlyMap<string, Uint8Array>;
}

const REGISTRY = {
  csv_columns_exact: true,
  row_count_range: true,
  unique_key: true,
  null_rate_max: true,
  regex_match_rate_min: true,
  iso8601_date_column: true,
  json_schema: true,
  reference_row_match_min: true,
} as const satisfies Record<CheckType, true>;
export const CHECK_TYPES: ReadonlySet<CheckType> = new Set(Object.keys(REGISTRY) as CheckType[]);

const DETAIL_MAX = 300;
const cap = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s);
const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const sha256 = (b: Uint8Array): Sha256 => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/** Static validation, usable at offer time. Returns a reason the check cannot be evaluated, or undefined. */
export function validateCheck(check: DeterministicCheck): string | undefined {
  const type: string = check.type;
  if (!CHECK_TYPES.has(type as CheckType)) return `unknown check type ${type.slice(0, 40)}`;
  switch (check.type) {
    case 'row_count_range':
      return check.min > check.max ? 'min is greater than max' : undefined;
    case 'regex_match_rate_min': {
      const r = compileSafeRegex(check.pattern);
      return r.ok ? undefined : `pattern refused: ${r.error}`;
    }
    case 'json_schema': {
      const r = compileJsonSchema(check.schema);
      return r.ok ? undefined : `schema refused: ${r.error}`;
    }
    default:
      return undefined;
  }
}

function column(t: Table, name: string): number | string {
  const i = t.columns.indexOf(name);
  return i < 0 ? `column ${name} not found` : i;
}

type Outcome = { passed: boolean; detail?: string };
const pass = (detail?: string): Outcome => (detail === undefined ? { passed: true } : { passed: true, detail });
const fail = (detail: string): Outcome => ({ passed: false, detail });

function evaluate(check: DeterministicCheck, input: CheckInput, table: () => ReturnType<typeof toTable>): Outcome {
  const invalid = validateCheck(check);
  if (invalid) return fail(`check invalid: ${invalid}`);
  if (check.type === 'json_schema') {
    let value: unknown;
    try {
      value = JSON.parse(input.data.reveal());
    } catch {
      return fail('deliverable is not valid JSON');
    }
    const v = compileJsonSchema(check.schema);
    const e = v.ok ? v.value(value) : v.error;
    return e === undefined ? pass() : fail(`schema: ${e}`);
  }
  const tr = table();
  if (!tr.ok) return fail(tr.error);
  const t = tr.value;
  switch (check.type) {
    case 'csv_columns_exact': {
      const same = t.columns.length === check.columns.length && t.columns.every((c, i) => c === check.columns[i]);
      return same ? pass() : fail(`columns are [${t.columns.join(', ')}]; expected [${check.columns.join(', ')}]`);
    }
    case 'row_count_range': {
      const n = t.rows.length;
      return n >= check.min && n <= check.max ? pass(`${n} rows`) : fail(`${n} rows; expected ${check.min} to ${check.max}`);
    }
    case 'unique_key': {
      const idx = check.columns.map((c) => column(t, c));
      const missing = idx.find((i) => typeof i === 'string');
      if (missing !== undefined) return fail(missing as string);
      const seen = new Set<string>();
      for (const [r, row] of t.rows.entries()) {
        const key = JSON.stringify(idx.map((i) => row[i as number]));
        if (seen.has(key)) return fail(`duplicate key at row ${r + 1}`);
        seen.add(key);
      }
      return pass();
    }
    case 'null_rate_max': {
      const i = column(t, check.column);
      if (typeof i === 'string') return fail(i);
      const nulls = t.rows.filter((row) => row[i] === null).length;
      const rate = t.rows.length ? nulls / t.rows.length : 0;
      return rate <= check.max ? pass(`null rate ${pct(rate)}`) : fail(`null rate ${pct(rate)} exceeds ${pct(check.max)}`);
    }
    case 'regex_match_rate_min': {
      const i = column(t, check.column);
      if (typeof i === 'string') return fail(i);
      const re = compileSafeRegex(check.pattern);
      if (!re.ok) return fail(re.error);
      const matches = t.rows.filter((row) => row[i] !== null && re.value.fullMatch(row[i]!)).length;
      const rate = t.rows.length ? matches / t.rows.length : 1;
      return rate >= check.min ? pass(`match rate ${pct(rate)}`) : fail(`match rate ${pct(rate)} below ${pct(check.min)}`);
    }
    case 'iso8601_date_column': {
      const i = column(t, check.column);
      if (typeof i === 'string') return fail(i);
      const bad = t.rows.findIndex((row) => row[i] !== null && !isIso8601(row[i]!));
      return bad < 0 ? pass() : fail(`row ${bad + 1} is not an ISO 8601 date`);
    }
    case 'reference_row_match_min': {
      const bytes = input.references?.get(check.reference.sha256);
      if (!bytes) return fail('reference not available');
      if (sha256(bytes) !== check.reference.sha256) return fail('reference bytes do not match the committed hash');
      let text: string;
      try {
        text = normalizeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).text;
      } catch {
        return fail('reference is not valid UTF-8');
      }
      const rr = toTable(text, input.mime);
      if (!rr.ok) return fail(`reference: ${rr.error}`);
      const ref = rr.value;
      const rk = column(ref, check.keyColumn);
      const dk = column(t, check.keyColumn);
      if (typeof rk === 'string') return fail(`reference: ${rk}`);
      if (typeof dk === 'string') return fail(dk);
      const byKey = new Map<string | null, Array<string | null>>();
      for (const row of t.rows) if (!byKey.has(row[dk]!)) byKey.set(row[dk]!, row);
      const map = ref.columns.map((c) => t.columns.indexOf(c));
      let matched = 0;
      for (const row of ref.rows) {
        const d = byKey.get(row[rk]!);
        if (d && map.every((di, ri) => di >= 0 && d[di] === row[ri])) matched++;
      }
      const rate = ref.rows.length ? matched / ref.rows.length : 1;
      return rate >= check.min ? pass(`reference match ${pct(rate)}`) : fail(`reference match ${pct(rate)} below ${pct(check.min)}`);
    }
  }
}

/** Evaluates every check, in declaration order. */
export function evaluateChecks(checks: readonly DeterministicCheck[], input: CheckInput): CheckOutcome[] {
  let cached: ReturnType<typeof toTable> | undefined;
  const table = () => {
    if (cached === undefined) {
      try {
        cached = toTable(input.data.reveal(), input.mime);
      } catch {
        cached = { ok: false, error: 'deliverable could not be read as a table' };
      }
    }
    return cached;
  };
  return checks.map((check) => {
    let o: Outcome;
    try {
      o = evaluate(check, input, table);
    } catch {
      // Hostile shapes (for example JSON nested deep enough to exhaust the stack) fail the check, never the pipeline.
      o = fail('check could not be evaluated on this input');
    }
    const out: CheckOutcome = { checkId: check.id, required: check.required, passed: o.passed };
    if (o.detail !== undefined) out.detail = cap(o.detail);
    return out;
  });
}
