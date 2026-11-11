# T-342: The scope ADR for the phase-one contracts

- **Lane:** research
- **Phase:** 2 (the contract refinement before the pilot; package R1 of the refinement plan, which the maintainers keep privately, `docs/private-materials.md`)
- **Depends on:** none. T-334 (the contract clean-up), T-338 (the audit docs) and T-340 (the state model and the threat model) run beside it.
- **Paths this task may touch:** `docs/decisions/ADR-0031-phase-one-contract-scope.md` (new), `docs/audit/scope.md`, `docs/decisions-today.md` (new lines only), this file.
- **Human gate:** no. The change is confined to this repository. Rafa's own edits wait for him: the sentence in `CLAUDE.md`'s litmus test 3, and the answers this task leaves open.
- **Status:** in progress
- **Agent/session:** the T-342 session, change kind 10 (research and decisions), target 200k tokens.

## Intent

Write down what the phase-one contracts deliberately do not do, so an auditor or an outside reviewer reads it first.

- **Goal.** One ADR, status Proposed, that records the eight scope cuts (SC-1 to SC-8) of the contract refinement plan. For each cut it says what leaves the contracts (functions, storage, events), what stays, what a party loses, and what brings the feature back.
- **Inputs.** The refinement plan's section 2 and package R1; Rafa's answers of 2026-11-11; the contracts in `contracts/src/` on `origin/main`; the ADRs each cut touches; `docs/audit/scope.md`, `docs/neutrality.md` and `docs/judgment-and-defenses.md`.
- **Outputs.** The ADR; `docs/audit/scope.md` with the phase-one scope and a short list of what was cut on purpose; one new entry in `docs/decisions-today.md` that records Rafa's decision on party appeals and bonds in his words.
- **Non-goals.** No code, schema, formal-model or contract change. No decision that is Rafa's. No edit to `CLAUDE.md`, `docs/audit/known-issues.md`, `docs/audit/state-model.md` or `docs/audit/threat-model.md`.

## Context

- The contracts: `contracts/src/HoldbackRules.sol`, `HoldbackBonds.sol`, `HoldbackTypes.sol`, `DrandQuicknetBeacon.sol`.
- The ADRs the cuts touch: ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0006 (defended judgment), ADR-0007 (bonded adjudicators), ADR-0016 (the acceptance and the state machine), ADR-0018 (the beacon), ADR-0019 with D23 (mutual settlement to any address), ADR-0025 and ADR-0026 (funding paths), ADR-0030 (adjudicator registration).
- Decisions: D23, D26, D28, D31, D32, D38, D42, D43.
- Rafa's standard for this work (2026-11-11): "it's better to have a limited scope for an initial phase of the product than perfectly complete and universal design contracts that open up to risks."

## Acceptance criteria

- [ ] The ADR records SC-1, SC-2, SC-3, SC-5 and SC-6 as the stated direction, each with what leaves, what stays and the trigger for bringing it back.
- [ ] The ADR records SC-7 as decided by Rafa on 2026-11-11, with his words.
- [ ] The ADR records every other answer Rafa gave on 2026-11-11 with his words, and leaves open what he has not answered, with options and a recommendation.
- [ ] The ADR settles the open points of the SC-7 cut, each with a reason: the appeal adjudicator's role, the signed `bondReserved` field (tested against the EIP-712 types), the docs that promise appeals, and SimChain as the full reference.
- [ ] Each cut names the functions, storage and events it removes or keeps.
- [ ] Each cut is tested against the three litmus tests. The ADR says plainly which line of litmus test 3 phase one sets aside, what protects a party instead, and what a wrong first decision costs.
- [ ] Nothing in the ADR contradicts the EIP-712 types or `spec/schemas/` without saying that a schema change and a version bump would follow.
- [ ] The ADR lists every doc that promises appeals or bonds, with the sentence to change, for a later docs package.
- [ ] A red team attacked the cuts without this session's reasoning, and the ADR answers each finding.
- [ ] `docs/audit/scope.md` states the phase-one scope and lists what was cut on purpose.
- [ ] `docs/decisions-today.md` has one new entry, D57, and no other line changes.

## Out of scope

- The contract changes themselves (packages R5 and R6 of the plan).
- The docs package that rewrites the pages that promise appeals and bonds.
- The state model, the signed-field register and the threat model (T-340).
- `docs/audit/known-issues.md` (T-338 owns it). The Handoff lists the rows to move, with their new wording.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
