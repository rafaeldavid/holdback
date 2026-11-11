# T-318: a reference seller adapter for a service that prices by quote

- **Lane:** api (example code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review. The `site/llms.txt` section is kind 1.
- **Depends on:** T-316 (`preflightDelivery`, PR 278), T-317 (the audit-report terms and sample reports, PR 273)
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter-stub.ts`, `examples/seller-adapter.template.json`, `examples/seller-adapter.test.ts`, `vitest.config.ts` (the test file's cost line only), `site/llms.txt` (the card paragraph and the new section only), `site/index.html` (only if the build regenerates it), this file. Never: `spec/schemas/`, `contracts/`, `packages/`, `apps/`, `examples/buyer-signer.ts` (T-319).
- **Human gate:** no. The site deploy that publishes the `llms.txt` section waits for Rafa.
- **Status:** in progress
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

- [ ] `POST /quote` with `{buyer, buyerEncryptionPublicKey, scope}` answers `{commitmentId, price, fees, expiresAt}`, and the commitment at that ID is an offer the seller's key signed, naming that buyer, at the quoted price (test).
- [ ] The offer's terms are the template filled with the scope: with the sample scope, `acceptance` equals `fixtures/terms/audit-report.yaml`'s (test).
- [ ] A buyer asks for a quote for a 2,000.00 tUSD job with a 4-day delivery window, funds it, and the deal ends `Released`; the buyer opens the report (test).
- [ ] The adapter starts the job only after the hold is funded, and learns it from the event stream or from polling (test: each alone).
- [ ] A restart mid-deal starts one job and submits one delivery (test, including a journal left at "starting").
- [ ] A report that fails preflight is not delivered: the settlement log holds no `delivery.submitted`, the commitment stays `Held`, and the log names the failed check (test).
- [ ] `POST /quote` refuses a scope outside the configured rules with 400 and makes no offer; the same `Idempotency-Key` with the same body replays the answer, and with another body answers 409 (test).
- [ ] Prices and fees are base-unit decimal strings; the adapter refuses a quote from the seller's API whose amount is not one (test).
- [ ] `site/llms.txt` documents `pricing.kind: "quoted"` beside the card convention and has the section "Sell a priced API service"; `node site/build.mjs && node site/check.mjs` passes.
- [ ] `pnpm typecheck`, `pnpm lint` and the examples' tests pass.

## Out of scope

- A ledger with a monthly export.
- Waiting for finality before starting work.
- A payout address apart from the signing key.
- The test seller's live card.

## Evidence

Fill this in before review.

## Decisions

## Handoff
