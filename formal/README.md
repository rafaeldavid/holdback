# Formal model of the commitment state machine (T-204)

`Holdback.tla` is a TLA+ model of the commitment state machine in `packages/core/src/state.ts`, in
`guaranteed_on_decision` mode (the only Phase 1 mode). It checks the two properties `docs/neutrality.md`
promises, with TLC:

- **Liveness:** every funded commitment reaches a terminal state when anyone may trigger timeouts, even
  when a named actor halts.
- **Safety:** no step moves funds without a valid signature, decision or expired timeout, and each escrow
  pays out at most once.

The model is a spec. The rules contract (T-202) and SimChain are checked against it (T-206). It is not
code that runs anywhere.

## Run it

```
formal/check.sh            # every config; exits 0 iff all good configs pass and all broken ones fail
formal/check.sh live-      # only configs whose name contains "live-"
```

The script needs Java 11 or later and `tla2tools.jar`. It downloads the pinned TLA+ tools release
(v1.7.4, sha256-checked) into `formal/.tools/`. If no working `java` is on `PATH` or in `JAVA_HOME`, it
also downloads a pinned Eclipse Temurin 21 JRE from its official GitHub release into the same directory.
Nothing is installed system-wide, and `formal/.tools/` is gitignored. TLC logs go to `reports/formal/`.
The script prints distinct states, search depth and wall time for each config.

## What is modelled

| Element | In the model |
| --- | --- |
| Commitments | `C = {c1, c2}`. The two commitments share the same buyer, seller and adjudicators, so they share accounts. |
| Actors | buyer, seller, primary, fallback and appeal adjudicators, operator, beacon, and "anyone", the permissionless trigger. |
| Escrow states | Every `EscrowState.kind`, plus `None` for "not yet offered". |
| Appeal states | Every `AppealState.kind`, plus `na` where no appeal state exists. |
| Money | Abstract units in buyer and seller wallets, `escrow[c]`, adjudicator fee accounts, adjudicator bonds, `apBond[c]` and `apFee[c]`. Postings follow `docs/architecture.md`, "Hold and settlement postings". Values: price 2, fee 1, appeal bond 1, appeal fee 1, default compensation 1 per liable bond. |
| Time | The absolute deadlines are strictly ordered (`timing.ts`), so `clk[c]` counts how many have passed (1 offerExpiresAt, 2 fundBy, 3 deliverBy, 4 judgeBy, 5 fallbackBy). Relative deadlines get their own counters: `escClk` for the escalation's appealDecideBy, `apClk` for appealBy and then appealDecideBy. Each tick is its own step, so TLC explores every interleaving of deadlines across commitments and actions. An action is on time iff its deadline has not passed. A timeout fires iff it has. |
| Halting | `Halted` names one actor. A weakly fair `Crash` step stops it at some point, which may be any point, and it never acts after that. |
| Fairness | Weak fairness applies only to the "anyone" timeouts, the clock and `Crash`. No named actor is ever required to act, so every config also covers any actor stopping at any time. |
| Operator | Relays signed messages or is bypassed (ADR-0005). It has no action that authors a message. |
| Beacon | Fallback and appeal decisions need it (ADR-0018: no beacon fact, no decision). The primary does not. |
| CPP hold (T-337) | `escrow[c]` is Commerce Payments' hold. `cppExp[c]` says its `authorizationExpiry` has passed. From then on no capture succeeds, a void still does, and the buyer may reclaim the hold on CPP directly (`CppReclaim`, `cppRec[c]`). The rules contract's timeouts then close the deal and move no money. With ordered deadlines the expiry comes after every deadline a capture could meet. |
| Bonds (T-337) | `bond[a]` is the posted bond, `enc[a]` the encumbered part, and `flags[c]` the adjudicators whose bond is encumbered for commitment c. Funding encumbers the primary's bond for the price, a fallback decision moves the encumbrance to the fallback, and every close releases it or slashes it. Funding and a fallback decision need the free bond to cover the price. The appeal adjudicator is never encumbered (L-5, open). |

