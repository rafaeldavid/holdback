// `node apps/test-agents/scripts/seed.mjs` (T-222): makes the test agents' Sepolia-only secret and sets it as the
// Worker secret TEST_AGENTS_SEED on crow-test-agents. The secret is generated in memory and piped to `wrangler secret
// bulk` on stdin: it is never printed, logged or written to disk. Only public values are printed: the intake's
// encryption key, which the intake page serves. The test agents hold no Sepolia ETH (the operators relay and pay the
// gas), so the secret guards test tokens and the intake's mail only. It refuses when the secret already exists, so
// open deals keep their keys; --replace overrides.
import { spawn, spawnSync } from 'node:child_process';
import { concat, keccak256, stringToHex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import nacl from 'tweetnacl';

const WORKER = 'crow-test-agents';
const NAME = 'TEST_AGENTS_SEED';

const list = spawnSync('npx', ['-y', 'wrangler@4', 'secret', 'list', '--name', WORKER, '--format', 'json'], { encoding: 'utf8' });
if (list.status !== 0) {
  console.error(`wrangler secret list failed (exit ${list.status}); log in with wrangler first, and deploy ${WORKER} once`);
  process.exit(1);
}
const names = JSON.parse(list.stdout.slice(list.stdout.indexOf('['))).map((s) => s.name);
if (names.includes(NAME) && !process.argv.includes('--replace')) {
  console.error(`refusing: ${WORKER} already has ${NAME}; a replacement changes the intake key and the keys of open deals. Pass --replace to make a new one anyway.`);
  process.exit(2);
}

const seed = generatePrivateKey();
// keys.ts: the intake's x25519 key is keccak256(seed ‖ "holdback/test-agents/seller/intake/x25519").
const intake = Buffer.from(keccak256(concat([seed, stringToHex('holdback/test-agents/seller/intake/x25519')])).slice(2), 'hex');
const publicKey = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(intake)).publicKey).toString('base64url');
const child = spawn('npx', ['-y', 'wrangler@4', 'secret', 'bulk', '--name', WORKER], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(JSON.stringify({ [NAME]: seed }));
child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`wrangler secret bulk exited with ${code}; nothing was set, and the secret is gone with this process`);
    process.exit(code ?? 1);
  }
  console.log(`Set ${NAME} on ${WORKER}. The test seller's intake encryption key (public): ${publicKey}`);
});
