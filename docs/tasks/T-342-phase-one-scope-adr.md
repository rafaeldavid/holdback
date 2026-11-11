# T-342: The scope ADR for the phase-one contracts

- **Lane:** research
- **Phase:** 2 (the contract refinement before the pilot; package R1 of the refinement plan, which the maintainers keep privately, `docs/private-materials.md`)
- **Depends on:** none. T-334 (the contract clean-up), T-338 (the audit docs) and T-340 (the state model and the threat model) run beside it.
- **Paths this task may touch:** `docs/decisions/ADR-0031-phase-one-contract-scope.md` (new), `docs/audit/scope.md`, `docs/decisions-today.md` (new lines only), this file.
- **Human gate:** no. The change is confined to this repository. Rafa's own edits wait for him: the sentence in `CLAUDE.md`'s litmus test 3, and the answers this task leaves open.
- **Status:** in progress
- **Agent/session:** the T-342 session, change kind 10 (research and decisions), target 200k tokens.

## Intent

Write down what the phase-one contracts deliberately do not do, so an auditor or an outside reviewer reads it first.

- **Goal.** One ADR, status Proposed, that records the eight scope cuts (SC-1 to SC-8) of the contract refinement plan. For each cut it says what leaves the contracts (functions, storage, events), what stays, what a party loses, and what brings the feature back.
- **Inputs.** The refinement plan's section 2 and package R1; Rafa's answers of 2026-11-11; the contracts in `contracts/src/` on `origin/main`; the ADRs each cut touches; `docs/audit/scope.md`, `docs/neutrality.md` and `docs/judgment-and-defenses.md`.
- **Outputs.** The ADR; `docs/audit/scope.md` with the phase-one scope and a short list of what was cut on purpose; one new entry in `docs/decisions-today.md` that records Rafa's decision on party appeals and bonds in his words.
- **Non-goals.** No code, schema, formal-model or contract change. No decision that is Rafa's. No edit to `CLAUDE.md`, `docs/audit/known-issues.md`, `docs/audit/state-model.md` or `docs/audit/threat-model.md`.

## Context

- The contracts: `contracts/src/HoldbackRules.sol`, `HoldbackBonds.sol`, `HoldbackTypes.sol`, `DrandQuicknetBeacon.sol`.
- The ADRs the cuts touch: ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0006 (defended judgment), ADR-0007 (bonded adjudicators), ADR-0016 (the acceptance and the state machine), ADR-0018 (the beacon), ADR-0019 with D23 (mutual settlement to any address), ADR-0025 and ADR-0026 (funding paths), ADR-0030 (adjudicator registration).
- Decisions: D23, D26, D28, D31, D32, D38, D42, D43.
- Rafa's standard for this work (2026-11-11): "it's better to have a limited scope for an initial phase of the product than perfectly complete and universal design contracts that open up to risks."

## Acceptance criteria

- [ ] The ADR records SC-1, SC-2, SC-3, SC-5 and SC-6 as the stated direction, each with what leaves, what stays and the trigger for bringing it back.
- [ ] The ADR records SC-7 as decided by Rafa on 2026-11-11, with his words.
- [ ] The ADR records every other answer Rafa gave on 2026-11-11 with his words, and leaves open what he has not answered, with options and a recommendation.
- [ ] The ADR settles the open points of the SC-7 cut, each with a reason: the appeal adjudicator's role, the signed `bondReserved` field (tested against the EIP-712 types), the docs that promise appeals, and SimChain as the full reference.
- [ ] Each cut names the functions, storage and events it removes or keeps.
- [ ] Each cut is tested against the three litmus tests. The ADR says plainly which line of litmus test 3 phase one sets aside, what protects a party instead, and what a wrong first decision costs.
- [ ] Nothing in the ADR contradicts the EIP-712 types or `spec/schemas/` without saying that a schema change and a version bump would follow.
- [ ] The ADR lists every doc that promises appeals or bonds, with the sentence to change, for a later docs package.
- [ ] A red team attacked the cuts without this session's reasoning, and the ADR answers each finding.
- [ ] `docs/audit/scope.md` states the phase-one scope and lists what was cut on purpose.
- [ ] `docs/decisions-today.md` has one new entry, D57, and no other line changes.

## Out of scope

- The contract changes themselves (packages R5 and R6 of the plan).
- The docs package that rewrites the pages that promise appeals and bonds.
- The state model, the signed-field register and the threat model (T-340).
- `docs/audit/known-issues.md` (T-338 owns it). The Handoff lists the rows to move, with their new wording.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

All are in ADR-0031, Proposed; Rafa may overrule each.

1. **The ADR records Rafa's newest answers.** This task's brief listed SC-4, SC-8 and the events question as open. Rafa answered all three on 2026-11-11, after the brief was written: contract signers stay, the on-chain beacon proof stays for now, and a cut feature's events leave with it. The ADR records each as decided, with his words. One cut now waits for his yes: SC-5b, a settlement in `Held` that names a delivery or releases a key, which the state model (T-340) found the contract tests on purpose.
2. **`bondReserved` must be zero on chain.** The plan recommended leaving it unchecked. Its claim that this changes no signed type holds [measured: `HoldbackTypes.sol:188-193,296-312`]. The ADR still requires zero, for two reasons: an unchecked value lets a funded deal carry a signed claim of a reservation that cannot exist, and core refuses an acceptance below the price (`packages/core/src/state.ts:223-231`), so the contract and core would disagree.
3. **`appealWindowSec` is signed and not read.** The plan does not list it. The schema requires at least 1, so the contract cannot require 0 without a schema version.
4. **The deadline order is core's:** strict, over five deadlines (`packages/core/src/timing.ts:33,46-49`). The plan names four.
5. **Refusing a zero price is a new limit.** The plan says core refuses it today; it does not [measured by search]. The ADR says so and names D31.
6. **SC-6 proceeds although the plan's condition fails.** The EVM adapter depends on `expireOffer`; the ADR recommends expiring an unfunded offer by the operators' clock.
7. **`Paid` stays declared until Rafa confirms SC-3.** His answer on events covers a feature he has cut.
8. **On EVM settlement an offer funds until `offerExpiresAt`.** The contract's rule stands; core and SimChain keep their two steps. The fix is in the docs and the prepare routes.
9. **SC-5b: recommended, cut.** The ADR names what replaces the late-work settlement: post the delivery before `deliverBy`, or reclaim and sign a new commitment, or settle the money and hand the key over directly.

