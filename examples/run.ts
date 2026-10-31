// pnpm example <name>: runs examples/<name>.ts against a sim. It uses the sim at HOLDBACK_SIM_URL (default
// http://127.0.0.1:8780) when one is running (`pnpm sim`), and otherwise starts one in this process for the
// run and stops it afterwards. The examples themselves talk HTTP only.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSimWorld, type SimWorld } from '@holdback/operator';

export const EXAMPLES = ['buy-dataset', 'sell-translation'] as const;

const name = process.argv[2] ?? '';
if (!(EXAMPLES as readonly string[]).includes(name)) {
  console.error(`usage: pnpm example <${EXAMPLES.join(' | ')}>`);
  process.exit(2);
}

let url = process.env['HOLDBACK_SIM_URL'] ?? 'http://127.0.0.1:8780';
let world: SimWorld | undefined;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (((await res.json()) as { kind?: string }).kind !== 'holdback-sim') throw new Error('not a sim');
} catch {
  world = await startSimWorld({ env: process.env, onError: (e) => console.error(`  (sim) ${e.message}`) });
  console.log(`No sim at ${url}; started one in this process for the run (${world.url}).\n`);
  url = world.url;
}

// Runs the source as written (Node strips the types), or its compiled twin when this file is compiled.
const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const child = spawn(process.execPath, [fileURLToPath(new URL(`./${name}${ext}`, import.meta.url))], { stdio: 'inherit', env: { ...process.env, HOLDBACK_SIM_URL: url } });
const code = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
await world?.close();
process.exit(code);
