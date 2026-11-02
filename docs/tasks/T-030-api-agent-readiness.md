# T-030: API agent-readiness batch

- **Lane:** api
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `apps/operator/src/`, `apps/demo-cloud/src/`, `apps/adjudicator/src/` (declining sealed offers only), `spec/openapi/paths.json`, `spec/openapi.json` (generated), `scripts/openapi.mjs`, `site/llms.txt`, `site/build.mjs`, `site/check.mjs`, `docs/api.md`, `docs/plan.md` (Phase 6 wording only), `examples/`, `tests/contract/`, `fixtures/` (new error fixtures), `docs/tasks/T-030-api-agent-readiness.md`, `docs/backlog.md` (close rows this task resolves)
- **Human gate:** no (a demo redeploy after merge follows `docs/operations.md`)
- **Status:** review
- **Agent/session:** implementer, branch `t-030-api-agent-readiness`

## Intent

Make the operator API meet D39's bar: an agent with only an HTTP client, an EIP-712 signer and `https://escrow.stream/llms.txt` completes a deal on its first try, and the API is simpler than today. Work from `docs/reviews/2026-11-02-api-agent-review.md`, sections 2 (Simplify), 4 (findings), 5 (first five) and 6 (conformance and stubs). Only operator and docs changes: anything that changes `spec/schemas/` belongs to T-033 (schema v0.9).

Restated (implementer, 2026-11-02). An outside agent should start from one URL and one page and never need hidden knowledge. Concretely: one discovery document carries everything a first deal needs (domain, fee, limits, and on a demo node its club, token, adjudicators by role and faucet); one faucet route sits in the OpenAPI document; every client-side computation (nonces, `has*` encodings, the private recipe) is written in `llms.txt`; prepare hides nothing (the caller sends every nonce and chooses `disclosure`); errors carry machine-readable members where an agent must branch and point to a page per type; advisory text travels in the body as untrusted `notices`, not in a header; planned routes say 501 with a link instead of a typo-like 404; a forged write cannot spend another signer's budget; and the demo adjudicators refuse sealed offers they cannot judge instead of letting a hold stall to a reclaim. Fewer moving parts, not more: where a change would add a concept, prefer folding it into one that exists.

Non-goals: any change to `spec/schemas/` (operator-status `chainId` as a number, a `not_implemented` type in a schema, receipt fees: T-033); telemetry (T-031); the feedback service (T-032, its routes stay planned stubs); CORS; the adjudicator opening sealed terms (T-207); persisting idempotency records; a deploy.

## Acceptance criteria

- [x] **Docs-only fixes (F3, F6, F9, F10, F12, C1, C13):** the operator's own `/llms.txt` links `https://escrow.stream/llms.txt` and the raw `docs/api.md`; `llms.txt` gains an "Encodings" section (nonce rule, `has*`/zero defaults for MutualSettlement, ReadToken and Delegation encodings, the private recipe summary), idempotency retention and refusal semantics, default expiries and `attempt`; `docs/api.md` and `docs/plan.md` say SDK and MCP are "later, on demand".
- [x] **Errors (F4):** problem `type` resolves at `https://escrow.stream/problems/<type>` (a generated page per type on the site), typed members `state`, `needs`, `fee`, `retryAfterSec`, `field` where an agent must branch, `internal` for 500, a bad `limit` as `invalid_terms` with `field`. If a new problem type needs the schema, stop and hand it to T-033.
- [x] **Discovery and faucet (F2, Simplify 1, 3, 9):** the demo's `GET /` facts (adjudicators with roles, token decimals, faucet, limits) reachable from the one discovery document and in the OpenAPI document under a `demo` tag; one faucet; one fee name. Changing `operator-status.schema.json` (for example `chainId` as a number) waits for T-033; until then document the difference.
- [x] **Simplify 5, 7, 8, 10, 11:** notices in the response body (`notices[]`, marked untrusted) instead of `Holdback-Notice`; prepare requires caller nonces (no hidden default); one timestamp format (whole seconds, `Z`) in read models; one version paragraph; OpenAPI descriptions under about 300 characters with the long lists in one linked section, and a `core` tag on the happy-path operations.
- [x] **Limits published (F8):** the caller's rate limits and idempotency retention in discovery and Conventions.
- [x] **Planned routes (D39):** the six new planned rows from the review §6.2 in `docs/api.md` and `x-holdback-planned`; planned routes answer 501 `not_implemented` with a `Link` to their source, read from `x-holdback-planned` (keep one source of truth; update the tests that enforce "planned = unrouted").
- [x] **Privacy and safety (C4, C9/F11, F1):** the write budget is charged only after the signature verifies; `prepare/offer` requires `disclosure` (no default); the demo adjudicators decline an offer whose sealed terms they cannot open (a clear problem, not a silent stall).
- [x] A fresh agent following only the new `llms.txt` completes a deal against a local `pnpm demo-cloud:dev` (record the transcript in Evidence); `pnpm verify` and CI pass; `node site/check.mjs` passes.

