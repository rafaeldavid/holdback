# T-346: phase one has no party appeals and no bonds (cut SC-7, package R6 part 1)

- **Lane:** settlement (contracts)
- **Phase:** 2
- **Depends on:** T-334 (the clean-up, merged to `contracts-audit-ready` at `b88f9e5`), T-341 (the side-by-side harness and the state oracle, holdback PR 333, merged to `main` at `67fde99`), T-342 (ADR-0031, the phase-one scope), T-340 (`docs/audit/state-model.md`)
- **Paths this task may touch:** `contracts/src/`; `contracts/test/` (tests of the removed feature, the new contract-signer and late-work tests, the harness's allow-list and handler for this change, the state oracle's phase-one rows); `contracts/script/` only where a removed contract requires it; `packages/core/src/` only for the SC-7 mirror; the simulator's SimChain-only exclusion list (`packages/testkit/src/runner.ts`, `LOCAL_EXCLUSIONS`); this task file. Never `apps/`, `examples/`, `site/`, `spec/schemas/`, `packages/settlement/`, `docs/audit/`
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** done (2026-11-13): merged to contracts-audit-ready, in `main` through PR 475 (`27ab44e`), and live on Sepolia since the phase-one cutover of 2026-11-13
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

- [x] The task file is the branch's first commit, with the list above.
- [x] Before any source change: the harness passes on the branch (main merged in) with an empty allow-list.
- [x] Every item in the list above is gone from `contracts/src/`; `HoldbackBonds.sol` is deleted; nothing else in `contracts/src/` changes but the `bondReserved` check, the comments that name the removed items, and the `decide` lines that become dead with the appeal branch.
- [x] `agreeAndFund` reverts with `InvalidMessage` on a nonzero `bondReserved`; a test failed before the change.
- [x] No signed type changes: the type hashes and the hash vectors (`Vectors.t.sol`, `packages/core`'s vectors) are unchanged, and `spec/schemas/` is untouched.
- [x] The harness's allow-list names every removed action and event and nothing else; the harness passes.
- [x] The state oracle checks the phase-one rows after every step of the campaign.
- [x] Tests: a contract wallet as the buyer, the seller and each adjudicator through every entry point; a wallet whose answer changes between two steps of one deal; a wallet that burns its gas; an account with delegated code (EIP-7702); a relay from inside another contract's call (second PR, holdback PR 357, merged into this branch: 39 tests); the late-work settlement releases the key of the delivery it names, and no other.
- [ ] `forge test`, the anvil suites and `formal/check.sh`'s safety run pass on the branch. `forge test` and the safety run pass; the anvil suites pass only once T-349 lands.
- [x] `HoldbackRules`' runtime size before and after, in bytes.
- [x] No test or invariant is weakened; each deleted test is named below with its reason.

## Out of scope

- The off-chain second part of R6: the EVM adapter and `abis.json`, the operator's appeal routes and bond refusal, the reference adjudicator's appeal role and its `bondReserved`, the test agents, the `examples/e2e-*` appeal scenarios, the demo's appeal beat, `site/llms.txt`. The Handoff lists what each needs.
- `docs/audit/` (the state model, the known issues, the events inventory): the Handoff gives the lines.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **Gate before the cut** [measured]: holdback PR 333 merged at `67fde99`. On the lane with main merged in, `forge test` passed 343 of 343, and the side-by-side harness passed with an empty allow-list: 256 runs, every row L01 to L37 reached.
- **`forge test` after the cut** [measured]: 296 of 296 pass in 44 suites. Before: 343 of 343. The appendix names every test removed, moved or renamed, with its reason.
- **`forge test` at the branch head** [measured, after `forge clean`]: 353 of 353 pass in 51 suites. That is the cut's 296, the red team's 14, the 4 that main's `DrandSecondRead.t.sol` brings with the second sync, and the 39 contract-signer tests.
- **Contract signers (PR 357, merged into this branch)** [measured, by the session that wrote them and its reviewer]. 39 tests in 5 files under `contracts/test/crosscheck/`; no defect found.
  - The buyer, the seller and the appeal adjudicator as wallets, through early accept, settlement and an escalation.
  - A wallet whose answer changes blocks only its own next step, and the deal ends by its timeouts.
  - A gas-burning wallet is refused with `BadSignature`; the relayer pays about 98.5% of its gas limit.
  - Solady checks a delegated EIP-7702 account by ERC-1271 alone (`extcodesize` picks one check), the M-4 behaviour.
  - Each of the nine entry points relayed from inside another contract lands exactly as a direct relay.

  Reviewer: ISSUES, Low and Info only; the four Lows are fixed. The red team's suggestion to check a plain-key signature before ERC-1271 (ADR-0031, finding M-4) is not adopted. It would change how every signature is checked, and it would make code that answers for a session key unable to override its own key. The tests pin today's behaviour, so a later decision can change it on purpose.
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
- **Size (VG-5)** [measured, `forge build --sizes` on `contracts/src` alone, at `65e734d` and at the head]: `HoldbackRules` runtime goes from 24,232 to 19,609 bytes, so 4,623 bytes are freed. Headroom under EIP-170 goes from 344 to 4,967 bytes. Initcode goes from 27,702 to 20,190 bytes, 7,512 bytes less. (A first reading of 24,299 bytes came from a full build, which also compiles the pinned old copy under `test/differential/old/`; the reviewer caught it.)
- **Signed types** [measured]: no file under `spec/schemas/` changes. Every type hash but `APPEAL_TYPEHASH` is unchanged, and `Vectors.t.sol`'s other 9 vectors pass unchanged, the acceptance with a nonzero `bondReserved` among them.
- **Core** [measured]: `vitest run packages/core` passes 978 of 978, 12 of them new (`phase_one profile`); `tsc` on core is clean.
- **Formal** [measured]: `formal/check.sh safety` passes, 132,339 distinct states at depth 31, in 15 s. The model is core's `full` profile, which is unchanged.
- **Anvil suites and `abis.test.ts`** [measured, expected red until T-349]: see the Handoff and `reports/scratch/t-346-for-part-2.md`.
- **The fixtures ADR-0031 §8 point 5 asks to be checked by their steps** [measured, by reading each file]:
  - `error.appeal-decision-other-attempt`, `attack.forced-stride-appeal-default`, `attack.injection-filter-abstain-appeal-default` and `attack.injection-splits-appeal-to-default` stay in the comparison. Each escalates to the appeal adjudicator and has no party-appeal step; the last three end in a default or a refusal of one, and expect the seller paid 0.
  - `neutrality.store-withholds-reference` moves to the SimChain-only list: its SimChain default pays the seller 2,000 tUSD from two bonds.
  - `error.early-accept-wrong-key-envelope` moves too: it has a party-appeal step.
- **Review** [measured, by the reviewer]: ISSUES. 3 Medium, 2 Low and 4 Info; no defect in `contracts/src/`. Fixed in this PR:
  - the oracle's escalation bound, now the later of `judgeBy` and `fallbackBy`, with a test;
  - the missing evidence and test table, now this file;
  - the allow-list's header, now backed by one gate before every entry;
  - the size figures.

  Answered in the Handoff: the contract-signer tests are a second PR on this branch, and the bisect boundary is stated. The full report is `reports/scratch/t-346-review.md`.
- **Red team** [measured, by the red team]: no Critical, High or Medium. To its three questions:
  1. No funded deal gets stuck. Every open stage keeps an exit anyone can call once its deadline passes, and the latest capture lands before the escrow's expiry.
  2. Neither held funds nor the buyer's key move outside the signed terms. A decision on a Refunded deal now reverts `WrongStage` before the key rule the cut removed would have been reached.
  3. No state that §9.3 calls illegal is reachable [inferred from every write].

  Its 14 tests are kept in `contracts/test/attack/PhaseOneRedTeam.t.sol`. `test_attack_*` and `test_neutrality_*` pass while the defence holds; `test_issue_*` pass while the weakness is present. Its findings:
  - **RT-1, Low:** the word does not record who decided or why the deal closed. P06 against P10, and P11 against P12, can leave identical words. This is refactor RF-4's (package R7); the oracle reads the reason from the handler until then.
  - **RT-2, Info:** an escalation's decision may carry any `appealGround`; only the first instance checks it. This is state-model §8.3 verdict 8, a behaviour change for R8.
  - **RT-3, Low, off chain:** core's `phase_one` writes appeal `none` with `appealBy` = the decision's time, which other code reads as "an appeal expiry is due now". Raised with T-349 before it codes against it; see the Handoff.
  - **RT-4, Info:** `Money.requirement`, `payout` and `split` have no caller in `src`. In the triage note.
  - **RT-5, Info:** no deal goes through the operators on the cut contracts until T-349 lands. Do not redeploy before it.
  - **RT-6, Info:** three `neutrality.*` fixtures run only on SimChain now; the red team's `test_neutrality_*` tests cover offline adjudicators at the contract level.

  The full report is `reports/scratch/t-346-red-team.md`.

## Decisions

- **Main came into the lane first, as its own PR** (holdback PR 343, `t-346-sync-main`). The lane predated the harness, and the harness must run against the branch before the cut. The merge had no file conflict, but two harness files still pointed `SimBeacon` at `src/`, which T-334 had moved to `script/` (`Sides.sol` and `PinnedSource.t.sol`); both are fixed on that PR.
- **Landing: option B** (the coordinator, 2026-11-11). This PR stays a draft until T-349's off-chain PR merges into this branch; then one merge into `contracts-audit-ready` carries both, so the lane never goes red.
- **The harness drives the deployed contracts through the phase-one handler.** Every choice an action makes rests on state both builds share. The pinned side overrides hooks for what differs: its seven-field word, its appeal state, `bondReserved` = price, and a funded vault. The vault holds 1,000 tUSD per adjudicator and token, so the old side never refuses for want of bond (a refusal phase one no longer has). The removed entry points stay as harness-only actions through the deployed selectors, with an appeal bond of 0, so the old side files, expires and decides appeals and the allow-list names each difference.
- **The oracle takes the closing reason from the handler** until refactor RF-4 stores it in the word. Without it, rows P06 to P12 collapse into two, and the primary's and the fallback's time bounds could no longer be told apart. With it, every §9.3 row keeps its bound.
- **Core's mirror is a profile, not a changed rule.** `step(s, e, 'phase_one')`; `'full'` stays the default for SimChain. A phase-one first decision gets an empty appeal window (`appealBy` = `appealDecideBy` = the decision's time), so core reports it final at once (ADR-0031 §8 point 7).
- **Three invariants leave with the vault**: `invariant_bondsNeverNegative`, `invariant_encumberedNotDoubleCounted`, `invariant_overturnPaysFromTheBond`. `invariant_noAdminPath` drops the vault's code hash. The handler's ghost counters `withdrawMismatch` and `overturnMispaid` go with them.
- **The contract-signer tests are a second PR on this branch.** The cut alone touches 48 files, with 1,481 lines added and 2,655 deleted [measured, `git diff --stat fb9ea77 HEAD`]. Adding the signer tests would make it too large to review as one change.

