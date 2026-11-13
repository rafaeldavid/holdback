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
formal/check.sh phase-one/   # everything of the phase-one profile, liveness included; full/ likewise
formal/check.sh reach/       # the reach witnesses alone
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
(`packages/core/src/state.ts:188`). `P1` is true in the phase-one profile, and it gates every difference:

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
| Appeal states | Every `AppealState.kind`, plus `na` where no appeal state exists; party appeals are SimChain only, not in phase one. In phase one a first-instance decision writes `expired`, as core does: closed, with no appeal. The API's state read reports `appealState` `none` there. |
| Money | Abstract units in the holders' wallets, `escrow[c]`, adjudicator fee accounts and, in the full profile, adjudicator bonds, `apBond[c]` and `apFee[c]`. Postings follow `docs/architecture.md`, "Hold and settlement postings". Values: price 2, fee 1, appeal bond 1, appeal fee 1, default compensation 1 per liable bond. |
| The ledger | `out[c]` records what `escrow[c]` paid to the payment address, to the payout address and to each fee account. It is an observer: in each step that debits the escrow it adds what that step itself credited to those accounts. The properties compare it with how the deal closed. |
| The closing reason and the decider | `reason[c]` and `decider[c]` are the two fields the contract stores in the deal's word when it closes a deal (`docs/audit/state-model.md`, section 9.2). The model writes them in the closing step, in both profiles. SimChain stores no such fields: its state keeps the same fact as `via`. In the full profile "closed" means the escrow is paid out: a first-instance decision there can still be appealed, and the decider stays what it was after an overturn. |
| Time | The absolute deadlines are strictly ordered, so `clk[c]` counts how many have passed (1 offerExpiresAt, 2 fundBy, 3 deliverBy, 4 judgeBy, 5 fallbackBy). Core refuses any other order (`packages/core/src/timing.ts:35-49`), and so does the contract at funding (`HoldbackRules.sol:222-228`). Relative deadlines get their own counters: `escClk` for the escalation's appealDecideBy, `apClk` for appealBy and then appealDecideBy. Each tick is its own step, so TLC explores every interleaving of deadlines across commitments and actions. An action is on time iff its deadline has not passed. A timeout fires iff it has. |
| Halting | `Halted` names one actor, or `"any"` to let the check choose it. A weakly fair `Crash` step stops that actor at some point, which may be any point, and it never acts after that. |
| Signatures | A signature is "the named actor took the step". A step that needs an actor's signature needs that actor not crashed, and each step records its signers. `Signed` holds every step to that record. It can fail only where an actor halts, so the `safety-halting` and `live-*` configs are the ones that check it. |
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
- **The rest of the stored word.** The contract also stores the delivery attempt, a time (`t1`) and the posted
  delivery's hash. The model has none of them, so `ReasonRules` does not state the ties
  `docs/audit/state-model.md`, section 9.3, makes between them and the closing reason.
- **The beacon round and its margin.** The model knows only whether the beacon answers. Which round fixes a
  seed, and the margin after an escalation, are tested in forge (ADR-0032).
- **Amounts other than the fixed ones.** A zero price or a zero fee takes other branches in the contract
  (`HoldbackRules.sol:356`, `:361-362`, `:395-396`). Forge tests cover them.
- **A payment address equal to the payout address,** or to the other party's signing address. The contract
  compares no two addresses. The model checks each money address equal to its own party's signing address, or
  apart from every other address.
- **Terms out of order.** A `deliverBy` or a `judgeBy` after the escrow's expiry cannot be signed into a deal:
  both profiles refuse the terms. The `late-judge-by` variants show what the refusal prevents.
- **A token that refuses a transfer.** Every void and capture in the model succeeds. On the contract a transfer
  the token refuses makes `reclaim`, `triggerDefault` and the escrow's own `reclaim` revert, so `FundedSettles`
  rests on the token letting transfers through. Token-issuer risk is out of the audit's scope
  (`docs/audit/scope.md`); `docs/audit/state-model.md`, section 5.3, states the assumption.
