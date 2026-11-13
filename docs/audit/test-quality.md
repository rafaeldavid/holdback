# Test quality of the contracts: coverage and mutation

How Crow measures whether the contract tests reach every line of `contracts/src/` (gate VG-8 of the contract refinement plan) and whether they catch small wrong changes to it (gate VG-7). Task T-352 built the two tools on 2026-11-11 and ran them first on `main`. Package R10 ran them on the phase-one lane, `contracts-audit-ready`, at `c629d06` on 2026-11-12, before the freeze.

## Summary: the pre-freeze run (R10)

The R10 run measured the lane at `c629d06cf1edbec91bb89de891210dd26035a93d`: `contracts/src/` as at that commit, the tests as at that commit plus this task's gap tests. The freeze commit `0180a39` has the same runtime code (below), so every figure here holds for it. Numbers are measured unless a label says otherwise.

- **Gate VG-7, mutation: passes.** 155 mutants: 151 killed, 4 survive, none timed out and no tool error.
  - The 4 survivors are equivalent or change only a revert reason; none is a finding.
  - The run also found three real test gaps, each now closed by a new test. Each was in a test, not in the contracts' behaviour.
  - Details: the R10 section below.
- **Gate VG-8, coverage: passes, with its exceptions named.**
  - `DrandQuicknetBeacon.sol` has 59/59 lines and 8/8 branches; `HoldbackTypes.sol` has 52/52 lines.
  - `HoldbackRules.sol` has 236/237 lines and 68/70 branches. Of the three misses, one was real and is closed by a test; the other two are source-map artefacts of `--ir-minimum` [inferred].
- **Static analysis: nothing new.** Aderyn 0.6.8 and Slither 0.11.6 at `c629d06` report only classes already dismissed in `docs/reviews/2026-11-11-static-analysis.md` (R10 section).
- **Runtime code at `c629d06` equals the freeze commit `0180a39`.** By T-384's method (sha256 of the runtime code with its metadata tail cut, the method to quote): `HoldbackRules` is `0x545f80b5…0c47` (20,449 bytes) and `DrandQuicknetBeacon` is `0x3a8c11c6…8c96` (3,216 bytes), reproduced here at `0180a39`. This task's keccak256 of a metadata-free build gives the same equality; the section below says why its figures differ.

## Summary: the first run, on main

Both tools work on `main` at `5a90dc5`, the deployed domain-0.7 contracts. Those contracts keep party appeals, bonds and a second funding method, which are not in phase one. This section is a dated record of that run; the R10 run above measures the phase-one contracts. The coordinator ended `main`'s run at 89 of 179 mutants on 2026-11-12, because `main`'s contracts are replaced at the freeze; the figures below are the first 82, as recorded then. Numbers are measured unless a label says otherwise.

- **Coverage builds** with `forge coverage --ir-minimum`, after the plain `forge coverage` fails. Four of the five source files have every line and branch covered. `HoldbackRules.sol` has 310 of 314 lines (98.7%) and 79 of 92 branches (85.9%). The gaps are revert branches of signature and deadline checks that no test reaches, plus one block that cannot run while the mutual-settlement fee share is 0 bps.
- **Mutation:** the run stopped at 82 of 179 mutants on 2026-11-12 to free the machine for the contract lane (T-356). Of the 82, 71 are killed and 11 survive. Every survivor has an outcome: a new test that kills it, or a written reason with the file and line that make it equivalent.
  - Two are equivalent: M004 and M057.
  - Seven get new tests: M005 and M006 in `contracts/test/unit/AgreeAndFundExpiry.t.sol` (holdback PR 358, merged); M008, M020, M047, M074 and M139 in `contracts/test/unit/MutationGaps.t.sol`. `main`'s copy does not compile against the phase-one contracts, which fund by ERC-3009 only (T-374), so R10 ported it to the lane without the funding-method test (the R10 section above).
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

On the lane, the mutant list is `contracts/scripts/mutants-lane.json`, and two shards at once ran it in about 4.5 h at `c629d06`:

```bash
node contracts/scripts/mutate.mjs --list contracts/scripts/mutants-lane.json --shard 1/2
```

