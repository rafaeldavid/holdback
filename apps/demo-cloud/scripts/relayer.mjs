// `node apps/demo-cloud/scripts/relayer.mjs` (D41, ADR-0028): makes a fresh Sepolia-only relayer key and sets it as
// the Worker secret SEPOLIA_RELAYER_KEY on holdback-op1, the Worker whose Durable Object relays for both nodes. The
// key is generated in memory and piped to `wrangler secret bulk` on stdin: it is never printed, logged or written to
// disk. Only public addresses are printed: the funding lane, which Rafa funds with Sepolia ETH, and the deal lanes
// it derives, which the world tops up from the funding lane. It refuses when the secret already exists, so a funded
// key is never replaced by accident; --replace overrides.
import { spawn, spawnSync } from 'node:child_process';
import { DEAL_LANES, laneKey } from '@holdback/settlement/live';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const WORKER = 'holdback-op1';
const NAME = 'SEPOLIA_RELAYER_KEY';

const list = spawnSync('npx', ['-y', 'wrangler@4', 'secret', 'list', '--name', WORKER, '--format', 'json'], { encoding: 'utf8' });
if (list.status !== 0) {
  console.error(`wrangler secret list failed (exit ${list.status}); log in with wrangler first`);
  process.exit(1);
}
const names = JSON.parse(list.stdout.slice(list.stdout.indexOf('['))).map((s) => s.name);
if (names.includes(NAME) && !process.argv.includes('--replace')) {
  console.error(`refusing: ${WORKER} already has ${NAME}; a replacement strands the Sepolia ETH on the old lanes. Pass --replace to make a new one anyway.`);
  process.exit(2);
}

const key = generatePrivateKey();
const lanes = [key, ...Array.from({ length: DEAL_LANES }, (_, i) => laneKey(key, i + 1))].map((k) => privateKeyToAccount(k).address);
const child = spawn('npx', ['-y', 'wrangler@4', 'secret', 'bulk', '--name', WORKER], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(JSON.stringify({ [NAME]: key }));
child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`wrangler secret bulk exited with ${code}; nothing was set, and the key is gone with this process`);
    process.exit(code ?? 1);
  }
  console.log(`Set ${NAME} on ${WORKER}. Public addresses (Sepolia only):`);
  console.log(`  funding lane (fund this one): ${lanes[0]}`);
  for (const [i, a] of lanes.slice(1).entries()) console.log(`  deal lane ${i + 1}: ${a}`);
});
