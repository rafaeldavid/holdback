# T-035: Fix the anvil gas-per-deal stall at its root

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `packages/settlement/evm/`, `packages/testkit/src/` (timeouts only), `apps/demo/agents/` (timeouts only), `vitest.config.*` (testTimeout only), `docs/tasks/T-035-anvil-receipt-stall.md`, `docs/backlog.md` (close the flaky-timeout rows)
- **Human gate:** no
- **Status:** done (PR 158)
- **Agent/session:** Claude Code side session of the 2026-11-03 docs-log session, branch `t-035-anvil-receipt-stall`

## Intent

The gas-per-deal anvil test normally takes about 10.5 s but stalled to 180 s on CI twice on 2026-11-02 (PRs 77 and 83). PR 84 raised its limit to 420 s, which only delays the report. The likely cause (inferred, `docs/reviews/2026-11-02-dev-velocity.md` §2.3): viem's `waitForTransactionReceipt` re-checks only on a new block, and anvil in automine produces none after a missed first check, so the wait sleeps until viem's own 180 s timeout. Confirm or refute it, fix it, and stop using tight per-test timeouts as correctness bounds.

## Acceptance criteria

- [x] Diagnosis confirmed or refuted with evidence (a reproduction loop, logs, or viem source). (PR 158; confirmed, with one race inferred; Evidence below.)
- [x] The receipt wait cannot stall (for example: poll `getTransactionReceipt` on an interval, or use anvil's synchronous receipt); the gas test split by path so one slow path is visible; the 420 s bump reverted to a tight bound. (PR 158.)
- [x] The testkit judgment and demo determinism timeouts under load (backlog rows) fixed or given a justified `testTimeout`; a global `testTimeout` of about 30 s where tests share a default. (PR 113, commit `89ad1b9`; Evidence below.)
- [x] 50 consecutive local runs of the gas test without a stall (measured), `pnpm verify` and CI pass. (PR 158; Evidence below.)

## Evidence

Criterion 3, done in PR 113 (2026-11-03):
- **Measured:** commit `89ad1b9` sets `testTimeout: 30_000` in `vitest.config.ts`; tests that need longer still set their own, and three per-suite overrides that only restated 30 s (`examples/early-accept.test.ts`, `examples/verify.test.ts`) are gone.
- **Measured:** of the two tests in the closed backlog row, the testkit "draws the same panel from the same seed…" test is deleted (`e3482f5`; `panel.test.ts` and `service.test.ts` cover it), and the demo "determinism" test now runs seed 8 only to the offer and runs under the 30 s default (`ca619d4`).
- **Measured (PR 113 body):** in back-to-back runs on one machine with the EVM folder excluded, `main` failed 10 and then 3 tests, all on the 5 s default; the branch failed 0 of 2,152 both times.
- **Measured:** after merging main, `pnpm test` passes 2,166 tests with 10 skipped (2,176) in 41.5 s, with 0 timeouts.
Criteria 1, 2 and 4, PR 158 (2026-11-03):

The CI failures:
- **Measured:** the `contracts` job failed 9 times on 2026-11-03, in runs 41642786150, 41654603377, 41655277538 (main), 41655736893, 41656792322, 41658582232, 41676033359 (main), 41677733191 and 41680864227. Every failure is in the anvil vitest step: the gas-per-deal test ends with viem's `WaitForTransactionReceiptTimeoutError` at 180 s. In 7 of the 9, 1 to 8 tests before it also failed at their 60 s limit; in 2 (jobs 125995441609 and 126056764354) the gas test failed alone. The forge suites passed every time.
- **Measured:** a healthy run (job 126071932353) had the escape-hatch and operator-fee tests at 4,205 ms and 4,218 ms, against 100 to 474 ms for the rest. Locally the gas test takes 1.6 s.
- **Inferred:** each of those two is one missed first check that recovered at viem's 4 s poll. A single miss on viem's wait recovered at 4,006 ms in the review's control run.
- **Measured:** the same stalled hash appears in two runs twice (`0xb42d…` in jobs 125995441609 and 125981449350, `0x3474…` in 125985406228 and 125940245907). The chain is deterministic, so a hash is a position in the run; the stalls hit some sends more than others.

The diagnosis (viem 2.57.13, anvil 1.0.0). Repros B and D come from a scratch script that is not committed; they are the first two tests of `receipt.test.ts` run on viem's wait instead of `EvmWorld.receipt`:
- **Confirmed, measured:** a receipt check made right after a send can miss, because anvil in automine mines a moment after it returns the hash: 9 of 1,000 sends missed on an idle 8-core machine.
- **Confirmed, measured (viem source and repro D):** after a miss, `waitForTransactionReceipt` asks again only when `watchBlockNumber` sees a block above the one it first read. Anvil in automine mines none while the test waits. A single wait whose transaction landed at or below that first read timed out at its 15 s limit with the receipt on chain.
- **Confirmed, measured (repro B):** every wait on one client shares that block-number poller (one observer id per client and interval), and vitest does not stop a test it timed out, so a stalled wait keeps the poller alive. After `evm_revert` the head is below it. A later wait that misses its first check joins that poller and hangs as long as the head stays at or below the highest block the poller has seen: viem timed out at 15 s with the receipt on chain.
- **Inferred from the logs:** this is the cascade of 60 s failures. A miss mid-cascade can still recover once the head climbs past the stale poller, as `escape hatch` did at 4,192 ms in job 126073821008.
- **Inferred, not reproduced:** the first stall on CI is a miss whose first head read already counts the transaction's block while the lookup still sees it pending. Under load locally (12 busy threads, anvil `--threads 1`) 2 of 4,000 viem waits took a 4 s poll and none stalled. The fix re-checks on a timer, so it does not depend on which race fires.

The fix:
- **Measured:** `EvmWorld.receipt` polls `eth_getTransactionReceipt` every 25 ms and throws after `receiptTimeoutMs`: 10 s by default, or three blocks when `blockTimeSec` makes that longer. The error names the hash, whether anvil holds the transaction pending, automine and the pool. `send`, the deployments and `EvmSettlement`'s genesis setup use it, and a test checks that nothing in `packages/settlement/evm/` calls `waitForTransactionReceipt`.
- **Measured:** `receipt.test.ts` (own anvil world, 2 s deadline) covers three cases: a transaction mined below the head the wait first saw, a wait left running across `evm_revert`, and a transaction anvil never mines. On `main`'s `world.ts` and `evm-settlement.ts`, the second and third hang until vitest's 30 s timeout and the guard flags both files; the first needs `EvmWorld.receipt`, and its scenario on viem's wait timed out at 15 s (repro D). On this branch all 4 pass in 5.0 s.
- **Measured:** the gas test is 12 tests: one per path pinning its calls and final state, each under the 30 s default, plus one that the table covers every path in `PATHS`. The 420 s limit is gone.
- **Measured:** 50 consecutive local runs of CI's anvil command (`pnpm vitest run packages/settlement/evm packages/testkit/src/runner.test.ts`) at commit `3d1e118` all passed: 89 of 89 tests each, 8.46 to 10.66 s per run, no stall.
- **Measured:** the `contracts` job passed 7 times on PR 158, 89 of 89 anvil tests each, with the anvil step at 9.5 to 14.9 s:
  - jobs 126148464982 (`3d1e118`), 126148907914 (`7152884`) and 126156948750 (`c7ff457`);
  - job 126162670876 (`c8d0e84`), then three re-runs of it: 126167645147, 126185950279 and 126205099552.
  - In job 126156948750 no settlement test took over 1 s. Before the fix, a healthy run had two at 4.2 s.
  - Most of each job's time was the recursive checkout, 5 to 48 min (PR 159).

`pnpm verify` at commit `c8d0e84`, no uncommitted changes (measured, `reports/verify-t-035-anvil-receipt-stall.md`). No snapshot diffs against HEAD; `pnpm test` ran 2,260 passed and 3 skipped:

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 223 ms |
| lint | `pnpm lint` | pass | 3266 ms |
| forge build | `forge build --root contracts` | pass | 958 ms |
| forge | `forge test --root contracts` | pass | 14004 ms |
| test | `pnpm test` | pass | 33020 ms |
| spec | `pnpm validate:spec` | pass | 509 ms |
| snap | `pnpm snap` | pass | 7959 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 12689 ms |
| demo | `pnpm demo` | pass | 4017 ms |

## Decisions

- Poll the receipt instead of tuning viem's wait. A shorter `pollingInterval` still shares one block-number poller per client and still hangs after `evm_revert`; anvil `--no-mining` with an `evm_mine` per send would change the world every caller relies on.
- The new tests assert no wall-clock time (`docs/team.md`, Rules and checks): on viem's wait they hang, and the 30 s test timeout is the hang detector.
- No workflow change in this PR: the 9 failures were all the receipt stall. A second, separate slowdown is in PR 159 (`.github/`, for Rafa to merge). The job's `submodules: recursive` checkout cloned about 100 nested repositories and took 36 min 17 s on main at 18:51 UTC (job 126132743491, measured). PR 159 fetches only the six repositories the remappings use, and adds job and step timeouts.

## Handoff

- If an anvil test fails with `anvil returned no receipt for 0x… within 10 s`, read the rest of the message. `pending` with automine on means anvil would not mine it (fee or nonce). `unknown to anvil` means it was dropped (`anvil_dropAllTransactions` or a restart). `evm_revert` keeps pending transactions (measured in the review), so a transaction left pending can mine after `fresh()`.
- `LiveChain` (testnets) has its own receipt loop and is unchanged.
- For the docs lane: add a row to `docs/team.md` Rules and checks, outside this task's paths. Rule: "anvil receipt waits poll by hash, never through viem's `waitForTransactionReceipt`". Check: the guard in `packages/settlement/evm/receipt.test.ts`.
