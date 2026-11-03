// Stage 1, deterministic checks. The registry is a closed union: exactly the check types in
// commitment.schema.json, each evaluated by built-in code over data. Nothing from a commitment or a
// deliverable is executed.
//
// Checks run on the decoded text exactly as delivered (intake `raw`), never on normalized text, so
// fullwidth digits or hidden characters cannot be folded into passing values.
//
// A check that cannot be evaluated (bad pattern, unsupported schema keyword, missing reference,
// unknown type, hostile shape) fails closed. A check that runs out of the shared work budget is
// inconclusive: it is recorded as not passed, and the pipeline escalates instead of rejecting.
import type { MimeType } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { countHidden, type HiddenCounts } from '../hidden.js';
import { normalizeText } from '../normalize.js';
import type { JudgmentCheck } from '../terms.js';
import type { UntrustedData } from '../untrusted.js';
import { isIso8601 } from './iso8601.js';
import { compileJsonSchema } from './json-schema.js';
import { BudgetExhausted, compileSafeRegex, StepBudget } from './safe-regex.js';
import { cellText, isNonScalar, toTable, type Cell, type Table } from './table.js';

export type CheckType = JudgmentCheck['type'];

/** judgment.schema.json `deterministic[]`. */
export interface CheckOutcome {
  checkId: string;
  required: boolean;
  passed: boolean;
  detail?: string;
}

export interface CheckInput {
  /** The deliverable text as delivered (not normalized). */
  data: UntrustedData;
  mime: MimeType;
  /** Reference files by committed sha256, as fetched (unverified) bytes. */
  references?: ReadonlyMap<string, Uint8Array>;
}

export interface CheckRun {
  outcomes: CheckOutcome[];
  /** Ids of checks that ran out of budget: not evaluated, so neither passed nor failed. */
  inconclusive: string[];
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
  hidden_characters_max: true,
} as const satisfies Record<CheckType, true>;
export const CHECK_TYPES: ReadonlySet<CheckType> = new Set(Object.keys(REGISTRY) as CheckType[]);

/** Work allowance per delivery across all checks, in regex state visits and schema node visits. */
export const CHECK_BUDGET = 50_000_000;

/**
 * Cell values null_rate_max counts as null after trimming: built-in, case-insensitive. A per-check
 * list would need a schema field (see the task's Handoff).
 */
