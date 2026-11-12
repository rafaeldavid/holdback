#!/usr/bin/env node
// One-Click Escrow harness (T-066, headline metrics 1 to 3). Drives a fresh Claude Code through the Agent SDK from the
// live homepage's prompt to a settled deal, and writes one run file (tools/one-click/metrics.mjs builds it; its schema is
// scripts/metrics/schemas/one-click.schema.json). The fresh assistant gets default permissions, no settings, no MCP
// servers, a filtered environment and an empty folder; the harness answers every permission request with "allow" and
// counts it, except a request that names this machine's user's own files, which it denies. That is why where it runs is
// Rafa's gate (T-066, Gates item 1): it approves tools as the user who runs it.
//
//   (once) npm ci --ignore-scripts --prefix tools/one-click
//   node tools/one-click/run.mjs --scenario buyer --effort medium --out reports/scratch/one-click [--logs <dir>] [--tail]
//
// --effort unset     passes no effort, so the hooks record the SDK's default for the model.
// --tail             counts Cloudflare events per Worker with `npx wrangler@4 tail` during the run (wrangler's login;
//                    Gates item 4). Counts only: no header, URL path or IP is kept (D39).
// --logs <dir>       keeps the SDK's raw messages as JSON lines, outside git (outside the repository, or under reports/).
// --probe            asks only "Reply with the single word: ok", with no tools at all, touches no Crow site, and prints
//                    the effort the hooks saw and the model; it writes no run file. With --effort unset it finds the default.
// --dry-run <file>   plays a script (tools/one-click/scripted.mjs) in place of the model: no SDK, no key, no network.
//                    It writes a run file from the script, as CI's test does (tests/metrics/one-click.test.ts).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { check } from '../../scripts/metrics/check.mjs';
import { DEFAULTS, ROOT, Sources, fetchCapped, gitCommit, iso, readEvents } from '../../scripts/metrics/lib.mjs';
import { EFFORTS, HOMEPAGE, MODEL_ID, WORKERS, buildRunFile, childEnv, cloudflareOf, countTailEvent, deniedRequest, emptyTailCount, runIdOf, summaryOf } from './metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// The homepage prompt changes with the site (T-229 added the one command to it), so the harness records the prompt
// as served and checks only that it is the homepage's deal prompt.
const EXPECTED_PREFIX = 'Run a test deal with Crow';
const REPLY = 'Yes, go ahead.';

const args = parseArgs({
  options: {
    scenario: { type: 'string', default: 'buyer' },
    effort: { type: 'string', default: 'medium' },
    model: { type: 'string', default: 'claude-opus-5-5' },
    out: { type: 'string', default: join(ROOT, 'reports/scratch/one-click') },
    logs: { type: 'string' },
    tail: { type: 'boolean', default: false },
    probe: { type: 'boolean', default: false },
    'dry-run': { type: 'string' },
    'max-replies': { type: 'string', default: '6' },
    'timeout-ms': { type: 'string', default: '600000' },
  },
  strict: true,
}).values;

if (!['buyer', 'seller'].includes(args.scenario)) fail('--scenario is buyer or seller');
if (args.scenario === 'seller') {
  console.error("Not measured yet: the seller scenario needs Crow's test buyer (T-222, second slice, in the backlog).");
  process.exit(3);
}
if (args.effort !== 'unset' && !EFFORTS.includes(args.effort)) fail(`--effort is one of ${EFFORTS.join(', ')}, or unset`);
if (args.model !== 'unset' && !MODEL_ID.test(args.model)) fail('--model is a model ID (lower-case letters, digits, dots and dashes), or unset');
const dryRun = args['dry-run'] ? resolve(args['dry-run']) : null;
if (dryRun && (args.tail || args.probe)) fail('--dry-run takes neither --tail nor --probe');
const maxReplies = Number.parseInt(args['max-replies'], 10);
const timeoutMs = Number.parseInt(args['timeout-ms'], 10);
if (!Number.isSafeInteger(maxReplies) || maxReplies < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000) fail('--max-replies and --timeout-ms take whole numbers');
const logsDir = args.logs ? resolve(args.logs) : null;
if (logsDir && (logsDir === ROOT || logsDir.startsWith(ROOT + sep)) && !logsDir.startsWith(join(ROOT, 'reports') + sep)) fail('--logs must be outside the repository or under reports/, so raw logs stay out of git');

function fail(message) {
  console.error(`one-click: ${message}`);
  process.exit(2);
}

