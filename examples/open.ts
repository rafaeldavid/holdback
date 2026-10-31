// Buyer: opens delivered work once its key is released. Usage: node examples/open.ts <commitmentId>
// Env: HOLDBACK_API (default http://127.0.0.1:8787), HOLDBACK_KEY (signing key; gives the address) and
// HOLDBACK_ENCRYPTION_KEY (x25519 secret key, base64url), as the sim prints them.
import type { Hex } from 'viem';
import { Agent } from './agent.ts';

const buyer = new Agent(process.env['HOLDBACK_API'] ?? 'http://127.0.0.1:8787', process.env['HOLDBACK_KEY'] as Hex, Buffer.from(process.env['HOLDBACK_ENCRYPTION_KEY'] ?? '', 'base64url'));
process.stdout.write(await buyer.openDelivery(process.argv[2] as Hex));
