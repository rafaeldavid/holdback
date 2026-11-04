# T-210: Mirror T-206's appeal fixes in core and SimChain

- **Lane:** core (with `packages/settlement/sim/` for the one SimChain line)
- **Phase:** 2
- **Depends on:** T-206 fix PRs #120, #125 and #135 merged
- **Paths this task may touch:** `packages/core/src/state.ts`, `packages/core/src/state.test.ts`, `packages/settlement/sim/simchain.ts`, `packages/settlement/sim/simchain.test.ts`, `fixtures/scenarios/` (new `error.` rows only), `docs/tasks/T-210-appeal-fixes-core-sim.md`. Extended during the task (Decisions 3): `packages/settlement/sim/actors.ts`; `packages/testkit/src/scenario.ts`, `stub-settlement.ts` and `runner.test.ts` (coordinator approved, 2026-11-04); and `reports/differential-local.md`, which the differential rewrites
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer session for T-210 (branch `t-210-appeal-fixes-core-sim`)

## Intent

The contract now refuses two appeal decisions that the reference state machine still accepts (review `docs/reviews/2026-11-03-contract-review.md`, H-1 and H-2). Make core and SimChain refuse them too, so Phase 1 settlement, the live demo and the differential test agree with the contract.

1. **H-1.** `escalationDecision` and `stepAppeal` (`decide`) in `state.ts` do not compare `m.attempt` with the delivery's attempt, and `beaconSeed` hashes it, so an appeal adjudicator can pick one of 256 seeds. Compare it, as `firstInstance` does.
2. **H-2.** `simchain.ts:881` releases `keyForBuyer` on a party-appeal decision whatever the first outcome, and a reject that carries a key is accepted. Apply the contract's rule (`HoldbackRules.decide`, PR #125): a decision carries the buyer's key only with an accept, and never on a deal that stands `Refunded`. Refuse anything else with `invalid_terms`.
3. **M-3, recorded and not changed here.** SimChain reserves the fallback's and appeal adjudicator's bonds at takeover and at escalation (`simchain.ts:896`, `:959`). Its default compensation pays from those reservations (`:974-981`), and two neutrality snapshots depend on them: `neutrality.adjudicator-and-fallback-offline` and `neutrality.appeal-adjudicator-offline-after-escalation`. Aligning SimChain with the contract (PR #135) has to wait for Phase 4's consent step (backlog: "Consent for default compensation"). Until then, T-202 difference 16 records the gap.

Restated by the implementer: core and SimChain must refuse exactly the two decisions `HoldbackRules.decide` now reverts on, with the contract's problem type (`invalid_terms`), so a local run, the live demo and the anvil differential never settle a decision the chain would refuse. Non-goals: the reference adjudicator's behaviour (T-211), any bond reservation (M-3), the formal model.

## Acceptance criteria

- [x] `state.test.ts`: an escalation decision and a party-appeal decision with another attempt and its matching beacon seed are refused; the same with the delivery's attempt is accepted.
- [x] `simchain.test.ts`: an overturned rejection whose decision carries `keyForBuyer` is refused, with no `key.released`, and so is any reject that carries one. After an accept, the appeal may still carry it.
- [x] One `error.` fixture for each refusal, passing on SimChain and on the contract (`pnpm snap --settlement=local`).
- [x] `pnpm verify` green.

## Out of scope

- The reference adjudicator's key attachment (T-211). Overturn payouts from the bond on chain (built in T-212 item 9, D43; core and SimChain already paid them). The appeal-slot rule (L-7) is mirrored in core by the same change.

## Evidence

All measured on branch `t-210-appeal-fixes-core-sim`, 2026-11-04.

- **H-1, core.** `state.test.ts`, "binds … to the delivered attempt": for the fallback, the escalated appeal and the party appeal, attempt 1 with its beacon seed is accepted; each of the other 255 attempts, signed with that attempt's own beacon seed, is refused with `invalid_terms`. Before the fix, the escalation and party-appeal cases failed (`ok: Released` among the results) and the fallback case passed. After: `@holdback/core` 889 of 889 pass.
- **H-2, SimChain.** In `simchain.test.ts`, 5 new or changed cases failed before the fix ("expected a refusal, got Refunded/Released"): a first-instance reject with the key, an escalated reject with the key, and a party-appeal decision with the key after an overturned rejection, an upheld rejection and an overturned accept. After: 41 of 41 pass. Each refusal leaves the ledger, the buyer's keys and the open appeal unchanged, and the same verdict without the key settles. An upheld accept still carries the key (`appeal.decided`, `key.released`; ADR-0012's wrong-key ground).
- **Callers.** `packages/settlement`, `tools/sim` and `apps/operator`: 277 passed, 32 skipped (the skips are pre-existing).
- **Fixtures.** `error.appeal-decision-other-attempt` (H-1, the escalation path) and `error.reject-carries-buyer-key` (H-2, first instance) pass on SimChain (`pnpm snap`: 31 passed). On the contract (`pnpm snap --settlement=local`): 28 passed, 0 failed, 3 excluded until Phase 4. Both new transcripts are identical to SimChain: 613,072 gas over 4 transactions, and 525,345 over 3. Every existing fixture is unchanged.
- **`pnpm verify`:** all 9 steps pass (`reports/verify-t-210-appeal-fixes-core-sim.md`): typecheck, lint, forge build, forge (241 of 241), test (2,322 passed, 3 skipped, 105 files), spec, snap (31 of 31), snap:local (28 passed, 3 excluded) and demo.

