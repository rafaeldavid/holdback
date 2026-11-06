# T-232: Read-after-write audit: every chain read right after a write sees that write

- **Lane:** settlement (with api, demo and judgment for their own reads, and test for the check)
- **Phase:** 2
- **Depends on:** the join-on-chain-delivery task (branch `t-230-join-onchain-delivery`) and the operator-sent timeouts task, both in flight on 2026-11-06. Both edit the relay code in `packages/settlement/evm/` that this audit reads, so it starts once both PRs merge.
- **Paths this task may touch:**
  - settlement: `packages/settlement/evm/` (the adapter, `live.ts`, the sync and the lanes) and its tests;
  - the operators and the faucet: `apps/demo-cloud/src/` (`world.ts`, the faucet and the funding lane) and its tests, and `apps/operator/src/` where it reads the chain after a relay;
  - the reference adjudicator: `apps/adjudicator/src/` (its settlement port, and its reads after its own acceptances and decisions);
  - Crow's test seller: `apps/test-agents/src/`;
  - the clients: `examples/try.ts` and the other examples, then `site/try.mjs`, rebuilt by `node site/build.mjs`; the round-1 driver (`examples/e2e-*.ts`) only where it still reads `latest` after a write;
  - the check: `eslint.config.js` (a rule) or a new test file under `tests/`;
  - docs: `docs/team.md` (the row "A chain read after a transaction sees that transaction"), `docs/plan.md` (this row), this file.

  Not `contracts/`, `spec/` or `.github/`.
- **Human gate:** yes, for the operator deploy (holdback-op1 and holdback-op2) and for a site deploy if `try.mjs` changes. Building, testing and merging need none.
- **Status:** todo (starts once the join-on-chain-delivery and operator-timeouts PRs merge, which edit the same relay code)
- **Agent/session:** not started. A docs session wrote this ticket on 2026-11-06 (branch `docs-phase2-walkthrough`) from Rafa's walkthrough of Phase 2 (D54).

## Intent

Rafa, 2026-11-06, asked whether to queue a sweep of the product's own reads after a write (D53's third proposed task): "Yes, queue it".

Restated: Crow's code often reads the chain right after its own write. A load-balanced RPC such as publicnode can answer that read from a node a block or more behind, which still shows the state before the write. That failure has come back five times (Context). This task finds every such read across Crow's code and makes each one safe: it pins the read to the write's block or later, or retries it until a node has that block, and never falls back to `latest`. Then it adds a check that fails on a new unpinned read after a write, if one is feasible.

Where to look:
- the operators' relay and sync paths (`packages/settlement/evm/`, `apps/demo-cloud/src/world.ts`);
- the reference adjudicator's reads after its acceptances, decisions and triggers;
- the faucet's mints and the funding lane's top-ups of the deal lanes;
- Crow's test seller;
- `examples/try.ts`, published as `site/try.mjs`, and the other examples;
- the round-1 driver, only for reads that PR 223 left on `latest`.

Inputs: the five incidents, the pattern that fixed them, and the `docs/team.md` row. Outputs: an inventory of every read after a write with its verdict, a fix and a test for each unsafe one, the check, and the team.md row updated.

Non-goals:
- reorg handling beyond trying a read again;
- any change to the contracts, the schema or the API's answers;
- replacing the RPC providers or adding a keyed one (a recommendation at most);
- the join-on-chain-delivery fix and operator-sent timeouts, which are their own tasks;
- a deal left behind the chain by a transformed call (T-227, Phase 11).

## Context

Labels: measured, documented, inferred or guessed.

