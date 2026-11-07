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
- **Status:** done ([PR 239](https://github.com/rafaeldavid/holdback/pull/239), merged 2026-11-07 at 06:06 UTC after one red-team pass and one review; it goes live with the next operator deploy)
- **Agent/session:** an implementer session on 2026-11-06, branch `t-232-read-after-write-audit`, worktree `.worktrees/t232-raw`, from origin/main at 5cb8c25 (both prerequisites, PR 232 and PR 230, merged). A docs session wrote this ticket on 2026-11-06 (branch `docs-phase2-walkthrough`) from Rafa's walkthrough of Phase 2 (D54).

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

**The implementer's restatement (2026-11-06).** The operators, the faucet and the reference adjudicator read the chain through one RPC client that may land on a node a block or more behind. Whenever such a read follows a transaction this node sent or applied, it must answer from that transaction's block or later. The work has four parts:
1. find every such read in the listed paths, with its file and line;
2. make each unsafe one name a block, never below the newest block this node knows of, and retry it within a bound before it fails loudly;
3. prove each change with a stand-in RPC that trails the write, a test that fails before the change and passes after;
4. add a lint rule that fails on a new read that names no block.

A read that follows another party's transaction stays unpinnable, as `docs/team.md` says; the inventory names those with their reason. Out of scope: the contracts, the schemas, the API's answer shapes, the RPC providers, reorgs, a deploy (Rafa's gate), and `docs/plan.md` (another session owns it today).

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

- [x] **An inventory in Evidence:** every chain read, simulation and gas estimate that follows a write in the paths above, with its file and line, what it reads, and its verdict: pinned already, retried already, fixed here, or safe as it is, with the reason.
- [x] **Test first:** for each read this task changes, a test against a stand-in RPC whose latest block trails the write fails before the change and passes after it.
- [x] **No fallback to `latest`:** a pinned read that fails retries within a stated bound, then fails loudly; none answers from the latest block instead.
- [x] **A check, if feasible:** an ESLint rule, a type (for example a read that requires a block), or a test over the code, that fails on a new unpinned read after a write. If none is feasible, Decisions says why.
- [x] **`docs/team.md`:** the row names the check and its status.
- [x] `pnpm verify` green, and `node site/build.mjs && node site/check.mjs` pass if `try.mjs` changes (`try.mjs` does not change).
- [ ] `reviewer` and `red-teamer` passes, with project context, since this changes settlement reads in the relay path.
- [ ] After Rafa's go-ahead, the operator deploy, then one smoke deal through both operators, Released (measured).

## Out of scope

- Reorgs, RPC providers and contract changes (Non-goals).
- The join-on-chain-delivery fix, operator-sent timeouts and T-227.

## Evidence

Labels: measured, documented, inferred or guessed. Lines are this branch's.

### Summary

- **The inventory: 43 read sites in the listed paths (inferred: found by reading the code and by the lint rule below).** 18 are fixed here, 6 were pinned already, 4 retry already, and 15 are safe as they are, each with its reason. No site is left unsafe without a reason.
- **The fix (measured by the tests below).** Every read of the state now in the operators names a block: `LiveChain.pinned` reads at the node's latest block, or at the chain's floor when the node trails it. The floor is the newest block this node has a receipt from, a sync pass has read up to, a timeouts pass has checked at, or a restored log names. A pinned read that finds no block is asked again after 0.5, 1, 2 and 4 s, within 10 s on Sepolia (a quarter, a half, one and two receipt polls of 2 s, within five), then fails with the node's error. No read answers from `latest` instead.
- **The guard (measured).** An ESLint rule fails on a contract read, gas estimate, `eth_call`, balance or nonce count that names no block in `packages/settlement/evm/` and `apps/*/src/`. On origin/main's `live.ts` it reports 7 errors (`git show origin/main:packages/settlement/evm/live.ts | eslint --stdin`). On this branch it reports none, with 3 reads that say why on an `eslint-disable` line.

### The inventory

Verdicts: **fixed here**, **pinned already**, **retried already**, **safe** (as it is, with the reason). Tests are in `packages/settlement/evm/read-after-write.test.ts` unless named otherwise, and are listed below the table.

| # | Where | The read | The write before it | A stale answer would | Verdict | Test |
|---|---|---|---|---|---|---|
| 1 | `live.ts:344` `simulate` | `eth_estimateGas` before every relay | this node's last receipt | refuse a valid message (WrongStage, TooEarly), or pass one the chain then reverts | fixed here: pinned | A2, A3 (simulation), A6 |
| 2 | `live.ts:538` `sendNow` | the gas estimate when no simulation ran (mints, top-ups, `ensureBond`'s approval and deposit) | the key's or the lane's previous transaction | revert the deposit TransferFromFailed before its approval (round 1's 3b) | fixed here: pinned | A1 |
| 3 | `live.ts:546` `sendNow` | a lane's nonce from `pending` when its cache is empty (first send, after a refusal or a give-up) | the lane's last mined transaction | reuse a mined nonce: the node answers "nonce too low" | fixed here: never below the nonce after the last mined transaction (`minedNonce`); `pending` has no block, so its line says why | A5 |
| 4 | `live.ts:482` `ethBalance` (`topUpLanes` 490, `ensureBond` 702) | test ETH | a top-up | top up the same lane twice | fixed here: pinned | A8, A3 (ETH) |
| 5 | `live.ts:696` to `704` `ensureBond` | `bondOf`, `balanceOf`, `allowance` | the ETH send, the mint, the approval, an earlier deposit | send a second mint, approval or deposit | fixed here: pinned | A1 (a repeat sends nothing) |
| 6 | `live.ts:594` `fly` | the receipt | its own broadcast | answer none: the loop polls again | retried already; it now raises the floor (602) | all |
| 7 | `live.ts:667` `blockTime` | the receipt's block | the receipt | throw BlockNotFoundError | retried already (5 tries, T-216) | none new |
| 8 | `live.ts:651` `feesNow` | the fee history | none | price a fee from a block ago; the fee bump covers it | safe: no state a write moves | none |
| 9 | `live.ts:294` to `306` `verify` | chain ID, code, EIP-712 domain, `EXPIRY_MARGIN` | none: it runs before any send | none | safe: fixed at deployment (no admin keys, no upgrade proxy); the two `readContract` lines say why | none |
| 10 | `evm-settlement.ts:582` `read`, `:571` `stage` | any contract read with no block (the helper behind rows 11 to 19) | any write of this node | answer the state before the write | fixed here: pinned by default on a live chain | A3 (dealOf) |
| 11 | `evm-settlement.ts:964` the offer's join check | `dealOf` | the buyer's direct funding; this node's own writes | offer as before; the next pass joins the funding | fixed here through row 10 (never below the floor); the buyer's own write stays unpinnable | A3 (dealOf) |
| 12 | `evm-settlement.ts:1023` after a refused or reverted funding bundle | `dealOf` | this node's reverted bundle | miss the copy of the fund leg and refuse | fixed here through row 10 (the floor holds the revert's block) | A3 (dealOf) |
| 13 | `evm-settlement.ts:1883` `land` after a restart | `dealOf` | the landed row's receipt | keep a behind deal's book at the stage before its own takeover | fixed here through row 10 | `attack.t231-behind-recovery-stale-stage` (`timeouts.redteam.test.ts:262`), its book flips from Delivered to FallbackJudging |
| 14 | `evm-settlement.ts:1247` the funding's balance check | the buyer's balance | the faucet's mint | make core refuse the funding (a divergence error) | fixed here: pinned | A2 |
| 15 | `evm-settlement.ts:2596` an answer's balances; GET /v1/balances (`apps/operator/src/server.ts:1172`); the faucet's gate and answer (`apps/demo-cloud/src/world.ts:1260`, `1288`) | balances | a relay; the faucet's mint (`world.ts:1201`) | show the balance before the write (the faucet answered 0 after its mint) | fixed here: pinned | A2, A3 (balances) |
| 16 | `evm-settlement.ts:614` the balance cache | a balance read in the last 4 s | another node's release, applied by this node's pass | let a second operator serve the balance from before the release, so try.mjs's balances step finds the operators disagree | fixed here: a cached read stands only while the floor does | A4 |
| 17 | `evm-settlement.ts:988` the acceptance's free bond; `apps/adjudicator/src/simchain-adapter.ts:212` `bondCover` | `freeOf` | `ensureBond`'s deposit; a decision or an appeal expiry that frees bond | refuse the acceptance coverage_exceeded; make the fallback decline, and the deal default | fixed here: pinned | A3 (free bond) |
| 18 | `evm-settlement.ts:642` `refreshPools` (`world.ts:958`, `964`, `972`, right after `ensureBond`); `:631` `bondOf` (`world.ts:645`, `server.ts:804`) | `bondOf`, `freeOf` | the deposit | serve bond 0 in the registry for up to 60 s | fixed here: pinned | A3 (bond, pools) |
| 19 | `evm-settlement.ts:748` | `DOMAIN_SEPARATOR` | none | none | safe: a constant (now pinned through row 10 as well) | none |
| 20 | `evm-settlement.ts:1322` `nonceUsed`, `:1402` `send` | the simulation (row 1) | as row 1 | as row 1 | fixed here through row 1 | A2, A3 |
| 21 | `evm-settlement.ts:1439`, `1444` `send` after the receipt | `dealOf`, `deliveryHashOf` | its own relay | lose the call's events (T-226) | pinned already (PR 200: the receipt's block) | `sync.test.ts` |
| 22 | `evm-settlement.ts:1462` `landBehind` | `dealOf` | its own timeout | freeze a stale stage (T-228) | pinned already, with a stale-answer check | `attack.t228-stale-receipt-read` |
| 23 | `evm-settlement.ts:2371` `landedDelivery` | `deliveryHashOf` | a revert of its own relay; another party's direct delivery | relay a delivery the chain holds | pinned already (T-230: the revert's block, or the node's latest) | `attack-t230.test.ts` |
| 24 | `sync.ts:291` `commitmentTxs` (catch-up, the offer's join) | logs to the head | a revert (pinned with `atLeast`); otherwise another party's transaction | miss that transaction; the next pass applies it (3 blocks of overlap) | pinned already where it follows this node's write (T-230) | `attack-t230.test.ts` |
| 25 | `evm-settlement.ts:1305` to `1312` `feePaidEarlier` | the fee's `AuthorizationUsed` log | another party's fee transfer | refuse payment_required, whose text says a public RPC can lag and to retry | safe: another party's write, which no floor of this node's covers | none |
| 26 | `evm-settlement.ts:1592` `replayCheck`, `:659` `holdings`, `:675` `heldFor`, `:2584` `view`'s `dealOf` | the chain | none on a live chain | none | safe: anvil only (testkit, snap:local), one node that mines each transaction before its receipt returns | none |
| 27 | `sync.ts:330` a pass's head, `:348` `dealOf` at the head | the head | this node's relay after the cursor | read `dealOf` from before this node's relay and put the deal behind | fixed here: a head below the floor reads nothing (335); a pass raises the floor (351); the cursor raises it after a restart (312) | A7 |
| 28 | `sync.ts:256` `Reader.tx` | a logged transaction and its receipt | none | throw on a node without the receipt | retried already: the pass applies nothing, moves no cursor, and the next pass reads again | `sync.test.ts` "fails closed" |
| 29 | `timeouts.ts:271`, `383`, `395` the timeouts pass | the head, `dealOf`, the timeout's `eth_call` | the sync's cursor; the log's last block | none: it reads at the newest of those | pinned already (T-231); it now raises the floor (274), so the relay's simulation reads no earlier than the check | `timeouts.test.ts` "the check reads at the latest of the RPC head…" |
| 30 | `evm-settlement.ts:475` `restore` | every read after a restart | the transactions in the saved log | read from before the last applied transaction | fixed here: the floor starts at the log's last block | A2 (restart) |
| 31 | `apps/adjudicator/src/simchain-adapter.ts:141` `offers` | the pool cached at the last `refreshPools` | a decision or a deposit | show an offer covered, or not, for up to 60 s | safe: the acceptance re-reads the free bond pinned (row 17) before it relays | none |
| 32 | the reference adjudicator's acceptances, decisions and triggers | the relay path | its own earlier submission | as rows 1 and 21 | safe: no read of its own; the relay path (rows 1, 20, 21) covers them | as rows 1 and 21 |
| 33 | `apps/test-agents/src/seller.ts:526`, `559`, `571`, `580`, `587` | the deal's state through the API | its own posts | none | safe: no chain read; the operator's book moves before the relay answers, and the seller waits for every operator to show Held (559) | none |
| 34 | `examples/try.ts:92` `until` | every operator's state | the script's own posts | none: it polls every 400 ms until each operator shows the state | retried already | none |
| 35 | `examples/try.ts:325` the balances step | `trusted`: every operator's balance must agree | the release | stop try.mjs with "operators disagree" | fixed here on the operators' side (rows 15, 16); `try.ts` and `site/try.mjs` do not change | A4 |
| 36 | `examples/agent.ts`, `buy-dataset.ts`, `sell-translation.ts`, `verify.ts`, `open.ts`, `run.ts`, `sign.ts`, `seal.ts` | the API | none | none | safe: no chain read | none |
| 37 | `examples/e2e-scenarios-direct.ts:328` scenario 11 | the lane's nonce at `latest` | the operator's relayed funding | take the funding for the delivery's broadcast: a false pause | fixed here: `RoundChain.nonceAfter` (`e2e-chain.ts:281`) at the funding's block or later | `e2e-chain.test.ts` "counts a relayer lane's nonce at its funding's block…" |
| 38 | `examples/e2e-scenarios-direct.ts:337` | the pause loop's counts | none | none | safe: it waits for a change, every 250 ms | none |
| 39 | `examples/e2e-chain.ts` reads given `at`, receipts, logs, `send`'s simulation, estimate and nonce | the round's evidence | the round's own sends | none | pinned already (PR 210, 220, 223) | `e2e-chain.test.ts` |
| 40 | `examples/e2e-chain.ts:272` `ethBalance` (`e2e-round.ts:154`) | Sepolia ETH | none | none | safe: a display line at the round's start, before any send | none |
| 41 | `examples/e2e-chain.ts:399` `untilIdle` | pending against mined counts | none | none | safe: before any send, and it waits | none |
| 42 | `examples/e2e-keys.ts:103`, `107` `topup` | balances and counts | the previous `topup` run's transfers | send one more top-up, up to the plan's target | safe: no write before it in its own run; the pending-against-latest check refuses while a transfer is pending (inferred) | none |
| 43 | `examples/e2e-scenarios-escalation.ts:266` | the beacon's `roundAt(at)` | none | none | safe: a pure function of `at` | none |

Counts: 18 fixed here (rows 1 to 5, 10 to 18, 20, 27, 30, 37), 6 pinned already (21 to 24, 29, 39), 4 retried already (6, 7, 28, 34), 15 safe (8, 9, 19, 25, 26, 31 to 33, 35, 36, 38, 40 to 43), counting row 35 as safe on the client's side, since its fix is rows 15 and 16.

### The tests (packages/settlement/evm/read-after-write.test.ts, on anvil behind `trailing`)

`trailing` stands in for a load-balanced RPC whose nodes trail every write: after each receipt it hands out, a read that names no block, and its head, come from the block before that receipt, and a read pinned past that block finds no header the first time.

| Test | Rows |
|---|---|
| A1 a bond deposit right after its approval is estimated at the approval's block | 2, 5 |
| A2 funds right after the faucet's mint, delivers right after the funding, answers the release with the seller paid, and a restart reads no earlier than its log's last block | 1, 14, 15, 20, 30 |
| A3 every read the operators serve after a write names a block at or after it (8 cases: dealOf, a token balance, the balances an answer shows, a bond, a free bond, the bond pools, a lane's test ETH, a relay's simulation) | 1, 4, 10 to 12, 15, 17, 18 |
| A4 a balance read before a pass applied the chain is not served after it | 16, 35 |
| A5 a lane's nonce after a refused broadcast is the one after its last mined transaction | 3 |
| A6 a pinned read on a node that never catches up fails after its bound, and never answers from the latest block | the bound |
| A7 a pass whose head trails this node's own write reads nothing, and the next one past it applies | 27 |
| A8 a deal lane topped up a moment ago is not topped up again | 4 |

### Commands run and results

- **The new tests fail before the change (measured).** `pnpm exec vitest run packages/settlement/evm/read-after-write.test.ts` on origin/main's code: 15 failed of 15. Each failed as its row says. A1 threw `EstimateGasExecutionError` with `0x7939f424`, TransferFromFailed(), the error round 1's 3b hit. A2's balance after the faucet's mint was `'0'`, not `'2050000000'`. Each A3 case read at `latest`. A4 served `0n`, not `7n`. A5's next send was refused "nonce too low". A6's read resolved `0n` instead of failing. A7's pass returned a report instead of null. A8 sent a second top-up.
- **They pass after it (measured).** The same command on this branch: 15 passed of 15.
- **The driver's test fails before and passes after (measured).** `pnpm exec vitest run examples/e2e-chain.test.ts -t "scenario 11"` with origin/main's `e2e-chain.ts` failed (`chain.nonceAfter is not a function`). The stand-in shows the old read at `latest` answers 4, the funding's nonce, not 5. On this branch: 23 passed of 23.
- **The lint rule fires (measured).** `pnpm exec vitest run tests/read-after-write.lint.test.ts`: 13 passed. `pnpm lint` on this branch: no error.
- **Existing tests (measured).** `pnpm exec vitest run packages/settlement/evm` after the first fix: 4 failed of 170. Each failure was a pinned read reading older state than the latest block did:
  - The relay's simulation pinned at viem's head of up to 1 s ago, so a trigger just past its deadline was refused TooEarly. `sync.test.ts`'s two T-228 tests caught it; a simulation and a gas estimate now ask the node's head each time.
  - A timeouts pass checked at a newer block than its relay then simulated at. `timeouts.test.ts` "the check reads at the latest…" caught it; the pass now raises the floor to the block it checked at.
  - `attack.t231-behind-recovery-stale-stage` asserted the stale book that its own comment said T-232 would pin. Its expectation now holds the takeover's stage.
  
  After those changes, the four pass, with the new file: `-t "does not stick|closes by its timeouts through the operator|the check reads at the latest|behind-recovery-stale-stage|T-232"` gave 19 passed.
- **`pnpm verify` (measured, 2026-11-06, `reports/verify-t-232-read-after-write-audit.md`):** every step passed.

  | Step | Result | Time |
  |---|---|---|
  | typecheck | pass | 228 ms |
  | lint | pass | 5,157 ms |
  | forge build | pass | 1,121 ms |
  | forge | pass: 241 tests | 19,916 ms |
  | test | pass: 2,935 passed, 6 skipped (Sepolia fork tests without `SEPOLIA_FORK_RPC`), 141 files | 478,918 ms |
  | spec | pass | 4,389 ms |
  | snap | pass: 31 | 103,892 ms |
  | snap:local | pass: 28, 3 excluded until Phase 4 | 313,849 ms |
  | demo | pass | 49,191 ms |
- **Snapshot diffs:** none. The branch changes no fixture or `.expect.md` snapshot, and `snap` and `snap:local` passed unchanged (measured).

## Decisions

1. **One floor per chain object, raised by every write and every pass (inferred: the simplest rule that covers every row).** `LiveChain` keeps the newest block it has a receipt from, a sync pass has read up to, a timeouts pass has checked at, or a restored log names. A read of the state now pins to the node's latest block, or to that floor when the node reports less. Per-deal floors would be tighter, but every read would have to name its deal, and a balance or a bond read has none.
2. **The adapter's read helper pins by default (documented in `read`'s comment).** Each caller that passes no block now gets the pinned read. Changing each call site instead would leave the next new one unpinned; the helper is the one place to change.
3. **The retry bound matches the adapter's reads at a receipt's block (documented, `RECEIPT_READ_RETRY_MS`).** Waits of 0.5, 1, 2 and 4 s within 10 s on Sepolia, scaled to the chain's receipt poll so tests run in milliseconds. Round 1's 3b found a node 2 to 4 s behind (documented, T-216 Evidence), inside that bound.
4. **A simulation and a gas estimate ask the node's head each time; other reads take viem's head of up to 1 s ago (measured by the two T-228 tests; the budget documented in `world.ts`, `LISTING_BOND_READS_PER_MIN`).**
   - With a cached head, a timeout sent just past its deadline simulated at the block before it and was refused TooEarly.
   - Asking the head before every read would double the bond listing's budgeted 2 `eth_call`s a second on the RPC endpoints the relays share.
   - The cached head adds at most one `eth_blockNumber` a second. The floor still covers this node's own writes, so a cached head only misses another party's write of the last second, as `latest` did.
5. **The nonce has no block to pin (documented: `eth_getTransactionCount` at `pending`).** Instead the lane keeps the nonce after its last mined transaction, and never sends below it. A reorg could make that floor too high (a non-goal); the give-up rule then frees the lane.
6. **A cached balance stands only while the floor does.** Clearing the cache at every applied transaction would not cover another operator's write seen only through a pass's head; tagging each entry with the floor does.
7. **The sync skips a pass whose head is below the floor.** Reading logs past a node's head can silently return fewer logs (T-230's `lag.logs`), so the pass waits for a node that has the block rather than reading up to the floor.
8. **The check is an ESLint rule (`no-restricted-syntax`), with stand-in tests beside it.** A type that requires a block was the alternative. It would touch viem's client type in every file and still allow `blockTag: 'latest'`. The rule rejects a read that names no `blockNumber`, `blockTag: 'latest'` included. Its limit: it sees syntax, so a helper that names a block only when its caller passes one, such as the adapter's `read`, passes it. The 15 stand-in tests cover that helper. The rule leaves out `examples/`: the driver's `RoundChain` wraps its reads in helpers the rule would flag (`simulateContract(call)`), and the driver keeps its own stand-in tests.
9. **Two edits were reverted: the fee log's range end and `landedDelivery`'s floor.** Both reads follow another party's transaction, which this node's floor does not reach, so no trailing-node test could show a change. They stay as they were (rows 23 and 25).

