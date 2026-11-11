# Contract state model

## Summary

This page lists every state a deal can be in on chain, across the rules contract, the bond vault and the Commerce Payments escrow. It describes the contracts at commit `26d4670` (`contracts/src` there equals the deployed commit `64be1f1` named in [`scope.md`](scope.md)). It changes no code.

- **The deal's stored word has 37 legal combinations** (rows L01 to L37, section 2) [measured: each row cites the line that writes it].
- **16 classes of combination are illegal** (I01 to I16, section 4). Each is unreachable, with the line that makes it so [inferred from reading every write to the word; no test ran]. One state is reachable that the word does not show: a funded deal whose escrow the buyer has already emptied (section 5.2). The code handles it; the word does not record it.
- **Three findings,** all Low or Info (section 11). No finding moves money outside the signed terms.
- **Phase one cuts 21 of the 37 rows.** The maintainers accepted scope cut SC-7 (no party appeals, no bonds) on 2026-11-11; it removes the 20 rows L11 to L30 and the vault columns. Scope cut SC-6 removes L02. 16 rows remain. Section 9 marks every cut as a branch. This page decides none.

Labels: **measured** (read at the cited line), **inferred** (concluded from reading, not checked by a run), **guessed**.

Citations: `R:211` is line 211 of [`HoldbackRules.sol`](../../contracts/src/HoldbackRules.sol), `B:` is [`HoldbackBonds.sol`](../../contracts/src/HoldbackBonds.sol), `T:` is [`HoldbackTypes.sol`](../../contracts/src/HoldbackTypes.sol), all at `26d4670`. `E:` is `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` at the pinned commit `6b0a5ef`. The scope cuts (SC-1 to SC-8) and implicit-state items (IS-1 to IS-14) are the contract refinement plan's labels; the maintainers keep the plan privately ([`docs/private-materials.md`](../private-materials.md)), and this page restates each label where it uses it.

## 1. What is stored

A deal is one commitment. Its ID is the EIP-712 struct hash of the signed terms (`T:270-294`).

| Where | What | Line |
| --- | --- | --- |
| Rules contract | **The word:** `stage`, `attempt`, `appeal`, `flags`, `t1`, `t2`, `seedTag`, one storage slot per deal | `R:47-55`, `R:82` |
| Rules contract | **`deliveryHashOf[id]`:** the hash of the delivery posted on chain, or zero | `R:86` |
| Bond vault | `bondOf[adjudicator][token]`, `encumberedOf[adjudicator][token]`: totals per adjudicator and token, with no record of which deal holds what | `B:20-21` |
| Bond vault | `appealBondOf[id]`: the appellant and the amount of an appeal bond | `B:23-28` |
| Escrow | `paymentState[hash]`: `hasCollectedPayment`, `capturableAmount`, `refundableAmount`, one per deal. The hash covers a `PaymentInfo` that the rules contract derives from the terms alone, with the deal's ID as salt | `E:55-62`, `R:163-187` |

Symbols used below:

| Symbol | Meaning |
| --- | --- |
| `P`, `F`, `H` | `t.price`, `t.fee`, and the hold `P + F` (`R:168`) |
| `B` | the appeal bond, `a.bond` (`R:516`) |
| `W`, `D` | `t.timing.appealWindowSec`, `t.timing.appealDecideSec` |
| `now` | `block.timestamp` |
| `dh` | `deliveryHashOf[id]` |
| flags | `1` = the primary's bond is reserved (`F_PRIMARY`), `2` = the fallback's bond is reserved (`F_FALLBACK`), `8` = the fallback made the first decision (`F_BY_FALLBACK`); `R:57-59`. The only values written are 0, 1, 8 and 10 |

## 2. The legal rows

**The invariant:** for every commitment ID, the word and `dh` together match exactly one row of this table. `seedTag` is zero in L01 and L02 and is the low 144 bits of the primary's seed commitment in every other row (`R:213`); no later write changes it.

`t1 > 0` and `t2 > 0` mean a block time was written. Every row assumes block time is above zero and below 2^40 seconds (the year 36812), the width of `t1` and `t2`.

| Row | stage | attempt | appeal | flags | `t1` | `t2` | `dh` | Meaning | Written at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | None | 0 | None | 0 | 0 | 0 | 0 | Never funded. The initial value of every ID | none |
| L02 | Expired | 0 | None | 0 | 0 | 0 | 0 | An unfunded offer's expiry, recorded | `R:528` |
| L03 | Held | 0 | None | 1 | 0 | 0 | 0 | Funded, nothing delivered | `R:211-213` |
| L04 | Delivered | 1 | None | 1 | 0 | 0 | ≠ 0 | A delivery is posted | `R:231`, `R:627-628` |
| L05 | FallbackJudging | 1 | None | 1 | > 0 | 0 | ≠ 0 | The primary missed `judgeBy`; `t1` is the trigger's block time | `R:548-549` |
| L06 | Escalated | 1 | None | 0 | > 0 | 0 | ≠ 0 | The primary or the fallback escalated; `t1` is the escalation's block time | `R:318-321` |
| L07, L08 | Released (L07), Refunded (L08) | 1 | None | 1 | > 0 | 0 | ≠ 0 | The primary decided; the appeal window is open; `t1` is the decision's block time | `R:328-332` |
| L09, L10 | Released (L09), Refunded (L10) | 1 | None | 10 | > 0 | 0 | ≠ 0 | The fallback decided; the appeal window is open | `R:328-332` |
| L11, L12 | Released (L11), Refunded (L12) | 1 | Open | 1 | > 0 | > 0 | ≠ 0 | The losing party appealed the primary's decision; `t2` is the filing's block time, and `t1 ≤ t2 < t1 + W` | `R:514-515` |
| L13, L14 | Released (L13), Refunded (L14) | 1 | Open | 10 | > 0 | > 0 | ≠ 0 | The same, against the fallback's decision | `R:514-515` |
| L15, L16 | Released (L15), Refunded (L16) | 1 | Upheld | 0 | > 0 | > 0 | ≠ 0 | The appeal adjudicator upheld the primary's decision | `R:371-373` |
| L17, L18 | Released (L17), Refunded (L18) | 1 | Upheld | 8 | > 0 | > 0 | ≠ 0 | It upheld the fallback's decision | `R:371-373` |
| L19, L20 | Released (L19), Refunded (L20) | 1 | Overturned | 0 | > 0 | > 0 | ≠ 0 | It overturned the primary's decision. The stage keeps the first outcome | `R:371-373` |
| L21, L22 | Released (L21), Refunded (L22) | 1 | Overturned | 8 | > 0 | > 0 | ≠ 0 | It overturned the fallback's decision | `R:371-373` |
| L23, L24 | Released (L23), Refunded (L24) | 1 | Expired | 0 | > 0 | 0 | ≠ 0 | Nobody appealed the primary's decision in time | `R:587-588` |
| L25, L26 | Released (L25), Refunded (L26) | 1 | Expired | 8 | > 0 | 0 | ≠ 0 | Nobody appealed the fallback's decision in time | `R:587-588` |
| L27, L28 | Released (L27), Refunded (L28) | 1 | Expired | 0 | > 0 | > 0 | ≠ 0 | An appeal against the primary's decision went undecided; the decision stands | `R:587-588` |
| L29, L30 | Released (L29), Refunded (L30) | 1 | Expired | 8 | > 0 | > 0 | ≠ 0 | The same, against the fallback's decision | `R:587-588` |
| L31 | Released | 1 | Closed | 0 | > 0 | 0 | ≠ 0 | The appeal adjudicator accepted an escalated case. `t1` is still the escalation's time, not the decision's | `R:338-341` |
| L32 | Refunded | 1 | Closed | 0 | > 0 | 0 | ≠ 0 | Three causes share this row: the appeal adjudicator rejected an escalated case (`R:338-341`); the fallback missed `fallbackBy`; an escalated case went undecided (both `R:598-600`) | `R:338-341`, `R:598-600` |
| L33 | Released | 1 | Closed | 0 | 0 | 0 | ≠ 0 | The buyer accepted early | `R:407-409` |
| L34 | Refunded | 0 | Closed | 0 | 0 | 0 | 0 | Reclaim: nothing was delivered by `deliverBy` | `R:598-600` |
| L35 | Settled | 0 | Closed | 0 | 0 | 0 | 0 | Both parties settled before any delivery was posted | `R:450-452` |
| L36 | Settled | 1 | Closed | 0 | 0 | 0 | ≠ 0 | Both parties settled after a delivery, before `triggerFallback` or an escalation | `R:450-452` |
| L37 | Settled | 1 | Closed | 0 | > 0 | 0 | ≠ 0 | Both parties settled during the fallback's turn or an escalation | `R:450-452` |

