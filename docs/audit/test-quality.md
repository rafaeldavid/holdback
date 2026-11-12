# Test quality of the contracts: coverage and mutation

How Crow measures whether the contract tests reach every line of `contracts/src/` (gate VG-8 of the contract refinement plan) and whether they catch small wrong changes to it (gate VG-7). Task T-352 built the two tools on 2026-11-11 and ran them once on `main`. Package R10 runs them again on `contracts-audit-ready` before the freeze.

## Summary

Both tools work on `main` at `5a90dc5`, the deployed domain-0.7 contracts. Those contracts keep party appeals, bonds and a second funding method, which are not in phase one. This page is a dated record of that run; package R10 measures the phase-one contracts on the lane before the freeze. Numbers are measured unless a label says otherwise.

- **Coverage builds** with `forge coverage --ir-minimum`, after the plain `forge coverage` fails. Four of the five source files have every line and branch covered. `HoldbackRules.sol` has 310 of 314 lines (98.7%) and 79 of 92 branches (85.9%). The gaps are revert branches of signature and deadline checks that no test reaches, plus one block that cannot run while the mutual-settlement fee share is 0 bps.
- **Mutation:** the run stopped at 82 of 179 mutants on 2026-11-12 to free the machine for the contract lane (T-356). Of the 82, 71 are killed and 11 survive. Every survivor has an outcome: a new test that kills it, or a written reason with the file and line that make it equivalent.
  - Two are equivalent: M004 and M057.
  - Seven get new tests: M005 and M006 in `contracts/test/unit/AgreeAndFundExpiry.t.sol` (holdback PR 358, merged); M008, M020, M047, M074 and M139 in `contracts/test/unit/MutationGaps.t.sol`, which is on `main` only. It does not compile against the phase-one contracts, which fund by ERC-3009 only (T-374). Porting its kills to the lane is package R7's or R10's.
  - Two are real gaps on `main` in code the lane's appeals-and-bonds cut deleted: M030 and M031 (M057 is gone from the lane too).
- **Real gaps, Low to Medium, all in the tests, none in the code's behaviour:** checks the code performs and no test exercises. The Medium ones are three expiry checks on signed messages (M005, M006, M139) and the posted-delivery binding of the early accept (M074). Coverage adds a fourth expiry check, the mutual settlement's, whose mutant (M083) has not run yet.
- **Cost:** one mutant takes 126 s on average (115 s to 198 s) on the fast build. The full list takes about 6.3 h plus about 1.5 h for the survivors' full-build pass [inferred from the per-mutant times]. The quick subset of 27 mutants takes about 1 h [inferred]. Neither fits a pull request's CI; both belong to the pre-freeze gate, and the quick subset fits a nightly job.

## The two commands

Both tools start from a clean checkout with the contract submodules checked out (the three `git submodule update` commands of the contracts job in `.github/workflows/ci.yml`). Neither writes to `contracts/src/` or changes `contracts/foundry.toml`, which `deploy-sepolia.sh --check` requires to equal the deployed commit. Each run copies `contracts/src`, `test`, `script`, the build config and the drand fixtures into `reports/scratch/t-352/` (git ignores `reports/`), links `contracts/lib` to the checkout's submodules, and works on that copy.

```bash
node contracts/scripts/coverage.mjs
```

```bash
node contracts/scripts/mutate.mjs
```

To run either on another branch, fetch it and pass `--ref`. The branch must pin the same `commerce-payments` submodule as the checkout.

```bash
git fetch origin contracts-audit-ready
```

```bash
node contracts/scripts/mutate.mjs --ref origin/contracts-audit-ready
```

```bash
node contracts/scripts/coverage.mjs --ref origin/contracts-audit-ready
```

Other `mutate.mjs` flags: `--quick` runs the mutants marked quick, `--only M001,M035` runs named mutants, `--resume` continues an interrupted run, `--build full` runs every mutant on the full optimizer build, `--no-full` skips the second pass over survivors, `--timeout-min 30` bounds each forge call.

