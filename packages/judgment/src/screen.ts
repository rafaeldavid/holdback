// Stage 2, screen v0 (threats T1, T2): heuristics over normalized text that produce signals. Any
// signal flags the delivery, and a flagged delivery can only escalate (aggregate.ts). The classifier
// model call is Phase 3. Signal details never quote the deliverable: the judgment record is published
// before the buyer has paid, so it must not leak the work.
//
// Every pass is linear in the text: fixed patterns with bounded gaps and no nested quantifiers, and
// decoders that each read a run once. Decoded text is screened again, two levels deep.
import type { Judgment, MimeType, ScreenSignalKind } from '@holdback/core';
import { normalizeText } from './normalize.js';
import type { UntrustedData } from './untrusted.js';

export const SCREEN_VERSION = 'screen-0';

export type ScreenResult = Judgment['screen'];
type Signal = { kind: ScreenSignalKind; detail: string };

export interface ScreenInput {
  /** Normalized deliverable text. */
  data: UntrustedData;
  hiddenTagText: UntrustedData;
  removed: { tagChars: number; zeroWidth: number; nfkcChanged?: number };
  /** Enables format-specific signals (CSV formula prefixes). */
  mime?: MimeType;
}

const MAX_SIGNALS = 20;
const MAX_DEPTH = 2;
const MAX_JSON_STRING_CHARS = 10 * 1024 * 1024;

// Fixed patterns, matched against several skeletons of the text (see variants()).
const PHRASES: Array<[string, RegExp]> = [
  ['override', /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,40}?\b(?:instructions?|rubric|rules|criteria|prompt|guidelines|above|previous|prior)\b/],
  ['role-reset', /\byou are now\b/],
  ['new-instructions', /\bnew instructions?\b/],
  ['prompt-probe', /\b(?:system|developer|hidden) prompt\b/],
  ['role-tag', /<\/?\s*(?:system|instructions?|assistant|user|data)\s*>/],
  ['verdict-steer', /\b(?:output|return|respond with|answer|print|mark (?:this|it) as)\b[^\n]{0,30}?\bpass\b/],
  ['score-steer', /\b(?:score|rate|grade)\s+(?:this|it|every|all|each)\b[^\n]{0,30}?\b(?:4|four|max(?:imum)?|perfect|full)\b/],
  ['schema-field', /\binjection ?suspected\b/],
  ['persona', /\bas an? (?:ai|language model)\b/],
  ['addressing', /\b(?:note|message|instructions?|attention|memo|notice) (?:to|for) (?:the |all |any )?(?:[a-z]+ )?(?:panel|judges?|evaluators?|graders?|models?|reviewers?|assistants?|ai|llms?)\b/],
  ['judge-note', /\b(?:judge|evaluator|grader|reviewer|panel|model|assistant|ai|llm)s? (?:note|notice|instruction|message|directive)s?\b/],
  ['verdict-claim', /\b(?:correct|only|right) (?:overall )?verdict\b|\boverall verdict is\b|\b(?:top|full|maximum|perfect) (?:marks|scores?)\b|\bpre ?approved\b|\bcriteria (?:are |were )?(?:all |fully )?(?:met|satisfied)\b/],
];

// UTS #39 confusables, the Cyrillic and Greek letters that look Latin (subset).
const CONFUSABLE: Record<string, string> = {
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x',
  '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd', '\u04BB': 'h', '\u04CF': 'l', '\u051B': 'q', '\u051D': 'w',
  '\u043A': 'k', '\u043C': 'm', '\u043D': 'h', '\u0442': 't', '\u044C': 'b', '\u0457': 'i', '\u0491': 'r',
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041A': 'K', '\u041C': 'M', '\u041D': 'H', '\u041E': 'O', '\u0420': 'P',
  '\u0421': 'C', '\u0422': 'T', '\u0425': 'X', '\u0406': 'I', '\u0408': 'J', '\u0405': 'S', '\u04AE': 'Y', '\u0417': '3',
  '\u03B1': 'a', '\u03BF': 'o', '\u03C1': 'p', '\u03BD': 'v', '\u03C4': 't', '\u03B9': 'i', '\u03BA': 'k', '\u03C7': 'x',
  '\u03C5': 'u', '\u03B5': 'e', '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': 'I',
  '\u039A': 'K', '\u039C': 'M', '\u039D': 'N', '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T', '\u03A5': 'Y', '\u03A7': 'X',
  '\u0131': 'i', '\u2113': 'l',
};
const CONFUSABLE_RE = /[\u0391-\u03C9\u0400-\u052F\u0131\u2113]/g;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

