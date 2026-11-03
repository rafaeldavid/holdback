// T-031's daily summary lines (`telemetry: "day"`), exported once for both the cost collector and the agent-ops
// phase's telemetry lane (T-042). No credential: Cloudflare's telemetry query API accepts only a Workers
// Observability Write permission (API reference, read 2026-11-03), and a write token is not read-only. So Rafa
// saves the Workers Logs he wants read (a dashboard export, or `wrangler tail --format json` output) into
// `<CROW_TELEMETRY_DIR>/inbox/`; this source finds every day line in those files, of any JSON or JSON-lines
// shape, and writes each as `<CROW_TELEMETRY_DIR>/day-<YYYY-MM-DD>.json`. Day lines hold aggregates, never a
// billing figure (ADR-0024 §1, D39).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalDecimal, makeLine } from '../money.mjs';

export const id = 'telemetry';
export const credentials = [];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The top-level fields of T-031's day line (apps/demo-cloud/src/telemetry.ts, `telemetry: 'day'` and the World's
 * day facts). Only these are copied, so a log record that wraps the line with request headers or other metadata
 * never reaches CROW_TELEMETRY_DIR, which agents may read.
 */
const DAY_FIELDS = ['telemetry', 'day', 'requests', 'routes', 'throttled', 'usage', 'facts', 'journalEntries', 'liveJudges', 'deals', 'outcomes', 'conversion', 'signers'];

const isDayLine = (v) => v && typeof v === 'object' && !Array.isArray(v) && v.telemetry === 'day' && typeof v.day === 'string' && DAY.test(v.day);
const pick = (v) => Object.fromEntries(DAY_FIELDS.filter((k) => Object.hasOwn(v, k)).map((k) => [k, v[k]]));

/** Every `{ telemetry: "day", day }` object inside a parsed value, including inside JSON-encoded strings. */
export function findDayLines(value, out = [], depth = 0) {
  if (depth > 12 || value === null || value === undefined) return out;
  if (typeof value === 'string') {
    if (value.includes('"telemetry"') && value.includes('"day"')) {
      try {
        findDayLines(JSON.parse(value), out, depth + 1);
      } catch {
        // a string that only mentions the words is not a day line
      }
    }
  } else if (Array.isArray(value)) {
    for (const v of value) findDayLines(v, out, depth + 1);
  } else if (typeof value === 'object') {
    if (isDayLine(value)) out.push(pick(value));
    else for (const v of Object.values(value)) findDayLines(v, out, depth + 1);
  }
  return out;
}

function parseFile(text) {
  try {
    return [JSON.parse(text)];
  } catch {
    return text.split('\n').flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l)] : [];
      } catch {
        return [];
      }
    });
  }
}

export async function collect(ctx) {
  const inbox = join(ctx.telemetryDir, 'inbox');
  let names = [];
  try {
    names = readdirSync(inbox).filter((n) => /\.(json|jsonl|ndjson|txt|log)$/.test(n)).sort();
  } catch {
    return { lines: [], files: [], note: 'no inbox yet: save Workers Logs exports in the inbox folder of CROW_TELEMETRY_DIR' };
  }
  const byDay = new Map();
  for (const name of names) {
    for (const value of parseFile(readFileSync(join(inbox, name), 'utf8'))) {
      for (const d of findDayLines(value)) byDay.set(d.day, d);
    }
  }
  const days = [...byDay.keys()].sort();
  const files = days.map((day) => ({ dir: 'telemetry', name: `day-${day}.json`, data: byDay.get(day) }));
  const lines = [];
  const latest = days.length ? byDay.get(days[days.length - 1]) : null;
  if (latest) {
    const line = (product, unit, v) => {
      if (v === undefined || v === null || !/^\d+$/.test(String(v))) return;
      lines.push(makeLine({ source: id, product, unit, quantity: canonicalDecimal(String(v)), basis: 'estimated', periodFrom: latest.day, periodTo: latest.day }));
    };
    line('World Durable Object', 'requests', latest.usage?.requests?.used);
    line('World Durable Object', 'rows-read', latest.usage?.rowsRead?.used);
    line('World Durable Object', 'rows-written', latest.usage?.rowsWritten?.used);
    line('Live judges', 'calls', latest.liveJudges?.calls);
    line('Live judges', 'input_tokens', latest.liveJudges?.inputTokens);
    line('Live judges', 'output_tokens', latest.liveJudges?.outputTokens);
  }
  return { lines, files, note: days.length ? `day lines ${days[0]} to ${days[days.length - 1]}` : 'no day line in the inbox' };
}
