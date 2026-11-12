# T-381: the Sepolia round deals with two money addresses

- **Lane:** test (the Sepolia round's scenarios), on `contracts-audit-ready`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53); the contract refinement plan's alignment (AL-1's follow-up)
- **Kind:** 4, with one reviewer (Change recipes)
- **Depends on:** T-358 (the two address fields, ADR-0033), T-378 part 1 (PR 403: the prepare routes take `buyer.paymentAddress` and `sellerPayoutAddress`), T-374 (AL-1: the round on the phase-one contracts)
- **Paths this task may touch:** `examples/e2e-*.ts` and their tests, this file. Never: T-379's files (`examples/buyer-signer.ts`, `buy-with-signer.ts`, `seller-adapter.ts`, `audit-deal.ts`, `deal-record.ts`, `agent.ts`, `verify.ts`) or T-378's (`apps/`, `packages/sdk/`)
- **Human gate:** no. The live round on Sepolia runs at the cutover
- **Status:** in progress
- **Agent/session:** the T-374 session, 2026-11-12, branch `t-381-round-two-addresses`

## Intent

Since ADR-0033, a deal's terms name two money addresses apart from the two signing keys. The buyer's payment address funds the hold and receives every refund. The seller's payout address receives every payment. Until now the Sepolia round never opened a deal with either address apart from its signing key, because the operators could not prepare one. T-378 part 1 added those inputs.

This task adds one round scenario where both addresses are apart from their signing keys:
- A release pays the payout address the price, and the seller's signing address receives nothing.
- A reject refunds the price to the payment address, and the buyer's signing address holds no token from the deal at any step.

The scenario runs on SimChain, on anvil in the round's test, and unchanged on Sepolia in the cutover's live round.

**Non-goals:** no change to the operators, the SDK or the client tools. Where those would help, the Handoff says so.

## Context

- ADR-0033 (the payout and payment addresses); `apps/operator/src/prepare.ts` (the offer route's `buyer.paymentAddress` and `sellerPayoutAddress`, and the funding slots the payment address signs).
- `examples/agent.ts` `agreeAndFund` refuses terms whose payment address is not the agent's own (ADR-0033: the payment address signs the funding).
- `examples/verify.ts` `verifyPrepared`: each signer verifies the prepared message and gets only its own slots.

## Acceptance criteria

- [ ] A round scenario with both money addresses apart from the signing keys: a release to the payout address and a reject refunded to the payment address, with the signing addresses' token balances unchanged after every step.
- [ ] It passes on SimChain and on anvil against the lane's contracts, in `examples/e2e-round.test.ts`.
- [ ] The alignment test's known list does not grow.

## Out of scope

- A reclaim with two addresses (the contract's reclaim refunds the same payment address as a reject; `send-timeout.test.ts` shows it on anvil, T-374).
- A payment address that is a contract wallet (ADR-0033 §10, items 16 to 18).

## Evidence

(filled in below)

## Decisions

1. **Scenario 12, in its own file** (`examples/e2e-scenarios-addresses.ts`), with two deals: a release and a reject. The reject is the faster refund path; a reclaim waits for `deliverBy`.
2. **Two derived keys, not new round roles.** `e2e-keys.ts` adds `MONEY_ROLES` (`buyer-payment`, `seller-payout`), derived from the seed as every round key is. They are not in `ROLES`, because every role there is topped up with Sepolia ETH, and neither money address sends a transaction.
3. **The funding has two signers, in the round's own code** (`e2e-run.ts`, `agreeAndFundFrom`). The agent's `agreeAndFund` takes one key. The round verifies the prepared message twice with `verifyPrepared`, once as the signing key (the agreement) and once as the payment address (the funding and the operator fee), and signs each slot with its own key.
4. **The payment address's tokens never pass through the buyer's signing address.** On a chain the buyer's key mints them straight to the payment address (tUSDC is open-mint; the buyer pays gas in Sepolia ETH); on SimChain the faucet grants them to it.
5. **"Holds nothing at any step" is read as "no token moves to or from the signing address".** The round's buyer key is shared with every scenario and holds faucet grants from them, so the scenario compares each signing address's balance with the deal's start after funding, after the delivery and after the outcome. On a chain it also checks that no `Transfer` log of the deal names either signing address.
6. **Two round helpers took the money addresses** (each was written for one address per party):
   - `paymentHashOf` (`e2e-chain.ts`) now uses the payment and payout addresses as the escrow's payer and receiver, as `verify.ts` and the contract do. Before, the CPP check would have read the wrong payment record.
   - `settledChecks` looks for the operator fee from the payment address.

## Handoff

(filled in below)
