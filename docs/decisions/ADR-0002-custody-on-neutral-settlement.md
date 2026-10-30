# ADR-0002: Custody on a neutral settlement layer; fiat only through ramps

- **Status:** Proposed. Decide today (D2, D7).
- **Date:** 2026-10-30

## Context

Card and processor holds are controlled by the processor and the platform. Stripe's docs state it "doesn't provide escrow services." A card authorization lasts about 7 days for customer-initiated payments and about 4 days 18 hours for Visa merchant-initiated payments (Stripe, "Place a hold on a payment method"). The payer also keeps chargeback rights after capture. None of this passes ADR-0001.

## Decision

- Held funds live in an escrow on a settlement layer with no owner, pause, freeze, blacklist or upgrade proxy.
- Phase 1 uses SimChain, which implements the same rules in-process. Phase 2 moves to an EVM contract.
- Cards, Stripe test mode and other fiat sources are on-ramps, which convert to the settlement token before the hold, and off-ramps, which convert after release.

## Consequences

- Card authorization windows do not bound the escrow.
- Chargeback risk sits with the on-ramp provider, which is how on-ramps operate today. This is untested for agent-initiated purchases (PRD assumption 7).
- Issuer-freezable stablecoins are a residual risk. The escrow accepts any ERC-20.
- The demo must say plainly that cards enter only as ramps.

## Alternatives considered

- Stripe manual-capture hold with platform-decided capture: fails ADR-0001.
- A hybrid by amount: two trust models.
