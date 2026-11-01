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

**Restated (implementer, 2026-11-01).** An operator node may charge for relaying the buyer's funded agreement, and only that. The charge is `max(min, ceil(price × bps / 10000))` in base units of the price token (capped at `max` when an operator sets one), with D33's demo values 1 bp and a minimum of 10000 base units (0.01 tUSD). The buyer pays it with a third signature in `POST /v1/prepare/agree-and-fund`: a `TransferAuthorization` from the buyer to the operator's published fee address, bound to the commitment, carried in the agree body as `operatorFee`. The settlement layer applies it in the same atomic step as the agreement and the funding, as a plain transfer from the buyer to the operator that never touches the escrow account, and logs a `fee.operator` event. Because the hold never contains it, no outcome (release, refund, reclaim, default, mutual settlement) can return it: earned at relay. An operator that publishes a non-zero fee answers 402 `payment_required` to a funded agree that carries no fee to it or too little, and says what is owed; the SDK then fails over to another operator or submits directly, where no operator fee applies, so the fee can price the relay but never block a deal. The schedule is published in `/v1/status` and `/.well-known/holdback.json` as `fees.operator`. A replay under the same Idempotency-Key, or the same signed body again, cannot charge twice (the transfer's nonce is spent once). The example agent computes the fee itself from the schedule two operators serve and refuses a fee slot that asks for more. The public demo reads its schedule from Worker variables: 0 first, then 1 bp / 0.01 tUSD.

**Non-goals.** No cap by default, no seller-side fee, no fee on reads, prepare, the faucet, deliveries, decisions, appeals or direct submission; no per-call payments; no fee inside the escrow contract or the rulebook; no change to how the adjudication fee works; no real money. The separate `fund` call and the one-shot `POST /v1/holds` stay free in this task (backlog).

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
