// Classes of hidden characters (D17). Counted on the raw decoded text for the
// hidden_characters_max check, and shared by normalization and the screen.
//   tag: U+E0000-U+E007F
//   bidi: U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069
//   variationSelector: U+FE00-U+FE0F, U+E0100-U+E01EF, Mongolian U+180B-U+180D and U+180F
//   invisible: other default-ignorable or zero-width characters: U+00AD, U+034F, U+115F, U+1160,
//     U+17B4, U+17B5, U+180E, U+200B-U+200D, U+2060-U+2064, U+206A-U+206F, U+3164, U+FEFF, U+FFA0,
//     U+1D173-U+1D17A
export type HiddenClass = 'tag' | 'bidi' | 'variationSelector' | 'invisible';

export const HIDDEN_GLOBAL =
  /[\u{E0000}-\u{E007F}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u180B-\u180D\u180F\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200D\u2060-\u2064\u206A-\u206F\u3164\uFEFF\uFFA0\u{1D173}-\u{1D17A}]/gu;

export function hiddenClass(cp: number): HiddenClass {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag';
  if (cp === 0x061c || cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi';
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || (cp >= 0x180b && cp <= 0x180d) || cp === 0x180f) return 'variationSelector';
  return 'invisible';
}

export interface HiddenCounts {
  tag: number;
  bidi: number;
  variationSelector: number;
  invisible: number;
  total: number;
}

/** Counts every hidden character in the text, legitimate or not. */
export function countHidden(text: string): HiddenCounts {
  const c: HiddenCounts = { tag: 0, bidi: 0, variationSelector: 0, invisible: 0, total: 0 };
  for (const m of text.matchAll(HIDDEN_GLOBAL)) {
    c[hiddenClass(m[0].codePointAt(0)!)]++;
    c.total++;
  }
  return c;
}
