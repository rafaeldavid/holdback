# Quickstart: your first deal in ten minutes

You will run a local Holdback world and settle one deal through the HTTP API: a seller offers a dataset, a buyer holds the money, the seller delivers it encrypted, an adjudicator checks it, and payment and the decryption key are released together. Every message is signed by the party that sends it, with a standard EIP-712 library; the operator only prepares and relays.

**Nothing here is real.** The world runs on SimChain, an in-process settlement layer. The token is tUSD, a test token with **6 decimals** (25 tUSD is `"25000000"`). Every key is a test key derived from a public label. The adjudicators use **fake judges**: no model runs, and every judgment record says so (`placeholder-` model IDs, verdicts starting `[fake judge, no model ran]`). No real money moves, and nothing can.

Two economics to know before you start: the buyer holds the price **plus the adjudication fee**, and **the fee is kept on a refund** (a refunded buyer gets the price back, not the fee). An appeal costs a bond of 5% of the price plus a 25 tUSD fee.

## 1. Install, build, start the sim

Node 22 and pnpm (through corepack), then:

```sh
corepack enable
pnpm install
pnpm build
pnpm sim
```

`pnpm sim` keeps running and prints two operator nodes (`http://127.0.0.1:8787` and `:8788`), a sim service (`http://127.0.0.1:8780`) that lists the funded test accounts with their keys, three test adjudicators, and the club's economics. Leave it running and open a second terminal.

**In a hurry?** `pnpm example buy-dataset` and `pnpm example sell-translation` run whole deals (`examples/`); they start their own sim if none is running. The rest of this page does the same deal step by step with curl.

## 2. Discover the API

An operator publishes what you need at a well-known address: the API base, the EIP-712 domain you sign under, the operator's receipt key and the settlement target.

```sh
curl -s http://127.0.0.1:8787/.well-known/holdback.json | jq
export API=http://127.0.0.1:8787
```

Take two test accounts from the sim, a buyer and a seller:

```sh
SIM=$(curl -s http://127.0.0.1:8780/)
acct() { echo "$SIM" | jq -r ".accounts[] | select(.label==\"$1\") | .$2"; }
BUYER=$(acct buyer-1 address); BUYER_KEY=$(acct buyer-1 privateKey); BUYER_ENC_PUB=$(acct buyer-1 encryptionPublicKey); BUYER_ENC=$(acct buyer-1 encryptionSecretKey)
SELLER=$(acct seller-1 address); SELLER_KEY=$(acct seller-1 privateKey)
CLUB=$(echo "$SIM" | jq -r .clubId)
read PRIMARY FALLBACK APPEAL <<< "$(echo "$SIM" | jq -r '[.adjudicators[].address] | join(" ")')"
curl -s $API/v1/balances/$BUYER    # {"token":"tUSD","amount":"10000000000"}: 10,000 tUSD
```

The adjudicators publish their registrations; the policy and registry hashes in your terms come from there:

```sh
curl -s $API/v1/adjudicators/$PRIMARY | jq '{name, policyHash, registry, fee}'
curl -s $API/v1/clubs/$CLUB | jq .rulebook
```

## 3. Prepare, verify, sign, submit

Every step has the same shape. `POST /v1/prepare/<kind>` returns the EIP-712 typed data to sign, its digest, a `check` list in words, and the body to submit with empty signature slots. You read the typed data, sign it with your own key, and POST the body to the path it names. Signing below uses `examples/sign.ts` (viem; the same 15 lines are under "Signing in your language").

**Verify before you sign.** The typed data is what your signature authorizes. Check the counterparty, the amounts, the adjudicators and, in a settlement, the payouts, in the typed data itself (docs/api.md, "Verify before you sign").

```sh
submit() { curl -s "$API$(jq -r .submit.path $1)" -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -d @$2; }
```

**Seller offers.** A `checks-only` template: the declarative checks alone decide, so no judge panel sits.

```sh
curl -s $API/v1/prepare/offer -H 'content-type: application/json' -d @- > offer.json <<EOF
{ "template": "checks-only", "clubId": "$CLUB", "seller": "$SELLER",
  "buyer": { "address": "$BUYER", "encryptionPublicKey": "$BUYER_ENC_PUB" },
  "adjudicators": { "primary": "$PRIMARY", "fallback": "$FALLBACK", "appeal": "$APPEAL" },
  "price": { "token": "tUSD", "amount": "25000000" },
  "deliverable": { "kind": "dataset", "description": "customers.csv, one row per customer", "format": "text/csv" },
  "checks": [ { "id": "cols", "type": "csv_columns_exact", "required": true, "columns": ["customer_id", "email"] },
              { "id": "rows", "type": "row_count_range", "required": true, "min": 3, "max": 3 } ] }
EOF
jq .check offer.json
HOLDBACK_KEY=$SELLER_KEY node examples/sign.ts offer.json > offer.body.json
submit offer.json offer.body.json | jq .escrowState      # "Offered"
ID=$(jq -r .commitmentId offer.json)
```

The primary adjudicator accepts the offer within a moment:

```sh
curl -s $API/v1/commitments/$ID | jq .escrowState        # "AcceptedByAdjudicator"
```

**Buyer agrees and funds** price plus fee in one call:

```sh
curl -s $API/v1/prepare/agree-and-fund -H 'content-type: application/json' -d "{\"commitmentId\": \"$ID\"}" > agree.json
jq .check agree.json
HOLDBACK_KEY=$BUYER_KEY node examples/sign.ts agree.json > agree.body.json
submit agree.json agree.body.json | jq '{escrowState, hold}'   # "Held", 26000000
```

