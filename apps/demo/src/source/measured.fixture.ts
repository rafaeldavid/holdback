// Test helper: transcripts measured on SimChain, run once per test file and shared by its tests. Replaces the
// scripted stand-in the renderer and narration tests used as a fast fixture (T-018 deleted it).
import type { BeatTranscript, EventSource } from '../transcript/types.js';
import { simchainSource } from './simchain.js';

const source = simchainSource();
const cache = new Map<number, Promise<BeatTranscript>>();

/** One beat's measured transcript, memoized. */
export function measured(beat: number): Promise<BeatTranscript> {
  let t = cache.get(beat);
  if (!t) {
    t = source.run(beat);
    cache.set(beat, t);
  }
  return t;
}

/** Every beat, in order. Beats run one after another: each starts its own operators on SimChain. */
export async function allMeasured(): Promise<BeatTranscript[]> {
  const out: BeatTranscript[] = [];
  for (const b of source.beats()) out.push(await measured(b));
  return out;
}

/** The SimChain source behind the cache, for tests that need an EventSource. */
export const measuredSource = (): EventSource => ({ name: source.name, beats: () => source.beats(), run: measured });
