// `pnpm demo-cloud:deploy`: deploys the public demo's two operator Workers and checks them with one test deal
// (T-234), so a deploy needs no hand checklist:
//   1. build;
//   2. read each Worker's live version: its rollback target;
//   3. deploy holdback-op1 (it defines the World Durable Object), then holdback-op2; a refused upload stops here;
//   4. wait until /v1/status answers 200 on both nodes;
//   5. one examples/try.ts deal against both operators must end Released within 180 s;
//   6. when a step after an upload fails, roll back each Worker whose live version changed, and exit 1;
//   7. print one Markdown record line for docs/operations.md.
// Wrangler uses the Cloudflare login of whoever runs it (its own OAuth; nothing is read from the repository). Test
// networks only: each wrangler file's SETTLEMENT picks SimChain (chain id 31337) or Ethereum Sepolia (11155111, D41),
// and the startup guards refuse anything else at run time. A cutover deploys the Workers one at a time instead
// (docs/operations.md, Settlement).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

/** Runs a command from the repository root, shows its output, and keeps it. The code is null after a timeout. */
function sh(cmd, args, { show = true, env = {}, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', out = '';
    const child = spawn(cmd, args, { cwd: here('../../../'), env: { ...process.env, FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const done = (code) => (clearTimeout(timer), resolve({ code, stdout, out }));
    child.stdout.on('data', (d) => {
      stdout += d;
      out += d;
      if (show) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d;
      if (show) process.stderr.write(d);
    });
    child.on('error', (e) => {
      out += e.message;
      done(1);
    });
    child.on('close', (code, signal) => done(signal ? null : code));
  });
}

/** The version a Worker serves to all traffic, or null when wrangler cannot say. */
async function live(name) {
  const r = await sh('npx', ['-y', 'wrangler@4', 'deployments', 'status', '--name', name, '--json'], { show: false });
  try {
    const v = JSON.parse(r.stdout).versions;
    return v.length === 1 && v[0].percentage === 100 ? v[0].version_id : null;
  } catch {
    return null;
  }
}

const fail = (why) => {
  throw new Error(why);
};
const startedAt = new Date();
const commit = (await sh('git', ['rev-parse', 'HEAD'], { show: false })).stdout.trim();
let uploaded = false, failure = null, smoke = null;

try {
  if ((await sh('pnpm', ['-C', here('..'), 'build'])).code !== 0) fail('the build failed');
  for (const w of WORKERS) w.before = (await live(w.name)) ?? fail(`wrangler cannot read ${w.name}'s live version (is it logged in?)`);
  for (const w of WORKERS) {
    uploaded = true;
    const r = await sh('npx', ['-y', 'wrangler@4', 'deploy', '-c', here(`../${w.config}`)]);
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
    const now = await live(w.name);
    if (now === w.before) continue;
    w.version ??= now ?? 'unknown';
    const r = await sh('npx', ['-y', 'wrangler@4', 'rollback', w.before, '--name', w.name, '--message', 'pnpm demo-cloud:deploy failed a check', '--yes']);
    w.rolledBack = r.code === 0 && (await live(w.name)) === w.before;
    if (!w.rolledBack) console.error(`ROLLBACK FAILED for ${w.name}. Run: npx wrangler@4 rollback ${w.before} --name ${w.name}`);
  }
}

const versions = WORKERS.map((w) => {
  const back = w.rolledBack === true ? ', rolled back' : w.rolledBack === false ? ', ROLLBACK FAILED' : '';
  return `${w.name} \`${w.version ?? 'not deployed'}\` (rollback target \`${w.before ?? 'unknown'}\`${back})`;
});
const deal = smoke?.id ? ` Smoke deal \`${smoke.id}\` ${smoke.state} in ${smoke.seconds} s.` : '';
const when = `${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
console.log(`\nThe record line for docs/operations.md:\n\n**Deploy ${when}, commit \`${commit.slice(0, 7)}\`: ${failure ? `FAIL, ${failure}` : 'pass'}.** ${versions.join(', ')}.${deal}\n`);
process.exit(failure ? 1 : 0);
