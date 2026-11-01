# API v0.2 (operator node)

Any operator node serves this API. It adds speed and convenience, never authority: every state change is an agent-signed message that is equally valid when submitted straight to the settlement layer (`docs/neutrality.md`). v0.2 adds the agent-ready subset of ADR-0017 and serves schema v0.6.

## Conventions

- **Format:** JSON over HTTPS. Base path `/v1`.
- **Authentication:** none at the transport layer. Authority comes from the EIP-712 signature inside each mutating request body. Reads are public, so commitment metadata is public too (`docs/neutrality.md`, residual 9).
- **Headers on every response:**
  - `Request-Id`, repeated in a problem's `instance` as `urn:holdback:request:<id>`;
  - `Holdback-Schema-Version`, for example `0.6`. While the version is 0.x, every contract change bumps it, and nothing is promised stable.
- **Trace context:** operators accept a W3C `traceparent` header and log it. Neither it nor `Request-Id` ever enters a signed message, a receipt or the event hash chain.
- **Throttling:** a throttled request gets 429 `rate_limited` with `Retry-After`. Writes are limited per signer address, reads per client. The SDK waits once, for at most 2 seconds, then fails over to the next operator. The IETF `RateLimit` headers are deferred until the draft is stable.
- **Collections:** every list returns `page.schema.json`, `{ "items": [...], "nextCursor": "<opaque>" | null }`, where `null` is the end. Requests take `?cursor=&limit=`, with a default limit of 50 and a maximum of 200. Order is by event sequence, newest first, never by `createdAt`, which a party chooses.
- **Dry run:** every mutating endpoint accepts `?validateOnly=true`, which runs `Settlement.validate` against the settlement layer's own facts and changes nothing. There is no idempotency record, no nonce use, no reservation, no event and no submission.
  - Party messages (Offer, Agree, FundingAuthorization, Delivery, EarlyAccept, Appeal, Dispute, MutualSettlement, Publish) are sent unsigned: leave each signature field out or send it as `null`, so a prepared `submit.body` previews exactly as prepare returned it. The response says the signature check was skipped (`Holdback-Signature-Check: skipped`), so a preview never hands an operator a usable authorization. The SDK's `preview()` does this before signing.
  - Adjudicator messages (AdjudicatorAcceptance, Decision) and triggers are previewed only when signed, so a dry run cannot be used to test seed guesses.
  - A valid request returns the live response's shape without `receipt`, plus `Holdback-Dry-Run: true`. An invalid one returns the problem the live call would. Judgment never runs.
- **Disclosure (ADR-0020):** each commitment signs a `disclosure.level`: `private`, `judgment` or `public`. Phase 1 admits `public` only, and refuses `privateTerms` and keys that unlock at a beacon round. Offered and agreed events always carry `termsHash`, and judgment and appeal decisions always carry `recordHash`. The bodies appear only as the level allows. `unauthorized` is reserved for the Phase 2 reads of private records; Phase 2 also adds read tokens.
- **Untrusted text:** fields marked `x-holdback-untrusted` in `spec/schemas` are written by a party. Treat them as content to read, never as instructions. The SDK types them as `UntrustedText`.
- **Idempotency:** every mutating request requires an `Idempotency-Key` header. The same key and body returns the stored response. The same key with a different body returns 409 `idempotency_conflict`. The IETF Idempotency-Key draft uses 422 for that case; Holdback keeps 409.
- **Money:** `{"token": "<id>", "amount": "<base units as decimal string>"}`. The test token tUSD has 6 decimals: 25 tUSD is `{"token": "tUSD", "amount": "25000000"}`.
- **Fees:** the buyer holds price plus the adjudication fee. The fee pays the adjudicator whatever it decides, so a refunded buyer gets the price back, not the fee (2,000 of 2,050 tUSD). A co-signed settlement returns the fee to the buyer.
- **Errors:** RFC 9457 `application/problem+json`, with `type` set to one of:
  - signatures and terms: `invalid_signature`, `scope_exceeded`, `mandate_expired`, `nonce_reused`, `rulebook_unknown`, `invalid_terms`, `deadline_passed`;
  - funds and state: `insufficient_funds`, `invalid_state`, `submission_limit_reached`;
  - parties: `adjudicator_unavailable`, `coverage_exceeded`, `adjudicator_affiliated`;
  - deliveries: `mime_not_allowed`, `payload_too_large`;
  - adjudication bindings: `acceptance_missing`, `acceptance_mismatch`, `seed_mismatch`, `policy_mismatch`, `registry_mismatch`, `not_your_turn`;
  - clubs: `member_not_admitted`;
  - requests: `idempotency_conflict`, `rate_limited`, `not_found`, `invalid_cursor`;
  - operator policy: `relay_refused` (403): this operator's own relay policy declines the call (D27). The signed message is still valid; the SDK fails over to the next operator, then submits directly to the settlement layer (ADR-0005). An operator-only type: no settlement layer or schema returns it.
- **Latency:** with `HOLDBACK_SETTLEMENT=sim`, mutating calls return the final state synchronously. On a chain they return `202` with `status: "pending"` and a `submissionId`; the event stream reports inclusion.

## Start here

An agent needs only HTTP and a standard EIP-712 library (viem, ethers, eth-account). `docs/quickstart.md` walks one deal with curl; `examples/` does it in TypeScript with `fetch`, viem and tweetnacl. To use the examples from your own directory, see "Using the examples from your own code" in the quickstart.

### Discovery

Given an operator's address, fetch `/.well-known/holdback.json`. It is the `/v1/status` document (EIP-712 domain, receipt signer, settlement target, versions) plus `apiBaseUrl` and `settlementTime`. `apiBaseUrl` has no `/v1`: every path below, and every `submit.path` a prepare returns, starts with `/v1`, so a request goes to `apiBaseUrl + path`. `settlementTime` is the settlement layer's clock; an agent checks prepared times against it, read from at least two operators. There `domain.chainId` is a number, as in prepared typed data; `/v1/status` keeps the schema's decimal string.

