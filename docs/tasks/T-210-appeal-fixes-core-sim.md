# T-210: Mirror T-206's appeal fixes in core and SimChain

- **Lane:** core (with `packages/settlement/sim/` for the one SimChain line)
- **Phase:** 2
- **Depends on:** T-206 fix PRs #120 and #125 merged
- **Paths this task may touch:** `packages/core/src/state.ts`, `packages/core/src/state.test.ts`, `packages/settlement/sim/simchain.ts`, `packages/settlement/sim/simchain.test.ts`, `fixtures/scenarios/` (new `error.` rows only), `docs/tasks/T-210-appeal-fixes-core-sim.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

The contract now refuses two appeal decisions that the reference state machine still accepts (review `docs/reviews/2026-11-03-contract-review.md`, H-1 and H-2). Make core and SimChain refuse them too, so Phase 1 settlement, the live demo and the differential test agree with the contract.

1. **H-1.** `escalationDecision` and `stepAppeal` (`decide`) in `state.ts` do not compare `m.attempt` with the delivery's attempt, and `beaconSeed` hashes it, so an appeal adjudicator can pick one of 256 seeds. Compare it, as `firstInstance` does.
2. **H-2.** `simchain.ts:881` releases `keyForBuyer` on a party-appeal decision whatever the first outcome. Refuse (`invalid_terms`) an appeal decision that carries a key on a deal that does not stand `Released`.

## Acceptance criteria

- [ ] `state.test.ts`: an escalation decision and a party-appeal decision with another attempt and its matching beacon seed are refused; the same with the delivery's attempt is accepted.
- [ ] `simchain.test.ts`: an overturned rejection whose decision carries `keyForBuyer` is refused, with no `key.released`; after an accept the appeal may still carry it.
- [ ] One `error.` fixture for each refusal, passing on SimChain and on the contract (`pnpm snap --settlement=local`).
- [ ] `pnpm verify` green.

## Out of scope

- The reference adjudicator's key attachment (T-211). Overturn payouts from the bond on chain (Phase 4).

## Evidence

## Decisions

## Handoff