## Handoff

**Done.** ADR-0031 (Proposed), the phase-one section of `docs/audit/scope.md`, and D57.

**Not done, on purpose.** No code, schema, contract or formal-model change. `CLAUDE.md` is not edited.

**For Rafa.** The list is ADR-0031's "What waits on Rafa". The proposed sentence for litmus test 3 in `CLAUDE.md`:

> Appeals are backed by the adjudicator's bond. Phase one sets this line aside: its contracts have no party appeals and no bonds, and the first decision by the primary or the fallback adjudicator is final on chain (Rafa, 2026-11-11; D57, ADR-0031). SimChain keeps both.

`CLAUDE.md` also says the decisions run "D1 to D56" in two places; they now run to D57.

**For the task that owns `docs/audit/known-issues.md` (T-338).** The eight findings that move to "not in phase one", each with its new Status and wording. They move at the redeploy; until then they describe the deployed contracts.

| ID | New status | New wording for "What bounds the loss today" |
| --- | --- | --- |
| H-2 limit | not in phase one (ADR-0031, SC-7) | Phase one takes no decision on a deal that is already `Released` or `Refunded`, so no appeal decision can carry a key to a refunded buyer. The limit returns with party appeals |
| L-3 | not in phase one (ADR-0031, SC-7) | The contract takes no appeal, so there is no appeal bond to set at 0. A minimum appeal bond in the signed terms returns with party appeals, with an ADR and a schema version |
| L-5 | not in phase one (ADR-0031, SC-7) | The appeal adjudicator decides escalations only, and no decision moves a bond. Still true: its decision after an escalation is final and unbonded (ADR-0031, "Litmus tests") |
| I-8 rest | not in phase one (ADR-0031, SC-7) | No bond exists, so there is no default compensation, appeal fee or minimum appeal bond. A default refunds the buyer; nobody compensates the seller |
| T-221 | not in phase one (ADR-0031, SC-7) | No bond exists for terms to be unable to pay. The operators' refusal of an unbonded fallback leaves the EVM path |
| A-1 | not in phase one (ADR-0031, SC-7) | A fallback's decision reserves nothing, so a sham deal holds no bond |
| A-2 | not in phase one (ADR-0031, SC-7) | No free bond exists to drain |
| A-3 | not in phase one (ADR-0031, SC-7) | No deal is appealed on the EVM path, so the service reads no first outcome of an appealed deal |

Other rows the cuts touch:

- **L-2** (a fee-on-transfer token leaves the vault short): not in phase one. The vault leaves (SC-7), and a deployment's one token must charge no fee on transfer (SC-1).
- **L-6 and L-8:** closed by the strict deadline order once it is built (SC-5). Until then: deferred to the phase-one redeploy.
- **I-2** (the dead fee-share branch in `_payOut`): unchanged by this ADR; the clean-up task owns it.
- **Rows whose bound names a bond or an appeal** need a phase-one bound: R-3, R-6, R-7, R-8 and DS-1. The phase-one bounds are commit-reveal selection, panels across model families, the parties' choice of adjudicators, the signed record and the law.
- **R-1** says "The parties choose the token": in phase one they choose a deployment, which serves one token.
- **G-3** (the formal model has no bond coverage): the bond half stops applying.
- **Section 8, "Bonds behind appeals and defaults":** the disagreement ends; phase one has neither.
- **New rows to add** (accepted for phase one, ADR-0031):
  - a wrong first decision has no remedy on chain; the loss is bounded by one deal's price and fee;
  - an accept whose key does not decrypt the work has no remedy on chain (threat T19);
  - `timing.appealWindowSec` is signed and not read;
  - if Rafa says yes to SC-5b: a late-work settlement in `Held` after `deliverBy` cannot release the key in the same transaction.

**For the tasks that build the cuts (packages R5 and R6 of the plan).** ADR-0031 names each function, storage field and event that leaves.

- **Copy the deadline comparisons exactly from `packages/core/src/timing.ts:46-49`,** strict or not, over the same five deadlines, so the contract and core refuse the same terms.
- **Do not remove the `Held` settlement path (SC-5b) until Rafa answers.**
- Check before cutting: SC-6's adapter change; the fixtures the ADR lists for the SimChain-only list; how the comparison between SimChain and the contract treats SimChain's bond postings and appeal window.
- Core gains two refusals with the contract: a zero price, and (on a phase-one deployment) an acceptance whose `bondReserved` is not zero.

**For the docs package.** ADR-0031's appendix lists every doc that promises what phase one cuts, with the sentence to change. The docs change at the redeploy, not before.

**How to resume.** Read ADR-0031, then D57. A hand-over note for the sessions that ran beside this one is in the shared notes folder of the session group.
