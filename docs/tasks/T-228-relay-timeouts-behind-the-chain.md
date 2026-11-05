# T-228: the operators close a deal behind the chain by its timeout (residual 13)

- **Lane:** settlement
- **Phase:** 11, security hardening
- **Depends on:** T-218 (PR 185, the chain sync; done) and T-219 (PR 195, the in-flight row per relayer lane; done), whose relay code in `evm-settlement.ts` this changes. Split out of T-227 on 2026-11-05.
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` (`send` and the timeout relay for a deal behind the chain, `follow`'s branch for a deal already behind) and `packages/settlement/evm/sync.test.ts`; `docs/neutrality.md` (residual 13); `site/llms.txt` and its build, only once PR 204 (T-220) has merged; `docs/plan.md` (this row); `docs/tasks/T-227-deal-behind-the-chain.md` (the moved timeout part); this file
- **Human gate:** the deploy waits for Rafa, as every deploy does. No contract change.
- **Status:** review
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
- The idempotent answer for a timeout relayed before a restart that lands on a deal behind (see Handoff).

## Evidence

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
- **`pnpm verify`** at `e4f5b15` plus this file's edits, 2026-11-05 13:33 UTC: PASS, no snapshot diffs against HEAD [measured: `reports/verify-t-228-relay-timeouts.md`]. `pnpm test` ran 120 files and 2,707 tests. The 2 files and 6 tests skipped are the suites that need `SEPOLIA_FORK_RPC` or other secrets [inferred from their skip conditions]. CI's contracts job runs `packages/settlement/evm` on anvil, so the new test runs in CI [measured: `.github/workflows/ci.yml` line 87].

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 5,247 ms |
  | lint | `pnpm lint` | pass | 5,327 ms |
  | forge build | `forge build --root contracts` | pass | 1,046 ms |
  | forge | `forge test --root contracts` | pass | 16,341 ms |
  | test | `pnpm test` | pass | 180,404 ms |
  | spec | `pnpm validate:spec` | pass | 624 ms |
  | snap | `pnpm snap` | pass | 9,285 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 14,902 ms |
  | demo | `pnpm demo` | pass | 4,424 ms |

- **Site** [measured]: `node site/build.mjs` rewrote nothing beyond `llms.txt`'s own edit, and `node site/check.mjs` passed.
- **Sepolia** [guessed]: a timeout on Sepolia costs the operator about 80,792 gas, the cost of round 1's relayed appeal expiries (T-216). Not run on Sepolia here: no live runs in this task.

## Decisions

- 2026-11-05: the API's timeout call relays the timeout, and the pass does not send one. The pass sends no party timeout for any deal today, and Rafa asked for the smallest fix that closes a stuck deal.
- 2026-11-05: the guard lets through only the five timeouts (`TIMEOUTS`: `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal`). Each carries no signed message, and the contract is the only check: the simulation runs first, so a timeout that is not due reverts there and nothing is sent. Signed steps still answer `invalid_state` until T-227.
- 2026-11-05: a relayed timeout for a deal behind gets no mirror step. Its receipt moves the deal as a transaction read from the chain does (`landBehind`, which shares `stillBehind` with `follow`): `dealOf` at the receipt's block, the keys its logs release, no rebuilt event. An `expireAppeal` for such a deal leaves `appealClosedAt` unset, since the book holds no appeal to close.
- 2026-11-05: the test wraps the operator's `estimateGas` for one anvil 1.0.0 bug (T-217 Decision 11): anvil cannot estimate a call whose EIP-7623 calldata floor exceeds its execution gas, and every timeout is one. The shim answers only that error: a revert stays a revert. Sepolia's nodes estimate these calls.

## Handoff

- **State:** in review as a draft PR. The code, the test, residual 13 and `site/llms.txt` are done. `pnpm verify` passes. Not deployed: the deploy waits for Rafa, and the `llms.txt` change goes live with it.
- **Next:** review the settlement change (the guard in `send` and `landBehind`) with the `reviewer` role, and a red-team pass, since it touches settlement. Then merge, mark this task done, and deploy when Rafa says so.
- **Known gap, for T-227:** a timeout for a deal behind whose receipt lands only after a restart gets no stored answer. `follow`'s branch for a deal behind closes the lane row without `answer`, so a retry with the same `Idempotency-Key` runs again and answers `invalid_state` (`WrongStage`) instead of replaying `ok`. The funds are safe and the deal is closed; only the retry's answer differs. The same gap predates this task for any lane row whose deal falls behind before its receipt lands (T-219). The fix is about 3 lines in that branch (store the answer for a successful row's note) plus a restart test; T-227 owns the relay path for deals behind.
- **Not done, by choice:** the operators' pass does not send due timeouts on its own for a deal behind, so someone still calls `POST /v1/commitments/<id>/triggers/<kind>` (anyone may, at no gas). If stuck deals show up in the demo, the pass could send them; that belongs in the backlog, not here.
