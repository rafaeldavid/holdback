# T-230: the operators join a delivery that is already on chain

- **Lane:** settlement
- **Phase:** 2 (D53: stable EVM operations)
- **Depends on:** T-218 (the chain sync and the delivery join, PR 185), T-219 (the in-flight row per relayer lane, PR 195) and T-228 (timeouts for a deal behind the chain, PR 207); all done. Found by T-216's round 1, scenario 8.
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` (the `deliver` relay, `send`'s revert answer, `process`, `land`, `follow`, `observe`, `openDeals`, `step`, `rebuild`, `fallBehind` and new `Book` fields), `packages/settlement/evm/sync.ts` (`commitmentTxs`, a pinned head), `packages/settlement/evm/sync.test.ts` and the red team's `packages/settlement/evm/attack-t230.test.ts` (new); `docs/neutrality.md` (the escape-hatch requirements), `site/llms.txt` (the line on submitting directly), `docs/api.md` (only if a response changes), `docs/team.md` (a Rules and checks row, if the failure repeats), `docs/plan.md` (this row) and this file
- **Human gate:** the deploy of holdback-op1 and holdback-op2 waits for Rafa, as every deploy does. No contract change, no schema change.
- **Status:** review
- **Agent/session:** T-230 session, 2026-11-06, worktree `.worktrees/join-delivery`, branch `t-230-join-onchain-delivery`. Rafa approved the work on 2026-11-06 ("Spin it up").

## Intent

Restated by the T-230 session (2026-11-06). Any party may call the rules contract directly (the escape hatch, ADR-0005). The contract keeps only a delivery's hash, so a seller who delivers directly must also post the same signed delivery to an operator, which then hands the adjudicators their envelopes (T-218). Round 1's scenario 8 did exactly that on Sepolia, and the deal stuck: the operators showed it Delivered with a "Behind the chain" notice, held no envelopes, and refused every signed step, so no adjudicator could decide.

The fix makes an operator join a posted delivery whose hash the chain already holds, whichever comes first: the post or the operator's sync pass. Joined means the `delivery.submitted` event is recorded with the seller's transaction, the adjudicators' envelopes are stored and the primary's is released, the primary can decide, and the post answers success. The operator sends no second delivery of its own that lands.

The operator must still refuse a delivery whose hash differs from the chain's, and a copy whose seller signature does not verify. It never records a step the contract did not take. The same Idempotency-Key with the same body replays the answer.

**Non-goals.**
- The operators' adjudicators reading `dealOf` for a deal behind the chain for other reasons, and relays of other signed steps for such a deal (T-227, Phase 11).
- Stopping every reverted relay. An operator whose RPC node trails the seller's cannot see the seller's transaction yet; its own relay may still go out and revert, at the operator's gas only. The fix joins the seller's copy after that revert.
- No contract change, no schema change, no new event or problem type, no deploy.

## Context

- **The run:** deal `0x71f767f8022e2d17624aa2bcad1635e7f68c1eea24e0da26c144d8a1305b1197`, round 1 run `2026-11-06T070341Z` (`reports/e2e-round-1/2026-11-06T070341Z/8.json` and `summary.md` in the round's worktree). The seller's direct delivery is [`0xc9c0d024…fa0a`](https://sepolia.etherscan.io/tx/0xc9c0d02485dd28bb203f48f3a4259a862b7f2305d101151c276d55022c95fa0a). The operator's reverted relay is [`0x89d34683…4309`](https://sepolia.etherscan.io/tx/0x89d3468367309a102a8108ae306ef73ebc8f62ef16154a9366d2b16cb32b4309). Rafa closed the deal on 2026-11-06 with a direct `mutualSettle` (the driver's `settle` command, PR 224).
- **The code:** `EvmSettlement.apply`'s `deliver` case, `send`, `catchUp`, `join` and `step` in `packages/settlement/evm/evm-settlement.ts`; `commitmentTxs` in `sync.ts`.
- **The read-after-write rule** in `docs/team.md` (Rules and checks): a read after a transaction is pinned to that transaction's block or later, and a node without the block is asked again.
- T-218 Decision 5: "The posted delivery joins. It joins whether the pass has read the direct delivery or not: a relay refused with `WrongStage` reads that commitment's transactions first."

## Acceptance criteria

1. [x] **Diagnosis, test first, on anvil** with `sync.test.ts`'s harness: a direct delivery, then the same delivery posted before a sync pass, through an RPC node that trails the chain. Today's code answers `invalid_state` and keeps no copy, and the next pass leaves the deal behind with no envelopes. The same post after the sync pass: measure whether it joins.
2. [x] **Both orders join.** A post before the pass and a post after it each end with `delivery.submitted` (the seller's transaction, `submittedVia: "direct"`), the primary's envelope released, the primary deciding, and the post answering `ok`. No second delivery of the operator's lands.
3. [x] **The relay checks the chain first.** Before it relays a delivery for a Held deal, the operator reads `deliveryHashOf`; when the chain holds this delivery, it joins with no relay at all.
4. [x] **A reverted relay joins.** When the relay's simulation passes and its transaction reverts, the operator reads `deliveryHashOf` at the revert's block. The same hash: it joins. Another hash: `invalid_state`, as before.
5. [x] **A post the node cannot join yet still joins.** When the chain holds the hash but the node cannot read the transaction within the read budget (10 s), it keeps the signed copy and answers `invalid_state` saying so. The next sync pass joins it, a restart keeps the copy, and a retry with the same Idempotency-Key replays the join.
6. [x] **A restart between the relay and its revert** (T-219's in-flight row) keeps the copy the same way.
7. [x] **Refusals stay.** Another delivery's hash, or a copy whose signature does not recover to the seller, is refused and keeps nothing.
8. [x] **Docs:** `docs/neutrality.md`'s escape-hatch requirements and `site/llms.txt`'s line on submitting directly say that the post joins in either order; `node site/build.mjs` and `node site/check.mjs` pass.
9. [x] **Review:** a `reviewer` pass, and a `red-teamer` pass on the relay and join path. Findings fixed.
10. [ ] `pnpm verify` passes and CI is green, gitleaks included.
11. [x] **The deploy steps** for Rafa are in the Handoff, after `docs/operations.md`'s T-228 section. Nothing is deployed in this task.

## Out of scope

- Everything in T-227.
- The live deploy and the rerun of scenario 8 on Sepolia: they wait for Rafa.

## Evidence

### The cause

**High · the operators dropped a seller's posted delivery whenever their own relay of it lost the race to the seller's direct one.** Scenario 8's deal sat `Delivered` on chain with no envelopes for any adjudicator until Rafa settled it by hand on 2026-11-06. Every claim below is labelled.

1. The seller's direct `deliver` landed at Sepolia block 12,075,086, 170,207 gas [measured: the receipt of `0xc9c0d024…fa0a` through publicnode].
2. The driver posted the same signed delivery as soon as it had that receipt (`directDeliver` in `examples/e2e-scenarios-direct.ts`) [measured: the driver's code]. No sync pass had read block 12,075,086 yet, so the operator's book still stood `Held`, and the `deliver` case relayed it.
3. The relay's simulation passed: the RPC node that answered it still showed the deal `Held` [inferred: a passing simulation means `dealOf` read `Held`]. Deal lane 1 (`0x5e7F…3243`) sent it, and it reverted in the next block, 12,075,087, at 103,320 gas and 1 gwei [measured: the receipt of `0x89d34683…4309`].
4. A relay that reverts after a passing simulation answered `invalid_state: … nothing changed` and kept nothing [measured: `send` at `a6c275a`]. The join path ran only when the simulation itself reverted with `WrongStage` (T-218 Decision 5), and the posted copy was dropped.
5. The next sync pass read the seller's transaction, found no copy, and put the deal behind with the notice asking the seller to post. The driver had already posted, once, and stopped on the error [measured on anvil, below].

### Test first, on anvil (2026-11-06)

All on anvil standing in for Sepolia (a block every second), `packages/settlement/evm/sync.test.ts`'s harness. `lagging` stands in for an RPC node that trails the chain: its latest block reads as the block before the seller's delivery until the relay's broadcast.

- **Against `a6c275a`, before the fix** [measured, `pnpm -C .worktrees/join-delivery exec vitest run packages/settlement/evm/sync.test.ts -t "T-230|…"`]: all 4 new tests failed.
  - The post through a trailing node answered `invalid_state: deliver reverted on chain in 0x… after a passing simulation (the state or a deadline moved in between); nothing changed`, as on Sepolia.
  - A relay that lost the race in the same block, with no trailing node at all (mining held, the seller's direct delivery outbidding it), answered the same.
- **A diagnosis run of the live sequence on the old code** [measured, a one-off test since removed]:
  - The post answered that `invalid_state` in 1,086 ms; the relay reverted at 57,120 gas.
  - The next pass applied 0 transactions and put 1 deal behind. The state read showed `Delivered`, the book `Held`, 0 envelopes for the primary, and the notice. The primary's decision answered `invalid_state: Behind the chain …`.
  - **The same post after the pass joined:** `ok: Delivered` in 9 ms, 1 envelope for the primary, `delivery.submitted` naming the seller's transaction, and the primary then decided, `Released`. So the join after a pass worked; only the post before it was lost.
- **After the fix** [measured, the same command]: the 4 new tests and the 2 existing join tests pass. The whole file, `sync.test.ts`, passed 47 of 47 in 205 s before the red-team fixes.

### What the tests show (after the fix, measured)

- **Through a trailing node** (round 1's shape): the post answers `ok: Delivered` with `delivery.submitted` (the seller's transaction, `submittedVia: "direct"`) and `key.released`. The node's relay went out and reverted; the only delivery on chain is the seller's. The primary decides, `Released`. A retry with the same Idempotency-Key replays.
- **A post before any pass, through a current node:** joins with no simulation (0 `estimateGas` calls) and no transaction from the deal's lane.
- **A post the node cannot join within the read budget** (its log reads trail): answers `invalid_state` saying it keeps the copy. A restart keeps it. The next pass joins it (`applied: 1`), and the retry replays `ok: Delivered`.
- **A relay that reverts across a restart** (T-219's row): `recover` reports it `reverted: 1`, keeps the copy, and the next pass joins it; the retry replays.
- **Refusals:** another seller-signed body is refused at once by a current node, and after a reverted relay by a trailing one. A copy with a signature the seller never made answers `invalid_signature`. Nothing is kept, and the seller's own copy then joins.

### Review and red team (2026-11-06, at `1b66628`)

- **Reviewer: ISSUES, no Critical or High.** It measured `pnpm snap --settlement=local`: 28 fixtures with transcripts identical to SimChain's, 3 excluded until Phase 4, and no `.expect.md` change. Its findings and their fixes:
  1. Medium, the read before the relay had no test that depended on it: the test now counts `estimateGas` calls and expects 0.
  2. Medium, this file had no Evidence or Handoff: filled in here.
  3. Low, a kept copy's answer was lost if a read failed while the pass stored it: the copy now stays until its answers are stored (`settlePosted`), and each pass retries.
  4. Low, a kept copy did not reserve its Idempotency-Key, and a second post took the first one's place: both fixed (findings below).
  5. Low, a quiet deal is read every 15 minutes, not every minute: a deal with a kept copy now counts as recent in `openDeals`.
  6. to 8. Low, wording in `docs/neutrality.md` and `llms.txt`, one test name, and the read-after-write row in `docs/team.md`: fixed.
- **Red team: one Medium and six Low, all fixed.** Its 12 attacks are `packages/settlement/evm/attack-t230.test.ts`; 8 failed against `1b66628` and all 12 pass now [measured].
  - **Medium, `attack.t230-forged-copy-stale-state`:** through an RPC whose state reads trailed, a copy of the landed delivery with junk signature bytes answered `ok: Delivered`, and the book then held a delivery the operators' adjudicators refuse to judge. The cause predates T-230: after a simulated `WrongStage`, the catch-up took the posted copy unchecked. Fixed: only a copy whose seller signature verifies stands in for the chain's delivery.
  - **Low, `key-held-by-kept-copy`:** another body under a kept copy's key was accepted. Fixed: the key is taken until the join, as an open lane row's is (T-219).
  - **Low, `kept-copy-overwritten`:** a second post under another key took the first post's answer. Fixed: the copy keeps up to 16 more keys, and each replays the join.
  - **Low, `revert-block-unread`:** when no read at the revert's block answered, the copy was dropped. Fixed: the signed copy is kept, unconfirmed; it joins only when a pass reads a `JobSubmitted` naming its hash, and never replaces a confirmed copy.
  - **Low, `pass-skips-the-block`:** a pass whose log reads trailed past its 3-block overlap never joined the copy. Fixed: each pass reads the transactions of every deal holding a copy.
  - **Low, `kept-copy-then-timeout`:** at `judgeBy` the operator's takeover threw a divergence for a deal still `Held` in its book. Fixed by the per-pass read above: the copy joins first.
  - **Low, `lying-hash-read`:** an RPC that misreported `deliveryHashOf` stopped the relay. Fixed: when the node cannot find the transaction behind the hash, it relays the copy anyway, and the contract decides.
  - **Info, `copy-kept-after-behind`:** a copy stayed on a deal behind for another reason. Fixed: such a deal drops it.
  - **PASS:** forged or mismatched copies through a healthy RPC, the envelope checks (a delivery core refuses does not join), replay after the join and a restart, and dry runs.

### `pnpm verify`

**PASS** at `ec35fe3`, 2026-11-06 11:06 UTC, with the review and red-team fixes [measured: `reports/verify-t-230-join-onchain-delivery.md`]. No snapshot diffs against HEAD. `pnpm test` ran 134 files and 2,877 tests; the 2 files and 6 tests skipped are the suites that need `SEPOLIA_FORK_RPC` or other secrets [inferred from their skip conditions, as in T-228]. `snap:local` ran 28 fixtures on the contract, each with a transcript identical to SimChain's, and excluded 3 until Phase 4. CI's contracts job runs `packages/settlement/evm` on anvil and fails on any skip, so the new tests run in CI [documented: `.github/workflows/ci.yml`, the "anvil tests (must not skip)" step].

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 4,926 ms |
| lint | `pnpm lint` | pass | 4,530 ms |
| forge build | `forge build --root contracts` | pass | 1,010 ms |
| forge | `forge test --root contracts` | pass | 15,283 ms |
| test | `pnpm test` | pass | 468,675 ms |
| spec | `pnpm validate:spec` | pass | 711 ms |
| snap | `pnpm snap` | pass | 10,215 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 16,339 ms |
| demo | `pnpm demo` | pass | 4,766 ms |

- The worktree's `contracts/lib/commerce-payments` was copied from the main checkout at the same commit, `6b0a5ef` [measured: `git rev-parse HEAD` in both]. CI checks the submodule out itself.
- `node site/build.mjs` rewrote nothing beyond `llms.txt`'s own edit, and `node site/check.mjs` passed [measured]. `try.mjs` keeps sha256 `cc310963…d832`.
- `docs/api.md` needs no change: no response changes shape [inferred from the diff]. The kept-copy answer is the existing 409 `invalid_state`, with `state` as `docs/api.md` documents it.

## Decisions

Made by the T-230 session on 2026-11-06; Rafa can overrule any of them.

1. **Read first, then relay, then read at the revert.** Before relaying a delivery for a `Held` deal, the operator reads `deliveryHashOf` (one `eth_blockNumber` and one `eth_call`) and joins a match with no relay. It cannot pin that read to the seller's block, which it does not know, so a node that trails the seller's may still relay; its relay then reverts at the operator's gas only (103,320 gas on Sepolia), and the read pinned to the revert's block joins. Stopping every reverted relay would need the seller to name its transaction, a new API field; not worth it for gas on a testnet.
2. **The answer when the node cannot read the transaction yet:** 409 `invalid_state`, with a detail that says the node keeps the copy and joins it within about a minute. No new problem type (no schema change). The operator stores no refusal, so a retry with the same Idempotency-Key runs again and replays the join the pass stored.
3. **What a kept copy may do.** It is a seller-signed copy only. It joins only through a `JobSubmitted` log that names its hash, the same rule as T-218's join. A copy that a read of the contract confirmed replaces any other; one no read confirmed (the read at the revert's block never answered) never replaces another. It goes when its deal leaves `Held` or falls behind for another reason.
4. **Idempotency.** A kept copy's key is taken until its answer is stored, for any commitment, as for an open lane row (T-219). The same copy posted under other keys answers them all, up to 16 keys besides the first; a further key still joins the deal, but its retry answers `invalid_state` like any second delivery.
5. **Each pass reads the deals that hold a copy,** one `eth_getLogs` for the commitment each, so the join does not depend on the pass's own 3-block overlap. Kept copies are rare, so the cost is small [inferred].
6. **The lane while a copy waits.** A post the node cannot join holds the deal's lane for about 8 s, the read budget, then the relay [measured: about 8 s per kept post in `kept-copy-overwritten`]. Only a holder of the seller-signed body can do that, and it delays only that deal and the pass that waits on its lane.

## Handoff

- **State:** review. PR to come; the deploy waits for Rafa.
- **The deploy, for Rafa,** in the shape of `docs/operations.md`'s T-228 section. No contract change, no schema change, no new secret or variable.
  - **Before** (read-only; save each answer under `reports/t230/`):
    1. The PR is merged and CI passed on its merge commit. A fresh detached worktree on that commit passes `pnpm install --frozen-lockfile` and `pnpm build`.
    2. `curl -s https://api.escrow.stream/v1/status` and the same on api2: `schemaVersion` 0.10, domain Holdback 0.7, `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.
    3. `curl -s "https://api.escrow.stream/v1/commitments?limit=200"` and its `nextCursor` pages: every deal's `escrowState`, `appealState` and notices.
    4. The funding lane `0x601137a8DE7E195E1426f57C053aFa49B20Ef555` and the three deal lanes: balance and nonce (`cast balance`, `cast nonce`).
    5. `npx wrangler@4 deployments status` for both Workers: holdback-op1 `ba7a2ad9`, holdback-op2 `7826e3ce`, the rollback targets below.
  - **Deploy:** `pnpm demo-cloud:deploy` from that worktree (builds, then holdback-op1, then holdback-op2). Record the two version IDs. Watch `npx wrangler@4 tail holdback-op1 --format json` until the Durable Object runs the new version: `/v1/status` carries no build marker.
  - **After:**
    1. Both nodes serve the same status, club, adjudicators and commitments listing as before; every deal reads the same state.
    2. The first passes send nothing: the lanes' nonces and the funding lane's balance as in Before step 4.
    3. The smoke deal: `HOLDBACK_OPERATORS=https://api.escrow.stream,https://api2.escrow.stream node examples/try.ts` ends `Released` with three Etherscan links.
    4. Then the site: `node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out`, `node site/check.mjs`, `npx wrangler@4 deploy --config apps/site/wrangler.jsonc`, for `llms.txt`'s new sentences. `try.mjs` does not change (sha256 `cc310963…d832`).
  - **Rollback** (`npx wrangler@4 rollback <version> --name <worker>`): holdback-op1 `ba7a2ad9-0172-458a-92a0-5d51d18afd0a`, holdback-op2 `7826e3ce-b8ce-422f-a2ea-9e88bd982ba9`. T-230 adds two book fields, `posted` and `postedKeys`, and no storage prefix. The old code keeps them unread [inferred from the diff]; a copy kept at the rollback then never joins, and its deal waits for the seller to post again, as before T-230.
- **Then rerun scenario 8,** the one round 1 scenario still to pass (D54: 9, 10a and 10b passed live on 2026-11-06, and 11 counts by its coverage). From the `round1-run` worktree moved to the merge commit (T-216 Handoff, step 1):

  ```bash
  node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/.worktrees/round1-run/examples/e2e-round.ts run 8 --t220
  ```

  Expect the post after the direct delivery to answer `Delivered`, the check "the posted copy joins the delivery with no second deliver transaction" to pass, and the demo primary to decide `Released`. If holdback-op1 is ever redeployed by hand again (scenario 11's pause), **deploy T-230's merge commit or later, not T-228's `236786a`,** or the redeploy takes this fix back out.
- **Left over:**
  - A relay can still revert at the operator's gas when its RPC node trails the seller's (Decision 1).
  - A deal whose book lags the chain for any reason, with no copy kept, still throws a divergence when the operator relays a timeout for it before the next pass (`kept-copy-then-timeout`'s shape without the copy). This predates T-230 and belongs with T-227.
