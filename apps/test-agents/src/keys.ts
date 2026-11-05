// The test agents' keys (T-222). One Sepolia-only secret, the Worker secret TEST_AGENTS_SEED, derives every key
// they use, as examples/e2e-keys.ts derives the round's: a label's signing key is keccak256(seed ‖
// "holdback/test-agents/<label>"), and its x25519 key keccak256(seed ‖ "holdback/test-agents/<label>/x25519").
// The labels are the seller's intake key ("seller/intake") and its one standing address ("seller/standing", D47).
// Only public keys and addresses ever leave this module: never the secret, never a key.
import nacl from 'tweetnacl';
import { concat, hexToBytes, keccak256, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const SEED_VAR = 'TEST_AGENTS_SEED';
const SEED = /^0x[0-9a-fA-F]{64}$/;

function derive(seed: string, label: string): Hex {
  if (!SEED.test(seed)) throw new RangeError(`${SEED_VAR} must be 32 bytes of 0x-prefixed hex`);
  return keccak256(concat([seed as Hex, stringToHex(`holdback/test-agents/${label}`)]));
}

/** A label's secp256k1 signing key. */
export const signingKey = (seed: string, label: string): Hex => derive(seed, label);

/** A label's x25519 secret key, for NaCl box. */
export const encryptionKey = (seed: string, label: string): Uint8Array => hexToBytes(derive(seed, `${label}/x25519`));

/** A label's public identity: its address and its x25519 public key as base64url. */
export function publicOf(seed: string, label: string): { address: string; encryptionPublicKey: string } {
  return {
    address: privateKeyToAccount(signingKey(seed, label)).address.toLowerCase(),
    encryptionPublicKey: Buffer.from(nacl.box.keyPair.fromSecretKey(encryptionKey(seed, label)).publicKey).toString('base64url'),
  };
}
