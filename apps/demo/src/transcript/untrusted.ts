// Output-surface defenses for text that can come from a deliverable or a party: check details (csv_columns_exact
// quotes the seller's header names), screen signal details, aggregate reasons, and the seller-authored terms in
// the signed message. Hard rule: deliverables are untrusted. Every surface (terminal, Markdown, HTML, JSON) gets
// text that cannot add escapes, markup, links or invisible reordering.

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

/** JSON text with every invisible or control character written as a \u escape, so a viewer cannot be tricked. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(INVISIBLE, (c) =>
    [...c].flatMap((ch) => (ch.length === 2 ? [ch.charCodeAt(0), ch.charCodeAt(1)] : [ch.charCodeAt(0)])).map((u) => `\\u${u.toString(16).padStart(4, '0')}`).join(''),
  );
}

/** A fenced code block whose fence is longer than any backtick run inside, so content cannot close it. */
export function fenced(lang: string, body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}
