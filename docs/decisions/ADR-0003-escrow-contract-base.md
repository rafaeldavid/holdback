# ADR-0003: Escrow contract base

- **Status:** Accepted, 2026-10-30 (D3, option A), subject to the hands-on spike T-201. Amended with T-002's findings (`docs/research/prior-art.md`) and the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`).
- **Date:** 2026-10-30

## Context

The Commerce Payments Protocol from Coinbase and Shopify (repository `base/commerce-payments`, Foundry, MIT per secondary listings) provides `AuthCaptureEscrow` with six operations:

- authorize;
- capture;
- charge;
- void;
- reclaim (by the payer after expiry);
- refund.

Its operators are permissionless, and its token collectors support ERC-3009, Permit2, allowances and spend permissions. Its operator decides capture. It has no acceptance or dispute layer.

ERC-8183 (Agentic Commerce, draft, February 25, 2026) defines job escrow with an evaluator and a permissionless refund after expiry. It has "no dispute resolution or arbitration."

Neither is a complete solution. One may serve as a base.

## Decision

Use `AuthCaptureEscrow` v1.1.0 (pinned; its fee interface differs from v1.0.0) for the buyer's funds, with a Holdback rules contract as its operator. The rules contract has no admin keys. It may capture or void only on:
- a valid adjudicator decision for that commitment;
- a buyer's early acceptance;
- a timeout that anyone can trigger.

Conditions, each to be confirmed in T-201:
- **Capture timing depends on the settlement mode.** In `guaranteed_on_decision`, the rules contract captures or voids at the decision, and a wrongful decision is repaid only from the adjudicator's bond, because a post-capture `refund` is not paid from the hold. In `settle_after_window`, it captures only after the appeal window closes or the appeal is decided.
- **Expiry.** `authorizationExpiry` is at least `appealDecideBy` plus a margin sized for forced inclusion, and `refundExpiry` equals it. Otherwise an accept in `settle_after_window` can expire and the buyer reclaims.
- **Timeouts.** `reclaim` is payer-only, so the rules contract supplies every permissionless timeout.
- **Idempotency.** `capture` takes no nonce and only decrements the capturable amount. The rules contract supplies idempotency and the settle-once guard.
- **Fees.** `PaymentInfo` sets `feeReceiver = 0`, `minFeeBps = 0` and `maxFeeBps = 10000`, because the fee goes to whichever adjudicator decided and is also paid on the refund path (a fee-only capture, then `void`). The buyer's protection against fee diversion is the rules contract's code. The fee recipient per decision path is in `docs/architecture.md`.

Payer reclaim after expiry is the final liveness backstop. Emit ERC-8183-compatible events for interoperability.

If T-201 shows the operator model cannot be driven by a rules contract, implement ERC-8183 with extensions for appeal, bonds, fallback and key release.

## Spike questions (T-002 desk research, T-201 hands-on)

1. Can the operator be a contract, and are any operator functions restricted to externally owned accounts?
2. How do operator fees and fee recipients work?
3. Can capture split payment between seller and adjudicator?
4. How do reclaim timing and the expiry fields interact with our deadlines?
5. Which networks have deployments, and which audits exist?
6. Does any part of the contract carry admin or upgrade control?

## Consequences

- `AuthCaptureEscrow` covers the buyer's funds only. Adjudicator bonds, appeal bonds, key release, timeouts and idempotency live in the rules contract and a bond escrow. That is the custody and audit surface Holdback owns; the existing audits cover only the vault.
- Reusing custody code reduces that surface but adds a dependency whose deployed bytecode is not yet compared with the tagged source (T-201).
