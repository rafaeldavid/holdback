// `pnpm demo-cloud:dev`: builds the Workers and runs both locally with wrangler dev, holdback-op1 (with the
// World Durable Object) on :8787 and holdback-op2 (bound to it through wrangler's dev registry) on :8788.
// `pnpm demo-cloud:e2e` (--deal) does the same, runs scripts/deal.ts against both, and stops: the end-to-end
// test of the Workers runtime. MIN_WINDOW_SEC overrides the demo club's minimum window (default 60).
// Both local nodes run on SimChain (chain id 31337), whatever the wrangler files name for the deployed ones: the
// Sepolia world needs the relayer secret, and scripts/deal.ts refuses any chain but SimChain (T-313).
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = here('../../../');
const runDeal = process.argv.includes('--deal');
const window = process.env.MIN_WINDOW_SEC ?? '60';

const build = spawnSync('pnpm', ['-C', here('..'), 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

// The e2e run starts from an empty world in its own state directory; plain dev keeps wrangler's default one.
const persist = runDeal ? ['--persist-to', here(`../.wrangler/e2e-${Date.now()}`)] : [];
// The deployed nodes name their public addresses (OPERATOR_URLS, read from holdback-op1's environment); locally the
// list is empty, so each node answers with its own local address (http is allowed only here).
const nodes = [
  { config: here('../wrangler.op1.jsonc'), port: 8787, inspector: 9331, vars: ['--var', 'SETTLEMENT:sim', '--var', 'OPERATOR_URLS:', '--var', `MIN_WINDOW_SEC:${window}`, ...persist] },
  { config: here('../wrangler.op2.jsonc'), port: 8788, inspector: 9332, vars: ['--var', 'SETTLEMENT:sim'] },
];
const children = [];
const ready = [];
for (const n of nodes) {
  // --local-upstream: without it wrangler dev hands the Worker the route's host (api.crow.direct), so each node
  // would publish production URLs (apiBaseUrl, ciphertext URIs, llms.txt links) while serving locally.
  const local = ['--local-upstream', `127.0.0.1:${n.port}`, '--local-protocol', 'http'];
  const child = spawn('npx', ['-y', 'wrangler@4', 'dev', '-c', n.config, '--ip', '127.0.0.1', '--port', String(n.port), '--inspector-port', String(n.inspector), ...local, '--show-interactive-dev-session=false', ...n.vars], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  ready.push(
    new Promise((resolve, reject) => {
      const onData = (d) => {
        const text = d.toString();
        if (!runDeal) process.stdout.write(text);
        if (text.includes('Ready on')) resolve();
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', (d) => process.stderr.write(d));
      child.on('exit', (code) => reject(new Error(`wrangler dev for ${n.config} exited with ${code}`)));
    }),
  );
  await ready.at(-1); // op1 first, so op2 finds its Durable Object in the dev registry
}
const urls = nodes.map((n) => `http://127.0.0.1:${n.port}`);
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('SIGINT', () => (stop(), process.exit(0)));
process.on('SIGTERM', () => (stop(), process.exit(0)));

if (!runDeal) {
  console.log(`\nHoldback public demo, locally:\n  operator 1  ${urls[0]}\n  operator 2  ${urls[1]}\nRun a deal: node apps/demo-cloud/scripts/deal.ts ${urls.join(' ')}\nCtrl-C stops both.`);
} else {
  const deal = spawn(process.execPath, [here('./deal.ts'), ...urls], { cwd: root, stdio: 'inherit' });
  const code = await new Promise((resolve) => deal.on('exit', (c) => resolve(c ?? 1)));
  stop();
  process.exit(code);
}
