# ADR-0012: Two-sided hold, money and work

- **Status:** Accepted, 2026-10-30 (D8 option A). Amended after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`).
- **Date:** 2026-10-30

## Context

With a money-only hold, the buyer sees the deliverable before paying. It could then reject and keep the work, which is a fair-exchange failure.

## Decision

- The seller encrypts the deliverable with a fresh content key, using AES-256-GCM.
- The delivery carries the ciphertext URI, the ciphertext hash, the plaintext hash, and the key encrypted to the primary, fallback and appeal adjudicators.
- On acceptance, the decision carries the key encrypted to the buyer. In `guaranteed_on_decision`, payment release and key release happen in one atomic step on the settlement layer: the rules contract emits the encrypted key in the same transaction as the capture.
- In `settle_after_window` the two cannot be atomic, because capture happens after the appeal window and an encrypted key published at the decision is readable at once. That mode needs its own key-release design before Phase 4.
- On early acceptance, no adjudicator is involved, so the seller's delivery must also carry the key encrypted to the buyer, and the rules contract releases it with the payment.
- The settlement layer cannot check that the released key decrypts the committed plaintext. "Missing or wrong key" is an appeal ground backed by the adjudicator's bond, and an appeal decision may carry the key to the buyer.
- On rejection or reclaim, the key is never released to the buyer.

## Rationale

This is delivery versus payment for digital work. It follows optimistic fair exchange (Asokan, Schunter and Waidner 1997; Asokan, Shoup and Waidner 1998), with the adjudicator as the third party that matters only on acceptance and dispute.

## Consequences

- Adjudicators see plaintext. They are bonded and named by both parties. Confidential-compute judging is a later option.
- Buyers verify plaintext against the committed hash after release.
