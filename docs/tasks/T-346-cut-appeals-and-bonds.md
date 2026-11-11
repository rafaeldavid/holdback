# T-346: phase one has no party appeals and no bonds (cut SC-7, package R6 part 1)

- **Lane:** settlement (contracts)
- **Phase:** 2
- **Depends on:** T-334 (the clean-up, merged to `contracts-audit-ready` at `b88f9e5`), T-341 (the side-by-side harness and the state oracle, holdback PR 333, merged to `main` at `67fde99`), T-342 (ADR-0031, the phase-one scope), T-340 (`docs/audit/state-model.md`)
- **Paths this task may touch:** `contracts/src/`; `contracts/test/` (tests of the removed feature, the new contract-signer and late-work tests, the harness's allow-list and handler for this change, the state oracle's phase-one rows); `contracts/script/` only where a removed contract requires it; `packages/core/src/` only for the SC-7 mirror; the simulator's SimChain-only exclusion list (`packages/testkit/src/runner.ts`, `LOCAL_EXCLUSIONS`); this task file. Never `apps/`, `examples/`, `site/`, `spec/schemas/`, `packages/settlement/`, `docs/audit/`
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress
- **Agent/session:** implementer session, change kind 7 (smart contracts): `forge test`, one reviewer and one red team before it lands, a target of 300k tokens

## Intent

In my own words: phase one's contracts settle a deal on the first decision of the primary or the fallback adjudicator, and nothing can reopen it. So the party appeal and the bond vault behind it leave the contracts. The appeal adjudicator stays, but only to decide a case that the primary or the fallback escalated. No signed type changes: the acceptance still signs `bondReserved`, and the contract now requires it to be 0, so every funded deal carries an acceptance that says what is true.

Inputs: the contracts on `contracts-audit-ready` after T-334, ADR-0031 section 8 (the list of what leaves and what stays) and section 10 (the events), the state model's section 9 (the phase-one rows).

Outputs: the smaller contracts; the tests of the removed feature deleted, each named below with its reason; new tests for contract wallets in every role and for the late-work settlement's key; the harness's list of allowed differences, naming every removed action and event and nothing else; the state oracle running with the phase-one rows; the SC-7 mirror in `packages/core`; the appeal and bond fixtures on the SimChain-only list.

Non-goals: no refactor beyond the cut (refinements go to `reports/scratch/t-346-triage.md`); no other scope cut (SC-1, SC-2, SC-3, SC-5 and SC-6 are package R5); no change to SimChain, which keeps appeals and bonds as the full protocol's reference; no signed type or schema change; nothing merged to `main`.

### What leaves, before it leaves

Line numbers are those of `contracts-audit-ready` at `b88f9e5` [measured].

`contracts/src/HoldbackRules.sol`:

| Kind | Item | Lines |
| --- | --- | --- |
| Function | `fileAppeal` | 497-512 |
| Function | `expireAppeal` | 567-586 |
| Function | `_appealDecision` | 366-382 |
| Function | `_releaseBonds`, and each of its 7 calls (`:319`, `:328`, `:339`, `:372`, `:412`, `:455`, `:583`, `:595`) | 649-652 |
| Branch | `decide`'s appeal decision on a `Released` or `Refunded` deal | 268-271, and the dispatch at 307 |
| Bond calls | `BONDS.encumber` at funding and at the fallback's decision | 217, 329 |
| Immutable | `BONDS`, and the vault's creation in the constructor | 75, 147 |
| Storage | `Deal.appeal`, `Deal.flags`, `Deal.t2`; the enum `AppealState` | 36-44, 50-51, 53 |
| Constants | `F_PRIMARY`, `F_FALLBACK`, `F_BY_FALLBACK`, `KEY_APPEAL` | 57-59, 65 |
| Error | `WrongAppealState` | 125 |
| Events | `AppealFiled`, `AppealClosed` | 118-119 |
| Writes | every `d.appeal = …` and `d.flags = …` (`:213`, `:320`, `:330`, `:332`, `:340`, `:342`, `:410-411`, `:453-454`, `:593-594`) | as listed |

`contracts/src/HoldbackTypes.sol`: the `Appeal` calldata struct (144-150), `APPEAL_TYPEHASH` (220-225) and `appealHash` (389-400).

