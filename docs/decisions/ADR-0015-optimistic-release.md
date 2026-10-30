# ADR-0015: Optional optimistic release

- **Status:** Accepted, 2026-10-30 (D11), with the amendments below. Built in Phase 4; the schema shape lands in v0.5.
- **Amended after:** an independent research pass (Fable, max effort). It found that the first draft failed the neutrality test: "default works as in guaranteed_on_decision" would refund a buyer who already holds the work, with no bond reserved to compensate the seller.
- **Date:** 2026-10-30
- **Raised by:** Rafa, in chat on October 30, 2026: let parties choose optimistic release, under the principle of user choice. No task file yet. Related to ADR-0014 (D10).

## Context

In the modes so far, an adjudicator judges every delivery that deterministic checks do not settle:
- `guaranteed_on_decision`: funds move at the decision;
- `settle_after_window`: funds move after the appeal window.

That is what lets the buyer pay without seeing the work first (ADR-0012). It also costs a panel run on most commitments, even when both parties are satisfied.

Many commitments do not need that. A buyer may be willing to inspect the work itself and dispute only if something is wrong, the way optimistic protocols treat the third party as needed only on dispute (Asokan, Shoup and Waidner 1998; UMA's optimistic oracle in `docs/research/prior-art.md`).

**Design principle (Rafa).** The parties choose; the protocol enforces what they chose. Holdback offers modes with stated tradeoffs. It does not pick one for everyone.

## Decision

Add a third settlement mode, `optimistic`, which parties select per commitment at agreement. Both signatures cover it, as with the other modes.

1. **Work release at delivery.** In `optimistic` mode the delivery carries the content key encrypted to the buyer, so the buyer can inspect the work at once. Only the money is held. The parties waive the two-sided hold of ADR-0012 for this commitment.
2. **Dispute window.** The terms set an absolute date, `disputeBy`. Until then, the buyer may:
   - accept early, which releases payment at once;
   - open a dispute, by signing a dispute message, paying the adjudication fee and posting a dispute bond.
3. **Tacit acceptance.** If no dispute is open at `disputeBy`, the parties have tacitly agreed that the work is complete. Anyone can trigger release to the seller, and no adjudicator call is possible for that commitment afterwards.
4. **Disputes use the existing pipeline.** A dispute runs deterministic checks, then the panel, under the commitment's bound `registryHash` and `policyHash`. Outcomes:
   - **Accept:** release to the seller. The buyer's dispute bond goes to the seller.
   - **Reject:** refund to the buyer, and the dispute bond is returned. The seller cannot recover the work, because the buyer already has it. That is the risk the seller accepted by choosing this mode.
   - Escalation, appeal and fallback work as in `guaranteed_on_decision` (ADR-0007), with the dispute decision as the first decision.
   - **Default differs.** If no adjudicator decides a dispute in time, the default outcome is release to the seller, because tacit acceptance is the baseline the parties chose. The buyer's dispute bond is returned, and the held adjudication fee goes back to the buyer, because no one judged. A defaulting adjudicator's reserved bond compensates the buyer at the rulebook's `buyerCompensationRate`, mirroring D5.
   - **Reservation at dispute open.** The primary adjudicator signs an `AdjudicatorAcceptance` at agreement with `bondReserved = 0`. When a dispute opens it must reserve 100% of price. If it cannot, the dispute passes to the fallback at once, and then to the default.
   - **Dispute windows** count from dispute open (`disputeJudgeSec`, `disputeFallbackSec`), as appeal windows already do in core.
5. **Deterministic checks at delivery are optional.** If the terms include required deterministic checks, they run at delivery, and a failure refunds as in the other modes, at `minFee`. With no required checks, nothing runs unless the buyer disputes.
6. **Fees and bonds.** The named adjudicators commit no capital and earn nothing unless a dispute opens.
   - The disputing buyer pays the adjudication fee.
   - An adjudicator's bond is encumbered only from the moment a dispute opens.
   - The dispute bond is a rulebook parameter, with a default equal to the adjudication fee. It goes to the seller when the dispute fails. No self-dispute profit path exists, so no protocol share is taken (unlike UMA's half-to-store split).
7. **Timing.** `deliverBy` plus a rulebook minimum inspection window ≤ `disputeBy`, so every on-time delivery leaves the buyer at least that window. Late delivery is not allowed: after `deliverBy`, anyone can trigger reclaim, as in the other modes. On the Commerce Payments Protocol, the rules contract captures at release, and `authorizationExpiry` ≥ `disputeBy` plus the dispute and appeal windows plus a margin (ADR-0003).
8. **Choosing.** The SDK shows each mode's tradeoff and fee quote side by side. Clubs may restrict which modes their rulebook allows, including excluding `optimistic`. No mode is a protocol-wide default except in a rulebook.

| Mode | Buyer sees work | Judged | Adjudicator capital | Cost when no one disputes |
| --- | --- | --- | --- | --- |
| `guaranteed_on_decision` | After acceptance | Every delivery the checks do not settle | 100% of price, until `appealDecideBy` | Panel run plus capital charge |
| `settle_after_window` | Design open (ADR-0012) | Every delivery the checks do not settle | 20% of exposure | Panel run plus capital charge |
| `optimistic` | At delivery | Only on dispute | Only once a dispute opens | Checks only, or nothing |

### Who may dispute (D19)

- Only the buyer disputes at first instance. Silence pays the seller, so the buyer is the party the default disfavors, and that party holds the call.
- The seller's instruments are the release at `disputeBy`, which anyone can trigger, and mutual settlement (ADR-0019). Appeals already let either party call the appeal adjudicator.
- A seller call at first instance was considered and rejected (D19). It would let one party shorten the inspection window the other signed for, and the seller gains little from it. It can be reopened if pilots show buyers using informal rejection threats while `disputeBy` sits far beyond `minInspectionWindowSec`. Even then, a seller call would be allowed only after `deliveredAt + minInspectionWindowSec`, for the fee only, with a response window for the buyer.

## Alternatives considered

- **Keep judged modes only.** This protects the seller's work in every case, but charges for a panel on commitments where both parties are satisfied, and it overrides the parties' choice.
- **Make optimistic release the default.** This is cheaper for most commitments, but it removes the protection of the two-sided hold for sellers who never chose to give it up.
- **Optimistic release with the work still encrypted until `disputeBy`.** This keeps the work held, but the buyer cannot inspect what it is tacitly accepting, so the acceptance is not informed.
- **Allow late adjudication after `disputeBy`.** This gives the buyer more recourse, but settlement is never final and the seller's payment stays contestable. It defeats the tacit agreement.

## Consequences

- **The protocol gains a design principle:** user choice among modes with stated tradeoffs. Future features should be options parties select, unless an option would let one party break the neutrality test against the other.
- **Schema v0.5** (shape only; built in Phase 4):
  - `SettlementMode` gains `optimistic`;
  - `timing` gains `disputeBy`, `disputeJudgeSec` and `disputeFallbackSec`, required only in this mode;
  - messages gain `Dispute`, buyer-signed, with bond and fee authorization; the API gains `POST /v1/commitments/{id}/disputes`;
  - the delivery already carries the key for the buyer (T-004 requires it), so no delivery change is needed;
  - the club rulebook's `defaultOutcome` becomes per mode: `judged: { refundBuyer, sellerCompensationRate }` and `optimistic: { release, buyerCompensationRate }`. Today `refundBuyer` is `const true` (measured);
  - the rulebook gains `minInspectionWindowSec` and `disputeBond`.
- **State machine:**
  - `Delivered → Disputed` (buyer, before `disputeBy`);
  - `Delivered → Released` (anyone, after `disputeBy`, or the buyer's early acceptance);
  - `Disputed` then follows the judged path.
- **Incentives (ADR-0014).** Optimistic commitments pay for adjudication only when it is used, which meets Rafa's third principle directly. Audit sampling cannot cover undisputed optimistic commitments, because nothing was judged.
- **New fixtures:**
  - `optimistic-no-dispute-releases`: release after `disputeBy`, triggered by anyone;
  - `optimistic-dispute-upheld`;
  - `optimistic-dispute-rejected`;
  - `error.dispute-after-deadline`;
  - `neutrality.optimistic-buyer-silent`: silence releases the payment;
  - `neutrality.optimistic-adjudicator-offline-during-dispute`;
  - `neutrality.optimistic-dispute-adjudicators-silent-releases`: primary and fallback both silent during a dispute, the default releases to the seller and the buyer gets its bond and fee back.
- **Phase.** Not in the Phase 1 demo. It is simpler than `settle_after_window`: no key-release design and no capital until a dispute. It could come before that mode in Phase 4.

## Litmus tests

- **Neutrality.** Once both parties have signed and the buyer has funded the hold, no single party can stop settlement. The buyer can delay payment only until `disputeBy`, and only by paying for a dispute. After that, anyone can trigger release. The seller cannot take funds before `disputeBy` or a decision. During a dispute, the fallback applies, and silence by every adjudicator resolves to the pre-dispute terms: release to the seller. No silent party can turn the outcome against the one who acted. No party can shorten the other's signed window (D19).
- **The hold.** The money is held, with an expiry, idempotent operations and anyone-can-trigger timeouts, as in every mode. The work is not held: the parties chose that, and the neutrality test's "held work" applies only to modes that hold it.
- **Defended judgment.** Unchanged when it runs. Fewer commitments are judged, so less traffic feeds the quality signals in ADR-0014.
