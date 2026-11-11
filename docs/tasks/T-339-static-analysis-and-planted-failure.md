# T-339: Static analysis at HEAD, triaged, and the planted-failure check of CI

- **Lane:** test
- **Phase:** 2
- **Depends on:** the contract review at `baac930` (`docs/reviews/2026-11-03-contract-review.md` §4); T-241 (its open part: a planted failing contract test fails the run)
- **Paths this task may touch:** `docs/reviews/2026-11-11-static-analysis.md` (new), this task file. Outside the PR: one throwaway branch `t-339-planted-failure` with `contracts/test/unit/PlantedFailure.t.sol`, opened as a draft PR, then closed and deleted.
- **Human gate:** no for the report and the planted-failure run. Installing Aderyn is a download, so it waits on Rafa.
- **Status:** done (PR #323 merged 2026-11-11; known issue G-7 records that Aderyn waits on Rafa's OK to install)
- **Agent/session:** implementer, pilot plan package C1e

## Intent

Crow is getting its contracts ready for an external audit. An auditor will run the standard static analysers first, so every result they would see should already have a recorded answer. This task runs Slither 0.11.6 over `contracts/src/` at today's `main`, the same way the `baac930` review ran it, and gives every high and medium result one of three answers by reading the code: a defect (recorded for T-334's lane with file, line and a proposed fix, since this task changes no source), already known (with its known-issues ID), or dismissed with a reason. The low and informational results are summarised by detector. The report compares the run with the one at `baac930`: what is new and what disappeared.

The second part closes T-241's open item: show, with a real CI run, that a failing contract test fails the `contracts (forge test)` job and with it the required `check` job. A throwaway draft PR carries one failing test, CI runs, the result is recorded, and the PR is closed and its branch deleted.

Non-goals:
- No change to `contracts/src/`, `.github/` or `docs/audit/known-issues.md`. Rows that known-issues should gain are listed in the report for the coordinator.
- No Aderyn run: it is not installed, and installing it waits on Rafa's OK.
- The planted-failure PR is never merged.

## Context

- `docs/reviews/2026-11-03-contract-review.md` §4, the last static-analysis run (at `baac930`).
- `docs/audit/known-issues.md`, the known-issues IDs.
- `.github/workflows/ci.yml`, the `contracts` and `check` jobs.

## Acceptance criteria

- [x] Slither runs over the worktree's `contracts/` at HEAD with `--filter-paths "lib/|test/|script/"`; the raw output is saved in `reports/scratch/t-339-slither.txt`.
- [x] `docs/reviews/2026-11-11-static-analysis.md` gives the tool version, the command, the commit, the counts by severity, a triage of every high and medium result (defect, known with ID, or dismissed with reason), the low and informational results by detector, the diff from `baac930`, and what waits (Aderyn, with the install command).
- [x] A draft PR with one failing forge test runs CI; the `contracts (forge test)` job and the required `check` job fail; the run ID, the jobs and the failing line are recorded as measured.
- [x] The draft PR is closed, its remote and local branch deleted, and its extra worktree removed.

## Out of scope

- Fixing any defect Slither finds (T-334's lane).
- Running Aderyn, or any other analyser that needs an install.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
  - `slither <worktree>/contracts --filter-paths "lib/|test/|script/" --json reports/scratch/t-339-slither.json`, Slither 0.11.6 at `1430f77`: 78 results, 1 high, 17 medium, 40 low, 20 informational, over 24 contracts with 102 detectors [measured]. Raw output in `reports/scratch/t-339-slither.txt` (409 lines) [measured].
  - Triage: no defect. The high (`arbitrary-send-erc20`, `HoldbackBonds.sol:101`) is dismissed: the `from` is the appellant whose signature `fileAppeal` checks. Of the 17 mediums, 1 is known as I-2 and 16 are dismissed with the code that shows it (report §3) [inferred from reading the code].
  - Diff from `baac930` (77 results): `reentrancy-no-eth` is gone (removed by `f685f09`, T-206 M-3); one new `incorrect-equality` at `HoldbackRules.sol:283` (`f2b28c1`) and one new `unused-return` at `:606` (`99dc47e`); the low and informational counts are unchanged [measured].
  - Planted failure: draft PR #322, CI run `43078620034`. `contracts (forge test)` failed with `[FAIL: T-339 planted failure: CI must fail on this] test_plantedFailure() (gas: 3513)` and `248 tests passed, 1 failed, 0 skipped (249 total tests)`; the required `check` failed on `contracts=failure`; every other job passed [measured]. PR #322 is closed unmerged and its branches and worktree are gone [measured].
  - Local checks: none for kind 2 (`docs/team.md`, Change recipes); CI is the gate.
  - `git diff --stat origin/main -- contracts/src` prints nothing [measured].
- Snapshot diffs: none.
- Metrics: the CI run took about 11 minutes from push to the `check` result; `contracts (forge test)` took 3 min 37 s [measured].

## Decisions

- Slither ran with the `baac930` filter (`--filter-paths "lib/|test/|script/"`) so the two runs compare one to one; the JSON output gave the counts by detector.
- A result that cannot do harm at its location is "dismissed" with the code that shows it, not "accepted": no result is a risk the project chose to carry. S-17 is "known: I-2", since I-2 already records that dead branch.
- The report proposes one known-issues row (G-7, Aderyn not run at HEAD) for the coordinator, and no row per Slither result.
- The planted test asserts `false` with a message naming T-339, so the failing line in the log names its task.

## Handoff

- Done: the Slither run, the triage, the diff from `baac930`, and the planted-failure run (report §7).
- Not done: Aderyn. It waits on Rafa's OK to install; the report's §6 gives the install and run commands. After it runs, add its results to the report's tables and triage its highs.
- For the coordinator: add row G-7 to `docs/audit/known-issues.md` §6 (text in the report's §6).
- For T-334's lane: no defect. When `contracts-audit-ready` lands, S-17 should disappear with the dead fee-share branch, and a re-run should show 16 medium [inferred].
