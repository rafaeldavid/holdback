// The benchmark harness's record (T-412, roadmap B1): one file per run, `crow.metrics.one-click/2`, checked against
// scripts/metrics/schemas/one-click.schema.json. Pure: it turns the run's bookkeeping into the record, with no model,
// no network and no clock of its own. Every number is a field of its inputs or integer arithmetic on them:
// - approvals: the permission requests the harness answered, the question cards and the chat replies it sent;
// - tokens: the last SDK result message's modelUsage, per model (taken as the session's running total: guessed, and
//   checked against the SDK's own total_cost_usd, which the record keeps beside the computed cost);
// - cost: each model's tokens at its own entry in config/model-prices.json (micro-USD per million tokens), rounded once
//   to the micro-dollar; a model the table does not price leaves the total null, with a gap line;
// - time: wall time, the time the run waited on an approval, and the rest: the time without the user;
// - API calls: the fetch and curl probes' logs (probes.mjs), model vendors and package registries left out;
// - doc gaps: each "GUESS:" line the agent wrote (scenarios.mjs, GUESS_RULE).
// A scripted run's record says mode "scripted"; one-click-summary.mjs never takes a headline number from it.
import { HEX32, divRound, iso } from '../../scripts/metrics/lib.mjs';
import { MODEL_ID, decimalToMicros, priceNumerator, scrub, tokensOf } from './metrics.mjs';

const MILLION = 1_000_000n;
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
export const STATES = ['Released', 'Refunded', 'stopped', 'timedOut', 'blocked'];
// a live run's permission mode (T-441): prompt, Claude Code's default; sandbox-auto, Bash unprompted in the OS sandbox
export const PERMISSION_MODES = ['prompt', 'sandbox-auto'];
// Hosts whose calls are the agent's own tooling, not Crow or the chain: they stay out of the API call count.
const NOT_COUNTED = /(^|\.)(anthropic\.com|claude\.ai|claude\.com|statsig\.com|sentry\.io|npmjs\.org|npmjs\.com|githubusercontent\.com)$/;
const CROW = /(^|\.)(crow\.direct|escrow\.stream)$|^(127\.0\.0\.1|localhost)$/;

/** "2026-11-14T10-00-00Z-s1". */
export const benchRunId = (startedAtMs, scenario) => `${iso(startedAtMs).replace(/:/g, '-')}-${scenario}`;

/** The price entry for a model ID as the SDK reports it ("claude-opus-5-5", "claude-opus-5-5[1m]"): exact, else the longest key it starts with. */
export function priceFor(prices, model) {
  const models = prices?.models ?? {};
  if (models[model]) return { key: model, price: models[model] };
  const key = Object.keys(models).filter((k) => model.startsWith(`${k}[`) || model.startsWith(`${k}-2`)).sort((a, b) => b.length - a.length)[0];
  return key ? { key, price: models[key] } : null;
}

/** Tokens by model, summed over the result messages given. bench.mjs passes the last one only (see the header). */
export function tokensByModel(results) {
  const byModel = {};
  for (const r of results ?? []) {
    for (const [model, usage] of Object.entries(r?.modelUsage ?? {})) {
      if (!MODEL_ID.test(model)) continue;
      const t = tokensOf(usage);
      const m = (byModel[model] ??= { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, thinking: null });
      for (const f of ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output']) m[f] += t[f];
      if (t.thinking !== null) m.thinking = (m.thinking ?? 0) + t.thinking;
    }
  }
  return byModel;
}

/** Each model's tokens at its own list price; { usdMicros, byModel, gaps }. */
export function costOf(byModel, prices) {
  const gaps = [];
  const out = {};
  let total = 0n;
  let priced = true;
  if (!prices?.models) gaps.push('config/model-prices.json could not be read, so the run\'s cost reads unknown.');
  for (const [model, tokens] of Object.entries(byModel)) {
    const p = prices?.models ? priceFor(prices, model) : null;
    if (!prices?.models) {
      priced = false;
      continue;
    }
    if (!p) {
      priced = false;
      gaps.push(`config/model-prices.json has no entry for ${model}, so the run's cost reads unknown.`);
      continue;
    }
    if (p.price.overPromptTokens) gaps.push(`${model} is priced at its base tier; a turn over its long-prompt threshold costs more.`);
    const n = priceNumerator(tokens, p.price);
    out[model] = divRound(n, MILLION).toString();
    total += n;
  }
  return { usdMicros: priced && Object.keys(byModel).length ? divRound(total, MILLION).toString() : null, byModel: out, gaps };
}

/** The API calls the probes logged, as the record counts them. Paths keep no IDs: 32-byte and address hex become <id>. */
export function apiCallsOf(calls) {
  const byHost = {};
  const byStatus = {};
  const errors = {};
  let total = 0;
  let crow = 0;
  for (const c of calls ?? []) {
    let host = 'unknown';
    try {
      host = new URL(c.origin).hostname;
    } catch {
      host = 'unknown';
    }
    if (NOT_COUNTED.test(host)) continue;
    total += 1;
    const origin = host === 'unknown' ? 'unknown' : new URL(c.origin).origin;
    byHost[origin] = (byHost[origin] ?? 0) + 1;
    const status = String(c.status ?? 'none');
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (CROW.test(host)) {
      crow += 1;
      if (c.status === null || c.status >= 400) {
        const key = `${status} ${String(c.method).toUpperCase().slice(0, 8)} ${String(c.path ?? '').replace(/0x[0-9a-fA-F]{40,64}/g, '<id>').slice(0, 120)}`;
        errors[key] = (errors[key] ?? 0) + 1;
      }
    }
  }
  return { total, crow, byHost: cap(byHost, 40), byStatus: cap(byStatus, 40), errors: cap(errors, 40) };
}

const cap = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));

