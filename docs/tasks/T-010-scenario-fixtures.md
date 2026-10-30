# T-010: Scenario fixtures for demo beats 1–7 plus error and neutrality sets

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-005, T-007, T-009, T-012
- **Paths this task may touch:** `fixtures/scenarios/`, `fixtures/recordings/`, `fixtures/clubs/`, `fixtures/terms/`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Write the Phase 1 fixtures from `docs/plan.md` Scenario index and capture live recordings once so CI replays real verdicts.

Restate this in your own words in this section before writing code.

## Context

- `docs/plan.md` §Scenario index; `docs/demo.md` §Beats; `docs/testing.md`; `docs/neutrality.md`.

## Acceptance criteria

- [ ] Every Phase 1 row in the scenario index exists and passes, including the rows added by the Phase 0 review (`neutrality.appeal-adjudicator-offline-after-escalation`, `neutrality.maintainers-change-registry`, `attack.adjudicator-self-dealing`, `appeal-bad-key-release`, `todo.adjudicator-leaks-plaintext`).
- [ ] Recordings captured with `--record` from at least two model families; model IDs visible in snapshots.
- [ ] Each `neutrality.` fixture asserts the terminal state and balances named in `docs/neutrality.md`.
- [ ] Snapshots reviewed for readability by a human (Rafa or reviewer agent) — record reviewer.

## Out of scope

- Phase 3+ fixtures.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