## Decisions

1. **The key rule sits in SimChain, not in core `step`.** Core never reads `keyForBuyer`. SimChain already enforces "an accept carries the key" next to it, and the EVM adapter steps core only after the contract has mined. The check runs after core's step and before any effect, and a refusal discards the whole transaction. So the nonce, the ledger, the keys and the open appeal stay as they were, as on chain.
2. **Same check order as the contract for H-1.** Core compares the attempt before the delivery hash and the seed (`sameAttempt`, shared by all three paths). A decision whose only fault is its attempt is refused with `invalid_terms` on both layers: on chain it is `InvalidMessage` before `BadSeed`.
3. **Three files outside the listed paths, each needed by the acceptance criteria.**
   - `packages/settlement/sim/actors.ts`: the `Deal` test helper's honest default no longer seals the buyer's key for an appeal of a refunded deal. Without this change, `properties.test.ts` and `tools/sim/check.test.ts` would sign decisions SimChain now refuses. `withKey` still forces the key.
   - `packages/testkit`: two `judge` tampers, `wrong_attempt` and `buyer_key`, plus their `runner.test.ts` cases. The testkit tampers were added with the coordinator's approval on 2026-11-04, because the runner's tamper set is closed: no existing step could sign an off-attempt decision or a keyed reject. The approval named the second tamper `key_on_reject`. It ships as `buyer_key` because it also covers an escalate and an accept on a refunded deal. It counts as applied only where an honest decision carries no key. Additions only: no existing tamper or fixture changes behaviour, and `pnpm snap` shows no diff outside the two new fixtures.
   - `packages/testkit`: the runner's honest judge also stops sealing the key for an appeal of a refunded deal, mirroring T-211. No current fixture takes that path.
4. **The fixtures take the escalation and first-instance paths, not a party appeal.** Party-appeal fixtures are SimChain-only until Phase 4 (the appeal fee is not collected on chain; `LOCAL_EXCLUSIONS` in `packages/testkit/src/runner.ts`), so they could not pass "on the contract". The party-appeal cases of both findings are covered by the unit tests above.

## Handoff

- **Status:** review. PR to follow; set to done on merge.
- **Docs to update (outside this task's paths):**
  - T-202 difference 16: H-1 and H-2 now match the contract; only M-3 remains.
  - `docs/reviews/2026-11-03-contract-review.md`: H-1's "Follow-up (T-210)" and H-2's "SimChain should refuse the same messages (T-210)" can be marked done (PR #166, which edited that file, has merged).
- **`packages/testkit` hold:** the coordinator gave this task testkit until this PR merges, and told T-211 not to edit it in the meantime. Tell the coordinator when this PR merges.
- **T-211:** until the reference adjudicator stops sealing the key for an appeal of a refunded deal, SimChain refuses its honest overturn-to-accept, as the contract already does. The same verdict re-signed without the key settles it. The only caller in this repo that files a seller appeal is `tools/sim/check.test.ts`, which uses the honest `Deal` helper.
- **M-3:** unchanged, as the Intent says. The two neutrality snapshots that depend on SimChain's reservations still pass.
