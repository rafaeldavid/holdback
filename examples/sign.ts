// Verifies a prepared message (POST /v1/prepare/<kind> output) against your own intent, then signs it with
// HOLDBACK_KEY and prints the body to submit. It refuses on any difference (verify.ts).
// Usage: node examples/sign.ts prepared.json intent.json > body.json   (docs/quickstart.md)
//   offer:          intent = the request you sent to /v1/prepare/offer
//   agree-and-fund: intent = { "terms": <the offer the seller sent you>, "maxTotal": "<base units>" }
//   early-accept:   intent = { "terms": … }
//   appeal:         intent = { "terms": …, "maxBond": "<base units>", "grounds": "wrong-outcome" }
//   settlement:     intent = { "terms": …, "payouts": [ … ], "releaseKey": true, "deliveryHash": "0x…" | null }
// Env: HOLDBACK_KEY, HOLDBACK_ENCRYPTION_KEY (buyer), HOLDBACK_OPERATORS (two or more, comma-separated, for
// trusted reads), HOLDBACK_CHAIN_ID and HOLDBACK_VERIFYING_CONTRACT (default: SimChain's).
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { Agent } from './agent.ts';
import { Refusal, verifyPrepared, type Intent } from './verify.ts';

const [preparedFile, intentFile] = process.argv.slice(2);
const prepared = JSON.parse(readFileSync(preparedFile!, 'utf8'));
const given = JSON.parse(readFileSync(intentFile!, 'utf8'));
const operators = (process.env['HOLDBACK_OPERATORS'] ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',');
const agent = new Agent(operators, process.env['HOLDBACK_KEY'] as Hex, Buffer.from(process.env['HOLDBACK_ENCRYPTION_KEY'] ?? '', 'base64url').length === 32 ? Buffer.from(process.env['HOLDBACK_ENCRYPTION_KEY']!, 'base64url') : new Uint8Array(32));
const me = agent.address;
const kind = prepared.kind as Intent['kind'];
const intent: Intent =
  kind === 'offer'
    ? { kind, request: given, registration: await agent.registration(given.adjudicators.primary), rulebookHash: await agent.rulebookHash(given.clubId) }
    : kind === 'agree-and-fund'
      ? { kind, terms: given.terms, me, encryptionPublicKey: agent.encryptionPublicKey, maxTotal: BigInt(given.maxTotal) }
      : kind === 'appeal'
        ? { kind, terms: given.terms, me, maxBond: BigInt(given.maxBond), ...(given.grounds ? { grounds: given.grounds } : {}) }
        : kind === 'settlement'
          ? { kind, terms: given.terms, payouts: given.payouts, releaseKey: given.releaseKey, deliveryHash: given.deliveryHash ?? null }
          : kind === 'early-accept'
            ? { kind, terms: given.terms }
            : (() => { throw new Refusal(`sign.ts does not sign ${kind}; deliveries are sealed and signed by seal.ts`); })();
try {
  const { body, toSign } = verifyPrepared(prepared, intent, me, agent.domain);
  for (const s of toSign) {
    const keys = s.slot.split('.');
    keys.slice(0, -1).reduce((o: Record<string, any>, k) => o[k], body)[keys.at(-1)!] = await agent.account.signTypedData(s.typed); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  console.log(JSON.stringify(body));
} catch (e) {
  console.error((e as Error).message);
  process.exit(3);
}
