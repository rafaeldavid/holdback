# T-352: coverage and mutation tooling for the contracts, with first results

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-341 (side-by-side harness), T-336 (delivery-hash invariant)
- **Paths this task may touch:** `contracts/scripts/` (new), `docs/audit/test-quality.md` (new), new test files under `contracts/test/` only for gaps this task closes, this task file. Never `contracts/src/`, existing test files, `contracts/test/handlers/`, `contracts/test/invariant/`, `contracts/test/differential/`, `.github/`, `packages/`, `apps/`
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** T-352 session (Opus 5.5), change kind 7, a target of 200k tokens

## Intent

Package R10 of the contract refinement plan (crow-private `roadmap/plans/2026-11-11-contract-refinement.md`) runs mutation testing and coverage on `contracts/src/` before the freeze, as gates VG-7 and VG-8. This task builds that tooling now, on `main`, to learn early whether it works: the plan warns that `forge coverage` may not build under the IR pipeline the contracts compile with.

- **Inputs:** the contracts and tests on `main` (or any branch, by a flag).
- **Outputs:** one command for coverage (line and branch coverage per file of `contracts/src/`, every uncovered branch by file and line) and one for mutation (one small change at a time to a scratch copy of the source, the tests run against it, killed and survived reported). The first results on `main`, with numbers and run times, in `docs/audit/test-quality.md`.
- **Non-goals:** changing any contract source; changing CI; closing every gap the tools find (real gaps go to the contract lane, with the test that would kill each described).

## Context

- The plan's section 6 (gates VG-7 and VG-8) and its package R10.
- `docs/audit/known-issues.md` G-4 and G-5: G-5 is the "stores no delivery hash" mutant, the mutation script's first known case.
- `contracts/foundry.toml`: `via_ir = true`; `deploy-sepolia.sh --check` requires `foundry.toml` to equal the deployed commit, so a coverage profile cannot go in that file.

## Acceptance criteria

- [ ] One command runs coverage from a clean checkout and says how to point it at another branch.
- [ ] One command runs mutation from a clean checkout, never writes to the real `contracts/src/`, runs a fixed list of mutants with the delivery-hash mutant first, and says how to point it at another branch.
- [ ] A mutant is reported killed only when the tests ran and failed on it; a mutant that does not compile is reported as such, not as killed.
- [ ] The first results on `main` are recorded with numbers: coverage per file, mutants killed and survived, run times for a full and a quick run.
- [ ] Every survivor is classified as a real gap or an equivalent mutant; each real gap is listed for the contract lane with the test that would kill it.
- [ ] One reviewer checks the mutation script for false kills and for writes to the real source; its findings are fixed.

## Out of scope

- CI jobs (written as a Handoff note; `.github/` is not this task's).
- Static analysis (Slither, Aderyn: gate VG-10).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
