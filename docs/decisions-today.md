# Decisions to make today

Status: D1–D9 decided October 30, 2026, after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`); the options are kept as the record. D10, D11 and D12 are open. Owner: Rafa. Each decision has options, a recommendation and the ADR it settles. Phase 1 (the demo) can start once D1, D2 and D6 are settled. Phase 2 needs D3 and D4.

## D1. Adopt the neutrality litmus test as the top constraint (ADR-0001)

**Decided 2026-10-30:** adopted (ADR-0001 Accepted). "Held work" means key release; adjudicator plaintext access is residual 6.

**Proposed definition:** no single party can stop a valid commitment from settling according to its terms, or move held funds outside those terms. That covers operators, adjudicators, club operators, on-ramps, model providers and Holdback's own maintainers.

**Residual control points to accept or mitigate:**
- **Stablecoin issuer freezes.** USDC's issuer can blacklist addresses. Mitigation: the escrow accepts any ERC-20, and the prototype uses a test token.
- **L2 sequencer censorship.** The sequencer can delay transactions. Mitigation: forced inclusion through L1, where the chain supports it.
- **Fiat on-ramps can refuse service.** Mitigation: several ramps, plus direct stablecoin funding.

**Recommendation:** adopt the definition, with the residual risks listed in `docs/neutrality.md`.

## D2. Where custody lives (ADR-0002)

**Decided 2026-10-30:** A (ADR-0002 Accepted).

| Option | Passes the litmus test? | Notes |
| --- | --- | --- |
| A. EVM escrow contract with no admin keys; cards and Stripe act only as on-ramps and off-ramps | Yes, apart from the residual risks in D1 | Card chargeback risk sits with the on-ramp |
| B. Stripe manual-capture hold, with the platform deciding capture | No. Stripe or the platform can refuse or reverse it | Card holds last 7 days for customer-initiated payments, about 4 days 18 hours for Visa merchant-initiated (Stripe docs) |
| C. Hybrid: Stripe hold for small amounts, contract above a threshold | Partly | Two trust models to explain and test |

**Recommendation:** A.

## D3. Escrow contract base (ADR-0003)

**Decided 2026-10-30:** A, `AuthCaptureEscrow` v1.1.0 with the conditions in ADR-0003, subject to T-201.

| Option | For | Against |
| --- | --- | --- |
| A. Reuse Coinbase/Shopify Commerce Payments Protocol `AuthCaptureEscrow` for custody, with a Holdback rules contract as its operator | Custody code exists and was built for authorize/capture/void/reclaim/refund. Operators are permissionless, and the payer can reclaim after expiry. | Operator semantics, fees and deployments are unverified. Needs a one-day spike. |
| B. Implement ERC-8183 (Agentic Commerce) and extend it with appeal, bonds and fallback | Agent-native vocabulary; already has an evaluator role and a permissionless refund after expiry | Draft standard; a single evaluator, "no dispute resolution or arbitration"; more code of our own to audit |
| C. Custom escrow | Full control | The most new code |

**Recommendation:** A, subject to two spikes: desk research in T-002 (Phase 0) and hands-on work on a local chain in T-201 (Phase 2). Fall back to B if CPP's operator model cannot run as a rules contract. Expose ERC-8183-compatible events either way.

## D4. Public testnet (ADR-0004)

**Decided 2026-10-30:** deferred to the start of Phase 2 (ADR-0004).

Phase 1 runs on SimChain, an in-process simulation of the escrow rules, so this choice is not urgent. The contract stays chain-agnostic on EVM.

| Option | Notes |
| --- | --- |
| Base Sepolia | CPP origin chain; Coinbase agent tooling |
| ZKsync Sepolia | Native account abstraction and paymasters suit gasless agent accounts. This is your team's stack: decide whether that helps or reads as a conflict. |
| Defer until Phase 2 | Decide after the D3 spike, based on paymaster and account-abstraction needs |

**Recommendation:** defer until Phase 2, and choose on account-abstraction and paymaster fit.

## D5. Liveness default when no adjudicator decides (ADR-0007)

**Decided 2026-10-30:** A (ADR-0007). An escalated case that the appeal adjudicator does not decide also goes to the default outcome, paid from the appeal adjudicator's bond.

If the primary adjudicator misses its deadline and the fallback adjudicator misses its own, anyone can trigger the default outcome.

| Option | Effect |
| --- | --- |
| A. Refund the buyer and pay the seller from the defaulting adjudicators' bonds | The seller is not punished for adjudicator failure, and adjudicators have a reason to stay live |
| B. Split 50/50 | Simple; rewards neither party |
| C. Release to the seller | Buyer pays for unjudged work |

**Recommendation:** A. The seller compensation is a rulebook parameter, default 100% of price up to the bond.

## D6. Default settlement mode for the demo (ADR-0007)

**Decided 2026-10-30:** A, and the only mode in Phase 1. Guaranteed commitments need bond equal to their price while open to appeal (ADR-0007).

| Option | Effect |
| --- | --- |
| A. `guaranteed_on_decision`: funds move when the adjudicator decides; an overturned appeal is paid from the adjudicator's bond | Machine-speed finality with capital behind the judgment. This is the essay's argument. |
| B. `settle_after_window`: funds move after the appeal window closes | Safer, slower; the bond matters less |

**Recommendation:** A for the demo. Support both.

## D7. Fiat funding in the demo (ADR-0002)

**Decided 2026-10-30:** as recommended (ADR-0002).

**Recommendation:** in Phase 5, a Stripe test-mode card payment acts as an on-ramp that mints test tokens into the buyer's account before the hold. The Phase 1 demo funds from a SimChain faucet and states that cards enter only as an on-ramp.

## D8. Hold both sides: money and the work (ADR-0012)

**Decided 2026-10-30:** A (ADR-0012). Atomic key release holds in guaranteed mode; early acceptance carries a seller-supplied key; a missing or wrong key is an appeal ground.

A money-only hold leaves a gap: the buyer sees the deliverable before paying, so it can reject in bad faith and keep the work. The alternative is to hold the work as well:

1. The seller encrypts the deliverable under a fresh content key.
2. The encrypted file and its hash are delivered.
3. The content key is escrowed to the adjudicator.
4. On acceptance, the key is released to the buyer atomically with payment. On rejection, the buyer gets a refund and the seller keeps the work.

This is the digital version of delivery versus payment. It follows the optimistic fair-exchange protocols of Asokan, Shoup and Waidner (1997–1998), where a third party steps in only on dispute.

| Option | Effect |
| --- | --- |
| A. Two-sided hold, with deliverables encrypted and key release tied to settlement | Fair exchange: neither side can take the other's value alone. The panel judges plaintext inside the adjudicator only. |
| B. Money-only hold | Simpler; leaks the work before payment |

**Recommendation:** A. It is cheap in the SimChain demo and is the demo's clearest beat.

## D9. Research track: agreements funded by the user's compute or API access (ADR-0013)

**Decided 2026-10-30:** spike run (T-003). Build R1 in Phase 6, defer R2, drop R3 and R4 as builds (ADR-0013).

Finding: Anthropic's API credits cannot be transferred between accounts (Supplemental Credit Terms, March 4, 2024). Compute cannot serve as transferable money on Anthropic's platform today. Four creative routes go to a research spike (T-003). None blocks the demo.

| Route | Idea | Neutrality | Open issue |
| --- | --- | --- | --- |
| R1. Work-for-work barter | Two agents swap deliverables, each produced on its own user's compute, through two-sided holds on both deliverables (D8). No money moves; a small stake covers liveness. | Passes | Valuation of unequal work; tax treatment of barter |
| R2. Buyer-supplied compute | The seller supplies the method; the job runs on the buyer's own API access under a capped, scoped key. The seller is paid for the outcome. | Partly: the provider and the buyer can revoke access | Whether a contractor's agent may run under the buyer's account under the provider's terms |
| R3. Parties fund the judges | Each party pays for part of the panel through its own provider account | Fails unless responses are attested (TEE or provider-signed), since a party could fake its judge's output | Response attestation |
| R4. Provider-native hold on API credit | Ask an AI lab for a hold primitive on credits | Fails as the only rail; acceptable as one rail among many | A natural question to raise with an AI lab audience in the demo |

**Recommendation:** run the spike in parallel with Phase 1. If the spike holds up, add R1 to the demo as an optional beat.

## D10. Incentives for adjudicators, capital and commitment design (ADR-0014)

**Open.** Needed before Phase 3 (T-306, fee quotes); not needed for the Phase 1 demo.

Rafa's principles: reward better adjudicators; reward capital at risk; make commitments that are likely to need the adjudicator pay for it.

| Part | Proposal | Main risk |
| --- | --- | --- |
| Quality | Public, recomputable signals (overturns, escalations, missed deadlines) plus opt-in audit sampling by a different adjudicator; fees may carry a margin above the cost floor | Audits widen plaintext access (residual 6) |
| Capital | Bond backers earn the capital charge; the adjudicator takes first loss (default 10% of its pool); stake locked until `appealDecideBy` | New held funds and audit surface in the rules contract |
| Commitment design | Price by checkability (deterministic-only terms pay `minFee`); per-attempt fee when a required check fails; no shared party reputation | Pricing estimates rest on each adjudicator's own history |
| Attestation | `attested` judges as a policy option once providers sign responses | Not available today (residual 8) |

**Recommendation:** run the adversarial review on ADR-0014 before deciding.

## D11. Optional optimistic release (ADR-0015)

**Open.** Not needed for the Phase 1 demo; it would land in Phase 4.

Rafa's principle: user choice. Parties may select `optimistic` mode. The work is released to the buyer at delivery, the money is held until `disputeBy`, and with no dispute by then the parties have tacitly accepted: anyone triggers release and no adjudicator call is possible afterwards. A buyer who disputes pays the adjudication fee and a dispute bond, and the existing pipeline judges.

| Choice | Proposal |
| --- | --- |
| Work release | At delivery (the parties waive the two-sided hold) |
| Who may dispute | The buyer, before `disputeBy` |
| Dispute cost | Adjudication fee plus a dispute bond, forfeited to the seller if the dispute fails |
| Inspection time | `disputeBy` ≥ `deliverBy` + a rulebook minimum |

**Recommendation:** review ADR-0014 and ADR-0015 together in one adversarial pass, then decide both.

## D12. Phase 1 contract fixes (ADR-0016)

**Open.** Blocks Phase 1: T-004 cannot fix its types and state machine until this is decided.

The Phase 0 readiness review found gaps that would stop Phase 1 tasks partway. ADR-0016 settles them together.

| Gap | Proposal |
| --- | --- |
| Circular commitment ID; adjudicators consent to nothing | The primary adjudicator signs an acceptance with a seed commitment before funding; the ID hashes terms only |
| Stall before judging; ambiguous guaranteed-mode states | `Delivered → FallbackJudging` at `judgeBy`; state split into escrow state and appeal state |
| No message schemas | `messages.schema.json` with every signed message (v0.4) |
| Clubs, registry, endpoints | Member admission and revocation; adjudicators publish registry hash and URI; acceptance, decision, discovery and membership endpoints |
| Unowned encryption and store | `tweetnacl` plus Web Crypto; a local content-addressed store; new task T-014 |

**Recommendation:** accept ADR-0016, then apply it in one PR (schemas v0.4, state machine, API doc, task files) before T-004 starts.