```bash
node contracts/scripts/mutate.mjs --list contracts/scripts/mutants-lane.json --shard 2/2
```

Other `mutate.mjs` flags:

| Flag | What it does |
| --- | --- |
| `--list <file>` | Picks the mutant list (default `mutants.json`) |
| `--check` | Reports which mutants apply exactly once to the source, without forge |
| `--quick` | Runs the mutants marked quick |
| `--only M001,M035` | Runs the named mutants |
| `--shard k/n` | Runs every n-th mutant from the k-th, so n runs at once split the list; each shard has its own copy and build cache |
| `--match-test <regex>` | Runs only the matching tests, to measure what one test kills on its own |
| `--resume` | Continues an interrupted run |
| `--build full` | Runs every mutant on the full optimizer build |
| `--no-full` | Skips the second pass over survivors |
| `--timeout-min 30` | Bounds each forge call, in minutes |

The tool refuses a list with a repeated mutant id.

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

## The pre-freeze run on the lane (R10)

All figures are at `c629d06`, from 2026-11-12 18:22 UTC (the commit) to 2026-11-13 about 01:00 UTC, on the maintainer's 8-core machine.

### The mutant list

`contracts/scripts/mutants-lane.json` inherits the lane's `mutants.json` and names every change. Every mutant's text applies exactly once at `c629d06` [measured with `--check`].

| Group | Count | What |
| --- | --- | --- |
| Unchanged from `main`'s list | 92 | the lines whose text did not change |
| Retargeted | 22 | 17 here, 5 by T-380 in the lane's `mutants.json` (M013, M027, M028, M040, M112): the same mutant on the line's new text |
| Retired | 65 | code the lane deleted, each with its reason in the file: the bonds (29 mutants: B01 to B18 and 11 bond lines in `HoldbackRules.sol`), party appeals (24), the second funding path (3), the offer's expiry on chain (2), the sim beacon in `src/` (2), the money helpers (2), and payout and fee-share lines the cuts removed (3) |
| New | 41 | 39 here (L001 to L041 without L025 and L027, which repeated T-380's M140 and M141), and M140 and M141 by T-380 |
| **Run** | **155** | |

The new mutants cover R8's fixes (the unrepresentable terms, the strict deadline order, the constructor's zero addresses, the beacon margin, the seed tag bound to the commitment), RF-4's close reasons, the payout and money addresses, and T-384's outcome check `isValidOutcome` with `ONLY_ATTEMPT`. `IHoldbackRules.sol` holds no logic and has no mutant. The lane's `mutants.json` had two mutants with the id M139; the second, T-380's, is now M141, and the tool refuses repeated ids.

### How it ran

- **Split in two shards,** each with its own copy and build cache, after a timing test on six mutants. Serial took 1,111 s, split 773 s, and each of the six got the same verdict both ways [measured].
- **The fast pass ran from 19:04 to 23:03 UTC.** The other sessions' jobs drove the load average to 167 at about 20:00 UTC, and the coordinator held their forge and anvil jobs until the pass ended. A mutant took 167 s to 192 s on a quiet machine and up to 347 s under that load.
- **Then the full-build pass:** the five survivors ran again on the full optimizer build with every test, the side-by-side and gas tests included, ending at 23:33 UTC.
- **Nothing to rerun:** no mutant timed out or hit a tool error, so no result could have come from load.
- **The baselines passed:** 461 tests on the fast build and 483 on the full build, before this task's last three tests.

### Results

**155 mutants: 151 killed, 4 survive.**
- 150 died in the fast pass.
- T05 died on the full build, to `testFuzz_sideBySide`.

Every survivor, with the function and the mutated text, since comments move the line numbers:

