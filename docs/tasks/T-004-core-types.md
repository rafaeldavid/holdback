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
- [ ] EIP-712 domain (version 0.4) and types for every message in `messages.schema.json` plus Delivery, Appeal and Mandate; the commitment ID hashes terms only (no acceptance, no signatures); sign/verify helpers with viem; tests against fixed vectors.
- [ ] Timing-rule validator enforcing ordering and rulebook minimums.
- [ ] State machine per `docs/architecture.md` (ADR-0016): an escrow-state union and a separate appeal-state union; `AcceptedByAdjudicator` before `Agreed`; `Delivered → FallbackJudging` at `judgeBy`; escalation not appealable. Phase 1 types admit only `guaranteed_on_decision` and `maxSubmissions = 1`.
- [ ] Types for schema v0.4, including `adjudication.registryHash`, `adjudication.policyHash`, the adjudicator acceptance and the split verdict hashes; a keccak256 helper over RFC 8785 canonical JSON with fixed test vectors.

## Out of scope

- Persistence, networking.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
