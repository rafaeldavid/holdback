// One-Click Escrow measurement harness.
// Drives a fresh Claude Code (Agent SDK) through the escrow.stream homepage prompt
// and records every approval it needs.
//
// Usage: node run.mjs <once|always|probe> <runDir> <logDir>
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';

const [mode, runDirArg, logDirArg] = process.argv.slice(2);
if (!['once', 'always', 'probe'].includes(mode) || !runDirArg || !logDirArg) {
  console.error('usage: node run.mjs <once|always|probe> <runDir> <logDir>');
  process.exit(2);
}
const runDir = path.resolve(runDirArg);
const logDir = path.resolve(logDirArg);
fs.mkdirSync(logDir, { recursive: true });
const tag = `run-${mode}`;
const rawPath = path.join(logDir, `${tag}.jsonl`);
const sumPath = path.join(logDir, `${tag}.summary.json`);
fs.writeFileSync(rawPath, '');

const EXPECTED_PROMPT = "Run a test deal with Crow's test environment, following https://escrow.stream/llms.txt";
const MAX_REPLIES = 6;
const MAX_MS = 10 * 60 * 1000;
const REPLY = 'Yes, go ahead.';

const t0 = Date.now();
const sec = () => +((Date.now() - t0) / 1000).toFixed(1);
const raw = (kind, data) => fs.appendFileSync(rawPath, JSON.stringify({ t: sec(), kind, ...data }) + '\n');
const note = (s) => console.log(`[${sec().toFixed(1).padStart(6)} s] ${s}`);

// --- The prompt, verbatim from the live homepage's hidden #prompt span.
function decode(s) {
  return s.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
let prompt = EXPECTED_PROMPT;
if (mode !== 'probe') {
  const html = await (await fetch('https://escrow.stream/')).text();
  const m = html.match(/<span[^>]*id="prompt"[^>]*>([^<]*)<\/span>/);
  if (!m) throw new Error('no #prompt span on https://escrow.stream/');
  prompt = decode(m[1]);
  raw('prompt', { live: prompt, matchesExpected: prompt === EXPECTED_PROMPT });
  note(`prompt (live, ${prompt === EXPECTED_PROMPT ? 'matches' : 'DIFFERS from'} expected): ${prompt}`);
} else {
  prompt = 'Reply with the single word: ok';
}

// --- A clean environment: a fresh visitor has none of this host's Claude/Anthropic variables.
// Filtered by name only; no value is read or printed. Auth comes from this Mac's Claude Code login.
const KEEP = ['HOME', 'PATH', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', '__CF_USER_TEXT_ENCODING',
  'NVM_DIR', 'NVM_BIN', 'NVM_INC', 'HOMEBREW_PREFIX', 'HOMEBREW_CELLAR', 'HOMEBREW_REPOSITORY', 'SSH_AUTH_SOCK', 'COMMAND_MODE'];
const env = {};
for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
env.CLAUDE_AGENT_SDK_CLIENT_APP = 'crow-one-click-harness/0.1';
raw('env', { passedNames: Object.keys(env) });

// --- Streaming input queue.
function inputQueue() {
  const pending = [];
  let wake = null;
  let closed = false;
  return {
    push(text) {
      pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, origin: { kind: 'human' } });
      if (wake) { const w = wake; wake = null; w(); }
    },
    close() { closed = true; if (wake) { const w = wake; wake = null; w(); } },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (pending.length) yield pending.shift();
        if (closed) return;
        await new Promise((r) => { wake = r; });
      }
    },
  };
}

// --- Bookkeeping.
const toolUses = new Map(); // id -> { t, name, input, asked }
const permissionRequests = [];
const conversational = [];
const assistantTexts = [];
const turns = [];
const errors = [];
let releasedAt = null;
let releasedLine = null;
let tryFinishedAt = null;
let tryOutput = null;
let tryBackground = false;
let initInfo = null;
let lastResult = null;
let replies = 0;
let done = false;
let timedOut = false;

function summarize(name, input) {
  const cut = (s, n = 400) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s);
  switch (name) {
    case 'Bash': return { command: cut(input.command, 600), description: input.description, run_in_background: input.run_in_background };
    case 'WebFetch': return { url: input.url, prompt: cut(input.prompt, 160) };
    case 'Read': case 'Write': case 'Edit': return { file_path: input.file_path };
    case 'AskUserQuestion': return { questions: (input.questions || []).map((q) => ({ question: q.question, options: (q.options || []).map((o) => o.label) })) };
    default: return { input: cut(JSON.stringify(input), 300) };
  }
}
const isTryCommand = (u) => u && u.name === 'Bash' && /try\.mjs/.test(u.input.command || '') && /\bnode\s/.test(u.input.command || '');
const textOf = (content) => typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : '')).join('\n') : '';