**The five incidents.**
1. **T-226, round 1's lost delivery (2026-11-04).** A relayed `deliver` mined, but neither operator logged `delivery.submitted` or the key release. After the receipt, the adapter read `dealOf` at the latest block from a node a block behind, and its divergence check threw before the events [documented, T-226; the cause is inferred there]. PR 200 fixed it: reads at the receipt's block, tried again while a node lags.
2. **Round 1's 3d and 10a (the live run of 2026-11-05, 13:25 UTC).** The driver's evidence reads used the latest block, and a lagging node answered the state before the deal's last transaction, so checks failed on deals that had settled [documented, T-216 Decision 30]. PR 210 fixed it: the reads pin to the deal's last block.
3. **3b's bond deposit (both runs of 2026-11-05 evening).** The driver simulated the deposit at the latest block 2 to 4 s after its approval mined, on a node that did not have the approval, and the token refused `transferFrom` with `TransferFromFailed()` [the times measured, the cause inferred; T-216 Evidence]. PR 223 fixed it: simulate and estimate at the round's newest receipt block.
4. **T-228's stale receipt read (2026-11-05, its review).** A `dealOf` read at a relayed timeout's receipt block still showed the stage before the timeout, and froze the state read for good (`attack.t228-stale-receipt-read`) [measured on anvil, T-228 Evidence]. T-228 fixed it in `landBehind`: such a read throws before the transaction counts as applied, and the next sync pass applies the receipt.
5. **Scenario 8's race (2026-11-06, 07:27 UTC).** The driver delivered directly to the contract, then posted the same delivery to the API before the operators' sync had seen it. The operator's relayed `deliver` passed its simulation and reverted on chain in [`0x89d3…4309`](https://sepolia.etherscan.io/tx/0x89d3468367309a102a8108ae306ef73ebc8f62ef16154a9366d2b16cb32b4309), because the deal was already Delivered [measured: the run record `8.json` in `reports/e2e-round-1/2026-11-06T070341Z/`, round-1 checkout; the simulation on a lagging node is inferred by the coordinator session]. The join-on-chain-delivery task fixes the relay's answer; this audit checks the read behind it.

`docs/team.md` counts the five a little differently: T-226's lost delivery, 3d's and 10a's evidence, PR 210's starting balances, 3b's bond deposit and the gate after 5a [documented]. The audit covers all of them.

**The pattern that fixed them** [documented: T-226, T-228, T-216 Decisions 30, 31 and 34]:
- pin a read, simulation or gas estimate that follows a write to the write's receipt block or later, never `latest`;
- when a node has no header for that block, ask again (the driver tries 8 times, 2 s apart), and never read past it;
- treat a stale answer at the receipt's block as a lag: throw before marking the transaction applied, and let the next pass apply it;
- test with a stand-in RPC whose latest block trails the writes (`laggingRpc` and `walletRpc` in `examples/e2e-chain.test.ts`).

**The transport.** `LiveChain` reads through viem's `fallback` transport over the keyed and public RPCs. It moves to the next RPC when a call throws, not when a node answers stale data [documented, T-226 Context].

**The rule in `docs/team.md`:** "A chain read after a transaction sees that transaction", status Partial (T-216): the stand-in tests exist, and a check that finds an unpinned read is still to build [documented].

## Acceptance criteria

- [ ] **An inventory in Evidence:** every chain read, simulation and gas estimate that follows a write in the paths above, with its file and line, what it reads, and its verdict: pinned already, retried already, fixed here, or safe as it is, with the reason.
- [ ] **Test first:** for each read this task changes, a test against a stand-in RPC whose latest block trails the write fails before the change and passes after it.
- [ ] **No fallback to `latest`:** a pinned read that fails retries within a stated bound, then fails loudly; none answers from the latest block instead.
- [ ] **A check, if feasible:** an ESLint rule, a type (for example a read that requires a block), or a test over the code, that fails on a new unpinned read after a write. If none is feasible, Decisions says why.
- [ ] **`docs/team.md`:** the row names the check and its status.
- [ ] `pnpm verify` green, and `node site/build.mjs && node site/check.mjs` pass if `try.mjs` changes.
- [ ] `reviewer` and `red-teamer` passes, with project context, since this changes settlement reads in the relay path.
- [ ] After Rafa's go-ahead, the operator deploy, then one smoke deal through both operators, Released (measured).

## Out of scope

- Reorgs, RPC providers and contract changes (Non-goals).
- The join-on-chain-delivery fix, operator-sent timeouts and T-227.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff

Not started. It starts once the join-on-chain-delivery and operator-sent timeouts PRs merge.

To resume:
1. Check that both PRs merged, and read what they changed in `packages/settlement/evm/` and `apps/demo-cloud/src/world.ts`.
2. Work in a worktree on `t-232-read-after-write-audit`. Build the inventory first, then the tests and fixes, test first, then the check.
3. One operator deploy carries the fixes, on Rafa's go-ahead; it can ride with the next operator deploy if one is due.
