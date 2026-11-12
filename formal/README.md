# Formal model of the commitment state machine (T-204, T-337, T-357, T-376)

`Holdback.tla` is a TLA+ model of the commitment state machine in `packages/core/src/state.ts`, in
`guaranteed_on_decision` mode. TLC, the TLA+ model checker, checks it in two profiles:

- **Full:** the whole protocol, which SimChain runs. It has party appeals, adjudicator bonds and a recorded
  offer expiry.
- **Phase one:** what `contracts/src/HoldbackRules.sol` runs (ADR-0031, ADR-0033). It has no party appeal and no
  bond, and the first decision is final.

For each profile it checks what `docs/neutrality.md` promises:

- **Liveness:** every funded commitment reaches a terminal state when anyone may trigger timeouts, even when a
  named actor halts.
- **Safety:** no step moves funds without a valid signature, decision or expired timeout; each escrow pays out at
  most once; and the money lands on the two addresses the terms name.

The model is a spec. The rules contract and SimChain are checked against it by reading (the mapping below). It is
not code that runs anywhere.

## Run it

```
formal/check.sh              # every config and every witness; exits 0 iff all meet expectations
formal/check.sh safety       # the safety configs of both profiles, and the reach witnesses (seconds)
formal/check.sh broken/      # every deliberately broken variant: each must still fail (seconds)
formal/check.sh live-        # the liveness configs of both profiles (tens of minutes: run it in the background)
formal/check.sh phase-one/   # everything of the phase-one profile; full/ likewise
```

The argument is a filter on the config's name. CI runs `safety` and `broken/` on every pull request, and
everything on a push to `main`.

The script needs Java 11 or later and `tla2tools.jar`. It downloads the pinned TLA+ tools release (sha256-checked)
into `formal/.tools/`. If no working `java` is on `PATH` or in `JAVA_HOME`, it also downloads a pinned Eclipse
Temurin JRE from its official GitHub release into the same directory. Nothing is installed system-wide, and
`formal/.tools/` is gitignored. TLC logs go to `reports/formal/`. The script prints distinct states, search depth
and wall time for each config.

## The two profiles

The constant `Profile` is `"full"` or `"phase_one"`, the same two names as core's `SettlementProfile`
(`packages/core/src/state.ts:179`). `P1` is true in the phase-one profile, and it gates every difference:

| | Full (SimChain) | Phase one (the contracts) |
| --- | --- | --- |
| Party appeal | `FileAppeal`, `DecideAppeal`, `ExpireAppeal`, `TickAppeal` | none: a first-instance decision is final at once |
| Bonds | posted, encumbered per deal, slashed on an overturn | none: no bond is posted or read |
| An unfunded offer's expiry | the `Expire` step records it | no step; a lapsed offer can never fund (`LapsedOfferNeverFunds`) |
| Funding deadline | `fundBy`: agreeing and funding are two steps | `offerExpiresAt`: they are one call |
| Default | `TriggerDefault`, then `ApplyDefault`, which also compensates the seller from bonds | `TriggerDefault` refunds in the same step; no compensation |
| A delivery carried by another message | no: the delivery is its own step | an early accept or the primary's decision in `Held` lands the delivery it carries, before `deliverBy` |

Both profiles share the rest: the offer, the acceptance, the agreement, the delivery, the three kinds of
decision, the escalation, early accept after a delivery, the mutual settlement, the timeouts, the escrow's expiry
and the two money addresses.

**Why a constant, and not a second file.** A copied specification drifts: a fix to a shared action would have to
land twice, and nothing would show when it did not. With the constant, each shared action is written once, a
search for `P1` lists every difference, and the invariant `PhaseOneCuts` states what the phase-one profile never
reaches. The reach witnesses (below) show the full profile still reaches all of it, so the gate removes what it
says and no more. Two alternatives were set aside. Choosing a different `Next` per config cannot express a
difference inside an action, such as funding without a bond. Two modules that extend a common base cannot remove
a step from the base's `Next`.

