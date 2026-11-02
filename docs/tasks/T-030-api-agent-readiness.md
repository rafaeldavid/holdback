# T-030: API agent-readiness batch

- **Lane:** api
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `apps/operator/src/`, `apps/demo-cloud/src/`, `apps/adjudicator/src/` (declining sealed offers only), `spec/openapi/paths.json`, `spec/openapi.json` (generated), `scripts/openapi.mjs`, `site/llms.txt`, `site/build.mjs`, `site/check.mjs`, `docs/api.md`, `docs/plan.md` (Phase 6 wording only), `examples/`, `tests/contract/`, `fixtures/` (new error fixtures), `docs/tasks/T-030-api-agent-readiness.md`, `docs/backlog.md` (close rows this task resolves)
- **Human gate:** no (a demo redeploy after merge follows `docs/operations.md`)
- **Status:** todo
- **Agent/session:** —

## Intent

Make the operator API meet D39's bar: an agent with only an HTTP client, an EIP-712 signer and `https://escrow.stream/llms.txt` completes a deal on its first try, and the API is simpler than today. Work from `docs/reviews/2026-11-02-api-agent-review.md`, sections 2 (Simplify), 4 (findings), 5 (first five) and 6 (conformance and stubs). Only operator and docs changes: anything that changes `spec/schemas/` belongs to T-033 (schema v0.9).

## Acceptance criteria

- [ ] **Docs-only fixes (F3, F6, F9, F10, F12, C1, C13):** the operator's own `/llms.txt` links `https://escrow.stream/llms.txt` and the raw `docs/api.md`; `llms.txt` gains an "Encodings" section (nonce rule, `has*`/zero defaults for MutualSettlement, ReadToken and Delegation encodings, the private recipe summary), idempotency retention and refusal semantics, default expiries and `attempt`; `docs/api.md` and `docs/plan.md` say SDK and MCP are "later, on demand".
- [ ] **Errors (F4):** problem `type` resolves at `https://escrow.stream/problems/<type>` (a generated page per type on the site), typed members `state`, `needs`, `fee`, `retryAfterSec`, `field` where an agent must branch, `internal` for 500, a bad `limit` as `invalid_terms` with `field`. If a new problem type needs the schema, stop and hand it to T-033.
- [ ] **Discovery and faucet (F2, Simplify 1, 3, 9):** the demo's `GET /` facts (adjudicators with roles, token decimals, faucet, limits) reachable from the one discovery document and in the OpenAPI document under a `demo` tag; one faucet; one fee name. Changing `operator-status.schema.json` (for example `chainId` as a number) waits for T-033; until then document the difference.
- [ ] **Simplify 5, 7, 8, 10, 11:** notices in the response body (`notices[]`, marked untrusted) instead of `Holdback-Notice`; prepare requires caller nonces (no hidden default); one timestamp format (whole seconds, `Z`) in read models; one version paragraph; OpenAPI descriptions under about 300 characters with the long lists in one linked section, and a `core` tag on the happy-path operations.
- [ ] **Limits published (F8):** the caller's rate limits and idempotency retention in discovery and Conventions.
- [ ] **Planned routes (D39):** the six new planned rows from the review §6.2 in `docs/api.md` and `x-holdback-planned`; planned routes answer 501 `not_implemented` with a `Link` to their source, read from `x-holdback-planned` (keep one source of truth; update the tests that enforce "planned = unrouted").
- [ ] **Privacy and safety (C4, C9/F11, F1):** the write budget is charged only after the signature verifies; `prepare/offer` requires `disclosure` (no default); the demo adjudicators decline an offer whose sealed terms they cannot open (a clear problem, not a silent stall).
- [ ] A fresh agent following only the new `llms.txt` completes a deal against a local `pnpm demo-cloud:dev` (record the transcript in Evidence); `pnpm verify` and CI pass; `node site/check.mjs` passes.

## Out of scope

- Schema changes (T-033), telemetry (T-031), the feedback service (T-032), CORS unless trivial (F13).

## Evidence

## Decisions

## Handoff
