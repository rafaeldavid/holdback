#!/usr/bin/env node
// The benchmark's headline numbers (T-412, roadmap B1), from the harness's records (`crow.metrics.one-click/2`,
// tools/one-click/bench.mjs), for Crow Control's build: approvals per deal, tokens per deal, time without the user,
// and cost per deal. A plain script, deterministic: no model, no network, no clock but generatedAt.
//
//   node scripts/metrics/one-click-summary.mjs --runs control/metrics/one-click --out <out>/metrics/one-click-summary.json
//
// Rules:
// - A headline number comes only from live records whose run reached its scenario's end state (an honest, completed
//   deal). A scripted record, a failed run and a blocked scenario never fill one.
// - Each number is the nearest-rank median of the newest 10 such records (lib.mjs quantile, as the console's medians).
// - The headline counts records in the prompt permission mode only (a record without agent.permissions is one);
//   sandboxAuto holds the same four numbers from sandbox-auto records (T-441). The two never share a median.
// - With no such record a number reads state "missing" and value null, never 0.
// - Every file is checked against scripts/metrics/schemas/one-click.schema.json; a file that fails is counted and named
//   in a gap line, and left out. Version 1 files (run.mjs, the homepage run) are counted and left out: they are not
//   one of the six scenarios.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check, loadSchemas } from './check.mjs';
import { ROOT, cli, envelope, gitCommit, isMain, quantile, writeJson } from './lib.mjs';

export const MEDIAN_OF = 10;
const SCENARIO_IDS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const MAX_BYTES = 1 << 20;

const median = (values) => quantile(values.filter((v) => Number.isSafeInteger(v)).sort((a, b) => a - b), 50);
const bigMedian = (values) => {
  const s = values.filter((v) => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v)).map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const q = quantile(s, 50);
  return q === null ? null : q.toString();
};

/**
 * The summary from parsed records. Pure.
 * @param {{ records: object[], invalid?: string[], v1?: number, generatedAtMs: number, commit: string }} input
 */
export function buildSummary({ records, invalid = [], v1 = 0, generatedAtMs, commit }) {
  const gaps = [];
  if (invalid.length) gaps.push(`${invalid.length} file(s) failed the one-click schema and are left out: ${invalid.slice(0, 5).join(', ')}.`);
  if (v1) gaps.push(`${v1} version 1 run file(s) (the homepage run, run.mjs) are left out: they are not one of the six scenarios.`);
  const newestFirst = [...records].sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
  const live = newestFirst.filter((r) => r.mode === 'live' && r.agent.kind === 'claude-code' && r.world.engine === 'sepolia');
  // T-441: the headline is Claude Code's default permission mode only; sandbox-auto records fill their own block
  const prompt = live.filter((r) => permissionsOf(r) === 'prompt');
  const auto = live.filter((r) => permissionsOf(r) === 'sandbox-auto');
  const deals = prompt.filter((r) => r.outcome.success).slice(0, MEDIAN_OF);
  if (!live.length) gaps.push('No live record yet, so every headline number reads missing. Scripted records prove the harness and never fill one.');
  else if (!prompt.length) gaps.push(`${live.length} live record(s), none in the prompt permission mode, so every headline number reads missing.`);
  else if (!deals.length) gaps.push(`${prompt.length} live prompt-mode record(s), none of which reached its end state, so every headline number reads missing.`);
  if (auto.length) gaps.push(`${auto.length} live sandbox-auto record(s) fill sandboxAuto, not the headline.`);
  const autoDeals = auto.filter((r) => r.outcome.success).slice(0, MEDIAN_OF);
  for (const [ds, what] of [[deals, 'deal(s)'], [autoDeals, 'sandbox-auto deal(s)']]) {
    const priced = ds.filter((r) => r.cost.usdMicros !== null).length;
    if (ds.length && priced < ds.length) gaps.push(`${ds.length - priced} of ${ds.length} ${what} have no cost: a model the price table does not price.`);
  }

  const byScenario = {};
  for (const id of SCENARIO_IDS) {
    const mine = newestFirst.filter((r) => r.scenario.id === id);
    const ownLive = mine.filter((r) => live.includes(r));
    const lastScripted = mine.find((r) => r.mode === 'scripted') ?? null;
    byScenario[id] = {
      live: ownLive.length,
      liveCompleted: ownLive.filter((r) => r.outcome.success).length,
      latestLive: ownLive[0] ? { runId: ownLive[0].runId, state: ownLive[0].outcome.state, success: ownLive[0].outcome.success, permissions: permissionsOf(ownLive[0]) } : null,
      latestScripted: lastScripted ? { runId: lastScripted.runId, state: lastScripted.outcome.state, success: lastScripted.outcome.success, blockedBy: lastScripted.outcome.blockedBy } : null,
    };
  }

  return {
    ...envelope('one-click-summary', { script: 'scripts/metrics/one-click-summary.mjs', commit, generatedAt: generatedAtMs, sources: [], gaps }),
    medianOf: MEDIAN_OF,
    runs: { records: records.length, live: live.length, scripted: records.length - live.length, liveCompleted: live.filter((r) => r.outcome.success).length, invalid: invalid.length, versionOne: v1 },
    headline: headlineOf(deals),
    sandboxAuto: { live: auto.length, liveCompleted: auto.filter((r) => r.outcome.success).length, headline: headlineOf(autoDeals) },
    byScenario,
  };
}