## Handoff

**State.** PR 352 merges the cut, the contract-signer tests (PR 357) and T-349's off-chain mirrors (PR 361, merged into this branch at `9cb7f3a`) into `contracts-audit-ready` in one merge. PR 343 had already brought main into the lane. On PR 361's final head, all 12 CI jobs passed, both anvil legs included [measured by T-349]. Nothing is on `main`.

**For the freeze (Rafa's).**
- **Redeploy before this build runs anywhere.** T-349's off-chain code has no guard against the deployed contracts, which still have appeals and the vault (T-349's review finding 2, `docs/tasks/T-349-cut-appeals-off-chain.md`, Handoff). The reverse holds too: the deployed operators cannot settle a deal on the cut contracts (red team RT-5).
- **The sentence in `CLAUDE.md`'s litmus test 3** that sets the bonded appeal aside for phase one is Rafa's (ADR-0031, "What waits on Rafa").

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

**Red-team finding RT-3, settled with T-349: option (b).** Core's first phase-one decision wrote appeal `{kind:'none', appealBy: at, appealDecideBy: at}`. `packages/settlement/evm/timeouts.ts:126` and the same check at `simchain-adapter.ts:230`, `_sim.ts:370`, `evm-settlement.ts:1658`, `:2579`, `:2626`, `:2677` and `demo-cloud/src/world.ts:503` would read that as an appeal expiry due now. Core now writes `{kind:'expired', appeal: null}` at the decision instead. T-349's EVM view reports `appealState: none` and `finalAt` = `settledAt` for every closed deal, so the API serves what ADR-0031 §8 point 7 says. T-349 also drops the appeal-expiry timeout on EVM and no longer decodes `dealOf`'s appeal fields.

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