## Out of scope

- Schema changes (T-033), telemetry (T-031), the feedback service (T-032), CORS unless trivial (F13).

## Evidence

- **Measured: a fresh agent completed a deal from the new `llms.txt` alone, first try.** A separate agent got only the page (filled with the local origins), Node 22, curl, and viem and tweetnacl by import path. It was told not to read any other file. It ran against `pnpm demo-cloud:dev` and played both sides. It rebuilt and compared every typed-data digest before signing. Result: 61 HTTP requests, all 2xx; Offered, AcceptedByAdjudicator, Held (26000000), Delivered, Released at 10:59:42Z, final at 11:00:42Z on both nodes. The buyer opened its envelope, the ciphertext and plaintext SHA-256 both matched, and its recomputed delivery hash equalled `payload.deliveryHash`. Final balances: buyer 973990000, seller 1025000000 (the 0.01 tUSD operator fee paid). Commitment `0xebbcb6a37524c8499f2ff0a7e2f6d447087b9cd58669576a38d2a6756e6315b0`. Transcript summary in order (both nodes where marked ×2):
  - discovery ×2, `POST /v1/faucet` ×2, discovery ×2, `GET /v1/adjudicators`, `GET /v1/adjudicators/<a>` ×3×2, `GET /v1/clubs/demo-club` ×2 (policyHash and rulebookHash recomputed and matched);
  - `POST /v1/prepare/offer`, discovery ×2 ×2, `POST /v1/commitments`, `/terms` ×2 (recomputed ID matched), state ×2;
  - discovery ×2, `POST /v1/prepare/agree-and-fund`, discovery ×2, `POST /v1/commitments/<id>/agree`;
  - registrations ×3×2, `/recipients`, `POST /v1/ciphertext` (id matched), `POST /v1/prepare/delivery`, discovery ×2, `POST …/deliveries`;
  - state ×2 (already Released), `/judgment`, `/events?limit=200`, `/key?recipient=<buyer>`, `GET /v1/ciphertext/<id>`, state ×8 polling `finalAt`, balances ×2×2.
- **Measured: what the fresh agent found unclear, and what changed.** It reported nine gaps, all fixed in this branch:
  1. `uint8` fields came as JSON numbers while the page says every integer is a decimal string. Prepare now emits decimal strings for every integer (one rule), pinned by a test.
  2. "fee" was ambiguous next to the operator fee: the page now says adjudication fee.
  3. The terms' `schemaVersion` `"0.6"` read as contradicting the API's 0.8: the Versions line now explains both.
  4. "The registration you read" now says the primary's.
  5. `demo.adjudicators` is described as the array it is.
  6. Section 8 now explains why the buyer's released envelope differs from the seller's (adjudicator re-seal) and the two `key.released` events.
  7. `/events` and `/recipients` shapes are stated.
  8. `row_count_range` counts data rows (not the header).
  9. The agree-and-fund check text pointed at `/v1/status`; it points at discovery now.
  Its own count: every step first try; one local check needed a fix before signing (item 1), with no extra request.
- **Measured: the dev quirk.** Before the fix, a local node's discovery said `"apiBaseUrl":"http://api.escrow.stream"`. After `--local-upstream` in `apps/demo-cloud/scripts/dev.mjs`, node 1 says `http://127.0.0.1:8787`, node 2 says `http://127.0.0.1:8788`, and `demo.operators` lists both. With the fix, `node apps/demo-cloud/scripts/deal.ts http://127.0.0.1:8787 http://127.0.0.1:8788` completed: final in 65 s, operator fee 10000 paid, 10 receipts per operator.
- **Measured: a planned route on the local Worker.** `POST /v1/funding/quote` answered `501 Not Implemented` with `type` `not_implemented`, and `Link: <https://escrow.stream/problems/not_implemented>; rel="type", <…/ADR-0026-funding-paths.md>; rel="describedby"`.
- **Measured: the OpenAPI document, before and after.**

  | | Before (22b8431) | After |
  | --- | --- | --- |
  | Operations | 40 | 40 |
  | Tagged `core` | 0 | 16 |
  | Longest description | 1,462 characters | 300 |
  | Descriptions over 300 characters | 17 | 0 |
  | Planned rows | 13 | 19, each with a `source` |
  | Problem types | 29 | 31 |
  | Size | 275,660 bytes | 290,950 bytes |

  The size grew by the new schemas (Problem members, limits, demo, notices). `pnpm validate:spec`: 40 operations, 180 schemas compiled strictly.
