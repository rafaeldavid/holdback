# T-383: the deploy script's remainder, the start-up check and the record's copies (package CU-1)

- **Lane:** settlement
- **Phase:** 2 (phase-one contracts, testnet-ready checklist item 8)
- **Depends on:** T-380 (R8: `BEACON_MARGIN`, merged in PR 418), T-363 (the cutover checklist), T-378 (R6c-2, the operator side)
- **Paths this task may touch:** `contracts/script/deploy-sepolia.sh`; `packages/settlement/evm/live.ts` with its tests, and one data file beside it (the accepted-token table); one new command under `scripts/` with its test; the two lines that name a world (`apps/demo-cloud/src/worker.ts`, `apps/test-agents/src/worker.ts`) and the one test line that pins the first (`apps/demo-cloud/src/worker.test.ts`); `examples/deployments.ts` only as the copies command's target; `docs/cutover-phase-one.md` where a step's command changes; this file. Nothing under `contracts/src` or `contracts/test`.
- **Human gate:** no. The task builds and tests on a local chain only. The deploy on Sepolia, and any explorer key, are Rafa's at the cutover.
- **Change kind:** 7 for the script, 5 for the start-up check; one reviewer per pull request.
- **Status:** in progress
- **Agent/session:** the T-383 session (Opus 5.5), started 2026-11-12 by the coordinator

## Intent

The pilot runs as a loop on Sepolia: deploy the frozen commit, let the design partner audit it, fix, redeploy, review the fixes. So the redeploy has to be a routine that runs the same way every time, with no hand edits between runs. This task makes it one.

What goes in:

1. **The beacon margin in the deploy.** R8 added a sixth constructor argument, `BEACON_MARGIN` (29 s on Sepolia). The script's create line, its creation-code check, its wiring check and the record's arguments all take it from one variable.
2. **One token, checked three ways.** A table, per chain, names the token Crow's operators accept. The deploy's `--check` and the operators' start-up check each compare three values and fail if any two differ: the table, the deployment record, and `TOKEN()` read from the rules contract. Both also refuse a token address that holds no code. A local chain has no table entry and skips that one comparison. Sepolia's entry is one of the record's copies, so the copies command rewrites it.
3. **An old world refuses to start.** One test: a lane build pointed at the dated 0.7 record refuses at start, and the error names the domain. No new probe.
4. **Explorer verification.** A script mode that verifies each deployed contract from the record, with the constructor arguments the record holds. Sourcify first, with no key. Etherscan only when a key is in the environment, read by name.
5. **The record's copies, by one command.** It takes the dated old record and the new record, rewrites each old address and hash in a fixed list of files, rebuilds what is built from them, then fails if any old value remains in a tracked file outside a short list of history files.
6. **The world's name follows the record,** so a new record is a new world without a second edit.

What comes out: a script that runs on Sepolia and, for rehearsal, on a local anvil; a start-up check in `live.ts`; one new command; the cutover page naming each command exactly.

Not built, on purpose: a resume after a failed create (a failed Sepolia run is rerun whole); any change to the contracts (the token's code check lives in the script and at start-up, not in the constructor; Rafa, 2026-11-12).

## Context

- `docs/cutover-phase-one.md`, steps 2, 3 and 6, and its second-pass table.
- The refinement plan (private): section 7c.3 (Package CU-1), section 2c (the CU-1 row), section 7d (item 53).
- ADR-0031 §2 (one token per deployment, SC-1), ADR-0032 (the beacon margin), ADR-0029 §8 (the domain check at start).

## Acceptance criteria

- [ ] On a local chain the script deploys the lane's contracts with the margin, writes a record, and its wiring and token checks pass.
- [ ] Each check fails on a planted fault: a wrong token in the table, a token with no code, a wrong margin.
- [ ] The operators' start-up refuses a record whose token differs from the chain's or from the table, and a token with no code.
- [ ] A lane build pointed at the 0.7 record refuses to start and names the domain.
- [ ] The verify mode builds the right `forge verify-contract` lines from a record, tested without a network.
- [ ] The copies command, run on a copy of the repo's files with a made-up new record, leaves no old value behind, and fails when one pin is skipped.
- [ ] The world's name changes with the record, with no second edit.
- [ ] `docs/cutover-phase-one.md` names each new command exactly.
- [ ] The whole routine runs twice on a local chain with no hand edit.
- [ ] `forge test` and the touched packages' tests with anvil pass; CI passes on each pull request.

## Out of scope

- A resume after a failed `forge create`.
- Any file under `contracts/src` or `contracts/test`.
- A deploy, a transaction or a key on Sepolia; a live run.
- The SimChain world's name (R6c-2).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