| Kind | Mutant | Function, line at `c629d06` | Mutated text | Outcome |
| --- | --- | --- | --- | --- |
| deadline | M004 | `agreeAndFund`, `HoldbackRules.sol:142` | `block.timestamp >= t.timing.fundBy` became `block.timestamp > t.timing.fundBy` | **Equivalent.** The strict deadline order (`:153`) puts `offerExpiresAt` before `fundBy` in any terms that can fund, so at `fundBy` the offer check on the same line already refuses; terms out of order are refused at `:153` |
| signature | M084 | `mutualSettle`, `HoldbackRules.sol:363` | `(m.releaseKey \|\| m.deliveryHash != bytes32(0) \|\| s != Stage.Held)` became `(m.releaseKey \|\| m.deliveryHash != bytes32(0))` | **Equivalent.** `:367` refuses the same input with the same `InvalidMessage`, on two premises measured by listing every write (below) |
| signature | M132 | `_requireKeyProof`, `HoldbackRules.sol:527` | `k.index >= k.keyHashes.length \|\| k.keyHashes[k.index] != …` became `k.keyHashes[k.index] != …` | **Same behaviour, a different revert reason.** An index past the list reverts with the array-bounds panic instead of `BadKeyProof`, so no key travels and no money moves. Killed since by `test_earlyAccept_refusesAKeyIndexPastTheList` [measured] |
| signature | D09 | `_lt`, `DrandQuicknetBeacon.sol:166` | `(aHi == bHi && aLo < bLo)` became `(aHi == bHi && aLo <= bLo)` | **Equivalent.** It changes three exact values. An x of exactly p: `test_refuses_malformedEncodings` (`DrandBeacon.t.sol:100`) sends it and got `InvalidSignature` against the mutant [measured], because the EIP-2537 precompiles refuse a coordinate not below p. The two others, r equal to p and y equal to (p − 1)/2, are single points no real round's signature can be [inferred] |

**M084's two premises** [measured, by listing every write in `HoldbackRules.sol` at `c629d06`]:
1. **A posted delivery always leaves a non-zero hash.** `deliveryHashOf[id]` has one write, at `:522`, of `dh = H.deliveryHash(id, dv)` (`:520`), a keccak256 of the encoded delivery. `invariant_deliveryHashStored` (`RulesInvariants.t.sol:143`) also asserts the stored hash equals the posted one.
2. **No path reaches the three stages without a delivery.**
   - `Delivered` is written only at `:190` (`deliver`) and `:208` (`decide` in `Held`), each right after `_acceptDelivery`.
   - `FallbackJudging` is written only at `:432`, which requires `Delivered` (`:430`).
   - `Escalated` is written only at `:272`, in `_firstInstance`, which `decide` reaches only in `Delivered` or `FallbackJudging` (`_turn`, `:254-258`).

**Three test gaps the run found, each closed by a new test** [measured: each test passes at `c629d06` and kills its mutant]:

| Mutant | What no test checked | Test | Severity of the gap |
| --- | --- | --- | --- |
| M128 | A delivery with an attempt other than `ONLY_ATTEMPT` (coverage showed that revert never ran) | `test_deliver_refusesAnotherAttemptNumber` in `MutationGaps.t.sol` | Low |
| M132 | A key index past the end of its list | `test_earlyAccept_refusesAKeyIndexPastTheList` in `MutationGaps.t.sol` | Info |
| T05 | The fallback role's hash: `roleHash` hashing it as the appeal role passed every suite but the side-by-side test, because the tests sign through the same library | `RoleVectors.t.sol`: core's decision digests for the fallback role (`0x36a53f5e…191b`) and the appeal role (`0xdf36cfed…3a27`) | Low |

- **Where T05's digests come from:** core's own `messageDigest` at `c629d06`, with the inputs of `eip712.vectors.test.ts`; the same computation reproduced the existing primary digest `0x64343a2c…59e1` [measured].
- **CI already covered T05 from the TypeScript side:** the anvil job runs `apps/adjudicator/src/drand-contract.redteam.test.ts` (`ci.yml:144`), whose test at line 240 has the contract accept a fallback's decision and an appeal decision, both signed through core's EIP-712 types. So T05 was a gap of the forge suites alone [inferred, from reading that test].

### The decision counter