## What is modelled

| Element | In the model |
| --- | --- |
| Commitments | `C = {c1, c2}`. The two commitments share the same parties, addresses and adjudicators, so they share accounts. |
| Actors | buyer, seller, primary, fallback and appeal adjudicators, operator, beacon, the buyer's payment address when it is apart from the buyer, and "anyone", the permissionless trigger. |
| The two money addresses (ADR-0033) | `PayAddr` is the terms' `buyerPaymentAddress`: it funds the hold and receives every refund. `PayoutAddr` is `sellerPayoutAddress`: it receives every payment to the seller. The constant `Apart` names the parties whose money address differs from their signing address; for the others the two are one account. The payment address signs the funding and its own reclaim on the escrow, so it can halt like any actor. The payout address signs nothing. |
| Escrow states | Every `EscrowState.kind`, plus `None` for "not yet offered". On the contract `None`, `Offered`, `AcceptedByAdjudicator` and `Agreed` are all `Stage.None`: it stores nothing before funding. Phase one never reaches `Expired` or `Defaulted`. |
| Appeal states | Every `AppealState.kind`, plus `na` where no appeal state exists. In phase one a first-instance decision writes `expired`, as core does: closed, with no appeal. |
| Money | Abstract units in the holders' wallets, `escrow[c]`, adjudicator fee accounts and, in the full profile, adjudicator bonds, `apBond[c]` and `apFee[c]`. Postings follow `docs/architecture.md`, "Hold and settlement postings". Values: price 2, fee 1, appeal bond 1, appeal fee 1, default compensation 1 per liable bond. |
| The ledger | `out[c]` records what `escrow[c]` paid to the payment address, to the payout address and to each fee account. It is an observer: in each step that debits the escrow it adds what that step itself credited to those accounts. The properties compare it with how the deal closed. |
| Time | The absolute deadlines are strictly ordered, so `clk[c]` counts how many have passed (1 offerExpiresAt, 2 fundBy, 3 deliverBy, 4 judgeBy, 5 fallbackBy). Core refuses any other order (`packages/core/src/timing.ts:35-49`), and so does the contract at funding (`HoldbackRules.sol:198-204`). Relative deadlines get their own counters: `escClk` for the escalation's appealDecideBy, `apClk` for appealBy and then appealDecideBy. Each tick is its own step, so TLC explores every interleaving of deadlines across commitments and actions. An action is on time iff its deadline has not passed. A timeout fires iff it has. |
| Halting | `Halted` names one actor. A weakly fair `Crash` step stops it at some point, which may be any point, and it never acts after that. |
| Fairness | Weak fairness applies only to the "anyone" timeouts, the clock and `Crash`. No named actor is ever required to act, so every config also covers any actor stopping at any time. |
| Operator | Relays signed messages or is bypassed (ADR-0005). It has no action that authors a message. |
| Beacon | Fallback, escalation and appeal decisions need it (ADR-0018: no beacon fact, no decision). The primary does not. |
| The escrow's hold (T-337) | `escrow[c]` is the hold in Commerce Payments' `AuthCaptureEscrow` (CPP). `cppExp[c]` says its `authorizationExpiry` has passed. From then on no capture succeeds, a void still does, and the payer alone, which is the payment address, may reclaim the hold on the escrow directly (`CppReclaim`, `cppRec[c]`). The rules contract's timeouts then close the deal and move no money. With ordered deadlines the expiry comes after every deadline a capture could meet. |
| Bonds (T-337, full profile) | `bond[a]` is the posted bond, `enc[a]` the encumbered part, and `flags[c]` the adjudicators whose bond is encumbered for commitment c. Funding encumbers the primary's bond for the price, a fallback decision moves the encumbrance to the fallback, and every close releases it or slashes it. |

## Not modelled

- **Signatures and messages.** A signature is "the named actor took the step". So the model has no message
  expiry, no replay and no message signed earlier and relayed after its signer stopped. A step that needs two
  signatures, such as an early accept in `Held` that carries the seller's delivery, needs both actors able to act
  at that step.