- **What a message signs.** A settlement's split is chosen by the step; the model does not record the split the
  parties signed, so it cannot tell a payout that differs from the signed one. The funding's amount is fixed.
- **Addresses that coincide with an adjudicator,** and one adjudicator in two roles. The contract allows both.
- **A contract signer whose answer changes** between two steps (ADR-0031 section 5).
- **A third-party payout in a settlement,** and a share of the fee for the sitting adjudicator. The full protocol
  allows both where the rulebook does (D23). The model splits the price between the two money addresses and
  returns the whole fee, in both profiles.
- **The full profile's economics.** Each adjudicator starts with a bond that covers both commitments, so the
  coverage gate never blocks. A bond too small, a zero appeal bond and an appeal adjudicator's own bond (known
  issues L-3 and L-5) are not modelled; phase one ships none of them.
- **SimChain's own bond bookkeeping.** The full profile's bond steps follow the bond vault the lane deleted:
  funding encumbers the primary's bond, and a fallback's decision moves the encumbrance. SimChain reserves the
  primary's bond at its acceptance, the fallback's at the takeover and the appeal adjudicator's at an escalation
  (`packages/settlement/sim/simchain.ts`) [measured by T-376's review]. The bond properties therefore describe
  the vault's rule, which returns with bonds (ADR-0031), and not SimChain's steps one for one.
- **The rest:** `settle_after_window` and the `settle` timeout, scopes and mandates, rulebook checks, more than
  one delivery attempt, the operator fee, and appeal clauses beyond core's default rules.

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
| `ReasonRules` | invariant | both | The stored closing reason and decider keep the rules of `docs/audit/state-model.md`, section 9.2: the reason is `open` exactly while the deal is not closed; a decider is named exactly when the reason is `decided`; the reason fixes the stage. |
| `ReasonMatchesMoney` | invariant | both | The stored reason matches the money that moved, read from the ledger and not from `via`. Decided: the price went to the payout address on a release and to the payment address on a refund, and the fee went to the stored decider and to no other adjudicator. Accepted early: the price to the payout address, the fee back. Settled: the price split between the two addresses, the fee back. Reclaimed or defaulted: the whole hold back to the payment address. After the payment address's own reclaim on the escrow the reason is `open`, `reclaimed` or `defaulted`, and that address has the whole hold. |
| `DefaultRefundsBuyer` | invariant | both | After a default the payment address has the whole hold back, and the escrow paid nothing to the payout address or to any adjudicator. |
| `SignersHoldNothing` | invariant | phase one | A signing address that is apart from its money address holds nothing, at any step. |
| `KeyOnlyWithPayment` | invariant | both | The buyer holds the content key only in Released, or in Settled when the settlement released it, and always holds it in Released. |
| `RefundedNeverReleasedKey` | invariant | both | A Refunded deal's buyer does not hold the key. With `AtomicKey`, which says a key is never taken back, it never held it. |
| `BondCovered`, `EncMatchesDeals`, `BondsReleasedAtClose` | invariants | full | No encumbrance exceeds its bond; each encumbrance is the price times the open deals that flag the adjudicator; a deal holds a bond only while funded or appealable. |
| `AuthorizedMoves` | action property | both | Every debit is justified by the state before the step and by who signed it. An escrow debit needs: the decision of the adjudicator whose turn it is, on time, with a beacon for the fallback and the appeal adjudicator; or the buyer's early accept after a delivery; or both parties' settlement; or reclaim after deliverBy; or the default outcome after its deadline; or the payment address's own reclaim after the escrow's expiry. In phase one a decision or an early accept in Held also qualifies, with the seller's signature on the delivery it carries, before deliverBy. A wallet debit needs the payment address's own funding before the funding deadline, or, in the full profile, a party's own appeal. Bond and appeal-stake debits need an appeal decision, an expired appeal or the default outcome. Fee accounts are never debited. Every signer the step names was able to act (`Signed`). |
| `AuthorizedSteps` | action property | both | Every step that changes a deal's stage is justified, whether or not it moves money: by the stage before it, the step's name and signers, and the deadline. A delivery needs the seller, before deliverBy. The fallback takes over only from judgeBy. Only the adjudicator whose turn it is escalates. The record of how a deal closed is the step that closed it, and so are the stored reason and decider: a default is stored as a default and a reclaim as a reclaim, although the money is the same. So the adjudicator `PaidAsClosed` and `ReasonMatchesMoney` find paid is the one whose turn it was. In the full profile the appeal state moves only by the losing party's filing in time, the appeal adjudicator's decision in time, or an expiry. |
| `BondMoneyLands` | action property | full (SimChain only, not in phase one) | A filing takes the appeal bond and fee from the losing party's signing address and from nobody else. An overturn pays the price to the wronged party's money address and returns the bond to the appellant's signing address. An undecided appeal returns bond and fee there. The default compensation lands on the payout address (ADR-0033 section 4). |
| `PaymentAddressFunds` | action property | both | Whatever enters an escrow leaves the payment address in the same step, a funding that address signed, and no other holder's balance changes. |
| `SignersOnlyStake` | action property | both | A signing address apart from its money address never pays or receives deal money. Its balance changes only by its own appeal stake, in the full profile. |
| `FirstDecisionFinal` | action property | both | Once an escrow is paid out, the deal's outcome, key, escrow, ledger, stored reason and decider never change. In phase one nothing about the deal changes, and no later step that names it moves money. |
| `LapsedOfferNeverFunds` | action property | both | An unfunded offer whose funding deadline has passed never funds. |
| `AtomicKey` | action property | both | The key moves only in a step that pays out the escrow, every transition into Released carries it, and it is never taken back (ADR-0012). |
| `NoCaptureAfterExpiry` | action property | both | After the escrow's expiry, whatever leaves it goes to the payment address in full and no fee is paid. |
| `FundedSettles` | liveness | both | `Held ~> Released, Refunded or Settled`, for each commitment: every funded deal ends. |
| `FundedFinal`, `OfferEnds`, `BondsFreed` | liveness | full | The appeal state closes too; every offer ends, expired or paid out; every encumbered bond is freed. Phase one has no appeal state to close, records no expiry and has no bond. |

Some properties follow from others and are kept for their plain names. `DefaultRefundsBuyer` is the default row
of `PaidAsClosed`. `RefundedNeverReleasedKey` follows from `KeyOnlyWithPayment`. In phase one `SignersOnlyStake`
says what `SignersHoldNothing` says; it adds something only in the full profile, where a signer holds its appeal
stake. `PaymentAddressFunds` adds to `AuthorizedMoves` that the debit and the credit are the same amount and that
no other balance moves.

The five properties the phase-one contracts must keep, and where each is checked:

| The promise | Property | Config |
| --- | --- | --- |
| No money moves without a signature, a decision or a passed deadline | `AuthorizedMoves`, `AuthorizedSteps`, `PaymentAddressFunds` | `phase-one/safety-*`; the signatures in `phase-one/safety-halting` and `phase-one/live-*` |
| Each escrow pays once | `SettleOnce`, `FirstDecisionFinal` | `phase-one/safety-*` |
| Every funded deal ends | `FundedSettles` | `phase-one/live-*` |
| A deal that ends Refunded never released its key | `RefundedNeverReleasedKey`, `AtomicKey` | `phase-one/safety-*` |
| A default refunds the buyer | `DefaultRefundsBuyer`, `PaidAsClosed` | `phase-one/safety-*` |

## Configs

| Config | Halted | Checks |
| --- | --- | --- |
| `full/safety-equal.cfg`, `full/safety-apart.cfg` | none | every invariant and action property of the full profile, with each money address equal to its signing address, and with both apart |
| `phase-one/safety-equal.cfg`, `safety-apart.cfg`, `safety-buyer-apart.cfg`, `safety-seller-apart.cfg` | none | every invariant and action property of the phase-one profile, for each choice of which money addresses are apart |
| `full/safety-halting.cfg`, `phase-one/safety-halting.cfg` | any one actor, addresses apart | the same invariants and action properties while one actor halts at some point; TLC covers each choice of actor. This is where a missing signature shows |
| `full/live-<actor>.cfg` | buyer, seller, primary, fallback, appeal, operator, beacon (addresses equal), payer (addresses apart) | the four liveness properties and every action property, plus `TypeOK`, `Conservation` and `SettleOnce` |
| `phase-one/live-<actor>.cfg` | the same eight actors, addresses apart | `FundedSettles` and every action property, plus `TypeOK`, `Conservation`, `SettleOnce` and `PhaseOneCuts` |

The liveness verdict does not depend on which actor halts: no fair step needs a named actor, so a halt only
removes optional steps. Each `live-<actor>` config is the record for that actor that `docs/neutrality.md` asks
for, and it also checks that the halted actor signs nothing after it stops. The operator's halt changes nothing
the model can see, because a signed message always has the direct route.

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
| `broken/phase-one/default-recorded-decided.cfg` | a default is stored as the fallback's decision | `ReasonMatchesMoney` |
| `broken/phase-one/fee-to-other.cfg` | a decision pays the fee to an adjudicator other than the stored decider | `ReasonMatchesMoney` |
| `broken/phase-one/reason-not-written.cfg` | a settlement closes the deal and leaves its stored reason open | `ReasonRules` |
| `broken/phase-one/default-recorded-reclaimed.cfg` | a default is stored as a reclaim | `AuthorizedSteps` |
| `broken/phase-one/second-capture.cfg` | the primary decides again after the close | `FirstDecisionFinal` |
| `broken/phase-one/fund-after-expiry.cfg` | funding lands after `offerExpiresAt` | `LapsedOfferNeverFunds` |
| `broken/phase-one/expire-recorded.cfg` | the contract records an offer's expiry | `PhaseOneCuts` |
| `broken/phase-one/late-early-accept.cfg` | an early accept in Held lands its delivery after `deliverBy` | `AuthorizedMoves` |
| `broken/phase-one/fund-from-signer-negative.cfg`, `double-refund-escrow.cfg`, `reject-releases-key-payment.cfg` | three of the faults above, against a second property | `NonNegative`, `EscrowMatchesState`, `KeyOnlyWithPayment` |
| `broken/*/settle-alone.cfg` | a settlement needs the buyer's signature only, and the seller has halted | `AuthorizedMoves` |
| `broken/*/fund-without-payer.cfg` | the buyer's signing key alone funds the hold, and the payment address has halted | `AuthorizedMoves` |
| `broken/*/early-fallback.cfg` | the fallback takes over at deliverBy, while the primary is on time | `AuthorizedSteps` |
| `broken/*/late-delivery.cfg` | a delivery lands after deliverBy | `AuthorizedSteps` |
| `broken/*/wrong-decider.cfg` | the fallback's decision pays the primary and is recorded as the primary's | `AuthorizedSteps` |
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
| `broken/full/overturn-pays-signer.cfg` | an overturn pays the wronged party's signing address | `BondMoneyLands` |
| `broken/full/pay-signer.cfg`, `refund-to-signer.cfg`, `fund-from-signer.cfg`, `early-accept-keeps-fee.cfg` | the phase-one faults of the same names, in the full profile | `EscrowLedger`, `SignersOnlyStake`, `PaymentAddressFunds`, `PaidAsClosed` |
| `broken/full/buyer-only-timeout-offer.cfg`, `buyer-only-timeout-final.cfg`, `keep-bond-liveness.cfg` | two faults above, against the full profile's other liveness properties | `OfferEnds`, `FundedFinal`, `BondsFreed` |

`broken/*/` means the variant runs in both profiles, one config each. `TypeOK` has no broken config.

**Reach witnesses.** `reach.list` names states the model must reach, one per line. Each is an operator `W_...`
that says "this state is never reached"; `check.sh` runs it as an invariant and requires TLC to violate it. A
witness reads the model's record of the last step, so it names the step that reached the state and the stage the
deal was in before it: a decision after a posted delivery is a different witness from a decision that carried
the delivery. A safety config that passes because the model lost one of these steps loses its witness.

- **Phase one:** every closing row of `docs/audit/state-model.md`, section 9.3 (P06 to P17), by the step that
  closes it; the steps between (an escalation by the primary and by the fallback, the fallback's takeover on time
  and late); the steps phase one adds (an early accept and each outcome of a decision that carry the delivery, a
  late-work settlement with its key); the payment address's reclaim on the escrow and the close after it; and a
  close after an actor halted.
- **Full:** what phase one cuts (an appeal overturned, upheld, undecided and not filed, an offer's recorded
  expiry, the default applied in its second step, a fallback's encumbered bond), and some shared rows.

The witnesses cover steps, not every interleaving: a step the list does not name can still go missing unseen.

**What became of `broken/late-judge-by.cfg`.** It moved, and it changed meaning. T-337 wrote it as the record of
an open issue (L-6): the 2026-11-04 contract (domain 0.7) took terms whose `judgeBy` falls after the escrow's
expiry. The phase-one contract refuses such terms at funding (`HoldbackRules.sol:222-228` at `74fa299`, ADR-0031
section 6), and core refuses them for
SimChain, so no code this model describes can reach that trace. The variant is now a planted fault like the
others, one config per profile: it removes the refusal and shows that `ExpiryAfterCaptures` would catch its loss.

## Model to code: phase one

`R:` is `contracts/src/HoldbackRules.sol` and `E:` is
`contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` (the pinned commit `6b0a5ef`). Lines are at the lane's
commit `74fa299`. The mapping was read, not checked by a tool [inferred]. Later refactors on the lane change no
behaviour the model describes and move these lines: RF-2 took the turn, its deadline and its round out of `decide`
into `_turn`, and RF-3 gave each deadline one function. Read the cited lines with
`git show 74fa299:contracts/src/HoldbackRules.sol`. The lane froze on 2026-11-13 at the annotated tag
`contracts-phase-one-1`, whose `contracts/src` equals the deployment record's `commit`. These citations are not yet
pinned at the tag, and `HoldbackRules.sol` differs between the two commits
(`git diff --stat 74fa299 contracts-phase-one-1 -- contracts/src`) [measured, 2026-11-13].

| Model action | Contract function and line |
| --- | --- |
| `Offer` | `agreeAndFund` (`R:202`): the seller's signature over the commitment ID, checked at funding (`R:229`). Nothing is stored before funding |
| `AdjAccept` | `agreeAndFund`: the primary's `Acceptance` signature (`R:230`), unexpired (`R:213`), with `bondReserved` of 0 (`R:216`) |
| `Agree` | `agreeAndFund`: the buyer's `Agree` signature (`R:231`), unexpired (`R:213`) |
| `Fund` | `agreeAndFund`: stage None (`R:211`); before `offerExpiresAt` and `fundBy` (`R:212`); the deadlines strictly in order, one delivery attempt, an escalation window above 0 and an appeal window of 0 (`R:222-228`); `stage = Held` (`R:234`); `ESCROW.authorize` (`R:239`) pulls price + fee from the escrow's payer, `buyerPaymentAddress` (`R:183`), on that address's ERC-3009 signature |
| `Deliver` | `deliver` (`R:247`): stage Held (`R:250`); `_acceptDelivery` (`R:529`): before `deliverBy` (`R:536`), attempt 1 (`R:537`), the seller's signature (`R:539`); `stage = Delivered` (`R:252`) |
| `DecidePrimary` | `decide` (`R:259`): role by stage (`R:276-278`), before `judgeBy` (`R:300`), the seed reveal (`R:303`), the primary's signature (`R:315`); `_firstInstance` (`R:324`). In Held the call first lands the delivery it carries (`R:265-269`), under `_acceptDelivery`'s checks |
| `DecideFallback` | `decide`: role and deadline `fallbackBy` (`R:279-282`, `R:300`), the beacon round and the seed (`R:304-311`); `_firstInstance` |
| `FirstInstance` with `escalate` | `_firstInstance` (`R:328-333`): `stage = Escalated`, `t1` = now; no money moves |
| `FirstInstance` with accept or reject | `_firstInstance` (`R:334-338`): `stage = Released` or `Refunded`, final when written, with the reason `Decided` and the decider by the decision's role (`R:336`); `_settleDecision` |
| `DecideEscalated` | `decide`: role and deadline `t1 + appealDecideSec` (`R:283-286`, `R:300`), accept or reject only (`R:294`); `_escalationDecision` (`R:342`), which stores the reason `Decided` and the decider `Appeal` (`R:344`) |
| `Settle` | `_settleDecision` (`R:352`). Accept: one capture of the hold with the fee to the decider (`R:356`); the rest goes to the escrow's receiver, `sellerPayoutAddress` (`R:184`, `E:468-471`); the key is released (`R:359`). Reject: a fee-only capture to the decider (`R:361`), then a void (`R:362`), which pays the payer (`E:315`). A key on a reject reverts (`R:299`) |
| `EarlyAccept` | `earlyAccept` (`R:375`): stage Held or Delivered (`R:385`); the buyer's signature (`R:387`); in Held `_acceptDelivery` lands the carried delivery (`R:388`); the price captured to the payout address (`R:395`), the fee voided to the payment address (`R:396`), the key released (`R:400`) |
| `MutualSettle` | `mutualSettle` (`R:409`): the four funded stages (`R:415-417`); no key without a named delivery (`R:419-421`); both signatures (`R:426-427`); `stage = Settled` (`R:433`); `_payOut` (`R:443`): a payout names the payout address or the payment address and nothing else (`R:449`), the payouts sum to the price (`R:453`), the seller's share is a capture (`R:455`), the rest and the whole fee a void (`R:460-462`); the key (`R:436`) |
| `Reclaim` | `reclaim` (`R:473`): stage Held (`R:476`), from `deliverBy` (`R:477`); `_refundAll` |
| `TriggerFallback` | `triggerFallback` (`R:483`): stage Delivered (`R:486`), from `judgeBy` (`R:487`) |
| `TriggerDefault` | `triggerDefault` (`R:496`): from `fallbackBy` (`R:501`) or from `t1 + appealDecideSec` after an escalation (`R:503`); `_refundAll` in the same call (`R:508`) |
| the refund in `Reclaim` and `TriggerDefault` | `_refundAll` (`R:513`): `stage = Refunded` (`R:514`); the void (`R:522`) pays the payer; skipped when the escrow holds nothing after its expiry (`R:518-520`) |
| `TickExpiry` | `authorizationExpiry = fallbackBy + appealDecideSec + EXPIRY_MARGIN` (`R:177`, `R:188`). A capture reverts from it (`E:277-278`); a void does not check it (`E:304-316`) |
| `CppReclaim` | the escrow's `reclaim` (`E:323`): only the payer may call it, from `authorizationExpiry` (`E:325-326`), and it pays the payer (`E:339`). Outside the rules contract |
| `TickAbs`, `TickEsc` | `block.timestamp` against `Terms.timing` and `Deal.t1` |
| `Crash` | (environment) an actor stops |
| `Expire`, `FileAppeal`, `DecideAppeal`, `ExpireAppeal`, `TickAppeal`, `ApplyDefault` | not in phase one: `~P1` disables each, and the contract has no such function (`R:469-470` says so for the offer's expiry) |
| `OperatorEarlyAccept`, `ReleaseKeyLate` and the other `Bug` branches | none: they exist only in the broken variants |

| Model variable | Contract storage or event |
| --- | --- |
| `esc` | `Deal.stage` (`R:58-65`; `Stage`, `R:23-32`). The model's None, Offered, AcceptedByAdjudicator and Agreed are all `Stage.None` |
| `reason` | `Deal.reason` (`R:63`; `Reason`, `R:38-45`), written in the storage write that closes the deal: a decision (`R:336`, `R:344`), an early accept (`R:393`), a settlement (`R:433`), a reclaim (`R:478`) and a default (`R:508`), the last two through `_refundAll` (`R:514`) |
| `decider` | `Deal.decider` (`R:64`; `Decider`, `R:49-54`): the primary or the fallback by the decision's role (`R:336`), the appeal adjudicator after an escalation (`R:344`); `None` otherwise |
| `via` | none stored: the model's own record of how a deal closed, core's `ReleaseVia` and `RefundVia`. `reason` and `decider` carry the same fact on the contract; the events `Decided`, `JobCompleted`, `Refunded`, `Defaulted` and `MutuallySettled` report it |
| `ap`, `appellant`, `apClk`, `apBond`, `apFee`, `bond`, `enc`, `flags` | none: not in phase one, which has no appeal state and no bond (`PhaseOneCuts`) |
| `clk`, `escClk` | `block.timestamp` against `Terms.timing`; `Deal.t1` starts the escalation's window |
| `key` | the `KeyReleased` event (`R:121`, `_releaseKey` `R:558`), always to `t.buyer` |
| `wallet[PayAddr]`, `wallet[PayoutAddr]` | the token balances of `t.buyerPaymentAddress` and `t.sellerPayoutAddress`, the escrow's payer and receiver (`R:183-184`); the `SettlementAddresses` event names both (`R:127`) |
| `wallet` of a signing address that is apart | the token balances of `t.buyer` and `t.seller`, which no step of the contract moves |
| `escrow` | the escrow's `paymentState(hash).capturableAmount` for the deal's `PaymentInfo` (`_paymentInfo`, `R:171`) |
| `fees` | the deciding adjudicator's token balance (the fee capture, `R:356`, `R:361`) |
| `cppExp` | `block.timestamp >= authorizationExpiry` (`R:188`) |
| `cppRec` | the escrow's `paymentState` after the payer's `reclaim`: nothing capturable, read in `_refundAll` (`R:519-520`) |
| `moves`, `out`, `down`, `act` | none: a counter, the ledger, the crashed actor and history |

**Where the model's shape differs from the contract's.** The model takes the offer, the acceptance and the
agreement as three steps before `Fund`; the contract checks the three signatures in the one call that funds. The
model's absolute clock stops at the deadline the current state can use.

## Model to code: full profile

`S:` is `packages/core/src/state.ts` and `Sim:` is `packages/settlement/sim/simchain.ts`, at `74fa299`; both files
have changed since, so the lines are those of that commit. SimChain steps core's `step` and then posts the money.

| Model action | Core and SimChain |
| --- | --- |
| `Offer` | `offer()` (`S:216`) |
| `AdjAccept` | `step` `adjudicator_accept` → `adjudicatorAccept` (`S:262`) |
| `Agree` | `step` `agree` → `agree` (`S:293`) |
| `Fund` | `step` `fund` → `fund` (`S:312`): the authorization comes from the payment address (`S:320`); SimChain posts the hold (`Sim:803`) |
| `Deliver` | `step` `deliver` → `deliver` (`S:345`) |
| `DecidePrimary`, `DecideFallback` | `step` `decide` in Delivered or FallbackJudging → `firstInstance` (`S:438`); SimChain's `decide` pays the payout or the payment address and the fee (`Sim:841`) |
| `DecideEscalated` | `step` `decide` in Escalated → `escalationDecision` (`S:486`) |
| `EarlyAccept` | `step` `early_accept` in Delivered (`S:673`); SimChain posts the price to the payout address and the fee back to the payment address (`Sim:747`) |
| `MutualSettle` | `step` `mutual_settle` → `mutualSettle` (`S:608`), `lateDelivery` in Held (`S:596`); SimChain's `mutualSettle` (`Sim:918`) |
| `FileAppeal` | `step` `file_appeal` → `settled` (`S:561`) → `stepAppeal` (`S:518`) |
| `DecideAppeal` | `step` `decide` in Released or Refunded → `settled` → `stepAppeal`; SimChain pays an overturn from the first decider's bond to the wronged party's money address (`Sim:881`) |
| `Expire` | `step` `expire` (`S:659`, `S:715`); TimeoutKind `expire_offer`, which on a chain is the operators' clock record with no transaction (the on-chain record is not in phase one) |
| `Reclaim` | `step` `reclaim` (`S:666`); SimChain refunds the payment address (`Sim:975`) |
| `TriggerFallback` | `step` `trigger_fallback` (`S:683`) |
| `TriggerDefault`, `ApplyDefault` | `step` `trigger_default` (`S:690`, `S:697`) and `apply_default_outcome` (`S:704`); SimChain refunds the payment address and compensates the payout address from the liable bonds (`Sim:988`) |
| `ExpireAppeal` (SimChain only) | `step` `expire_appeal` → `stepAppeal` (`S:553`); SimChain returns an open appeal's bond and fee to the appellant (`Sim:1008`) |
| `TickExpiry`, the `~cppExp` guards | SimChain's `beforeCaptureExpiry` (`Sim:602`), which refuses a payment to the seller from `authorizationExpiry` as the escrow does |
| `CppReclaim` | none on SimChain, which has no escrow contract beside it. The full profile keeps the step so that the bond properties of T-337 still cover it |

Core's own `phase_one` profile keeps core's shape: a default in two steps, a delivery as its own step, funding
until `fundBy`. The EVM adapter maps the contract's single calls onto those steps. The model's phase-one profile
follows the contract.

## Run times

A dated measurement, not a standing figure [measured on 2026-11-12, one run of `formal/check.sh` with no
argument, at commit `ff1c371`]. Machine: Apple M1 Pro, 8 cores, 16 GB, macOS 26.6; TLC 2.19 from tla2tools
v1.7.4 with 8 workers, on the pinned Temurin 21 JRE. The whole run took 30 min 4 s, and all 124 configs met
expectations.

| What | Full profile | Phase-one profile |
| --- | --- | --- |
| Safety, no actor halted | 5 s and 6 s (2 configs); 169,621 distinct states each, depth 31 | 3 s to 4 s (4 configs); 64,225 distinct states each, depth 27 |
| Safety, any one actor halting | 56 s; 1,841,663 distinct states, depth 32 | 37 s; 644,257 distinct states, depth 28 |
| Liveness, one config per halted actor | 138 s to 238 s each, 1,417 s (23 min 37 s) for the 8; 326,648 to 405,290 distinct states, depth 32 | 11 s to 25 s each, 139 s (2 min 19 s) for the 8; 105,985 to 149,185 distinct states, depth 28 |

The 56 broken variants and the 44 reach witnesses took 1 s to 4 s each, 128 s together. Wall times vary between
runs with the machine's load. The run of the first pass, at `6a15d2a` on the same machine, took 32 min 48 s; its
halting-actor safety configs took 202 s (full) and 19 s (phase one), and its liveness configs 1,360 s and 241 s.
An earlier run beside another job took up to 1,773 s for one full-profile liveness config.
