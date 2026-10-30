# ADR-0008: Demo-first walking skeleton on SimChain

- **Status:** Accepted, 2026-10-30.
- **Date:** 2026-10-30

## Decision

Phase 1 builds every layer thinly, end to end, on SimChain:
- the hold and the two-sided key release;
- operators and the SDK;
- the judgment panel with the core defenses;
- adjudicator fallback and appeal;
- a narrated demo.

Each demo beat is a scenario fixture, and its transcript is the `.expect.md` snapshot. Later phases replace thin parts without changing the fixtures, except through reviewed snapshot diffs.

## Rationale

- The first audience is an AI lab, and the experience is the product claim.
- A walking skeleton exposes integration problems early.
- Snapshot transcripts give humans and agents the same evidence.

## Consequences

SimChain must implement the same rules the contract will (ADR-0003). Differential tests in Phase 2 keep the two aligned.
