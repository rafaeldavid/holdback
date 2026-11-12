----------------------------- MODULE Holdback -----------------------------
(***************************************************************************)
(* The commitment state machine of packages/core/src/state.ts, in          *)
(* guaranteed_on_decision mode, as a spec that the rules contract and      *)
(* SimChain are checked against.                                           *)
(*                                                                          *)
(* Two profiles, one specification (T-376). Profile is core's              *)
(* SettlementProfile (state.ts):                                           *)
(*   "full"      the whole protocol, which SimChain runs: party appeals,   *)
(*               adjudicator bonds, a recorded offer expiry, a default in  *)
(*               two steps with compensation from bonds.                   *)
(*   "phase_one" what contracts/src/HoldbackRules.sol settles (ADR-0031,   *)
(*               ADR-0033): no party appeal, no bond, no Expire step, a    *)
(*               default in one call, funding until offerExpiresAt, and a  *)
(*               delivery that an early accept or the primary's decision   *)
(*               may carry in Held.                                        *)
(* Every action both profiles share is written once. P1 gates what differs, *)
(* so a search for "P1" lists every difference. The invariant PhaseOneCuts *)
(* states what the phase-one profile never reaches.                        *)
(*                                                                          *)
(* Actors: buyer, seller, primary / fallback / appeal adjudicators, an      *)
(* operator node, the randomness beacon, the buyer's payment address when  *)
(* it is apart from the buyer, and "anyone" (the permissionless timeout    *)
(* trigger). Named actors get no fairness: each may stop at any time.      *)
(* Halted names one actor that is certain to stop at some point (Crash,    *)
(* weakly fair) and acts no more after it; "any" lets the check choose the *)
(* actor. Only the "anyone" triggers and the passage of time are weakly    *)
(* fair. A signature is "the named actor took the step": a step that needs *)
(* a signature needs that actor not crashed, and the property Signed holds *)
(* every step to the signers it records.                                   *)
(*                                                                          *)
(* Time: each commitment's absolute deadlines are strictly ordered         *)
(* (timing.ts: offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy; *)
(* HoldbackRules.agreeAndFund refuses any other order), so clk[c] counts   *)
(* how many have passed. Relative deadlines (the escalation's              *)
(* appealDecideBy; appealBy and appealDecideBy) start at the deciding step *)
(* and have their own counters. Every tick is a separate step, so every    *)
(* interleaving of deadlines across commitments and actions is explored:   *)
(* an action is on time iff its deadline has not passed (at < deadline);   *)
(* a timeout fires iff it has (at >= deadline).                            *)
(*                                                                          *)
(* Money (ADR-0033): the buyer and the seller sign; two addresses named in *)
(* the terms hold the money. PayAddr (buyerPaymentAddress) funds the hold  *)
(* and receives every refund. PayoutAddr (sellerPayoutAddress) receives    *)
(* every payment to the seller. Apart names the parties whose money        *)
(* address differs from their signing address; for the others the two are  *)
(* one account. Amounts are fixed small constants in abstract units.       *)
(*                                                                          *)
(* The ledger out[c] is an observer, not a rule: in each step that debits  *)
(* escrow[c] it adds what the step itself credited to PayAddr, to          *)
(* PayoutAddr and to each fee account. The properties compare it with how  *)
(* the deal closed, so a payment that lands anywhere else is caught.       *)
(*                                                                          *)
(* CPP (T-337): escrow[c] is Commerce Payments' hold. From its            *)
(* authorizationExpiry (fallbackBy + appealDecideSec + EXPIRY_MARGIN) no    *)
(* capture succeeds, a void still does, and the payer alone (PayAddr) may  *)
(* reclaim the hold on CPP directly, outside the rules contract. The rules *)
(* contract's timeouts then close the deal and move no money.              *)
(*                                                                          *)
(* Bonds (T-337, full profile only): bond[a] is the posted bond, enc[a]    *)
(* the encumbered part, and flags[c] names the adjudicators whose bond is  *)
(* encumbered for commitment c.                                            *)
(*                                                                          *)
(* Bug selects a deliberately broken variant for formal/broken/ ("none" is *)
(* the model itself).                                                      *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS C,        \* commitment ids (model values)
          Halted,   \* "none" or the one named actor that halts
          Bug,      \* "none" or the broken variant to check
          Profile,  \* "full" or "phase_one"
          Apart     \* the parties whose money address is apart from their signing address

P1 == Profile = "phase_one"

Price == 2
Fee == 1
Hold == Price + Fee
ApBond == 1    \* appeal bond (full profile)
ApFee == 1     \* appeal fee (full profile)
Comp == 1      \* default-outcome compensation per liable bond (full profile, abstracted)

Parties == {"buyer", "seller"}
Adjs == {"primary", "fallback", "appeal"}

\* The two money addresses of the terms (ADR-0033). The contract compares neither with a signing address.
PayAddr == IF "buyer" \in Apart THEN "buyer_pay" ELSE "buyer"
PayoutAddr == IF "seller" \in Apart THEN "seller_payout" ELSE "seller"
Holders == Parties \cup {PayAddr, PayoutAddr}

\* The payment address signs the funding and its own reclaim on CPP, so it is an actor. The payout address signs nothing.
Named == Parties \cup Adjs \cup {"operator", "beacon", PayAddr}

SharedBugs == {"none", "second_capture", "operator_authors", "early_reclaim", "key_separate", "buyer_only_timeout",
               "double_refund", "late_judge_by", "capture_after_expiry", "refund_to_signer", "pay_signer",
               "fund_from_signer", "early_accept_keeps_fee", "reject_releases_key", "reject_refunds_fee",
               "settle_alone", "fund_without_payer", "early_fallback", "late_delivery", "wrong_decider"}
FullBugs == {"mint", "keep_bond_after_cpp", "slash_keeps_enc", "overturn_pays_signer"}
P1Bugs == {"default_pays_fee", "late_early_accept", "fund_after_expiry", "expire_recorded"}

ASSUME Profile \in {"full", "phase_one"}
ASSUME Apart \subseteq Parties
\* Halted: "none", one named actor, or "any": one actor stops, and the check covers each choice of which.
ASSUME Halted \in Named \cup {"none", "any"}
ASSUME Bug \in SharedBugs \cup (IF P1 THEN P1Bugs ELSE FullBugs)
ASSUME Bug = "overturn_pays_signer" => Apart = Parties
\* A fault that pays or debits a signing address shows only where that address is apart from the money address.
ASSUME Bug \in {"refund_to_signer", "fund_from_signer"} => "buyer" \in Apart
ASSUME Bug = "pay_signer" => "seller" \in Apart

EscStates == {"None", "Offered", "AcceptedByAdjudicator", "Agreed", "Held", "Delivered",
              "FallbackJudging", "Escalated", "Defaulted", "Released", "Refunded", "Expired", "Settled"}
PreFunded == {"None", "Offered", "AcceptedByAdjudicator", "Agreed"}
Funded == {"Held", "Delivered", "FallbackJudging", "Escalated", "Defaulted"}
Settleable == {"Held", "Delivered", "FallbackJudging", "Escalated"}   \* mutual settlement (ADR-0019)
MoneyDone == {"Released", "Refunded", "Settled"}
\* via: how the escrow was settled. primary / fallback = first instance (appealable in the full profile).
Vias == {"na", "primary", "fallback", "early", "escalation", "reclaim", "default_fb", "default_esc", "mutual"}
ApStates == {"na", "none", "open", "upheld", "overturned", "expired"}

VARIABLES
  esc,        \* escrow state per commitment (state.ts EscrowState.kind; "None" = not yet offered)
  via,        \* ReleaseVia / RefundVia, and Defaulted.from
  ap,         \* AppealState.kind; "na" where no appeal state exists
  appellant,  \* "na", "buyer" or "seller"
  clk,        \* absolute deadlines passed: 1 offerExpiresAt .. 5 fallbackBy
  escClk,     \* 1 = the escalation's appealDecideBy passed
  apClk,      \* 1 = appealBy passed, 2 = the appeal's appealDecideBy passed
  key,        \* the buyer can read the delivery (content key released to it)
  moves,      \* steps that debited escrow[c]
  out,        \* the ledger: what escrow[c] paid to PayAddr, to PayoutAddr and to each fee account (an observer)
  down,       \* the actor that has crashed, or "none"
  wallet, escrow, fees, bond, apBond, apFee,  \* accounts
  cppExp,     \* CPP's authorizationExpiry has passed (tracked while the commitment is funded)
  cppRec,     \* the payment address reclaimed the hold on CPP directly
  enc,        \* HoldbackBonds.encumberedOf per adjudicator (bond is bondOf); full profile
  flags,      \* the adjudicators whose bond is encumbered for this commitment; full profile
  act         \* history: the last step's name, signers and commitment, and that commitment's state before it

(***************************************************************************)
(* RF-4, the marked place (T-376 second pass; waits for T-375's refactor).  *)
(* Once HoldbackRules.sol stores a closing reason and a decider in the     *)
(* deal's word (docs/audit/state-model.md, section 9.2), this model gains  *)
(*   reason[c]  \in {"open", "decided", "accepted_early", "settled",       *)
(*                   "reclaimed", "defaulted"}                             *)
(*   decider[c] \in {"none"} \cup Adjs                                     *)
(* written in the step that closes the deal, and two properties:           *)
(*   ReasonRules: reason = "open" exactly while esc \notin MoneyDone;      *)
(*     decider # "none" exactly when reason = "decided"; neither changes   *)
(*     after the close.                                                    *)
(*   ReasonMatchesMoney: the reason matches the money that moved.          *)
(*     "decided": out = the price to PayoutAddr (accept) or to PayAddr     *)
(*       (reject), and the fee to the decider's account and no other.      *)
(*     "accepted_early": the price to PayoutAddr, the fee to PayAddr.      *)
(*     "settled": the seller's share to PayoutAddr, the rest and the fee   *)
(*       to PayAddr, no fee account paid.                                  *)
(*     "reclaimed", "defaulted": the whole hold to PayAddr.                *)
(* PaidAsClosed below already states that table over via, the model's own  *)
(* record of how a deal closed. Until the contract stores the two fields,  *)
(* they are not modelled.                                                  *)
(***************************************************************************)

money == <<wallet, escrow, fees, bond, apBond, apFee>>
led == <<moves, out>>
cppv == <<cppExp, cppRec>>
bondv == <<enc, flags>>
vars == <<esc, via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv, act>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE x \in S : TRUE IN f[x] + SumOver(f, S \ {x})

Total == SumOver(wallet, Holders) + SumOver(escrow, C) + SumOver(fees, Adjs)
         + SumOver(bond, Adjs) + SumOver(apBond, C) + SumOver(apFee, C)

N == Cardinality(C)
\* Phase one: the payment address holds the price and the fee of each commitment, and nobody else holds anything.
\* Full: each party's signing address also holds its appeal stake (ADR-0033 section 4: a stake made by a later
\* signature stays with the signer), and each adjudicator posts a bond.
InitialTotal == N * Hold + (IF P1 THEN 0 ELSE 2 * N * (ApBond + ApFee) + 3 * N * Price)

\* An actor acts only while it has not crashed. A signature is "the named actor took the step", so a step that
\* needs an actor's signature needs Can of that actor.
Can(a) == a # down

\* Who may fire a timeout: anyone (the operator and every party included), or under the
\* buyer_only_timeout bug the buyer alone.
Trig == IF Bug = "buyer_only_timeout" THEN Can("buyer") ELSE TRUE
TrigSigners == IF Bug = "buyer_only_timeout" THEN {"buyer"} ELSE {}

\* Signed party messages reach the settlement layer through an operator or directly (ADR-0005).
\* The relay changes nothing in the state: an operator relays, it never authors.
Relays == {"direct"} \cup (IF Can("operator") THEN {"operator"} ELSE {})

Act(name, signers, c) == act' = [name |-> name, signers |-> signers, c |-> c, from |-> esc[c]]

\* The deciding adjudicator's deadline has not passed (judgeBy, fallbackBy, the escalation's appealDecideBy).
OnTime(c) == CASE esc[c] = "Delivered" -> clk[c] < 4
               [] esc[c] = "FallbackJudging" -> clk[c] < 5
               [] esc[c] = "Escalated" -> escClk[c] < 1
               [] OTHER -> FALSE

\* The last deadline funding can meet: fundBy on SimChain, where agreeing and funding are two steps; offerExpiresAt
\* on the contract, where they are one call (ADR-0031 section 6, "One funding deadline").
FundBy == IF P1 THEN 1 ELSE 2
FundGuard == IF Bug = "fund_after_expiry" THEN 2 ELSE FundBy

\* HoldbackBonds.freeOf: posted minus encumbered.
Free(a) == bond[a] - enc[a]

\* Release every bond held for the deal: the price back to free for each flagged adjudicator. An overturn's slash
\* shrinks the encumbrance by the same price, so it uses this too. Phase one flags nobody, so this changes nothing.
ReleaseAll(c) ==
  /\ enc' = [a \in Adjs |-> IF a \in flags[c] THEN enc[a] - Price ELSE enc[a]]
  /\ flags' = [flags EXCEPT ![c] = {}]

\* HoldbackRules._refundAll: what the void returns. After the payer's CPP reclaim nothing is held, and the
\* contract skips the void (the M-1 fix). The double_refund bug pays again.
Refunds(c) == IF cppRec[c] /\ Bug # "double_refund" THEN 0 ELSE Hold

\* What leaves escrow[c] in this step, and the ledger's record of where it landed. The ledger reads the step's own
\* changes to the two money addresses and the fee accounts, so wallet' and fees' are set before this. fromBonds is
\* what the same step paid PayoutAddr from bonds (the full profile's default compensation), which is not escrow money.
Debit(c, amount, fromBonds) ==
  /\ escrow' = [escrow EXCEPT ![c] = @ - amount]
  /\ moves' = [moves EXCEPT ![c] = @ + (IF amount > 0 THEN 1 ELSE 0)]
  /\ out' = [out EXCEPT ![c] = [pay |-> @.pay + (wallet'[PayAddr] - wallet[PayAddr]),
                                payout |-> @.payout + (wallet'[PayoutAddr] - wallet[PayoutAddr]) - fromBonds,
                                fee |-> [a \in Adjs |-> @.fee[a] + (fees'[a] - fees[a])]]]

\* _refundAll releases the deal's bonds whether or not the payer reclaimed on CPP. The keep_bond_after_cpp bug
\* forgets them after a CPP reclaim (the shape of T-206 M-1 before its fix: the deal closes, the bond stays locked).
CloseBonds(c) == IF Bug = "keep_bond_after_cpp" /\ cppRec[c] THEN UNCHANGED bondv ELSE ReleaseAll(c)

NoFees == [a \in Adjs |-> 0]

Init ==
  /\ esc = [c \in C |-> "None"]
  /\ via = [c \in C |-> "na"]
  /\ ap = [c \in C |-> "na"]
  /\ appellant = [c \in C |-> "na"]
  /\ clk = [c \in C |-> 0]
  /\ escClk = [c \in C |-> 0]
  /\ apClk = [c \in C |-> 0]
  /\ key = [c \in C |-> FALSE]
  /\ moves = [c \in C |-> 0]
  /\ out = [c \in C |-> [pay |-> 0, payout |-> 0, fee |-> NoFees]]
  /\ down = "none"
  /\ wallet = [h \in Holders |-> (IF h = PayAddr THEN N * Hold ELSE 0)
                                 + (IF h \in Parties /\ ~P1 THEN N * (ApBond + ApFee) ELSE 0)]
  /\ escrow = [c \in C |-> 0]
  /\ fees = NoFees
  /\ bond = [a \in Adjs |-> IF P1 THEN 0 ELSE N * Price]
  /\ apBond = [c \in C |-> 0]
  /\ apFee = [c \in C |-> 0]
  /\ cppExp = [c \in C |-> FALSE]
  /\ cppRec = [c \in C |-> FALSE]
  /\ enc = [a \in Adjs |-> 0]
  /\ flags = [c \in C |-> {}]
  /\ act = [name |-> "init", signers |-> {}, c |-> CHOOSE c \in C : TRUE, from |-> "None"]

-----------------------------------------------------------------------------
(* Signed messages *)

\* offer (state.ts offer): the seller's signed terms, before offerExpiresAt. On the contract nothing is stored
\* before funding: this step, AdjAccept and Agree are the three signatures agreeAndFund checks.
Offer(c) ==
  /\ Can("seller") /\ \E r \in Relays : TRUE
  /\ esc[c] = "None"
  /\ esc' = [esc EXCEPT ![c] = "Offered"]
  /\ Act("offer", {"seller"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv>>

\* adjudicator_accept: the primary accepts (seed commitment; a bond reserved in the full profile, 0 in phase one)
\* before offerExpiresAt.
AdjAccept(c) ==
  /\ Can("primary")
  /\ esc[c] = "Offered" /\ clk[c] < 1
  /\ esc' = [esc EXCEPT ![c] = "AcceptedByAdjudicator"]
  /\ Act("adjudicator_accept", {"primary"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv>>

\* agree: the buyer signs the same terms hash before offerExpiresAt.
Agree(c) ==
  /\ Can("buyer") /\ \E r \in Relays : TRUE
  /\ esc[c] = "AcceptedByAdjudicator" /\ clk[c] < 1
  /\ esc' = [esc EXCEPT ![c] = "Agreed"]
  /\ Act("agree", {"buyer"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv>>

\* fund: the payment address's funding authorization (ADR-0033), before FundBy. Posting PayAddr -> escrow
\* (price + fee). Full profile: the primary's bond is encumbered for the price, and uncovered funding is refused.
\* Phase one has no bond. The fund_from_signer bug pulls the money from the buyer's signing address; under
\* fund_without_payer the buyer's signing key alone is enough to fund.
Fund(c) ==
  /\ Can(IF Bug = "fund_without_payer" THEN "buyer" ELSE PayAddr) /\ \E r \in Relays : TRUE
  /\ esc[c] = "Agreed" /\ clk[c] < FundGuard
  /\ IF P1 THEN UNCHANGED bondv
           ELSE /\ Free("primary") >= Price
                /\ enc' = [enc EXCEPT !["primary"] = @ + Price]
                /\ flags' = [flags EXCEPT ![c] = {"primary"}]
  /\ esc' = [esc EXCEPT ![c] = "Held"]
  /\ wallet' = [wallet EXCEPT ![IF Bug = "fund_from_signer" THEN "buyer" ELSE PayAddr] = @ - Hold]
  /\ escrow' = [escrow EXCEPT ![c] = @ + Hold]
  /\ Act("fund", {PayAddr}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, fees, bond, apBond, apFee, cppv>>

\* deliver: the seller's delivery (attempt 1), before deliverBy. The late_delivery bug drops the deadline.
Deliver(c) ==
  /\ Can("seller") /\ \E r \in Relays : TRUE
  /\ esc[c] = "Held" /\ (clk[c] < 3 \/ Bug = "late_delivery")
  /\ esc' = [esc EXCEPT ![c] = "Delivered"]
  /\ Act("deliver", {"seller"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv>>

\* A decision's release or refund of the escrow in one step; on accept the buyer's key moves in the same step
\* (ADR-0012), except under the key_separate bug. Accept: escrow -> PayoutAddr (price). Reject: escrow -> PayAddr
\* (price). Either way escrow -> the deciding adjudicator (fee). The pay_signer bug pays the seller's signing
\* address; reject_refunds_fee returns the fee to the buyer as well as paying it; reject_releases_key hands the
\* buyer the key of a refunded deal.
Settle(c, accept, adj) ==
  /\ wallet' = [wallet EXCEPT ![IF accept THEN (IF Bug = "pay_signer" THEN "seller" ELSE PayoutAddr) ELSE PayAddr]
                                 = @ + Price + (IF ~accept /\ Bug = "reject_refunds_fee" THEN Fee ELSE 0)]
  /\ fees' = [fees EXCEPT ![adj] = @ + Fee]
  /\ Debit(c, Hold, 0)
  /\ key' = [key EXCEPT ![c] = @ \/ (accept /\ Bug # "key_separate") \/ (~accept /\ Bug = "reject_releases_key")]

\* A first-instance decision (state.ts firstInstance): accept, reject or escalate.
\* Escalate moves no money and releases every bond held for the deal (ADR-0016 section 1). Accept and reject capture
\* on CPP, so they need the authorization unexpired. Full profile: the appeal window opens; the primary's bond stays
\* encumbered until the appeal closes; a fallback decision releases the primary's and encumbers the fallback's,
\* which needs it covered. Phase one: the decision is final at once (state.ts: appeal "expired", no appeal).
FirstInstance(c, role, o) ==
  /\ IF o = "escalate"
       THEN /\ esc' = [esc EXCEPT ![c] = "Escalated"]
            /\ escClk' = [escClk EXCEPT ![c] = 0]
            /\ ReleaseAll(c)
            /\ UNCHANGED <<via, ap, apClk, key, led, money>>
       ELSE /\ ~cppExp[c]
            /\ esc' = [esc EXCEPT ![c] = IF o = "accept" THEN "Released" ELSE "Refunded"]
            /\ via' = [via EXCEPT ![c] = role]
            /\ ap' = [ap EXCEPT ![c] = IF P1 THEN "expired" ELSE "none"]
            /\ apClk' = [apClk EXCEPT ![c] = 0]
            /\ Settle(c, o = "accept", role)
            /\ IF role = "primary" \/ P1
                 THEN UNCHANGED bondv
                 ELSE /\ Free("fallback") >= Price
                      /\ enc' = [a \in Adjs |-> IF a = "fallback" THEN enc[a] + Price
                                                ELSE IF a \in flags[c] THEN enc[a] - Price ELSE enc[a]]
                      /\ flags' = [flags EXCEPT ![c] = {"fallback"}]
            /\ UNCHANGED <<escClk, bond, apBond, apFee>>
  /\ UNCHANGED <<appellant, clk, down, cppv>>

\* decide by the primary, before judgeBy. Its seed is its own commit-reveal: no beacon. In Delivered in both
\* profiles. Phase one also takes it in Held: HoldbackRules.decide lands the seller-signed delivery the decision
\* carries, which must come before deliverBy, and decides in the same call. Under second_capture the primary may
\* also decide again after the commitment settled.
DecidePrimary(c, o) ==
  /\ Can("primary")
  /\ \/ /\ esc[c] \in (IF Bug = "second_capture" THEN {"Delivered", "Released", "Refunded"} ELSE {"Delivered"})
        /\ clk[c] < 4
        /\ Act("decide", {"primary"}, c)
     \/ /\ P1 /\ esc[c] = "Held" /\ clk[c] < 3 /\ Can("seller")
        /\ Act("decide", {"primary", "seller"}, c)
  /\ FirstInstance(c, "primary", o)

\* decide by the fallback in FallbackJudging, before fallbackBy; needs the beacon round at judgeBy. Under the
\* wrong_decider bug its decision pays the fee to the primary and is recorded as the primary's.
DecideFallback(c, o) ==
  /\ Can("fallback") /\ Can("beacon")
  /\ esc[c] = "FallbackJudging" /\ clk[c] < 5
  /\ FirstInstance(c, IF Bug = "wrong_decider" THEN "primary" ELSE "fallback", o)
  /\ Act("decide", {"fallback"}, c)

\* decide by the appeal adjudicator in Escalated, before its appealDecideBy (state.ts escalationDecision).
\* Final in both profiles; cannot escalate. The fee goes to the appeal adjudicator.
DecideEscalated(c, o) ==
  /\ Can("appeal") /\ Can("beacon")
  /\ esc[c] = "Escalated" /\ escClk[c] < 1
  /\ o \in {"accept", "reject"}
  /\ ~cppExp[c]
  /\ esc' = [esc EXCEPT ![c] = IF o = "accept" THEN "Released" ELSE "Refunded"]
  /\ via' = [via EXCEPT ![c] = "escalation"]
  /\ Settle(c, o = "accept", "appeal")
  /\ ReleaseAll(c)
  /\ Act("decide", {"appeal"}, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, down, bond, apBond, apFee, cppv>>

\* Escrow effect of early acceptance: escrow -> PayoutAddr (price); escrow -> PayAddr (fee: no adjudicator judged);
\* key released. The early_accept_keeps_fee bug pays the fee to the primary instead.
EarlyAcceptEffect(c) ==
  /\ ~cppExp[c] \/ Bug = "capture_after_expiry"
  /\ esc' = [esc EXCEPT ![c] = "Released"]
  /\ via' = [via EXCEPT ![c] = "early"]
  /\ IF Bug = "early_accept_keeps_fee"
       THEN /\ wallet' = [wallet EXCEPT ![PayoutAddr] = @ + Price]
            /\ fees' = [fees EXCEPT !["primary"] = @ + Fee]
       ELSE /\ wallet' = [wallet EXCEPT ![PayoutAddr] = @ + Price, ![PayAddr] = @ + Fee]
            /\ UNCHANGED fees
  /\ Debit(c, Hold, 0)
  /\ key' = [key EXCEPT ![c] = TRUE]
  /\ ReleaseAll(c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, down, bond, apBond, apFee, cppv>>

\* early_accept: the buyer's signature (no deadline beyond the message's own expiry). In Delivered in both
\* profiles. Phase one also takes it in Held (T-376): HoldbackRules.earlyAccept lands the seller-signed delivery
\* the call carries, before deliverBy, and pays in the same call. The late_early_accept bug drops that deadline.
EarlyAccept(c) ==
  /\ Can("buyer") /\ \E r \in Relays : TRUE
  /\ \/ /\ esc[c] = "Delivered"
        /\ Act("early_accept", {"buyer"}, c)
     \/ /\ P1 /\ esc[c] = "Held" /\ Can("seller")
        /\ clk[c] < 3 \/ Bug = "late_early_accept"
        /\ Act("early_accept", {"buyer", "seller"}, c)
  /\ EarlyAcceptEffect(c)

\* Bug operator_authors: the operator submits an early acceptance it signed itself.
OperatorEarlyAccept(c) ==
  /\ Bug = "operator_authors" /\ Can("operator")
  /\ esc[c] = "Delivered"
  /\ EarlyAcceptEffect(c)
  /\ Act("early_accept", {"operator"}, c)

\* Bug key_separate: the key for an accepted decision is released in a later step.
ReleaseKeyLate(c) ==
  /\ Bug = "key_separate"
  /\ esc[c] = "Released" /\ ~key[c]
  /\ key' = [key EXCEPT ![c] = TRUE]
  /\ Act("release_key", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, apClk, led, down, money, cppv, bondv>>

\* mutual_settle (ADR-0019): both parties sign a split of the price; the fee returns to the buyer. The seller's
\* share s goes to PayoutAddr and the rest to PayAddr: phase one refuses any other payee, a signing address that
\* differs from them included (HoldbackRules._payOut, ADR-0033 section 2). releaseKey in every Settleable state:
\* after a delivery it names the posted one; in Held (late work, ADR-0031 SC-5b, T-357) it names and carries a
\* delivery nobody posted, and the key released is the buyer's envelope in it. The model has no delivery identity:
\* both parties' signatures are what bind the key to that delivery, and the key still moves only with the payment.
\* A seller share is a CPP capture (authorization unexpired); an all-buyer split is a void only, which works
\* after the expiry while anything is still held. Under the settle_alone bug the buyer's signature is enough.
MutualSettle(c, s, releaseKey) ==
  /\ Can("buyer") /\ (Can("seller") \/ Bug = "settle_alone") /\ \E r \in Relays : TRUE
  /\ esc[c] \in Settleable
  /\ IF s > 0 THEN ~cppExp[c] ELSE ~cppRec[c]
  /\ esc' = [esc EXCEPT ![c] = "Settled"]
  /\ via' = [via EXCEPT ![c] = "mutual"]
  /\ wallet' = [wallet EXCEPT ![PayoutAddr] = @ + s, ![PayAddr] = @ + (Price - s) + Fee]
  /\ UNCHANGED fees
  /\ Debit(c, Hold, 0)
  /\ key' = [key EXCEPT ![c] = releaseKey]
  /\ ReleaseAll(c)
  /\ Act("mutual_settle", Parties, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, down, bond, apBond, apFee, cppv>>

\* file_appeal (full profile): the party a first-instance decision went against appeals it before appealBy, paying
\* bond and fee from the address that signs the appeal (ADR-0033 section 4). Only that party (T-206 L-7, D43).
FileAppeal(c, p) ==
  /\ ~P1
  /\ Can(p) /\ \E r \in Relays : TRUE
  /\ esc[c] \in {"Released", "Refunded"} /\ via[c] \in {"primary", "fallback"}
  /\ p = IF esc[c] = "Released" THEN "buyer" ELSE "seller"
  /\ ap[c] = "none" /\ apClk[c] < 1
  /\ ap' = [ap EXCEPT ![c] = "open"]
  /\ appellant' = [appellant EXCEPT ![c] = p]
  /\ wallet' = [wallet EXCEPT ![p] = @ - (ApBond + ApFee)]
  /\ apBond' = [apBond EXCEPT ![c] = @ + ApBond]
  /\ apFee' = [apFee EXCEPT ![c] = @ + ApFee]
  /\ Act("file_appeal", {p}, c)
  /\ UNCHANGED <<esc, via, clk, escClk, apClk, key, led, down, escrow, fees, bond, cppv, bondv>>

\* decide on an open appeal (full profile; state.ts stepAppeal), before its appealDecideBy; needs the beacon round
\* after the filing. Upheld: appealbond -> bond of the first-instance adjudicator. Overturned: that bond pays the
\* wronged party's money address the price (ADR-0033 section 4); appealbond -> the appellant's signing address.
\* Either way appealfee -> appeal adjudicator. The escrow is not touched.
DecideAppeal(c, o) ==
  /\ ~P1
  /\ Can("appeal") /\ Can("beacon")
  /\ ap[c] = "open" /\ apClk[c] < 2
  /\ o \in {"accept", "reject"}
  /\ LET first == IF esc[c] = "Released" THEN "accept" ELSE "reject"
         a == via[c]
         p == appellant[c]
         wronged == IF Bug = "overturn_pays_signer"
                      THEN (IF first = "accept" THEN "buyer" ELSE "seller")
                      ELSE (IF first = "accept" THEN PayAddr ELSE PayoutAddr)
     IN IF o = first
          THEN /\ ap' = [ap EXCEPT ![c] = "upheld"]
               /\ bond' = [bond EXCEPT ![a] = @ + ApBond]
               /\ UNCHANGED wallet
          ELSE /\ ap' = [ap EXCEPT ![c] = "overturned"]
               /\ bond' = [bond EXCEPT ![a] = @ - Price]
               /\ wallet' = [wallet EXCEPT ![wronged] = @ + Price, ![p] = @ + ApBond]
  /\ apBond' = [apBond EXCEPT ![c] = 0]
  /\ apFee' = [apFee EXCEPT ![c] = 0]
  /\ fees' = [fees EXCEPT !["appeal"] = @ + ApFee]
  \* Upheld: the bonds are released. Overturned: the slash shrinks the posted and the encumbered bond by the price.
  \* The slash_keeps_enc bug shrinks the posted bond only and leaves the encumbrance behind.
  /\ IF Bug = "slash_keeps_enc" /\ o # (IF esc[c] = "Released" THEN "accept" ELSE "reject")
       THEN /\ flags' = [flags EXCEPT ![c] = {}] /\ UNCHANGED enc
       ELSE ReleaseAll(c)
  /\ Act("decide_appeal", {"appeal"}, c)
  /\ UNCHANGED <<esc, via, appellant, clk, escClk, apClk, key, led, down, escrow, cppv>>

-----------------------------------------------------------------------------
(* Permissionless timeouts: anyone may trigger them (TimeoutKind in settlement/src/interface.ts). *)

\* expire_offer (full profile): Offered or AcceptedByAdjudicator after offerExpiresAt; Agreed after fundBy.
\* Phase one records no expiry (ADR-0031 section 7, SC-6): an unfunded offer stores nothing, and funding it after
\* offerExpiresAt reverts. The expire_recorded bug brings the step back.
Expire(c) ==
  /\ ~P1 \/ Bug = "expire_recorded"
  /\ Trig
  /\ \/ esc[c] \in {"Offered", "AcceptedByAdjudicator"} /\ clk[c] >= 1
     \/ esc[c] = "Agreed" /\ clk[c] >= FundBy
  /\ esc' = [esc EXCEPT ![c] = "Expired"]
  /\ Act("expire", TrigSigners, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv>>

\* reclaim: Held after deliverBy; escrow -> PayAddr (price + fee), or nothing after a CPP reclaim, and the
\* primary's bond released either way. The early_reclaim bug fires it at fundBy; refund_to_signer pays the buyer's
\* signing address.
Reclaim(c) ==
  /\ Trig
  /\ esc[c] = "Held" /\ clk[c] >= (IF Bug = "early_reclaim" THEN 2 ELSE 3)
  /\ esc' = [esc EXCEPT ![c] = "Refunded"]
  /\ via' = [via EXCEPT ![c] = "reclaim"]
  /\ wallet' = [wallet EXCEPT ![IF Bug = "refund_to_signer" THEN "buyer" ELSE PayAddr] = @ + Refunds(c)]
  /\ UNCHANGED fees
  /\ Debit(c, Refunds(c), 0)
  /\ CloseBonds(c)
  /\ Act("reclaim", TrigSigners, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, key, down, bond, apBond, apFee, cppv>>

\* fallback: Delivered after judgeBy. The early_fallback bug fires it at deliverBy, while the primary is on time.
TriggerFallback(c) ==
  /\ Trig
  /\ esc[c] = "Delivered" /\ clk[c] >= (IF Bug = "early_fallback" THEN 3 ELSE 4)
  /\ esc' = [esc EXCEPT ![c] = "FallbackJudging"]
  /\ Act("trigger_fallback", TrigSigners, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, led, down, money, cppv, bondv>>

\* default: FallbackJudging after fallbackBy, or Escalated after its appealDecideBy.
\* Full profile: the commitment becomes Defaulted, and ApplyDefault refunds it in a second step.
\* Phase one: HoldbackRules.triggerDefault refunds in the same call: escrow -> PayAddr (price + fee), or nothing
\* after a CPP reclaim. No bond exists, so nothing compensates the seller. The default_pays_fee bug pays the fee
\* to the fallback adjudicator, which did not decide.
TriggerDefault(c) ==
  /\ Trig
  /\ \/ esc[c] = "FallbackJudging" /\ clk[c] >= 5 /\ via' = [via EXCEPT ![c] = "default_fb"]
     \/ esc[c] = "Escalated" /\ escClk[c] >= 1 /\ via' = [via EXCEPT ![c] = "default_esc"]
  /\ IF P1
       THEN LET r == Refunds(c)
                toAdj == IF Bug = "default_pays_fee" /\ r > 0 THEN Fee ELSE 0
            IN /\ esc' = [esc EXCEPT ![c] = "Refunded"]
               /\ wallet' = [wallet EXCEPT ![PayAddr] = @ + r - toAdj]
               /\ fees' = [fees EXCEPT !["fallback"] = @ + toAdj]
               /\ Debit(c, r, 0)
               /\ UNCHANGED <<bond, apBond, apFee>>
       ELSE /\ esc' = [esc EXCEPT ![c] = "Defaulted"]
            /\ UNCHANGED <<led, money>>
  /\ Act("trigger_default", TrigSigners, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, key, down, cppv, bondv>>

\* apply_default (full profile): Defaulted -> Refunded. escrow -> PayAddr (price + fee), or nothing after a CPP
\* reclaim; the deal's bonds are released. The liable bonds compensate the seller at PayoutAddr (state.ts,
\* ADR-0033 section 4): primary and fallback after FallbackJudging, appeal after Escalated. The mint bug skips
\* the debit.
ApplyDefault(c) ==
  /\ ~P1
  /\ Trig
  /\ esc[c] = "Defaulted"
  /\ LET liable == IF via[c] = "default_fb" THEN {"primary", "fallback"} ELSE {"appeal"}
         comp == Comp * Cardinality(liable)
     IN /\ bond' = IF Bug = "mint" THEN bond
                   ELSE [a \in Adjs |-> IF a \in liable THEN bond[a] - Comp ELSE bond[a]]
        /\ wallet' = [wallet EXCEPT ![PayAddr] = @ + Refunds(c), ![PayoutAddr] = @ + comp]
        /\ UNCHANGED fees
        /\ Debit(c, Refunds(c), comp)
  /\ esc' = [esc EXCEPT ![c] = "Refunded"]
  /\ CloseBonds(c)
  /\ Act("apply_default", TrigSigners, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, down, apBond, apFee, cppv>>

\* appeal_expiry (full profile): none after appealBy (nothing moves); open after appealDecideBy (bond and fee
\* returned to the appellant's signing address).
ExpireAppeal(c) ==
  /\ ~P1
  /\ Trig
  /\ \/ /\ ap[c] = "none" /\ apClk[c] >= 1
        /\ UNCHANGED <<wallet, apBond, apFee>>
     \/ /\ ap[c] = "open" /\ apClk[c] >= 2
        /\ wallet' = [wallet EXCEPT ![appellant[c]] = @ + apBond[c] + apFee[c]]
        /\ apBond' = [apBond EXCEPT ![c] = 0]
        /\ apFee' = [apFee EXCEPT ![c] = 0]
  /\ ap' = [ap EXCEPT ![c] = "expired"]
  /\ ReleaseAll(c)
  /\ Act("expire_appeal", TrigSigners, c)
  /\ UNCHANGED <<esc, via, appellant, clk, escClk, apClk, key, led, down, escrow, fees, bond, cppv>>

-----------------------------------------------------------------------------
(* Environment: time and the halting actor. *)

\* Deadlines beyond the one the current state can use add no behaviour, so the clock stops there.
Horizon(s) == CASE s \in {"Offered", "AcceptedByAdjudicator"} -> 1
                [] s = "Agreed" -> FundGuard
                [] s = "Held" -> 3
                [] s = "Delivered" -> 4
                [] s = "FallbackJudging" -> 5
                [] OTHER -> 0

TickAbs(c) ==
  /\ clk[c] < Horizon(esc[c])
  /\ clk' = [clk EXCEPT ![c] = @ + 1]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, escClk, apClk, key, led, down, money, cppv, bondv>>

TickEsc(c) ==
  /\ esc[c] = "Escalated" /\ escClk[c] < 1
  /\ escClk' = [escClk EXCEPT ![c] = 1]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, apClk, key, led, down, money, cppv, bondv>>

\* The appeal window and the appeal's decision window (full profile).
TickAppeal(c) ==
  /\ ~P1
  /\ \/ ap[c] = "none" /\ apClk[c] < 1
     \/ ap[c] = "open" /\ apClk[c] < 2
  /\ apClk' = [apClk EXCEPT ![c] = @ + 1]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, key, led, down, money, cppv, bondv>>

\* CPP's authorizationExpiry passes. It is fallbackBy + appealDecideSec + EXPIRY_MARGIN
\* (HoldbackRules._paymentInfo), so with ordered deadlines it comes after every deadline a capture could
\* still meet: deliverBy in Held, judgeBy and fallbackBy in Delivered and FallbackJudging (the clock jumps to
\* fallbackBy), the escalation's appealDecideBy in Escalated. Both profiles refuse terms out of order: core's
\* validateTiming for SimChain, agreeAndFund on the contract (ADR-0031 section 6, SC-5). The late_judge_by bug
\* drops that refusal: a judgeBy after the expiry lets it pass while the primary is still on time.
\* Only funded commitments track it: after the payout nothing is held. Not fair: time may never get there.
ExpiryDue(c) ==
  \/ esc[c] = "Held" /\ clk[c] >= 3
  \/ esc[c] \in Funded \ {"Held"} /\ ~OnTime(c)
  \/ Bug = "late_judge_by" /\ esc[c] = "Delivered"

TickExpiry(c) ==
  /\ esc[c] \in Funded /\ ~cppExp[c] /\ ExpiryDue(c)
  /\ cppExp' = [cppExp EXCEPT ![c] = TRUE]
  /\ clk' = IF OnTime(c) THEN clk ELSE [clk EXCEPT ![c] = 5]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, escClk, apClk, key, led, down, money, cppRec, bondv>>

\* The payer's reclaim on CPP (AuthCaptureEscrow.reclaim, the payer only, from authorizationExpiry), outside the
\* rules contract: the whole hold goes back to the payment address, which is the only address that can call it
\* (ADR-0033). The deal's stage is untouched; its timeouts close it.
CppReclaim(c) ==
  /\ Can(PayAddr)
  /\ esc[c] \in Funded /\ cppExp[c] /\ ~cppRec[c]
  /\ cppRec' = [cppRec EXCEPT ![c] = TRUE]
  /\ wallet' = [wallet EXCEPT ![PayAddr] = @ + Hold]
  /\ UNCHANGED fees
  /\ Debit(c, Hold, 0)
  /\ Act("cpp_reclaim", {PayAddr}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, apClk, key, down, bond, apBond, apFee, cppExp, bondv>>

Crash ==
  /\ Halted # "none" /\ down = "none"
  /\ \E a \in (IF Halted = "any" THEN Named ELSE {Halted}) : down' = a
  /\ Act("crash", {}, CHOOSE c \in C : TRUE)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, apClk, key, led, money, cppv, bondv>>

Outcomes == {"accept", "reject", "escalate"}

Next ==
  \/ Crash
  \/ \E c \in C :
       \/ Offer(c) \/ AdjAccept(c) \/ Agree(c) \/ Fund(c) \/ Deliver(c)
       \/ EarlyAccept(c) \/ OperatorEarlyAccept(c) \/ ReleaseKeyLate(c)
       \/ \E o \in Outcomes : DecidePrimary(c, o) \/ DecideFallback(c, o) \/ DecideEscalated(c, o) \/ DecideAppeal(c, o)
       \/ \E s \in 0..Price, k \in BOOLEAN : MutualSettle(c, s, k)
       \/ \E p \in Parties : FileAppeal(c, p)
       \/ Expire(c) \/ Reclaim(c) \/ TriggerFallback(c) \/ TriggerDefault(c) \/ ApplyDefault(c) \/ ExpireAppeal(c)
       \/ TickAbs(c) \/ TickEsc(c) \/ TickAppeal(c)
       \/ TickExpiry(c) \/ CppReclaim(c)

\* Weak fairness only on the "anyone" triggers, the clock and the halting actor's crash.
\* No named actor (parties, adjudicators, operator, beacon, payment address) is ever required to act.
\* Expire, ApplyDefault, ExpireAppeal and TickAppeal are never enabled in phase one, so their fairness asks nothing.
Fairness ==
  /\ WF_vars(Crash)
  /\ \A c \in C :
       /\ WF_vars(TickAbs(c)) /\ WF_vars(TickEsc(c)) /\ WF_vars(TickAppeal(c))
       /\ WF_vars(Expire(c)) /\ WF_vars(Reclaim(c)) /\ WF_vars(TriggerFallback(c))
       /\ WF_vars(TriggerDefault(c)) /\ WF_vars(ApplyDefault(c)) /\ WF_vars(ExpireAppeal(c))

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* Safety *)

TypeOK ==
  /\ esc \in [C -> EscStates]
  /\ via \in [C -> Vias]
  /\ ap \in [C -> ApStates]
  /\ appellant \in [C -> {"na"} \cup Parties]
  /\ clk \in [C -> 0..5] /\ escClk \in [C -> 0..1] /\ apClk \in [C -> 0..2]
  /\ key \in [C -> BOOLEAN] /\ moves \in [C -> Nat] /\ down \in Named \cup {"none"}
  /\ out \in [C -> [pay : Int, payout : Int, fee : [Adjs -> Int]]]
  /\ wallet \in [Holders -> Int] /\ escrow \in [C -> Int] /\ fees \in [Adjs -> Int]
  /\ bond \in [Adjs -> Int] /\ apBond \in [C -> Int] /\ apFee \in [C -> Int]
  /\ cppExp \in [C -> BOOLEAN] /\ cppRec \in [C -> BOOLEAN]
  /\ enc \in [Adjs -> Int] /\ flags \in [C -> SUBSET {"primary", "fallback"}]

\* No posting creates or destroys a unit.
Conservation == Total = InitialTotal

NonNegative ==
  /\ \A h \in Holders : wallet[h] >= 0
  /\ \A a \in Adjs : fees[a] >= 0 /\ bond[a] >= 0
  /\ \A c \in C : escrow[c] >= 0 /\ apBond[c] >= 0 /\ apFee[c] >= 0

\* Each escrow is paid out at most once.
SettleOnce == \A c \in C : moves[c] <= 1

\* The escrow holds price + fee exactly while funded and undecided, and nothing otherwise. After the payer's
\* CPP reclaim (T-337) it holds nothing although the stage is still funded, until a timeout closes the deal.
EscrowMatchesState == \A c \in C : escrow[c] = IF esc[c] \in Funded /\ ~cppRec[c] THEN Hold ELSE 0

\* CPP's expiry comes only after every deadline a capture could still meet (EXPIRY_MARGIN's purpose). It rests on
\* the refusal of out-of-order deadlines, and fails under late_judge_by.
ExpiryAfterCaptures ==
  \A c \in C : cppExp[c] => ~OnTime(c) /\ (esc[c] = "Held" => clk[c] >= 3)

\* What the phase-one profile never reaches (ADR-0031): no party appeal and no appeal stake, no bond posted or
\* encumbered, no recorded offer expiry, and no Defaulted state between the default's trigger and its refund.
PhaseOneCuts ==
  P1 => /\ \A c \in C : /\ esc[c] \notin {"Expired", "Defaulted"}
                        /\ ap[c] \in {"na", "expired"} /\ appellant[c] = "na" /\ apClk[c] = 0
                        /\ apBond[c] = 0 /\ apFee[c] = 0 /\ flags[c] = {}
        /\ \A a \in Adjs : bond[a] = 0 /\ enc[a] = 0

\* The two addresses hold the money (ADR-0033). Whatever left escrow[c] reached the payment address, the payout
\* address or a fee account: the ledger counts only those, so a unit paid anywhere else leaves this sum short.
EscrowLedger ==
  \A c \in C : out[c].pay + out[c].payout + SumOver(out[c].fee, Adjs) + escrow[c]
               = IF esc[c] \in Funded \cup MoneyDone THEN Hold ELSE 0

OnlyFee(a) == [x \in Adjs |-> IF x = a THEN Fee ELSE 0]
Decider(c) == IF via[c] = "escalation" THEN "appeal" ELSE via[c]

\* The money matches how the deal closed. The payment address received every refund, the reclaim on the escrow
\* after its expiry among them; the payout address received every payment to the seller; the adjudicator that
\* decided received the fee, and no other adjudicator received anything.
PaidAsClosed ==
  \A c \in C :
    LET o == out[c]
        decided == via[c] \in {"primary", "fallback", "escalation"}
        refundedWhole == via[c] \in {"reclaim", "default_fb", "default_esc"}
    IN IF cppRec[c]
         THEN o = [pay |-> Hold, payout |-> 0, fee |-> NoFees]
         ELSE /\ esc[c] \notin MoneyDone => o = [pay |-> 0, payout |-> 0, fee |-> NoFees]
              /\ esc[c] = "Released" => \/ decided /\ o = [pay |-> 0, payout |-> Price, fee |-> OnlyFee(Decider(c))]
                                        \/ via[c] = "early" /\ o = [pay |-> Fee, payout |-> Price, fee |-> NoFees]
              /\ esc[c] = "Refunded" => \/ decided /\ o = [pay |-> Price, payout |-> 0, fee |-> OnlyFee(Decider(c))]
                                        \/ refundedWhole /\ o = [pay |-> Hold, payout |-> 0, fee |-> NoFees]
              /\ esc[c] = "Settled" => /\ via[c] = "mutual" /\ o.fee = NoFees
                                       /\ o.payout \in 0..Price /\ o.pay = Hold - o.payout

\* A default refunds the buyer: the payment address has the whole hold back, the seller's payout address and the
\* adjudicators got nothing from the escrow. (Full profile: the seller's compensation comes from bonds, not the escrow.)
DefaultRefundsBuyer ==
  \A c \in C : (esc[c] = "Refunded" /\ via[c] \in {"default_fb", "default_esc"})
                 => out[c] = [pay |-> Hold, payout |-> 0, fee |-> NoFees]

\* A signing address that is apart from its money address holds nothing in phase one, at any step.
SignersHoldNothing == P1 => \A p \in Apart : wallet[p] = 0

\* The buyer has the key only with a release (or a settlement that chose to release it), and always
\* has it once released.
KeyOnlyWithPayment ==
  \A c \in C :
    /\ key[c] => esc[c] \in {"Released", "Settled"}
    /\ esc[c] = "Released" => key[c]

\* A deal that ends Refunded never released its key. AtomicKey says a released key is never taken back, so a
\* Refunded deal without the key now never had it.
RefundedNeverReleasedKey == \A c \in C : esc[c] = "Refunded" => ~key[c]

\* HoldbackBonds (T-337, full profile): no adjudicator's encumbrance exceeds its posted bond ...
BondCovered == \A a \in Adjs : 0 <= enc[a] /\ enc[a] <= bond[a]

\* ... the encumbrance is exactly the price for each open deal that flags the adjudicator. The appeal
\* adjudicator is never flagged, so never encumbered ...
EncMatchesDeals == \A a \in Adjs : enc[a] = Price * Cardinality({c \in C : a \in flags[c]})

\* ... and a closed deal holds no bond: an encumbrance lasts only while the deal is funded, or while its
\* first-instance decision can still be appealed, and then only the decider's.
BondsReleasedAtClose ==
  \A c \in C :
    /\ flags[c] # {} => \/ esc[c] \in Funded
                        \/ esc[c] \in {"Released", "Refunded"} /\ ap[c] \in {"none", "open"}
    /\ (esc[c] \in {"Released", "Refunded"} /\ flags[c] # {}) => flags[c] = {via[c]}

\* Every fund movement follows a valid signature, decision or expired timeout. Judged on the state
\* before the step and the step's recorded name and signers, independently of the action guards.
Decreased(f, x) == f'[x] < f[x]

Turn(c) == CASE esc[c] = "Delivered" -> "primary"
             [] esc[c] = "FallbackJudging" -> "fallback"
             [] esc[c] = "Escalated" -> "appeal"
             [] OTHER -> "nobody"

DefaultDue(c) == (esc[c] = "FallbackJudging" /\ clk[c] >= 5) \/ (esc[c] = "Escalated" /\ escClk[c] >= 1)

\* Every signer the step names was able to act: an actor that has crashed signs nothing. The checks below read
\* the signers a step records; this ties that record to the actors. It bites only where an actor halts.
Signed == \A a \in act'.signers : Can(a)

\* A decision by the adjudicator whose turn it is, on time, with the beacon for the fallback and the appeal
\* adjudicator. Phase one: also the primary's decision in Held, with the seller's signature on the delivery it
\* carries, before deliverBy.
DecisionOK(c) ==
  /\ act'.name = "decide"
  /\ \/ /\ act'.signers = {Turn(c)} /\ OnTime(c)
        /\ Turn(c) # "primary" => Can("beacon")
     \/ P1 /\ act'.signers = {"primary", "seller"} /\ esc[c] = "Held" /\ clk[c] < 3

EscrowDebitOK(c) ==
  /\ act'.c = c
  /\ \/ DecisionOK(c)
     \/ act'.name = "early_accept" /\ act'.signers = {"buyer"} /\ esc[c] = "Delivered"
     \* Phase one: an early accept that carries the seller-signed delivery, before deliverBy.
     \/ P1 /\ act'.name = "early_accept" /\ act'.signers = {"buyer", "seller"} /\ esc[c] = "Held" /\ clk[c] < 3
     \/ act'.name = "mutual_settle" /\ act'.signers = Parties /\ esc[c] \in Settleable
     \/ act'.name = "reclaim" /\ esc[c] = "Held" /\ clk[c] >= 3
     \/ ~P1 /\ act'.name = "apply_default" /\ esc[c] = "Defaulted"
     \/ P1 /\ act'.name = "trigger_default" /\ DefaultDue(c)
     \/ act'.name = "cpp_reclaim" /\ act'.signers = {PayAddr} /\ esc[c] \in Funded /\ cppExp[c]

AppealDecidedOK(c) ==
  ~P1 /\ act'.name = "decide_appeal" /\ act'.signers = {"appeal"} /\ ap[c] = "open" /\ apClk[c] < 2 /\ Can("beacon")

BondDebitOK(a) ==
  LET c == act'.c IN
  \/ AppealDecidedOK(c) /\ via[c] = a
  \/ /\ ~P1 /\ act'.name = "apply_default" /\ esc[c] = "Defaulted"
     /\ a \in (IF via[c] = "default_fb" THEN {"primary", "fallback"} ELSE {"appeal"})

AppealDebitOK(c) ==
  /\ act'.c = c
  /\ AppealDecidedOK(c) \/ (~P1 /\ act'.name = "expire_appeal" /\ ap[c] = "open" /\ apClk[c] >= 2)

\* A wallet is debited only by its own signature: the payment address's funding, before the funding deadline, or
\* (full profile) a party's own appeal filing.
WalletDebitOK(h) ==
  LET c == act'.c IN
  \/ h = PayAddr /\ act'.name = "fund" /\ act'.signers = {PayAddr} /\ esc[c] = "Agreed" /\ clk[c] < FundBy
  \/ ~P1 /\ h \in Parties /\ act'.name = "file_appeal" /\ act'.signers = {h}

Authorized ==
  /\ Signed
  /\ \A c \in C : Decreased(escrow, c) => EscrowDebitOK(c)
  /\ \A h \in Holders : Decreased(wallet, h) => WalletDebitOK(h)
  /\ \A a \in Adjs : Decreased(bond, a) => BondDebitOK(a)
  /\ \A a \in Adjs : ~Decreased(fees, a)
  /\ \A c \in C : (Decreased(apBond, c) \/ Decreased(apFee, c)) => AppealDebitOK(c)

AuthorizedMoves == [][Authorized]_vars

\* Every step that changes a deal's stage is justified too, whether or not it moves money: by the stage before
\* it, the step's name and signers, and the deadline. These steps decide who may move the money next. The record
\* of how a deal closed (via) is the step that closed it, so the adjudicator PaidAsClosed finds paid is the one
\* whose turn it was.
Loser(c) == IF esc[c] = "Released" THEN "buyer" ELSE "seller"

DecidedVia(c) == CASE esc[c] \in {"Held", "Delivered"} -> "primary"
                   [] esc[c] = "FallbackJudging" -> "fallback"
                   [] esc[c] = "Escalated" -> "escalation"
                   [] OTHER -> "na"

StageChangeOK(c) ==
  LET a == esc[c]
      b == esc'[c]
      n == act'.name
      s == act'.signers
  IN /\ act'.c = c
     /\ \/ a = "None" /\ b = "Offered" /\ n = "offer" /\ s = {"seller"}
        \/ a = "Offered" /\ b = "AcceptedByAdjudicator" /\ n = "adjudicator_accept" /\ s = {"primary"} /\ clk[c] < 1
        \/ a = "AcceptedByAdjudicator" /\ b = "Agreed" /\ n = "agree" /\ s = {"buyer"} /\ clk[c] < 1
        \/ a = "Agreed" /\ b = "Held" /\ n = "fund" /\ s = {PayAddr} /\ clk[c] < FundBy
        \/ a = "Held" /\ b = "Delivered" /\ n = "deliver" /\ s = {"seller"} /\ clk[c] < 3
        \/ a # "Escalated" /\ b = "Escalated" /\ DecisionOK(c) /\ via'[c] = via[c]
        \/ b \in {"Released", "Refunded"} /\ DecisionOK(c) /\ via'[c] = DecidedVia(c)
        \/ /\ b = "Released" /\ n = "early_accept" /\ via'[c] = "early"
           /\ \/ a = "Delivered" /\ s = {"buyer"}
              \/ P1 /\ a = "Held" /\ s = {"buyer", "seller"} /\ clk[c] < 3
        \/ a \in Settleable /\ b = "Settled" /\ n = "mutual_settle" /\ s = Parties /\ via'[c] = "mutual"
        \/ a = "Held" /\ b = "Refunded" /\ n = "reclaim" /\ clk[c] >= 3 /\ via'[c] = "reclaim"
        \/ a = "Delivered" /\ b = "FallbackJudging" /\ n = "trigger_fallback" /\ clk[c] >= 4 /\ via'[c] = via[c]
        \/ /\ DefaultDue(c) /\ n = "trigger_default" /\ b = (IF P1 THEN "Refunded" ELSE "Defaulted")
           /\ via'[c] = (IF a = "FallbackJudging" THEN "default_fb" ELSE "default_esc")
        \/ ~P1 /\ a = "Defaulted" /\ b = "Refunded" /\ n = "apply_default" /\ via'[c] = via[c]
        \/ /\ ~P1 /\ b = "Expired" /\ n = "expire" /\ via'[c] = via[c]
           /\ (a \in {"Offered", "AcceptedByAdjudicator"} /\ clk[c] >= 1) \/ (a = "Agreed" /\ clk[c] >= 2)

\* The appeal state: opened and closed at once by a first-instance decision (phase one), or opened by it and then
\* moved by the losing party's filing, the appeal adjudicator's decision or an expiry (full profile).
AppealChangeOK(c) ==
  LET a == ap[c]
      b == ap'[c]
  IN /\ act'.c = c
     /\ \/ /\ a = "na" /\ b = (IF P1 THEN "expired" ELSE "none")
           /\ DecisionOK(c) /\ esc[c] # "Escalated" /\ esc'[c] \in {"Released", "Refunded"}
        \/ /\ ~P1 /\ a = "none" /\ b = "open" /\ act'.name = "file_appeal" /\ apClk[c] < 1
           /\ act'.signers = {Loser(c)} /\ appellant'[c] = Loser(c)
        \/ ~P1 /\ a = "open" /\ b \in {"upheld", "overturned"} /\ AppealDecidedOK(c)
        \/ /\ ~P1 /\ b = "expired" /\ act'.name = "expire_appeal"
           /\ (a = "none" /\ apClk[c] >= 1) \/ (a = "open" /\ apClk[c] >= 2)

AuthorizedSteps ==
  [][/\ Signed
     /\ \A c \in C : /\ esc'[c] # esc[c] => StageChangeOK(c)
                     /\ via'[c] # via[c] => esc'[c] # esc[c]
                     /\ ap'[c] # ap[c] => AppealChangeOK(c)]_vars

\* Full profile (ADR-0033 section 4): a stake made by a later signature stays with the signer, and what a bond
\* pays a wronged party goes to that party's money address. The filing takes the appeal bond and fee from the
\* losing party's signing address and from nobody else. An overturn pays the price to the wronged party's money
\* address and returns the bond to the appellant's signing address; an upheld appeal moves no wallet; an undecided
\* one returns bond and fee to the appellant's signing address. The default compensation the bonds pay lands on
\* the payout address.
BondMoneyLands ==
  [][\A c \in C :
       /\ (ap[c] = "none" /\ ap'[c] = "open")
            => wallet' = [wallet EXCEPT ![Loser(c)] = @ - (ApBond + ApFee)]
       /\ (ap[c] = "open" /\ ap'[c] # "open")
            => wallet' = [h \in Holders |->
                 wallet[h]
                 + (IF ap'[c] = "overturned" /\ h = (IF esc[c] = "Released" THEN PayAddr ELSE PayoutAddr) THEN Price ELSE 0)
                 + (IF ap'[c] = "overturned" /\ h = appellant[c] THEN ApBond ELSE 0)
                 + (IF ap'[c] = "expired" /\ h = appellant[c] THEN ApBond + ApFee ELSE 0)]
       /\ (esc[c] = "Defaulted" /\ esc'[c] = "Refunded")
            => wallet'[PayoutAddr] - wallet[PayoutAddr] = SumOver(bond, Adjs) - SumOver(bond', Adjs)]_vars

\* The payment address funds the hold (ADR-0033): whatever enters an escrow leaves the payment address in the same
\* step, a funding it signed, and no other holder's balance changes.
PaymentAddressFunds ==
  [][\A c \in C :
       escrow'[c] > escrow[c]
         => /\ act'.name = "fund" /\ act'.c = c /\ PayAddr \in act'.signers
            /\ wallet[PayAddr] - wallet'[PayAddr] = escrow'[c] - escrow[c]
            /\ \A h \in Holders \ {PayAddr} : wallet'[h] = wallet[h]]_vars

\* A signing address that is apart from its money address never pays or receives deal money. Its balance changes
\* only by its own appeal stake, which exists in the full profile alone: paid at the filing, returned when the
\* appeal is overturned or goes undecided.
SignersOnlyStake ==
  [][\A p \in Apart :
       wallet'[p] # wallet[p] => ~P1 /\ act'.name \in {"file_appeal", "decide_appeal", "expire_appeal"}]_vars

\* The first decision is final. Once a deal's escrow is paid out, its outcome, its key, its escrow and its ledger
\* never change again. In phase one nothing about the deal changes: no later step naming it moves any money.
FirstDecisionFinal ==
  [][\A c \in C :
       esc[c] \in MoneyDone
         => /\ esc'[c] = esc[c] /\ via'[c] = via[c] /\ key'[c] = key[c]
            /\ escrow'[c] = escrow[c] /\ out'[c] = out[c]
            /\ P1 => /\ ap'[c] = ap[c]
                     /\ act'.c = c => (wallet' = wallet /\ fees' = fees)]_vars

\* An offer whose funding deadline has passed never funds: no later step revives it. In phase one this stands in
\* for the Expire step the contract no longer has.
LapsedOfferNeverFunds ==
  [][\A c \in C : (esc[c] \in PreFunded /\ clk[c] >= FundBy) => esc'[c] \in PreFunded \cup {"Expired"}]_vars

\* guaranteed_on_decision (ADR-0012): the key moves only in a step that pays out the escrow, a release
\* always carries it, and it is never taken back.
AtomicKey ==
  [][\A c \in C :
       /\ (~key[c] /\ key'[c]) => Decreased(escrow, c)
       /\ (esc[c] # "Released" /\ esc'[c] = "Released") => key'[c]
       /\ key[c] => key'[c]]_vars

\* CPP refuses every capture from authorizationExpiry (T-337): after it, whatever leaves the escrow goes to the
\* payment address in full, and no fee is paid.
NoCaptureAfterExpiry ==
  [][\A c \in C :
       (cppExp[c] /\ Decreased(escrow, c))
         => /\ fees' = fees
            /\ wallet'[PayAddr] - wallet[PayAddr] = escrow[c] - escrow'[c]]_vars

-----------------------------------------------------------------------------
(* Liveness *)

\* Every funded commitment's escrow is paid out.
FundedSettles == \A c \in C : (esc[c] = "Held") ~> (esc[c] \in MoneyDone)

\* ... and its appeal state closes too (finalAt, D20). Full profile.
FundedFinal == \A c \in C : (esc[c] = "Held") ~> (esc[c] \in MoneyDone /\ ap[c] \notin {"none", "open"})

\* Every offer ends: expired, or funded and then paid out. Full profile; phase one records no expiry, and
\* LapsedOfferNeverFunds is its safety counterpart.
OfferEnds == \A c \in C : (esc[c] = "Offered") ~> (esc[c] \in MoneyDone \cup {"Expired"})

\* Every bond encumbered for a funded commitment is released or paid out in the end (T-337): no bond is
\* stranded, whether or not the payer reclaimed on CPP. Full profile.
BondsFreed == \A c \in C : (esc[c] = "Held") ~> (esc[c] \in MoneyDone /\ flags[c] = {})

-----------------------------------------------------------------------------
(* Reach witnesses. Each names a state the model must reach. formal/check.sh runs each as an invariant and        *)
(* requires TLC to violate it (formal/reach.list). They show that the safety configs do not pass for want of       *)
(* behaviour: every closing row of the phase-one state model is reached, by the step its name says, and the full   *)
(* profile still reaches what phase one cuts. Did reads act, the last step, so a witness names the step that       *)
(* reached the state and the stage the deal was in before it.                                                      *)

Did(name, from, c) == act.c = c /\ act.name = name /\ act.from = from
Some(P(_)) == \E c \in C : P(c)

\* Decisions after a posted delivery, by each adjudicator, each way.
W_ReleasedByPrimary == ~Some(LAMBDA c : Did("decide", "Delivered", c) /\ esc[c] = "Released" /\ via[c] = "primary")
W_RefundedByPrimary == ~Some(LAMBDA c : Did("decide", "Delivered", c) /\ esc[c] = "Refunded" /\ via[c] = "primary")
W_EscalatedByPrimary == ~Some(LAMBDA c : Did("decide", "Delivered", c) /\ esc[c] = "Escalated")
W_ReleasedByFallback == ~Some(LAMBDA c : Did("decide", "FallbackJudging", c) /\ esc[c] = "Released" /\ via[c] = "fallback")
W_RefundedByFallback == ~Some(LAMBDA c : Did("decide", "FallbackJudging", c) /\ esc[c] = "Refunded" /\ via[c] = "fallback")
W_EscalatedByFallback == ~Some(LAMBDA c : Did("decide", "FallbackJudging", c) /\ esc[c] = "Escalated")
W_ReleasedOnEscalation == ~Some(LAMBDA c : Did("decide", "Escalated", c) /\ esc[c] = "Released" /\ via[c] = "escalation")
W_RefundedOnEscalation == ~Some(LAMBDA c : Did("decide", "Escalated", c) /\ esc[c] = "Refunded" /\ via[c] = "escalation")
\* Phase one: the primary's decision carries the delivery from Held.
W_ReleasedCarryingDelivery == ~Some(LAMBDA c : Did("decide", "Held", c) /\ esc[c] = "Released")
W_RefundedCarryingDelivery == ~Some(LAMBDA c : Did("decide", "Held", c) /\ esc[c] = "Refunded")
W_EscalatedCarryingDelivery == ~Some(LAMBDA c : Did("decide", "Held", c) /\ esc[c] = "Escalated")
\* Timeouts.
W_Reclaimed == ~Some(LAMBDA c : Did("reclaim", "Held", c))
W_FallbackTriggered == ~Some(LAMBDA c : Did("trigger_fallback", "Delivered", c) /\ clk[c] = 4)
W_FallbackTriggeredAfterFallbackBy == ~Some(LAMBDA c : Did("trigger_fallback", "Delivered", c) /\ clk[c] = 5)
W_DefaultedAfterFallback == ~Some(LAMBDA c : Did("trigger_default", "FallbackJudging", c))
W_DefaultedAfterEscalation == ~Some(LAMBDA c : Did("trigger_default", "Escalated", c))
\* Early accept: after a delivery, after judgeBy (racing the fallback), and in Held carrying the delivery.
W_AcceptedEarlyAfterDelivery == ~Some(LAMBDA c : Did("early_accept", "Delivered", c) /\ clk[c] < 4)
W_AcceptedEarlyAfterJudgeBy == ~Some(LAMBDA c : Did("early_accept", "Delivered", c) /\ clk[c] >= 4)
W_AcceptedEarlyInHeld == ~Some(LAMBDA c : Did("early_accept", "Held", c))
\* Mutual settlement in each of its four stages; late work with its key; a refund-only split after the expiry.
W_SettledInHeld == ~Some(LAMBDA c : Did("mutual_settle", "Held", c) /\ ~key[c])
W_SettledLateWorkWithKey == ~Some(LAMBDA c : Did("mutual_settle", "Held", c) /\ key[c] /\ clk[c] = 3)
W_SettledAfterDelivery == ~Some(LAMBDA c : Did("mutual_settle", "Delivered", c))
W_SettledUnderFallback == ~Some(LAMBDA c : Did("mutual_settle", "FallbackJudging", c))
W_SettledUnderEscalation == ~Some(LAMBDA c : Did("mutual_settle", "Escalated", c))
W_SettledRefundOnlyAfterExpiry == ~Some(LAMBDA c : act.c = c /\ act.name = "mutual_settle" /\ cppExp[c])
\* The payment address's reclaim on the escrow, and the timeout that closes the deal after it.
W_ReclaimedOnEscrowInHeld == ~Some(LAMBDA c : Did("cpp_reclaim", "Held", c))
W_ReclaimedOnEscrowWhileEscalated == ~Some(LAMBDA c : Did("cpp_reclaim", "Escalated", c))
W_ClosedAfterEscrowReclaim == ~Some(LAMBDA c : cppRec[c] /\ esc[c] = "Refunded")
W_BothClosed == ~(\A c \in C : esc[c] \in MoneyDone)
\* An actor crashed and a funded deal still closed (the halting configs are not empty of crashes).
W_ClosedAfterCrash == ~(down # "none" /\ Some(LAMBDA c : esc[c] \in MoneyDone))
\* Full profile only: what phase one cuts is still reached here.
W_AppealOverturned == ~Some(LAMBDA c : ap[c] = "overturned")
W_AppealUpheld == ~Some(LAMBDA c : ap[c] = "upheld")
W_AppealUndecided == ~Some(LAMBDA c : ap[c] = "expired" /\ appellant[c] # "na")
W_AppealWindowExpired == ~Some(LAMBDA c : ap[c] = "expired" /\ appellant[c] = "na")
W_OfferExpired == ~Some(LAMBDA c : esc[c] = "Expired")
W_DefaultApplied == ~Some(LAMBDA c : Did("apply_default", "Defaulted", c))
W_FallbackBondEncumbered == ~Some(LAMBDA c : flags[c] = {"fallback"})

=============================================================================
