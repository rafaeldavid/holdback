// One judge's prompt and verdict for the transcript. The prompt quotes the agreed terms and a sample of
// the deliverable, and the verdict is model output over both: untrusted. Every line is made plain here (no
// controls, bidi or tag characters); the renderers escape again per surface and keep it inside fences or <pre>.
import type { JudgeVerdict } from '@holdback/core';
import type { PromptView, VerdictView } from './types.js';
import { plain } from '@holdback/testkit';

/** Data lines shown at the head of the data section: the CSV header row and the first rows after it. */
export const DATA_LINES_SHOWN = 9;

/** The template's opening marker line; its nonce names the matching end marker. */
const BEGIN = /^<<<BEGIN UNTRUSTED DATA ([0-9a-f]+)>>>$/;

/**
 * The system message whole; the user message up to the first DATA_LINES_SHOWN data lines, then the last data
 * line and everything from the end marker on. The count of lines left out is kept; nothing is reworded.
 * The end marker must carry the begin marker's nonce, and is searched from the end, so a data line that imitates
 * a marker cannot move the cut.
 */
export function judgePromptView(system: string, user: string): PromptView {
  const lines = user.split(/\r\n|\n/);
  const begin = lines.findIndex((l) => BEGIN.test(l));
  const nonce = begin >= 0 ? BEGIN.exec(lines[begin]!)![1] : undefined;
  const end = nonce === undefined ? -1 : lines.lastIndexOf(`<<<END UNTRUSTED DATA ${nonce}>>>`);
  const headEnd = begin >= 0 ? begin + 1 + DATA_LINES_SHOWN : 30;
  const tailStart = end > 0 ? end - 1 : lines.length;
  const omitted = tailStart - headEnd;
  const [head, tail] = omitted > 0 ? [lines.slice(0, headEnd), lines.slice(tailStart)] : [lines, []];
  return {
    system: system.split(/\r\n|\n/).map(plain),
    user: { head: head.map(plain), omitted: Math.max(0, omitted), tail: tail.map(plain), lines: lines.length },
  };
}

/** A verdict with every string made plain. */
export function verdictView(v: JudgeVerdict): VerdictView {
  return {
    overall: v.overall,
    criteria: v.criteria.map((c) => ({ id: plain(c.id), score: c.score, evidence: plain(c.evidence) })),
    injectionSuspected: v.injectionSuspected,
    ...(v.injectionEvidence === undefined ? {} : { injectionEvidence: plain(v.injectionEvidence) }),
    rationale: plain(v.rationale),
  };
}
