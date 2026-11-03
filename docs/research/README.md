# Research

The research behind the design. Open these files only when a decision needs them. The specs in `docs/` cite what they rely on.

| File | What it is | Caveats |
| --- | --- | --- |
| `agent-to-agent-commitments-report.md` | Full report, "Agents Commit for Principals, Not Peers" (October 29, 2026): how agents make commitments today, from triggers to escrow; a framework; a thesis; implications; 127 Chicago notes and a bibliography | Some figures come from AI-authored outlets or aggregators. Its assumptions section lists them |
| `escrow-is-a-missing-verb.md` | Market research essay that motivates the product: clubs first, then bonded adjudicators | Market research, 29 October 2026 |
| `escrow-options-2026-10.md` | Escrow routes an agent can call today, why none fits, and why Anthropic API credits cannot be escrow value | T-002 extends this into `prior-art.md` |
| `prior-art.md` | Prior-art sweep (T-002, October 30, 2026): escrow and judgment for agent commitments, scored against the three litmus tests; the Commerce Payments Protocol answers for D3 | Supersedes the summary table in `escrow-options-2026-10.md` |
| `compute-native.md` | Spike report (T-003): agreements funded by the user's own compute or API access, routes R1–R4; feeds ADR-0013 and D9 | Desk research |
| `2026-11-T-201-cpp-spike.md` | Hands-on spike (T-201, November 1, 2026): can a Holdback rules contract operate CPP's `AuthCaptureEscrow` on a local chain; recommends keeping option A | Measured on anvil; the code is in `contracts/` |
| `prividium-fragment.md` | T-208 research pass (November 2, 2026): Prividium as a single-use fragment per escrow, and Rafa's operated-Prividium option; recommends parking. Ends with the original proposal, moved from `docs/backlog.md` | Read from the public repos and docs; nothing was run |
| `escrow-evolution-model.html` | Interactive step-through model: human escrow → 2025–2026 mechanisms → five speculative futures; includes the full report | Open in a browser; self-contained apart from Google Fonts |
| `engineering-practices-sources.md` | Sources for the agent-team and testing setup (Minsky, Lauren Tan's pstack, React Compiler fixtures) | X posts not retrieved; secondary summaries |
| `notes/` | Seven raw research notes: protocols, fiat payments, crypto-native, deployed cases, experiments and precedents, theory and law, trust and failures | Working notes with per-claim sources and gaps sections |
| Stripe, "Place a hold on a payment method", https://docs.stripe.com/payments/place-a-hold-on-a-payment-method (external; read October 30, 2026) | How long a card authorization can be held before capture. As read: about 7 days for customer-initiated payments, 4 days 18 hours for Visa merchant-initiated ones; uncaptured funds are released when the hold expires. Cited by D2 and `escrow-options-2026-10.md` | Stripe's figures change; check the live page |
