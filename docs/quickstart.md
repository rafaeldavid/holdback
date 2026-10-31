# Quickstart: your first deal in ten minutes

You will run a local Holdback world and settle one deal through the HTTP API: a seller offers a dataset, a buyer holds the money, the seller delivers it encrypted, an adjudicator checks it, and payment and the decryption key are released together. Every message is signed by the party that sends it, with a standard EIP-712 library. The operator prepares messages and relays them; the agent verifies each one against its own intent before signing.

**Nothing here is real.** The world runs on SimChain, an in-process settlement layer. The token is tUSD, a test token with **6 decimals** (25 tUSD is `"25000000"`). Every key is a test key derived from a public label. The adjudicators use **fake judges**: no model runs, and every judgment record says so (`placeholder-` model IDs, verdicts starting `[fake judge, no model ran]`). No real money moves, and nothing can.

Two economics to know before you start: the buyer holds the price **plus the adjudication fee**, and **the fee is kept on a refund** (a refunded buyer gets the price back, not the fee). An appeal costs a bond of 5% of the price plus a 25 tUSD fee. docs/api.md, "Who gets what", has every outcome.

## 1. Install, build, start the sim

Node 22 and pnpm (through corepack), then:

```sh
corepack enable
pnpm install
pnpm build
pnpm sim
```

`pnpm sim` keeps running and prints two operator nodes (`http://127.0.0.1:8787` and `:8788`), a sim service (`http://127.0.0.1:8780`), three test adjudicators, the EIP-712 domain to pin in your agent, and the club's economics. If a port is taken, it says so; choose others with `pnpm sim --port 9780 --operator-ports 9787,9788` (then use those ports below). Leave it running and open a second terminal.

The sim service has test controls: `POST /accounts` hands out a fresh funded account, `POST /advance {"seconds": n}` moves the clock, and `POST /adjudicators/primary {"silent": true}` stops an adjudicator so you can try the fallback. Work containing the text `FAIL-ME` fails every fake judge, so you can try a reject and an appeal.

**In a hurry?** `pnpm example buy-dataset` and `pnpm example sell-translation` run whole deals (`examples/`); they start their own sim if none is running. The rest of this page does the same deal step by step with curl.

## 2. Discover the API and configure your agent

An operator publishes where its API is at a well-known address: the API base, the EIP-712 domain, the operator's receipt key and the settlement target.

```sh
curl -s http://127.0.0.1:8787/.well-known/holdback.json | jq
export API=http://127.0.0.1:8787
export HOLDBACK_OPERATORS=http://127.0.0.1:8787,http://127.0.0.1:8788   # trusted reads must agree on both
export HOLDBACK_CHAIN_ID=31337 HOLDBACK_VERIFYING_CONTRACT=0x00000000000000000000000000000000484f4c44
```

The last line is your agent's own configuration: the EIP-712 domain it signs under, as `pnpm sim` printed it. Pin it yourself. Do not take it from an operator, because an operator that served another domain could collect a signature that is valid somewhere else.

Take two fresh funded test accounts from the sim, a buyer and a seller:

```sh
fresh() { curl -s -X POST http://127.0.0.1:8780/accounts; }
B=$(fresh); S=$(fresh)
BUYER=$(echo "$B" | jq -r .address); BUYER_KEY=$(echo "$B" | jq -r .privateKey)
BUYER_ENC_PUB=$(echo "$B" | jq -r .encryptionPublicKey); BUYER_ENC=$(echo "$B" | jq -r .encryptionSecretKey)
SELLER=$(echo "$S" | jq -r .address); SELLER_KEY=$(echo "$S" | jq -r .privateKey)
SIM=$(curl -s http://127.0.0.1:8780/); CLUB=$(echo "$SIM" | jq -r .clubId)
read PRIMARY FALLBACK APPEAL <<< "$(echo "$SIM" | jq -r '[.adjudicators[].address] | join(" ")')"
curl -s $API/v1/balances/$BUYER    # {"token":"tUSD","amount":"10000000000"}: 10,000 tUSD
```

The adjudicators publish their registrations; the policy and registry hashes in your terms come from there:

```sh
curl -s $API/v1/adjudicators/$PRIMARY | jq '{name, policyHash, registry, fee}'
curl -s $API/v1/clubs/$CLUB | jq .rulebook
```

## 3. Prepare, verify, sign, submit

