# T-231: the operators send due timeouts on their own

- **Lane:** settlement
- **Phase:** 2, settlement on EVM (in focus under D53: stable EVM operations)
- **Depends on:** T-228 (PR 207, the relayed timeout for a deal behind the chain; done), T-218 (the chain sync; done) and T-219 (the in-flight row per relayer lane; done). T-228's leftover: "the operators' pass does not send due timeouts on its own". Rafa approved it on 2026-11-06: "Spin it up".
- **Paths this task may touch:** `packages/settlement/evm/timeouts.ts` and `timeouts.test.ts` (new), `packages/settlement/evm/live-entry.ts` (the export), `packages/settlement/evm/evm-settlement.ts` (only `timeout()`, a constant beside `TIMEOUTS` and the `behindStage` read); `apps/demo-cloud/src/world.ts` (the pass, the alarm, the daily budget), `telemetry.ts`, `world.test.ts`, `telemetry.test.ts` and `timeouts.anvil.test.ts` (new); `docs/api.md`, `site/llms.txt` and the site build, `docs/neutrality.md`, `docs/plan.md` (this row), `docs/tasks/T-228-relay-timeouts-behind-the-chain.md` (its leftover); this file
- **Human gate:** the operator deploy waits for Rafa, as every deploy does, and goes out in one deploy with T-230 (the operators join a delivery already on chain). No contract change, no schema change.
- **Status:** review
- **Agent/session:** T-231 implementer session, 2026-11-06, worktree `.worktrees/op-timeouts`, branch `t-231-operator-timeouts`

## Intent

Every timeout on HoldbackRules is permissionless: once its deadline passes, anyone may send it, and the contract checks it against `dealOf` and the terms. Today the operators' pass sends only the fallback takeover, at `judgeBy`, for their own fallback adjudicator. The party timeouts (the reclaim, the default and the offer expiry) wait for a caller. Since T-228 that caller can be anyone with no gas, through `POST /v1/commitments/<id>/triggers/<kind>`. But someone still has to come back, so a deal whose parties went away keeps its money held.

This task makes the operators' pass send each due timeout of every deal the world tracks, at the relayer's gas, through the same relay path the trigger route uses (`EvmSettlement.trigger`). That includes a deal behind the chain (residual 13), whose book stopped: the pass reads `dealOf` for it instead. The pass reads whether a timeout is due at a pinned block, never before a block this node already applied (`docs/team.md`, a chain read after a transaction). It sends each timeout once, across restarts, and it respects T-219's lane rows. Telemetry counts each timeout the operators sent. The relayer's gas is guarded: only deals this world holds, only calls the contract accepts at the pinned block, a cap per pass, a daily budget, and a back-off per deal after any refusal.

A party may still trigger a timeout itself, the moment it is due. Because the operators may now have sent it first, a trigger whose timeout already ran answers 200 with the state that timeout left, and sends nothing. Round 1's driver sends its own triggers (`examples/e2e-run.ts`, `trigger`), and before this change such a late trigger answered 409 `invalid_state` and failed the scenario.

**Non-goals.**
- The fallback takeover before `fallbackBy`. It is the fallback adjudicator's own turn, and the reference adjudicator declines one it would not decide (T-211). The pass sends the takeover only at `fallbackBy`, when the default needs it.
- Offers no adjudicator accepted. Nobody can fund them, and posting one is free.
- SimChain worlds, the operators' adjudicators acting on a deal behind the chain (T-227), signed steps, contract changes and schema changes.
- Pinning `send`'s own simulation to the deal's last block. That belongs to T-232, the read-after-write audit (D54), which starts once this PR and T-230's merge.

## Context