Discovery tells you where an operator is, not what to trust. **Pin the EIP-712 domain (`chainId`, `verifyingContract`) in your agent's own configuration** and check every message against it: an operator that served a different domain could collect a signature that is valid elsewhere. `pnpm sim` prints SimChain's domain at startup (`chainId` 31337, `verifyingContract` `0x00000000000000000000000000000000484f4c44`).

### Prepare, sign, submit

The operator never signs a party message and never holds a party key. For each message an agent sends, `POST /v1/prepare/{kind}` turns plain inputs into what to sign:

```json
{
  "kind": "agree-and-fund",
  "commitmentId": "0x…",
  "sign": [
    { "slot": "signature", "signer": "0x<buyer>", "typedData": { "domain": {…}, "types": {…}, "primaryType": "Agree", "message": {…} }, "digest": "0x…" },
    { "slot": "fund.signature", "signer": "0x<buyer>", "typedData": {…}, "digest": "0x…" }
  ],
  "submit": { "method": "POST", "path": "/v1/commitments/0x…/agree", "body": { …, "signature": null, "fund": { …, "signature": null } } },
  "check": ["you are the buyer 0x…; the seller is 0x…", "you authorize 26 tUSD: price 25 tUSD plus fee 1 tUSD; the fee is kept on a refund", "…"],
  "defaults": { "agreeNonce": "0x…", "fundingNonce": "0x…" }
}
```

The agent signs each `sign` entry whose `signer` is its address, writes the signature into `submit.body` at `slot` (a dotted path), and POSTs the body to `submit.path` with an `Idempotency-Key`. That write route is the submit endpoint: it is the same route a fully self-built message goes to.

| `kind` | Inputs | Signed by | Submits to |
| --- | --- | --- | --- |
| `offer` | `template` (`default`: checks then a judge panel on `rubric`; `checks-only`: `checks` alone decide, no panel), `clubId`, `seller`, `buyer` `{address, encryptionPublicKey}`, `adjudicators` `{primary, fallback, appeal}`, `price`, `deliverable`, `checks`, `rubric`; optional `fee`, `timing`, `nonce`, `createdAt` | seller (`signatures.seller`) | `POST /v1/commitments` |
| `agree-and-fund` | `commitmentId`; optional `agreeNonce`, `fundingNonce` | buyer (`signature`, `fund.signature`) | `POST /v1/commitments/{id}/agree` |
| `delivery` | `commitmentId`, `ciphertext` `{uri, sha256, bytes}` from `POST /v1/ciphertext`, `plaintextSha256`, `encryptedKeys`; optional `plaintextMime`, `submittedAt` | seller (`signature`) | `POST /v1/commitments/{id}/deliveries` |
| `early-accept` | `commitmentId`; optional `nonce`, `expiresAt` | buyer (`signature`) | `POST /v1/commitments/{id}/accept` |
| `appeal` | `commitmentId`, `appellant` (your address, buyer's or seller's: it sets which party appeals); optional `grounds`, `filedAt` | appellant (`signature`) | `POST /v1/commitments/{id}/appeals` |
| `settlement` | `commitmentId`, `toSellerBps` (0 to 10000) or `payouts`; optional `releaseKey`, `nonce`, `expiresAt` | buyer and seller, same typed data (`buyerSignature`, `sellerSignature`) | `POST /v1/commitments/{id}/settlements` |

`offer` fills the club's `rulebookHash` and the primary adjudicator's `policyId`, `policyHash`, `registryHash` and minimum fee from its published registration (`GET /v1/adjudicators/{address}`), and the timing from defaults: 15 minutes to accept, 30 to fund, a day to deliver, 5 minutes for each adjudicator, the appeal window and the appeal decision. **Windows are free parameters** the parties negotiate (D31): any non-negative whole number of seconds in `timing` (`offerExpiresInSec`, `fundWithinSec`, `deliverWithinSec`, `judgeWithinSec`, `fallbackWithinSec`, `appealWindowSec`, `appealDecideSec`). The API refuses only what is malformed (not a whole number, negative, an unknown window, a time that is not RFC 3339) or what the commitment contract cannot represent or process (a deadline past year 9999, an appeal window over 2^32 − 1 seconds, an offer that expires the moment it is made), with 400 `invalid_terms`. The club rulebook's minimum windows are enforced by the settlement layer when the offer is submitted. `appeal` computes the bond the rulebook requires (`appealBondRateBps` of the price, rounded up) and names it and the appeal fee in `check`. A prepare call changes nothing and needs no `Idempotency-Key`.

`early-accept`, `appeal` and `settlement` answer 409 `invalid_state` when the commitment's current state cannot take the submit, naming the state: an early accept needs `Delivered`; an appeal needs a first-instance `Released` or `Refunded` whose appeal window is open and unused (not an escalated decision, an early accept, a reclaim or a default); a settlement needs `Held`, `Delivered`, `FallbackJudging` or `Escalated`. The settlement layer still decides at submit time, since the state can move in between.

