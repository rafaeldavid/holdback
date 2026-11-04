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
3. **L-1.** Decide whether `EarlyAccept` names the delivery hash (a schema change: ADR, version bump, core and contract together) or record the acceptance. The money is safe today under D32; the record is not. The cross-family pass (review §8) found that `Decision` has the same gap: it names the attempt, not the delivery. A seller who signed two deliveries for one attempt can pair a decision about one with the other. The judgment record (`judgment.schema.json`) carries no delivery hash either. Decide all three in the same schema change: `EarlyAccept`, `Decision` and the judgment record.
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

## Decisions

## Handoff

Items 7 and 9 (PR #160):
- **Before mainnet:** item 5, the appeal adjudicator's coverage. Since the payout, an unbonded appeal adjudicator moves the price out of the first decider's bond; L-5 is re-rated medium (the PR #160 reviewer and DeepSeek both flagged it, review §8 follow-up).
- **Before mainnet:** a minimum appeal bond. With the payout live, a losing party's zero-bond appeal can win the price from the decider's bond, bounded only by the appeal adjudicator the terms name (D43). The rate must be in the signed terms (an ADR and a version bump), and the contract and core then refuse a smaller bond.
- **Before the Sepolia redeploy:** the reference adjudicator declines terms whose fallback or appeal adjudicator it does not trust (item 3's PR). Until then, a party that is also the appeal adjudicator could take the price out of a demo adjudicator's bond.
- **Schema v0.9:** closed event payloads (`BondMovement`, `OperatorFeePaid`, `SettledSplit`) carry no chain fields. The EVM adapter adds `tx`, `block`, `sender` and `gasUsed` to `fee.operator` and `commitment.settled`, so those events fail the schema today [inferred, reviewer's probe on `bond.slashed`]. Allow the chain fields on every payload in v0.9, then add them to `bond.slashed` too.
- **Formal model:** `FileAppeal` admits only the party the decision went against.
