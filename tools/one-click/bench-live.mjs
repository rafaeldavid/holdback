// The live runs of the benchmark harness (T-412): one fresh Claude Code through the Agent SDK, as outsider.mjs (T-328)
// drives it, from one sentence of goal and https://crow.direct/llms.txt to a deal with Crow's live test agents on
// Sepolia. Rafa starts these runs: they spend his model key and Sepolia test funds.
//
// The fresh agent gets an empty folder, default permissions, no settings files, no MCP servers, a filtered environment
// and, by default, Claude Code's OS sandbox (writes only in its folders, no reads of this user's folders, network only
// to Crow's, npm's and Sepolia's hosts). The harness answers each permission request "allow" and counts it, except a
// request that names this machine's user's files or logins, or reads the environment, which it denies and records. It
// answers a question card with its "yes" option and, when the agent ends a turn with a question, replies "Yes, go ahead."
// up to --max-replies times. Each of these counts as an approval.
//
// The model key: HOLDBACK_AGENT_ANTHROPIC_API_KEY, the agents' own key (tools/duet/README.md), never the judges'. It
// reaches only the SDK's Claude Code process, as ANTHROPIC_API_KEY; it is never printed, and every string the harness
// writes passes through scrubSecrets() first.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubSecrets } from './bench-record.mjs';
import { ENV_KEEP, deniedRequest, summaryOf } from './metrics.mjs';
import { readCalls, writeFetchProbe, writeShellProbes } from './probes.mjs';
import { GUESS_RULE } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const KEY_VAR = 'HOLDBACK_AGENT_ANTHROPIC_API_KEY';
const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const REPLY = 'Yes, go ahead.';
// Reading the environment would show the key to the agent: denied, on top of metrics.mjs's DENY list.
const ENV_READS = [/\bprocess\.env\b/, /\bos\.environ\b/, /\/proc\/[^/\s]+\/environ\b/, /\$\{?[A-Z_]*(ANTHROPIC|API_KEY|CLAUDE)[A-Z_]*\}?/, /(^|[\s;&|(])(set|export|declare\s+-[px])(\s*$|\s*[;&|])/];
export const readsEnv = (tool, input) => ENV_READS.some((re) => re.test(tool === 'Bash' ? String(input?.command ?? '') : JSON.stringify(input ?? {})));

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

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : '')).join('\n') : '');
const asks = (s) => /\?\s*$/.test(s.trim()) || /\b(would you like|shall i|should i|do you want|want me to|let me know if|confirm)\b/i.test(s.slice(-600));

/**
 * One live run. Returns the bookkeeping buildBenchRecord takes; the caller scrubs and writes the record.
 * @param {{ scenario: object, key: string, model: string, effort: string, maxReplies: number, timeoutMs: number, idleMs: number, sandboxed: boolean, logsDir: string|null, runId: string, note: (s: string) => void }} o
 */
