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

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

- **Main came into the lane first, as its own PR** (holdback PR 343, `t-346-sync-main`). The lane predated the harness, and the harness must run against the branch before the cut. The merge had no file conflict; one import of the harness (`Sides.sol`) still named `src/SimBeacon.sol`, which T-334 moved to `script/`.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
