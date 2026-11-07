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
- **Status:** review ([PR 239](https://github.com/rafaeldavid/holdback/pull/239); the reviewer and red-team passes and the operator deploy remain)
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

- **The inventory: 45 read sites in the listed paths (inferred: found by reading the code, by the lint rule below, and by the review of PR 239, which added two).** 18 are fixed here, 6 were pinned already, 4 retry already, and 17 are safe as they are, each with its reason. No site is left unsafe without a reason.
- **The fix (measured by the tests below).** Every read of the state now in the operators names a block: `LiveChain.pinned` reads at the node's latest block, or at the chain's floor when the node trails it. The floor is the newest block this node has read the state at and found: a receipt's block, a sync pass's head, a block a timeouts check was accepted at, or a restored log's last block. A head the RPC only reported never raises it. A pinned read that finds no block, in any of the shapes nodes answer, is asked again after 0.5, 1, 2 and 4 s, within 10 s on Sepolia (a quarter, a half, one and two receipt polls of 2 s, within five), then fails with the node's error. No read answers from `latest` instead.
- **The guard (measured).** An ESLint rule fails on a contract read, gas estimate, `eth_call`, balance or nonce count that does not name its block in its own argument object, in `packages/settlement/evm/` and `apps/*/src/` (`.ts`, `.mts`, `.cts`). It also fails on an alias of the client, an extracted read method, `viem/actions`, a raw `eth_call` through `request`, and a disable comment that could hide a read without its rule and a reason. On origin/main's `live.ts` it reports 7 errors (`git show origin/main:packages/settlement/evm/live.ts | eslint --stdin`). On this branch it reports none; 3 reads say why on an `eslint-disable` line. Its limits are in `docs/team.md`'s row and in `tests/read-after-write.lint-bypass.test.ts`.

### The inventory

Verdicts: **fixed here**, **pinned already**, **retried already**, **safe** (as it is, with the reason). Tests are in `packages/settlement/evm/read-after-write.test.ts` unless named otherwise, and are listed below the table.

| # | Where | The read | The write before it | A stale answer would | Verdict | Test |
|---|---|---|---|---|---|---|
| 1 | `live.ts:350` `simulate` | `eth_estimateGas` before every relay | this node's last receipt | refuse a valid message (WrongStage, TooEarly), or pass one the chain then reverts | fixed here: pinned, the head asked each time | A2, A3 (simulation), A6, R4 |
| 2 | `live.ts:544` `sendNow` | the gas estimate when no simulation ran (mints, top-ups, `ensureBond`'s approval and deposit) | the key's or the lane's previous transaction | revert the deposit TransferFromFailed before its approval (round 1's 3b) | fixed here: pinned | A1 |
| 3 | `live.ts:549`, `590` `nextNonce` | a lane's nonce when its cache is empty (first send, after a refusal or a give-up, after a restart) | the lane's last mined transaction | reuse a mined nonce ("nonce too low"); after a reorg, keep a nonce too high | fixed here: the larger of `pending` and the mined count at the pinned block, read from the chain each time; `pending` has no block, so its line says why | A5, R3 |
| 4 | `live.ts:488` `ethBalance` (`topUpLanes` 496, `ensureBond` 717) | test ETH | a top-up | top up the same lane twice | fixed here: pinned | A8, A3 (ETH), R4 |
| 5 | `live.ts:711` to `719` `ensureBond` | `bondOf`, `balanceOf`, `allowance` | the ETH send, the mint, the approval, an earlier deposit | send a second mint, approval or deposit | fixed here: pinned | A1 (a repeat sends nothing) |
| 6 | `live.ts:609` `fly` | the receipt, then its block's time | its own broadcast | answer none: the loop polls again | retried already; it now raises the floor (617), once the block's time is read too | all |
| 7 | `live.ts:682` `blockTime` | the receipt's block | the receipt | throw BlockNotFoundError | retried already (5 tries, T-216) | none new |
| 8 | `live.ts:666` `feesNow` | the fee history | none | price a fee from a block ago; the fee bump covers it | safe: no state a write moves | none |
| 9 | `live.ts:293` to `305` `verify` | chain ID, code, EIP-712 domain, `EXPIRY_MARGIN` | none: it runs before any send | none | safe: fixed at deployment (no admin keys, no upgrade proxy); the two `readContract` lines say why | none |
| 10 | `evm-settlement.ts:582` `read`, `:571` `stage` | any contract read with no block (the helper behind rows 11 to 19) | any write of this node | answer the state before the write | fixed here: pinned by default on a live chain | A3 (dealOf), R4 |
| 11 | `evm-settlement.ts:966` the offer's join check | `dealOf` | the buyer's direct funding; this node's own writes | offer as before; the next pass joins the funding | fixed here through row 10 (never below the floor); the buyer's own write stays unpinnable | A3 (dealOf) |
| 12 | `evm-settlement.ts:1025` after a refused or reverted funding bundle | `dealOf` | this node's reverted bundle | miss the copy of the fund leg and refuse | fixed here through row 10 (the floor holds the revert's block) | A3 (dealOf) |
| 13 | `evm-settlement.ts:1884` `land` after a restart | `dealOf` | the landed row's receipt | keep a behind deal's book at the stage before its own takeover | fixed here through row 10 | `attack.t231-behind-recovery-stale-stage` (`timeouts.redteam.test.ts:262`), its book flips from Delivered to FallbackJudging |
| 14 | `evm-settlement.ts:1249` the funding's balance check | the buyer's balance | the faucet's mint | make core refuse the funding (a divergence error) | fixed here: pinned | A2 |
| 15 | `evm-settlement.ts:2603` an answer's balances; GET /v1/balances (`apps/operator/src/server.ts:1172`); the faucet's gate and answer (`apps/demo-cloud/src/world.ts:1260`, `1288`) | balances | a relay; the faucet's mint (`world.ts:1201`) | show the balance before the write (the faucet answered 0 after its mint) | fixed here: pinned. An answer to a write (`process` 878, the sync's `answer` 1824) leaves the balances out when their read fails, and is stored and replayed all the same | A2, A3 (balances), R2 |
| 16 | `evm-settlement.ts:615` the balance cache | a balance read in the last 4 s | another node's release, applied by this node's pass | let a second operator serve the balance from before the release, so try.mjs's balances step finds the operators disagree | fixed here: a cached read stands only while the floor does | A4 |
| 17 | `evm-settlement.ts:990` the acceptance's free bond; `apps/adjudicator/src/simchain-adapter.ts:212` `bondCover` | `freeOf` | `ensureBond`'s deposit; a decision or an appeal expiry that frees bond | refuse the acceptance coverage_exceeded; make the fallback decline, and the deal default | fixed here: pinned | A3 (free bond) |
| 18 | `evm-settlement.ts:643` `refreshPools` (`world.ts:958`, `964`, `972`, right after `ensureBond`); `:632` `bondOf` (`world.ts:645`, `server.ts:804`) | `bondOf`, `freeOf` | the deposit | serve bond 0 in the registry for up to 60 s | fixed here: pinned | A3 (bond, pools) |
| 19 | `evm-settlement.ts:749` | `DOMAIN_SEPARATOR` | none | none | safe: a constant (now pinned through row 10 as well) | none |
| 20 | `evm-settlement.ts:1323` `nonceUsed`, `:1403` `send` | the simulation (row 1) | as row 1 | as row 1 | fixed here through row 1 | A2, A3 |
| 21 | `evm-settlement.ts:1440`, `1445` `send` after the receipt | `dealOf`, `deliveryHashOf` | its own relay | lose the call's events (T-226) | pinned already (PR 200: the receipt's block) | `sync.test.ts` |
| 22 | `evm-settlement.ts:1463` `landBehind` | `dealOf` | its own timeout | freeze a stale stage (T-228) | pinned already, with a stale-answer check | `attack.t228-stale-receipt-read` |
| 23 | `evm-settlement.ts:2372` `landedDelivery` | `deliveryHashOf` | a revert of its own relay; another party's direct delivery | relay a delivery the chain holds | pinned already (T-230: the revert's block, or the node's latest) | `attack-t230.test.ts` |
| 24 | `sync.ts:291` `commitmentTxs` (catch-up, the offer's join) | logs to the head | a revert (pinned with `atLeast`); otherwise another party's transaction | miss that transaction; the next pass applies it (3 blocks of overlap) | pinned already where it follows this node's write (T-230) | `attack-t230.test.ts` |
| 25 | `evm-settlement.ts:1306` to `1313` `feePaidEarlier` | the fee's `AuthorizationUsed` log | another party's fee transfer | refuse payment_required, whose text says a public RPC can lag and to retry | safe: another party's write, which no floor of this node's covers | none |
| 26 | `evm-settlement.ts:1593` `replayCheck`, `:660` `holdings`, `:676` `heldFor`, `:2591` `view`'s `dealOf` | the chain | none on a live chain | none | safe: anvil only (testkit, snap:local), one node that mines each transaction before its receipt returns | none |
| 27 | `sync.ts:330` a pass's head, `:350` `dealOf` at the head | the head | this node's relay after the cursor | read `dealOf` from before this node's relay and put the deal behind | fixed here: a head below the floor reads nothing and throws, which the world reports (337); a pass raises the floor once it has read the head's block (353); the cursor raises it after a restart (312) | A7, R1 |
| 28 | `sync.ts:256` `Reader.tx` | a logged transaction and its receipt | none | throw on a node without the receipt | retried already: the pass applies nothing, moves no cursor, and the next pass reads again | `sync.test.ts` "fails closed" |
| 29 | `timeouts.ts:271`, `389`, `401` the timeouts pass | the head, `dealOf`, the timeout's `eth_call` | the sync's cursor; the log's last block; the chain's floor | none: it reads at the newest of those (273) | pinned already (T-231). It now raises the floor only once the contract has accepted the timeout at that block (308), so the relay's simulation reads no earlier, and a wrong head from the RPC raises nothing; a node without the block is thrown, never read as the contract's refusal (405) | `timeouts.test.ts` "the check reads at the latest of the RPC head…", R1 |
| 30 | `evm-settlement.ts:475` `restore` | every read after a restart | the transactions in the saved log | read from before the last applied transaction | fixed here: the floor starts at the log's last block | A2 (restart) |
| 31 | `apps/adjudicator/src/simchain-adapter.ts:141` `offers` | the pool cached at the last `refreshPools` | a decision or a deposit | show an offer covered, or not, for up to 60 s | safe: the acceptance re-reads the free bond pinned (row 17) before it relays | none |
| 32 | the reference adjudicator's acceptances, decisions and triggers | the relay path | its own earlier submission | as rows 1 and 21 | safe: no read of its own; the relay path (rows 1, 20, 21) covers them | as rows 1 and 21 |
| 33 | `apps/test-agents/src/seller.ts:526`, `559`, `571`, `580`, `587` | the deal's state through the API | its own posts | none | safe: no chain read; the operator's book moves before the relay answers, and the seller waits for every operator to show Held (559) | none |
| 34 | `examples/try.ts:92` `until` | every operator's state | the script's own posts | none: it polls every 400 ms until each operator shows the state | retried already | none |
| 35 | `examples/try.ts:325` the balances step | `trusted`: every operator's balance must agree | the release | stop try.mjs with "operators disagree" | fixed here on the operators' side (rows 15, 16); `try.ts` and `site/try.mjs` do not change | A4 |
| 36 | `examples/agent.ts`, `buy-dataset.ts`, `sell-translation.ts`, `verify.ts`, `open.ts`, `run.ts`, `sign.ts`, `seal.ts` | the API | none | none | safe: no chain read | none |
| 37 | `examples/e2e-scenarios-direct.ts:328` scenario 11 | the lane's nonce at `latest` | the operator's relayed funding | take the funding for the delivery's broadcast: a false pause | fixed here: `RoundChain.nonceAfter` (`e2e-chain.ts:281`) at the funding's block or later | `e2e-chain.test.ts` "counts a relayer lane's nonce at its funding's block…" |
| 38 | `examples/e2e-scenarios-direct.ts:337` | the pause loop's counts | none | none | safe: it waits for a change, every 250 ms | none |
| 39 | `examples/e2e-chain.ts` reads given `at`, receipts, logs, `send`'s simulation and estimate | the round's evidence | the round's own sends | none | pinned already (PR 210, 220, 223) | `e2e-chain.test.ts` |
| 40 | `examples/e2e-chain.ts:272` `ethBalance` (`e2e-round.ts:154`) | Sepolia ETH | none | none | safe: a display line at the round's start, before any send | none |
| 41 | `examples/e2e-chain.ts:399` `untilIdle` | pending against mined counts | none | none | safe: before any send, and it waits | none |
| 42 | `examples/e2e-keys.ts:103`, `107` `topup` | balances and counts | the previous `topup` run's transfers | send one more top-up, up to the plan's target | safe: no write before it in its own run; the pending-against-latest check refuses while a transfer is pending (inferred) | none |
| 43 | `examples/e2e-scenarios-escalation.ts:266` | the beacon's `roundAt(at)` | none | none | safe: a pure function of `at` | none |
| 44 | `examples/e2e-chain.ts:384` to `385` `send`'s nonce | a `pending` count, raised to at least the one after this key's last send in the round | the key's previous send | reuse the nonce of the round's own last send | safe: `pending` names no block; the round's own count is its floor (PR 223), as row 3 does for the lanes | `e2e-chain.test.ts` "deposits a bond right after its approval…" |
| 45 | `examples/e2e-scenarios-direct.ts:127` `directTakeover`, `examples/e2e-round.ts:280` `finality` | the latest block's time; the head | none | wait one more poll (1 s); print a head a block old | safe: a wait that polls until the block's time passes judgeBy, and a display line (review of PR 239) | none |

Counts: 18 fixed here (rows 1 to 5, 10 to 18, 20, 27, 30, 37), 6 pinned already (21 to 24, 29, 39), 4 retried already (6, 7, 28, 34), 17 safe (8, 9, 19, 25, 26, 31 to 33, 35, 36, 38, 40 to 45), counting row 35 as safe on the client's side, since its fix is rows 15 and 16. The review of PR 239 moved the driver's `send` nonce from row 39 to row 44 and added row 45.

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
| A7 a pass whose head trails this node's own write reads nothing and says so, and the next one past it applies | 27 |
| A8 a deal lane topped up a moment ago is not topped up again | 4 |

From the review of PR 239 (2026-11-07):

| Test | Rows |
|---|---|
| R1 `neutrality.t232-rpc-bogus-head` (`t232-redteam.test.ts`): one head 1,000,000 blocks too high must not stop the operator; the direct reclaim still settles, and the book follows it | 27, 29 |
| R2 `attack.t232-answer-read-fails-after-relay` (`t232-redteam.test.ts`): a mined delivery whose answer's balance reads fail is answered, stored, replayed under its key, and its lane row goes | 15 |
| R3 `attack.t232-mined-nonce-after-rollback` (`t232-redteam.test.ts`): after a rollback drops the lane's last transaction, a send after the give-up is mined | 3 |
| R4 a pinned read asks again for every shape of "no such block" (`read-after-write.test.ts`, 18 cases over HTTP: codes -32000, -32001, -32602 and -32603 on `eth_call`, `eth_getBalance` and `eth_estimateGas`), and a revert is not asked again (3 cases) | 1, 4, 10 |
| R5 `attack.t231-behind-stale-book-direct-takeover` (`timeouts.redteam.test.ts`): a stranger's takeover no pass has read leaves a behind deal's book stale; the pass takes the contract's stage and sends the default | T-231's stale-book path, which row 13's fix no longer reaches |
| R6 `tests/read-after-write.lint-bypass.test.ts`: the red team's 13 bypasses are reported (10 cases), disables without a reason fail lint (4), `.mts` and `.cts` files are covered, and the known limits are listed (4) | the guard |

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

### The review round (2026-11-07): the red team's and the reviewer's findings on PR 239

- **Before the fixes (measured).** The red team's files, adopted as they came, failed 16 of 16 on the branch: 13 lint bypasses and the three anvil findings. With this round's added cases, `vitest run` of the adopted and new tests gave 28 failed and 35 passed. That counts every lint case, R1 to R3, A7's visible skip, and the six -32603 shapes. At this file's 500 ms bound (`pollMs` 100), viem's own retry delay made one try outlast the bound for all three methods. At a 2 s bound (`pollMs` 400), with the old predicate swapped back in, exactly the two -32603 `eth_call` shapes failed, as the reviewer's probe found.
- **After them (measured).** `vitest run` of `t232-redteam.test.ts`, `read-after-write.test.ts` and `timeouts.redteam.test.ts`: 46 passed. `tests/read-after-write.lint.test.ts` and `tests/read-after-write.lint-bypass.test.ts`: 37 passed. `pnpm lint`: no error.
- **One expectation changed (decision 11).** R2's draft expected the first submit to throw. With best-effort balances it answers `{ ok: true, state: 'Delivered', replayed: false }`, without balances, and every retry replays that answer.
- **The reviewers disagreed on R2.** The reviewer traced `follow`, which stores the answer for an applied transaction that still has a lane row (`evm-settlement.ts:1750` to `1753`), and expected the next pass to repair the answer. The red team's R2 failed on the branch (measured: the retry after a pass was refused invalid_state). The sync never reads an applied transaction (`sync.ts:343`), so `follow` never runs for it. Best-effort balances fix it at the source; the sync is unchanged.
- **The full suites and `pnpm verify`:** below, at the final head.

## Decisions

1. **One floor per chain object, raised only to a block a read has proved (inferred: the simplest rule that covers every row; measured by R1 for the proof).** `LiveChain` keeps the newest block it has read the state at and found. That is a receipt's block once its time is read, a sync pass's head once the pass has read that block, a block the contract accepted a timeout at, or a restored log's last block. A read of the state now pins to the node's latest block, or to that floor when the node reports less. Per-deal floors would be tighter, but every read would have to name its deal, and a balance or a bond read has none.
2. **The adapter's read helper pins by default (documented in `read`'s comment).** Each caller that passes no block now gets the pinned read. Changing each call site instead would leave the next new one unpinned; the helper is the one place to change.
3. **The retry bound matches the adapter's reads at a receipt's block (documented, `RECEIPT_READ_RETRY_MS`).** Waits of 0.5, 1, 2 and 4 s within 10 s on Sepolia, scaled to the chain's receipt poll so tests run in milliseconds. Round 1's 3b found a node 2 to 4 s behind (documented, T-216 Evidence), inside that bound.
4. **A simulation and a gas estimate ask the node's head each time; other reads take viem's head of up to 1 s ago (measured by the two T-228 tests; the budget documented in `world.ts`, `LISTING_BOND_READS_PER_MIN`).**
   - With a cached head, a timeout sent just past its deadline simulated at the block before it and was refused TooEarly.
   - Asking the head before every read would double the bond listing's budgeted 2 `eth_call`s a second on the RPC endpoints the relays share.
   - The cached head adds at most one `eth_blockNumber` a second. The floor still covers this node's own writes, so a cached head only misses another party's write of the last second, as `latest` did.
