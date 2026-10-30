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

- [ ] Providers: Anthropic, OpenAI-compatible, recorded, fake. Each verdict records provider, family, pinned model ID, prompt template hash, input hash, rubric hash, latency.
- [ ] Registry loader rejects aliases and non-active entries; `error.unpinned-model-refused` path.
- [ ] Commit-reveal: commitment posted at agreement; seeded shuffle with family constraints over the registry named by `registryHash`; anyone can recompute (test); a registry that does not hash to `registryHash` is refused.
- [ ] Panel seed fixed per (commitment, attempt); no re-roll (test).
- [ ] The shuffle takes the seed for the decider's role (ADR-0018): the primary's revealed seed, or `keccak256(commitmentId ‖ role ‖ attempt ‖ beaconValue(round))` for the fallback and appeal adjudicators. The adjudicator service reads rounds through a `RandomnessSource` interface (`sim` now, `drand` later).
- [ ] Adjudicator service: watches assignments, runs pipeline, signs Decision with judgment record hash, publishes record; acts as fallback or appeal adjudicator when assigned; appeal panel policy.
- [ ] Policy binding: `policyHash` computed as keccak256 of the RFC 8785 canonical JSON of the adjudicator's policy; a judgment whose template hash or `policyHash` does not match the commitment is refused (`error.policy-hash-mismatch`).
- [ ] The adjudicator service signs `AdjudicatorAcceptance` (seed commitment, policy and registry hashes, fee, reserved bond) and publishes its registry hash and URI and its policy hash in its registration.
- [ ] Fee quote stub returning policy minimum.
- [ ] Appeal ground "missing or wrong key": the appeal decision may carry the key to the buyer.

## Out of scope

- Calibration harness, fee from metrics (Phase 3).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