export const NULL_TOKENS: ReadonlySet<string> = new Set(['null', 'nil', 'n/a', 'nan', 'undefined', '-', '--', '?']);
/** Whitespace, format characters (zero-width, bidi, tags) and blank-looking letters such as fillers. */
const BLANK_CHAR = /[\s\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/u;

/** Null for null_rate_max: empty, blank-looking, a null token, or a non-scalar JSON value. */
export function isNullish(c: Cell): boolean {
  if (c === null || isNonScalar(c)) return true;
  // Character by character: a regex loop over a multi-megabyte cell can overflow the stack.
  const chars = [...c];
  let start = 0;
  let end = chars.length;
  while (start < end && BLANK_CHAR.test(chars[start]!)) start++;
  while (end > start && BLANK_CHAR.test(chars[end - 1]!)) end--;
  if (start === end) return true;
  return end - start <= 16 && NULL_TOKENS.has(chars.slice(start, end).join('').toLowerCase());
}

const DETAIL_MAX = 300;
const cap = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 3)}...` : s);
/** Display only; decisions use integer cross-multiplication. */
const pct = (count: number, total: number) => (total ? `${count}/${total}` : '0/0');
const bps = (b: number) => `${b} bps`;
const isBps = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 10_000;
const isCount = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const HIDDEN_KEYS = ['tag', 'bidi', 'variationSelector', 'otherIgnorable', 'total'] as const;

/** Static validation, usable at offer time. Returns a reason the check cannot be evaluated, or undefined. */
export function validateCheck(check: JudgmentCheck): string | undefined {
  const type: string = check.type;
  if (!CHECK_TYPES.has(type as CheckType)) return `unknown check type ${type.slice(0, 40)}`;
  switch (check.type) {
    case 'row_count_range':
      return check.min > check.max ? 'min is greater than max' : undefined;
    case 'null_rate_max':
      return isBps(check.maxBps) ? undefined : 'maxBps must be an integer 0..10000';
    case 'reference_row_match_min':
      return isBps(check.minBps) ? undefined : 'minBps must be an integer 0..10000';
    case 'regex_match_rate_min': {
      if (!isBps(check.minBps)) return 'minBps must be an integer 0..10000';
      const r = compileSafeRegex(check.pattern);
      return r.ok ? undefined : `pattern refused: ${r.error}`;
    }
    case 'hidden_characters_max': {
      const keys = Object.keys(check.max ?? {});
      if (keys.length === 0) return 'max must name at least one class';
      for (const k of keys) {
        if (!(HIDDEN_KEYS as readonly string[]).includes(k)) return `unknown hidden-character class ${k.slice(0, 40)}`;
        if (!isCount((check.max as Record<string, unknown>)[k])) return `max.${k} must be a non-negative integer`;
      }
      return undefined;
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

function evaluate(check: JudgmentCheck, input: CheckInput, table: () => ReturnType<typeof toTable>, budget: StepBudget): Outcome {
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
    const e = v.ok ? v.value(value, budget) : v.error;
    return e === undefined ? pass() : fail(`schema: ${e}`);
  }
  if (check.type === 'hidden_characters_max') {
    // Counted on the text as delivered, every occurrence, legitimate or not (D17).
    const counts: HiddenCounts = countHidden(input.data.reveal());
    const over = HIDDEN_KEYS.filter((k) => check.max[k] !== undefined && counts[k] > check.max[k]!);
    const summary = HIDDEN_KEYS.map((k) => `${k} ${counts[k]}`).join(', ');
    return over.length ? fail(`over the limit for ${over.join(', ')} (${summary})`) : pass(summary);
  }
  if (check.type === 'csv_columns_exact' && input.mime !== 'text/csv') return fail(`csv_columns_exact needs a text/csv deliverable, not ${input.mime}`);
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
      const nulls = t.rows.filter((row) => isNullish(row[i]!)).length;
      const ok = nulls * 10_000 <= check.maxBps * t.rows.length;
      return ok ? pass(`null ${pct(nulls, t.rows.length)}`) : fail(`null ${pct(nulls, t.rows.length)} exceeds ${bps(check.maxBps)}`);
    }
    case 'regex_match_rate_min': {
      const i = column(t, check.column);
      if (typeof i === 'string') return fail(i);
      const re = compileSafeRegex(check.pattern);
      if (!re.ok) return fail(re.error);
      let matches = 0;
      for (const row of t.rows) {
        const s = cellText(row[i]!);
        if (s !== null && re.value.fullMatch(s, budget)) matches++;
      }
      // Zero rows match vacuously; row_count_range governs emptiness.
      const ok = t.rows.length === 0 || matches * 10_000 >= check.minBps * t.rows.length;
      return ok ? pass(`match ${pct(matches, t.rows.length)}`) : fail(`match ${pct(matches, t.rows.length)} below ${bps(check.minBps)}`);
    }
    case 'iso8601_date_column': {
      const i = column(t, check.column);
      if (typeof i === 'string') return fail(i);
      const bad = t.rows.findIndex((row) => row[i] !== null && (isNonScalar(row[i]!) || !isIso8601(row[i] as string)));
      return bad < 0 ? pass() : fail(`row ${bad + 1} is not an ISO 8601 date`);
    }
    case 'reference_row_match_min': {
      const bytes = input.references?.get(check.reference.sha256);
      if (!bytes) return fail('reference not available');
      if (sha256(bytes) !== check.reference.sha256) return fail('reference bytes do not match the committed hash');
      let text: string;
      try {
        // The reference is compared as committed: decoded, not normalized, like the deliverable.
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return fail('reference is not valid UTF-8');
      }
      if (normalizeText(text).tagChars > 0) return fail('reference contains Unicode tag characters');
      const rr = toTable(text, input.mime);
      if (!rr.ok) return fail(`reference: ${rr.error}`);
      const ref = rr.value;
      const rk = column(ref, check.keyColumn);
      const dk = column(t, check.keyColumn);
      if (typeof rk === 'string') return fail(`reference: ${rk}`);
      if (typeof dk === 'string') return fail(dk);
      const keyOf = (c: Cell) => JSON.stringify(c);
      const byKey = new Map<string, Cell[]>();
      for (const row of t.rows) if (!byKey.has(keyOf(row[dk]!))) byKey.set(keyOf(row[dk]!), row);
      const map = ref.columns.map((c) => t.columns.indexOf(c));
      let matched = 0;
      for (const row of ref.rows) {
        const d = byKey.get(keyOf(row[rk]!));
        if (d && map.every((di, ri) => di >= 0 && keyOf(d[di]!) === keyOf(row[ri]!))) matched++;
      }
      const ok = ref.rows.length === 0 || matched * 10_000 >= check.minBps * ref.rows.length;
      return ok ? pass(`reference match ${pct(matched, ref.rows.length)}`) : fail(`reference match ${pct(matched, ref.rows.length)} below ${bps(check.minBps)}`);
    }
  }
}

/** Evaluates every check in declaration order under one shared budget, reporting inconclusive ones. */
export function runChecks(checks: readonly JudgmentCheck[], input: CheckInput, budget = new StepBudget(CHECK_BUDGET)): CheckRun {
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
  const inconclusive: string[] = [];
  const outcomes = checks.map((check) => {
    let o: Outcome;
    try {
      o = evaluate(check, input, table, budget);
    } catch (e) {
      if (e instanceof BudgetExhausted) {
        inconclusive.push(check.id);
        o = fail('inconclusive: the check work budget for this delivery ran out');
      } else {
        // Hostile shapes (for example JSON nested deep enough to exhaust the stack) fail the check, never the pipeline.
        o = fail('check could not be evaluated on this input');
      }
    }
    const out: CheckOutcome = { checkId: check.id, required: check.required, passed: o.passed };
    if (o.detail !== undefined) out.detail = cap(o.detail);
    return out;
  });
  return { outcomes, inconclusive };
}

/** Evaluates every check, in declaration order. See runChecks for inconclusive results. */
export function evaluateChecks(checks: readonly JudgmentCheck[], input: CheckInput, budget?: StepBudget): CheckOutcome[] {
  return runChecks(checks, input, budget).outcomes;
}