`invariant_timelyDecisionsLand` (`RulesInvariants.t.sol`, T-375, triage item 43) is a liveness counter: every authorised, timely decision lands. It ran alone against the 50 mutants on the decision path, with `--match-test invariant_timelyDecisionsLand`, in two shards from 23:50 to 00:31 UTC [measured]. Those are the mutants in `decide`, `_turn`, `_firstInstance`, `_escalationDecision`, `_settleDecision`, `isValidOutcome`, the round and deadline helpers, and `triggerFallback`.

- **It kills 16 of the 50 on its own:** M025, M027, M028, M036, M039, M042, M044, M045, M113, L017, L028 and L034 to L037, and L039. Each makes a timely, authorised decision fail, or moves its deadline, its round or the outcome rule.
- **It lets 34 pass, as a liveness check should.** Examples:
  - mutants that let a malformed decision land: a wrong role, attempt, delivery hash, seed or round, or an unknown outcome (M033 to M035, M040, M041, M043, L038, L040);
  - mutants in the money and event lines after the decision (M058 to M065, M046);
  - one-second boundaries the handler's clock does not hit (M029, M038, M110).
- **The full suite kills all 50** in the main run. None of them is among the four survivors.

So the counter adds liveness coverage, and the refusals of malformed decisions rest on the unit and cross-check suites, which kill each of them.

### Coverage at c629d06

Measured with `node contracts/scripts/coverage.mjs`: 212 s; 459 tests ran and passed, `MutationGaps.t.sol` among them.

| File | Lines | Branches |
| --- | --- | --- |
| `DrandQuicknetBeacon.sol` | 59/59 (100%) | 8/8 (100%) |
| `HoldbackRules.sol` | 236/237 (99.6%) | 68/70 (97.1%) |
| `HoldbackTypes.sol` | 52/52 (100%) | none reported |

`IHoldbackRules.sol` and `IHoldbackBeacon.sol` hold no code to cover. What no test reached in `HoldbackRules.sol`:

| Line | What | Outcome |
| --- | --- | --- |
| 519, branch 0 | the refusal of a delivery attempt other than `ONLY_ATTEMPT` | real; closed by `test_deliver_refusesAnotherAttemptNumber` |
| 151 | `H.Timing calldata tm = t.timing;`, an alias of a calldata pointer | an `--ir-minimum` source-map artefact [inferred]: every funded deal passes the line |
| 224, branch 1 | the false side of `if (role == H.ROLE_PRIMARY)` | an artefact [inferred]: fallback and escalation decisions run in `DrandDecide.t.sol` and the invariant suite |

### Static analysis at c629d06

Both tools ran with the commands of `docs/reviews/2026-11-11-static-analysis.md` on the lane worktree, whose `contracts/src/` equals `c629d06` [measured]. Neither finds anything new: every result belongs to a class that review dismissed, and no instance is a defect.

**Slither 0.11.6:** 55 results, 0 High, 8 Medium, 19 Low, 28 Informational. The command was `slither contracts --filter-paths "lib/|test/|script/"`.

| Class | At `c629d06` | At `7a9f1d2` (T-380) | Answer |
| --- | --- | --- | --- |
| `incorrect-equality` (Medium) | 5 | 9 | dismissed: enum stages and role codes, never a balance |
| `uninitialized-local` (Medium) | 2 | 2 | dismissed: `_payOut`'s sums start at 0 |
| `unused-return` (Medium) | 1 | 1 | dismissed: `_refundAll` reads one field of `paymentState` |
| `reentrancy-events`, `timestamp` (Low) | 9, 10 | 9, 10 | dismissed there |
| `naming-convention` (Info) | 17 | 9 at `1430f77` | style. The 8 more are the `UPPER_CASE` getters `IHoldbackRules.sol` declares (`ESCROW()`, `BEACON()`, `KEY_DECISION()` and so on), the same point as the immutables |
| `too-many-digits`, `low-level-calls`, `cyclomatic-complexity` (Info) | 8, 2, 1 | the same | kept: the BLS12-381 constants, the EIP-2537 precompile calls, `decide` |