The appeal rows follow one pattern. For `j` in 0 to 3, row `L(7+j)` leads to `L(11+j)` on an appeal, `L(11+j)` leads to `L(15+j)` when upheld, to `L(19+j)` when overturned and to `L(27+j)` when undecided, and `L(7+j)` leads to `L(23+j)` when nobody appeals.

**Bounds on the times,** for an oracle that also checks values [measured at the cited guards]:

| Row | Bound | Guard |
| --- | --- | --- |
| L05 | `t1 ≥ judgeBy` | `R:547` |
| L06 | `t1 < judgeBy` when the primary escalated, `judgeBy ≤ t1 < fallbackBy` when the fallback did. The word does not record which | `R:257`, `R:260`, `R:286` |
| L07, L08 and the rows after them (flags 1 or 0) | `t1 < judgeBy` | `R:257`, `R:286` |
| L09, L10 and the rows after them (flags 10 or 8) | `judgeBy ≤ t1 < fallbackBy` | `R:547`, `R:260`, `R:286` |
| L11 to L22, L27 to L30 | `t1 ≤ t2 < t1 + W` | `R:508` |
| L37 | `t1` is the fallback trigger's time or the escalation's time | `R:549`, `R:320` |

**The same invariant as a predicate,** for the state oracle (T-341):

```
legal(d, dh) :=
  d.stage ∈ {None, Expired}:
      d.attempt = 0 ∧ d.appeal = None ∧ d.flags = 0 ∧ d.t1 = 0 ∧ d.t2 = 0 ∧ d.seedTag = 0 ∧ dh = 0
  d.stage = Held:
      d.attempt = 0 ∧ d.appeal = None ∧ d.flags = 1 ∧ d.t1 = 0 ∧ d.t2 = 0 ∧ dh = 0
  d.stage = Delivered:
      d.attempt = 1 ∧ d.appeal = None ∧ d.flags = 1 ∧ d.t1 = 0 ∧ d.t2 = 0 ∧ dh ≠ 0
  d.stage = FallbackJudging:
      d.attempt = 1 ∧ d.appeal = None ∧ d.flags = 1 ∧ d.t1 > 0 ∧ d.t2 = 0 ∧ dh ≠ 0
  d.stage = Escalated:
      d.attempt = 1 ∧ d.appeal = None ∧ d.flags = 0 ∧ d.t1 > 0 ∧ d.t2 = 0 ∧ dh ≠ 0
  d.stage ∈ {Released, Refunded} ∧ d.appeal = None:
      d.attempt = 1 ∧ d.flags ∈ {1, 10} ∧ d.t1 > 0 ∧ d.t2 = 0 ∧ dh ≠ 0
  d.stage ∈ {Released, Refunded} ∧ d.appeal = Open:
      d.attempt = 1 ∧ d.flags ∈ {1, 10} ∧ d.t1 > 0 ∧ d.t2 ≥ d.t1 ∧ dh ≠ 0
  d.stage ∈ {Released, Refunded} ∧ d.appeal ∈ {Upheld, Overturned}:
      d.attempt = 1 ∧ d.flags ∈ {0, 8} ∧ d.t1 > 0 ∧ d.t2 ≥ d.t1 ∧ dh ≠ 0
  d.stage ∈ {Released, Refunded} ∧ d.appeal = Expired:
      d.attempt = 1 ∧ d.flags ∈ {0, 8} ∧ d.t1 > 0 ∧ (d.t2 = 0 ∨ d.t2 ≥ d.t1) ∧ dh ≠ 0
  d.stage = Released ∧ d.appeal = Closed:
      d.attempt = 1 ∧ d.flags = 0 ∧ d.t2 = 0 ∧ dh ≠ 0                      (t1 = 0: L33; t1 > 0: L31)
  d.stage = Refunded ∧ d.appeal = Closed:
      d.flags = 0 ∧ d.t2 = 0 ∧
      ((d.attempt = 1 ∧ d.t1 > 0 ∧ dh ≠ 0) ∨ (d.attempt = 0 ∧ d.t1 = 0 ∧ dh = 0))   (L32, L34)
  d.stage = Settled:
      d.appeal = Closed ∧ d.flags = 0 ∧ d.t2 = 0 ∧
      ((d.attempt = 0 ∧ d.t1 = 0 ∧ dh = 0) ∨ (d.attempt = 1 ∧ dh ≠ 0))              (L35; L36, L37)
  otherwise: false
```

## 3. Entry points and transitions

Every entry point of the rules contract is permissionless: the contract never reads `msg.sender`, and it checks a signature for every step that is not a timeout [measured: no `msg.sender` in `HoldbackRules.sol`]. "Signs" names the key whose signature the call must carry.

