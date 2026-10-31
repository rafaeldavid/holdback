// <beat>.json: the machine-readable trace. The transcript already holds only strings, integers and booleans.
import type { BeatTranscript } from './types.js';

export const renderJson = (t: BeatTranscript): string => `${JSON.stringify(t, null, 2)}\n`;
