# Invariants

The contracts are checked against ten stateful-fuzzing invariants, the commitment state machine, and the properties of a TLA+ model. This page lists each property in plain words, the test or model property that checks it, and the contract functions it constrains. A property that a mutant breaks must make its check fail; that is how each invariant was shown to bite (T-203) [documented: `RulesInvariants.t.sol:17`].

Labels: **measured** (read from the named file at `main` `1430f77`, or produced by the named command), **documented** (stated in the doc cited), **inferred** (concluded from reading). Line numbers are at `1430f77`, where `contracts/src` and `contracts/test/invariant` equal the deployed commit `64be1f1` [measured: `git diff --quiet 64be1f1 1430f77 -- contracts/src contracts/test/invariant` exits 0]. None of the suites ran for this page.

## The invariant suite

`contracts/test/invariant/RulesInvariants.t.sol` drives `contracts/test/handlers/RulesHandler.sol`. The handler sends random interleavings of 19 calls: every external function of the rules contract and the vault, every timeout, a direct CPP reclaim by the buyer, calls to CPP's and the vault's guarded functions from strangers, and time warps that land on, one second before or one second after each deadline. It runs seven actors (buyer, seller, three adjudicators, an operator and an unrelated address), at most 8 commitments over 2 tokens, with fuzzed prices, fees, roles (one address may hold two) and timing, ordered or not (D31). Each invariant runs 256 runs of depth 100 [measured: `RulesInvariants.t.sol:27-58` and the `forge-config` lines; `RulesHandler.sol:14-40`].

The handler checks each call's outcome against what the rules allow and counts violations in ghost variables. The invariants read those counters and the real balances.

| # | Test (exact name) | The property | What it reads | Contract functions it constrains | Model property |
| --- | --- | --- | --- | --- | --- |
| 1 | `invariant_conservation` | No token unit is created or destroyed, and none leaves the known actors, CPP, its token store and the vault | Total supply and every known holder's balance, per token (`:64-75`) | Every function that moves tokens: `agreeAndFund`, `decide`, `earlyAccept`, `mutualSettle`, `fileAppeal`, `reclaim`, `triggerDefault`, `expireAppeal`; `HoldbackBonds.deposit`, `withdraw`, `slash`, `takeAppealBond`, `payAppealBond` | `Conservation` |
| 2 | `invariant_escrowMatchesState` | CPP's token store holds exactly the sum of open holds (price + fee for each commitment in `Held`, `Delivered`, `FallbackJudging` or `Escalated`), each hold's capturable amount matches its stage, and no call that must not move held money moves it | The store's balance, `capturable` per deal, `unexpectedMovement` (`:81-91`) | `agreeAndFund`, `_settleDecision`, `earlyAccept`, `_payOut`, `_refundAll`; and the calls that must leave the hold alone, which the handler checks one by one: `deliver`, `fileAppeal`, `expireOffer`, `triggerFallback`, `expireAppeal` (`RulesHandler.sol:364`, `:641`, `:665`, `:703`, `:754`) | `EscrowMatchesState` |
| 3 | `invariant_settleOnce` | Each commitment closes (`Released`, `Refunded` or `Settled`) at most once and never reopens | `closings` per deal, `reopened` (`:96-101`) | `_firstInstance`, `_escalationDecision`, `earlyAccept`, `mutualSettle`, `reclaim`, `triggerDefault` (`_refundAll`) | `SettleOnce` |
| 4 | `invariant_bondsNeverNegative` | For every actor and token the bond covers what is encumbered; the vault holds every bond plus every held appeal bond; a withdrawal moves exactly what it says | `bondOf`, `encumberedOf`, the vault's balance, `withdrawMismatch` (`:107-120`) | `HoldbackBonds.withdraw`, `freeOf`, `encumber`, `release`, `slash`, `takeAppealBond`, `payAppealBond` | `NonNegative` |
| 5 | `invariant_encumberedNotDoubleCounted` | Each adjudicator's encumbrance is exactly one price per open reservation its commitments' flags record | `encumberedOf` against the handler's mirror of `F_PRIMARY` and `F_FALLBACK` (`:126-134`) | `agreeAndFund` (`:215`), `_firstInstance` (`:326-328`), `_escalationDecision`, `_appealDecision`, `expireAppeal`, `_refundAll`, `_releaseBonds` | none (the model has no bond coverage) |
| 6 | `invariant_timeoutsExactlyWhenDue` | A timeout never succeeds before its deadline and always succeeds from it, for any caller, when the stage allows, including after the buyer reclaimed on CPP; no delivery lands at or after `deliverBy`, whichever call carries it | `timeoutMismatch` (`:141-143`; raised in `RulesHandler.sol:251` and `:265`) | `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal`, `_refundAll`'s CPP-reclaim branch (`:605-608`), `_acceptDelivery` (`:623`) | `AuthorizedMoves` (the timeout clauses); `FundedSettles`, `FundedFinal`, `OfferEnds` (liveness) |
| 7 | `invariant_noMovementWithoutAuthority` | No call signed by a wrong key succeeds, and nobody but the rules contract reaches CPP's operator functions (`capture`, `void`, `refund`) or the vault's rules-only functions | `unauthorisedSuccess`, `strangerSuccess` (`:149-152`; the stranger calls at `RulesHandler.sol:802-835`) | `_requireSigned` in every signed entry point; `HoldbackBonds.onlyRules` (`:49-52`) | `AuthorizedMoves` |
| 8 | `invariant_overturnPaysFromTheBond` | An overturn pays the wronged party the price from the first decider's bond; an upheld appeal moves only the forfeited appeal bond into that bond; only the party the decision went against may appeal | `overturnMispaid` (`:159-161`; raised at `RulesHandler.sol:476`, `:637`) | `fileAppeal` (`:511`), `_appealDecision` (`:365-380`), `HoldbackBonds.slash`, `payAppealBond` | `AuthorizedMoves` (`BondDebitOK`); the model's `DecideAppeal` |
| 9 | `invariant_keyOnlyWithPayment` | No decision releases the buyer's key on a deal that does not stand `Released` | `keyWithoutPayment` (`:167-169`; raised at `RulesHandler.sol:522`) | `decide` (`:283-285`), `_settleDecision` (`:350`, `:354`), `_appealDecision` (`:379`) | `KeyOnlyWithPayment` |
| 10 | `invariant_noAdminPath` | Deployed code never changes (no self-destruct, no upgrade), and the rules contract never holds tokens or ether | The code hashes of the rules contract, the vault, CPP and the token; the rules contract's balances (`:175-185`) | The whole ABI; no `receive` or `fallback` | none (`NoAdmin.fuzz.t.sol` covers the ABI) |
| 11 | added by T-336 (name to be filled by the coordinator) | A delivery-hash liveness counter: every delivery that lands stores its hash, and every later step names it (known issue G-5) | | `_acceptDelivery` (`:628`), and the checks at `:276`, `:403`, `:439` | none |

