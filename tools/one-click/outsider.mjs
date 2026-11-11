#!/usr/bin/env node
// Outsider design tests (T-328, roadmap N1a). Drives one fresh Claude Code through the Agent SDK, as the One-Click
// harness does (run.mjs in PR 217, T-066), from one sentence of goal and the URL https://crow.direct/llms.txt to a
// buyer-started deal against the live operators and Crow's live test seller. It writes one run record:
// approvals asked, tokens, wall time, tool calls, HTTP calls by host and status, the commitment it found and the
// state the operator reports for it, plus a compact digest of the agent's turns to read for doc gaps.
//
//   (once) npm ci --ignore-scripts --prefix tools/one-click
//   node tools/one-click/outsider.mjs --scenario 1 --out reports/scratch/t-328
//
// The fresh agent gets an empty folder, default permissions, no settings files, no MCP servers and a filtered
// environment. The harness answers each permission request "allow" and counts it, except a request that names a
// path of this machine's user (the repository, .env files, keys, the cost clones): that one is denied and recorded.
// It answers a question card with its "yes" option and, when the agent ends a turn with a question, replies
// "Yes, go ahead." up to --max-replies times. Each of these counts as an approval.
//
// Measuring HTTP calls without hints: the agent's PATH starts with a run folder holding a `curl` wrapper that logs
// each call's arguments and response status lines, and NODE_OPTIONS preloads a module that logs each fetch()
// (method, origin, path, status, ms). Neither changes a response. Query strings are dropped from fetch logs.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DOCS = 'https://crow.direct/llms.txt';
const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const REPLY = 'Yes, go ahead.';
const TAIL = 'using fresh keys you make yourself and test funds only.';

// One sentence of goal per scenario. Nothing else reaches the agent.
const GOALS = {
  1: `Using the docs at ${DOCS}, buy a small dataset from Crow's live test seller on Sepolia under deterministic acceptance checks you choose yourself, and take the deal through to Released, ${TAIL}`,
  2: `Using the docs at ${DOCS}, buy a short piece of written work from Crow's live test seller on Sepolia that a judge panel grades against a rubric you write, and take the deal through to Released, ${TAIL}`,
  4: `Using the docs at ${DOCS}, buy from Crow's live test seller on Sepolia a delivery that fails your acceptance checks and is rejected, and take the deal through to Refunded, ${TAIL}`,
  5: `Using the docs at ${DOCS}, make a deal with Crow's live test seller on Sepolia in which the seller misses its delivery deadline, and get your held funds back through the buyer's reclaim, ${TAIL}`,
};

const args = parseArgs({
  options: {
    scenario: { type: 'string' },
    model: { type: 'string', default: 'claude-opus-5-5' },
    effort: { type: 'string', default: 'medium' },
    out: { type: 'string', default: join(ROOT, 'reports/scratch/t-328') },
    'max-replies': { type: 'string', default: '4' },
    'timeout-min': { type: 'string', default: '40' },
    'idle-min': { type: 'string', default: '5' },
    sandbox: { type: 'boolean', default: false },
  },
  strict: true,
}).values;
const goal = GOALS[args.scenario];
if (!goal) fail(`--scenario is one of ${Object.keys(GOALS).join(', ')}`);
const maxReplies = Number.parseInt(args['max-replies'], 10);
const timeoutMs = Number.parseInt(args['timeout-min'], 10) * 60_000;
const idleMs = Number.parseInt(args['idle-min'], 10) * 60_000;
if (![maxReplies, timeoutMs, idleMs].every(Number.isSafeInteger)) fail('--max-replies, --timeout-min and --idle-min take whole numbers');

function fail(message) {
  console.error(`outsider: ${message}`);
  process.exit(2);
}

