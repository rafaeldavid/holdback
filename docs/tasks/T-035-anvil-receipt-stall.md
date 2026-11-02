# T-035: Fix the anvil gas-per-deal stall at its root

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `packages/settlement/evm/`, `packages/testkit/src/` (timeouts only), `apps/demo/agents/` (timeouts only), `vitest.config.*` (testTimeout only), `docs/tasks/T-035-anvil-receipt-stall.md`, `docs/backlog.md` (close the flaky-timeout rows)
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

The gas-per-deal anvil test normally takes about 10.5 s but stalled to 180 s on CI twice on 2026-11-02 (PRs 77 and 83). PR 84 raised its limit to 420 s, which only delays the report. The likely cause (inferred, `docs/reviews/2026-11-02-dev-velocity.md` §2.3): viem's `waitForTransactionReceipt` re-checks only on a new block, and anvil in automine produces none after a missed first check, so the wait sleeps until viem's own 180 s timeout. Confirm or refute it, fix it, and stop using tight per-test timeouts as correctness bounds.

## Acceptance criteria

- [ ] Diagnosis confirmed or refuted with evidence (a reproduction loop, logs, or viem source).
- [ ] The receipt wait cannot stall (for example: poll `getTransactionReceipt` on an interval, or use anvil's synchronous receipt); the gas test split by path so one slow path is visible; the 420 s bump reverted to a tight bound.
- [ ] The testkit judgment and demo determinism timeouts under load (backlog rows) fixed or given a justified `testTimeout`; a global `testTimeout` of about 30 s where tests share a default.
- [ ] 50 consecutive local runs of the gas test without a stall (measured), `pnpm verify` and CI pass.

## Evidence

## Decisions

## Handoff
