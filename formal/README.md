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

Not modelled: the Phase 4 economics (coverage gate, backers, size of the default compensation),
`settle_after_window` and the `settle` timeout, signature cryptography (a signature is "the named actor
took the step"), message expiry, scopes and mandates, rulebook checks, multi-attempt delivery
(`maxSubmissions` is 1 in Phase 1), and D27/D28 appeal clauses beyond the default rules in `state.ts`.

## Properties

| Property | Kind | Meaning |
| --- | --- | --- |
| `TypeOK` | invariant | Variables stay in their domains. |
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
| `safety.cfg` | none | every invariant and both action properties |
| `live-<actor>.cfg` | buyer, seller, primary, fallback, appeal, operator, beacon (one each) | the three liveness properties, plus `TypeOK`, `Conservation` and `SettleOnce` |
| `broken/mint.cfg` | none | the default outcome pays compensation without debiting bonds: `Conservation` must fail |
| `broken/second-capture.cfg` | none | the primary may decide again after the escrow has settled: `SettleOnce` must fail |
| `broken/operator-authors.cfg` | none | the operator submits an early accept the buyer never signed: `AuthorizedMoves` must fail |
| `broken/early-reclaim.cfg` | none | reclaim fires at fundBy instead of deliverBy: `AuthorizedMoves` must fail |
| `broken/key-separate.cfg` | none | an accept pays the seller and the key follows in a later step: `AtomicKey` must fail |
| `broken/buyer-only-timeout.cfg` | buyer | timeouts are callable by the buyer only: `FundedSettles` must fail |

Each broken config has an `\* expect:` line. `check.sh` requires that TLC fails on that config and that
its output matches the line.

## Model action to `state.ts` transition to contract function

The contract column is filled in once T-202 lands (see the task's Handoff).

| Model action | `state.ts` | Contract function (T-202) |
| --- | --- | --- |
| `Offer` | `offer()` | TBD |
| `AdjAccept` | `step` `adjudicator_accept` → `adjudicatorAccept` | TBD |
| `Agree` | `step` `agree` → `agree` | TBD |
| `Fund` | `step` `fund` → `fund` | TBD |
| `Deliver` | `step` `deliver` → `deliver` | TBD |
| `EarlyAccept` | `step` `early_accept` in Delivered | TBD |
| `DecidePrimary` | `step` `decide` in Delivered → `firstInstance` (role primary) | TBD |
| `DecideFallback` | `step` `decide` in FallbackJudging → `firstInstance` (role fallback) + `beaconSeed` | TBD |
| `DecideEscalated` | `step` `decide` in Escalated → `escalationDecision` | TBD |
| `MutualSettle` | `step` `mutual_settle` → `mutualSettle` | TBD |
| `FileAppeal` | `step` `file_appeal` → `settled` → `stepAppeal` | TBD |
| `DecideAppeal` | `step` `decide` in Released/Refunded → `settled` → `stepAppeal` + `beaconSeed` | TBD |
| `Expire` | `step` `expire` (Offered, AcceptedByAdjudicator, Agreed); TimeoutKind `expire_offer` | TBD |
| `Reclaim` | `step` `reclaim`; TimeoutKind `reclaim` | TBD |
| `TriggerFallback` | `step` `trigger_fallback`; TimeoutKind `fallback` | TBD |
| `TriggerDefault` | `step` `trigger_default`; TimeoutKind `default` | TBD |
| `ApplyDefault` | `step` `apply_default_outcome`; TimeoutKind `apply_default` | TBD |
| `ExpireAppeal` | `step` `expire_appeal` → `stepAppeal`; TimeoutKind `appeal_expiry` | TBD |
| `TickAbs`, `TickEsc`, `TickAppeal` | the event time `at` passing a deadline | block timestamp |
| `Crash` | (environment) an actor stops | n/a |
| `OperatorEarlyAccept`, `ReleaseKeyLate` | none: they exist only in the broken variants | must not exist |