/** A live record's permission mode: a record from before T-441 has none and is a prompt record. */
export const permissionsOf = (r) => r.agent?.permissions ?? 'prompt';

/** The four numbers over completed deals, newest first, at most MEDIAN_OF. Pure. */
function headlineOf(deals) {
  const state = (n) => (n ? 'measured' : 'missing');
  const costs = deals.map((r) => r.cost.usdMicros).filter((v) => v !== null);
  return {
    approvalsPerDeal: { state: state(deals.length), value: median(deals.map((r) => r.approvals.total)), deals: deals.length },
    tokensPerDeal: { state: state(deals.length), in: median(deals.map((r) => r.tokens.in)), uncachedIn: median(deals.map((r) => Object.values(r.tokens.byModel).reduce((n, t) => n + t.input, 0))), out: median(deals.map((r) => r.tokens.out)), total: median(deals.map((r) => r.tokens.in + r.tokens.out)), deals: deals.length },
    timeWithoutUserMs: { state: state(deals.length), value: median(deals.map((r) => r.time.withoutUserMs)), deals: deals.length },
    costPerDealUsdMicros: { state: state(costs.length), value: bigMedian(costs), deals: costs.length },
  };
}

/** Reads every *.json record in `dirs` (not recursive), checked against the schema. */
export function readRecords(dirs, schemas = loadSchemas()) {
  const records = [];
  const invalid = [];
  let v1 = 0;
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    } catch {
      continue;
    }
    for (const f of names) {
      const path = join(dir, f);
      let value;
      try {
        if (statSync(path).size > MAX_BYTES) throw new Error('too large');
        value = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        invalid.push(f);
        continue;
      }
      if (!check('one-click', value, schemas).ok) invalid.push(f);
      else if (value.schema === 'crow.metrics.one-click/1') v1 += 1;
      else records.push(value);
    }
  }
  return { records, invalid, v1 };
}

if (isMain(import.meta.url)) {
  const args = cli({ runs: { type: 'string', multiple: true }, out: { type: 'string' } });
  if (!args.runs?.length || !args.out) {
    console.error('usage: node scripts/metrics/one-click-summary.mjs --runs <dir> [--runs <dir>] --out <file>');
    process.exit(2);
  }
  const schemas = loadSchemas();
  const read = readRecords(args.runs, schemas);
  const summary = buildSummary({ ...read, generatedAtMs: Date.now(), commit: gitCommit(ROOT) });
  const ok = check('one-click-summary', summary, schemas);
  if (!ok.ok) {
    console.error(`FAIL the summary does not match its schema\n${ok.errors.join('\n')}`);
    process.exit(1);
  }
  writeJson(args.out, summary);
  const h = summary.headline;
  const or = (v, unit) => (v === null ? 'missing' : `${v}${unit}`);
  console.log(`ok   ${args.out}: ${summary.runs.records} record(s), ${summary.runs.liveCompleted} completed live deal(s); approvals ${or(h.approvalsPerDeal.value, '')}, tokens ${or(h.tokensPerDeal.total, '')}, time without the user ${or(h.timeWithoutUserMs.value, ' ms')}, cost ${or(h.costPerDealUsdMicros.value, ' micro-USD')}`);
}