- **The content of a delivery.** The model has no delivery hash. It does not check that a decision, an early
  accept or a settlement names the posted delivery (ADR-0029), nor that a late-work settlement releases the key of
  the delivery it names. Forge tests cover both (`contracts/test/unit/MutualSettleNamedDelivery.t.sol`).
- **The beacon round and its margin.** The model knows only whether the beacon answers. Which round fixes a
  seed, and the margin after an escalation, are tested in forge (ADR-0032).
- **Amounts other than the fixed ones.** A zero price or a zero fee takes other branches in the contract
  (`HoldbackRules.sol:330`, `:335-336`, `:369-370`). Forge tests cover them.
- **A payment address equal to the payout address,** or to the other party's signing address. The contract
  compares no two addresses. The model checks each money address equal to its own party's signing address, or
  apart from every other address.
- **Terms out of order.** A `deliverBy` or a `judgeBy` after the escrow's expiry cannot be signed into a deal:
  both profiles refuse the terms. The `late-judge-by` variants show what the refusal prevents.
- **A third-party payout in a settlement.** The full protocol allows one where the rulebook does (D23). The
  model splits the price between the two money addresses in both profiles.
- **The full profile's economics.** Each adjudicator starts with a bond that covers both commitments, so the
  coverage gate never blocks. A bond too small, a zero appeal bond and an appeal adjudicator's own bond (known
  issues L-3 and L-5) are not modelled; phase one ships none of them.
- **The rest:** `settle_after_window` and the `settle` timeout, scopes and mandates, rulebook checks, more than
  one delivery attempt, the operator fee, and appeal clauses beyond core's default rules.
- **The contract's stored closing reason and decider.** See "Waiting for RF-4".

## Properties

"Both" means the property is checked in both profiles.

