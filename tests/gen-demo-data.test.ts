// Tests for scripts/gen-demo-data.ts (T-012). The checks below are declarative DeterministicCheck
// definitions (current schema), evaluated by @holdback/judgment's built-in check registry. Nothing here
// reads expectations from the generated fixtures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countHidden, runChecks, screen, UntrustedData, type JudgmentCheck } from '../packages/judgment/src/index.ts';
import { B64_PAYLOAD, DATA_DIR, DEFAULT_SEED, generate, type GeneratedFile } from '../scripts/gen-demo-data.ts';
// @ts-expect-error -- plain ESM helper without type declarations
import { loadSpec } from '../scripts/spec.mjs';

const root = new URL('..', import.meta.url).pathname;

/** The deterministic checks the demo's $2,000 terms carry (drafted for fixtures/terms/ in the T-012 Handoff). */
const DEMO_CHECKS: JudgmentCheck[] = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'name', 'email', 'signup_date', 'email_valid'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 9400, max: 9600 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
  { id: 'dates', type: 'iso8601_date_column', required: true, column: 'signup_date' },
  { id: 'id_nulls', type: 'null_rate_max', required: true, column: 'customer_id', maxBps: 0 },
  { id: 'name_nulls', type: 'null_rate_max', required: true, column: 'name', maxBps: 100 },
  { id: 'email_nulls', type: 'null_rate_max', required: true, column: 'email', maxBps: 200 },
  { id: 'emails', type: 'regex_match_rate_min', required: false, column: 'email', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', minBps: 9700 },
];
/** The hidden-character limit in spec/examples/commitment.example.json. The ADR-0021 beat's terms leave it out. */
const NO_HIDDEN: JudgmentCheck = { id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } };

const text = (f: GeneratedFile) => new TextDecoder('utf-8', { fatal: true }).decode(f.bytes);
const failed = (f: GeneratedFile, checks: JudgmentCheck[] = DEMO_CHECKS) =>
  runChecks(checks, { data: UntrustedData.wrap(text(f)), mime: 'text/csv' })
    .outcomes.filter((o) => !o.passed)
    .map((o) => o.checkId);

const files = generate(DEFAULT_SEED);
const file = (name: string) => {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`generator did not produce ${name}`);
  return f;
};
const column = (f: GeneratedFile, name: string) => {
  const [header, ...rows] = text(f).trimEnd().split('\n');
  const i = header!.split(',').indexOf(name);
  // Only for unquoted leading columns (customer_id); names may be quoted.
  return rows.map((r) => r.split(',')[i]!);
};

