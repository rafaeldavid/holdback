# T-321: one audit-shaped deal, end to end

- **Lane:** demo (examples), test
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (example and fixture code) for the build; 9 (a live test on testnet) for the one run on Sepolia, from the Change recipes in `docs/team.md`
- **Depends on:** T-320 (the loosened template, PR 287), T-318 (the seller adapter, PR 284), T-319 (the buyer signer, PR 281), T-316 (the seller's check runner, PR 278)
- **Paths this task may touch:** `examples/audit-deal.ts`, `examples/audit-deal.test.ts`, `examples/seller-adapter.ts`, `examples/seller-adapter-stub.ts`, `examples/seller-adapter.test.ts`, `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buy-with-signer.ts`, `examples/two-origins.ts` (its header comment), `package.json` (one script), `site/llms.txt` (three lines in "Sell a priced API service", kind 1), `docs/tasks/T-320-audit-template-fit.md` (its Status, on merge), this file. Never: `spec/schemas/`, `apps/`, `packages/`, `.env*`.
- **Human gate:** no for the build. The live run uses test tokens on Sepolia through the public test service and its faucet, which the brief names; it deploys nothing.
- **Status:** review
- **Agent/session:** the T-320 and T-321 session, 2026-11-11, branch `t-321-audit-deal-end-to-end`

## Intent

Rafa asked on 2026-11-11 for one audit-shaped deal that runs end to end with no gap.

**Why.** The seller adapter (T-318) and the buyer signer (T-319) were built in parallel against an agreed quote shape and have never run together. Each has its own test with a stand-in for the other side. Nobody has seen a buyer's key store and a seller's adapter complete one deal.

**Goal.** One script runs both sides of a deal for a code-audit report and shows every step:

1. The stub seller API and the seller adapter start. The adapter holds the seller's key.
2. The buyer signer makes fresh keys, asks the adapter for a quote, reads the offer from both operators, and approves it against its own expectation: 2,000.00 tUSD, a 4-day delivery window, and the T-320 template filled with the buyer's own scope.
3. The buyer takes test funds from the faucet, checks the offer, and funds the hold.
4. The adapter sees the hold, starts the job, runs the adjudicator's first stage on the result, and delivers.
5. The adjudicator accepts, the deal ends Released, and the buyer opens the report.
6. The script prints each step, what the buyer paid and the receipt.

A second case: the stub returns a report that misses one file in scope. The adapter's preflight refuses to deliver. After the delivery deadline the buyer's hold comes back.

**Also in this task.**
- Fix any mismatch between the adapter and the signer, in whichever file is wrong, and name it.
- `examples/buyer-signer.test.ts` failed 2 of 3 local runs for another agent. Reproduce it, fix the cause, and show 10 passes in a row.
- A script runs the deal: `pnpm audit-deal`.
- After the PR merges, run the Released case once against the live test service on Sepolia, and record the commitment ID, the transaction links, the time taken and every stall.

**Inputs.** `examples/seller-adapter.ts`, `examples/seller-adapter-stub.ts`, `examples/buyer-signer.ts`, `examples/seller-adapter.template.json` (T-320), the demo's world (`@holdback/demo-cloud`) served on two origins for the local run, and the live operators named in `https://crow.direct/llms.txt`.

**Outputs.** `examples/audit-deal.ts` with its test, the fixes to the adapter, the signer's script and the flaky test, the `audit-deal` script, and the live run's record in Evidence.

**Non-goals.**
- No change to `spec/schemas/`, the operator, the contracts or the judgment code.
- No real money, no mainnet, no deploy. Keys are fresh and stay in memory or in a scratch key store.
- No retry loop on the live run: one run, at most one retry, then report.
- No refund case on Sepolia: it would wait for the delivery deadline. The refund case runs on the local world, which moves its own clock.
- No real audit and no firm's report: the stub returns the generic sample report.

## Context

- `docs/tasks/T-318-seller-adapter.md` and `docs/tasks/T-319-buyer-signer.md`: the two halves and the quote shape they agreed (`POST /quote` with `{buyer, buyerEncryptionPublicKey, scope}`, answered by `{commitmentId, price, fees, expiresAt}`).
- `docs/tasks/T-320-audit-template-fit.md`: the template the deal uses.
- `site/llms.txt`: the faucet, the triggers (`reclaim` after `deliverBy`), and the live operators.
- `CLAUDE.md`, hard rules: each party signs its own messages; operators relay; idempotency keys on mutating calls; money as base-unit decimal strings; a deliverable is untrusted data.

## Acceptance criteria

- [ ] `examples/audit-deal.test.ts`: the Released case ends Released on both operators; the buyer paid the price, the adjudication fee and the operator fee; the seller holds 2,000.00 tUSD; the buyer opened a report that passes the template's checks.
- [ ] The same test: the refused case ends Refunded after the delivery deadline; the adapter's stage is `refused` and its log names the failed check; no delivery is recorded; the hold (price plus adjudication fee) is back on the buyer's key.
- [ ] The buyer approves against its own expectation, not against whatever the offer says: a test shows the script stopping on an offer with another price.
- [ ] The script prints no secret key (test).
- [ ] `examples/buyer-signer.test.ts` passes 10 runs in a row; Evidence states the cause of the failures.
- [ ] `pnpm audit-deal` runs both cases on a local world and exits 0.
- [ ] `pnpm typecheck`, `pnpm lint`, the examples' tests, `pnpm validate:spec`, `pnpm snap` and the site check pass.
- [ ] After merge: one live run on Sepolia, recorded in Evidence with the commitment ID, the transaction links, the time taken and each stall; or the failure with its request IDs.

## Out of scope

- A real seller API, a real audit, and a buyer's own agent logic for approving a quote.
- Anything a later ticket should build; the Handoff ranks the gaps that still stop a real seller.

## Evidence

All local runs on 2026-11-11, on branch `t-321-audit-deal-end-to-end` cut from `origin/main` at `b04d4de` (after PR 287).

### The deal, locally

- **Both outcomes run end to end (measured).** `pnpm audit-deal` exits 0. The released outcome ends Released in 0.6 s: the buyer paid 2,001.20 tUSD (2,001.00 tUSD into the hold, 0.20 tUSD operator fee), the seller received 2,000.00 tUSD, and the buyer opened a 4,938-byte report with 3 findings that its own run of the 5 checks accepts. The refused outcome ends Refunded in 0.5 s: the adapter logged `FAIL coverage (required): schema: /filesReviewed: fewer than 3 items` and delivered nothing, the world's clock moved 345,601 s forward, the buyer sent the reclaim, and its key holds 2,001.00 tUSD again.
- **The test (measured).** `pnpm exec vitest run examples/audit-deal.test.ts`: 5 tests passed. They cover both outcomes, the amounts, the receipt, the step order, no secret key and no report text in the output, the 20-line script against the adapter, and a stop before any signature on an offer with another price.
- **The adapter and the signer had never run together.** The first run of `runAuditDeal` on the local world passed (measured). The two mismatches below did not show there: one needs a chain, the other is in the script beside the signer.

### The mismatches, and which file was wrong

1. **The adapter was wrong: it signed under a settlement layer set by environment variables, not the one its operators serve.** `examples/seller-adapter.ts` built its agent with the default EIP-712 domain, SimChain's unless `HOLDBACK_CHAIN_ID` and `HOLDBACK_VERIFYING_CONTRACT` were set in the process environment, although it takes its key and operators from the `env` argument. The buyer signer reads the domain from both operators and requires a pinned one. On the live service (chain 11155111) the adapter's offer would carry a signature under the wrong domain (inferred from the code; the live run below is the measurement that the fix works). The adapter now reads the domain from both operators, starts only on one pinned in `verify.ts`, and signs under it. A new test shows it refusing to start on an unpinned domain (measured).
2. **The adapter's stub and the adapter did not say which token a price is in.** The stub priced in `tUSD` whatever the settlement layer. On Sepolia the token ID is the token's address (discovery, `demo.token.id`). The stub now takes the token as an option, and the adapter refuses a price in another token and logs the one it holds (measured, new test).
3. **The signer's script was wrong: `examples/buy-with-signer.ts` sent its scope argument as a string.** The adapter takes a scope object and answered 400 (measured: the new test failed with "the seller's quote route answered 400" before the fix). The script now parses the argument as JSON. The signer's error now carries the seller's reason, as printable text of at most 200 characters: "answered 400: scope must be an object".

The agreed quote shape itself matched: `{buyer, buyerEncryptionPublicKey, scope}` in, `{commitmentId, price, fees, expiresAt}` out, with the buyer's `Idempotency-Key` replayed by the adapter (measured, the local runs).

### The flaky test

- **Reproduced (measured).** Before the fix, `pnpm exec vitest run examples/buyer-signer.test.ts` failed 2 of 6 runs, both in "checkOffer refuses an offer whose price, check list or adjudicator differs", with `expected 'Offered' to be 'AcceptedByAdjudicator'`.
- **Cause.** The test asserted the deal's state right after eight refusals. A refusal returns before `checkOffer` waits for the adjudicator, and the eight take about 85 ms. The adjudicator accepts on the world's next pass, every 100 ms. When the pass had not run yet, the deal was still Offered. The signer was right; the test raced the adjudicator.
- **Fix.** The test now asserts "Offered or AcceptedByAdjudicator" at that point, and "AcceptedByAdjudicator" after the approved `checkOffer` returns, which waits for the adjudicator.
- **After (measured).** 10 runs in a row: 10 passed, 6 of 6 tests each.

### Checks

- `pnpm typecheck` exits 0; `pnpm lint` prints nothing (measured).
- `pnpm exec vitest run examples/ tests/`: 37 files; 581 tests passed and 13 skipped (measured).
- `pnpm validate:spec`: 35 of 35 examples valid. `pnpm snap`: 35 passed, 0 failed, no snapshot changed. `node site/build.mjs && node site/check.mjs`: "site check PASS" (measured).
- Not run: the full `pnpm verify` (the recipe keeps it for deploys) and gitleaks, which is not installed on this machine. CI runs both gates.

### The live run on Sepolia

Recorded after the PR merges.

## Decisions

1. **The buyer approves against its own expectation.** `audit-deal.ts` fills the template with the buyer's scope and passes that, the price it agreed and the adjudicators discovery names to `checkOffer`. It does not approve whatever the offer says, as the 20-line script does. A cap of 60.00 on the fees and a check that the delivery deadline is 4 days away come first.
2. **`fill` is exported from the adapter.** The buyer fills the same template the seller does. A real buyer would hold its own copy of the template.
3. **The local run uses the public demo's world, not the sim.** The buyer signer takes test funds from the faucet, which only that world serves. `startLocalWorld` gives it a clock the script moves, so the refused outcome reaches a deadline 4 days away at once.
4. **The buyer sends the reclaim itself in the local run.** The trigger needs no signature. On a chain the operators send it; on SimChain nobody else does.
5. **A script of its own, `pnpm audit-deal`.** `pnpm demo` is the scripted two-agent demo in `apps/demo` with its own transcript; the examples have their own scripts (`pnpm example`).
6. **The live run keeps its key store and prints refused requests.** The directory is printed, and each request an operator refuses is listed with its Request-Id.
7. **The report stays data.** The script counts findings and runs the check library on the bytes. It prints no text from the report; a test checks that a finding's title never reaches the output.
8. **`agent.ts` and `verify.ts` are unchanged.** `site/try.mjs` is a bundle of them, pinned by hash in `llms.txt`; a change there would change the published command.

## Handoff

**Done.** `examples/audit-deal.ts` and its test; the adapter pins its settlement layer and checks the price's token; the signer's script takes a JSON scope and the signer's quote error carries the seller's reason; the flaky test is fixed; `pnpm audit-deal` runs both outcomes locally.

**Not done.** The live run on Sepolia follows the merge; its record goes into Evidence in a docs PR that also sets this task's Status to done. The site deploy that publishes the three new `llms.txt` lines waits for Rafa.

**How to resume.** `pnpm audit-deal` for the local run, `pnpm audit-deal --live` for the live one, `pnpm exec vitest run examples/audit-deal.test.ts` for the test.

**What still stops a real seller, ranked (inferred from this build; the live run may add to it).**

1. **No path from a real report to the template's JSON.** A seller's report is a document; the deal takes one JSON file of at most 1 MiB of ciphertext, and judges read 100,000 characters whole. Nobody has built the converter, and the buyer signer returns text only.
2. **One delivery, and the adapter stops at a refused preflight.** With `maxSubmissions` 1, a report that fails a check is not delivered and the adapter does nothing more. The seller must fix the report and deliver by hand (`check-delivery.ts`, `seal.ts`) before `deliverBy`, or the buyer is refunded.
3. **Membership is the faucet's.** A real seller and buyer need a mandate in a club. On the test service the faucet grants one; nothing else here does.
4. **The adapter is one process with a journal file.** It needs the seller's own HTTPS front, authentication and rate limit before `/quote`, because every quote makes it sign an offer. A 4-day job needs it to stay up or restart cleanly for 4 days; the restart test covers minutes.
5. **The buyer has no notice of the outcome.** `openDelivery` waits 10 minutes by default. For a 4-day job the client must come back with `loadKeys` and ask again. The signer also has no reclaim call; on an operator that does not send timeouts the buyer posts the trigger itself, as `audit-deal.ts` does.
6. **Terms are the seller's template, per seller and not per quote.** The proof term, the severity scale, the windows and the adjudicators are fixed in the adapter's configuration. A buyer who wants other terms has no way to ask through `/quote`.
7. **Test tokens only.** The contracts are reviewed and not audited, and the service refuses real money by design.