const t0 = Date.now();
const at = () => Date.now() - t0;
const note = (s) => console.error(`[${String(Math.round(at() / 1000)).padStart(5)} s] ${s}`);
const runId = `s${args.scenario}-${new Date(t0).toISOString().replace(/[:.]/g, '').slice(0, 15)}Z`;
const runDir = join(resolve(args.out), runId);
mkdirSync(runDir, { recursive: true });
// The probes live outside the repository, so a sandbox that denies reads of this user's folders still runs them.
// Their logs are copied into runDir at the end.
const probeDir = mkdtempSync(join(tmpdir(), 'crow-outsider-probe-'));
const binDir = join(probeDir, 'bin');
mkdirSync(binDir, { recursive: true });
const rawPath = join(runDir, 'sdk.jsonl');
const raw = (kind, data) => appendFileSync(rawPath, `${JSON.stringify({ atMs: at(), kind, ...data })}\n`);
const sdkVersion = JSON.parse(readFileSync(join(HERE, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')).version;

// --- The two probes. Paths are written in literally, so the agent's environment carries no extra variable but these.
const q1 = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const curlLog = join(probeDir, 'curl.log');
const curlWrapper = `#!/bin/sh
# Logs each curl call for a T-328 run, then runs the system curl with a header dump. Output is unchanged.
hdr=${q1(probeDir)}/curl-hdr-$$-$(date +%s).txt
printf '%s\\t%s\\t' "$(date +%s)" "$hdr" >> ${q1(curlLog)}
printf '%s ' "$@" | tr '\\n' ' ' >> ${q1(curlLog)}
printf '\\n' >> ${q1(curlLog)}
/usr/bin/curl -D "$hdr" "$@"
`;
writeFileSync(join(binDir, 'curl'), curlWrapper);
chmodSync(join(binDir, 'curl'), 0o755);
const fetchLog = join(probeDir, 'fetch.jsonl');
const preload = join(probeDir, 'fetch-log.mjs');
writeFileSync(
  preload,
  `// Logs each fetch() for a T-328 run: method, origin, path (no query), status, ms. Responses are unchanged.
import { appendFileSync } from 'node:fs';
const orig = globalThis.fetch;
if (typeof orig === 'function') {
  globalThis.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    let where = { origin: null, path: null };
    try { const u = new URL(href); where = { origin: u.origin, path: u.pathname }; } catch {}
    const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
    const t = Date.now();
    try {
      const r = await orig.call(this, input, init);
      try { appendFileSync(${JSON.stringify(fetchLog)}, JSON.stringify({ at: t, ms: Date.now() - t, method, ...where, status: r.status }) + '\\n'); } catch {}
      return r;
    } catch (e) {
      try { appendFileSync(${JSON.stringify(fetchLog)}, JSON.stringify({ at: t, ms: Date.now() - t, method, ...where, status: null, error: String(e?.name ?? 'Error') }) + '\\n'); } catch {}
      throw e;
    }
  };
}
`,
);

// --- A clean environment: no Claude or Anthropic variable of this machine. Filtered by name only; no value read.
const KEEP = ['HOME', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', '__CF_USER_TEXT_ENCODING', 'NVM_DIR', 'NVM_BIN', 'NVM_INC', 'HOMEBREW_PREFIX', 'HOMEBREW_CELLAR', 'HOMEBREW_REPOSITORY', 'COMMAND_MODE'];
const env = {};
for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
// Claude Code drops NODE_OPTIONS from its commands' environment (measured in run s1), so a `node` wrapper on PATH
// loads the fetch probe instead.
writeFileSync(join(binDir, 'node'), `#!/bin/sh\nexec ${q1(process.execPath)} --import=${q1(preload)} "$@"\n`);
chmodSync(join(binDir, 'node'), 0o755);
env.PATH = `${binDir}:${process.env.PATH}`;
env.CLAUDE_AGENT_SDK_CLIENT_APP = 'crow-outsider-harness/0.2';
const workdir = mkdtempSync(join(tmpdir(), 'crow-outsider-'));
// A fresh machine's own temporary folder and npm cache, both writable, instead of this session's.
const agentTmp = join(probeDir, 'tmp');
mkdirSync(join(agentTmp, 'npm-cache'), { recursive: true });
env.TMPDIR = agentTmp;
env.npm_config_cache = join(agentTmp, 'npm-cache');
// Inside the sandbox all traffic goes through its proxy; Node's fetch uses it only with this flag (run s1).
if (args.sandbox) env.NODE_USE_ENV_PROXY = '1';
const workdirs = [workdir, realpathSync(workdir), agentTmp, realpathSync(agentTmp)];

// --- --sandbox: Claude Code's OS sandbox around every Bash command. Writes only in the agent's folder and the
// probes' folder; no reads of this user's own folders; network only to Crow, npm and Sepolia hosts. Bash is not
// auto-allowed, so each command still asks and is counted. A blocked host is a finding, not a harness error.
const HOME = process.env.HOME ?? '/Users/unknown';
const sandbox = args.sandbox
  ? {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: [...new Set([...workdirs, probeDir, realpathSync(probeDir)])],
        denyRead: [join(HOME, 'Documents'), join(HOME, 'Desktop'), join(HOME, 'Downloads'), join(HOME, '.ssh'), join(HOME, '.aws'), join(HOME, '.config'), join(HOME, '.claude'), join(HOME, 'Library/Keychains'), join(HOME, 'Library/Application Support'), join(HOME, 'crow-costs-private'), join(HOME, 'crow-costs'), join(HOME, 'crow-data')],
      },
      network: {
        strictAllowlist: true,
        allowedDomains: ['crow.direct', '*.crow.direct', 'escrow.stream', '*.escrow.stream', 'registry.npmjs.org', 'rpc.sepolia.org', 'ethereum-sepolia-rpc.publicnode.com', 'sepolia.drpc.org', '*.sepolia.org', 'sepolia.etherscan.io', 'api-sepolia.etherscan.io', 'api.drand.sh', 'drand.cloudflare.com'],
      },
    }
  : undefined;

// --- Requests naming this machine's user's own files are denied, not answered. With --sandbox, file tools may
// touch only the agent's folder.
const DENY = [/\/Users\/[^/\s]+\/(Documents|Library|Desktop|Downloads|\.ssh|\.aws|\.config|\.claude|crow-)/i, /\.env\b/, /~\/(\.ssh|\.aws|\.claude|crow-|Documents|Library)/, /\bsecurity\s+find-/, /\bkeychain\b/i];
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'];
const outsideWorkdir = (tool, input) => {
  if (!args.sandbox || !FILE_TOOLS.includes(tool)) return false;
  const p = input?.file_path ?? input?.notebook_path ?? input?.path;
  if (typeof p !== 'string' || !p) return false;
  const abs = resolve(workdir, p);
  return !workdirs.some((w) => abs === w || abs.startsWith(`${w}/`));
};
const inputText = (tool, input) => (tool === 'Bash' ? String(input?.command ?? '') : JSON.stringify(input ?? {}));
const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

function inputQueue() {
  const pending = [];
  let wake = null;
  let closed = false;
  const poke = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  return {
    push(text) {
      pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      poke();
    },
    close() {
      closed = true;
      poke();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (pending.length) yield pending.shift();
        if (closed) return;
        await new Promise((r) => {
          wake = r;
        });
      }
    },
  };
}

const book = { permissionRequests: [], denied: [], questions: [], chatReplies: [], errors: [], timedOut: false, idleStop: false };
const toolUses = new Map();
const usageById = new Map();
const digest = [];
const texts = [];
const effortSeen = new Set();
let init = null;
let lastResult = null;
const resultMsgs = [];
let results = 0;
let replies = 0;
let backgroundStarted = 0;

const canUseTool = async (toolName, toolInput, opts) => {
  raw('permission_request', { tool: toolName });
  if (toolName === 'AskUserQuestion') {
    const answers = {};
    for (const qq of toolInput.questions ?? []) {
      const opt = (qq.options ?? []).find((o) => /yes|run|approve|go|proceed|allow|continue/i.test(o.label)) ?? (qq.options ?? [])[0];
      answers[qq.question] = opt ? opt.label : REPLY;
      book.questions.push({ atMs: at(), question: short(String(qq.question ?? ''), 300), answer: answers[qq.question] });
    }
    note('question card answered');
    return { behavior: 'allow', updatedInput: { ...toolInput, answers }, toolUseID: opts.toolUseID };
  }
  const text = inputText(toolName, toolInput);
  if (DENY.some((re) => re.test(text)) || outsideWorkdir(toolName, toolInput)) {
    book.denied.push({ atMs: at(), tool: toolName, summary: short(text, 300) });
    note(`denied: ${toolName} names a local path`);
    return { behavior: 'deny', message: 'Not allowed: that names files outside this task.', toolUseID: opts.toolUseID };
  }
  book.permissionRequests.push({ atMs: at(), tool: toolName, summary: short(text, 300) });
  note(`approval ${book.permissionRequests.length}: ${toolName}: ${short(text.replace(/\s+/g, ' '), 100)}`);
  return { behavior: 'allow', updatedInput: toolInput, toolUseID: opts.toolUseID };
};

const recordEffort = async (hookInput) => {
  if (typeof hookInput?.effort?.level === 'string') effortSeen.add(hookInput.effort.level);
  return {};
};

const input = inputQueue();
const q = query({
  prompt: input,
  options: {
    cwd: workdir,
    permissionMode: 'default',
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool,
    env,
    ...(sandbox ? { sandbox } : {}),
    model: args.model,
    effort: args.effort,
    hooks: { PreToolUse: [{ hooks: [recordEffort] }], Stop: [{ hooks: [recordEffort] }] },
    stderr: (d) => raw('stderr', { text: short(String(d), 2000) }),
  },
});

let finished = false;
const stop = async (why) => {
  if (finished) return;
  finished = true;
  note(`stopping: ${why}`);
  try {
    await q.interrupt();
  } catch {
    // already idle
  }
  input.close();
  setTimeout(() => {
    try {
      q.close();
    } catch {
      // already closed
    }
  }, 10_000).unref();
};
const hardTimer = setTimeout(() => {
  book.timedOut = true;
  book.errors.push(`timed out after ${args['timeout-min']} min`);
  stop('timeout');
}, timeoutMs);
let idleTimer = null;
const armIdle = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    book.idleStop = true;
    stop(`idle ${args['idle-min']} min after a turn ended`);
  }, idleMs);
};

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : '')).join('\n') : '');
const asks = (s) => /\?\s*$/.test(s.trim()) || /\b(would you like|shall i|should i|do you want|want me to|let me know if|confirm)\b/i.test(s.slice(-600));