**The cut-feature known list (T-354), for every later merge into the lane.** `tests/cut-feature-alignment.known.json` lists the files that still name a cut feature.
- **A sync from main makes it grow,** because main keeps the full machine on purpose. The sync in PR 343 added 6 entries: `docs/audit/events.md`, `invariants.md`, `known-issues.md`, `state-model.md` and `threat-model.md` (owner docs/audit, R12), and `examples/deal-record.ts` (owner examples/, R6c-3, package 3).
- **A package that fixes files makes it shrink.** When this cut and T-349 land, the entries for the files they fixed leave.
- **Who merges regenerates it** and checks the diff adds or removes only the files the merge brought in or fixed. On a worktree of the merged tree, with the workspace installed:

  ```
  pnpm -C <worktree> exec vitest run tests/cut-feature-alignment.test.ts -u
  ```

  Then `git -C <worktree> diff tests/cut-feature-alignment.known.json`. Stop and ask if anything else is removed or reordered.

**Bisecting:** the cut's commits build again only from `0564fe8`. `fcc4072` deletes `HoldbackBonds.sol` while the tests still import it, until `eec6909` and `2aa8d4a`. The branch is pushed, so it is not squashed: a force push is a gate. Bisect at `0564fe8` or later.

## Appendix: every test removed, moved or renamed

