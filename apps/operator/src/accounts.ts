// Test accounts for SimChain and testnets. Each key is derived from a public label, so anyone can recompute
// it: the keys guard nothing of value (hard rule: no real money). `pnpm sim` funds the labels it prints.
import type { Address, Base64Url } from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey } from '@holdback/core/crypto';
import { hexToBytes, keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Who a party is to the other side: the address it signs with and the x25519 key its envelopes are sealed to. */
export interface PartyIdentity {
  address: Address;
  encryptionPublicKey: Base64Url;
}

export interface TestAccount {
  label: string;
  /** secp256k1 key that signs EIP-712 messages. Public by construction; never use it for anything of value. */
  privateKey: Hex;
  address: Address;
  /** x25519 secret key that opens content-key envelopes (ADR-0012). */
  encryptionSecretKey: Uint8Array;
  encryptionPublicKey: Base64Url;
  identity: PartyIdentity;
}

const derive = (label: string, purpose: string): Hex => keccak256(stringToBytes(`holdback/test-account/v1/${label}/${purpose}`));

/** The test account for a label, e.g. testAccount('buyer-1'). Deterministic and public. */
export function testAccount(label: string): TestAccount {
  const privateKey = derive(label, 'signing');
  const encryptionSecretKey = hexToBytes(derive(label, 'encryption'));
  const encryptionPublicKey = encodePublicKey(encryptionKeyPairFromSecretKey(encryptionSecretKey).publicKey);
  const address = privateKeyToAccount(privateKey).address.toLowerCase() as Address;
  return { label, privateKey, address, encryptionSecretKey, encryptionPublicKey, identity: { address, encryptionPublicKey } };
}
