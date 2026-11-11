# Known issues

One list of the weaknesses and limits that Crow's own docs record, for an auditor. It gathers; it adds no new finding. Crow runs on Ethereum Sepolia with test tokens only, so no row puts real money at risk today. Scope is in [`scope.md`](scope.md).

How to read it:
- **Severity** is the word the source uses. "Not rated" means the source gives none.
- **Status** is one of: open, accepted, fixed in a PR, deferred to a task.
- Every row is documented in the file its "Recorded in" column names. A row says [inferred] where this page concludes something the source does not state.
- T-212, the contract hardening task, is paused. Its open items ship with the contract redeploy before mainnet ([T-212](../tasks/T-212-contract-hardening.md), Status).

## 1. Residual control points

Source: [`docs/neutrality.md`](../neutrality.md), "Residual control points". The source rates none of them and accepts all 13 for the prototype.

| ID | Issue | Recorded in | Severity | Status | What bounds the loss today |
| --- | --- | --- | --- | --- | --- |
| R-1 | A stablecoin issuer can freeze an address, and then a push transfer to it reverts | residual 1; review I-7 | not rated | accepted; out of scope (`SECURITY.md`) | The parties choose the token. The demo's tUSDC has no freeze |
| R-2 | An L2 sequencer can delay transactions | residual 2 | not rated | accepted | Forced inclusion where the chain has it, and deadlines sized for it. Sepolia has no sequencer [inferred] |
| R-3 | An adjudicator can collude with one party | residual 3 | not rated | accepted | Commit-reveal panel selection, panels across model families, an appeal to another adjudicator, and the bond |
| R-4 | If every operator, every adjudicator and both agents vanish, funds stay held | residual 4 | not rated | accepted | Anyone can trigger the timeout; one live party is enough |
| R-5 | Courts and regulators can compel real-world parties | residual 5 | not rated | accepted, by design | None in the protocol |
| R-6 | An adjudicator that decrypts a delivery can copy or leak it | residual 6 | not rated | accepted | The parties name the adjudicators. Bonds and appeals do not reach a leak |
| R-7 | The appeal adjudicator's decision is final and, on an overturn, moves the first decider's bond | residual 7 | not rated | accepted | A larger panel, and the first decider's consent to the appeal adjudicator the terms name. The appeal adjudicator posts no bond on chain (L-5; section 8) |
| R-8 | No provider signs judge responses, so an adjudicator could run a cheaper model under a pinned name | residual 8 | not rated | accepted | The bond and appeals. The calibration harness is not built (G-2) |
| R-9 | The deal's skeleton is public: addresses, token, price, deadlines, adjudicators and outcomes | residual 9 | not rated | accepted | Per-deal keys at the `private` and `judgment` levels; bodies travel as ciphertext |
| R-10 | If no beacon round can be proven in a whole window, that adjudicator cannot decide | residual 10 | not rated | accepted; its fixture is planned | The case goes to the fallback or the default outcome |
| R-11 | A funding transfer links the funding account to the commitment | residual 11 | not rated | accepted | The agent chooses how to fund |
| R-12 | A principal has no recourse after its agent signs within its mandate | residual 12 | not rated | accepted | The mandate's scope caps |
| R-13 | Five kinds of direct step leave the operators' view behind the chain, and the operators' own adjudicators then do not act on that deal | residual 13; `docs/operations.md`, T-228 | not rated | open; deferred to T-227, before mainnet | The deal ends by its timeouts, which the operators send at their own gas. Funds stay under the contract's terms. A signed step through the API answers `invalid_state` for such a deal |

## 2. Contract review findings that are not fixed

Source: [`docs/reviews/2026-11-03-contract-review.md`](../reviews/2026-11-03-contract-review.md), §2 and §8. The review read commit `baac930`. H-1, M-1, M-2, M-3, L-1 and L-7 are fixed in the deployed contracts, and H-2 is fixed with the limit in the first row.

