# ADR-0017: Agent-ready API

- **Status:** Accepted, 2026-10-30 (D13), as the trimmed Phase 1 subset in this document. Schema v0.5 is applied in a follow-up PR.
- **Date:** 2026-10-30
- **Raised by:** scoring `docs/api.md` against Rafa's article "The Agent Readiness Test for Enterprise Operations Software". It shapes T-006, T-007 and the new T-015.
- **Amended after review:** an independent assessment of the first draft found five problems:
  - a signed dry run leaked a live authorization;
  - the contract test could not pass on placeholder signatures;
  - the open-enum policy contradicted the strict schemas;
  - ordering lists by a party-chosen timestamp let a party pick its own position;
  - the receipt schema was missing.
  This version fixes all five.

## Context

Holdback's users are agents and the small tools people build around them: an MCP server, a dashboard, a reconciliation script. The API is the product surface for all of them (protocol property 3). The readiness test asks 16 yes-or-no questions of an API that agents will use. The current spec already meets questions 3, 4, 6, 7, 9, 11, 13 and 14, and the idempotency half of 15. Those cover RFC 9457 errors, exact money and RFC 3339 time, full current state, the event log, signed webhooks, per-agent signers with scoped mandates, and the hash-chained audit trail (inferred from `docs/api.md` and `spec/schemas`; no API exists yet).

**Gaps:**
- no lists or pagination;
- no published limits;
- no machine-readable API description;
- no dry run;
- no version policy;
- no request IDs;
- no self-description;
- party-authored text is unmarked;
- no read endpoints for clubs, agents or members;
- no receipt schema, though receipts are part of every response.

## Decision

### Phase 1 (T-006, T-007, schema v0.5)

1. **Lists and pagination.**
   - `GET /v1/commitments?party=<address>&role=buyer|seller|adjudicator&escrowState=<state>`.
   - `GET /v1/commitments/{id}/events`.
   - `GET /v1/adjudicators` is paginated.
   - Every collection returns `{ "items": [...], "nextCursor": "<opaque>" | null }`, and `null` means the end. Requests take `?cursor=&limit=`, with a default limit of 50 and a maximum of 200.
   - Order is by event sequence, newest first. It is never `createdAt`, because that is a signed term the parties choose.
2. **Reads for parties to check each other.** `GET /v1/clubs/{id}` (the rulebook behind `rulebookHash`), `GET /v1/agents/{address}` (scope, mandate and revocation), and `GET /v1/clubs/{id}/members/{principal}`.
3. **Throttling.**
   - A throttled request gets 429 with problem type `rate_limited` and `Retry-After` (RFC 9110).
   - The SDK waits at most once, for at most 2 seconds, then fails over to the next operator. The cap stops a hostile operator from stalling a deadline with a large `Retry-After`.
4. **Request IDs and trace context.**
   - Every response carries `Request-Id`, and every problem repeats it in `instance` as `urn:holdback:request:<id>`.
   - Operators accept and log a W3C `traceparent`.
   - Neither ID ever enters signed messages, receipts or the event hash chain.
5. **Version header.**
   - Every response carries `Holdback-Schema-Version`.
   - While the version is 0.x, every contract change bumps the schema version and adds a changelog entry in `spec/README.md`, and nothing is promised stable. Signed types cannot change additively, because an EIP-712 struct hash changes with its fields.
6. **Operator self-description.** `GET /v1/status` returns:
   - the operator ID and its receipt-signing address;
   - the settlement target, with the EIP-712 domain (`chainId`, `verifyingContract`);
   - the API and schema versions;
   - the head event sequence, and its lag behind the settlement layer.
7. **Unsigned dry run.**
   - Every mutating endpoint accepts `?validateOnly=true`. It is a query parameter rather than a body field, as in Google AIP-163, because the body is signed.
   - For party messages (Offer, Agree, Fund, Delivery, EarlyAccept, Appeal) the body is unsigned. The response reports that the signature check was skipped. The SDK's `preview()` runs this before signing, so a preview never hands an operator an authorization it could submit.
   - Adjudicator messages (Acceptance, Decision) and triggers are previewed only when signed. That way the dry run is never a free check of seed guesses.
   - The operator calls `Settlement.validate(...)`, which runs the same guards as submission against the settlement layer's own facts, then discards the result. On SimChain that is the same code path without the commit. In Phase 2 it is `eth_call`.
   - A valid request returns the live response's shape without `receipt`, plus the header `Holdback-Dry-Run: true`. An invalid request returns the same problem the live call would.
   - A dry run must have no effects:
     - it records no idempotency key;
     - it consumes no nonce;
     - it reserves no funds or bond;
     - it emits no event;
     - it submits nothing.
   - It never runs judgment, and never reveals sealed checks or a panel.
8. **Receipts.** `receipt.schema.json` defines a receipt:
   - the operator address;
   - the event sequence and event hash;
   - the commitment ID;
   - an EIP-712 signature.
   An agent verifies a receipt with the address from `/v1/status` and the hash chain.
9. **Untrusted text is marked.**
   - Party-authored string fields carry `"x-holdback-untrusted": true` in `spec/schemas`. These are the deliverable description, criterion descriptions and anchors, regex patterns, appeal grounds and names.
   - Core registers the keyword with Ajv strict.
   - The SDK types these fields as `UntrustedText`.
   - The MCP server (Phase 6) wraps them in T-008's spotlighting delimiters. This carries the "deliverables are untrusted" rule past the judges to every consumer.
