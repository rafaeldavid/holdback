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
6. [x] **Docs.** Residual 13 says the operators still close such a deal by its timeout. `site/llms.txt` changes only after PR 204 merges.
7. [ ] `pnpm verify` green.

## Out of scope

- Everything else in T-227: the adjudicators reading `dealOf`, the relay path for signed steps, each case's test, contract signers, the named attack test.
- The operators' pass sending due timeouts on its own for a deal behind (it sends none for any deal today).
- The idempotent answer for a timeout relayed before a restart that lands on a deal behind (see Handoff).

## Evidence

## Decisions

## Handoff
