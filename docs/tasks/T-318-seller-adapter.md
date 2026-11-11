# T-318: a reference seller adapter for a service that prices by quote

- **Lane:** api (example code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review. The `site/llms.txt` section is kind 1.
- **Depends on:** T-316 (`preflightDelivery`, PR 278), T-317 (the audit-report terms and sample reports, PR 273)
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter-stub.ts`, `examples/seller-adapter.template.json`, `examples/seller-adapter.test.ts`, `vitest.config.ts` (the test file's cost line only), `.gitignore` (the journal's line only), `site/llms.txt` (the card paragraph and the new section only), `site/index.html` (only if the build regenerates it), this file. Never: `spec/schemas/`, `contracts/`, `packages/`, `apps/`, `examples/buyer-signer.ts` (T-319).
- **Human gate:** no. The site deploy that publishes the `llms.txt` section waits for Rafa.
- **Status:** review
- **Agent/session:** the T-318 session, 2026-11-11, branch `t-318-seller-adapter`

## Intent

Rafa asked on 2026-11-11 for a reference adapter that lets a seller with a priced HTTP API sell through Crow.

**Problem.** A seller that prices by quote already runs an HTTP API with three calls: quote a job, start it, fetch its result. To sell through Crow today it must write protocol code: build terms, sign an offer, watch the hold, encrypt and sign a delivery. The agent card also has no way to say "ask for a price"; an offer entry carries fixed terms only.

**Goal.** The seller runs one file, `examples/seller-adapter.ts`, with its own keys, and edits configuration only: the three addresses of its API, a deal template, the adjudicators and the deadlines. The adapter turns a quote into a signed offer, a funded hold into a started job, and a finished job into a checked, encrypted, signed delivery.

**Who signs.** The adapter signs the seller's offer and the seller's delivery with the seller's key, read from an environment variable. It never holds or asks for a buyer's key. The operators only relay what the adapter signed.

**Inputs.**
- From the buyer: `POST /quote` with `{buyer, buyerEncryptionPublicKey, scope}`. T-319's buyer signer calls this route.
- From the seller: the configuration, the template file, and `HOLDBACK_KEY` and `HOLDBACK_OPERATORS` in the environment.
- From the seller's API: a price for the scope, a job ID, and the result's bytes.

**Outputs.**
1. `examples/seller-adapter.ts`:
   - **Quote to offer.** It checks the scope against the configured rules, asks the seller's API for a price, fills the template with the scope, signs an offer that names the buyer, submits it, and answers `{commitmentId, price, fees, expiresAt}`.
   - **Funded hold to start.** It follows the operators' event stream for `hold.funded` and also polls. It starts the job only when every configured operator shows the commitment `Held`. It keeps a journal file, so a restart neither starts the job twice nor delivers twice.
   - **Result to delivery.** When the seller's API returns the result, the adapter runs `preflightDelivery` on those exact bytes. It encrypts and delivers only when the checks do not refuse them. Otherwise it does not deliver and logs each failed check.
2. `examples/seller-adapter-stub.ts`: a stub seller API for tests. It quotes from a size number, starts a job and returns a JSON findings report built from `fixtures/data/audit-report/report.json`.
3. `examples/seller-adapter.template.json`: the audit-report terms of `fixtures/terms/audit-report.yaml` with placeholders for the scope.
4. The card convention gains a quoted price, `"pricing": {"kind": "quoted", "quote": "<url>"}`, documented in `site/llms.txt` with a seller's section, "Sell a priced API service".
5. A test on the in-process chain (SimChain, through `startSimWorld`): a quoted 2,000.00 tUSD job with a 4-day delivery window ends `Released` with the report delivered; a report that fails preflight ends with no delivery; a restart mid-deal starts one job and delivers once.

**Non-goals.**
- No change to `spec/schemas/`, to the protocol or to any package. The card is a convention.
- No ledger and no monthly export.
- No wait for finality before the job starts.
- No payout address apart from the signing key.
- No change to the live test seller's card.
- No code from the template, the scope or the result runs. The template is data with named placeholders.

## Context

- `examples/agent.ts`: `Agent.offer`, `Agent.deliver`, `Agent.trusted` (a read every operator must answer the same way).
- `packages/judgment/src/preflight.ts` (T-316): the adjudicator's intake rules and stage 1, run by the seller.
- `fixtures/terms/audit-report.yaml` and `fixtures/data/audit-report/` (T-317): the sample deal.
- `apps/operator/src/server.ts`, `stream`: `GET /v1/events?from=<seq>`, server-sent events.
- `site/llms.txt`, "Two agents, two people": the card convention.
- `docs/team.md`, Rules and checks: "Deliverables untrusted, output surfaces" and "Examples run as written".

## Acceptance criteria

- [x] `POST /quote` with `{buyer, buyerEncryptionPublicKey, scope}` answers `{commitmentId, price, fees, expiresAt}`, and the commitment at that ID is an offer the seller's key signed, naming that buyer, at the quoted price (test).
- [x] The offer's terms are the template filled with the scope: with the sample scope, `acceptance` equals `fixtures/terms/audit-report.yaml`'s (test).
- [x] A buyer asks for a quote for a 2,000.00 tUSD job with a 4-day delivery window, funds it, and the deal ends `Released`; the buyer opens the report (test).
- [x] The adapter starts the job only after the hold is funded, and learns it from the event stream or from polling (test: each alone).
- [x] A restart mid-deal starts one job and submits one delivery (test, including a journal left at "starting").
- [x] A report that fails preflight is not delivered: the settlement log holds no `delivery.submitted`, the commitment stays `Held`, and the log names the failed check (test).
- [x] `POST /quote` refuses a scope outside the configured rules with 400 and makes no offer; the same `Idempotency-Key` with the same body replays the answer, and with another body answers 409 (test).
- [x] Prices and fees are base-unit decimal strings; the adapter refuses a quote from the seller's API whose amount is not one (test).
- [x] `site/llms.txt` documents `pricing.kind: "quoted"` beside the card convention and has the section "Sell a priced API service"; `node site/build.mjs && node site/check.mjs` passes.
- [x] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A ledger with a monthly export.
- Waiting for finality before starting work.
- A payout address apart from the signing key.
- The test seller's live card.

## Evidence

All runs on 2026-11-11, on branch `t-318-seller-adapter`, cut from `origin/main` at `a42dc45`.

- **Test first (measured).** `pnpm exec vitest run examples/seller-adapter.test.ts` failed to load before the adapter existed: "Cannot find module './seller-adapter.ts'".
- **The adapter's test (measured).** `pnpm exec vitest run examples/seller-adapter.test.ts`: 10 tests passed in about 4 s. They cover the quote and the signed offer, the refused scopes, the Idempotency-Key, a price that is not a base-unit string, the operator fee and total, the 2,000.00 tUSD deal that ends `Released`, the stream alone, polling alone, the report that fails preflight, and the restarts.
- **The test fails on a broken adapter (measured).** Four changes to the adapter, one at a time, each failed exactly one test: delivering whatever preflight says; a fresh key on each start call; a stream that wakes nothing; no settlement check before the delivery. The file was restored after each run.
- **As separate processes (measured).** `node examples/seller-adapter-stub.ts` and `node examples/seller-adapter.ts --sim` ran as written against a sim. A buyer's quote answered 2,000,000,000 base units of tUSD with a 1,000,000 base-unit adjudication fee, the adapter saw the funded hold 155 ms after its offer, and the deal ended `Released` with a 4,573-byte report.
- **The examples and the site's tests (measured).** `pnpm exec vitest run examples tests/site-deploy.test.ts tests/audit-report-template.test.ts`: 20 files passed; 210 tests passed and 13 skipped. That run came before the operator-fee test and the `total` field; the adapter's own test ran again after them.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm lint` prints nothing.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". `site/index.html` and `site/try.mjs` did not change.
- **Not run.** The full `pnpm verify` (the recipe keeps it for deploys), `pnpm snap` (no scenario or judgment code changed) and gitleaks, which is not installed on this machine. CI runs all three.

## Decisions

1. **The template is a JSON file with named placeholders.** `{{field}}` stands for a scope field and `{{field.length}}` for a list's size. A string that is only a placeholder takes the value itself, so a list fills an `enum` and a number fills `minItems`. The adapter fills the template in one pass, so a scope value is never read as a placeholder. A test holds the filled template equal to `fixtures/terms/audit-report.yaml`'s `acceptance`.
2. **The scope has rules in the configuration.** Each field is a string with a pattern, a list of distinct strings, or a whole number in a range. The adapter refuses any other scope with 400 before the seller's API or the seller's key sees it. These are the seller's own limits on what it sells, not protocol limits (D31).
3. **The event stream wakes the loop; a trusted read decides.** One operator serves the stream and could omit or invent an event. The adapter starts a job only when every configured operator shows the commitment `Held` (`Agent.trusted`). Polling covers a stream that drops.
4. **Restart safety has two sources.** The journal records `starting` before the start call and sends the commitment ID as the `Idempotency-Key`, so a repeat after a crash reaches the same job. For the delivery, the settlement layer decides: the adapter reads the state and the `delivery.submitted` event before it delivers, and the rules contract takes one delivery in any case.
5. **A preflight result of `escalate` is not delivered either.** A check that cannot be decided would escalate the deal. The adapter logs it and leaves the choice to the seller, who can deliver by hand with `seal.ts`.
6. **The seller's API may quote the delivery window.** A quote's `deliverWithinSec` replaces the configured one. The stub quotes one day plus one day for each 1,000 lines started, so 3,000 lines give the test's 4 days.
7. **`fees` carries `adjudication`, `operator` and `total`.** T-319's stand-in seller answers the same three, and T-319 passes `fees` through unread. The buyer computes the fees from the terms itself.
8. **`POST /quote` takes an optional `Idempotency-Key`.** T-319's signer sends none today, so the route cannot require one. With a key, the same body replays the answer and another body answers 409; the journal keeps the answers across restarts.
9. **`--sim` reads the club, the operators, the adjudicators and a test key from a running sim.** It is the one command that runs the adapter with no configuration. Without it, the key comes from `HOLDBACK_KEY` only.
10. **No chain guard in the adapter.** `@holdback/core`'s list of mainnet chain IDs is not a dependency of the examples. The adapter signs under the pinned domain (`verify.ts`), and the operators it talks to refuse a mainnet at startup.

## Handoff

**Done.** The adapter, the stub seller API, the template, their test, the quoted price in the card convention and the section "Sell a priced API service" in `site/llms.txt`.

**Not done.**
- The site deploy that publishes the section waits for Rafa.
- T-319's buyer signer (PR 281) has not run against this adapter. Its test plays the seller itself. A follow-up test can point `examples/buy-with-signer.ts` at the adapter: the signer sends the scope as given, and the adapter's sample rules want `{commit, files, lines}`.

**Follow-ups, each out of scope here.**
1. **A ledger with a monthly export.** The journal keeps every deal and every keyed quote answer and never prunes them.
2. **Waiting for finality before starting work.** The adapter starts the job when both operators show `Held`. On a chain a reorganization could undo that hold after the work began.
3. **A payout address apart from the signing key.** The seller is paid at the address that signs.
4. **The test seller's live card.** It does not list a quoted item.
5. **A rate limit on `POST /quote`.** Each quote makes the adapter sign and submit an offer. The adapter listens on 127.0.0.1; a seller puts its own front before it.
6. **Private and judgment-level deals.** The adapter makes public-level offers with the seller's standing key. Per-deal keys and sealed terms (ADR-0024) need `Agent.offerPrivate`.
7. **A second look at a refused result.** After a failed preflight the adapter stops on that deal. It does not fetch a corrected result.

**Known limits.**
- Run one adapter per journal. Two processes on one journal could both call start; the `Idempotency-Key` still gives one job on a seller API that honors it.
- The seller's API must return the same job for the same `Idempotency-Key`. A seller API without that rule can start a job twice after a crash between the call and its record.
- The preflight does not run the screen or the judges (T-316's Handoff).

**How to resume.** Run `pnpm exec vitest run examples/seller-adapter.test.ts`. To run the adapter against the stub: `pnpm install && pnpm build`, then `pnpm sim`, `node examples/seller-adapter-stub.ts` and `node examples/seller-adapter.ts --sim` in three terminals, and POST a quote to `http://127.0.0.1:8791/quote`.
