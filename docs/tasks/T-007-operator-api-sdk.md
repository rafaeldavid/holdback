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

- `docs/api.md`; ADR-0005; `docs/neutrality.md` §Escape hatch requirements.

## Acceptance criteria

- [ ] Endpoints listed for Phase 1 (registry, faucet, commitments incl. one-shot `/v1/holds`, deliveries, accept, appeals, triggers, reads, key, events SSE).
- [ ] Idempotency middleware with 409 on body mismatch; property test.
- [ ] RFC 9457 problem responses with the listed types.
- [ ] Startup guards: refuse non-`sk_test_` Stripe keys and mainnet chain IDs (unit test).
- [ ] Operator-signed receipts.
- [ ] SDK: operator list failover, direct submit to SimChain, `waitFor`; tests where op-1 refuses and op-2 is offline.
- [ ] Two operator instances can run against one SimChain in tests.

## Out of scope

- MCP wrapper (Phase 6).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
