// Claude Code tokens for this repository, month to date, from the local session transcripts under
// ~/.claude/projects/ (subagents included): no credential. Laptop sessions only: cloud or VM sessions leave no
// transcript here. A response's usage is repeated on every entry that shares its requestId, and the repeats can
// differ: an early entry may carry fewer output tokens than the last (measured 2026-11-03: a few groups a month in
// this repository). So each request counts once, at the highest value of each field.
// An entry counts when its own working directory is in this repository, or when its transcript's first one is: a
// session that starts here and moves into a submodule or a scratch folder still counts, and so does one that
// starts elsewhere and moves in. Only usage, model, sessionId, gitBranch, cwd, timestamp and requestId are read;
// message content never is.
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { git } from '../approved.mjs';
import { addDecimals, compareDecimals, makeLine } from '../money.mjs';

export const id = 'claude-code';
export const credentials = [];
export const note = 'laptop sessions only; tokens with no amount until T-053 prices them';

/** "git@github.com:owner/repo.git" and "https://github.com/owner/repo" both become "github.com/owner/repo". */
export function repoKey(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? `github.com/${m[1]}/${m[2]}`.toLowerCase() : null;
}

/**
 * Decides, once per directory, whether it is in a checkout of `repo`. A directory that no longer exists (a removed
 * worktree under `.claude/worktrees/` or `.worktrees/`, a deleted subfolder) is judged by its nearest existing parent.
 */
export function makeMembership(repo, originOf = (dir) => repoKey(git(['config', '--get', 'remote.origin.url'], dir).stdout)) {
  const cache = new Map();
  return (cwd) => {
    if (typeof cwd !== 'string' || !cwd.startsWith('/')) return false;
    let dir = cwd;
    while (!existsSync(dir)) {
      const up = dirname(dir);
      if (up === dir) return false;
      dir = up;
    }
    if (!cache.has(dir)) cache.set(dir, originOf(dir) === repo);
    return cache.get(dir);
  };
}

/** Every .jsonl transcript modified since `sinceMs`, subagent transcripts included. */
export function transcriptFiles(root, sinceMs) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          if (statSync(p).mtimeMs >= sinceMs) out.push(p);
        } catch {
          // a file removed while walking is skipped
        }
      }
    }
  };
  walk(root, 0);
  return out.sort();
}

const UNITS = [
  ['input_tokens', (u) => u.input_tokens],
  ['output_tokens', (u) => u.output_tokens],
  ['cache_read_input_tokens', (u) => u.cache_read_input_tokens],
  ['cache_write_5m_input_tokens', (u) => u.cache_creation?.ephemeral_5m_input_tokens],
  ['cache_write_1h_input_tokens', (u) => u.cache_creation?.ephemeral_1h_input_tokens],
  // Older entries carry only the total, with no lifetime split.
  ['cache_write_input_tokens', (u) => (u.cache_creation ? undefined : u.cache_creation_input_tokens)],
  ['web_search_requests', (u) => u.server_tool_use?.web_search_requests],
  ['web_fetch_requests', (u) => u.server_tool_use?.web_fetch_requests],
];

const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? String(v) : null);

/** The usage-bearing entries of one transcript, and its first working directory. Throws if it cannot be read. */
async function readTranscript(file, period) {
  let firstCwd = null;
  const entries = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const text of lines) {
    const hasUsage = text.includes('"usage"');
    if (!hasUsage && (firstCwd !== null || !text.includes('"cwd"'))) continue;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      continue;
    }
    if (firstCwd === null && typeof entry?.cwd === 'string') firstCwd = entry.cwd;
    const usage = entry?.message?.usage;
    const model = entry?.message?.model;
    if (!hasUsage || !usage || typeof model !== 'string' || model.startsWith('<')) continue;
    const day = String(entry.timestamp ?? '').slice(0, 10);
    if (day < period.from || day > period.to) continue;
    const key = entry.requestId ?? entry.message?.id;
    if (typeof key !== 'string' || !key) continue;
    const tokens = {};
    for (const [unit, pick] of UNITS) {
      const n = count(pick(usage));
      if (n !== null && n !== '0') tokens[unit] = n;
    }
    entries.push({
      key,
      cwd: typeof entry.cwd === 'string' ? entry.cwd : null,
      day,
      model,
      branch: typeof entry.gitBranch === 'string' ? entry.gitBranch : '',
      session: typeof entry.sessionId === 'string' ? entry.sessionId : '',
      speed: usage.speed ?? null,
      serviceTier: usage.service_tier ?? null,
      tokens,
    });
  }
  return { firstCwd, entries };
}

export async function collect(ctx) {
  const root = ctx.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  const repo = repoKey(git(['config', '--get', 'remote.origin.url'], ctx.cloneRoot).stdout);
  if (!repo) return { lines: [], files: [], note: 'the clone has no GitHub origin, so no transcript can be matched to it' };
  const member = ctx.membership ?? makeMembership(repo);
  const since = Date.parse(`${ctx.period.from}T00:00:00Z`);

  // One record per request, holding the highest value seen for each field.
  const requests = new Map();
  let unreadable = 0;
  for (const file of transcriptFiles(root, since)) {
    let read;
    try {
      read = await readTranscript(file, ctx.period);
    } catch {
      unreadable += 1;
      continue;
    }
    const startedHere = member(read.firstCwd);
    for (const e of read.entries) {
      if (!startedHere && !member(e.cwd)) continue;
      const seen = requests.get(e.key);
      if (!seen) {
        requests.set(e.key, e);
        continue;
      }
      for (const [unit, n] of Object.entries(e.tokens)) {
        if (seen.tokens[unit] === undefined || compareDecimals(n, seen.tokens[unit]) > 0) seen.tokens[unit] = n;
      }
    }
  }

  const totals = new Map();
  const detail = new Map();
  const bump = (map, key, base, unit, n) => {
    const row = map.get(key) ?? { ...base, tokens: {} };
    row.tokens[unit] = addDecimals(row.tokens[unit] ?? '0', n);
    map.set(key, row);
  };
  for (const r of requests.values()) {
    for (const [unit, n] of Object.entries(r.tokens)) {
      bump(totals, r.model, { model: r.model }, unit, n);
      bump(detail, JSON.stringify([r.day, r.session, r.branch, r.model, r.speed, r.serviceTier]), { day: r.day, session: r.session, branch: r.branch, model: r.model, speed: r.speed, serviceTier: r.serviceTier }, unit, n);
    }
  }

  const lines = [];
  for (const row of totals.values()) {
    for (const [unit, quantity] of Object.entries(row.tokens)) {
      lines.push(makeLine({ source: id, product: `Claude Code ${row.model}`, unit, quantity, basis: 'estimated', periodFrom: ctx.period.from, periodTo: ctx.period.to }));
    }
  }
  const rows = [...detail.values()].sort((a, b) => (a.day + a.session + a.model < b.day + b.session + b.model ? -1 : 1));
  const fullNote = unreadable ? `${note}; ${unreadable} transcript file(s) could not be read` : note;
  return { lines, note: fullNote, files: [{ dir: 'costs', name: `claude-code-${ctx.period.to}.json`, data: { date: ctx.period.to, period: ctx.period, note: fullNote, rows } }] };
}