/** Each "GUESS:" line in the agent's text, scrubbed, at most 40. */
export function docGapsOf(texts) {
  const gaps = [];
  for (const t of texts ?? []) for (const m of String(t).matchAll(/^[\s>*-]*GUESS:\s*(.+)$/gim)) gaps.push({ source: 'agent', text: scrub(m[1]).slice(0, 300) });
  return gaps.slice(0, 40);
}

/** Replaces every secret wherever it appears in any string of `value` (hex with and without 0x, and as given). */
export function scrubSecrets(value, secrets) {
  const forms = [...new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 8).flatMap((s) => [s, s.replace(/^0x/i, '')]))].sort((a, b) => b.length - a.length);
  if (!forms.length) return value;
  const walk = (v) => {
    if (typeof v === 'string') return forms.reduce((s, f) => s.split(f).join('<secret>'), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [walk(k), walk(x)]));
    return v;
  };
  return walk(value);
}

/**
 * Builds the record. Pure.
 * @param {{ mode: 'scripted'|'live', scenario: { id: string, name: string, endState: string, party: string }, world: { engine: 'local'|'sepolia', docs: string },
 *   agent: object, outcome: { state: string, commitmentId?: string|null, blockedBy?: string|null, stoppedAt?: string|null },
 *   book: { permissionRequests?: object[], questions?: object[], chatReplies?: object[], wallMs: number, approvalWaitMs?: number, errors?: string[], timedOut?: boolean },
 *   results?: object[], calls?: object[], texts?: string[], prices: object|null, startedAtMs: number, generatedAtMs: number, commit: string, sources?: object[], gaps?: string[] }} input
 */