| ID | Issue | Recorded in | Severity | Status | What bounds the loss today |
| --- | --- | --- | --- | --- | --- |
| H-2 limit | A decision's calldata carries the buyer's key, so the contract's refusal cannot stop a signed key from reaching a refunded buyer | §2.1, H-2 "Limit" | high (the finding) | contract fixed in PR #125; reference adjudicator fixed in PR #175 (T-211) | The reference adjudicator never seals the key for an appeal over a reject. Another adjudicator could [inferred] |
| L-2 | The bond vault credits the nominal amount, so a fee-on-transfer or rebasing token leaves it short | §2.3 | low | open; deferred to T-212 item 1 | Only adjudicators who bond in such a token are exposed |
| L-3 | The contract accepts an appeal with a bond of 0, and since the overturn payout a free appeal can win the price from the decider's bond | §2 table; §2.3; `test_attack_zero_bond_appeal_accepted_without_allowance` and `test_attack_free_appeal_wins_the_price_from_the_bond` (`contracts/test/unit/OverturnKeyRelease.t.sol`) | low; blocks mainnet since D43 | open; blocks mainnet with L-5. Deferred to T-212: a minimum appeal bond in the signed terms | The appeal adjudicator the terms name decides it. On the demo the tokens are worthless and the appeal adjudicators are Crow's (D48) |
| L-4 | The contract checks the primary's seed commitment on 144 bits, and the tag does not bind the commitment | §2.3 | low | open; deferred to T-212 item 2 | A collision costs about 2^72 work. Core checks all 256 bits, so an off-chain verifier sees it |
| L-5 | The appeal adjudicator decides with no bond on chain, yet its decision moves the price out of the first decider's bond | §2.3; `test_attack_appeal_adjudicator_decides_escalation_with_no_bond_at_stake` and `test_attack_party_appeal_adjudicator_has_nothing_at_stake` (`contracts/test/unit/UnbondedDecider.t.sol`) | medium since D43 (low before it; the adversarial pass rated it medium, DeepSeek high); blocks mainnet | open; deferred to T-212 item 5. The fallback's part is fixed in PR #135 | The primary consents by accepting terms that name the appeal adjudicator. The reference adjudicator declines terms whose fallback or appeal adjudicator it does not trust |
| L-6 | `authorizationExpiry` ignores `judgeBy`, so a `judgeBy` after it stops the primary's on-time decision from capturing | §2.3; `test_attack_d31_deadlines_after_expiry_leave_seller_unpaid` (`contracts/test/unit/CppReclaimStrandsBonds.t.sol`) | low | open; deferred to T-212 item 4 | The M-1 fix keeps the bonds safe, and the buyer reclaims on CPP |
| L-8 | A `judgeBy` already past at funding makes the fallback's beacon round public before the terms are signed | §2.3 | low | open; deferred to T-212 item 8 | The reference path refuses that schedule. It takes a buyer who signs such terms directly |
| I-2 | A dead fee-share branch sits in `_payOut` (`MUTUAL_FEE_SHARE_BPS` is a constant 0) | §2.3 | info | open; deferred to T-212 item 6 | No effect on funds; it costs bytecode. Headroom is 263 bytes |
| I-8 rest | The contract has no default compensation from bonds, no appeal fee and no minimum appeal bond | §2.3, I-8 update | info; the minimum bond blocks mainnet | open; Phase 4, except the minimum bond (L-3) | A default refunds the buyer; nobody is paid from a bond [inferred] |
| I-1, I-4 to I-7, I-9 to I-13 | Ten informational items, each with a label and a disposition | §2.3, "Informational"; I-9: `test_info_mutual_payout_to_rules_strands_tokens` (`contracts/test/unit/Withstood.t.sol`) | info | accepted or documented, per item | See each item |
| DS-1 | The primary chooses its own panel seed through its seed commitment | §8, DeepSeek table | medium (DeepSeek); deferred (the review) | open; ADR-0018 "Not adopted" | Calibration, the parties' choice of primary, and the appeal with its overturn payout |