/** Folds obfuscation so the phrase patterns see plain lowercase words separated by single spaces. */
function skeleton(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c] ?? c)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    // Keep a wide gap as a double space so spaced-out letters can be rejoined word by word.
    .replace(/[^a-z0-9<>/]+/g, (m) => (/\s\s/.test(m) ? '  ' : ' '));
}

/** Rejoins words written as single letters separated by spaces ("i g n o r e"); gaps are double spaces. */
function collapseSpaced(sk: string): string {
  return sk
    .split('  ')
    .map((segment) => {
      const out: string[] = [];
      let letters: string[] = [];
      const flush = () => {
        if (letters.length >= 3) out.push(letters.join(''));
        else out.push(...letters);
        letters = [];
      };
      for (const t of segment.split(' ')) {
        if (t.length === 1 && t >= 'a' && t <= 'z') letters.push(t);
        else {
          flush();
          out.push(t);
        }
      }
      flush();
      return out.join(' ');
    })
    .join(' ');
}

const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

/** The texts the phrase patterns are matched against. */
function variants(text: string): string[] {
  const sk = skeleton(text);
  const collapsed = collapseSpaced(sk);
  const single = sk.replace(/  +/g, ' ');
  const leet = single.replace(/[a-z0-9]+/g, (t) => (/[a-z]/.test(t) && /[0-9]/.test(t) ? t.replace(/[0-9]/g, (d) => LEET[d] ?? d) : t));
  return [text.toLowerCase(), single, collapsed, leet, rot13(single), [...single].reverse().join('')];
}

function phraseIds(text: string): string[] {
  if (!text) return [];
  const vs = variants(text);
  return PHRASES.filter(([, re]) => vs.some((v) => re.test(v))).map(([id]) => id);
}

const PRINTABLE = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
/** Text if the bytes are mostly printable ASCII with some letters; random bytes never are. */
function printableText(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  let printable = 0;
  let letters = 0;
  for (const b of bytes) {
    if (PRINTABLE(b)) printable++;
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) letters++;
  }
  return printable / bytes.length >= 0.95 && letters >= 6 ? Buffer.from(bytes).toString('latin1') : undefined;
}

