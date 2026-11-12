# T-336: an invariant counts the handler's deliveries and catches a lost delivery hash

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-203 (the invariant suite), T-212 (ADR-0029: every decision names the posted delivery)
- **Paths this task may touch:** `contracts/test/handlers/RulesHandler.sol`, `contracts/test/invariant/`, `docs/audit/known-issues.md` (row G-5 only), `docs/tasks/T-336-invariant-liveness-counter.md`
- **Human gate:** no
- **Status:** done (PR #325 merged 2026-11-11; one review, PASS: a fresh campaign fails `invariant_deliveryHashStored` on the mutant; T-341 builds on the counter)
- **Agent/session:** implementer, pilot plan package C1b ("Invariants")

## Intent

Today a mutant of `HoldbackRules` that never stores the delivery hash passes the whole invariant suite: every decision and early accept after a delivery then reverts, so deals only close through timeouts, and no invariant notices that settlement stalled (`docs/audit/known-issues.md` G-5, T-212 Handoff). The unit tests catch it; the stateful campaign does not.

This task makes the campaign catch it. The handler gets ghost counters for the deliveries that land on chain and the hash of each posted delivery, and a new invariant fails when a deal the handler delivered has no matching delivery hash on chain, when a delivery lands that the handler did not count, or when an authorised, timely `deliver` is refused. Smoke tests show the counter moves on every path that carries a delivery, so the invariant cannot pass vacuously.

Non-goals: no change to `contracts/src/` (the mutant lives only in the worktree and is never committed), no change to the campaign settings (256 runs, depth 100), no change to any existing invariant or smoke test, no edit to `contracts/README.md`, no edit outside row G-5 in `known-issues.md`.

## Context

- `docs/audit/known-issues.md` row G-5; `docs/tasks/T-212-contract-hardening.md` (Evidence on the handler, Handoff on the mutant).
- ADR-0029: decisions, early accepts and mutual settlements name the posted delivery (`deliveryHashOf`).
- `contracts/test/invariant/RulesInvariants.t.sol`, `contracts/test/invariant/HandlerSmoke.t.sol`, `contracts/test/handlers/RulesHandler.sol`.

## Acceptance criteria

- [ ] The handler counts every landed delivery (`deliveries`) and records the posted delivery's hash per deal (`postedHash`), on all four paths: `deliver`, a decision carrying the delivery, an early accept carrying it, and `decideFallback`'s own delivery.
- [ ] A new invariant fails when a delivered deal's `deliveryHashOf` differs from the posted delivery's hash, when a deal's attempt is set without a counted delivery, or when an authorised `deliver` before `deliverBy` is refused.
- [ ] Smoke tests assert that the counter moves on each of the four paths and stays at 0 for a refused delivery.
- [ ] Measured: the "stores no delivery hash" mutant fails the new invariant; the real source passes the whole suite.
- [ ] No existing invariant, smoke test or campaign setting changes; `contracts/src/` has no diff against `origin/main`.
- [ ] `known-issues.md` row G-5 names the invariant and says fixed in this PR.

## Out of scope

- Other mutants and other liveness properties (for example, "an authorised decision after a delivery is never refused").
- `contracts/README.md` counts (the coordinator refreshes them).

## Evidence

- **Test first [measured].** The five new smoke tests failed to compile before the handler change (`Member "deliveries" not found ... in contract RulesHandler`), then passed after it: `HandlerSmoke.t.sol` 17 passed, 0 failed.
- **Real source [measured].** `forge test --match-path "test/invariant/*"`: 28 passed, 0 failed, 0 skipped, 2 suites. All 11 invariants pass at 256 runs and depth 100 (25,600 calls each), `invariant_deliveryHashStored` included.
- **The mutant is caught [measured].** In this worktree only, `HoldbackRules._acceptDelivery` lost the line `deliveryHashOf[id] = dh;`. The invariant suite then failed in 1 of 11 invariants, the new one:
  `[FAIL: the stored delivery hash != the posted delivery's: 0x0000000000000000000000000000000000000000000000000000000000000000 != 0x9d90c19fb9050f45a6440f54e92414dd87069be75b41124a3c3b9258612ba55d] invariant_deliveryHashStored()`.
  The other 10 invariants passed under the mutant, which is the gap G-5 recorded. In the smoke suite, 9 of 17 tests failed, 4 of them new (`test_deliveryCounter_deliver` with the same hash mismatch, and the decision, early accept and fallback paths). Then `git -C <worktree> checkout -- contracts/src/HoldbackRules.sol`; `git diff --stat origin/main -- contracts/src` printed nothing. The mutant was never committed.
- **The counter moves in the campaign [measured].** With `FOUNDRY_INVARIANT_SHOW_METRICS=true`, one campaign of 25,600 calls had 37 successful `deliver` calls, 42 `earlyAccept`, 37 `decide` and 24 `decideFallback` calls (each can land a delivery).
- **No per-run liveness assertion [measured].** A temporary `afterInvariant` asserting `deliveries() > 0` failed all 11 campaigns: some runs of 100 calls land no delivery, so a per-run assertion would be flaky. It was removed before commit; the smoke tests carry the non-vacuity check instead.
- **Full kind-7 check [measured].** `forge test --root <worktree>/contracts`: 254 passed, 0 failed, 0 skipped, 37 suites, 62 s.
- **Counts.** The invariant suite now has 11 `invariant_*` tests in 2 files (was 10), and `HandlerSmoke.t.sol` has 17 tests (was 12) [measured]. `contracts/README.md` is not edited; the coordinator refreshes its counts.

## Decisions

- **The posted hash comes from the fixture.** Every handler path posts `Base._delivery()`, so `_track` records `hx.delivery(id, dv)` when a deal's attempt goes from 0 to 1 in Held. That one hook covers all four paths (`deliver`, a carried decision, a carried early accept, `decideFallback`) without touching each action.
- **The invariant checks state both ways.** A delivered deal stores exactly the posted hash; an undelivered deal stores none; the on-chain attempt is set exactly when the handler counted a delivery; and the counter equals the delivered deals. So a landing path the handler forgets fails too, not only the mutant.
- **`deliverRefused` is a liveness counter for `deliver` itself:** the seller's own delivery on a Held deal before deliverBy must land from any relayer. Both new counters join `_violations()`, so a call that trips them is not re-reverted as `Refused()`.
- **Non-vacuity lives in the smoke tests, not in `afterInvariant`** (see Evidence: a per-run assertion is flaky).

## Handoff

- Done: the handler's delivery counter, `invariant_deliveryHashStored`, five smoke tests, and G-5 marked fixed. No change to `contracts/src/`, the campaign settings or any existing invariant.
- T-341 (refinement package R3) builds its state oracle in `RulesHandler.sol` and `test/invariant/` on top of this counter.
- Not done (out of scope): a liveness counter for decisions ("an authorised, timely decision after a delivery is never refused"), which would also catch a mutant that breaks the decision path without touching the stored hash.