Counted on this branch: `forge test` ran 343 tests at `65e734d` (the lane with main merged in) and 296 at the head [measured]. Phase one has no party appeal and no bond vault (SC-7, ADR-0031 §8). In the unit, crosscheck and fuzz suites, 59 test functions leave and 6 move. In the handler, harness and oracle suites, 3 invariants leave. 15 tests are added: 8 in `PhaseOneNoBonds.t.sol`, 5 in `LateWorkKey.t.sol` and 2 in `StateOracle.t.sol` (the fallback's decision rows and the escalation bound). 343 − 62 + 15 = 296. The other changes are renames, below. Paths are relative to `contracts/test/`.

### Removed or moved

| File | Test function | Reason |
| --- | --- | --- |
| invariant/RulesInvariants.t.sol | invariant_bondsNeverNegative | the vault's totals cover its encumbrance and appeal bonds; removed with the vault (SC-7) |
| invariant/RulesInvariants.t.sol | invariant_encumberedNotDoubleCounted | the vault's encumbrance equals the deals' flags; removed with the vault and the flags (SC-7) |
| invariant/RulesInvariants.t.sol | invariant_overturnPaysFromTheBond | an overturn pays from the first decider's bond; removed with the appeal decision and the vault (SC-7) |
| crosscheck/AppealSlot.t.sol | test_defense_winnerCannotTakeTheSlot_loserAppeals | who may take the single appeal slot; removed with fileAppeal (SC-7) |
| crosscheck/AppealSlot.t.sol | test_defense_afterReject_refundedBuyerCannotBlockTheSeller | who may take the single appeal slot; removed with fileAppeal (SC-7) |
| crosscheck/AppealSlot.t.sol | test_residual_loserZeroBondAppealExtendsTheDecidersLock | a zero-bond appeal holding the decider's bond; removed with fileAppeal, expireAppeal and the vault (SC-7) |
| unit/BondConsent.t.sol | test_shamDeal_triggerFallbackReservesNothing | a takeover reserves no fallback bond; removed with the vault (SC-7) |
| unit/BondConsent.t.sol | test_shamEscalation_reservesNothingForTheAppealAdjudicator | an escalation reserves no appeal bond; removed with the vault (SC-7) |
| unit/BondConsent.t.sol | test_fallbackDecision_reservesItsBondUntilTheAppealCloses | the fallback's reservation and its release by expireAppeal; removed with the vault and expireAppeal (SC-7) |
| unit/BondConsent.t.sol | test_uncoveredFallback_cannotDecide_dealDefaults | a fallback without free bond cannot decide; removed with the vault (SC-7). The default refund stays in Timeouts.t.sol `test_default_fromFallbackJudging_inOneCall` |
| unit/BondConsent.t.sol | test_uncoveredFallback_mayEscalate | moved: now Decide.t.sol `test_fallback_mayEscalate`, without the bond withdrawal and the bond assertion |
| unit/BondConsent.t.sol | test_samePrimaryAndFallback_fullyBooked_decidesWithOneReservation | moved: now Decide.t.sol `test_fallback_sameAddressAsPrimary_decides`, without the bond netting and the flags assertion |
| unit/BondsReentrancy.t.sol | test_defense_deposit_reentered_on_pull_credits_each_pull_once | reentrancy into the vault's deposit; removed with the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_withdraw_inside_deposit_pull_takes_nothing_extra | reentrancy into the vault's withdraw; removed with the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_withdraw_reentered_on_payout_cannot_withdraw_twice | reentrancy into the vault's withdraw; removed with the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_withdraw_reentered_on_payout_cannot_reach_encumbered_bond | the vault's encumbered balance under reentrancy; removed with the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_reentry_cannot_call_rules_only_functions | the vault's rules-only functions; removed with the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_fee_payout_reentry_cannot_free_the_deciders_bond | a vault withdrawal from the fee payout's callback; removed with the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_appeal_bond_pull_reentry_cannot_file_twice | reentrancy into fileAppeal through the appeal bond pull; removed with fileAppeal and the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_appeal_bond_refund_reentry_cannot_refund_twice | reentrancy into expireAppeal through the appeal bond refund; removed with expireAppeal and the vault (SC-7) |
| unit/BondsReentrancy.t.sol | test_defense_slash_payee_reentry_slashes_once | reentrancy through the overturn slash; removed with the appeal decision and the vault (SC-7) |
| unit/CppReclaimStrandsBonds.t.sol | test_regression_cpp_reclaim_in_held_strands_primary_bond | moved: now AfterCppReclaim.t.sol `test_regression_cppReclaimInHeld_rulesReclaimClosesTheDeal`, without the bond assertions and the bond withdrawal |
| unit/CppReclaimStrandsBonds.t.sol | test_regression_cpp_reclaim_in_fallbackJudging_strands_two_bonds | moved: now AfterCppReclaim.t.sol `test_regression_cppReclaimInFallbackJudging_defaultClosesTheDeal`, without the bond assertions |
| unit/CppReclaimStrandsBonds.t.sol | test_attack_d31_deadlines_after_expiry_leave_seller_unpaid | moved: now AfterCppReclaim.t.sol, same name, without the bond assertions |
| unit/OverturnKeyRelease.t.sol | test_regression_overturned_reject_releases_key_without_paying_seller | the key and the payout on an overturning party appeal; removed with fileAppeal and the appeal decision (SC-7) |
| unit/OverturnKeyRelease.t.sol | test_attack_zero_bond_appeal_accepted_without_allowance | a zero-bond party appeal; removed with fileAppeal and expireAppeal (SC-7) |
| unit/OverturnKeyRelease.t.sol | test_attack_free_appeal_wins_the_price_from_the_bond | a free party appeal winning the price from the bond (L-3); removed with fileAppeal and the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_overturnedAccept_paysTheBuyerThePriceFromThePrimarysBond | the overturn payout from the primary's bond; removed with the appeal decision and the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_overturnedReject_paysTheSellerThePriceFromThePrimarysBond | the overturn payout from the primary's bond; removed with the appeal decision and the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_overturnedFallbackDecision_paysFromTheFallbacksBond | the overturn payout from the fallback's bond; removed with the appeal decision and the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_upheldAppeal_paysNothingFromTheBond | an upheld party appeal; removed with the appeal decision and the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_afterAnOverturn_theAdjudicatorWithdrawsOnlyTheRest | a bond withdrawal after a slash; removed with the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_undecidedAppeal_expiresWithoutAPayout | expireAppeal on an open appeal; removed with expireAppeal (SC-7) |
| unit/OverturnPayout.t.sol | test_slash_onlyTheRulesContract | the vault's slash guard; removed with the vault (SC-7) |
| unit/OverturnPayout.t.sol | test_favouredSeller_cannotAppealAnAccept | fileAppeal's appellant rule; removed with fileAppeal (SC-7) |
| unit/OverturnPayout.t.sol | test_favouredBuyer_cannotAppealAReject | fileAppeal's appellant rule; removed with fileAppeal (SC-7) |
| unit/UnbondedDecider.t.sol | test_regression_fallback_decides_with_no_bond_at_stake | an unbonded fallback cannot decide; removed with the vault (SC-7). The default refund stays in Timeouts.t.sol |
| unit/UnbondedDecider.t.sol | test_attack_appeal_adjudicator_decides_escalation_with_no_bond_at_stake | the appeal adjudicator's missing bond (L-5); removed with the vault (SC-7). The escalation decision and its fee stay in Decide.t.sol `test_escalate_movesNoMoney_thenAppealAdjudicatorDecides` |
| unit/UnbondedDecider.t.sol | test_attack_party_appeal_adjudicator_has_nothing_at_stake | the appeal adjudicator's missing bond on a party appeal; removed with fileAppeal and the vault (SC-7) |
| unit/AppealAttempt.t.sol | test_afterPartyAppeal_refusesASeedFromAnotherAttempt | the attempt binding on a party appeal; removed with fileAppeal (SC-7). The escalation case stays |
| unit/AppealAttempt.t.sol | test_afterPartyAppeal_decidesWithTheDeliveryAttempt | a party-appeal decision; removed with fileAppeal and the appeal decision (SC-7). The escalation case stays |
| unit/AppealKey.t.sol | test_overturnedReject_refusesAKeyForTheRefundedBuyer | the key rule on a party appeal against a reject; removed with fileAppeal (SC-7). A decision on a Refunded deal now reverts WrongStage (PhaseOneNoBonds.t.sol) |
| unit/AppealKey.t.sol | test_overturnedReject_withoutTheKey_settles | an overturning party appeal; removed with fileAppeal and the appeal decision (SC-7) |
| unit/AppealKey.t.sol | test_upheldReject_refusesAKey | the key rule on a party appeal; removed with fileAppeal (SC-7) |
| unit/AppealKey.t.sol | test_overturnedAccept_refusesAKey | the key rule on a party appeal; removed with fileAppeal (SC-7) |
| unit/AppealKey.t.sol | test_upheldAccept_releasesTheKey | KEY_APPEAL's release on an upheld party appeal; removed with fileAppeal and KEY_APPEAL (SC-7) |
| unit/AppealSeedAttempt.t.sol | test_regression_party_appeal_attempt_changes_seed | the attempt binding on a party appeal; removed with fileAppeal (SC-7). The escalation regressions stay |
| unit/Timeouts.t.sol | test_appealExpiry_releasesTheDecidersBond | expireAppeal after the appeal window; removed with expireAppeal (SC-7) |
| unit/Timeouts.t.sol | test_appealExpiry_openAppealUndecided_returnsTheBond | expireAppeal on an open appeal; removed with fileAppeal and expireAppeal (SC-7) |
| unit/Timeouts.t.sol | test_withdraw_onlyWhatIsFree | the vault's withdraw; removed with the vault (SC-7) |
| unit/Timeouts.t.sol | test_withdraw_afterSettlementReleasesTheBond | the vault's withdraw after a reclaim; removed with the vault (SC-7). The reclaim refund stays in `test_reclaim_refundsPricePlusFee` |
| unit/Timeouts.t.sol | test_onlyRulesEncumbers | the vault's rules-only guard; removed with the vault (SC-7) |
| unit/Timeouts.t.sol | test_deposit_creditsTheCaller | the vault's deposit; removed with the vault (SC-7) |
| unit/Timeouts.t.sol | test_deposit_refusesWithoutTheTokens | the vault's deposit; removed with the vault (SC-7) |
| unit/Settle.t.sol | test_file_holdsTheBond | fileAppeal's appeal bond; removed with fileAppeal and the vault (SC-7) |
| unit/Settle.t.sol | test_file_refusesAnotherSigner | fileAppeal's signature check; removed with fileAppeal (SC-7) |
| unit/Settle.t.sol | test_file_refusesAfterAppealBy | the appeal filing window; removed with fileAppeal (SC-7) |
| unit/Settle.t.sol | test_file_refusesASecondAppeal | fileAppeal's one-appeal rule; removed with fileAppeal and WrongAppealState (SC-7) |
| unit/Settle.t.sol | test_upheld_bondGoesToTheFirstAdjudicatorsBond | an upheld party appeal's bond; removed with the appeal decision and the vault (SC-7) |
| unit/Settle.t.sol | test_overturned_bondBackToAppellant | an overturning party appeal's bonds; removed with the appeal decision and the vault (SC-7) |
| unit/Settle.t.sol | test_appealDecision_refusesAnotherSigner | moved: the appeal adjudicator's signature check after an escalation is now Decide.t.sol `test_escalated_refusesAnotherSigner` |
| unit/UntestedReverts.t.sol | test_refuses_appealBondAboveUint96 | the vault's AppealBondTooLarge; removed with fileAppeal and the vault (SC-7) |
| unit/UntestedReverts.t.sol | test_refuses_secondAppealBondForOneCommitment | the vault's AppealBondExists; removed with the vault (SC-7) |
| unit/Vectors.t.sol | test_appeal_matchesCore | the contract's appealHash against core's vector; removed with appealHash (SC-7). packages/core and spec/ keep the vector |
| unit/AgreeAndFund.t.sol | test_refuses_primaryWithoutFreeBond | the primary's bond encumbrance at funding; removed with the vault (SC-7) |
| unit/DeliveryBinding.t.sol | test_everyRoleNamesThePostedDelivery_partyAppeal | the delivery a party-appeal decision names; removed with fileAppeal and the appeal decision (SC-7). The escalation case stays |
| crosscheck/TokenAndDomain.t.sol | test_defense_depositInATokenWithNoCode_reverts | a bond deposit in a token with no code; removed with the vault (SC-7) |
| crosscheck/DrandRedTeam.t.sol | test_issue_wrongRound_appellantFilesOnlyWhenTheAppealSeedSuitsIt | seed grinding through fileAppeal; removed with fileAppeal (SC-7). The escalation variant stays |

### Renamed or split in place

| File | Before | After |
| --- | --- | --- |
| unit/AgreeAndFund.t.sol | test_erc3009_holdsPricePlusFee_andEncumbersThePrimary | test_erc3009_holdsPricePlusFee |
| unit/AgreeAndFund.t.sol | test_refuses_bondReservedBelowPrice | test_refuses_bondReservedNonzero_belowPrice |
| unit/AfterCppReclaim.t.sol | test_held_reclaimReleasesThePrimaryBond | test_held_reclaimClosesTheDeal |
| unit/AfterCppReclaim.t.sol | test_delivered_fallbackThenDefaultReleasesBothBonds | test_delivered_fallbackThenDefaultClosesTheDeal |
| unit/AfterCppReclaim.t.sol | test_deliverByAfterExpiry_reclaimStillReleasesThePrimaryBond | test_deliverByAfterExpiry_reclaimStillClosesTheDeal |
| crosscheck/Erc1271Roles.t.sol | test_primaryWallet_acceptsAndDecides_bondAndFee | test_primaryWallet_acceptsAndDecides_fee |
| crosscheck/Erc1271Roles.t.sol | test_fallbackWallet_decidesAfterTakeover_andReservesItsBond | test_fallbackWallet_decidesAfterTakeover |
| invariant/HandlerSmoke.t.sol | test_offer_fund_deliver_decide_appeal_decide | test_offer_fund_deliver_decide_isFinal: the decision is final; a later decision, an appeal filing and an appeal expiry are refused |
| invariant/HandlerSmoke.t.sol | test_decide_carriesDelivery_thenAppealExpires | test_decide_carriesDelivery: the appeal expiry left |
| invariant/HandlerSmoke.t.sol | test_bonds_and_warp | test_warp: the bond actions left with the vault |
| invariant/StateOracle.t.sol | test_legalPaths_decisionAndAppeal | test_legalPaths_primaryDecision (P01 to P07), with the new test_legalPaths_fallbackDecision (P08, P09) beside it |
| invariant/StateOracle.t.sol | test_legalPaths_settlementAndExpiries | test_legalPaths_settlementAndExpiry (P15 to P17, L02): the appeal expiry left |
