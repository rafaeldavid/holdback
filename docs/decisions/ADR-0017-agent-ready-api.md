# ADR-0017: Agent-ready API

- **Status:** Proposed
- **Date:** 2026-10-30
- **Raised by:** scoring `docs/api.md` against Rafa's agent readiness test ("The Agent Readiness Test for Enterprise Operations Software", https://rafael.fyi/blyg/t/71jexkhsyr9e7c70vadqkz5ba6/). It shapes T-007 (operator API and SDK) and needs schema v0.5. Decision D13.

## Context

Holdback's users are agents and the small tools people build around them: an MCP server, a dashboard, a reconciliation script. The API is the product surface for all of them (protocol property 3). The test asks 16 yes-or-no questions of an API that agents will use. We scored the current spec without running anything, because T-007 has not built the API yet (inferred).

**Already met** (questions 3, 4, 6, 7, 9, 11, 13 and 14 in full, and the idempotency half of 15):
- Errors use RFC 9457 problem types.
- Money is base units plus a token, and timestamps are RFC 3339.
- `GET /v1/commitments/{id}` returns full current state and balances.
- State and history are an ordered event stream (`/v1/events?from=<seq>`), with operator-signed receipts.
- Webhooks are signed.
- Every mutating call takes an `Idempotency-Key`.
- Identity is per agent. Each agent has its own EIP-712 signer with a scoped, revocable mandate.
- The audit trail is a hash chain that anyone can verify.
- The open protocol makes the terms-of-service question moot.

**Gaps** (inferred from `docs/api.md` and `spec/schemas`):
1. **No list or filter.** An agent cannot ask "my open commitments as buyer" without replaying the whole event stream. Nothing is paginated.
2. **No published limits.** `docs/api.md` says operators "may rate-limit by signer address", but there are no headers, no `Retry-After` and no problem type.
3. **No machine-readable API description.** `spec/schemas` defines the bodies, but no OpenAPI document ties them to paths, and nothing tests the running API against the spec.
4. **No dry run.** An agent learns that a hold would fail (wrong policy hash, deadline order, insufficient bond) only by sending it. Failed sends cost latency and, on a chain, gas.
5. **No versioning or deprecation policy** beyond the `/v1` path.
6. **No request IDs or trace context.** A multi-agent call chain cannot be reconstructed across operators.
7. **No self-description.** An agent cannot ask an operator which settlement it targets, how far behind the chain it is, which schema version it serves, or what its own limits are.
8. **Party-authored text is unmarked.** Responses carry text written by a party (deliverable descriptions, rubric text, appeal reasons) next to protocol data. An LLM reading a response cannot tell which fields are untrusted.

The test's own advice is to fix the API description, the error format and the event log first. We already have the last two.

## Decision

Adopt the following in API v0.2 and schema v0.5. T-007 builds it, and a new task T-015 owns the OpenAPI document and its contract test.

### 1. Lists, filters and pagination

- `GET /v1/commitments` with filters:
  - `party=<address>` and `role=buyer|seller|adjudicator`;
  - `escrowState` and `appealState` (each repeatable);
  - `club`;
  - `createdAfter` and `createdBefore`.
- `GET /v1/commitments/{id}/events` returns one commitment's history, each event with its sequence number and timestamp.
- Every collection, including `/v1/adjudicators` and receipts, uses cursor pagination.
  - Requests take `?cursor=&limit=`, with a default limit of 50 and a maximum of 200.
  - Responses are `{ "items": [...], "nextCursor": "<opaque>" | null }`, and `null` means the end of the data.
  - Order is `createdAt` descending, with the ID as tie-break, so pages are stable.
- Bulk export stays the event stream from a sequence number. There is no second export format.
- Acceptance test from the readiness test: each planned MCP tool (`docs/api.md`, MCP section) is answerable in two calls or fewer.

### 2. Published limits

- Every response carries the IETF `RateLimit` and `RateLimit-Policy` headers.
- Throttled requests return 429 with problem type `rate_limited` and `Retry-After`.
- Writes are limited per signer address and reads per client.
- The SDK honors `Retry-After` once, then fails over to the next operator.
- A rate limit is an operator refusing to relay. It never decides whether a commitment settles, because the escape hatch covers it (see Litmus tests).

### 3. OpenAPI, generated and tested

- `pnpm openapi` generates `spec/openapi.json` from `spec/schemas` plus a paths file. Nobody writes the bodies by hand twice.
- `pnpm validate:spec` fails if the generated file is stale.
- A contract test in T-015 runs every example in `spec/examples` through the operator over HTTP, and checks each response against the OpenAPI document. It runs in CI against SimChain.
- `GET /v1/openapi.json` serves the document. `docs/api.md` stays the prose guide and links to it.
- We also publish `llms.txt` at the operator root, pointing to `docs/api.md` and the OpenAPI document. This is cheap and optional.

### 4. Validate-only dry run for writes

- Every mutating endpoint accepts `?validateOnly=true`, following Google AIP-163.
- The operator runs the request through the parser and core's pure `step` against current state.
- **Valid request:** the response is 200 with `{ "valid": true, "wouldBe": <state>, "checks": [...] }`.
- **Invalid request:** the response is the same problem the real call would return.
- A dry run has no effects:
  - it records no idempotency key;
  - it consumes no nonce;
  - it reserves no funds or bond;
  - it emits no event;
  - it relays nothing to the settlement layer.
