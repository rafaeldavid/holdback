// A strict RFC 4180 CSV parser (comma separator, double-quote quoting, CRLF or LF line ends).
// Single pass, no backtracking. Ragged rows, unterminated quotes and stray quotes are refused.
import { err, ok, type Result } from '@holdback/core';

export interface Csv {
  header: string[];
  rows: string[][];
}

export function parseCsv(text: string): Result<Csv, string> {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let fieldStarted = false;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const n = text[i];
        if (n !== undefined && n !== ',' && n !== '\n' && n !== '\r') return err(`line ${records.length + 1}: text after closing quote`);
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (fieldStarted) return err(`line ${records.length + 1}: quote inside an unquoted field`);
      quoted = true;
      fieldStarted = true;
      i++;
    } else if (c === ',') {
      endField();
      i++;
    } else if (c === '\r' || c === '\n') {
      endRecord();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      fieldStarted = true;
      i++;
    }
  }
  if (quoted) return err('unterminated quoted field');
  if (fieldStarted || record.length > 0) endRecord();
  // A trailing line break does not add a record; a blank line in the middle is a one-empty-field record.
  const [header, ...rows] = records;
  if (!header) return err('empty CSV');
  for (const [n, r] of rows.entries()) {
    if (r.length !== header.length) return err(`row ${n + 1} has ${r.length} fields; the header has ${header.length}`);
  }
  return ok({ header, rows });
}
