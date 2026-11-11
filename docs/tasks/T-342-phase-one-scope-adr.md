# T-342: The scope ADR for the phase-one contracts

- **Lane:** research
- **Phase:** 2 (the contract refinement before the pilot; package R1 of the refinement plan, which the maintainers keep privately, `docs/private-materials.md`)
- **Depends on:** none. T-334 (the contract clean-up), T-338 (the audit docs) and T-340 (the state model and the threat model) run beside it.
- **Paths this task may touch:** `docs/decisions/ADR-0031-phase-one-contract-scope.md` (new), `docs/audit/scope.md`, `docs/decisions-today.md` (new lines only), this file.
- **Human gate:** no. The change is confined to this repository. Rafa's own edits wait for him: the sentence in `CLAUDE.md`'s litmus test 3, and the answers this task leaves open.
- **Status:** done (PR 329, merged 2026-11-11 at `fd2f41a`)
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

- [x] The ADR records SC-1, SC-2, SC-3, SC-5 and SC-6 as the stated direction, each with what leaves, what stays and the trigger for bringing it back.
- [x] The ADR records SC-7 as decided by Rafa on 2026-11-11, with his words.
- [x] The ADR records every other answer Rafa gave on 2026-11-11 with his words: SC-4 refused, SC-8 not cut, SC-5b not cut, and the events exception. No scope cut is left open.
- [x] The ADR settles the open points of the SC-7 cut, each with a reason: the appeal adjudicator's role, the signed `bondReserved` field (tested against the EIP-712 types), the docs that promise appeals, and SimChain as the full reference.
- [x] Each cut names the functions, storage and events it removes or keeps.
- [x] Each cut is tested against the three litmus tests. The ADR says plainly which line of litmus test 3 phase one sets aside, what protects a party instead, and what a wrong first decision costs.
- [x] Nothing in the ADR contradicts the EIP-712 types or `spec/schemas/` without saying that a schema change and a version bump would follow.
- [x] The ADR lists every doc that promises appeals or bonds, with the sentence to change, for a later docs package.
- [x] A red team attacked the cuts without this session's reasoning, and the ADR answers each finding.
- [x] `docs/audit/scope.md` states the phase-one scope and lists what was cut on purpose.
- [x] `docs/decisions-today.md` has one new entry, D57, and no other line changes.

## Out of scope

- The contract changes themselves (packages R5 and R6 of the plan).
- The docs package that rewrites the pages that promise appeals and bonds.
- The state model, the signed-field register and the threat model (T-340).
- `docs/audit/known-issues.md` (T-338 owns it). The Handoff lists the rows to move, with their new wording.

## Evidence

Change kind 10 has no local checks; CI is the gate. Nothing was built or run: the change is four docs.

- **Commands run and results:**
  - `git diff --quiet 64be1f1 HEAD -- contracts/src` exits 0 at `26d4670`: the contracts this task read are the deployed ones [measured].
  - `git diff --stat origin/main...HEAD` lists four files, all under `docs/` [measured].
