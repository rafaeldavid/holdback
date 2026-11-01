// Verifies a prepared message (POST /v1/prepare/<kind> output) against your own intent, then signs it with
// HOLDBACK_KEY and prints the body to submit. It refuses on any difference (verify.ts).
// Usage: node examples/sign.ts prepared.json intent.json > body.json   (docs/quickstart.md)
// You pick every nonce yourself (32 random bytes, e.g. `openssl rand -hex 32` with 0x in front), send it with
// the prepare request, and put the same value in the intent:
//   offer:          intent = the request you sent to /v1/prepare/offer, including "nonce"
//   agree-and-fund: intent = { "terms": <the offer the seller sent you>, "maxTotal": "<base units>", "agreeNonce": …, "fundingNonce": … }
//   early-accept:   intent = { "terms": …, "nonce": …, "delivery": <the signed delivery body the seller handed you> }
//                   (sign.ts first opens your envelope from it with HOLDBACK_ENCRYPTION_KEY and refuses unless
//                   it opens and the plaintext hash matches: an early accept releases that envelope with payment)
//   appeal:         intent = { "terms": …, "grounds": "wrong-outcome" }   (the bond comes from the club rulebook)
//   settlement:     intent = { "terms": …, "payouts": [ … ], "releaseKey": true, "deliveryHash": "0x…" | null, "nonce": … }
// Env: HOLDBACK_KEY, HOLDBACK_ENCRYPTION_KEY (buyer), HOLDBACK_OPERATORS (two or more distinct operators,
// comma-separated, for trusted reads and settlement time), HOLDBACK_CHAIN_ID and HOLDBACK_VERIFYING_CONTRACT.
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { Agent } from './agent.ts';
import { openOwnEnvelope, Refusal, verifyPrepared, type Intent } from './verify.ts';

const [preparedFile, intentFile] = process.argv.slice(2);
const prepared = JSON.parse(readFileSync(preparedFile!, 'utf8'));
const given = JSON.parse(readFileSync(intentFile!, 'utf8'));
const operators = (process.env['HOLDBACK_OPERATORS'] ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',');
const enc = Buffer.from(process.env['HOLDBACK_ENCRYPTION_KEY'] ?? '', 'base64url');
const agent = new Agent(operators, process.env['HOLDBACK_KEY'] as Hex, enc.length === 32 ? enc : new Uint8Array(32));
const me = agent.address;
const kind = prepared.kind as Intent['kind'];
try {
  const intent: Intent =
    kind === 'offer'
      ? { kind, request: given, registration: await agent.registration(given.adjudicators.primary), rulebookHash: await agent.rulebookHash(given.clubId) }
      : kind === 'agree-and-fund'
        ? { kind, terms: given.terms, me, encryptionPublicKey: agent.encryptionPublicKey, maxTotal: BigInt(given.maxTotal), agreeNonce: given.agreeNonce, fundingNonce: given.fundingNonce }
        : kind === 'appeal'
          ? { kind, terms: given.terms, me, appealBondRateBps: (await agent.club(given.terms.clubId)).rulebook.appealBondRateBps, ...(given.grounds ? { grounds: given.grounds } : {}) }
          : kind === 'settlement'
            ? { kind, terms: given.terms, payouts: given.payouts, releaseKey: given.releaseKey, deliveryHash: given.deliveryHash ?? null, nonce: given.nonce }
            : kind === 'early-accept'
              ? { kind, terms: given.terms, nonce: given.nonce, opened: await openOwnEnvelope(await agent.envelopeMaterial(given.terms, given.delivery ?? (() => { throw new Refusal('refusing to sign: the early-accept intent needs "delivery", the signed delivery body the seller handed you, so you can open your envelope first'); })())) }
              : (() => { throw new Refusal(`sign.ts does not sign ${kind}; deliveries are sealed and signed by seal.ts`); })();
  const { body, toSign } = verifyPrepared(prepared, intent, me, agent.domain, await agent.settlementNow());
  for (const s of toSign) {
    const keys = s.slot.split('.');
    keys.slice(0, -1).reduce((o: Record<string, any>, k) => o[k], body)[keys.at(-1)!] = await agent.account.signTypedData(s.typed); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  console.log(JSON.stringify(body));
} catch (e) {
  console.error((e as Error).message);
  process.exit(3);
}
