// A tabular view of a deliverable for the column checks: CSV (header plus rows) or a JSON array of
// flat objects. A cell is a string, null (empty CSV cell, JSON null or ""), or a non-scalar JSON
// value (object, array, boolean) kept apart so no check mistakes it for text.
import { canonicalJson, err, ok, type MimeType, type Result } from '@holdback/core';
import { parseCsv } from './csv.js';

export interface NonScalar {
  nonScalar: 'object' | 'array' | 'boolean';
  text: string;
}
export type Cell = string | null | NonScalar;

export interface Table {
  columns: string[];
  rows: Cell[][];
}

export const isNonScalar = (c: Cell): c is NonScalar => typeof c === 'object' && c !== null;
/** The cell as text for string checks; null and non-scalars have none. */
export const cellText = (c: Cell): string | null => (typeof c === 'string' ? c : null);

function cell(v: unknown): Cell {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return { nonScalar: 'boolean', text: String(v) };
  return { nonScalar: Array.isArray(v) ? 'array' : 'object', text: canonicalJson(v) };
}

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
