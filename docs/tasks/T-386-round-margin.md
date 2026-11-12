# T-386: the round's beacon rounds follow the margin rule

- **Lane:** test (the Sepolia round's scenarios and the drand fork suite), on `contracts-audit-ready`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, with one reviewer (Change recipes)
- **Depends on:** R8's rounds fix (PR 418, `cd88cca`; ADR-0032)
- **Paths this task may touch:** `examples/e2e-scenarios-silent.ts`, `examples/e2e-scenarios-escalation.ts`, their tests, `examples/e2e-chain.ts` (one read), a new `examples/e2e-rounds.test.ts`, `apps/adjudicator/src/drand-fork.test.ts`, this file. Nothing else under `apps/`
- **Human gate:** no
- **Status:** in progress
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

(filled in below)

## Decisions

1. **The margin comes from the rules contract.** `RoundChain.beaconMarginSec()` (`e2e-chain.ts`) reads `BEACON_MARGIN()` from the deployment record's rules contract, the value the settlement adapter also reads. On SimChain the round uses 0, as core and SimChain do.
2. **The round keeps its own clock arithmetic and a test pins it to core's.** The round's scenarios do not import the workspace packages. `e2e-rounds.test.ts` compares the round's `roundAfter` with core's `roundAfter` on drand quicknet's clock, at margins of 0 and 29 s.

## Handoff

(filled in below)
