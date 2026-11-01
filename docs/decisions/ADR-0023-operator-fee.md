# ADR-0023: Operator fee

- **Status:** Accepted, 2026-11-01 (D33, confirmed by Rafa: "Confirm D33")
- **Date:** 2026-11-01
- **Raised by:** Rafa: fees at the API level, not a protocol fee in the contracts; 0.01% of settled volume, with cost-plus weighed. The research pass of 2026-11-01 behind D33 (`docs/decisions-today.md`) measured what a deal costs ’crow and compared take rates.
- **Changes:** schema v0.7 (additive), `packages/core` (types, EIP-712, fee rule, problem type), `packages/settlement` (interface and SimChain), `packages/sdk` (the agree operation carries the fee), `apps/operator` (prepare, 402, status), `apps/demo-cloud` (schedule from variables), `examples/` (the agent checks the fee), T-029.

## Context

- **An operator has costs and no income.** Per deal about $0.001 of infrastructure, about $0.01 to $0.10 of model calls when judged, and $5 a month fixed (inferred in D33 from list prices and the code's prompt sizes). The adjudication fee already pays the adjudicator (ADR-0014); nothing pays the node that relays.
- **The operator is not a gatekeeper** (ADR-0005, `docs/neutrality.md`). Any fee must price a convenience, never the deal: direct submission to the settlement layer and other operators must stay open.
- **The commitment ID must not depend on the operator.** The seller signs the terms first, often through another operator. A fee inside `CommitmentTerms` would bind one node into the deal (inferred).
- **The hold is neutral custody** (ADR-0002). A fee taken from held funds would let a third party's cut depend on the outcome, and would touch funds neither party alone can move.
- **Prior art** (D33 research pass): Stripe cards 1.5% + €0.25 (EU) to 2.9% + $0.30 (US); escrow.com 0.7% to 2.6% with a $50 minimum; the x402 facilitator $0.001 a settlement after a free tier; Uniswap 1 to 100 bp tiers; Lightning about 1 sat base plus about 1 bp. Every per-transaction rail has a fixed part.

## Decision

### The rule

`fee = max(min, ceil(price × bps / 10000))`, then `min(fee, max)` when the operator publishes a `max`, in base units of the price token (ADR-0022 rule 1: a requirement rounds up). The price is the commitment's `price`, without the adjudication fee. A schedule in another token than the price charges nothing. ’crow's demo nodes publish `bps: 1`, `min: "10000"` (0.01 tUSD), `max: null`.

### The mechanism

1. **Published.** `/v1/status` and `/.well-known/holdback.json` gain `fees.operator`: `to` (the address paid), `token`, `bps`, `min`, `max` (or `null`), `appliesAt` (`agree-and-fund`) and `refundable` (`false`). A node with no schedule omits `fees`.
2. **Prepared.** When the fee due is above zero, `POST /v1/prepare/agree-and-fund` returns a third slot, `operatorFee.signature`: a `TransferAuthorization` (new EIP-712 type) from the buyer to `fees.operator.to`, with `purpose: "operator_fee"`, bound to the commitment ID, valid from the terms' `createdAt` until `fundBy`. The check text names the amount, the rule and "not refunded". When the fee is zero there is no third slot and nothing changes.
3. **Executed by the settlement layer.** The agree body carries the signed message as `operatorFee` beside `fund`. The settlement layer verifies the buyer's signature, that it names this commitment and its buyer, the price token and a live window, spends its nonce, and moves the value from the buyer to `to` as a plain transfer, never through the escrow account, in the same atomic step as the agreement and the funding: all three apply or none does. It posts `fee.operator` (`from`, `to`, `amount`, `postings`).
4. **Enforced by the operator only.** A node whose fee due is above zero answers **402 `payment_required`** to a funded agree that carries no `operatorFee`, or one paid to another address, in another token or for less, and the detail names the amount, the rule and the alternatives. Nothing on the settlement layer requires a fee: another operator relays the same body, and direct submission is free. The SDK already fails over on any refusal. A node relays a fee the buyer signed to someone else unchanged (it is the buyer's signed transfer).
5. **Free:** reads, prepare, the faucet, the seller's deliveries, decisions, appeals, triggers and direct submission. The separate `fund` call and the one-shot `POST /v1/holds` stay free in this version (`docs/backlog.md`).
6. **Earned at relay.** The fee is outside the hold, so no outcome returns it, as with the adjudication fee on a refund.

### Idempotency

The operator's Idempotency-Key replays the stored answer; the settlement layer's submission key replays its result; and the transfer's nonce (`<from>:<nonce>`, the same space as the funding nonce) is spent once. The same signed body under a new key is refused (`invalid_state` on the agreement, before any money moves). A paid agree therefore never charges twice.

### Versions

- **Schema v0.7.** Every `$id`, the `Holdback-Schema-Version` header and `x-holdback-schema-version` move to 0.7. The change is additive: one new message, one optional status field, one event type, one problem type.
- **The EIP-712 domain version stays "0.6", and so does `commitment.schemaVersion`.** They version the signed encoding, which this bump does not change for any existing type: `TransferAuthorization` is new, so no signature made under 0.6 can be read as a different message under 0.7. Moving the domain would invalidate every signature agents hold today and re-pin every agent (`site/llms.txt`, `examples/verify.ts`) for no security gain. The rule from now on: **the domain version and `commitment.schemaVersion` move only when an existing typed-data struct or the terms encoding changes;** additive schema versions leave them. `packages/core/src/eip712.ts`, `docs/architecture.md` and `spec/README.md` say so.

## Alternatives considered

- **A. Volume only, 1 bp.** The market floor, but below cost under about 10 tUSD and unrelated to what the operator does (D33).
- **B. Cost-plus per deal, per judgment or per call.** Honest, but a flat cent never funds the fixed cost without volume, and per-call payment needs its own rail and fights idempotency (D33).
- **C. Hybrid max(min, bps) (chosen).** The floor covers the per-deal cost about ten times; the percentage shares value on large deals; the shape of Stripe, escrow.com and Lightning.
- **Fee in the terms.** Binds one operator into the commitment ID and makes the seller's signature depend on the buyer's relay. Rejected.
- **Fee taken from the hold, or by the escrow contract.** Touches neutral custody and needs the contract to know operators. Rejected; a rulebook fee on chain is a later option (backlog).
- **A separate fee call before or after the agreement.** Not atomic: a fee paid for a relay that then fails, or a deal relayed whose fee then fails. Rejected for the single atomic step.
- **The settlement layer refuses an agree without a fee when relayed by a fee-charging node.** Makes the fee a protocol rule and lets an operator block a deal. Rejected: the fee is enforced only by the node that wants it.

## Consequences

- **Schema v0.7:** `messages.schema.json` adds `TransferAuthorization`; `operator-status.schema.json` adds optional `fees.operator`; `event.schema.json` adds `fee.operator`; the problem type `payment_required` (402) joins `@holdback/core`'s list and the OpenAPI document; `AgreeRequest` gains `operatorFee`; examples `messages.transfer.example.json` and `event.fee-operator.example.json`; the operator status example carries a schedule.
- **Code:** core `operatorFeeDue`; `Submission.agree_and_fund.operatorFee`; SimChain verifies and posts it; the SDK carries it from the agree body; the operator prepares the slot, answers 402 and publishes `fees`; the example agent computes the fee from the schedule two operators serve, refuses a higher one and signs the third slot; the public demo reads `OPERATOR_FEE_BPS`, `OPERATOR_FEE_MIN` and `OPERATOR_FEE_MAX`.
- **Agents written for v0.6** that ignore the schedule still work against a node with no fee and against any node by direct submission; against a fee-charging node, their unpaid agree is answered 402 and their SDK fails over.
- **Fixtures** (named tests over the real operator and SimChain, as the `neutrality.operator-*` ones are): `fee.operator-fee-posted`, `fee.min-applies-below-100`, `fee.bps-rounds-up`, `fee.kept-on-refund`, `error.operator-fee-short-402`, `idempotency.paid-agree-replays`, `neutrality.operator-fee-direct-submission-free`.

## Residual

- **A buyer can avoid the fee** by agreeing and funding in two calls, by the one-shot hold, or by submitting directly. That is the intended escape for direct submission; the first two are backlog rows, since the protocol does not need to close them for neutrality.
- **Mixed operators.** The example agent requires the schedule to be identical at its two operators (true for the demo's two nodes, one operator). An agent using independent operators reads the relay's schedule from it and decides itself (backlog).
- **Regulatory** (not legal advice): the fee never touches held funds and ’crow holds nothing, which reads more like software than an intermediary's cut; state escrow and money-transmitter rules vary; counsel before any real money (D33).

## Litmus tests

- **Neutrality: passes.** The fee conditions only one node's relay, never settlement. The settlement layer accepts the same agree without a fee from anyone; `neutrality.operator-fee-direct-submission-free` shows a fee-charging node answering 402 and the deal still reaching `Held` and `Released` by direct submission. No operator can stop or alter a deal by its fee.
- **The hold: passes.** The fee is a separate transfer from the buyer's own balance, never through the escrow account; the hold's amount, conservation and every payout are unchanged (`fee.kept-on-refund`). The transfer is atomic with the funding, nonce-protected and idempotent.
- **Defended judgment: unaffected.** No judge, check, panel or appeal path changes.

## Amendment: EVM mechanism (Proposed, 2026-11-01, T-202)

On the EVM settlement layer, step 3 of the mechanism ("executed by the settlement layer") changes: the rules contract has no fee code.

- **The transfer** is the price token's own ERC-3009 `transferWithAuthorization(from = buyer, to = fees.operator.to, value, validAfter, validBefore = fundBy, nonce = keccak256(abi.encode(commitmentId, "operator_fee")), signature)`, signed by the buyer under the token's domain. The nonce binds the fee to one commitment and makes it payable once.
- **Atomicity** comes from bundling, not from the contract: the relaying operator sends one transaction that calls the token's `transferWithAuthorization` and then `HoldbackRules.agreeAndFund`, through any stateless batcher (Multicall3 `aggregate3` with `allowFailure = false`, or the operator's own account batching). Both apply or neither does, and the value never passes through CPP's hold or the rules contract.
- **Why not in the contract:** the contract would have to know operators and verify a second token signature on every funding; bundling keeps the fee entirely at the API level (ADR-0023's direction) and costs nothing for deals without a fee. The contract stays under the EIP-170 size limit with no room to spare (T-202, measured).
- **Residual (inferred, not tested in T-202):** anyone who sees the bundle in the mempool can submit the `transferWithAuthorization` alone first. The buyer then pays the fee it signed, the bundle reverts, and the operator relays `agreeAndFund` alone; the attacker gains nothing. T-205 tests the bundle on anvil.
- **The Holdback `TransferAuthorization` message** stays the API-level record the operator checks; on EVM its `signature` is the ERC-3009 one (ADR-0025's pattern for funding). The schema change goes with ADR-0025's follow-up.
