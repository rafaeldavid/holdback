# T-430: The in-flight rows test read a receipt anvil had not mined yet

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-219, T-035
- **Paths this task may touch:** `packages/settlement/evm/`, this task file
- **Human gate:** no
- **Status:** done
- **Agent/session:** root-cause session started from Crow Control's failed-run flag, 2026-11-14

## Intent

CI run 43587508963 on main (commit `12794e4`, docs only) failed one test of 293 in the job "anvil tests, settlement (must not skip)" at 11:05 UTC on 2026-11-14. The test is `live.test.ts` > "LiveChain's in-flight rows on anvil (T-219)" > "a broadcast that errors after the node took it keeps its row". The goal is to find whether the race is in `LiveChain` or in the test, fix it at its cause, and prove the fix with a repeat loop. Longer timeouts and retries are out of bounds, because they would only hide the race.

## Context

- `packages/settlement/evm/live.ts`: `sendNow` keeps the row when a broadcast errors after the node took it, and `fly` polls for the receipt until it is there or the deadline passes.
- T-035 (`docs/tasks/T-035-anvil-receipt-stall.md`) fixed an earlier anvil receipt stall in `world.ts`: the helper polls `eth_getTransactionReceipt` and does not use viem's waiter.
- T-409 changed the lane nonces and missing-block handling in the same package on 2026-11-14. It does not touch this path; the failed line is the test's own read.

## Acceptance criteria

- [x] The failing line and its cause are named, measured.
- [x] The fix removes the race instead of waiting longer.
- [x] A repeat loop under load fails before the fix and passes after it.
- [x] `LiveChain`'s own receipt reads are checked for the same race.

## Out of scope

- Other anvil tests in the package. None reads a receipt once right after an automine send (grep of `getTransactionReceipt`, below).

## Evidence

- **Cause (measured).** The test failed at `live.test.ts:364`, its own `getTransactionReceipt` right after the send rejected. The CI log shows `TransactionReceiptNotFoundError` from viem 2.57.13 at that line. The test assumed automine had mined the transaction by the time `eth_sendRawTransaction` returned. Anvil does not promise that: it adds the transaction to its pool, answers, and mines the automine block in a separate step.
- **Anvil's behavior (measured).** On anvil 1.0.0 (`e144b82`), a probe sent transactions with automine on and read each receipt right after its send returned. Serially, 29 of 2,000 reads found no receipt (1.5%). With 8 senders in parallel, 3,089 of 4,000 reads found none (77%). To repeat it: start `anvil`, then per sender loop `eth_sendTransaction` from an unlocked dev account and call `eth_getTransactionReceipt` on the returned hash at once, counting `null` answers. The session's copy was the git-ignored `reports/scratch/anvil-receipt-probe.mjs`.
- **Product code (inferred from reading, then measured by the passing test).** `LiveChain` is not affected. `fly` treats a missing receipt as "not yet", polls every `pollMs` and rebroadcasts. The lane's next send resolves the open row through `fly` too. The other product reads in `evm-settlement.ts` (1309, 1611) and `sync.ts` (258) take hashes from logs or blocks, so those transactions are already mined.
- **Fix.** The test now holds mining back before the send. It checks that the transaction is in anvil's pool, which is the claim "the node took it", then mines one block with `evm_mine`, turns automine back on, and reads the receipt. The read no longer races the miner. No timeout or retry was added.
- **Repeat loop (measured, 2026-11-14, on the Mac).** The test ran with vitest `repeats` on one anvil:
  - before the fix, idle machine: 200 of 200 runs passed (the window is too small to hit when idle);
  - before the fix, with the probe loading a second anvil (10 senders): 21 of 200 runs failed, all at line 364, with the CI error;
  - after the fix, under the same load: 200 of 200 runs passed, then 500 of 500 runs passed.
- **Commands run and results (measured):** `pnpm vitest run packages/settlement/evm/live.test.ts`: 21 of 21 tests passed. `pnpm exec eslint packages/settlement/evm/live.test.ts`: no findings. `pnpm exec vitest run packages/settlement/evm` (the kind's local check, with anvil): 16 of 16 files and 267 of 267 tests passed in 878 s on the Mac. CI's job "anvil tests, settlement (must not skip)" on PR 537 is the gate. Review (kind 5, one reviewer): PASS, no blocking findings.
- **Snapshot diffs:** none.

## Decisions

- Fix the test, not `LiveChain`. The product already handles a receipt that is not there yet. The test made a claim (mined at once) that neither anvil nor a real node makes.
- Assert the pool instead of polling for the receipt. Checking the pool states the test's claim exactly and is deterministic. A poll would also pass, but it would still depend on the miner's timing.

## Handoff

Done. The test fix is in this task's PR. Nothing remains open. If another anvil test shows `TransactionReceiptNotFoundError` on a direct read, look first for a receipt read right after an automine send. Hold mining back and use `evm_mine`, or poll as `world.ts`'s `receiptOf` does.
