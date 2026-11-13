# T-354: An alignment test for the features phase one cut

- **Lane:** test
- **Phase:** 2
- **Depends on:** ADR-0031 (the phase-one contract scope); the contract refinement plan, section 7b (kept privately, `docs/private-materials.md`)
- **Paths this task may touch:** one new test file under `tests/` and one data file beside it; `vitest.config.ts` (a cost line for the new file only); this task file
- **Human gate:** no
- **Status:** done (2026-11-13): merged to contracts-audit-ready, and in `main` through PR 475 (`27ab44e`), where the test runs in CI
- **Agent/session:** T-354 side session, change kind 4 (one test, no review, a target of 100k tokens)

## Intent

The phase-one contracts cut appeals and bonds (SC-7), Permit2 funding (SC-2), third-party payouts (SC-3), the on-chain record of an unfunded offer's expiry (SC-6) and any-token support (SC-1). Product code and docs outside `contracts/` still name those features. This task adds one test that lists the identifiers of every cut feature, each tagged with its cut and the ADR-0031 section, scans the tracked files for them, and compares the files it finds with a known list of the files still to align, each mapped to the component and the package that will fix it. The test fails when a new file uses a cut identifier and when a listed file no longer does, so the list can only shrink. It prints a count per component and per cut. The whole alignment is done when the known list is empty.

Inputs: ADR-0031, the plan's component table, the source on `contracts-audit-ready`. Output: the test, its data file, the counts. Non-goals: fixing any file the scan finds; checking prose that names a cut feature without an identifier; checking `contracts/`, which the lane's own gates check.

## Context

- `docs/decisions/ADR-0031-phase-one-contract-scope.md` (on `main`): sections 2, 3, 4, 7, 8 and 10, and the appendix of docs that promise what phase one cuts.
- The contract refinement plan, section 7b: the measured count of 79 files on `main` and the table of 22 components.
- `packages/testkit/src/runner.ts`, `LOCAL_EXCLUSIONS`: the SimChain-only fixtures.

## Acceptance criteria

- [x] The identifiers list cites the ADR-0031 section for each cut, and each identifier was found in the source.
- [x] The test passes on `contracts-audit-ready` with its known list.
- [x] Removing a use of a cut identifier from a listed file makes it fail until the list is updated.
- [x] Adding one to an unlisted file makes it fail.
- [x] One command prints the counts per component and per cut.
- [x] Exclusions are an explicit list, each with a reason; false matches are handled by precise patterns or a short allow-list with reasons.

## Out of scope

- Any change to a file the scan finds.
- Prose about appeals or bonds that names no identifier.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
  - `pnpm exec vitest run tests/cut-feature-alignment.test.ts`: 2 of 2 tests pass in about 1.3 s, on `contracts-audit-ready` at `b88f9e5` [measured].
  - Removing `Permit2` from `SECURITY.md` (a listed file) fails the test with the diff line `- "SECURITY.md": …` [measured; the edit was reverted with `git checkout`].
  - Adding `HoldbackBonds` to a comment in `packages/judgment/src/sample.ts` (an unlisted file) fails the test with the diff line `+ "packages/judgment/src/sample.ts": …`, and the failing run prints the counts without any flag [measured; reverted].
  - `pnpm typecheck` and `eslint` on the test and `vitest.config.ts`: clean [measured].
