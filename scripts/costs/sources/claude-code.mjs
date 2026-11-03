// Claude Code tokens for this repository, month to date, from the local session transcripts under
// ~/.claude/projects/ (subagents included): no credential. Laptop sessions only: cloud or VM sessions leave no
// transcript here. Each response's usage is repeated on every transcript entry that shares its requestId
// (measured 2026-11-03: 2,816 requests in three transcripts, no group with differing usage), so each counts once.
// Only usage, model, sessionId, gitBranch, cwd, timestamp and requestId are read; message content never is.
import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { git } from '../approved.mjs';
import { addDecimals, makeLine } from '../money.mjs';

export const id = 'claude-code';
export const credentials = [];
export const note = 'laptop sessions only; tokens with no amount until T-053 prices them';

/** "git@github.com:owner/repo.git" and "https://github.com/owner/repo" both become "github.com/owner/repo". */
export function repoKey(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? `github.com/${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Decides, once per cwd, whether a transcript entry belongs to a checkout of the same repository. */
export function makeMembership(repo, originOf = (dir) => repoKey(git(['config', '--get', 'remote.origin.url'], dir).stdout)) {
  const cache = new Map();
  const member = (cwd) => {
    if (typeof cwd !== 'string' || !cwd) return false;
    if (cache.has(cwd)) return cache.get(cwd);
    let yes = false;
    if (existsSync(cwd)) yes = originOf(cwd) === repo;
    else if (cwd.includes('/.claude/worktrees/')) yes = member(cwd.split('/.claude/worktrees/')[0]);
    cache.set(cwd, yes);
    return yes;
  };
  return member;
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

export async function collect(ctx) {
  const root = ctx.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  const repo = repoKey(git(['config', '--get', 'remote.origin.url'], ctx.cloneRoot).stdout);
  if (!repo) return { lines: [], files: [] };
  const member = ctx.membership ?? makeMembership(repo);
  const since = Date.parse(`${ctx.period.from}T00:00:00Z`);
  const seen = new Set();
  const totals = new Map();
  const detail = new Map();
  const bump = (map, key, base, unit, n) => {
    const row = map.get(key) ?? { ...base, tokens: {} };
    row.tokens[unit] = addDecimals(row.tokens[unit] ?? '0', n);
    map.set(key, row);
  };

  for (const file of transcriptFiles(root, since)) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const text of lines) {
      if (!text.includes('"usage"')) continue;
      let entry;
      try {
        entry = JSON.parse(text);
      } catch {
        continue;
      }
      const usage = entry?.message?.usage;
      const model = entry?.message?.model;
      if (!usage || typeof model !== 'string' || model.startsWith('<')) continue;
      const day = String(entry.timestamp ?? '').slice(0, 10);
      if (day < ctx.period.from || day > ctx.period.to) continue;
      const key = entry.requestId ?? entry.message?.id;
      if (!key || seen.has(key)) continue;
      if (!member(entry.cwd)) continue;
      seen.add(key);
      const branch = typeof entry.gitBranch === 'string' ? entry.gitBranch : '';
      const session = typeof entry.sessionId === 'string' ? entry.sessionId : '';
      const extra = { speed: usage.speed ?? null, serviceTier: usage.service_tier ?? null };
      for (const [unit, pick] of UNITS) {
        const n = count(pick(usage));
        if (n === null || n === '0') continue;
        bump(totals, `${model}\u0000${unit}`, { model }, unit, n);
        bump(detail, JSON.stringify([day, session, branch, model, extra.speed, extra.serviceTier]), { day, session, branch, model, ...extra }, unit, n);
      }
    }
  }

  const out = [];
  for (const row of totals.values()) {
    for (const [unit, quantity] of Object.entries(row.tokens)) {
      out.push(makeLine({ source: id, product: `Claude Code ${row.model}`, unit, quantity, basis: 'estimated', periodFrom: ctx.period.from, periodTo: ctx.period.to }));
    }
  }
  const rows = [...detail.values()].sort((a, b) => (a.day + a.session < b.day + b.session ? -1 : 1));
  return { lines: out, files: [{ dir: 'costs', name: `claude-code-${ctx.period.to}.json`, data: { date: ctx.period.to, period: ctx.period, note, rows } }] };
}
