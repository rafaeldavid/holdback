# T-335: Port the adversarial pass's attack tests and fill the untested contract paths

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-206 (the contract review and its adversarial pass), T-322 (the defenses already ported)
- **Paths this task may touch:** new files under `contracts/test/unit/` and `contracts/test/crosscheck/` (not `contracts/test/unit/Base.sol`); in `docs/audit/known-issues.md` only row G-4, the "Recorded in" cells of section 2 rows these tests cover, and new rows in section 3; this task file
- **Human gate:** no
- **Status:** done (PR #328 merged 2026-11-11; one review, three Lows in the coordinator's triage note, none blocking; CI ran 293 tests in 46 suites, 0 failed, 0 skipped, run 43085901114)
- **Agent/session:** implementer, pilot plan package C1a (change kind 7, smart contracts)

## Intent

The contract review's adversarial pass (2026-11-03, against `baac930`) wrote 24 proof-of-concept tests: 17 attacks and 7 defenses. Seven are in the repository already (`contracts/test/unit/Withstood.t.sol`: six defenses and the co-signed payout to the rules contract). This task brings in the other 17 and fills three gaps an auditor would look for, without changing any contract source.

- **Port the 17.** Each attack becomes a test at HEAD. If its finding is fixed, the test asserts the attack now fails and names the finding and the fixing PR. If its finding is open and recorded, the test stays attack-shaped and passing, and its name goes into that row of `docs/audit/known-issues.md`. A test that shows an unrecorded open issue gets a new row in section 3. A test that fails for a reason no test change explains is kept skipped and reported.
- **Hook tokens on the bond vault.** `HoldbackBonds` has no reentrancy guard. Tests bond a token that calls back the sender and the recipient, and try to re-enter deposit, withdraw, release and encumber, and the rules paths that move vault tokens (appeal bond pull, appeal bond refund, slash, fee payout). They assert no double credit and no double withdrawal. A working reentry is a high finding.
- **Untested reverts.** Every custom error in `contracts/src/` that no test names gets a test.
- **Contract signers.** The seller and an adjudicator are ERC-1271 wallets that sign their steps (terms, delivery, acceptance, decision); a wrong ERC-1271 answer is refused.

Non-goals: no change under `contracts/src/`, `contracts/script/` or `Base.sol`; no fix for any open finding (that is T-212 and pilot packages C3 to C5); no change to `contracts/README.md` (the coordinator refreshes its counts); no edit to section 8 or the header of `known-issues.md` (T-338 owns them).

## Context

- `docs/reviews/2026-11-03-contract-review.md`, §2 (findings, proofs, fixing PRs)
- `docs/audit/known-issues.md`, sections 2, 3 and 6 (G-4)
- The recovered sources: `reports/scratch/t-335-poc/` (outside the repository)

## Acceptance criteria

- [x] The 17 missing proof-of-concept tests are in `contracts/test/unit/`, each a regression (fixed finding) or an attack-shaped test with an `// Open: <ID>` comment (open finding)
- [x] Hook-token tests on `HoldbackBonds` cover deposit, withdraw, release and encumber, and the rules paths that move vault tokens
- [x] Each custom error that no test named has a test
- [x] The seller and an adjudicator sign their steps as ERC-1271 wallets; a wrong ERC-1271 answer is refused
- [x] `forge test` passes, with counts before and after recorded
- [x] `known-issues.md` G-4 is fixed in this PR, and the section 2 rows the tests cover name them

## Out of scope

- Any contract source change, fix or redeploy
- The formal model (G-3) and invariant counting of the delivery hash (G-5)

## Evidence

- **`forge test --root contracts`, before (origin/main `1430f77`):** 37 suites, 248 passed, 0 failed, 0 skipped [measured].
- **After (this branch):** 46 suites, 287 passed, 0 failed, 0 skipped [measured]. That adds 9 suites and 39 tests: 17 ported, 9 vault reentrancy, 6 untested errors, 7 contract signers.
- **The 17 ported tests at HEAD** [measured, each passes]:

  | Suite (`contracts/test/unit/`) | Test | Finding | Shape |
  | --- | --- | --- | --- |
  | `AppealSeedAttempt.t.sol` | `test_regression_appeal_after_escalation_attempt_changes_seed` | H-1, PR #120 | regression |
  | | `test_regression_appeal_attempt_gives_256_valid_seeds` | H-1, PR #120 | regression |
  | | `test_regression_party_appeal_attempt_changes_seed` | H-1, PR #120 | regression |
  | | `test_defense_fallback_attempt_is_bound` | control | defense, name kept |
  | `CppReclaimStrandsBonds.t.sol` | `test_regression_cpp_reclaim_in_held_strands_primary_bond` | M-1, PR #122 | regression |
  | | `test_regression_cpp_reclaim_in_fallbackJudging_strands_two_bonds` | M-1, PR #122 | regression |
  | | `test_attack_d31_deadlines_after_expiry_leave_seller_unpaid` | L-6 open (M-1 half fixed) | attack |
  | `EarlyAcceptDeliverySwap.t.sol` | `test_regression_early_accept_paired_with_another_signed_delivery_after_onchain_deliver` | L-1, PR #161 | regression |
  | | `test_regression_early_accept_in_held_records_a_delivery_the_buyer_never_saw` | L-1, PR #161 | regression |
  | `LateDelivery.t.sol` | `test_regression_late_delivery_carried_by_decide_beats_reclaim` | M-2, PR #127 | regression |
  | | `test_regression_late_delivery_carried_by_escalate_blocks_reclaim` | M-2, PR #127 | regression |
  | `OverturnKeyRelease.t.sol` | `test_regression_overturned_reject_releases_key_without_paying_seller` | H-2, PR #125; L-7 and payout, PR #160 | regression |
  | | `test_attack_zero_bond_appeal_accepted_without_allowance` | L-3 open | attack, name kept |
  | | `test_attack_free_appeal_wins_the_price_from_the_bond` | L-3 open (H-2 half fixed) | attack |
  | `UnbondedDecider.t.sol` | `test_regression_fallback_decides_with_no_bond_at_stake` | L-5 fallback part, PR #135 | regression |
  | | `test_attack_appeal_adjudicator_decides_escalation_with_no_bond_at_stake` | L-5 open | attack, name kept |
  | | `test_attack_party_appeal_adjudicator_has_nothing_at_stake` | L-5 open | attack, name kept |

- **Vault reentrancy** (`unit/BondsReentrancy.t.sol`, 9 tests): no reentry worked. Nested deposit credits each pull once; a withdraw inside a deposit's pull ends with even books; a second withdraw from the payout hook, or one reaching the encumbered bond, is refused with `InsufficientFreeBond`; the five RULES-only vault functions are refused with `NotRules` from a callback; re-entering `fileAppeal`, `expireAppeal` and `decide` from the appeal bond pull, the refund and the slash is refused, and each pays once [measured].
- **Mutant check:** with `HoldbackBonds.withdraw` changed to pay before it debits (in the worktree only, then restored), 2 of the 9 reentrancy tests fail: `..._cannot_withdraw_twice` (arithmetic underflow) and `..._cannot_reach_encumbered_bond` [measured]. `git diff --stat origin/main -- contracts/src` prints nothing [measured].
- **Untested reverts:** of the 17 custom errors in `contracts/src/`, 3 were named by no test before this task: `Unrepresentable`, `AppealBondTooLarge` and `AppealBondExists` [measured, by grepping `contracts/test/` for each name]. `unit/UntestedReverts.t.sol` tests all three, with `Unrepresentable` at each of its three widths and the uint48 expiry bound from both sides. No source file uses `require` or `assert` [measured].
- **Contract signers** (`crosscheck/Erc1271Roles.t.sol`, 7 tests): an ERC-1271 seller signs the terms and the delivery and is paid; an ERC-1271 primary signs the acceptance (bond encumbered) and the decision (fee paid); an ERC-1271 fallback reserves its bond by deciding. A wrong magic value, a revert, an empty return, and an honest wallet given another key's signature are each refused with `BadSignature` [measured].
- **Format:** `forge fmt --check` passes on the 9 new files [measured].

## Decisions

1. **The count of 24.** The recovered `Withstood.t.sol` holds 8 functions, but one (`test_defense_cross_deployment_replay_refused`, with its `_bondOn` helper) is a duplicate left by a repeated edit in the pass's transcript. Its 7 distinct tests are the 7 already in `contracts/test/unit/Withstood.t.sol` [measured, by comparing the two files]. The other 6 recovered files hold 17 tests: 16 attacks and 1 defense (`test_defense_fallback_attempt_is_bound`). The 17 attacks of G-4 are those 16 plus `test_info_mutual_payout_to_rules_strands_tokens` [inferred].
2. **Renames.** A test whose finding is fixed is renamed from `test_attack_` to `test_regression_` with the rest of its name kept, so a reader finds it from the review. Two tests whose behaviour changed in part got new names: `test_attack_d31_deadlines_after_expiry_leave_seller_unpaid` (was `..._strand_bonds_and_unpaid_seller`; M-1 fixed the bond half, L-6 keeps the seller half) and `test_attack_free_appeal_wins_the_price_from_the_bond` (was `test_attack_free_appeal_then_key_for_nothing`; H-2 fixed the key half, and since the overturn payout the free appeal wins the price, L-3).
3. **Appellant changes.** L-7's fix (PR #160) admits only the party the decision went against, so the ported tests about an appealed reject file the appeal as the seller, not the buyer. The H-2 regression also asserts that the buyer's appeal of its own refund is refused.
4. **One test per original.** Where a finding is half fixed, one function asserts the fixed half as a regression and keeps the open half attack-shaped, so the port stays at 17 functions.
5. **The vault's deposit credits before it pulls.** `deposit` adds to `bondOf` before `safeTransferFrom`, so a sender hook can withdraw the credit before the tokens arrive. The pull must still land for the call to succeed, so the books end even; `test_defense_withdraw_inside_deposit_pull_takes_nothing_extra` pins that. Not a finding [inferred]; a fee-on-transfer token is L-2, already recorded.
6. **`AppealBondExists` is unreachable through the rules contract.** `fileAppeal` refuses a second appeal with `WrongAppealState` first, and the vault deletes the record when the appeal closes. The test calls the vault as RULES [inferred from the source].

## Handoff

Done: the 17 tests are ported, the vault reentrancy, untested-error and contract-signer suites are written, and every new test passes. No new finding: no reentry into the vault worked, and every ported attack behaves as the review and `known-issues.md` say.

For the contract lane (T-212, pilot C3 to C5): five tests are attack-shaped and pass while their finding is open. Each flips when its fix lands; turn it into a `test_regression_` then.
- L-3: `test_attack_zero_bond_appeal_accepted_without_allowance`, `test_attack_free_appeal_wins_the_price_from_the_bond` (`unit/OverturnKeyRelease.t.sol`)
- L-5 (appeal part): `test_attack_appeal_adjudicator_decides_escalation_with_no_bond_at_stake`, `test_attack_party_appeal_adjudicator_has_nothing_at_stake` (`unit/UnbondedDecider.t.sol`)
- L-6: `test_attack_d31_deadlines_after_expiry_leave_seller_unpaid` (`unit/CppReclaimStrandsBonds.t.sol`)

For the coordinator: `contracts/README.md` test counts need a refresh (this task may not edit it). The recovered sources stay in `reports/scratch/t-335-poc/`, outside the repository.
