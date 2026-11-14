// The ID check (T-405; the second link T-437). The chain it holds: a pull request names its task, and the task's
// file names its roadmap row or says none; Crow Control's build then ties the row to that work.
//   1. A pull request names the task it works on, a T-number with a task file in docs/tasks/, in its branch (t-405-…),
//      its title or a "Closes T-nnn" line, or it says "no ticket" in its title or body.
//   2. Each task it names has, in its file's header (above the first "## " heading), the line
//        - **Roadmap row:** N70
//      with one roadmap row's ID, several separated by commas ("N109, N119"), a note in brackets after an ID allowed
//      ("N70 (part 1)"), or "none" for work with no row ("none (a CI fix)").
//      The date rule: files filed from 2026-11-13 on must carry it. Task numbers are given in order and T-402 was the
//      first filed that day, so the check reads the number: T-402 and later (FIRST_WITH_ROW). Older files are exempt.
// This repository cannot see the private roadmap, so the check reads the line's shape only; Crow Control's build,
// which reads both repositories, reports an ID that no row answers to. It reads the checkout and the PR event,
// nothing else, and names no private ID: the private repository runs its own check against its own registry, and
// both say the first message in the same words (NO_TASK).
//   node scripts/id-check.mjs                       (in Actions: GITHUB_EVENT_PATH)
//   node scripts/id-check.mjs --title <t> --branch <b> --body <text>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS = join(root, 'docs', 'tasks');
const T_ID = /(?<![A-Za-z0-9])T-(\d{3})(?![0-9])/gi;
export const FIRST_WITH_ROW = 402;
export const NO_TASK = 'names no task: put its ID in the branch (t-405-…), the title or a "Closes" line, or write "no ticket" in the body';
export const ROW_LINE = /^- \*\*Roadmap rows?:\*\*[ \t]*(.*)$/im;
export const ROW_SHAPE = /^(?:T-\d{3}|[A-Z]{1,2}\d{1,3}[a-z]?)$/;
const HOW = 'with the row\'s ID from the roadmap, several separated by commas, or "none" for work with no row';

// the T-numbers with a task file on this checkout
export function taskIds(dir = TASKS) {
  return new Set(existsSync(dir) ? readdirSync(dir).map((f) => /^(T-\d{3})/.exec(f)?.[1]).filter(Boolean) : []);
}

// The line's value: { ok, none, ids }. "none" with anything after it, or row IDs separated by commas or "and", each
// of a row's shape (T-252, N70, AD4, N1a), with bracketed notes removed first.
export function rowLine(value) {
  const v = String(value ?? '').trim();
  if (/^none\b/i.test(v)) return { ok: true, none: true, ids: [] };
  let bare = v, prev;
  do { prev = bare; bare = bare.replace(/\([^()]*\)/g, ''); } while (bare !== prev);
  const items = bare.split(/,|\band\b/).map((x) => x.trim()).filter(Boolean);
  return items.length && items.every((x) => ROW_SHAPE.test(x)) ? { ok: true, none: false, ids: items } : { ok: false, none: false, ids: [] };
}

// The problems of one task's files (two files may share a number): [] when each carries a well-formed line.
export function rowProblems(id, dir = TASKS) {
  if (Number(id.slice(2)) < FIRST_WITH_ROW || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(`${id}-`) || f === `${id}.md`).flatMap((f) => {
    const head = readFileSync(join(dir, f), 'utf8').split(/^## /m)[0];
    const m = ROW_LINE.exec(head);
    const file = `docs/tasks/${f}`;
    if (!m) return [`${id}'s task file ${file} names no roadmap row: add the line "- **Roadmap row:** N70" to its header, above "## Intent", ${HOW}`];
    if (!rowLine(m[1]).ok) return [`${id}'s task file ${file} has a "Roadmap row:" line that is not a list of row IDs or "none": write "- **Roadmap row:** N70", ${HOW}`];
    return [];
  });
}

// { ok, ids, reason }
// The body without its HTML comments: the pull request template's guidance ("write no ticket …", "T-xxx") is not
// the author's answer, and GitHub keeps the comments in the body.
export const uncommented = (text) => String(text ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
export function checkPr({ title = '', branch = '', body: raw = '' } = {}, ids = taskIds(), dir = TASKS) {
  const body = uncommented(raw);
  const named = [...new Set([...`${branch} ${title} ${body}`.matchAll(T_ID)].map((m) => `T-${m[1]}`))].filter((id) => ids.has(id));
  if (named.length) {
    const problems = named.flatMap((id) => rowProblems(id, dir));
    return problems.length ? { ok: false, ids: named, reason: problems.join('; ') } : { ok: true, ids: named, reason: `names ${named.join(', ')}, and each task file names its roadmap row or says none` };
  }
  if (/\bno ticket\b/i.test(`${title} ${body}`)) return { ok: true, ids: [], reason: 'says "no ticket"' };
  return { ok: false, ids: [], reason: NO_TASK };
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