// Run patterns are single character classes with a bounded length. V8 overflows its stack on
// quantified groups and on open-ended counted loops ({n,}) over a multi-megabyte run; bounded
// classes are iterative. A longer run is read as consecutive 4096-character chunks, which stay
// aligned for base64 (4096 = 4 x 1024) and hex. Decoders check the structure of each run.
const B64_TOKEN = /[A-Za-z0-9+/_=-]{16,4096}/g;
const B64_JOINED = /[A-Za-z0-9+/_=,;| \t-]{24,4096}/g;
const HEX_RUN = /[0-9a-fA-F]{24,4096}/g;
const PERCENT_RUN = /[A-Za-z0-9._~!*'()%-]{12,4096}/g;
const MORSE_RUN = /[.\- /]{15,4096}/g;
const MORSE: Record<string, string> = {
  '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e', '..-.': 'f', '--.': 'g', '....': 'h', '..': 'i', '.---': 'j',
  '-.-': 'k', '.-..': 'l', '--': 'm', '-.': 'n', '---': 'o', '.--.': 'p', '--.-': 'q', '.-.': 'r', '...': 's', '-': 't',
  '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x', '-.--': 'y', '--..': 'z', '-----': '0', '.----': '1', '..---': '2',
  '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
};

const decodeB64 = (run: string) => printableText(new Uint8Array(Buffer.from(run, /[-_]/.test(run) ? 'base64url' : 'base64')));
/** Joined chunks: only when every chunk is at least 4 characters, as base64 split into pieces is. */
function decodeJoined(run: string): string | undefined {
  const chunks = run.split(/[,;| \t]+/).filter(Boolean);
  if (chunks.length < 2 || chunks.some((c) => c.length < 4)) return undefined;
  return decodeB64(chunks.join(''));
}
const decodeHex = (run: string) => printableText(new Uint8Array(Buffer.from(run.length % 2 ? run.slice(0, -1) : run, 'hex')));
function decodePercent(run: string): string | undefined {
  if ((run.match(/%/g)?.length ?? 0) < 4) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i < run.length; i++) {
    if (run[i] === '%' && /^[0-9a-fA-F]{2}$/.test(run.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(run.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(run.charCodeAt(i));
  }
  return printableText(new Uint8Array(bytes));
}
function decodeMorse(run: string): string | undefined {
  const tokens = run.split(/[ /]+/).filter(Boolean);
  if (tokens.length < 8 || tokens.some((t) => t.length > 7)) return undefined;
  let unknown = 0;
  let letters = 0;
  const words = run.trim().split(/\s*\/\s*|\s\s\s+/).map((w) =>
    w.split(/\s+/).filter(Boolean).map((code) => {
      const c = MORSE[code];
      if (c === undefined) unknown++;
      else letters++;
      return c ?? '?';
    }).join(''),
  );
  return letters >= 6 && unknown * 10 <= letters ? words.join(' ') : undefined;
}
/** Morse written with middle dots, bullets, underscores, dashes or pipes, mapped to . - and /. */
const morseView = (text: string) => text.replace(/[\u00B7\u2022\u2219\u22C5\u2027]/g, '.').replace(/[_\u2212\u2013\u2014\u2012]/g, '-').replace(/\|/g, '/');

const DECODERS: Array<[string, RegExp, (run: string) => string | undefined, (t: string) => string]> = [
  ['base64', B64_TOKEN, decodeB64, (t) => t],
  ['joined base64', B64_JOINED, decodeJoined, (t) => t],
  ['hex', HEX_RUN, decodeHex, (t) => t],
  ['percent-encoded', PERCENT_RUN, decodePercent, (t) => t],
  ['Morse', MORSE_RUN, decodeMorse, morseView],
];

/** Line numbers for increasing indices in one pass over the text (matchAll yields indices in order). */
function lineCounter(text: string): (index: number) => number {
  let at = 0;
  let line = 1;
  return (index) => {
    for (; at < index; at++) if (text.charCodeAt(at) === 10) line++;
    return line;
  };
}

class Signals {
  readonly list: Signal[] = [];
  private readonly seen = new Set<string>();
  get full(): boolean {
    return this.list.length >= MAX_SIGNALS;
  }
  add(kind: ScreenSignalKind, detail: string): void {
    const d = detail.length > 300 ? `${detail.slice(0, 297)}...` : detail;
    if (this.full || this.seen.has(`${kind}:${d}`)) return;
    this.seen.add(`${kind}:${d}`);
    this.list.push({ kind, detail: d });
  }
}

function mixedScriptWords(text: string): number {
  let n = 0;
  // Bounded: an open-ended Unicode-mode loop overflows V8's stack on a multi-megabyte word.
  for (const m of text.matchAll(/\p{L}{1,256}/gu)) {
    if (/\p{Script=Latin}/u.test(m[0]) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(m[0])) n++;
  }
  return n;
}

/** Runs a screen pass; a pass that throws flags the delivery instead of crashing the pipeline. */
function guarded(out: Signals, where: string, pass: () => void): void {
  try {
    pass();
  } catch {
    out.add('encoded_run', `a screen pass could not finish on ${where}`);
  }
}

/** Phrases, mixed-script words and decodable runs in one view of the text. */
function scanView(text: string, where: string, out: Signals, depth: number): void {
  guarded(out, where, () => scanViewUnguarded(text, where, out, depth));
}

function scanViewUnguarded(text: string, where: string, out: Signals, depth: number): void {
  if (!text || out.full) return;
  const ids = phraseIds(text);
  if (ids.length) out.add('instruction_phrase', `in ${where}: ${ids.join(', ')}`);
  const mixed = mixedScriptWords(text);
  if (mixed) out.add('encoded_run', `${mixed} mixed-script words (Latin with Cyrillic or Greek) in ${where}`);
  if (depth >= MAX_DEPTH) return;
  for (const [name, re, decode, view] of DECODERS) {
    const t = view(text);
    const lineOf = lineCounter(t);
    for (const m of t.matchAll(re)) {
      if (out.full) return;
      // Failed decodes cost nothing against the signal cap, so padding cannot hide a later run.
      const decoded = decode(m[0]);
      if (decoded === undefined) continue;
      const line = lineOf(m.index);
      out.add('encoded_run', `decodable ${name} run of ${m[0].length} characters at line ${line} of ${where}`);
      scanView(decoded, `decoded ${name} at line ${line} of ${where}`, out, depth + 1);
    }
  }
}

/** Screens a view that needs its own normalization (unescaped or parsed text). */
function scanDerived(text: string, where: string, out: Signals): void {
  const n = normalizeText(text);
  if (n.tagChars) out.add('unicode_tags', `${n.tagChars} Unicode tag characters in ${where}`);
  if (n.zeroWidth) out.add('zero_width', `${n.zeroWidth} zero-width or invisible characters in ${where}`);
  if (n.nfkcChanged) out.add('encoded_run', `${n.nfkcChanged} characters changed by NFKC in ${where}`);
  scanView(n.hiddenTagText, `hidden characters in ${where}`, out, MAX_DEPTH);
  scanView(n.text, where, out, 1);
}

/** All string keys and values of a parsed JSON document, iteratively (no recursion on hostile depth). */
function jsonStrings(text: string): string | undefined {
  const head = text.trimStart()[0];
  if (head !== '{' && head !== '[') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parts: string[] = [];
  let size = 0;
  const stack: unknown[] = [value];
  while (stack.length && size < MAX_JSON_STRING_CHARS) {
    const v = stack.pop();
    if (typeof v === 'string') {
      parts.push(v);
      size += v.length;
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    } else if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v);
      for (let i = entries.length - 1; i >= 0; i--) stack.push(entries[i]![1], entries[i]![0]);
    }
  }
  return parts.join('\n');
}

const UNICODE_ESCAPE = /\\u([0-9a-fA-F]{4})/g;
// A cell that starts a spreadsheet formula: = or @, or + or - followed by a formula start.
const FORMULA_CELL = /(?:^|,)"?(?:[=@][^,\n]|[+-][=@(A-Za-z])/m;

export function screen(input: ScreenInput): ScreenResult {
  const text = input.data.reveal();
  const out = new Signals();
  const { tagChars, zeroWidth } = input.removed;
  const nfkcChanged = input.removed.nfkcChanged ?? 0;

  if (tagChars > 0) out.add('unicode_tags', `${tagChars} Unicode tag characters removed`);
  if (zeroWidth > 0) out.add('zero_width', `${zeroWidth} zero-width or bidi control characters removed`);
  if (nfkcChanged > 0) out.add('encoded_run', `${nfkcChanged} characters changed by NFKC (fullwidth, compatibility or ligature forms)`);

  scanView(input.hiddenTagText.reveal(), 'Unicode tag or variation-selector characters', out, MAX_DEPTH);
  scanView(text, 'text', out, 0);
  if (input.mime === 'text/csv' && FORMULA_CELL.test(text)) out.add('instruction_phrase', 'a CSV cell starts with a spreadsheet formula prefix');

  // Escapes are decoded after intake normalization, so screen the decoded text separately: a JSON
  // document through its parsed string values (exact), any other text through its \\u escapes.
  guarded(out, 'decoded escapes', () => {
    const strings = jsonStrings(text);
    if (strings !== undefined) scanDerived(strings, 'JSON string values', out);
    else if (UNICODE_ESCAPE.test(text)) {
      UNICODE_ESCAPE.lastIndex = 0;
      scanDerived(text.replace(UNICODE_ESCAPE, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16))), 'text with \\u escapes decoded', out);
    }
  });

  return { flagged: out.list.length > 0, signals: out.list };
}

