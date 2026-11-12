# T-386: the round's beacon rounds follow the margin rule

- **Lane:** test (the Sepolia round's scenarios and the drand fork suite), on `contracts-audit-ready`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, with one reviewer (Change recipes)
- **Depends on:** R8's rounds fix (PR 418, `cd88cca`; ADR-0032)
- **Paths this task may touch:** `examples/e2e-scenarios-silent.ts`, `examples/e2e-scenarios-escalation.ts`, their tests, `examples/e2e-chain.ts` (one read), a new `examples/e2e-rounds.test.ts`, `apps/adjudicator/src/drand-fork.test.ts`, this file. Nothing else under `apps/`
- **Human gate:** no
- **Status:** review
- **Agent/session:** the T-374 session, 2026-11-12, branch `t-386-round-margin`

## Intent

ADR-0032 fixes two beacon rounds in the rules contract.
- **The fallback's round** is the first published after `judgeBy − 1 + BEACON_MARGIN`.
- **The appeal adjudicator's round** after an escalation is the first published after `t1 + BEACON_MARGIN`.

`BEACON_MARGIN` is 29 s on Sepolia and mainnet and 0 on a local chain. T-380 reported that the round's scenarios and the drand fork suite still state the rule from before the margin.

This task finds out, in each file, whether that is a comment or logic that computes or expects a round. It fixes what is wrong, reading the margin from the deployment rather than writing 29. The risk to rule out is an expectation that passes on anvil, where the margin is 0, and fails only in the live round on Sepolia at the cutover.

## Context

- `contracts/src/HoldbackRules.sol`, `_roundAfter`, `_fallbackRound`, `_appealRound`: `BEACON.roundAt(lastChoice + BEACON_MARGIN) + 1`.
- `packages/core/src/beacon.ts` `roundAfter`, and `state.ts` `beaconRoundFor(s, role, marginSec)`.
- `apps/adjudicator/src/randomness.ts` `roundFor`: the adjudicator already applies the margin.

## Acceptance criteria

- [ ] Each file's use is classified: comment or logic.
- [ ] Every expected round applies the margin, read from the deployment (`BEACON_MARGIN()`) or the settlement adapter (`beaconMarginSec`).
- [ ] A test shows the round's rule equals core's with a 29 s margin.
- [ ] The anvil round and the silent and escalation scenario files still pass.

## Out of scope

- The adjudicator's and the adapter's own round code (R8's, already on the rule).

## Evidence

**What each file held** [measured, by reading each file against `HoldbackRules._fallbackRound` and `_appealRound`]:

| File | Was | Kind | Now |
| --- | --- | --- | --- |
| `examples/e2e-scenarios-silent.ts`, scenario 4 | expected the fallback's beacon round to be `roundAt(judgeBy)`, the latest round at or before `judgeBy` | **logic** | `roundAt(judgeBy − 1 + margin) + 1`, the margin read from the rules contract |
| `examples/e2e-scenarios-escalation.ts`, scenario 5b | expected the appeal adjudicator's round to be `BEACON.roundAt(t1) + 1` | **logic** | `BEACON.roundAt(t1 + margin) + 1` |
| `examples/e2e-scenarios-escalation.ts`, scenario 5a | an escalation window of `max(minWindowSec, 20)` s | **logic** (a window, not a round) | `max(minWindowSec, margin + 20)` s. The appeal adjudicator can run its check only once its round is out, which on Sepolia is 29 s or more after the escalation. The live world's default `minWindowSec` of 60 s (`apps/demo-cloud/src/world.ts:554`) already covered it [inferred] |
| `apps/adjudicator/src/drand-fork.test.ts` | expected the fallback at `beaconRoundAt(judgeBy)` and the appeal adjudicator at `beaconRoundFor(escalated, 'appeal')` with no margin | **logic** | both through core's `beaconRoundFor` with `EvmSettlement.beaconMarginSec`, the deployment's margin |

**Why anvil never showed it** [measured by `examples/e2e-rounds.test.ts`]:
- On anvil and SimChain the margin is 0 and the beacon is SimChain's one-second clock.
- There, `roundAt(judgeBy − 1) + 1` equals `roundAt(judgeBy)`.
- On Sepolia, with drand quicknet's three-second rounds and a 29 s margin, the fallback's round is 9 to 10 rounds later than the old expectation, so checks for scenarios 4 and 5b would have failed in the live round.
- The drand fork suite runs against the Sepolia record, so it would have failed at the cutover's fork step.

**Checks** [measured, in the worktree]:

| Check | Result |
| --- | --- |
| `examples/e2e-rounds.test.ts` | 4 of 4. The round's rule equals core's `roundAfter` for every second of two drand periods, at margins of 0 and 29 s |
| `examples/e2e-round.test.ts`, `e2e-scenarios-silent.test.ts`, `e2e-scenarios-escalation.test.ts`, anvil included, on the lane at `690edfd` plus this change | 13 of 13, with every scenario counted |
| `pnpm typecheck`; `eslint examples apps/adjudicator/src/drand-fork.test.ts`; `tests/cut-feature-alignment.test.ts`; `tests/ci-gated.test.ts` | clean; 4 of 4 |

`drand-fork.test.ts` is opt-in (`SEPOLIA_FORK_RPC`) and ran skipped here. It compiles and lints; its first run is the cutover's fork step.

## Decisions

1. **The margin comes from the rules contract.** `RoundChain.beaconMarginSec()` (`e2e-chain.ts`) reads `BEACON_MARGIN()` from the deployment record's rules contract, the value the settlement adapter also reads. On SimChain the round uses 0, as core and SimChain do.
2. **The round keeps its own clock arithmetic and a test pins it to core's.** The round's scenarios do not import the workspace packages. `e2e-rounds.test.ts` compares the round's `roundAfter` with core's `roundAfter` on drand quicknet's clock, at margins of 0 and 29 s.

## Handoff

**Done.** The round's three beacon-round expectations and the fork suite's two use the deployment's margin, and a test pins the round's rule to core's at 29 s.

**For the cutover:**
- In the live round on Sepolia, scenarios 4 and 5b now expect the round the contract computes.
- The drand fork suite expects the same rounds against the new record.
- No step of the checklist changes.

**Not checked here:** the live round itself. It runs at the cutover, against Sepolia's 29 s margin.
