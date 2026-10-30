# T-007: Operator API and SDK with failover and direct submit

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-006
- **Paths this task may touch:** `apps/operator/`, `packages/sdk/`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Expose the REST API in `docs/api.md` on top of `Settlement`, and an SDK that fails over across operators and falls back to direct submission.

Restate this in your own words in this section before writing code.

## Context

- `docs/api.md`; ADR-0005; ADR-0017 (agent-ready API, Phase 1 subset); ADR-0019 (mutual settlement); `docs/neutrality.md` §Escape hatch requirements.

## Acceptance criteria

- [ ] Endpoints listed for Phase 1 (registry, club membership, adjudicator discovery, faucet, commitments incl. adjudicator acceptance and one-shot `/v1/holds`, deliveries, early accept, decisions, appeals, triggers, reads, key, events SSE).
- [ ] Idempotency middleware with 409 on body mismatch; property test.
- [ ] RFC 9457 problem responses with the listed types.
- [ ] Startup guards: refuse non-`sk_test_` Stripe keys and mainnet chain IDs (unit test).
- [ ] Operator-signed receipts.
- [ ] SDK: operator list failover, direct submit to SimChain, `waitFor`; tests where op-1 refuses and op-2 is offline.
- [ ] Two operator instances can run against one SimChain in tests.
- [ ] ADR-0017 Phase 1 subset:
  - every collection returns the `page.schema.json` envelope, ordered by event sequence;
  - `GET /v1/commitments?party&role&escrowState`, `GET /v1/commitments/{id}/events`, paginated `/v1/adjudicators`;
  - `GET /v1/clubs/{id}`, `GET /v1/agents/{address}`, `GET /v1/clubs/{id}/members/{principal}`;
  - `Request-Id` on every response and in problem `instance`; `traceparent` accepted and logged, never signed; `Holdback-Schema-Version` on every response;
  - 429 `rate_limited` with `Retry-After`; the SDK waits at most once, for at most 2 seconds, then fails over (fixture `neutrality.operator-rate-limits`);
  - `GET /v1/status` per `operator-status.schema.json`, including the EIP-712 domain and the receipt-signing address;
  - `?validateOnly=true` through `Settlement.validate`, unsigned for party messages, with the live response shape minus `receipt` and `Holdback-Dry-Run: true`; SDK `preview()`;
  - receipts conform to `receipt.schema.json`;
  - problem types `not_found` and `invalid_cursor`.
- [ ] `POST /v1/commitments/{id}/settlements` accepts a co-signed `MutualSettlement`, with `?validateOnly=true` (ADR-0019); the SDK exposes `settle()` and `preview()` for it.
- [ ] SDK decrypt helper (ADR-0021): returns `{ plaintext, screen, removed }`, hands the agent a normalized view by default with the raw bytes on request, and always verifies the plaintext hash on the raw bytes.
- [ ] Privacy (ADR-0020): responses include a commitment's body only at disclosure levels that publish it (Phase 1: `public`). Read authentication (`ReadToken`, `unauthorized`) is out of scope until Phase 2.

## Out of scope

- MCP wrapper (Phase 6).
- OpenAPI document and HTTP contract test (T-015). RateLimit headers, Deprecation and Sunset headers, SDK ranking of operators (deferred by ADR-0017).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