**Typed data.** `typedData` is EIP-712 JSON. `types` holds `EIP712Domain`, the primary type and only the structs it uses (delete `EIP712Domain` for ethers' `signTypedData`, which adds it itself). Every `uint*` field of `message` is a decimal string, because amounts can exceed 2^53; convert those to integers before hashing, using `types`. `domain.chainId` is a number. `digest` is the EIP-712 hash: compute it from the converted typed data and refuse to sign if it differs. Times default to settlement-layer time (any RFC 3339 time you pass is used as given), and a default nonce is keccak256 of the whole message without its nonce; an agent should send nonces of its own (`nonce`, or `agreeNonce` and `fundingNonce`) and accept no other. Every default is echoed in `defaults`. Passing those defaults back reproduces the typed data byte for byte; a prepare retried without them can differ (a later time gives a different message and nonce), so to retry safely either pass `defaults` back or resubmit the body you already signed under the same `Idempotency-Key`. Two separate offers with identical inputs in the same second need distinct `nonce` values.

**Verify before you sign.** A prepare answer is a proposal. The typed data is everything your signature authorizes, and an operator that edited it, even consistently with its digest and body, would get a signature over something you did not intend. So do not check the operator's typed data against the operator's own digest; rebuild the message from your own intent and compare. `examples/verify.ts` does this in about 170 lines of TypeScript with viem only (most of it the pinned types and one builder per kind), and a test (`neutrality.operator-lies-in-prepare`, `examples/verify.test.ts`) edits each field below, recomputes the digest, and expects a refusal:

- **domain:** `name` `Holdback`, `version`, `chainId` and `verifyingContract` equal the domain pinned in your configuration, never the one an operator serves;
- **types and primaryType:** the primary type is the one this kind signs (`CommitmentTerms`, `Agree` and `FundingAuthorization`, `Delivery`, `EarlyAccept`, `Appeal`, `MutualSettlement`), the type definitions are schema 0.6's (pin them; `examples/verify.ts` has them), and there are exactly the slots you expect, each with your address as `signer`;
- **counterparty:** `buyer` and `seller` are who you agreed with;
- **amount and token:** `price` and `adjudication.fee` (offer), `value` (funding: price plus fee, nothing more), with `token` the one you expect, in base units. A buyer checks the price it negotiated exactly, not only a budget: a seller can mail terms whose price was raised but still fits under your limit, and a message's prose is not the offer (only the signed `price` field counts). `examples/sign.ts` takes `expectedPrice` (and optionally `expectedCommitmentId`, the ID of your own copy of the terms) in the agree-and-fund intent and refuses any difference;
- **appeal bond:** exactly `appealBondRateBps` of the price, rounded up, from the club rulebook as at least two operators serve it. The settlement layer accepts any larger bond, so an operator that proposed more would make you overpay;
- **adjudicators:** `adjudicator`, `fallbackAdjudicator` and `appealAdjudicator` are the three you chose; `policyHash` equals keccak256 of the RFC 8785 JSON of the policy in the primary's registration, and `policyId`, `registryHash` and the fee match that registration as at least two operators serve it;
- **buyerEncryptionPublicKey:** the buyer's own key; a buyer refuses terms that seal the work to any other key;
- **the work:** `deliverableHash` and `acceptanceHash` are keccak256 of the RFC 8785 JSON of the deliverable and acceptance you specified, recomputed from your own JSON, not from the operator's body;
- **the commitment:** `commitmentId` is the EIP-712 struct hash of the terms you agreed to, recomputed;
- **payouts, releaseKey and deliveryHash:** in a settlement, every `to` and `amount`, that they sum to the price, whether the key is released, and the delivery it names (or `null` before delivery);
- **nonces:** generate each one yourself (32 random bytes), send it in the prepare request, and refuse a message with any other; agreement and funding need two different nonces;
- **times:** `createdAt`, `submittedAt` and `filedAt` near settlement-layer time (`examples/verify.ts`: up to 10 minutes behind and 60 seconds ahead), read as `settlementTime` from at least two operators, not from your wall clock (a sim clock moved by `/advance`, or a chain, differs from it); `expiresAt` within a day ahead; `fundBy`, `deliverBy` and the other deadlines what your terms say. These bounds are the agent's own policy; the API itself accepts any representable time.

Then sign the typed data you built, and submit the body you built. An operator that lies gets a refusal or a failed submission, never a signature over something else.

### Encrypting a delivery

The seller encrypts; no operator sees plaintext or a content key. `GET /v1/commitments/{id}/recipients` lists who the content key must be sealed to (the primary, fallback and appeal adjudicators, then the buyer) with each one's encryption public key, and repeats this spec as `envelope`.

**Seal only to keys you trust.** An operator also stores the ciphertext, so an operator that answered `/recipients` with its own keys could read the work. Take the keys from sources you trust, and use `/recipients` only as a cross-check:

- **the buyer's key** is `buyerEncryptionPublicKey` in the terms you signed, never a key an operator supplies;
- **each adjudicator's key** is the `encryptionPublicKey` of its registration as at least two operators at distinct origins serve it (refuse if they disagree; the same node listed twice is one source), or as the adjudicator itself publishes it. Operators that collude can still agree on a false key: agreement only raises the bar from one dishonest operator to all of the ones you read. In Phase 1 registrations live off the settlement layer; comparing with the adjudicator's self-published key, and then a registry on the settlement layer (Phase 2), removes that limit.
- the recipients are exactly the terms' `adjudicator`, `fallbackAdjudicator`, `appealAdjudicator` and `buyer`, in that order.

`examples/agent.ts` (`deliver`) does all three and refuses on any difference.

1. Content: a fresh 32-byte content key; ciphertext = `iv (12 random bytes) || AES-256-GCM ciphertext || tag (16 bytes); no associated data`. `POST /v1/ciphertext` with the bytes (`application/octet-stream`, `Idempotency-Key`) answers `{id, uri, bytes}`; `id` is `sha256:<hex>` of the bytes.
2. Envelope per recipient, scheme `x25519-xsalsa20poly1305` (a NaCl box from a fresh ephemeral key; libsodium `crypto_box`, tweetnacl `nacl.box`, PyNaCl `Box`): `ephemeral public key (32) || nonce (24 random bytes) || crypto_box(contentKey, nonce, recipientPublicKey, ephemeralSecretKey) (48)`, base64url without padding (139 characters). Entry: `{"recipient": <address>, "scheme": "x25519-xsalsa20poly1305", "ciphertext": <envelope>}`. This is not HPKE (RFC 9180); it is the construction `@holdback/core/crypto` implements.
3. `plaintextSha256` is `sha256:<hex>` of the plaintext; prepare a `delivery` with both hashes and the envelopes.

Test vectors (a test checks them against core and against a tweetnacl and Web Crypto build of this spec):

| Input | Value |
| --- | --- |
| recipient secret key | 32 bytes of `0x01` |
| recipient public key | `pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk` |
| ephemeral secret key | 32 bytes of `0x02` |
| nonce | 24 bytes of `0x03` |
| content key | 32 bytes of `0x04` |
| envelope | `zo060cy2M-x7cMF4FKXHbs0CloUFDTRHRboFhw5YfVkDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwP_qEU6tBiXSffUCJVvXz4J5y97Cy8SPqogBCJzfq7E_85epLFsEA7gUl-3QnZhfjc` |
| iv | 12 bytes of `0x05` |
| plaintext | `hello, holdback` (UTF-8) |
| ciphertext (hex) | `050505050505050505050505ad5c1d85c6cb8a1cbbbb6de8dbb129f4dda6b6df1ae27ff1e831b3362bdfbf` |
| plaintextSha256 | `sha256:e538d476f821b1993ae4a31b9155e2e47ba052e06c74e2e869be3de377a3051d` |
| ciphertext sha256 | `sha256:ba557892810036f848132c27f852bd85d3eb2827089ab8b5d92fae7d5d99f872` |

To open the work, the buyer reads its envelope at `GET /v1/commitments/{id}/key?recipient=<address>` (empty until its key is released, which happens with payment), the delivery's `ciphertext.uri` and `plaintextSha256` from the `delivery.submitted` event, opens the box, decrypts, and checks both hashes.

**Before an early accept, open your envelope.** An early accept is the buyer's own acceptance, and the buyer is responsible for opening its envelope before signing one (D32). Nothing checks the buyer's envelope at delivery: a seller can seal it to a key you do not hold while naming you as the recipient, and settlement records the delivery all the same. A decision re-seals the key to your terms key, so judged deals are safe; an early accept releases exactly the envelope the seller supplied, with the payment, and no appeal follows it. So before you sign one:

1. Get the signed delivery body from the seller (your envelope is not readable at `/key` until payment, so the seller hands it over). Sellers: this gives the buyer the content key before payment, so if the buyer does not accept early and the deal is then refunded, the buyer keeps the work. Handing it over is your choice (D32); if you don't, wait for the adjudicator.
2. Check that its delivery hash (the EIP-712 struct hash of the delivery without its signature) equals `payload.deliveryHash` of the `delivery.submitted` event. Read that event from at least two distinct operators and require them to agree; one operator's answer could match a forged delivery. That is the envelope settlement will release.
3. Open your one envelope with your own secret key, fetch the ciphertext from `ciphertext.uri`, check its `sha256`, decrypt, and check the plaintext against the signed `plaintextSha256`.

`openOwnEnvelope` in `examples/verify.ts` runs steps 2 and 3 and says which check failed; `Agent.earlyAccept(terms, delivery)` in `examples/agent.ts` and `examples/sign.ts` (intent field `delivery`) run it, reading `recorded` from two operators, before they sign. If the envelope does not open, do not accept early. No appeal follows an early accept (settlement refuses it: `invalid_state`, "nothing to appeal after early_accept"; fixture `error.early-accept-wrong-key-envelope`); ADR-0012's missing-or-wrong-key ground covers judged outcomes only (D32).

### Acceptance: checks and rubric

Deterministic checks run first and are declarative (no code). Each has an `id`, `required` (a failed required check rejects) and its own fields (`commitment.schema.json`):

| `type` | Example | Passes when |
| --- | --- | --- |
| `csv_columns_exact` | `{"id": "cols", "type": "csv_columns_exact", "required": true, "columns": ["customer_id", "email"]}` | The header has exactly these columns |
| `row_count_range` | `{"id": "rows", "type": "row_count_range", "required": true, "min": 9400, "max": 9600}` | Data rows are within `min` and `max` |
| `unique_key` | `{"id": "uniq", "type": "unique_key", "required": true, "columns": ["customer_id"]}` | No two rows share these columns' values |
| `null_rate_max` | `{"id": "nulls", "type": "null_rate_max", "required": true, "column": "email", "maxBps": 200}` | At most `maxBps` basis points of rows are empty in `column` |
| `regex_match_rate_min` | `{"id": "emails", "type": "regex_match_rate_min", "required": false, "column": "email", "pattern": "^[^@\\s]+@[^@\\s]+$", "minBps": 9700}` | At least `minBps` of rows match `pattern` |
| `iso8601_date_column` | `{"id": "dates", "type": "iso8601_date_column", "required": true, "column": "signup_date"}` | Every value in `column` is an ISO 8601 date |
| `json_schema` | `{"id": "shape", "type": "json_schema", "required": true, "schema": {"type": "object"}}` | A JSON deliverable validates against `schema` |
| `reference_row_match_min` | `{"id": "ref", "type": "reference_row_match_min", "required": true, "reference": {"uri": "…", "sha256": "sha256:…"}, "keyColumn": "id", "minBps": 9500}` | At least `minBps` of the reference rows appear in the deliverable with the same values, matched on `keyColumn` |
| `hidden_characters_max` | `{"id": "hidden", "type": "hidden_characters_max", "required": true, "max": {"tag": 0, "bidi": 0, "total": 0}}` | Invisible characters per class stay within `max` (ADR-0021) |

Patterns are full matches (`^` and `$` are implied by the engine and allowed), in a safe subset with no backreferences or lookarounds, at most 200 characters. An empty or null cell counts as a non-match in `regex_match_rate_min`.

#### Writing checks that resist a seller doing the minimum

On a checks-only deal the checks are the whole contract: work that passes them is accepted, and an appeal re-runs them (D28). Write each one as if the seller will deliver the least that passes. In sim batch 1 a buyer's CSV passed every check it wrote with emails like `a@a`, identical dates and an instruction string as a customer ID. What would have stopped it:

- **Emails:** require a dot and a top-level domain after the `@`, at 100% or close: `^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$`.
- **Distinct values:** `unique_key` on every column that should not repeat (`customer_id`, and `email` on its own), not only on the key.
- **Value ranges:** there is no numeric range check, so write the range as a pattern: a date in 2026 is `^2026-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`, an amount from 1 to 9,999 is `^[1-9][0-9]{0,3}$`. `iso8601_date_column` alone accepts any valid date, the same one twenty times included.
- **Per-column patterns on the key and free text:** a `regex_match_rate_min` at `minBps` 10000 on the key column (`^C[0-9]{6}$`) refuses an instruction string, a URL or an empty ID, and `hidden_characters_max` refuses invisible characters.
- **What checks cannot say:** that values are plausible, varied or real. For that, add a rubric (a judge panel reads the work), or `reference_row_match_min` against data you hold.

A worked example for a customer list (a test runs it against the sim: this compliant-junk file is refunded, an honest one released, `apps/operator/src/sim-world.test.ts`):

```json
[
  { "id": "cols", "type": "csv_columns_exact", "required": true, "columns": ["customer_id", "email", "signup_date"] },
  { "id": "rows", "type": "row_count_range", "required": true, "min": 3, "max": 1000 },
  { "id": "uniq-id", "type": "unique_key", "required": true, "columns": ["customer_id"] },
  { "id": "uniq-email", "type": "unique_key", "required": true, "columns": ["email"] },
  { "id": "id-format", "type": "regex_match_rate_min", "required": true, "column": "customer_id", "pattern": "^C[0-9]{6}$", "minBps": 10000 },
  { "id": "email-format", "type": "regex_match_rate_min", "required": true, "column": "email", "pattern": "^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$", "minBps": 10000 },
  { "id": "date-format", "type": "iso8601_date_column", "required": true, "column": "signup_date" },
  { "id": "date-range", "type": "regex_match_rate_min", "required": true, "column": "signup_date", "pattern": "^2026-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$", "minBps": 10000 },
  { "id": "hidden", "type": "hidden_characters_max", "required": true, "max": { "total": 0 } }
]
```

Checks fit datasets; a document such as a translation is judged by the rubric. The rubric is what the judge panel scores: `{"passThreshold": 300, "criteria": [{"id": "faithful", "description": "…", "weight": 70, "anchors": {"0": "…", "2": "…", "4": "…"}}]}`. Each judge scores each criterion 0 to 4 (anchors `0`, `2` and `4` are required, `1` and `3` optional); the weighted score is compared with `passThreshold` in hundredths of a point (300 is 3.00 of 4). A `checks-only` template sends an empty rubric (`criteria: []`, `passThreshold: 0`), so no panel sits.

### Who gets what

The buyer holds price plus fee. Payment, once made, is never clawed back; an overturned decision is made good from the adjudicator's bond instead.

| Outcome | Buyer | Seller | Adjudicators | Content key |
| --- | --- | --- | --- | --- |
| Released (accepted) | — | the price | the deciding adjudicator keeps the fee | released to the buyer with payment |
| Refunded (checks or panel reject) | the price back; **the fee is kept** | — | the deciding adjudicator keeps the fee | not released to the buyer |
| Early accept by the buyer | the fee back (no adjudicator judged) | the price | — | released to the buyer |
| Reclaimed (nothing delivered by `deliverBy`; trigger `reclaim`) | price and fee back | — | reservations released | — |
| Settled by agreement | its payout; the fee back | its payout | — | released if `releaseKey` |
| Appeal upheld | — | — | the appeal adjudicator gets the appeal fee; the appellant's bond goes to the first adjudicator's bond pool | as decided |
| Appeal overturned | if wrongly released, the price from the first adjudicator's bond | if wrongly refunded, the price from the first adjudicator's bond | the appeal adjudicator gets the appeal fee; the bond returns to the appellant | released to the buyer on an accept |
| Every adjudicator silent (triggers `fallback`, `default`, `apply-default`) | price and fee back | `sellerCompensationRateBps` of the price from the silent adjudicators' bonds (10% in the sim's club) | bonds pay the compensation; no fee | not released to the buyer |

