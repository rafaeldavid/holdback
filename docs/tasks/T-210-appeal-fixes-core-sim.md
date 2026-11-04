# T-210: Mirror T-206's appeal fixes in core and SimChain

- **Lane:** core (with `packages/settlement/sim/` for the one SimChain line)
- **Phase:** 2
- **Depends on:** T-206 fix PRs #120, #125 and #135 merged
- **Paths this task may touch:** `packages/core/src/state.ts`, `packages/core/src/state.test.ts`, `packages/settlement/sim/simchain.ts`, `packages/settlement/sim/simchain.test.ts`, `fixtures/scenarios/` (new `error.` rows only), `docs/tasks/T-210-appeal-fixes-core-sim.md`. Extended during the task (Decisions 3): `packages/settlement/sim/actors.ts`; `packages/testkit/src/scenario.ts`, `stub-settlement.ts` and `runner.test.ts` (coordinator approved, 2026-11-04); and `reports/differential-local.md`, which the differential rewrites
- **Human gate:** no
- **Status:** done (PR #173)
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
- **Empty key, SimChain (after review).** As on chain, a key with an empty ciphertext counts as no key. A reject carrying `{ scheme: '', ciphertext: '' }` settles, and an accept carrying only that is refused. EIP-712 hashes that shape like an absent key, so a relayer could add it to a signed decision. The red-teamer measured the old divergence on both layers.
- **Tamper seed (after review).** `runner.test.ts`, "wrong_attempt signs a beacon role the seed of the attempt it names": the tampered appeal decision carries attempt 2, the honest decision's beacon, and `panelSeed(id, 'appeal', 2, beacon)`. A mutant that signs the attempt-1 seed fails the test.
- **The tampers produce what the contract refuses (red-teamer, measured on SimChain and anvil).**
  - The signed `wrong_attempt` decision differs from the one that settles only in its attempt, seed, nonce and signature. On chain it reverts `InvalidMessage`. The same message with attempt 1 and the attempt-2 seed reverts `BadSeed`, so the seed is the attempt-2 one.
  - The signed `buyer_key` reject carries a non-empty `keyCiphertext`. It reverts `InvalidMessage`, and the same reject without the key passes.
  - Over 252 decisions (14 states, 3 roles, 3 outcomes, with and without a key) and a 150-run random walk, SimChain never settled a keyed decision the contract refuses. In none of them did a buyer hold a key outside `Released` or `Settled`.
- **Callers.** `packages/settlement`, `tools/sim` and `apps/operator`: 277 passed, 32 skipped (the skips are pre-existing).
- **Fixtures.** `error.appeal-decision-other-attempt` (H-1, the escalation path) and `error.reject-carries-buyer-key` (H-2, first instance) pass on SimChain (`pnpm snap`: 31 passed). On the contract (`pnpm snap --settlement=local`): 28 passed, 0 failed, 3 excluded until Phase 4. Both new transcripts are identical to SimChain: 613,072 gas over 4 transactions, and 525,345 over 3. Every existing fixture is unchanged.
- **`pnpm verify`, after the review fixes:** all 9 steps pass (`reports/verify-t-210-appeal-fixes-core-sim.md`): typecheck, lint, forge build, forge (241 of 241), test (2,324 passed, 3 skipped), spec, snap (31 of 31), snap:local (28 passed, 3 excluded; `reports/differential-local.md` unchanged) and demo. `simchain.test.ts` has 42 tests.

## Decisions

1. **The key rule sits in SimChain, not in core `step`.** Core never reads `keyForBuyer`. SimChain already enforces "an accept carries the key" next to it, and the EVM adapter steps core only after the contract has mined. The check runs after core's step and before any effect, and a refusal discards the whole transaction. So the nonce, the ledger, the keys and the open appeal stay as they were, as on chain.
2. **Single-fault parity, not the contract's check order.** Core compares the attempt before the delivery hash and the seed (`sameAttempt`, shared by all three paths). A decision whose only fault is its attempt, or its key, is refused with `invalid_terms` on both layers. With two faults, both layers still refuse and nothing moves, but the problem type can differ. SimChain checks the signature first, then core's bindings (adjudicator, deadline, policy, registry), then the attempt, and the key last. The contract checks stage, role, attempt, delivery and outcome, then the key, then the deadline and seed, and the signature last. Some of this ordering predates this branch. The red-teamer's table is in the Handoff for T-202's list of differences.
3. **Three files outside the listed paths, each needed by the acceptance criteria.**
   - `packages/settlement/sim/actors.ts`: the `Deal` test helper's honest default no longer seals the buyer's key for an appeal of a refunded deal. Without this change, `properties.test.ts` and `tools/sim/check.test.ts` would sign decisions SimChain now refuses. `withKey` still forces the key.
   - `packages/testkit`: two `judge` tampers, `wrong_attempt` and `buyer_key`, plus their `runner.test.ts` cases. The testkit tampers were added with the coordinator's approval on 2026-11-04, because the runner's tamper set is closed: no existing step could sign an off-attempt decision or a keyed reject. The approval named the second tamper `key_on_reject`. It ships as `buyer_key` because it also covers an escalate and an accept on a refunded deal. It counts as applied only where an honest decision carries no key. Additions only: no existing tamper or fixture changes behaviour, and `pnpm snap` shows no diff outside the two new fixtures.
   - `packages/testkit`: the runner's honest judge also stops sealing the key for an appeal of a refunded deal, mirroring T-211. No fixture or test takes that path: the judges are deterministic, so none can overturn a reject.
4. **The fixtures take the escalation and first-instance paths, not a party appeal.** Party-appeal fixtures are SimChain-only until Phase 4 (the appeal fee is not collected on chain; `LOCAL_EXCLUSIONS` in `packages/testkit/src/runner.ts`), so they could not pass "on the contract". The party-appeal cases of both findings are covered by the unit tests above.
5. **`error.reject-carries-buyer-key` has no `verify_key_release` step.** The step refuses on any non-`Released` state before it looks at the keys, so it proved nothing. `simchain.test.ts` checks the buyer's keys directly.

## Handoff

- **Status:** done with PR #173 (reviewer PASS at `9571047`, red team with no blocking finding, CI green).
- **Docs to update (outside this task's paths):**
  - T-202 difference 16: H-1 and H-2 now match the contract for a single fault; only M-3 remains.
  - T-202, a new difference: with two faults, the problem types differ (Decisions 2). Each row was measured by the red-teamer, SimChain first, then the contract:
    - attempt 2 with a wrong `policyHash`: `policy_mismatch`, `invalid_terms`;
    - attempt 2 signed by the buyer: `invalid_signature`, `invalid_terms`;
    - attempt 2 after `appealDecideBy`: `deadline_passed`, `invalid_terms`;
    - a key with a random seed: `seed_mismatch`, `invalid_terms`;
    - a key signed by the buyer: `invalid_signature`, `invalid_terms`;
    - a key with a wrong `policyHash`: `policy_mismatch`, `invalid_terms`;
    - a key after `appealDecideBy`: `deadline_passed`, `invalid_terms`;
    - a key on role `fallback`: `not_your_turn`, `invalid_terms`.
  - `docs/reviews/2026-11-03-contract-review.md`: H-1's "Follow-up (T-210)" and H-2's "SimChain should refuse the same messages (T-210)" can be marked done. PR #166, which edited that file, has merged.
  - `docs/plan.md`, scenario index: rows for `error.appeal-decision-other-attempt` and `error.reject-carries-buyer-key`.
- **`packages/testkit` hold:** the coordinator gave this task testkit until this PR merges, and told T-211 not to edit it in the meantime. Tell the coordinator when this PR merges.
- **T-211, release order (red-teamer M-1, measured).**
  - Until T-211 lands, the reference adjudicator (`apps/adjudicator/src/service.ts`) seals the buyer's key on every accept.
  - Any agent can file a seller appeal of a reject through the operator API. SimChain then refuses the reference service's honest overturn-to-accept, as the contract already does, and the service retries with the same message.
  - The appeal expires, the first decision stands, and the seller gets its bond and fee back but loses the overturn payout.
  - The live demo settles on Sepolia, where the contract refuses that overturn already. `docs/operations.md` blocks deploys from main until the 0.7 contracts are there.
  - So: ship T-210 and T-211 together in any SimChain world, and do not redeploy a SimChain rollback world with T-210 alone.
- **Follow-ups found in review, not in this task's lane:**
  - `EvmDeal.decide` (`packages/settlement/evm/testing.ts`) still seals the key on every accept. It should match `Deal` before an EVM test overturns a refund.
  - `EvmSettlement` throws (`IntegerOutOfRangeError`) on a decision with attempt ≥ 256, instead of returning a problem. The operator's parser refuses such attempts first (T-205 lane).
  - A testkit invariant for `KeyOnlyWithPayment`: no buyer key unless the deal is `Released`, or `Settled` with the key released. Every refund fixture would then guard H-2, but adding it changes every snapshot's invariants line.
- **M-3:** unchanged, as the Intent says. The two neutrality snapshots that depend on SimChain's reservations still pass.
