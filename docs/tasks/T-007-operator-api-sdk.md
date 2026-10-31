# T-007: Operator API and SDK with failover and direct submit

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-006
- **Paths this task may touch:** `apps/operator/`, `packages/sdk/`
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-007-operator-api`

## Intent

Expose the REST API in `docs/api.md` on top of `Settlement`, and an SDK that fails over across operators and falls back to direct submission.

Restated (implementer): an operator node is a thin HTTP relay over the `Settlement` interface. It turns each mutating request into the signed submissions T-006 defined, adds conveniences (idempotent replay, request IDs, version header, page envelope, dry run, signed receipts, reads, an event stream, status) and never adds authority: it authors no message, and anything it relays is equally valid when an agent submits it straight to SimChain. The SDK is the agent's side: typed calls, an ordered operator list it fails over across (one capped `Retry-After` wait), and the escape hatch that submits the same messages under the same idempotency keys directly to the settlement layer, so a call one operator half-relayed completes and never doubles. Two operators share one SimChain in tests; one refuses, one is offline, and the deal still settles.

Non-goals: run-time registration of clubs, agents, members and adjudicators (SimChain reads them from genesis; the GET reads serve genesis), quotes, webhooks, read tokens and private disclosure levels (Phase 2), disputes (Phase 4), the MCP wrapper, OpenAPI (T-015), persistence across operator restarts. Honest parties until the demo works; edge cases go to `docs/backlog.md`.

## Context

- `docs/api.md`; ADR-0005; ADR-0017 (agent-ready API, Phase 1 subset); ADR-0019 (mutual settlement); `docs/neutrality.md` §Escape hatch requirements.

## Acceptance criteria

- [x] Endpoints listed for Phase 1 (registry, club membership, adjudicator discovery, faucet, commitments incl. adjudicator acceptance and one-shot `/v1/holds`, deliveries, early accept, decisions, appeals, triggers, reads, key, events SSE). Registry, membership and adjudicators are served as genesis reads; run-time registration writes are a non-goal (`docs/backlog.md`).
- [x] Idempotency middleware with 409 on body mismatch; property test.
- [x] RFC 9457 problem responses with the listed types.
- [x] Startup guards: refuse non-`sk_test_` Stripe keys and mainnet chain IDs (unit test).
- [x] Operator-signed receipts.
- [x] SDK: operator list failover, direct submit to SimChain, `waitFor`; tests where op-1 refuses and op-2 is offline.
- [x] Two operator instances can run against one SimChain in tests.
- [x] ADR-0017 Phase 1 subset:
  - every collection returns the `page.schema.json` envelope, ordered by event sequence;
  - `GET /v1/commitments?party&role&escrowState`, `GET /v1/commitments/{id}/events`, paginated `/v1/adjudicators`;
  - `GET /v1/clubs/{id}`, `GET /v1/agents/{address}`, `GET /v1/clubs/{id}/members/{principal}`;
  - `Request-Id` on every response and in problem `instance`; `traceparent` accepted and logged, never signed; `Holdback-Schema-Version` on every response;
  - 429 `rate_limited` with `Retry-After`; the SDK waits at most once, for at most 2 seconds, then fails over (fixture `neutrality.operator-rate-limits`);
  - `GET /v1/status` per `operator-status.schema.json`, including the EIP-712 domain and the receipt-signing address;
  - `?validateOnly=true` through `Settlement.validate`, unsigned for party messages, with the live response shape minus `receipt` and `Holdback-Dry-Run: true`; SDK `preview()`;
  - receipts conform to `receipt.schema.json`;
  - problem types `not_found` and `invalid_cursor`.
- [x] `POST /v1/commitments/{id}/settlements` accepts a co-signed `MutualSettlement` with `payouts: [{to, amount}]` (one to eight, summing to the price; D23), with `?validateOnly=true` (ADR-0019); the SDK exposes `settle()` and `preview()` for it.
- [x] SDK decrypt helper (ADR-0021): returns `{ plaintext, screen, removed }`, hands the agent a normalized view by default with the raw bytes on request, and always verifies the plaintext hash on the raw bytes.
- [x] Privacy (ADR-0020): responses include a commitment's body only at disclosure levels that publish it (Phase 1: `public`). Read authentication (`ReadToken`, `unauthorized`) is out of scope until Phase 2.

- [x] Finality (D20): `GET /v1/commitments/{id}` serves `settledAt` and `finalAt`. SDK `waitFor('final')` if T-012's agents need it; otherwise it may slip to API v0.3.
## Out of scope

- MCP wrapper (Phase 6).
- OpenAPI document and HTTP contract test (T-015). RateLimit headers, Deprecation and Sunset headers, SDK ranking of operators (deferred by ADR-0017).

## Evidence

- **Measured:** `pnpm verify` on a clean tree at `f1f300b` (after the review fixes): typecheck, lint, test (1657 tests), spec and snap pass; demo is a placeholder (T-013). Report `reports/verify-t-007-operator-api.md`.
- **Measured (review fixes, test first):** commit `c3b4234` added the tests first, and 6 failed against the old code, plus `guards.test.ts`, which could not import `TEST_CHAIN_IDS`. The cases: chain IDs as an allowlist (100, 250, 5000, 42220, 81457, 1101 and unknown IDs fail closed; opt-in through `HOLDBACK_ALLOW_TEST_CHAIN_IDS`), every `STRIPE_*` key scanned with `pk_test_` allowed, guards inside the `Operator` constructor, a malformed body returning 400 rather than 500, and `?validateOnly=` other than `true` or `false` returning 400. An unsigned live `EarlyAccept` returns 400, and a zero or wrong signature returns 401, each with `SimChain.digest()` unchanged; these already passed.
- **Measured (test first):** commit `4a4ba63` added the operator, idempotency and decrypt tests before any implementation; run against it, every new suite failed (missing modules; 25 failing tests in `operator.test.ts` and `neutrality.test.ts`). The SDK client tests (`add185c`) likewise preceded `client.ts` (`b68cfce`).
- **Measured (mutation):** `node apps/operator/scripts/mutants.mjs` breaks 27 guards one at a time: 8 idempotency, 7 failover, 1 receipt signer, 7 startup guards, 2 shape-before-throttle and 2 `validateOnly`. All 27 are killed, and each file is restored in a `finally`. One equivalent mutant ("case-insensitive true", unreachable behind the strict check) was replaced by "false runs as a dry run", which the strengthened `validateOnly=false` test kills.
- **Measured:** two operators on one SimChain (`apps/operator/src/neutrality.test.ts`). op-1 refuses: the deal settles through op-2. op-1 refuses and op-2 is offline: the SDK submits directly and the deal reaches `Released`. op-1 throttles: the SDK waits once (at most 2 s), fails over to op-2, then goes direct after op-2 stops, and the hold releases (`neutrality.operator-rate-limits`). op-1 relays a one-shot hold and drops the response: op-2, or the direct path, completes it under the same key and `hold.funded` appears once.
- **Measured:** `fast-check` property (200 runs) over sequential and concurrent calls: each key runs its handler once, the same body replays the stored response, another body is a conflict. Over HTTP, a repeat leaves the event log unchanged and another body returns 409 `idempotency_conflict`.
- **Measured:** receipts parse against `receipt.schema.json` and verify against `receiptSigner` from `GET /v1/status`, which parses against `operator-status.schema.json`. Collections parse against `page.schema.json`, newest first, with `invalid_cursor` for a bad cursor.
- **Measured:** a dry run of an unsigned `EarlyAccept` and of an unsigned `MutualSettlement` returns the target state with `Holdback-Dry-Run: true` and `Holdback-Signature-Check: skipped`, without `receipt`, and leaves `SimChain.digest()` and the log unchanged.
- **Inferred:** the privacy criterion holds because Phase 1 admits `public` commitments only (core parser and SimChain refuse other levels); the only read that carries terms is the `commitment.offered` event.
- **Guessed:** latency against the p95 ≤ 300 ms target for `/v1/holds` was not measured; the in-process tests complete in tens of milliseconds.

## Decisions

- The operator types itself over the `Settlement` interface plus a `Registry` (`simRegistry(chain)` for SimChain), so the Phase 2 EVM settlement plugs in without operator changes.
- The operator relays the SDK's own operation table (`packages/sdk/src/operations.ts`): one HTTP route per operation, the same submissions, and settlement keys derived from the caller's `Idempotency-Key`. That is what lets op-2 or the direct path finish a call op-1 half-relayed without doubling it.
- Idempotency records store successful responses only, like SimChain's; a refused call can be corrected and retried under its key. Recorded in `docs/backlog.md`.
- Problem `type` is the bare token (`not_found`), a relative URI reference under RFC 9457. Status mapping: 400 terms and cursor, 401 signature, 403 authority, 404, 409 state, nonce, deadline and idempotency, 413, 422 others, 429.
- Live bodies are checked against `spec/schemas` before relay. Dry-run bodies are checked for shape with placeholder signatures and then validated unsigned.
- Receipts: a mutation's receipt covers its last event. `GET .../receipts` also signs receipts for indexed events the node did not relay (ADR-0017: "relayed or indexed").
- `GET /v1/commitments/{id}/key` takes `?recipient=` with no signed request; the envelopes are already public in `key.released` events. Signed requests wait for read authentication (Phase 2).
- The SDK decrypt helper depends on `@holdback/judgment` for `normalizeText` and `screen`, so the agent sees the same normalized view and report the judges did.

## Handoff

- PR 41 targets `main` (PR 38 merged; `origin/main` merged in at `6eb6bed`, verify passes there with 1664 tests and 27 of 27 mutants killed).
- T-012 (agents) and T-013 (demo): start operators in process with `startOperator({ settlement, registry: simRegistry(chain), signerKey, operatorId, env: process.env })`, and use `new Holdback({ operators, settlement: chain })`. There is no operator binary yet (backlog).
- Fixtures lane: `neutrality.operator-refuses`, `-offline` and `-rate-limits` and `error.dry-run-has-no-effects` exist as vitest cases only; porting them to `.scenario.yaml` needs testkit to drive HTTP operators (backlog).
- Not served yet: judgment record, quotes, webhooks, audit verify, publish, disputes (backlog, with phases).
