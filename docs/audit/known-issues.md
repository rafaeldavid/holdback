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
| R-7 | The appeal adjudicator's decision is final and moves the primary's bond | residual 7 | not rated | accepted | A larger panel. See section 8 on its bond |
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
| L-3 | The contract accepts an appeal with a bond of 0, and since the overturn payout a free appeal can win the price from the decider's bond | §2 table; §2.3 | low; blocks mainnet | open; deferred to T-212 (a minimum appeal bond in the signed terms) | The appeal adjudicator the terms name decides it. On the demo the tokens are worthless and the appeal adjudicators are Crow's (D48) |
| L-4 | The contract checks the primary's seed commitment on 144 bits, and the tag does not bind the commitment | §2.3 | low | open; deferred to T-212 item 2 | A collision costs about 2^72 work. Core checks all 256 bits, so an off-chain verifier sees it |
| L-5 | The appeal adjudicator decides with no bond on chain, yet its decision moves the price out of the first decider's bond | §2.3 | low, medium since D43; blocks mainnet | open; deferred to T-212 item 5. The fallback's part is fixed in PR #135 | The primary consents by accepting terms that name the appeal adjudicator. The reference adjudicator declines terms whose fallback or appeal adjudicator it does not trust |
| L-6 | `authorizationExpiry` ignores `judgeBy`, so a `judgeBy` after it stops the primary's on-time decision from capturing | §2.3 | low | open; deferred to T-212 item 4 | The M-1 fix keeps the bonds safe, and the buyer reclaims on CPP |
| L-8 | A `judgeBy` already past at funding makes the fallback's beacon round public before the terms are signed | §2.3 | low | open; deferred to T-212 item 8 | The reference path refuses that schedule. It takes a buyer who signs such terms directly |
| I-2 | A dead fee-share branch sits in `_payOut` (`MUTUAL_FEE_SHARE_BPS` is a constant 0) | §2.3 | info | open; deferred to T-212 item 6 | No effect on funds; it costs bytecode. Headroom is 263 bytes |
| I-8 rest | The contract has no default compensation from bonds, no appeal fee and no minimum appeal bond | §2.3, I-8 update | info; the minimum bond blocks mainnet | open; Phase 4, except the minimum bond (L-3) | A default refunds the buyer; nobody is paid from a bond [inferred] |
| I-1, I-4 to I-7, I-9 to I-13 | Ten informational items, each with a label and a disposition | §2.3, "Informational" | info | accepted or documented, per item | See each item |
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
| O-2 | 13 ways bypass the lint rule that makes each chain read name a block | [T-232](../tasks/T-232-read-after-write-audit.md), Handoff, Backlog | Low (red team) | open | Stand-in tests cover the adapter's read helper. The rule is a lint check, so it guards source code only [inferred] |
| O-3 | When a balance read fails after a relay mined, the operator stores no replay and defers that deal's timeouts until a restart | T-232 Handoff, Backlog | Medium (red team) | open | The step is already on chain; the parties can submit to the contract directly [inferred] |
| O-4 | After a reorg drops a lane's last transaction, the lane keeps a nonce that is too high until a restart | T-232 Handoff, Backlog | Low (red team) | open | Not stated in the source |
| O-5 | The contracts are not verified on Etherscan | `docs/operations.md`, "Sepolia contracts" | not rated | open | `deploy-sepolia.sh --check` compares the chain with the build |

## 6. Recorded gaps in tests and evidence

| ID | Gap | Recorded in | Status |
| --- | --- | --- | --- |
| G-1 | Five `neutrality.*` fixtures and one `todo.*` fixture are planned, not built | `docs/neutrality.md`, control-point table and "How neutrality is tested" | open; they gate mainnet, not the Sepolia demo |
| G-2 | The calibration and red-team harness is not built, and the live registry was promoted without calibration | `docs/judgment-and-defenses.md`; `config/judges-live.yaml` header | open; T-301, Phase 3 |
| G-3 | The formal model has no CPP reclaim by the buyer and no bond coverage, and its README's contract column reads TBD | review §5 and I-11; `formal/README.md` | open |
| G-4 | The adversarial pass's 24 proof-of-concept tests are not in the repository | review §2 | open |
| G-5 | A mutant that stores no delivery hash is caught by unit tests, but no invariant counts it | T-212 Handoff | open |
| G-6 | No external audit has run | `docs/tasks/T-206-contract-review.md`, Status | open; before mainnet |

## 7. Testnet-only facts

- **tUSDC is open-mint.** Anyone can mint any amount; it guards no value (`contracts/script/TestUSDC.sol`).
- **The relayer pays test ETH.** One Sepolia-only relayer secret on operator node 1 pays gas through a funding lane and three deal lanes. It has no role in any contract (`docs/operations.md`, Secrets).
- **The demo adjudicators' keys are generated in a Durable Object.** The world derives the three adjudicators' keys, both operators' keys and the club's keys from one random secret that it creates and stores (`apps/demo-cloud/src/world.ts`, `meta.secret`). Crow therefore runs the primary, fallback and appeal adjudicators of the demo.
- **Both operator nodes serve one world.** Node 2 has its own receipt key and forwards to the same Durable Object (`docs/operations.md`, "What is live").
- **Live judges are capped at 30 calls a day.** Past the cap, panels are scripted and every verdict says so. The DeepSeek model IDs are provider aliases with no dated snapshot (`config/judges-live.yaml`).
- **The deployer is a throwaway key** with no authority on chain.

## 8. Where the sources disagree

- **L-1.** The review's findings table still lists it as a T-212 item. T-212 and the review's §8 follow-up say it is fixed in PR #161, at the deployed commit. This page treats it as fixed.
- **L-3.** The review's table says it blocks mainnet since D43. The same review's §2.3 says "accepted until Phase 4". T-212's Handoff and D48 agree with the table.
- **L-5.** The review rates it "low, medium since D43"; its adversarial pass rated it medium, and DeepSeek rated it high.
- **Bonds behind appeals and defaults.** `docs/neutrality.md` says the appeal adjudicator is bounded by its own bond (residual 7) and that defaulting adjudicators' bonds compensate the seller (control-point table). The review says the contract takes no bond from the appeal adjudicator (L-5) and pays no default compensation (I-8). The contract follows the review.
- **O-1.** D48 and its research note cite a backlog row for the faucet's optional test ETH. The maintainers keep the backlog privately (`docs/private-materials.md`), so this page cannot confirm that row.
- **O-2.** T-232 cites `lint-bypass.test.ts`. This checkout has no file of that name; `tests/read-after-write.lint.test.ts` exists.
