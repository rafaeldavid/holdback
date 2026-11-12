# T-392: the round runs at the deployed operator fee of 0

- **Lane:** test (the Sepolia round), on `contracts-audit-ready`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53); found by the cutover rehearsal (T-383)
- **Kind:** 4, with one reviewer (Change recipes)
- **Depends on:** T-389 (PR 438, `1db0003`: the operators' fee at 0 for the first pilots)
- **Paths this task may touch:** the round's files and tests under `examples/` (`e2e-scenario-kit.ts`, `e2e-world.ts`, the scenario files and their tests), this file. Never: T-379's files, `apps/`
- **Human gate:** no
- **Status:** review
- **Agent/session:** the T-374 session, 2026-11-12, branch `t-392-round-zero-fee`

## Intent

Since T-389 the live operators charge no operator fee (`apps/demo-cloud/wrangler.op1.jsonc`: `OPERATOR_FEE_BPS`, `OPERATOR_FEE_MIN` and `OPERATOR_FEE_GAS` are "0"). At 0 the prepare route returns no fee slot: the buyer signs no fee message, and no fee transfer or `fee.operator` event happens.

The round's shared check `settledChecks` expected exactly one fee transfer whenever a fee was computed, and a fee of 0 is computed. T-383's rehearsal at the deployed config measured scenario 12 failing that check on both deals. CI never saw it, because the round's local worlds ran at a fee of 1 bp.

This task makes three changes:
- The check expects one transfer of the stated amount above 0, and no transfer at all at 0.
- The round's local worlds take the fee from the deployed config, so a local run tests what deploys.
- One test keeps a non-zero fee alive with its own values, since another operator may charge one.

## Acceptance criteria

- [ ] At a fee of 0, `settledChecks` passes only when no fee transfer happens. Above 0, it passes only on exactly one transfer of the amount.
- [ ] `examples/e2e-world.ts` reads the fee variables from `apps/demo-cloud/wrangler.op1.jsonc`.
- [ ] The anvil round passes with every scenario counted at the deployed fee, and scenario 12 passes on anvil at a non-zero fee.

## Out of scope

- T-379's client files, which have their own fee tests at 1 bp.

## Evidence

**Where the round assumed a fee** [measured, by search of `examples/e2e-*`]:
- **One place: `settledChecks`** (`e2e-scenario-kit.ts`), which scenarios 12, 3c, 7, 2 and the direct ones share. It expected one fee transfer whenever `deal.operatorFee` was defined, and a fee of 0 is defined.
- **Fixed now:**
  - above 0, the check needs exactly one transfer of the stated amount from the payment address to the fee address;
  - at 0, it needs no such transfer and is named "no operator fee moves: the fee is 0".
- **Every other fee use is right at 0:** it adds `deal.operatorFee ?? 0n` to a total. That covers the scenarios' balance checks, the funding helpers in `e2e-run.ts` (the fee slot is asked for only when the schedule has one) and the direct scenarios' "no operator fee" checks.
- **The worlds' fee:**
  - before, `examples/e2e-world.ts` ran every round world at 1 bp with a minimum of 0.01 test token, and the anvil world added a gas quote of 4.70;
  - now `ENV` is read from `apps/demo-cloud/wrangler.op1.jsonc`, where all three variables are "0";
  - `e2e-scenarios-direct.test.ts` no longer adds its own gas quote.

**Checks** [measured, in the worktree, on the lane at `e6a74b6` plus this change, with `contracts/out` built from it]:

| Run | Result |
| --- | --- |
| `examples/e2e-round.test.ts` and `examples/e2e-scenarios-direct.test.ts`, anvil included | 16 of 16, none skipped |
| The anvil round at the deployed fee of 0 | `… 10a pass, 12 pass`. Scenario 12 has no failed check, and "no operator fee moves: the fee is 0" passes on both deals |
| The new anvil run at a non-zero fee (`NONZERO_FEE`) | `results: 12 pass`. "the operator fee is paid once" passes on both deals |
| `e2e-scenarios-silent`, `-escalation`, `-appeal`, `e2e-adjudicator`, `e2e-run`, `e2e-settle`, `e2e-chain`, `e2e-keys`, `e2e-rounds`, `tests/cut-feature-alignment.test.ts`, `tests/ci-gated.test.ts` | 99 of 99 |
| `pnpm typecheck`; `pnpm lint` | clean |

## Decisions

1. **The source is `wrangler.op1.jsonc`.** The World Durable Object, which serves both nodes, reads the fee from that Worker's variables; `wrangler.op2.jsonc` carries none. The round strips the file's whole-line comments and parses its `vars`.
2. **`ENV` keeps its name and now means the deployed fee**, so every round test that opens a world runs what deploys. `NONZERO_FEE` (1 bp, minimum 0.01, gas quote 4.70 test tokens) is the charging operator's case.
3. **The non-zero case runs scenario 12 on anvil.** Its two deals pay the fee from a payment address apart from the buyer's signing key, which is the strictest fee path the round has.

## Handoff

**Done.** The round passes at the fee Crow's operators deploy, and one anvil run keeps a charging operator's case alive.

**For T-383 (the cutover sheet):** the "expected failure" for scenario 12's fee check is gone. At the deployed fee of 0 the live round expects no fee transfer.

**If the deployed fee changes:** the round follows `wrangler.op1.jsonc` on its next run. The non-zero case keeps its own values in `NONZERO_FEE`.
