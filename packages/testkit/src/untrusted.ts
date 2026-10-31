// Output-surface defenses for snapshot text that can come from a deliverable or a party: check details
// (csv_columns_exact quotes the seller's header names), screen signal details, aggregate reasons, refusal
// details and run errors. Hard rule: deliverables are untrusted, and a .expect.md is an output surface too.
// A copy of apps/demo/src/transcript/untrusted.ts (plain, mdText, fenced): a package must not import an app.
// Keep the two in step; the hostile-header tests in both places pin the behavior.

/** C0 and C1 controls, including ESC (terminal escapes), CR, LF and TAB. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidi overrides and isolates, marks, zero-width characters, BOM, and Unicode tag characters. */
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/gu;
const LINE_BREAKS = /\r\n|[\r\n\u2028\u2029]/g;

/** One line of plain text: line breaks become spaces; controls, bidi and tag characters are removed. */
export const plain = (s: string): string => s.replace(LINE_BREAKS, ' ').replace(CONTROLS, '').replace(INVISIBLE, '');

/**
 * Plain text safe inside a Markdown paragraph, list item or table cell: every Markdown and inline-HTML special
 * is backslash-escaped (CommonMark allows it for all ASCII punctuation), and autolinks are broken.
 */
export function mdText(s: string): string {
  return plain(s)
    // Parentheses stay: they only form a link after a ']', which is escaped.
    .replace(/[\\`*_[\]<>!|~#&]/g, '\\$&')
    .replace(/:\/\//g, '\\://')
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`);
}

/** A fenced code block whose fence is longer than any backtick run inside, so content cannot close it. */
export function fenced(lang: string, body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}