- T-228 (`docs/tasks/T-228-relay-timeouts-behind-the-chain.md`): the relay of a timeout for a deal behind the chain, and its Handoff, "Not done, by choice".
- `workAt` in `apps/demo-cloud/src/world.ts` and T-057 (the alarm only while a case awaits an adjudicator); T-211 (the demo adjudicators expire their own decisions' appeals).
- The contract's timeouts: `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal` in `contracts/src/HoldbackRules.sol`.
- `docs/team.md`, Rules and checks: "A chain read after a transaction sees that transaction".
- The operator fee (D33 as amended 2026-11-03): 4.71 tUSDC a deal on Sepolia, a 4.70 tUSDC quote for about 1.56 million gas.

## Acceptance criteria

1. [x] **Each timeout closes a deal with no caller.** On anvil, for each one, a deal reaches its due time and the pass sends it; no party sends a transaction or a trigger. Tests in `packages/settlement/evm/timeouts.test.ts`: the reclaim, the default after an unheard escalation, the takeover and default for a silent primary and fallback, an accepted offer's expiry, an unused appeal window, and an appeal nobody decides (the appellant gets its bond back).
2. [x] **A timeout that is not due is not sent.** Before each deadline the pass makes no chain read and sends nothing; the takeover before `fallbackBy` is not sent; an offer no adjudicator accepted gets no transaction.
3. [x] **The contract is the check, at a pinned block.** A timeout the book thinks due but the contract refuses at the pinned block is not sent, and the next pass does not read it again (back-off). The block is the latest head, the sync's cursor or the highest block in the log, whichever is latest.
4. [x] **Once, across a restart.** A restart between the broadcast and the receipt sends the reclaim once: the restarted pass leaves the deal to the lane row's recovery, which lands it, and then has nothing to send. Each send carries an Idempotency-Key the world derives from its secret.
5. [x] **A deal behind the chain still closes.** T-228's case (the funding and the delivery in one Multicall3 transaction): the pass reads `dealOf`, sends the takeover and then the default at `fallbackBy`, and the buyer gets the hold back.
6. [x] **Gas guards.** A cap per pass (4 sends, 16 reads), money first; a daily budget of 300 timeouts, offer expiries capped at 100 of them, in one storage row a UTC day written before each send; a back-off per deal after each refusal or failure; a stop for the pass when the relay refuses (out of test ETH, above the gas cap).
7. [x] **A party's late trigger is not an error.** After the operators' timeout, the same trigger answers 200 with the state it left, with no event and no transaction.
8. [x] **In the world.** The world's pass runs it after the sync and the adjudicators, sets the alarm at the next timeout, and counts each send in telemetry (`operatorTimeouts`, by kind). Test: `apps/demo-cloud/src/timeouts.anvil.test.ts`.
9. [x] **Docs.** `docs/api.md` and `site/llms.txt` say deals close on their own when a deadline passes, and a party may still trigger one the moment it is due; `docs/neutrality.md` (the operator's row and residual 13); T-228's leftover marked done; this row in `docs/plan.md`.
10. [ ] `pnpm verify` green; review and red-team findings fixed.

## Out of scope

- A daily budget for the trigger route itself. Since T-228 any client can ask the operators to send a due timeout, bounded only by the write throttle (120 writes a minute per client). T-231's budget counts only the timeouts the pass sends.
- Sending the timeouts from several lanes at once: the pass sends them one after another, each waiting for its block.

## Evidence

Every item is measured on this machine (anvil 1.0.0 standing in for Sepolia) unless it says otherwise. No Sepolia transaction was sent.

- **Test first** [measured, 2026-11-06]: `pnpm exec vitest run packages/settlement/evm/timeouts.test.ts` failed before `timeouts.ts` existed (the import of `./timeouts.js` fails, no test ran). With the module, all 11 tests pass in 65 s: 3 without a chain, 8 on anvil.
- **The late trigger** [measured]: with the "already ran" check in `EvmSettlement.timeout` turned off, the reclaim test fails at the party's trigger after the operators' reclaim: `invalid_state: contract revert WrongStage(6)` instead of `ok: Refunded with 0 events`. That 409 is what round 1's `trigger` helper throws on. With the check, it passes.
- **What the anvil tests show** [measured, `packages/settlement/evm/timeouts.test.ts`]:
  - Reclaim: before `deliverBy` a pass makes 0 chain reads and sends nothing, and `nextAt` is `deliverBy`. After it, one pass sends the reclaim: the deal is Refunded on chain and in the book, the buyer's balance grows by exactly what CPP held, the event says `submittedVia: op-1`, the transaction comes from the deal's lane, and the parties' nonces do not move. The next pass reads nothing; the relayer lanes sent 1 transaction in all.
  - Default: an escalation nobody decides defaults after `appealDecideBy`. A silent primary and fallback get no takeover between `judgeBy` and `fallbackBy` (0 reads); after `fallbackBy` one pass sends the takeover and the next the default, and the buyer gets the hold back. 3 transactions in all.
  - Offer expiry: the accepted offer is Expired on chain after `offerExpiresAt`; the unaccepted one stays Offered, and the lanes sent 1 transaction.
  - Appeal expiry: the unused window closes after `appealBy` and frees the primary's bond (its free bond grows by the price); the open appeal nobody decides expires after `appealDecideBy`, and the buyer's balance returns to what it held before its 100 tUSDC appeal bond.
  - The contract as the check: a reclaim a stranger sent straight to the contract, unread by any sync, makes the pass's check answer `contract revert WrongStage at block N`; nothing is sent, and the next pass makes 0 reads. The sync then applies the stranger's reclaim and the pass forgets the deal.
  - Restart: with mining held, the pass's reclaim is broadcast and its lane row (note `call: reclaim`, the pass's Idempotency-Key) is copied. The restarted node's pass defers the deal (1 deferred, nothing sent), `recover()` lands the row (`applied: 1`), and the next pass reads nothing. The lanes sent 1 transaction in all.
  - Behind the chain: T-228's case (the funding and the delivery in one Multicall3 transaction; the book AcceptedByAdjudicator, `dealOf` Delivered). The pass reads `dealOf` once and sets `nextAt` to `fallbackBy`, sends nothing after `judgeBy`, then the takeover and the default after `fallbackBy`. The buyer gets the hold back, the parties' nonces do not move, the lanes sent 2 transactions, and the last pass reads `dealOf` once and forgets the deal.
  - Caps: with 2 sends a pass and a budget of 2, the first pass sends the two reclaims first (the offer expiry, due earlier, waits: no money on it) and defers 2; the second sends nothing once the budget closes, and `nextAt` moves to its opening.
- **In the world** [measured, `apps/demo-cloud/src/timeouts.anvil.test.ts`, 1 test in 83 s]: two agents use only the HTTP API and then stop. The world's own passes expire the accepted offer nobody funded and reclaim the funded deal nobody delivered: both are Expired and Refunded on chain and on both nodes, each event says `submittedVia: demo-op-1`, each transaction comes from its deal lane, and both parties' nonces stay 0. The row `ot:<day>` reads `{sent: 2, offers: 1}`, telemetry counts `{expire_offer: 1, reclaim: 1}`, and no error was reported.
- **Unit tests** [measured]: the budget (`world.test.ts`: one row a UTC day, the offers' cap apart, kept across a restart, a new day from zero) and the telemetry count (`telemetry.test.ts`: in the hour line's `usageToday` and the day line, not carried into the next day) pass; `world.test.ts` and `telemetry.test.ts` ran 43 tests.
- **The anvil suites around it** [measured, 2026-11-06]: `packages/settlement/evm` with `apps/demo-cloud/src/registration.anvil.test.ts`, `lanes.test.ts` and `live.test.ts`: 12 files, 132 tests passed, 2 skipped (the Sepolia fork tests, which need `SEPOLIA_FORK_RPC`; inferred from their skip conditions), in 186 s. T-221's deal 4, whose demo fallback declines its turn, still reads Delivered before `fallbackBy`.
- **Site** [measured]: `node site/build.mjs` rewrote no file beyond the `llms.txt` edits, and `node site/check.mjs` passed.
- **`pnpm verify`** [measured, `reports/verify-t-231-operator-timeouts.md`, at `acf3117` plus this change, 2026-11-06 10:46 UTC]: PASS, no snapshot diffs against HEAD. `pnpm test` ran 137 files: 135 passed and 2 skipped; 2,875 tests passed and 6 skipped (the suites that need `SEPOLIA_FORK_RPC` or other secrets; inferred from their skip conditions).

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 281 ms |
  | lint | `pnpm lint` | pass | 5,844 ms |
  | forge build | `forge build --root contracts` | pass | 1,187 ms |
  | forge | `forge test --root contracts` | pass | 20,729 ms |
  | test | `pnpm test` | pass | 442,144 ms |
  | spec | `pnpm validate:spec` | pass | 621 ms |
  | snap | `pnpm snap` | pass | 9,625 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 15,173 ms |
  | demo | `pnpm demo` | pass | 4,109 ms |

- **Sepolia** [guessed]: each timeout costs the operators about 80,792 gas, the cost of round 1's relayed appeal expiries (T-228). Not run on Sepolia here.

## Decisions

- 2026-11-06: **what the pass sends.** Every due timeout of a deal the world holds, except two. The takeover before `fallbackBy` stays the fallback adjudicator's own turn (T-211 lets it decline one). An offer no adjudicator accepted gets nothing, since nobody can fund it and posting one is free. A silent fallback is therefore taken over at `fallbackBy`, and the default follows on the next pass. The outcome is the same as a takeover at `judgeBy` followed by silence: the contract refunds the buyer at `fallbackBy` either way.
- 2026-11-06: **appeal expiries for every decider.** The demo adjudicators already expire the appeals of their own decisions (T-211), and the pass runs after them, so it finds those closed. Two cases still needed the pass. An open appeal that nobody decides holds the appellant's bond until someone expires it. An outside decider's unused window holds that decider's bond. The pass sends both. The first is rank 0 (money waits on it), the second rank 1.
- 2026-11-06: **the check reads at a pinned block.** The block is the latest head the RPC reports, raised to the sync's cursor and to the highest block of any transaction in this node's log. A load-balanced node's head can trail a write, so a check never reads before a block this node already applied (`docs/team.md`). The contract answers there with an `eth_call` of the timeout itself. For a deal behind the chain, `dealOf` at that block must also show the stage this node last applied, or the pass waits a block. The relay's own simulation stays at the latest block: pinning it is T-232's (D54).
- 2026-11-06: **a late trigger answers its result.** `EvmSettlement.timeout` returns the current state, with no send, when the deal's log already holds that timeout's event (`offer.expired`, `settlement.reclaimed`, `fallback.triggered`, `default.triggered`, `appeal.expired`), as `apply_default` already did. Without it a party's trigger that comes after the operators' answers 409 `invalid_state: contract revert WrongStage(6)` (measured, below), which fails round 1's driver. A deal behind the chain logs no event for its later steps, so the contract still answers for it, as in T-228. SimChain is unchanged: no pass sends timeouts there.
- 2026-11-06: **the Idempotency-Key** is `operator-timeout:` plus the canonical keccak of the timeout, the commitment and the world's secret. The settlement layer stores keys across all commitments, and a client chooses its own key. A guessable key would let a client post another trigger under it first, so the operators' send would meet `idempotency_conflict`.
- 2026-11-06: **the budget.** 300 timeouts a UTC day, about 0.024 test ETH at 1 gwei a gas and 80,792 gas each (round 1's relayed appeal expiry, measured in T-228), with offer expiries capped at 100 inside it. One row `ot:<day>` is written before each send, as the faucet counts its mints, so a restart cannot reset it. Past the budget a deal waits for the next UTC day or a party's trigger.
- 2026-11-06: **the griefer's cost.** A griefer who opens funded deals designed to time out pays the 4.71 tUSDC operator fee on each.
  - In the demo's own units the fee covers the gas. The 4.70 tUSDC quote prices about 1.56 million gas (measured on Sepolia, T-213). Such a deal costs the operators the funding they relay, 840,709 gas (measured, T-228's smoke deal), plus at most two timeouts, about 160,000 gas (guessed from 80,792 each). That is about 1.0 million gas in all (inferred).
  - In real terms the fee is not enough. tUSDC is an open-mint test token with no value, so on Sepolia the fee costs a griefer nothing, and only the relayer's Sepolia ETH is at stake.
  - T-231 adds at most about 19% to what such a deal already costs the relayer (160,000 of 840,709 gas, inferred): the funding relay is the main cost, and it existed before. The daily budget caps what the pass adds at about 0.024 test ETH a day, at 1 gwei a gas.
  - An accepted offer costs nothing at all to post, so its expiry has the separate cap of 100 a day.
  - On mainnet with USDC the fee is real money, and D33 sets it to cover the gas.
  - A low balance on the funding lane is the backstop for both: since D54, Crow Control's "Waiting on you" warns when the funding lane holds less than about 200 deals of runway (crow-private PR 6), and the full alarm stays in T-054.
- 2026-11-06: **one send after another.** The pass sends at most 4 timeouts, each waiting for its block (about 12 s on Sepolia), so a pass takes at most about 48 s plus the reads. A Durable Object alarm may run for 15 minutes (guessed from Cloudflare's published limits; not checked here). Lanes in parallel would be faster, but no demo load needs that.

## Handoff

- **State:** in review. The pass and its tests are built; Evidence and the review rounds follow.
- **The deploy (one deploy with T-230, after both merge):**
  1. Deploy from main once both PRs have merged, from the later merge commit. Check that it holds both: `git log --oneline` shows T-230's and T-231's merges.
  2. Before: record the live versions with `npx wrangler@4 deployments status --name holdback-op1` and `--name holdback-op2` (on 2026-11-06 they were holdback-op1 `ba7a2ad9` and holdback-op2 `7826e3ce`, the rollback targets unless a later deploy replaced them). Record the funding lane's and the three deal lanes' balances and nonces (`cast balance`, `cast nonce`), as T-228's deploy did. List the open deals and their next deadlines (`GET /v1/commitments` on both nodes): any deal whose timeout is already due is closed by the first passes after the deploy, at about 80,792 gas each (guessed).
  3. Run the fork rehearsal on the merge commit (`apps/demo-cloud/src/predeploy-fork.test.ts`, which needs `SEPOLIA_FORK_RPC`), then `pnpm demo-cloud:deploy`.
  4. Watch `npx wrangler@4 tail holdback-op1 --format json` until the Durable Object runs the new version, as in T-228's deploy.
  5. After: both nodes serve the same status and the same state for every deal, except deals whose timeout came due. Each of those shows the timeout's event with `submittedVia: "demo-op-1"`, sent from its deal lane.
  6. Smoke: `HOLDBACK_OPERATORS=https://api.escrow.stream,https://api2.escrow.stream node examples/try.ts` ends Released, as before. For a timeout with no caller, offer a deal through the API with `offerExpiresInSec: 60`, let the demo primary accept it, fund nothing, and read it Expired within about two minutes with no trigger.
  7. To roll back: `npx wrangler@4 rollback <version> --name holdback-op1` and the same for holdback-op2, to the versions recorded in step 2. T-231 adds one storage prefix, `ot:`, which older code never reads (inferred from the diff). Party triggers then work as before.
- **What to watch after the deploy:**
  - Workers Logs: the hourly telemetry line's `usageToday.operatorTimeouts` counts the timeouts sent, by kind. A failed send logs `demo world: the operators' timeout for 0x… failed: …`.
  - The relayer: each timeout costs about 80,792 gas from its deal lane (guessed). The lanes top up from the funding lane as before. The daily budget caps the pass at 300 timeouts.
  - A timeout that reverted on chain after a passing check spends gas for nothing. It shows as a deal lane transaction with status 0 and no event, and the pass then backs that deal off for an hour.
  - Round 1: the driver's own triggers now answer 200 when the operators got there first; 3a, 3d and the gate after each scenario need no change.
- **Not done:** CI does not run `apps/demo-cloud/src/timeouts.anvil.test.ts`. CI's anvil step names only `packages/settlement/evm` and the testkit runner, and `.github/` is Rafa's (T-221's open CI line covers the same gap for `registration.anvil.test.ts`). The settlement half, `packages/settlement/evm/timeouts.test.ts`, runs there.
