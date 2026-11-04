# T-210: Mirror T-206's appeal fixes in core and SimChain

- **Lane:** core (with `packages/settlement/sim/` for the one SimChain line)
- **Phase:** 2
- **Depends on:** T-206 fix PRs #120, #125 and #135 merged
- **Paths this task may touch:** `packages/core/src/state.ts`, `packages/core/src/state.test.ts`, `packages/settlement/sim/simchain.ts`, `packages/settlement/sim/simchain.test.ts`, `fixtures/scenarios/` (new `error.` rows only), `docs/tasks/T-210-appeal-fixes-core-sim.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

The contract now refuses two appeal decisions that the reference state machine still accepts (review `docs/reviews/2026-11-03-contract-review.md`, H-1 and H-2). Make core and SimChain refuse them too, so Phase 1 settlement, the live demo and the differential test agree with the contract.

1. **H-1.** `escalationDecision` and `stepAppeal` (`decide`) in `state.ts` do not compare `m.attempt` with the delivery's attempt, and `beaconSeed` hashes it, so an appeal adjudicator can pick one of 256 seeds. Compare it, as `firstInstance` does.
2. **H-2.** `simchain.ts:881` releases `keyForBuyer` on a party-appeal decision whatever the first outcome, and a reject that carries a key is accepted. Apply the contract's rule (`HoldbackRules.decide`, PR #125): a decision carries the buyer's key only with an accept, and never on a deal that stands `Refunded`. Refuse anything else with `invalid_terms`.
3. **M-3, recorded and not changed here.** SimChain reserves the fallback's and appeal adjudicator's bonds at takeover and at escalation (`simchain.ts:896`, `:959`). Its default compensation pays from those reservations (`:974-981`), and two neutrality snapshots depend on them: `neutrality.adjudicator-and-fallback-offline` and `neutrality.appeal-adjudicator-offline-after-escalation`. Aligning SimChain with the contract (PR #135) has to wait for Phase 4's consent step (backlog: "Consent for default compensation"). Until then, T-202 difference 16 records the gap.

## Acceptance criteria

- [ ] `state.test.ts`: an escalation decision and a party-appeal decision with another attempt and its matching beacon seed are refused; the same with the delivery's attempt is accepted.
- [ ] `simchain.test.ts`: an overturned rejection whose decision carries `keyForBuyer` is refused, with no `key.released`, and so is any reject that carries one. After an accept, the appeal may still carry it.
- [ ] One `error.` fixture for each refusal, passing on SimChain and on the contract (`pnpm snap --settlement=local`).
- [ ] `pnpm verify` green.

## Out of scope

- The reference adjudicator's key attachment (T-211). Overturn payouts from the bond on chain (built in T-212 item 9, D43; core and SimChain already paid them). The appeal-slot rule (L-7) is mirrored in core by the same change.

## Evidence

## Decisions

## Handoff
