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
- On a co-signed mutual settlement with `releaseKey: true`, the rules contract releases that same buyer key with the payment. With `releaseKey: false` the seller keeps the work (ADR-0019, D15).
- The settlement layer cannot check that the released key decrypts the committed plaintext. "Missing or wrong key" is an appeal ground backed by the adjudicator's bond, and an appeal decision may carry the key to the buyer.
  - *Amended 2026-11-01 by D32:* the appeal ground covers judged outcomes only. An early accept is the buyer's own acceptance, settlement allows no appeal after it, and checking that its envelope opens before signing is the buyer's responsibility (the reference verifier does it). A seller who sealed a wrong key is answerable outside the protocol, with the signed record as evidence (D26).
- On rejection or reclaim, the key is never released to the buyer.

## Rationale

This is delivery versus payment for digital work. It follows optimistic fair exchange (Asokan, Schunter and Waidner 1997; Asokan, Shoup and Waidner 1998), with the adjudicator as the third party that matters only on acceptance and dispute.

## Consequences

- Adjudicators see plaintext. They are bonded and named by both parties. Confidential-compute judging is a later option.
- Buyers verify plaintext against the committed hash after release.

## Amended by ADR-0020 (D16)

- Keys go only to those who need them. The primary gets the content key at delivery in `guaranteed_on_decision`. The fallback's envelope is released on takeover: SimChain holds it in Phase 1, and in Phase 2 it is time-locked to the beacon round at `judgeBy`. The appeal adjudicator's key is carried by the `escalate` decision or the appeal, with a time-lock at `appealBy` as a backstop.
- In optimistic mode a `Dispute` carries keys for all three adjudicators; with no dispute, no adjudicator reads the work.
- The work is never published by the protocol at any disclosure level.
