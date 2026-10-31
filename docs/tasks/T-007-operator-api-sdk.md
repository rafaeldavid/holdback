# T-007: Operator API and SDK with failover and direct submit

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-006
- **Paths this task may touch:** `apps/operator/`, `packages/sdk/`
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-007-operator-api`

## Intent

Expose the REST API in `docs/api.md` on top of `Settlement`, and an SDK that fails over across operators and falls back to direct submission.

Restated (implementer): an operator node is a thin HTTP relay over the `Settlement` interface. It turns each mutating request into the signed submissions T-006 defined, adds conveniences (idempotent replay, request IDs, version header, page envelope, dry run, signed receipts, reads, an event stream, status) and never adds authority: it authors no message, and anything it relays is equally valid when an agent submits it straight to SimChain. The SDK is the agent's side: typed calls, an ordered operator list it fails over across (one capped `Retry-After` wait), and the escape hatch that submits the same messages under the same idempotency keys directly to the settlement layer, so a call one operator half-relayed completes and never doubles. Two operators share one SimChain in tests; one refuses, one is offline, and the deal still settles.

Non-goals: run-time registration of clubs, agents, members and adjudicators (SimChain reads them from genesis; the GET reads serve genesis), quotes, webhooks, read tokens and private disclosure levels (Phase 2), disputes (Phase 4), the MCP wrapper, OpenAPI (T-015), persistence across operator restarts. Honest parties until the demo works; edge cases go to `docs/backlog.md`.

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
- [ ] `POST /v1/commitments/{id}/settlements` accepts a co-signed `MutualSettlement` with `payouts: [{to, amount}]` (one to eight, summing to the price; D23), with `?validateOnly=true` (ADR-0019); the SDK exposes `settle()` and `preview()` for it.
- [ ] SDK decrypt helper (ADR-0021): returns `{ plaintext, screen, removed }`, hands the agent a normalized view by default with the raw bytes on request, and always verifies the plaintext hash on the raw bytes.
- [ ] Privacy (ADR-0020): responses include a commitment's body only at disclosure levels that publish it (Phase 1: `public`). Read authentication (`ReadToken`, `unauthorized`) is out of scope until Phase 2.

- [ ] Finality (D20): `GET /v1/commitments/{id}` serves `settledAt` and `finalAt`. SDK `waitFor('final')` if T-012's agents need it; otherwise it may slip to API v0.3.
## Out of scope

- MCP wrapper (Phase 6).
- OpenAPI document and HTTP contract test (T-015). RateLimit headers, Deprecation and Sunset headers, SDK ranking of operators (deferred by ADR-0017).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