- **What was read:** `HoldbackRules.sol`, `HoldbackBonds.sol` and `HoldbackTypes.sol` in full; `ERC3009PaymentCollector.sol`; `LateCarriedDelivery.t.sol`; ADR-0001, 0002, 0006, 0007, 0016 and 0025 in full, and ADR-0018, 0019 and 0030 in part; `docs/neutrality.md`, `docs/audit/scope.md` and `docs/audit/known-issues.md` in full; the state model's sections 8.3 to 11 on T-340's branch [measured].
- **Two read-only searches** produced the schema and core facts and the list of docs in ADR-0031's appendix. This task spot-checked their line numbers against 12 lines in `packages/core`, `spec/schemas`, `packages/testkit` and `apps/adjudicator`, and against its own read of three docs; all matched [measured].
- **The red team:** one pass, without the ADR or its reasoning. No Critical finding; 2 High, 5 Medium, 5 Low. ADR-0031 answers each one in "Red-team findings and answers" [measured: the pass's report].
- **Not read:** `DrandQuicknetBeacon.sol`, the formal model, `packages/settlement`, `apps/operator`. Facts about them come from the searches and are labelled.
- **Snapshot diffs:** none.
- **CI on PR 329,** at head `ae1b7e2`: 6 checks passed (check, changes, gitleaks, CodeQL and its two analyses) and 5 were skipped, because the change touches docs only [measured: `gh pr checks 329`]. Merged at 19:18 UTC on 2026-11-11.
- **Metrics:** subagents used 566,389 tokens [measured: 149,434 and 175,728 for the two searches, 241,227 for the red team]. That is over the kind's 200k target before this session's own tokens. The searches returned more than the ADR needed; one search with a narrower brief would have done.

## Decisions

All are in ADR-0031, Proposed; Rafa may overrule each.

1. **The ADR records Rafa's newest answers.** This task's brief listed SC-4, SC-8 and the events question as open. Rafa answered all three on 2026-11-11, after the brief was written: contract signers stay, the on-chain beacon proof stays for now, and a cut feature's events leave with it. The ADR records each as decided, with his words. He also decided SC-5b while this task ran: the settlement in `Held` for late work stays ("Yes, keep it"). The state model (T-340) had found that the contract tests that path on purpose.
2. **`bondReserved` must be zero on chain.** The plan recommended leaving it unchecked. Its claim that this changes no signed type holds [measured: `HoldbackTypes.sol:188-193,296-312`]. The ADR still requires zero, for two reasons: an unchecked value lets a funded deal carry a signed claim of a reservation that cannot exist, and core refuses an acceptance below the price (`packages/core/src/state.ts:223-231`), so the contract and core would disagree.
3. **`appealWindowSec` is signed and not read.** The plan does not list it. The schema requires at least 1, so the contract cannot require 0 without a schema version.
4. **The deadline order is core's:** strict, over five deadlines (`packages/core/src/timing.ts:33,46-49`). The plan names four.
5. **Refusing a zero price is a new limit.** The plan says core refuses it today; it does not [measured by search]. The ADR says so and names D31.
6. **SC-6 proceeds although the plan's condition fails.** The EVM adapter depends on `expireOffer`; the ADR recommends expiring an unfunded offer by the operators' clock.
7. **`Paid` stays declared until Rafa confirms SC-3.** His answer on events covers a feature he has cut.
8. **On EVM settlement an offer funds until `offerExpiresAt`.** The contract's rule stands; core and SimChain keep their two steps. The fix is in the docs and the prepare routes.
9. **SC-5b: kept, by Rafa.** This task first recommended the cut. Rafa then said he wants to measure how many deals hold to their time bounds strictly and how many settle anyway, and decided to keep the path. The state model's finding F-1 is resolved toward the contract: core, ADR-0019 and the formal model change to allow it.
10. **The red team's two High findings are accepted as the price of SC-7,** and the ADR states them: a wrong first decision is final and unpaid, and a party must trust all three adjudicators it names. One Medium finding raises a planned fix to required: the margin of one block before an escalation's beacon round.

11. **Rafa answered decisions 2, 4, 5, 6 and 7 on 2026-11-11, after PR 329 merged (D58).** He agreed with 2 and 4, the stricter rules. He overruled the refusal behind 5: a zero price stays allowed. He confirmed 6: the unfunded offer's expiry moves off chain, and the operators send no transaction. He cut third-party payouts for phase one with a planned return, so `Paid` leaves with them and 7 is settled. A follow-up PR records all of it in ADR-0031, `docs/audit/scope.md` and D58.

## Handoff

**Update after D58.** Where the lines below differ from D58, D58 wins: a zero price is not refused, so core gains no zero-price refusal; `Paid` leaves with SC-3; SC-6 is decided. One point is open with Rafa: a deal with price 0 and fee 0 cannot be funded, because the escrow refuses to hold nothing.

**Done.** ADR-0031 (Proposed), the phase-one section of `docs/audit/scope.md`, D57 and D58.

**Not done, on purpose.** No code, schema, contract or formal-model change. `CLAUDE.md` is not edited.

**For Rafa.** The list is ADR-0031's "What waits on Rafa". The proposed sentence for litmus test 3 in `CLAUDE.md`:

> Appeals are backed by the adjudicator's bond. Phase one sets this line aside: its contracts have no party appeals and no bonds, and the first decision by the primary or the fallback adjudicator is final on chain (Rafa, 2026-11-11; D57, ADR-0031). SimChain keeps both.

`CLAUDE.md` also says the decisions run "D1 to D56" in two places; they now run to D58.

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
  - a party must trust all three adjudicators it names, because the other party can steer which one decides;
  - the settlement for late work releases a key with no posted delivery, by design (SC-5b, kept).

**For the tasks that build the cuts (packages R5 and R6 of the plan).** ADR-0031 names each function, storage field and event that leaves.

- **Copy the deadline comparisons exactly from `packages/core/src/timing.ts:46-49`,** strict or not, over the same five deadlines, so the contract and core refuse the same terms.
- **The `Held` settlement for late work stays in the contract (SC-5b).** Add one test: the delivery named in the settlement is the one whose key is released, and a settlement that names one delivery cannot release another's key (`HoldbackRules.sol:445-446`).
- **A later package, with a reviewer, changes `packages/core/src/state.ts:516-518`, ADR-0019 and the formal model** to allow that settlement, as the contract already does. It opens a path for a signed message, so it gets a review. Until core allows it, nobody can use the path through the API, and a direct use leaves the deal behind the operators' view.
- **The off-chain phase-one profile lands before the redeploy** (red-team finding M-5): core, the EVM adapter, the operator and the reference adjudicator.
- **The escalation round's margin of one block is required before the freeze** (red-team finding M-1; review I-5).
- The red team proposed ten fixtures for the phase-one contracts; ADR-0031 names four of them.
- Check before cutting: SC-6's adapter change; the fixtures the ADR lists for the SimChain-only list; how the comparison between SimChain and the contract treats SimChain's bond postings and appeal window.
- Core gains one refusal with the contract, on a phase-one deployment: an acceptance whose `bondReserved` is not zero. A zero price stays allowed (D58).

**For the docs package.** ADR-0031's appendix lists every doc that promises what phase one cuts, with the sentence to change. The docs change at the redeploy, not before.

**How to resume.** Read ADR-0031, then D57. A hand-over note for the sessions that ran beside this one is in the shared notes folder of the session group.
