// `pnpm demo-cloud:deploy`: builds and deploys the public demo to the Cloudflare account wrangler is logged
// in to (wrangler's own OAuth; nothing is read from the repository): holdback-op1 first, since it defines the
// World Durable Object, then holdback-op2, which binds to it. Test networks only: each wrangler file's SETTLEMENT
// picks SimChain (chain id 31337) or Ethereum Sepolia (11155111, D41), and the startup guards refuse anything else at
// run time. A cutover deploys the Workers one at a time instead (docs/operations.md, Settlement).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: here('../../../') });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
// T-066: each Worker publishes the commit it was built from (discovery's demo.build.commit), so Crow Control can list
// what is merged but not live without a Cloudflare token. A tree with uncommitted changes deploys with no commit.
const git = (args) => spawnSync('git', ['-C', here('../../../'), ...args], { encoding: 'utf8' });
const head = git(['rev-parse', 'HEAD']).stdout?.trim() ?? '';
const clean = git(['status', '--porcelain', '--untracked-files=no']).stdout?.trim() === '';
const commit = /^[0-9a-f]{40}$/.test(head) && clean ? head : '';
if (!commit) console.log('BUILD_COMMIT: the working tree has uncommitted changes, so discovery will name no commit');
run('pnpm', ['-C', here('..'), 'build']);
for (const config of ['wrangler.op1.jsonc', 'wrangler.op2.jsonc']) {
  run('npx', ['-y', 'wrangler@4', 'deploy', '-c', here(`../${config}`), ...(commit ? ['--var', `BUILD_COMMIT:${commit}`] : [])]);
}
console.log('\nDeployed. Check a deal: node apps/demo-cloud/scripts/deal.ts <op1 URL> <op2 URL>');