/**
 * Screens party-written terms (description, criteria, anchors). They sit in the judges' system
 * prompt, so hidden characters in them are flagged here (validateTerms offers the same check to an agent before it signs).
 */
export function screenTerms(texts: readonly string[]): Signal[] {
  const out = new Signals();
  for (const t of texts) {
    const n = normalizeText(t);
    if (n.tagChars) out.add('unicode_tags', `${n.tagChars} Unicode tag characters in the agreed terms`);
    if (n.zeroWidth) out.add('zero_width', `${n.zeroWidth} zero-width or invisible characters in the agreed terms`);
    scanView(n.hiddenTagText, 'hidden characters in the agreed terms', out, MAX_DEPTH);
    const mixed = mixedScriptWords(n.text);
    if (mixed) out.add('encoded_run', `${mixed} mixed-script words in the agreed terms`);
  }
  return out.list;
}

/** Offer-time validation of party-written text. Returns reasons to refuse; empty means acceptable. */
export function validateTermsText(texts: ReadonlyArray<readonly [string, string]>): string[] {
  const reasons: string[] = [];
  for (const [where, t] of texts) {
    const n = normalizeText(t);
    if (n.tagChars + n.zeroWidth > 0) reasons.push(`${where} contains tag, zero-width, bidi or other invisible characters`);
    if (mixedScriptWords(t.normalize('NFKC'))) reasons.push(`${where} contains mixed-script words`);
  }
  return reasons;
}
