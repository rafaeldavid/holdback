// Text normalization for intake (threat T2): strip the Unicode tag block and zero-width and bidi
// control characters, then apply NFKC. What was removed is counted, and what the tag characters
// spelled is kept so the screen can read the hidden message.

/** U+E0000–U+E007F. Tags U+E0020–U+E007E mirror printable ASCII. */
const TAG = /[\u{E0000}-\u{E007F}]/gu;
/**
 * Zero-width and invisible formatting characters, plus bidi controls:
 * U+00AD soft hyphen, U+180E Mongolian vowel separator, U+200B–U+200F (ZWSP, ZWNJ, ZWJ, LRM, RLM),
 * U+202A–U+202E (bidi embedding and override), U+2060–U+2064 (word joiner, invisible operators),
 * U+2066–U+2069 (bidi isolates), U+FEFF (BOM / ZWNBSP).
 */
const ZERO_WIDTH = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;

export interface Normalized {
  text: string;
  tagChars: number;
  zeroWidth: number;
  /** The ASCII spelled by tag characters U+E0020–U+E007E, in order. */
  hiddenTagText: string;
}

export function normalizeText(raw: string): Normalized {
  let hiddenTagText = '';
  let tagChars = 0;
  let zeroWidth = 0;
  const stripped = raw
    .replace(TAG, (c) => {
      tagChars++;
      const cp = c.codePointAt(0)! - 0xe0000;
      if (cp >= 0x20 && cp <= 0x7e) hiddenTagText += String.fromCharCode(cp);
      return '';
    })
    .replace(ZERO_WIDTH, () => {
      zeroWidth++;
      return '';
    });
  return { text: stripped.normalize('NFKC'), tagChars, zeroWidth, hiddenTagText };
}
