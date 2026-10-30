# ADR-0012: Two-sided hold, money and work

- **Status:** Proposed. Decide today (D8).
- **Date:** 2026-10-30

## Context

With a money-only hold, the buyer sees the deliverable before paying. It could then reject and keep the work, which is a fair-exchange failure.

## Decision

- The seller encrypts the deliverable with a fresh content key, using AES-256-GCM.
- The delivery carries the ciphertext URI, the ciphertext hash, the plaintext hash, and the key encrypted to the primary, fallback and appeal adjudicators.
- On acceptance, the decision carries the key encrypted to the buyer. Payment release and key release happen in one atomic step on the settlement layer.
- On rejection or reclaim, the key is never released to the buyer.

## Rationale

This is delivery versus payment for digital work. It follows optimistic fair exchange (Asokan, Schunter and Waidner 1997; Asokan, Shoup and Waidner 1998), with the adjudicator as the third party that matters only on acceptance and dispute.

## Consequences

- Adjudicators see plaintext. They are bonded and named by both parties. Confidential-compute judging is a later option.
- Buyers verify plaintext against the committed hash after release.
