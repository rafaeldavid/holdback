# T-056: A budget for the planned costs

- **Lane:** research
- **Phase:** 10
- **Depends on:** nothing to start. T-053's unit costs make the per-deal figures measured instead of estimated.
- **Paths this task may touch:** `docs/costs.md` (the "Planned" table), `docs/research/<date>-planned-costs.md` (new), `docs/tasks/T-056-planned-cost-budget.md`
- **Human gate:** **yes** for quotes: contacting an auditor, a trademark attorney or a provider's sales team is outward-facing, so Rafa sends every request. The research itself needs no gate.
- **Status:** todo
- **Agent/session:** —

## Intent

Before each gate that brings a new cost (mainnet, the live on-ramp, the trademark), Rafa should know its size and its drivers, from sources rather than memory.

- Inputs: the "Planned" rows of `docs/costs.md`; measured gas per deal (T-202, T-209, T-205); measured judge tokens (T-028); T-053's unit costs once they exist.
- Outputs: a research note with a range per cost and its sources, updated "Planned" rows, and drafted quote requests for Rafa to send.
- Non-goals: choosing an auditor or attorney (Rafa), any purchase, mainnet deployment.

## Agent steps

1. **Mainnet gas per deal.** From measured gas (about 375k gas for a happy path in two transactions, 440k with the fee bundled; `docs/backlog.md`), the cost per deal at a range of gas prices and ETH prices, and the operator fee that recovers it (D33 as amended). Mark the inputs measured and the prices as of their date.
2. **Judges at volume.** Cost per judged deal by deliverable size, from T-028's measured tokens and current list prices, for a panel of three and an appeal of five.
3. **Cloudflare at volume.** Workers and Durable Object cost per 1,000 deals from T-053's unit cost, against the included amounts.
4. **Stripe.** Read Stripe's US pricing page from a US locale (the page geo-redirects; documented 2026-11-03), the stablecoin and crypto on-ramp fees, and what a test-mode on-ramp costs (Phase 5, D7, D42).
5. **Trademark.** The USPTO fee schedule from the USPTO's own page, the classes "Crow" would need (software, financial services), and a range for attorney fees from published sources.
6. **External audit.** The scope in lines per contract, the drand verifier review (`docs/backlog.md`), and published ranges; a draft request for quotes listing the scope, commit and timeline.
7. **The budget.** One table per gate (Sepolia to mainnet; the live on-ramp; the trademark): each cost, its range, its source, and what drives it up.

## Rafa's steps

1. Read the research note and decide which quotes to request (human).
2. Send the drafted requests yourself and record the answers in `reports/costs/register.md` (human).

## Acceptance criteria

- [ ] The research note gives each planned cost a range with at least one source read on the vendor's or the authority's own page, labeled documented, inferred or guessed.
- [ ] The per-deal gas and judge figures are computed from measured inputs that the note cites by task and file.
- [ ] `docs/costs.md` "Planned" rows link the note and hold no quote Rafa received (quotes stay in the register).
- [ ] The drafted quote requests are in the note, unsent.

## Out of scope

- Signing anything, sending anything, mainnet, choosing vendors.

## Evidence

## Decisions

## Handoff
