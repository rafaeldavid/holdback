# T-339: Static analysis at HEAD, triaged, and the planted-failure check of CI

- **Lane:** test
- **Phase:** 2
- **Depends on:** the contract review at `baac930` (`docs/reviews/2026-11-03-contract-review.md` §4); T-241 (its open part: a planted failing contract test fails the run)
- **Paths this task may touch:** `docs/reviews/2026-11-11-static-analysis.md` (new), this task file. Outside the PR: one throwaway branch `t-339-planted-failure` with `contracts/test/unit/PlantedFailure.t.sol`, opened as a draft PR, then closed and deleted.
- **Human gate:** no for the report and the planted-failure run. Installing Aderyn is a download, so it waits on Rafa.
- **Status:** in progress
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

- [ ] Slither runs over the worktree's `contracts/` at HEAD with `--filter-paths "lib/|test/|script/"`; the raw output is saved in `reports/scratch/t-339-slither.txt`.
- [ ] `docs/reviews/2026-11-11-static-analysis.md` gives the tool version, the command, the commit, the counts by severity, a triage of every high and medium result (defect, known with ID, or dismissed with reason), the low and informational results by detector, the diff from `baac930`, and what waits (Aderyn, with the install command).
- [ ] A draft PR with one failing forge test runs CI; the `contracts (forge test)` job and the required `check` job fail; the run ID, the jobs and the failing line are recorded as measured.
- [ ] The draft PR is closed, its remote and local branch deleted, and its extra worktree removed.

## Out of scope

- Fixing any defect Slither finds (T-334's lane).
- Running Aderyn, or any other analyser that needs an install.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
