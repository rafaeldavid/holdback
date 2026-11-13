# Contract state model

## Summary

This page lists every state a deal can be in on chain under the phase-one contracts: the rules contract and the Commerce Payments escrow, at the frozen commit (the tag `contracts-phase-one-1`; [`scope.md`](scope.md)). Phase one has no party appeals and no bonds (D57). SimChain keeps the full protocol, appeals and bonds included; this page does not describe it. The model of the contracts the live demo settled on until 2026-11-13 (EIP-712 domain 0.7, with party appeals and the bond vault) is `main`'s version of this page at commit `e29d387`; this page calls it the 0.7 model. This page changes no code.

- **Each legal word is one row of section 9.3** (P01 to P17), and each row names the function that writes it [measured: read in `HoldbackRules.sol`].
- **Every other combination is illegal** (section 4), each with the code that makes it unreachable [inferred from reading every write to the word]. `invariant_legalDealStates` checks every deal against section 9.3's rows after every step of the fuzzing campaign [documented: its NatSpec in `contracts/test/invariant/RulesInvariants.t.sol`]. One state is reachable that the word does not show: a funded deal whose escrow the buyer's payment address has already emptied (section 5.2).
- **On 2026-11-11 an independent red-team check of the 0.7 model found no break.** The phase-one rows have had no such read of this page. `contracts/test/attack/PhaseOneRedTeam.t.sol` (T-346) tests three of its questions in code: whether a funded deal can get stuck, whether funds or the key can move outside the terms, and whether a state outside section 9.3 is reachable.
- **Three findings,** all Low or Info (section 11): F-1 is closed, F-2 is a stated limit and F-3 is a record. None moves money outside the signed terms.
- **What phase one is.** One token per deployment, fixed at deploy (`TOKEN`). The buyer's payment address funds the hold with one ERC-3009 signature. The seller delivers once. The primary decides, or the fallback when the primary is late; either may escalate to the appeal adjudicator. The buyer may accept early, both parties may settle, and anyone may trigger a timeout. The first decision is final. A settlement pays the seller's payout address and the buyer's payment address only. Nothing on chain records an unfunded offer's expiry. Appendix A lists what is not in phase one.

**Which table to use.** Section 9.3 holds the rows; section 9.4 holds what the escrow holds per row. A test oracle uses those two: `contracts/test/invariant/StateOracle.sol` is that oracle. The section numbers stay as they are because the contract's NatSpec, the state oracle, the formal model and the tests cite them.

Labels: **measured** (read in the named function or file), **documented** (stated in the doc cited), **inferred** (concluded from reading, not checked by a run), **guessed**.

Citations: contract code is cited by the name of its function, error, event or constant in [`HoldbackRules.sol`](../../contracts/src/HoldbackRules.sol) and [`HoldbackTypes.sol`](../../contracts/src/HoldbackTypes.sol) (the library is imported as `H`) at the frozen commit (the tag `contracts-phase-one-1`; [`scope.md`](scope.md)). `E:` is a line of `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` at the pinned commit `6b0a5ef`. The scope cuts (SC-1 to SC-8) and implicit-state items (IS-1 to IS-14) are the contract refinement plan's labels; the maintainers keep the plan privately ([`docs/private-materials.md`](../private-materials.md)), and this page restates each label where it uses it.

## 1. What is stored

A deal is one commitment. Its ID is the EIP-712 struct hash of the signed terms (`H.commitmentId`). The terms name the buyer's payment address and the seller's payout address apart from the two signing addresses (ADR-0033).

| Where | What | Code |
| --- | --- | --- |
| Rules contract | **The word:** `stage`, `attempt`, `t1`, `seedTag`, `reason`, `decider`, one storage slot per deal (1 + 1 + 5 + 18 + 1 + 1 bytes) | `struct Deal`, `_deals` |
| Rules contract | **`deliveryHashOf[id]`:** the hash of the delivery posted on chain, or zero | `deliveryHashOf` |
| Escrow | `paymentState[hash]`: `hasCollectedPayment`, `capturableAmount`, `refundableAmount`, one per deal. The hash covers a `PaymentInfo` the rules contract derives from the terms alone: payer the buyer's payment address, receiver the seller's payout address, token `TOKEN`, salt the deal's ID | `E:55-62`; `_paymentInfo` |

Symbols used below:

| Symbol | Meaning |
| --- | --- |
| `P`, `F`, `H` | `t.price`, `t.fee`, and the hold `P + F` (`_paymentInfo`) |
| `D` | `t.timing.appealDecideSec`, the escalation's decision window. The terms' `appealWindowSec` must be 0 (`agreeAndFund`) |
| `now` | `block.timestamp` |
| `dh` | `deliveryHashOf[id]` |
| `reason`, `decider` | why the deal closed and whose decision closed it (enums `Reason` and `Decider`; section 9.2) |

## 2. The legal rows

