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
export const HOMEPAGE = 'https://crow.direct/';
export const WORKERS = ['holdback-op1', 'holdback-op2', 'crow-test-agents'];
const MILLION = 1_000_000n;
const PRICE_FIELDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output'];
export const MODEL_ID = /^[a-z0-9.@[\]-]{1,64}$/;
/** The run file's `model.requested` pattern (one-click.schema.json): no brackets, unlike the IDs the SDK reports. */
export const REQUESTED_MODEL_ID = /^[a-z0-9.@-]{1,64}$/;

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

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\[[0-9A-Fa-f:.]{2,45}\]|\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:)+:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?(?![\w:])|::1\b/g;

/** A URL as origin and path only: no user, password, query or fragment, and an IP host replaced. */
function urlPart(href) {
  try {
    const u = new URL(href);
    const host = u.host.replace(IPV6, '<ip>').replace(IPV4, '<ip>');
    return `${u.protocol}//${host}${u.pathname}`;
  } catch {
    return '<url>';
  }
}

// An option whose value is a credential, a header or a request body: its value is dropped, joined or not.
const VALUE_OPTIONS = /(^|\s)(-[HbdE]|--[A-Za-z0-9-]*(?:header|cookie|bearer|data|user|pass|password|token|secret|key|cert|auth|credential)[A-Za-z0-9-]*)(=|\s+|(?=['"]))("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi;

/**
 * A command or URL as the run file may keep it: one line; quoted strings, option values that carry credentials,
 * headers or bodies, KEY=VALUE pairs, 32-byte hex, emails, IP addresses and local paths replaced; URLs as origin and
 * path; long opaque runs cut; at most 300 characters. The fresh assistant writes these, so nothing in them is trusted.
 */
export function scrub(text) {
  return String(text ?? '')
    .slice(0, 4000)
    .replace(HIDDEN, ' ')
    .replace(VALUE_OPTIONS, '$1$2$3<value>')
    .replace(/(^|\s)(-u)(\s+)("[^"]*:[^"]*"|'[^']*:[^']*'|[^\s-]\S*:\S*)/g, '$1$2$3<value>')
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>|;)]+/gi, (m) => urlPart(m))
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (m) => (/^["'][a-z][a-z0-9+.-]*:\/\/[^\s]*["']$/i.test(m) ? m : `${m[0]}<text>${m[0]}`))
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)=\S+/g, '$1=<value>')
    .replace(IPV6, '<ip>')
    .replace(/(^|\s)([A-Za-z][\w-]*)(:=?|==)(?!\/\/)\S+/g, '$1$2$3<value>')
    .replace(/[^\s@'"<>]+@[^\s@'"<>]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b0x[0-9A-Fa-f]{64}\b/g, '<hex32>')
    .replace(IPV4, '<ip>')
    .replace(/(?:~|\$HOME)\/[^\s'"`;|&)]*/g, '<local path>')
    .replace(/\/(?:Users|home|private|var|tmp|opt|root|Volumes)\/[^\s'"`;|&)]*/gi, '<local path>')
    .replace(/\b(sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9+/_=-]{120,})/g, '<redacted>')
    .slice(0, 300);
}

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'];

/** What an approval request shows in the run file: a Bash command or a file path scrubbed, a URL as origin and path, any other tool by its name only. */
export function summaryOf(tool, input) {
  if (tool === 'Bash') return scrub(input?.command);
  if (tool === 'WebFetch') return typeof input?.url === 'string' ? scrub(urlPart(input.url)) : '';
  if (FILE_TOOLS.includes(tool)) return scrub(input?.file_path ?? input?.notebook_path ?? input?.path ?? '');
  return '';
}

// Requests that reach this machine's user's own files, keychain or logins are denied, not answered, as
// tools/one-click/outsider.mjs does: an outside agent has none of them. The sandbox (run.mjs, on by default) blocks
// the same reads at the OS level; this list also covers the commands that use a login without naming a file.
const DENY = [
  /\/Users\/[^/\s]+\/(Documents|Library|Desktop|Downloads|Projects|\.ssh|\.aws|\.config|\.claude|\.npmrc|\.netrc|\.git-credentials|\.gitconfig|\.wrangler|\.docker|\.kube|\.gnupg|crow-)/i,
  /\/home\/[^/\s]+\/(\.ssh|\.aws|\.config|\.claude|\.npmrc|\.netrc|\.git-credentials)/i,
  /(~|\$HOME|\$\{HOME\})\/?(\.ssh|\.aws|\.claude|\.config|\.npmrc|\.netrc|\.git-credentials|\.gitconfig|\.wrangler|\.docker|\.kube|\.gnupg|crow-|Documents|Library|Desktop|Downloads|Projects)/,
  /\bcd\s+(~|\$HOME|\/Users\/[^/\s]+)\/?(\s|;|&|$)/i,
  /(^|[\s;&|(])\.(npmrc|netrc|git-credentials|ssh|aws|gnupg)\b/,
  /\.env\b/,
  /\bsecurity\s+(find-|dump-|export)/,
  /\bkeychain\b/i,
  /\bgh\s+(auth|api|repo|secret|pr|release)\b/,
  /\bwrangler\b/,
  /\bgit\s+(push|credential|config\s+--global)\b/,
  /(^|[\s;&|(])(ssh|scp|sftp|ssh-add)\s/,
  /\/private\/tmp\/com\.apple\.launchd/,
  /\bprintenv\b|(^|[\s;&|(])env(\s*$|\s*[;&|])/,
];

/** True when a tool request names a local path the harness refuses. */
export function deniedRequest(tool, input) {
  const text = tool === 'Bash' ? String(input?.command ?? '') : JSON.stringify(input ?? {});
  return DENY.some((re) => re.test(text));
}

// The names the fresh assistant's environment keeps. No Claude, Anthropic, SSH agent, cloud or git credential
// variable of this machine reaches it; values are copied by name, never read for content or printed.
export const ENV_KEEP = ['HOME', 'PATH', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', '__CF_USER_TEXT_ENCODING', 'NVM_DIR', 'NVM_BIN', 'NVM_INC', 'HOMEBREW_PREFIX', 'HOMEBREW_CELLAR', 'HOMEBREW_REPOSITORY', 'COMMAND_MODE'];

/** The child's environment: only ENV_KEEP's names from `source`, plus the client app name. */
export function childEnv(source) {
  const env = {};
  for (const k of ENV_KEEP) if (typeof source[k] === 'string') env[k] = source[k];
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'crow-one-click-harness/0.3';
  return env;
}

/** A fresh count for one Worker's tail. */
export const emptyTailCount = () => ({ requests: 0, cpuMs: null, wallMs: null, durableObjectRequests: 0, durableObjectWallMs: null });

/**
 * Adds one `wrangler tail` event to a Worker's count. A Durable Object event counts only in the Durable Object
 * fields, so ops-cost does not price it twice; any other event counts in requests, CPU and wall time.
 */
export function countTailEvent(c, e) {
  const cpu = Number.isFinite(e?.cpuTime) && e.cpuTime >= 0 ? Math.round(e.cpuTime) : null;
  const wall = Number.isFinite(e?.wallTime) && e.wallTime >= 0 ? Math.round(e.wallTime) : null;
  if (e?.executionModel === 'durableObject') {
    c.durableObjectRequests += 1;
    if (wall !== null) c.durableObjectWallMs = (c.durableObjectWallMs ?? 0) + wall;
    return c;
  }
  c.requests += 1;
  if (cpu !== null) c.cpuMs = (c.cpuMs ?? 0) + cpu;
  if (wall !== null) c.wallMs = (c.wallMs ?? 0) + wall;
  return c;
}

/**
 * The run file's `cloudflare` field from the tails. A Worker whose tail did not connect, or exited before the run
 * ended, is left out with a gap line, so a dead tail never reads as 0 requests; with none connected the field is
 * null. A tail that connected after the prompt was sent (`promptAt`) missed the deal's first requests and is left
 * out too. `otherDealsInWindow` is null when the run found no commitment, since its own deal cannot be told apart.
 * @param {{ tails: Record<string, { connected: boolean, connectedAt?: number|null, exitedEarly: boolean, count: object }>, window: { from: string, to: string }, otherDeals: number|null, commitmentId: string|null, promptAt?: number|null }} input
 */
export function cloudflareOf({ tails, window, otherDeals, commitmentId, promptAt = null }) {
  const gaps = [];
  const workers = {};
  for (const [name, t] of Object.entries(tails)) {
    if (!WORKERS.includes(name)) continue;
    const late = t.connected && promptAt !== null && !(Number.isSafeInteger(t.connectedAt) && t.connectedAt <= promptAt);
    if (t.connected && !t.exitedEarly && !late) workers[name] = t.count;
    else gaps.push(`wrangler tail on ${name} ${!t.connected ? 'never connected' : late ? 'connected after the prompt was sent' : 'exited before the run ended'}, so its counts are left out.`);
  }
  if (!Object.keys(workers).length) return { cloudflare: null, gaps: [...gaps, 'No wrangler tail connected, so the Cloudflare counts read unknown.'] };
  return { cloudflare: { basis: 'tail', window, otherDealsInWindow: commitmentId ? otherDeals : null, workers }, gaps };
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
export function buildRunFile({ init, result, book, options, prices, startedAtMs, generatedAtMs, commit, sdkVersion, cloudflare = null, sources = [], promptSource = `${HOMEPAGE} #prompt`, harnessGaps = [] }) {
  const gaps = harnessGaps.map(String).slice(0, 20);
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
    prompt: { text: String(book.prompt?.text ?? '').slice(0, 2000), source: String(promptSource).slice(0, 200), matchesExpected: !!book.prompt?.matchesExpected },
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
