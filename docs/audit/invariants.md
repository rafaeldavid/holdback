# Invariants

The phase-one contracts are checked against the stateful-fuzzing invariants of `RulesInvariants.t.sol`, the commitment state machine, and the properties of a TLA+ model in two profiles. This page lists each property in plain words, the test or model property that checks it, and the contract functions it constrains. A property that a mutant breaks must make its check fail; that is how each invariant was shown to bite (T-203) [documented: the NatSpec of `RulesInvariants.t.sol`]. SimChain keeps the full protocol, appeals and bonds included; where this page names the full profile it says so.

Labels: **measured** (read from the named file at the lane's tip, or produced by the named command), **documented** (stated in the doc cited), **inferred** (concluded from reading). Contract code is cited by function name in `HoldbackRules.sol` at `<FREEZE_COMMIT>`; test code by file and function name. None of the invariant suites or model checks ran for this page.

## The invariant suite

`contracts/test/invariant/RulesInvariants.t.sol` drives `contracts/test/handlers/RulesHandler.sol`. The campaign targets the handler's offer, funding, delivery, decisions (the primary's and the fallback's, and an escalation's), early accept, settlement, reclaim, fallback trigger and default. It also targets the buyer's own reclaim on the escrow, calls to the escrow's guarded functions from strangers, and time warps that land on, one second before or one second after each deadline. It runs seven actors (buyer, seller, three adjudicators, an operator and an unrelated address), at most `MAX_DEALS` commitments over two tokens, with fuzzed price, fee, adjudicator roles (one address may hold two) and timing: strictly ordered, or out of order in one offer in 32, which funding refuses. In one deal in four the money addresses are apart from the signing addresses. Each invariant runs 256 runs of depth 100 [measured: `setUp` and the `forge-config` lines of `RulesInvariants.t.sol`; the NatSpec of `RulesHandler`].

The handler checks each call's outcome against what the rules allow and counts violations in ghost variables. The invariants read those counters and the real balances.