| Entry point | From | To | Guards | Signs |
| --- | --- | --- | --- | --- |
| `agreeAndFund` (`R:193-219`) | L01 | L03 | stage None (`R:202`); `now < offerExpiresAt` and `now < fundBy` (`R:203`); both message expiries (`R:204`); `bondReserved ≥ P`, method 0 or 1 (`R:205`); `H`, the escrow expiry and `fundBy` fit their widths (`R:170`); the primary's free bond `≥ P` (`B:75-76`); `H > 0` (`E:179`); `fundBy ≤` the escrow expiry (`E:494`); the escrow's token store receives exactly `H` (`E:424`) | the seller (terms, `R:206`), the primary (acceptance, `R:207`), the buyer (Agree, `R:208`, and the collector signature, `R:218`) |
| `deliver` (`R:226-232`) | L03 | L04 | stage Held (`R:229`); `now < deliverBy` (`R:623`); attempt is 1 (`R:624`) | the seller (`R:626`) |
| `decide`, primary (`R:238-307`) | L03 carrying a delivery (under `deliver`'s guards, `R:244-248`), or L04 | accept: L07. reject: L08. escalate: L06 | message expiry (`R:243`); role, attempt, posted delivery hash, outcome (`R:275-280`); a key only with an accept (`R:283-285`), and required on an accept (`R:350`); `now < judgeBy` (`R:257`, `R:286`); the seed's hash matches `seedTag` on 144 bits (`R:289`); no appeal ground (`R:313`) | the primary (`R:301`) |
| `decide`, fallback | L05 | accept: L09. reject: L10. escalate: L06 | the same common guards; `now < fallbackBy` (`R:260`); the beacon round is `roundAt(judgeBy)`, its value is proven and the seed follows from it (`R:261`, `R:290-297`); on accept or reject the fallback's free bond `≥ P` (`R:327`, `B:75-76`) | the fallback (`R:301`) |
| `decide`, escalation | L06 | accept: L31. reject: L32 | the common guards; outcome is accept or reject (`R:277`); `now < t1 + D` (`R:264`); the round is `roundAt(t1) + 1` (`R:265`) | the appeal adjudicator (`R:301`) |
| `decide`, party appeal | L11 to L14 | upheld: L15 to L18. overturned: L19 to L22 | the common guards; `now < t1 + W + D` (`R:268`); the round is `roundAt(t2) + 1` (`R:269`); no key when the deal stands Refunded (`R:283`) | the appeal adjudicator (`R:301`) |
| `earlyAccept` (`R:388-418`) | L03 carrying a delivery (`now < deliverBy`, `R:401`, `R:623`), or L04 | L33 | stage (`R:398`); message expiry (`R:399`); the message names the posted delivery and its attempt (`R:403`); the buyer's envelope is in the delivery's key list (`R:404`, `R:632-637`). No deadline of its own | the buyer (`R:400`); the seller's delivery signature when carried (`R:626`) |
| `mutualSettle` (`R:425-457`) | L03, L04, L05, L06 | L35 (from L03), L36 (from L04), L37 (from L05 or L06) | stage (`R:431`); message expiry (`R:434`); a settlement without a delivery only in Held, with no key (`R:435`); outside Held it names the posted delivery (`R:439`); with a key, the carried delivery hashes to the named one and holds the buyer's envelope (`R:444-447`); each payout is above zero (`R:466`) and they sum to `P` (`R:477`). No deadline of its own | the buyer and the seller (`R:442-443`) |
| `fileAppeal` (`R:503-518`) | L07 to L10 | L11 to L14 | stage (`R:506`); appeal None (`R:507`); `now < t1 + W` (`R:508`); the appellant is the party the decision went against (`R:511`); `B < 2^96` (`B:97`); no appeal bond held for this ID (`B:98`) | the appellant (`R:513`) |
| `expireOffer` (`R:523-530`) | L01 | L02 | stage None (`R:526`); `now ≥ offerExpiresAt` or `now ≥ fundBy` (`R:527`) | nobody |
| `reclaim` (`R:533-540`) | L03 | L34 | stage Held (`R:536`); `now ≥ deliverBy` (`R:537`) | nobody |
| `triggerFallback` (`R:543-551`) | L04 | L05 | stage Delivered (`R:546`); `now ≥ judgeBy` (`R:547`) | nobody |
| `triggerDefault` (`R:556-569`) | L05, L06 | L32 | from L05: `now ≥ fallbackBy` (`R:561`); from L06: `now ≥ t1 + D` (`R:563`) | nobody |
| `expireAppeal` (`R:573-592`) | L07 to L10; L11 to L14 | L23 to L26; L27 to L30 | stage (`R:576`); appeal None and `now ≥ t1 + W` (`R:580`), or appeal Open and `now ≥ t1 + W + D` (`R:582`) | nobody |

Two calls outside the rules contract change what a deal holds without changing its word:

| Call | Effect | Line |
| --- | --- | --- |
| The buyer's `reclaim` on the escrow, from the escrow's expiry | Empties a hold that is still in L03 to L06 (section 5.2) | `E:323-340` |
| An adjudicator's `deposit` and `withdraw` on the vault | Change `bondOf`; `withdraw` cannot touch a reserved amount | `B:55-68` |

**Terminal rows:** L02 and L15 to L37. No entry point accepts them: every entry point checks the stage first, and for Released or Refunded also the appeal state (`R:266`, `R:507`, `R:579-585`).

**Every non-terminal row has an exit anyone can take once its deadline passes:** L03 by `reclaim`, L04 by `triggerFallback`, L05 and L06 by `triggerDefault`, L07 to L14 by `expireAppeal`. Each of these moves tokens to the buyer or an appellant, except `triggerFallback`; section 5.3 states what that rests on.

## 4. Illegal combinations

Each class is a set of combinations the storage can hold and no entry point writes. "Why unreachable" names the lines that make it so [inferred from reading every write to `_deals` and `deliveryHashOf`: `R:211-213`, `R:231`, `R:321`, `R:332`, `R:341`, `R:373`, `R:407-409`, `R:450-452`, `R:514-515`, `R:528`, `R:548-549`, `R:587-588`, `R:598-600`, `R:627-628`].

| Class | Combination | Why unreachable | If it were reached |
| --- | --- | --- | --- |
| I01 | stage None or Expired with any other field or `dh` nonzero | Every other write follows a check that the stage is not None, or sets the stage in the same call (`R:202-211`, `R:526-528`); `expireOffer` writes the stage only | A second funding of one ID, or a phantom reservation |
| I02 | `attempt ≥ 2` | `_acceptDelivery` is the only writer of `attempt` and refuses any value but 1 (`R:624`, `R:627`); `decide` copies the same value (`R:247`) | A decision could name an attempt nobody delivered |
| I03 | `attempt = 1` in Held, or `attempt = 0` in Delivered, FallbackJudging or Escalated | The delivery and the move out of Held are one call (`R:230-231`, `R:245-246`, `R:401-407`); a revert undoes both | A reclaim over a posted delivery, or a decision with no delivery |
| I04 | `dh = 0` with `attempt = 1`, or `dh ≠ 0` with `attempt = 0` | `R:627-628` write both together and nothing clears either. Assumes no delivery hashes to zero | A decision could not name the delivery (`R:276`), or a hash with no delivery |
| I05 | flags outside {0, 1, 8, 10} | The only values written are 1 (`R:212`, `R:328`), 10 (`R:328`), 0 (`R:318`, `R:338`, `R:409`, `R:452`, `R:600`) and the old value masked with 8 (`R:371`, `R:588`) | `_releaseBonds` would release a reservation that does not exist |
| I06 | Held, Delivered or FallbackJudging with flags ≠ 1; Escalated with flags ≠ 0 | Held is written with 1 (`R:212`); `deliver` and `triggerFallback` leave flags alone; an escalation writes 0 (`R:318`) | The primary's bond is free while it still owes a decision, or a reservation survives an escalation |
| I07 | Any stage before a decision (None, Expired, Held, Delivered, FallbackJudging, Escalated) with appeal ≠ None | The appeal field is written only at a decision (`R:330`, `R:340`, `R:372`), a close (`R:408`, `R:451`, `R:599`), a filing (`R:514`) or an appeal expiry (`R:587`) | `fileAppeal` and `expireAppeal` check the stage first, so nothing follows |
| I08 | Released or Refunded with appeal None or Open and flags not 1 or 10 | The first decision writes 1 or 10 (`R:328`); `fileAppeal` leaves flags alone | An overturn would pay from a bond nobody reserved: `slash` reverts, or takes another deal's reservation (the plan's IS-1) |
| I09 | Appeal Upheld, Overturned or Expired with flag 1 or 2 set | Both writers mask with 8 (`R:371`, `R:588`) | A reservation that no entry point can release |
| I10 | Appeal Closed with flags ≠ 0 | Every writer of Closed writes flags 0 beside it (`R:338-340`, `R:408-409`, `R:451-452`, `R:599-600`) | The same |
| I11 | Settled with appeal ≠ Closed; Released or Refunded with appeal Closed and `t2 ≠ 0` | `R:450-451` write both; `t2` is written only by `fileAppeal` (`R:515`), which needs appeal None | A settled deal that looks appealable |
| I12 | `t2 ≠ 0` outside Open, Upheld, Overturned and Expired; `t2 = 0` in Open, Upheld or Overturned; `t2 < t1` | `fileAppeal` is the only writer (`R:515`); the two decided states come only from Open; block time does not run backwards | The appeal round `roundAt(t2) + 1` would be wrong (`R:269`) |
| I13 | `t1 = 0` in FallbackJudging, in Escalated, or after a first decision; `t1 ≠ 0` in Held or Delivered | `R:549`, `R:320`, `R:331` write block time; nothing writes `t1` before them | Appeal and escalation deadlines would be measured from zero and be over at once |
| I14 | Released with appeal Closed and `attempt = 0`; Refunded with appeal Closed and `attempt = 1`, `t1 = 0`, or `attempt = 0`, `t1 ≠ 0`; Settled with `attempt = 0` and `t1 ≠ 0` | Early accept and an escalation decision both need a posted delivery (`R:401-403`, `R:276`). `t1` is first written at `triggerFallback` or an escalation, and both need a delivery (`R:546`, `R:255-258`); a reclaim and a settlement from Held find `t1` at zero | A release with no delivery, or a fallback turn with none |
| I15 | `appealBondOf[id].appellant ≠ 0` while appeal ≠ Open, or zero while Open | `takeAppealBond` runs only in `fileAppeal` (`R:516`); `payAppealBond` runs in both ways out of Open (`R:376`, `R:590`) and deletes the entry (`B:108`) | An appeal bond stranded in the vault, or a second filing refused |
| I16 | The escrow's `capturableAmount` is neither `H` nor 0; it is `H` in a terminal row; it is 0 in L03 to L06 before the escrow's expiry | The rules contract is the escrow's only operator (`R:174`, `E:241`, `E:270`, `E:304`). It authorizes `H` once (`R:218`) and every settlement path leaves `capturableAmount` at 0 in the call that leaves the funded rows (section 5.1). The buyer's own reclaim needs the expiry (`E:325`) | Money left in the escrow after a deal closed, or a hold gone before its deadline |

