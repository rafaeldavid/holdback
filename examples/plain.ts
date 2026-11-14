// One line of plain text, for any text from a deliverable, a party or a seller's API that reaches a log or an error.
// The same function as `plain` in packages/testkit/src/untrusted.ts (its tests: packages/testkit), kept here so the
// seller adapter's core imports no testkit module: the testkit's index builds a URL from import.meta.url when it
// loads, which fails in the Workers runtime (T-434). examples/seller-adapter-core.test.ts holds the two to one output.

/** C0 and C1 controls, including ESC (terminal escapes), CR, LF and TAB. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidi overrides and isolates, marks, zero-width characters, BOM, and Unicode tag characters. */
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/gu;
const LINE_BREAKS = /\r\n|[\r\n\u2028\u2029]/g;

/** One line of plain text: line breaks become spaces; controls, bidi and tag characters are removed. */
export const plain = (s: string): string => s.replace(LINE_BREAKS, ' ').replace(CONTROLS, '').replace(INVISIBLE, '');