## 3. Other changes waiting for the contract redeploy

| ID | Issue | Recorded in | Severity | Status | What bounds the loss today |
| --- | --- | --- | --- | --- | --- |
| T-225 M1 | The fallback's drand quicknet round is public before the primary's deadline | [T-217](../tasks/T-217-drand-proofs-sepolia.md), Decisions | medium (red team) | open; deferred to T-225, with six smaller items (M2, M3, L1 to L3, I1) | Not stated in the source |
| T-221 | The contract does not yet refuse terms whose adjudicators' bonds cannot pay [inferred from the backlog row's title, "The protocol refuses a selection the terms cannot pay"] | T-212 Handoff | not rated | open; deferred to the redeploy | The operator refuses to relay terms whose fallback has less free bond than the price (`docs/neutrality.md`, operator row) |

T-225 and T-227 have no task file in this repository. `CLAUDE.md` ("Map") says the phases after Phase 2 are planned privately.

## 4. The reference adjudicator

Source: [T-211](../tasks/T-211-appeal-key-adjudicator.md), Handoff. The source calls none of these blocking.

| ID | Issue | Recorded in | Severity | Status | What bounds the loss today |
| --- | --- | --- | --- | --- | --- |
| A-1 | A sham deal priced at a fallback's whole free bond still holds that bond once the fallback decides | "What remains of the sham-deal lock (T-206 M-3)" | not rated; "bounded, not removed" | open | The hold lasts at most `appealWindowSec` plus `appealDecideSec`: two weeks with the defaults. The attacker pays the fee and ties up its own capital each time [inferred by the source] |
| A-2 | Sham offers that a service accepts as primary drain the free bond its fallback turns need, which can force the default on another deal | Follow-up 2 | not rated | open; "needs its own task" | On the contract the sham must be funded and must last until `fallbackBy`; the attacker gets its capital back [inferred by the source] |
| A-3 | The service trusts its settlement port for the first outcome of an appealed deal | Follow-up 5 | not rated | open | The port is the service's own reader of the chain |
| A-4 | A restart while the fallback waits for cover runs its panel a second time | Follow-up 7 | Low | open | The first verdict was never published or signed |

## 5. Operators and tooling

| ID | Issue | Recorded in | Severity | Status | What bounds the loss today |
| --- | --- | --- | --- | --- | --- |
| O-1 | A test-ETH drip from the faucet would be farmable: about 0.6 Sepolia ETH a day at 600 grants, which empties the funding lane in about three days | `docs/decisions-today.md`, D48, "Not chosen: a gas drip" | not rated | not built; Crow relays a token permit instead | The faucet mints tUSDC only, with limits per address, per client and per day (ADR-0028 §6) |
| O-2 | 13 ways bypass the lint rule that makes each chain read name a block | [T-232](../tasks/T-232-read-after-write-audit.md), Handoff, Backlog. Its test, `tests/read-after-write.lint-bypass.test.ts`, never reached `main` (section 8) | Low (red team) | open | Stand-in tests cover the adapter's read helper. The rule is a lint check, so it guards source code only [inferred] |
| O-3 | When a balance read fails after a relay mined, the operator stores no replay and defers that deal's timeouts until a restart | T-232 Handoff, Backlog. Its test, in `packages/settlement/evm/t232-redteam.test.ts`, never reached `main` (section 8) | Medium (red team) | open | The step is already on chain; the parties can submit to the contract directly [inferred] |
| O-4 | After a reorg drops a lane's last transaction, the lane keeps a nonce that is too high until a restart | T-232 Handoff, Backlog. Its test is in the same file as O-3's, which never reached `main` | Low (red team) | open | Not stated in the source |
| O-5 | The contracts are not verified on Etherscan | `docs/operations.md`, "Sepolia contracts" | not rated | open | `deploy-sepolia.sh --check` compares the chain with the build |

