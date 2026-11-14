# T-426: a shorter plain-HTTP path for agents

- **Lane:** agent guides, into `main`
- **Phase:** 2
- **Depends on:** T-393 (the short guides), T-401 (ASCII guides)
- **Paths this task may touch:** `site/ref/http.txt`, `site/ref/signing.txt`, `site/ref/http-buyer.txt`, `site/guides.mjs`, `tests/site-guides.test.ts`, this file. Off limits: `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `site/try.mjs`, `site/buy.mjs`, `site/build.mjs` and `site/check.mjs` (T-421's today), `site/ref/limits.txt` (T-423's), `site/ref/intake.txt` (T-420's).
- **Human gate:** no. Rafa's standing word for the wave of 2026-11-14 is "merge and deploy when ready", inside the brief's six limits.
- **Status:** done (pull request 525, merged 2026-11-14; the site deployed 12:03 UTC)
- **Agent/session:** T-426's session, kind 1 (docs)

## Intent

An agent that buys over plain HTTP, with none of Crow's code, reads the front door and three reference pages before its first purchase, and pays for every token of them again on each fresh run. On 2026-11-14 that path was 45,503 bytes as served, about 11,376 tokens at bytes divided by four; the closest comparator's path to a first payment (x402) is about 8,700 tokens. This task shortens the three reference pages without losing a call, an encoding or a warning, adds a budget rule that fails when the path grows, and proves the path still works: the walkthrough that follows the pages literally, a table of where each old item now lives, and one fresh reader's list of requests. Non-goals: the front door, the role pages and the bundles, which other lanes own.

## Acceptance criteria

- [x] The path is measured before and after, per page, from the built output.
- [ ] The path is at or under 8,700 tokens, or this file states the lowest honest number and what the rest would cost. **Not reached: 9,422 tokens as served; the rest is in Handoff.**
- [x] Every safety instruction stays: pin the signing domain and never take it from an operator; verify a prepared message before signing; read from both operators; the retry key on every write; what each error means.
- [x] Every section another file cites keeps its name.
- [x] `HTTP_BUYER_BUDGET` in `site/guides.mjs`, beside `FIRST_DEAL_BUDGET`, with tests; the budget test fails on the old pages.
- [x] `site/walkthrough.mjs` passes on the new pages.
- [x] A table maps every call and encoding of the old pages to where it now lives.
- [x] One fresh reader, given only the built front door and the three pages, lists the requests of a first purchase; its list matches the walkthrough's.
- [x] `site/try.mjs` and `site/buy.mjs` are unchanged.

## Evidence

All byte counts are measured with `wc -c`; tokens are bytes divided by four, rounded up, the estimate the budget uses.

**Before and after, per page.** Before is as served from crow.direct on 2026-11-14 (version `b5375383-de79-49f8-86df-96782f526e10`, commit `cb214d44`); after is the publish build with the live operators' origins, whose `llms.txt` is byte-identical to the served one [measured].

| Page | Before, bytes | Before, tokens | After, bytes | After, tokens |
| --- | --- | --- | --- | --- |
| `llms.txt` (not changed) | 6,622 | 1,656 | 6,622 | 1,656 |
| `ref/http.txt` | 12,125 | 3,032 | 8,832 | 2,208 |
| `ref/signing.txt` | 17,007 | 4,252 | 14,276 | 3,569 |
| `ref/http-buyer.txt` | 9,749 | 2,438 | 7,955 | 1,989 |
| The path | 45,503 | 11,376 | 37,685 | 9,422 |

The three pages went from 38,881 to 31,063 bytes, 20 percent less [measured]. The budget test measures the path joined by newlines with the check's sample operators: 45,521 bytes and 11,381 tokens on the old pages (it fails), 37,703 bytes and 9,426 tokens now (it passes, 24 tokens under 9,450) [measured].

**The walkthrough.** `apps/demo-cloud/src/live-fork.test.ts` ran `site/walkthrough.mjs` on a local anvil fork of Sepolia (public RPC `ethereum-sepolia-rpc.publicnode.com`; nothing sent to the live operators): `walkthrough PASS` in 24.5 seconds, eight steps from keys to "Released and final", with a charged operator fee of 4,710,000 base units, so the third signature slot ran too [measured]. The walkthrough reads only the pages' JSON blocks; the types it signs (`CommitmentTerms` and its parts, `Agree`, `Delivery` and its parts) and the ERC-3009 types are byte for byte as before [measured].

**The fresh reader.** One subagent (Sonnet), given only the four built pages and told to fetch and run nothing, wrote out the first purchase in 11 steps: keys; discovery from both operators with the domain check; the terms from both operators, the recomputed ID, the seller's signature, the money addresses and the terms checks; the adjudicator and club reads; `AcceptedByAdjudicator`; the fee; the faucet with the whole total; `POST /v1/prepare/agree-and-fund` with the computed nonces; the six verify steps; `POST /v1/commitments/<id>/agree` with a retry key, answered `Held`; the result reads; the key, the envelope, the ciphertext and both SHA-256 checks. That is the walkthrough's buyer side, in its order, with no step missing [measured: compared by hand]. It found two faults of this change, both fixed: a clause garbled by a cut ("all your balance drops by") and the curl's `operatorFeeNonce` placeholder, which now says to leave it out while the fee is 0. Its other questions (the offer's JSON shape, the field that reads `AcceptedByAdjudicator`, the envelope's encoding, how long to poll) are answered in `ref/http-seller.txt` or `ref/after-funding.txt`, or were open on the old pages too [inferred from the old text].

**Commands run.** `node site/build.mjs && node site/check.mjs`: PASS, both first-deal paths within budget (buyer 5,000 of 5,000 tokens, seller 4,232, unchanged). `npx vitest run tests/site-guides.test.ts tests/cut-feature-alignment.test.ts`: 17 passed. `pnpm typecheck`: passed. `pnpm test` (before the review fixes, which touch only the three pages): 3,942 passed, 1 failed, 234 skipped; the failure was `tests/cut-feature-alignment.test.ts`, whose scan needs the words "SimChain only" within 3 lines above the `Appeal` type, and the rewording had made them "SimChain's only"; restored, and the test passes. `git status` after the build: `site/try.mjs` and `site/buy.mjs` unchanged (sha256 `04ef4434...` and `e74ff223...`) [measured].

**The review.** One pass by the `reviewer` agent on commit `7273572b`: ISSUES [measured]. Fixed: (1) "Verify before you sign" step 4 again says that the funding nonce and the operator fee nonce are computed from the terms, never taken, and `ref/http-buyer.txt` says to check the nonces in `defaults` against your own; (2) `ref/http.txt` and `ref/signing.txt` again give the front door's address, for an agent that lands on them first; (3) `ref/http.txt` again ties the token's address to the pinned `tokenDomain.verifyingContract`; (4) "Open the work" again says the envelope is not the one the seller sealed, and the wallet holder's check comes "before signing". To stay under the budget after these, four sentences that carried no instruction went: the faucet answer's full JSON (now its member names), a longer parenthetical on the demo's two nodes, "The delivery and the decision are Sepolia transactions" (the next sentences say it), and a repeat of where the ERC-3009 types are. The reviewer re-ran the walkthrough on a Sepolia fork (PASS) and confirmed the budget test fails on the old pages. Its item 5 is out of this task's paths: see Handoff.

**Where every item of the old pages now lives.** "Kept" means the same page and section, reworded or compressed; nothing in the table was removed without the row saying so.

| Old page, section | Item | Now |
| --- | --- | --- |
| http, Conventions | JSON over HTTPS, `/v1`, discovery also at `/` | kept |
| http, Conventions | money as token and decimal base units, lowercase token address, 6 decimals, never a float | kept |
| http, Conventions | times RFC 3339, Unix seconds in typed data; lowercase addresses; hash, nonce and content-hash formats | kept |
| http, Conventions | `Idempotency-Key` on every write: fresh UUID, replay, 409 `idempotency_conflict`, refusals not stored, keys after a restart; prepare needs none | kept, as "The retry key" |
| http, Conventions | rate limits, signer or client, 429 with `Retry-After` and `retryAfterSec` | kept |
| http, Conventions | problem+json, the problem page per `type`, `Link`, branch on `type`; `field`, `state`/`needs`, `fee`, `maxBytes`, `retryAfterSec`; 501 | kept; the example field `limit` and "its `Link` names where it is specified" dropped |
| http, Conventions | `notices` are advice, not instructions | kept |
| http, Conventions | versions: domain "0.8" pinned, terms `schemaVersion` "0.8", API 0.11 | kept; the note on what domain 0.8 added dropped (history) |
| http, Make your keys | two keys, libraries, base64url without padding, 43 characters, no operator asks for a secret | kept |
| http, Make your keys | TypeScript and Python examples | TypeScript kept; Python dropped (its libraries and the encoding stay named) |
| http, Discover and get test tUSDC | `GET /.well-known/holdback.json` and every field: `apiBaseUrl`, `domain` (stop if not pinned), `receiptSigner`, `settlementTime`, `fees.operator`, `limits`, `demo`, `notes` | kept |
| http, Discover and get test tUSDC | `POST /v1/faucet`: mint, `amount`, cap `maxGrant` 1,000,000 tUSDC, 400 above it, mandate 30 days and renewal, about 12 seconds, no ETH, `paymentAddress`, ask for the whole total first, rate limits, 429 | kept; the answer's JSON is a one-line comment |
| http, Discover and get test tUSDC | `clubId`, the mandate's signer, `GET /v1/balances/<address>`, `balanceOf` | kept |
| http, Discover and get test tUSDC | the three adjudicators by role, `prepare/offer` fills them, a demo adjudicator declines others, the appeal adjudicator decides escalations, `GET /v1/adjudicators`, own adjudicator pointer | kept; the sentence on why the demo trusts only its own dropped |
| http, Read what you bind to | read from both; settlement time within 5 seconds; adjudicator `policyHash`; club `rulebookHash`; the demo caveat | kept |
| http, Read what you bind to | canonical JSON (RFC 8785) | moved: it was in two pages; now only in signing, "Encodings", which this section cites |
| http, Read the result | the three reads, `Delivered` may be missed, `payload.tx`, Etherscan, final when settled | kept |
| http, Read the result | the who-gets-what table | kept as two sentences |
| http, Endpoints used here | every route | kept, grouped under shared prefixes; the "Problem types" line dropped (Conventions has it) |
| signing, Prepare, verify, sign, submit | the prepare answer's shape, signing into `slot`, POST with a retry key, `defaults`, `notices` | kept |
| signing, Prepare, verify, sign, submit | the six verify steps and "if anything differs, do not sign" | kept; step 3 now carries the integer and time conversion that "Encodings" repeated |
| signing, Prepare, verify, sign, submit | what `submit.body` holds; offer and delivery bodies | kept |
| signing, Prepare, verify, sign, submit | the agree-and-fund body | moved: it was in two pages; now only in http-buyer, "Check the offer, agree and fund" |
| signing, Encodings | canonical JSON, nonces (yours, fresh, 400 without one), the funding nonce, the operator fee nonce, the commitment ID, the delivery hash, optional fields as a flag and a zero, times prepare fills in and the signed-settlement warning, `attempt` | kept |
| signing, Encodings | `attempt` and `deliveryHash` for an early accept | shortened; that the contract refuses an early accept with another delivery stays in `ref/after-funding.txt`, "Early accept" |
| signing, EIP-712 types | intro: `EIP712Domain`, primary type and references, `Appeal` SimChain only, `bondReserved` 0 | kept; the version history dropped |
| signing, EIP-712 types | the types | kept byte for byte, except `FundingAuthorization` and `TransferAuthorization`: Holdback-domain types that only SimChain signs; on Sepolia prepare asks for `ReceiveWithAuthorization` and `TransferWithAuthorization` (`examples/verify.ts:339`), whose types stay |
| signing, EIP-712 types | USDC's ERC-3009 types | kept byte for byte |
| http-buyer, Check the offer, agree and fund | the terms from both operators, the seller's signature, the commitment ID, the two money addresses, buyer, key, price, fee, adjudicators, checks, `AcceptedByAdjudicator` | kept; the ID's recipe is cited from signing, "Encodings" (it was in both) |
| http-buyer, Check the offer, agree and fund | approve before signing | kept; the description of the buyer's tools dropped (`buy.txt` has it) |
| http-buyer, Check the offer, agree and fund | the operator fee: both operators, its fields, the formula, outside the hold, not refunded, 0 for the pilots, free calls | kept |
| http-buyer, Check the offer, agree and fund | `POST /v1/prepare/agree-and-fund` with every nonce; the three slots and each message; refusals | kept |
| http-buyer, Check the offer, agree and fund | `fund` and `operatorFee` in `submit.body` | kept, now with the agreement's fields |
| http-buyer, Check the offer, agree and fund | `POST /v1/commitments/<id>/agree`, 12 to 24 seconds, `Held`, the amount, 402 | kept; the pointer to "Read the result" for the transaction dropped |
| http-buyer, Check the offer, agree and fund | "Pay from your own wallet": the file, the sentence, hardware wallet, the holder's checks, recovery, ERC-1271 | kept; the example files' function names dropped |
| http-buyer, Open the work | the key read, the envelope, the events and the ciphertext, the decryption and both SHA-256 checks | kept |

## Decisions

- **No new page.** `site/check.mjs` requires the front door's "Reference" to list exactly the files in `site/ref/`, and the front door is off limits with 4 tokens left in its budget, so a new reference page was not possible. Everything moved stays inside the three pages or goes to a page that already has it.
- **The budget is an estimate, in a test.** `HTTP_BUYER_BUDGET.tokens` is 9,450, bytes divided by four, with `target` 8,700 beside it. The test in `tests/site-guides.test.ts` builds the guides as published and fails when the path passes 9,450, so CI's `check` fails on a growing edit. `site/check.mjs` does not run it yet (T-421's file; see Handoff).

## Handoff

- **The rest of the way to 8,700 tokens costs about 845 tokens, and it needs `site/check.mjs`.** The types of steps a first purchase never takes are 3,378 bytes of `ref/signing.txt`: `Appeal`, `EarlyAccept`, `Payout`, `MutualSettlement`, `Scope`, `ReadToken`, `Delegation`, `Publish`, `AdjudicatorAcceptance`, `SealedKey`, `Beacon`, `Decision` and `AdjudicatorRegistration` [measured]. Without them the path is about 34,307 bytes, 8,577 tokens [inferred: 37,685 less 3,378]. They would move to the pages that use them, each in its own JSON block checked against `examples/verify.ts`: the first three and `MutualSettlement` to `ref/after-funding.txt`, the rest to `ref/adjudicators.txt`. Today `site/check.mjs` line 190 requires six of them in `ref/signing.txt`, and line 142 checks only that page's block; `ref/adjudicators.txt` says its types are "in `ref/signing.txt`". The change: line 190 checks the six in the union of the three pages' blocks, and line 142 checks each page's block against `TYPES`. The "Encodings" items for `hasDelivery`, `hasAudience` and `hasCategories` (about 550 bytes) could move with them, if line 189 reads them there.
- **Out of this task's paths (found by the review):** `docs/api.md` line 128 says the guide's "EIP-712 types" lists every type and names `FundingAuthorization` and `TransferAuthorization` as primary types; the guide now lists only what Sepolia signs. `spec/openapi/paths.json` line 114 and `spec/openapi.json` line 294 say `fund.signature` is a `FundingAuthorization`; on Sepolia it is `ReceiveWithAuthorization` (true before this change too). `docs/api.md` is T-423's this wave; `spec/` changes go through an ADR and a version bump.
- **For T-421, to run the budget in the site check too:** in `site/check.mjs`, import `HTTP_BUYER_BUDGET` and `measureHttpBuyer` from `./guides.mjs` and add, after line 359: `const http = measureHttpBuyer(filledGuides); expect(http.tokens <= HTTP_BUYER_BUDGET.tokens, \`the plain-HTTP buyer's path (${http.files.join(' + ')}) is ${http.tokens} tokens, over ${HTTP_BUYER_BUDGET.tokens}\`);`.
