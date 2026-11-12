# T-384: the names, then the comments for the auditor (package R9)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-380 (package R8, last pull request 426, lane tip `73bbafa`), T-375 (package R7: the values R9 names), T-341 and T-356 (the side-by-side harness)
- **Paths this task may touch:** `contracts/src/*`, the new `contracts/src/IHoldbackRules.sol` included; `contracts/test/*` for the renames and for what the layout requires; `packages/settlement/evm/abis.json` when the build regenerates it; this task file. Lines in `contracts/script/` (T-383) or `contracts/scripts/mutants.json` (T-352) go to their owners through the coordinator
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress (pull request 1 in review)
- **Agent/session:** implementer session, change kind 7 (smart contracts); one reviewer subagent per pull request

## Intent

In my own words: the phase-one contracts go to an auditor on testnet, and today almost nothing in them says what each function takes, returns or refuses. This task gives the auditor two things, in two pull requests into `contracts-audit-ready`.

1. **The names (pull request 1).** A named check for a valid outcome that tests membership instead of the constants' numeric order (RF-5, IS-9); a named constant for the one delivery attempt; the three test files named "Appeal…" that test the escalation case become "Escalation…" (item 51); the last dead description of the key rule goes (item 52). The interface layout lands here too: a new `IHoldbackRules.sol` holds every declaration of the rules contract (functions, events, errors, the enums and the `Deal` struct), so the mutation run (T-352) and the two reviews (R11) start on the final layout and the final test files.
2. **The descriptions (pull request 2).** NatSpec for every function, event, error, struct, enum and stored field of the phase-one source, in the interface where it can go there, with a short map for the auditor at its head: the stages, the outcomes, the deadlines in order, where the money moves. The code is right where a comment disagrees; a place where the code looks wrong is reported, not changed.

Non-goals: no behaviour change; no change to a signed type, the signing domain or `spec/schemas/`; no rename of the decider value `Appeal` or of any signed field; no event removed; no check removed; no edit in `contracts/script/`, `docs/` or another session's paths.

## Context

- The refinement plan (private): section 4, rows RF-5 and RF-7; section 7, row R9; section 7d, "R9, NatSpec and names", items 51 and 52, and Rafa's decisions of 2026-11-12 on the order and the place.
- `docs/tasks/T-375-refactors-r7.md`, Handoff: RF-5's values.
- ADR-0031 (phase one's scope; "the appeal adjudicator, which in phase one hears escalations only"), ADR-0032 (the beacon margin), ADR-0033 (the two money addresses).
- `docs/audit/state-model.md`, `docs/audit/threat-model.md`.

## Acceptance criteria

- [ ] Pull request 1: `IHoldbackRules.sol` declares every external and public function of `HoldbackRules`, every event, every error, `Stage`, `Reason`, `Decider` and `Deal`; `HoldbackRules is EIP712, IHoldbackRules`.
- [ ] Pull request 1: `H.isValidOutcome(role, outcome)` replaces the numeric-order bound in `decide`, and a test over every role and outcome byte shows it accepts exactly what the old rule accepted.
- [ ] Pull request 1: `ONLY_ATTEMPT` names the one delivery attempt; the three "Appeal…" test files are "Escalation…"; `AppealKey.t.sol`'s header loses the rule no path reaches.
- [ ] Pull request 1: the test edits the layout needs are mechanical (the qualifier and one import line) and counted; the runtime code is identical to the parent's except for the outcome check, shown by one build without it; the full kind 7 recipe passes, the side-by-side harness with an empty allow list.
- [ ] Pull request 2: every external and public function, event and error, every struct, enum and stored field of the phase-one source is described; the runtime code is identical before and after, with both hashes recorded, and the ABI unchanged.
- [ ] Each pull request has one reviewer who checks the descriptions against the code and against phase one; every inaccuracy found is fixed.

## Out of scope

- The docs that cite moved lines or the renamed test files (T-385); the deploy script (T-383); the mutation run's file list (T-352).
- The stage predicates and the role-to-decider helper T-375 listed: each changes the runtime code (measured below) and adds nothing an auditor needs that a description does not give.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

### Pull request 1, the names (branch `t-384-names-r9`, base `73bbafa`)

- **Runtime code** [measured]: `forge build src` (solc 0.8.28, via_ir, optimizer 200), then the sha256 of each artifact's `deployedBytecode` with the CBOR metadata tail left out (53 bytes; with it, the parent's HoldbackRules is 20,469 bytes, as T-380 measured).

  | Build | HoldbackRules runtime | sha256 |
  | --- | --- | --- |
  | Parent, `73bbafa` | 20,416 bytes | `ecd7e88c529927903dcff7ef4899ec4064ce4b8b4c8c06773ce7c28af949116b` |
  | The layout and `ONLY_ATTEMPT`, without the outcome check (`aee5cbf`) | 20,416 bytes | `ecd7e88c529927903dcff7ef4899ec4064ce4b8b4c8c06773ce7c28af949116b` |
  | The whole pull request | 20,449 bytes | `545f80b56390f540e5a98d715c7a436914af83d3653bf458d14c380ff53b0c47` |

  The outcome check is the one runtime difference: 33 bytes. `DrandQuicknetBeacon` (3,216 bytes, `3a8c11c6…e38c96`), `HoldbackTypes` and `Money` are unchanged in every build.