## 6. Recorded gaps in tests and evidence

| ID | Gap | Recorded in | Status |
| --- | --- | --- | --- |
| G-1 | Five `neutrality.*` fixtures and one `todo.*` fixture are planned, not built | `docs/neutrality.md`, control-point table and "How neutrality is tested" | open; they gate mainnet, not the Sepolia demo |
| G-2 | The calibration and red-team harness is not built, and the live registry was promoted without calibration | `docs/judgment-and-defenses.md`; `config/judges-live.yaml` header | open; T-301, Phase 3 |
| G-3 | The formal model has no CPP reclaim by the buyer and no bond coverage, and its README's contract column reads TBD | review §5 and I-11; `formal/README.md` | fixed in part in T-337: the model has the buyer's CPP reclaim and posted and encumbered bond, and the README maps each action and variable to the contract line. Open: its bond is sized so the coverage gate never blocks, so the uncovered-fallback default path (`HoldbackRules.sol:325-327`) is unexplored; L-3, L-5 and a `deliverBy` after the expiry are not modelled. They pass to refinement package R4 (T-337 Handoff) |
| G-4 | The adversarial pass's 24 proof-of-concept tests are not in the repository | review §2 | fixed in the T-335 PR: all 24 are in `contracts/test/unit/`, 7 in `Withstood.t.sol` (T-322) and 17 ported by T-335 (16 attacks and 1 defense): regressions for fixed findings, attack-shaped tests for open ones |
| G-5 | A mutant that stores no delivery hash is caught by unit tests, but no invariant counts it | T-212 Handoff; `docs/tasks/T-336-invariant-liveness-counter.md` | fixed in T-336: the handler counts every landed delivery, and `invariant_deliveryHashStored` fails on the mutant (measured) |
| G-6 | No external audit has run | `docs/tasks/T-206-contract-review.md`, Status | open; before mainnet |
| G-7 | Aderyn has not run since `baac930`; Slither ran at `1430f77` with every result answered | [`docs/reviews/2026-11-11-static-analysis.md`](../reviews/2026-11-11-static-analysis.md), §6 | fixed in T-339: Aderyn 0.6.8 ran at `8bd8eb1` (same `contracts/src/` as `1430f77`) and on `contracts-audit-ready`; no defect, every result known or dismissed |

## 7. Testnet-only facts

- **tUSDC is open-mint.** Anyone can mint any amount; it guards no value (`contracts/script/TestUSDC.sol`).
- **The relayer pays test ETH.** One Sepolia-only relayer secret on operator node 1 pays gas through a funding lane and three deal lanes. It has no role in any contract (`docs/operations.md`, Secrets).
- **The demo adjudicators' keys are generated in a Durable Object.** The world derives the three adjudicators' keys, both operators' keys and the club's keys from one random secret that it creates and stores (`apps/demo-cloud/src/world.ts`, `meta.secret`). Crow therefore runs the primary, fallback and appeal adjudicators of the demo.
- **Both operator nodes serve one world.** Node 2 has its own receipt key and forwards to the same Durable Object (`docs/operations.md`, "What is live").
- **Live judges are capped at 30 calls a day.** Past the cap, panels are scripted and every verdict says so. The DeepSeek model IDs are provider aliases with no dated snapshot (`config/judges-live.yaml`).
- **The deployer is a throwaway key** with no authority on chain.

## 8. Where the sources disagreed, and how each was settled

Six places where Crow's own sources disagreed are settled. Each was settled by the primary source: the code at `main` `1430f77` (where `contracts/src` equals the deployed `64be1f1`), the merged PRs, or the decision log. This page's rows now follow the source that is right. The docs that are still wrong are listed in [T-338](../tasks/T-338-audit-docs.md), Handoff, for the docs batch; this page does not edit them. Settled on 2026-11-11 (T-338).

