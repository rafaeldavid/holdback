# T-354: An alignment test for the features phase one cut

- **Lane:** test
- **Phase:** 2
- **Depends on:** ADR-0031 (the phase-one contract scope); the contract refinement plan, section 7b (kept privately, `docs/private-materials.md`)
- **Paths this task may touch:** one new test file under `tests/` and one data file beside it; `vitest.config.ts` (a cost line for the new file only); this task file
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** T-354 side session, change kind 4 (one test, no review, a target of 100k tokens)

## Intent

The phase-one contracts cut appeals and bonds (SC-7), Permit2 funding (SC-2), third-party payouts (SC-3), the on-chain record of an unfunded offer's expiry (SC-6) and any-token support (SC-1). Product code and docs outside `contracts/` still name those features. This task adds one test that lists the identifiers of every cut feature, each tagged with its cut and the ADR-0031 section, scans the tracked files for them, and compares the files it finds with a known list of the files still to align, each mapped to the component and the package that will fix it. The test fails when a new file uses a cut identifier and when a listed file no longer does, so the list can only shrink. It prints a count per component and per cut. The whole alignment is done when the known list is empty.

Inputs: ADR-0031, the plan's component table, the source on `contracts-audit-ready`. Output: the test, its data file, the counts. Non-goals: fixing any file the scan finds; checking prose that names a cut feature without an identifier; checking `contracts/`, which the lane's own gates check.

## Context

- `docs/decisions/ADR-0031-phase-one-contract-scope.md` (on `main`): sections 2, 3, 4, 7, 8 and 10, and the appendix of docs that promise what phase one cuts.
- The contract refinement plan, section 7b: the measured count of 79 files on `main` and the table of 22 components.
- `packages/testkit/src/runner.ts`, `LOCAL_EXCLUSIONS`: the SimChain-only fixtures.

## Acceptance criteria

- [ ] The identifiers list cites the ADR-0031 section for each cut, and each identifier was found in the source.
- [ ] The test passes on `contracts-audit-ready` with its known list.
- [ ] Removing a use of a cut identifier from a listed file makes it fail until the list is updated.
- [ ] Adding one to an unlisted file makes it fail.
- [ ] One command prints the counts per component and per cut.
- [ ] Exclusions are an explicit list, each with a reason; false matches are handled by precise patterns or a short allow-list with reasons.

## Out of scope

- Any change to a file the scan finds.
- Prose about appeals or bonds that names no identifier.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
