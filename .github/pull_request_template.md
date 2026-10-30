## Summary
<!-- Task ID and one paragraph: what changed and why. Task file: docs/tasks/T-xxx-*.md -->

## Acceptance criteria
<!-- Copy the task's checklist and tick what is met. -->
- [ ]

## Evidence
<!-- Paste the table from reports/verify-<branch>.md (`pnpm verify`). Label every claim. -->
- **Measured:**
- **Inferred:**
- **Guessed:**

Snapshot diffs: <!-- each .expect.md change with a one-line reason, or "none" -->

## Litmus tests
- [ ] Neutrality: no actor gains a way to stop settlement or move held funds; new actors or timeouts have a `neutrality.*` fixture
- [ ] Hold: no double spend; operations idempotent; custody stays on the settlement layer
- [ ] Judgment: deliverables stay untrusted data; pinned models; new defenses have an `attack.*` fixture

## Contract checklist (contracts/ only; otherwise delete)
- [ ] No owner, pause, freeze, blacklist, `selfdestruct` or upgrade proxy
- [ ] Every timeout function is callable by anyone
- [ ] Cross-family review done

## Human gate
- [ ] Not needed / [ ] Needs Rafa (ADR, schema, contract, defense, keys, deploy)

## Risks and follow-ups
-