## Handoff

**Status: review.** The fixes, the tests, the lint rule and the `docs/team.md` row are in the PR. The reviewer and red-team passes ran on 2026-11-07. On Rafa's call ("simplify and stop getting into testing loops"), two findings are fixed here and the rest are in the backlog below. The coordinator merges on green CI; the operator deploy remains.

**The review round, fixed here (2026-11-07):**
1. **The floor rises only after a read at that block succeeded (red team, Medium; reviewer, Low).**
   - The timeouts pass raised the floor to the head the RPC reported, before any read at it. One `eth_blockNumber` answer 1,000,000 blocks too high then broke every pinned read until a restart.
   - Now `OperatorTimeouts.run` raises it only after the contract accepted the timeout at that block (`timeouts.ts`), and the block it checks at includes the floor.
   - `fly` raises it only after the receipt's block time is read (`live.ts`).
   - Test: `timeouts.test.ts` "one wrong head from the RPC does not raise the floor…". It failed before the fix (measured: the floor reached block 1,000,022, the head was 22) and passes after.
2. **`askAgain` asks again on a node's "header not found", "block not found" or "unknown block", before the revert test (reviewer, Medium).**
   - viem rewraps a code -32603 answer from `eth_call` as a contract revert, so a pinned contract read gave up on its first try.
   - Test: `read-after-write.test.ts` "a pinned contract read asks again…", a JSON-RPC stand-in over HTTP. Before the fix, -32603 "header not found" and "block not found" got one try (measured: 6 eth_calls, not 12 or more), and pass after. -32000 "unknown block" was asked again before as well. A revert is still asked once.
   - Run after both fixes (measured): `vitest run` of `read-after-write.test.ts`, `timeouts.test.ts` and `timeouts.redteam.test.ts`, 38 passed; `tsc -b` and `eslint packages/settlement/evm` clean. No full `pnpm verify` this round, on the coordinator's instruction; CI runs it.

