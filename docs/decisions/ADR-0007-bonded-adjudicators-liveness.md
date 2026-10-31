# ADR-0007: Bonded adjudicators, fallback, default outcome, settlement modes

- **Status:** Accepted, 2026-10-30 (D5 option A, D6 option A). Amended after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`).
- **Date:** 2026-10-30

## Decision

- Anyone may register as an adjudicator by posting a bond. Each commitment names a primary, a fallback and an appeal adjudicator, all chosen by the parties at agreement.
- An adjudicator may not judge a commitment involving a member it is affiliated with.
- **Bonds:**
  - New assignments require bond ≥ coverage ratio × open exposure.
  - For `guaranteed_on_decision` commitments the coverage ratio is 100%: each commitment still open to appeal encumbers bond equal to its price until `appealDecideBy`. At 20%, one adjudicator could accept its whole book for sellers it controls, collect every price and lose only a fifth of it.
  - For `settle_after_window` commitments the default coverage ratio stays 20%, because the funds are still held while an appeal is possible.
  - An overturned decision pays the wronged party the price from the bond. Encumbered bond cannot back a second commitment's overturn or default payout at the same time.
  - A missed deadline pays the seller compensation set by the rulebook (D5-A).
- **Appeal fee held (D21):** the appeal fee is held at filing and paid to the appeal adjudicator only when it decides. If `appealDecideBy` passes undecided, the appellant gets the fee back with its bond.
- **Timeouts:** when judgeBy passes, the fallback adjudicator may decide. When fallbackBy passes, anyone triggers the default outcome: refund the buyer and compensate the seller from the defaulting adjudicators' bonds.
- **Escalation:** an escalated case has no first decision. If the appeal adjudicator misses `appealDecideBy`, anyone triggers the default outcome, and the appeal adjudicator's bond pays the seller's compensation. Escalation needs no appellant bond.
- **Resubmission:** Phase 1 sets `maxSubmissions = 1`. In guaranteed mode a reject refunds at the decision, so nothing is left to hold for a second attempt.
- **Settlement modes:** `guaranteed_on_decision` is the demo default (D6-A) and the only mode in Phase 1. `settle_after_window` is specified here and built in Phase 4.
- **Affiliation** is declared by the adjudicator at registration. A self-dealing adjudicator can leave it undeclared, so the 100% coverage rule, not the affiliation check, is what bounds self-dealing.

## Consequences

- No adjudicator can hold a commitment hostage.
- Capital stands behind every decision, and the fee prices the adjudicator's measured error rate.
- Bond sizing has no loss data yet (PRD assumption 4). Guaranteed mode is capital-heavy by design: an adjudicator's open guaranteed volume cannot exceed its bond.
- **Value capture.** The overseer role, meaning the rules contract plus the adjudicators who decide release, is where value accrues. It is permissionless, and adjudicators compete on fees priced from their measured error. Holdback earns only as one adjudicator among many or through tooling, never through control of the judge registry or the rules contract.
- The appeal adjudicator's decision is final within a commitment. That is residual control point 7 in `docs/neutrality.md`.

## Finality (D20)

In `guaranteed_on_decision` the payee's money is final at the decision; an overturn pays from the bond, never from escrow. The commitment is final when no appeal path remains. See `docs/architecture.md` §Finality.
