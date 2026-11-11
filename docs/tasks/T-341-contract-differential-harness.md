# T-341: the side-by-side harness and the state oracle (contract refinement package R3)

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-203 (the handler and the invariant suite), T-336 (the delivery liveness counter), T-340 (the state table, `docs/audit/state-model.md`)
- **Paths this task may touch:** new files under `contracts/test/differential/`; `contracts/test/handlers/RulesHandler.sol`; `contracts/test/invariant/`; `contracts/foundry.toml` (only what these tests need); this task file
- **Human gate:** no
- **Status:** done (on merge of PR 333)
- **Agent/session:** implementer session, change kind 7 (smart contracts), refinement plan package R3

## Intent

Every later change to the contracts on `contracts-audit-ready` must prove what it changes and what it leaves alone. This task builds the two tools that proof needs.

1. **The side-by-side harness (gate VG-1).** A pinned copy of the contracts as deployed on Sepolia (commit `64be1f1`) lives under `contracts/test/differential/`, with a test that its bytes still match that commit. One test runs the same random sequence of handler actions against the old copy and against the source under test, from the same starting state at the same addresses, and compares after every step: every call's outcome, every event, every token balance, every hold, every bond, every deal's stage and stored word, the contract's views and immutables, and the clock. Any difference fails the run, unless an allow-list entry names the change and the exact difference. A sequence is reproducible from its printed seed. A planted behaviour change (a copy that stores no delivery hash) fails the harness, and a kept test proves it.
2. **The state oracle (gate VG-2).** After every step of the invariant campaign, every deal must be in a legal state of `docs/audit/state-model.md` (T-340): a row of its table, the row's time bounds, the appeal-bond rule and the escrow's amounts. A planted illegal state fails the oracle, and a kept test proves it. The oracle carries the delivery liveness counter of pilot package C1b (T-336): the "stores no delivery hash" mutant fails an invariant, and a kept test proves that too.

Non-goals: no change under `contracts/src/`, `docs/audit/`, `formal/`, `packages/`, `apps/`, `examples/`, `spec/` or `.github/`. No existing test or invariant is weakened or deleted. No deploy.

## Context

- Refinement plan (crow-private `roadmap/plans/2026-11-11-contract-refinement.md`): section 3.3 (the oracle), section 6 (gates VG-1 and VG-2), section 7 (package R3).
- `docs/audit/state-model.md` (T-340, PR 330, merged as `ec86a22`; the table is unchanged from `3761f9c`).
- `docs/audit/known-issues.md`, gap G-5. ADR-0029, ADR-0001, ADR-0002.

## Acceptance criteria

- [x] The pinned copy of `64be1f1`'s `contracts/src/` sits under `contracts/test/differential/old/`, and a test fails if any of its bytes change.
- [x] The side-by-side test runs in `forge test`, compares ten fields after every step, and prints the seed and the replay command on a failure.
- [x] With both sides built from `main`'s source and an empty allow-list, the harness passes.
- [x] A planted behaviour change fails the harness; a kept test proves it.
- [x] The state oracle runs as an invariant after every step of the campaign; planted illegal states fail it; a kept test proves it.
- [x] The delivery liveness counter (T-336) is in the handler, and the "stores no delivery hash" mutant fails it; a kept test proves it.
- [x] The harness's run time is measured; its cost to the CI job is stated below.
- [x] Nothing under `contracts/src/` or in `contracts/foundry.toml` changes; the deployed bytecode and `deploy-sepolia.sh --check` are untouched.

## Out of scope

- Allow-list entries for real changes: each change on `contracts-audit-ready` writes its own.
- Contract-wallet signers in every role (the plan gives them to package R6).
- `docs/audit/known-issues.md` and `contracts/README.md` counts (other lanes).

## Evidence

All measured on 2026-11-11 on this branch unless a line says otherwise.

- **Whole suite:** `forge test --root <worktree>/contracts` passed 270 of 270 tests in 40 suites, in 178.7 s of test time (274.5 s wall with an incremental build). A clean build and run of the reviewed commit took 312.7 s wall. The longest suite is `SideBySide.t.sol`, 165.6 s to 178.6 s; the invariant suite takes 17 to 27 s.
- **CI cost:** the `contracts (forge test)` job ran about 3 minutes before this change (its own comment, `ci.yml`). Forge runs suites in parallel, so the job grows by about the side-by-side suite's length, to roughly 5 to 6 minutes [inferred from the local times; the PR's CI run gives the real figure]. The job's limit is 30 minutes.
- **The pinned copy:** each `old/` file has the git blob id of `64be1f1:contracts/src/<file>` (`git hash-object` against `git rev-parse`), and the same source keccak256 as `src/` in the compiler's metadata. `PinnedSource.t.sol` checks those keccak256 values in the artifacts, so it checks the bytes that were compiled.
- **The gate on `main`:** `testFuzz_sideBySide` passed 256 runs at depth 100 (25,600 steps a side) with an empty allow-list.
- **Reach:** over 48 fixed seeds, `test_sideBySide_reachesEveryRow` saw every stage and every row L01 to L37 of the state model, and 772 checked calls landed on the old side. Before the `appealPath` action, the reviewer measured that row L19 was never reached over 256 seeds.
- **Planted behaviour change 1, kept:** the copy that stores no delivery hash fails the harness on all 6 of seeds 1 to 8 that land a delivery (step 12 to 20; fields `calls` and `words`). Seeds 4 and 6 land no delivery, and there the mutant behaves like the old contract.
- **Planted behaviour change 2, measured and not kept:** a domain version of "9.9" in the planted copy failed the harness at step 0 on the `surface` field on every seed. The kept test `test_surfaceSeesTheSigningDomain` checks that the field reads the domain.
- **Planted illegal states, kept:** `test_planted_illegalStatesFailTheOracle` writes four words into storage, and the oracle fails each. Three match no row (a held deal with no bond reserved, a delivered deal with no delivery hash, a delivered deal reserving both bonds). One matches row L05 but has a `t1` before `judgeBy`.
- **The G-5 mutant, kept:** `test_planted_noDeliveryHashFailsTheLivenessInvariant` drives the mutant through a delivery. The handler's `deliveryHashLost` counter, which `invariant_deliveryHashStored` asserts is zero, reads 1, and the oracle fails the deal. T-336 measured the full campaign failing on the same mutant (its Evidence).
- **No hit on an illegal class:** `invariant_legalDealStates` passed 256 runs at depth 100 in three campaigns, with the deal bound at 8 and then 16.
- **Bytecode:** the reviewer measured the branch's `HoldbackRules` runtime code equal to the main checkout's, apart from the metadata hash. `git diff --quiet 64be1f1 -- contracts/foundry.toml` exits 0, so `deploy-sepolia.sh --check` sees unchanged build inputs.