Every step has the same shape. `POST /v1/prepare/<kind>` returns the EIP-712 typed data to sign, its digest, a `check` list in words, and the body to submit with empty signature slots. That answer is a proposal. **Verify before you sign:** `examples/sign.ts` rebuilds the message from your own intent (the request you sent, or the terms you agreed to), with your pinned domain and the schema's types, takes from the operator only a nonce and a time near your clock, and refuses on any other difference. Then it signs the typed data it built and prints the body it built. docs/api.md ("Verify before you sign") lists every field it checks.

```sh
submit() { curl -s "$API$(jq -r .submit.path $1)" -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -d @$2; }
```

**Seller offers.** A `checks-only` template: the declarative checks alone decide, so no judge panel sits. The request is the seller's intent; keep it.

```sh
cat > offer.request.json <<EOF
{ "template": "checks-only", "clubId": "$CLUB", "seller": "$SELLER",
  "buyer": { "address": "$BUYER", "encryptionPublicKey": "$BUYER_ENC_PUB" },
  "adjudicators": { "primary": "$PRIMARY", "fallback": "$FALLBACK", "appeal": "$APPEAL" },
  "price": { "token": "tUSD", "amount": "25000000" },
  "deliverable": { "kind": "dataset", "description": "customers.csv, one row per customer", "format": "text/csv" },
  "checks": [ { "id": "cols", "type": "csv_columns_exact", "required": true, "columns": ["customer_id", "email"] },
              { "id": "rows", "type": "row_count_range", "required": true, "min": 3, "max": 3 } ] }
EOF
curl -s $API/v1/prepare/offer -H 'content-type: application/json' -d @offer.request.json > offer.json
jq .check offer.json
HOLDBACK_KEY=$SELLER_KEY node examples/sign.ts offer.json offer.request.json > offer.body.json
submit offer.json offer.body.json | jq .escrowState      # "Offered"
ID=$(jq -r .id offer.body.json)
```

`offer.body.json` is the signed offer. The seller sends it to the buyer, agent to agent; the buyer checks it before agreeing.

The primary adjudicator accepts the offer within a moment:

```sh
curl -s $API/v1/commitments/$ID | jq .escrowState        # "AcceptedByAdjudicator"
```

**Buyer agrees and funds** price plus fee in one call. Its intent: the terms it was sent, and the most it will hold.

```sh
jq '{terms: ., maxTotal: "30000000"}' offer.body.json > agree.intent.json
curl -s $API/v1/prepare/agree-and-fund -H 'content-type: application/json' -d "{\"commitmentId\": \"$ID\"}" > agree.json
HOLDBACK_KEY=$BUYER_KEY HOLDBACK_ENCRYPTION_KEY=$BUYER_ENC node examples/sign.ts agree.json agree.intent.json > agree.body.json
submit agree.json agree.body.json | jq '{escrowState, hold}'   # "Held", 26000000
```

`sign.ts` refuses if the terms name another buyer, seal the work to a key the buyer does not hold, cost more than `maxTotal`, or do not hash to `$ID`.

**Seller delivers.** The work is encrypted before it leaves the seller: AES-256-GCM under a fresh key, the key sealed to each adjudicator and to the buyer. `examples/seal.ts` takes the buyer's key from the terms the seller signed and each adjudicator's key from its registration as both operators serve it, cross-checks the operator's `/recipients`, uploads the ciphertext, verifies the prepared delivery, signs and submits it (format and test vectors: docs/api.md, "Encrypting a delivery"):

```sh
curl -s $API/v1/commitments/$ID/recipients | jq '.recipients'
printf 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n' > customers.csv
HOLDBACK_KEY=$SELLER_KEY node examples/seal.ts offer.body.json customers.csv   # {"escrowState":"Delivered"}
```

## 4. Read the result

The adjudicator decrypts, runs the checks and decides. On accept, the seller is paid and the buyer's key is released in the same step:

```sh
curl -s $API/v1/commitments/$ID | jq '{escrowState, finalAt, deadlines}'   # "Released"
curl -s "$API/v1/commitments/$ID/events?limit=200" | jq -r '.items | reverse | .[] | [.seq, .type, (.payload.recipient // "")] | @tsv'
curl -s $API/v1/commitments/$ID/judgment | jq '{deterministic, panel: .panel.ran, decision: .aggregate.decision}'
curl -s "$API/v1/commitments/$ID/key?recipient=$BUYER" | jq '.items | length'   # 1: the buyer's envelope
HOLDBACK_KEY=$BUYER_KEY HOLDBACK_ENCRYPTION_KEY=$BUYER_ENC node examples/open.ts $ID
curl -s $API/v1/balances/$BUYER; curl -s $API/v1/balances/$SELLER       # 9,974 and 10,025 tUSD
```

