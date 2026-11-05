// One-Click Escrow's run file (T-066, headline metrics 1 to 3, the assistant's side). Pure: it turns the Agent SDK's
// init and result messages and the harness's own bookkeeping into one-click/<runId>.json, with no model, no network
// and no clock of its own. Every number is a field of those inputs, or integer arithmetic on them:
// - approvals: the harness's canUseTool calls (toolPermission) plus the questions it answered and the chat replies it
//   sent (conversational);
// - tokens and the SDK's cost: the result's modelUsage, usage, total_cost_usd and num_turns, kept as given;
// - the cost at Opus 5.5: every model's tokens at the claude-opus-5-5 entry of config/model-prices.json, rounded once
//   to the micro-dollar;
// - time: the result's duration_api_ms and duration_ms, and the harness's tool and approval spans.
import { HEX32, divRound, iso } from '../../scripts/metrics/lib.mjs';

export const OPUS = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MILLION = 1_000_000n;
const PRICE_FIELDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output'];
const MODEL_ID = /^[a-z0-9.@[\]-]{1,64}$/;

const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

// Control, line-separator and direction characters, built from code points at run time so this file holds none of
// them (as crow-private control/deps.mjs does): C0 and C1 controls, zero-width marks, line and paragraph separators,
// embeddings and overrides, isolates, and the byte-order mark.
const HIDDEN = new RegExp(
  `[${[[0x0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]]
    .map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`)
    .join('')}]+`,
  'gu',
);

/**
 * A command or URL as the run file may keep it: one line, local paths replaced, long opaque runs cut, at most 300
 * characters. The fresh assistant writes these, so nothing in them is trusted.
 */
export function scrub(text) {
  return String(text ?? '')
    .slice(0, 4000)
    .replace(HIDDEN, ' ')
    .replace(/\/(?:Users|home|private|var|tmp|opt|root)\/[^\s'"`;|&)]*/g, '<local path>')
    .replace(/\b(sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9+/_=-]{120,})/g, '<redacted>')
    .slice(0, 300);
}

/** A decimal or exponent string (the SDK's dollar figures, as String(number) gives them) as micro-USD, rounded. */
export function decimalToMicros(text) {
  const m = /^(\d{1,30})(?:\.(\d{1,30}))?(?:[eE]([+-]?\d{1,3}))?$/.exec(String(text));
  if (!m) return null;
  const frac = m[2] ?? '';
  const digits = BigInt(`${m[1]}${frac}`);
  const power = Number.parseInt(m[3] ?? '0', 10) - frac.length + 6;
  return power >= 0 ? digits * 10n ** BigInt(power) : divRound(digits, 10n ** BigInt(-power));
}

/** The tokens of one modelUsage entry, in the run file's names. A cache write the SDK did not split counts as 5-minute. */
export function tokensOf(u) {
  const w5 = count(u?.cacheCreationEphemeral5mInputTokens);
  const w1 = count(u?.cacheCreationEphemeral1hInputTokens);
  const unsplit = Math.max(0, count(u?.cacheCreationInputTokens) - w5 - w1);
  return {
    input: count(u?.inputTokens),
    cacheWrite5m: w5 + unsplit,
    cacheWrite1h: w1,
    cacheRead: count(u?.cacheReadInputTokens),
    output: count(u?.outputTokens),
    thinking: Number.isSafeInteger(u?.thinkingTokens) ? u.thinkingTokens : null,
  };
}

/** Σ tokens × price (micro-USD per million tokens), as a bigint numerator over 10^6. Thinking is inside output. */
export function priceNumerator(tokens, price) {
  let n = 0n;
  for (const f of PRICE_FIELDS) n += BigInt(tokens[f]) * BigInt(price[f]);
  return n;
}

/** The length of the union of [start, end) spans, so parallel tool calls are not counted twice. */
export function unionMs(spans) {
  const s = spans.filter((x) => Number.isSafeInteger(x.startMs) && Number.isSafeInteger(x.endMs) && x.endMs >= x.startMs).sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const x of s) {
    if (curEnd === null || x.startMs > curEnd) {
      if (curEnd !== null) total += curEnd - curStart;
      curStart = x.startMs;
      curEnd = x.endMs;
    } else if (x.endMs > curEnd) curEnd = x.endMs;
  }
  if (curEnd !== null) total += curEnd - curStart;
  return total;
}

/** "2026-11-05T13-35-12Z-buyer". */
export const runIdOf = (startedAtMs, scenario) => `${iso(startedAtMs).replace(/:/g, '-')}-${scenario}`;

/**
 * Builds the run file. Pure.
 * @param {{ init: object|null, result: object|null, book: object, options: { scenario: string, model: string|null,
 *   effort: string|null, maxReplies: number, timeoutMs: number }, prices: object|null, startedAtMs: number,
 *   generatedAtMs: number, commit: string, sdkVersion: string, cloudflare?: object|null, sources?: object[] }} input
 */