| Test (exact name) | The property | What it reads | Contract functions it constrains | Model property |
| --- | --- | --- | --- | --- |
| `invariant_conservation` | No token unit is created or destroyed, and none leaves the known actors, the escrow and its token store | Total supply and every known holder's balance, per token | `agreeAndFund`, `decide`, `earlyAccept`, `mutualSettle`, `reclaim`, `triggerDefault` | `Conservation` |
| `invariant_escrowMatchesState` | CPP's token store holds exactly the sum of open holds (price + fee for each commitment in Held, Delivered, FallbackJudging or Escalated), each hold's capturable amount matches its stage, and no call that must not move held money moves it | The store's balance, `capturable` per deal, the handler's count of unexpected movements | `agreeAndFund`, `_settleDecision`, `earlyAccept`, `_payOut`, `_refundAll`; and the calls that must leave the hold alone: `deliver`, `triggerFallback` and an escalation | `EscrowMatchesState` |
| `invariant_settleOnce` | Each commitment closes (Released, Refunded or Settled) at most once and never reopens | the handler's closings per deal | `_firstInstance`, `_escalationDecision`, `earlyAccept`, `mutualSettle`, `reclaim`, `triggerDefault` (`_refundAll`) | `SettleOnce`, `FirstDecisionFinal` |
| `invariant_timeoutsExactlyWhenDue` | A timeout never succeeds before its deadline and always succeeds from it, for any caller, when the stage allows, including after the buyer reclaimed on CPP; no delivery lands at or after `deliverBy`, whichever call carries it | the handler's timeout mismatches | `reclaim`, `triggerFallback`, `triggerDefault`, `_refundAll`'s escrow-reclaim branch, `_acceptDelivery` | `AuthorizedMoves`, `AuthorizedSteps`; `FundedSettles` (liveness) |
| `invariant_noMovementWithoutAuthority` | No call signed by a wrong key succeeds, and nobody but the rules contract reaches CPP's operator functions (`capture`, `void`, `refund`) | the handler's unauthorised and stranger successes | `_requireSigned` in every signed entry point | `AuthorizedMoves` |
| `invariant_signingAddressesMoveNoMoney` | On a deal whose money addresses are apart, no call moves the signing addresses' money: the payment address funds and is refunded, the payout address is paid, and `buyer` and `seller` only sign | the signing and money addresses' balances | `_paymentInfo`, `_payOut` | `SignersHoldNothing`, `SignersOnlyStake`, `PaymentAddressFunds` |
| `invariant_keyOnlyWithPayment` | No decision releases the buyer's key on a deal that does not stand Released | the handler's count of keys without payment | `decide` (a key only with an accept), `_settleDecision` | `KeyOnlyWithPayment`, `RefundedNeverReleasedKey` |
| `invariant_deliveryHashStored` (T-336, PR #325) | A delivery-hash liveness counter: every delivery that lands stores exactly the posted hash, and a deal with no delivery stores none (known issue G-5). A mutant of `_acceptDelivery` that stores no hash fails it [measured, T-336] | the handler's delivery counter and each deal's expected hash | `_acceptDelivery`, and the posted-delivery checks in `decide`, `earlyAccept` and `mutualSettle` | none |
| `invariant_timelyDecisionsLand` | Every authorised, timely decision lands, and no other decision the handler relays does | the handler's record of each decision it relayed | `decide` | none |
| `invariant_legalDealStates` | After every step every deal matches one row of `state-model.md` section 9.3, keeps the row's time bounds, and the escrow holds the row's amounts (`StateOracle`) | the word, `deliveryHashOf`, the escrow's record, the handler's record of how each deal closed | every write to the word | `ReasonRules`, in part |
| `invariant_noAdminPath` | Deployed code never changes (no self-destruct, no upgrade), and the rules contract never holds tokens or ether | The code hashes of the rules contract, the escrow and the token; the rules contract's balances | The whole ABI; no `receive` or `fallback` | none (`NoAdmin.fuzz.t.sol` covers the ABI) |

Three invariants of the vault and the party appeal are not in phase one: T-346 removed them with the vault, and its task file says why.

What the suite does not check [inferred]:
- Party appeals and bonds: not in phase one. SimChain keeps both, and the formal model's full profile checks their bookkeeping.
- Tokens with transfer fees or callbacks: the handler uses mock ERC-3009 tokens. A phase-one deployment's token must be a plain ERC-20 with ERC-3009 ([`scope.md`](scope.md)).
- The beacon: the handler runs the local-chain test beacon from `Base.sol`, not drand. The drand verifier has its own unit and cross-check tests, and the margin's tests are `BeaconMargin.t.sol`.

## The state machine

The contract keeps one word per commitment: the stage, where the money is, and the closing reason and decider, why it closed (`struct Deal`, enums `Stage`, `Reason`, `Decider`). It collapses `docs/architecture.md`'s pre-funding states and the default into fewer calls [measured: the enums; documented: review §5]:
- `Offered`, `AcceptedByAdjudicator` and `Agreed` are signatures checked at `agreeAndFund`; nothing is stored before funding, so the stage stays `None`.
- `Defaulted` is not a stored stage: `triggerDefault` applies the default in the same call and leaves the deal `Refunded`.
- No stage records an unfunded offer's expiry: the operators record it by their own clock. A reclaim leaves the deal `Refunded` and emits `JobExpired`.

### Stage transitions

| From | To | Function | Who | Guard |
| --- | --- | --- | --- | --- |
| `None` | `Held` | `agreeAndFund` | anyone, with the seller's terms signature, the primary's acceptance, the buyer's `Agree` and the payment address's ERC-3009 authorization | before `offerExpiresAt` and `fundBy`; both messages unexpired; `bondReserved = 0`; the deployment's token; the deadlines strictly in order, one attempt, an escalation window of at least 1 s, an appeal window of 0; values core can represent |
| `Held` | `Delivered` | `deliver`, through `_acceptDelivery` | anyone, with the seller's `Delivery` | before `deliverBy`; attempt 1 |
| `Held` | `Refunded` | `reclaim` | anyone | from `deliverBy` |
| `Held` or `Delivered` | `Released`, `Refunded`, `Escalated` | `decide`, role primary (`_turn`, `_firstInstance`); in Held the call carries the delivery | anyone, with the primary's `Decision` | before `judgeBy`; the seed hashes, with the ID, to the stored tag; names the stored attempt and delivery hash |
| `Delivered` | `FallbackJudging` | `triggerFallback` | anyone | from `judgeBy` |
| `FallbackJudging` | `Released`, `Refunded`, `Escalated` | `decide`, role fallback (`_turn`, `_firstInstance`) | anyone, with the fallback's `Decision` | before `fallbackBy`; the first beacon round after `judgeBy − 1 + BEACON_MARGIN` |
| `FallbackJudging` | `Refunded` | `triggerDefault` | anyone | from `fallbackBy` |
| `Escalated` | `Released`, `Refunded` | `decide`, role appeal (`_turn`, `_escalationDecision`) | anyone, with the appeal adjudicator's `Decision` | before `t1 + appealDecideSec`; the first beacon round after `t1 + BEACON_MARGIN`; accept or reject only |
| `Escalated` | `Refunded` | `triggerDefault` | anyone | from `t1 + appealDecideSec` |
| `Held`, `Delivered` | `Released` | `earlyAccept` | anyone, with the buyer's `EarlyAccept` | the message unexpired; names the posted delivery; a key proof for the buyer's envelope |
| `Held`, `Delivered`, `FallbackJudging`, `Escalated` | `Settled` | `mutualSettle` | anyone, with `Mutual` signed by both parties | the message unexpired; the payouts name the two money addresses and sum to the price; after a delivery it names the posted one |

### Closing reason

Each closing call writes the reason and the decider in the same storage write that closes the deal; an escalation leaves both open.

| Closing call | Stage | `reason` | `decider` |
| --- | --- | --- | --- |
| The primary's or the fallback's accept or reject (`_firstInstance`) | Released or Refunded | `Decided` | `Primary` or `Fallback` |
| The appeal adjudicator's decision after an escalation (`_escalationDecision`) | Released or Refunded | `Decided` | `Appeal` |
| `earlyAccept` | Released | `AcceptedEarly` | `None` |
| `mutualSettle` | Settled | `Settled` | `None` |
| `reclaim` (`_refundAll`) | Refunded | `Reclaimed` | `None` |
| `triggerDefault` (`_refundAll`) | Refunded | `Defaulted` | `None` |

The contract refuses at funding terms whose deadlines are not strictly ordered `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, as core does (`agreeAndFund`; `packages/core/src/timing.ts`). Phase one has no appeal deadlines.

## The formal model

`formal/Holdback.tla` models the state machine of `packages/core/src/state.ts` in two profiles: the full protocol, which SimChain runs, and phase one, which the contracts run [documented: `formal/README.md`, "The two profiles"]. `formal/check.sh` runs TLC on the safety configs `phase-one/safety-*.cfg` and `full/safety-*.cfg`, the liveness configs `phase-one/live-<actor>.cfg` and `full/live-<actor>.cfg`, the reach witnesses of `formal/reach.list`, and the planted faults `broken/phase-one/<name>.cfg` and `broken/full/<name>.cfg`, each of which must fail.

| Property | Kind | Profile | In plain words | Contract counterpart |
| --- | --- | --- | --- | --- |
| `TypeOK` | invariant | both | Every variable stays in its domain | none needed (Solidity types) |
| `Conservation` | invariant | both | No posting creates or destroys a unit | `invariant_conservation` |
| `NonNegative` | invariant | both | No account goes negative | `invariant_conservation` [inferred] |
| `SettleOnce` | invariant | both | Each escrow is debited in at most one step | `invariant_settleOnce` |
| `EscrowMatchesState` | invariant | both | The escrow holds price + fee exactly while funded and undecided, and nothing otherwise; after the payment address's own reclaim it holds nothing | `invariant_escrowMatchesState` |
| `ExpiryAfterCaptures` | invariant | both | The escrow's expiry passes only once no decision is on time | `_escrowExpiry` [inferred] |
| `EscrowLedger` | invariant | both | Whatever left an escrow reached the payment address, the payout address or a fee account | `invariant_conservation`, `invariant_signingAddressesMoveNoMoney` [inferred] |
| `PaidAsClosed` | invariant | both | The money matches how the deal closed | `invariant_legalDealStates` (the escrow's amounts per row) |
| `ReasonRules` | invariant | both | The stored reason and decider keep the rules of `state-model.md` section 9.2 | `invariant_legalDealStates` |
| `ReasonMatchesMoney` | invariant | both | The stored reason matches the money that moved | `invariant_legalDealStates` [inferred] |
| `DefaultRefundsBuyer` | invariant | both | After a default the payment address has the whole hold back | `invariant_legalDealStates` [inferred] |
| `KeyOnlyWithPayment` | invariant | both | The buyer holds the key only in Released, or in Settled when the settlement released it, and always in Released | `invariant_keyOnlyWithPayment` |
| `RefundedNeverReleasedKey` | invariant | both | A Refunded deal's buyer does not hold the key | `invariant_keyOnlyWithPayment` |
| `AuthorizedMoves` | action property | both | Every debit follows from the state before the step and who signed it | `invariant_noMovementWithoutAuthority`, `invariant_timeoutsExactlyWhenDue` |
| `AuthorizedSteps` | action property | both | Every step that changes a deal's stage is justified, whether or not it moves money | `invariant_timeoutsExactlyWhenDue`, `invariant_timelyDecisionsLand` [inferred] |
| `PaymentAddressFunds` | action property | both | Whatever enters an escrow leaves the payment address in the same step | `invariant_signingAddressesMoveNoMoney` |
| `SignersOnlyStake` | action property | both | A signing address apart from its money address never pays or receives deal money | `invariant_signingAddressesMoveNoMoney` |
| `FirstDecisionFinal` | action property | both | Once an escrow is paid out, nothing about the deal changes | `invariant_settleOnce` |
| `LapsedOfferNeverFunds` | action property | both | An unfunded offer whose funding deadline has passed never funds | `agreeAndFund`; `NoOfferExpiry.t.sol` |
| `AtomicKey` | action property | both | The key moves only in a step that pays out the escrow, every step into Released carries it, and it is never taken back | `_settleDecision` emits `KeyReleased` in the capture's transaction [inferred]; no invariant counts it |
| `NoCaptureAfterExpiry` | action property | both | After the escrow's expiry, whatever leaves it goes to the payment address in full | the escrow (`E:277`) [inferred] |
| `FundedSettles` | liveness | both | Every funded commitment reaches Released, Refunded or Settled | `invariant_timeoutsExactlyWhenDue` (a due timeout always succeeds) [inferred] |
| `PhaseOneCuts` | invariant | phase one | No party appeal, no bond, no `Expired` and no `Defaulted` state | the phase-one ABI (`PhaseOneNoBonds.t.sol`) |
| `SignersHoldNothing` | invariant | phase one | A signing address apart from its money address holds nothing | `invariant_signingAddressesMoveNoMoney` |
| `BondMoneyLands`, `FundedFinal`, `OfferEnds`, `BondsFreed` | action property, liveness | full; SimChain only | The full protocol's appeal and bond money, the appeal state's close, an offer's recorded expiry, and every encumbered bond freed | none: not in phase one |

`formal/README.md` lists each planted fault with the property it must fail ("Configs") and maps each phase-one action and variable to a contract line ("Model to code: phase one"), and the full profile to SimChain ("Model to code: full profile"). Its citations are pinned at the lane's commit `74fa299` and are pinned again at the freeze. Not in phase one: the model's `Expire`, `FileAppeal`, `DecideAppeal`, `ExpireAppeal`, `TickAppeal` and `ApplyDefault` steps, which the phase-one profile disables.

### Where the model and the contract differ

An auditor comparing the phase-one profile with the contract will find these [documented: `formal/README.md`, "Not modelled"]:

| The phase-one profile | The contract |
| --- | --- |
| Treats a signature as "the named actor took the step": no message expiry, no replay | Checks EIP-712 signatures and every message's expiry |
| Has no delivery hash | Every decision, early accept and settlement after a delivery names the posted one |
| Has no `attempt`, `t1` or posted delivery hash | Stores all three in the word and `deliveryHashOf` |
| Has no beacon round or margin | Fixes each panel's round with `BEACON_MARGIN` (`BeaconMargin.t.sol`) |
| Uses fixed amounts | Takes other branches for a zero price or fee (`ZeroPrice.t.sol`) |
| Does not record the split the parties signed | Pays the signed split (`_payOut`) |
| Never lets an address coincide with an adjudicator | Allows it |
| Has no contract signer that changes its answer | Calls ERC-1271 signers in every check |
| Makes the offer, the acceptance and the agreement three steps | Checks all three in one call (`agreeAndFund`) |

The appeal fee, default compensation from bonds and bond coverage are in the full profile only; SimChain only.

## Other property tests

These are not invariants but check properties an auditor will look for [measured: the files exist; scope from their names and the review]:
- `contracts/test/fuzz/NoAdmin.fuzz.t.sol`: an ABI allowlist per contract, forbidden selectors, refusal of ether and unknown selectors, and an opcode walk for `SELFDESTRUCT` and `DELEGATECALL`.
- `contracts/test/fuzz/Postings.fuzz.t.sol`: the postings per path. Phase one has no rate arithmetic on chain (`Money` in `HoldbackTypes.sol`).
- `contracts/test/unit/Vectors.t.sol`: the EIP-712 hashes, byte for byte against `packages/core`.
- One regression file per fixed finding: `AppealAttempt.t.sol` (H-1), `AppealKey.t.sol` (H-2), `AfterCppReclaim.t.sol` (M-1, L-6), `LateCarriedDelivery.t.sol` (M-2), `DeliveryBinding.t.sol` (L-1), `SeedTag.t.sol` (L-4), `crosscheck/KnownSeedFallback.t.sol` (L-8). The tests of M-3, I-8 and L-7 left with the vault and the party appeal (T-346's appendix).
