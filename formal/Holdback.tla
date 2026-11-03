----------------------------- MODULE Holdback -----------------------------
(***************************************************************************)
(* The commitment state machine of packages/core/src/state.ts, in          *)
(* guaranteed_on_decision mode (the only Phase 1 mode), as a spec that the  *)
(* rules contract and SimChain are checked against.                         *)
(*                                                                          *)
(* Actors: buyer, seller, primary / fallback / appeal adjudicators, an      *)
(* operator node, the randomness beacon, and "anyone" (the permissionless  *)
(* timeout trigger). Named actors get no fairness: each may stop at any    *)
(* time. Halted names one actor that is certain to stop at some point      *)
(* (Crash, weakly fair) and acts no more after it. Only the "anyone"       *)
(* triggers and the passage of time are weakly fair.                       *)
(*                                                                          *)
(* Time: each commitment's absolute deadlines are strictly ordered         *)
(* (timing.ts: offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy), *)
(* so clk[c] counts how many have passed. Relative deadlines (escalation   *)
(* appealDecideBy; appealBy and appealDecideBy) start at the deciding step *)
(* and have their own counters. Every tick is a separate step, so every    *)
(* interleaving of deadlines across commitments and actions is explored:   *)
(* an action is on time iff its deadline has not passed (at < deadline);   *)
(* a timeout fires iff it has (at >= deadline).                            *)
(*                                                                          *)
(* Money: abstract units in buyer, seller, escrow, adjudicator fee, bond,  *)
(* appeal-bond and appeal-fee accounts, posted as in docs/architecture.md   *)
(* "Hold and settlement postings". Amounts are fixed small constants; the  *)
(* Phase 4 economics (coverage gate, backers, compensation size) are out   *)
(* of scope.                                                               *)
(*                                                                          *)
(* Bug selects a deliberately broken variant for formal/broken/ ("none" is *)
(* the model of state.ts).                                                 *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS C,       \* commitment ids (model values)
          Halted,  \* "none" or the one named actor that halts
          Bug      \* "none" or the broken variant to check

Price == 2
Fee == 1
ApBond == 1    \* appeal bond
ApFee == 1     \* appeal fee
Comp == 1      \* default-outcome compensation per liable bond (abstracted)

Parties == {"buyer", "seller"}
Adjs == {"primary", "fallback", "appeal"}
Named == Parties \cup Adjs \cup {"operator", "beacon"}

Bugs == {"none", "mint", "second_capture", "operator_authors", "early_reclaim", "key_separate", "buyer_only_timeout"}
ASSUME Halted \in Named \cup {"none"}
ASSUME Bug \in Bugs

EscStates == {"None", "Offered", "AcceptedByAdjudicator", "Agreed", "Held", "Delivered",
              "FallbackJudging", "Escalated", "Defaulted", "Released", "Refunded", "Expired", "Settled"}
Funded == {"Held", "Delivered", "FallbackJudging", "Escalated", "Defaulted"}
Settleable == {"Held", "Delivered", "FallbackJudging", "Escalated"}   \* mutual settlement (ADR-0019)
MoneyDone == {"Released", "Refunded", "Settled"}
\* via: how the escrow was settled. primary / fallback = first instance (appealable).
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
  up,         \* the Halted actor has not crashed yet
  wallet, escrow, fees, bond, apBond, apFee,  \* accounts
  act         \* history: the last step's name, signers and commitment

money == <<wallet, escrow, fees, bond, apBond, apFee>>
vars == <<esc, via, ap, appellant, clk, escClk, apClk, key, moves, up, money, act>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE x \in S : TRUE IN f[x] + SumOver(f, S \ {x})

Total == SumOver(wallet, Parties) + SumOver(escrow, C) + SumOver(fees, Adjs)
         + SumOver(bond, Adjs) + SumOver(apBond, C) + SumOver(apFee, C)

N == Cardinality(C)
InitialTotal == N * (Price + Fee + ApBond + ApFee)    \* buyer
                + N * (ApBond + ApFee)                \* seller
                + 3 * N * Price                       \* bonds

\* An actor acts only while it is not the halted one, or has not crashed yet.
Can(a) == a # Halted \/ up

\* Who may fire a timeout: anyone (the operator and every party included), or under the
\* buyer_only_timeout bug the buyer alone.
Trig == IF Bug = "buyer_only_timeout" THEN Can("buyer") ELSE TRUE
TrigSigners == IF Bug = "buyer_only_timeout" THEN {"buyer"} ELSE {}

\* Signed party messages reach the settlement layer through an operator or directly (ADR-0005).
\* The relay changes nothing in the state: an operator relays, it never authors.
Relays == {"direct"} \cup (IF Can("operator") THEN {"operator"} ELSE {})

Act(name, signers, c) == act' = [name |-> name, signers |-> signers, c |-> c]

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
  /\ up = TRUE
  /\ wallet = [p \in Parties |-> IF p = "buyer" THEN N * (Price + Fee + ApBond + ApFee) ELSE N * (ApBond + ApFee)]
  /\ escrow = [c \in C |-> 0]
  /\ fees = [a \in Adjs |-> 0]
  /\ bond = [a \in Adjs |-> N * Price]
  /\ apBond = [c \in C |-> 0]
  /\ apFee = [c \in C |-> 0]
  /\ act = [name |-> "init", signers |-> {}, c |-> CHOOSE c \in C : TRUE]

-----------------------------------------------------------------------------
(* Signed messages *)

\* offer (state.ts offer): the seller's signed terms, before offerExpiresAt.
Offer(c) ==
  /\ Can("seller") /\ \E r \in Relays : TRUE
  /\ esc[c] = "None"
  /\ esc' = [esc EXCEPT ![c] = "Offered"]
  /\ Act("offer", {"seller"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* adjudicator_accept: the primary accepts (seed commitment, bond reserved) before offerExpiresAt.
AdjAccept(c) ==
  /\ Can("primary")
  /\ esc[c] = "Offered" /\ clk[c] < 1
  /\ esc' = [esc EXCEPT ![c] = "AcceptedByAdjudicator"]
  /\ Act("adjudicator_accept", {"primary"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* agree: the buyer signs the same terms hash before offerExpiresAt.
Agree(c) ==
  /\ Can("buyer") /\ \E r \in Relays : TRUE
  /\ esc[c] = "AcceptedByAdjudicator" /\ clk[c] < 1
  /\ esc' = [esc EXCEPT ![c] = "Agreed"]
  /\ Act("agree", {"buyer"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* fund: the buyer's funding authorization, before fundBy. Posting buyer -> escrow (price + fee).
Fund(c) ==
  /\ Can("buyer") /\ \E r \in Relays : TRUE
  /\ esc[c] = "Agreed" /\ clk[c] < 2
  /\ esc' = [esc EXCEPT ![c] = "Held"]
  /\ wallet' = [wallet EXCEPT !["buyer"] = @ - (Price + Fee)]
  /\ escrow' = [escrow EXCEPT ![c] = @ + (Price + Fee)]
  /\ Act("fund", {"buyer"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, fees, bond, apBond, apFee>>

\* deliver: the seller's delivery (attempt 1), before deliverBy.
Deliver(c) ==
  /\ Can("seller") /\ \E r \in Relays : TRUE
  /\ esc[c] = "Held" /\ clk[c] < 3
  /\ esc' = [esc EXCEPT ![c] = "Delivered"]
  /\ Act("deliver", {"seller"}, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* Release or refund of the escrow in one step; on accept the buyer's key moves in the same step
\* (ADR-0012, architecture.md Two-sided hold step 4), except under the key_separate bug.
\* Postings: escrow -> payee (price); escrow -> adjudicator {adj} (fee).
Settle(c, payee, adj, releaseKey) ==
  /\ escrow' = [escrow EXCEPT ![c] = @ - (Price + Fee)]
  /\ wallet' = [wallet EXCEPT ![payee] = @ + Price]
  /\ fees' = [fees EXCEPT ![adj] = @ + Fee]
  /\ moves' = [moves EXCEPT ![c] = @ + 1]
  /\ key' = [key EXCEPT ![c] = @ \/ (releaseKey /\ Bug # "key_separate")]

\* A first-instance decision (state.ts firstInstance): accept, reject or escalate.
FirstInstance(c, role, o) ==
  /\ IF o = "escalate"
       THEN /\ esc' = [esc EXCEPT ![c] = "Escalated"]
            /\ escClk' = [escClk EXCEPT ![c] = 0]
            /\ UNCHANGED <<via, ap, apClk, key, moves, money>>
       ELSE /\ esc' = [esc EXCEPT ![c] = IF o = "accept" THEN "Released" ELSE "Refunded"]
            /\ via' = [via EXCEPT ![c] = role]
            /\ ap' = [ap EXCEPT ![c] = "none"]
            /\ apClk' = [apClk EXCEPT ![c] = 0]
            /\ Settle(c, IF o = "accept" THEN "seller" ELSE "buyer", role, o = "accept")
            /\ UNCHANGED <<escClk, bond, apBond, apFee>>
  /\ UNCHANGED <<appellant, clk, up>>

\* decide by the primary in Delivered, before judgeBy. Its seed is its own commit-reveal: no beacon.
\* Under second_capture it may also decide again after the commitment settled.
DecidePrimary(c, o) ==
  /\ Can("primary")
  /\ esc[c] \in (IF Bug = "second_capture" THEN {"Delivered", "Released", "Refunded"} ELSE {"Delivered"})
  /\ clk[c] < 4
  /\ FirstInstance(c, "primary", o)
  /\ Act("decide", {"primary"}, c)

\* decide by the fallback in FallbackJudging, before fallbackBy; needs the beacon round at judgeBy.
DecideFallback(c, o) ==
  /\ Can("fallback") /\ Can("beacon")
  /\ esc[c] = "FallbackJudging" /\ clk[c] < 5
  /\ FirstInstance(c, "fallback", o)
  /\ Act("decide", {"fallback"}, c)

\* decide by the appeal adjudicator in Escalated, before its appealDecideBy (state.ts escalationDecision).
\* Not appealable; cannot escalate. The fee goes to the appeal adjudicator.
DecideEscalated(c, o) ==
  /\ Can("appeal") /\ Can("beacon")
  /\ esc[c] = "Escalated" /\ escClk[c] < 1
  /\ o \in {"accept", "reject"}
  /\ esc' = [esc EXCEPT ![c] = IF o = "accept" THEN "Released" ELSE "Refunded"]
  /\ via' = [via EXCEPT ![c] = "escalation"]
  /\ Settle(c, IF o = "accept" THEN "seller" ELSE "buyer", "appeal", o = "accept")
  /\ Act("decide", {"appeal"}, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, up, bond, apBond, apFee>>

\* Escrow effect of early acceptance: escrow -> seller (price); escrow -> buyer (fee); key released.
EarlyAcceptEffect(c) ==
  /\ esc[c] = "Delivered"
  /\ esc' = [esc EXCEPT ![c] = "Released"]
  /\ via' = [via EXCEPT ![c] = "early"]
  /\ escrow' = [escrow EXCEPT ![c] = @ - (Price + Fee)]
  /\ wallet' = [wallet EXCEPT !["seller"] = @ + Price, !["buyer"] = @ + Fee]
  /\ moves' = [moves EXCEPT ![c] = @ + 1]
  /\ key' = [key EXCEPT ![c] = TRUE]
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, up, fees, bond, apBond, apFee>>

\* early_accept: the buyer's signature, in Delivered (no deadline beyond the message's own expiry).
EarlyAccept(c) ==
  /\ Can("buyer") /\ \E r \in Relays : TRUE
  /\ EarlyAcceptEffect(c)
  /\ Act("early_accept", {"buyer"}, c)

\* Bug operator_authors: the operator submits an early acceptance it signed itself.
OperatorEarlyAccept(c) ==
  /\ Bug = "operator_authors" /\ Can("operator")
  /\ EarlyAcceptEffect(c)
  /\ Act("early_accept", {"operator"}, c)

\* Bug key_separate: the key for an accepted decision is released in a later step.
ReleaseKeyLate(c) ==
  /\ Bug = "key_separate"
  /\ esc[c] = "Released" /\ ~key[c]
  /\ key' = [key EXCEPT ![c] = TRUE]
  /\ Act("release_key", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, apClk, moves, up, money>>

\* mutual_settle (ADR-0019, D23): both parties sign any split of the price; the fee returns to the buyer;
\* releaseKey only after a delivery.
MutualSettle(c, s, releaseKey) ==
  /\ Can("buyer") /\ Can("seller") /\ \E r \in Relays : TRUE
  /\ esc[c] \in Settleable
  /\ releaseKey => esc[c] # "Held"
  /\ esc' = [esc EXCEPT ![c] = "Settled"]
  /\ via' = [via EXCEPT ![c] = "mutual"]
  /\ escrow' = [escrow EXCEPT ![c] = @ - (Price + Fee)]
  /\ wallet' = [wallet EXCEPT !["seller"] = @ + s, !["buyer"] = @ + (Price - s) + Fee]
  /\ moves' = [moves EXCEPT ![c] = @ + 1]
  /\ key' = [key EXCEPT ![c] = releaseKey]
  /\ Act("mutual_settle", Parties, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, up, fees, bond, apBond, apFee>>

\* file_appeal: a party appeals a first-instance decision before appealBy, paying bond and fee
\* (appellant -> appealbond:{id}, appellant -> appealfee:{id}).
FileAppeal(c, p) ==
  /\ Can(p) /\ \E r \in Relays : TRUE
  /\ esc[c] \in {"Released", "Refunded"} /\ via[c] \in {"primary", "fallback"}
  /\ ap[c] = "none" /\ apClk[c] < 1
  /\ ap' = [ap EXCEPT ![c] = "open"]
  /\ appellant' = [appellant EXCEPT ![c] = p]
  /\ wallet' = [wallet EXCEPT ![p] = @ - (ApBond + ApFee)]
  /\ apBond' = [apBond EXCEPT ![c] = @ + ApBond]
  /\ apFee' = [apFee EXCEPT ![c] = @ + ApFee]
  /\ Act("file_appeal", {p}, c)
  /\ UNCHANGED <<esc, via, clk, escClk, apClk, key, moves, up, escrow, fees, bond>>

\* decide on an open appeal (state.ts stepAppeal), before its appealDecideBy; needs the beacon round
\* after the filing. Upheld: appealbond -> bond of the first-instance adjudicator. Overturned: that
\* bond pays the wronged party the price; appealbond -> appellant. Either way appealfee -> appeal adjudicator.
\* The escrow is not touched.
DecideAppeal(c, o) ==
  /\ Can("appeal") /\ Can("beacon")
  /\ ap[c] = "open" /\ apClk[c] < 2
  /\ o \in {"accept", "reject"}
  /\ LET first == IF esc[c] = "Released" THEN "accept" ELSE "reject"
         a == via[c]
         p == appellant[c]
         wronged == IF first = "accept" THEN "buyer" ELSE "seller"
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
  /\ Act("decide_appeal", {"appeal"}, c)
  /\ UNCHANGED <<esc, via, appellant, clk, escClk, apClk, key, moves, up, escrow>>

-----------------------------------------------------------------------------
(* Permissionless timeouts: anyone may trigger them (TimeoutKind in settlement/src/interface.ts). *)

\* expire_offer: Offered or AcceptedByAdjudicator after offerExpiresAt; Agreed after fundBy.
Expire(c) ==
  /\ Trig
  /\ \/ esc[c] \in {"Offered", "AcceptedByAdjudicator"} /\ clk[c] >= 1
     \/ esc[c] = "Agreed" /\ clk[c] >= 2
  /\ esc' = [esc EXCEPT ![c] = "Expired"]
  /\ Act("expire", TrigSigners, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* reclaim: Held after deliverBy; escrow -> buyer (price + fee). The early_reclaim bug fires it at fundBy.
Reclaim(c) ==
  /\ Trig
  /\ esc[c] = "Held" /\ clk[c] >= (IF Bug = "early_reclaim" THEN 2 ELSE 3)
  /\ esc' = [esc EXCEPT ![c] = "Refunded"]
  /\ via' = [via EXCEPT ![c] = "reclaim"]
  /\ escrow' = [escrow EXCEPT ![c] = @ - (Price + Fee)]
  /\ wallet' = [wallet EXCEPT !["buyer"] = @ + (Price + Fee)]
  /\ moves' = [moves EXCEPT ![c] = @ + 1]
  /\ Act("reclaim", TrigSigners, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, key, up, fees, bond, apBond, apFee>>

\* fallback: Delivered after judgeBy.
TriggerFallback(c) ==
  /\ Trig
  /\ esc[c] = "Delivered" /\ clk[c] >= 4
  /\ esc' = [esc EXCEPT ![c] = "FallbackJudging"]
  /\ Act("trigger_fallback", TrigSigners, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* default: FallbackJudging after fallbackBy, or Escalated after its appealDecideBy.
TriggerDefault(c) ==
  /\ Trig
  /\ \/ esc[c] = "FallbackJudging" /\ clk[c] >= 5 /\ via' = [via EXCEPT ![c] = "default_fb"]
     \/ esc[c] = "Escalated" /\ escClk[c] >= 1 /\ via' = [via EXCEPT ![c] = "default_esc"]
  /\ esc' = [esc EXCEPT ![c] = "Defaulted"]
  /\ Act("trigger_default", TrigSigners, c)
  /\ UNCHANGED <<ap, appellant, clk, escClk, apClk, key, moves, up, money>>

\* apply_default: Defaulted -> Refunded. escrow -> buyer (price + fee); the liable bonds compensate the
\* seller: primary and fallback after FallbackJudging, appeal after Escalated. The mint bug skips the debit.
ApplyDefault(c) ==
  /\ Trig
  /\ esc[c] = "Defaulted"
  /\ LET liable == IF via[c] = "default_fb" THEN {"primary", "fallback"} ELSE {"appeal"}
     IN /\ bond' = IF Bug = "mint" THEN bond
                   ELSE [a \in Adjs |-> IF a \in liable THEN bond[a] - Comp ELSE bond[a]]
        /\ wallet' = [wallet EXCEPT !["buyer"] = @ + (Price + Fee),
                                    !["seller"] = @ + Comp * Cardinality(liable)]
  /\ esc' = [esc EXCEPT ![c] = "Refunded"]
  /\ escrow' = [escrow EXCEPT ![c] = @ - (Price + Fee)]
  /\ moves' = [moves EXCEPT ![c] = @ + 1]
  /\ Act("apply_default", TrigSigners, c)
  /\ UNCHANGED <<via, ap, appellant, clk, escClk, apClk, key, up, fees, apBond, apFee>>

\* appeal_expiry: none after appealBy (nothing moves); open after appealDecideBy (bond and fee returned).
ExpireAppeal(c) ==
  /\ Trig
  /\ \/ /\ ap[c] = "none" /\ apClk[c] >= 1
        /\ UNCHANGED <<wallet, apBond, apFee>>
     \/ /\ ap[c] = "open" /\ apClk[c] >= 2
        /\ wallet' = [wallet EXCEPT ![appellant[c]] = @ + apBond[c] + apFee[c]]
        /\ apBond' = [apBond EXCEPT ![c] = 0]
        /\ apFee' = [apFee EXCEPT ![c] = 0]
  /\ ap' = [ap EXCEPT ![c] = "expired"]
  /\ Act("expire_appeal", TrigSigners, c)
  /\ UNCHANGED <<esc, via, appellant, clk, escClk, apClk, key, moves, up, escrow, fees, bond>>

-----------------------------------------------------------------------------
(* Environment: time and the halting actor. *)

\* Deadlines beyond the one the current state can use add no behaviour, so the clock stops there.
Horizon(s) == CASE s \in {"Offered", "AcceptedByAdjudicator"} -> 1
                [] s = "Agreed" -> 2
                [] s = "Held" -> 3
                [] s = "Delivered" -> 4
                [] s = "FallbackJudging" -> 5
                [] OTHER -> 0

TickAbs(c) ==
  /\ clk[c] < Horizon(esc[c])
  /\ clk' = [clk EXCEPT ![c] = @ + 1]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, escClk, apClk, key, moves, up, money>>

TickEsc(c) ==
  /\ esc[c] = "Escalated" /\ escClk[c] < 1
  /\ escClk' = [escClk EXCEPT ![c] = 1]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, apClk, key, moves, up, money>>

TickAppeal(c) ==
  /\ \/ ap[c] = "none" /\ apClk[c] < 1
     \/ ap[c] = "open" /\ apClk[c] < 2
  /\ apClk' = [apClk EXCEPT ![c] = @ + 1]
  /\ Act("tick", {}, c)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, key, moves, up, money>>

Crash ==
  /\ Halted # "none" /\ up
  /\ up' = FALSE
  /\ Act("crash", {}, CHOOSE c \in C : TRUE)
  /\ UNCHANGED <<esc, via, ap, appellant, clk, escClk, apClk, key, moves, money>>

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

\* Weak fairness only on the "anyone" triggers, the clock and the halting actor's crash.
\* No named actor (parties, adjudicators, operator, beacon) is ever required to act.
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
  /\ key \in [C -> BOOLEAN] /\ moves \in [C -> Nat] /\ up \in BOOLEAN
  /\ wallet \in [Parties -> Int] /\ escrow \in [C -> Int] /\ fees \in [Adjs -> Int]
  /\ bond \in [Adjs -> Int] /\ apBond \in [C -> Int] /\ apFee \in [C -> Int]

\* No posting creates or destroys a unit.
Conservation == Total = InitialTotal

NonNegative ==
  /\ \A p \in Parties : wallet[p] >= 0
  /\ \A a \in Adjs : fees[a] >= 0 /\ bond[a] >= 0
  /\ \A c \in C : escrow[c] >= 0 /\ apBond[c] >= 0 /\ apFee[c] >= 0

\* Each escrow is paid out at most once.
SettleOnce == \A c \in C : moves[c] <= 1

\* The escrow holds price + fee exactly while funded and undecided, and nothing otherwise.
EscrowMatchesState == \A c \in C : escrow[c] = IF esc[c] \in Funded THEN Price + Fee ELSE 0

\* The buyer has the key only with a release (or a settlement that chose to release it), and always
\* has it once released.
KeyOnlyWithPayment ==
  \A c \in C :
    /\ key[c] => esc[c] \in {"Released", "Settled"}
    /\ esc[c] = "Released" => key[c]

\* Every fund movement follows a valid signature, decision or expired timeout. Judged on the state
\* before the step and the step's recorded name and signers, independently of the action guards.
Decreased(f, x) == f'[x] < f[x]

Turn(c) == CASE esc[c] = "Delivered" -> "primary"
             [] esc[c] = "FallbackJudging" -> "fallback"
             [] esc[c] = "Escalated" -> "appeal"
             [] OTHER -> "nobody"

OnTime(c) == CASE esc[c] = "Delivered" -> clk[c] < 4
               [] esc[c] = "FallbackJudging" -> clk[c] < 5
               [] esc[c] = "Escalated" -> escClk[c] < 1
               [] OTHER -> FALSE

EscrowDebitOK(c) ==
  /\ act'.c = c
  /\ \/ /\ act'.name = "decide" /\ act'.signers = {Turn(c)} /\ OnTime(c)
        /\ Turn(c) # "primary" => Can("beacon")
     \/ act'.name = "early_accept" /\ act'.signers = {"buyer"} /\ esc[c] = "Delivered"
     \/ act'.name = "mutual_settle" /\ act'.signers = Parties /\ esc[c] \in Settleable
     \/ act'.name = "reclaim" /\ esc[c] = "Held" /\ clk[c] >= 3
     \/ act'.name = "apply_default" /\ esc[c] = "Defaulted"

AppealDecidedOK(c) ==
  act'.name = "decide_appeal" /\ act'.signers = {"appeal"} /\ ap[c] = "open" /\ apClk[c] < 2 /\ Can("beacon")

BondDebitOK(a) ==
  LET c == act'.c IN
  \/ AppealDecidedOK(c) /\ via[c] = a
  \/ /\ act'.name = "apply_default" /\ esc[c] = "Defaulted"
     /\ a \in (IF via[c] = "default_fb" THEN {"primary", "fallback"} ELSE {"appeal"})

AppealDebitOK(c) ==
  /\ act'.c = c
  /\ AppealDecidedOK(c) \/ (act'.name = "expire_appeal" /\ ap[c] = "open" /\ apClk[c] >= 2)

Authorized ==
  /\ (Halted \in act'.signers) => up
  /\ \A c \in C : Decreased(escrow, c) => EscrowDebitOK(c)
  /\ \A p \in Parties : Decreased(wallet, p) => act'.signers = {p} /\ act'.name \in {"fund", "file_appeal"}
  /\ \A a \in Adjs : Decreased(bond, a) => BondDebitOK(a)
  /\ \A a \in Adjs : ~Decreased(fees, a)
  /\ \A c \in C : (Decreased(apBond, c) \/ Decreased(apFee, c)) => AppealDebitOK(c)

AuthorizedMoves == [][Authorized]_vars

\* guaranteed_on_decision (ADR-0012): the key moves only in a step that pays out the escrow, a release
\* always carries it, and it is never taken back.
AtomicKey ==
  [][\A c \in C :
       /\ (~key[c] /\ key'[c]) => Decreased(escrow, c)
       /\ (esc[c] # "Released" /\ esc'[c] = "Released") => key'[c]
       /\ key[c] => key'[c]]_vars

-----------------------------------------------------------------------------
(* Liveness *)

\* Every funded commitment's escrow is paid out.
FundedSettles == \A c \in C : (esc[c] = "Held") ~> (esc[c] \in MoneyDone)

\* ... and its appeal state closes too (finalAt, D20).
FundedFinal == \A c \in C : (esc[c] = "Held") ~> (esc[c] \in MoneyDone /\ ap[c] \notin {"none", "open"})

\* Every offer ends: expired, or funded and then paid out.
OfferEnds == \A c \in C : (esc[c] = "Offered") ~> (esc[c] \in MoneyDone \cup {"Expired"})

=============================================================================