const input = inputQueue();

const canUseTool = async (toolName, toolInput, opts) => {
  const rec = {
    t: sec(), tool: toolName, input: summarize(toolName, toolInput), toolUseID: opts.toolUseID,
    title: opts.title, decisionReason: opts.decisionReason, blockedPath: opts.blockedPath,
    suggestions: opts.suggestions ?? [], suppressAlwaysAllowRule: opts.suppressAlwaysAllowRule,
  };
  raw('permission_request', rec);
  if (toolName === 'AskUserQuestion') {
    // A question card to the user: answer it as the user approving. Counted as conversational.
    const answers = {};
    for (const q of toolInput.questions || []) {
      const opt = (q.options || []).find((o) => /yes|run|approve|go|proceed|allow/i.test(o.label)) || (q.options || [])[0];
      answers[q.question] = opt ? opt.label : REPLY;
    }
    conversational.push({ t: sec(), via: 'AskUserQuestion', question: rec.input, answers });
    note(`AskUserQuestion answered: ${JSON.stringify(answers)}`);
    return { behavior: 'allow', updatedInput: { ...toolInput, answers }, toolUseID: opts.toolUseID };
  }
  permissionRequests.push(rec);
  const u = toolUses.get(opts.toolUseID);
  if (u) u.asked = true;
  note(`PERMISSION #${permissionRequests.length} ${toolName}: ${JSON.stringify(rec.input).slice(0, 220)}`);
  const result = { behavior: 'allow', updatedInput: toolInput, toolUseID: opts.toolUseID };
  if (mode === 'always' && opts.suggestions && opts.suggestions.length) result.updatedPermissions = opts.suggestions;
  return result;
};

const q = query({
  prompt: input,
  options: {
    cwd: runDir,
    permissionMode: 'default',
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool,
    env,
    stderr: (d) => raw('stderr', { data: String(d).slice(0, 2000) }),
  },
});

const timer = setTimeout(async () => {
  timedOut = true;
  errors.push({ t: sec(), error: 'timeout after 10 min' });
  note('TIMEOUT: interrupting');
  try { await q.interrupt(); } catch (e) { errors.push({ t: sec(), error: 'interrupt failed: ' + e.message }); }
  input.close();
  setTimeout(() => { try { q.close(); } catch {} }, 15000).unref();
}, mode === 'probe' ? 120000 : MAX_MS);

input.push(prompt);
raw('user', { text: prompt, origin: 'homepage prompt' });

