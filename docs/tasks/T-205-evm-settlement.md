# T-205: `Settlement` EVM implementation and the differential report

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-202 merged (contract ABI and its list of Phase 4 rules not yet on chain). T-203 green is wanted before the PR merges but does not block starting.
- **Paths this task may touch:** `packages/settlement/evm/` (new), `packages/settlement/src/index.ts` (export only), `packages/settlement/sim/` (only to model `authorizationExpiry`, the backlog row from T-006), `packages/settlement/package.json`, `contracts/script/` (anvil deploy script only), `packages/testkit/src/runner.ts`, `packages/testkit/src/cli.ts`, `packages/testkit/src/pragma.ts` (lift the `--settlement` refusal for `local`), `scripts/verify.ts` (add `forge test` and `snap --settlement=local`), `reports/differential-local.md`, `docs/plan.md` (Scenario index "phase on contract" notes only), `docs/tasks/T-205-evm-settlement.md`
- **Human gate:** none. Anvil only (chain id 31337). The adapter refuses chain id 1 and any other mainnet ID at startup (hard rule). `kind: 'testnet'` against Sepolia is not exercised here; it is T-206's gate.
- **Status:** review
- **Agent/session:** implementer (Claude Opus 5.5), worktree branch `t-205-evm-settlement`, 2026-11-01/02

## Intent

Implement the `Settlement` interface (`docs/architecture.md`, `packages/settlement/src/interface.ts`) over the T-202 contracts on a local anvil chain, so the operator, SDK and testkit run unchanged against `kind: 'local'`. Then run every scenario fixture against both SimChain and the contract and report every difference. Agents still see amounts, states and receipts, never chain mechanics. Record gas per deal so D33's fee can be checked against it (D4).

**Restated (implementer, 2026-11-01).** Build `EvmSettlement`, a `Settlement` whose state changes are calls to `HoldbackRules` on anvil (127.0.0.1, chain id 31337). The contract has no Offered, Accepted or Agreed stage (T-202 rule 1). So the adapter collects those three signatures, runs SimChain's pre-funding checks on them, and the contract verifies all of them at `agreeAndFund`. From funding on, each submission is one contract call. A revert is the refusal, mapped to SimChain's problem type, and a mined call is the state change. The read model keeps SimChain's shape. Then drive every scenario fixture through both backends with the same driver, compare normalised transcripts, and write each difference to `reports/differential-local.md`. Model `authorizationExpiry` in SimChain so both refuse the same late capture. Measure gas per deal on anvil, and test the operator-fee bundle (fee transfer and funding in one transaction).

**Non-goals:** Sepolia or any public RPC (T-206); contract changes (findings go back to T-202); Phase 4 economics (those fixtures are on a printed exclusion list); the ADR-0025 schema bump (not needed for this to work, see Decisions); paymasters.

## Context