**Backlog (from the review of PR 239, not built here):**
- **The answer read after a mined relay** (red team, Medium; `attack.t232-answer-read-fails-after-relay`). When the answer's balance read fails after the write mined, `process` throws after the book moved. It stores no replay, the lane row stays open, a retry with the same Idempotency-Key is refused invalid_state, and the timeouts pass defers that deal until a restart. Fix: read the answer's balances as a best effort (`balances` is optional in the schema), then always store the replay and release the row. The reviewer expected the sync to repair it through `follow`; the red team's test showed the sync never reads an applied transaction (`sync.ts:343`).
- **The nonce floor after a reorg** (red team, Low; `attack.t232-mined-nonce-after-rollback`). `minedNonce` survives a give-up, so after a reorg drops the lane's last transaction the lane keeps a nonce too high until a restart. Fix: take the larger of `pending` and the mined count at the pinned block, read each time, as `nonceAfter` does. Correct decision 5, which says the give-up frees the lane.
- **The 13 lint bypasses** (red team, Low; `lint-bypass.test.ts`):
  - an alias or destructuring of the client, and an extracted read method;
  - `viem/actions`, a computed member, and a raw `eth_call` through `request`;
  - `blockNumber: undefined`, or only nested or inside a spread;
  - a disable comment with no rule or no reason, and `.mts` and `.cts` files.
  
  The fixes that need no dependency: `reportUnusedDisableDirectives: 'error'`, nested relative `:has` selectors, and a local rule for disable reasons. Known limits that stay: a `blockNumber` that may be `undefined` at run time, the client passed to a helper, and a file that starts with `/* eslint-disable */`.
