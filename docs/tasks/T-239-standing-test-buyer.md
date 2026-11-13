# T-239: Crow's standing test buyer on the Sepolia test environment

- **Lane:** demo (the test agents, and the site for `llms.txt`)
- **Phase:** 2 (roadmap rank 2, stage 1, "Outsiders can use it"; unblocks scenario 3 of the outsider design tests, row N1b)
- **Depends on:** T-222 (the test seller and the `crow-test-agents` Worker), merged.
- **Paths this task may touch:** `apps/test-agents/`; `site/llms.txt` (the new seller section only), `site/check.mjs` (a matching check, if needed), `site/index.html` (only as the build regenerates it); `docs/operations.md` (a deploy command for the test buyer only); this file.
- **Human gate:** yes for the last criterion only: the deploy and the first seller-started deal on Sepolia wait for Rafa.
- **Status:** done (2026-11-13). First deployed 2026-11-11; redeployed in the phase-one cutover (crow-test-agents `4b675edd`), where a sale to the test buyer ended released (`docs/operations.md`, Deploy record)
- **Agent/session:** t-239-standing-test-buyer
- **Change kind:** 4 (API and operator code): the package's tests, no review, a target of 150k tokens.

## Intent

An outside seller has nobody to sell to on the test environment: the test seller (D47) covers outside buyers only. This task adds a standing test buyer beside it in `apps/test-agents`. A seller reads the buyer's published rules, offers on Crow naming the buyer's address and encryption key, and posts the commitment ID to the buyer's intake. The buyer checks the terms on the operators against its rules, refuses with the broken rule, or agrees and funds with test tUSDC. Then it follows the deal to Released or Refunded, and sends the reclaim itself when the seller misses `deliverBy`. No person at Crow takes part.

Inputs: a commitment ID from a seller. Outputs: a signed agree-and-fund, a reclaim trigger when due, and a status the seller reads. Non-goals: opening or judging the work (the adjudicator decides), negotiating, and any protocol, schema or operator change.

## Context

- D47 (`docs/decisions-today.md`): the test seller, whose later slice is this buyer.
- `apps/test-agents/src/seller.ts` and `catalog.ts`: how the seller is built, published and tested.
- `site/llms.txt`: "Try it", "Two agents, two people", sections 5, 6 and "Beyond the happy path" (triggers).
- `examples/agent.ts` and `examples/verify.ts`: the agent the buyer runs, and the prepared-message checks.

## Acceptance criteria

- [x] An outside seller's offer that names the test buyer and fits its published rules is agreed and funded with test tUSDC, with no manual step on Crow's side.
- [x] A delivery that passes the offer's checks ends Released; one that fails ends Refunded; a seller that never delivers leaves the buyer to reclaim after `deliverBy`, and the test buyer sends that reclaim itself.
- [x] The buyer publishes what it accepts (token, largest price, required deadlines and checks) at `<base>/agent.json` and on its page, as the seller publishes its catalog, and it answers a refusal with the rule the offer broke.
- [x] It signs its own EIP-712 messages with its own key from the Worker's environment; the operators only relay; it still works when one operator is offline.
- [x] Its limits (largest price, deals per seller per window) are its own published choices (D31). It refuses to start on a mainnet chain ID.
- [x] It accepts only declarative checks and runs nothing from an offer.
- [x] Every mutating call carries an `Idempotency-Key`; a restart never agrees or funds the same offer twice.
- [x] Tests cover the three outcomes on the in-process chain; the package's tests, `pnpm typecheck` and `pnpm lint` pass.
- [x] `site/llms.txt` gains "Sell to Crow's test buyer"; `node site/build.mjs` and `node site/check.mjs` pass.
- [x] (Rafa) A seller-started deal ends Released on Sepolia after the deploy (Evidence).

## Out of scope

