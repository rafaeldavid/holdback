# T-009: Providers, pinned registry, commit-reveal panel, adjudicator service

- **Lane:** judgment
- **Phase:** 1
- **Depends on:** T-008, T-006
- **Paths this task may touch:** `packages/judgment/providers/`, `apps/adjudicator/`, `config/judges.yaml`
- **Human gate:** yes (defenses)
- **Status:** todo
- **Agent/session:** —

## Intent

Turn the pipeline into a running adjudicator that selects a verifiable panel, calls pinned judges, signs decisions, and supports fallback and appeal.

Restate this in your own words in this section before writing code.

## Context

- `docs/judgment-and-defenses.md` §Panel policy, §Model registry; ADR-0006, ADR-0007.

## Acceptance criteria

- [ ] Providers: Anthropic, OpenAI-compatible, recorded, fake. Each verdict records provider, family, pinned model ID, prompt hash, rubric hash, latency.
- [ ] Registry loader rejects aliases and non-active entries; `error.unpinned-model-refused` path.
- [ ] Commit-reveal: commitment posted at agreement; seeded shuffle with family constraints; anyone can recompute (test).
- [ ] Panel seed fixed per (commitment, attempt); no re-roll (test).
- [ ] Adjudicator service: watches assignments, runs pipeline, signs Decision with judgment record hash, publishes record; acts as fallback or appeal adjudicator when assigned; appeal panel policy.
- [ ] Fee quote stub returning policy minimum.

## Out of scope

- Calibration harness, fee from metrics (Phase 3).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