What the suite does not check [inferred]:
- The economics of an appeal: a zero appeal bond and an unbonded appeal adjudicator pass every invariant, because the contract allows them (L-3 with L-5: open, and it blocks mainnet; [`known-issues.md`](known-issues.md) section 2).
- Tokens with transfer fees or callbacks: the handler uses CPP's mock ERC-3009 token twice (`RulesHandler.sol:6`, `:36`, `:62`), so L-2 is out of its reach.
- The beacon: the handler runs the local-chain test beacon from `Base.sol`, not drand. The drand verifier has its own unit and cross-check tests.

## The state machine

The contract keeps two parts of state per commitment (ADR-0016): the stage, where the money is, and the appeal state (`HoldbackRules.sol:24-44`). It collapses `docs/architecture.md`'s pre-funding states and the default into fewer calls [measured: the enum; documented: review §5]:
- `Offered`, `AcceptedByAdjudicator` and `Agreed` are signatures checked at `agreeAndFund`; nothing is stored before funding, so the stage stays `None`.
- `Defaulted` is not a stored stage: `triggerDefault` applies the default in the same call and leaves the deal `Refunded`.
- `Expired` is reached only from `None` (`expireOffer`). A reclaim leaves the deal `Refunded` and emits `JobExpired`.

### Stage transitions