- **ABI** [measured]: every entry, name, type, selector and topic unchanged; three entries (`dealOf`, event `Defaulted`, error `WrongStage`) change only their `internalType` string. `packages/settlement/evm/abis.json` regenerated with `node scripts/evm-abis.mjs`: with `internalType` left out it equals the parent's.
- **Test edits** [measured]: 51 files under `contracts/test/` change `HoldbackRules.X` to `IHoldbackRules.X` for a type, error or event X and add one import line, and nothing else. A script undoes both edits in each file and compares it with `73bbafa`: 51 files checked, 51 import lines, 0 other differences (`reports/scratch/t-384/mechanical.sh`, not committed).
- **The outcome check** [measured]: `ValidOutcome.t.sol` compares `H.isValidOutcome` with the old bound, written into the test, over all 256 × 256 role and outcome bytes: equal for every pair.
- **`forge test`** at `0a2c09b` [measured]: 64 suites, 472 of 472 passed (T-380's 470 and the 2 new tests). The side-by-side harness against the re-seated parent `73bbafa`, allow list empty: `testFuzz_sideBySide` 256 runs passed, `test_planted_failsTheHarness` and `test_sideBySide_reachesEveryRow` passed. `PinnedSource.t.sol`'s three pins passed. The 11 invariants passed, 256 runs × 100 calls each.
- **Anvil suites** [measured]: CI's settlement leg (`pnpm vitest run packages/settlement/evm packages/testkit/src/runner.test.ts`, after `pnpm build`), the one that reads `abis.json`: 15 files, 247 of 247 passed. `deploy-script.test.ts` first failed 8 of 10 because the working tree held the uncommitted wording fixes and the deploy script refuses a `contracts/src` that differs from the commit; on the committed tree it passed 10 of 10. CI's world leg runs on the pull request.
- **Review**: one reviewer subagent, ISSUES, four low-severity wording findings, all fixed in `3081cb3` (comments only: the runtime hash after it is still `545f80b5…`, measured); no runtime or ABI finding. It confirmed the outcome equivalence, the interface's completeness against the ABI, the mechanical test edits, `abis.json`, and the re-seat's blob ids and pins.

## Decisions

- **Layout (a), the full interface** (the coordinator, 2026-11-12, inside Rafa's condition of the same day: identical runtime code, no forced edits in other sessions' files). Measured on a scratch branch at `100cde3`: moving every declaration into `IHoldbackRules.sol` leaves the runtime code of every contract identical (HoldbackRules 20,422 bytes, sha256 without the metadata tail `fef84eaa…5db295`, before and after). The ABI keeps every entry, selector, topic and encoding; three entries change only their `internalType` string (`dealOf`, event `Defaulted`, error `WrongStage` now name `IHoldbackRules.Stage` and `IHoldbackRules.Deal`), and nothing in the repository reads that string. Solidity does not resolve an inherited type, error or event through the derived contract's name, so the tests that wrote `HoldbackRules.X` now write `IHoldbackRules.X`. The narrower layouts were not taken: an interface without `dealOf`, the events and the errors would leave out most of what an auditor reads.
- **The explicit outcome check** (the coordinator, 2026-11-12). The numeric-order form compiled to identical code; the explicit form adds 33 bytes [measured at `100cde3`]. Pull request 1 runs the full recipe anyway, so the explicit form costs no time, and it removes the reliance on the constants' order that IS-9 names. It lives in `HoldbackTypes` beside the constants, so a test can call it directly.
- **Not built:** `_isOpen` and `_acceptsEarly` (1 byte more, or the same size reordered) and a role-to-decider helper (17 bytes more) [measured at `100cde3`].

## Handoff

- **Pull request 1** (the names) is ready on `t-384-names-r9`. Pull request 2 (the descriptions) follows on a new branch from the lane after it merges; the drafts are in `reports/scratch/t-384/` (not committed).
- **For T-352 (`contracts/scripts/mutants.json`)**, two rows find text this pull request moves:
  - M036 ("the appeal adjudicator may escalate") finds `(role == H.ROLE_APPEAL ? H.OUTCOME_REJECT : H.OUTCOME_ESCALATE)` in `src/HoldbackRules.sol`, which is gone. The same mutant on the new code: file `src/HoldbackTypes.sol`, find `|| (outcome == OUTCOME_ESCALATE && role != ROLE_APPEAL);`, replace `|| outcome == OUTCOME_ESCALATE;`.
  - M128 ("_acceptDelivery: any attempt number") finds `        if (dv.attempt != 1) revert InvalidMessage();\n`; the line now reads `        if (dv.attempt != ONLY_ATTEMPT) revert InvalidMessage();\n`.
- **For T-385 (the docs pass)**: `contracts/src` now holds `DrandQuicknetBeacon.sol`, `HoldbackRules.sol`, `HoldbackTypes.sol`, `IHoldbackBeacon.sol` and `IHoldbackRules.sol`. `Stage`, `Reason`, `Decider` and `Deal`, every event and every error now live in `IHoldbackRules`; the calldata structs stay in `HoldbackTypes`. `docs/audit/invariants.md:108`, `docs/audit/threat-model.md:96,99` and `docs/audit/test-quality.md` name `AppealAttempt.t.sol`, `AppealKey.t.sol` or `AppealSeedAttempt.t.sol`, now `Escalation…`. Every line citation of `HoldbackRules.sol` above its old line 158 moved.
- **For triage**: `contracts/.gas-snapshot` still lists the old test names; it was already stale and no CI step reads it.