- A dry run covers protocol guards only. It never runs judgment, and it never reveals sealed checks or a panel.
- This is how an agent previews a money-moving call before its principal approves. The mandate stays the standing approval. Dry run is the per-call preview.

### 5. Versioning and deprecation

- The path carries the major version (`/v1`). Within a major version, changes are additive only.
- Every response carries `Holdback-Schema-Version` (for example `0.5`).
- Enums may grow. Problem types, escrow and appeal states, event kinds and trigger kinds are all documented as open sets. Clients must treat an unknown value as "not handled" and must not crash on it.
- A deprecated field or endpoint carries the `Deprecation` header (RFC 9745) and `Sunset` (RFC 8594).
- A deprecation is announced in the `spec/README.md` changelog at least one minor version before removal. Removal happens only in a new major path.

### 6. Request IDs and trace context

- Every response carries `Request-Id`, and every problem response repeats it in `instance`.
- Operators accept a W3C `traceparent` header and propagate it to their logs and to any operator they forward to.
- Trace and request IDs never enter signed messages, receipts or the event hash chain. Those stay deterministic and free of operator-specific data.

### 7. Operator self-description

`GET /v1/status` returns:
- the operator ID;
- the settlement target, as SimChain or a chain ID;
- the API and schema versions served, and the deprecations in force;
- the head event sequence and its lag behind the settlement layer, in blocks and seconds;
- the caller's current limits;
- the settlement modes this operator relays.

The SDK uses it to rank operators before failover.

### 8. Untrusted text is marked

- Every response field that carries party-authored free text is marked `"x-holdback-untrusted": true` in the OpenAPI document.
- Every such field is documented as content, never instructions.
- This extends the "deliverables are untrusted" rule from judges to every consumer of the API. It changes no field names.

### Not adopted

- **Human approval before money moves, as an API feature.** The readiness test asks for it, but Holdback's approval is the principal's signed mandate, and machine-speed settlement is the point. Dry run (item 4) gives tools a preview step. Principals who want per-call approval can set a low mandate limit and approve above it outside the protocol.
- **Field selection** (`?fields=`). Responses are small, so we defer it until a measured need appears.

## Alternatives considered

1. **Adopt all of it now, in T-007 plus T-015 (recommended).** On SimChain most items are cheap: middleware, two GET endpoints, a header set and a generator. It sets the API's shape before T-007 hard-codes one. The demo audience, a lab studying agentic commerce, will judge exactly this surface.
2. **Defer to Phase 5, alongside more operators.** The Phase 1 demo drives the SDK, not raw HTTP, so the demo would not miss it. But T-007 would set response shapes with no pagination or versioning rules. Changing those later is a breaking v2, and any MCP server written in between breaks with it.
3. **Make MCP the agent surface and keep REST minimal.** MCP is how many agents will call us. But it is one client of the API, not a replacement. Protocol property 3 requires any operator to serve the API, and MCP tools still need lists, limits and dry runs underneath.
4. **GraphQL for reads.** It gives flexible filters and field selection. But it adds a second contract surface beside `spec/schemas`. Idempotency, signatures and caching fit it poorly, and agents tend to write worse GraphQL than REST calls.

## Consequences

- **Schema v0.5,** which is additive. It adds:
  - `page.schema.json` (items plus `nextCursor`);
  - `operator-status.schema.json`;
  - `dry-run-result.schema.json`;
  - the `rate_limited` problem type;
  - the `x-holdback-untrusted` annotation on existing free-text fields.
  The `spec/README.md` changelog records it.
- **T-007 grows:**
  - list and events-per-commitment endpoints, pagination and rate-limit headers;
  - `validateOnly`, `Request-Id`/`traceparent` and `/v1/status`;
  - SDK `Retry-After` handling and operator ranking.
  This is an estimated one to two days more on SimChain (guessed).
- **New task T-015** (api lane), depending on T-007. It covers the OpenAPI generator, the staleness check in `validate:spec`, the HTTP contract test over `spec/examples`, and `llms.txt`.
- **New fixtures:**
  - `neutrality.operator-rate-limits`: op-1 throttles, the SDK waits once, fails over to op-2, then submits directly, and the hold still settles;
  - `error.dry-run-has-no-effects`: a property test that a `validateOnly` call leaves state, nonces, idempotency records and events unchanged;
  - `attack.untrusted-text-in-response`: an injection string in a deliverable description comes back marked untrusted and never in an instruction field.
- **Cost:** a second document to keep in sync, which the generator and staleness check contain. Pagination cursors must stay opaque so operators can change storage.
- **Operators may differ** in limits and freshness, and `/v1/status` makes those differences visible instead of hiding them.

## Litmus tests

- **Neutrality** (ADR-0001)
  - Every addition is a read, a header or a dry run. None adds authority.
  - A rate limit is a relay refusal, and failover plus direct submission already defeat that (ADR-0005). The new `neutrality.operator-rate-limits` fixture proves it.
  - `/v1/status` lets agents pick live operators instead of trusting one.
  - Passes.
- **The hold** (ADR-0002)
  - A dry run must never reserve funds or bond, consume a nonce, or record an idempotency key. Otherwise it could double-spend a hold or block the real call. The `error.dry-run-has-no-effects` property test enforces this.
  - Pagination and lists read state and never change it.
  - Passes, if that test holds.
- **Defended judgment** (ADR-0006)
  - Dry runs exclude judgment and never expose sealed checks or panel membership, so they cannot be used to probe the panel.
  - Marking party-authored text untrusted carries the injection defense past the judges to every API consumer.
  - Passes, and strengthens it.
