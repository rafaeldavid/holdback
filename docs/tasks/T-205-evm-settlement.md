# T-205: `Settlement` EVM implementation and the differential report

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-202 merged (contract ABI and its list of Phase 4 rules not yet on chain). T-203 green is wanted before the PR merges but does not block starting.
- **Paths this task may touch:** `packages/settlement/evm/` (new), `packages/settlement/src/index.ts` (export only), `packages/settlement/sim/` (only to model `authorizationExpiry`, the backlog row from T-006), `packages/settlement/package.json`, `contracts/script/` (anvil deploy script only), `packages/testkit/src/runner.ts`, `packages/testkit/src/cli.ts`, `packages/testkit/src/pragma.ts` (lift the `--settlement` refusal for `local`), `scripts/verify.ts` (add `forge test` and `snap --settlement=local`), `reports/differential-local.md`, `docs/plan.md` (Scenario index "phase on contract" notes only), `docs/tasks/T-205-evm-settlement.md`
- **Human gate:** none. Anvil only (chain id 31337). The adapter refuses chain id 1 and any other mainnet ID at startup (hard rule). `kind: 'testnet'` against Sepolia is not exercised here; it is T-206's gate.
- **Status:** todo
- **Agent/session:** —

## Intent

Implement the `Settlement` interface (`docs/architecture.md`, `packages/settlement/src/interface.ts`) over the T-202 contracts on a local anvil chain, so the operator, SDK and testkit run unchanged against `kind: 'local'`. Then run every scenario fixture against both SimChain and the contract and report every difference. Agents still see amounts, states and receipts, never chain mechanics. Record gas per deal so D33's fee can be checked against it (D4).

Restate this in your own words in this section before writing code.

## Context

- `docs/architecture.md` (Settlement interface, postings, invariants); `packages/settlement/src/interface.ts`; `packages/settlement/sim/simchain.ts` (the reference).
- `docs/testing.md` (Differential tests row; `pnpm snap --settlement=local`); `packages/testkit/src/runner.ts` (today refuses non-`sim` backends).
- D4 update (gas per deal; one funding and one settlement transaction on the happy path); ADR-0023 (fee posting must look the same on both backends); ADR-0005 and `docs/neutrality.md` escape hatch (direct submission must work: an agent's own transaction, no operator).
- T-202 Decisions (the transaction shape and the fixtures that stay SimChain-only until Phase 4).

## Acceptance criteria

- [ ] `packages/settlement/evm/` implements `submit`, `fund`, `trigger`, `state` and `events` against anvil, mapping contract reverts to the same problem types SimChain returns. Unit tests run with no public network (measured: no RPC URL other than localhost in the test environment).
- [ ] A startup guard refuses chain id 1 and a listed set of mainnet IDs; a unit test shows the refusal.
- [ ] `pnpm snap --settlement=local` green on every fixture whose phase on contract is 1 or 2. Fixtures excluded until Phase 4 (for example `appeal-overturn-bond-pays-seller`) are an explicit list in the runner, each with a reason, printed in the run output; none is silently skipped.
- [ ] `reports/differential-local.md` lists, per fixture, the normalised transcripts' differences (states, balances, event kinds and order, problem types, receipts). Target zero; every remaining difference is explained and either accepted in Decisions or filed back to T-202 as a finding.
- [ ] The `neutrality.*` fixtures pass on `local` with the escape hatch taken as a direct transaction from the agent's own key (measured: no operator in the call path).
- [ ] SimChain models `authorizationExpiry ≥ appealDecideBy + margin` and the differential run agrees with the contract on it.
- [ ] Gas per deal recorded in Evidence for happy path, reject, reclaim, early accept, mutual settlement, appeal and fallback (measured on anvil), with transaction count per deal and an estimated mainnet cost at a stated gas price and ETH price (inferred).
- [ ] `pnpm verify` runs `forge test` and `pnpm snap --settlement=local` and is green. PR opened.

## Out of scope

- Sepolia or any public network (T-206 gate); paymasters and gas sponsorship (Phase 5).
- Contract changes: findings go to T-202 through Handoff.
- Phase 4 economics on chain.

## Evidence

## Decisions

## Handoff
