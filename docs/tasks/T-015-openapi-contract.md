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

**Restated (implementer, 2026-11-01).** Since D30 the HTTP API is the product surface, so an agent framework should be able to generate its tools from one OpenAPI 3.1 document. This task produces that document and keeps it honest:

- **One description of every route an operator node serves** (`apps/operator/src/server.ts`, including T-020's `/v1/prepare/*`, `/recipients`, `/v1/ciphertext`, `/.well-known/holdback.json` and `/v1/test/faucet`), with an operation ID, summary and description per operation that a tool generator can use as-is. Each prepare operation says "verify before you sign" and links `docs/api.md`. The sim service's own routes (`pnpm sim`'s `/accounts`, `/advance`, ...) are not operator routes and stay out.
- **Generated, not hand-copied.** `pnpm openapi` builds `spec/openapi.json` from `spec/schemas` (every body schema hoisted into `components.schemas` with its `$ref`s rewritten) plus a hand-written paths file. Shapes that exist only at the operator (prepare inputs and answers, recipients, discovery) are written once, in the paths file, and reuse spec schemas by `$ref`. `x-holdback-untrusted` survives.
- **Kept fresh.** `pnpm validate:spec` fails when the committed `spec/openapi.json` differs from a fresh build, or when a `$ref` dangles or a schema does not compile under Ajv strict.
- **Proven against a running operator.** The snap runner drives SimChain directly, not HTTP, so the contract test drives the HTTP flows instead: the `examples/` agent (offer, agree and fund, encrypted delivery, release, open) and the sim-world flows (refund and appeal, early accept, mutual settlement, triggers, dry runs, idempotent replay and conflict, problems, throttling, relay refusal, the event stream). Every response from an operator is checked against the document (status listed, required headers present and valid, body valid), and every documented operation is exercised at least once.
- **Served.** `GET /v1/openapi.json` returns the document with `servers` set to the node's own base URL; `GET /llms.txt` points to it and to `docs/api.md`.
- **The planned routes stay out.** `docs/api.md`'s "planned: 404 today" routes are not in `paths` (a tool generator would otherwise make tools that always 404); they are listed under a top-level `x-holdback-planned`. A test checks that the documented operations are exactly api.md's served rows.

Non-goals: no change to `spec/schemas` (no version bump); no new bounds on negotiable values (D31: prepare inputs carry only the operator's own refusals, such as non-negative whole-second windows); spec examples as contract inputs; `RateLimit` and `Deprecation` headers; the `202 pending` chain responses (no chain in Phase 1); generating an SDK or tools (T-021).

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