10. **New problem types:** `rate_limited`, `not_found` and `invalid_cursor`.

### Phase 1, after T-010 (T-015)

11. **OpenAPI.**
    - `pnpm openapi` generates `spec/openapi.json` from `spec/schemas` plus a paths file. OpenAPI 3.1 embeds JSON Schema 2020-12, so the bodies are not written twice.
    - `pnpm validate:spec` fails when the generated file is stale.
    - The contract test drives T-010's scenario fixtures through an operator over HTTP and checks every response against the document. It does not use `spec/examples`, whose signatures are placeholders.
    - `GET /v1/openapi.json` serves the document, and the operator root serves an `llms.txt` that points to it and to `docs/api.md`.

### Deferred

- **IETF `RateLimit` and `RateLimit-Policy` headers:** wait until the draft is stable.
- **More list filters** (`club`, `appealState`, dates): when the viewer or MCP needs them.
- **`Deprecation` (RFC 9745) and `Sunset` headers:** at v1.0, when an external client exists.
- **Ranking operators in the SDK by `/v1/status`:** ordered failover is what the fixtures test.
- **Standard Webhooks signing headers:** when webhooks are built.
- **x402 and AP2 interop:** with the Phase 6 A2A extension. ERC-3009 funding is the same primitive as x402's EVM exact scheme.
- **Field selection.**

### Not adopted

**Human approval for each payment, as an API feature.** The principal's signed mandate is the standing approval, and machine-speed settlement is the point. The unsigned preview is the "prepare and stop" step for tools that want one. AP2 takes the same position, with signed mandates and no per-call approval.

## Alternatives considered

1. **Adopt the first draft as written.**
   - Its signed dry run hands the operator a live authorization.
   - Its contract test cannot pass.
   - Its open-enum policy contradicts the strict schemas.
   - It pins a protocol document to a moving IETF draft.
2. **Trimmed Phase 1 subset, with the rest scheduled (chosen).** It gets the response shapes right before T-007 hard-codes them, and fixes the preview leak. It costs about 3 days across T-006, T-007, the schema and T-015 (guessed).
3. **Defer everything to Phase 5.** T-007 would hard-code bare arrays and no request IDs, any MCP server written in between would break on the later envelope, and the receipt gap would still block T-007. The demo audience judges exactly this surface.
4. **GraphQL for reads.** It would add a second contract surface beside `spec/schemas`, and idempotency, signatures and caching fit it poorly.

## Consequences

- **Schema v0.5 adds:**
  - `page.schema.json`, `operator-status.schema.json` and `receipt.schema.json`;
  - the three problem types;
  - the `x-holdback-untrusted` annotation, with the keyword registered in `packages/core/src/parse.ts`.
  There is no dry-run schema, because the dry run returns the live shape.
- **T-006** adds `Settlement.validate` with the same guards as submit and no state change, plus the no-effects property test.
- **T-007** adds:
  - the endpoints, headers and envelope above;
  - the unsigned `validateOnly`;
  - `/v1/status`;
  - receipts that conform to the schema;
  - the SDK's capped `Retry-After` handling and `preview()`.
- **T-015** (api lane, after T-007 and T-010) owns the OpenAPI document, its staleness check, the HTTP contract test and `llms.txt`.
- **New fixtures:**
  - `neutrality.operator-rate-limits`: op-1 throttles, the SDK waits once, fails over to op-2, then submits directly, and the hold settles;
  - `error.dry-run-has-no-effects`: a property test that state, nonces, idempotency records and events are unchanged;
  - a schema lint that every party-authored string carries the untrusted marker.
- **Residual risk, recorded in `docs/neutrality.md`:**
  - Reads are unauthenticated, so `?party=` lets anyone profile an address's counterparties and prices in one call.
  - The same data is already public through `/v1/events` and will be on chain in Phase 2.
  - Private commitments are a later design question.
- **Idempotency status code:** the IETF draft returns 422 for a reused key with a different body. We keep 409 and note the difference in `docs/api.md`.

## Litmus tests

- **Neutrality.**
  - Every addition is a read, a header or a dry run, and none adds authority.
  - A rate limit is a relay refusal, which failover and direct submission defeat (ADR-0005). The `neutrality.operator-rate-limits` fixture shows it, and the 2-second cap stops a `Retry-After` stall.
  - The unsigned preview never gives an operator a usable authorization.
  - Passes.
- **The hold.**
  - A dry run must never reserve funds or bond, consume a nonce, or record an idempotency key. The `error.dry-run-has-no-effects` property test enforces this.
  - Lists only read.
  - Passes.
- **Defended judgment.**
  - Dry runs exclude judgment and never expose sealed checks or panels.
  - Adjudicator messages preview only when signed, which closes a seed-guess check.
  - The untrusted marker carries the injection defense to every API consumer.
  - Passes, and strengthens it.

## Amended by ADR-0020 (D16)

- Responses carry a commitment's body only at the disclosure levels that publish it. Phase 1 admits `public` only, so Phase 1 responses are unchanged.
- In Phase 2, reading a private body needs an EIP-712 `ReadToken {viewer, commitmentId, expiresAt, nonce}` in `Authorization: Holdback-EIP712 <token>`, `GET /v1/commitments/{id}/body` serves it, and problem type `unauthorized` is added. Direct submission is unchanged.
- `GET /v1/commitments?party=` lists skeletons for private commitments.