// The run is named by when the harness started; its clock (`at`) restarts when the prompt is sent, so neither the
// homepage fetch nor the tail's connect wait counts as the assistant's time.
const startedAt = Date.now();
let t0 = startedAt;
const at = () => Date.now() - t0;
const note = (s) => console.error(`[${String(Math.round(at() / 1000)).padStart(4)} s] ${s}`);
const script = dryRun ? JSON.parse(readFileSync(dryRun, 'utf8')) : null;
const { query } = script ? { query: (await import('./scripted.mjs')).scriptedQuery(script) } : await import('@anthropic-ai/claude-agent-sdk');
const sdkVersion = script
  ? JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).dependencies['@anthropic-ai/claude-agent-sdk']
  : JSON.parse(readFileSync(join(HERE, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')).version;
const runId = runIdOf(startedAt, args.scenario);
const rawPath = logsDir ? join(logsDir, `${runId}.jsonl`) : null;
if (rawPath) mkdirSync(logsDir, { recursive: true });
const raw = (kind, data) => rawPath && appendFileSync(rawPath, `${JSON.stringify({ atMs: at(), kind, ...data })}\n`);
const sources = new Sources();
const harnessGaps = [];

// --- The prompt, verbatim from the live homepage's #prompt span (or the script's, in a dry run).
function decode(s) {
  return s.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
let prompt = 'Reply with the single word: ok';
let promptSource = `${HOMEPAGE} #prompt`;
if (script) {
  prompt = String(script.prompt ?? '');
  promptSource = 'dry run: a script, not the homepage';
} else if (!args.probe) {
  const page = await fetchCapped(HOMEPAGE);
  sources.record('homepage', HOMEPAGE, startedAt, page.ok, page.ms, page.ok ? null : page.error);
  const m = page.ok ? /<span[^>]*id="prompt"[^>]*>([^<]{1,2000})<\/span>/.exec(page.text) : null;
  if (!m) fail(`no #prompt span on ${HOMEPAGE}`);
  prompt = decode(m[1]).trim();
  note(`prompt (${prompt.startsWith(EXPECTED_PREFIX) ? 'the deal prompt' : 'NOT the deal prompt'}, ${prompt.length} characters)`);
}

// --- A clean environment (metrics.mjs, ENV_KEEP): no Claude, Anthropic, SSH agent or cloud variable of this machine.
// Filtered by name only; no value is read or printed. Authentication comes from this machine's Claude Code login.
const env = childEnv(process.env);
const workdir = mkdtempSync(join(tmpdir(), 'crow-one-click-'));

// --- Cloudflare counts from wrangler tail. Each event is read, counted and dropped; nothing of it is stored. A tail
// counts only if it connected and was still running when the run ended (metrics.mjs, cloudflareOf).
const CONNECTED = /Connected to|Successfully created tail/i;
function startTail() {
  const tails = {};
  const procs = [];
  let stopping = false;
  for (const w of WORKERS) {
    const t = (tails[w] = { connected: false, exitedEarly: false, count: emptyTailCount() });
    const p = spawn('npx', ['--yes', 'wrangler@4', 'tail', w, '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.on('error', () => {
      t.exitedEarly = true;
    });
    p.on('exit', () => {
      if (!stopping) t.exitedEarly = true;
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (chunk) => {
      if (CONNECTED.test(chunk)) t.connected = true;
    });
    // wrangler prints each event as an indented JSON object, so the reader splits objects by brace depth.
    let depth = 0;
    let inString = false;
    let escaped = false;
    let buf = '';
    let line = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      for (const ch of chunk) {
        if (depth === 0 && ch !== '{') {
          line = ch === '\n' ? '' : (line + ch).slice(-200);
          if (CONNECTED.test(line)) t.connected = true;
          continue;
        }
        buf += ch;
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}' && --depth === 0) {
          try {
            countTailEvent(t.count, JSON.parse(buf));
            t.connected = true;
          } catch {
            // Not an event: skipped.
          }
          buf = '';
        }
        if (buf.length > 4_000_000) {
          buf = '';
          depth = 0;
          inString = false;
        }
      }
    });
    procs.push(p);
  }
  return {
    tails,
    stop: () => {
      stopping = true;
      procs.forEach((p) => p.kill('SIGINT'));
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tail = null;
let tailFrom = null;
if (args.tail && !args.probe) {
  tail = startTail();
  note('wrangler tail started on holdback-op1, holdback-op2 and crow-test-agents; waiting 10 s for it to connect');
  await sleep(10_000);
  tailFrom = Date.now();
}

// --- Streaming input, so the harness can reply in the chat when the assistant asks.
function inputQueue() {
  const pending = [];
  let wake = null;
  let closed = false;
  const poke = () => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
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

// --- Bookkeeping, in integer ms from when the prompt was sent.
const toolUses = new Map(); // tool_use id -> { tool, startMs, endMs, input }
const book = { prompt: { text: prompt, matchesExpected: prompt.startsWith(EXPECTED_PREFIX) }, permissionRequests: [], conversational: [], toolCalls: [], errors: [], timedOut: false };
const effortSeen = [];
let init = null;
let result = null;
let tryOutput = null;
let tryBackground = false;
let replies = 0;

const isTry = (u) => u && u.tool === 'Bash' && /try\.mjs/.test(u.input?.command ?? '') && /\bnode\s/.test(u.input?.command ?? '');
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : '')).join('\n') : '');

const recordEffort = (where) => async (input) => {
  const level = input?.effort?.level;
  if (typeof level === 'string') effortSeen.push({ where, level });
  return {};
};

const input = inputQueue();
const canUseTool = async (toolName, toolInput, opts) => {
  const start = at();
  raw('permission_request', { tool: toolName });
  if (args.probe) return { behavior: 'deny', message: 'This run allows no tools.', toolUseID: opts.toolUseID };
  if (toolName === 'AskUserQuestion') {
    const answers = {};
    for (const q of toolInput.questions ?? []) {
      const opt = (q.options ?? []).find((o) => /yes|run|approve|go|proceed|allow/i.test(o.label)) ?? (q.options ?? [])[0];
      answers[q.question] = opt ? opt.label : REPLY;
    }
    book.conversational.push({ atMs: start, via: 'AskUserQuestion', waitMs: at() - start });
    note('AskUserQuestion answered');
    return { behavior: 'allow', updatedInput: { ...toolInput, answers }, toolUseID: opts.toolUseID };
  }
  if (deniedRequest(toolName, toolInput)) {
    book.errors.push(`denied a ${toolName} request that named a local path`);
    note(`denied: ${toolName} names a local path`);
    return { behavior: 'deny', message: 'Not allowed: that names files outside this task.', toolUseID: opts.toolUseID };
  }
  book.permissionRequests.push({ atMs: start, tool: toolName, summary: summaryOf(toolName, toolInput), waitMs: at() - start });
  note(`approval ${book.permissionRequests.length}: ${toolName}`);
  return { behavior: 'allow', updatedInput: toolInput, toolUseID: opts.toolUseID };
};

const q = query({
  prompt: input,
  options: {
    cwd: workdir,
    permissionMode: 'default',
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    ...(args.probe ? { tools: [] } : {}),
    canUseTool,
    env,
    ...(args.model === 'unset' ? {} : { model: args.model }),
    ...(args.effort === 'unset' ? {} : { effort: args.effort }),
    hooks: { PreToolUse: [{ hooks: [recordEffort('PreToolUse')] }], Stop: [{ hooks: [recordEffort('Stop')] }] },
    stderr: (d) => raw('stderr', { bytes: String(d).length }),
  },
});

const timer = setTimeout(async () => {
  book.timedOut = true;
  book.errors.push(`timed out after ${Math.round(timeoutMs / 1000)} s`);
  note('timed out: interrupting');
  try {
    await q.interrupt();
  } catch {
    book.errors.push('interrupt failed');
  }
  input.close();
  setTimeout(() => {
    try {
      q.close();
    } catch {
      // already closed
    }
  }, 15_000).unref();
}, timeoutMs);

t0 = Date.now();
input.push(prompt);
try {
  for await (const msg of q) {
    raw('sdk', { msg });
    if (msg.type === 'system' && msg.subtype === 'init') {
      init = msg;
      note(`init: model ${msg.model}, Claude Code ${msg.claude_code_version}`);
    } else if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type !== 'tool_use') continue;
        toolUses.set(block.id, { tool: block.name, input: block.input, startMs: at(), endMs: null });
        if (isTry({ tool: block.name, input: block.input }) && block.input?.run_in_background) tryBackground = true;
      }
    } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        const u = toolUses.get(block.tool_use_id);
        const text = textOf(block.content);
        if (u) u.endMs = at();
        const fromTry = isTry(u) || u?.tool === 'BashOutput' || (u && /crow-try/.test(JSON.stringify(u.input)) && /commitment\s/.test(text));
        if (fromTry && book.releasedAtMs === undefined && /\bReleased\b/.test(text)) {
          book.releasedAtMs = at();
          note('Released');
        }
        if ((isTry(u) && !/running in background/i.test(text)) || (fromTry && /commitment\s+\S+\s+(Released|Refunded)|stopped at|refused at/.test(text))) tryOutput = text;
      }
    } else if (msg.type === 'result') {
      result = msg;
      note(`turn ended (${msg.subtype})`);
      if (msg.is_error) book.errors.push(`result ${String(msg.subtype).slice(0, 40)}`);
      if (args.probe || tryOutput !== null || book.timedOut || msg.is_error) break;
      if (tryBackground) continue;
      if (replies >= maxReplies) {
        book.errors.push(`stopped after ${maxReplies} chat replies`);
        break;
      }
      replies += 1;
      book.conversational.push({ atMs: at(), via: 'chat reply', waitMs: 0 });
      note(`chat reply ${replies}: "${REPLY}"`);
      input.push(REPLY);
    }
  }
} catch (e) {
  book.errors.push(`query threw: ${String(e?.message ?? e).slice(0, 200)}`);
} finally {
  clearTimeout(timer);
  input.close();
  try {
    q.close();
  } catch {
    // already closed
  }
}