**Seller delivers.** The work is encrypted before it leaves the seller: AES-256-GCM under a fresh key, the key sealed to each adjudicator and to the buyer. `examples/seal.ts` does it with Web Crypto and tweetnacl (the format is specified, with test vectors, in docs/api.md, "Encrypting a delivery"). It reads who to seal to and uploads the ciphertext:

```sh
curl -s $API/v1/commitments/$ID/recipients | jq '.recipients'
printf 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n' > customers.csv
HOLDBACK_API=$API node examples/seal.ts $ID customers.csv > delivery.json   # POST /v1/ciphertext, then /v1/prepare/delivery
HOLDBACK_KEY=$SELLER_KEY node examples/sign.ts delivery.json > delivery.body.json
submit delivery.json delivery.body.json | jq .escrowState   # "Delivered"
```

## 4. Read the result

The adjudicator decrypts, runs the checks and decides. On accept, the seller is paid and the buyer's key is released in the same step:

```sh
curl -s $API/v1/commitments/$ID | jq '{escrowState, finalAt, deadlines}'   # "Released"
curl -s "$API/v1/commitments/$ID/events?limit=200" | jq -r '.items | reverse | .[] | [.seq, .type, (.payload.recipient // "")] | @tsv'
curl -s $API/v1/commitments/$ID/judgment | jq '{deterministic, panel: .panel.ran, decision: .aggregate.decision}'
curl -s "$API/v1/commitments/$ID/key?recipient=$BUYER" | jq '.items | length'   # 1: the buyer's envelope
HOLDBACK_API=$API HOLDBACK_KEY=$BUYER_KEY HOLDBACK_ENCRYPTION_KEY=$BUYER_ENC node examples/open.ts $ID
curl -s $API/v1/balances/$BUYER; curl -s $API/v1/balances/$SELLER       # 9,974 and 10,025 tUSD
```

Two `key.released` events appear: `payload.recipient` says whose key each is. The first, right after delivery, is the primary adjudicator's, so it can judge; the second is the buyer's, released with payment. The commitment is final (`finalAt`) once the appeal window closes with no appeal; the sim's clock follows the wall clock, and `curl -s -X POST http://127.0.0.1:8780/advance -d '{"seconds": 600}'` moves it on.

Try a bad delivery (two rows instead of three): the checks fail, the buyer is refunded 25 tUSD, keeps no key, and the 1 tUSD fee stays with the adjudicator.

Other steps follow the same pattern: `early-accept`, `appeal` and `settlement` (a co-signed split; both parties sign the same typed data). Timeouts are permissionless triggers: `POST $API/v1/commitments/$ID/triggers/fallback` and the others in docs/api.md.

## Signing in your language

The operator sends integers as decimal strings (amounts can exceed 2^53). Convert every `uint*` field to an integer using `types`, check the hash against `digest`, then sign.

TypeScript (viem), as in `examples/sign.ts`:

```ts
import { hashTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ints = (types, type, v) =>
  type.endsWith('[]') ? v.map((x) => ints(types, type.slice(0, -2), x))
  : types[type] ? Object.fromEntries(types[type].map((f) => [f.name, ints(types, f.type, v[f.name])]))
  : /^u?int\d*$/.test(type) ? BigInt(v) : v;

const account = privateKeyToAccount(process.env.HOLDBACK_KEY);
for (const s of prepared.sign.filter((x) => x.signer.toLowerCase() === account.address.toLowerCase())) {
  const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) };
  if (hashTypedData(typed) !== s.digest) throw new Error('digest mismatch: do not sign');
  const path = s.slot.split('.');
  path.slice(0, -1).reduce((o, k) => o[k], prepared.submit.body)[path.at(-1)] = await account.signTypedData(typed);
}
// POST prepared.submit.body to prepared.submit.path with an Idempotency-Key header
```

Python (eth-account; not run in this repository's CI):

```python
import os
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak

def ints(types, t, v):
    if t.endswith("[]"): return [ints(types, t[:-2], x) for x in v]
    if t in types: return {f["name"]: ints(types, f["type"], v[f["name"]]) for f in types[t]}
    return int(v) if t.startswith(("uint", "int")) else v

account = Account.from_key(os.environ["HOLDBACK_KEY"])
for s in [s for s in prepared["sign"] if s["signer"].lower() == account.address.lower()]:
    td = dict(s["typedData"], message=ints(s["typedData"]["types"], s["typedData"]["primaryType"], s["typedData"]["message"]))
    m = encode_typed_data(full_message=td)
    assert "0x" + keccak(b"\x19" + m.version + m.header + m.body).hex() == s["digest"], "digest mismatch: do not sign"
    *parents, last = s["slot"].split(".")
    node = prepared["submit"]["body"]
    for k in parents: node = node[k]
    node[last] = "0x" + bytes(Account.sign_typed_data(account.key, full_message=td).signature).hex()
```

Encrypting a delivery in Python uses PyNaCl (`nacl.public.Box`) for the envelope and `cryptography`'s `AESGCM` for the content, following the byte layouts and test vectors in docs/api.md.

## Where next

- docs/api.md: every endpoint, the prepare inputs, the envelope spec, triggers and events.
- `examples/agent.ts`: an agent in about 100 lines of TypeScript with no Holdback package.
- docs/neutrality.md: why no operator, adjudicator or maintainer can stop a valid deal; the escape hatch.