`contracts/src/HoldbackBonds.sol`, the whole file: functions `deposit`, `withdraw`, `freeOf`, `encumber`, `release`, `slash`, `takeAppealBond`, `payAppealBond`; storage `RULES`, `bondOf`, `encumberedOf`, `appealBondOf`; errors `NotRules`, `InsufficientFreeBond`, `AppealBondTooLarge`, `AppealBondExists`; events `BondDeposited`, `BondWithdrawn`, `BondEncumbered`, `BondReleased`, `AppealBondHeld`, `AppealBondPaid`, `BondSlashed`.

**What changes and does not leave:** `agreeAndFund`'s check of the acceptance changes from `acc.bondReserved < t.price` to `acc.bondReserved != 0` (`:206`; ADR-0031 section 8, point 2). `dealOf` returns the smaller `Deal` (stage, attempt, `t1`, `seedTag`): an ABI change, not a signed-type change.

**What stays:** `decide` for the primary in `Delivered`, the fallback in `FallbackJudging` and the appeal adjudicator in `Escalated`; escalation; `triggerDefault` after an escalation; `timing.appealDecideSec`, in the escalation's deadline and the escrow's expiry; `ROLE_APPEAL` and the role string `"appeal"`; every other event; `Money` (its `requirement` loses its last caller, which the triage note records).

## Context

- ADR-0031 sections 8 and 10; D57.
- The contract refinement plan (crow-private `roadmap/plans/2026-11-11-contract-refinement.md`): section 2 (SC-7), section 3 (IS-1, IS-4, IS-11, IS-12, half of IS-3 and IS-7), section 6 (gates VG-1 to VG-6), section 7 (package R6).
- `docs/audit/state-model.md`: rows L11 to L30 and every vault column leave; section 9 is the phase-one machine.
- T-341's Handoff: how a change on this branch uses the harness.

## Acceptance criteria