book.wallMs = at();
book.toolCalls = [...toolUses.values()].map((u) => ({ tool: u.tool, startMs: u.startMs, endMs: u.endMs }));
const outcome = (tryOutput ?? '').match(/commitment\s+(0x[0-9a-fA-F]{64})\s+(Released|Refunded)/);
book.commitmentId = outcome?.[1] ?? null;
book.finalState = outcome?.[2] ?? null;
book.txs = [...new Set((tryOutput ?? '').match(/0x[0-9a-fA-F]{64}(?=\b)/g) ?? [])].filter((h) => (tryOutput ?? '').includes(`/tx/${h}`));
book.effortApplied = (effortSeen.find((e) => e.where === 'Stop') ?? effortSeen[effortSeen.length - 1])?.level ?? null;
if (new Set(effortSeen.map((e) => e.level)).size > 1) book.errors.push(`hooks reported more than one effort: ${[...new Set(effortSeen.map((e) => e.level))].join(', ')}`);

if (args.probe) {
  rmSync(workdir, { recursive: true, force: true });
  const usage = Object.fromEntries(Object.entries(result?.modelUsage ?? {}).map(([k, u]) => [k, { input: u.inputTokens, output: u.outputTokens }]));
  console.log(JSON.stringify({ probe: true, sdkVersion, claudeCodeVersion: init?.claude_code_version ?? null, model: init?.model ?? null, effortRequested: args.effort, effortSeen, usage, errors: book.errors }, null, 2));
  process.exit(0);
}

