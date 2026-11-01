// Entry point for `pnpm demo`. Output goes to demo/out at the repository root. The environment reaches main()
// for --live only (T-028; the package script loads the git-ignored .env with --env-file-if-exists).
import { fileURLToPath } from 'node:url';
import { main } from './cli.js';

const outDir = fileURLToPath(new URL('../../../demo/out', import.meta.url));

process.exitCode = await main(process.argv.slice(2), {
  outDir,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  ...(process.argv.includes('--live') ? { env: process.env } : {}),
});
