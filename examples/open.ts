// Buyer: opens delivered work once its key is released. Usage: node examples/open.ts <commitmentId>
// Env: HOLDBACK_OPERATORS (first one is used), HOLDBACK_KEY (gives the address) and HOLDBACK_ENCRYPTION_KEY
// (x25519 secret key, base64url), as the sim hands them out.
import type { Hex } from 'viem';
import { Agent } from './agent.ts';

const operators = (process.env['HOLDBACK_OPERATORS'] ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',');
const buyer = new Agent(operators, process.env['HOLDBACK_KEY'] as Hex, Buffer.from(process.env['HOLDBACK_ENCRYPTION_KEY'] ?? '', 'base64url'));
process.stdout.write(await buyer.openDelivery(process.argv[2] as Hex));