describe('gen-demo-data', () => {
  it('produces the same bytes for the same seed and different bytes for another seed', () => {
    const again = generate(DEFAULT_SEED);
    expect(again.map((f) => f.name)).toEqual(files.map((f) => f.name));
    for (const [i, f] of files.entries()) expect(Buffer.from(again[i]!.bytes).equals(Buffer.from(f.bytes)), f.name).toBe(true);
    const other = generate(DEFAULT_SEED + 1);
    expect(Buffer.from(other.find((f) => f.name === 'customers.clean.csv')!.bytes).equals(Buffer.from(file('customers.clean.csv').bytes))).toBe(false);
  });

  it('matches the committed files in fixtures/data (regenerate with node scripts/gen-demo-data.ts)', () => {
    for (const f of files) {
      const onDisk = readFileSync(join(root, DATA_DIR, f.name));
      expect(onDisk.equals(Buffer.from(f.bytes)), `${f.name} drifted from the generator`).toBe(true);
    }
  });

  it('uses check definitions that are valid under the commitment schema', () => {
    const { ajv } = loadSpec();
    const validate = ajv.getSchema(`${JSON.parse(readFileSync('spec/schemas/commitment.schema.json', 'utf8')).$id}#/$defs/DeterministicCheck`);
    expect(validate).toBeDefined();
    for (const c of [...DEMO_CHECKS, NO_HIDDEN]) expect(validate(c), `${c.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('keeps the clean file around 0.5 MB with a row count inside the terms', () => {
    const clean = file('customers.clean.csv');
    expect(clean.bytes.length).toBeGreaterThan(450_000);
    expect(clean.bytes.length).toBeLessThan(600_000);
    expect(clean.rows).toBeGreaterThanOrEqual(9400);
    expect(clean.rows).toBeLessThanOrEqual(9600);
  });

  it('clean file passes every demo check, the optional email rate and the hidden-character limit', () => {
    expect(failed(file('customers.clean.csv'), [...DEMO_CHECKS, NO_HIDDEN])).toEqual([]);
  });

  it.each([
    ['customers.clean.row-drop.csv', ['rows']],
    ['customers.clean.dup-keys.csv', ['uniq']],
    ['customers.clean.bad-dates.csv', ['dates']],
    ['customers.clean.missing-column.csv', ['cols']],
    ['customers.clean.blank-cells.csv', ['email_nulls', 'emails']],
  ])('%s fails exactly %j', (name, expected) => {
    expect(failed(file(name))).toEqual(expected);
  });

  it('blank-cells hides its nulls: no more literally empty email cells than the clean file', () => {
    const blankRe = /^$/;
    const emptyIn = (f: GeneratedFile) => {
      const lines = text(f).trimEnd().split('\n').slice(1);
      // email is the third column; names containing commas are quoted, so take it from the right.
      return lines.filter((l) => blankRe.test(l.split(',').at(-3)!)).length;
    };
    expect(emptyIn(file('customers.clean.blank-cells.csv'))).toBe(emptyIn(file('customers.clean.csv')));
  });

  it('hidden-tags passes every demo check but carries a Unicode tag payload aimed at the buyer agent (ADR-0021)', () => {
    const tagged = file('customers.clean.hidden-tags.csv');
    expect(failed(tagged)).toEqual([]);
    expect(failed(tagged, [NO_HIDDEN])).toEqual(['hidden']);
    const body = text(tagged);
    expect(countHidden(body).tag).toBeGreaterThan(20);
    const decoded = [...body]
      .map((c) => c.codePointAt(0)!)
      .filter((cp) => cp > 0xe0000 && cp < 0xe007f)
      .map((cp) => String.fromCodePoint(cp - 0xe0000))
      .join('');
    expect(decoded).toMatch(/agent/i);
    // Stripping the tags gives back the clean file byte for byte: the only change is the hidden payload.
    expect(body.replace(/[\u{E0000}-\u{E007F}]/gu, '')).toBe(text(file('customers.clean.csv')));
  });

  it('injection-base64 passes every demo check, differs from the clean file in one name cell, and the screen flags its decoded instruction (beat 6a, T-018)', () => {
    const injected = file('customers.clean.injection-base64.csv');
    expect(failed(injected, [...DEMO_CHECKS, NO_HIDDEN])).toEqual([]);
    const lines = text(injected).split('\n');
    const clean = text(file('customers.clean.csv')).split('\n');
    const changed = lines.map((l, i) => (l === clean[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toHaveLength(1);
    const run = lines[changed[0]!]!.match(/[A-Za-z0-9+/=]{40,}/)![0];
    expect(Buffer.from(run, 'base64').toString('utf8')).toBe(B64_PAYLOAD);
    const screened = (f: GeneratedFile) => screen({ data: UntrustedData.wrap(text(f)), hiddenTagText: UntrustedData.wrap(''), removed: { tagChars: 0, zeroWidth: 0 }, mime: 'text/csv' });
    const result = screened(injected);
    expect(result.flagged).toBe(true);
    expect(result.signals.some((s) => /base64/.test(s.detail))).toBe(true);
    expect(screened(file('customers.clean.csv')).flagged).toBe(false);
  });

  it('raw file is dirty in the ways the job describes and covers exactly the clean customers', () => {
    const raw = file('customers.raw.csv');
    expect(failed(raw, DEMO_CHECKS.filter((c) => c.id !== 'cols' && c.id !== 'rows'))).toEqual(
      expect.arrayContaining(['uniq', 'dates', 'emails']),
    );
    const rawIds = column(raw, 'customer_id');
    const cleanIds = column(file('customers.clean.csv'), 'customer_id');
    expect(rawIds.length).toBeGreaterThan(cleanIds.length);
    expect([...new Set(rawIds.map((id) => id.trim()))].sort()).toEqual([...cleanIds].sort());
  });

  it('writes a manifest recording each file size, row count and sha256', () => {
    const manifest = JSON.parse(text(file('manifest.json')));
    expect(manifest.seed).toBe(DEFAULT_SEED);
    for (const f of files.filter((x) => x.name.endsWith('.csv'))) {
      const m = manifest.files.find((x: { name: string }) => x.name === f.name);
      expect(m, f.name).toMatchObject({ bytes: f.bytes.length, rows: f.rows });
      expect(m.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