try {
  for await (const msg of q) {
    raw('sdk', { msg });
    if (msg.type === 'system' && msg.subtype === 'init') {
      initInfo = {
        model: msg.model, permissionMode: msg.permissionMode, cwd: msg.cwd, tools: msg.tools,
        mcp_servers: msg.mcp_servers, plugins: msg.plugins, skills: msg.skills, apiKeySource: msg.apiKeySource,
        claude_code_version: msg.claude_code_version, output_style: msg.output_style,
      };
      note(`init: model=${msg.model} mode=${msg.permissionMode} cc=${msg.claude_code_version} apiKeySource=${msg.apiKeySource} tools=${msg.tools.length} mcp=${msg.mcp_servers.length} plugins=${(msg.plugins || []).length} skills=${(msg.skills || []).length}`);
    } else if (msg.type === 'assistant') {
      for (const block of msg.message.content || []) {
        if (block.type === 'tool_use') {
          toolUses.set(block.id, { t: sec(), name: block.name, input: block.input, asked: false });
          note(`tool_use ${block.name}: ${JSON.stringify(summarize(block.name, block.input)).slice(0, 220)}`);
          if (isTryCommand({ name: block.name, input: block.input }) && block.input.run_in_background) tryBackground = true;
        } else if (block.type === 'text' && block.text.trim()) {
          assistantTexts.push({ t: sec(), text: block.text });
          note(`assistant: ${block.text.replace(/\s+/g, ' ').slice(0, 300)}`);
        }
      }
      if (msg.error) errors.push({ t: sec(), error: 'assistant error: ' + msg.error });
    } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        const u = toolUses.get(block.tool_use_id);
        const text = textOf(block.content);
        if (u) { u.resultAt = sec(); u.isError = !!block.is_error; u.resultHead = text.slice(0, 300); }
        note(`tool_result ${u ? u.name : '?'}${block.is_error ? ' (error)' : ''}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
        const fromTry = isTryCommand(u) || (u && u.name === 'BashOutput') || (u && /crow-try|tasks\//.test(JSON.stringify(u.input)) && /commitment\s/.test(text));
        if (fromTry && releasedAt === null) {
          const line = text.split('\n').find((l) => /\bReleased\b/.test(l));
          if (line) { releasedAt = sec(); releasedLine = line.trim(); note(`RELEASED seen at ${releasedAt} s: ${releasedLine}`); }
        }
        if (isTryCommand(u) && !/running in background|Command running in background/i.test(text)) {
          tryFinishedAt = sec(); tryOutput = text;
        } else if (fromTry && /commitment\s+\S+\s+(Released|Refunded)|stopped at|refused at/.test(text)) {
          tryFinishedAt = sec(); tryOutput = text;
        }
      }
    } else if (msg.type === 'result') {
      lastResult = { t: sec(), subtype: msg.subtype, is_error: msg.is_error, result: msg.result, duration_ms: msg.duration_ms, num_turns: msg.num_turns, total_cost_usd: msg.total_cost_usd, modelUsage: msg.modelUsage ? Object.keys(msg.modelUsage) : undefined, permission_denials: msg.permission_denials };
      turns.push(lastResult);
      note(`turn ended (${msg.subtype}${msg.is_error ? ', error' : ''}); try finished: ${tryFinishedAt !== null}`);
      if (msg.is_error) errors.push({ t: sec(), error: `result ${msg.subtype}: ${String(msg.result || msg.errors || '').slice(0, 500)}` });
      if (mode === 'probe' || tryFinishedAt !== null || timedOut || msg.is_error) { done = true; input.close(); break; }
      if (tryBackground) { note('try.mjs is running in the background; waiting'); continue; }
      if (replies >= MAX_REPLIES) { errors.push({ t: sec(), error: 'stopped after 6 user replies' }); done = true; input.close(); break; }
      replies += 1;
      conversational.push({ t: sec(), via: 'chat reply', assistantAsked: (msg.result || '').slice(-600), reply: REPLY });
      note(`CONVERSATIONAL approval #${replies}: replying "${REPLY}"`);
      raw('user', { text: REPLY, origin: 'harness reply' });
      input.push(REPLY);
    }
  }
} catch (e) {
  errors.push({ t: sec(), error: 'query threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)) });
  note('ERROR: ' + e.message);
} finally {
  clearTimeout(timer);
  try { q.close(); } catch {}
}

const total = sec();
const allTools = [...toolUses.entries()].map(([id, u]) => ({ id, t: u.t, tool: u.name, input: summarize(u.name, u.input), asked: u.asked, resultAt: u.resultAt, isError: u.isError }));
const commitment = (tryOutput && tryOutput.match(/commitment\s+(0x[0-9a-fA-F]+|\S+)\s+(Released|Refunded|\w+)/)) || [];
const summary = {
  mode, runDir, model: initInfo?.model, init: initInfo, prompt,
  counts: {
    toolPermissionRequests: permissionRequests.length,
    conversationalApprovals: conversational.length,
    totalApprovals: permissionRequests.length + conversational.length,
    toolCalls: allTools.length,
    toolCallsWithoutAsking: allTools.filter((u) => !u.asked && u.tool !== 'AskUserQuestion').length,
  },
  seconds: { toReleasedLine: releasedAt, tryFinished: tryFinishedAt, total },
  releasedLine,
  commitmentId: commitment[1] ?? null,
  finalState: commitment[2] ?? null,
  etherscan: tryOutput ? [...new Set(tryOutput.match(/https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-fA-F]+/g) || [])] : [],
  tryOutput,
  permissionRequests,
  conversational,
  toolCalls: allTools,
  turns,
  finalMessage: lastResult?.result ?? assistantTexts.at(-1)?.text ?? null,
  errors,
  timedOut,
};
fs.writeFileSync(sumPath, JSON.stringify(summary, null, 2));
note(`done: ${permissionRequests.length} tool approvals, ${conversational.length} conversational, Released at ${releasedAt} s, total ${total} s`);
note(`summary: ${sumPath}`);
process.exit(0);
