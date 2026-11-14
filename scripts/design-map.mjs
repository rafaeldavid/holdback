// Builds the read-only design map (reports/design-map.html) from the repository's sources of truth.
// Run at each milestone: `pnpm map`, then republish the page (see .claude/commands/map.md). Colours, type and the
// header bar come from Crow's brand kit (site/brand/), inlined at build time so the page stays one file (T-424).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerBar, kitCss, markDataUri } from '../site/brand/kit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const list = (dir, pattern) => readdirSync(join(root, dir)).filter((f) => pattern.test(f)).sort();
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function section(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

const bullets = (text) => [...text.matchAll(/^\s*(?:-|\d+\.) (.+)$/gm)].map((m) => m[1].trim());

export function workFeed() {
  const out = git(['log', '--first-parent', '--format=%h%x1f%cI%x1f%s%x1f%b%x1e']);
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, date, subject, body] = record.split('\x1f');
      // a merge commit ("Merge pull request #12 …") or a squash merge ("feat: … (#12)")
      const merged = subject.match(/^Merge pull request #(\d+)/);
      const squashed = subject.match(/ \(#(\d+)\)$/);
      const pr = merged ?? squashed;
      const title = merged ? (body ?? '').split('\n')[0].trim() || subject : subject.replace(/ \(#\d+\)$/, '');
      const type = title.match(/^(\w+)(?:\(([^)]+)\))?:/);
      return { sha, date, pr: pr ? Number(pr[1]) : null, title, type: type ? type[1] : 'commit', scope: type?.[2] ?? null };
    });
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Turns "A, and the only mode in Phase 1." into the text of option A plus the rest, so the map never shows a bare letter.
function outcome(body, decided) {
  const note = decided.replace(/\s*\(ADR-\d{4}[^)]*\)/g, '').trim();
  const recommendation = body.match(/^\*\*Recommendation:\*\*\s*(.+)$/m)?.[1] ?? '';
  if (/^as recommended\.?$/i.test(note)) return { choice: capitalize(recommendation), detail: '' };
  const letter = note.match(/^([A-D])(?:[.,]\s*|$)(.*)$/);
  if (!letter) return { choice: capitalize(note), detail: '' };
  const option = body.match(new RegExp(`^\\| ${letter[1]}\\. ([^|]+)\\|`, 'm'))?.[1].trim();
  const rest = letter[2].replace(/^and\s+/, '').trim();
  return { choice: option ?? `Option ${letter[1]}`, detail: rest ? capitalize(rest) : '' };
}

// The first line that is not blank under each "## Dnn." heading is "**Status:** <state>, <YYYY-MM-DD>." (T-413). The
// state sets the status: "needs Rafa" or "open" waits on Rafa (open), "deferred" is deferred, and "adopted", "decided"
// and "superseded" are settled (decided). An entry without a Status line in that form falls back to its bold
// "Decided …" or "Open." lead, as entries were read before T-413. The Status line wins over the lead, so a Decided line
// that says something stays "deferred" (D70) does not make the entry deferred.
const STATUS_LINE = /^\*\*Status:\*\* ([a-zA-Z ]+?), (\d{4}-\d{2}-\d{2})\.$/;
const STATE_STATUS = { 'needs rafa': 'open', open: 'open', deferred: 'deferred', adopted: 'decided', decided: 'decided', superseded: 'decided' };

export function decisionsFrom(text) {
  const parts = text.split(/^## (D\d+)\. (.+)$/m);
  const result = [];
  for (let i = 1; i < parts.length; i += 3) {
    const [id, heading, body] = [parts[i], parts[i + 1], parts[i + 2]];
    const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const state = STATUS_LINE.exec(first)?.[1].toLowerCase() ?? null;
    const decided = body.match(/\*\*Decided [^*]*\*\*\s*(.+)/);
    const open = body.match(/\*\*Open\.\*\*\s*(.+)/);
    const adr = heading.match(/ADR-\d{4}/g) ?? [];
    const title = heading.replace(/\s*\(ADR[^)]*\)\s*$/, '');
    let status = 'open';
    if (state && STATE_STATUS[state]) status = STATE_STATUS[state];
    else if (decided) status = /deferred/i.test(decided[1]) ? 'deferred' : 'decided';
    // the lead paragraph after the Status line ("**Proposed 2026-11-14 by T-407; …**"), for an entry with no Decided line
    const lead = body.split('\n').map((l) => l.trim()).find((l) => /^\*\*/.test(l) && !/^\*\*Status:\*\*/.test(l))?.replace(/\*\*/g, '') ?? '';
    let choice = '';
    let detail = open?.[1] ?? '';
    if (decided) ({ choice, detail } = outcome(body, decided[1]));
    else if (status === 'decided') choice = title;
    else detail = detail || lead;
    result.push({ id, title, adr, state, status, choice, detail });
  }
  return result;
}

export const decisions = () => decisionsFrom(read('docs/decisions-today.md'));

export function adrs() {
  return list('docs/decisions', /^ADR-\d{4}.*\.md$/).map((file) => {
    const text = read(`docs/decisions/${file}`);
    const title = text.match(/^# (ADR-\d{4}): (.+)$/m);
    const status = text.match(/^- \*\*Status:\*\* (\w+)/m);
    return { id: title?.[1] ?? file, title: title?.[2] ?? file, status: status?.[1] ?? 'Unknown' };
  });
}

export function tasks() {
  return list('docs/tasks', /^T-\d{3}.*\.md$/).map((file) => {
    const text = read(`docs/tasks/${file}`);
    const field = (name) => text.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'm'))?.[1].trim() ?? '';
    const head = text.match(/^# (T-\d{3}): (.+)$/m);
    const dependsText = field('Depends on');
    return {
      id: head?.[1] ?? file.slice(0, 5),
      title: head?.[2] ?? file,
      lane: field('Lane'),
      phase: Number(field('Phase').match(/\d+/)?.[0] ?? -1),
      // A status may carry a note: "in progress (first slice merged)", "done for Phase 1 (…)". The leading keyword counts.
      status: field('Status').toLowerCase().match(/^(done|in progress|review|todo|blocked)\b/)?.[1] ?? field('Status').toLowerCase().replace(/\s*\(.*$/, ''),
      dependsOn: [...dependsText.matchAll(/T-\d{3}/g)].map((m) => m[0]),
      dependsOnAll: /^all\b/i.test(dependsText),
    };
  });
}

// The public repo holds the current build and its record only (Rafa, 2026-11-07): later phases, proposed rows and
// the backlog are planned privately, so the map reads none of them.

// docs/team.md, Change recipes: one row per kind of change.
export function recipes() {
  const body = section(read('docs/team.md'), '## Change recipes');
  return [...body.matchAll(/^\| (\d+)\. (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({
    kind: Number(m[1]), name: m[2], paths: m[3], checks: m[4], review: m[5], approves: m[6], budget: m[7],
  }));
}

// The daily log is not part of this repository: the maintainers keep it privately (docs/private-materials.md). A
// caller that holds the log passes its folder as { logDir }, absolute or relative to the repository root. Without the
// option the map reads docs/log/ when the checkout has that folder. With no folder, or no entry in it, the Live and
// Waiting lists are empty and the page shows NO_LOG_NOTE in their place; nothing throws.
export const NO_LOG_NOTE = 'This build has no daily log, so the map shows no live list and no waiting list. The maintainers keep the log privately.';

// The newest entry of the daily log, by file name (YYYY-MM-DD.md): its date and its text, or null without one.
function newestLog({ logDir } = {}) {
  const dir = logDir ? resolve(root, logDir) : join(root, 'docs/log');
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().at(-1);
  return name ? { date: name.slice(0, 10), text: readFileSync(join(dir, name), 'utf8') } : null;
}

// The newest daily log entry: its date, its lead paragraph and its "## Live" bullets.
export function live(options) {
  const log = newestLog(options);
  if (!log) return { date: '', lead: '', items: [], note: NO_LOG_NOTE };
  const lead = log.text.split('\n').find((l) => /^\*\*/.test(l)) ?? '';
  return { date: log.date, lead, items: bullets(section(log.text, '## Live')) };
}

export function phases(allTasks) {
  const text = read('docs/plan.md');
  const parts = text.split(/^## Phase (\d+): (.+)$/m);
  const result = [];
  for (let i = 1; i < parts.length; i += 3) {
    const n = Number(parts[i]);
    const body = parts[i + 2];
    const goal = capitalize(body.match(/^Goal: (.+)$/m)?.[1] ?? '');
    const exit = bullets(section(body, '**Exit:**'));
    const own = allTasks.filter((t) => t.phase === n);
    const done = own.length > 0 && own.every((t) => t.status === 'done');
    const active = own.some((t) => t.status === 'in progress' || t.status === 'review');
    // every planned line of the phase ("- T-201 …", "- [x] T-013 …", "- D4 decided …"); a phase with no task IDs shows
    // all its lines
    const plan = body.split('**Exit:**')[0];
    const lines = [...plan.matchAll(/^- (?:\[([ x])\] )?(.+)$/gm)]
      .map((m) => ({ checked: m[1] === 'x', id: m[2].match(/^(T-\d+[a-z]?)\b/)?.[1] ?? null, text: m[2].replace(/^T-\d+[a-z]?\b\s*/, '').replace(/\s+/g, ' ').trim() }));
    const tasked = lines.some((it) => it.id);
    const items = lines.filter((it) => !tasked || it.id || /^(Decide|D\d+)/.test(it.text));
    result.push({ n, title: parts[i + 1], goal, exit, items, tasks: own.map((t) => t.id), status: done ? 'done' : active ? 'active' : 'later' });
  }
  const next = result.find((p) => p.status !== 'done');
  if (next && next.status === 'later') next.status = 'next';
  return result;
}

export function api() {
  const text = read('docs/api.md');
  const endpoints = [...text.matchAll(/^\| (GET|POST|PUT|DELETE) \| `([^`]+)` \| (.*?) \| (.*?) \|$/gm)].map((m) => ({
    method: m[1],
    path: m[2],
    body: m[3].replace(/`/g, ''),
    result: m[4].replace(/`/g, ''),
  }));
  const examples = [];
  const re = /^## (.+)$|^```(\w+)\n([\s\S]*?)^```$/gm;
  let heading = '';
  for (const m of text.matchAll(re)) {
    if (m[1]) heading = m[1];
    else examples.push({ heading, lang: m[2], code: m[3].replace(/\n$/, '') });
  }
  return { endpoints, examples };
}

export function schema() {
  const id = JSON.parse(read('spec/schemas/commitment.schema.json')).$id;
  return { version: id.match(/\/(v[\d.]+)\//)?.[1] ?? 'unknown', files: list('spec/schemas', /\.schema\.json$/) };
}

export function reviews() {
  return list('docs/reviews', /\.md$/)
    .reverse()
    .map((file) => {
      const text = read(`docs/reviews/${file}`);
      return {
        file: `docs/reviews/${file}`,
        title: text.match(/^# (.+)$/m)?.[1] ?? file,
        date: file.slice(0, 10),
        nextSteps: bullets(section(text, '## Next steps')),
      };
    });
}

// The newest daily log entry's "## Waiting on Rafa" bullets; none without a log.
export function waiting(options) {
  const log = newestLog(options);
  return log ? bullets(section(log.text, '## Waiting on Rafa')) : [];
}

// options.logDir: the daily log's folder (see newestLog)
export function collect(options = {}) {
  const allTasks = tasks();
  return {
    generatedFrom: { commit: git(['rev-parse', '--short', 'HEAD']), date: git(['log', '-1', '--format=%cI']) },
    workFeed: workFeed(),
    decisions: decisions(),
    adrs: adrs(),
    tasks: allTasks,
    phases: phases(allTasks),
    api: api(),
    schema: schema(),
    reviews: reviews(),
    waiting: waiting(options),
    recipes: recipes(),
    live: live(options),
  };
}

export function build(options = {}) {
  const template = read('tools/design-map/template.html');
  const marker = '/*__MAP_DATA__*/null';
  if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
  const data = JSON.stringify(collect(options)).replace(/</g, '\\u003c');
  return withKit(template).replace(marker, () => data);
}

/** The template with the brand kit's CSS (tokens, base, header bar) and its header bar, Crow's mark inlined. */
export function withKit(template) {
  for (const m of ['/*__KIT_CSS__*/', '<!--__KIT_HEADER__-->']) if (!template.includes(m)) throw new Error(`template is missing ${m}`);
  return template
    .replace('/*__KIT_CSS__*/', () => kitCss({ parts: ['bar'], mark: markDataUri() }))
    .replace('<!--__KIT_HEADER__-->', () => headerBar({ home: 'https://crow.direct' }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = join(root, 'reports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'design-map.html');
  // --log-dir <folder>: the daily log's folder, for a maintainer who holds it
  const at = process.argv.indexOf('--log-dir');
  const options = at > 0 && process.argv[at + 1] ? { logDir: resolve(process.argv[at + 1]) } : {};
  writeFileSync(out, build(options));
  console.log(`design map written: ${out}`);
  if (live(options).note) console.log(`no daily log${options.logDir ? ` in ${options.logDir}` : ''}: the Live and Waiting lists are empty, and the page says so`);
}