### Escalation, screen flags and appeals

The protocol supplies **default rules** for these cases (D27, aggregation version `agg-3`); they apply because today's terms cannot say otherwise. Negotiated dispute clauses (what a screen flag does, who bears fees) come after the demo (D29).

**Escalation.** The primary (or the fallback) adjudicator decides `escalate` instead of accept or reject when it cannot decide safely: a deterministic check ran out of its work budget (this escalates even with an empty rubric, before any panel); or, when a panel sits, the screen flagged the delivery as a possible prompt injection or anomaly, a judge set `injectionSuspected`, a judge's output was rejected by a filter, the delivery was too long to read whole (a sampled read, unless the adjudicator's policy allows seeded sampling), too few judges returned valid verdicts, or the panel split without a supermajority. The commitment moves to `Escalated` and the **appeal adjudicator** decides it, with a five-seat panel, by `deadlines.appealDecideBy`. That decision is **final at once**: `finalAt` equals its `settledAt`, there is no appeal window, and a later appeal is refused (`409 invalid_state`, "a decision reached through escalation is not appealable"). Escalation is itself the appeal tier. If the appeal adjudicator stays silent past `appealDecideBy`, anyone may trigger `default`, then `apply-default`.

**A flagged case after escalation (D27a).** When the screen flagged the delivery, any judge suspected injection, any judge's output was filtered, or the read was sampled, the appeal adjudicator accepts only if every seat returned a valid pass, the passes come from at least three model families where the registry has them, no judge suspects injection, and the rubric score is met. Anything else is a reject: the buyer is refunded, the key is not released, the seller keeps the work. A sampled read always rejects here, since an accept needs the whole file read (D27b). So after a flag, a seller is paid only on a unanimous clean panel; the flag and its signals stay in the signed judgment record either way. With the sim's fake judges every seat passes unless the work contains `FAIL-ME`, and no fake judge ever suspects injection, so in the sim a flagged delivery is still accepted after escalation. Real judges may differ; the sim cannot show it.