**The invariant:** for every commitment ID, the word and `dh` together match exactly one row of section 9.3. `seedTag` is zero in P01. In every other row it is the low 144 bits of keccak256(the primary's seed commitment ‖ the commitment ID) (`H.seedTag`), written at funding (`agreeAndFund`), and no later write changes it.

`t1 > 0` means a block time was written. Every row assumes block time is above zero and below 2^40 seconds (the year 36812), the width of `t1`. The contract refuses, with `Unrepresentable()`, terms whose `fallbackBy` is after 9999-12-31T23:59:59-23:59 (`LAST_TIMESTAMP`, 253,402,387,139 s) or whose escalation window is above 2^32 − 1 s. So every `t1` that a decision or an escalation writes fits 40 bits. Only `triggerFallback`'s `t1` has no upper bound in time, and it wraps from 2^40 s [documented: the comment in `agreeAndFund`].

## 3. Entry points and transitions

Every entry point of the rules contract is permissionless: the contract never reads `msg.sender`, and it checks a signature for every step that is not a timeout [measured: no `msg.sender` in `HoldbackRules.sol`]. "Signs" names the key whose signature the call must carry. The error each guard raises is in brackets.

**The common guards of `decide`,** which every decision passes:

- the message has not expired (`MessageExpired`);
- the stage gives a turn, which only Delivered, FallbackJudging and Escalated do (`_turn`, `WrongStage`);
- the message names the turn's role, the stored attempt, the posted delivery and an outcome the role may give (`InvalidMessage`);
- it carries a key only with an accept (`InvalidMessage`);
- `now` is before the turn's deadline (`DeadlinePassed`);
- the seed is valid for the role (`BadSeed`);
- the adjudicator whose turn it is signed it (`BadSignature`).

| Entry point | From | To | Guards | Signs |
| --- | --- | --- | --- | --- |
| `agreeAndFund` | P01 | P02 | stage None (`WrongStage`); `now < offerExpiresAt` and `now < fundBy` (`DeadlinePassed`); both message expiries (`MessageExpired`); `bondReserved = 0` and the terms' token is `TOKEN` (`InvalidMessage`); the deadlines strictly in order `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, `maxSubmissions = 1`, `D ≥ 1` and `appealWindowSec = 0` (`InvalidMessage`); `fallbackBy ≤ LAST_TIMESTAMP` and `D ≤ 2^32 − 1` (`Unrepresentable`); then the three signatures; then, in `_paymentInfo`, `H ≤ 2^120 − 1` and the escrow's expiry `≤ 2^48 − 1` (`Unrepresentable`). In the escrow: `H > 0` (`E:179`); `fundBy ≤` the escrow's expiry (`E:494`), which the order makes true; the token store receives exactly `H` (`E:424`) | the seller (the commitment ID), the primary (the acceptance, `H.acceptanceHash`), the buyer (the Agree, `H.agreeHash`), the buyer's payment address (the ERC-3009 authorization, checked by the collector `ERC3009_COLLECTOR` and the token) |
| `deliver` | P02 | P03 | stage Held (`WrongStage`); in `_acceptDelivery`: `now < deliverBy` (`DeadlinePassed`), attempt 1 (`InvalidMessage`) | the seller (`_acceptDelivery`) |
| `decide`, primary | P02 carrying a delivery (under `_acceptDelivery`'s guards), or P03 | accept: P06. reject: P07. escalate: P05 | the common guards, with deadline `judgeBy`; the revealed seed hashes, with the ID, to the stored `seedTag` (`BadSeed`); no appeal ground (`_firstInstance`, `InvalidMessage`); a key on an accept (`_settleDecision`, `InvalidMessage`) | the primary |
| `decide`, fallback | P04 | accept: P08. reject: P09. escalate: P05 | the common guards, with deadline `fallbackBy`; the round is `_fallbackRound`, the first published after `judgeBy − 1 + BEACON_MARGIN`, its value is proven by `BEACON` and the seed is `H.panelSeed` of it (`BadSeed`); no appeal ground; a key on an accept | the fallback |
| `decide`, escalation | P05 | accept: P10. reject: P11 | the common guards, with deadline `t1 + D` (`_escalationDecideBy`); accept or reject only; the round is `_escalationRound`, the first published after `t1 + BEACON_MARGIN`; a key on an accept. The appeal ground is not checked (`_escalationDecision`) | the appeal adjudicator |
| `earlyAccept` | P02 carrying a delivery (under `_acceptDelivery`'s guards), or P03 | P13 | stage Held or Delivered (`WrongStage`); message expiry (`MessageExpired`); the message names the carried and posted delivery and its attempt (`InvalidMessage`); the buyer's envelope is in the delivery's key list (`_requireKeyProof`, `BadKeyProof`). No deadline of its own | the buyer; the seller's delivery signature when carried |
| `mutualSettle` | P02, P03, P04, P05 | P15 (from P02), P16 (from P03), P17 (from P04 or P05) | stage (`WrongStage`); message expiry (`MessageExpired`); without a delivery only in Held, with no key and no named hash (`InvalidMessage`); outside Held it names the posted delivery (`InvalidMessage`); with a key, the carried delivery hashes to the named one and holds the buyer's envelope (`BadKeyProof`); in `_payOut`, each payout is above zero and names the seller's payout address or the buyer's payment address, and the payouts sum to `P` (`InvalidMessage`). No deadline of its own | the buyer and the seller |
| `reclaim` | P02 | P14 | stage Held (`WrongStage`); `now ≥ deliverBy` (`TooEarly`) | nobody |
| `triggerFallback` | P03 | P04 | stage Delivered (`WrongStage`); `now ≥ judgeBy` (`TooEarly`) | nobody |
| `triggerDefault` | P04, P05 | P12 | from P04: `now ≥ fallbackBy`; from P05: `now ≥ t1 + D` (`TooEarly`); any other stage (`WrongStage`) | nobody |

The refusals of terms run before any signature is checked [measured: `agreeAndFund`; `StrictTerms.t.sol`, `test_refusedBeforeSignatures`].

**No entry point records an unfunded offer's expiry.** From `offerExpiresAt` (or `fundBy`) `agreeAndFund` refuses the terms, and nothing is stored. The operators record `Expired` by their own clock, with no transaction (ADR-0031 §7) [measured: the comment above `reclaim`; `contracts/test/unit/NoOfferExpiry.t.sol`].

One call outside the rules contract changes what a deal holds without changing its word:

| Call | Effect | Line |
| --- | --- | --- |
| The buyer's payment address calls `reclaim` on the escrow, from the escrow's expiry | Empties a hold that is still in P02 to P05 (section 5.2) | `E:323-340` |

**Terminal rows:** P06 to P17. No entry point accepts them: each checks the stage first, and `decide` finds no turn in Released, Refunded or Settled (`_turn`) [measured; `PhaseOneNoBonds.t.sol`, `test_decisionOnAReleasedDeal_revertsWrongStage` and `test_decisionOnARefundedDeal_revertsWrongStage`].

**Every funded, non-terminal row has an exit anyone can take once its deadline passes:** P02 by `reclaim`, P03 by `triggerFallback`, P04 and P05 by `triggerDefault`. One limit applies:

- **Two exits push tokens.** `reclaim` and `triggerDefault` return the hold to the buyer's payment address, unless that address already took it from the escrow (`_refundAll`). Section 5.3 states what this rests on. `triggerFallback` moves nothing.

## 4. Illegal combinations

Each class is a set of combinations the storage can hold and no entry point writes. "Why unreachable" names the code that makes it so [inferred from reading every write to `_deals` and `deliveryHashOf`: `agreeAndFund`, `deliver`, `decide` (in Held), `_firstInstance`, `_escalationDecision`, `earlyAccept`, `mutualSettle`, `triggerFallback`, `_refundAll` and `_acceptDelivery`]. The class IDs are those of the 0.7 model. Its classes I05 to I12 and I15, which covered the flags, the appeal state and the bonds, are not in phase one.

| Class | Combination | Why unreachable | If it were reached |
| --- | --- | --- | --- |
| I01 | stage None with any other field or `dh` nonzero | Every other write follows a check that the stage is not None, or sets the stage in the same call (`agreeAndFund`) | A second funding of one ID |
| I02 | `attempt ≥ 2` | `_acceptDelivery` refuses any attempt but 1; its callers `deliver`, `decide` (in Held) and `earlyAccept` (in Held) copy that value | A decision could name an attempt nobody delivered |
| I03 | `attempt = 1` in Held, or `attempt = 0` in Delivered, FallbackJudging or Escalated | The delivery and the move out of Held are one call (`deliver`, `decide`, `earlyAccept`); a revert undoes both | A reclaim over a posted delivery, or a decision with no delivery |
| I04 | `dh = 0` with `attempt = 1`, or `dh ≠ 0` with `attempt = 0` | `_acceptDelivery` writes `dh` in the call that sets `attempt`, and nothing clears either. Assumes no delivery hashes to zero | A decision could not name the delivery, or a hash with no delivery |
| I13 | `t1 = 0` in FallbackJudging, in Escalated, or after a decision; `t1 ≠ 0` in Held or Delivered | `triggerFallback` and `_firstInstance` write block time; nothing writes `t1` before them, and `_escalationDecision` keeps the escalation's `t1` | Escalation and fallback deadlines would be measured from zero and be over at once |
| I14 | Released with `reason = accepted_early` and `t1 ≠ 0`; Refunded with `reason = reclaimed` and `attempt = 1`; Refunded with `reason = defaulted` and `t1 = 0`; Settled with `attempt = 0` and `t1 ≠ 0` | `earlyAccept` runs only from Held or Delivered, where `t1` is 0. `reclaim` runs only from Held. `triggerDefault` runs only from FallbackJudging or Escalated, where `t1` is set. `t1` is first written at `triggerFallback` or an escalation, both after a delivery; a settlement from Held finds `t1` at zero | A release with no delivery, or a fallback turn with none |
| I16 | The escrow's `capturableAmount` is neither `H` nor 0; it is `H` in a terminal row; it is 0 in P02 to P05 before the escrow's expiry | The rules contract is the escrow's only operator (`_paymentInfo` sets `operator: address(this)`; `E:241`, `E:270`, `E:304`). It authorizes `H` once (`agreeAndFund`), and every settlement path leaves `capturableAmount` at 0 in the call that leaves the funded rows (section 9.4). The payment address's own reclaim needs the expiry (`E:325`). A call nested inside the funding call cannot void or capture: the escrow's reentry guard refuses it (`E:269`, `E:304`) | Money left in the escrow after a deal closed, or a hold gone before its deadline |
| I17 | `reason` other than `open` in None, Held, Delivered, FallbackJudging or Escalated; `reason = open` in Released, Refunded or Settled; `decider ≠ none` without `reason = decided`, or `none` with it; a reason that gives another stage than the stored one | The only writers set the reason in the storage write that closes the deal (`_firstInstance`, `_escalationDecision`, `earlyAccept`, `mutualSettle`, `_refundAll`); an escalation leaves it open | A reader reports the wrong cause or the wrong fee recipient |

No class is reachable [inferred]. One reachable state has no row of its own, because the word does not record it: section 5.2.

## 5. What the escrow holds

### 5.1 Per row

Section 9.4 gives the escrow's `capturableAmount` and `refundableAmount` per row, and the tokens that have left. `refundableAmount` is the escrow's own count of what it paid out; the rules contract never calls the escrow's `refund`.

Zero amounts follow the same formulas: a void of zero and a capture of zero are skipped (`_settleDecision`, `earlyAccept`, `_payOut`). `H = 0` cannot fund (`E:179`), and core's phase-one profile refuses such terms before anyone signs (`ZERO_HOLD_PROBLEM` in `packages/core/src/state.ts`). Section 12 takes a deal with price 0 through every outcome.

The closing reason tells every terminal row apart: an escalation's reject is `decided` with decider `appeal` (P11), and a default is `defaulted` (P12).

### 5.2 The one state the word does not show: a funded deal with an empty escrow

From the escrow's expiry (`fallbackBy + D + EXPIRY_MARGIN`, `_escrowExpiry`), the buyer's payment address can call the escrow's `reclaim` and take `H` back directly (`E:323-340`). The deal's word stays in P02, P03, P04 or P05. This is the plan's IS-6.

In that state [measured at the cited lines]:

- every capture reverts, because the expiry has passed (`E:277`) and nothing is left (`E:284`); every void reverts (`E:308`). So no decision, early accept or settlement can close the deal: each makes at least one of those calls;
- `deliver`, `triggerFallback` and an `escalate` decision still succeed, because they do not call the escrow;
- the timeouts close the deal: `_refundAll` reads the escrow and skips the void when nothing is held. `reclaim` closes P02; `triggerFallback` moves P03 to P04; `triggerDefault` closes P04 and P05.

The contract refuses terms whose deadlines are not strictly in order (`agreeAndFund`), so every timeout is already due at the escrow's expiry and anyone can close the deal at once.

### 5.3 The aggregate invariant

The escrow's token store for the rules contract holds at least the sum of `capturableAmount` over all deals. The escrow checks the exact amount on the way in (`E:424`). A deployment serves one token, so the sum is in that token.

This holds between transactions [inferred; `invariant_escrowMatchesState` checks it]. Inside one transaction it has one gap: the escrow records the hold before it collects the tokens (`E:250-255`). A call nested in that gap sees the invariant broken; the red-team check of the 0.7 model found no use for it.

The exits in section 3 that move tokens rest on the token letting the transfer through. If a transfer to the buyer's payment address reverts, `reclaim` and `triggerDefault` revert and the deal stays open; nothing else is held. Token-issuer risk is out of scope ([`scope.md`](scope.md)); [`threat-model.md`](threat-model.md) states it as an assumption.

## 6. Deadlines

### 6.1 Named expressions

| Name | Expression | Read at |
| --- | --- | --- |
| `offerExpiry` | `t.timing.offerExpiresAt` | `agreeAndFund` |
| `fundBy` | `t.timing.fundBy`; also the escrow's `preApprovalExpiry` | `agreeAndFund`, `_paymentInfo` |
| `deliverBy` | `t.timing.deliverBy` | `_acceptDelivery`, `reclaim` |
| `judgeBy` | `t.timing.judgeBy` | `_turn` (the primary's deadline), `triggerFallback` |
| `fallbackBy` | `t.timing.fallbackBy` | `_turn` (the fallback's deadline), `triggerDefault` from P04 |
| `escalationDecideBy` | `d.t1 + D`, in P05 | `_escalationDecideBy`, read by `_turn` and `triggerDefault` from P05 |
| `escrowExpiry` | `fallbackBy + D + EXPIRY_MARGIN`; the escrow's `authorizationExpiry` and `refundExpiry`. `EXPIRY_MARGIN` is set at deploy; the freeze record in [`scope.md`](scope.md) states it | `_escrowExpiry`, `_paymentInfo` |
| Message expiries | `acc.expiresAt`, `ag.expiresAt`, and `m.expiresAt` of a decision, an early accept and a settlement. A message is good while `now < expiresAt` | `agreeAndFund`, `decide`, `earlyAccept`, `mutualSettle` |
| `BEACON_MARGIN` | Set at deploy: 29 s on Ethereum mainnet and Sepolia; 0 only on the local chain, which the constructor checks (`NoBeaconMargin`) | the constructor; `_roundAfter` |
| `fallbackRound` | `BEACON.roundAt(judgeBy − 1 + BEACON_MARGIN) + 1`: the first round published after the last second a primary's decision can land, plus the margin | `_fallbackRound`; emitted by `triggerFallback` in `FallbackTriggered` |
| `escalationRound` | `BEACON.roundAt(d.t1 + BEACON_MARGIN) + 1` | `_escalationRound` |

All sums are in 256 bits over 64-bit and 40-bit terms, so none overflows [measured: `_escalationDecideBy`, `_escrowExpiry`, `_roundAfter`]. `judgeBy` is at least 3 for a funded deal, because the deadlines are strictly in order, so `judgeBy − 1` cannot underflow (`_fallbackRound`).

### 6.2 Opposing pairs

Each step that needs a deadline to be open is paired with the timeout that needs it to have passed. Every pair splits time at one instant: the step needs `now < X` and the timeout needs `now ≥ X` [measured].

| Deadline | Step, needs `now <` | Timeout, needs `now ≥` |
| --- | --- | --- |
| `deliverBy` | a delivery by any path (`_acceptDelivery`) | `reclaim` |
| `judgeBy` | the primary's decision (`decide`, through `_turn`) | `triggerFallback` |
| `fallbackBy` | the fallback's decision | `triggerDefault` from P04 |
| `escalationDecideBy` | the escalation decision | `triggerDefault` from P05 |

The funding deadlines have no opposing timeout. `agreeAndFund` refuses from either, and nothing is stored.

Three steps have no deadline of their own and can race a timeout: `earlyAccept` in P03 after `judgeBy`, `mutualSettle` in any funded row, and `triggerFallback` when it comes late. The first one applied wins, because each leaves the row the other needs. A capture reverts from `escrowExpiry` (`E:277`), so from then on no path pays the seller's payout address out of the hold.

### 6.3 What the contract refuses, and two stated limits

The contract refuses, at funding, terms that settlement cannot process (`agreeAndFund`, `InvalidMessage`):

- deadlines not strictly in the order `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, compared as core compares them (`packages/core/src/timing.ts`);
- `maxSubmissions` other than 1;
- an `appealDecideSec` of 0;
- an `appealWindowSec` other than 0 (ADR-0033 §2b).

It also refuses with `Unrepresentable()` what core cannot represent, as core does: a `fallbackBy` after 9999-12-31T23:59:59-23:59, so every deadline after it; an escalation window above 2^32 − 1 s; and a hold above 2^120 − 1 base units [measured: `agreeAndFund`, `_paymentInfo`; `contracts/test/unit/Unrepresentable.t.sol`; core's `MAX_HOLD` and its parser]. It does not refuse the dispute fields (section 8.3, rows 2 to 4). This closes the plan's IS-5.

Two limits remain. Both are stated, and the contract does not refuse them (D31; ADR-0032 §5):

| Terms | Effect |
| --- | --- |
| `D` shorter than the wait for the escalation's round and a block | No escalation can be decided, and the case defaults to a refund. The round is the first published after `t1 + BEACON_MARGIN` (`_escalationRound`), and the decision needs a block before `t1 + D`. **The smallest decidable window is 37 s on Ethereum mainnet and on Sepolia,** and 2 s on the local chain and SimChain [documented: ADR-0032 Summary and §5; the operator's `escalationFloorSec` gives the same 37 s]. The appeal adjudicator's panel needs its own run time on top. Finding F-2 |
| `fallbackBy − judgeBy` shorter than the wait for the fallback's round and a block | The fallback cannot decide, and the case defaults. The fallback's round is published 29 to 31 s after `judgeBy` on a 29 s margin. **A fallback window of 43 s on Ethereum mainnet, or 44 s on Sepolia, always has a block that can carry the decision** [documented: ADR-0032 Summary, measured there over every `judgeBy` in 720 s]. On the local chain 1 s is enough |

The operator's prepare route warns below both numbers and refuses neither (`beaconWindowNotices` in `apps/operator/src/prepare.ts`) [measured]. Its fallback floor is 44 s on both chains, the larger of the two.

## 7. The effective outcome

The closing reason is the outcome. `decided` reads released or refunded from the stage, and the decider names who earned the fee. The other reasons are `accepted_early`, `settled`, `reclaimed` and `defaulted`. Every terminal row is final when it is written.

| Outcome | Rows | Final | Payment address | Payout address | Adjudicators |
| --- | --- | --- | --- | --- | --- |
| unfunded | P01 | no | 0 | 0 | 0 |
| open | P02 to P05 | no | `−H` held, or 0 after its own reclaim on the escrow | 0 | 0 |
| released | P06, P08, P10 | yes | `−H`; the buyer holds the key | `+P` | the decider `+F` |
| refunded | P07, P09, P11 | yes | `−F` | 0 | the decider `+F` |
| defaulted | P12 | yes | 0 | 0 | 0 |
| accepted_early | P13 | yes | `−P`; the buyer holds the key | `+P` | 0 |
| reclaimed | P14 | yes | 0 | 0 | 0 |
| settled | P15, P16, P17 | yes | `−s`, with `s` the seller's share; the buyer holds the key when the settlement released it | `+s` | 0 |

## 8. The signed-field register

Every field of every message a party signs, and where the contract enforces it. "Bound" means the field is in the signed hash, so a call that changes it fails the signature check; it says nothing about whether the contract acts on the value.

### 8.1 Terms (`CommitmentTerms`)

The seller signs the commitment ID (`agreeAndFund`). The buyer's Agree, the primary's acceptance and every later message carry the ID.

| Field | Enforced | Where |
| --- | --- | --- |
| `schemaVersion`, `clubId`, `rulebookHash`, `deliverableHash`, `acceptanceHash`, `adjudication.policyId`, `disclosure`, `buyerEncryptionPublicKey`, `nonce` | no: bound only | `H.commitmentId` |
| `buyer`, `seller` | yes, as signers | the seller signs the terms and the delivery (`agreeAndFund`, `_acceptDelivery`); the buyer signs the Agree and the early accept (`agreeAndFund`, `earlyAccept`); both sign a settlement (`mutualSettle`). Neither is paid or refunded unless it is also a money address |
| `buyerPaymentAddress`, `sellerPayoutAddress` | yes, as the escrow's payer and receiver | `_paymentInfo`; a settlement's payouts may name only these two (`_payOut`); `SettlementAddresses` names both at funding |
| `price` (token and amount) | yes: the token must be the deployment's `TOKEN` | `agreeAndFund`, `_paymentInfo`, `_payOut` |
| `adjudication.adjudicator`, `fallbackAdjudicator`, `appealAdjudicator` | yes | the acceptance in `agreeAndFund`; the signer of each decision in `decide` |
| `adjudication.fee` | yes; its token is the price token by construction (`H.adjudicationHash`) | `_paymentInfo`, `_settleDecision` |
| `adjudication.registryHash`, `policyHash` | bound into the acceptance and every decision, not interpreted | `H.acceptanceHash`, `H.decisionHash` |
| `timing.offerExpiresAt`, `fundBy`, `deliverBy`, `judgeBy`, `fallbackBy`, `appealDecideSec` | yes | section 6.1; order and window at funding (`agreeAndFund`) |
| `timing.appealWindowSec` | yes: must be 0 (ADR-0033 §2b) | `agreeAndFund` |
| `timing.maxSubmissions` | yes: must be 1 | `agreeAndFund`; attempt 1 only (`_acceptDelivery`) |
| `timing.disputeBy`, `disputeJudgeSec`, `disputeFallbackSec` | **no** | never read |
| `settlement.mode`, `settlement.token` | yes, by construction: the hash uses the constant `guaranteed_on_decision` and the price token | `H.commitmentId` |
| `remedy` | **no**: an opaque hash. A reject always refunds the price in full | `H.commitmentId`, `_settleDecision` |
| `createdAt` | **no** | `H.commitmentId` |

### 8.2 The other signed messages

| Message, signer | Field | Enforced | Where |
| --- | --- | --- | --- |
| Acceptance, primary | `seedCommitment` | in full, bound to the commitment ID: the deal stores the low 144 bits of keccak256(`seedCommitment` ‖ commitment ID), and the primary's decision must reveal a seed that gives the same tag. Known issue L-4 keeps one residual | `H.seedTag`; `agreeAndFund`; `decide` |
| | `bondReserved` | must be 0: phase one has no bond | `agreeAndFund` |
| | `expiresAt` | yes | `agreeAndFund` |
| | `nonce` | no | |
| Agree, buyer | `expiresAt` | yes | `agreeAndFund` |
| | `nonce` | no | |
| Delivery, seller | `attempt` | must be 1 | `_acceptDelivery` |
| | `ciphertext`, `plaintextSha256`, `plaintextMime` | no: bound only, through the posted hash | `H.deliveryHash`, `_acceptDelivery` |
| | `encryptedKeys` | its hash, when a key is released by early accept or settlement. The recipients are not checked; core checks them | `_requireKeyProof` |
| | `submittedAt` | **no** | |
| Decision, the adjudicator whose turn it is | `attempt`, `deliveryHash`, `role`, `outcome` | yes | `decide` |
| | `seed` | yes | `decide` |
| | `judgmentRecordHash` | no: emitted in `Decided` | `decide` |
| | `keyForBuyer` | required on an accept (`_settleDecision`), refused on a reject or an escalation (`decide`). The contract cannot check the ciphertext | `decide`, `_settleDecision` |
| | `appealGround` | empty for the primary and the fallback; **not checked** for the appeal adjudicator's decision after an escalation | `_firstInstance`; not read in `_escalationDecision` |
| | `beacon.round`, `value`, `signature` | for the fallback and appeal roles; **not checked** for the primary | `decide` |
| | `beacon.source` | **no** | `H.decisionHash` |
| | `encryptedKeys` | **no** | `H.decisionHash` |
| | `expiresAt` | yes | `decide` |
| | `nonce` | no | |
| EarlyAccept, buyer | `attempt`, `deliveryHash`, `expiresAt` | yes | `earlyAccept` |
| | `nonce` | no | |
| MutualSettlement, buyer and seller | `hasDelivery`, `releaseKey`, `payouts`, `expiresAt` | yes; each payout names the payout address or the payment address | `mutualSettle`, `_payOut` |
| | `deliveryHash` | outside Held, and with a key. **Not checked** in Held without a key, by design (finding F-1, closed) | `mutualSettle` |
| | `nonce` | no | |

No message's nonce is stored. Each signed message applies at most once because its step leaves the row it needs, and the commitment ID and the EIP-712 domain stop a replay on another deal or deployment [inferred from section 3].

### 8.3 Verdicts on the signed fields the contract does not enforce

The plan first counted nine such fields (IS-13). Its list names ten: rows 1 to 10 below. The first read of this page added seven more, rows 11 to 16 and row 18. Row 17 comes from the plan's independent hunt.

Verdicts: **enforce** (the contract refuses a value it cannot honour), **remove** (take the field out of the signed type, which needs an ADR and a schema version), or **assumption** (the field is signed for the record; the NatSpec and the agent docs say so). The rule applied: where the schema or core refuses a value, the contract refuses it too, because a step the contract takes and core refuses leaves the operators' view of the deal behind ([`neutrality.md`](../neutrality.md), residual 13). A verdict marked **Enforced** is built.

| # | Field | Verdict | Reason |
| --- | --- | --- | --- |
| 1 | `timing.maxSubmissions` | **Enforced:** the contract refuses terms where it is not 1 (`agreeAndFund`) | The contract takes one attempt (`_acceptDelivery`). The schema allows 1 to 3 for the full protocol, which SimChain runs |
| 2 | `timing.disputeBy` | **Enforce:** refuse nonzero. Not built in phase one: recorded for the outside audit (below) | An optimistic-mode field. The schema forbids it in `guaranteed_on_decision` (`spec/schemas/commitment.schema.json`), the only mode the contract settles; core encodes its absence as zero (`packages/core/src/eip712.ts`) |
| 3 | `timing.disputeJudgeSec` | **Enforce:** refuse nonzero. Not built in phase one: recorded (below) | The same |
| 4 | `timing.disputeFallbackSec` | **Enforce:** refuse nonzero. Not built in phase one: recorded (below) | The same |
| 5 | `createdAt` | **Assumption** | The seller's claim of when it wrote the terms. No deadline derives from it, and any value settles the same way. Refusing a future value would restrict a parameter the parties manage (D31) |
| 6 | Delivery `submittedAt` | **Assumption** | The seller's claim. The delivery's time for every deadline is the block time of the call that lands it (`_acceptDelivery`) |
| 7 | Appeal `filedAt` | Not in phase one: the contract takes no appeal. SimChain keeps it | — |
| 8 | Decision `appealGround` | **Enforced empty** for the primary and the fallback (`_firstInstance`). **Not checked** for the appeal adjudicator's decision after an escalation (`_escalationDecision`): not built in phase one, recorded (below) | Phase one has no party appeal, so the field has no meaning on chain. The verdict is half built [measured: `PhaseOneRedTeam.t.sol`, `test_issue_escalationDecisionAcceptsAnyAppealGround`] |
| 9 | Decision `beacon.source` | **Assumption** | The contract proves the round against its immutable beacon, so the name is a label. The on-chain proof stays (SC-8 is not cut). If a later decision removes the proof, the name becomes the only link to a beacon, and the contract should then hash its deployment's source name the way it hashes the settlement mode |
| 10 | Decision `encryptedKeys` | **Assumption** | The envelopes an escalating adjudicator hands to the next one (ADR-0020). The contract sees a hash and cannot check a ciphertext |
| 11 | Decision `beacon.round`, `value`, `signature`, primary role | **Enforce empty.** Not built in phase one, recorded (below): the primary's path does not read them (`decide`) | A primary's seed is its own commit-reveal and uses no beacon. Unchecked, a primary can sign beacon data that a reader may take as proven |
| 12 | Acceptance `bondReserved` | **Enforced:** must be 0 (`agreeAndFund`); **remove** at a later schema version | Phase one has no bond (ADR-0031 §8). A nonzero value would be a signed statement that something is reserved |
| 13 | Acceptance `seedCommitment`, high 112 bits | **Enforced:** the tag hashes the whole commitment with the commitment ID (PR 414; `H.seedTag`) | Known issue L-4. One residual stays: the primary knows the commitment ID before it signs, so about 2^72 hash attempts buy a two-way seed choice on that one deal. The primary already chooses its own seed (DS-1), so it gains nothing new |
| 14 | MutualSettlement `deliveryHash` in Held | **Assumption** on chain when no key is released | Finding F-1, closed: core, ADR-0019 and the formal model follow the contract's rule (T-357). With a key, the contract checks that the carried delivery hashes to the named one (`mutualSettle`). Without a key, the named hash is signed for the record |
| 15 | `remedy` | **Assumption** | The schema fixes it to `full_refund`, which is what a reject does. A second remedy would need a schema version and contract code |
| 16 | Delivery `encryptedKeys` recipients; Decision `keyForBuyer` content | **Assumption** | The contract sees hashes and ciphertext. Core checks the recipients; the buyer checks the key it receives. The key proof takes any entry addressed to the buyer, so a delivery with two such entries lets whoever relays the paying call choose which envelope `KeyReleased` carries; the buyer's reference check refuses such a delivery before it signs (`examples/verify.ts`; the whole-diff review's finding I-4) |
| 17 | The primary's acceptance is named by no other signature | **Assumption;** binding it needs a change to a signed type | The buyer's Agree signs the ID, its own address, a nonce and an expiry (`H.agreeHash`), and the seller signs the ID. Neither names the acceptance, so whoever funds chooses which acceptance to carry. A primary that signed two fixes its seed commitment only at funding. This extends known issue DS-1: the primary already chooses its own panel seed |
| 18 | `timing.appealWindowSec` | **Enforced:** must be 0 on a phase-one deployment (`agreeAndFund`; ADR-0033 §2b, schema v0.11) | Phase one has no party appeal. SimChain keeps each club's minimum window for the full protocol |

**Three checks are recorded for the outside audit and not built in phase one** (the coordinator's default of 2026-11-12, put to Rafa; the whole-diff reviews, T-388, findings L-1 and I-1):

- **The three dispute fields** (rows 2 to 4). The contract takes terms whose `disputeBy`, `disputeJudgeSec` or `disputeFallbackSec` is not 0 [measured by the review: `test_r11_issue_disputeFieldsAreSignedAndNotRefused`]. The schema forbids them in the one settlement mode the contract runs and core encodes them as 0, so only terms sent straight to the contract can carry them, and such a deal then falls behind the operators' view (residual 13). No money moves outside the terms.
- **An escalation decision's appeal ground** (row 8). It is hashed into the decision's signature and into nothing else: never emitted, stored or read [measured by the red team: `test_issue_escalationDecisionAcceptsAnyAppealGround`].
- **A primary's beacon fields** (row 11). The primary's path does not read them, so a primary's accept may carry beacon data no one proved [measured by the review: `test_r11_issue_primaryDecisionMayCarryUnprovenBeaconFields`]. A reader must not take them as proven.

Building any of the three is one comparison in the contract, its proof and a redeploy; the review recommends leaving them recorded.

The nonces of the messages that carry one are assumptions too: the stage stops a replay. `rulebookHash` is bound only: a club's rules, its settlement rules among them, are not on chain, so a message sent straight to the contract is held to the terms and not to the rulebook.

## 9. The phase-one machine

Phase one is an escrow with a neutral decider: hold, deliver, decide (the primary, then the fallback, with escalation), early accept, a two-party settlement, and timeouts. The phase-one contract builds it, and each row names the function that writes it at the frozen commit (the tag `contracts-phase-one-1`; [`scope.md`](scope.md)).

### 9.1 What phase one changed from the 0.7 contracts

- **No party appeals and no bond vault** (SC-7, D57; not in phase one, SimChain keeps both). The word has no appeal state, flags or second time. An accept or a reject by the primary or the fallback is final when written (`_firstInstance`); an escalate hands the deal to the appeal adjudicator, whose accept or reject is final too. The appeal adjudicator stays, for escalations only (`_escalationDecision`).
- **No record of an unfunded offer's expiry** (SC-6). The stage list ends at Settled (`enum Stage`), and the operators record `Expired` by their own clock, with no transaction.
- **Funding refuses terms that settlement cannot process** (SC-5, `agreeAndFund`): deadlines not strictly in order up to `fallbackBy`; `maxSubmissions` other than 1; an `appealDecideSec` of 0; and an `appealWindowSec` other than 0 (ADR-0033 §2b). A zero price stays allowed (ADR-0031 §6; section 12).
- **Funding refuses terms core cannot represent** (T-380, PR 420): a deadline after 9999-12-31T23:59:59-23:59, an escalation window above 2^32 − 1 s and a hold above 2^120 − 1 base units, each with `Unrepresentable()`.
- **One token per deployment, funded by ERC-3009 only** (SC-1, SC-2). `t.token` must equal the immutable `TOKEN`, fixed at deploy. The hold is authorized through the ERC-3009 collector only (`ERC3009_COLLECTOR`).
- **Two money addresses** (ADR-0033): the signed terms name the buyer's payment address and the seller's payout address, apart from the signing keys. They are the escrow's payer and receiver (`_paymentInfo`).
- **A settlement pays the seller's payout address and the buyer's payment address only** (SC-3, ADR-0033; `_payOut`).
- **The seed tag binds the whole seed commitment and the commitment ID** (known issue L-4, PR 414; `H.seedTag`).
- **The panel rounds take a margin** (ADR-0032): the fallback's round is the first after `judgeBy − 1 + BEACON_MARGIN`, an escalation's the first after `t1 + BEACON_MARGIN` (`_roundAfter`).
- **The constructor takes six arguments** and refuses a zero address (`ZeroAddress`) and, on any chain but the local one, a beacon margin of 0 (`NoBeaconMargin`).
- **Kept:** contract signers by ERC-1271 (SC-4 is refused); the on-chain proof of the beacon round (SC-8 is not cut); and a settlement in Held that names a delivery and releases its key, the path for late work (SC-5b is not cut). Finding F-1 resolved toward the contract (T-357). `LateWorkKey.t.sol` shows that the delivery a settlement names is the one whose key it releases.
- **Events:** the nine events of party appeals and the bond vault are not in phase one, and neither is the event for a third-party payout. `SettlementAddresses` is new (ADR-0033). [`events.md`](events.md) lists them.

### 9.2 The closing reason

The word records why a deal closed, so each terminal row has one cause (refactor RF-4; enums `Reason` and `Decider`). Without it, a release by the primary, by the fallback and on an escalation would be one word. So would an escalation's reject and a default, although the fee went to different parties.

| Field | Values | Rule |
| --- | --- | --- |
| `reason` | `open`, `decided`, `accepted_early`, `settled`, `reclaimed`, `defaulted` | `open` exactly in None, Held, Delivered, FallbackJudging and Escalated. Written in the same storage write that leaves those stages, and never changed after |
| `decider` | `none`, `primary`, `fallback`, `appeal` | Not `none` exactly when `reason = decided`. It names the adjudicator that signed the decision and received the fee |

The reason fixes the stage: `decided` gives Released or Refunded, `accepted_early` gives Released, `settled` gives Settled, `reclaimed` and `defaulted` give Refunded. The contract encodes them as the enums `Reason` (`Open`, `Decided`, `AcceptedEarly`, `Settled`, `Reclaimed`, `Defaulted`) and `Decider` (`None`, `Primary`, `Fallback`, `Appeal`). `StateOracle.sol` checks these rules after every step of the fuzzing campaign.

### 9.3 The rows

| Row | stage | attempt | `reason` | `decider` | `t1` | `dh` | Written by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | None | 0 | open | none | 0 | 0 | nothing: the initial value of every ID |
| P02 | Held | 0 | open | none | 0 | 0 | `agreeAndFund` |
| P03 | Delivered | 1 | open | none | 0 | ≠ 0 | `deliver`, with `_acceptDelivery`. A decision or an early accept that carries the delivery from Held writes its own final row in the same call |
| P04 | FallbackJudging | 1 | open | none | > 0 | ≠ 0 | `triggerFallback` |
| P05 | Escalated | 1 | open | none | > 0, the escalation's time | ≠ 0 | `_firstInstance`, on an escalation |
| P06, P07 | Released (P06), Refunded (P07) | 1 | decided | primary | > 0, the decision's time | ≠ 0 | `_firstInstance` |
| P08, P09 | Released (P08), Refunded (P09) | 1 | decided | fallback | > 0, the decision's time | ≠ 0 | `_firstInstance` |
| P10, P11 | Released (P10), Refunded (P11) | 1 | decided | appeal | > 0, the escalation's time | ≠ 0 | `_escalationDecision` |
| P12 | Refunded | 1 | defaulted | none | > 0 | ≠ 0 | `_refundAll`, from `triggerDefault` |
| P13 | Released | 1 | accepted_early | none | 0 | ≠ 0 | `earlyAccept` |
| P14 | Refunded | 0 | reclaimed | none | 0 | 0 | `_refundAll`, from `reclaim` |
| P15 | Settled | 0 | settled | none | 0 | 0 | `mutualSettle` from Held, with or without a named delivery |
| P16 | Settled | 1 | settled | none | 0 | ≠ 0 | `mutualSettle` from Delivered |
| P17 | Settled | 1 | settled | none | > 0 | ≠ 0 | `mutualSettle` from FallbackJudging or Escalated |

`seedTag` is zero in P01 and unchanged from funding in every other row.

**Bounds on `t1`,** for an oracle that also checks values [measured at the guards named]. `StateOracle.sol` checks them (`_times`).

| Row | Bound | Guard |
| --- | --- | --- |
| P04 | `t1 ≥ judgeBy` | `triggerFallback` |
| P05 | `t1 < judgeBy` when the primary escalated, `judgeBy ≤ t1 < fallbackBy` when the fallback did. The word does not record which | the deadline in `_turn` |
| P06, P07 | `t1 < judgeBy` | the primary's deadline |
| P08, P09 | `judgeBy ≤ t1 < fallbackBy` | `triggerFallback`, then the fallback's deadline |
| P10, P11 | `t1` is the escalation's time, with P05's bound | `_escalationDecision` keeps `t1` |
| P12 | from P04: the takeover's time, `≥ judgeBy`; from P05: the escalation's time | `_refundAll` keeps `t1` |
| P17 | the takeover's time or the escalation's time | `mutualSettle` keeps `t1` |

**The same invariant as a predicate,** for the state oracle (T-341):

```
legalPhaseOne(d, dh) :=
  d.stage = None:            d.attempt = 0 ∧ d.reason = open ∧ d.decider = none ∧ d.t1 = 0 ∧ d.seedTag = 0 ∧ dh = 0
  d.stage = Held:            d.attempt = 0 ∧ d.reason = open ∧ d.decider = none ∧ d.t1 = 0 ∧ dh = 0
  d.stage = Delivered:       d.attempt = 1 ∧ d.reason = open ∧ d.decider = none ∧ d.t1 = 0 ∧ dh ≠ 0
  d.stage = FallbackJudging: d.attempt = 1 ∧ d.reason = open ∧ d.decider = none ∧ d.t1 > 0 ∧ dh ≠ 0
  d.stage = Escalated:       d.attempt = 1 ∧ d.reason = open ∧ d.decider = none ∧ d.t1 > 0 ∧ dh ≠ 0
  d.stage = Released:        d.attempt = 1 ∧ dh ≠ 0 ∧
      ((d.reason = decided ∧ d.decider ≠ none ∧ d.t1 > 0) ∨ (d.reason = accepted_early ∧ d.decider = none ∧ d.t1 = 0))
  d.stage = Refunded:
      (d.reason = decided   ∧ d.decider ≠ none ∧ d.attempt = 1 ∧ d.t1 > 0 ∧ dh ≠ 0) ∨
      (d.reason = defaulted ∧ d.decider = none ∧ d.attempt = 1 ∧ d.t1 > 0 ∧ dh ≠ 0) ∨
      (d.reason = reclaimed ∧ d.decider = none ∧ d.attempt = 0 ∧ d.t1 = 0 ∧ dh = 0)
  d.stage = Settled:         d.reason = settled ∧ d.decider = none ∧
      ((d.attempt = 0 ∧ d.t1 = 0 ∧ dh = 0) ∨ (d.attempt = 1 ∧ dh ≠ 0))
  otherwise: false
```

### 9.4 Holdings

The escrow only: phase one has no vault.

| Rows | Escrow capturable | Escrow refundable | Tokens that have left, and to whom |
| --- | --- | --- | --- |
| P01 | 0 (no payment) | 0 | none |
| P02 to P05 | `H`, or 0 after the payment address's own reclaim from the escrow's expiry (5.2) | 0 | none, or `H` to the payment address |
| P06, P08, P10 | 0 | `H` | `P` to the payout address, `F` to the decider (`_settleDecision`) |
| P07, P09, P11 | 0 | `F` | `P` to the payment address, `F` to the decider |
| P12, P14 | 0 | 0 | `H` to the payment address (`_refundAll`, or the address's own reclaim) |
| P13 | 0 | `P` | `P` to the payout address, `F` back to the payment address (`earlyAccept`) |
| P15, P16, P17 | 0 | `s` | With `s` the seller's share: `s` to the payout address, `P − s + F` to the payment address (`_payOut`) |

A settlement whose two money addresses are equal counts every payout as the seller's share, so `s = P` [measured: `_payOut`].

**Three facts the code assumes and an oracle should check:** a funded deal's escrow holds `H` until the escrow's expiry (I16); `attempt` is 1 exactly when `dh` is nonzero (I04); each terminal word has one cause (9.2).

### 9.5 The cuts, one by one

Each cut, its decision, and what it changed in the contract. Appendix A lists what is not in phase one.

| Cut | State of the decision | Effect on the contract |
| --- | --- | --- |
| SC-1: one settlement token per deployment | built (`TOKEN`, checked in `agreeAndFund`) | The token is a deploy-time constant |
| SC-2: ERC-3009 funding only | built: the ERC-3009 collector only (`ERC3009_COLLECTOR`) | One collector; no funding method field is read |
| SC-3: a settlement pays the two money addresses only | built (`_payOut`) | P15 to P17: every payout goes to the payout address or the payment address |
| SC-4: plain-key signatures only | **refused:** contract signers stay | No row changes. [`threat-model.md`](threat-model.md) says what a contract signer can do |
| SC-5: refuse deadlines out of order, `maxSubmissions` other than 1, and an `appealDecideSec` of 0 | built (`agreeAndFund`) | A zero price stays allowed (ADR-0031 §6), and `H > 0` stays the funding condition (`E:179`). Verdict 1 of section 8.3 lands here. Finding F-2 stays a stated limit |
| SC-5b: a settlement in Held cannot name a delivery or release a key | **not cut:** the path stays | None on chain. P15 is reached with or without a named delivery and a key. Core, ADR-0019 and the formal model changed to allow it (T-357), which closed finding F-1 |
| SC-6: no on-chain record of an unfunded offer's expiry | built | Not in phase one: the stage Expired and its entry point are gone |
| SC-7: no party appeals and no bonds | built (D57) | Not in phase one; SimChain keeps both. The word lost its appeal state, flags and second time, and gained the closing reason and decider (RF-4) |
| SC-8: no on-chain proof of the beacon | **not cut:** the proof stays for now | None. Had it been cut, the beacon guards of the fallback and escalation decisions would go, and verdict 9 would change |

## 10. Where this page differs from the formal model, core and the docs

`formal/Holdback.tla` models core in two profiles: the full protocol, which SimChain runs, and phase one, which the contracts run (T-337, T-376). Its README maps each phase-one action and variable to the contract ("Model to code: phase one"). The differences between the phase-one profile and the contract that remain [documented: `formal/README.md`, "Not modelled" and "The two profiles"]:

| # | The phase-one profile | The contract |
| --- | --- | --- |
| 1 | Treats a signature as the actor taking the step: no message expiry, no replay | Checks EIP-712 signatures and every message's expiry |
| 2 | Has no delivery hash and no named delivery | Every decision, early accept and settlement after a delivery names the posted one (ADR-0029) |
| 3 | Has no `attempt`, `t1` or `dh` | Stores all three (section 1) |
| 4 | Has no beacon round or margin | Fixes each panel's round with `BEACON_MARGIN` (section 6.1) |
| 5 | Uses fixed amounts, so no zero price or zero fee | Takes other branches for a zero price or fee (section 12) |
| 6 | Never makes the payment address equal the payout address | Compares no two addresses |
| 7 | Refuses terms out of order, as the contract does | The same (section 6.3) |
| 8 | Lets every transfer succeed | A refused transfer makes the call revert (section 5.3) |
| 9 | Does not record the split the parties signed | Pays the signed split (`_payOut`) |
| 10 | Never lets an adjudicator share an address with another adjudicator or a party | Allows both |
| 11 | Has no contract signer that changes its answer | Calls ERC-1271 signers in every check |
| 12 | Makes the offer, the acceptance and the agreement three steps | Checks all three in one call (`agreeAndFund`) |

The 0.7 model's other differences (the Offered states and `Expired`, the two-step default with compensation, the appeal fee, the escrow's expiry, bond coverage, early accept in Held, a settlement in Held that releases a key, third-party payouts, the strict deadline order and the record of how a deal closed) are resolved in the phase-one profile or are not in phase one.

Other documents:

- [`docs/architecture.md`](../architecture.md), the transition table, says early accept needs the state Delivered. The contract also takes it in Held with the delivery (`earlyAccept`). The plan's IS-8.
- [`docs/neutrality.md`](../neutrality.md) describes the full protocol, where defaulting adjudicators' bonds compensate the seller. That is not in phase one: a default refunds the buyer's payment address and pays nobody from a bond (`triggerDefault`).
- The comment on `Deal.t1` calls it "decidedAt, escalatedAt or fallbackSince". After an escalation decision (P10, P11), `t1` is still the escalation's time, and the decision's time is in no field.
- Core and ADR-0019 took the contract's rule for a settlement in Held that names an unposted delivery (T-357), so finding F-1 is closed.
- **The funding deadline.** ADR-0031 §6 settled it: on the contract an offer funds until `offerExpiresAt`, and `fundBy` bounds only the ERC-3009 authorization (`_paymentInfo` sets it as `preApprovalExpiry`). Core and SimChain keep two steps: agree before `offerExpiresAt`, then fund before `fundBy` (`packages/core/src/state.ts`, `agree` and `fund`). The formal model's phase-one profile funds by `offerExpiresAt`.

## 11. Findings

No Critical, High or Medium finding. None moves money outside what the parties signed.

**F-1 · Low · Closed · The contract took a settlement that core, ADR-0019 and the formal model refused.** In Held, `mutualSettle` accepts a settlement that names an unposted delivery, and with `releaseKey` it releases that delivery's buyer envelope. The maintainer kept the path on 2026-11-11 (ADR-0031, SC-5b). T-357 moved core, ADR-0019 and the formal model to the contract's rule. `LateWorkKey.t.sol` shows the key comes from the named delivery only. No event gained a field: a reader recognises late work as `MutuallySettled` with `keyReleased` true, plus `KeyReleased` with path `KEY_MUTUAL` (2), on a deal with no `JobSubmitted`.

**F-2 · Low · Stated limit · A short escalation window cannot be decided.** The contract refuses a window of 0 at funding (`agreeAndFund`). A window above zero still needs the escalation's round, the first published after `t1 + BEACON_MARGIN` (`_escalationRound`), and then a block before `t1 + D` (`_escalationDecideBy`). With the 29 s margin of Ethereum mainnet and Sepolia, the smallest decidable window is 37 s; on the local chain and SimChain it is 2 s [documented: ADR-0032 §5]. A shorter window makes every escalated case default to a refund. The fallback's window has a floor too: 43 s on mainnet and 44 s on Sepolia (section 6.3). Under D31 the contract refuses only 0. The operator's prepare route warns below the chain's number (`beaconWindowNotices`), and the agent docs state it (ADR-0032 §5, gate line BR-5).

**F-3 · Info · The plan's count of unenforced signed fields was low.** The plan said nine and listed ten; section 8.3 lists eighteen, among them the beacon fields of a primary's decision and the acceptance's `bondReserved`. Impact: the NatSpec and the agent docs would under-state what is signed for the record. Next action: the scope record and the NatSpec package use section 8.3; the plan already points to it. Recorded on 2026-11-11.

From the plan: IS-5 is closed by SC-5 (section 6.3), and IS-6 stands (section 5.2). IS-3 shrinks to P05 and P17, where the word does not record whether the primary or the fallback escalated, or whether the fallback's turn or an escalation came before the settlement. IS-1, IS-4 and IS-11 are not in phase one.

## 12. A deal with price 0

**A deal with price 0 and a fee above 0 settles in every outcome, and its word matches section 9.3's rows.** The maintainer decided on 2026-11-11 that the contract keeps a price of 0 (ADR-0031 §6): other terms, or a future oracle state, can carry the deal's value. [`ZeroPrice.t.sol`](../../contracts/test/unit/ZeroPrice.t.sol) (T-345, ported to phase one by T-375) takes such a deal through every phase-one outcome: `P = 0` and `F = 500,000` base units (`FEE` in `contracts/test/unit/Base.sol`). Each test checks the escrow's record and token store, every party's balance, the word against its row, and the ordered list of events from the rules contract and the escrow.

| Outcome | Row | Fee goes to | Payout address gets | Payment address gets back | Test |
| --- | --- | --- | --- | --- | --- |
| Funding | P02 | (held) | – | – | `test_fund_holdsTheFeeOnly` |
| The primary accepts | P06 | the primary, `F` | 0 | 0 | `test_release_primaryAccepts_feeToPrimary_zeroToSeller` |
| The primary rejects | P07 | the primary, `F` | 0 | 0 | `test_refund_primaryRejects_feeToPrimary_zeroToBuyer` |
| The fallback accepts | P08 | the fallback, `F` | 0 | 0 | `test_release_fallbackAccepts_feeToFallback_zeroToSeller` |
| The fallback rejects | P09 | the fallback, `F` | 0 | 0 | `test_refund_fallbackRejects_feeToFallback_zeroToBuyer` |
| An escalation accepted | P10 | the appeal adjudicator, `F` | 0 | 0 | `test_escalation_accepted_feeToAppealAdjudicator_zeroToSeller`; escalated by the fallback: `test_escalation_byTheFallback_thenAccepted_feeToAppealAdjudicator` |
| An escalation rejected | P11 | the appeal adjudicator, `F` | 0 | 0 | `test_escalation_rejected_feeToAppealAdjudicator_zeroToBuyer` |
| Default, the fallback silent | P12 | nobody | 0 | `F` | `test_default_fallbackMissesFallbackBy_feeBackToBuyer` |
| Default, an escalation undecided | P12 | nobody | 0 | `F` | `test_default_escalationUndecided_feeBackToBuyer` |
| Default after the payment address's own reclaim (5.2) | P12 | nobody | 0 | `F`, by the escrow's reclaim; the default moves nothing and emits no `Refunded` | `test_default_afterTheBuyersOwnEscrowReclaim_closesWithoutRefundEvent` |
| Early accept | P13 | nobody | 0 | `F` | `test_earlyAccept_carryingTheDelivery_feeBackToBuyer_zeroToSeller`, `test_earlyAccept_afterDelivery_feeBackToBuyer_zeroToSeller` |
| Reclaim | P14 | nobody | 0 | `F` | `test_reclaim_afterMissedDeliverBy_feeBackToBuyer` |
| Mutual settlement | P15, P16, P17 | nobody | 0 | `F` | `test_mutual_beforeDelivery_emptyPayouts_feeBackToBuyer`, `test_mutual_afterDelivery_releasesTheKey_feeBackToBuyer`, `test_mutual_duringFallback_feeBackToBuyer`, `test_mutual_duringEscalation_feeBackToBuyer` |

What the tests show [measured by the tests]:

- **A decision takes the whole hold as a fee.** An accept is one capture of `H = F`, with fee `F` to the decider, and the escrow sends the payout address nothing (`E:471`). A reject captures `F` as the fee and makes no void, because nothing is left (`_settleDecision`).
- **Events report zero amounts.** Every accept emits `PaymentReleased(seller, 0)` (`_settleDecision`, `earlyAccept`), and every reject emits `Refunded(buyer, 0)`. `JobFunded` reports the hold, `F`. An indexer must not read these events as payments.
- **A settlement can pay nobody.** The payouts must sum to 0 and each must be above 0 (`_payOut`), so only an empty list settles, and the fee goes back to the payment address (`test_mutual_refusesAnyPayout`).

**Price 0 with fee 0 cannot be funded.** The hold is 0, and the escrow refuses to authorize 0 with `ZeroAmount()` (`E:179`). The revert undoes the whole call: the word stays P01, the escrow records nothing and no token moves (`test_zeroPriceZeroFee_cannotFund_escrowRefusesZeroAmount`). Core's phase-one profile refuses such terms at the offer, before anyone signs (`ZERO_HOLD_PROBLEM`). This is a stated phase-one limit: a deal holds at least one base unit, as price or as fee (ADR-0031 §6).

## Appendix A. What is not in phase one

Each cut is deliberate. Nothing in this table is in phase one; SimChain keeps all of it as the full protocol's reference.

| Not in phase one | What left the model |
| --- | --- |
| Party appeals (SC-7). Not in phase one | The 0.7 model's rows L11 to L30; the appeal filing, its expiry and the party-appeal branch of `decide`; the `appeal` field and `t2`; the deadlines `appealBy` and `appealDecideBy`; the overturn outcomes; the `Appeal` message; the events `AppealFiled` and `AppealClosed` |
| Bonds (SC-7). Not in phase one | `HoldbackBonds.sol` and its seven events; the `flags` field; every vault column; the vault's aggregate invariants; the illegal classes of flags and appeal bonds |
| The record of an unfunded offer's expiry (SC-6). Not in phase one | The 0.7 model's row L02; `expireOffer`; `Stage.Expired` |
| Any-token support and Permit2 funding (SC-1, SC-2). Not in phase one | The token as a term the parties choose; a second funding method |
| Settlement payouts to third parties (SC-3). Not in phase one | Payouts to any address other than the two money addresses; the event for such a payout |

What a cut costs: a wrong final decision has no remedy on chain in phase one. The parties choose the adjudicators, and the law is the backstop ([`threat-model.md`](threat-model.md), TA-13).

## Where this page did not look

- **Run for this pass (T-385, 2026-11-12):** `forge test --match-path 'test/unit/*'` in `contracts/` at `ba941e0`: every unit test passed [measured]. No TLC run and no invariant campaign ran for this pass. Every "unreachable" is from reading each write to the word.
- **Not checked by a red team on the phase-one rows:** this page's sections 3 to 12. The 0.7 model's sections 1 to 6 had that read on 2026-11-11.
- **Not read in full:** the ERC-3009 collector, `TokenStore.sol`, Solady's signature library beyond the plan's note that a zero signer fails, and the test handler.
- **Assumed:** a token that moves exactly the amount asked and lets every transfer through; block time between 1 and 2^40 − 1; no delivery or seed that hashes to zero.
