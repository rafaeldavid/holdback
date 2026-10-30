// Text normalization for the screen and for prompts (threat T2). Deterministic checks do NOT use
// this: they run on the decoded text as delivered (intake.ts `raw`), so normalization can never
// turn failing data into passing data.
//
// Strips every hidden character (hidden.ts: tags, bidi controls, variation selectors, other
// invisible characters), then applies NFKC. It counts what it removed and what NFKC changed, and
// keeps what tag characters and variation-selector runs spelled so the screen can read them.
//
// Hidden characters that are part of ordinary writing are stripped but not counted as suspicious
// ("explained"), so legitimate text does not escalate:
//   - an emoji tag sequence: U+1F3F4, 1 to 8 tag characters, U+E007F (subdivision flags);
//   - U+FE0E or U+FE0F right after an emoji or a keycap base;
//   - U+200D between emoji (ZWJ sequences);
//   - U+200C or U+200D between letters of a script other than Latin, Cyrillic or Greek
//     (Persian, Arabic, Indic and other scripts use them inside words).
import { HIDDEN_GLOBAL, hiddenClass } from './hidden.js';

const EMOJI_TAG_SEQUENCE = /\u{1F3F4}[\u{E0020}-\u{E007E}]{1,8}\u{E007F}/gu;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE = /[0-9#*]/;
const LETTER = /\p{L}/u;
const LATIN_LIKE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;
const NON_ASCII = /[^\x00-\x7f]/gu;

export interface Normalized {
  text: string;
  /** Unexplained tag characters removed. */
  tagChars: number;
  /** Unexplained bidi, variation-selector and other invisible characters removed. */
  zeroWidth: number;
  /** Hidden characters removed that belong to ordinary writing (see above). */
  explained: number;
  /** Code points NFKC changed (fullwidth forms, ligatures, superscripts...), ignoring space variants. */
  nfkcChanged: number;
  /** The ASCII spelled by tag characters, then the bytes spelled by variation-selector runs. */
  hiddenTagText: string;
}

/** The code point before index i, skipping variation selectors. */
function prevBase(s: string, i: number): string {
  let j = i;
  for (;;) {
    if (j <= 0) return '';
    const lo = s.charCodeAt(j - 1);
    const start = lo >= 0xdc00 && lo <= 0xdfff && j >= 2 ? j - 2 : j - 1;
    const ch = String.fromCodePoint(s.codePointAt(start)!);
    const cp = ch.codePointAt(0)!;
    if (!((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef))) return ch;
    j = start;
  }
}
const nextChar = (s: string, i: number): string => (i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : '');

export function normalizeText(raw: string): Normalized {
  let explained = 0;
  let tagText = '';
  let tagChars = 0;
  let zeroWidth = 0;
  const vsBytes: number[] = [];
  const withoutFlags = raw.replace(EMOJI_TAG_SEQUENCE, (m) => {
    explained += [...m].length - 1;
    return '\u{1F3F4}';
  });
  const stripped = withoutFlags.replace(HIDDEN_GLOBAL, (c: string, offset: number, s: string) => {
    const cp = c.codePointAt(0)!;
    const cls = hiddenClass(cp);
    if (cls === 'tag') {
      tagChars++;
      const a = cp - 0xe0000;
      if (a >= 0x20 && a <= 0x7e) tagText += String.fromCharCode(a);
      return '';
    }
    const before = prevBase(s, offset);
    const after = nextChar(s, offset + c.length);
    if ((cp === 0xfe0e || cp === 0xfe0f) && (PICTOGRAPHIC.test(before) || KEYCAP_BASE.test(before))) {
      explained++;
      return '';
    }
    if (cp === 0x200d && PICTOGRAPHIC.test(before) && PICTOGRAPHIC.test(after)) {
      explained++;
      return '';
    }
    if ((cp === 0x200c || cp === 0x200d) && LETTER.test(before) && LETTER.test(after) && !LATIN_LIKE.test(before) && !LATIN_LIKE.test(after)) {
      explained++;
      return '';
    }
    zeroWidth++;
    if (cls === 'variationSelector' && cp >= 0xfe00) vsBytes.push(cp <= 0xfe0f ? cp - 0xfe00 : cp - 0xe0100 + 16);
    return '';
  });
  let nfkcChanged = 0;
  for (const m of stripped.matchAll(NON_ASCII)) {
    const n = m[0].normalize('NFKC');
    if (n !== m[0] && n !== ' ') nfkcChanged++;
  }
  // A variation-selector run carries a message only when it is long.
  const vsText = vsBytes.length >= 8 ? Buffer.from(vsBytes).toString('latin1') : '';
  const hiddenTagText = tagText && vsText ? `${tagText}\n${vsText}` : tagText || vsText;
  return { text: stripped.normalize('NFKC'), tagChars, zeroWidth, explained, nfkcChanged, hiddenTagText };
}
