# T-384: the names, then the comments for the auditor (package R9)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-380 (package R8, last pull request 426, lane tip `73bbafa`), T-375 (package R7: the values R9 names), T-341 and T-356 (the side-by-side harness)
- **Paths this task may touch:** `contracts/src/*`, the new `contracts/src/IHoldbackRules.sol` included; `contracts/test/*` for the renames and for what the layout requires; `packages/settlement/evm/abis.json` when the build regenerates it; this task file. Lines in `contracts/script/` (T-383) or `contracts/scripts/mutants.json` (T-352) go to their owners through the coordinator
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress (pull request 1)
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

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

- **Layout (a), the full interface** (the coordinator, 2026-11-12, inside Rafa's condition of the same day: identical runtime code, no forced edits in other sessions' files). Measured on a scratch branch at `100cde3`: moving every declaration into `IHoldbackRules.sol` leaves the runtime code of every contract identical (HoldbackRules 20,422 bytes, sha256 without the metadata tail `fef84eaa…5db295`, before and after). The ABI keeps every entry, selector, topic and encoding; three entries change only their `internalType` string (`dealOf`, event `Defaulted`, error `WrongStage` now name `IHoldbackRules.Stage` and `IHoldbackRules.Deal`), and nothing in the repository reads that string. Solidity does not resolve an inherited type, error or event through the derived contract's name, so the tests that wrote `HoldbackRules.X` now write `IHoldbackRules.X`. The narrower layouts were not taken: an interface without `dealOf`, the events and the errors would leave out most of what an auditor reads.
- **The explicit outcome check** (the coordinator, 2026-11-12). The numeric-order form compiled to identical code; the explicit form adds 33 bytes [measured at `100cde3`]. Pull request 1 runs the full recipe anyway, so the explicit form costs no time, and it removes the reliance on the constants' order that IS-9 names. It lives in `HoldbackTypes` beside the constants, so a test can call it directly.
- **Not built:** `_isOpen` and `_acceptsEarly` (1 byte more, or the same size reordered) and a role-to-decider helper (17 bytes more) [measured at `100cde3`].

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