## Decisions

- **Same addresses from one snapshot.** Each side is created from one state snapshot, so every contract lands at the same address on both sides. Calldata, IDs, signatures and events then compare byte for byte, with no translation. `PinnedSide.setUp` repeats `Base.setUp` line for line for that reason, and the harness checks the addresses before it compares.
- **One handler drives both sides.** The invariant handler runs in a trace mode on both sides, through the new source's ABI, so the sides receive identical calls. Trace mode returns instead of re-reverting `Refused()`, and records every checked call and every event. The campaign never sets it.
- **The copies' file names.** The two `HoldbackRules` copies are named `HoldbackRules.64be1f1.sol` and `HoldbackRules.planted.sol`, so `"HoldbackRules.sol:HoldbackRules"` lookups (`Vectors.t.sol`) find only `src/`. A test also pins that `src/` keeps the short artifact paths.
- **No `foundry.toml` change.** The first version granted a file read for a git-blob check; that broke `deploy-sepolia.sh --check` (review High 2). The pin now reads the compiler's source hashes from `./out`, which was already readable.
- **Gas metering.** The gate meters only the handler's actions (about 64M gas a sequence against the 1.07B limit). The coverage and planted tests run unmetered or with several seeds, and reuse memory between seeds.
- **The oracle follows T-340's table row for row:** L01 to L37 as exact rows, the time bounds of section 2, rule I15 for appeal bonds, the escrow amounts of section 5.1, and the exact seed tag. The table is a parameter, so the phase-one table (section 9) can sit beside it.
- **New handler action `appealPath`.** It files the losing party's appeal and usually has it decided; without it the appeal rows were seldom reached. It joins the campaign's 20 targets.
- **The deal bound is 16, up from 8** (plan, VG-2). Measured cost: the invariant campaign still passes in 17 to 27 s.
- **Price 0 is generated** in one offer in eight, because phase one keeps it legal (Rafa, 2026-11-11, relayed by the plan session).

## Handoff

**Done:** VG-1 and VG-2 run in `forge test`; review findings H1 to H3 are fixed, and Lows 8 and 9 too. Lower-priority finds are in `reports/scratch/t-341-triage.md` (Permit2 and boundary inputs, vault reads for all holders, the two meanings of row L32, contract wallets).

**How a session on `contracts-audit-ready` uses it:**

- **The new side** is `contracts/src/`, deployed by `Base.setUp`. Nothing to point: the branch's source is the new side. If a change alters `Base.setUp` (constructor arguments, creation order, no vault), keep `PinnedSide.setUp` in `test/differential/Sides.sol` creating the same contracts in the same order. The harness fails with "align PinnedSide.setUp" when the addresses differ.
- **Run:** `forge test --root <worktree>/contracts --match-path test/differential/SideBySide.t.sol`. Replay a failure with `SIDE_BY_SIDE_SEED=<seed> forge test --mt test_sideBySide_replay -vv`.
- **A behaviour change** adds entries to `test/differential/AllowList.sol`: one per exact difference, returning `Verdict(change, diverged)`. Set `diverged` when the sides now hold different state by design; the harness then stops comparing that seed. The header gives an example of each kind: an action gone, an input refused, an event no longer emitted. A refactor adds none.
- **When the ABI changes** (an action removed, a struct changed), update the handler for the new source. The old side is driven through the same handler, so only behaviour both builds share is compared.
- **The oracle's table** is `StateOracle.rows()`, the deployed machine. When the cuts change the word (SC-7, RF-4's closing reason), add section 9's table beside it and pass it to `check`.

**Pointing the old side at another commit** (needed from R6c on, when the signed terms change). The old side is whatever source sits under `test/differential/old/`. To compare against a parent commit `<sha>`:

1. Replace each `old/` file with `git show <sha>:contracts/src/<file>`. Keep the file names; `HoldbackRules.sol` becomes `HoldbackRules.64be1f1.sol` (or rename it, and its import in `Sides.sol`).
2. Rebuild, read each file's `keccak256` from `.metadata.sources` in its artifact, and update the constants in `PinnedSource.t.sol`.
3. Regenerate `planted/HoldbackRules.planted.sol` from the new `old/` copy (imports to `../old/`, the `deliveryHashOf[id] = dh;` line deleted), and update its pin.
4. Align `PinnedSide.setUp` with the parent's `Base.setUp`.

**Limit:** the two builds must share the handler's ABI. A change that changes the signed types, as R6c does, cannot be proven by this harness against its parent: every call differs. It needs its own tests. The changes after it compare against R6c's commit. A selectable old side, without re-vendoring, would need a second frozen copy for the planted mutant (another compile of the rules contract); it is not built.

**Open:** a review by a second model family before the freeze (VG-11, package R11).
