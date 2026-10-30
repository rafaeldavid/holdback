# T-012: Demo data and scripted buyer/seller agents

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-007, T-009 (the data generator can start after T-004)
- **Paths this task may touch:** `apps/demo/agents/`, `fixtures/data/`, `fixtures/clubs/`, `fixtures/terms/`, `scripts/gen-demo-data.ts`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Produce the dataset-cleaning job materials and scripted agents that drive each beat through the SDK.

Restate this in your own words in this section before writing code.

## Context

- `docs/demo.md` §Cast, §Beats.

## Acceptance criteria

- [ ] Seeded generator for a dirty customers CSV (duplicates, mixed date formats, invalid emails, nulls) and deliverables: good, row-drop (8%), panel-borderline, injection-plain, injection-base64, injection-unicode-tags.
- [ ] Terms file for the $2,000 job with deterministic checks and three rubric criteria with anchors.
- [ ] Scripted buyer and seller agents using only the SDK; each beat callable alone.
- [ ] Club rulebook v1 (`fixtures/clubs/`, guaranteed mode only, `maxSubmissions` 1) and adjudicator registrations for Bench A/B/C with registry and policy hashes from T-009.

## Out of scope

- LLM-driven agents (Phase 6).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