// --- Cloudflare: stop the tail 10 s after the run, and count the other deals that moved in the window.
let cloudflare = null;
if (tail) {
  await sleep(10_000);
  tail.stop();
  const tailTo = Date.now();
  let otherDeals = null;
  if (book.commitmentId) {
    const log = await readEvents(sources, [DEFAULTS.op1, DEFAULTS.op2], { back: 2000 });
    if (log) {
      const others = new Set();
      for (const e of log.events) {
        const t = Date.parse(e.at);
        if (t >= tailFrom - 10_000 && t <= tailTo && typeof e.commitmentId === 'string' && e.commitmentId.toLowerCase() !== book.commitmentId.toLowerCase()) others.add(e.commitmentId.toLowerCase());
      }
      otherDeals = others.size;
    }
  }
  const cf = cloudflareOf({ tails: tail.tails, window: { from: iso(tailFrom - 10_000), to: iso(tailTo) }, otherDeals, commitmentId: book.commitmentId });
  cloudflare = cf.cloudflare;
  harnessGaps.push(...cf.gaps);
}

let prices = null;
try {
  prices = JSON.parse(readFileSync(join(ROOT, 'config/model-prices.json'), 'utf8'));
} catch {
  prices = null;
}
const run = buildRunFile({
  init,
  result,
  book,
  options: { scenario: args.scenario, model: args.model === 'unset' ? null : args.model, effort: args.effort === 'unset' ? null : args.effort, maxReplies, timeoutMs },
  prices,
  startedAtMs: startedAt,
  generatedAtMs: Date.now(),
  commit: gitCommit(ROOT),
  sdkVersion,
  cloudflare,
  sources: sources.list,
  promptSource,
  harnessGaps,
});
rmSync(workdir, { recursive: true, force: true });
// The run file takes its name only after it passes its schema; a failing one stays as <runId>.json.invalid.
const ok = check('one-click', run);
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${run.runId}.json`);
const tmpFile = `${outFile}.invalid`;
writeFileSync(tmpFile, `${JSON.stringify(run, null, 2)}\n`);
if (ok.ok) renameSync(tmpFile, outFile);
note(`${run.outcome.state}: ${run.approvals.total} approvals, effort ${run.model.effortApplied ?? 'unknown'}, USD ${run.cost.atOpus55.usdMicros ?? 'unknown'} micro at Opus 5.5`);
note(`run file ${ok.ok ? `valid: ${outFile}` : `INVALID: ${tmpFile}`}`);
if (!ok.ok) console.error(ok.errors.join('\n'));
process.exit(ok.ok ? 0 : 1);