| Item | The disagreement | Settled by | The source that is right | What changed on this page |
| --- | --- | --- | --- | --- |
| L-1 | The review's findings table lists it as a T-212 item; T-212 and the review's §8 follow-up say PR #161 fixed it | The code: `deliveryHashOf` is stored at `HoldbackRules.sol:628`, and `decide`, `earlyAccept` and `mutualSettle` require it at `:276`, `:403` and `:439` [measured]. PR #161 merged on 2026-11-04 with merge commit `64be1f1`, the deployed commit [measured: `gh pr view 161`] | T-212 and review §8: **fixed** | Nothing: section 2 already counts L-1 as fixed. The review's table row is stale |
| L-3 | The review's table says it blocks mainnet since D43; its §2.3 says "accepted until Phase 4" | D43 (2026-11-03) says a minimum appeal bond "blocks mainnet", and D48 repeats it. The code still takes any appeal bond, 0 included (`HoldbackRules.sol:516`; `HoldbackBonds.sol:96-102`) [measured]. §2.3's status was written before D43 [inferred: §2.3 cites T-202's difference list and Phase 4; the table cites D43] | The table, D43 and D48: **open, blocks mainnet** | The L-3 row's severity and status say so. With L-5 it is open and not an accepted design limit |
| L-5 | The review rates it "low, medium since D43"; the adversarial pass rated it medium; DeepSeek rated it high | D43 re-rated it medium and made T-212 item 5 block mainnet; T-212's Status says "item 5 blocks mainnet" [documented]. The code reserves nothing on the appeal adjudicator for a party appeal, and an overturn pays from the first decider's bond (`HoldbackRules.sol:365-380`) [measured]. The three ratings came from three raters at different times; none is a factual error | D43: **medium, blocks mainnet**. The other ratings are kept as history | The L-5 row's severity names the rating of record and the other two |
| Bonds behind appeals and defaults | `docs/neutrality.md` says the appeal adjudicator is bounded by its own bond (residual 7) and that defaulting adjudicators' bonds compensate the seller (control-point table, adjudicator and appeal adjudicator rows); the review says neither happens (L-5, I-8) | The code: no function encumbers the appeal adjudicator's bond, and `triggerDefault` refunds the buyer in full and pays nobody from a bond (`HoldbackRules.sol:553-569`; its comment says "Seller compensation from bonds is Phase 4") [measured]. `HoldbackBonds.sol:11-13` defers default compensation to Phase 4 [measured] | The review: **no appeal adjudicator bond, no default compensation** | R-7 no longer points here for the bond; it names L-5 |
| O-1 | D48 and its research note cite a backlog row for the faucet's optional test ETH, and the backlog is private | D48 itself states the facts the row uses: the drip's farmability (about 0.6 Sepolia ETH a day at 600 grants) and that it was not chosen [documented: `docs/decisions-today.md`, D48]. No drip exists in the faucet code: a grep for `drip`, `parseEther` and value sends over `apps/demo-cloud/src` and `apps/operator/src` finds none [measured] | D48: **not built**. The backlog row is not needed to support the row | Nothing: the row already cites D48 only |
| O-2 | T-232 cites `lint-bypass.test.ts`, and `main` has only `tests/read-after-write.lint.test.ts` | Commit `3515172` (2026-11-07) adds `tests/read-after-write.lint-bypass.test.ts` and `packages/settlement/evm/t232-redteam.test.ts`, but it sits only on a local branch, `t-232-review-round-backup`, which is not on the remote [measured: `git branch -a --contains 3515172`; `git ls-remote --heads origin t-232-review-round-backup` prints nothing]. PR #239, which merged T-232, carries neither file [measured: `gh pr view 239`]. `tests/read-after-write.lint.test.ts` is the rule's own test, not the bypass test [inferred from its name and PR #239's file list] | Neither: T-232 names a test that **never reached `main`** | O-2, O-3 and O-4 now say their red-team tests are not on `main`. The finding stands; the evidence for it is not in the repository |
