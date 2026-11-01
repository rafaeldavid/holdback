# T-029: Operator fee (D33): 1 bp of the price, minimum 0.01 tUSD, paid by the buyer at funding

- **Lane:** api + settlement (sim) + test
- **Phase:** 1 (public demo)
- **Depends on:** T-025, T-026
- **Paths this task may touch:** `docs/decisions/ADR-0023-operator-fee.md` (new), `spec/schemas/` (v0.7: messages, operator status/discovery, event, problem types), `spec/examples/`, `spec/openapi/paths.json` and generated `spec/openapi.json`, `packages/core/` (types, EIP-712 for the new message), `packages/settlement/sim/` (execute the fee transfer, post `fee.operator`), `apps/operator/src/` (prepare slot and check text, 402 policy, fee schedule in discovery and status), `apps/demo-cloud/` (fee schedule from env vars), `examples/` (verify.ts and sign.ts handle the fee slot), `fixtures/scenarios/` (fee and neutrality fixtures), `docs/api.md`, `docs/neutrality.md` (operator row), `docs/architecture.md` (glossary), `site/llms.txt`, `docs/backlog.md` (rows), `docs/tasks/T-029-operator-fee.md`
- **Human gate:** none for the code (D33 confirmed by Rafa on 2026-11-01). Redeploying the two demo Workers with the fee switched on is approved; test tokens only.
- **Status:** todo
- **Agent/session:** —

## Intent

Implement D33 (`docs/decisions-today.md`): an operator fee of max(0.01 tUSD, 1 bp of the price), rounded up in base units, paid by the buyer to the relaying operator as a separate signed transfer in the agree-and-fund call. It is earned at relay and never refunded. An operator that is not paid answers 402 and declines to relay; direct submission to the settlement layer and other operators stay free, so no operator can stop a deal. The fee never enters the hold. Reads, prepare, the faucet and deliveries are free.

Restate this in your own words in this section before writing code.

## Acceptance criteria

- [ ] ADR-0023 written (Accepted, citing D33): the mechanism, alternatives, the three litmus tests, and whether the EIP-712 domain version follows this additive schema bump (decide and record).
- [ ] Schema v0.7: the fee transfer message; `fees.operator` (`to`, `token`, `bps`, `min`, `max` or null, `appliesAt`, `refundable`) in discovery and status; a `fee.operator` event; the `payment_required` problem type. Examples validate (`pnpm validate:spec`).
- [ ] Prepare agree-and-fund returns the third signed slot and check text that names the amount, the rule and "not refunded". The settlement layer executes the transfer and posts `fee.operator`. An unpaid or short relay answers 402 `payment_required` naming the fee; an idempotent replay of a paid agree does not charge twice.
- [ ] `examples/verify.ts` rebuilds and checks the fee message from the published schedule (amount computed by the agent, recipient read from at least two operators) and refuses a fee above the schedule.
- [ ] Fixtures: fee posted; minimum applies on a small deal; bps rounds up; fee kept on refund; 402 on a short fee; paid agree replays; `neutrality.operator-fee-direct-submission-free`.
- [ ] Public demo: the schedule comes from env vars. Deploy with 0 first, run `pnpm demo-cloud:e2e`, then switch on 1 bp / 0.01 tUSD on both nodes and run it again. `site/llms.txt` and `docs/api.md` describe the fee; rebuild `site/` without publishing (the coordinator publishes).
- [ ] `pnpm verify` green. PR opened.

## Out of scope

- A cap, a seller-side fee, per-call payments, an on-chain rulebook fee, cost-plus adjudication fees (backlog).

## Evidence

## Decisions

## Handoff
