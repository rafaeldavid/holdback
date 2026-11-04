// The keys of the first full EVM end-to-end round on Sepolia (T-216). One Sepolia-only secret, E2E_SEPOLIA_SEED,
// read from the process environment, derives every key the round uses. The master is the one address Rafa funds
// with Sepolia ETH; the round's driver tops up the other keys from it before a step that needs their own gas, as
// the operators' funding lane tops up the deal lanes (ADR-0028 §3). Only public addresses are ever printed: never
// the secret, never a key.
//
//   node --env-file-if-exists=.env examples/e2e-keys.ts init .env   makes the secret if the environment has none,
//                                                                   appends it to .env, prints the addresses
//   node --env-file-if-exists=.env examples/e2e-keys.ts address     prints the addresses
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { concat, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export const SEED_VAR = 'E2E_SEPOLIA_SEED';
/** The master, then the round's roles: the parties, and its own adjudicators (registered through the API, T-221). */
export const ROLES = ['master', 'buyer', 'seller', 'adjudicator-1', 'adjudicator-2', 'adjudicator-3'] as const;
export type Role = (typeof ROLES)[number];

const SEED = /^0x[0-9a-fA-F]{64}$/;

/** A role's key: keccak256(seed ‖ "holdback/e2e/<role>"), as the relayer derives its deal lanes from its secret. */
export function roundKey(seed: string, role: Role): Hex {
  if (!SEED.test(seed)) throw new RangeError(`${SEED_VAR} must be 32 bytes of 0x-prefixed hex`);
  return keccak256(concat([seed as Hex, stringToHex(`holdback/e2e/${role}`)]));
}

export function roundAddresses(seed: string): Record<Role, Address> {
  return Object.fromEntries(ROLES.map((r) => [r, privateKeyToAccount(roundKey(seed, r)).address])) as Record<Role, Address>;
}

function print(seed: string): void {
  const a = roundAddresses(seed);
  console.log('Round keys (Sepolia only):');
  console.log(`  master, fund this one with Sepolia ETH: ${a.master}`);
  console.log(`    https://sepolia.etherscan.io/address/${a.master}`);
  for (const r of ROLES.slice(1)) console.log(`  ${r}: ${a[r]} (topped up from the master)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, file] = process.argv.slice(2);
  const seed = process.env[SEED_VAR];
  if (cmd === 'address') {
    if (!seed) {
      console.error(`${SEED_VAR} is not set; run with --env-file-if-exists=<file>, or make one with init <file>`);
      process.exit(1);
    }
    print(seed);
  } else if (cmd === 'init' && file) {
    if (seed) {
      console.log(`${SEED_VAR} is already set; nothing written.`);
      print(seed);
    } else if (existsSync(file) && readFileSync(file, 'utf8').split('\n').some((l) => l.startsWith(`${SEED_VAR}=`))) {
      console.error(`refusing: ${file} already has ${SEED_VAR}; load it with --env-file-if-exists=${file} and run address`);
      process.exit(2);
    } else {
      // A file this creates is readable by its owner only.
      const fresh = generatePrivateKey();
      appendFileSync(file, `\n# T-216: the first EVM end-to-end round's Sepolia-only secret (examples/e2e-keys.ts)\n${SEED_VAR}=${fresh}\n`, { mode: 0o600 });
      console.log(`Wrote ${SEED_VAR} to ${file} (not shown).`);
      print(fresh);
    }
  } else {
    console.error('usage: node --env-file-if-exists=<file> examples/e2e-keys.ts <init <file> | address>');
    process.exit(2);
  }
}
