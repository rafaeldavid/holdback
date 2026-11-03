# T-215: Gas share on small deals

- **Lane:** settlement
- **Phase:** 5
- **Depends on:** T-213 (Sepolia settlement for the demo); feeds the gas sponsorship or paymaster line in Phase 5
- **Paths this task may touch:** `apps/operator/src/` (fee quote), `apps/demo-cloud/` (fee parameters), `packages/settlement/evm/` (gas measurement), `site/llms.txt` (how the fee is stated), `docs/decisions-today.md` (D33), `docs/decisions/ADR-0023-operator-fee.md`, `docs/backlog.md`
- **Human gate:** yes for the target share (Rafa decides the number); no for the rest, until anything is deployed
- **Status:** todo
- **Agent/session:** none yet

## Intent

On the Sepolia demo the operator fee has a minimum of 1.51 tUSDC: a 1.50 tUSDC gas quote (about 500,000 gas for a deal's three transactions at a fixed 1 gwei, priced at a fixed and fictional 3,000 tUSDC per test ETH) plus the 0.01 tUSDC relay minimum (D33 as amended on 2026-11-03; ADR-0023). On a 25 tUSDC deal that is about 6% of the price (measured on the demo's numbers). Sepolia gas is close to free today, but on mainnet this is the real cost of settling a small deal on chain, so it is the honest number to show and the one to bring down before mainnet (Rafa, 2026-11-03).

Goal: before mainnet, a small deal's gas share is measured, quoted from the live gas price, refunded when unused, and under a target Rafa sets. Non-goals: no change to the hold or to who can settle (the fee never enters the hold, ADR-0023); no cap on what an operator may charge (D31); no protocol fee in the contracts.

## Context

- `docs/decisions-today.md` D33 and its 2026-11-03 amendment ("Gas should be part of the cost of using the API"); `docs/decisions/ADR-0023-operator-fee.md` ("How it is quoted", "The demo's numbers").
- `docs/tasks/T-213-demo-on-sepolia.md` Evidence (1.51 tUSDC on a 25 tUSDC deal, measured on anvil).
- `docs/tasks/T-209-beacon-verification.md` (gas per path, measured).
- `docs/plan.md` Phase 7 "Minimise gas per deal" and its backlog row ("Minimise gas", Far future); Phase 8's agent-to-agent L2 fragment per escrow.

## Acceptance criteria

- [ ] The gas quote follows the live gas price: an operator parameter for the source and a safety margin replaces the fixed 1 gwei, and discovery, the prepare check text and `llms.txt` state how the quote is made.
- [ ] The unused part of a quote is credited or refunded: a reclaim or a deal that needs fewer transactions does not leave the difference with the operator, or the terms say plainly that it does. Proposed in an ADR-0023 amendment first.
- [ ] A published target share for small deals, decided by Rafa (proposed: under 1% of a $25 deal), recorded under D33, with the measured share against it on the testnet.
- [ ] The cheapest wins pulled forward from Phase 7 "Minimise gas" and measured: batching many deals' settlements, and the decision carrying the delivery on every path; the L2 or fragment options in Phase 8 weighed against the target with numbers.
- [ ] Gas per deal and the resulting share at $25, $100 and $2,000 recorded in Evidence, labeled measured, inferred or guessed.

## Out of scope

- Mainnet deployment (a separate gate for Rafa after an audit, D4).
- A protocol-level fee or a fee inside the hold.
- Choosing the L2 or fragment design; that is Phase 8's research.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