- Snapshot diffs: none; the known list is new.
- Metrics, from the scan of `b88f9e5` [measured]:
  - Identifiers: 57 in all. SC-1: 1, SC-2: 3, SC-3: 2, SC-6: 4, SC-7: 47. Five SC-7 identifiers (`_appealDecision`, `_releaseBonds`, `F_BY_FALLBACK`, `APPEAL_TYPEHASH`, `appealHash`) are used only inside `contracts/` today; they stay listed so a new use outside it is caught.
  - Files that still use a cut feature: 132. Per cut, by files: SC-1 3, SC-2 29, SC-3 9, SC-6 31, SC-7 115.
  - Per component, by files: `packages/settlement/evm` 20; `examples/e2e-*` 18; `tools/`, `scripts/`, `tests/` 13; `packages/core` 11; `docs/` and the root docs 11; `spec/` 9; `apps/demo-cloud` 9; `packages/sdk` and `packages/testkit` 8; `apps/adjudicator` 8; `fixtures/` 7; `apps/operator` 6; `site/` 4; the pinned client in `examples/` 3; `formal/` 2; `packages/settlement` (the port) 1; `apps/demo` 1; `docs/audit` 1.
  - Against the plan's 79 files on `main`: in the plan's search areas (`apps`, `packages`, `examples`, `site`, `spec`, `tools`, `fixtures/scenarios`) this test finds 108 [measured]. The difference comes from identifiers the plan's search did not use (`coverage_exceeded`, `appellant`, the SC-1 and SC-3 names), the scenario snapshots, and tests [inferred: the plan does not list its search terms]. The other 24 files are docs, `formal/`, `scripts/`, `tests/` and the club fixture.

## Decisions

- **`contracts/` is out of the scan.** The lane's own gates check it (plan section 6), and the side-by-side harness names the old contract on purpose. Its vendored code (`contracts/lib`) is the only vendored code in the tree [measured: `git ls-files`].
- **The SimChain-only fixtures are read from `LOCAL_EXCLUSIONS`** in `packages/testkit/src/runner.ts`, so a fixture moved there leaves the scan without a change to this test.
- **A "not in phase one" mark exempts a use.** A use whose line, or one of the three lines above it, says "not in phase one" or "SimChain only" is not counted. That is the ADR-0031 appendix's rule for pages that keep the full protocol's text. No file carries a mark yet [measured].
- **The known list is a vitest file snapshot** (`tests/cut-feature-alignment.known.json`), so `-u` rewrites it and its diff shows each fixed file as a removed line. Each entry names its component and owner from the plan's table.
- **Left out of the identifiers, with the reason in the test:** names that stay in phase one (`appealAdjudicator`, the `appeal` role, `appealDecideSec`, `appealWindowSec`, `appealGround`, `bondReserved`, `appealState`, `offer.expired`, `JobExpired`, the `permit2` scheme value, `appealPanelSize`); rulebook fields ADR-0031 does not name (`appealFee`, `appealBondRateBps`, `bondNoticePeriodMinSec`); and words too common to match precisely (the vault's `deposit` and `release`, `Stage.Expired`). The fixtures whose default pays the seller from a bond (ADR-0031 §8, open point 5) have no identifier of their own; the building task checks them by their steps.
- **One allow-list entry:** `appellant` in a comment in `packages/judgment/src/prompt.ts`, since the plan finds the judgment pipeline takes nothing from the contracts.
- **Two components are not in the plan's table:** `packages/settlement` (the port's timeout kinds) and `tools/`, `scripts/`, `tests/` together. Both are marked "open".

## Handoff

- **Done:** the test, its known list of 132 files and the counts, on `contracts-audit-ready`.
- **Not done: T-346's and T-349's work is not on the lane yet.** PR 343 (T-346, bringing `main` in) is open, and T-349 has no PR into the lane. The known list was built from the lane at `b88f9e5`. Once either merges, the test fails until the list is regenerated. Regenerate it from the lane, review the diff, and commit it with that change:

  ```bash
  pnpm exec vitest run tests/cut-feature-alignment.test.ts -u
  ```

- **Progress, per component, cut, identifier and file:** `pnpm exec vitest run tests/cut-feature-alignment.test.ts --silent=false`.
- **Each package that aligns a file** removes it from the known list in its own PR (rerun with `-u`). A doc that keeps the full protocol's text adds "not in phase one" or "SimChain only" next to each use.
- **Done for the whole alignment:** the known list is empty.
