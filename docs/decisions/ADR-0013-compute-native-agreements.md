# ADR-0013: Research track for agreements funded by the user's compute or API access

- **Status:** Proposed. Decide today whether to run the spike (D9).
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

## Consequences

- If R1 proves viable, it becomes demo beat 9 and Phase 6 work.
- R3 and R4 become questions to raise with AI labs in the demo's closing section.
