// Deliverables are untrusted, output surfaces (docs/team.md, Rules and checks). The helpers' own test; the hostile
// text on the demo's four surfaces is in apps/demo/src/transcript/untrusted.test.ts, the snapshots' in render.test.ts.
import { describe, expect, it } from 'vitest';
import { fenced, safeJson } from './untrusted.js';

describe('untrusted text helpers', () => {
  it('safeJson writes invisible characters as escapes; fenced outgrows any backtick run', () => {
    expect(safeJson({ d: '‮\u{E0041}' })).toContain('\\u202e');
    expect(safeJson({ d: '\u{E0041}' })).toContain('\\udb40\\udc41');
    expect(fenced('json', 'a ```` b')).toMatch(/^`{5}json\n/);
  });
});