note(`scenario ${args.scenario}: ${goal}`);
input.push(goal);
try {
  for await (const msg of q) {
    raw('sdk', { msg });
    if (msg.type === 'system' && msg.subtype === 'init') {
      init = msg;
      note(`init: model ${msg.model}, Claude Code ${msg.claude_code_version}, tools ${msg.tools?.length}`);
    } else if (msg.type === 'assistant') {
      clearTimeout(idleTimer);
      if (msg.message?.id && msg.message?.usage) usageById.set(msg.message.id, { model: msg.message.model, ...msg.message.usage });
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text.trim()) {
          texts.push(block.text);
          digest.push({ atS: Math.round(at() / 1000), say: short(block.text.trim(), 700) });
        }
        if (block.type !== 'tool_use') continue;
        toolUses.set(block.id, { tool: block.name, startMs: at(), endMs: null, sub: msg.parent_tool_use_id ?? null });
        if (block.input?.run_in_background) backgroundStarted += 1;
        digest.push({ atS: Math.round(at() / 1000), tool: block.name, in: short(inputText(block.name, block.input).replace(/\s+/g, ' '), 260) });
      }
    } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        const u = toolUses.get(block.tool_use_id);
        if (u) u.endMs = at();
        const text = textOf(block.content);
        digest.push({ atS: Math.round(at() / 1000), out: short(text.replace(/\s+/g, ' '), 360), ...(block.is_error ? { error: true } : {}) });
      }
    } else if (msg.type === 'result') {
      results += 1;
      lastResult = msg;
      resultMsgs.push(msg);
      note(`turn ended (${msg.subtype}), cost so far USD ${msg.total_cost_usd}`);
      if (msg.is_error) book.errors.push(`result ${String(msg.subtype).slice(0, 60)}`);
      if (finished || msg.is_error) break;
      const last = texts[texts.length - 1] ?? '';
      if (asks(last) && replies < maxReplies) {
        replies += 1;
        book.chatReplies.push({ atMs: at(), question: short(last.trim().slice(-500), 500) });
        note(`chat reply ${replies}: "${REPLY}"`);
        input.push(REPLY);
        continue;
      }
      if (backgroundStarted > 0) {
        armIdle();
        continue;
      }
      break;
    }
  }
} catch (e) {
  book.errors.push(`query threw: ${short(String(e?.message ?? e), 300)}`);
} finally {
  clearTimeout(hardTimer);
  clearTimeout(idleTimer);
  finished = true;
  input.close();
  try {
    q.close();
  } catch {
    // already closed
  }
}
const wallMs = at();

