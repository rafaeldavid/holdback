# T-336: an invariant counts the handler's deliveries and catches a lost delivery hash

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-203 (the invariant suite), T-212 (ADR-0029: every decision names the posted delivery)
- **Paths this task may touch:** `contracts/test/handlers/RulesHandler.sol`, `contracts/test/invariant/`, `docs/audit/known-issues.md` (row G-5 only), `docs/tasks/T-336-invariant-liveness-counter.md`
- **Human gate:** no
- **Status:** in progress
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

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
