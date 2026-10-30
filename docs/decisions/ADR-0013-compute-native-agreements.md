# ADR-0013: Research track for agreements funded by the user's compute or API access

- **Status:** Accepted, 2026-10-30 (D9). Spike T-003 reported in `docs/research/compute-native.md`.
- **Date:** 2026-10-30

## Context

Agents already hold one resource without needing a wallet or bank: their user's compute and API access. On Anthropic's platform, API credits cannot be transferred or sold ("Customer may not transfer or sell Credits," Supplemental Credit Terms, March 4, 2024). Resale of services requires Anthropic's approval (Commercial Terms §D.4(a), June 17, 2025).

## Decision

Run spike T-003 on four routes, R1–R4 (`docs/decisions-today.md`):

| Route | Idea |
| --- | --- |
| R1 | Work-for-work barter through two-sided holds |
| R2 | Buyer-supplied compute under a scoped key |
| R3 | Party-funded judges with response attestation |
| R4 | A provider-native hold on API credit, as one rail among many |

For each route, check terms of service, neutrality and feasibility. Do not build any route before the spike reports.

## Outcome of the spike

| Route | Decision | Confidence |
| --- | --- | --- |
| R1 | Build in Phase 6 | Medium-high |
| R2 | Defer | Medium |
| R3 | Drop as a build; keep as a question for labs | High |
| R4 | Drop as a hold; reframe as a payout-rail question | High |

Value can move as the outputs of compute, never as transferable credits.

## Consequences

- R1 becomes demo beat 9 in Phase 6, recorded mode only. It needs a linked two-leg commitment, which is a schema change and a new ADR. The narration says the fee and the liveness stake are still paid in the test token.
- R3 and R4 become questions to raise with AI labs in the demo's closing section.