| Property | Kind | Profile | Meaning |
| --- | --- | --- | --- |
| `TypeOK` | invariant | both | Variables stay in their domains. |
| `Conservation` | invariant | both | The total over all accounts is constant: no posting creates or destroys a unit. |
| `NonNegative` | invariant | both | No account goes negative. |
| `SettleOnce` | invariant | both | Each escrow is debited in at most one step. |
| `EscrowMatchesState` | invariant | both | The escrow holds price + fee exactly while funded and undecided, and nothing otherwise. After the payment address's own reclaim it holds nothing although the stage is still funded. |
| `ExpiryAfterCaptures` | invariant | both | The escrow's expiry passes only once no decision is on time and, in Held, deliverBy has passed. |
| `PhaseOneCuts` | invariant | phase one | No party appeal and no appeal stake, no bond posted or encumbered, no `Expired` and no `Defaulted` state. |
| `EscrowLedger` | invariant | both | Whatever left an escrow reached the payment address, the payout address or a fee account. A unit paid anywhere else leaves the sum short. |
| `PaidAsClosed` | invariant | both | The money matches how the deal closed. A decision's accept paid the price to the payout address, a reject paid it to the payment address, and either paid the fee to the adjudicator that decided and to no other. An early accept paid the price to the payout address and returned the fee. A reclaim or a default returned the whole hold to the payment address. A settlement split the price between the two and returned the fee. After the payment address's reclaim on the escrow, that address has the whole hold and nobody else has anything. |
| `DefaultRefundsBuyer` | invariant | both | After a default the payment address has the whole hold back, and the escrow paid nothing to the payout address or to any adjudicator. |
| `SignersHoldNothing` | invariant | phase one | A signing address that is apart from its money address holds nothing, at any step. |
| `KeyOnlyWithPayment` | invariant | both | The buyer holds the content key only in Released, or in Settled when the settlement released it, and always holds it in Released. |
| `RefundedNeverReleasedKey` | invariant | both | A Refunded deal's buyer does not hold the key. With `AtomicKey`, which says a key is never taken back, it never held it. |
| `BondCovered`, `EncMatchesDeals`, `BondsReleasedAtClose` | invariants | full | No encumbrance exceeds its bond; each encumbrance is the price times the open deals that flag the adjudicator; a deal holds a bond only while funded or appealable. |
| `AuthorizedMoves` | action property | both | Every debit is justified by the state before the step and by who signed it. An escrow debit needs: the decision of the adjudicator whose turn it is, on time, with a beacon for the fallback and the appeal adjudicator; or the buyer's early accept after a delivery; or both parties' settlement; or reclaim after deliverBy; or the default outcome after its deadline; or the payment address's own reclaim after the escrow's expiry. In phase one a decision or an early accept in Held also qualifies, with the seller's signature on the delivery it carries, before deliverBy. A wallet debit needs the payment address's own funding before the funding deadline, or, in the full profile, a party's own appeal. Bond and appeal-stake debits need an appeal decision, an expired appeal or the default outcome. Fee accounts are never debited. The halted actor signs nothing after it crashes. |
| `PaymentAddressFunds` | action property | both | Whatever enters an escrow leaves the payment address in the same step, a funding that address signed, and no other holder's balance changes. |
| `SignersOnlyStake` | action property | both | A signing address apart from its money address never pays or receives deal money. Its balance changes only by its own appeal stake, in the full profile. |
| `FirstDecisionFinal` | action property | both | Once an escrow is paid out, the deal's outcome, key, escrow and ledger never change. In phase one nothing about the deal changes, and no later step that names it moves money. |
| `LapsedOfferNeverFunds` | action property | both | An unfunded offer whose funding deadline has passed never funds. |
| `AtomicKey` | action property | both | The key moves only in a step that pays out the escrow, every transition into Released carries it, and it is never taken back (ADR-0012). |
| `NoCaptureAfterExpiry` | action property | both | After the escrow's expiry, whatever leaves it goes to the payment address in full and no fee is paid. |
| `FundedSettles` | liveness | both | `Held ~> Released, Refunded or Settled`, for each commitment: every funded deal ends. |
| `FundedFinal`, `OfferEnds`, `BondsFreed` | liveness | full | The appeal state closes too; every offer ends, expired or paid out; every encumbered bond is freed. Phase one has no appeal state to close, records no expiry and has no bond. |

The five properties the phase-one contracts must keep, and where each is checked:

| The promise | Property | Config |
| --- | --- | --- |
| No money moves without a signature, a decision or a passed deadline | `AuthorizedMoves`, `PaymentAddressFunds` | `phase-one/safety-*` |
| Each escrow pays once | `SettleOnce`, `FirstDecisionFinal` | `phase-one/safety-*` |
| Every funded deal ends | `FundedSettles` | `phase-one/live-*` |
| A deal that ends Refunded never released its key | `RefundedNeverReleasedKey`, `AtomicKey` | `phase-one/safety-*` |
| A default refunds the buyer | `DefaultRefundsBuyer`, `PaidAsClosed` | `phase-one/safety-*` |

## Configs

| Config | Halted | Checks |
| --- | --- | --- |
| `full/safety-equal.cfg`, `full/safety-apart.cfg` | none | every invariant and action property of the full profile, with each money address equal to its signing address, and with both apart |
| `phase-one/safety-equal.cfg`, `safety-apart.cfg`, `safety-buyer-apart.cfg`, `safety-seller-apart.cfg` | none | every invariant and action property of the phase-one profile, for each choice of which money addresses are apart |
| `full/live-<actor>.cfg` | buyer, seller, primary, fallback, appeal, operator, beacon (addresses equal), payer (addresses apart) | the four liveness properties, plus `TypeOK`, `Conservation` and `SettleOnce` |
| `phase-one/live-<actor>.cfg` | the same eight actors, addresses apart | `FundedSettles`, plus `TypeOK`, `Conservation`, `SettleOnce` and `PhaseOneCuts` |