- **Persist the floor in the world's meta** (red team, Info; `attack.t232-floor-after-restart-mint`). After a restart that follows a write with no event (a faucet mint, a lane top-up, `ensureBond`), the floor restarts below that write. It is in `apps/demo-cloud/src/world.ts`.
- **A T-231 stale-book variant** (red team, Info): a stranger's direct takeover leaves a behind deal's book stale, so T-231's stale-book path stays covered now that row 13's fix no longer reaches it (`timeouts.redteam.test.ts:262`).
- **The inventory's gaps** (reviewer, Low):
  - add two driver reads at `latest`, both safe: `examples/e2e-scenarios-direct.ts:127` waits for a block's time, and `examples/e2e-round.ts:280` prints the head;
  - reword row 39, since the driver's `send` nonce is a `pending` count raised to at least the key's last send (`e2e-chain.ts:384` to `385`), not pinned;
  - refresh the `live.ts` and `timeouts.ts` line numbers.
- **The nits** (reviewer):
  - drop `newest?` from `EvmChain`, un-export `askAgain`, and make the signature `pinned(read, head)`;
  - in `docs/team.md`'s row, say the rule matches only calls on objects named `publicClient` or `client`;
  - rerun `pnpm verify` on the final head and cite the commit: the reviewer's loaded-machine run overwrote `reports/verify-t-232-read-after-write-audit.md` with a FAIL, while a plain `vitest run` passed 2,935 tests with none failing.

