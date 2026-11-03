# T-215: Gas share on small deals

- **Lane:** settlement
- **Phase:** 5
- **Depends on:** T-213 (Sepolia settlement for the demo); feeds the gas sponsorship or paymaster line in Phase 5
- **Paths this task may touch:** `apps/operator/src/` (fee quote), `apps/demo-cloud/` (fee parameters), `packages/settlement/evm/` (gas measurement, relayer-side batching), `site/llms.txt` (how the fee is stated), `spec/schemas/operator-status.schema.json` (only with an ADR and a version bump, or folded into T-033), `docs/decisions-today.md` (D33), `docs/decisions/ADR-0023-operator-fee.md`, `docs/backlog.md`; `contracts/` only if batching moves on chain, under the NoAdmin check
- **Human gate:** yes for the target share (Rafa decides the number); no for the rest, until anything is deployed
- **Status:** todo
- **Agent/session:** none yet

## Intent

With the Sepolia demo's parameters the operator fee has a minimum of 1.51 tUSDC: a 1.50 tUSDC gas quote (about 500,000 gas for a deal's three transactions at a fixed 1 gwei, priced at a fixed and fictional 3,000 tUSDC per test ETH) plus the 0.01 tUSDC relay minimum (D33 as amended on 2026-11-03; ADR-0023). On a 25 tUSDC deal that is about 6% of the price (measured on anvil with those parameters, T-213). Sepolia gas is close to free, but on mainnet this is the real cost of settling a small deal on chain, so it is the honest number to show and the one to bring down before mainnet (Rafa, 2026-11-03).

For scale (inferred): under 1% of a $25 deal is about 83,000 gas at 1 gwei and 3,000 per ETH, less than one funding transaction today (about 234,000 gas, T-209). A target that low probably needs batching across deals or an L2.

Goal: before mainnet, a small deal's gas share is known in gas units, quoted from live prices, credited back when unused, and under a target Rafa sets. Non-goals: no change to the hold or to who can settle (the fee never enters the hold, ADR-0023); no cap on what an operator may charge (D31); no protocol fee in the contracts.

## Context

- `docs/decisions-today.md` D33 and its 2026-11-03 amendment ("Gas should be part of the cost of using the API"); `docs/decisions/ADR-0023-operator-fee.md` ("How it is quoted", "The demo's numbers").
- `docs/tasks/T-213-demo-on-sepolia.md` Evidence (1.51 tUSDC on a 25 tUSDC deal, measured on anvil).
- `docs/tasks/T-209-beacon-verification.md` (gas per path, measured).
- `docs/plan.md` Phase 7 "Minimise gas per deal" and its backlog row ("Minimise gas", Far future); Phase 8's agent-to-agent L2 fragment per escrow.

## Acceptance criteria

- [ ] The gas quote follows live prices: operator parameters for the gas-price source, the ETH-to-token rate source and a safety margin replace the fixed 1 gwei and the fictional 3,000 per ETH (D31), and discovery, the prepare check text and `llms.txt` state how the quote is made.
- [ ] The unused part of a quote is credited or refunded, so a reclaim or a deal that needs fewer transactions does not leave the difference with the operator. This reverses D33's "not refunded" and `refundable: false` in `operator-status.schema.json`, so it starts with an ADR-0023 amendment and a schema version bump (or rides T-033). It covers a deal whose later transactions another operator or the party itself submits (ADR-0005).
- [ ] A published target share for small deals, decided by Rafa (proposed: under 1% of a $25 deal), recorded under D33.
- [ ] Gas units per deal measured on each path (anvil and Sepolia), and the share at $25, $100 and $2,000 computed at stated gas prices and ETH rates, in Evidence, labeled measured, inferred or guessed.
- [ ] The cheapest wins taken and measured: the demo uses the decision that carries the delivery by default, when the decision can land before `deliverBy`, while the seller may still post `deliver` to stop a reclaim (D37; two transactions, 440,005 gas with the fee bundled, T-209); batching many deals' settlements by the relayer (for example one Multicall) before any contract change; Phase 7's other "Minimise gas" ideas and Phase 8's L2 or fragment options weighed against the target with numbers.

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
