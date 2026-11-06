# T-230: the operators join a delivery that is already on chain

- **Lane:** settlement
- **Phase:** 2 (D53: stable EVM operations)
- **Depends on:** T-218 (the chain sync and the delivery join, PR 185), T-219 (the in-flight row per relayer lane, PR 195) and T-228 (timeouts for a deal behind the chain, PR 207); all done. Found by T-216's round 1, scenario 8.
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` (the `deliver` relay, `send`'s revert answer, `land`, `follow`, `step`, `rebuild`, `join` and a new `Book` field), `packages/settlement/evm/sync.ts` (`commitmentTxs`, a pinned head), `packages/settlement/evm/sync.test.ts`; `docs/neutrality.md` (the escape-hatch requirements), `site/llms.txt` (the line on submitting directly), `docs/api.md` (only if a response changes), `docs/team.md` (a Rules and checks row, if the failure repeats), `docs/plan.md` (this row) and this file
- **Human gate:** the deploy of holdback-op1 and holdback-op2 waits for Rafa, as every deploy does. No contract change, no schema change.
- **Status:** in progress
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

1. [ ] **Diagnosis, test first, on anvil** with `sync.test.ts`'s harness: a direct delivery, then the same delivery posted before a sync pass, through an RPC node that trails the chain. Today's code answers `invalid_state` and keeps no copy, and the next pass leaves the deal behind with no envelopes. The same post after the sync pass: measure whether it joins.
2. [ ] **Both orders join.** A post before the pass and a post after it each end with `delivery.submitted` (the seller's transaction, `submittedVia: "direct"`), the primary's envelope released, the primary deciding, and the post answering `ok`. No second delivery of the operator's lands.
3. [ ] **The relay checks the chain first.** Before it relays a delivery for a Held deal, the operator reads `deliveryHashOf`; when the chain holds this delivery, it joins with no relay at all.
4. [ ] **A reverted relay joins.** When the relay's simulation passes and its transaction reverts, the operator reads `deliveryHashOf` at the revert's block. The same hash: it joins. Another hash: `invalid_state`, as before.
5. [ ] **A post the node cannot join yet still joins.** When the chain holds the hash but the node cannot read the transaction within the read budget (10 s), it keeps the signed copy and answers `invalid_state` saying so. The next sync pass joins it, a restart keeps the copy, and a retry with the same Idempotency-Key replays the join.
6. [ ] **A restart between the relay and its revert** (T-219's in-flight row) keeps the copy the same way.
7. [ ] **Refusals stay.** Another delivery's hash, or a copy whose signature does not recover to the seller, is refused and keeps nothing.
8. [ ] **Docs:** `docs/neutrality.md`'s escape-hatch requirements and `site/llms.txt`'s line on submitting directly say that the post joins in either order; `node site/build.mjs` and `node site/check.mjs` pass.
9. [ ] **Review:** a `reviewer` pass, and a `red-teamer` pass on the relay and join path. Findings fixed.
10. [ ] `pnpm verify` passes and CI is green, gitleaks included.
11. [ ] **The deploy steps** for Rafa are in the Handoff, after `docs/operations.md`'s T-228 section. Nothing is deployed in this task.

## Out of scope

- Everything in T-227.
- The live deploy and the rerun of scenario 8 on Sepolia: they wait for Rafa.

## Evidence

Filled in before review.

## Decisions

## Handoff
