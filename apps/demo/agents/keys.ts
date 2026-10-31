// Deterministic demo keys and randomness. Every key is derived from the testkit context's seed and a public
// label, so the keys guard nothing of value (hard rule: no real money) and a run replays byte for byte.
import { encodePublicKey, encryptionKeyPairFromSecretKey, type EncryptionKeyPair, type RandomSource } from '@holdback/core/crypto';
import type { Address, Base64Url } from '@holdback/core';
import type { Rng } from '@holdback/testkit';
import { hexToBytes, keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface AgentKeys {
  /** Actor label, e.g. 'atlas' or 'bench-a'. */
  name: string;
  /** secp256k1 key that signs EIP-712 messages. */
  signingKey: Hex;
  address: Address;
  /** x25519 key pair that opens content-key envelopes (ADR-0012). */
  encryption: EncryptionKeyPair;
  encryptionPublicKey: Base64Url;
}

const derive = (seed: number, name: string, purpose: string): Hex => keccak256(stringToBytes(`holdback/demo-agents/v0/${seed}/${name}/${purpose}`));

export function agentKeys(seed: number, name: string): AgentKeys {
  const signingKey = derive(seed, name, 'signing');
  const encryption = encryptionKeyPairFromSecretKey(hexToBytes(derive(seed, name, 'encryption')));
  return { name, signingKey, address: privateKeyToAccount(signingKey).address, encryption, encryptionPublicKey: encodePublicKey(encryption.publicKey) };
}

/** Random bytes drawn from the context's splitmix64, for content keys, IVs and envelope nonces. Not secure; demo only. */
export function rngSource(rng: Rng): RandomSource {
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 8) {
      let v = rng.nextU64();
      for (let j = 0; j < 8 && i + j < length; j++) {
        out[i + j] = Number(v & 0xffn);
        v >>= 8n;
      }
    }
    return out;
  };
}
