// The source `pnpm demo` uses: every beat measured on SimChain through the scripted agents (T-018 removed
// the scripted stand-in). Beat 6's appeal verdicts are scripted, and its transcript says so.
import type { EventSource } from '../transcript/types.js';
import { simchainSource } from './simchain.js';

export const demoSource = (): EventSource => simchainSource();
