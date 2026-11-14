// T-413: every entry in docs/decisions-today.md carries one machine-readable status line, so Crow Control can age the
// decisions that wait for Rafa apart from the ones agents adopted, which he may overrule. The line sits right under the
// entry's heading:
//
//   **Status:** <state>, <YYYY-MM-DD>.
//
// <state> is one of STATES; the date is the day the entry reached that state. The console reads it with STATUS_LINE.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STATES = ['needs Rafa', 'adopted', 'decided', 'deferred', 'superseded'] as const;
const STATUS_LINE = /^\*\*Status:\*\* (needs Rafa|adopted|decided|deferred|superseded), (\d{4}-\d{2}-\d{2})\.$/;

const text = readFileSync(new URL('../docs/decisions-today.md', import.meta.url), 'utf8');
const parts = text.split(/^## (D\d+)\. (.+)$/m);
const entries: { id: string; body: string }[] = [];
for (let i = 1; i < parts.length; i += 3) entries.push({ id: parts[i]!, body: parts[i + 2]! });

describe('docs/decisions-today.md status lines (T-413)', () => {
  it('has entries to check', () => {
    expect(entries.length).toBeGreaterThan(60);
  });

  it.each(entries)('$id opens with one valid status line', ({ id, body }) => {
    const first = body.split('\n').find((l) => l.trim() !== '') ?? '';
    expect(first, `${id}: the first line under the heading must be "**Status:** <state>, <YYYY-MM-DD>." with a state from ${STATES.join(' | ')}`).toMatch(STATUS_LINE);
    expect(body.match(/^\*\*Status:\*\*/gm)?.length, `${id} has more than one status line`).toBe(1);
    const day = STATUS_LINE.exec(first)![2]!;
    expect(Number.isNaN(Date.parse(`${day}T00:00:00Z`)), `${id}: ${day} is not a date`).toBe(false);
  });

  it('marks decided only an entry whose text records the decision', () => {
    for (const { id, body } of entries) {
      const state = STATUS_LINE.exec(body.split('\n').find((l) => l.trim() !== '') ?? '')?.[1];
      // the console's parser (and the design map's) reads "**Decided …**" as decided; the two must agree
      const recorded = /\*\*Decided [^*]*\*\*/.test(body);
      if (state === 'decided') expect(recorded, `${id} is marked decided, but its text has no "**Decided …**" line`).toBe(true);
      if (!recorded) expect(state, `${id} has no "**Decided …**" line, so it cannot be marked decided`).not.toBe('decided');
    }
  });
});
