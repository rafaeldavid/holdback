// Builds the read-only design map (reports/design-map.html) from the repository's sources of truth.
// Run at each milestone: `pnpm map`, then republish the page (see .claude/commands/map.md).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function decisions() {
  const text = read('docs/decisions-today.md');
  const parts = text.split(/^## (D\d+)\. (.+)$/m);
  const result = [];
  for (let i = 1; i < parts.length; i += 3) {
    const [id, heading, body] = [parts[i], parts[i + 1], parts[i + 2]];
    const decided = body.match(/\*\*Decided [^*]*\*\*\s*(.+)/);
    const open = body.match(/\*\*Open\.\*\*\s*(.+)/);
    const adr = heading.match(/ADR-\d{4}/g) ?? [];
    let status = 'open';
    if (decided) status = /deferred/i.test(decided[1]) ? 'deferred' : 'decided';
    const { choice, detail } = decided ? outcome(body, decided[1]) : { choice: '', detail: open?.[1] ?? '' };
    result.push({ id, title: heading.replace(/\s*\(ADR[^)]*\)\s*$/, ''), adr, status, choice, detail });
  }
  return result;
}

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

// A plan row proposed for Rafa's approval reads:
// "(proposed (Rafa approves); rank 3; kind 4; 150k tokens) **Title.** Why now: …. Done when: …. Waits for the contract/API rearchitecture."
export function proposal(text) {
  if (!/^\(proposed \(Rafa approves\)/.test(text)) return null;
  const head = text.match(/^\((.*?)\)\s*(?=\*\*)/)?.[1] ?? '';
  const after = (label, stops) => text.match(new RegExp(`${label}: (.+?)(?= (?:${stops}):|$)`))?.[1].trim() ?? '';
  return {
    rank: Number(head.match(/rank (\d+)/)?.[1] ?? 0),
    kind: head.match(/kind ([\d, and]+?)(?:;|$)/)?.[1].trim() ?? '',
    budget: head.match(/(\d+k) tokens/)?.[1] ?? '',
    title: text.match(/\*\*(.+?)\.?\*\*/)?.[1] ?? '',
    why: after('Why now', 'Done when'),
    done: after('Done when', 'Why now').replace(/\s*Waits for the contract\/API rearchitecture\.?$/, ''),
    waits: /waits for the contract\/API rearchitecture/i.test(text),
  };
}

// docs/backlog.md: each "## " theme with its table rows (item, source, when).
export function backlog() {
  const text = read('docs/backlog.md');
  const parts = text.split(/^## (.+)$/m);
  const themes = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const rows = [...body.matchAll(/^\| (?!Item \||---)(.+?) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({ item: m[1], source: m[2], when: m[3] }));
    const intro = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('|')) ?? '';
    themes.push({ theme: parts[i], intro, rows });
  }
  return themes;
}

// docs/team.md, Change recipes: one row per kind of change.
export function recipes() {
  const body = section(read('docs/team.md'), '## Change recipes');
  return [...body.matchAll(/^\| (\d+)\. (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({
    kind: Number(m[1]), name: m[2], paths: m[3], checks: m[4], review: m[5], approves: m[6], budget: m[7],
  }));
}

// The newest docs/log entry: its date, its lead paragraph and its "## Live" bullets.
export function live() {
  const logs = list('docs/log', /^\d{4}-\d{2}-\d{2}\.md$/);
  if (!logs.length) return { date: '', lead: '', items: [] };
  const text = read(`docs/log/${logs.at(-1)}`);
  const lead = text.split('\n').find((l) => /^\*\*/.test(l)) ?? '';
  return { date: logs.at(-1).slice(0, 10), lead, items: bullets(section(text, '## Live')) };
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
    // every planned line of the phase ("- T-201 …", "- [x] T-013 …", "- D4 decided …"), for the roadmap; a phase with
    // no task IDs yet (Phase 5 onward) shows all its lines, so later work is visible before it has task files
    const plan = body.split('**Exit:**')[0];
    const lines = [...plan.matchAll(/^- (?:\[([ x])\] )?(.+)$/gm)]
      .map((m) => ({ checked: m[1] === 'x', id: m[2].match(/^(T-\d+[a-z]?)\b/)?.[1] ?? null, text: m[2].replace(/^T-\d+[a-z]?\b\s*/, '').replace(/\s+/g, ' ').trim() }))
      .map((it) => ({ ...it, proposal: proposal(it.text) }));
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

export function waiting() {
  const logs = list('docs/log', /^\d{4}-\d{2}-\d{2}\.md$/);
  if (!logs.length) return [];
  return bullets(section(read(`docs/log/${logs.at(-1)}`), '## Waiting on Rafa'));
}

export function collect() {
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
    waiting: waiting(),
    backlog: backlog(),
    recipes: recipes(),
    live: live(),
  };
}

export function build() {
  const template = read('tools/design-map/template.html');
  const marker = '/*__MAP_DATA__*/null';
  if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
  const data = JSON.stringify(collect()).replace(/</g, '\\u003c');
  return template.replace(marker, data);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = join(root, 'reports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'design-map.html');
  writeFileSync(out, build());
  console.log(`design map written: ${out}`);
}