No class is reachable [inferred]. One reachable state has no row of its own, because the word does not record it: section 5.2.

## 5. What the vault and the escrow hold

### 5.1 Per row

`enc(primary)` and `enc(fallback)` are this deal's share of `encumberedOf` for the primary and the fallback adjudicator, in the deal's token. The escrow columns are `capturableAmount` and `refundableAmount`. `refundableAmount` is the escrow's own count of what it paid out; the rules contract never calls the escrow's `refund`.

| Rows | `enc(primary)` | `enc(fallback)` | Appeal bond held | Escrow capturable | Escrow refundable | Tokens that have left, and to whom |
| --- | --- | --- | --- | --- | --- | --- |
| L01, L02 | 0 | 0 | 0 | 0 (no payment) | 0 | none |
| L03, L04, L05 | `P` | 0 | 0 | `H`, or 0 after the buyer's own reclaim (5.2) | 0 | none, or `H` to the buyer (5.2) |
| L06 | 0 | 0 | 0 | `H`, or 0 (5.2) | 0 | none, or `H` to the buyer (5.2) |
| L07 | `P` | 0 | 0 | 0 | `H` | `P` to the seller, `F` to the primary (`R:351`) |
| L08 | `P` | 0 | 0 | 0 | `F` | `P` to the buyer, `F` to the primary (`R:356-357`) |
| L09 | 0 | `P` | 0 | 0 | `H` | `P` to the seller, `F` to the fallback |
| L10 | 0 | `P` | 0 | 0 | `F` | `P` to the buyer, `F` to the fallback |
| L11 to L14 | as L07 to L10 | as L07 to L10 | `B`, from the buyer (L11, L13) or the seller (L12, L14) (`B:99-101`) | 0 | as L07 to L10 | as L07 to L10 |
| L15 to L18 | 0 | 0 | 0 | 0 | as L07 to L10 | as L07 to L10. The appeal bond `B` stays in the vault, added to the first decider's `bondOf` (`B:110-112`) |
| L19, L21 | 0 | 0 | 0 | 0 | `H` | as L07 or L09, plus `P` from the first decider's bond to the buyer (`R:378`, `B:88-93`) and `B` back to the buyer |
| L20, L22 | 0 | 0 | 0 | 0 | `F` | as L08 or L10, plus `P` from the first decider's bond to the seller and `B` back to the seller |
| L23 to L26 | 0 | 0 | 0 | 0 | as L07 to L10 | as L07 to L10 |
| L27 to L30 | 0 | 0 | 0 | 0 | as L07 to L10 | as L07 to L10, plus `B` back to the appellant (`R:590`, `B:114-115`) |
| L31 | 0 | 0 | 0 | 0 | `H` | `P` to the seller, `F` to the appeal adjudicator (`R:342`, `R:351`) |
| L32, after an escalation decision | 0 | 0 | 0 | 0 | `F` | `P` to the buyer, `F` to the appeal adjudicator |
| L32, after a default; L34 | 0 | 0 | 0 | 0 | 0 | `H` to the buyer (`R:609`, or the buyer's own reclaim, `R:605-607`) |
| L33 | 0 | 0 | 0 | 0 | `P` | `P` to the seller, `F` back to the buyer (`R:412-413`) |
| L35, L36, L37 | 0 | 0 | 0 | 0 | `P − b` | With `b` the sum of the payouts to the buyer: each payout to its address, and `b + F` to the buyer (`R:464-496`) |

Zero amounts follow the same formulas: a capture or a void of zero is skipped (`R:356-357`, `R:412-413`, `R:493`). `H = 0` cannot fund (`E:179`).

An oracle that reads the word alone cannot tell the two L32 lines apart. It accepts `refundableAmount ∈ {0, F}` for L32, or reads the `Decided` and `Defaulted` events.

### 5.2 The one state the word does not show: a funded deal with an empty escrow

From the escrow's expiry (`fallbackBy + D + EXPIRY_MARGIN`, `R:169`) the buyer can call the escrow's `reclaim` and take `H` back directly (`E:323-340`). The deal's word stays in L03, L04, L05 or L06. This is the plan's IS-6.

In that state [measured at the cited lines]:

- every capture reverts, because the expiry has passed (`E:277`) and nothing is left (`E:284`); every void reverts (`E:308`). So no decision, early accept or settlement can close the deal: each makes at least one of those calls;
- `deliver`, `triggerFallback` and an `escalate` decision still succeed, because they do not call the escrow;
- the timeouts close the deal: `_refundAll` reads the escrow and skips the void when nothing is held (`R:605-608`). `reclaim` closes L03; `triggerFallback` moves L04 to L05; `triggerDefault` closes L05 and L06;
- the primary's bond stays reserved until one of those timeouts runs.

With deadlines in order (`deliverBy ≤ judgeBy ≤ fallbackBy`), every timeout is already due at the escrow's expiry, so anyone can close the deal at once. The contract does not check that order (section 6.3).

### 5.3 Aggregate invariants

For every adjudicator `a` and token `k` [inferred; `invariant` tests exist for the first, T-341 extends them]:

1. `encumberedOf[a][k]` equals the sum of `P` over the deals in token `k` whose primary is `a` and whose flags have bit 1, plus the sum of `P` over the deals whose fallback is `a` and whose flags have bit 2. The reservation and each release use the same adjudicator, token and amount, all bound by the deal's ID (`R:215`, `R:327`, `R:656-657`, `B:89`).
2. `bondOf[a][k] ≥ encumberedOf[a][k]`: `withdraw` takes only the free part (`B:63-65`), and `slash` lowers both by the same amount (`B:89-90`).
3. The vault's balance of `k` is at least the sum of `bondOf[·][k]` plus the sum of the appeal bonds held in `k`. It holds for a token that moves exactly the amount asked; a fee-on-transfer or rebasing token breaks it (known issue L-2).
4. The escrow's token store for the rules contract holds at least the sum of `capturableAmount` over all deals in `k`. The escrow checks the exact amount on the way in (`E:424`).

The exits in section 3 that move tokens rest on the token letting the transfer through. If a transfer to the buyer reverts, `reclaim` and `triggerDefault` revert, and the primary's reservation stays. If a transfer to an appellant reverts, `expireAppeal` reverts for an open appeal, and the first decider's reservation stays (the plan's IS-11). Token-issuer risk is out of scope ([`scope.md`](scope.md)); [`threat-model.md`](threat-model.md) states both as assumptions.

## 6. Deadlines

### 6.1 Named expressions

| Name | Expression | Read at |
| --- | --- | --- |
| `offerExpiry` | `t.timing.offerExpiresAt` | `R:203`, `R:527` |
| `fundBy` | `t.timing.fundBy`; also the escrow's `preApprovalExpiry` | `R:203`, `R:179`, `R:527` |
| `deliverBy` | `t.timing.deliverBy` | `R:623`, `R:537` |
| `judgeBy` | `t.timing.judgeBy` | `R:257`, `R:547` |
| `fallbackBy` | `t.timing.fallbackBy` | `R:260`, `R:561` |
| `escalationDecideBy` | `d.t1 + D`, in L06 | `R:264`, `R:563` |
| `appealBy` | `d.t1 + W`, in L07 to L10 | `R:508`, `R:577` |
| `appealDecideBy` | `d.t1 + W + D`, in L11 to L14. It runs from the first decision, not from the filing | `R:268`, `R:582` |
| `escrowExpiry` | `fallbackBy + D + EXPIRY_MARGIN`; the escrow's `authorizationExpiry` and `refundExpiry`. `EXPIRY_MARGIN` is 86,400 s on Sepolia ([`scope.md`](scope.md)) | `R:169`, `R:180-181` |
| Message expiries | `acc.expiresAt`, `ag.expiresAt`, and `m.expiresAt` of a decision, an early accept and a settlement. A message is good while `now < expiresAt`. An appeal carries none | `R:204`, `R:243`, `R:399`, `R:434` |
| `fallbackRound` | `BEACON.roundAt(judgeBy)` | `R:261`, `R:550` |
| `escalationRound` | `BEACON.roundAt(d.t1) + 1` | `R:265` |
| `appealRound` | `BEACON.roundAt(d.t2) + 1` | `R:269` |

All sums are in 256 bits over 64-bit and 40-bit terms, so none overflows [measured: `R:169`, `R:264`, `R:268`, `R:508`, `R:563`, `R:577`].

### 6.2 Opposing pairs

Each step that needs a deadline to be open is paired with the timeout that needs it to have passed. Every pair splits time at one instant: the step needs `now < X` and the timeout needs `now ≥ X` [measured].

| Deadline | Step, needs `now <` | Timeout, needs `now ≥` |
| --- | --- | --- |
| `offerExpiry` and `fundBy` | `agreeAndFund`: both (`R:203`) | `expireOffer`: either (`R:527`) |
| `deliverBy` | a delivery by any path (`R:623`) | `reclaim` (`R:537`) |
| `judgeBy` | the primary's decision (`R:257`, `R:286`) | `triggerFallback` (`R:547`) |
| `fallbackBy` | the fallback's decision (`R:260`, `R:286`) | `triggerDefault` from L05 (`R:561`) |
| `escalationDecideBy` | the escalation decision (`R:264`, `R:286`) | `triggerDefault` from L06 (`R:563`) |
| `appealBy` | `fileAppeal` (`R:508`) | `expireAppeal` with no appeal (`R:580`) |
| `appealDecideBy` | the appeal decision (`R:268`, `R:286`) | `expireAppeal` with an open appeal (`R:582`) |

Three steps have no deadline of their own and can race a timeout: `earlyAccept` in L04 after `judgeBy`, `mutualSettle` in any funded row, and `triggerFallback` when it comes late. The first one applied wins, because each leaves the row the other needs. A capture reverts from `escrowExpiry` (`E:277`), so from then on no path pays the seller.

### 6.3 What the contract does not check

The contract checks two relations between deadlines: both funding deadlines are still open at funding (`R:203`), and `fundBy ≤ escrowExpiry` (`E:494`). It does not check `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, which core requires (`packages/core/src/timing.ts:33-49`), nor `W ≥ 1` and `D ≥ 1`, which the schema requires. This is the plan's IS-5; scope cut SC-5 closes it.

Terms out of order leave a party without its turn; none moves money outside the terms [inferred]:

| Terms | Effect |
| --- | --- |
| `deliverBy ≤` the funding time | No delivery can land; `reclaim` is due at once |
| `judgeBy ≤ deliverBy` | The primary has no window after a late delivery; the fallback takes over |
| `fallbackBy ≤ judgeBy` | The fallback has no window; `triggerDefault` is due at `triggerFallback` |
| `D = 0` | No escalation can be decided (`now < t1` never holds); the case defaults at once |
| `judgeBy` or `deliverBy` after `escrowExpiry` | An on-time decision cannot capture (known issue L-6). After the buyer's own reclaim, the deal's word stays open and the primary's bond stays reserved until that deadline |
| `judgeBy` before the funding time | The fallback's beacon round is public before anyone signs (known issue L-8) |

## 7. The effective outcome

The stage alone does not give the outcome: an overturned deal keeps its first stage (the plan's IS-4), and three causes share L32 (IS-3). This function of the word gives it.

| `outcome(d)` | Rows | Final | Buyer | Seller | Adjudicators |
| --- | --- | --- | --- | --- | --- |
| `unfunded` | L01 | no | 0 | 0 | 0 |
| `offer_expired` | L02 | yes | 0 | 0 | 0 |
| `open` | L03 to L06 | no | `−H` held, or 0 after its own reclaim on the escrow | 0 | 0 |
| `released_appealable` | L07, L09, L11, L13 | no | `−H`, holds the key | `+P` | first decider `+F` |
| `refunded_appealable` | L08, L10, L12, L14 | no | `−F` | 0 | first decider `+F` |
| `released` | L15, L17, L23, L25, L27, L29, L31 | yes | `−H`, holds the key | `+P` | decider `+F` |
| `refunded` | L16, L18, L24, L26, L28, L30, and L32 after an escalation decision | yes | `−F` | 0 | decider `+F` |
| `released_overturned` | L19, L21 | yes | `−F`: the first decider's bond repaid `P`. Holds the key | `+P` | first decider `+F − P` |
| `refunded_overturned` | L20, L22 | yes | `−F`. No key is released on chain (`R:283`) | `+P`, from the first decider's bond | first decider `+F − P` |
| `accepted_early` | L33 | yes | `−P`, holds the key | `+P` | 0 |
| `reclaimed` | L34 | yes | 0 | 0 | 0 |
| `defaulted` | L32 after a default | yes | 0 | 0 | 0 |
| `settled` | L35, L36, L37 | yes | `−(P − b)`; holds the key when the settlement released it | its payouts | 0 |

An open appeal (L11 to L14) also holds `B` from the appellant. An upheld appeal moves `B` from the appellant to the first decider's bond (L15 to L18). The appeal adjudicator earns nothing on chain for a party appeal.

`refunded` and `defaulted` share L32. A reader tells them apart by the `Decided` or `Defaulted` event, or by the escrow's `refundableAmount` when `F > 0`.

## 8. The signed-field register

Every field of every message a party signs, and where the contract enforces it. "Bound" means the field is in the signed hash, so a call that changes it fails the signature check; it says nothing about whether the contract acts on the value.

### 8.1 Terms (`CommitmentTerms`)

The seller signs the commitment ID (`R:206`). The buyer's Agree, the primary's acceptance and every later message carry the ID.

| Field | Enforced | Where |
| --- | --- | --- |
| `schemaVersion`, `clubId`, `rulebookHash`, `deliverableHash`, `acceptanceHash`, `adjudication.policyId`, `disclosure`, `buyerEncryptionPublicKey`, `nonce` | no: bound only | `T:274-292` |
| `buyer`, `seller` | yes | payer and receiver (`R:175-176`); signers (`R:206`, `R:208`, `R:400`, `R:442-443`, `R:512`, `R:626`) |
| `price` (token and amount) | yes | `R:168`, `R:177`, `R:215`, `R:477` |
| `adjudication.adjudicator`, `fallbackAdjudicator`, `appealAdjudicator` | yes | `R:207`, `R:298-301` |
| `adjudication.fee` | yes; its token is the price token by construction (`T:262`) | `R:168`, `R:351`, `R:356` |
| `adjudication.registryHash`, `policyHash` | bound into the acceptance and every decision, not interpreted | `T:304-305`, `T:380-381` |
| `timing.offerExpiresAt`, `fundBy`, `deliverBy`, `judgeBy`, `fallbackBy`, `appealWindowSec`, `appealDecideSec` | yes | section 6.1 |
| `timing.maxSubmissions` | **no** | the contract takes attempt 1 only (`R:624`) |
| `timing.disputeBy`, `disputeJudgeSec`, `disputeFallbackSec` | **no** | never read |
| `settlement.mode`, `settlement.token` | yes, by construction: the hash uses the constant `guaranteed_on_decision` and the price token | `T:286` |
| `remedy` | **no**: an opaque hash. A reject always refunds the price in full | `T:287`, `R:356-357` |
| `createdAt` | **no** | `T:291` |

### 8.2 The other signed messages

| Message, signer | Field | Enforced | Where |
| --- | --- | --- | --- |
| Acceptance, primary | `seedCommitment` | on its low 144 bits only (known issue L-4) | `R:213`, `R:289` |
| | `bondReserved` | `≥ P`; the vault reserves `P`, not this amount | `R:205`, `R:215` |
| | `expiresAt` | yes | `R:204` |
| | `nonce` | no | |
| Agree, buyer | `expiresAt` | yes | `R:204` |
| | `nonce` | no | |
| Delivery, seller | `attempt` | must be 1 | `R:624` |
| | `ciphertext`, `plaintextSha256`, `plaintextMime` | no: bound only, through the posted hash | `R:625-628` |
| | `encryptedKeys` | its hash, when a key is released by early accept or settlement. The recipients are not checked; core checks all four (`packages/core/src/state.ts:292-294`) | `R:404`, `R:446`, `R:632-637` |
| | `submittedAt` | **no** | |
| Decision, the adjudicator whose turn it is | `attempt`, `deliveryHash`, `role`, `outcome` | yes | `R:275-280` |
| | `seed` | yes | `R:289`, `R:292` |
| | `judgmentRecordHash` | no: emitted | `R:302` |
| | `keyForBuyer` | present on an accept, absent otherwise and on a Refunded deal. The contract cannot check the ciphertext | `R:283`, `R:350` |
| | `appealGround` | empty at first instance; **not checked** for the appeal role | `R:313` |
| | `beacon.round`, `value`, `signature` | for the fallback and appeal roles; **not checked** for the primary | `R:290-297` |
| | `beacon.source` | **no** | `T:369` |
| | `encryptedKeys` | **no** | `T:384` |
| | `expiresAt` | yes | `R:243` |
| | `nonce` | no | |
| EarlyAccept, buyer | `attempt`, `deliveryHash`, `expiresAt` | yes | `R:399`, `R:403` |
| | `nonce` | no | |
| MutualSettlement, buyer and seller | `hasDelivery`, `releaseKey`, `payouts`, `expiresAt` | yes | `R:434-435`, `R:444`, `R:466`, `R:477` |
| | `deliveryHash` | outside Held, and with a key. **Not checked** in Held without a key (finding F-1) | `R:439`, `R:445` |
| | `nonce` | no | |
| Appeal, the appellant | `appellant`, `appellantAddress` | yes | `R:511-513` |
| | `bond` | pulled in full; no minimum (known issue L-3) | `R:516`, `B:97-101` |
| | `grounds` | no: bound only | |
| | `filedAt` | **no** | |

No message's nonce is stored. Each signed message applies at most once because its step leaves the row it needs, and the commitment ID and the EIP-712 domain stop a replay on another deal or deployment [inferred from section 3].

### 8.3 Verdicts on the signed fields the contract does not enforce

The plan counts nine such fields (IS-13). Its list names ten: rows 1 to 10 below. This read adds six more, rows 11 to 16.

Verdicts: **enforce** (the contract refuses a value it cannot honour), **remove** (take the field out of the signed type, which needs an ADR and a schema version), or **assumption** (the field is signed for the record; the NatSpec and the agent docs say so). The rule applied: where the schema or core refuses a value, the contract refuses it too, because a step the contract takes and core refuses leaves the operators' view of the deal behind ([`neutrality.md`](../neutrality.md), residual 13).

| # | Field | Verdict | Reason |
| --- | --- | --- | --- |
| 1 | `timing.maxSubmissions` | **Enforce:** refuse terms where it is not 1 | The contract takes one attempt (`R:624`). The schema allows 1 to 3, so parties can sign a second attempt that settlement cannot process. One comparison at `agreeAndFund`; it belongs with scope cut SC-5 |
| 2 | `timing.disputeBy` | **Enforce:** refuse nonzero | An optimistic-mode field. The schema forbids it in `guaranteed_on_decision` (`commitment.schema.json:829-863`), the only mode the contract settles (`T:286`); core encodes its absence as zero (`packages/core/src/eip712.ts:353`) |
| 3 | `timing.disputeJudgeSec` | **Enforce:** refuse nonzero | The same |
| 4 | `timing.disputeFallbackSec` | **Enforce:** refuse nonzero | The same |
| 5 | `createdAt` | **Assumption** | The seller's claim of when it wrote the terms. No deadline derives from it, and any value settles the same way. Refusing a future value would restrict a parameter the parties manage (D31) |
| 6 | Delivery `submittedAt` | **Assumption** | The seller's claim. The delivery's time for every deadline is the block time of the call that lands it (`R:623`) |
| 7 | Appeal `filedAt` | **Assumption;** it leaves with scope cut SC-7 | The filing's time is the block time, stored as `t2` (`R:515`) |
| 8 | Decision `appealGround`, appeal role | **Enforce empty for every role** once SC-7 lands; **assumption** if party appeals stay | Without party appeals the field has no meaning, and the first-instance check (`R:313`) becomes the rule for every decision. With party appeals it records the appeal adjudicator's reason, which the contract cannot judge |
| 9 | Decision `beacon.source` | **Assumption;** **enforce by construction** if scope cut SC-8 lands | The contract proves the round against its immutable beacon, so the name is a label. If SC-8 removes the on-chain proof, the name is the only link to a beacon, and the contract hashes its deployment's source name the way it hashes the settlement mode |
| 10 | Decision `encryptedKeys` | **Assumption** | The envelopes an escalating adjudicator hands to the next one (ADR-0020). The contract sees a hash and cannot check a ciphertext |
| 11 | Decision `beacon.round`, `value`, `signature`, primary role | **Enforce empty** | A primary's seed is its own commit-reveal and uses no beacon. Unchecked, a primary can sign beacon data that a reader may take as proven |
| 12 | Acceptance `bondReserved` above `P` | **Enforce equality** while bonds stay; **assumption** for phase one under SC-7, **remove** at the next schema version | The vault reserves `P` whatever the field says. With no vault the field has nothing to reserve; dropping the check changes no signed type, and removing the field needs a schema version. The scope ADR picks |
| 13 | Acceptance `seedCommitment`, high 112 bits | **Enforce** | Known issue L-4; the fix is already planned |
| 14 | MutualSettlement `deliveryHash` in Held | **Enforce** core's rule, or change core, ADR-0019 and the formal model to the contract's | Finding F-1 |
| 15 | `remedy` | **Assumption** | The schema fixes it to `full_refund`, which is what a reject does. A second remedy would need a schema version and contract code |
| 16 | Delivery `encryptedKeys` recipients; Decision `keyForBuyer` content | **Assumption** | The contract sees hashes and ciphertext. Core checks the recipients; the buyer checks the key it receives |

The nonces of the five messages that carry one, and the missing expiry on an appeal, are assumptions too: the stage stops a replay, and the appeal window bounds a signed appeal's life.

## 9. Scope-cut branches

The plan proposes eight cuts. This page specifies the machine as deployed; each cut changes it as follows. SC-7 is accepted; SC-4 and SC-8 wait for the maintainer; the others proceed unless stopped. The scope ADR records the answers.

| Cut | State of the decision | Effect on this model |
| --- | --- | --- |
| SC-1: one settlement token per deployment | proceeds | `t.token` becomes a constant. Aggregate invariant 3 (section 5.3) holds by the choice of token |
| SC-2: ERC-3009 funding only | proceeds | `agreeAndFund` loses the method guard (`R:205`) and one collector |
| SC-3: a settlement pays the buyer and the seller only | proceeds | L35 to L37: every payout goes to the buyer or the seller; the all-fee captures go (`R:470-475`) |
| SC-4: plain-key signatures only | open | No row changes. The threat model's contract-signer assumption goes |
| SC-5: refuse a zero price and deadlines out of order | proceeds | Section 6.3's table empties. `H > 0` becomes `P > 0`. Verdicts 1 to 4 of section 8.3 fit the same check |
| SC-6: no on-chain record of an unfunded offer's expiry | proceeds | L02, `expireOffer` and `Stage.Expired` go: 36 rows |
| SC-7: no party appeals and no bonds | **accepted** | L11 to L30 go. L07 to L10 become final at the decision. `fileAppeal`, `expireAppeal`, the appeal branch of `decide`, the `appeal` field, the flags, `t2` and every vault column go. Classes I05, I06, I08 to I10, I12 and I15 go with them; I07 and I11 shrink. Six final outcomes remain: `released`, `refunded`, `accepted_early`, `reclaimed`, `defaulted` and `settled`. 17 rows remain (L01 to L10, L31 to L37), and 16 with SC-6. L07 to L10 merge into two rows if the new word does not record which adjudicator decided |
| SC-8: no on-chain proof of the beacon | open | The beacon guards of the fallback and escalation decisions (`R:290-297`) go; `fallbackRound` and `escalationRound` become values the decision carries. Verdict 9 changes |

## 10. Where this page differs from the formal model, core and the docs

`formal/Holdback.tla` at `26d4670` models `packages/core/src/state.ts`, not the contract. Its README's contract column still reads TBD (known issue G-3). The differences [measured against the cited lines of the model]:

| # | The formal model | The contract |
| --- | --- | --- |
| 1 | Has the states Offered, AcceptedByAdjudicator and Agreed (`Holdback.tla:52`) | Stores nothing before funding: L01 to L03 is one call (`R:193-219`). `expireOffer` runs for any terms, offered or not (`R:523-530`) |
| 2 | `Defaulted` is a state, and `ApplyDefault` a second step (`:338-360`) | `triggerDefault` refunds in one call (`R:556-569`); there is no Defaulted row |
| 3 | The default outcome pays the seller from the liable bonds (`:351-355`) | A default pays the seller nothing (`R:596-611`; known issue I-8) |
| 4 | An appeal pays an appeal fee to the appeal adjudicator (`:274-276`, `:301`) | There is no appeal fee |
| 5 | `EscrowMatchesState`: the escrow holds `H` exactly while funded (`:460`) | False from the escrow's expiry: section 5.2 |
| 6 | Bonds start large enough and no step checks coverage (`:117`) | Funding and the fallback's decision revert when the free bond is below `P` (`B:75-76`); reservations are not modelled |
| 7 | Early accept and the primary's decision need Delivered (`:195`, `:221`) | Both also run in Held, carrying the delivery, under `deliverBy` (`R:244-248`, `R:401`) |
| 8 | A settlement releases a key only after a delivery: `releaseKey => esc # "Held"` (`:255`) | A settlement in Held can name a delivery and release its key (`R:435-447`): finding F-1 |
| 9 | A settlement splits the price between the seller and the buyer (`:259`) | Payouts go to any address (`R:470-475`); SC-3 cuts this |
| 10 | The absolute deadlines are strictly ordered (`:14-15`) | Not checked: section 6.3 |
| 11 | No message expiry; early accept and settlement have no time limit | Message expiries are enforced; a capture reverts from the escrow's expiry (`E:277`) |
| 12 | `via` records how each deal closed (`:58`) | The word records only which adjudicator decided first (flag 8); L32 has three causes |

Other documents:

- [`docs/architecture.md`](../architecture.md), the transition table, says early accept needs the state Delivered. The contract also takes it in Held with the delivery (`R:398-401`). The plan's IS-8.
- [`docs/neutrality.md`](../neutrality.md), the adjudicator rows, says defaulting adjudicators' bonds compensate the seller. The contract pays none. [`known-issues.md`](known-issues.md) section 8 already records this.
- The comment at `R:52` calls `t1` "decidedAt, escalatedAt or fallbackSince". After an escalation decision (L31, L32) `t1` is still the escalation's time; the decision's time is in no field.
- `packages/core/src/state.ts:516-518` refuses a settlement in Held that names a delivery or releases a key; ADR-0019 says the same. The contract accepts it: finding F-1.

## 11. Findings

No Critical, High or Medium finding. None moves money outside what the parties signed.

**F-1 · Low · The contract takes a settlement that core, ADR-0019 and the formal model refuse.** In Held, `mutualSettle` accepts a settlement with `hasDelivery = true`: it checks the named hash against nothing unless a key is released, and with `releaseKey` it releases the buyer's envelope from a delivery that was never posted (`R:435-447`). Core refuses both (`packages/core/src/state.ts:516-518`), and the formal model has `releaseKey => esc # "Held"`. The contract's behaviour is deliberate: `contracts/test/unit/LateCarriedDelivery.t.sol:84` tests a settlement for late work. Impact: both parties signed, so the money is theirs to move; the deal ends in L35 with a `KeyReleased` event and no posted delivery, and an operator that mirrors the chain through core refuses the step (residual 13, case 4). Next action: the scope ADR's owner decides which side is right, then core, ADR-0019 and the formal model, or the contract, change to match.

**F-2 · Info · A zero appeal-decision window is accepted and makes an escalation undecidable.** With `appealDecideSec = 0` the escalation decision needs `now < t1`, which never holds (`R:264`, `R:286`), so every escalated case defaults at once. The schema requires at least 1 second; the contract does not check. Impact: none beyond the terms the parties signed. Next action: fold `W ≥ 1` and `D ≥ 1` into scope cut SC-5's order check.

**F-3 · Info · The plan's count of unenforced signed fields is low.** The plan says nine and lists ten; this read finds sixteen (section 8.3), among them the beacon fields of a primary's decision and the acceptance's `bondReserved` above the price. Impact: the NatSpec and the agent docs would under-state what is signed for the record. Next action: the scope ADR and the NatSpec package use section 8.3.

Confirmed and unchanged from the plan, with no new severity: IS-1 (reservations exist only as flag bits; class I08 and invariant 1), IS-3 (L06, L32 and L37 each have more than one cause), IS-4 (section 7), IS-5 (section 6.3), IS-6 (section 5.2), IS-11 (section 5.3).

## Where this page did not look

- **Not run:** no test, no `forge build`, no model check. Every "unreachable" is from reading each write to the word.
- **Not read in full:** the two collectors, `TokenStore.sol`, Solady's signature library beyond the plan's note that a zero signer fails, and the test handler.
- **Assumed:** a token that moves exactly the amount asked and lets every transfer through; block time between 1 and 2^40 − 1; no delivery or seed that hashes to zero.
