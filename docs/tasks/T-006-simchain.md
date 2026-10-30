# T-006: SimChain: escrow rules, permissionless triggers, two-sided key release, bonds

- **Lane:** settlement
- **Phase:** 1
- **Depends on:** T-004
- **Paths this task may touch:** `packages/settlement/sim/`, `packages/settlement/src/interface.ts`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Implement the `Settlement` interface in-process with the exact rules the contract will enforce, so the demo and fixtures run deterministically.

Restate this in your own words in this section before writing code.

## Context

- `docs/architecture.md` §Hold and settlement postings, §Settlement interface, §Two-sided hold; ADR-0002, ADR-0007, ADR-0012; `docs/neutrality.md`.

## Acceptance criteria

- [ ] All postings in the table implemented; settle-once guard; permissionless triggers (expire-offer, reclaim, fallback, default, appeal-expiry, settle).
- [ ] Signature, scope, mandate, nonce, deadline checks on every submitted message (reuse T-004).
- [ ] Key release: decision accept carries key-for-buyer; stored and emitted atomically with release.
- [ ] Bonds and coverage-ratio gate; overturn payouts in both settlement modes; default-outcome compensation.
- [ ] fast-check properties: conservation, non-negative balances, settle-once, idempotent resubmission, random interleavings of triggers.
- [ ] Hash-chained event log with replay.
- [ ] `pnpm load`: 1,000 holds, report p50/p95 (measured); 100 concurrent holds on one balance, zero overdrafts.

## Out of scope

- EVM contracts (Phase 2).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
