# T-010: Scenario fixtures for demo beats 1–7 plus error and neutrality sets

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-005, T-007, T-009, T-012
- **Paths this task may touch:** `fixtures/scenarios/`, `fixtures/recordings/` (`fixtures/clubs/` and `fixtures/terms/` belong to T-012)
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Write the Phase 1 fixtures from `docs/plan.md` Scenario index and capture live recordings once so CI replays real verdicts.

Restate this in your own words in this section before writing code.

## Context

- `docs/plan.md` §Scenario index; `docs/demo.md` §Beats; `docs/testing.md`; `docs/neutrality.md`.

## Acceptance criteria

- [ ] Every Phase 1 row in the scenario index exists and passes, including the rows added by the Phase 0 review (`neutrality.appeal-adjudicator-offline-after-escalation`, `neutrality.maintainers-change-registry`, `attack.adjudicator-self-dealing`, `appeal-bad-key-release`, `todo.adjudicator-leaks-plaintext`) and by ADR-0016 (`neutrality.adjudicator-never-accepts`, `neutrality.adjudicator-silent-before-judging`, `error.acceptance-mismatch`, `error.seed-mismatch`, `error.member-not-admitted`, `early-accept-releases-key`) and by ADR-0017 and ADR-0018 (`neutrality.operator-rate-limits`, `attack.fallback-panel-shopping`, `attack.appeal-panel-shopping-after-escalation`, `attack.timing-grind`; `error.seed-mismatch` covers a wrong primary preimage, a fallback-chosen seed and an appeal-chosen seed; `neutrality.adjudicator-silent-before-judging` shows the beacon round) and by ADR-0019 (`mutual-split-releases-key`, `mutual-refund-before-delivery`, `mutual-cancel-keeps-work`, `neutrality.mutual-settlement-adjudicator-offline`, `error.settlement-single-signature`, `error.settlement-exceeds-price`, `error.settlement-after-decision`, `error.settlement-key-without-delivery`, `error.settlement-stale-delivery`, `error.settlement-disallowed-by-rulebook`, `attack.settlement-race-with-decision`).
- [ ] Recordings captured with `--record` from at least two model families; model IDs visible in snapshots.
- [ ] Each `neutrality.` fixture asserts the terminal state and balances named in `docs/neutrality.md`.
- [ ] Snapshots reviewed for readability by a human (Rafa or reviewer agent) — record reviewer.
- [ ] Privacy fixtures (ADR-0020): `neutrality.fallback-key-on-takeover` (Bench B cannot read before `judgeBy`, can after), `error.escalate-without-appeal-key`, `error.dispute-without-keys`, `error.disclosure-level-not-public-in-phase-1`.
- [ ] Screen fixtures (ADR-0021): `attack.injection-tags-empty-rubric` (accepted, screen flagged, SDK shows stripped text), `attack.injection-tags-required-check` (rejected by the required check, no panel), `neutrality.seller-multilingual-text` (Persian with ZWNJ, ❤️ and 🏴󠁧󠁢󠁥󠁮󠁧󠁿 settle without a false reject).
- [ ] Phase 4 set, pinned now (D19): `error.dispute-by-seller` (a seller-signed `Dispute` is refused with `invalid_signature`); `neutrality.optimistic-buyer-silent` (release at `disputeBy` by anyone).

## Out of scope

- Phase 3+ fixtures.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