| From | To | Function and lines | Who | Guard |
| --- | --- | --- | --- | --- |
| `None` | `Held` | `agreeAndFund` (`:193-219`) | anyone, with the seller's terms signature, the primary's acceptance and the buyer's `Agree` | before `offerExpiresAt` and `fundBy`; both messages unexpired; `bondReserved ≥ price`; the primary's free bond covers the price |
| `None` | `Expired` | `expireOffer` (`:523-530`) | anyone | from `offerExpiresAt` or `fundBy` |
| `Held` | `Delivered` | `deliver` (`:226-232`), or carried by `decide` (`:244-248`) or `earlyAccept` (`:401`) | anyone, with the seller's `Delivery` | before `deliverBy`; attempt 1 |
| `Held` | `Refunded` | `reclaim` (`:533-540`) | anyone | from `deliverBy` |
| `Delivered` | `Released`, `Refunded`, `Escalated` | `decide`, role primary (`:255-257`, `_firstInstance`) | anyone, with the primary's `Decision` | before `judgeBy`; the seed's hash matches the stored tag; names the stored attempt and delivery hash |
| `Delivered` | `FallbackJudging` | `triggerFallback` (`:543-551`) | anyone | from `judgeBy` |
| `FallbackJudging` | `Released`, `Refunded`, `Escalated` | `decide`, role fallback (`:258-261`, `_firstInstance`) | anyone, with the fallback's `Decision` | before `fallbackBy`; the beacon round at `judgeBy`; the fallback's free bond covers the price (`:327`) |
| `FallbackJudging` | `Refunded` | `triggerDefault` (`:556-569`) | anyone | from `fallbackBy` |
| `Escalated` | `Released`, `Refunded` | `decide`, role appeal (`:262-265`, `_escalationDecision`) | anyone, with the appeal adjudicator's `Decision` | before `t1 + appealDecideSec`; the first beacon round after the escalation; accept or reject only |
| `Escalated` | `Refunded` | `triggerDefault` | anyone | from `t1 + appealDecideSec` |
| `Held`, `Delivered` | `Released` | `earlyAccept` (`:388-418`) | anyone, with the buyer's `EarlyAccept` | the message unexpired; names the posted delivery; a key proof for the buyer's envelope |
| `Held`, `Delivered`, `FallbackJudging`, `Escalated` | `Settled` | `mutualSettle` (`:425-457`) | anyone, with `Mutual` signed by both parties | the message unexpired; the payouts sum to the price; after a delivery it names the posted one |

### Appeal state transitions

| From | To | Function and lines | Guard |
| --- | --- | --- | --- |
| (a first-instance accept or reject) | `None` | `_firstInstance` (`:330`) | |
| `None` | `Open` | `fileAppeal` (`:503-518`) | stage `Released` or `Refunded`; before `t1 + appealWindowSec`; only the party the decision went against; its signature; any bond, 0 included |
| `None` | `Expired` | `expireAppeal` (`:573-592`) | from `t1 + appealWindowSec` |
| `Open` | `Upheld`, `Overturned` | `decide`, role appeal (`:266-269`, `_appealDecision`) | before `t1 + appealWindowSec + appealDecideSec`; the first beacon round after the filing |
| `Open` | `Expired` | `expireAppeal` | from `t1 + appealWindowSec + appealDecideSec`; the appeal bond goes back |
| (escalation decision, early accept, mutual settlement, reclaim, default) | `Closed` | `_escalationDecision` (`:340`), `earlyAccept` (`:408`), `mutualSettle` (`:451`), `_refundAll` (`:599`) | nothing to appeal |

The architecture's timing order (`offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy < appealBy < appealDecideBy`) is a rule of the reference path (`timing.ts`), not of the contract: under D31 the contract takes any order it can represent [documented: `docs/architecture.md`, Timing rules; review L-6, L-8].

## The formal model

`formal/Holdback.tla` models the state machine of `packages/core/src/state.ts` in `guaranteed_on_decision` mode with two commitments, seven named actors and "anyone" [documented: `formal/README.md`]. `formal/check.sh` runs TLC on `safety.cfg`, one `live-<actor>.cfg` per actor that may halt, and six `broken/` configs that must fail.