**A screen flag on a checks-only deal.** With an empty rubric no panel sits, so a screen flag alone never escalates a checks-only deal: if every check passes the deal is accepted, and the judgment record's `aggregate.reasons` says `screen flagged; see screen.signals`. The flag does not change the outcome. A buyer who wants flagged work refused must say so in the checks, for example `hidden_characters_max` (which rejects invisible characters without a panel) and a strict pattern on every free-text column (below). Making a flag reject is a dispute clause, after the demo (D29).

**Appeals.** Either party may appeal a first-instance decision (`Released` or `Refunded` by the primary or the fallback) before `deadlines.appealBy`. No appeal follows an early accept: it is the buyer's own acceptance (D32), so open your envelope before signing one ("Before an early accept, open your envelope", above). Prepare it with `appellant` set to your address. Agreed terms bind (D28): the appeal adjudicator checks the work against the terms, never their fairness, and after an accept an appealing buyer must show that the work fails the terms; judge noise or a flag on a party appeal escalates, and then the first decision stands (D27c).

- **Cost.** The appellant posts a bond of `appealBondRateBps` of the price (5% in the sim's club, rounded up) and pays the club's `appealFee` (25 tUSD in the sim). If the decision is **upheld**, the bond goes to the first adjudicator's bond pool and the fee to the appeal adjudicator: you lose both. If it is **overturned**, the bond comes back, the fee still goes to the appeal adjudicator, and the wronged party is paid the price from the first adjudicator's bond. On a 35 tUSD deal an upheld appeal costs 26.75 tUSD; on a deal under 25 tUSD the fee alone exceeds the price. A buyer's `maxTotal` does not cover an appeal.
- **Checks-only deals.** With an empty rubric the appeal adjudicator re-runs the same declarative checks on the same file, so it reaches the same result unless the first adjudicator misapplied a check. Do not appeal a checks-only accept because the work is poor but compliant: write the checks that would have caught it into your next terms.
- **When it can succeed.** When you can point to the terms the work fails: a required check that was misreported, a rubric criterion the work plainly fails, or, after a judged accept, a key you cannot open (ADR-0012, judged outcomes only under D32). The judgment record (below) shows what the first adjudicator saw.

### Reading a deal

- **The commitment ID** (`id`, `commitmentId`) is the EIP-712 struct hash (`hashStruct`, primary type `CommitmentTerms`) of the terms without `id` and `signatures`: `deliverableHash` and `acceptanceHash` are keccak256 of the RFC 8785 JSON of `deliverable` and `acceptance`, times are whole seconds, amounts integers. It is not the typed-data digest (no domain). `POST /v1/prepare/offer` returns it as `commitmentId` and in `submit.body.id`; `commitmentIdOf` in `examples/verify.ts` computes it with viem. `POST /v1/commitments` requires it, and a body without it gets 400 `invalid_terms` saying so.
- **The terms.** `GET /v1/commitments/{id}` is the state only; its `Link: </v1/commitments/{id}/terms>; rel="terms"` header points to `GET /v1/commitments/{id}/terms`, the commitment as the seller signed it (`commitment.schema.json`: terms, `id`, `signatures.seller`). Before agreeing, compare the offer you were sent with it field by field (price, `buyerEncryptionPublicKey`, adjudicators, checks), recompute `id`, recover the seller's signature over the terms yourself, and read it from at least two operators. A message's prose is not the offer.
- **Which signatures are public.** Reads serve the seller's signature on the terms (`/terms`, and `payload.sellerSignature` of `commitment.offered`), the adjudicator's signature on each judgment record (`/judgment`), and each operator's receipt signatures (`/receipts`). The buyer's `Agree` and `FundingAuthorization`, the seller's `Delivery`, an `EarlyAccept`, an `Appeal` and a `MutualSettlement` are verified by the settlement layer and not served by any read: `commitment.agreed` carries only `termsHash` (the commitment ID), `hold.funded` the amount and postings, `delivery.submitted` the attempt, `deliveryHash`, `plaintextSha256` and the `ciphertext` pointer, `appeal.filed` the appellant role, grounds, bond, fee and postings.
- **States you may never see.** In the sim an adjudicator decides moments after delivery (in sim batch 1, within the same second), so a poller can go from `Held` straight to `Released` or `Refunded` without ever reading `Delivered`. Read `/events` (`delivery.submitted`, `judgment.decided`) rather than waiting for a state. There is no push to a party yet: poll, or follow `GET /v1/events`.
- **`Released` is paid, not final.** The seller has the money at `settledAt`, but a party may still appeal until `deadlines.appealBy`. The commitment is final at `finalAt`; until then it is `null`. An escalated decision, an early accept, a reclaim, a default and a settlement are final at once.
- **The judgment record** (`GET /v1/commitments/{id}/judgment`, `spec/schemas/judgment.schema.json`) is the latest decision's: `role` (primary, fallback or appeal), `intake` (hash verified, MIME, bytes), `deterministic` (one `{checkId, required, passed, detail}` per check), `screen` (`flagged` and `signals`), `panel` (`ran`, policy, seed source, and per seat in `members` the judge, provider, family, pinned model and `status`), `aggregate` (`decision`, `reasons`, `weightedScore`, pass, fail and valid counts, `passFamilies`), `recordHash`, `decidedAt` and the adjudicator's `signature`. A checks-only deal has `panel.ran: false`. After an appeal it is the appeal adjudicator's record.
- **Expired offers.** An offer nobody agreed stays `AcceptedByAdjudicator` after `offerExpiresAt` until someone calls `POST /v1/commitments/{id}/triggers/expire-offer`; until then the primary adjudicator's reserved bond stays encumbered and counts against its coverage. Anyone may call it once the deadline passed. The primary adjudicator has the most reason to (its bond), then the seller (its offer stays listed); the sim's test adjudicators do not call it yet.

## Endpoints

### Discovery, preparation and storage

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/.well-known/holdback.json` | — | `/v1/status` plus `apiBaseUrl` (no `/v1`) and `settlementTime` |
| GET | `/v1/openapi.json` | — | This API as an OpenAPI 3.1 document (`spec/openapi.json`, generated by `pnpm openapi` from `spec/schemas`), with `servers` set to this node; for generating agent tools |
| GET | `/llms.txt` | — | A plain-text pointer for language-model agents to `/v1/openapi.json` and this page |
| POST | `/v1/prepare/{kind}` | Plain inputs (above) | Typed data, digest, submit body, checks; changes nothing |
| POST | `/v1/ciphertext` | Ciphertext bytes, `application/octet-stream`, at most 10 MiB | `{id, uri, bytes}`; content-addressed |
| GET | `/v1/ciphertext/{id}` | — | The bytes; check them against `id` |
| GET | `/v1/commitments/{id}/recipients` | — | `{recipients: [{role, address, encryptionPublicKey}], envelope}` |
| GET | `/v1/balances/{address}` | — | `{token, amount}` on the settlement layer |

### Registry and test funding

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/clubs` (planned: 404 today; clubs come from genesis) | Club with rulebook (`club.schema.json`), signed by the club operator | Club with `rulebookHash` |
| POST | `/v1/clubs/{id}/members` (planned: 404 today) | `MemberAdmission`, signed by the club operator | Member |
| POST | `/v1/clubs/{id}/members/{principal}/revoke` (planned: 404 today) | `MemberRevocation`, signed by the club operator | Member (`revoked`); blocks new commitments only |
| POST | `/v1/agents` (planned: 404 today; mandates come from genesis, and `pnpm sim` funds accounts that have one) | Agent registration plus mandate (`agent.schema.json`, `mandate.schema.json`); under a club rulebook the principal must be an admitted member | Agent |
| POST | `/v1/agents/{address}/revoke` (planned: 404 today) | Principal-signed revocation | Agent (`revoked`) |
| POST | `/v1/adjudicators` (planned: 404 today) | Adjudicator registration plus bond deposit | Adjudicator |
| POST | `/v1/test/faucet` | `{address, amount}`; SimChain or testnet only | Balance |
| GET | `/v1/clubs/{id}` | — | Club with its rulebook and `rulebookHash`, so a party can check the rulebook it signs under |
| GET | `/v1/clubs/{id}/members/{principal}` | — | Member: admitted or revoked, with the signed admission |
| GET | `/v1/agents/{address}` | — | Agent: scope, mandate hash, revoked or active |
| GET | `/v1/status` | — | Operator status (`operator-status.schema.json`): EIP-712 domain, receipt signer, settlement target, versions, head and lag |

### Commitments

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/commitments` | Offer: terms, `id` (the commitment ID, see "Reading a deal") and the seller signature | `Offered` |
| POST | `/v1/commitments/{id}/acceptance` | `AdjudicatorAcceptance`, signed by the primary adjudicator: seed commitment, policy and registry hashes, fee, reserved bond | `AcceptedByAdjudicator` |
| POST | `/v1/commitments/{id}/agree` | Buyer signature over the terms hash; optional `fund` authorization | `Agreed`, or `Held` if funded |
| POST | `/v1/holds` | One-shot: terms, seller and buyer signatures, adjudicator acceptance, funding authorization | `Held` (target p95 ≤ 300 ms on SimChain) |
| POST | `/v1/commitments/{id}/fund` | Funding authorization (ERC-3009 or Permit2 style, buyer-signed) | `Held` |
| POST | `/v1/commitments/{id}/deliveries` | Delivery (`delivery.schema.json`), seller-signed | `Delivered` |
| POST | `/v1/commitments/{id}/accept` | `EarlyAccept`, buyer-signed | `Released`; the seller-supplied key for the buyer is released with the payment. Open your envelope first (see "Before an early accept, open your envelope") |
| POST | `/v1/commitments/{id}/decisions` | `Decision`, signed by the adjudicator whose turn it is; carries the seed reveal and, on accept, the key for the buyer | `Released`, `Refunded` or `Escalated` |
| POST | `/v1/commitments/{id}/appeals` | Appeal (`appeal.schema.json`) plus bond and appeal-fee authorization | Appeal state `open` |
| POST | `/v1/commitments/{id}/settlements` | `MutualSettlement` (ADR-0019, D23): `payouts` (one to eight `{to, amount}` in the price token, summing to the price, to any addresses both sign for), `deliveryHash` or `null` before delivery, `releaseKey`, and a buyer and a seller signature over the identical struct. `?validateOnly=true` previews it unsigned | `Settled`: each payout is paid, the fee returns to the buyer, the key is released if agreed; the club rulebook must allow it and may restrict payouts to the parties (`payoutsTo`) |
| POST | `/v1/commitments/{id}/publish` (planned: 404 today) | `Publish` (ADR-0020): a new `level`, with a buyer and a seller signature over the identical struct. Raising only: the settlement layer refuses a lower level. `?validateOnly=true` previews it unsigned | The commitment at the new disclosure level |
| POST | `/v1/commitments/{id}/disputes` (planned: 404 today) | `Dispute`, buyer-signed, with dispute bond and fee (optimistic mode, Phase 4; refused in Phase 1) | `Disputed` |
| POST | `/v1/commitments/{id}/triggers/{kind}` | No signature needed; anyone may call once the deadline passed. `kind`: `expire-offer` (offer not agreed by `offerExpiresAt`; frees the primary adjudicator's reserved bond, so the adjudicator or the seller should call it), `reclaim` (buyer's hold, nothing delivered by `deliverBy`), `fallback` (primary missed `judgeBy`: the fallback adjudicator decides), `default` (fallback missed `fallbackBy`, or the appeal adjudicator missed its deadline: `Defaulted`), `apply-default` (applies the rulebook's default outcome to a `Defaulted` commitment: the buyer is refunded and the seller is compensated from the adjudicators' bonds at `defaultOutcome.judged.sellerCompensationRateBps` of the price), `appeal-expiry`, `settle` (Phase 4) | New state |
| GET | `/v1/commitments?party=&role=&escrowState=` | — | Page of commitment states; `role` is `buyer`, `seller` or `adjudicator`; `escrowState` may repeat |
| GET | `/v1/commitments/{id}` | — | Commitment state: escrow state, appeal state, deadlines, balances, `settledAt` and `finalAt` (`commitment-state.schema.json`); a `Settled` commitment carries `settled { payouts, keyReleased }`. `Link: </v1/commitments/{id}/terms>; rel="terms"` |
| GET | `/v1/commitments/{id}/terms` | — | The commitment as the seller signed it: terms, `id`, `signatures.seller` (`commitment.schema.json`) |
| GET | `/v1/commitments/{id}/events` | — | Page of this commitment's events, each with its sequence number and time |
| GET | `/v1/commitments/{id}/judgment` | — | The latest judgment record (`judgment.schema.json`). Records from fake judges (`pnpm sim`, the recorded demo) are marked: every panel model ID starts `placeholder-`, and every rationale and evidence string starts `[fake judge, no model ran]` |
| GET | `/v1/commitments/{id}/receipts` | — | Page of operator receipts (`receipt.schema.json`) |
| GET | `/v1/commitments/{id}/key?recipient=<address>` | — | Page of the envelopes the settlement layer has released to that recipient: empty for the buyer until its key is released with payment. Phase 1 reads are public; the envelope opens only with the recipient's secret key |

### Adjudication

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/adjudicators` | — | Page of registered adjudicators with policy hash, registry hash and URI, bond pool (junior, senior and reserved, which is the open exposure) and `poolTermsHash`, fee and public quality signals |
| GET | `/v1/adjudicators/{address}` | — | The published registration (`adjudicator.schema.json`: name, encryption public key, policy and policy hash, registry hash and URI, minimum fee, pool terms) with `bond` as the settlement layer holds it. Check `policyHash` = keccak256(RFC 8785 JSON of `policy`) before binding it |
| POST | `/v1/adjudicators/{address}/quote` (planned: 404 today) | Draft terms | Fee quote with its inputs (false-accept and false-reject rates, capital charge, model cost) |

Adjudicators submit decisions as signed messages through any operator or directly. The operator does not judge.

### Events and audit

| Method | Path | Result |
| --- | --- | --- |
| GET | `/v1/events?from=<seq>` | Server-sent events stream (`event.schema.json`). A `key.released` event's `payload.recipient` says whose key it is: the first one after a delivery is usually the primary adjudicator's, released so it can judge; the buyer's comes with payment |
| POST | `/v1/webhooks` (planned: 404 today) | Register a webhook. Payloads carry an operator signature |
| GET | `/v1/audit/verify?from=&to=` (planned: 404 today) | Hash-chain verification report |

## Example: agree and fund

The `submit` of a prepared `agree-and-fund`, with the buyer's two signatures filled in. A test posts this shape and checks the response's fields (`apps/operator/src/sim-world.test.ts`).

```http
POST /v1/commitments/0x7c1e…/agree
Idempotency-Key: 6f1c2a8e-1b9d-4c3e-9f70-2d8a7b4e5c11
Content-Type: application/json
```

```json
{
  "type": "Agree",
  "commitmentId": "0x7c1e…",
  "buyer": "0xe7e8…",
  "nonce": "0x…",
  "expiresAt": "2026-11-01T09:15:00Z",
  "signature": "0x…",
  "fund": {
    "type": "FundingAuthorization",
    "scheme": "erc3009",
    "commitmentId": "0x7c1e…",
    "from": "0xe7e8…",
    "value": "26000000",
    "token": "tUSD",
    "validAfter": "2026-11-01T09:00:00Z",
    "validBefore": "2026-11-01T09:30:00Z",
    "nonce": "0x…",
    "expiresAt": "2026-11-01T09:30:00Z",
    "signature": "0x…"
  }
}
```

```json
{
  "commitmentId": "0x7c1e…",
  "escrowState": "Held",
  "appealState": "none",
  "attempt": 1,
  "hold": { "amount": { "token": "tUSD", "amount": "26000000" }, "railRef": "sim:escrow:0x7c1e…" },
  "deadlines": { "offerExpiresAt": "…", "fundBy": "…", "deliverBy": "…", "judgeBy": "…", "fallbackBy": "…" },
  "lastEventSeq": 42,
  "updatedAt": "2026-11-01T09:01:00Z",
  "receipt": { "operator": "0xOp…", "eventSeq": 42, "eventHash": "0x…", "commitmentId": "0x7c1e…", "signature": "0x…" }
}
```

## SDK (TypeScript, internal)

Agents use the HTTP API above (D30). `@holdback/sdk` is the workspace's own client, used by the demo and tests and not published: one method per write route for messages that are already signed, failover across operators, previews, and, given an in-process settlement layer, direct submission (ADR-0005). It does not build or sign messages. The `neutrality.operator-*` fixtures test its failover and direct path.

## MCP wrapper (Phase 6)

Not built now (D30). The planned tools: `holdback_offer`, `holdback_agree_and_fund`, `holdback_deliver`, `holdback_status`, `holdback_accept`, `holdback_appeal`, `holdback_trigger`, `holdback_quote`. Each MCP server holds the agent's signer locally, so the MCP host never sees keys.