Differences between this file and the coordinator's brief, as the brief asked:
- **Branch:** the brief named `t-232-read-after-write`; this file names `t-232-read-after-write-audit`. The branch uses this file's name.
- **`docs/plan.md`:** this file lists it among the paths; the brief said another session owns it today. It is unchanged: that session moves T-232's row to review.
- **`site/try.mjs`:** `try.ts` makes no chain read, so neither it nor `site/try.mjs` changes, and no site rebuild or site deploy is due. try.mjs's balances step is fixed on the operators' side (rows 15, 16, 35).

What a reviewer checks:
- `packages/settlement/evm/live.ts`: `pinned`, `newest`, `floor` and `saw`, the pinned `simulate`, `sendNow` and `ethBalance`, `minedNonce`, and `ensureBond`.
- `packages/settlement/evm/evm-settlement.ts`: `read` pins by default, `tokenBalance`'s cache, and `restore`'s floor.
- `packages/settlement/evm/sync.ts`: the floor check and `saw(head)`. `packages/settlement/evm/timeouts.ts`: `saw(block)` after the contract accepted the timeout there.
- The changed expectation in `timeouts.redteam.test.ts:262`: the book now shows the takeover's stage, which is what T-232 was meant to change.

Residual risks (inferred):
- A pinned read fails where an unpinned one answered stale data. That happens when every node lacks the block for 10 s, which round 1 never showed (its nodes trailed by 2 to 4 s). The failure is loud: a relay's simulation or a GET answers an error, and the client retries.
- A balance read in `view` that fails after a relay mined throws after the book moved, as an RPC error there already did before T-232. A retry with the same Idempotency-Key then meets the moved state. A backlog row could make the view's balances a best effort; this PR does not.

To resume:
1. The coordinator merges once CI passes; the backlog above goes to `docs/backlog.md` or a follow-up task.
2. After Rafa's go-ahead, deploy holdback-op1 and holdback-op2 (T-234's deploy script, when merged). Run one smoke deal through both operators to Released, and record it here (measured).
3. Extend the lint rule to `examples/e2e-chain.ts` if the driver grows new reads (a follow-up for T-216's lane).
