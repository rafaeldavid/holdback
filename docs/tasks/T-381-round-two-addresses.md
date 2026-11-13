# T-381: the Sepolia round deals with two money addresses

- **Lane:** test (the Sepolia round's scenarios), on `contracts-audit-ready`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53); the contract refinement plan's alignment (AL-1's follow-up)
- **Kind:** 4, with one reviewer (Change recipes)
- **Depends on:** T-358 (the two address fields, ADR-0033), T-378 part 1 (PR 403: the prepare routes take `buyer.paymentAddress` and `sellerPayoutAddress`), T-374 (AL-1: the round on the phase-one contracts)
- **Paths this task may touch:** `examples/e2e-*.ts` and their tests, this file. Never: T-379's files (`examples/buyer-signer.ts`, `buy-with-signer.ts`, `seller-adapter.ts`, `audit-deal.ts`, `deal-record.ts`, `agent.ts`, `verify.ts`) or T-378's (`apps/`, `packages/sdk/`)
- **Human gate:** no. The live round on Sepolia runs at the cutover
- **Status:** done (PR 413)
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

All measured, in the worktree, on the lane at `bfe57ed` plus this change, with `contracts/out` built from that commit:

| Command | Result |
| --- | --- |
| `pnpm exec vitest run examples/e2e-round.test.ts` | 7 of 7, none skipped |
| The SimChain run inside it | `results: 1 fail, 2 pass, 3a pass, 3d pass, 6 pass, 10a pass, 12 pass`; scenario 12 has no failed check |
| The anvil run inside it, against the lane's contracts | `results: 1 fail, 2 (pass\|fail), 3a pass, 3d pass, 6 waits, 10a pass, 12 pass`; scenario 12 has no failed check, including "the price reaches the payout address on chain", "the price returns to the payment address on chain" and "no token transfer names a signing address on chain" |
| `examples/e2e-keys`, `e2e-chain`, `e2e-run`, `e2e-settle` tests, `tests/cut-feature-alignment.test.ts`, `tests/ci-gated.test.ts` | 78 of 78 |
| `pnpm typecheck`; `eslint examples tests` | clean |
| The alignment test's known list | unchanged at 87 files: the test passes with the list as it was |

Scenario 1 fails only "a live panel judged" in both runs, as before this change: the local worlds have no model keys.

Not run here: the round's other anvil scenario files (silent, direct, escalation, appeal). They call the two helpers this change touched, `paymentHashOf` and `settledChecks`, with terms whose money addresses equal the signing addresses. There the new code computes the same values as before [inferred from the code].

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

**Done:** scenario 12 in `examples/e2e-scenarios-addresses.ts`, registered in `e2e-scenarios.ts` and run by `e2e-round.test.ts` on SimChain and on anvil.

**For the cutover's live round on Sepolia** (`node examples/e2e-round.ts run 12`):
- The scenario mints the payment address's tokens from the buyer's key, so the buyer key needs Sepolia ETH for one more mint per deal. That is two mints.
- The two money addresses need no Sepolia ETH.
- Their keys derive from `E2E_SEPOLIA_SEED` as `holdback/e2e/buyer-payment` and `holdback/e2e/seller-payout`. `e2e-keys.ts` (`balances`, `plan`) does not list them [measured: they are not in `ROLES`].

**For T-379 (`examples/agent.ts`):** the agent's `agreeAndFund` refuses terms whose payment address is not its own. The round signs the funding with two keys in its own helper (`e2e-run.ts`, `agreeAndFundFrom`). If the agent gains an outside payment signer, the round can call it instead.

**For T-378:** nothing. The scenario uses `appealWindowSec: 0` (`shortWindows`) and the offer route's `buyer.paymentAddress` and `sellerPayoutAddress`. On SimChain it gets the payment address's tokens from `POST /v1/faucet` with that address; the faucet's own `paymentAddress` input would do the same.

**Review** (one reviewer pass): PASS, no Critical or High. Fixed from it:
- L2: the refund deal also checks that no `Transfer` log names a signing address.
- L3: `agreeAndFundFrom` refuses a buyer key that is not the agent's.
- L4: a unit test of `paymentHashOf` with the money addresses apart.

Left, L1: on Sepolia, `signersUntouched` reads wallet balances. A second run of the round on the same seed at the same moment would fail it falsely; the round's lock (`e2e-round.ts`, exit 3) prevents that.

**Not covered:** a reclaim with two addresses in the round. `examples/send-timeout.test.ts` shows on anvil that the contract's reclaim refunds the payment address (T-374).
