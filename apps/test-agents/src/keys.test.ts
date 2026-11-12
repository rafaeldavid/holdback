// T-313: scripts/seed.mjs prints the intake's public key that the seller will serve. It used to carry its own copy of
// the derivation; it now imports keys.ts. These tests hold the two together without running the script, which needs
// a Cloudflare login: the formula the script printed from is still what keys.ts derives, plain Node loads keys.ts the
// way the script does, and the script has no derivation of its own. Every seed here is random and never printed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import { concat, hexToBytes, keccak256, stringToHex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { publicOf, SEED_VAR } from './keys.ts';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe("the seed script and the seller's keys", () => {
  it("derives the intake's public key by the formula the seed script printed from", () => {
    for (let i = 0; i < 5; i++) {
      const seed = generatePrivateKey();
      // scripts/seed.mjs before T-313: keccak256(seed ‖ "holdback/test-agents/seller/intake/x25519") as an x25519 secret key.
      const secretKey = hexToBytes(keccak256(concat([seed, stringToHex('holdback/test-agents/seller/intake/x25519')])));
      const printed = Buffer.from(nacl.box.keyPair.fromSecretKey(secretKey).publicKey).toString('base64url');
      expect(publicOf(seed, 'seller/intake').encryptionPublicKey).toBe(printed);
    }
  });

  it('loads in plain Node, as the seed script imports it, and derives the same key there', () => {
    const seed = generatePrivateKey();
    // The child reads the seed from its environment and prints the public key only.
    const code = `import { publicOf } from ${JSON.stringify(new URL('./keys.ts', import.meta.url).href)}; process.stdout.write(publicOf(process.env.SEED_UNDER_TEST, 'seller/intake').encryptionPublicKey);`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', SEED_UNDER_TEST: seed }, timeout: 60_000 });
    expect(r.stderr).not.toContain(seed);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(publicOf(seed, 'seller/intake').encryptionPublicKey);
  });

  it('leaves the seed script no derivation of its own', () => {
    const script = readFileSync(path('../scripts/seed.mjs'), 'utf8');
    expect(script).toContain("import { publicOf, SEED_VAR } from '../src/keys.ts';");
    expect(script).toContain("publicOf(seed, 'seller/intake').encryptionPublicKey");
    expect(script).not.toMatch(/keccak256|tweetnacl|x25519/);
    // The secret's name comes from keys.ts too, and it is the name the Worker reads.
    expect(script).toContain('const NAME = SEED_VAR;');
    expect(SEED_VAR).toBe('TEST_AGENTS_SEED');
    // The seed goes to wrangler's stdin and to publicOf, and nowhere else: no console line names it.
    const uses = script.split('\n').filter((l) => /\bseed\b/.test(l) && !l.trim().startsWith('//'));
    expect(uses.map((l) => l.trim())).toEqual([
      'const seed = generatePrivateKey();',
      "const publicKey = publicOf(seed, 'seller/intake').encryptionPublicKey;",
      'child.stdin.end(JSON.stringify({ [NAME]: seed }));',
    ]);
  });
});
