// The keys of the first full EVM end-to-end round on Sepolia (T-216). One Sepolia-only secret, E2E_SEPOLIA_SEED,
// read from the process environment, derives every key the round uses. The master is the one address Rafa funds
// with Sepolia ETH; the round's driver tops up the other keys from it before a step that needs their own gas, as
// the operators' funding lane tops up the deal lanes (ADR-0028 §3). Only public addresses are ever printed: never
// the secret, never a key.
//
//   node --env-file-if-exists=.env examples/e2e-keys.ts init .env   makes the secret if the environment has none,
//                                                                   appends it to .env, prints the addresses
//   node --env-file-if-exists=.env examples/e2e-keys.ts address     prints the addresses
//   node --env-file-if-exists=.env examples/e2e-keys.ts topup [--dry-run]
//                                                                   brings each other key up to 0.04 Sepolia ETH from
//                                                                   the master, one transfer at a time, on Sepolia only
//                                                                   (SEPOLIA_RPC_URL, else a public node)
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BaseError, concat, createPublicClient, createWalletClient, formatEther, formatGwei, http, keccak256, parseEther, parseGwei, stringToHex, toBytes, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

export const SEED_VAR = 'E2E_SEPOLIA_SEED';
/** The master, then the round's roles: the parties, and its own adjudicators (registered through the API, T-221). */
export const ROLES = ['master', 'buyer', 'seller', 'adjudicator-1', 'adjudicator-2', 'adjudicator-3'] as const;
export type Role = (typeof ROLES)[number];

const SEED = /^0x[0-9a-fA-F]{64}$/;
/** A line that sets the secret, in any form a dotenv reader accepts: leading spaces, `export`, spaces around `=`. */
const SETS_SEED = new RegExp(`^\\s*(export\\s+)?${SEED_VAR}\\s*=`, 'm');

/** A role's key: keccak256(seed ‖ "holdback/e2e/<role>"), as the relayer derives its deal lanes from its secret. */
export function roundKey(seed: string, role: Role): Hex {
  if (!SEED.test(seed)) throw new RangeError(`${SEED_VAR} must be 32 bytes of 0x-prefixed hex`);
  return keccak256(concat([seed as Hex, stringToHex(`holdback/e2e/${role}`)]));
}

/** A role's x25519 secret key, for the envelopes it seals and opens: keccak256(seed ‖ "holdback/e2e/<role>/x25519"). */
export function roundEncryptionKey(seed: string, role: Role): Uint8Array {
  roundKey(seed, role); // refuses a malformed seed, as every key here does
  return toBytes(keccak256(concat([seed as Hex, stringToHex(`holdback/e2e/${role}/x25519`)])));
}

export function roundAddresses(seed: string): Record<Role, Address> {
  return Object.fromEntries(ROLES.map((r) => [r, privateKeyToAccount(roundKey(seed, r)).address])) as Record<Role, Address>;
}

/** The round runs on Sepolia only: a top-up refuses any other chain, mainnet above all (CLAUDE.md, no real money). */
export const SEPOLIA_CHAIN_ID = 11155111;
/**
 * Each key's top-up target, in wei: 0.04 Sepolia ETH. That covers a key's own approvals, an adjudicator's bond deposit
 * (about 372,709 gas) and direct calls many times over at up to 20 gwei; the round needs about 0.2 in all (question 4).
 */
export const TOPUP_TARGET = parseEther('0.04');
/** The fee cap, as the operators' funding lane has (`SEPOLIA_MAX_FEE_GWEI`, default 20): above it, a top-up waits. */
export const MAX_FEE_PER_GAS = parseGwei('20');
/**
 * What the master keeps for its own transfers' gas, in wei. A transfer is 21,000 gas, 0.00042 Sepolia ETH at the 20
 * gwei cap, so five transfers take 0.0021 and 0.01 covers them about 4.8 times.
 */
export const MASTER_RESERVE = parseEther('0.01');
/** The RPC: SEPOLIA_RPC_URL (it may carry a provider key, so it is never printed), else a public node. */
const rpcUrl = () => process.env['SEPOLIA_RPC_URL'] || 'https://ethereum-sepolia-rpc.publicnode.com';

export interface TopUp { role: Exclude<Role, 'master'>; address: Address; balance: bigint; send: bigint }

/** Refuses any chain but Sepolia: stricter than `assertSafeChain`'s mainnet list, which it would also satisfy. */
export function assertSepolia(chainId: number): void {
  if (chainId !== SEPOLIA_CHAIN_ID) throw new RangeError(`refusing: chain ${chainId} is not Sepolia (${SEPOLIA_CHAIN_ID})`);
}

/**
 * An error as one line safe to print: viem's short message, without the request details its long one carries, and
 * every URL but an Etherscan link replaced, so a keyed RPC URL never reaches a transcript.
 */