export async function runLive(o) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const sdkVersion = JSON.parse(readFileSync(join(HERE, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')).version;
  const secrets = [o.key];
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const rawPath = o.logsDir ? join(o.logsDir, `${o.runId}.jsonl`) : null;
  if (rawPath) mkdirSync(o.logsDir, { recursive: true });
  const raw = (kind, data) => rawPath && writeFileSync(rawPath, `${JSON.stringify(scrubSecrets({ atMs: at(), kind, ...data }, secrets))}\n`, { flag: 'a' });

  const probeDir = mkdtempSync(join(tmpdir(), 'crow-bench-probe-'));
  const fetchProbe = writeFetchProbe(probeDir);
  const shell = writeShellProbes(probeDir, fetchProbe.path);
  const workdir = mkdtempSync(join(tmpdir(), 'crow-bench-'));
  const agentTmp = join(probeDir, 'tmp');
  mkdirSync(join(agentTmp, 'npm-cache'), { recursive: true });
  const env = {};
  for (const k of ENV_KEEP) if (typeof process.env[k] === 'string') env[k] = process.env[k];
  env.PATH = `${shell.bin}:${process.env.PATH ?? ''}`;
  env.TMPDIR = agentTmp;
  env.npm_config_cache = join(agentTmp, 'npm-cache');
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'crow-bench-harness/1.0';
  env.ANTHROPIC_API_KEY = o.key;
  // Asks Claude Code to strip its credentials from the commands it runs (guessed to be honoured by this version; the
  // ENV_READS denials and the scrub below do not depend on it).
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  if (o.sandboxed) env.NODE_USE_ENV_PROXY = '1';
  const HOME = process.env.HOME ?? '/Users/unknown';
  const writable = [...new Set([workdir, realpathSync(workdir), probeDir, realpathSync(probeDir)])];
  const sandbox = o.sandboxed
    ? {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: false,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowWrite: writable,
          denyRead: ['Documents', 'Desktop', 'Downloads', 'Projects', '.ssh', '.aws', '.config', '.claude', '.npmrc', '.netrc', '.gitconfig', '.git-credentials', '.wrangler', '.docker', '.kube', '.gnupg', 'Library/Keychains', 'Library/Preferences', 'Library/Application Support', 'crow-costs-private', 'crow-costs', 'crow-data'].map((d) => join(HOME, d)),
        },
        network: {
          strictAllowlist: true,
          allowedDomains: ['crow.direct', '*.crow.direct', 'registry.npmjs.org', 'rpc.sepolia.org', 'ethereum-sepolia-rpc.publicnode.com', 'sepolia.drpc.org', '*.sepolia.org', 'sepolia.etherscan.io', 'api-sepolia.etherscan.io', 'api.drand.sh', 'drand.cloudflare.com'],
        },
      }
    : undefined;

  const book = { permissionRequests: [], questions: [], chatReplies: [], errors: [], timedOut: false, approvalWaitMs: 0 };
  const texts = [];
  const results = [];
  const effortSeen = new Set();
  let init = null;
  let replies = 0;
  let backgroundStarted = 0;

  const canUseTool = async (toolName, toolInput, opts) => {
    const start = at();
    raw('permission_request', { tool: toolName });
    if (toolName === 'AskUserQuestion') {
      const answers = {};
      for (const qq of toolInput.questions ?? []) {
        const opt = (qq.options ?? []).find((x) => /yes|run|approve|go|proceed|allow|continue/i.test(x.label)) ?? (qq.options ?? [])[0];
        answers[qq.question] = opt ? opt.label : REPLY;
        book.questions.push({ atMs: start });
      }
      book.approvalWaitMs += at() - start;
      o.note('question card answered');
      return { behavior: 'allow', updatedInput: { ...toolInput, answers }, toolUseID: opts.toolUseID };
    }
    if (deniedRequest(toolName, toolInput) || readsEnv(toolName, toolInput)) {
      book.errors.push(`denied a ${toolName} request that named a local path or read the environment`);
      o.note(`denied: ${toolName}`);
      return { behavior: 'deny', message: 'Not allowed: that names files or settings outside this task.', toolUseID: opts.toolUseID };
    }
    book.permissionRequests.push({ atMs: start, tool: toolName, summary: summaryOf(toolName, toolInput) });
    book.approvalWaitMs += at() - start;
    o.note(`approval ${book.permissionRequests.length}: ${toolName}`);
    return { behavior: 'allow', updatedInput: toolInput, toolUseID: opts.toolUseID };
  };
  const recordEffort = async (h) => {
    if (typeof h?.effort?.level === 'string') effortSeen.add(h.effort.level);
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
      model: o.model,
      effort: o.effort,
      hooks: { PreToolUse: [{ hooks: [recordEffort] }], Stop: [{ hooks: [recordEffort] }] },
      stderr: (d) => raw('stderr', { bytes: String(d).length }),
    },
  });

  let finished = false;
  let idleStop = false;
  const stop = async (why) => {
    if (finished) return;
    finished = true;
    o.note(`stopping: ${why}`);
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
    book.errors.push(`timed out after ${Math.round(o.timeoutMs / 60_000)} min`);
    stop('timeout');
  }, o.timeoutMs);
  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleStop = true;
      stop('idle after a turn ended');
    }, o.idleMs);
  };

  const goal = `${o.scenario.goal} ${GUESS_RULE}`;
  input.push(goal);
  try {
    for await (const msg of q) {
      raw('sdk', { msg });
      if (msg.type === 'system' && msg.subtype === 'init') {
        init = msg;
        o.note(`init: model ${msg.model}, Claude Code ${msg.claude_code_version}`);
      } else if (msg.type === 'assistant') {
        clearTimeout(idleTimer);
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text.trim()) texts.push(block.text);
          if (block.type === 'tool_use' && block.input?.run_in_background) backgroundStarted += 1;
        }
      } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) if (block.type === 'tool_result') texts.push(textOf(block.content).slice(0, 4000));
      } else if (msg.type === 'result') {
        results.push(msg);
        o.note(`turn ended (${msg.subtype})`);
        if (msg.is_error) book.errors.push(`result ${String(msg.subtype).slice(0, 60)}`);
        if (finished || msg.is_error) break;
        const last = texts[texts.length - 1] ?? '';
        if (asks(last) && replies < o.maxReplies) {
          replies += 1;
          book.chatReplies.push({ atMs: at() });
          o.note(`chat reply ${replies}: "${REPLY}"`);
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
    book.errors.push(`query threw: ${String(e?.message ?? e).slice(0, 200)}`);
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
  book.wallMs = at();
  if (idleStop) book.errors.push('stopped: the agent was idle after a turn ended');

  // The commitment: the ID most often in commitment paths, else in the agent's text and tool output; its state from
  // the operators, as outsider.mjs reads it.
  const calls = readCalls({ fetchLog: fetchProbe.log, curlLog: shell.curlLog });
  const counts = {};
  for (const c of calls) {
    const m = /\/commitments\/(0x[0-9a-fA-F]{64})/.exec(c.path ?? '');
    if (m) counts[m[1].toLowerCase()] = (counts[m[1].toLowerCase()] ?? 0) + 2;
  }
  for (const t of texts) for (const m of t.matchAll(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)) counts[m[0].toLowerCase()] = (counts[m[0].toLowerCase()] ?? 0) + 1;
  const candidates = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const sources = [];
  let outcome = { state: 'stopped', commitmentId: null, stoppedAt: book.timedOut ? 'timed out' : 'no commitment reached its end state' };
  search: for (const id of candidates) {
    for (const op of OPERATORS) {
      const t = Date.now();
      try {
        const r = await fetch(`${op}/v1/commitments/${id}`, { signal: AbortSignal.timeout(15_000) });
        sources.push({ id: 'commitment', url: `${op}/v1/commitments/<id>`, readAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'), ok: r.ok, ms: Date.now() - t, error: r.ok ? null : 'http' });
        if (r.status === 404) continue;
        const j = await r.json().catch(() => null);
        if (['Released', 'Refunded'].includes(j?.escrowState)) {
          outcome = { state: j.escrowState, commitmentId: id, stoppedAt: null };
          break search;
        }
        outcome = { state: 'stopped', commitmentId: id, stoppedAt: `the operator reports ${String(j?.escrowState ?? 'no state').slice(0, 40)}` };
        break;
      } catch {
        sources.push({ id: 'commitment', url: `${op}/v1/commitments/<id>`, readAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'), ok: false, ms: Date.now() - t, error: 'unreachable' });
      }
    }
  }
  rmSync(workdir, { recursive: true, force: true });
  rmSync(probeDir, { recursive: true, force: true });
  const levels = [...effortSeen];
  return {
    book,
    results,
    calls,
    texts,
    outcome,
    sources: sources.slice(0, 20),
    secrets,
    agent: { requested: o.model, reported: init?.model ?? null, effortRequested: o.effort, effortApplied: levels.length === 1 ? levels[0] : null, claudeCodeVersion: init?.claude_code_version ?? null, sdkVersion },
    gaps: levels.length > 1 ? [`The hooks reported more than one effort: ${levels.join(', ')}.`] : levels.length ? [] : ['No hook reported the applied effort.'],
  };
}
