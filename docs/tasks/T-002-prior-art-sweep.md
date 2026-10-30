# T-002: Prior-art sweep: confirm the gap; evaluate Commerce Payments Protocol for D3

- **Lane:** research
- **Phase:** 0
- **Depends on:** —
- **Paths this task may touch:** `docs/research/prior-art.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** research-lane agent (Claude Code), 2026-10-30

## Intent

Confirm or refute that no existing product meets all three litmus tests (neutrality, hold, defended multi-model judgment). Answer ADR-0003's spike questions from public sources.

Restatement (research agent): Check whether any shipped or announced product already gives agents all three things Holdback promises at once: settlement no single party can block or redirect, a real expiring hold outside fiat rails, and acceptance decided by a defended cross-family model panel with bonded appeals. If one does, Holdback should build on it or not exist; if none does, show where each falls short. Separately, read the actual `AuthCaptureEscrow` source to answer ADR-0003's six questions well enough for Rafa to decide D3 today, and list what only a hands-on spike (T-201) can settle. Output is one research document; no code.

## Context

- `docs/research/escrow-options-2026-10.md`, `docs/research/agent-to-agent-commitments-report.md`, ADR-0001, ADR-0003.

## Acceptance criteria

- [ ] Table of at least 10 candidates (Commerce Payments Protocol, ERC-8183/Virtuals ACP, x402 + x402B + x402r, Kustodia, Escrow.com API, Trustless Work, Stripe holds/Connect, Kleros, UMA optimistic oracle, any new 2026 entrants) scored against the three litmus tests with sources.
- [ ] Answers to ADR-0003 spike questions 1–6 with links to code lines where possible (read `base/commerce-payments` source).
- [ ] Recommendation for D3 with confidence level and what the hands-on spike T-201 must still verify.
- [ ] Every claim cites a source; vendor-only claims flagged.

## Out of scope

- Writing code or contracts.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- [measured] `docs/research/prior-art.md` scores 13 rows (15 products incl. x402/x402r/x402B split) against N/H/J, each with sources; vendor-only claims tagged `[vendor-only]`.
- [measured] Read `base/commerce-payments` `src/` at tag v1.1.0 (`6b0a5ef3`), confirmed identical to `main` `b748fdd7` via GitHub compare API; all Q1–Q6 answers link pinned lines.
- [measured] Read x402r `PaymentOperator` (contract operator over canonical `AuthCaptureEscrow` v1.0.0), Virtuals `ACPSimple`, Trustless Work Soroban escrow, `KlerosLiquid` governor functions at pinned SHAs.
- [measured] grep of commerce-payments `src/` for owner/admin/pause/upgrade/proxy/tx.origin finds no admin surface.
- [inferred] Gap verdict: no candidate passes all three tests; J is the unfilled layer.
- Not verified: no code compiled, run or forked; audit PDFs not read; deployed bytecode at Base/Base Sepolia addresses not compared with source; Virtuals `ACPSimple` not matched to deployed contract; Kustodia, x402B, Nava, ClawBank pilot rest on vendor or secondary sources only.
- Note: one fetched page (YouMind mirror of the ClawBank post) contained embedded instructions addressed to summarisers; treated as page data and ignored.
- `/verify`, `pnpm` and `forge` not run: docs-only change, no code.

## Decisions

- Scored x402, x402r and x402B as separate rows because they differ on every test.
- Pinned code links to tag v1.1.0 rather than `main`, since `src/` is identical and the tag is the deployed version.
- Added Circle Refund Protocol, the ClawBank/Kleros pilot, GenLayer and Nava as 2026-relevant entrants; omitted products with no escrow or judgment component (AP2, Stripe/OpenAI ACP) beyond earlier notes.
- Recommendation for D3: adopt `AuthCaptureEscrow` v1.1.0 with a no-admin rules contract as operator; confidence medium-high (see prior-art.md).

## Handoff

- Ready for review by Rafa (D3 decision) and the `reviewer` agent.
- For T-201: the nine hands-on checks are listed under "What T-201 must still verify" in `docs/research/prior-art.md`.
- For ADR-0003 (human gate, not edited here): consider adding (a) capture only after appeals close, since post-capture refunds are not escrow-backed; (b) the default-outcome trigger must fire before `authorizationExpiry`; (c) a separate bond escrow; (d) pin v1.1.0, not v1.0.0 (fee interface differs).
- `docs/research/escrow-options-2026-10.md` says T-002 updates it; I left it unchanged because it is outside this task's paths. A one-line pointer to `prior-art.md` would close that.