| Property | Kind | In plain words | Config | Contract counterpart |
| --- | --- | --- | --- | --- |
| `TypeOK` | invariant | Every variable stays in its domain | all | none needed (Solidity types) |
| `Conservation` | invariant | No posting creates or destroys a unit | all; `broken/mint.cfg` must fail it | `invariant_conservation` |
| `NonNegative` | invariant | No account, bond or escrow goes negative | `safety.cfg` | `invariant_bondsNeverNegative` |
| `SettleOnce` | invariant | Each escrow is debited in at most one step | all; `broken/second-capture.cfg` must fail it | `invariant_settleOnce` |
| `EscrowMatchesState` | invariant | The escrow holds price + fee while funded and undecided, and nothing otherwise | `safety.cfg` | `invariant_escrowMatchesState` |
| `KeyOnlyWithPayment` | invariant | The buyer holds the key only in `Released`, or in `Settled` when the settlement released it, and always in `Released` | `safety.cfg` | `invariant_keyOnlyWithPayment` |
| `AuthorizedMoves` | action property | Every debit follows from the state before the step and who signed it: the decider whose turn it is, on time, with a beacon for fallback and appeal; the buyer's early accept; both parties' settlement; a due timeout; or the default. Fee accounts are never debited | `safety.cfg`; `broken/operator-authors.cfg`, `broken/early-reclaim.cfg` must fail it | `invariant_noMovementWithoutAuthority`, `invariant_timeoutsExactlyWhenDue`, `invariant_overturnPaysFromTheBond` |
| `AtomicKey` | action property | The key moves only in a step that pays out the escrow; every step into `Released` carries it; it is never taken back | `safety.cfg`; `broken/key-separate.cfg` must fail it | `_settleDecision` emits `KeyReleased` in the capture's transaction (`:351-354`) [inferred]; no invariant counts it |
| `FundedSettles` | liveness | Every funded commitment reaches `Released`, `Refunded` or `Settled` | `live-*.cfg`; `broken/buyer-only-timeout.cfg` must fail it | `invariant_timeoutsExactlyWhenDue` (a due timeout always succeeds) [inferred] |
| `FundedFinal` | liveness | And its appeal state closes | `live-*.cfg` | same |
| `OfferEnds` | liveness | Every offer expires or is paid out | `live-*.cfg` | `expireOffer`; same |

Model action to contract function, from review §5 [documented]: `Offer`, `AdjAccept`, `Agree` and `Fund` are `agreeAndFund`; `Deliver` is `deliver` or a carried delivery; the four `Decide*` actions are `decide`, by stage; `EarlyAccept` is `earlyAccept`; `MutualSettle` is `mutualSettle`; `FileAppeal` is `fileAppeal`; `Expire` is `expireOffer`; `Reclaim` is `reclaim`; `TriggerFallback` is `triggerFallback`; `TriggerDefault` and `ApplyDefault` are one call, `triggerDefault`; `ExpireAppeal` is `expireAppeal`; the clock ticks are `block.timestamp`. `formal/README.md` still lists this column as TBD (I-11).

### Where the model and the contract differ

An auditor comparing the two will find these [measured: `Holdback.tla` and `HoldbackRules.sol`; documented: review §5]. Known issue G-3 tracks the model's gaps.

| The model | The contract |
| --- | --- |
| Collects an appeal fee (`apFee`) and pays it to the appeal adjudicator | Collects no appeal fee (I-8 rest) |
| `ApplyDefault` compensates the seller from the liable adjudicators' bonds | `triggerDefault` refunds the buyer in full and pays nobody from a bond (`:553-569`) |
| Has no CPP reclaim by the buyer | `_refundAll` handles one (`:605-608`; M-1) |
| Has no bond coverage; the initial bond covers every worst case | The fallback encumbers its bond by deciding, or cannot decide (M-3); the appeal adjudicator posts none (L-5) |
| `EarlyAccept` only in `Delivered` | `earlyAccept` also in `Held`, carrying the delivery (`:398`, `:401`) |
| Treats a signature as "the named actor took the step"; no message expiry, no seeds beyond "the beacon is up" | Checks EIP-712 signatures, message expiry, the seed commitment and the beacon proof |

## Other property tests

These are not invariants but check properties an auditor will look for [measured: the files exist; scope from their names and the review]:
- `contracts/test/fuzz/NoAdmin.fuzz.t.sol`: an ABI allowlist per contract, forbidden selectors, refusal of ether and unknown selectors, and an opcode walk for `SELFDESTRUCT` and `DELEGATECALL`.
- `contracts/test/fuzz/Postings.fuzz.t.sol` and `Rounding.fuzz.t.sol`: the postings per path and the `Money` rounding rules (ADR-0022).
- `contracts/test/unit/Vectors.t.sol`: the EIP-712 hashes, byte for byte against `packages/core`.
- One regression file per fixed finding: `AppealAttempt.t.sol` (H-1), `AppealKey.t.sol` (H-2), `AfterCppReclaim.t.sol` (M-1), `LateCarriedDelivery.t.sol` (M-2), `BondConsent.t.sol` (M-3), `DeliveryBinding.t.sol` (L-1), `OverturnPayout.t.sol` and `crosscheck/AppealSlot.t.sol` (I-8, L-7).