**Aderyn 0.6.8:** 1 High class and 7 Low classes over 5 files and 961 nSLOC. The command was `aderyn contracts --src src`.
- H-1, `abi.encodePacked` over type strings: 8 instances, dismissed as A-1.
- L-1 to L-7: internal functions used once (A-5), large literals (A-5), the 10 lines of BLS literals (A-5), `_payOut`'s loop (A-7), `_acceptDelivery`'s unused return (A-3), the public `roundAt` (A-8), and `PAIRING_GAS` reported unused (a false positive, A-4).

### Runtime code: c629d06 against the freeze commit

`node contracts/scripts/runtime-hashes.mjs c629d06 0180a39` builds `contracts/src/` alone at each commit with `bytecode_hash = "none"` and `cbor_metadata = false`, and hashes each contract's `deployedBytecode` with `cast keccak` [measured, 56 s per commit]:

| Contract | `c629d06` | `0180a39` (freeze) | Bytes |
| --- | --- | --- | --- |
| `HoldbackRules` | `0x7418f469f50a7da3b398586fe8bd43231f7add8e14b39dc32c8d54f997baf16d` | the same | 20,449 |
| `DrandQuicknetBeacon` | `0x8c91f83bbb02e5d5e2094567ef379facc245ae3772c1b8789f11f5b869739058` | the same | 3,215 |

**The figures to quote are T-384's, which this run reproduced exactly at `0180a39`** [measured, 2026-11-13]: `HoldbackRules` `0x545f80b56390f540e5a98d715c7a436914af83d3653bf458d14c380ff53b0c47` (20,449 bytes) and `DrandQuicknetBeacon` `0x3a8c11c6bc2940b404c417b538bdd6a40c431717c4d32e62dfa5ab3479e38c96` (3,216 bytes). The keccak256 figures above are a second view of nearly the same bytes; they are not for the cutover sheet or the audit docs.

What each method hashes [measured: `contracts/src/` built at `0180a39` both ways, each variant hashed with sha256 and keccak256]:

| | T-384's method, for the sheet and the audit | This task's method, above |
| --- | --- | --- |
| Build | as configured: the build the deploy uses | a second build with `bytecode_hash = "none"`, `cbor_metadata = false` |
| Code | the artifact's `deployedBytecode` (runtime code) | the same field of the second build |
| Metadata tail | cut: the last two bytes give the CBOR length (51), and the CBOR plus those two bytes go, 53 bytes | never emitted |
| Immutables | the compiler's zero placeholders (24 slots in `HoldbackRules`, 2 in the beacon) | the same |
| Hash | sha256 | keccak256 |
| `HoldbackRules` | 20,502 bytes less 53 = 20,449 bytes; `0x545f80b5…0c47` | the same 20,449 bytes, byte for byte; keccak256 `0x7418f469…f16d` |
| `DrandQuicknetBeacon` | 3,269 bytes less 53 = 3,216 bytes; `0x3a8c11c6…8c96` | 3,215 bytes: the same code without its last byte, a `0xfe` (INVALID) that the compiler places before the metadata and leaves out when there is none; keccak256 `0x8c91f83b…9058` |

So the two methods differ in the hash function for both contracts, and by that one trailing byte for the beacon. Each still finds `c629d06` and `0180a39` equal.

**Use T-384's method** for the cutover sheet and the audit docs. It hashes the code the deploy actually builds, needs no second build with other settings, and the cutover sheet and T-383 already quote its figures.

**On chain,** neither figure equals `extcodehash`: the deployed code carries the immutables' values where the artifact has zeros. To check a deployed contract, zero the immutable ranges the artifact lists (`deployedBytecode.immutableReferences`), cut the tail, then take sha256.

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
- **On the lane,** 99 of the 139 `HoldbackRules.sol` mutants still apply as written. The bonds and sim-beacon mutants (20) report stale, because the cut deleted those files [measured by applying each mutant's text to the lane's source]. The lane's own new checks, such as `acc.bondReserved != 0` in `agreeAndFund`, need mutants added to `mutants.json` before the freeze. T-380 added M139 and M140 for the beacon margin. That reuses M139, which `main` uses for the early accept's expiry, so the lane's list held two mutants with one ID [measured on the lane, 2026-11-12]; R10 renumbered T-380's to M141 and added mutants for the lane's new lines (the R10 section above).

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
