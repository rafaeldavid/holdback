// `pnpm demo-cloud:deploy`: deploys the public demo's two operator Workers and checks them with one test deal
// (T-234), so a deploy needs no hand checklist:
//   1. pre-flight (T-313, scripts/deploy-lib.mjs): refuse, with exit code 2, a checkout whose tracked files differ
//      from its commit, or one that lacks origin/main's commits after a fresh fetch (it could drop the custom domains);
//   2. build;
//   3. read each Worker's live version: its rollback target;
//   4. deploy holdback-op1 (it defines the World Durable Object), then holdback-op2; a refused upload stops here;
//   5. wait until /v1/status answers 200 on both nodes;
//   6. one examples/try.ts deal against both operators must end Released within 180 s;
//   7. when a step after an upload fails, roll back each Worker whose live version changed, and exit 1;
//   8. print one Markdown record line for docs/operations.md, with the commit and its branch.
// Wrangler uses the Cloudflare login of whoever runs it (its own OAuth; nothing is read from the repository). Test
// networks only: each wrangler file's SETTLEMENT picks SimChain (chain id 31337) or Ethereum Sepolia (11155111, D41),
// and the startup guards refuse anything else at run time. A cutover deploys the Workers one at a time instead
// (docs/operations.md, Settlement).
import { fileURLToPath } from 'node:url';
import { checkout, liveVersion, recordLine, rollback, sh } from '../../../scripts/deploy-lib.mjs';

const NODES = ['https://api.crow.direct', 'https://api2.crow.direct'];
const WORKERS = [
  { name: 'holdback-op1', config: 'wrangler.op1.jsonc' },
  { name: 'holdback-op2', config: 'wrangler.op2.jsonc' },
];
const STATUS_TIMEOUT_MS = 300_000;
const SMOKE_TIMEOUT_MS = 180_000;

if (process.argv.length > 2) {
  console.error(`Refused: pnpm demo-cloud:deploy takes no arguments (got ${process.argv.slice(2).join(' ')}), and it deploys for real.`);
  process.exit(2);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (why) => {
  throw new Error(why);
};
const { refused, branch, commit } = await checkout('pnpm demo-cloud:deploy');
if (refused) {
  console.error(refused);
  process.exit(2);
}

const startedAt = new Date();
let uploaded = false, failure = null, smoke = null;

try {
  if ((await sh('pnpm', ['-C', here('..'), 'build'])).code !== 0) fail('the build failed');
  for (const w of WORKERS) w.before = (await liveVersion(w.name)) ?? fail(`wrangler cannot read ${w.name}'s live version (is it logged in?)`);
  for (const w of WORKERS) {
    uploaded = true;
    // T-066: discovery's demo.build.commit names the commit each Worker runs, so Crow Control can tell what is
    // merged but not live. The pre-flight above refused a changed tree, so `commit` is what was built.
    const r = await sh('npx', ['-y', 'wrangler@4', 'deploy', '-c', here(`../${w.config}`), ...(/^[0-9a-f]{40}$/.test(commit) ? ['--var', `BUILD_COMMIT:${commit}`] : [])]);
    w.version = /Current Version ID:\s*([0-9a-f-]{36})/.exec(r.out)?.[1];
    if (r.code !== 0 || !w.version) fail(`${w.name}'s upload was refused`);
  }
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  for (const node of NODES) {
    while ((await fetch(`${node}/v1/status`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.status, () => 0)) !== 200) {
      if (Date.now() > deadline) fail(`${node}/v1/status did not answer 200 within ${STATUS_TIMEOUT_MS / 1000} s`);
      await sleep(5000);
    }
  }
  const t0 = Date.now();
  const r = await sh(process.execPath, ['examples/try.ts'], { env: { HOLDBACK_OPERATORS: NODES.join(',') }, timeoutMs: SMOKE_TIMEOUT_MS });
  const last = /^done\s+commitment (0x[0-9a-f]{64}) (\w+)/m.exec(r.out);
  smoke = { id: last?.[1], state: last?.[2], seconds: Math.round((Date.now() - t0) / 1000) };
  if (r.code !== 0 || smoke.state !== 'Released') { console.error(`\nthe smoke deal's output (exit ${r.code}):\n${String(r.out).slice(-6000)}`); fail(`the smoke deal did not end Released within ${SMOKE_TIMEOUT_MS / 1000} s`); }
} catch (e) {
  failure = e.message;
  console.error(`\nFAIL: ${failure}`);
  // Last deployed first. A Worker that still serves its version from before has nothing to roll back.
  for (const w of uploaded ? [...WORKERS].reverse() : []) {
    const now = await liveVersion(w.name);
    if (now === w.before) continue;
    w.version ??= now ?? 'unknown';
    w.rolledBack = await rollback(w.name, w.before, 'pnpm demo-cloud:deploy failed a check');
    if (!w.rolledBack) console.error(`ROLLBACK FAILED for ${w.name}. Run: npx wrangler@4 rollback ${w.before} --name ${w.name}`);
  }
}

const deal = smoke?.id ? ` Smoke deal \`${smoke.id}\` ${smoke.state} in ${smoke.seconds} s.` : '';
console.log(`\nThe record line for docs/operations.md:\n\n${recordLine({ title: 'Deploy', startedAt, commit, branch, failure, workers: WORKERS, note: deal })}\n`);
process.exit(failure ? 1 : 0);
