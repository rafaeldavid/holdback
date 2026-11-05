#!/usr/bin/env node
// The cost collector's launcher (T-052). Rafa runs it only in the dedicated clone, with node and never pnpm (a
// package.json hook would run outside the approval):
//
//   node scripts/costs/collect.mjs
//
// It imports nothing but node: modules and the approval check, and runs that check first. Only then does it load
// the keys from `.env.costs` at the clone's root and import the collector (run.mjs) and its sources. So a cost
// module changed since Rafa's approval never runs, not even its top level, and never with a key loaded. The one
// exception is a change to this launcher or the check itself, which no check can catch: docs/costs.md
// ("Running the collector") says how the clone is updated so that never goes unread.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalRefused, checkApproved, cloneRootOf } from './approved.mjs';

export const KEYS_FILE = '.env.costs';

async function main() {
  const root = cloneRootOf(dirname(fileURLToPath(import.meta.url)));
  checkApproved(root);
  const keys = join(root, KEYS_FILE);
  if (existsSync(keys)) process.loadEnvFile(keys);
  const { collect, isRefusal } = await import('./run.mjs');
  try {
    await collect({ env: process.env, cloneRoot: root });
  } catch (e) {
    if (isRefusal(e)) throw e;
    throw new Error('unexpected');
  }
}

main().then(
  // Exit once the files are written, even if a timed-out source is still reading.
  () => process.exit(0),
  (e) => {
    console.error(e instanceof ApprovalRefused || e?.name === 'DirRefused' || e?.name === 'ConfigRefused' ? `refused: ${e.message}` : 'failed: unexpected error');
    process.exit(1);
  },
);
