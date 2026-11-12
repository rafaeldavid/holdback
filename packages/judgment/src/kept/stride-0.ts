// FROZEN: the even-stride sampler screen-0 reads a long delivery with, as released before PR 386 (commit 00be274,
// packages/judgment/src/prompt.ts, `sample` and the stride note in `buildPrompt`). ADR-0036 section 1: `screenVersion`
// covers everything between the delivered bytes and the prompt, the sampling included, so this is part of screen-0
// and never changes under that label. Only its packaging as a StrideSampler differs from that commit.
import type { StrideSampler } from '../prompt.js';

/** Header plus lines at an even stride across the whole deliverable, within the budget. */
function sample(lines: string[], max: number): string[] {
  const out = [lines[0]!];
  let used = lines[0]!.length + 1;
  const rest = lines.length - 1;
  if (rest <= 0) return out;
  const avg = Math.max(1, Math.ceil((lines.slice(1).reduce((n, l) => n + l.length + 1, 0)) / rest));
  const take = Math.max(1, Math.min(rest, Math.floor((max - used) / avg)));
  for (let k = 0; k < take; k++) {
    const line = lines[1 + Math.floor((k * rest) / take)]!;
    if (used + line.length + 1 > max && out.length > 1) break;
    out.push(line);
    used += line.length + 1;
  }
  return out;
}

export const strideSample0: StrideSampler = (all, max) => {
  const total = all.length;
  const lines = sample(all, max);
  return { lines, note: `The data section holds the first line and ${lines.length - 1} of ${total - 1} further lines, sampled at even intervals.` };
};