Each broken config sets `Bug` to one planted fault and names the property that must fail. Its `\* expect:` line is
what TLC must print; `check.sh` requires that TLC fails on that config and that its output matches the line.

| Broken config | The fault | Must fail |
| --- | --- | --- |
| `broken/phase-one/refund-to-signer.cfg` | a reclaim refunds the buyer's signing address | `SignersHoldNothing` |
| `broken/phase-one/pay-signer.cfg`, `pay-signer-ledger.cfg` | an accept pays the seller's signing address | `SignersOnlyStake`, `EscrowLedger` |
| `broken/phase-one/fund-from-signer.cfg` | funding pulls the hold from the buyer's signing address | `PaymentAddressFunds` |
| `broken/phase-one/early-accept-keeps-fee.cfg` | an early accept pays the fee to the primary | `PaidAsClosed` |
| `broken/phase-one/default-pays-fee.cfg` | a default pays the fee to the fallback adjudicator | `DefaultRefundsBuyer` |
| `broken/phase-one/reject-releases-key.cfg` | a reject hands the buyer the key | `RefundedNeverReleasedKey` |
| `broken/phase-one/reject-refunds-fee.cfg` | a reject pays the fee and also returns it | `Conservation` |
| `broken/phase-one/second-capture.cfg` | the primary decides again after the close | `FirstDecisionFinal` |
| `broken/phase-one/fund-after-expiry.cfg` | funding lands after `offerExpiresAt` | `LapsedOfferNeverFunds` |
| `broken/phase-one/expire-recorded.cfg` | the contract records an offer's expiry | `PhaseOneCuts` |
| `broken/phase-one/late-early-accept.cfg` | an early accept in Held lands its delivery after `deliverBy` | `AuthorizedMoves` |
| `broken/*/late-judge-by.cfg` | terms whose `judgeBy` falls after the escrow's expiry are taken | `ExpiryAfterCaptures` |
| `broken/*/operator-authors.cfg` | the operator submits an early accept the buyer never signed | `AuthorizedMoves` |
| `broken/*/early-reclaim.cfg` | reclaim fires at fundBy instead of deliverBy | `AuthorizedMoves` |
| `broken/*/key-separate.cfg` | an accept pays the seller and the key follows in a later step | `AtomicKey` |
| `broken/*/double-refund.cfg` | after the payment address's reclaim on the escrow, the timeout refunds again | `SettleOnce` |
| `broken/*/capture-after-expiry.cfg` | an early accept captures after the escrow's expiry | `NoCaptureAfterExpiry` |
| `broken/*/buyer-only-timeout.cfg` | timeouts are callable by the buyer only, and the buyer halts | `FundedSettles` |
| `broken/full/second-capture.cfg` | the primary decides again after the close | `SettleOnce` |
| `broken/full/mint.cfg` | the default outcome pays compensation without debiting bonds | `Conservation` |
| `broken/full/keep-bond-after-cpp.cfg` | after a reclaim on the escrow the timeout keeps the deal's bonds | `BondsReleasedAtClose` |
| `broken/full/slash-keeps-enc.cfg`, `slash-uncovered.cfg` | an overturn slashes the bond but keeps the encumbrance | `EncMatchesDeals`, `BondCovered` |

`broken/*/` means the variant runs in both profiles, one config each.

**Reach witnesses.** `reach.list` names states the model must reach, one per line. Each is an operator `W_...`
that says "this state is never reached"; `check.sh` runs it as an invariant and requires TLC to violate it. A
safety config that passes because the model lost a behaviour would lose its witness. The phase-one witnesses are
the closing rows P06 to P17 of `docs/audit/state-model.md`, section 9.3, and the steps phase one adds: an early
accept and a decision that carry the delivery, a late-work settlement with its key, and a close after the payment
address's reclaim on the escrow. The full-profile witnesses are what phase one cuts: an appeal overturned, upheld
and undecided, an offer's recorded expiry, the `Defaulted` state and a fallback's encumbered bond.

