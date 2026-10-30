# ADR-0007: Bonded adjudicators, fallback, default outcome, settlement modes

- **Status:** Proposed. Decide today (D5, D6).
- **Date:** 2026-10-30

## Decision

- Anyone may register as an adjudicator by posting a bond. Each commitment names a primary, a fallback and an appeal adjudicator, all chosen by the parties at agreement.
- An adjudicator may not judge a commitment involving a member it is affiliated with.
- **Bonds:**
  - New assignments require bond ≥ coverage ratio (default 20%) × open exposure.
  - An overturned decision pays the wronged party the price from the bond.
  - A missed deadline pays the seller compensation set by the rulebook (D5-A).
- **Timeouts:** when judgeBy passes, the fallback adjudicator may decide. When fallbackBy passes, anyone triggers the default outcome: refund the buyer and compensate the seller from the defaulting adjudicators' bonds.
- **Settlement modes:** `guaranteed_on_decision` is the demo default (D6-A); `settle_after_window` is also supported.

## Consequences

- No adjudicator can hold a commitment hostage.
- Capital stands behind every decision, and the fee prices the adjudicator's measured error rate.
- Bond sizing has no loss data yet (PRD assumption 4).
