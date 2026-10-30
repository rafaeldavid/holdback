# T-006: SimChain: escrow rules, permissionless triggers, two-sided key release, bonds

- **Lane:** settlement
- **Phase:** 1
- **Depends on:** T-004, T-014
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
- [ ] Signature, scope, mandate, nonce, deadline checks on every submitted message (reuse T-004); member admission checked under club rulebooks.
- [ ] Adjudicator acceptance gates funding: policy and registry hashes match, bond reserved (100% of price in guaranteed mode); an adjudicator that never accepts leaves nothing held.
- [ ] Decisions are refused unless the seed hashes to `seedCommitment`, the policy and registry hashes match, and the signer is the adjudicator whose turn it is.
- [ ] Key release: decision accept carries key-for-buyer; stored and emitted atomically with release.
- [ ] Bonds and coverage-ratio gate (100% per guaranteed commitment open to appeal; encumbered bond never counted twice); overturn payouts in guaranteed mode; default-outcome compensation, including the default after an escalation times out (appeal adjudicator's bond).
- [ ] Fee routing per the postings table: the fee goes to the adjudicator whose decision settles; early acceptance returns the fee to the buyer; appeal fee paid by the appellant.
- [ ] Early acceptance releases the seller-supplied key for the buyer with the payment.
- [ ] Model `authorizationExpiry` so SimChain and the Phase 2 contract agree (differential tests).
- [ ] fast-check properties: conservation, non-negative balances, settle-once, idempotent resubmission, random interleavings of triggers.
- [ ] Hash-chained event log with replay.
- [ ] `pnpm load`: 1,000 holds, report p50/p95 (measured); 100 concurrent holds on one balance, zero overdrafts.

## Out of scope

- EVM contracts (Phase 2).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