5. **The nonce's `pending` count has no block to pin; its floor is the mined count at the pinned block (corrected after the red team's R3, measured).**
   - The first version kept the nonce after the lane's last mined transaction in memory, and said a give-up would free the lane after a reorg. It did not: a give-up cleared the nonce cache but not that memory. Each later send took the same nonce, which was too high, until a restart.
   - Now a lane with no cached nonce takes the larger of `pending` and the count of mined transactions at the pinned block, read from the chain each time. After a reorg that count follows the chain the node serves, once the chain has grown back past the floor. After a restart it covers the lane too.
   - The cost: one more read when the cache is empty, at the first send, after a refusal or after a give-up.
6. **A cached balance stands only while the floor does.** Clearing the cache at every applied transaction would not cover another operator's write seen only through a pass's head; tagging each entry with the floor does.
7. **The sync reads nothing in a pass whose head is below the floor, and throws, so the world reports it (made visible after the red team's R1).** Reading logs past a node's head can silently return fewer logs (T-230's `lag.logs`), so the pass waits for a node that has the block rather than reading up to the floor. A skip that returned null was silent; with R1's wrong head it would have stopped every pass without a word.
8. **The check is an ESLint rule (`no-restricted-syntax`), with stand-in tests beside it.** A type that requires a block was the alternative. It would touch viem's client type in every file and still allow `blockTag: 'latest'`. The rule rejects a read that names no `blockNumber`, `blockTag: 'latest'` included. Its limit: it sees syntax, so a helper that names a block only when its caller passes one, such as the adapter's `read`, passes it. The 15 stand-in tests cover that helper. The rule leaves out `examples/`: the driver's `RoundChain` wraps its reads in helpers the rule would flag (`simulateContract(call)`), and the driver keeps its own stand-in tests.
9. **Two edits were reverted: the fee log's range end and `landedDelivery`'s floor.** Both reads follow another party's transaction, which this node's floor does not reach, so no trailing-node test could show a change. They stay as they were (rows 23 and 25).
10. **A node's "no such block" answer is recognised before any revert test, in every shape (the reviewer's finding 1, measured by R4).** viem rewraps a code -32603 "header not found" from `eth_call` as a contract revert, so the first version gave up at once on a node that only lagged. `missingBlock` (`errors.ts`) reads every message in the error's chain for "header not found", "block not found", "unknown block" or viem's own "could not be found". The timeouts check uses it too, so a missing block is never counted as the contract's refusal.
11. **The answer to a write reads the parties' balances as a best effort (the red team's R2; the coordinator's choice of fix).** The write has mined and the book has moved, so `process` and the sync's `answer` store the answer and release the lane row whatever a balance read does. A failed read leaves `balances` out of the answer; `commitment-state.schema.json` makes it optional, so no schema change. GET /v1/commitments/<id> still fails loudly on a failed balance read: it moves nothing, and a retry is safe. The other repair the red team offered, a sync pass that answers an applied transaction with an open row, would duplicate this and is not built.
12. **The lint rule is hardened by syntax only, with no new dependency (the red team's R6).**
    - **Reported now:** a read whose own argument object lacks a `blockNumber` that is not `undefined`; a computed member; an alias of the client or an extracted read method; `viem/actions`; a raw state read through `request`; `.mts` and `.cts` files; unused disable directives.
    - **Disables:** core ESLint cannot require a reason on a disable comment. A local rule (`holdback/disable-with-reason`, defined in `eslint.config.js`) does it for any comment that could hide the read rule. A file that starts with a bare `/* eslint-disable */` hides every report, the local rule's included, so a test scans the covered files for that.
    - **Known limits** (`docs/team.md`, and the lint-bypass test's last cases): a `blockNumber` whose value may be `undefined` at run time, the client passed to a helper that reads, and a member named by a variable. A typed reader that hides `publicClient` would close them; the coordinator kept that out of this PR.

## Handoff

**Status: review.** The fixes, the tests, the lint rule and the `docs/team.md` row are in the PR. The reviewer and red-team passes ran on 2026-11-07, and their findings are fixed in this branch (Evidence, the review round). Their second look and the operator deploy remain.

Differences between this file and the coordinator's brief, as the brief asked:
- **Branch:** the brief named `t-232-read-after-write`; this file names `t-232-read-after-write-audit`. The branch uses this file's name.
- **`docs/plan.md`:** this file lists it among the paths; the brief said another session owns it today. It is unchanged: that session moves T-232's row to review.
- **`site/try.mjs`:** `try.ts` makes no chain read, so neither it nor `site/try.mjs` changes, and no site rebuild or site deploy is due. try.mjs's balances step is fixed on the operators' side (rows 15, 16, 35).

What a reviewer checks:
- `packages/settlement/evm/live.ts`: `pinned(read, head)`, `newest`, `floor` and `saw`, `askAgain`, the pinned `simulate`, `sendNow` and `ethBalance`, `nextNonce`, `fly` (the floor after the block's time), and `ensureBond`.
- `packages/settlement/evm/errors.ts`: `missingBlock`.
- `packages/settlement/evm/evm-settlement.ts`: `read` pins by default, `tokenBalance`'s cache, `restore`'s floor, and `view`'s best-effort balances in an answer.
- `packages/settlement/evm/sync.ts`: the floor check, which now throws, and `saw(head)`.
- `packages/settlement/evm/timeouts.ts`: the floor in the check's block, and `saw(block)` only after the contract accepted the timeout there.
- `eslint.config.js`: the rule's selectors and the local `holdback/disable-with-reason` rule.
- The changed expectations: `timeouts.redteam.test.ts:262`, where the book now shows the takeover's stage, which is what T-232 was meant to change; and R2's first answer (decision 11).

Residual risks (inferred):
- A pinned read fails where an unpinned one answered stale data. That happens when every node lacks the block for 10 s, which round 1 never showed (its nodes trailed by 2 to 4 s). The failure is loud: a relay's simulation or a GET answers an error, and the client retries.
- After a reorg deeper than the floor, every pinned read fails until the chain grows back past the floor's block number (R3 shows it recovers). Reorgs are a non-goal.

Deferred, from the red team's Info (not built here):
- **The floor after a restart that follows a write with no event** (a faucet mint, a lane top-up, `ensureBond`). The floor restarts at the saved log's last block and the sync's cursor, which may predate such a write by a few blocks. A read right after the restart could then answer from before it: the faucet's answer, or the funding's balance check, which a retry passes. The fix is to keep the floor in the world's meta row, written with the books and read at open. It belongs in `apps/demo-cloud/src/world.ts`, which the T-233 session is changing today; its test needs the world on anvil behind `trailing`. Fixture name, when built: `attack.t232-floor-after-restart-mint`.
- **The lint rule's known limits** (decision 12) stay until a typed reader hides `publicClient`, which is out of this PR's scope.

To resume after review:
1. Fix the review findings in this branch, then merge once CI passes.
2. After Rafa's go-ahead, deploy holdback-op1 and holdback-op2 (T-234's deploy script, when merged). Run one smoke deal through both operators to Released, and record it here (measured).
3. Extend the lint rule to `examples/e2e-chain.ts` if the driver grows new reads (a follow-up for T-216's lane).
