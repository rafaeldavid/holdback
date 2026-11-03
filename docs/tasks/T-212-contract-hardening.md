# T-212: Contract hardening from the T-206 review (low findings)

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** the T-206 fix PRs merged
- **Paths this task may touch:** `contracts/src/`, `contracts/test/`, `packages/settlement/evm/encode.ts` and `packages/settlement/sim/simchain.ts` (only for item 4), `docs/decisions/ADR-0016-phase1-contract.md` (item 5, through an amendment), `docs/tasks/T-212-contract-hardening.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

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

## Decisions

## Handoff
