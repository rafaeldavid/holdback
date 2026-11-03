#!/usr/bin/env node
// The read-only cost collector (T-052). Run it only in the dedicated clone, with the keys file Rafa keeps there:
//
//   node --env-file=.env.costs scripts/costs/collect.mjs
//
// It checks the approval first, then the two directories, then reads every source whose credentials are set,
// each with a timeout, and writes `<CROW_COSTS_DIR>/<date>.json` and `latest.json`. A source that fails records
// its error type and status, never a response body or a header; the others still run. It prints only which
// sources it read and which it could not. Every file under scripts/costs imports only node: modules, so no
// package from the lockfile runs with the billing keys.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalRefused, checkApproved, cloneRootOf } from './approved.mjs';
import { DirRefused, resolveDirs } from './dir.mjs';
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

/** The month to date, in UTC dates. */
export function periodOf(now) {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** Rafa's budgets.json in the cost directory (template: config/costs.template.json), or nothing. */
export function readConfig(costsDir) {
  const file = join(costsDir, 'budgets.json');
  if (!existsSync(file)) return {};
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
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
    }, TIMEOUT_MS[source.id] ?? DEFAULT_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([source.collect({ ...ctx, signal: controller.signal }), timeout]);
    const { lines, files = [], note = source.note } = Array.isArray(result) ? { lines: result } : result;
    return { status: { source: source.id, ok: true, ...(note ? { note } : {}) }, lines, files };
  } catch (e) {
    const error = e instanceof SourceError ? { type: e.type, status: e.status } : { type: 'unexpected', status: null };
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
 * Collects every source and writes the day's file. Options exist for tests: a fake fetch, clock, sleep and
 * transcript folder, and a clone root. Throws ApprovalRefused, DirRefused or ConfigRefused before any source runs.
 */
export async function collect({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  cloneRoot,
  sources = SOURCES,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  claudeProjectsDir,
  log = (line) => console.log(line),
} = {}) {
  const root = cloneRoot ?? cloneRootOf(dirname(fileURLToPath(import.meta.url)));
  checkApproved(root);
  const { costsDir, telemetryDir } = resolveDirs(env, root);
  const config = readConfig(costsDir);
  const period = periodOf(now);
  const ctx = { env, fetch: fetchImpl, now, period, config, cloneRoot: root, telemetryDir, sleep, claudeProjectsDir };
  const results = await Promise.all(sources.map((s) => runSource(s, ctx)));
  const doc = { date: period.to, lines: results.flatMap((r) => r.lines), sources: results.map((r) => r.status) };
  for (const r of results) {
    for (const f of r.files) writeJson(join(f.dir === 'telemetry' ? telemetryDir : costsDir, f.name), f.data);
  }
  writeJson(join(costsDir, `${period.to}.json`), doc);
  writeJson(join(costsDir, 'latest.json'), doc);
  for (const s of doc.sources) log(describe(s));
  log(`wrote ${join(costsDir, 'latest.json')}`);
  return doc;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Exit once the files are written, even if a timed-out source is still reading.
  collect().then(
    () => process.exit(0),
    (e) => {
      const known = e instanceof ApprovalRefused || e instanceof DirRefused || e instanceof ConfigRefused;
      console.error(known ? `refused: ${e.message}` : 'failed: unexpected error');
      process.exit(1);
    },
  );
}