- [ ] The task file is the branch's first commit, with the list above.
- [ ] Before any source change: the harness passes on the branch (main merged in) with an empty allow-list.
- [ ] Every item in the list above is gone from `contracts/src/`; `HoldbackBonds.sol` is deleted; nothing else in `contracts/src/` changes but the `bondReserved` check, the comments that name the removed items, and the `decide` lines that become dead with the appeal branch.
- [ ] `agreeAndFund` reverts with `InvalidMessage` on a nonzero `bondReserved`; a test failed before the change.
- [ ] No signed type changes: the type hashes and the hash vectors (`Vectors.t.sol`, `packages/core`'s vectors) are unchanged, and `spec/schemas/` is untouched.
- [ ] The harness's allow-list names every removed action and event and nothing else; the harness passes.
- [ ] The state oracle checks the phase-one rows after every step of the campaign.
- [ ] Tests: a contract wallet as the buyer, the seller and each adjudicator through every entry point; a wallet whose answer changes between two steps of one deal; a wallet that burns its gas; an account with delegated code (EIP-7702); a relay from inside another contract's call; the late-work settlement releases the key of the delivery it names, and no other.
- [ ] `forge test`, the anvil suites and `formal/check.sh`'s safety run pass on the branch.
- [ ] `HoldbackRules`' runtime size before and after, in bytes.
- [ ] No test or invariant is weakened; each deleted test is named below with its reason.

## Out of scope

- The off-chain second part of R6: the EVM adapter and `abis.json`, the operator's appeal routes and bond refusal, the reference adjudicator's appeal role and its `bondReserved`, the test agents, the `examples/e2e-*` appeal scenarios, the demo's appeal beat, `site/llms.txt`. The Handoff lists what each needs.
- `docs/audit/` (the state model, the known issues, the events inventory): the Handoff gives the lines.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **Gate before the cut** [measured]: holdback PR 333 merged at `67fde99`. On the lane with main merged in, `forge test` passed 343 of 343, and the side-by-side harness passed with an empty allow-list: 256 runs, every row L01 to L37 reached.
- **`forge test` after the cut** [measured]: 295 of 295 pass in 44 suites. Before: 343 of 343.
  - 59 test functions of the removed feature are deleted; `reports/scratch/t-346-deleted-tests.md` gives each one's file, name and reason. That table has 65 rows: 6 are tests moved to surviving files without their bond and appeal parts.
  - 13 tests are added: `PhaseOneNoBonds.t.sol` has 8, `LateWorkKey.t.sol` 5.
- **The `bondReserved` rule failed before** [measured]: `test_before_pinnedContractsRefuseZero_andFundWithThePriceAndWithMax` runs the pinned deployed contracts. They refuse `bondReserved` 0 and fund with the price; the cut does the opposite.
- **Side-by-side harness (VG-1)** [measured]: 258 fuzz runs pass. All 18 phase-one rows are reached over the 48 coverage seeds, and the planted mutant still fails the harness. The allow-list names nine exact differences, all SC-7's:
  1. no vault;
  2. `BONDS()` and `KEY_APPEAL()` gone;
  3. the word without `appeal`, `flags` and `t2`;
  4. the vault's events, token transfers to or from the vault, `AppealFiled`, `AppealClosed` and `KeyReleased` on path 3;
  5. no bond deposits;
  6. `fileAppeal` and `expireAppeal` gone;
  7. no appeal decision on a decided deal;
  8. no overturn payout, the only entry that diverges a seed;
  9. the appeal decision's `Decided` event.

  The first full run found entries 7 (for `decideFallback`) and 9 missing; both were added.
- **State oracle (VG-2)** [measured]: `invariant_legalDealStates` checks the phase-one rows (§9.3: P01 to P17, plus L02 until SC-6) after every step, 256 runs at depth 100. Its planted illegal states fail it.
- **Size (VG-5)** [measured, `forge build --sizes`]: `HoldbackRules` runtime goes from 24,299 to 19,609 bytes, so 4,690 bytes are freed and 4,967 bytes of headroom remain. Initcode goes from 27,769 to 20,190 bytes.
- **Signed types** [measured]: no file under `spec/schemas/` changes. Every type hash but `APPEAL_TYPEHASH` is unchanged, and `Vectors.t.sol`'s other 9 vectors pass unchanged, the acceptance with a nonzero `bondReserved` among them.
- **Core** [measured]: `vitest run packages/core` passes 978 of 978, 12 of them new (`phase_one profile`); `tsc` on core is clean.
- **Formal** [measured]: `formal/check.sh safety` passes, 132,339 distinct states at depth 31, in 15 s. The model is core's `full` profile, which is unchanged.
- **Anvil suites and `abis.test.ts`** [measured, expected red until T-349]: see the Handoff and `reports/scratch/t-346-for-part-2.md`.

## Decisions

- **Main came into the lane first, as its own PR** (holdback PR 343, `t-346-sync-main`). The lane predated the harness, and the harness must run against the branch before the cut. The merge had no file conflict, but two harness files still pointed `SimBeacon` at `src/`, which T-334 had moved to `script/` (`Sides.sol` and `PinnedSource.t.sol`); both are fixed on that PR.
- **Landing: option B** (the coordinator, 2026-11-11). This PR stays a draft until T-349's off-chain PR merges into this branch; then one merge into `contracts-audit-ready` carries both, so the lane never goes red.
- **The harness drives the deployed contracts through the phase-one handler.** Every choice an action makes rests on state both builds share. The pinned side overrides hooks for what differs: its seven-field word, its appeal state, `bondReserved` = price, and a funded vault. The vault holds 1,000 tUSD per adjudicator and token, so the old side never refuses for want of bond (a refusal phase one no longer has). The removed entry points stay as harness-only actions through the deployed selectors, with an appeal bond of 0, so the old side files, expires and decides appeals and the allow-list names each difference.
- **The oracle takes the closing reason from the handler** until refactor RF-4 stores it in the word. Without it, rows P06 to P12 collapse into two, and the primary's and the fallback's time bounds could no longer be told apart. With it, every §9.3 row keeps its bound.
- **Core's mirror is a profile, not a changed rule.** `step(s, e, 'phase_one')`; `'full'` stays the default for SimChain. A phase-one first decision gets an empty appeal window (`appealBy` = `appealDecideBy` = the decision's time), so core reports it final at once (ADR-0031 §8 point 7).
- **Three invariants leave with the vault**: `invariant_bondsNeverNegative`, `invariant_encumberedNotDoubleCounted`, `invariant_overturnPaysFromTheBond`. `invariant_noAdminPath` drops the vault's code hash. The handler's ghost counters `withdrawMismatch` and `overturnMispaid` go with them.
- **The contract-signer tests are a second PR on this branch.** The cut alone touches 48 files, with 1,481 lines added and 2,655 deleted [measured, `git diff --stat fb9ea77 HEAD`]. Adding the signer tests would make it too large to review as one change.