**What became of `broken/late-judge-by.cfg`.** It moved, and it changed meaning. T-337 wrote it as the record of
an open issue (L-6): the deployed contract took terms whose `judgeBy` falls after the escrow's expiry. The lane's
contract refuses such terms at funding (`HoldbackRules.sol:198-204`, ADR-0031 section 6), and core refuses them for
SimChain, so no code this model describes can reach that trace. The variant is now a planted fault like the
others, one config per profile: it removes the refusal and shows that `ExpiryAfterCaptures` would catch its loss.

## Model to code: phase one

`R:` is `contracts/src/HoldbackRules.sol` and `E:` is
`contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` (the pinned commit `6b0a5ef`). Lines are at the lane's
commit `ffb67cf`. The mapping was read, not checked by a tool [inferred].

| Model action | Contract function and line |
| --- | --- |
| `Offer` | `agreeAndFund` (`R:178`): the seller's signature over the commitment ID, checked at funding (`R:205`). Nothing is stored before funding |
| `AdjAccept` | `agreeAndFund`: the primary's `Acceptance` signature (`R:206`), unexpired (`R:189`), with `bondReserved` of 0 (`R:192`) |
| `Agree` | `agreeAndFund`: the buyer's `Agree` signature (`R:207`), unexpired (`R:189`) |
| `Fund` | `agreeAndFund`: stage None (`R:187`); before `offerExpiresAt` and `fundBy` (`R:188`); the deadlines strictly in order, one delivery attempt, an escalation window above 0 and an appeal window of 0 (`R:198-204`); `stage = Held` (`R:210`); `ESCROW.authorize` (`R:215`) pulls price + fee from the escrow's payer, `buyerPaymentAddress` (`R:159`), on that address's ERC-3009 signature |
| `Deliver` | `deliver` (`R:223`): stage Held (`R:226`); `_acceptDelivery` (`R:503`): before `deliverBy` (`R:510`), attempt 1 (`R:511`), the seller's signature (`R:513`); `stage = Delivered` (`R:228`) |
| `DecidePrimary` | `decide` (`R:235`): role by stage (`R:252-254`), before `judgeBy` (`R:276`), the seed reveal (`R:279`), the primary's signature (`R:291`); `_firstInstance` (`R:300`). In Held the call first lands the delivery it carries (`R:241-245`), under `_acceptDelivery`'s checks |
| `DecideFallback` | `decide`: role and deadline `fallbackBy` (`R:255-258`, `R:276`), the beacon round and the seed (`R:280-287`); `_firstInstance` |
| `FirstInstance` with `escalate` | `_firstInstance` (`R:304-309`): `stage = Escalated`, `t1` = now; no money moves |
| `FirstInstance` with accept or reject | `_firstInstance` (`R:310-313`): `stage = Released` or `Refunded`, final when written; `_settleDecision` |
| `DecideEscalated` | `decide`: role and deadline `t1 + appealDecideSec` (`R:259-262`, `R:276`), accept or reject only (`R:270`); `_escalationDecision` (`R:317`) |
| `Settle` | `_settleDecision` (`R:326`). Accept: one capture of the hold with the fee to the decider (`R:330`); the rest goes to the escrow's receiver, `sellerPayoutAddress` (`R:160`, `E:468-471`); the key is released (`R:333`). Reject: a fee-only capture to the decider (`R:335`), then a void (`R:336`), which pays the payer (`E:315`). A key on a reject reverts (`R:275`) |
| `EarlyAccept` | `earlyAccept` (`R:349`): stage Held or Delivered (`R:359`); the buyer's signature (`R:361`); in Held `_acceptDelivery` lands the carried delivery (`R:362`); the price captured to the payout address (`R:369`), the fee voided to the payment address (`R:370`), the key released (`R:374`) |
| `MutualSettle` | `mutualSettle` (`R:383`): the four funded stages (`R:389-391`); no key without a named delivery (`R:393-395`); both signatures (`R:400-401`); `stage = Settled` (`R:407`); `_payOut` (`R:417`): a payout names the payout address or the payment address and nothing else (`R:423`), the payouts sum to the price (`R:427`), the seller's share is a capture (`R:429`), the rest and the whole fee a void (`R:434-436`); the key (`R:410`) |
| `Reclaim` | `reclaim` (`R:447`): stage Held (`R:450`), from `deliverBy` (`R:451`); `_refundAll` |
| `TriggerFallback` | `triggerFallback` (`R:457`): stage Delivered (`R:460`), from `judgeBy` (`R:461`) |
| `TriggerDefault` | `triggerDefault` (`R:470`): from `fallbackBy` (`R:475`) or from `t1 + appealDecideSec` after an escalation (`R:477`); `_refundAll` in the same call (`R:482`) |
| the refund in `Reclaim` and `TriggerDefault` | `_refundAll` (`R:487`): `stage = Refunded` (`R:488`); the void (`R:496`) pays the payer; skipped when the escrow holds nothing after its expiry (`R:492-494`) |
| `TickExpiry` | `authorizationExpiry = fallbackBy + appealDecideSec + EXPIRY_MARGIN` (`R:153`, `R:164`). A capture reverts from it (`E:277-278`); a void does not check it (`E:304-316`) |
| `CppReclaim` | the escrow's `reclaim` (`E:323`): only the payer may call it, from `authorizationExpiry` (`E:325-326`), and it pays the payer (`E:339`). Outside the rules contract |
| `TickAbs`, `TickEsc` | `block.timestamp` against `Terms.timing` and `Deal.t1` |
| `Crash` | (environment) an actor stops |
| `Expire`, `FileAppeal`, `DecideAppeal`, `ExpireAppeal`, `TickAppeal`, `ApplyDefault` | not in phase one: `~P1` disables each, and the contract has no such function (`R:443-444` says so for the offer's expiry) |
| `OperatorEarlyAccept`, `ReleaseKeyLate` and the other `Bug` branches | none: they exist only in the broken variants |

| Model variable | Contract storage or event |
| --- | --- |
| `esc` | `Deal.stage` (`R:36-41`; `Stage`, `R:23-32`). The model's None, Offered, AcceptedByAdjudicator and Agreed are all `Stage.None` |
| `via` | none stored: the events `Decided`, `JobCompleted`, `Refunded`, `Defaulted` and `MutuallySettled` tell how a deal closed. RF-4 stores it |
| `ap`, `appellant`, `apClk`, `apBond`, `apFee`, `bond`, `enc`, `flags` | none: phase one has no appeal state and no bond (`PhaseOneCuts`) |
| `clk`, `escClk` | `block.timestamp` against `Terms.timing`; `Deal.t1` starts the escalation's window |
| `key` | the `KeyReleased` event (`R:97`, `_releaseKey` `R:532`), always to `t.buyer` |
| `wallet[PayAddr]`, `wallet[PayoutAddr]` | the token balances of `t.buyerPaymentAddress` and `t.sellerPayoutAddress`, the escrow's payer and receiver (`R:159-160`); the `SettlementAddresses` event names both (`R:103`) |
| `wallet` of a signing address that is apart | the token balances of `t.buyer` and `t.seller`, which no step of the contract moves |
| `escrow` | the escrow's `paymentState(hash).capturableAmount` for the deal's `PaymentInfo` (`_paymentInfo`, `R:147`) |
| `fees` | the deciding adjudicator's token balance (the fee capture, `R:330`, `R:335`) |
| `cppExp` | `block.timestamp >= authorizationExpiry` (`R:164`) |
| `cppRec` | the escrow's `paymentState` after the payer's `reclaim`: nothing capturable, read in `_refundAll` (`R:493-494`) |
| `moves`, `out`, `up`, `act` | none: counters, the ledger, environment and history |

**Where the model's shape differs from the contract's.** The model takes the offer, the acceptance and the
agreement as three steps before `Fund`; the contract checks the three signatures in the one call that funds. The
model's absolute clock stops at the deadline the current state can use.

## Model to code: full profile

`S:` is `packages/core/src/state.ts` and `Sim:` is `packages/settlement/sim/simchain.ts`, at `ffb67cf`. SimChain
steps core's `step` and then posts the money.

| Model action | Core and SimChain |
| --- | --- |
| `Offer` | `offer()` (`S:207`) |
| `AdjAccept` | `step` `adjudicator_accept` → `adjudicatorAccept` (`S:253`) |
| `Agree` | `step` `agree` → `agree` (`S:284`) |
| `Fund` | `step` `fund` → `fund` (`S:303`): the authorization comes from the payment address (`S:311`); SimChain posts the hold (`Sim:803`) |
| `Deliver` | `step` `deliver` → `deliver` (`S:336`) |
| `DecidePrimary`, `DecideFallback` | `step` `decide` in Delivered or FallbackJudging → `firstInstance` (`S:429`); SimChain's `decide` pays the payout or the payment address and the fee (`Sim:841`) |
| `DecideEscalated` | `step` `decide` in Escalated → `escalationDecision` (`S:477`) |
| `EarlyAccept` | `step` `early_accept` in Delivered (`S:664`); SimChain posts the price to the payout address and the fee back to the payment address (`Sim:747`) |
| `MutualSettle` | `step` `mutual_settle` → `mutualSettle` (`S:599`), `lateDelivery` in Held (`S:587`); SimChain's `mutualSettle` (`Sim:918`) |
| `FileAppeal` | `step` `file_appeal` → `settled` (`S:552`) → `stepAppeal` (`S:509`) |
| `DecideAppeal` | `step` `decide` in Released or Refunded → `settled` → `stepAppeal`; SimChain pays an overturn from the first decider's bond to the wronged party's money address (`Sim:881`) |
| `Expire` | `step` `expire` (`S:650`, `S:706`); TimeoutKind `expire_offer` |
| `Reclaim` | `step` `reclaim` (`S:657`); SimChain refunds the payment address (`Sim:975`) |
| `TriggerFallback` | `step` `trigger_fallback` (`S:674`) |
| `TriggerDefault`, `ApplyDefault` | `step` `trigger_default` (`S:681`, `S:688`) and `apply_default_outcome` (`S:695`); SimChain refunds the payment address and compensates the payout address from the liable bonds (`Sim:988`) |
| `ExpireAppeal` | `step` `expire_appeal` → `stepAppeal` (`S:544`); SimChain returns an open appeal's bond and fee to the appellant (`Sim:1008`) |
| `TickExpiry`, the `~cppExp` guards | SimChain's `beforeCaptureExpiry` (`Sim:602`), which refuses a payment to the seller from `authorizationExpiry` as the escrow does |
| `CppReclaim` | none on SimChain, which has no escrow contract beside it. The full profile keeps the step so that the bond properties of T-337 still cover it |

Core's own `phase_one` profile keeps core's shape: a default in two steps, a delivery as its own step, funding
until `fundBy`. The EVM adapter maps the contract's single calls onto those steps. The model's phase-one profile
follows the contract.

## Waiting for RF-4

The contract will store a closing reason and a decider in the deal's word (`docs/audit/state-model.md`, section
9.2; refactor RF-4, which T-375 lands). They are not modelled yet. `Holdback.tla` marks the place, after the
variables, with the two fields and the properties to add:

- **`ReasonRules`:** the reason is `open` exactly while the deal is not closed; a decider is named exactly when
  the reason is `decided`; neither changes after the close.
- **`ReasonMatchesMoney`:** the reason matches the money that moved. It is `PaidAsClosed`, restated over the
  stored reason and decider in place of `via`, the model's own record of how a deal closed.

The second pass is a small pull request once T-375 reports RF-4 merged.

## Run times

To fill in from the final run.