export function buildBenchRecord({ mode, scenario, world, agent, outcome, book, results = [], calls = [], texts = [], prices, startedAtMs, generatedAtMs, commit, sources = [], gaps: harnessGaps = [] }) {
  const gaps = harnessGaps.map(String).slice(0, 20);
  const requests = book.permissionRequests ?? [];
  const questions = book.questions ?? [];
  const replies = book.chatReplies ?? [];
  const byTool = {};
  for (const r of requests) {
    const tool = String(r.tool).replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || 'unknown';
    byTool[tool] = (byTool[tool] ?? 0) + 1;
  }
  const last = results.length ? results[results.length - 1] : null;
  const byModel = tokensByModel(last ? [last] : []);
  const cost = costOf(byModel, prices);
  gaps.push(...cost.gaps);
  const sdkMicros = typeof last?.total_cost_usd === 'number' && Number.isFinite(last.total_cost_usd) && last.total_cost_usd >= 0 ? decimalToMicros(String(last.total_cost_usd)) : null;
  const sdkReported = sdkMicros === null ? null : sdkMicros.toString();
  if (results.length > 1) gaps.push(`${results.length} result messages: tokens, cost and model time are the last one's, taken as the session's running total (guessed); compare cost.sdkReportedUsdMicros.`);
  if (sdkMicros !== null && cost.usdMicros !== null && sdkMicros > 0n) {
    const diff = BigInt(cost.usdMicros) - sdkMicros;
    if ((diff < 0n ? -diff : diff) * 20n > sdkMicros) gaps.push(`The computed cost (${cost.usdMicros} micro-USD) differs from the SDK's own (${sdkReported}) by more than 5 percent.`);
  }
  let tokensIn = 0;
  let tokensOut = 0;
  for (const t of Object.values(byModel)) {
    tokensIn += t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
    tokensOut += t.output;
  }
  const modelMs = Number.isSafeInteger(last?.duration_api_ms) && last.duration_api_ms >= 0 ? last.duration_api_ms : null;
  const wallMs = count(book.wallMs);
  const approvalWaitMs = Math.min(wallMs, count(book.approvalWaitMs));
  const state = book.timedOut ? 'timedOut' : STATES.includes(outcome.state) ? outcome.state : 'stopped';
  const success = state === scenario.endState;
  if (!success && state !== 'blocked') gaps.push(`The run ended ${state}, not ${scenario.endState}, so it stays out of the headline numbers.`);
  if (mode === 'scripted') gaps.push('A scripted run: no model and no person, so it proves the harness and the scenario path, and fills no headline number.');
  const commitmentId = typeof outcome.commitmentId === 'string' && HEX32.test(outcome.commitmentId) ? outcome.commitmentId.toLowerCase() : null;
  return {
    schema: 'crow.metrics.one-click/2',
    generatedAt: iso(generatedAtMs),
    generator: { script: 'tools/one-click/bench.mjs', commit },
    sources,
    gaps: gaps.slice(0, 50),
    runId: benchRunId(startedAtMs, scenario.id),
    mode,
    scenario: { id: scenario.id, name: scenario.name, endState: scenario.endState, party: scenario.party },
    world: { engine: world.engine, docs: String(world.docs).slice(0, 200) },
    agent: {
      kind: mode === 'scripted' ? 'scripted' : 'claude-code',
      script: typeof agent.script === 'string' ? agent.script.slice(0, 120) : null,
      requested: typeof agent.requested === 'string' && MODEL_ID.test(agent.requested) ? agent.requested : null,
      reported: typeof agent.reported === 'string' && MODEL_ID.test(agent.reported) ? agent.reported : null,
      effortRequested: agent.effortRequested ?? null,
      effortApplied: agent.effortApplied ?? null,
      claudeCodeVersion: typeof agent.claudeCodeVersion === 'string' && /^\d+\.\d+\.\d+/.test(agent.claudeCodeVersion) ? agent.claudeCodeVersion.slice(0, 40) : null,
      sdkVersion: typeof agent.sdkVersion === 'string' && /^\d+\.\d+\.\d+$/.test(agent.sdkVersion) ? agent.sdkVersion : null,
      // T-441: a live record names its permission mode; a record without it (before T-441) is a prompt record
      ...(mode === 'live' ? { permissions: PERMISSION_MODES.includes(agent.permissions) ? agent.permissions : 'prompt' } : {}),
    },
    outcome: {
      success,
      state,
      commitmentId,
      blockedBy: state === 'blocked' ? scrub(outcome.blockedBy ?? 'unknown') : null,
      stoppedAt: success || state === 'blocked' ? null : outcome.stoppedAt ? scrub(outcome.stoppedAt) : null,
    },
    approvals: { total: requests.length + questions.length + replies.length, toolPermission: requests.length, questionCards: questions.length, chatReplies: replies.length, byTool },
    tokens: { in: tokensIn, out: tokensOut, byModel },
    cost: { usdMicros: cost.usdMicros, sdkReportedUsdMicros: sdkReported, byModel: cost.byModel, priceTable: { file: 'config/model-prices.json', readOn: /^\d{4}-\d{2}-\d{2}$/.test(prices?.readOn ?? '') ? prices.readOn : '1970-01-01' } },
    time: { wallMs, approvalWaitMs, withoutUserMs: wallMs - approvalWaitMs, modelMs },
    apiCalls: apiCallsOf(calls),
    errors: (book.errors ?? []).slice(0, 20).map(scrub),
    docGaps: docGapsOf(texts),
    timedOut: !!book.timedOut,
  };
}
