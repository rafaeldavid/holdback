# T-016: Testkit runner features that unblock the open T-010 rows

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-005, T-008, T-009, T-010 (PR47)
- **Paths this task may touch:** `packages/testkit/`, `docs/team.md` (Rules and checks row for authored recordings), regenerated `fixtures/scenarios/*.expect.md` and `fixtures/recordings/` only where a runner change alters existing output
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

T-010 wrote 18 passing fixtures but about 45 Phase 1 scenario rows cannot be expressed by the snap runner yet. Give the runner the features those rows need, so T-010 can finish them without touching the runner itself.

Restate this in your own words in this section before writing code.

## Context

- T-010's Handoff (`docs/tasks/T-010-scenario-fixtures.md`) lists the gaps and the rows each blocks.
- `docs/plan.md` §Scenario index; `docs/testing.md`; ADR-0016, ADR-0018, ADR-0019, ADR-0020, ADR-0021; decisions D19–D23.
- `packages/judgment` (T-008, T-009) and `config/judges.yaml`.

## Acceptance criteria

Each feature lands with a unit test in `packages/testkit` and, where possible, one T-010 fixture moved from `todo.`/open to passing as proof.

- [ ] Judgment pipeline in the runner: deterministic checks, screen and panels drawn from `config/judges.yaml`, with role-specific sizes (appeal panel of five over three families). Snapshots show registry model IDs. Proof: `bad-work-row-drop` refunds.
- [ ] Recordings keyed by role (`<scenario>/<role>/<judgeId>.json`), with a migration for the existing recordings. Proof: `panel-disagreement-escalates`.
- [ ] Steps: `appeal` (party, bond and held fee), `early_accept`, `mutual_settle` (`Settled` terminal state, D23 payouts), `dispute`, `revoke_member`, `revoke_mandate`, deliver `attempt`, and a second commitment per scenario.
- [ ] Message overrides for refusal fixtures: reused nonce, wrong seed or preimage, wrong policy or acceptance hash.
- [ ] `offline: { actor: <operator> }` stops that operator from relaying; the no-prefix rules accept the seller's reclaim timeout.
- [ ] Snapshot rendering: `settledAt` and `finalAt` (D20), "seed source: beacon round N" (ADR-0018), content-key envelope recipients (ADR-0020), hours in the clock column past 60 minutes.
- [ ] `capturedFrom: authored` recordings that `--judges fake --record` refuses to overwrite (like `live`), plus the Rules and checks row in `docs/team.md`.
- [ ] Existing snapshot diffs explained line by line in the PR.

## Out of scope

- Writing the remaining T-010 fixtures (T-010 finishes them once this lands).
- Optimistic mode (D19, Phase 4).
- Live recordings (need Rafa's keys).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
