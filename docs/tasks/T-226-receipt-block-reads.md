# T-226: A relayed call's checks read at its receipt's block

- **Lane:** settlement (the EVM adapter and the live chain)
- **Phase:** 2
- **Depends on:** T-218 (merged in PR 185), which moved the book's state after the post-receipt checks. T-219 (draft PR 195) edits the same files; this task keeps out of its changes.
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` (`send` and its read helpers), `packages/settlement/evm/live.ts` (`blockTime`), their tests (`evm-settlement.test.ts`, `sync.test.ts`); docs: `docs/backlog.md` (its row), `docs/tasks/T-216-evm-e2e-round-1.md` (one Evidence line), `docs/plan.md` (this row), this file
- **Human gate:** yes for the deploy: the operators run the fix only after T-220's deploy, which Rafa does. Everything else is in the repository.
- **Status:** done (merged in PR 200; it goes live with T-220's deploy)
- **Agent/session:** the round-1 lost-events session, 2026-11-04, started from the T-216 session

## Intent

Round 1's first live run (T-216, 2026-11-04) found a Medium problem. A relayed `deliver` mined on Sepolia, but neither operator logged `delivery.submitted` or the primary's key release, so the buyer could not open the work through the API. The inferred cause: after the receipt, the adapter checked `dealOf` at the latest block, through one of several RPCs. A node a block behind answered the stage before the call, and the divergence check threw before the events.

The goal: an RPC node that lags a relayed call's block can neither drop the call's events nor leave the book ahead of them. Non-goals: a lane row that survives a restart (T-219), and reorg handling beyond trying the read again.

## Context

- `docs/reviews/2026-11-04-evm-e2e-round-1.md` (Medium finding) and T-216's Evidence: deal `0xf0453986…5e5b`, transaction `0x64c5c757…caf1`, Sepolia block 12,064,917.
- `EvmSettlement.send` and `record` (`packages/settlement/evm/evm-settlement.ts`); review M2 in T-218 keeps the book untouched when a post-receipt read fails.
- `LiveChain` reads through viem's `fallback` transport over the keyed and public RPCs (`live.ts`, `apps/demo-cloud/src/worker.ts`). The transport tries the next RPC when a call throws, not when a node answers null or stale data.

## Acceptance criteria

- [x] Test first: on anvil, the node that answers `dealOf` or `deliveryHashOf` after a relayed delivery lags the receipt by a block. It fails, or answers the block before, once. Before the fix every case throws a divergence; after it the delivery's events and the primary's key are served.
- [x] The block's time: a node that does not serve the receipt's block yet (viem's `BlockNotFoundError`) is asked again; a test on a LiveChain over anvil fails before the fix and passes after.
- [x] An answer at the receipt's block that never matches the mirror is still a divergence: the relay throws after five tries and the book stays as it was.
- [x] A read that keeps failing leaves the book untouched, and the next sync pass applies the call (T-218's M2 test, now failing every try).
- [x] The retries stay bounded: no wait starts after 10 s, and on anvil (the scenario clock) no retry waits.
- [x] The backlog row is narrowed to what is left, and T-216's Evidence names this task and PR 200.
- [x] `pnpm verify` passes, and the `reviewer` role has reviewed the PR (relayer code: operators relay and never author).

## Out of scope

- Several transactions in flight per lane, and the lane row itself (T-219).
- Pinning reads by block hash. `Mined` would need the hash, and `chain.ts` is T-219's to change (Decisions).
- The operators' deploy (T-220, Rafa).

## Evidence

- **The cause, in the deployed code** [measured: the code at `dd0a55a`, the live operators' build since 2026-11-04 16:40 UTC]: `send` set `book.state`, then read `dealOf` at the latest block. On main, T-218 had already moved `book.state` after the reads.
- **Test first** [measured, 2026-11-04, `pnpm vitest run` on this branch]:
  - The new `dealOf` and `deliveryHashOf` lag tests fail on main with "EVM/core divergence after deliver: the contract is Held, core is Delivered" and "the contract stores delivery 0x0000…, core holds 0x0b9a…".
  - The block-time test fails on main's `live.ts` with `BlockNotFoundError: Block at number "22" could not be found`.
  - With the fix, `packages/settlement/evm/`: 8 files, 99 tests pass.
- **With T-219's draft** [measured]: a local merge with PR 195 ran `packages/settlement/evm/` and `apps/demo-cloud/src/lanes.test.ts`, 9 files and 105 tests, all passing (before the review's changes). `git merge-tree` shows no code conflict.
- **Review** [measured]: the `reviewer` role returned ISSUES. This branch answers each finding: the block-time read (Medium), mismatched answers retried, a divergence test, the retry budget, the wording, this task file and the PR template.
- **`pnpm verify`** on the branch with the review's changes, 2026-11-04 21:58 UTC: PASS, no snapshot diffs against HEAD, no placeholders [measured: `reports/verify-t-216-receipt-block-reads.md`]. `pnpm test` ran 117 files and 2,661 tests; 1 file and 4 tests were skipped, the suites that need `SEPOLIA_FORK_RPC` [inferred from their skip conditions].

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 270 ms |
  | lint | `pnpm lint` | pass | 4,031 ms |
  | forge build | `forge build --root contracts` | pass | 1,255 ms |
  | forge | `forge test --root contracts` | pass | 21,156 ms |
  | test | `pnpm test` | pass | 158,032 ms |
  | spec | `pnpm validate:spec` | pass | 1,768 ms |
  | snap | `pnpm snap` | pass | 10,707 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 20,839 ms |
  | demo | `pnpm demo` | pass | 5,157 ms |

## Decisions

- **Retry the read, keep the M2 rule.** A read pinned to the receipt's block either answers the block's state or fails, so the adapter tries a failed or mismatched read again rather than trusting the receipt alone. A read that still fails leaves the book untouched (T-218's review M2), so a divergence is never recorded as a step.
- **Pin by block number, not by hash.** Reading by `blockHash` with `requireCanonical` would also catch a reorg. It needs `blockHash` on `Mined` in `chain.ts`, which T-219 is rewriting; the retry covers a one-block reorg in the common case (inferred). Revisit after T-219 merges.

## Handoff

- **T-219:** this task changes `send` between the receipt and `record`, and `LiveChain.blockTime`. PR 195 merges with it with no conflict in code (`git merge-tree`, measured 2026-11-04). With T-219, a read that fails on every try leaves the lane row open, and the next pass applies the call as this node's relay (inferred from PR 195's `follow` and `noteOf`).
- **T-220:** the deploy carries this fix; round 1 re-runs scenario 1 on it.
- **Open for Rafa:** the reviewer recommends a second review from another model family: what the keyed and public Sepolia RPCs return for `eth_call` and `eth_getBlockByNumber` at a block they lack, and pinned reads across a one-block reorg.