export function buildRunFile({ init, result, book, options, prices, startedAtMs, generatedAtMs, commit, sdkVersion, cloudflare = null, sources = [] }) {
  const gaps = [];
  const opus = prices?.models?.[OPUS] ?? null;
  if (!opus) gaps.push('config/model-prices.json has no claude-opus-5-5 entry, so the cost at Opus 5.5 reads unknown.');

  // Approvals.
  const requests = (book.permissionRequests ?? []).filter((r) => r.tool !== 'AskUserQuestion');
  const conversational = book.conversational ?? [];
  const byTool = {};
  for (const r of requests) {
    const tool = String(r.tool).replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || 'unknown';
    byTool[tool] = (byTool[tool] ?? 0) + 1;
  }

  // Tokens and cost.
  const byModel = {};
  const atOpusByModel = {};
  const sdkByModel = {};
  let numerator = 0n;
  for (const [model, usage] of Object.entries(result?.modelUsage ?? {})) {
    if (!MODEL_ID.test(model)) continue;
    byModel[model] = tokensOf(usage);
    if (typeof usage?.costUSD === 'number' && Number.isFinite(usage.costUSD)) sdkByModel[model] = String(usage.costUSD);
    if (opus) {
      const n = priceNumerator(byModel[model], opus);
      atOpusByModel[model] = divRound(n, MILLION).toString();
      numerator += n;
    }
  }
  if (Object.keys(byModel).some((m) => !m.startsWith(OPUS))) gaps.push("Tokens of models other than Opus 5.5 (the CLI's side calls) are priced at Opus 5.5 rates, so the cost at Opus 5.5 reads above the SDK's figure.");
  const atOpus = opus && Object.keys(byModel).length ? divRound(numerator, MILLION) : null;
  const sdkTotal = typeof result?.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd) ? String(result.total_cost_usd) : null;
  const sdkMicros = sdkTotal === null ? null : decimalToMicros(sdkTotal);
  const deltaBps = atOpus === null || !sdkMicros ? null : Number(divRound((atOpus - sdkMicros) * 10_000n, sdkMicros));

  // Effort.
  const effortApplied = EFFORTS.includes(book.effortApplied) ? book.effortApplied : null;
  if (!effortApplied) gaps.push('No hook reported the applied effort, so the cost metric marks this run invalid.');
  else if (options.effort && effortApplied !== options.effort) gaps.push(`The effort applied (${effortApplied}) is not the one requested (${options.effort}).`);

  // Time.
  const wallMs = count(book.wallMs);
  const modelMs = Number.isSafeInteger(result?.duration_api_ms) ? result.duration_api_ms : null;
  const toolMs = unionMs(book.toolCalls ?? []);
  const approvalWaitMs = [...(book.permissionRequests ?? []), ...conversational].reduce((n, r) => n + count(r.waitMs), 0);

  // Outcome.
  const state = book.timedOut ? 'timedOut' : ['Released', 'Refunded'].includes(book.finalState) ? book.finalState : 'stopped';
  const commitmentId = typeof book.commitmentId === 'string' && HEX32.test(book.commitmentId) ? book.commitmentId.toLowerCase() : null;
  if (state === 'stopped') gaps.push('The run did not reach Released or Refunded, so it stays out of the medians.');

  return {
    schema: 'crow.metrics.one-click/1',
    generatedAt: iso(generatedAtMs),
    generator: { script: 'tools/one-click/run.mjs', commit },
    sources,
    gaps,
    runId: runIdOf(startedAtMs, options.scenario),
    scenario: options.scenario,
    harness: {
      sdkVersion,
      claudeCodeVersion: typeof init?.claude_code_version === 'string' && /^\d+\.\d+\.\d+/.test(init.claude_code_version) ? init.claude_code_version.slice(0, 40) : null,
      maxReplies: options.maxReplies,
      timeoutMs: options.timeoutMs,
    },
    prompt: { text: String(book.prompt?.text ?? '').slice(0, 2000), source: 'https://escrow.stream/ #prompt', matchesExpected: !!book.prompt?.matchesExpected },
    model: {
      requested: options.model ?? null,
      init: typeof init?.model === 'string' && MODEL_ID.test(init.model) ? init.model : null,
      effortRequested: EFFORTS.includes(options.effort) ? options.effort : null,
      effortApplied,
      effortSource: effortApplied ? 'hook' : 'none',
    },
    outcome: {
      state,
      commitmentId,
      txs: (book.txs ?? []).filter((t) => typeof t === 'string' && HEX32.test(t)).map((t) => t.toLowerCase()).slice(0, 20),
      releasedAtMs: Number.isSafeInteger(book.releasedAtMs) ? book.releasedAtMs : null,
    },
    approvals: {
      total: requests.length + conversational.length,
      toolPermission: requests.length,
      conversational: conversational.length,
      byTool,
      requests: requests.slice(0, 100).map((r) => ({ atMs: count(r.atMs), tool: String(r.tool).replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || 'unknown', summary: scrub(r.summary) })),
    },
    tokens: { byModel, sdkUsage: result?.usage && typeof result.usage === 'object' ? result.usage : null, numTurns: Number.isSafeInteger(result?.num_turns) ? result.num_turns : null },
    cost: {
      atOpus55: {
        usdMicros: atOpus === null ? null : atOpus.toString(),
        byModel: atOpusByModel,
        priceTable: { file: 'config/model-prices.json', model: OPUS, source: opus?.source ?? 'https://platform.claude.com/docs/en/about-claude/pricing', readOn: opus?.readOn ?? prices?.readOn ?? '1970-01-01' },
      },
      sdk: { totalCostUsd: sdkTotal, byModel: sdkByModel },
      deltaBps,
    },
    time: {
      wallMs,
      modelMs,
      toolMs,
      approvalWaitMs,
      otherMs: modelMs === null ? null : wallMs - modelMs - toolMs - approvalWaitMs,
      sdkDurationMs: Number.isSafeInteger(result?.duration_ms) ? result.duration_ms : null,
    },
    cloudflare,
    errors: (book.errors ?? []).slice(0, 20).map(scrub),
    timedOut: !!book.timedOut,
  };
}
