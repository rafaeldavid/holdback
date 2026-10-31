// Seller: encrypts a file for a commitment, uploads the ciphertext, seals the content key to every recipient,
// and prints the prepared delivery to sign. Usage: node examples/seal.ts <commitmentId> <file> > delivery.json
// Env: HOLDBACK_API (operator base URL, default http://127.0.0.1:8787). Uses agent.ts (Web Crypto, tweetnacl).
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { Agent } from './agent.ts';

const [id, file] = process.argv.slice(2) as [Hex, string];
// Sealing needs no signing key; the delivery is signed afterwards with sign.ts.
const seller = new Agent(process.env['HOLDBACK_API'] ?? 'http://127.0.0.1:8787', `0x${'11'.repeat(32)}`, new Uint8Array(32));
console.log(JSON.stringify(await seller.prepareDelivery(id, new Uint8Array(readFileSync(file)))));
