// Stage 2, screen v0 (threats T1, T2): heuristics over normalized text that produce signals. Any
// signal flags the delivery, and a flagged delivery can only escalate (aggregate.ts). The classifier
// model call is Phase 3. Signal details never quote the deliverable: the judgment record is published
// before the buyer has paid, so it must not leak the work.
import type { Judgment, ScreenSignalKind } from '@holdback/core';
import type { UntrustedData } from './untrusted.js';

export const SCREEN_VERSION = 'screen-0';

export type ScreenResult = Judgment['screen'];
type Signal = { kind: ScreenSignalKind; detail: string };

export interface ScreenInput {
  data: UntrustedData;
  hiddenTagText: UntrustedData;
  removed: { tagChars: number; zeroWidth: number };
}

// Fixed patterns over lowercased text. Each is linear: bounded gaps, no nested quantifiers, and no
// gap crosses a line break.
const PHRASES: Array<[string, RegExp]> = [
  ['override', /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,40}?\b(?:instructions?|rubric|rules|criteria|prompt|guidelines|above|previous|prior)\b/],
  ['role-reset', /\byou are now\b/],
  ['new-instructions', /\bnew instructions?\b/],
  ['prompt-probe', /\b(?:system|developer|hidden) prompt\b/],
  ['role-tag', /<\/?\s*(?:system|instructions?|assistant|user|data)\s*>/],
  ['verdict-steer', /\b(?:output|return|respond with|answer|print|mark (?:this|it) as)\b[^\n]{0,30}?\bpass\b/],
  ['score-steer', /\b(?:score|rate|grade)\s+(?:this|it|every|all|each)\b[^\n]{0,30}?\b(?:4|four|max(?:imum)?|perfect|full)\b/],
  ['schema-field', /\binjectionsuspected\b/],
  ['persona', /\bas an? (?:ai|language model)\b/],
];

const MAX_RUNS = 1000;
const B64_RUN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
const MORSE_RUN = /[.-]{1,7}(?:[ /]+[.-]{1,7}){7,}/g;
const MORSE: Record<string, string> = {
  '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e', '..-.': 'f', '--.': 'g', '....': 'h', '..': 'i', '.---': 'j',
  '-.-': 'k', '.-..': 'l', '--': 'm', '-.': 'n', '---': 'o', '.--.': 'p', '--.-': 'q', '.-.': 'r', '...': 's', '-': 't',
  '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x', '-.--': 'y', '--..': 'z', '-----': '0', '.----': '1', '..---': '2',
  '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
};

function phraseIds(text: string): string[] {
  const lower = text.toLowerCase();
  return PHRASES.filter(([, re]) => re.test(lower)).map(([id]) => id);
}

/** Line numbers for increasing indices in one pass over the text (matchAll yields indices in order). */
function lineCounter(text: string): (index: number) => number {
  let at = 0;
  let line = 1;
  return (index) => {
    for (; at < index; at++) if (text.charCodeAt(at) === 10) line++;
    return line;
  };
}

/** Decoded text if the run is base64 or base64url for mostly printable text with spaces. */
function decodeBase64(run: string): string | undefined {
  const bytes = Buffer.from(run, /[-_]/.test(run) ? 'base64url' : 'base64');
  if (bytes.length < 16) return undefined;
  let printable = 0;
  for (const b of bytes) if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  const text = bytes.toString('latin1');
  return printable / bytes.length >= 0.95 && text.includes(' ') ? text : undefined;
}

function decodeMorse(run: string): string | undefined {
  let unknown = 0;
  let letters = 0;
  const words = run.trim().split(/\s*\/\s*|\s{3,}/).map((w) =>
    w.split(/\s+/).filter(Boolean).map((code) => {
      const c = MORSE[code];
      if (c === undefined) unknown++;
      else letters++;
      return c ?? '?';
    }).join(''),
  );
  return letters >= 6 && unknown * 10 <= letters ? words.join(' ') : undefined;
}

export function screen(input: ScreenInput): ScreenResult {
  const text = input.data.reveal();
  const signals: Signal[] = [];
  const { tagChars, zeroWidth } = input.removed;

  if (tagChars > 0) signals.push({ kind: 'unicode_tags', detail: `${tagChars} Unicode tag characters removed` });
  if (zeroWidth > 0) signals.push({ kind: 'zero_width', detail: `${zeroWidth} zero-width or bidi control characters removed` });

  const hidden = phraseIds(input.hiddenTagText.reveal());
  if (hidden.length) signals.push({ kind: 'instruction_phrase', detail: `in Unicode tag characters: ${hidden.join(', ')}` });

  const plain = phraseIds(text);
  if (plain.length) signals.push({ kind: 'instruction_phrase', detail: `in text: ${plain.join(', ')}` });

  const decoders: Array<[string, RegExp, (run: string) => string | undefined]> = [
    ['base64', B64_RUN, decodeBase64],
    ['Morse', MORSE_RUN, decodeMorse],
  ];
  for (const [name, re, decode] of decoders) {
    let runs = 0;
    const lineOf = lineCounter(text);
    for (const m of text.matchAll(re)) {
      if (++runs > MAX_RUNS) break;
      const decoded = decode(m[0]);
      if (decoded === undefined) continue;
      const line = lineOf(m.index);
      signals.push({ kind: 'encoded_run', detail: `decodable ${name} run of ${m[0].length} characters at line ${line}` });
      const ids = phraseIds(decoded);
      if (ids.length) signals.push({ kind: 'instruction_phrase', detail: `in decoded ${name} at line ${line}: ${ids.join(', ')}` });
      if (signals.length >= 20) break;
    }
  }

  return { flagged: signals.length > 0, signals: signals.slice(0, 20) };
}
