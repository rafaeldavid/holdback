# T-004: Core types, state machine, EIP-712 types, money, timing rules

- **Lane:** core
- **Phase:** 1
- **Depends on:** T-001
- **Paths this task may touch:** `packages/core/`
- **Human gate:** no (yes if a schema must change)
- **Status:** todo
- **Agent/session:** —

## Intent

Encode the domain so illegal states are unrepresentable and every agent message is a typed EIP-712 struct.

Restate this in your own words in this section before writing code.

## Context

- `spec/schemas/*`; `docs/architecture.md` §State machine, §Identity and signing, §Timing rules.

## Acceptance criteria

- [ ] Types generated or hand-written from `spec/schemas` with a test that round-trips every `spec/examples/*` file.
- [ ] Commitment state as a discriminated union; transition function `step(state, event) -> Result<state, Problem>` covering every row of the transition table; table-driven tests for legal and illegal transitions.
- [ ] `TokenAmount` branded string type with bigint arithmetic helpers; lint rule banning `number` in money code.
- [ ] EIP-712 domain and types for Offer, Agree, FundingAuthorization, Delivery, Accept, Decision, Appeal, Mandate, Revocation; sign/verify helpers with viem; tests against fixed vectors.
- [ ] Timing-rule validator enforcing ordering and rulebook minimums.

## Out of scope

- Persistence, networking.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