- Rubric deals and LLM judges: the buyer takes checks-only deals.
- Private and judgment-level deals.
- Appeals: the buyer never appeals.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results (measured, 2026-11-11, in the worktree):
  - `pnpm exec vitest run apps/test-agents`: 6 files, 66 tests passed. `buyer.test.ts` has 11 of them: the card; Released; Refunded; the buyer's own reclaim after `deliverBy`, with the price and the adjudication fee back; refusals naming `accepts.maxPrice`, `accepts.checks.requiredAtLeast`, `accepts.windows.maxDeliverWithinSec`, `accepts.windows.maxJudgingSec` and `buyer`; declarative check types only; the per-seller cap (429 `limits.perSellerPerHour`); one operator offline; a lost funding answer replayed after a restart with the same key and body, one `hold.funded`; the outside seller's script end to end; the mainnet refusal. `worker.test.ts` adds the buyer's route and its `buyer:` storage prefix.
  - `pnpm typecheck`: pass. `pnpm exec eslint apps/test-agents site/check.mjs`: no findings.
  - CI on PR 309 at `8b4842f`: all 15 checks pass, CodeQL included. Its one alert, a substring check on the buyer's URL in `site/check.mjs`, was fixed in code by matching whole sentences.
  - `node site/build.mjs`, then `node site/check.mjs`: PASS, with the new check 9 (the section states `buyer-rules.ts`'s caps, windows and limits). `site/try.mjs` and `site/index.html` did not change.
- The deploy (measured, Rafa ran it). **Test seller deploy 2026-11-11 15:16 UTC, commit `7103cdf`: pass.** crow-test-agents serves `830eb7e1-9c6d-4892-a153-97b87bf17faa` with the route `crow.direct/agents/test-buyer*` and `BUYER_URL` set; the rollback target is `545afdd8-1e1c-40ff-aa35-2eea83d9ec0e`. `wrangler deployments status` shows the new version at 100%. `https://crow.direct/agents/test-buyer/health` reads `operational` for the buyer `0xd0a29422c5515a0ee31586a379a649803821dc29`, and `agent.json` serves the `crow-buyer` card. In the first minutes after the upload, 3 reads got the seller's 404 instead; 8 of 8 reads after that reached the buyer (inferred: edge locations still running the old version).
- The first seller-started deal on Sepolia (measured, 2026-11-11, Rafa's go-ahead: "Yes, run the deal"). `node apps/test-agents/scripts/sell-to-test-buyer.mjs` exited 0. A fresh seller, `0xa3bfb3cf687efa509d89539f3a47687fc4bbba6c`, offered 3 rows of `customer_id,email` for 25 tUSDC as commitment `0xd298b3da40a61685ff5903284131607582b9b05dc41a14fa78401facf25c687a`. The test buyer took the offer, agreed and funded; the seller delivered 3 rows that passed every check; the deal ended `released`. Transactions:
  - funded: https://sepolia.etherscan.io/tx/0x7645bde77304ecfb175835bcaa4a65b965bb8fbeebf1993f13376d9eec699b71
  - delivered: https://sepolia.etherscan.io/tx/0xaaf4d5ff51bb18aebcf7cd53b512313027456fc65435675355463342555741ed
  - decided: https://sepolia.etherscan.io/tx/0xfeb97694db5d2b78b0080f201cc67e6fa12f3d7f4eca273f369dc9835791be49
- Snapshot diffs: none (no scenario fixtures change).

### Review fixes (roadmap row N69, 2026-11-11)

An independent review of PR 309 found 1 High, 2 Medium and 2 Low findings in the live buyer. Rafa: "Yes, fix all three" (the day's High findings). Each one was first a failing test in `buyer.test.ts` ("the review's findings"), then fixed. All 5 failed before the fix and pass after it (measured):

1. **High: a postdated offer.** Before: an offer dated 2099, with short windows, was taken with 202. After: 422 `accepts.windows.maxCreatedAheadSec`. Every window now counts from settlement time at the post, never from the seller's `createdAt`: an offer dated more than 60 s ahead is refused, and the work is due at most 86,400 s from the post.
2. **Medium: a refused reclaim looped.** Before: one `work()` pass sent 1,190 reclaim POSTs against a 409. After: 1 POST a pass. The next try comes no sooner than 12 s later (`RECLAIM_RETRY_MS`, one Sepolia block), with a new idempotency key, and the status shows `retryAt`.
3. **Medium: no per-client cap.** Before: a third post from one client in a minute still read the operators. After: 429 `limits.perClientPerMinute`, before any operator read. The buyer allows 6 posts per client a minute and 60 an hour. It counts in memory only, with an IPv6 /64 as one client, and stores no address.
4. **Low: the open cap raced.** Before: 5 concurrent posts took 5 deals against a cap of 2. After: 2 taken, and 3 answered 429 `limits.open`. The caps are checked again, and the deal written, one post at a time after the operator reads.
5. **Low: `Agreed` and `Expired`.** Before: a deal in `Agreed` counted as funded, and one that then went `Expired` kept its slot. After: the buyer waits on `Agreed`, closes `Expired` as `expired`, and frees the slot. The 2-minute acceptance rule is now published as `accepts.windows.maxAdjudicatorAcceptSec` (120 s).
6. **From the triage note: the deploy checks.** `scripts/deploy-checks.mjs` now reads the buyer's `/health` after the seller's health and card, and rolls back when it never reads operational. `deploy.test.ts` adds that case.

- One older test changed with the rule: the over-a-day case offers 86,460 s, not 86,401 s, because the window now counts from the post, a few seconds after `createdAt`.
- `pnpm exec vitest run apps/test-agents`: 6 files, 72 tests passed. `pnpm typecheck` passes, and `eslint apps/test-agents` reports no findings. `node site/build.mjs` and `node site/check.mjs` pass (measured).
- The live buyer, read-only (measured, 2026-11-11): `/health` reads `"open": 0`, so it holds no deal, and none with a delivery deadline more than a day out. Its two deals from today ended Released and Refunded.
- Until the redeploy, the live buyer keeps finding 1 and the others (inferred: it runs `830eb7e1`, built before these fixes).

## Decisions

- **One Worker, one secret.** The buyer runs in crow-test-agents beside the seller, on its own route, with its storage under the key prefix `buyer:`. Its key derives from `TEST_AGENTS_SEED` under the label `buyer/standing`, so it needs no new secret. It funds itself from the faucet, which mints 1,000 tUSDC a grant on Sepolia; with a 50 tUSDC price cap, a grant covers at least 16 deals (arithmetic).
- **The seller posts the ID.** A seller offers on Crow naming the buyer, as section 5 already describes, and posts `{"commitmentId"}` to the buyer. The buyer answers at once: 202 taken, or 422 with `rule`, the field of `accepts` the offer broke. A refused offer leaves nothing in storage.
- **The rules** (`buyer-rules.ts`, D31: the buyer's choices): a checks-only deal with public terms in tUSDC, in the demo club, with the demo's three adjudicators. The price is at most 50 tUSDC and the adjudication fee at most 5 tUSDC. It takes 1 to 10 checks, at least 1 of them required, of the 8 types in the commitment schema. The work is due at most 86,400 s after the offer, and each judging window is at most 3,600 s. Limits: 3 deals per seller an hour and 10 a day, 50 a day in all, 10 open.
- **One operator offline.** The buyer reads from every operator that answers, requires those that answer to agree, and relays through the first that takes the message. With one operator left, the cross-check is gone, but `verify.ts` still rebuilds each message from the buyer's own intent before it signs.
- **Test networks only.** It refuses to start on any chain other than 31337, 11155111 or 84532.

## Handoff

Done: the buyer, its rules, its Worker route, the tests, the llms.txt section and its site check, the deploy steps in `docs/operations.md`, and `scripts/sell-to-test-buyer.mjs` for the first live deal.

Also done, on 2026-11-11: the deploy (`7103cdf`, crow-test-agents `830eb7e1`) and the first seller-started deal, Released on Sepolia (Evidence).

Open: lower-priority finds are in `reports/scratch/t-239-triage.md`. The first: the deploy script checks only the seller's health, so a deploy that breaks only the buyer still passes. To see a refund on Sepolia, run `node /Users/rafa/Documents/escrow/apps/test-agents/scripts/sell-to-test-buyer.mjs --outcome refund`.