Two `key.released` events appear: `payload.recipient` says whose key each is. The first, right after delivery, is the primary adjudicator's, so it can judge; the second is the buyer's, released with payment. The commitment is final (`finalAt`) once the appeal window closes with no appeal, at `deadlines.appealBy`; the sim's clock follows the wall clock, and `curl -s -X POST http://127.0.0.1:8780/advance -d '{"seconds": 600}'` moves it on.

Try a bad delivery (two rows instead of three): the checks fail, the buyer is refunded 25 tUSD, gets no key, and the 1 tUSD fee stays with the adjudicator.

Other steps follow the same pattern: `early-accept`, `appeal` and `settlement` (a co-signed split; both parties sign the same typed data). `examples/sign.ts` lists the intent each takes. Timeouts are permissionless triggers: `POST $API/v1/commitments/$ID/triggers/fallback` and the others in docs/api.md.

## Signing in your language

The principle in any language: build the message yourself from your intent, with your pinned domain and the schema's types; compare its EIP-712 hash with the operator's `digest`; sign only on a match, and submit your own body. A digest check alone proves nothing: the operator chose both the typed data and the digest.

TypeScript (viem) with `examples/verify.ts`, which holds the pinned types and a builder for every kind:

```ts
import { privateKeyToAccount } from 'viem/accounts';
import { verifyPrepared, configuredDomain } from './verify.ts';

const account = privateKeyToAccount(process.env.HOLDBACK_KEY);
// intent: what you asked for, e.g. { kind: 'agree-and-fund', terms, me, encryptionPublicKey, maxTotal: 30_000_000n }
const { path, body, toSign } = verifyPrepared(prepared, intent, account.address, configuredDomain()); // throws on any difference
for (const s of toSign) {
  const keys = s.slot.split('.');
  keys.slice(0, -1).reduce((o, k) => o[k], body)[keys.at(-1)] = await account.signTypedData(s.typed);
}
// POST body to path with an Idempotency-Key header
```

Python (eth-account; not run in this repository's CI), for an agreement, building the message from the terms you were sent:

```python
import os
from datetime import datetime
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak

DOMAIN = {"name": "Holdback", "version": "0.6", "chainId": 31337, "verifyingContract": "0x00000000000000000000000000000000484f4c44"}
TYPES = {"EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                          {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
         "Agree": [{"name": "commitmentId", "type": "bytes32"}, {"name": "buyer", "type": "address"},
                   {"name": "nonce", "type": "bytes32"}, {"name": "expiresAt", "type": "uint64"}]}
account = Account.from_key(os.environ["HOLDBACK_KEY"])
assert terms["buyer"].lower() == account.address.lower(), "the terms name another buyer"
op = prepared["sign"][0]  # the operator's proposal: take only the nonce from it
msg = {"commitmentId": commitment_id, "buyer": terms["buyer"], "nonce": op["typedData"]["message"]["nonce"],
       "expiresAt": int(datetime.fromisoformat(terms["timing"]["offerExpiresAt"].replace("Z", "+00:00")).timestamp())}
td = {"domain": DOMAIN, "types": TYPES, "primaryType": "Agree", "message": msg}
m = encode_typed_data(full_message=td)
assert "0x" + keccak(b"\x19" + m.version + m.header + m.body).hex() == op["digest"], "not the message you intend"
signature = "0x" + bytes(Account.sign_typed_data(account.key, full_message=td).signature).hex()
```

`commitment_id` is the EIP-712 struct hash of the terms you checked (`commitmentIdOf` in `examples/verify.ts` shows the encoding). Encrypting a delivery in Python uses PyNaCl (`nacl.public.Box`) for the envelope and `cryptography`'s `AESGCM` for the content, following the byte layouts and test vectors in docs/api.md.

## Where next

- docs/api.md: every endpoint, the prepare inputs, what to verify, the envelope spec, checks and rubric, who gets what, triggers and events.
- `examples/agent.ts` and `examples/verify.ts`: an agent in TypeScript with no Holdback package.
- docs/neutrality.md: why no operator, adjudicator or maintainer can stop a valid deal; the escape hatch.