## Handoff

**State.** The cut is on branch `t-346-cut-appeals-and-bonds`, in draft PR 352 into `contracts-audit-ready`. That PR is stacked on PR 343, which brings main into the lane. It stays a draft until T-349 merges its off-chain mirrors into the branch; then the full CI should be green and one merge carries both.

**For T-349, the off-chain second part.** The full list is `reports/scratch/t-346-for-part-2.md`: 31 places, each with file and line, what it does today and what it must do after the cut, plus the measured failures. In short:
- **`packages/settlement/evm`:**
  - regenerate `abis.json`;
  - `world.ts:255`, `:267` and `:273` stop loading the vault and reading `BONDS()`;
  - `evm-settlement.ts:640-676` stops reading bonds, and `:974-991` steps core with `'phase_one'` and drops the coverage refusal;
  - the appeal mappings and calls at `evm-settlement.ts:308`, `:313`, `:1055`, `:1352` and `:2102-2128` go, and so does the appeal-expiry timeout in `timeouts.ts:80`;
  - `testing.ts:171` and `live.ts:706-718` sign 0 and deposit nothing;
  - the four-field `dealOf` in `sync.ts`.
- **`apps/adjudicator/src/service.ts`:** `:242` signs `bondReserved` 0; `:325` drops the coverage refusal; the appeal role hears escalations only.
- **`apps/operator`:**
  - `prepare.ts:51` refuses the appeal kind, and `:417-430` drops `fallbackBondRefusal` (ADR-0031 §8 point 6);
  - the acceptance prepares 0;
  - `registry.ts:90` reads no vault;
  - `server.ts` refuses the appeal routes and the appeal-expiry trigger.
- **`apps/demo-cloud/src/world.ts`:** `:116`, `:357-364`, `:654-671` and `:982`, with no deposit and no bond reads; its anvil tests follow.
- **`examples/`:** the `e2e-*` party-appeal scenarios leave the EVM path; `deployments.ts` and `verify.ts` read no `bonds`.
- **The demo's appeal beat** and **`site/llms.txt`** change at the redeploy (ADR-0031 appendix).

Measured: the anvil settlement leg fails 10 of 13 files and the world leg 6 of 7, all first at `packages/settlement/evm/world.ts:267` (`BONDS` not on the ABI); `abis.test.ts` fails with 54 against 47 ABI entries.

**For the docs package (`docs/audit/`, not this task's paths):**
- `state-model.md`: §9 describes the cut as built. Add that the word is now (stage, attempt, t1, seedTag), and that rows P06 to P12 are told apart by the closing reason, which the oracle takes from the handler until RF-4.
- `known-issues.md`: move L-3, L-5, T-221's bond refusal, the rest of I-8, A-1, A-2, A-3 and the limit on H-2 (and L-2) to "not in phase one", with the wording in T-342's Handoff.
- `events.md`: the nine events leave (ADR-0031 §10).
- `scope.md`: `HoldbackBonds.sol` leaves the audit's scope; `HoldbackRules` is 19,609 runtime bytes.
- `threat-model.md`: TA-13 holds as built; there is no bond on chain.

**Not done in this PR:** the contract-signer tests for every role, a second PR on this branch. Specifically:
- the buyer and the seller as wallets through early accept and settlement;
- the appeal adjudicator as a wallet on an escalation;
- a wallet whose answer changes between two steps;
- a wallet that burns its gas;
- an EIP-7702 account;
- a relay from inside another contract's call, for every entry point.

`Erc1271Roles.t.sol`, `Erc1271Replay.t.sol` and `Erc6492Prepare.t.sol` already cover the seller, the primary, the fallback and the buyer's funding.

**Refinements left alone:** `reports/scratch/t-346-triage.md`.