// --- Tokens: from the result messages' modelUsage, every model summed (the streamed assistant messages carry only
// partial output counts, measured in run s1). Each result reports its own turn.
const tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, messages: usageById.size, byModel: {}, perResult: [] };
for (const r of resultMsgs) {
  const turn = {};
  for (const [model, u] of Object.entries(r.modelUsage ?? {})) {
    const m = (tokens.byModel[model] ??= { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
    m.input += u.inputTokens ?? 0;
    m.output += u.outputTokens ?? 0;
    m.cacheCreation += u.cacheCreationInputTokens ?? 0;
    m.cacheRead += u.cacheReadInputTokens ?? 0;
    turn[model] = { input: u.inputTokens, output: u.outputTokens, cacheCreation: u.cacheCreationInputTokens, cacheRead: u.cacheReadInputTokens };
  }
  tokens.perResult.push(turn);
}
for (const m of Object.values(tokens.byModel)) {
  tokens.input += m.input;
  tokens.output += m.output;
  tokens.cacheCreation += m.cacheCreation;
  tokens.cacheRead += m.cacheRead;
}
tokens.total = tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead;

// --- HTTP calls from the two probes.
const http = [];
if (existsSync(fetchLog)) {
  for (const line of readFileSync(fetchLog, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      http.push({ via: 'fetch', method: e.method, origin: e.origin, path: e.path, status: e.status, ms: e.ms });
    } catch {
      // a torn line
    }
  }
}
if (existsSync(curlLog)) {
  for (const line of readFileSync(curlLog, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [, hdr, argv = ''] = line.split('\t');
    const urls = argv.match(/https?:\/\/[^\s'"]+/g) ?? [];
    const method = (/(?:-X|--request)\s+([A-Z]+)/.exec(argv)?.[1] ?? (/(^|\s)(-d|--data\S*|--json|-F)\s/.test(argv) ? 'POST' : 'GET')).toUpperCase();
    let statuses = [];
    try {
      statuses = (readFileSync(hdr, 'utf8').match(/^HTTP\/[\d.]+\s+(\d{3})/gm) ?? []).map((s) => Number(s.split(/\s+/)[1]));
    } catch {
      statuses = [];
    }
    for (const [i, href] of urls.entries()) {
      let where = { origin: null, path: null };
      try {
        const u = new URL(href);
        where = { origin: u.origin, path: u.pathname };
      } catch {
        // not a URL
      }
      http.push({ via: 'curl', method, ...where, status: statuses[i] ?? statuses[statuses.length - 1] ?? null });
    }
  }
}
const crowish = (o) => /crow\.direct|escrow\.stream/.test(o ?? '');
const byHost = {};
const byStatus = {};
const errorsByStatus = {};
for (const h of http) {
  if (/anthropic\.com|claude\.ai|statsig|sentry|registry\.npmjs/.test(h.origin ?? '')) continue;
  byHost[h.origin ?? 'unknown'] = (byHost[h.origin ?? 'unknown'] ?? 0) + 1;
  const k = String(h.status ?? 'none');
  byStatus[k] = (byStatus[k] ?? 0) + 1;
  if (crowish(h.origin) && (h.status === null || h.status >= 400)) {
    const key = `${h.status ?? 'none'} ${h.method} ${h.path?.replace(/0x[0-9a-fA-F]{40,64}/g, '<id>')}`;
    errorsByStatus[key] = (errorsByStatus[key] ?? 0) + 1;
  }
}
const crowCalls = http.filter((h) => crowish(h.origin));

// --- The commitment: the ID most often in commitment paths, else in the agent's text and tool output.
const counts = {};
for (const h of crowCalls) {
  const m = /\/commitments\/(0x[0-9a-fA-F]{64})/.exec(h.path ?? '');
  if (m) counts[m[1].toLowerCase()] = (counts[m[1].toLowerCase()] ?? 0) + 2;
}
for (const d of digest) for (const m of JSON.stringify(d).matchAll(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)) counts[m[0].toLowerCase()] = (counts[m[0].toLowerCase()] ?? 0) + 1;
const candidates = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
const operatorStates = [];
for (const id of candidates) {
  for (const op of OPERATORS) {
    try {
      const r = await fetch(`${op}/v1/commitments/${id}`, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) continue;
      const j = await r.json().catch(() => null);
      operatorStates.push({ id, operator: op, status: r.status, escrowState: j?.escrowState ?? null, appealState: j?.appealState ?? null, settledAt: j?.settledAt ?? null });
      break;
    } catch (e) {
      operatorStates.push({ id, operator: op, status: null, error: String(e?.name ?? e) });
    }
  }
}

const tools = {};
for (const u of toolUses.values()) tools[u.tool] = (tools[u.tool] ?? 0) + 1;
const record = {
  runId,
  scenario: Number(args.scenario),
  goal,
  startedAt: new Date(t0).toISOString(),
  wallMs,
  model: { requested: args.model, reported: init?.model ?? null, effortRequested: args.effort, effortSeen: [...effortSeen] },
  versions: { claudeCode: init?.claude_code_version ?? null, agentSdk: sdkVersion },
  approvals: {
    total: book.permissionRequests.length + book.questions.length + book.chatReplies.length,
    tool: book.permissionRequests.length,
    questionCards: book.questions.length,
    chatReplies: book.chatReplies.length,
    list: book.permissionRequests,
    questions: book.questions,
    replies: book.chatReplies,
  },
  denied: book.denied,
  tokens,
  costUsdReported: lastResult?.total_cost_usd ?? null,
  turns: { results, numTurnsLast: lastResult?.num_turns ?? null },
  tools,
  toolCalls: toolUses.size,
  http: { total: http.length, crow: crowCalls.length, byHost, byStatus, crowErrors: errorsByStatus },
  commitment: { candidates, operatorStates },
  stop: { timedOut: book.timedOut, idleStop: book.idleStop, errors: book.errors },
  finalText: short(texts[texts.length - 1] ?? '', 4000),
};
writeFileSync(join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(join(runDir, 'digest.jsonl'), digest.map((d) => JSON.stringify(d)).join('\n') + '\n');
writeFileSync(join(runDir, 'http.jsonl'), http.map((h) => JSON.stringify(h)).join('\n') + '\n');
// The workdir holds the agent's keys and code: keep a list of its files, then remove it.
const files = [];
const walk = (d, rel = '') => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, join(rel, e.name));
    else files.push(join(rel, e.name));
  }
};
try {
  walk(workdir);
} catch {
  // gone
}
writeFileSync(join(runDir, 'workdir-files.txt'), files.join('\n') + '\n');
rmSync(workdir, { recursive: true, force: true });
for (const f of ['curl.log', 'fetch.jsonl']) if (existsSync(join(probeDir, f))) copyFileSync(join(probeDir, f), join(runDir, f));
rmSync(probeDir, { recursive: true, force: true });
note(`done: ${record.approvals.total} approvals, ${tokens.total} tokens, ${Math.round(wallMs / 60000)} min, ${crowCalls.length} Crow calls, state ${operatorStates[0]?.escrowState ?? 'unknown'}`);
note(`record: ${join(runDir, 'record.json')}`);
