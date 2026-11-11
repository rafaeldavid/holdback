# T-329: a refused check run alerts the seller, and the adapter delivers the fixed report

- **Lane:** api (example code)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, API and example code (Change recipes): the examples' tests, no review. A target of 150k tokens.
- **Depends on:** T-318 (the seller adapter, PR 284), T-323 (the report converter, PR 304), T-324 (the adapter as a service, PR 305)
- **Paths this task may touch:** `examples/seller-adapter.ts` (the result-to-delivery path, the journal's stages, the configuration fields this task adds, and one route for the seller's "ready" signal), `examples/seller-adapter-stub.ts`, `examples/seller-adapter.test.ts`, `vitest.config.ts` (the cost line of a new test file only), `site/llms.txt` (the seller section only), this file. Never: `packages/`, `apps/`, `spec/schemas/`, `contracts/`, `examples/buyer-signer.ts`, the adapter's quote route and the offer's terms (T-330 writes those).
- **Human gate:** no. A site deploy that publishes an `llms.txt` change waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-329 session, 2026-11-11, branch `t-329-refused-report-redelivery`
- **Roadmap:** N60

## Intent

Rafa asked on 2026-11-11 for the seller gaps left after the first audit deal on Sepolia. This is N60.

**Problem.** The rules contract takes one delivery per deal, so the adapter rightly does not deliver a report its own check run (`preflightDelivery`) refuses. Today it only logs the failed checks and marks the deal `refused` for good. The seller is not told, nothing delivers a fixed report, and the deal runs out `deliverBy`; then the buyer reclaims.

**Goal.** When the check run refuses a report, the adapter tells the seller which check failed and why, holds the delivery, and waits for a fixed report. It fetches the result again from the seller's API, on the seller's schedule or when the seller says the fix is ready, runs the check run on the new bytes, and delivers once they pass, before `deliverBy`. After `deliverBy` it stops and says so.

**Inputs.**
- The seller's configuration: an alert callback address, an optional environment variable that holds the callback's signing secret, a refetch interval, and an optional bearer credential (by environment variable name) for the "ready" signal.
- The seller's API's result address, as today. The fixed report comes from the same address.
- The agreed terms (`deliverBy`) and settlement-layer time, as every operator reports it.

**Outputs.**
1. An alert for each refused report: an `ALERT` log line, and a POST of a JSON body to the seller's callback address, signed with HMAC-SHA256 when the seller names a secret. The body names each failed or undecided check, whether it is required, and why. A failing or slow callback never holds up the deal loop.
2. The journal keeps a refused deal open, with the refusal count, the hash of the refused bytes, the next refetch time and the "ready" flag, so a restart resumes the wait.
3. A refetch on the seller's schedule (any whole number of seconds, D31), and a `POST /deals/<commitmentId>/ready` route for the seller that asks for one now. The fixed bytes go through the report mapping and the check run like the first result; the adapter delivers them only when the check run does not refuse them.
4. A `delivering` stage recorded before the delivery call. On a restart in that stage, the adapter reads `delivery.submitted` before it delivers again (row 3 of the T-324 triage).
5. After `deliverBy`, the deal is `closed`, and the adapter sends a last alert that says no fixed report was delivered.

**Non-goals.**
- No second delivery to the rules contract, and no change to the contract, the packages or `spec/schemas/`.
- The seller does not post the fixed report's bytes to the adapter: the adapter only fetches from the address in its configuration, so no request's host comes from a report, a scope or a request.
- No retry of a failed callback across a restart. The log line stays the record.
- No change to the quote route or the offer's terms (T-330).

## Context

- `docs/tasks/T-318-seller-adapter.md`, `docs/tasks/T-323-report-converter.md`, `docs/tasks/T-324-seller-adapter-service.md`.
- `packages/judgment/src/preflight.ts` (T-316): the seller's check run.
- `reports/scratch/t-324-triage.md` in the main checkout, row 3: a crash between the delivery call and its journal record.
- `CLAUDE.md`: secrets from the environment only, deliverables are untrusted, D31 (parametrize, don't restrict).

## Acceptance criteria

- [ ] When the check run refuses a report, the adapter names the failed check and why in an `ALERT` log line and in a POST to the seller's callback address; a failing callback never blocks the deal loop (test).
- [ ] The adapter holds the delivery and marks the deal as waiting for a fixed report, across a restart (test).
- [ ] It delivers a fixed report before `deliverBy`: on the seller's refetch schedule, or when the seller posts "ready"; it runs the check run on the new bytes and delivers once they pass (tests: one for each way).
- [ ] It never delivers twice and never delivers a report its check run refuses; after `deliverBy` it stops and says so (test).
- [ ] Tests cover: refused, then fixed and `Released`; refused and never fixed (no delivery, the deal still `Held`); a restart while waiting; a callback address that fails.
- [ ] `pnpm typecheck`, `pnpm lint` and all the examples' tests pass.

## Out of scope

- The quote path, the offer's terms and the buyer signer (N63, T-330).
- A journal lock and the other T-324 triage rows (N74).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