Reports land in `reports/scratch/t-352/`: `coverage-report.md`, `coverage.json` and `lcov.info` under `coverage/`; `mutation-<run>.md` and `mutation-<run>.json`, where `<run>` names the ref (or `worktree`) and the build.

## Coverage: method

`forge coverage` does not build these contracts as configured. Coverage turns the optimizer off, and the contracts need the IR pipeline with the optimizer for stack depth (T-202). `forge coverage --ir-minimum`, the IR pipeline with the minimum optimizer steps, builds `contracts/src/` and every test but one. Foundry warns that its source maps can be inaccurate.

The coverage run leaves three things out, and its report names them:

- **The side-by-side test** (`test/differential/SideBySide.t.sol`): it does not compile under `--ir-minimum` (stack too deep at line 265). It drives the same handler as the invariant suite.
- **`NoAdminFuzzTest` and `PinnedSourceTest`:** they read build artifacts in `out/`, which `forge coverage` does not write. Their reach into `src/` is the function dispatcher and one accept, which other suites also reach.
- **Eight gas-cap tests** in the drand cross-checks (`GAS_CAP_TESTS` in `contracts/scripts/scratch.mjs`): unoptimized code exceeds the caps they assert.

Every other test runs, with a fixed fuzz seed, and must pass, or the tool stops.

## Mutation: method

`contracts/scripts/mutants.json` holds a fixed list of 179 mutants. Each replaces one piece of text in one source file with another. The operators are:

- flip a comparison or move its boundary by one (`cmp`);
- drop a check (`req`);
- change a constant or a term (`const`);
- skip a state write or a payment step (`write`);
- swap two arguments or branches (`swap`);
- remove an event (`event`).

The first mutant, M001, is the known case from `known-issues.md` G-5: `_acceptDelivery` stores no delivery hash. A mutant marked `money` sits on a line that moves money, changes a stage, or checks a signature or a deadline, the lines gate VG-7 names. A mutant whose text is missing, or appears more than once, is reported stale and never applied, so the list cannot mutate the wrong line after the source moves.

For each mutant the tool writes the mutated file into the copy, builds, runs the tests with `--fail-fast` and a fixed fuzz seed (`0x352`), and restores the file. It hashes the checkout's `contracts/src/` before the run and after every mutant, and stops if the hash changes.

Verdicts:

- **killed:** the copy compiled with the change, forge test ran, and at least one test failed. Nothing else counts as a kill.
- **survived:** it compiled, and every test the baseline passed passed again.
- **not compiled, stale, timeout, error:** none of these counts as a kill or a survivor.

The main pass uses a fast build: the IR pipeline with the minimum optimizer steps, in the copy's `foundry.toml` only. The unmutated copy compiles in 99 s to 113 s instead of 308 s [measured on `main`, two runs]. It changes gas and code size, so the gas-budget tests (`GasPerDeal.t.sol` and the eight gas caps) stay out of that pass. The side-by-side test stays out too: while `src/` equals the pinned deployed copy it fails on any change of behaviour, so it would kill every mutant and hide what the other suites assert. Every survivor then runs again on the full build with every test, the side-by-side test included. The report gives both verdicts and the test that killed each mutant.

## First results on main

All results are from `main` at `5a90dc5` (2026-11-11), the commit the Sepolia deployment runs, before the tests this task adds.

### Coverage

Measured with `node contracts/scripts/coverage.mjs`: 211 s wall time, and 342 tests ran and passed under the coverage build.

| File | Lines | Branches |
| --- | --- | --- |
| `DrandQuicknetBeacon.sol` | 59/59 (100%) | 8/8 (100%) |
| `HoldbackBonds.sol` (on `main`; not in phase one) | 44/44 (100%) | 7/7 (100%) |
| `HoldbackRules.sol` | 310/314 (98.7%) | 79/92 (85.9%) |
| `HoldbackTypes.sol` | 58/58 (100%) | none reported |
| `SimBeacon.sol` | 8/8 (100%) | 2/2 (100%) |

