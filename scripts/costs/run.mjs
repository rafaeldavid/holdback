// The cost collector itself (T-052), loaded by collect.mjs only after the approval check passes and the keys are
// loaded. It checks the two directories, reads every source whose credentials are set, each with a timeout, and
// writes `<CROW_COSTS_DIR>/<date>.json` and `latest.json`. A source that fails records its error type and status,
// never a response body or a header; the others still run. It prints only which sources it read and which it
// could not.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ApprovalRefused, checkApproved } from './approved.mjs';
import { DirRefused, resolveDirs } from './dir.mjs';
import { DecimalError, parseJsonExact } from './money.mjs';
import { SourceError } from './sources/http.mjs';
import * as anthropic from './sources/anthropic.mjs';
import * as claudeCode from './sources/claude-code.mjs';
import * as cloudflareAnalytics from './sources/cloudflare-analytics.mjs';
import * as cloudflareBilling from './sources/cloudflare-billing.mjs';
import * as deepseek from './sources/deepseek.mjs';
import * as github from './sources/github.mjs';
import * as sepolia from './sources/sepolia.mjs';
import * as telemetry from './sources/telemetry.mjs';

export const SOURCES = [cloudflareBilling, cloudflareAnalytics, anthropic, github, deepseek, sepolia, claudeCode, telemetry];

/** Per-source time limits: the Sepolia source may wait two minutes for a second read; transcripts are large. */
const TIMEOUT_MS = { sepolia: 300_000, 'claude-code': 600_000 };
const DEFAULT_TIMEOUT_MS = 60_000;

export class ConfigRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigRefused';
  }
}

/** A refusal to explain to Rafa, as opposed to an unexpected failure. */
export const isRefusal = (e) => e instanceof ApprovalRefused || e instanceof DirRefused || e instanceof ConfigRefused;

/** The month to date, in UTC dates. */
export function periodOf(now) {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** Rafa's budgets.json in the cost directory (template: config/costs.template.json), or nothing. Amounts stay exact. */
export function readConfig(costsDir) {
  const file = join(costsDir, 'budgets.json');
  if (!existsSync(file)) return {};
  try {
    const config = parseJsonExact(readFileSync(file, 'utf8'));
    if (config && typeof config === 'object' && !Array.isArray(config)) return config;
  } catch {
    // reported below
  }
  throw new ConfigRefused('budgets.json in CROW_COSTS_DIR is not a JSON object');
}

function writeJson(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Runs one source: not configured, read, or failed with a type and status. */
export async function runSource(source, ctx) {
  const missing = source.credentials.filter((k) => !ctx.env[k]);
  if (missing.length) return { status: { source: source.id, ok: false, error: { type: 'not_configured', status: null } }, lines: [], files: [] };
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SourceError('timeout'));
    }, ctx.timeoutMs ?? TIMEOUT_MS[source.id] ?? DEFAULT_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([source.collect({ ...ctx, signal: controller.signal }), timeout]);
    const { lines, files = [], note = source.note } = Array.isArray(result) ? { lines: result } : result;
    return { status: { source: source.id, ok: true, ...(note ? { note } : {}) }, lines, files };
  } catch (e) {
    const error =
      e instanceof SourceError ? { type: e.type, status: e.status } : e instanceof DecimalError ? { type: 'parse', status: null } : { type: 'unexpected', status: null };
    return { status: { source: source.id, ok: false, error }, lines: [], files: [] };
  } finally {
    clearTimeout(timer);
  }
}

function describe(s) {
  if (s.ok) return `${s.source}: read`;
  if (s.error.type === 'not_configured') return `${s.source}: not configured`;
  return `${s.source}: failed (${s.error.type}${s.error.status ? ` ${s.error.status}` : ''})`;
}

/**
 * Collects every source and writes the day's file. Options exist for tests: a fake fetch, clock, sleep, timeout
 * and transcript folder, and a clone root. Throws ApprovalRefused, DirRefused or ConfigRefused before any source
 * runs. The approval is checked again here, so a caller other than collect.mjs cannot skip it.
 */
export async function collect({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  cloneRoot,
  sources = SOURCES,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs,
  claudeProjectsDir,
  log = (line) => console.log(line),
}) {
  checkApproved(cloneRoot);
  const { costsDir, telemetryDir } = resolveDirs(env, cloneRoot);
  const config = readConfig(costsDir);
  const period = periodOf(now);
  const ctx = { env, fetch: fetchImpl, now, period, config, cloneRoot, telemetryDir, sleep, timeoutMs, claudeProjectsDir };
  const results = await Promise.all(sources.map((s) => runSource(s, ctx)));
  const doc = { date: period.to, lines: results.flatMap((r) => r.lines), sources: results.map((r) => r.status) };
  for (const r of results) {
    for (const f of r.files) {
      if (basename(f.name) !== f.name || f.name.startsWith('.')) continue;
      writeJson(join(f.dir === 'telemetry' ? telemetryDir : costsDir, f.name), f.data);
    }
  }
  writeJson(join(costsDir, `${period.to}.json`), doc);
  writeJson(join(costsDir, 'latest.json'), doc);
  for (const s of doc.sources) log(describe(s));
  log(`wrote ${join(costsDir, 'latest.json')}`);
  return doc;
}
