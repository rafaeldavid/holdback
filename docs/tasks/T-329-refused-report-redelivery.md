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

All runs on 2026-11-11, on branch `t-329-refused-report-redelivery`, cut from `origin/main` at `f0b44ef`.

- **Test first (measured).** With the tests and the stub change but no adapter change, `pnpm build` failed: `alerts` and `redelivery` do not exist in type `Partial<SellerAdapterConfig>`.
- **The adapter's tests (measured).** `pnpm exec vitest run examples/seller-adapter.test.ts`: 31 tests passed in 10.4 s, 7 of them new, on a SimWorld of their own:
  - fixed on the seller's ready signal: the alert names `coverage` (required) and `schema: /filesReviewed: fewer than 3 items`, and its `X-Crow-Signature` matches HMAC-SHA256 of the body. For 300 ms nothing is delivered and the deal stays `Held`. The ready route answers 401 without the credential or with a wrong one, 404 for an unknown deal, 202 for the deal, and 409 once the deal is delivered. The deal ends `Released` with one `delivery.submitted` and one job, the buyer opens the fixed report, and a `delivery.fixed` alert says attempt 2. Neither secret appears in the log;
  - fixed on a 1-second refetch schedule: `Released`, one delivery;
  - never fixed, with a 10-second window and a refetch at every poll: the adapter fetches again, sends one alert, delivers nothing, and the deal stays `Held`. At `deliverBy` the deal is `closed`, a `delivery.deadline_passed` alert goes out, the fetches stop, and the deal is still `Held` with no delivery;
  - a restart while waiting, with a receiver that answers 500: run 1 logs "the alert callback answered 500". The journal keeps `refused`, `refusals: 1` and the refused hash. Run 2 waits, sends no second alert, and delivers once on the ready signal. Run 3, with the journal set to `delivering`, finds the delivery and fetches nothing;
  - a crash just before the delivery call (`delivering`, nothing submitted): the next start delivers once and the deal ends `Released`;
  - a receiver that never answers (60 s timeout): the deal is refused and then delivered while the receiver hangs, and `close()` returns at once. A receiver address that refuses connections: the log says "the alert callback failed" and the deal stays `Held`;
  - malformed settings refuse to start, and the error names each: a callback that is not an http or https address, a missing secret, a zero timeout, a refetch interval of -1 or 1.5, and missing ready credentials.
- **The examples' tests (measured).** `pnpm exec vitest run examples`: 22 files passed; 242 tests passed and 13 skipped, in 126 s.
- **Types and lint (measured).** `pnpm typecheck` exits 0. `pnpm lint` prints nothing.
- **Site (measured).** `node site/build.mjs && node site/check.mjs`: "site check PASS". The build left `site/index.html` and `site/try.mjs` unchanged.
- **T-330 (measured).** `git merge-tree` of this branch with `origin/t-330-terms-per-quote` merges with no conflict.
- **CI's first run (measured).** On PR 317, `test (1/4)` failed one test: `examples/audit-deal.test.ts` "refused: … the hold comes back after the delivery deadline" expected `sellerStage` `refused` and got `closed`. That run moves the clock past `deliverBy` and then read the adapter's stage, which this task now closes at `deliverBy`; whether a poll ran first decided the answer, so the test passed locally. `examples/audit-deal.ts` now records the stage when the adapter decides (3 lines). `pnpm exec vitest run examples/audit-deal.test.ts`: 13 tests passed.
- **Not shown by a test (inferred).** On SimChain the state leaves `Held` as soon as a delivery lands, so no test shows a restart in `delivering` while the state still reads `Held` and the event is already there. The code reads `delivery.submitted` in that stage whatever the state.
- **Not run.** The full `pnpm verify` (the recipe keeps it for deploys), `pnpm snap` (no scenario or judgment code changed) and gitleaks, which is not installed on this machine. CI runs them.

## Decisions

1. **"Signed-off log line" means one fixed-format line per alert.** It starts `ALERT <commitmentId> <type>`, and for a refusal it lists each check as `FAIL <check> (required): <why>`, so a seller can grep for it or feed it to a log alert. The callback body is signed (HMAC-SHA256 with a secret from the environment), not the log line.
2. **`refused` waits instead of ending.** The stage keeps its name, so the earlier tests and journals still read the same, and now means "the last result was refused; the delivery waits for a fixed one until `deliverBy`". `pass()` keeps visiting it.
3. **The seller's "ready" is a signal, not an upload.** `POST /deals/<commitmentId>/ready` takes no body; the adapter fetches the fixed report from `sellerApi.result`, an address in the configuration. No report, scope or request ever chooses a request's host. The route exists only when `redelivery.readyAuth` names credentials, and it compares their SHA-256 digests in constant time, as `quoteAuth` does.
4. **The schedule counts settlement-layer time.** `nextFetchAt` is the settlement time of the refusal plus `refetchEverySec`, and the deadline check uses `settlementNow()`, as before. `refetchEverySec` takes any whole number of seconds, 0 included (every poll), and is omitted for "only when I say" (D31). The shipped configuration sets 600 s.
5. **One alert for each distinct refused result.** The journal keeps the SHA-256 of the refused result's bytes, as they come from the seller's API. The same bytes again only move `nextFetchAt` forward, so a refetch at every poll does not flood the seller.
6. **A callback never holds up the loop.** It runs beside the loop, is not awaited, times out after `alerts.timeoutMs` (default 10,000 ms), follows no redirect, and is dropped when the adapter closes. It is not retried; the log line is the record (triage).
7. **The crash at the delivery call is fixed here** (T-324 triage row 3). It was small: a `delivering` stage before the call, and a read of `delivery.submitted` in that stage even while the state still reads Held.
8. **After `deliverBy` the adapter stops.** A deal that had refusals closes with a note and a `delivery.deadline_passed` alert; one that never had a result closes as before. The reclaim is the buyer's.

## Handoff

**Done.** The `alerts` and `redelivery` settings, the `ALERT` line and the signed callback, the wait in the journal, the refetch schedule and the ready route, the `delivering` stage (T-324 triage row 3), the stop at `deliverBy`, the stub's `setReport`, 7 tests, and one bullet plus step 4 in the seller section of `site/llms.txt`.

**Not done.**
- The site deploy that publishes the `llms.txt` change waits for Rafa.
- Four lower-priority finds are in `reports/scratch/t-329-triage.md` in the main checkout. They cover alert retry across a restart, reads at every poll while a deal waits, a rate limit on the ready route, and a chain whose events lag.

**Outside the listed paths.** `examples/audit-deal.ts` (T-326, merged): `sellerStage` is now the adapter's stage when it decided, read before the clock moves, because a refused deal now ends `closed` at `deliverBy`. It is 3 lines, and no open task holds the file.

**For T-330.** This task changed `examples/seller-adapter.ts` in these places: the header comment (step 3 and the result call), the `createHmac` import, the `alerts` and `redelivery` fields after `reportMapping`, a `redelivery` line in the shipped configuration after `pollMs`, the `Stage` type and the `Deal` fields, `bearerOk()`, `refusalSettings()` and `checkLine()` after `gate()`, one line after `gate(c, env)`, the `started` block of `advance()`, the new `alert()` and `refuse()`, the stage list in `pass()`, `readySignal()` and one route line before the `/quote` check, a startup log line, and `close()`. None is in the quote route or the offer's terms.

**How to resume.** Run `pnpm exec vitest run examples/seller-adapter.test.ts -t "T-329"`.