Not modelled: the Phase 4 economics (backers, size of the default compensation; the contract pays none, I-8),
an initial bond too small to cover both commitments (each adjudicator starts with 2 × price, so the coverage gate
never blocks; L-3 and L-5, the zero-bond appeal paths, need it),
`settle_after_window` and the `settle` timeout, signature cryptography (a signature is "the named actor
took the step"), message expiry, scopes and mandates, rulebook checks, multi-attempt delivery
(`maxSubmissions` is 1 in Phase 1), and D27/D28 appeal clauses beyond the default rules in `state.ts`.

## Properties

| Property | Kind | Meaning |
| --- | --- | --- |
| `TypeOK` | invariant | Variables stay in their domains. |
| `ExpiryAfterCaptures` | invariant | CPP's expiry passes only once no decision is on time and, in Held, deliverBy has passed. L-6 breaks it (`broken/late-judge-by.cfg`). |
| `BondCovered` | invariant | No adjudicator's encumbrance is negative or exceeds its posted bond. |
| `EncMatchesDeals` | invariant | Each adjudicator's encumbrance is the price times the open deals that flag it. |
| `BondsReleasedAtClose` | invariant | A deal holds a bond only while funded or while its first-instance decision can still be appealed, and then only the decider's. |
| `NoCaptureAfterExpiry` | action property | After CPP's expiry, whatever leaves the escrow goes to the buyer in full and no fee is paid. |
| `BondsFreed` | liveness | `Held ~>` paid out with no bond encumbered, whether or not the buyer reclaimed on CPP. |
| `Conservation` | invariant | The total over all accounts is constant: no posting creates or destroys a unit. |
| `NonNegative` | invariant | No account goes negative. The initial bond is sized to cover each commitment's worst case, which stands in for the Phase 4 coverage gate. |
| `SettleOnce` | invariant | Each escrow is debited in at most one step. |
| `EscrowMatchesState` | invariant | The escrow holds price + fee exactly while funded and undecided, and nothing otherwise. |
| `KeyOnlyWithPayment` | invariant | The buyer holds the content key only in Released, or in Settled when the settlement released it, and always holds it in Released. |
| `AuthorizedMoves` | action property | Every debit is justified by the state before the step and by who signed it. An escrow debit needs the decision of the adjudicator whose turn it is, on time, with a beacon for fallback and appeal; or the buyer's early accept in Delivered; or both parties' settlement; or reclaim after deliverBy; or the default outcome. A wallet debit needs that party's own signature. A bond debit needs an appeal decision against that adjudicator, or the default outcome that makes it liable. An appeal-bond or appeal-fee debit needs an appeal decision or an expired appeal. Fee accounts are never debited. The halted actor signs nothing after it crashes. |
| `AtomicKey` | action property | In guaranteed_on_decision (ADR-0012) the key moves only in a step that pays out the escrow, every transition into Released carries it, and it is never taken back. |
| `FundedSettles` | liveness | `Held ~> Released, Refunded or Settled`, for each commitment. |
| `FundedFinal` | liveness | Also, the appeal state is closed (finalAt, D20). |
| `OfferEnds` | liveness | `Offered ~>` Expired or paid out. |

## Configs

| Config | Halted | Checks |
| --- | --- | --- |
| `safety.cfg` | none | every invariant and the three action properties |
| `live-<actor>.cfg` | buyer, seller, primary, fallback, appeal, operator, beacon (one each) | the four liveness properties, plus `TypeOK`, `Conservation` and `SettleOnce` |
| `broken/keep-bond-after-cpp.cfg` | none | after a CPP reclaim the timeout closes the deal but keeps its bonds (M-1's shape): `BondsReleasedAtClose` must fail |
| `broken/double-refund.cfg` | none | after a CPP reclaim the timeout refunds the buyer again: `SettleOnce` must fail |
| `broken/capture-after-expiry.cfg` | none | an early accept captures after CPP's expiry: `NoCaptureAfterExpiry` must fail |
| `broken/slash-keeps-enc.cfg` | none | an overturn slashes the bond but keeps the encumbrance: `EncMatchesDeals` must fail |
| `broken/slash-uncovered.cfg` | none | the same bug: `BondCovered` must fail |
| `broken/late-judge-by.cfg` | none | **recorded open issue L-6**, not a model bug: a judgeBy after CPP's expiry lets the expiry pass while the primary is on time, so `ExpiryAfterCaptures` fails. Move it out of `broken/` when L-6 is fixed |
| `broken/mint.cfg` | none | the default outcome pays compensation without debiting bonds: `Conservation` must fail |
| `broken/second-capture.cfg` | none | the primary may decide again after the escrow has settled: `SettleOnce` must fail |
| `broken/operator-authors.cfg` | none | the operator submits an early accept the buyer never signed: `AuthorizedMoves` must fail |
| `broken/early-reclaim.cfg` | none | reclaim fires at fundBy instead of deliverBy: `AuthorizedMoves` must fail |
| `broken/key-separate.cfg` | none | an accept pays the seller and the key follows in a later step: `AtomicKey` must fail |
| `broken/buyer-only-timeout.cfg` | buyer | timeouts are callable by the buyer only: `FundedSettles` must fail |

Each broken config has an `\* expect:` line. `check.sh` requires that TLC fails on that config and that
its output matches the line.

## Model to `state.ts` and to the contract

Lines are in `contracts/src/` at `26d4670` (T-337), `HoldbackRules.sol` unless another file is named. CPP is
`AuthCaptureEscrow` in `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol`. The mapping was read, not
checked by a tool [inferred]; the review's §5 (`docs/reviews/2026-11-03-contract-review.md`) gave the
function-level mapping first.

### Actions

| Model action | `state.ts` | Contract function and line |
| --- | --- | --- |
| `Offer` | `offer()` | `agreeAndFund` (193): the seller's signature over the terms ID, checked at funding (206); nothing is stored before funding |
| `AdjAccept` | `step` `adjudicator_accept` → `adjudicatorAccept` | `agreeAndFund`: the primary's `Acceptance` signature (207) and `bondReserved >= price` (205) |
| `Agree` | `step` `agree` → `agree` | `agreeAndFund`: the buyer's `Agree` signature (208), before `offerExpiresAt` (203) |
| `Fund` | `step` `fund` → `fund` | `agreeAndFund`: before `fundBy` (203); `stage = Held` (211); `flags = F_PRIMARY` (212); `BONDS.encumber` of the price (215; `HoldbackBonds.encumber` 74 reverts when `freeOf` is short, 76); `ESCROW.authorize` (218) |
| `Deliver` | `step` `deliver` → `deliver` | `deliver` (226), or carried by `decide` (244-248) or `earlyAccept` (401) in Held; all land through `_acceptDelivery` (616), before `deliverBy` (623) |
| `EarlyAccept` | `step` `early_accept` in Delivered | `earlyAccept` (388): `_releaseBonds` (410), price captured (412), fee voided (413), key emitted (417). The capture reverts from `authorizationExpiry` (CPP `capture`, 278) |
| `DecidePrimary` | `step` `decide` in Delivered → `firstInstance` (role primary) | `decide` (238), role by stage (255-257), before `judgeBy` (286), seed reveal (289); `_firstInstance` (309) keeps `F_PRIMARY` (326-328); `_settleDecision` (347) captures |
| `DecideFallback` | `step` `decide` in FallbackJudging → `firstInstance` (role fallback) + `beaconSeed` | `decide` (258-261, beacon 290-297); `_firstInstance` releases the primary (326) and encumbers the fallback (327), which reverts if uncovered; `flags = F_FALLBACK \| F_BY_FALLBACK` (328) |
| `FirstInstance` with `escalate` | `step` `decide` → `escalate` | `_firstInstance` (314-322): `_releaseBonds`, `flags = 0`, `stage = Escalated`, `t1` = now; no money moves |
| `DecideEscalated` | `step` `decide` in Escalated → `escalationDecision` | `decide` (262-265); `_escalationDecision` (336): `_releaseBonds`, appeal `Closed` (340), `_settleDecision` |
| `MutualSettle` | `step` `mutual_settle` → `mutualSettle` | `mutualSettle` (425): both signatures (442-443), `_releaseBonds` (453), `_payOut` (459): a seller share is a capture (479), the rest a void (494) |
| `FileAppeal` | `step` `file_appeal` → `settled` → `stepAppeal` | `fileAppeal` (503): only the losing party (511), before `appealBy` (508), `BONDS.takeAppealBond` (516; `HoldbackBonds` 96) |
| `DecideAppeal` | `step` `decide` in Released/Refunded → `settled` → `stepAppeal` + `beaconSeed` | `decide` (266-269); `_appealDecision` (365): upheld releases (370) and pays the appeal bond into the decider's bond (376; `HoldbackBonds.payAppealBond` 106); overturned slashes the decider's bond to the wronged party (378; `HoldbackBonds.slash` 88). The contract has no appeal fee (I-8), unlike `apFee` here |
| `Expire` | `step` `expire`; TimeoutKind `expire_offer` | `expireOffer` (523) |
| `Reclaim` | `step` `reclaim`; TimeoutKind `reclaim` | `reclaim` (533), from `deliverBy` (537); `_refundAll` (596): `_releaseBonds` (601), and the void skipped when CPP holds nothing after its expiry (605-608) |
| `TriggerFallback` | `step` `trigger_fallback`; TimeoutKind `fallback` | `triggerFallback` (543), from `judgeBy` (547) |
| `TriggerDefault` and `ApplyDefault` | `step` `trigger_default` and `apply_default_outcome` | one call, `triggerDefault` (556): from `fallbackBy` (561) or the escalation's `appealDecideBy` (563), then `_refundAll`. The contract pays no default compensation (I-8); the model's `Comp` follows `state.ts` |
| `ExpireAppeal` | `step` `expire_appeal` → `stepAppeal`; TimeoutKind `appeal_expiry` | `expireAppeal` (573): `_releaseBonds` (589), appeal bond back to the appellant (590) |
| `TickExpiry` (T-337) | none | `authorizationExpiry = fallbackBy + appealDecideSec + EXPIRY_MARGIN` (`_paymentInfo` 169, 180; `EXPIRY_MARGIN` 77). The contract does not check that it falls after `judgeBy` (L-6) |
| `CppReclaim` (T-337) | none | CPP `reclaim` (323), the payer only, from `authorizationExpiry` (326); outside the rules contract (`AfterCppReclaim.t.sol`) |
| `TickAbs`, `TickEsc`, `TickAppeal` | the event time `at` passing a deadline | `block.timestamp` against `Terms.timing` and `Deal.t1`, `Deal.t2` |
| `Crash` | (environment) an actor stops | none |
| `OperatorEarlyAccept`, `ReleaseKeyLate` and the other `Bug` branches | none: they exist only in the broken variants | must not exist |

### Variables

| Model variable | Contract storage or event |
| --- | --- |
| `esc` | `Deal.stage` (48; `Stage` 24). The model's None, Offered, AcceptedByAdjudicator and Agreed are all `Stage.None`; Defaulted has no stage, because `triggerDefault` refunds in the same call |
| `via` | `Deal.flags & F_BY_FALLBACK` (59) for primary or fallback; the other values are events only (`JobCompleted`, `Refunded`, `Defaulted`, `MutuallySettled`) |
| `ap`, `appellant` | `Deal.appeal` (50; `AppealState` 36; the model's `na` is `Closed`); `HoldbackBonds.appealBondOf[id].appellant` (28) |
| `clk`, `escClk`, `apClk` | `block.timestamp` against `Terms.timing`; `Deal.t1` (52) and `Deal.t2` (53) start the relative deadlines |
| `key` | the `KeyReleased` event (114, `_releaseKey` 645) |
| `moves` | none: a count of CPP captures and voids per deal, for `SettleOnce` |
| `up`, `act` | none: environment and history |
| `wallet` | the buyer's and seller's token balances |
| `escrow` | CPP's `paymentState(hash).capturableAmount` for the deal's `PaymentInfo` (`_paymentInfo` 163) |
| `fees` | the deciding adjudicator's token balance (fee capture, `_settleDecision` 351, 356) |
| `bond` | `HoldbackBonds.bondOf` (20) |
| `enc` | `HoldbackBonds.encumberedOf` (21) |
| `flags` | `Deal.flags` (51): `F_PRIMARY` (57), `F_FALLBACK` (58) |
| `apBond` | `HoldbackBonds.appealBondOf[id].amount` (28) |
| `apFee` | none: the contract takes no appeal fee (I-8) |
| `cppExp` | `block.timestamp >= authorizationExpiry` (`_paymentInfo` 180) |
| `cppRec` | CPP's `paymentState` after the payer's `reclaim`: nothing capturable, checked in `_refundAll` (605-607) |