export function printable(e: unknown): string {
  const text = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e);
  return text.replace(/https?:\/\/(?!sepolia\.etherscan\.io\/)[^\s"'`]+/g, '<rpc url>');
}

/**
 * The transfers that bring every key but the master up to `target`, in role order. A key at or above it gets
 * nothing. Refuses, sending nothing, when the master cannot cover them all and keep its reserve.
 */
export function planTopUps(addresses: Record<Role, Address>, balances: Record<Role, bigint>, target = TOPUP_TARGET): TopUp[] {
  const plan = ROLES.filter((r): r is TopUp['role'] => r !== 'master')
    .map((role) => ({ role, address: addresses[role], balance: balances[role], send: balances[role] < target ? target - balances[role] : 0n }))
    .filter((t) => t.send > 0n);
  const total = plan.reduce((sum, t) => sum + t.send, 0n);
  if (total > 0n && total + MASTER_RESERVE > balances.master) {
    throw new RangeError(`refusing: the master holds ${formatEther(balances.master)} Sepolia ETH; the top-ups need ${formatEther(total)} Sepolia ETH plus ${formatEther(MASTER_RESERVE)} Sepolia ETH for gas`);
  }
  return plan;
}

/**
 * Checks the chain before anything else, refuses while a transfer from the master is still pending or fees are above
 * the cap, plans from the balances, and (unless `dryRun`) sends each transfer, printing its link before it waits.
 */
async function topUp(seed: string, dryRun: boolean): Promise<void> {
  const transport = http(rpcUrl());
  const client = createPublicClient({ chain: sepolia, transport });
  assertSepolia(await client.getChainId());
  const addresses = roundAddresses(seed);
  // A transfer still in flight leaves its key looking empty at `latest`, and a rerun would send it again.
  const [pending, mined] = await Promise.all(['pending', 'latest'].map((blockTag) => client.getTransactionCount({ address: addresses.master, blockTag: blockTag as 'pending' | 'latest' })));
  if (pending !== mined) throw new Error('refusing: a transfer from the master is still pending (its pending and latest nonces differ); run again once it is mined');
  const fees = await client.estimateFeesPerGas();
  if (fees.maxFeePerGas > MAX_FEE_PER_GAS) throw new Error(`refusing: Sepolia fees are ${formatGwei(fees.maxFeePerGas)} gwei, above the ${formatGwei(MAX_FEE_PER_GAS)} gwei cap; run again later`);
  const balances = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await client.getBalance({ address: addresses[r] })]))) as Record<Role, bigint>;
  const plan = planTopUps(addresses, balances);
  console.log(`master ${addresses.master}: ${formatEther(balances.master)} Sepolia ETH`);
  if (plan.length === 0) {
    console.log(`Every key holds at least ${formatEther(TOPUP_TARGET)} Sepolia ETH; nothing to send.`);
    return;
  }
  for (const t of plan) console.log(`  ${t.role} ${t.address}: holds ${formatEther(t.balance)} Sepolia ETH, to send ${formatEther(t.send)} Sepolia ETH`);
  if (dryRun) return;
  const wallet = createWalletClient({ account: privateKeyToAccount(roundKey(seed, 'master')), chain: sepolia, transport });
  // One transfer at a time, each mined before the next, so the master's nonces never race.
  let done = 0;
  for (const t of plan) {
    try {
      const hash = await wallet.sendTransaction({ to: t.address, value: t.send, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      console.log(`  ${t.role}: sent ${formatEther(t.send)} Sepolia ETH, https://sepolia.etherscan.io/tx/${hash}`);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`the transfer to ${t.role} reverted: https://sepolia.etherscan.io/tx/${hash}`);
      done++;
    } catch (e) {
      throw new Error(`${done} of ${plan.length} transfers mined, then: ${printable(e)}`);
    }
  }
  console.log(`${done} of ${plan.length} transfers mined.`);
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
  if (cmd === 'address' || cmd === 'topup') {
    if (!seed) {
      console.error(`${SEED_VAR} is not set; run with --env-file-if-exists=<file>, or make one with init <file>`);
      process.exit(1);
    }
    if (cmd === 'address') print(seed);
    else if (file !== undefined && file !== '--dry-run') {
      console.error('usage: node --env-file-if-exists=<file> examples/e2e-keys.ts topup [--dry-run]');
      process.exit(2);
    } else {
      try {
        await topUp(seed, file === '--dry-run');
      } catch (e) {
        // A refusal or a failed transfer: say why, never the key that signed or the RPC URL.
        console.error(printable(e));
        process.exit(1);
      }
    }
  } else if (cmd === 'init' && file) {
    if (seed) {
      console.log(`${SEED_VAR} is already set; nothing written.`);
      print(seed);
    } else if (existsSync(file) && SETS_SEED.test(readFileSync(file, 'utf8'))) {
      // Only whether the variable is set leaves this read; nothing in the file is printed.
      console.error(`refusing: ${file} already has ${SEED_VAR}; load it with --env-file-if-exists=${file} and run address`);
      process.exit(2);
    } else {
      // A file this creates is readable by its owner only; an existing one keeps its mode, so say when others can read it.
      if (existsSync(file) && statSync(file).mode & 0o077) console.error(`warning: ${file} is readable by other users; chmod 600 ${file}`);
      const fresh = generatePrivateKey();
      appendFileSync(file, `\n# T-216: the first EVM end-to-end round's Sepolia-only secret (examples/e2e-keys.ts)\n${SEED_VAR}=${fresh}\n`, { mode: 0o600 });
      console.log(`Wrote ${SEED_VAR} to ${file} (not shown).`);
      print(fresh);
    }
  } else {
    console.error('usage: node --env-file-if-exists=<file> examples/e2e-keys.ts <init <file> | address | topup [--dry-run]>');
    process.exit(2);
  }
}
