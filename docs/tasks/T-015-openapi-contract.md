# T-015: OpenAPI document, staleness check and HTTP contract test

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-007, T-010
- **Paths this task may touch:** `spec/openapi/` (paths file), `spec/openapi.json` (generated), `scripts/openapi.mjs`, `scripts/validate-spec.mjs`, `tests/contract/`, `apps/operator/src/openapi/`, root `package.json` (`openapi` script)
- **Human gate:** no (the schemas it reads are already accepted in v0.5)
- **Status:** todo
- **Agent/session:** —

## Intent

Give agents and tool builders one machine-readable description of the operator API that is generated from `spec/schemas` and proven against the running operator (ADR-0017 §11).

Restate this in your own words in this section before writing code.

## Context

- ADR-0017; `docs/api.md`; `spec/schemas`; T-010's scenario fixtures; OpenAPI 3.1 (JSON Schema 2020-12).

## Acceptance criteria

- [ ] `pnpm openapi` generates `spec/openapi.json` from `spec/schemas` plus a hand-written paths file; no body schema is written twice.
- [ ] `pnpm validate:spec` fails when `spec/openapi.json` is stale.
- [ ] Contract test: T-010's scenario fixtures run through an operator over HTTP, and every response validates against the document (status, headers, body). It runs in CI on SimChain.
- [ ] `GET /v1/openapi.json` serves the document; the operator root serves `llms.txt` pointing to it and to `docs/api.md`.
- [ ] Party-authored fields keep `x-holdback-untrusted` in the generated document.

## Out of scope

- Spec examples as contract inputs (their signatures are placeholders).
- RateLimit and Deprecation headers (deferred by ADR-0017).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
