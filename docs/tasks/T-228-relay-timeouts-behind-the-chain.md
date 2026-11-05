# T-228: the operators close a deal behind the chain by its timeout (residual 13)

- **Lane:** settlement
- **Phase:** 11, security hardening
- **Depends on:** T-218 (PR 185, the chain sync; done) and T-219 (PR 195, the in-flight row per relayer lane; done), whose relay code in `evm-settlement.ts` this changes. Split out of T-227 on 2026-11-05.
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` (`send` and the timeout relay for a deal behind the chain, `follow`'s branch for a deal already behind) and `packages/settlement/evm/sync.test.ts`; `docs/neutrality.md` (residual 13); `site/llms.txt` and its build, only once PR 204 (T-220) has merged; `docs/plan.md` (this row); `docs/tasks/T-227-deal-behind-the-chain.md` (the moved timeout part); this file
- **Human gate:** the deploy waits for Rafa, as every deploy does. No contract change.
- **Status:** done
- **Agent/session:** T-228 workflow session, 2026-11-05, worktree `.worktrees/t-228`, branch `t-228-relay-timeouts`

## Intent

A deal falls behind the chain when the rules contract takes a signed step that the operators' view cannot rebuild (residual 13 in `docs/neutrality.md`). The operators' book then stops before `dealOf`, the contract's record of the deal. Their adjudicators read the book, so they do not act, and the deal should end by its timeouts: the default refund, or the first decision standing.

Today the operators refuse every relay for such a deal, timeouts included (`send` in `evm-settlement.ts` answers `invalid_state`). A demo visitor whose agent holds no Sepolia ETH then cannot close the deal, and its funds wait until someone with Sepolia ETH sends the timeout to the contract.

This task makes the operators relay a timeout for a deal behind the chain. A timeout carries no signed message, and the contract checks it against `dealOf`'s stage and the terms' deadlines. The operators simulate the call first: a timeout that is not due reverts in the simulation, and nothing is sent. A due timeout is sent at the operator's gas. Its receipt moves the deal as a transaction read from the chain does: the state read shows `dealOf`'s stage at the receipt's block, with the notice, and the node invents no step.

The operators' pass sends no party timeout today (`workAt` in `apps/demo-cloud/src/world.ts`: reclaim, default and appeal expiry are a party's trigger). Only the fallback adjudicator triggers its own takeover, from the book. So the visitor's agent asks for the timeout through the API, the same call it uses for any deal, and pays no gas.

**Non-goals.** The operators' adjudicators reading `dealOf` and acting on the deal, the relay path for signed steps, and contract signers all stay in T-227. The pass does not start sending party timeouts. No contract change, no schema change, no new event type.

## Context

- **Sources:** T-227 (`docs/tasks/T-227-deal-behind-the-chain.md`), "The impact": "The operators refuse every relay for a deal behind the chain, the timeouts included". Rafa, 2026-11-05: "feels like you should solve in the next piece of work". Rafa, 2026-11-05: "You need to ship this so you stop iterating."
- **What a timeout is:** `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal` and `expireOffer` on `HoldbackRules`. Anyone may send one. Each reverts `WrongStage` or `TooEarly` unless `dealOf` and the terms' deadlines allow it.
- **How the view follows a deal behind** (T-218): `follow` records `dealOf`'s stage, queues the transaction when only the delivery is missing, and serves the keys the transaction released.

## Acceptance criteria

1. [x] **A due timeout for a deal behind the chain is relayed.** The operator simulates it, sends it from its relayer lane, and the state read then shows `dealOf`'s stage at the receipt's block. Test: `sync.test.ts`, "a deal behind the chain closes by its timeouts through the operator" (case 3 of residual 13: the funding and the delivery in one Multicall3 transaction).
2. [x] **The test ends with the contract's default outcome.** The fallback takeover after `judgeBy`, then the default after `fallbackBy`: the deal is Refunded on chain and in the state read, and the buyer gets the hold back. The parties send no transaction.
3. [x] **A timeout that is not due is not sent.** It answers `invalid_state` with the contract's `TooEarly`, and the relayer lane's nonce does not move.
4. [x] **A deal this node never saw is not touched.** A timeout for it answers `not_found`, nothing is sent, and `dealOf` does not move.
5. [x] **Signed steps for a deal behind still answer `invalid_state`** with the notice (T-227's scope), and the view stays honest: no rebuilt step, the event hash chain stays append-only, and a restart keeps the stage.
6. [x] **Docs.** Residual 13 says the operators still close such a deal by its timeout. `site/llms.txt`'s honest limit "A step the operators cannot read" says the same, with no Sepolia ETH from the visitor (PR 204 merged first, as planned).
7. [x] `pnpm verify` green.

## Out of scope

- Everything else in T-227: the adjudicators reading `dealOf`, the relay path for signed steps, each case's test, contract signers, the named attack test.
- The operators' pass sending due timeouts on its own for a deal behind (it sends none for any deal today).

## Evidence

### The deploy (2026-11-05)

**Deployed and checked; no rollback.** Rafa gave the go-ahead on 2026-11-05: "Yes, deploy it". A deploy session shipped PR 207's merge commit `236786a` to the two operators by the runbook in `docs/operations.md`, in the shape of T-220's deploy. It did not deploy the site, so T-228's line in `llms.txt` goes live with the site's next deploy. The session saved each answer under `reports/t228/` in its worktree (git-ignored). Every line below is measured unless it says otherwise.

| Worker | New version | Rollback target |
| --- | --- | --- |
| holdback-op1 | `ba7a2ad9-0172-458a-92a0-5d51d18afd0a` | `1d8a029c-44eb-4276-b5c0-c2c8894b25d5` |
| holdback-op2 | `7826e3ce-b8ce-422f-a2ea-9e88bd982ba9` | `a042aae3-821a-4efd-856a-42070205c45e` |

**Before** (15:17 to 15:28 UTC):
1. Auto-merge merged PR 207 at 15:17:46 UTC as `236786a`, after all 12 checks passed on its head `b38f4e0`. A fresh detached worktree on `236786a` passed `pnpm install --frozen-lockfile` and `pnpm build`.
2. The fork run on `236786a` passed: 1 test in 290 s, forked at Sepolia block 12,070,323, world errors none, all 16 rules-contract calls succeeded. It rehearses T-220's upgrade, not T-228's relay (inferred from the test's header); `sync.test.ts` covers T-228 on anvil.
3. Both nodes at 15:21:24 UTC: `schemaVersion` 0.10, domain Holdback 0.7, `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`. The club's `rulebookHash` was `0x3fecb058…d108`, with `randomness` drand quicknet. `GET /v1/adjudicators` listed the three demo adjudicators, each with a `registration` and `observed.bond` `bonded`: `0x71f8…7c9e` primary, `0x594a…68a2` fallback, `0xdee0…f286` appeal.
4. The world held 23 deals, all final: 15 Released, 6 Refunded, 1 Settled and 1 Expired. 14 were bound to `0x3fecb058…d108` and 9 to `0xd25b8f97…0c25`. One deal was behind the chain: `0xf0453986…5e5b`, `Released` on chain and in the state read, with the notice naming its lost delivery `0x64c5c757…caf1` (T-220's known case). No deal had a timeout due, since every deal was final (inferred), so T-228 had no deal to close.
5. At Sepolia block 12,070,335: the funding lane `0x6011…f555` held 1.8109 Sepolia ETH (1,810,877,128,750,136,128 wei) at nonce 35. The three deal lanes were at nonces 51, 21 and 24, and the three adjudicators at nonce 2. Every pending nonce equalled its nonce. `cast balance` and `cast nonce` gave the same numbers as the snapshot's RPC reads.
6. `head.eventSeq` stayed 228 on both nodes from 15:25:47 to 15:26:17 UTC.
7. `wrangler deployments status` showed holdback-op1 `1d8a029c` and holdback-op2 `a042aae3` live, the rollback targets above.

**Deploy** (15:28:43 to 15:29:20 UTC):
1. `pnpm demo-cloud:deploy` deployed both Workers on the first try: holdback-op1 at 15:28:56 UTC (startup 502 ms), then holdback-op2 at 15:29:13 UTC (startup 504 ms).
2. `/v1/status` carries no build marker, and the schema stayed 0.10. So the session read the switch from `npx wrangler@4 tail holdback-op1 --format json`. The first Durable Object event it saw ran `ba7a2ad9`, at 15:29:33 UTC, 36.5 s after holdback-op1's deploy, and so did every later one. The tail saw no event before 15:29:31 UTC, so 36.5 s is an upper bound on the switch.

**After** (15:29 to 15:41 UTC):
1. At 15:31:13 UTC both nodes served the same JSON as before for `/v1/status` (except `lagSec`), the club, the adjudicators and the commitments listing.
2. All 23 deals read the same `escrowState`, `appealState`, `rulebookHash`, deadlines, notices, `finalAt` and `lastEventSeq` on both nodes: 46 of 46 reads unchanged. On holdback-op1 each deal's full state read and terms read returned the same JSON as before. T-228 closed no deal.
3. The tail from 15:29:31 to 15:40:46 UTC: 142 events, all from `ba7a2ad9`. It held 14 alarm passes, 0 exceptions, 0 responses of 500 or more and 0 log lines. Three events ended `canceled` without an exception: both halves of one `GET /v1/events?from=0` that ran 15 s in the Durable Object, and a second run of the 15:34:49 alarm, cancelled after 9 ms, whose first run ended `ok`. Their cause is not established (guessed: a client that closed its connection, and a duplicate alarm delivery).
4. At Sepolia block 12,070,384 (15:31:13 UTC) the funding lane, the three deal lanes and the three adjudicators had the same balances, nonces and pending nonces as in Before step 5. The first sync passes sent nothing.
5. **The smoke deal.** `HOLDBACK_OPERATORS=https://api.escrow.stream,https://api2.escrow.stream node examples/try.ts` played both sides, so it used none of the test seller's quota. Commitment `0xb9d3940c…1d37` ended Released in 49 s, final at 15:34:48 UTC, bound to `0x3fecb058…d108`, with an operator fee of 4.71 tUSDC. Deal lane 2 sent all three, and each receipt has status 1:
   - funded [`0x336c049f…f203`](https://sepolia.etherscan.io/tx/0x336c049f27fa6bb473f216406afb164e679ec1d7fa5dbbf80778a106e2adf203), 840,709 gas;
   - delivered [`0xf0f4115a…f721`](https://sepolia.etherscan.io/tx/0xf0f4115ac80b970be3ebdf538fde0af144577273f08122f3c4cad43f39f9f721), 173,119 gas;
   - decided [`0x23fc4860…ddec`](https://sepolia.etherscan.io/tx/0x23fc4860ed65e3dad22a588c99efa179f716161fd9a57633c6e573ee8ea9ddec), 166,808 gas.
6. **Lane nonces.** At block 12,070,411 (15:36:40 UTC) the funding lane stood at nonce 36 and deal lane 2 at nonce 25; the other five addresses had not moved. A scan of blocks 12,070,335 to 12,070,411 found five transactions from the seven addresses, and each has a cause:
   - funding lane, nonce 35: the faucet's grant to the smoke deal's two keys, [`0x152aa853…c5e5`](https://sepolia.etherscan.io/tx/0x152aa853c5ceff5be4bd1abd82a7385aaa9a83c0efada88959ac77b0fb5ac5e5), 262,195 gas, at 15:33:12 UTC (inferred from its timing and its Multicall3 target);
   - deal lane 2, nonces 21 to 23: the smoke deal's three transactions above;
   - deal lane 2, nonce 24: the smoke deal's appeal expiry, [`0x1800ad28…72d8`](https://sepolia.etherscan.io/tx/0x1800ad284b329f5dfd60ed0f78c55b7094ff0ad2f4cb6c4ff253c857dd7b72d8), 80,792 gas, at 15:36:36 UTC. The deal's `appeal.expired` event names it. The primary adjudicator expires the appeals on its own decisions to free its bond (T-211, `apps/adjudicator/src/service.ts`).

**Not measured on Sepolia:** a relayed timeout for a deal behind the chain. No live deal had one due, and the session sent no transaction beyond the smoke deal.

### The build (before the deploy)

- **The gap, from the code** [measured: `send` in `evm-settlement.ts` at `cfbd509`]: `if (book.behind) refuse('invalid_state', this.lag(id)!)` refused every relay for a deal behind, the five timeouts included.
- **The pass sends no party timeout** [measured: `workAt` in `apps/demo-cloud/src/world.ts`]: the operators' pass acts only for their adjudicators. Reclaim, default and appeal expiry are a party's trigger, and the fallback takeover is the fallback adjudicator's own step from the book (T-227's scope). So the fix relays the API's timeout call instead of extending the pass.
- **Test first** [measured, 2026-11-05, `pnpm -C .worktrees/t-228 exec vitest run packages/settlement/evm/sync.test.ts -t T-228`, on anvil]: with the old guard put back, the new test fails at `sync.test.ts:727`. The not-due takeover answers `invalid_state: Behind the chain: …` from the operator, not the contract's `TooEarly`, so no timeout ever reaches the contract. With the fix, it passes in 6,110 ms.
- **What the test shows** [measured, the same run]: the funding and the delivery in one Multicall3 transaction put the deal behind (book `AcceptedByAdjudicator`, `dealOf` `Delivered`).
  - A signed decision still answers `invalid_state` with the notice.
  - The takeover before `judgeBy` and the default before `fallbackBy` each answer `invalid_state: contract revert TooEarly`, and no relayer lane's pending nonce moves.
  - A reclaim for a deal this node never saw answers `not_found`, no lane sends anything, and `dealOf` stays `Held`.
  - After `judgeBy` the takeover lands (`FallbackJudging`), and after `fallbackBy` the default lands (`Refunded`). The buyer's tUSDC balance grows by exactly the held amount, and the hold reads 0.
  - The operator's relayer lane sent both transactions (`triggerFallback`, `triggerDefault`, via `op-1`). The buyer's and the seller's nonces did not move.
  - The book keeps its last rebuilt step, the next sync pass applies 0 transactions, the event log stays one hash chain and matches the schema, and a restart serves `Refunded`.
- **The whole sync suite** [measured, the same day, after merging `origin/main` at `c98c0b7`]: `packages/settlement/evm/sync.test.ts`, 40 of 40 tests pass in 162.5 s.
- **`pnpm verify`** at `6578cba` plus the review fixes, 2026-11-05 14:56 UTC: PASS, no snapshot diffs against HEAD [measured: `reports/verify-t-228-relay-timeouts.md`]. `pnpm test` ran 120 files and 2,710 tests (2,707 before the review, plus the 3 regression tests). The 2 files and 6 tests skipped are the suites that need `SEPOLIA_FORK_RPC` or other secrets [inferred from their skip conditions]. CI's contracts job runs `packages/settlement/evm` on anvil, so the new tests run in CI [measured: `.github/workflows/ci.yml` line 87].

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 16,207 ms |
  | lint | `pnpm lint` | pass | 15,698 ms |
  | forge build | `forge build --root contracts` | pass | 2,849 ms |
  | forge | `forge test --root contracts` | pass | 36,883 ms |
  | test | `pnpm test` | pass | 188,584 ms |
  | spec | `pnpm validate:spec` | pass | 661 ms |
  | snap | `pnpm snap` | pass | 10,351 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 18,417 ms |
  | demo | `pnpm demo` | pass | 5,052 ms |

- **Site** [measured]: `node site/build.mjs` rewrote nothing beyond `llms.txt`'s own edit, and `node site/check.mjs` passed.
- **Review and red-team on PR 207** (2026-11-05, at `6578cba`): 1 medium and 4 low findings, all fixed in this PR. The red team's three failing fixtures are now regression tests in `sync.test.ts`.
  - Medium, `attack.t228-stale-receipt-read`: a `dealOf` read at the receipt's block that still showed the stage before the timeout froze the state read for good. Fixed in `landBehind`: such a read throws before the transaction counts as applied, and the next pass applies the receipt.
  - Low, `attack.t228-waiting-order`: a relayed timeout queued ahead of an earlier direct takeover broke the delivery's join. Fixed in `join`: the queue replays in chain order.
  - Low, `attack.t228-restart-double-send`, and the two idempotency findings: a relay whose receipt landed through `follow` on a deal behind stored no answer, after a restart or after a failed read at the receipt. Fixed in `follow`'s branch for a deal behind, so T-227 no longer needs to carry the gap, and its task file needs no clause for it.
- **Test first** [measured, 2026-11-05, on anvil, `pnpm -C .worktrees/t-228 exec vitest run packages/settlement/evm/sync.test.ts -t attack.t228`, the new tests against the code at `6578cba`]:
  - `attack.t228-waiting-order` failed: after the join the book stayed `Delivered`, behind with "trigger_default is not allowed in Delivered", while `dealOf` read `Refunded`.
  - `attack.t228-restart-double-send` failed: the retry with the same `Idempotency-Key` answered `invalid_state: contract revert WrongStage(3)`, not the replayed `ok: FallbackJudging`.
  - `attack.t228-stale-receipt-read` failed: the relayed default answered `ok` with the state read at `FallbackJudging`, while the contract had refunded the buyer. Its first run timed out at 120,000 ms; run alone, it failed on that assertion (cause of the timeout not found; it did not recur).
- **With the fixes** [measured, the same day, on anvil]: the T-228 test and the three regression tests pass in 50.1 s. The whole sync suite passes, 43 of 43 tests in 188.3 s; the regression tests take 12,536 ms (stale read, most of it the 10,000 ms read budget), 5,358 ms (waiting order) and 3,280 ms (restart). In the restart test the relayer lanes sent 1 transaction in all.
- **Sepolia** [guessed]: a timeout on Sepolia costs the operator about 80,792 gas, the cost of round 1's relayed appeal expiries (T-216). Not run on Sepolia here: no live runs in this task.

## Decisions

- 2026-11-05: the API's timeout call relays the timeout, and the pass does not send one. The pass sends no party timeout for any deal today, and Rafa asked for the smallest fix that closes a stuck deal.
- 2026-11-05: the guard lets through only the five timeouts (`TIMEOUTS`: `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal`). Each carries no signed message, and the contract is the only check: the simulation runs first, so a timeout that is not due reverts there and nothing is sent. Signed steps still answer `invalid_state` until T-227.
- 2026-11-05: a relayed timeout for a deal behind gets no mirror step. Its receipt moves the deal as a transaction read from the chain does (`landBehind`, which shares `stillBehind` with `follow`): `dealOf` at the receipt's block, the keys its logs release, no rebuilt event. An `expireAppeal` for such a deal leaves `appealClosedAt` unset, since the book holds no appeal to close.
- 2026-11-05: the test wraps the operator's `estimateGas` for one anvil 1.0.0 bug (T-217 Decision 11): anvil cannot estimate a call whose EIP-7623 calldata floor exceeds its execution gas, and every timeout is one. The shim answers only that error: a revert stays a revert. Sepolia's nodes estimate these calls.
- 2026-11-05, review: `landBehind` takes no stage from a `dealOf` read at the receipt's block that still shows the stage before the timeout. Every timeout moves the stage or the appeal state, so such an answer comes from a node that lags or follows another fork. The call throws before it marks the transaction applied, and the next sync pass applies the receipt with its own `dealOf` read, as `send` already does for a deal that is not behind (review M2).
- 2026-11-05, review: `follow`'s branch for a deal behind stores the answer of this node's own relay, so a retry with the same `Idempotency-Key` replays it after the next pass or a restart. This closes the gap the first Handoff left to T-227, in 4 lines, for timeouts and for any lane row whose deal fell behind before its receipt landed (T-219).
- 2026-11-05, review: `join` replays the waiting transactions in chain order (block, then the first log's index). A relayed timeout joins the queue when mined, so it can sit ahead of an earlier direct call that no pass had read yet.

## Handoff

- **State:** done, and live on both operators since 2026-11-05, 15:29 UTC: holdback-op1 `ba7a2ad9`, holdback-op2 `7826e3ce` (Evidence, "The deploy"). Rafa gave the go-ahead on 2026-11-05: "Yes, deploy it". PR 207 merged once CI passed, with the review and red-team findings fixed. `pnpm verify` passed at `9a88110`, 2026-11-05 15:04 UTC [measured: `reports/verify-t-228-relay-timeouts.md`]. The site is not deployed yet, so T-228's line in `llms.txt` is not live.
- **Next:** the site's own deploy publishes the `llms.txt` change. To roll back the operators: holdback-op1 `1d8a029c-44eb-4276-b5c0-c2c8894b25d5`, holdback-op2 `a042aae3-821a-4efd-856a-42070205c45e` (`docs/operations.md`, T-228).
- **Left over, small (all deals, not only those behind):** a retry with the same `Idempotency-Key` that arrives after a failed or stale read at the receipt but before the next sync pass (about 1 min while the deal is recent) runs again and answers `invalid_state`, as on `send`'s path since review M2; after the pass or a restart it replays `ok`.
- **Left over, view only:** for a deal waiting for its posted delivery, `transactions()` lists the operator's relayed timeout only once the delivery joins (`landBehind` skips `txs.push` there, and `join` records it, labelled `direct`), so the operator's gas spend for such a deal shows late or, if the seller never posts, never.
- **Not done, by choice:** the operators' pass does not send due timeouts on its own for a deal behind, so someone still calls `POST /v1/commitments/<id>/triggers/<kind>` (anyone may, at no gas). If stuck deals show up in the demo, the pass could send them; that belongs in the backlog, not here.
