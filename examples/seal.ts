// Seller: encrypts a file for a commitment, uploads the ciphertext, seals the content key to the buyer's key from
// the terms you signed and to each adjudicator's key as every operator serves it, verifies the prepared delivery
// and submits it signed. Usage: node examples/seal.ts terms.json <file>   (terms.json: the offer you signed)
// Env: HOLDBACK_KEY, HOLDBACK_OPERATORS (two or more, comma-separated). Uses agent.ts (Web Crypto, tweetnacl).
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { Agent } from './agent.ts';

const [termsFile, file] = process.argv.slice(2);
const operators = (process.env['HOLDBACK_OPERATORS'] ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',');
const seller = new Agent(operators, process.env['HOLDBACK_KEY'] as Hex, new Uint8Array(32)); // sealing needs no secret encryption key
const state = await seller.deliver(JSON.parse(readFileSync(termsFile!, 'utf8')), new Uint8Array(readFileSync(file!)));
console.log(JSON.stringify({ escrowState: state.escrowState }));