- **Measured: `site/llms.txt`** went from 29,717 to 43,084 bytes (Encodings, Beyond the happy path, the private recipe, eight more EIP-712 types). `node site/build.mjs && node site/check.mjs`: PASS. The new checks cover the problem pages, the Encodings facts, the full type list and the required request fields. A filled build (`--out`) writes 32 problem pages (31 types plus the index).
- **Measured: tests.** In `pnpm verify` at commit `4be506b`, `pnpm test` passed 93 files and 2,219 tests. New tests:
  - `apps/operator/src/agent-ready.test.ts`, 12 tests: problems with Link, title and members; settlement-layer `invalid_state` with `state` and `needs`; `fee` on 402; 500 `internal` without the cause; every planned route 501 with its source; one faucet; discovery `limits`, `demo` and `GET /`; caller nonces, filled-in defaults and decimal-string integers; required `disclosure`; whole-second read models; notices; the C4 forger test.
  - `apps/operator/src/problems.test.ts`, 4 tests.
  - An adjudicator test: a sealed offer is declined with its reason.
  - Demo-world tests: discovery with demo facts at `/` and the well-known path, notices in the body, a private offer declined and the reason on the state read.
  - Contract test additions: planned rows carry sources; descriptions at most 300 characters; the `core` set; the `demo` tag; the Problem enum from the operator table.
