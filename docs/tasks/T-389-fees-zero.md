# T-389: the operators' fee is 0 for the first pilots, on the contract branch

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-029 (the operator fee, ADR-0023, D33)
- **Paths this task may touch:** `apps/demo-cloud/wrangler.op1.jsonc` and `wrangler.op2.jsonc`, `apps/test-agents/wrangler.jsonc`; `apps/operator`, `apps/demo-cloud`, `packages/sdk` and `examples/` only where a zero fee needs a code change, with their tests; this task file
- **Human gate:** no (lands on `contracts-audit-ready`; the switch-over deploy that carries it is T-383's and Rafa's)
- **Status:** in progress
- **Agent/session:** T-389 session, change kind 4

## Intent

Rafa, 2026-11-12: "Product Fees (should be set to 0 now, we cover even gas for first wave of Pilots)."

In my own words: for the first wave of pilots, a buyer pays the price and the adjudication fee, and nothing else. The two demo operator nodes stop charging their relaying fee and its gas quote; Crow's relayer wallet keeps paying the gas. Inputs: the operators' configuration. Output: the operators publish their fee schedule at 0, and every path (prepare, funding, the outside-wallet path, the deal record, the receipts) works with a fee of exactly 0, without a needless signature for a transfer of 0.

Non-goals: the adjudication fee stays as it is (it pays the adjudicator and is part of the signed terms). The fee machinery, its fields and its tests stay: a fee is a parameter (D31), and an operator anyone else runs can still set one. Nothing is deployed here; the live service keeps its fee until the switch-over deploy of the lane.

## Context

- ADR-0023 (operator fee), D33 and its 2026-11-03 amendment (the gas quote), D31 (parametrize, don't restrict).
- `packages/core/src/fee.ts`: the fee is max(min, ceil(price × bps / 10000)), capped at max.
- `apps/demo-cloud/src/world.ts` `operatorFeeFromEnv`: on a chain world the minimum is `OPERATOR_FEE_MIN` + `OPERATOR_FEE_GAS`.

## Where the fee is set and stated (found 2026-11-12, on `origin/contracts-audit-ready` at e4e930c4)

**Set** [measured, by `git grep`]:

| Place | Values | What 0 does |
|---|---|---|
| `apps/demo-cloud/wrangler.op1.jsonc` vars | BPS "1", MIN "10000", GAS "4700000" | The live nodes' schedule. Both nodes read it: op2 serves op1's World Durable Object (its config says so). This is the one change. |
| `apps/demo-cloud/wrangler.op2.jsonc` | none (reads op1's) | Nothing to change. |
| `apps/test-agents/wrangler.jsonc` | none (the agents read `fees.operator` from discovery) | Nothing to change; the agents compute 0 from the published schedule. |
| `apps/operator/src/sim-world.ts` | none by default; a test passes `operatorFee` | Nothing to change. |
| `apps/demo-cloud/test/anvil.ts`, `examples/e2e-world.ts`, `apps/test-agents/src/test-world.ts`, `examples/try.test.ts`, `examples/buyer-signer*.test.ts`, `examples/audit-deal.ts` (its local world), `apps/demo-cloud/src/world.test.ts`, `lanes.test.ts`, `examples/e2e-scenarios-direct.test.ts` | 1 bp, 0.01 minimum, some with the 4.70 gas quote | Test worlds with their own values: they keep proving the machinery with a non-zero fee. Unchanged. |
| deploy script (`apps/demo-cloud/scripts/`) | none set; `deal.ts` only reads the schedule | Nothing to change. |

**Assumed or stated** [measured by reading the code; behaviour at 0 inferred from it, then measured by the new test]:

| Place | At a fee of 0 |
|---|---|
| `apps/operator/src/prepare.ts` (agree-and-fund) | No `operatorFee` body and no `operatorFee.signature` slot when the fee due is 0 (`due.amount !== '0'`). Two slots: the agreement and the funding. The check text drops the fee sentence. |
| `apps/operator/src/server.ts` `chargeFee` | Returns at once when the fee due is 0: no 402. |
| `examples/verify.ts` `verifyPrepared` | At `due === 0n` it rebuilds the body without `operatorFee` and two slots; a fee slot the operator added anyway is refused as unexpected. |
| `examples/agent.ts` `prepareAgreeAndFund` | Sends `operatorFeeNonce` because a schedule is published; prepare ignores it at 0. |
| `examples/buyer-signer.ts` `fundingFiles` (outside wallet), `examples/pay-from-wallet.ts`, `examples/buy-with-signer.ts` | Files are written per slot the payment address signs: only `<address>.funding.typed.json`; no `operator-fee` file and no `--fee` check line. `agreeAndFund` refuses an `operatorFee` signature for a deal that has no fee message. The approved total is price + adjudication fee. |
| `apps/demo-cloud/src/world.ts` `notesFor` | With bps 0 and min "0" the note reads "published at 0 … relay a funded agreement free for now"; with gas "0" the gas sentence is left out. |
| `examples/try.ts` | Prints "operator fee none" on funding, "the zero operator fee" on a refund. |
| `examples/deal-record.ts` | No `fee.operator` event: paid 0, due 0, the check passes. |
| `apps/test-agents/src/buyer.ts`, `seller.ts` | Total = price + adjudication fee + 0. |
| `examples/audit-deal.ts` (rehearsal) | Live mode reads the schedule: fees = adjudication fee only. Its local world keeps 1 bp. |
| `site/llms.txt`, `docs/` | State 1 bp, at least 4.71 tUSDC, and "three slots": false at 0. Owned by T-385 and T-383; the sentences are in Handoff. |

## Acceptance criteria

- [ ] Both nodes' configured fee is 0: basis points, minimum and gas quote.
- [ ] A fee of 0 needs no fee signature: the buyer signs the agreement and the funding only, also from an outside wallet.
- [ ] A new end-to-end test on the local world (anvil) with the pilot's configuration, read from the operators' config: a deal Released and a deal Refunded; the buyer pays the price plus the adjudication fee and nothing else; the seller receives the price.
- [ ] The non-zero fee tests pass with their own values.
- [ ] `pnpm typecheck`, `pnpm lint`, the touched packages' tests with anvil, `pnpm snap`, `pnpm snap --settlement=local` pass.
- [ ] One reviewer has read the change; its blocking findings are fixed.

## Out of scope

- The adjudication fee.
- `docs/`, `site/llms.txt`, `docs/cutover-phase-one.md`, `contracts/`.
- Any deploy.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

- **Publish the schedule at 0 rather than remove it.** Agents keep reading `fees.operator` and compute 0; the note says the nodes relay free for now; switching a fee back on is a config change. Removing the variables would publish no schedule, which reads as "no fee machinery" to an agent.
- **No code change for the zero case.** Every path already skips the fee slot at 0 (table above); the new test measures it.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
