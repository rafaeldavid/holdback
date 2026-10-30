# ADR-0003: Escrow contract base

- **Status:** Proposed. Decide today, subject to spikes T-002 and T-201 (D3).
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

## Decision (proposed)

Use `AuthCaptureEscrow` for custody, with a Holdback rules contract as its operator. The rules contract may capture or void only on:
- a valid adjudicator decision for that commitment;
- a buyer's early acceptance;
- a permissionless timeout.

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

Reusing custody code reduces our audit surface. It also adds a dependency whose details are unverified.
