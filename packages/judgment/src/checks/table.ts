// A tabular view of a deliverable for the column checks: CSV (header plus rows) or a JSON array of
// flat objects. Empty CSV cells and JSON null or "" are null.
import { canonicalJson, err, ok, type MimeType, type Result } from '@holdback/core';
import { parseCsv } from './csv.js';

export interface Table {
  columns: string[];
  rows: Array<Array<string | null>>;
}

const cell = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : typeof v === 'string' ? v : typeof v === 'object' ? canonicalJson(v) : String(v);

export function toTable(text: string, mime: MimeType): Result<Table, string> {
  if (mime === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err('deliverable is not valid JSON');
    }
    if (!Array.isArray(parsed)) return err('JSON deliverable is not an array of objects');
    const first = parsed[0];
    if (parsed.length > 0 && (typeof first !== 'object' || first === null || Array.isArray(first))) return err('JSON row 0 is not an object');
    const columns = parsed.length ? Object.keys(first as object) : [];
    const key = canonicalJson([...columns].sort());
    const rows: Table['rows'] = [];
    for (const [i, r] of parsed.entries()) {
      if (typeof r !== 'object' || r === null || Array.isArray(r)) return err(`JSON row ${i} is not an object`);
      if (canonicalJson(Object.keys(r).sort()) !== key) return err(`JSON row ${i} has different keys from row 0`);
      rows.push(columns.map((c) => cell((r as Record<string, unknown>)[c])));
    }
    return ok({ columns, rows });
  }
  const csv = parseCsv(text);
  if (!csv.ok) return err(`CSV: ${csv.error}`);
  return ok({ columns: csv.value.header, rows: csv.value.rows.map((r) => r.map((v) => (v === '' ? null : v))) });
}