What no test reaches in `HoldbackRules.sol`, by line:

| Line | What never ran | Why | Outcome |
| --- | --- | --- | --- |
| 204 | the `MessageExpired` revert of `agreeAndFund` | no test sends an expired acceptance or agree | tests in PR 358 |
| 313 | the refusal of an appeal ground on a first decision | no test sends one | test in `MutationGaps.t.sol` |
| 399 | the `MessageExpired` revert of `earlyAccept` | no test sends an expired early accept | test in `MutationGaps.t.sol` |
| 434 | the `MessageExpired` revert of `mutualSettle` | no test sends an expired settlement | test in `MutationGaps.t.sol` |
| 435-436 | the refusal of a settlement that names no delivery but carries a key release or a delivery hash | no test sends one | two tests in `MutationGaps.t.sol` |
| 445 | the refusal of a released key from a delivery other than the named one | no test sends one | test in `MutationGaps.t.sol` |
| 484-489 | the mutual-settlement fee share to the sitting adjudicator | unreachable: `MUTUAL_FEE_SHARE_BPS` is 0, so the share is 0 (`HoldbackRules.sol:65`, `:483`) | none needed while the constant is 0 |
| 636 | the refusal of a key list that is not the delivery's | the existing test changes the key itself, which fails the check before | test in `MutationGaps.t.sol` |
| 255, 258, 262, 266, 287 | "branch 1" of the `if`/`else if` chain that picks the deciding role | an artefact of the `--ir-minimum` source maps [inferred]: fallback, escalation and appeal decisions all run in the unit tests (for example `DrandDecide.t.sol`, `AfterCppReclaim.t.sol`, `AppealAttempt.t.sol`), so each condition is false in some test | none |

### Mutation

Measured with `node contracts/scripts/mutate.mjs` (fast build, fuzz seed `0x352`). The baseline passed 342 tests; the unmutated copy built in 99 s and tested in 47 s. The run stopped after 82 of the 179 mutants, M001 to M081 and M139, to free the machine for the contract lane. It continues with `--ref 5a90dc5 --resume` (Handoff in the task file).

- **82 mutants:** 71 killed, 11 survived, none stale, none failed to compile, no errors.
- **M001**, G-5's mutant (no delivery hash stored), is killed. The killing test was `test_fallbackDecision_reservesItsBondUntilTheAppealCloses`; `--fail-fast` stops at the first failing test, so other tests that also fail on it are not listed.
- **The full-build pass over the survivors has not run yet:** it needs the machine for about 1.5 h. It could still kill M004 or M020 through the gas tests or the side-by-side test, and the outcomes below do not depend on it.

Every survivor, by the kind of line it sits on:

