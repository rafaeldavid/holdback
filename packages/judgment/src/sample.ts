// Seeded, recomputable sampling of a large CSV for the panel (T-009; T-008 Handoff item 1).
//
// A deliverable over the prompt's data budget is shown to each judge as:
//   - the header record;
//   - the first SAMPLE_HEAD and last SAMPLE_TAIL data records;
//   - records drawn uniformly at random from the rest, without replacement, from a seed fixed before
//     judging (the panel seed), until the next drawn record does not fit the budget;
// all in file order. The seed is revealed in the Decision (primary) or comes from a beacon round
// (fallback and appeal, ADR-0018), so anyone holding the plaintext can recompute each judge's sample,
// and with it the judge's inputHash. The seller does not know the seed when it delivers, so it cannot
// steer bad rows away from the sample; deterministic checks still run on the whole file.
//
// Only CSV is row-sampled. Anything else over the budget, a CSV with an unterminated quote, or any
// record longer than the budget / MIN_SAMPLED_ROWS is "unsampleable": the prompt falls back to the
// even-stride sample, and the pipeline escalates as before.
import { bytesToBigInt, concat, keccak256, numberToBytes, stringToBytes, toBytes } from 'viem';
import type { Hex32 } from '@holdback/core';

export const SAMPLE_VERSION = 'sample-1';
export const SAMPLE_HEAD = 20;
export const SAMPLE_TAIL = 20;
/** No record may cost more than maxChars / MIN_SAMPLED_ROWS, so a sample always shows about this many rows. */
export const MIN_SAMPLED_ROWS = 100;

/**
 * The i-th draw of a seeded stream, in [0, range): keccak256(seed || label || uint64 i) mod range.
 * The modulo bias is below 2^-200 for any range a file can have.
 */
export function seededIndex(seed: Hex32, label: string, i: number, range: number): number {
  if (!Number.isSafeInteger(range) || range <= 0) throw new RangeError('range must be a positive integer');
  const h = keccak256(concat([toBytes(seed), stringToBytes(label), numberToBytes(BigInt(i), { size: 8 })]));
  return Number(bytesToBigInt(toBytes(h)) % BigInt(range));
}

/**
 * Splits CSV text into records at line breaks outside double quotes (RFC 4180 quoting), keeping each
 * record's text exactly. A trailing line break does not make an empty record. Null on an unterminated quote.
 */
export function csvRecords(text: string): string[] | null {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) quoted = !quoted;
    else if (!quoted && (c === 10 || c === 13)) {
      out.push(text.slice(start, i));
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  if (quoted) return null;
  if (start < text.length) out.push(text.slice(start));
  return out;
}

export interface CsvSample {
  /** Header first, then the sampled data records in file order. */
  records: string[];
  head: number;
  tail: number;
  random: number;
  /** Data records in the whole file. */
  totalRows: number;
}

/**
 * Samples records (header first) within `maxChars` (each record counts its length plus a line break).
 * Null (unsampleable) when any record costs more than maxChars / MIN_SAMPLED_ROWS: such a record could
 * never be shown and could hide anything. Under that cap every sample shows at least
 * min(MIN_SAMPLED_ROWS - 1, rows) data rows.
 */
export function sampleCsv(records: readonly string[], maxChars: number, seed: Hex32): CsvSample | null {
  if (records.length === 0) return null;
  const cost = (k: number) => records[k]!.length + 1;
  for (let k = 0; k < records.length; k++) if (cost(k) * MIN_SAMPLED_ROWS > maxChars) return null;
  let used = cost(0);
  const n = records.length - 1;
  const chosen = new Set<number>();
  const take = (k: number): boolean => {
    if (used + cost(k) > maxChars) return false;
    used += cost(k);
    chosen.add(k);
    return true;
  };
  let head = 0;
  for (let k = 1; k <= Math.min(SAMPLE_HEAD, n) && take(k); k++) head++;
  let tail = 0;
  for (let k = n; k > n - Math.min(SAMPLE_TAIL, n - head) && take(k); k--) tail++;
  // Partial Fisher-Yates over the middle records, in draw order; stop at the first that does not fit.
  const middle: number[] = [];
  for (let k = 1 + head; k <= n - tail; k++) middle.push(k);
  let random = 0;
  for (let i = 0; i < middle.length; i++) {
    const j = i + seededIndex(seed, SAMPLE_VERSION, i, middle.length - i);
    [middle[i], middle[j]] = [middle[j]!, middle[i]!];
    if (!take(middle[i]!)) break;
    random++;
  }
  const order = [...chosen].sort((a, b) => a - b);
  return { records: [records[0]!, ...order.map((k) => records[k]!)], head, tail, random, totalRows: n };
}
