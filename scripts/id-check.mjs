// The ID check (T-405, prepared as a draft: workflow files are tier 3, Rafa's word). A pull request names
// the task it works on, a T-number with a task file in docs/tasks/, in its branch (t-405-…), its title or a "Closes
// T-nnn" line, or it says "no ticket" in its title or body. It reads the checkout and the PR event, nothing else, and
// names no private ID: the private repository runs its own check against its own registry.
//   node scripts/id-check.mjs                       (in Actions: GITHUB_EVENT_PATH)
//   node scripts/id-check.mjs --title <t> --branch <b> --body <text>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T_ID = /(?<![A-Za-z0-9])T-(\d{3})(?![0-9])/gi;

// the T-numbers with a task file on this checkout
export function taskIds(dir = join(root, 'docs', 'tasks')) {
  return new Set(existsSync(dir) ? readdirSync(dir).map((f) => /^(T-\d{3})/.exec(f)?.[1]).filter(Boolean) : []);
}

// { ok, ids, reason }
export function checkPr({ title = '', branch = '', body = '' } = {}, ids = taskIds()) {
  const named = [...new Set([...`${branch} ${title} ${body}`.matchAll(T_ID)].map((m) => `T-${m[1]}`))].filter((id) => ids.has(id));
  if (named.length) return { ok: true, ids: named, reason: `names ${named.join(', ')}` };
  if (/\bno ticket\b/i.test(`${title} ${body}`)) return { ok: true, ids: [], reason: 'says "no ticket"' };
  return { ok: false, ids: [], reason: 'names no task with a file in docs/tasks/: put its T-number in the branch (t-405-…), the title or a "Closes T-nnn" line, or write "no ticket" in the body' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  let pr = { title: opt('--title') ?? '', branch: opt('--branch') ?? '', body: opt('--body') ?? '' };
  if (!opt('--title') && process.env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request ?? {};
    pr = { title: ev.title ?? '', branch: ev.head?.ref ?? '', body: ev.body ?? '' };
  }
  const r = checkPr(pr);
  console.log(`ID check: ${r.ok ? 'pass' : 'fail'}: ${r.reason}`);
  if (!r.ok) process.exit(1);
}
