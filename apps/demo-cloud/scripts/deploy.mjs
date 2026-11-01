// `pnpm demo-cloud:deploy`: builds and deploys the public demo to the Cloudflare account wrangler is logged
// in to (wrangler's own OAuth; nothing is read from the repository): holdback-op1 first, since it defines the
// World Durable Object, then holdback-op2, which binds to it. workers.dev only; SimChain only (chain id
// 31337), and the operators' startup guards refuse anything else at run time.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: here('../../../') });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('pnpm', ['-C', here('..'), 'build']);
for (const config of ['wrangler.op1.jsonc', 'wrangler.op2.jsonc']) run('npx', ['-y', 'wrangler@4', 'deploy', '-c', here(`../${config}`)]);
console.log('\nDeployed. Check a deal: node apps/demo-cloud/scripts/deal.ts <op1 URL> <op2 URL>');
