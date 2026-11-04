// `pnpm -C apps/test-agents deploy` (T-222, D47): deploys crow-test-agents, Crow's test seller, to the Cloudflare
// account wrangler is logged in to (wrangler's own OAuth; nothing is read from the repository). Deploys wait for Rafa.
// The first deploy, in order (docs/operations.md, "Crow's test seller"):
//   1. this script, which deploys the Worker and its route on escrow.stream/agents/test-seller*;
//   2. node apps/test-agents/scripts/seed.mjs, which sets TEST_AGENTS_SEED and prints the intake key;
//   3. check https://escrow.stream/agents/test-seller/health, then run one deal with --seller;
//   4. only then publish the site, whose one command names the test seller.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const r = spawnSync('npx', ['-y', 'wrangler@4', 'deploy', '-c', here('../wrangler.jsonc'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: here('../../../') });
if (r.status !== 0) process.exit(r.status ?? 1);
if (!process.argv.includes('--dry-run')) console.log('\nDeployed crow-test-agents. Check: curl -s https://escrow.stream/agents/test-seller/health');
