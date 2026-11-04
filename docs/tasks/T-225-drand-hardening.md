# T-225: harden the drand quicknet path (T-217's review and red-team findings)

- **Lane:** judgment (with core and contracts for item 1, and settlement for item 4)
- **Phase:** 11, security hardening
- **Depends on:** T-217 (PR 186, the drand-quicknet source). Item 1 waits for a contract redeploy; the others do not.
- **Paths this task may touch:** `apps/adjudicator/src/drand.ts`, `service.ts` (`runOnce` and `#preflight`), their tests and `scripts/mutants.mjs`; `packages/core/src/state.ts` (`beaconRoundFor`, the offer) and its tests; `packages/settlement/sim/simchain.ts` (`beaconFact`, genesis clubs) and its tests; `contracts/src/HoldbackRules.sol` (the fallback round in `decide`) and its tests, with an ADR-0018 amendment; `apps/demo-cloud/src/world.ts` (item 6 only); this file
- **Human gate:** the contract redeploy in item 1 (Rafa).
- **Status:** todo
- **Agent/session:** —

## Intent

T-217 shipped the functional path: fallback and appeal adjudicators decide from proven drand quicknet rounds on Sepolia. Its review and red team (PR 186, 2026-11-04) found no Critical or High issue. Rafa moved the rest here: "we need something functional then add security issues to the security hardening phase" (2026-11-04).

The reports and the tests that prove each finding are in Rafa's session notes, `/Users/rafa/Library/Application Support/Claude/side-session-notes/local_5d96f464-3e9f-488a-8cd3-964dda80e0bc/t225-drand-hardening/`: `redteam.md`, `review.md` and six test files. They were written against the T-217 branch before it was simplified, so some name options that branch dropped (`budgetMs`); adapt them as the fixes land.

## Acceptance criteria

1. [ ] **The fallback's round is not public before the primary's deadline** (red team M1, Medium). On quicknet the round at `judgeBy` is published 1 or 2 s before `judgeBy` for 2 in every 3 `judgeBy` seconds, so the primary can compute the fallback's panel and then choose to decide or stay silent. Fix: the first round published at or after `judgeBy`, `roundAt(judgeBy − 1 s) + 1`, in core's `beaconRoundFor` and `HoldbackRules.decide` together (sim rounds do not change), with an ADR-0018 amendment and a redeploy. Until then: `prepare/offer` suggests a `judgeBy` on a quicknet round boundary, `(judgeBy − 1692803367) mod 3 = 0` (advisory, D31). Test: `state.redteam.test.ts`, `service.redteam.test.ts`.
2. [ ] **A relay outage costs a pass little** (red team M2, Medium). Today each drand task whose round no relay proves waits for every relay's 2 s timeout in turn, tasks on the same round each ask again, a task past its deadline keeps asking, and primaries wait behind them. Fix: one overall budget per round, one in-flight ask per round, a short memory of a missed round, no fetch past the deadline, and primary tasks before beacon-dependent ones in `runOnce`. Tests: `service.redteam.test.ts`, `drand-outage-cost.test.excerpt.ts`.
3. [ ] **A lying relay cannot send a huge answer** (red team M3, Medium). The source reads any body whole (a 32 MB one, measured). Fix: refuse a body over 4 KiB unread. Test: `drand.redteam.test.ts`.
4. [ ] **SimChain keeps `sim` only** (red team L1 and the review, Low). SimChain's beacon fact is its own sim value at a quicknet-numbered round, so a sim-seeded decision on a drand club settles, with seeds public in advance. Fix: `beaconFact` gives no value unless the state's source is `sim`; refuse a drand club at genesis. Test: `simchain-drand-club.redteam.test.ts`.
5. [ ] **Small checks** (Low): core's offer checks the drand chain hash, as `parseClub` does (red team L2; `simchain-adapter.redteam.test.ts`); relay URLs are checked when the source is built (red team L3; `drand.redteam.test.ts`); an adjudicator with no drand source does not trigger a takeover it can never decide (review).
6. [ ] **The rulebook's source matches the deployed beacon** (red team I1): a live world refuses a `sim` rulebook over `DrandQuicknetBeacon`, and a `drand-quicknet` rulebook over `SimBeacon`.
7. [ ] **A second review from another model family** of `quicknetValue` against `DrandQuicknetBeacon.beaconValue` and of `beaconRoundFor` against the contract's round selection (review suggestion), alongside the verifier's external review (backlog row, T-209).
8. [ ] `reviewer` and `red-teamer` passes with project context; `pnpm verify` green.

## Out of scope

- A block producer that delays its block to see the appeal round (red team I2): bounded, and it depends on the chain choice (D4).

## Evidence

## Decisions

## Handoff
