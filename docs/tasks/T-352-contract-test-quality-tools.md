# T-352: coverage and mutation tooling for the contracts, with first results

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-341 (side-by-side harness), T-336 (delivery-hash invariant)
- **Paths this task may touch:** `contracts/scripts/` (new; the plan's package R10 names this folder), `docs/audit/test-quality.md` (new), new test files under `contracts/test/` only for gaps this task closes, this task file. Never `contracts/src/`, existing test files, `contracts/test/handlers/`, `contracts/test/invariant/`, `contracts/test/differential/`, `.github/`, `packages/`, `apps/`
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
- Static analysis was out of scope on `main`; R10 added its rerun on the lane (gate VG-10), at the coordinator's request.

## Evidence

### R10, the pre-freeze run on the lane, at `c629d06` (2026-11-12 and 2026-11-13)

All measured unless labelled; the full write-up is `docs/audit/test-quality.md` (R10).

- **Mutation:** 155 mutants (92 unchanged from `main`'s list, 22 retargeted, 41 new; 65 retired with reasons).
  - Verdicts: 151 killed, 4 survive, no timeouts or tool errors.
  - The run took two shards, 19:04 to 23:33 UTC. Split took 773 s against 1,111 s serial on six mutants, with the same verdicts.
  - Survivors: M004, M084 and D09 are equivalent, and M132 changes only a revert reason. Each has its reason, with the file and line.
- **Three test gaps found and closed:**
  - M128 (the attempt number) and M132 (the key index): two new tests in `MutationGaps.t.sol`.
  - T05 (the fallback role's hash): `RoleVectors.t.sol`, core's decision digests for the fallback and appeal roles.
  - Each new test kills its mutant at `c629d06`.
- **The decision counter** `invariant_timelyDecisionsLand`, run alone, kills 16 of the 50 decision-path mutants; the full suite kills all 50.
- **Coverage:** 459 tests passed under `--ir-minimum`. `DrandQuicknetBeacon` has 59/59 lines and 8/8 branches; `HoldbackRules` has 236/237 lines and 68/70 branches; `HoldbackTypes` has 52/52 lines. One miss was real and is closed by the M128 test; two are source-map artefacts [inferred].
- **Static analysis:** Slither 0.11.6 reports 55 results with no High; Aderyn 0.6.8 reports one High class and 7 Low classes. Nothing new against `docs/reviews/2026-11-11-static-analysis.md`.
- **Runtime code equals the freeze commit:** `HoldbackRules` is `0x7418f469…f16d` and `DrandQuicknetBeacon` is `0x8c91f83b…9058` at both `c629d06` and `0180a39`, built from `src/` with the metadata tail off.
- **`MutationGaps.t.sol` is ported to the lane:** errors through `IHoldbackRules`, payouts to the money addresses, and no funding-method test. It runs in every baseline above.

### The first run, on `main` at `5a90dc5` (2026-11-11 and 2026-11-12)

- **Baseline `forge test`** (full build, every test): 364 tests passed in 483 s wall, of which 308 s compile and 172 s the side-by-side test [measured].
- **`forge coverage` as configured fails** [measured]: it turns the optimizer off, and the contracts need the IR pipeline with it.
- **`forge coverage --ir-minimum` builds** [measured]:
  - It compiles in 52 s.
  - `SideBySide.t.sol` does not compile under it (stack too deep at line 265).
  - Two suites read `out/`, which coverage does not write.
  - Eight drand tests fail only on their gas caps.
  - With those left out, `node contracts/scripts/coverage.mjs` ran 342 tests, all passing, in 211 s.
  - `HoldbackRules.sol`: 310/314 lines, 79/92 branches. The other four files: every line and branch.
- **`node contracts/scripts/mutate.mjs`** (fast build, fuzz seed `0x352`) [measured]:
  - The baseline passed 342 tests; it built in 99 s and tested in 47 s.
  - 82 of the 179 mutants ran before a pause to free the machine for the contract lane (T-356): 71 killed, 11 survived, nothing stale and no errors.
  - M001 (G-5, no delivery hash stored) is killed.
  - A mutant takes 126 s on average.
- **Survivors:** each has a new test or a written reason (`docs/audit/test-quality.md`, Mutation).
  - M005 and M006 are killed by `AgreeAndFundExpiry.t.sol`, holdback PR 358, merged 2026-11-12 [measured: CI's contracts job passed on main with the tests].
  - The tests in `MutationGaps.t.sol` have not run yet [not verified]. They need the machine, which the lane holds; CI runs them on this PR.
- **The review of the mutation script** (one `reviewer`) found no false kill and no write to `contracts/src/`. It found eight Medium and Low items; all eight are fixed: the fixed fuzz seed, `--resume` bound to the source, tests, build and mutant text, one locked copy per run, build timeouts, mutant paths limited to `src/`, the archive by commit, a stricter test-name parser with `--color never`, and the report written before a stop.
- **Lint:** `eslint --no-ignore` on the three scripts with the repo config passed [measured]. Without `--no-ignore` the main checkout's config ignores `.worktrees/**` and lints nothing; CI's `pnpm lint` lints them.

## Decisions

- **No coverage profile in `foundry.toml`.** `deploy-sepolia.sh --check` requires `foundry.toml` to equal the deployed commit, so both tools change only the build config of their scratch copy.
- **The mutation script lives in `contracts/scripts/`,** where the plan's package R10 puts it. It is Node, like the repo's other scripts.
- **Mutation runs on a fast build** (forge coverage's `--ir-minimum` settings), which compiles about 3 times faster. Gas tests leave the fast pass; every survivor gets a second verdict on the full build with every test.
- **The side-by-side test is out of the fast pass.** While `src/` equals the pinned copy, it fails on any behaviour change and would hide what the other suites assert.
- **Tests that must survive the lane's cuts:** the gap tests use only what `Base.sol` offers both on `main` and on the phase-one lane, which has no bonds (D57). The M004 test was dropped for that reason (the lane's deadline-order cut changes its terms), and M004 keeps a written reason.

## Handoff

**State.** R10 is done at `c629d06`, and its figures hold for the freeze commit `0180a39`, whose runtime code is the same. The tools, the lane's mutant list, the gap tests and the results are in the lane's pull request for R10.
- `main`'s run ended at 89 of 179 mutants, by the coordinator's decision, since `main`'s contracts are replaced at the freeze.
- Nothing has to be fixed in `contracts/src/` before the freeze.

**To run both tools again on the lane** (after any change to `contracts/src/`):

```bash
node contracts/scripts/mutate.mjs --list contracts/scripts/mutants-lane.json --check
```

```bash
node contracts/scripts/coverage.mjs
```

```bash
node contracts/scripts/mutate.mjs --list contracts/scripts/mutants-lane.json --shard 1/2
```

```bash
node contracts/scripts/mutate.mjs --list contracts/scripts/mutants-lane.json --shard 2/2
```

- **Run `--check` first.** It reports every mutant whose text no longer applies; retarget each in `mutants-lane.json`, or retire it with its reason.
- **New lines need new mutants.** The list covers the code at `c629d06`.
- **If the lane renames tests,** `GAS_CAP_TESTS` in `contracts/scripts/scratch.mjs` must follow, or coverage stops on the failing gas caps.
- **The fast build's `foundry.toml` edit** expects the lines `optimizer = true` and `via_ir = true`; the script stops if they change.
- **Run nothing else heavy beside the shards:** at a load average of 167 a mutant took twice as long.

**CI (not this task's: `.github/`).** A nightly job could run `node contracts/scripts/mutate.mjs --quick` (about 1 h) and `node contracts/scripts/coverage.mjs` (about 4 min) on the lane. It needs the same three submodule commands as the contracts job and Foundry 1.0.0, and it should upload `reports/scratch/t-352/` as an artifact. Pull-request CI should not run either tool.

**Open.**
- **For `packages/core` (not this task's paths):** pin the two role digests of `RoleVectors.t.sol` in `packages/core/src/eip712.vectors.test.ts` too:
  - the fallback's `0x36a53f5e00f8667a82cdb7589237528a96cdfcdc1bebccf3bbbd1224ffdd191b`;
  - the appeal's `0xdf36cfedd8b2ecad09dff2144b173ca11491141f45abc74f76e25a368cb03a27`.

  Each is the example decision with only `role` changed. Then the repo itself shows they come from core; today only the test's comment says so.
- The runtime hashes differ from T-384's figures for the same commits. Both methods find `c629d06` and `0180a39` equal. The difference is in how each built and hashed the code [inferred], and the coordinator may ask T-384 for its method.
