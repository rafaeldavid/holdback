// <beat>.json: the machine-readable trace. The transcript holds only strings, integers and booleans; invisible
// and control characters (possible in deliverable-derived text) are written as \u escapes.
import type { BeatTranscript } from './types.js';
import { safeJson } from '@holdback/testkit';

export const renderJson = (t: BeatTranscript): string => `${safeJson(t)}\n`;
