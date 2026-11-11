# T-335: Port the adversarial pass's attack tests and fill the untested contract paths

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-206 (the contract review and its adversarial pass), T-322 (the defenses already ported)
- **Paths this task may touch:** new files under `contracts/test/unit/` and `contracts/test/crosscheck/` (not `contracts/test/unit/Base.sol`); in `docs/audit/known-issues.md` only row G-4, the "Recorded in" cells of section 2 rows these tests cover, and new rows in section 3; this task file
- **Human gate:** no
- **Status:** in progress
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

- [ ] The 17 missing proof-of-concept tests are in `contracts/test/unit/`, each a regression (fixed finding) or an attack-shaped test with an `// Open: <ID>` comment (open finding)
- [ ] Hook-token tests on `HoldbackBonds` cover deposit, withdraw, release and encumber, and the rules paths that move vault tokens
- [ ] Each custom error that no test named has a test
- [ ] The seller and an adjudicator sign their steps as ERC-1271 wallets; a wrong ERC-1271 answer is refused
- [ ] `forge test` passes, with counts before and after recorded
- [ ] `known-issues.md` G-4 is fixed in this PR, and the section 2 rows the tests cover name them

## Out of scope

- Any contract source change, fix or redeploy
- The formal model (G-3) and invariant counting of the delivery hash (G-5)

## Evidence

## Decisions

## Handoff