| Kind | Mutant | Line on `main` | Change | Outcome |
| --- | --- | --- | --- | --- |
| deadline | M004 | `HoldbackRules.sol:203` | `agreeAndFund` funds at `fundBy` itself | **Equivalent in effect, Info.** CPP refuses the same call at `fundBy` on its own: `AuthCaptureEscrow.sol:491` reverts `AfterPreApprovalExpiry` when the time is at or past `preApprovalExpiry`, which `_paymentInfo` sets to `fundBy` (`HoldbackRules.sol:179`). Only the revert reason differs. No test: the lane's next cut changes the deadline order on this line |
| deadline | M005 | `HoldbackRules.sol:204` | the acceptance's expiry unchecked | **Real gap, Medium. Killed by** `AgreeAndFundExpiry.t.sol` (PR 358, merged 2026-11-12) |
| deadline | M006 | `HoldbackRules.sol:204` | the agree's expiry unchecked | **Real gap, Medium. Killed by** `AgreeAndFundExpiry.t.sol` (PR 358) |
| deadline | M139 | `HoldbackRules.sol:399` | the early accept's expiry unchecked | **Real gap, Medium:** an expired early accept would still pay the seller. Test `test_earlyAccept_refusesAnExpiredMessage` |
| signature | M074 | `HoldbackRules.sol:403` | after `deliver`, the early accept need not name the posted delivery | **Real gap, Medium:** the buyer's key could travel with a delivery body the seller never posted (ADR-0029). Test `test_earlyAccept_afterDelivery_refusesAnotherDeliveryThanThePostedOne` |
| signature | M047 | `HoldbackRules.sol:313` | a first decision may carry an appeal ground | **Real gap, Low:** a signed field the contract stores nowhere. Test `test_firstDecision_refusesAnAppealGround` |
| money | M008 | `HoldbackRules.sol:205` | funding method 2 accepted | **Low:** method 2 would take the Permit2 collector (`HoldbackRules.sol:218`), which still needs the buyer's Permit2 signature, so no money moves without the buyer. Test `test_agreeAndFund_refusesAnUnknownFundingMethod`. Not in phase one: the lane funds by ERC-3009 only, and the mutant's text is gone there |
| money | M020 | `HoldbackRules.sol:170` | a hold of exactly 2^120 - 1 refused as unrepresentable | **Low:** a boundary D31 says must be allowed. Test `test_agreeAndFund_aHoldAtTheLargestRepresentableAmountIsRepresentable` |
| money | M057 | `HoldbackRules.sol:336` | the escalation decision releases no bonds | **Equivalent, Info:** escalating already releases the bonds and sets the flags to 0 (`HoldbackRules.sol:317-318`), so this call is always `_releaseBonds(t, 0)`. Gone from the lane (not in phase one) |
| deadline | M030 | `HoldbackRules.sol:268` | the appeal's decision deadline leaves out the appeal window | **Real gap on `main`, Low:** no test decides an appeal late in its window. **Gone from the lane:** the appeals-and-bonds cut deleted party appeals (D57) |
| other (seed) | M031 | `HoldbackRules.sol:269` | the appeal's beacon round counted from the decision, not the filing | **Real gap on `main`, Low:** tests file the appeal in the decision's block, so both times are equal [inferred]. **Gone from the lane** (D57) |

No stage line has a survivor. The new tests are not yet run: they wait for the machine (Handoff).

### What the run does not yet cover

- **M082 to M138 and the bonds, types, drand and sim-beacon mutants** (97 mutants) are not run yet.
- **On the lane,** 99 of the 139 `HoldbackRules.sol` mutants still apply as written. The bonds and sim-beacon mutants (20) report stale, because the cut deleted those files [measured by applying each mutant's text to the lane's source]. The lane's own new checks, such as `acc.bondReserved != 0` in `agreeAndFund`, need mutants added to `mutants.json` before the freeze. T-380 added M139 and M140 for the beacon margin. That reuses M139, which `main` uses for the early accept's expiry, so the lane's list holds two mutants with one ID [measured on the lane, 2026-11-12]; R10 renumbers before the run.

## Cost, and where it runs

| Run | Wall time | Label |
| --- | --- | --- |
| `coverage.mjs` | 211 s | measured |
| `forge test`, full build, every test (the CI job) | 483 s: 308 s compile, 172 s for the side-by-side test | measured |
| One mutant, fast build | 126 s on average, 115 s to 198 s | measured, 82 mutants |
| `mutate.mjs --quick`, 27 mutants | about 1 h | inferred: 27 × 126 s plus the baseline |
| `mutate.mjs`, 179 mutants | about 6.3 h, plus about 8 min per survivor for the full-build pass | inferred |

- **Neither tool belongs in a pull request's CI.** The full mutation run takes hours, and the coverage run needs `--ir-minimum` exclusions that a CI job would have to keep in step with the tests.
- **Both belong to the pre-freeze gate** (VG-7, VG-8), run on `contracts-audit-ready` by package R10.
- **A nightly job could run the quick subset** and the coverage report on the lane, each on its own runner. That needs a `.github/` change, which is not this task's (see the task's Handoff).
