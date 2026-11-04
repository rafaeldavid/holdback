# T-212: Contract hardening from the T-206 review (low findings)

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** the T-206 fix PRs merged
- **Paths this task may touch:** `contracts/src/`, `contracts/test/`, `packages/settlement/evm/encode.ts` and `packages/settlement/sim/simchain.ts` (only for item 4), `docs/decisions/ADR-0016-phase1-contract.md` (item 5, through an amendment), `docs/tasks/T-212-contract-hardening.md`. Added for items 7 and 9 (2026-11-03, D43, so every layer agrees on who may appeal and what an overturn reports): `packages/core/src/state.ts` and its test, `packages/settlement/evm/` (`evm-settlement.ts`, `gas.ts`, `abis.json`, tests), `apps/operator/src/prepare.ts` and `sim-world.test.ts`, `formal/Holdback.tla` (`FileAppeal`), and the docs that state who may appeal (`docs/api.md`, `docs/quickstart.md`, `docs/PRD.md`, `site/llms.txt`, `README.md`, ADR-0015 and ADR-0019 by amendment). Item 3's paths are in its own PR (ADR-0029).
- **Human gate:** no
- **Status:** in progress (items 7 and 9 in PR #160; item 3 in its own PR)
- **Agent/session:** T-206's session (items 7 and 9); an implementer agent (item 3)

## Intent

This task covers the low findings of `docs/reviews/2026-11-03-contract-review.md` that need code or an ADR line. They block mainnet, not the Sepolia testnet (T-206 Decisions 6). Each item lands with a regression test that fails before it. Record the EIP-170 headroom with each change (review I-3).

1. **L-2.** `HoldbackBonds.deposit` and `takeAppealBond` refuse a transfer whose measured balance delta differs from the amount, as CPP's collection does. This stops a fee-on-transfer token from making the vault short.
2. **L-4.** The primary's seed tag binds the commitment (`uint144(keccak256(abi.encode(seedCommitment, id)))`, checked the same way at decide), so a 144-bit collision cannot be reused across deals.
3. **L-1.** Decide whether `EarlyAccept` names the delivery hash (a schema change: ADR, version bump, core and contract together) or record the acceptance. The money is safe today under D32; the record is not. The cross-family pass (review §8) found that `Decision` has the same gap: it names the attempt, not the delivery. A seller who signed two deliveries for one attempt can pair a decision about one with the other. The judgment record (`judgment.schema.json`) carries no delivery hash either. Decide all three in the same schema change: `EarlyAccept`, `Decision` and the judgment record. **Decided and built** (D44, ADR-0029 option A; branch `t-212-delivery-binding`, stacked on PR #160).
4. **L-6.** Either derive `authorizationExpiry` from `max(judgeBy, fallbackBy) + appealDecideSec + EXPIRY_MARGIN`, or refuse at funding a `judgeBy` after `fallbackBy` as self-contradictory (D31 allows that refusal). Either way, mirror it in `encode.ts` and SimChain's `authorizationExpiry`.
5. **L-5.** Since M-3 (PR #135), the fallback reserves its bond by deciding, so an uncovered fallback cannot decide. That leaves the appeal adjudicator. Decide whether its decision after an escalation, or on a party appeal, needs free cover, per ADR-0016 §1 ("if either lacks coverage then, the case goes to the default outcome"). Then record the rule in ADR-0016 before Phase 4 attaches payouts to coverage.
6. **I-2.** Drop the dead fee-share branch in `_payOut` (`MUTUAL_FEE_SHARE_BPS` is a constant 0), or move the rate into the terms when it stops being 0.
7. **L-7.** `fileAppeal` admits only the party the decision went against, or gives each party its own slot. Then the favoured party cannot block the other's appeal with a free one. Port the cross-check's `AppealSlot.t.sol`. **Done with item 9** (only the losing party appeals; core too).
9. **I-8, the overturn payout** (added 2026-11-03, D43: Rafa asked to fix the review's high findings in the contracts). An overturning party appeal pays the wronged party the price from the first decider's bond, as SimChain and the formal model's `DecideAppeal` do. **Done:** `HoldbackBonds.slash`, `_appealDecision`, the adapter's `bond.slashed`.
8. **L-8.** `agreeAndFund` refuses when `block.timestamp >= judgeBy`, so the fallback's beacon round cannot already be public when the terms are signed. Port the cross-check's `KnownSeedFallback.t.sol`.

## Acceptance criteria

- [ ] Items 1, 2, 6, 7 and 8 merged, each with a regression test that fails before it.
- [ ] Items 3, 4 and 5 decided, each recorded in `docs/decisions-today.md` or an ADR, and built if the decision is to build.
- [ ] `HoldbackRules` stays under EIP-170, with the headroom recorded.
- [ ] `pnpm verify` green.

## Out of scope

- Phase 4 economics (default compensation, coverage ratios, the appeal fee, a minimum appeal bond). The overturn payout moved in (item 9, D43).

## Evidence

Items 7 and 9 (branch `t-212-overturn-and-binding`, 2026-11-03):
- `contracts/test/unit/OverturnPayout.t.sol`: 9 tests, 6 of which fail on `main` (the three overturns, the withdrawal after one, and both refused appeals by the favoured party) [measured]. The other 3 pin what must not change: an upheld or undecided appeal pays nothing from the bond, and a stranger cannot call `slash`.
- `invariant_overturnPaysFromTheBond` (new; `RulesHandler.decideAppeal` checks each appeal decision's bond and balance deltas). It fails when the payout goes to the wrong party (mutation run, measured), and passes on the fix.
- `AppealSlot.t.sol`: the cross-check's three attacks are now two refusals and the residual L-3 lock extension.
- Existing tests that had the favoured party appeal or expected no payout were changed: `AppealKey.test_upheldReject_refusesAKey` (now the seller appeals), `Settle.test_overturned_bondBackToAppellant` (now also checks the price from the bond), the gas path "party appeal (reject, seller appeals, upheld)", and the ABI allowlist (`slash`).
- `forge test`: 224 passed, 0 failed [measured]. EVM adapter on anvil: 33 passed, including the new overturn test ([measured]: the buyer ends down only the fee, the primary's bond down the price, `bond.slashed` as SimChain's payload). `pnpm snap`: 28 passed; `--settlement local`: 25 passed, 3 excluded until Phase 4, as before [measured].
- EIP-170: `HoldbackRules` runtime 24,244 bytes, 332 under the limit (was 23,986, so +258) [measured, `forge build --sizes`].
- After the PR #160 review: the fuzz check compares sums, so a movement the wrong way counts instead of underflowing, and a successful appeal by the favoured party is a violation. Mutation runs [measured]: dropping the L-7 check fails `invariant_overturnPaysFromTheBond`; a slash added to the upheld path makes every upheld appeal revert (the encumbrance underflows), so it cannot move money. Core and prepare refuse the favoured party's appeal (`state.test.ts`, `sim-world.test.ts`). The adapter's `bond.slashed` payload is exactly SimChain's, valid against `event.schema.json` (`BondMovement` is closed).
- `formal/check.sh` with `FileAppeal` narrowed to the party the decision went against: safety and all seven liveness configs pass (safety 107,519 distinct states; liveness 235,068 to 268,326), and all six broken configs still bite [measured].

Item 3 (branch `t-212-delivery-binding`, 2026-11-03; ADR-0029, D44):
- **Test first.** `contracts/test/unit/DeliveryBinding.t.sol` at commit cc424bd: three attacks pass on the pre-ADR contract (a carried decision settles another seller-signed delivery and `JobSubmitted` names it; an early accept relayed with another delivery releases that body's envelope; a mutual settlement naming another delivery settles) [measured]. After the fix the same three revert `InvalidMessage`, and the file has 17 tests: every role (primary in `Delivered`, carried in `Held` for accept, reject and escalate, fallback, escalation, party appeal), the early accept in `Held` and `Delivered`, a zero hash, the stored hash, and mutual-settlement parity [measured]. `state.test.ts`: the five new refusals (early accept, primary, fallback, escalation, party appeal naming another delivery) failed before the `state.ts` change and pass after [measured].
- **Byte compatibility.** `packages/core/src/eip712.vectors.test.ts` is the vector generator `Vectors.t.sol` pins; before the change it reproduced all 11 of T-202's pins [measured], and after it both sides pin the new commitment ID, delivery hash and digests (domain 0.7) and pass [measured].
- **The handler.** `RulesHandler.decide` and `earlyAccept` name the posted delivery, rarely another body; a success that names any other counts as an unauthorised success. Mutation run, the `decide` hash check dropped [measured]: 9 of the 17 `DeliveryBinding` tests fail, and the invariant suite fails on the handler's unauthorised-success counter (reported as "decide: succeeded with a signature from the wrong key", the counter's one message).
- **`forge test`:** 241 passed, 0 failed (224 + 17) [measured].
- **EIP-170:** `HoldbackRules` runtime 24,313 bytes, 263 under the limit (was 24,244: +69) [measured, `forge build --sizes` before and after]. No cut was needed: item 6's dead branch is still there, and no getter, event or emit was removed.
- **Gas, forge unit tests (one transaction per test, so a slot read after a write is warm)** [measured, before and after]: `deliver` 18,541 → 40,799; a decision carrying the delivery 78,513 → 98,907; an early accept carrying it 74,812 → 95,225; a reject carrying it 74,747 → 95,140; a decision after `deliver` 70,796 → 71,115; a fallback decision 124,548 → 124,866; a mutual settlement before delivery 73,032 → 73,072. The three-transaction path (fund, deliver, decide) goes from 298,215 to 320,792 (+7.6 %).
- **Gas per deal on anvil, after** (`node packages/settlement/dist/evm/gas.js`) [measured]: happy path carrying the delivery 398,341 in 2 transactions; with an on-chain `deliver` 451,544 in 3 (agreeAndFund 233,982 + deliver 83,559 + decide 134,003); early accept 406,668; reject 397,878; fallback 565,397; overturned party appeal 631,893; operator fee bundled, then accept, 464,695. On Sepolia the new slot may cost about 77,000 (T-213: new state at about 3.5 times anvil's price) [inferred]; re-measure on the new deployment (T-215).
- **Schema and spec:** v0.9, domain 0.7, `commitment.schemaVersion` "0.7"; `pnpm validate:spec` 33 of 33 examples, OpenAPI strict and fresh [measured]; `tests/spec.test.ts` refuses a `Decision`, an `EarlyAccept` or a judgment record without `deliveryHash` [measured].
- **Reference adjudicator:** `service.test.ts` [measured]: the decision and the record name `deliveryHash(task.delivery)`; a delivery signed by another key, or unsigned, is refused `invalid_signature` before any judge call, with no record and no decision; an offer whose fallback or appeal adjudicator is untrusted is declined; with no trusted set, it trusts only itself.
- **EVM adapter on anvil:** 51 passed [measured], including: an early accept and a decision naming another delivery are refused `invalid_terms` (as SimChain) and `deliveryHashOf`, the mirror and the read model agree; every event on every gas path parses against `event.schema.json` (with `fee.operator`, `commitment.settled` and `bond.slashed`); `bond.slashed` carries the appeal decision's transaction.
- **Scenarios:** `pnpm snap` 29 passed, with the new `attack.seller-equivocates-delivery` (the early accept naming a second signed delivery is refused at step 5; Bench A judges the posted row-drop CSV; Refunded) [measured]. Every recording re-seated (the commitment ID moved, so judge inputs and some panels moved): a judge still seated keeps its verdict with its input hash refreshed; a newly seated one takes an unseated judge's verdict, same family first; every appeal panel kept its seats; one authored verdict moved (`todo.provider-outage`, gpt-b's abstention to gpt-a). With hashes and IDs masked, no snapshot line changed beyond panel members and aggregate lines; terminal states, balances, step results and events are as before, and the aggregate decisions are the same (7 accept, 2 escalate) [measured].
- **Site:** `node site/build.mjs && node site/check.mjs` pass [measured].

## Decisions

Item 3 (D44, ADR-0029, Rafa may overrule):
- Option A as the draft wrote it, built in one PR with the reference adjudicator's signature check. Departures, each in ADR-0029 "As built": the early accept's checks as one condition, the mutual-settlement check without the redundant `hasDelivery` test, the read model's `deliveryHash` from core's `postedDeliveryHash`, and the adapter's mirror check only after a call that lands a delivery.
- The adjudicator's tasks carry the seller-signed delivery as posted (they carried a delivery with envelopes filtered, which no signature covers). A party appeal reads it from the first decision's state: core's first-instance state now keeps the delivery it judged. The service still opens only its own envelope (primary) or the one released to it.
- `trustedAdjudicators` (an `AdjudicatorConfig` field): unset means this adjudicator trusts only itself as fallback and appeal adjudicator, so an operator must name whom it trusts; each world's three adjudicators trust each other. The refusal is `invalid_terms` (the remedy is in the terms, as for a fee below the quote).
- Schema v0.9 ships now; T-033's additive items join it before the redeploy.

## Handoff

Items 7 and 9 (PR #160):
- **Before mainnet:** item 5, the appeal adjudicator's coverage. Since the payout, an unbonded appeal adjudicator moves the price out of the first decider's bond; L-5 is re-rated medium (the PR #160 reviewer and DeepSeek both flagged it, review §8 follow-up).
- **Before mainnet:** a minimum appeal bond. With the payout live, a losing party's zero-bond appeal can win the price from the decider's bond, bounded only by the appeal adjudicator the terms name (D43). The rate must be in the signed terms (an ADR and a version bump), and the contract and core then refuse a smaller bond.
- **Before the Sepolia redeploy:** the reference adjudicator declines terms whose fallback or appeal adjudicator it does not trust. *Done in item 3's PR* (`trustedAdjudicators`).
- **Schema v0.9:** closed event payloads carried no chain fields. *Done in item 3's PR:* `ChainTx` is admitted on `BondMovement`, `OperatorFeePaid` and `SettledSplit`, `bond.slashed` carries its transaction again, and an anvil test parses every event the adapter emits.
- **Formal model:** `FileAppeal` admits only the party the decision went against.

Item 3 (branch `t-212-delivery-binding`; stacks on PR #160 and merges after it):
- **Still open in T-212:** items 1, 2, 4, 5, 6 and 8. Item 6 (the dead `MUTUAL_FEE_SHARE_BPS` branch) was not needed for size: 263 bytes are left.
- **The Sepolia redeploy (gated on Rafa; nothing here touched Sepolia).** The deployed contract is domain 0.6 and cannot settle 0.7 messages, so the Workers must not be deployed from a commit with this change before the new contracts are on Sepolia. In order:
  1. Merge T-033's additive v0.9 items first, so there is one redeploy.
  2. Deploy a new `HoldbackRules` (it deploys its own `HoldbackBonds`) with the same CPP escrow, collectors, `EXPIRY_MARGIN` (86,400), drand beacon and tUSDC; add the new entry to `contracts/deployments/sepolia.json` beside the old one.
  3. Copy the new addresses into `examples/deployments.ts` (its test compares the two), the pinned domain and deployment in `site/llms.txt` (domain version is already 0.7; `verifyingContract` and `rules` still name the old contract), and rebuild the site (`node site/build.mjs && node site/check.mjs`).
  4. Run ADR-0028 §7's idempotent setup so the three demo adjudicators deposit bonds in the new vault; their old bonds stay withdrawable as old deals close.
  5. Give the Sepolia world a new name and switch each Worker's `SETTLEMENT` and world name together; rollback is the old name and flag. Deals open on the old deployment finish there (every timeout is permissionless).
  6. Re-measure gas on the new deployment with `eth_estimateGas` and update the operator's gas quote (`OPERATOR_FEE_GAS`, D33; T-215): the new slot is about +22,000 gas on anvil and may be about +77,000 on Sepolia [inferred].
- **Mutation evidence still to strengthen:** a mutant that stores no hash makes every decision after a delivery revert, which the unit tests catch but no invariant counts yet (a liveness counter in the handler would).
- **Files outside T-212's original paths** (ADR-0029's list): `spec/`, `packages/core`, `packages/settlement`, `packages/testkit`, `apps/adjudicator`, `apps/operator`, `apps/demo`, `apps/demo-cloud`, `examples/`, `site/`, `fixtures/`, `tests/spec.test.ts`, `packages/judgment/src/pipeline.test.ts`, and the docs ADR-0029 amends.
