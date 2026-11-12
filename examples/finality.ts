// When a settled deal is final, in the words try.ts closes with (T-390 part 3): true of the world it ran on. Phase
// one's terms have no appeal window, so the decision is final; the full protocol's terms may have one.

/** The finality clause for terms whose appeal window is `appealWindowSec` seconds and whose appeal deadline is `appealBy`. */
export function finality(appealWindowSec: string | number | undefined, appealBy?: string): string {
  const window = Number(appealWindowSec ?? 0);
  if (window === 0) return 'final at the decision, since the terms have no appeal window';
  return `final at ${appealBy ?? 'the end of the appeal window'}, when the ${window} s appeal window closes, with nobody needing to act`;
}