- **Measured: `pnpm verify` PASS** at `4be506b` (2026-11-02T13:09Z), every step: typecheck, lint, forge build, forge, test, spec, snap, snap:local (anvil) and demo. No snapshot diffs. An earlier run failed in forge build (nested submodule clones over the network), snap:local (needs forge's artifacts) and one vitest worker start timeout, all while the session stalled; the rerun passed without code changes.
- **Measured: PR 85 review fixes.**
  - Concurrent burst on a node with a write budget of 2. Before the fix (review's measurement): 20 concurrent forged writes from one client gave 20×401, and 10 concurrent genuine writes by one signer from 10 clients gave 10×200. Now (`agent-ready.test.ts`, "holds under a concurrent burst"):
    - 20 forged from one client: 2×401, 18×429;
    - 10 genuine by one signer from one client: 2×200, 8×429;
    - 10 genuine by one signer from 10 clients: 10×200, each within its client's budget, and that signer's next write from a fresh client is 429.
  - Planned routes count as reads: on a node allowing 100 reads, 100×501 then 429.
  - The quickstart's offer heredoc, filled as a shell fills it, now prepares (200) on a sim node. Its agree request names every field `PrepareAgreeAndFundInput` requires (`examples.test.ts`). Before the fix the test failed with 400 `invalid_terms`, `field: "disclosure"`.
  - `fieldOf` is pinned against core's real refusal text, and the `needs` tables against the read model's states and `TIMEOUT_KINDS` (`problems.test.ts`).
- **Inferred:** a deployed node behaves like the local Worker run, which uses the same bundle (embedded `spec/openapi.json`, `node:fs` shim).
- **Not done:** no deploy.

## Decisions

- **`type` stays the short token; it resolves through the `Link: <https://escrow.stream/problems/<type>>; rel="type"` header (RFC 6903) and the generated page.** Changing the `type` value to the absolute URI would break every client that branches on it, including `@holdback/sdk`'s `isProblemType` (another lane) and the scenario fixtures. Whether v0.9 moves `type` to the URI is handed to T-033.
- **`internal` and `not_implemented` are operator problem types, in one table** (`apps/operator/src/problems.ts`: status, title, next step). They are not in `@holdback/core`'s `PROBLEM_TYPES`, which is outside this lane, and no spec schema enumerates problem types, so no schema change was needed. The table also drives the OpenAPI enum and the site pages.
- **One discovery document now; `/v1/status` unchanged.** `/.well-known/holdback.json` (also `GET /`) carries `limits` and, on a demo, `demo`. `/v1/status` keeps the schema shape until T-033, and docs/api.md says so. `GET /` is the same document, not a third shape, and is not a separate OpenAPI operation.
- **Demo facts sit under `demo`, not at the top level.** Adjudicators by role and a faucet are facts of a test world, not of the protocol; a production operator omits the object. The per-adjudicator `scriptedPanel` flag is dropped (`demo.judges.panel` says it once).
- **One faucet: `POST /v1/faucet {address, amount?}`.** `amount` is optional, and a node may grant a fixed amount (the demo ignores `amount`, and `granted` says what it gave). The operator now serves it with the world's grant behind `Registry.faucet`, so idempotency, throttling and problems are uniform. Faucet idempotency is per node now (it was per world): the same key at the other node runs again and meets the per-address limit.
- **Notices come from a single operator hook** (`notices(subject)` for prepare, write and state). The demo world uses it for the panel notice, the sealed-offer warning and the declined reason. The declined reasons live in memory: every adjudicator pass declines again, so they are rebuilt after a restart.
- **`defaults` lists only what the operator filled in** (times, `releaseKey`), not every value echoed back. This is stricter than before and consistent with "prepare hides nothing".
- **`operatorFeeNonce` is required only where a fee applies, and accepted always.** The guide tells agents to send it always.
- **C4, revised after the PR 85 review.** Every write is counted against its client at entry, in one synchronous step, so a concurrent burst cannot pass the check before any of it is counted. A fresh relay the settlement layer accepted (its signature verified) moves that count from the client to the signer. The signer bucket is checked before relaying but not reserved: reserving it would let a forger hold a victim's slots for the length of a relay. So a signer can overshoot its own budget only by concurrent writes, each within its client's budget.
  - Refusals, unsigned writes, dry runs and replays stay on the client. Replaying an observed request cannot spend the signer's budget.
  - Planned routes are counted as reads of the client before their 501.
  - A verified signer that rotates addresses still gets fresh budgets; the backlog row is narrowed to that.
- **Declining sealed offers is the adjudicator service's default** (`acceptSealedUnread` false). The demo uses the default. `pnpm sim` opts in to accepting them unread, so `examples/private.test.ts` keeps its early-accept flow. Accepting terms an adjudicator cannot judge only ends in a default that its bond pays for.
- **Timestamps are normalized at the operator boundary** (state reads, lists, write and dry-run answers), never in events or terms, which are hashed or signed. Core and SimChain still mix formats internally; the backlog row is narrowed.
- **Every integer in prepared typed data is a decimal string, `uint8` included.** This is the fresh agent's finding: one rule instead of a type-dependent one.

## Handoff

- **Status: review.** Not deployed. A demo redeploy after merge follows `docs/operations.md`. There is no schema bump, so the `WORLD_NAME` reset is not needed. Rebuild the site with `--out` so the 32 problem pages ship with it.
- **Lane exceptions; a reviewer should confirm them:**
  - `tools/sim/world.test.ts`: two fields (`nonce`, `disclosure`) in its prepare call, which the new required inputs need.
  - `docs/quickstart.md`: `"disclosure": "public"` in the offer request (PR 85 review). `examples.test.ts` now checks the quickstart's request bodies, not only its paths.
  - `apps/demo-cloud/scripts/dev.mjs`: the local-upstream fix the task brief asked for.
  - `apps/demo-cloud/scripts/deal.ts`: reads discovery now that `GET /` is the discovery document.
  - `site/walkthrough.mjs`: sends `disclosure` and reads adjudicators from discovery. It still handles only two agree-and-fund slots, so against a node that charges a fee it stops at the third slot, as it did before this task.
  - The `tools/sim/briefs/` prompts may need the two new prepare fields when the sim batch next runs; refusals now name `field`.
- **To T-033 (schema v0.9):**
  - make `/v1/status` the discovery document, with `chainId` a number, `limits` and the optional `demo`;
  - decide whether a problem's `type` becomes the absolute URI `https://escrow.stream/problems/<type>`, together with the SDK's `isProblemType`;
  - move `internal` and `not_implemented` into `@holdback/core`'s `PROBLEM_TYPES`, so the SDK and fixtures know them;
  - add the fee on receipts (C3);
  - move the MIME allowlist to adjudicator capability (C8).
- **To the core or settlement lane:** emit whole-second timestamps in core and SimChain, so the operator's normalization can go.
- **To T-207 (adjudicator slice):** when the service can open `privateTerms`, accept sealed offers it can open. Keep declining the ones it cannot (a missing envelope, or a body that does not hash to its bound hash). Then drop the demo notices that say sealed offers are declined.
- **To T-032:** the feedback routes are planned rows (`POST /v1/feedback`, `GET /v1/feedback/{feedbackId}`). They answer 501 until built; remove them from `x-holdback-planned` when routed.
- **After PR 83 merges:** merge main and keep its tagline and intro lines in `site/llms.txt`, then run `node site/build.mjs` (it regenerates `site/index.html`) and `node site/check.mjs`. This branch does not touch those first lines.
- **Proposed check, for `docs/team.md` Rules and checks (another lane, so not added here):** "every computation the agent guide describes is exercised by a fresh-agent run before a release". This task's run found nine gaps that every repository test missed. `site/walkthrough.mjs` is the scripted half of that check.
