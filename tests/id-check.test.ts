// T-437: the ID check's two links. A pull request names its task (scripts/id-check.mjs, T-405), and that task's file
// names its roadmap row or says none, in one header line:
//
//   - **Roadmap row:** N70
//
// The public repository cannot see the private roadmap, so the check reads the line's shape only; Crow Control's build,
// which sees both, reports an ID no row answers to. Files filed before 2026-11-13 (below T-402) are exempt.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_WITH_ROW, NO_TASK, ROW_LINE, checkPr, rowLine, taskIds } from '../scripts/id-check.mjs';

const head = (id: string, extra: string) => `# ${id}: a task\n\n- **Lane:** infra\n${extra}- **Status:** todo\n\n## Intent\n\nNames N88 here, which does not count.\n`;
function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'id-check-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
}
const D = dir({
  'T-440-row.md': head('T-440', '- **Roadmap row:** N70\n'),
  'T-441-rows.md': head('T-441', '- **Roadmap row:** N109, N119 (the trust page, part 1)\n'),
  'T-442-none.md': head('T-442', '- **Roadmap row:** none (a CI fix)\n'),
  'T-443-nothing.md': head('T-443', ''),
  'T-444-bad.md': head('T-444', '- **Roadmap row:** the trust page\n'),
  'T-445-intent-only.md': '# T-445: x\n\n- **Lane:** infra\n\n## Intent\n\n- **Roadmap row:** N70\n',
  'T-301-old.md': head('T-301', ''),
  'T-446-twice.md': head('T-446', '- **Roadmap row:** N37\n- **Roadmap row:** N134\n'),
  'T-447-one.md': head('T-447', '- **Roadmap row:** N70\n'),
  'T-447-two.md': head('T-447', ''),
});
const ids = taskIds(D);
const check = (pr: { title?: string; branch?: string; body?: string }) => checkPr(pr, ids, D);

describe('the ID check: the task file names its roadmap row (T-437)', () => {
  it('passes a PR whose task file names one row, several, or none', () => {
    expect(check({ branch: 't-440-x' })).toMatchObject({ ok: true, ids: ['T-440'] });
    expect(check({ title: 'feat: y (T-441)' }).ok).toBe(true);
    expect(check({ body: 'Closes T-442' }).ok).toBe(true);
  });

  it('fails a PR whose task file has no Roadmap row line, and says what to add and where', () => {
    const r = check({ branch: 't-443-x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('T-443');
    expect(r.reason).toContain('T-443-nothing.md');
    expect(r.reason).toContain('- **Roadmap row:** N70');
    expect(r.reason).toContain('"none"');
    expect(r.reason).toContain('## Intent');
  });

  it('fails a malformed line, and a line below the header does not count', () => {
    expect(check({ branch: 't-444-x' })).toMatchObject({ ok: false });
    expect(check({ branch: 't-444-x' }).reason).toContain('not a list of row IDs');
    expect(check({ branch: 't-445-x' })).toMatchObject({ ok: false });
  });

  it('fails when any named task lacks the line, naming each one', () => {
    const r = check({ branch: 't-440-x', body: 'Closes T-443' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('T-443');
    expect(r.reason).not.toContain('T-440-row.md');
  });

  it('fails a header with two Roadmap row lines (a merge can leave both), and checks every file of a shared number', () => {
    const r = check({ branch: 't-446-x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('has 2 "Roadmap row:" lines');
    expect(r.reason).toContain('keep one');
    const s = check({ branch: 't-447-x' });
    expect(s.ok).toBe(false);
    expect(s.reason).toContain('T-447-two.md');
    expect(s.reason).not.toContain('T-447-one.md');
  });

  it('exempts files filed before 2026-11-13 (below T-402) by their number', () => {
    expect(FIRST_WITH_ROW).toBe(402);
    expect(check({ branch: 't-301-old' }).ok).toBe(true);
  });

  it('keeps the first link: a PR that names no task fails with the shared message; "no ticket" passes', () => {
    expect(check({ branch: 'misc', title: 'tidy' })).toEqual({ ok: false, ids: [], reason: NO_TASK });
    expect(NO_TASK).toBe('names no task: put its ID in the branch (t-405-…), the title or a "Closes" line, or write "no ticket" in the body');
    expect(check({ title: 'chore: bump', body: 'No ticket: a dependency bump.' }).ok).toBe(true);
    expect(check({ branch: 't-999-unfiled' }).ok).toBe(false);
  });

  it('ignores the template\'s HTML comments: guidance in them is no answer', () => {
    expect(check({ branch: 'misc', body: '<!-- No task: write "no ticket" here. Closes T-440 -->\nTask: T-xxx' }).ok).toBe(false);
    expect(check({ branch: 'misc', body: '<!-- guidance -->\nNo ticket: a dependency bump.' }).ok).toBe(true);
    expect(check({ branch: 'misc', body: 'Run `grep "<!--"` then Closes T-440' }).ok, 'an unclosed comment is text').toBe(true);
  });

  it('reads the line\'s shape: row IDs separated by commas, a bracketed note, or none', () => {
    expect(rowLine('N70')).toEqual({ ok: true, none: false, ids: ['N70'] });
    expect(rowLine('N1a, T-252 and B1')).toEqual({ ok: true, none: false, ids: ['N1a', 'T-252', 'B1'] });
    expect(rowLine('none, a CI fix')).toEqual({ ok: true, none: true, ids: [] });
    for (const bad of ['', 'TBD', 'n70', 'N70 N71', 'roadmap row N70', 'N1234']) expect(rowLine(bad).ok, bad).toBe(false);
  });
});

describe('every task file from T-402 on carries the line (the backfill, T-437)', () => {
  const tasks = new URL('../docs/tasks/', import.meta.url);
  const files = readdirSync(tasks).filter((f) => /^T-\d{3}/.test(f) && Number(f.slice(2, 5)) >= FIRST_WITH_ROW);
  it('has files to check', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(f, () => {
      const text = readFileSync(new URL(f, tasks), 'utf8');
      const m = ROW_LINE.exec(text.split(/^## /m)[0]);
      expect(m, `${f} has no "- **Roadmap row:**" line in its header`).not.toBeNull();
      expect(rowLine(m![1]).ok, `${f}: ${m![1]}`).toBe(true);
    });
  }
});