- `docs/architecture.md` (Settlement interface, postings, invariants); `packages/settlement/src/interface.ts`; `packages/settlement/sim/simchain.ts` (the reference).
- `docs/testing.md` (Differential tests row; `pnpm snap --settlement=local`); `packages/testkit/src/runner.ts` (today refuses non-`sim` backends).
- D4 update (gas per deal; one funding and one settlement transaction on the happy path); ADR-0023 (fee posting must look the same on both backends); ADR-0005 and `docs/neutrality.md` escape hatch (direct submission must work: an agent's own transaction, no operator).
- T-202 Decisions (the transaction shape and the fixtures that stay SimChain-only until Phase 4).

## Acceptance criteria

- [x] `packages/settlement/evm/` implements `submit`, `fund`, `trigger`, `state` and `events` against anvil, mapping contract reverts to the same problem types SimChain returns. Unit tests run with no public network (measured: no RPC URL other than localhost in the test environment).
- [x] A startup guard refuses chain id 1 and a listed set of mainnet IDs; a unit test shows the refusal.
- [x] `pnpm snap --settlement=local` green on every fixture whose phase on contract is 1 or 2. Fixtures excluded until Phase 4 (for example `appeal-overturn-bond-pays-seller`) are an explicit list in the runner, each with a reason, printed in the run output; none is silently skipped.
- [x] `reports/differential-local.md` lists, per fixture, the normalised transcripts' differences (states, balances, event kinds and order, problem types, receipts). Target zero; every remaining difference is explained and either accepted in Decisions or filed back to T-202 as a finding. (Receipts are operator-side and identical by construction; they are not in the normalised transcript.)
- [x] The `neutrality.*` fixtures pass on `local` with the escape hatch taken as a direct transaction from the agent's own key (measured: no operator in the call path).
- [x] SimChain models `authorizationExpiry ≥ appealDecideBy + margin` and the differential run agrees with the contract on it.
- [x] Gas per deal recorded in Evidence for happy path, reject, reclaim, early accept, mutual settlement, appeal and fallback (measured on anvil), with transaction count per deal and an estimated mainnet cost at a stated gas price and ETH price (inferred).
- [x] `pnpm verify` runs `forge test` and `pnpm snap --settlement=local` and is green. PR opened.

## Out of scope

- Sepolia or any public network (T-206 gate); paymasters and gas sponsorship (Phase 5).
- Contract changes: findings go to T-202 through Handoff.
- Phase 4 economics on chain.

## Evidence

**`pnpm verify`.** Green on all eight steps: typecheck, lint, `forge test --root contracts`, test, spec, snap, `snap --settlement=local` and demo (`reports/verify-t-205-evm-settlement.md`). [measured]
- `forge test`: 96 tests in 13 suites pass; `contracts/src` is unchanged. [measured]
- vitest: 2196 tests in 90 files pass. This includes the adapter's 23 tests (guard, revert mapping and 7 anvil integration tests) and the runner's local test; none skipped on this machine. [measured]

**Fixtures on the contract** (`pnpm snap --settlement=local`; full report in `reports/differential-local.md`). [measured]
- **29 of 29 run fixtures pass on the contract.** These are every fixture except the 3 on the exclusion list, including 6 `todo.` fixtures that record today's behaviour.
- **SimChain:** 32 of 32, snapshots unchanged.
- **Excluded until Phase 4:** 3, printed at the top of every local run with a reason each (`LOCAL_EXCLUSIONS` in `packages/testkit/src/runner.ts`). Run on the contract anyway, all three do fail, and only on Phase 4 economics:
  - `neutrality.adjudicator-and-fallback-offline`: the seller's 2,000 compensation from the primary and fallback bonds is not paid;
  - `neutrality.appeal-adjudicator-offline-after-escalation`: the same, from the appeal adjudicator's bond;
  - `honest-seller-survives-judge-noise-on-appeal`: the 25 tUSD appeal fee is not collected.

  On the first two, the contract also goes straight from FallbackJudging or Escalated to Refunded in one call, so there is no Defaulted step (T-202 rule 9).

**Differential: identical states, balances, problem types, final states and invariants on all 29.** [measured]
- 6 transcripts are identical.
- 23 differ in exactly one way: the contract emits no `key.released` for an adjudicator's envelope. SimChain releases one to the primary at delivery, to the fallback at takeover and to the appeal adjudicator at escalation or a party appeal.

**No public network.** [measured]
- `EvmWorld` starts anvil with `--host 127.0.0.1`, and `assertLocalRpc` refuses any other host; a test checks it.
- The only RPC URL in the run is `http://127.0.0.1:<free port>`.

**Startup guard.** `assertSafeChain` refuses chain id 1 and 20 other mainnet IDs (`MAINNET_CHAIN_IDS`); `guard.test.ts` shows the refusal. `EvmWorld.start` and the `EvmSettlement` constructor both call it. [measured]

**Revert mapping.** [measured]
- `errors.test.ts` covers every HoldbackRules and HoldbackBonds error, the token's revert strings and CPP's `AfterAuthorizationExpiry`.
- On anvil:
  - funding signed by the wrong key gives `invalid_signature`;
  - a reclaim before `deliverBy` gives `invalid_state`;
  - a second decision gives `invalid_state`;
  - a late early accept gives `deadline_passed`.
- A refused call is simulated, never sent: the transaction list shows no transaction for it.

**Escape hatch.** [measured]
- **Neutrality fixtures.** A `via: direct` call is sent and paid for by the acting agent's own key. In `neutrality.operator-refuses` and `neutrality.operator-offline`, the delivery is sent by `tidewater-seller` and the decision by `bench-a`, with no operator in the path (transaction tables in the report).
- **Anvil test.** The buyer reclaims with its own key: `tx.from` is the buyer and `via` is `direct`.

**`authorizationExpiry`.** [measured]
- **SimChain** refuses an early accept, or a mutual settlement that pays the seller, at `fallbackBy + appealDecideSec + margin` with `deadline_passed`. One second earlier it allows them, and a full refund still works after expiry (`sim/expiry.test.ts`, 4 tests).
- **The contract on anvil** refuses the same calls at the same second (`AfterAuthorizationExpiry`, mapped to `deadline_passed`), allows the early accept one second earlier, and lets the all-to-buyer mutual settlement through (a void).

**Operator-fee bundle** (ADR-0023, EVM mechanism). One transaction runs the token's `transferWithAuthorization` (buyer to op-1, 1 tUSD) and `agreeAndFund` through `LocalMulticall3.aggregate3`. [measured]
- **When the funding signature is wrong,** the whole transaction is refused: the operator's balance stays 0, the buyer's is unchanged, and the state stays AcceptedByAdjudicator.
- **When valid:** one transaction, the operator holds 1 tUSD, the buyer pays price + fee + 1 tUSD, and the state is Held. Events are `fee.operator` then `hold.funded`.
- **Gas:** 310,122 for the bundle, against 245,149 for plain funding, so about 65k more.

**Gas per deal on anvil** (D4), from `node packages/settlement/dist/evm/gas.js`.
- Method: receipt `gasUsed`, steady state (a warm-up deal runs first), mock ERC-3009 token, ERC-3009 funding. [measured]
- Mainnet cost assumes 1 gwei and $3,000/ETH. [inferred: the prices are assumed]

| Path | Tx | Gas per transaction | Total gas | ≈ USD at 1 gwei, $3,000/ETH |
| --- | --- | --- | --- | --- |
| Happy path (decision carries the delivery) | 2 | agreeAndFund 245,149 + decide 151,435 | 396,584 | $1.19 |
| Happy path with an on-chain `deliver` (what the fixtures do) | 3 | 245,137 + deliver 61,326 + decide 141,276 | 447,739 | $1.34 |
| Reject (fee-only capture + void) | 2 | 245,113 + decide 151,158 | 396,271 | $1.19 |
| Reclaim | 2 | 245,125 + reclaim 103,541 | 348,666 | $1.05 |
| Early accept (delivery carried) | 2 | 245,089 + earlyAccept 160,733 | 405,822 | $1.22 |
| Mutual settlement (70/30, before delivery) | 2 | 245,149 + mutualSettle 155,484 | 400,633 | $1.20 |
| Party appeal (reject, buyer appeals, upheld) | 4 | 245,149 + decide 151,158 + fileAppeal 108,368 + decide 97,925 | 602,600 | $1.81 |
| Escalation, then the appeal adjudicator decides | 3 | 245,125 + decide 123,945 + decide 165,305 | 534,375 | $1.60 |
| Fallback (primary silent, fallback accepts) | 4 | 245,137 + deliver 61,326 + triggerFallback 80,099 + decide 170,463 | 557,025 | $1.67 |
| Default (primary and fallback silent) | 4 | 245,137 + deliver 61,302 + triggerFallback 80,087 + triggerDefault 107,710 | 494,236 | $1.48 |
| Operator fee bundled with funding, then accept | 2 | bundle 310,122 + decide 151,411 | 461,533 | $1.38 |

- **Against T-202:** the anvil receipts are within about 0.2% of its in-process `--isolate` figures (happy path 396,584 here, 395,831 there). [measured]
- **Against D33:** D33's fee on a $2,000 deal is $0.20, and the operator's own `agreeAndFund` gas alone is about $0.74 at these prices (backlog row). [inferred]

**Time.** `pnpm snap --settlement=local` takes 16 s for 32 fixtures, each running on both backends. One anvil process and one deployment serve the whole run; each fixture reverts to a snapshot. [measured]

## Decisions

1. **Pre-funding stages live in the adapter, checked as SimChain checks them.**
   - Offer, acceptance and Agree are collected by `EvmSettlement` and run through core `offer` and `step`, with mandate scope, membership, daily spend and nonces. The contract then verifies all three signatures at `agreeAndFund`.
   - This keeps every pre-funding refusal (scope, coverage, invalid signature) at the same step and with the same problem type.
   - Their events carry `source: 'adapter'`.
   - The coverage check at acceptance is a read of `freeOf`, not a reservation. The concurrent case is a backlog row.
2. **The contract is the authority from funding on.**
   - Every call is simulated on the pending block at the scenario second. A revert is the refusal and nothing is sent. Otherwise the call is mined at that second.
   - A core mirror is stepped before sending. The adapter throws a divergence error if core refuses what the contract accepts, or if the mirror's state is not the on-chain stage afterwards. No fixture hit either.
3. **The ADR-0025 schema change is not needed for T-205.**
   - The token address (lowercase, 42 characters) already fits `TokenId`'s pattern.
   - `EvmSettlement` reads `FundingAuthorization` scheme `erc3009` as the token-domain ERC-3009 `ReceiveWithAuthorization` signature to CPP's collector, and checks its fields against the derived values: nonce = payer-agnostic PaymentInfo hash, `validAfter` = epoch, value = price + fee.
   - The cost: one scheme value means a different signature on each backend until v0.9 adds `cpp-erc3009`. The backlog row is updated; ADR-0025 stays Proposed.
4. **Tokens in fixtures.** The driver rewrites the fixtures' `tUSD` to the deployed token's address in the club rulebook (with the rulebook hash recomputed), the terms template, the stub terms, mandates, appeal bonds and payouts. No fixture file changes.
5. **Judgments are reused across backends.**
   - The judge input hashes the commitment, whose ID changes with the token identifier, so the recorded verdicts cannot replay on EVM.
   - Judgment is off chain and does not depend on settlement, so the local run takes the SimChain run's judgment for the same commitment number, role and attempt.
   - Any difference is therefore settlement's.
6. **Accepted difference: adjudicator envelopes are not settlement events on EVM.**
   - The contract never holds envelopes (T-202 decision 3), so the only `key.released` on chain is the buyer's, in the paying transaction.
   - This is the 23-fixture difference above.
   - Not filed to T-202, because it is the T-202 design. It is a backlog row for the adjudicator service, which reads its envelope through `keysFor`.
7. **Accepted difference: default is one call** (T-202 rule 9, T-204 finding 2).
   - `trigger_default` on EVM refunds at once. `apply_default` is then an accepted no-op with no transaction.
   - Visible only in the excluded fixtures, because elsewhere default is refused in a settled state on both backends.
8. **`authorizationExpiry` in SimChain** (backlog row from T-006, now done).
   - `Genesis.expiryMarginSec`, default 86,400 s, the local deployment's `EXPIRY_MARGIN`.
   - Refused at or after expiry: an early accept, and a mutual settlement that pays anyone but the buyer or a fee share. A full refund still works, as CPP's `void` does.
   - Decisions always land before expiry, so nothing else changes. All 32 SimChain snapshots are unchanged.
9. **Gas payer = relay.**
   - `via: <operator>` sends from the operator's key.
   - `via: direct` sends from the acting agent's own key: the escape hatch, measured.
   - A permissionless trigger with no named agent comes from an unrelated account.
   - Setup (minting, bond deposits, each party's one-time allowance to HoldbackBonds for appeal bonds) uses anvil impersonation and never counts as gas per deal.
10. **Two anvil-only helper contracts in `contracts/script/`:**
    - `LocalUSDC`: CPP's mock plus USDC's `transferWithAuthorization`, which the mock lacks and the operator fee needs.
    - `LocalMulticall3`: Multicall3's `aggregate3` ABI, which is not vendored.

    Permit2 is not deployed, so only ERC-3009 funding runs. The contracts are deployed from `contracts/out` by `EvmWorld`, not by a `forge script`, so no broadcast exists anywhere.
11. **The two-transaction happy path needs an EVM-only call** (`EvmSettlement.carryDelivery`).
    - The `Settlement` interface has no "carried delivery" submission, so fixtures post `deliver`, which costs 3 transactions and +51k gas.
    - Backlog row: an interface change.
12. **The local snapshot is the SimChain comparison.** `pnpm snap --settlement=local` does not compare `.expect.md`, because IDs, hashes and the token differ by design. A fixture passes when its expectations hold on the contract. The transcript diff goes to the report on a full run.

## Handoff

**Done:**
- `packages/settlement/evm/`: `world.ts` (anvil and deployment), `evm-settlement.ts`, `encode.ts`, `errors.ts`, `guard.ts`, `gas.ts`, `testing.ts`, with tests.
- The `./evm` export; `authorizationExpiry` in `sim/simchain.ts` and `sim/expiry.test.ts`.
- `contracts/script/LocalUSDC.sol` and `LocalMulticall3.sol`.
- `pnpm snap --settlement=local`, with the exclusion list and the differential report.
- `scripts/verify.ts` runs `forge test` and `snap:local`.
- `reports/differential-local.md` is committed, force-added because `reports/` is gitignored.
- Plan Scenario index notes; backlog rows under Settlement layer.

**Outside the listed paths, and why:**
- **`packages/testkit/src/stub-settlement.ts`.** The fixture driver was hard-wired to SimChain, and no runner change could run fixtures on the contract without a backend seam. With the seam, the sim path is unchanged: 32 of 32 snapshots are byte-identical.
- **`packages/testkit/src/runner.test.ts`:** tests for the new behaviour.
- **`packages/settlement/tsconfig.json`:** `include` gains `evm`.
- **`vitest.config.ts`:** adds the `packages/settlement/evm/**/*.test.ts` pattern, without which the adapter's tests never run.
- **`docs/backlog.md`:** rows, at the coordinator's request.
- **Not touched:** `pragma.ts` and `cli.ts` (`local` already parsed; the refusal lived in `runner.ts`).

**For T-203 and CI:** CI has no Foundry. The anvil tests skip there, with the reason in the test name. Installing foundry in the test job (T-203's CI work) makes them run. `pnpm verify` runs them locally.

**For T-202 and T-206 (findings; no contract change made):**
- The only differences are designed ones (decisions 6 and 7).
- The adjudicator service needs an off-chain envelope source on EVM.
- D33 against L1 gas: an operator relaying `agreeAndFund` pays about 245k gas.
- `EXPIRY_MARGIN` is still a constant. SimChain now models it, so a change must update both.

**For the schema follow-up (ADR-0025 v0.9):**
- Add `cpp-erc3009` and `cpp-permit2`.
- Then `EvmSettlement.fund` should require them instead of reading `erc3009`.
- Move `paymentInfo`, `payerAgnosticHash` and `receiveDigest` from `evm/encode.ts` into `core`.
