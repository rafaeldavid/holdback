# Decisions D1–D44

Status: D1–D9 decided October 30, 2026, after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`); the options are kept as the record. D10 to D24 decided October 30 and 31, 2026, each after an independent research pass. D25 to D36 decided October 31 and November 1, 2026, D37 to D40 on November 1 and 2, D41 and D42 on November 3 (Rafa's principles and research-backed choices; D4 was updated on November 1 to target Ethereum mainnet via Sepolia). Newer entries are appended at the end. Owner: Rafa. Each decision has options, a recommendation and the ADR it settles.

Still open (2026-11-03): ADR-0025, Proposed, to be decided with schema v0.9 (T-033); ADR-0027, Proposed (T-308: judgment report, verifiable inference, tuning releases; four open questions, none needed before Phase 3); the ADR-0023 amendment on fee bundling, Proposed (D37); and dispute clauses as selectable terms, deferred until after the demo (D29).

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
| ZKsync Sepolia | Native account abstraction and paymasters suit gasless agent accounts |
| Defer until Phase 2 | Decide after the D3 spike, based on paymaster and account-abstraction needs |

**Recommendation:** defer until Phase 2, and choose on account-abstraction and paymaster fit.

**Updated 2026-11-01 by Rafa: the target settlement chain is Ethereum mainnet.** Chosen for neutrality and reliability: no single sequencer or operator can censor or delay a deal there. What this means in practice:

- **No real money yet (hard rule unchanged).** Phase 2 builds and tests the contracts on a local chain, then on Sepolia, Ethereum's public testnet, with test ETH and a test token. A mainnet deployment is a separate gate for Rafa, after an audit and legal advice.
- **Costs to design around.** Mainnet gas makes every settlement cost real money, which hurts small agent deals. The Phase 2 design should minimise on-chain steps per deal (one funding and one settlement transaction on the happy path), and record the gas per deal in the evidence so the fee (D33) can be checked against it. Rollups stay an option to add later for small deals; the contract stays chain-agnostic.
- **Revisit on evidence.** If measured gas makes typical deals uneconomic, bring this back with numbers.

**To evaluate later: Prividium.** A private, Ethereum-anchored chain run by a permissioned set of operators. The question is whether Crow's operators could run it as a consortium that cannot themselves see the transactions on their own chain, which would give private deals (T-207) without trusting the operators. To evaluate: what the operators can see, how neutrality holds when the operator set is permissioned (who admits operators, whether a party can force inclusion or exit to Ethereum), and how USDC and settlement finality work there. Backlog row under Privacy.

**Update 2026-10-31 (earlier, as the settlement chain):** Matter Labs Prividium was evaluated and not adopted *as the chain that holds the money*. It is a single-operator permissioned chain whose operator can gate access, stop the sequencer, block forced inclusion and read everything (ADR-0004). A fifth criterion now applies: anyone can read the public skeleton and submit a signed message without an admin. A club-chosen permissioned chain is in the backlog.

**How the two Prividium notes fit (2026-11-01):** the 2026-10-31 finding stands for Prividium as the chain that holds the money. The 2026-11-01 note asks a different question: whether a Prividium-style private instance can run a deal's private content while the assets stay in the Ethereum L1 escrow (the single-use fragment exploration, now in `docs/research/prividium-fragment.md`). That exploration must answer the 2026-10-31 objections directly: the fragment's operator must not be able to block settlement (the L1 timeout path works with the fragment offline) and must not be able to read the deal. Tracked as T-208, after T-206.

**Parked 2026-11-03 (Rafa):** "Agree on parking prividium, you can add that to a diff roadmap phase on privacy end-to-end". T-208 moves, parked, into the roadmap's Privacy end to end phase (`docs/plan.md`).

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

**Decided 2026-10-30:** a two-tranche bond pool per adjudicator (ADR-0014 §2a). The adjudicator's own stake is junior and takes losses first; backers are senior, pro rata. One `reserved` counter, a coverage gate of `junior + senior - reserved >= price`, and a forfeited appeal bond credited to junior. T-006 builds the accounts with senior empty and no deposit API; deposits, withdrawals and the capital charge to the pool come in Phase 4. Defaults (guessed): first-loss share at least 10%, notice period one appeal cycle. Audit sampling and checkability pricing wait for later phases.

The proposal below is kept as the record.

Rafa's principles: reward better adjudicators; reward capital at risk; make commitments that are likely to need the adjudicator pay for it.

| Part | Proposal | Main risk |
| --- | --- | --- |
| Quality | Public, recomputable signals (overturns, escalations, missed deadlines) plus opt-in audit sampling by a different adjudicator; fees may carry a margin above the cost floor | Audits widen plaintext access (residual 6) |
| Capital | Bond backers earn the capital charge; the adjudicator takes first loss (default 10% of its pool); stake locked until `appealDecideBy` | New held funds and audit surface in the rules contract |
| Commitment design | Price by checkability (deterministic-only terms pay `minFee`); per-attempt fee when a required check fails; no shared party reputation | Pricing estimates rest on each adjudicator's own history |
| Attestation | `attested` judges as a policy option once providers sign responses | Not available today (residual 8) |

**Recommendation:** run the adversarial review on ADR-0014 before deciding.

## D11. Optional optimistic release (ADR-0015)

**Decided 2026-10-30:** accepted with amendments, built in Phase 4 (ADR-0015). If no adjudicator decides a dispute, the default is release to the seller, and the buyer gets its dispute bond and fee back. The adjudicator reserves 100% of price when a dispute opens, or the dispute passes to the fallback at once. Dispute windows count from dispute open. A failed dispute's bond goes to the seller. Clubs may exclude the mode and set a minimum inspection window. The schema shape lands in v0.5.

The proposal below is kept as the record.

Rafa's principle: user choice. Parties may select `optimistic` mode. The work is released to the buyer at delivery, the money is held until `disputeBy`, and with no dispute by then the parties have tacitly accepted: anyone triggers release and no adjudicator call is possible afterwards. A buyer who disputes pays the adjudication fee and a dispute bond, and the existing pipeline judges.

| Choice | Proposal |
| --- | --- |
| Work release | At delivery (the parties waive the two-sided hold) |
| Who may dispute | The buyer, before `disputeBy` |
| Dispute cost | Adjudication fee plus a dispute bond, forfeited to the seller if the dispute fails |
| Inspection time | `disputeBy` ≥ `deliverBy` + a rulebook minimum |

**Recommendation:** review ADR-0014 and ADR-0015 together in one adversarial pass, then decide both.

## D12. Phase 1 contract fixes (ADR-0016)

**Decided 2026-10-30:** accepted as proposed (ADR-0016), applied with schema v0.4.

The Phase 0 readiness review found gaps that would stop Phase 1 tasks partway. ADR-0016 settles them together.

| Gap | Proposal |
| --- | --- |
| Circular commitment ID; adjudicators consent to nothing | The primary adjudicator signs an acceptance with a seed commitment before funding; the ID hashes terms only |
| Stall before judging; ambiguous guaranteed-mode states | `Delivered → FallbackJudging` at `judgeBy`; state split into escrow state and appeal state |
| No message schemas | `messages.schema.json` with every signed message (v0.4) |
| Clubs, registry, endpoints | Member admission and revocation; adjudicators publish registry hash and URI; acceptance, decision, discovery and membership endpoints |
| Unowned encryption and store | `tweetnacl` plus Web Crypto; a local content-addressed store; new task T-014 |

**Recommendation:** accept ADR-0016, then apply it in one PR (schemas v0.4, state machine, API doc, task files) before T-004 starts.

## D13. Agent-ready API (ADR-0017)

**Decided 2026-10-30:** a trimmed Phase 1 subset of ADR-0017, amended after an independent assessment. It adds lists with a page envelope ordered by event sequence, and reads for clubs, agents and members. It adds 429 with a capped `Retry-After`, request IDs, the schema-version header, and `/v1/status` with the signing domain. It adds an unsigned dry run through `Settlement.validate`, and a receipt schema. Party-authored text is marked untrusted in the schemas. OpenAPI and its contract test follow in T-015, after T-010. RateLimit headers, deprecation headers, operator ranking, Standard Webhooks and x402/AP2 interop wait for later phases.

The proposal below is kept as the record.

Scoring `docs/api.md` against Rafa's 16-question agent readiness test found eight gaps. Errors, money and time formats, current state, the event log, signed webhooks, idempotency, per-agent identity and the audit chain already pass.

| Gap | Proposal |
| --- | --- |
| No list or filter | `GET /v1/commitments` with party, role, state, club and date filters; per-commitment events; cursor pagination everywhere |
| No published limits | `RateLimit` headers, 429 `rate_limited` with `Retry-After`; the SDK waits once, then fails over |
| No API description | `spec/openapi.json` generated from `spec/schemas`, checked for staleness, contract-tested over HTTP (new T-015) |
| No dry run | `?validateOnly=true` on every write; runs guards only, with no effects |
| No version policy | Additive within `/v1`, `Holdback-Schema-Version` header, open enums, `Deprecation` and `Sunset` headers |
| No tracing | `Request-Id` on every response, `traceparent` propagated, never in signed data |
| No self-description | `GET /v1/status`: settlement target, versions, lag, the caller's limits |
| Untrusted text unmarked | `x-holdback-untrusted` on party-authored fields |

**Recommendation:** adopt all of it in T-007 plus T-015 (alternative 1 in ADR-0017). Human approval per payment stays out of the API: the mandate is the standing approval and dry run is the preview.

## D14. Panel seed for fallback and appeal decisions (ADR-0018)

**Decided 2026-10-30:** the fallback and appeal adjudicators take their panel seed from a public randomness beacon, at a round fixed by `judgeBy`, the escalation or the appeal filing. The primary keeps its commit-reveal. SimChain runs a deterministic beacon in Phase 1; drand quicknet in Phase 2. If a round cannot be proven by the deadline, the fallback or default applies; there is no substitute source.

Today only the primary commits to a seed, so a fallback or appeal adjudicator can read the work, call every judge once, and pick the seed whose panel gives the outcome it wants. The check cannot simply apply the primary's commitment to every role, because a silent primary would then leave only the default.

| Option | Effect |
| --- | --- |
| A. Primary-only, gap recorded | No work; shopping by the fallback and the final appeal role stays undetectable |
| B. Commit a seed at takeover | Little defense: the decider already has the work, so it grinds first and commits second |
| C. All three commit before funding | Strong, but funding waits on two more signatures |
| D. Beacon-derived seed (chosen) | No adjudicator or party knows the panel before its round; liveness kept |
| E. VRF per adjudicator | Stops grinding, but a colluding seller can vary the commitment; expensive to verify |

## D15. Mutual settlement (ADR-0019)

**Decided 2026-10-30:** buyer and seller can end a funded, undecided commitment by co-signing a `MutualSettlement` at any split of the price, in every settlement mode. It is allowed in Held, Delivered, FallbackJudging and Escalated, and refused after a decision, in Defaulted, or when the rulebook disables it. One signature moves nothing. Both parties choose whether the buyer receives the content key: with it, the settlement is a discounted acceptance; without it, a paid cancellation in which the seller keeps the work. The fee returns to the buyer in Phase 1, and a later rulebook share can pay an adjudicator that already worked. The adjudicator's reserved bond is released. Adjudicator decisions stay binary: parties split, judges decide. `EarlyAccept` stays as the one-signature special case.

Rafa's framing: escrow as a 2-of-3. The parties agree, or the adjudicator decides when they do not. The third key can only sign the outcomes the terms allow.

| Option | Effect |
| --- | --- |
| A. Co-signed settlement, any split, in every funded undecided state and every mode | Symmetric consent path for both parties; the seller can concede; cheaper than judging |
| B. The same, only before `judgeBy` | Protects late adjudicator revenue, but parties who agree must wait out fallback or escalation windows |
| C. The adjudicator decides splits from the rubric score | Makes the third key discretionary; harder to calibrate and defend |
| D. Defer to Phase 4 | Phase 1 unchanged; the seller concession gap stays |

**Recommendation:** A (research pass, Fable at max effort).

## D16. Privacy model (ADR-0020)

**Decided 2026-10-30:** every commitment has a public skeleton and a private body. The skeleton holds what anyone needs to trigger timeouts and check coverage: addresses, token and amounts, deadlines, adjudicators, mode, hashes, outcomes and money movements. The body (description, criteria, rubric, judgment reasons) is encrypted to the parties and to each adjudicator only when it becomes involved; whoever wants judgment carries the key, and the seller is never the gate. Disclosure is a signed term, `private`, `judgment` or `public`, with a rulebook minimum; a co-signed `Publish` can only raise it. Bond backers get aggregate signals, not cases. Compliance follows the banking pattern without a freeze: screen at admission and on-ramps, report after the fact, disclose by view key, unmask through the parties and the club's admission records. A pseudonymous per-commitment identity mode comes in Phase 2. Phase 1 admits `public` only, carries hashes on every event, makes escalations and disputes carry keys, and has SimChain release fallback and appeal keys on takeover.

Rafa's framing: end to end by default, the adjudicator and bond capital involved only as needed, an option to publish, banking patterns and compliance reporting, and dummy public IDs per escrow.

| Option | Effect |
| --- | --- |
| A. Public by default, opt-in privacy later | Passes the litmus tests today; leaves residual 9 open and costs a schema break later |
| B. Private by default: public skeleton, need-based keys, aggregate backer signals, opt-in publication | Narrows residuals 6 and 9; about two weeks in Phase 1 and three in Phase 2 (guessed) |
| C. Full cryptographic privacy from Phase 2 (Aztec, fhEVM, shielded pools) | Hides amounts and parties; today it means alpha software or token admins, which fails "no admin keys" |
| D. Tiered disclosure as a signed term with a rulebook minimum | User choice by construction; needs B underneath |
| E. Banking model with a freezing party | Fails neutrality with the freeze; kept as a lens without it |

**Recommendation:** B with D, and E as the compliance lens (research pass, Fable at max effort).

## D17. Screen report and hidden-character check (ADR-0021)

**Decided 2026-10-30:** with an empty rubric, a delivery the screen flags is still accepted and delivered unchanged, but the screen report is part of the signed record and the SDK must surface it, handing the buyer's agent a normalized view by default with the raw bytes on request. Parties who want hidden characters to block payment can require a new declarative check, `hidden_characters_max`, which rejects without a panel; clubs may turn it on by default. Escalation on high-risk signals waits for a Phase 3 `screenPolicy` option, because without a classifier an escalation only drifts to the default outcome. The panel-threshold question from the same research is still open.

| Option | Effect |
| --- | --- |
| A. Keep today's behavior | Buyer agent unprotected; report easy to miss |
| B. Escalate on any flag | Stalls legitimate Persian and emoji data on an uncalibrated screen; ends in the default outcome |
| C. Escalate on high-risk signals | Better precision, same degenerate path until Phase 3 |
| D. Reject | A rule neither party wrote moves money; false positives are wrong refunds |
| E. Annotate and surface, plus an opt-in check (chosen) | No unchosen rule moves money; the buyer's agent sees a cleaned view |

## D18. Integer rates and fraction thresholds (ADR-0022)

**Decided 2026-10-30:** money and statistical rates become integer basis points with a `Bps` suffix, and the accept and reject supermajorities become exact fractions such as `{ numerator: 2, denominator: 3 }`. Thresholds compare by cross-multiplication, inclusively; a policy must sit strictly above one half; ties escalate. Weights, the pass threshold and the weighted score become integers, and the judgment record carries counts. Requirements round up, splits round the rate side down with a named remainder claimant, and bond payouts round down with the dust kept, so no posting creates or destroys a unit. Lands in schema v0.5, core money helpers (`mulBps`, `splitBps`), T-006 and T-008.

The schema v0.5 review and the T-008 red team found that 18 rates are JSON floats inside signed hashes. A Python operator would hash `1.0` differently from `1`, and 0.667 × 3 = 2.0010000000000003 makes 2 of 3 judges escalate instead of accept.

| Option | Effect |
| --- | --- |
| A. Basis points everywhere | Exact and Solidity-native; cannot express 2/3 |
| B. ppm or 1e18 WAD | No gain at 2% to 100% rates; WAD breaks the 2^53 integer rule |
| C. Basis points for rates, fractions for thresholds | Exact, hash-stable, reads as the docs write it ("≥ 2/3") |
| D. Floats with defined rounding | Floats stay in signed hashes; blocked by the money lint |

**Recommendation:** C (two research passes, Fable at max effort).

## D19. Who can call the adjudicator (ADR-0015, ADR-0019, ADR-0014)

**Decided 2026-10-30:** keep the modes as they are and write the rule down: the party the silence default disfavors holds the call. In judged modes judgment is automatic, so no one needs to call it. In optimistic mode the buyer disputes, and the seller relies on the anyone-callable release at `disputeBy` and on mutual settlement. Either party can appeal. The refundable bond, not loser-pays, deters low-merit calls. Nothing changes in Phase 1 or schema v0.5. An optional consent window for judged modes (`consentWindowSec`, default 0, during which either party may call early or settle) is a candidate ADR after Phase 1.

Rafa asked whether either buyer or seller should be able to trigger review. A research pass (Fable, max effort) compared the options.

| Option | Effect |
| --- | --- |
| A. Add a seller dispute in optimistic mode | Cuts the buyer's signed inspection window, or changes nothing; sellers gain little |
| B. One "review on request" mode with a party-chosen default | The two existing modes under a vaguer name; a refund default with released work fails neutrality |
| C. Keep the modes; write the rule down (chosen) | Passes all three litmus tests; no Phase 1 change |
| D. Always automatic; drop optimistic | Removes an accepted choice (D11) |
| E. C now, plus an optional consent window later | A real new choice at no neutrality cost; candidate ADR after Phase 1 |

**Recommendation:** C now, E as a candidate after Phase 1.

## D20. Settlement finality per mode (ADR-0007, ADR-0015)

**Decided 2026-10-30:** define two moments and expose them. Payee finality (`settledAt`) is at the posting that pays a party. Commitment finality (`finalAt`) is when no appeal, dispute or settlement path remains. Both are derived read-model fields, never signed. Guaranteed mode is finality with indemnity: an overturn pays from the bond, never from escrow. A Finality section in `docs/architecture.md` holds the per-mode table. A finality object, a `commitment.final` event and chain finality stages are in `docs/backlog.md`.

The escrow-theory review (F1) found that "final" differs by mode and is not stated anywhere, as PFMI Principle 8 requires. A research pass (Fable, max effort) compared the options.

| Option | Effect |
| --- | --- |
| A. Docs only | Agents keep inferring finality from `appealBy` |
| B. Docs plus `settledAt` and `finalAt` (chosen) | Additive, derived, no signed change; cheapest before T-006 and T-007 build the read model |
| C. A full finality object and event | Right for Phases 2 and 4; too much for the honest-party demo |
| D. A per-commitment finality wait | That is `settle_after_window` under another name |

**Recommendation:** B.

## D21. Fees and the appeal fee (ADR-0007, ADR-0014)

**Decided 2026-10-30:** keep today's fee postings for the demo, with one change: the appeal fee is held at filing, paid to the appeal adjudicator only when it decides, and returned to the appellant if `appealDecideBy` passes undecided. Full "fees follow the event" (refunding an overturned adjudicator's fee and a winning appellant's appeal fee from the bond) is in `docs/backlog.md`. ADR-0014's citation for deposits is corrected.

The escrow-theory review (F3) found that fees do not follow the outcome. The research pass also found that a silent appeal adjudicator kept a fee for no judgment.

| Option | Effect |
| --- | --- |
| A. Status quo | A silent appeal adjudicator keeps the appeal fee |
| B. Hold the appeal fee until decided (chosen) | Three postings rows, no schema change; "no judgment, no fee" everywhere |
| C. Fees follow the event | Needs a larger bond reservation; matters before Phase 2 bonds and Phase 4 |
| D. Only the appeal fee follows the event | As C, smaller |

**Recommendation:** B now, C to the backlog.

## D22. Principal recourse after the agent signs (residual 12)

**Decided 2026-10-30:** nothing in the protocol for the demo. The mandate is the principal's standing approval; caps bound the loss on a live commitment; revocation blocks new commitments. Recourse for an agent's in-mandate action lies between the principal and its agent provider, as on card rails, Reg E, AP2 and under agency law. Residual 12 in `docs/neutrality.md` records it. Principal standing to sign party messages is the first item for this area in `docs/backlog.md`.

The escrow-theory review (F8) found no chargeback analog for the agent's principal.

| Option | Effect |
| --- | --- |
| A. Principal standing on party messages | Neutral; a candidate ADR before the Phase 2 contract |
| B. A recall window | Before funding it exists in effect; after funding a unilateral cancel fails neutrality |
| C. A chargeback-like claim | Nobody holds settled funds; reversing them fails neutrality |
| D. Bonded agent operators or intent mandates | Needs signed intent; later interop |
| E. Nothing in the protocol (chosen) | Matches every rail today; passes all three litmus tests |

**Recommendation:** E now, A first in the backlog.

## D23. Mutual settlement to any addresses (ADR-0019 amendment)

**Decided 2026-10-31:** a co-signed mutual settlement may pay the held price to any addresses, in any split that sums to the price, up to eight payouts. The fee, bond, key and race rules are unchanged, and only money leaves: the content key cannot follow the funds. The rulebook's `mutualSettlement.payoutsTo` is `parties` or `any`; the demo club uses `any` and a regulated club sets `parties`. Schema v0.6 replaces `sellerAmount` with `payouts`.

Rafa: if buyer and seller agree, they should be able to pull their funds to any address or mechanism, so they can arbitrate outside the model. A research pass (Fable, max effort) compared the options.

| Option | Effect |
| --- | --- |
| A. Keep payees fixed to the parties | To use another mechanism, one party must take custody first |
| B. Payouts to any addresses, rulebook may restrict to the parties (chosen) | Two signatures still move the funds; the parties can exit together to any mechanism |
| C. Only to exit addresses registered in advance | The parties cannot name a shared outside arbiter |
| D. Defer to a later schema | A second schema bump after T-006 and T-007 build on `sellerAmount` |

**Recommendation:** B.

## T-009 judgment choices

**Decided 2026-10-31 by the T-009 implementer, for Rafa to overrule.** Five choices in the panel and adjudicator service (PR #37) change what judges see or how a panel decides. Under the autonomy rule they proceed inside the repo; the numbers are the task's Decisions in `docs/tasks/T-009-panel-adjudicator.md`.

| Choice | Decided | Alternative not taken |
| --- | --- | --- |
| 1. Seeded sampling, CSV only | A CSV over the prompt budget is shown as the header, the first 20 and last 20 rows, and rows drawn from the panel seed until the first that does not fit. Anyone with the seed and the plaintext can recompute it. A CSV with an unterminated quote or any record costing more than budget / 100 characters, and every non-CSV input over the budget, keep the stride sample and escalate | Escalate every large deliverable (the demo CSV would never be accepted); sample JSON and text too (no reader stage yet) |
| 2. One sample per judge | Each judge's sample has its own seed, derived from the panel seed and the judge ID, so the panel together sees more of the file | One shared sample (easier to audit, less coverage) |
| 7. Appeal thresholds | Appeals use the bound policy's supermajority fractions with `minValidAppeal` and `appealPanelSize`; the schema has no appeal fractions. With 5 valid seats, 2/3 already needs 4 passes | 4/5 from the docs table, which needs a schema field (backlog) |
| 8. Inconclusive appeal panel | After a party appeal, the first decision stands. After an escalation, the record is published and no Decision is signed, so the default outcome applies at `appealDecideBy` | A "no decision" message (backlog, with default compensation) |
| 13. Fallback and appeal judge under the bound policy | They use the primary's published policy, checked against the bound hash and this build's template hashes, and refuse when they cannot obtain it | Each adjudicator's own policy, which the parties did not agree to |

**Recommendation:** keep all five for the demo; revisit 1 and 7 with calibration in Phase 3.

## D24. Changing terms by mutual agreement (ADR-0019)

**Decided 2026-10-31:** no protocol change. Commitments are ephemeral and machine speed, so changing terms means closing the active commitment with a co-signed mutual settlement (D23) and opening a new one, distributing the held funds as needed. The sequence is recorded in ADR-0019 under "Changing terms". Settlement is refused after a decision, so reopening can never re-roll an adverse verdict. The gaps (an atomic close-and-reopen, a `supersedes` link, the daily cap, double bond during the overlap, offer withdrawal) are in `docs/backlog.md`.

Rafa first asked that both parties be able to change any term, as in a regular contract, then proposed close-and-reopen instead. A research pass (Fable, max effort) confirmed today's spec supports it end to end.

| Option | Effect |
| --- | --- |
| A. A co-signed amendment that keeps the commitment, with adjudicator re-acceptance | New message, new ID or version rules, new consent path for bound third parties |
| B. Close and reopen: mutual settlement plus a new commitment (chosen) | Works today; every party re-consents through the normal flow |
| C. Defer | No way to change terms short of a dispute |

**Recommendation:** B.

## D25. Build review: what to do before the dry run (docs/reviews/2026-10-31-build-and-simplification-review.md)

**Decided 2026-10-31 under the autonomy rule, for Rafa to overrule.** An independent review (Fable, max effort, PR 49) measured the build (`pnpm verify` green, `pnpm demo` in 1.9 s) and found the demo does not yet show its two strongest claims: beat 7 (neutrality) and the injection half of beat 6 are stand-in. It also found one defense gap (L3-1): the appeal adjudicator cannot decide a screen-flagged case, so the default outcome would pay an injecting seller from the appeal bond.

| Item | Decided |
| --- | --- |
| Before the dry run | Review proposals 1–9: beat 7 and beat 6a on SimChain (T-018); honest labels, one commitment ID per job, meaningful judging time, one judge prompt and verdict in beat 3, lean balance tables (T-019); trim T-016 to real judgment in snap, role-keyed recordings, authored guard and `mutual_settle`, the rest to T-016b; fix stale docs |
| L3-1 (defense) | At the appeal, a screen flag stays in the record and the five-judge panel decides by supermajority; it never auto-accepts (FR-15 kept). T-018 amends ADR-0021 and `docs/judgment-and-defenses.md` with the rule and a failing-first test |
| Fixture target | The ~45 open T-010 rows are not needed before the dry run; the demo needs its beats as fixtures. Moving the rest to the backlog by name happens after the demo (proposal 14) |
| T-017 profiles | Kept, against review proposal 10: Rafa asked for adjudicator profiles and the agreement step. Invented history stays labelled role-play |
| Design map | Kept, against review proposal 16: Rafa uses it to track progress |
| After the demo | Proposals 11–19 (one driver for snap and demo, delete the adjudicator's second in-memory settlement, one mutation script, prune `docs/api.md`, backlog triage, leaner task files, batched Phase 4 research) |

**Recommendation:** as decided.

**T-018 implementation choices (2026-10-31, for Rafa to overrule).**

| Choice | Decided | Why |
| --- | --- | --- |
| Which flags the appeal keeps rather than escalates on | Superseded by D27a | — |
| Aggregation version | Superseded by D27b (`agg-3` now) | — |
| Operator refusal shape | Superseded by D27c (`relay_refused`) | — |
| Beat 7's second failure | op-2 goes offline after relaying the hold, so the delivery and the fallback trigger are submitted directly | Shows "no operator required" from measured events, not only failover |
| Beat 6a's fee | The appeal adjudicator earns the 50 tUSD fee; Ledger ends at 9,950 tUSD | Existing SimChain postings ("fee to the appeal adjudicator, whose decision settles"); not changed here |

## D26. Widen collaboration; the law stays the backstop

**Decided 2026-10-31 by Rafa.** Agent owners and controllers will seek legal recourse if something goes wrong. The product's job is to extend the set of deals agents can make with each other, not to resolve every dispute inside the protocol.

What follows from it:

- Bounded loss (scope caps, bonds, expiry) and a clean, signed, attributable record come before new protocol steps for edge cases. This is the same rule as "assume honest parties until the demo works", made permanent.
- The record should serve as evidence. A party should be able to export one commitment's signed terms, receipts, judgment record and audit-chain proof and hand them to a court or arbitrator (backlog: evidence bundle).
- A rulebook should say which law governs and where disputes go, so the signed messages bind (PRD Assumption 1). The protocol records that choice; it does not enforce it (backlog).
- **Both parties remember everything, equally.** Each side ends the exchange holding the same complete record: every message either party signed, every operator receipt, the adjudicator's judgment record with reasons, the decision and the settlement postings, each verifiable without trusting an operator. Neither party can hold a part of the record the other cannot see. ADR-0020 already makes bodies and judgment records readable by both parties at every disclosure level; the work itself still follows the hold (the buyer gets it with payment; on a refund the seller keeps it, and both hold its hash).
- Neutrality is unchanged: no party gets a technical freeze. Courts act on real-world parties (residual 5), not on the settlement layer.

Recorded in `CLAUDE.md` and `docs/PRD.md` (Design principle). D22 (no principal recourse in the protocol) already follows this rule.

## D27. The default clause set for appeals: a flagged appeal accepts only unanimously, else rejects (red-team review of PR 52)

**Decided 2026-10-31 under the autonomy rule, for Rafa to overrule.**

**What these rules are.** D27a to D27c are the **default clause set**: gap-fillers that apply when the agreed terms say nothing about these cases. They are versioned with the aggregation as `agg-3`. They are not the protocol judging whether a party is malicious. Each condition they name (a screen flag, an injection suspicion, a filter abstention, a sampled read) is an observable fact in the signed record, and the clause says what follows from it. D29 makes the clauses negotiable after the demo.

**Findings.** A red-team review of PR 52 (T-018) found that D25's L3-1 fix, "the appeal panel decides a flagged case by its supermajority", still paid an injecting seller. Its findings, each now a fixture in this PR:

- **Steered supermajority.** An injection that steers four of five appeal judges to pass with no injection suspected was accepted (`attack.injection-steers-appeal-supermajority`).
- **Steered across two families.** Three passes from two families failed the accept rule, but under `agg-2` the case then escalated and drifted to the default outcome (`attack.injection-steers-appeal-two-families`).
- **Split to default.** Two steered passes and three fails escalated, so the default outcome paid the seller from Bench C's bond (`attack.injection-splits-appeal-to-default`).
- **Filter abstention to default.** One judge induced to write a URL abstained by filter, which escalated, with the same result (`attack.injection-filter-abstain-appeal-default`).
- **Version.** The rule changed under the same `AGGREGATION_VERSION`, which policies bind.
- **Refusal type.** An operator refusal reused the club's `member_not_admitted` problem type, and a relay policy received the operation by reference.

| Item | Decided |
| --- | --- |
| D27a: flagged appeal rule | At the appeal after an escalation, when the screen flagged the delivery, any judge set `injectionSuspected`, or any judge's output was rejected by a filter: accept only if every seat returned a valid verdict, all pass, the passes span the appeal family minimum (three where the registry has them), no judge suspects injection, and the score is met. Otherwise reject (refund; key not released; seller keeps the work). Never escalate or end without a decision; filter abstentions and timeouts count against accept. Primary and fallback unchanged. Implemented once in `@holdback/judgment` (`aggregate`, `signedOutcome`) for the service and the snap runner |
| D27b: forced sampling (re-check, path 5) | A seller can pad one CSV record past the sampler's per-record budget and force the even-stride sample. The primary escalates; the unflagged appeal escalated again, so no decision was signed and the default outcome paid the seller 2,000 from Bench C's bond, even when all five judges passed bad work (`attack.forced-stride-appeal-default`). After an escalation, a sampled read joins the seller-controllable conditions of D27a: accept only on unanimous valid passes of the whole file across the family minimum, else reject. After an escalation the appeal never returns no decision for these conditions. A genuine unflagged split (for example 3-2) still goes to the default outcome (backlog) |
| D27c: party appeals (re-check) | D27a and D27b apply only to the appeal after an escalation (no first decision). On a party appeal against a first decision, judge-level flags (`injectionSuspected`, filter abstentions), a screen flag and a sampled read escalate as at first instance, and the first decision stands. Before this, one false `injectionSuspected` among five passes overturned an honest accept and Bench A's bond paid the buyer (`honest-seller-survives-judge-noise-on-appeal`). `aggregate` takes `appeal: 'escalated' \| 'party'`; the service and the snap runner set it from `firstOutcome`. Follows D28 |
| D27d: version | `AGGREGATION_VERSION` `agg-3`. `aggregate.test.ts` pins a digest of the decision table and of `signedOutcome` to the version, so semantics cannot change without a bump. The digest was re-pinned for D27b/c without an `agg-4`, because `agg-3` has not reached `main`. Every recording was re-recorded (fake) or re-seated (authored); no pre-existing fixture changed its terminal state or balances |
| D27e: refusal | New problem type `relay_refused` (403, operator API only: `packages/core/src/problem.ts`, `docs/api.md`; not in `spec/schemas`). Policies receive a frozen deep copy of the operation |
| D27f: wording | FR-15 amended in `docs/PRD.md` for the appeal; ADR-0021 amendment, `docs/judgment-and-defenses.md` and `docs/demo.md` beat 6 updated |
| D27g: backlog | Tell appeal judges about the screen flag (a new appeal template). Revisit the default outcome after an unflagged, inconclusive appeal, where the appeal bond pays the seller though no adjudicator was at fault, and separate adjudicator-absence compensation from a panel that ruled but could not decide. A sampler that handles long records, or a declared `max_record_chars` check, so honest long-record CSVs are not refunded. On unflagged appeals, a provider's `not_json` (a filter abstention) and a timeout are treated differently |

**Recommendation:** as decided. The tradeoff: after an escalation, a false positive on a flagged or sampled appeal now refunds the buyer and the seller loses the sale, where before it might have been accepted by a supermajority. The screen is uncalibrated (ADR-0021), and an honest CSV with one very long record is sampled by stride, so this can happen to honest sellers (backlog: a long-record sampler or a declared check). On the other side, an injector can no longer win by steering, splitting or forcing the panel. A party appeal is not affected, so judge noise cannot overturn an honest first decision.

D27b and D27c were added after a red-team re-check of PR 52 (`42fa67a`), **decided 2026-10-31 under the autonomy rule, for Rafa to overrule**.

## D28. Agreed terms bind; the buyer carries the burden of acceptance

**Decided 2026-10-31 by Rafa.**

- **Judges.** They assess conformance to the agreed terms, never their fairness.
- **The buyer protects itself in advance.** Its protection is the acceptance checks and rubric it writes into the terms before agreeing.
- **After an accept.** An appealing buyer must show the work fails the terms, as a buyer must prove breach of goods it accepted (cf. UCC §2-607(4)); otherwise the first decision stands (D27c).
- **The exception.** The burden shifts only when a party games the judgment itself: an injection, or forcing an unreadable delivery. Nobody agreed to that as a term (D27a, D27b).

Recorded in `CLAUDE.md` and `docs/PRD.md`.

## D29. Dispute clauses are negotiated terms (after the demo)

**Decided 2026-10-31 by Rafa.**

- **Not the protocol's call.** The protocol does not decide whether terms are favourable or whether a party is malicious. As in contract law, the parties negotiate dispute clauses: what happens on a screen flag, an unreadable delivery or an inconclusive panel, and who bears the fees.
- **Default rules.** The protocol supplies rules that apply when the terms are silent. Today these are the D27 clause set, versioned as `agg-3`.
- **Mandatory rules.** The hard rules and the three litmus tests apply whatever the terms say; no agreement can waive them.
- **Who narrows the menu.** Clubs may narrow the clauses in their rulebook, and adjudicators may decline clauses they won't run.
- **When.** Making the clauses selectable in the signed terms is a schema change, so an ADR and a version bump, after the demo. The backlog row is under Modes and calls. Until then the D27 defaults stand for every commitment.

Recorded in `CLAUDE.md` and `docs/PRD.md`.

## D30. API first: agents call the HTTP API directly

**Decided 2026-10-31 by Rafa.** For simplicity, the product surface is the open HTTP API that any operator serves. We do not build and maintain a high-level SDK or an MCP server now; an agent calls the API, as it would any web service. Operators may charge per call with micropayments (for example HTTP 402 schemes such as x402), which fits "any operator node serves the API" and the operator business (backlog, after the demo).

What it means:

- **Signing stays with the agent (hard rule).** Each party message is prepared by the API as EIP-712 typed data, signed by the agent with any standard library, and submitted. The operator proposes the typed data; it never signs. The data is deterministic from the agent's inputs, and the docs say which fields to verify before signing.
- **Encryption stays with the seller.** The API serves recipients' public keys and an envelope spec buildable with standard libraries; operators never see plaintext.
- **The existing SDK client stays** as an internal library for the demo and tests, and is not expanded.
- **T-020** is re-scoped to the API surface (prepare/sign/submit, delivery envelope spec, terms templates, `pnpm sim`, a curl quickstart, examples using only fetch and a signing library). **T-021** drops the MCP server: simulated agents call the API through generic HTTP and signing tools, ideally generated from the OpenAPI document (T-015).

## D31. Parametrize, don't restrict

**Decided 2026-10-31 by Rafa.** The protocol and API should not specify anything the negotiating agents can manage themselves. Values such as deadlines, windows, the auto-release time, amounts and rates are parameters: any value the encoding can represent is allowed, including a date far in the future. The API refuses only what is malformed, unrepresentable, or self-contradictory in a way settlement cannot process (for example a deadline before the commitment was created). Spotting a value that looks wrong, such as the year 20270, is an advisory warning an operator may offer as a service, not a refusal (backlog). Mandatory rules (hard rules, litmus tests) are unaffected, and clubs may still narrow options in their rulebook, since members chose the club (ADR-0015). Applied first in T-020: the operator's timing bounds were relaxed to the encodable range.

## D32. The parties carry the responsibility; prefer the simpler fix

**Decided 2026-11-01 by Rafa** ("generally there's probably simpler solutions, the burden of responsibility should be primarily on buyer and seller"), applied first to sim batch 1 finding F2.

- **Principle.** When a party can protect itself with a check it runs before signing, the protocol does not add settlement machinery for the party that skipped it. Responsibility sits with the buyer and the seller; the protocol keeps the mandatory rules (hard rules, litmus tests), and the law stays the backstop with the signed record as evidence (D26). It extends D28 from acceptance to every signature a party gives.
- **F2 (early accept with a misdirected buyer envelope).** No settlement change. An early accept is the buyer's own acceptance: before signing it, the buyer opens its envelope and checks the plaintext hash, and the reference verifier does this (T-024). Settlement keeps refusing appeals after an early accept. ADR-0012's "missing or wrong key is an appeal ground" now covers judged outcomes only (amended). The `todo.` fixture from T-024 becomes a plain `attack.` fixture recording this behaviour as intended.
- **Simplicity.** Agent-side helpers stay small: plain checks the buyer or seller can read, not mechanisms that try to stop an agent from bypassing its own verifier.
- Research pass for F2 stopped once Rafa decided; options compared in the batch 1 review were adjudicator re-seal on early accept, a wrong-key-only appeal, and this one.

## D33. Operator fee: 1 bp of the price, minimum 0.01 tUSD, paid by the buyer with the funded agreement, outside the contracts

**Amended 2026-11-03 by Rafa: "Gas should be part of the cost of using the API etc."** Agents never need ETH: the relaying operator pays the gas and recovers it through its fee, quoted in the deal's token (USDC, D42). On a chain, the published minimum is the relay minimum plus a per-deal gas quote, so the fee, `max(min, ceil(price × bps / 10000))`, never falls below the gas the operator pays, and agents compute it exactly as before. On the Sepolia demo the gas quote is 1.50 tUSDC: about 500,000 gas for a deal's three transactions (funding with the fee, delivery, decision; T-209's measured figures) at 1 gwei, at a fixed and fictional rate of 3,000 tUSDC per test ETH, stated as such wherever the fee is shown. So the demo publishes 1 bp with a minimum of 1.51 tUSDC. The quote is fixed per deal and not refunded: a deal that needs fewer transactions (a reclaim) leaves the operator the difference; one that needs more (a fallback, an appeal) costs it the difference. A party that submits directly to the contract pays its own gas and no fee to this operator, and another operator charges its own schedule (ADR-0005, unchanged). The quote is a parameter (`OPERATOR_FEE_GAS`, D31), never a cap. Schema v0.9 (T-033) may show the gas part as its own member of `fees.operator`; until then discovery's notes and `llms.txt` state the split. The fee still never enters the hold. ADR-0023 has the amendment.

*Note, 2026-11-03 (T-213, measured):* on the deployed Sepolia contracts a deal's three transactions take about 1.56 million gas, not 500,000 (anvil prices new state at about a third of Sepolia's), and Sepolia's median tip is 1 gwei. So the demo's quote is 4.70 tUSDC and the minimum 4.71, which cover the measured gas at the measured 1 gwei tip (4.69 at the fictional rate). A fixed quote keeps the rule above only at the fees it was measured at; a higher tip or base fee costs the operator the difference until T-215 quotes gas live. `OPERATOR_FEE_GAS` is one Worker variable; T-215 makes the share on small deals smaller before mainnet.

**Decided 2026-11-01: confirmed by Rafa ("Confirm D33") after a research pass.** Rafa set the direction (fees at the API level, not a protocol fee in the contracts; a rulebook fee on chain is a possible later step), proposed 0.01% of settled volume, and asked for cost-plus to be weighed. The pass measured what a deal costs Crow: about $0.001 of infrastructure, about $0.01 to $0.10 of model calls when judged (more on appeal), and $5 a month fixed (inferred from Cloudflare, Anthropic and DeepSeek list prices and the code's prompt sizes).

| Option | Effect |
| --- | --- |
| A. Volume % only (1 bp) | Market floor; below cost under about 10 tUSD; unrelated to what the operator does |
| B. Cost-plus per deal, judgment or call | Honest, but a flat cent never funds fixed costs without volume; per-call payment needs a rail and fights idempotency |
| C. Hybrid max(0.01 tUSD, 1 bp) (proposed) | The floor covers the per-deal cost about 10 times; the percentage shares value on large deals; the same shape as Stripe, escrow.com and Lightning routing |

- **Mechanism (needs ADR-0023 and schema v0.7).** A third signed slot in `prepare/agree-and-fund`: a transfer authorization from the buyer to the relaying operator's published fee address, executed as a plain token transfer, never through the escrow, and posted as a `fee.operator` event. An unpaid relay gets 402 `payment_required`; direct submission and other operators ignore it, so no operator can stop a deal (a `neutrality.` fixture shows it).
- **Who pays, when.** The buyer, at funding; earned at relay, never refunded. Reads, prepare, the faucet, the seller's deliveries and direct submission are free. Model cost stays in the adjudication fee (ADR-0014), which should become cost-plus with a capital charge on the bond for large deals.
- **Shown up front.** In discovery and status (`fees`), `llms.txt`, the prepare check text, and the operator's receipt.
- **Rollout.** Ship with the fee published at 0, then 1 bp / 0.01 tUSD on both demo nodes, measured for a week. No cap now; a cap, a seller-side fee, per-call payment and an on-chain rulebook fee go to the backlog.
- **Regulatory flags (not legal advice).** Crow never holds funds and the fee never touches held funds, which reads more like software than an intermediary's cut; state escrow and money-transmitter rules vary; counsel before any real money.

Full report with sources: the research pass of 2026-11-01 (comparable take rates: Stripe, escrow.com, x402 facilitator, Uniswap, Lightning).

## D34. Private deals and the end-to-end encrypted API (ADR-0024)

**Decided 2026-11-01: accepted by Rafa ("Accept both"), as amended after the research pass the same day.** Agents encrypt the `deliverable` and `acceptance` bodies under two keys (so `judgment` can publish the acceptance alone), sealed to the buyer and the primary adjudicator at offer; either party may seal them to the fallback and appeal adjudicators, time-locked to `judgeBy` and `appealBy`, and any envelope that opens suffices, so neither party can block judgment. Operators store and relay ciphertext and see only the settlement view, verified signers and relay metadata. Private reads need an EIP-712 `ReadToken` (optional `audience`) from a party or an involved adjudicator; everyone else gets 401. Judgment records are sealed to both parties (D26). Prepare becomes a published, deterministic recipe, plus a hash-only operator prepare. Publication discloses keys in a `disclosure` body; `Publish` is unchanged.

Research pass 2026-11-01: keep the domain at 0.6; bind the seller's per-deal encryption key in the hashed `deliverable` body and the buyer's in the struct as today; adjudicator keys by self-signed registration, two operators now, an on-chain registry later (ERC-6538 is a deployed candidate). The L1 contract takes a settlement view in calldata, stores one word per deal and emits ERC-8183 events; happy path about 0.5–0.65M gas (inferred; T-202 measures). Amounts stay public in Phase 2; confidential tokens are not adopted (admin surface; public wrap/unwrap). Default level `private`. The mailbox leaves the protocol (identity, discovery and negotiation are outside it, D35); an operator may offer one free with delivery-token gating. Per-deal keys with a `Delegation` certificate shown to the counterparty and the adjudicator become the default for private deals; L1 funding linkage stays residual 11. Private inference (D35) is `providerPrivacy: zdr` with a named provider; the registry needs two providers or one `local` seat. Build B now; T-208 after T-206.

| Option | Effect |
| --- | --- |
| A. Access control only (ReadToken over plaintext) | Quick; every operator still reads every deal |
| B. End-to-end encrypted API, amended (proposed) | Operators hold ciphertext and hashes; per-deal keys hide identity; L1 amounts and funding links are residuals; no on-chain cost, no new actor, domain stays 0.6 |
| C. Prividium fragment per escrow (T-208) | Content off every operator; private settlement not shipped; about 460k L1 gas per batch proof; new sequencer actor; spike after T-206, can sit on top of B |
| D. Full chain privacy (Aztec, fhEVM) | Deferred, as in D16 |
| Seller key as a `CommitmentTerms` field | Rejected: moves the domain to 0.8 for no gain over the hashed body |

Wording owed elsewhere if accepted: the scope hard rule in `CLAUDE.md` and the neutrality definition each gain one sentence (at the pseudonymous level the certificate attests scope and membership, checked by the counterparty and adjudicator, not settlement); T-207's acceptance criteria drop `neutrality.operator-refuses-mailbox` and the mailbox schemas.

**Recommendation:** B, amended as above.

## D35. Rails, not a record-keeper: disclosure is each party's choice

**Decided 2026-11-01 by Rafa** ("the protocol and API as rails, and maximal information then becomes something each party chooses to disclose, and can privately arbitrate ideally based on model usage, maybe use something like Venice for private inference").

- **The protocol and API are rails.** They hold funds, check signatures, enforce deadlines and settle. They need keys, hashes and amounts, not identities or content. Buyer and seller find each other and agree however they like; the protocol assumes they know each other (Rafa, same day). Per-deal keys that do not link to a party's long-term identity follow naturally, and are the default for private deals (D34, ADR-0024).
- **Disclosure is a choice.** Who a party is, what it bought, the terms and the judgment are disclosed by each party, to whom and when it chooses. The default is minimal; a party can reveal more to its counterparty, an adjudicator, a club or a court (D26 evidence by selective disclosure).
- **Arbitration can be private.** Adjudicators may run judges through private inference: a provider that keeps no prompts or outputs, such as Venice, as an adjudicator option. Mandatory rules still hold: pinned model IDs, at least two families, no tools for judges, untrusted deliverables, the verdict schema. Backlog row under Judgment defenses.
- **Shapes:** ADR-0024 (private deals) and T-207; the mailbox and identity may leave the protocol entirely.

## D36. Parties may choose their judge panel; Crow offers a default; OpenRouter as a provider

**Decided 2026-11-01: proposed by Rafa and accepted by him ("Accept both").** Buyer and seller may name their own judge structure in the terms: models and families, seat count, pass threshold, private inference or not. The adjudicator runs it or declines (D29), and the terms bind it by hash as they already bind the policy and registry. Crow's adjudicator offers its live panel (Anthropic and DeepSeek, two families) as the default for parties who do not choose. OpenRouter joins as an `openai-compatible` provider, so any model is reachable without a per-lab integration.

- **Mandatory rules still hold:** pinned exact model versions (pin OpenRouter's model slug and its upstream provider routing; no aliases), at least two families, judges with no tools, the injection screen, the verdict schema, and no re-roll after a verdict.
- **Concentration risk:** one gateway in front of every model fails or misroutes for all of them at once, and sees plaintext unless zero-retention routing is used. So a panel needs two providers or one self-hosted seat (the ADR-0024 research rule), and OpenRouter is an option or second provider, not the only path.
- **When:** with the policy and registry work after T-207. Backlog row under Judgment defenses.

## D37. Rules contract design (T-202)

**Decided 2026-11-01 in T-202 under "autonomy inside the repo"; Rafa may overrule.** The four design questions of `docs/tasks/T-202-escrow-rules-contract.md`, answered from the built contract and its measured tests. Details, measurements and the SimChain differences for T-205 are in the task file.

1. **Two transactions on the happy path.** `agreeAndFund` verifies the seller's terms signature, the primary's acceptance and the buyer's Agree, and funds CPP in one call; `decide` may carry the seller-signed delivery, so a happy path is two transactions (395,831 gas, measured). A seller can still post `deliver` itself (61,302 gas) to stop a reclaim after `deliverBy`.
2. **Operator fee by bundling, not in the contract.** The buyer's ERC-3009 `transferWithAuthorization` to the operator is bundled with `agreeAndFund` in one transaction by a stateless batcher; the contract has no fee code (ADR-0023 amendment, Proposed).
3. **Envelopes: tlock and the off-chain union, nothing stored.** The contract stores no envelope or delivery hash (one word per deal, ADR-0024 §8). The buyer's envelope is proven against the seller-signed delivery and emitted only when it is released; fallback and appeal envelopes rely on the time-lock and the union of envelopes (ADR-0020, ADR-0024 §5).
4. **Bonds in Phase 2: custody primitives only.** Deposit, encumber per commitment (primary at funding; fallback and appeal at takeover, all or nothing), release, withdraw when free, appeal bond in and out. Coverage ratios, backers, overturn payouts and default compensation are Phase 4.

Also: the funding signature on EVM is CPP's collector signature and token identifiers are lowercase addresses (ADR-0025, Proposed; schema change after PR 67); default and apply-default are one call (T-204 finding 2); beacon BLS verification (EIP-2537) is split out to a follow-up (backlog), the round and seed derivation are checked now.

| Option (question 2) | Effect |
| --- | --- |
| Contract executes `transferWithAuthorization` | Atomic, but fee code and operator knowledge in neutral custody code; no size headroom (EIP-170) |
| Stateless bundling (chosen) | Atomic per transaction, zero contract code; a mempool observer can split the fee off, gaining nothing |

**Amended 2026-11-03 (T-206 review, M-2 and M-3; Rafa may overrule).**
- **Point 1 (M-2):** a delivery now lands only before `deliverBy`, whichever call carries it: `deliver`, a decision, or an early accept (PR #127).
  - Before, a carried delivery that landed after the deadline raced the buyer's reclaim, so the buyer's deadline did not bind.
  - Core, the EVM adapter and the formal model already refused it.
  - A seller whose judge may outlast `deliverBy` posts `deliver`. A buyer who wants late work settles for it with the seller.
- **Point 4 (M-3):** nothing reserves a fallback's or appeal adjudicator's bond at takeover or escalation (PR #135).
  - The fallback reserves its own bond by deciding, and an uncovered fallback cannot decide, as ADR-0016 §1 says.
  - Before, a sham deal could lock any named adjudicator's bond.
- **Research pass:** the T-206 adversarial review (Fable, max effort) and the public-audit cross-check; the review passes agree. See `docs/reviews/2026-11-03-contract-review.md`.

**Amended 2026-11-03 (D44, ADR-0029; Rafa may overrule).**
- **Point 3:** the contract now stores one delivery hash per deal, beside the deal word (`deliveryHashOf`), written by whichever call lands the delivery. Every decision, early accept and mutual settlement after it must name that hash. Envelopes are still not stored.

## D38. Funding paths: any ERC-20, WETH or ETH; ramps as a deferred separate service (ADR-0026)

*Note (2026-11-03): first wave narrowed to USDC by D42; other assets later.*

**Decided 2026-11-02 from Rafa's direction** ("simply accept any ERC20 or wETH or ETH"; "a separate service we call via our unified API"; "for later", a stub only), after a research pass (repository facts measured; provider facts from memory, to be checked before the service is built).

- The deal's token is any ERC-20 the parties name (D31). `rulebook.allowedTokens` becomes optional and only narrows; the schema change rides with ADR-0025's v0.9 follow-up. Until then the demo club lists tUSD.
- ERC-3009 tokens (USDC) fund with one relayed signature; every other ERC-20, WETH included, through Permit2 after the buyer's one-time approval.
- Native ETH is accepted by wrapping: the deal is denominated in WETH; the buyer wraps and the seller may unwrap, each with its own call. No contract change (an ETH collector or native custody were rejected: more custody code, no EIP-170 headroom).
- Fee-on-transfer and rebasing tokens are advisory warnings in prepare, never refusals; CPP already reverts a short transfer at funding.
- Fiat on-ramps, swaps and bridges are one separate funding service any operator may run, exposed by the unified API as `/v1/funding/quote` and `/v1/funding/sessions`, never a settlement dependency. It delivers the deal token to the buyer's address, never holds escrowed funds and never signs for the buyer; direct funding from the buyer's own address always remains (`neutrality.onramp-refuses`). Stub only today; the routes answer 404.
- Ramp identity (Rafa, 2026-11-02): the agent's owner passes the ramp's identity check, choosing a listed ramp or opening its own account under its own, separate identity; the agent spends from it.
- Public demo (Rafa, 2026-11-02): a Stripe test-mode ramp is enough; who runs the service (Crow or operator-chosen third parties) is open either way.

## D39. The API for agents: conventions from the 2026-11-02 review

**Decided 2026-11-02 under Rafa's principles** ("an elegant, simple, unified API over a hard protocol"; "no SDK or MCP for now, agents integrate on their side"; feedback calls; minimal telemetry; the operator sees as little as possible), after the research and review pass in `docs/reviews/2026-11-02-api-agent-review.md`. Rafa can overrule any line.

- **The bar:** an agent with an HTTP client, an EIP-712 signer and `https://escrow.stream/llms.txt` completes a deal on its first try. Every client-side computation (nonces, hashes, encodings, the private recipe) is spelled out there; nothing depends on `examples/`. SDK and MCP are "later, on demand" (review C1, F10).
- **Simplify first:** one discovery document (`/v1/status`, folding in the well-known body and the demo's `GET /` facts, `chainId` a number), one `llms.txt`, one faucet in the OpenAPI document, notices in the body instead of a header, caller-chosen nonces only, one timestamp format, one fee name, one version paragraph, shorter OpenAPI descriptions with a `core` tag (review §2).
- **Errors an agent can act on:** each problem `type` resolves at `https://escrow.stream/problems/<type>`, with typed members where an agent must branch (`state`, `needs`, `fee`, `retryAfterSec`, `field`) and `internal` for 500 (F4).
- **Planned routes answer 501 `not_implemented`** with a `Link` to their source, read from `x-holdback-planned`, instead of an indistinguishable 404. New planned rows: `GET /v1/funding/sessions/{id}`, `POST /v1/feedback`, `GET /v1/feedback/{id}`, `GET /v1/commitments/{id}/judgments`, `POST /v1/adjudicators/{address}/keys`, `GET /v1/commitments/{id}/evidence` (review §6.2).
- **Disclosure has no default in prepare** (D34 says `private`, but the demo cannot judge it yet, so the agent chooses explicitly); the demo adjudicators decline an offer whose sealed terms they cannot open rather than let it stall to a reclaim (F1, F11, C9).
- **Operator visibility stays inside ADR-0024 §1:** no request bodies or `Authorization` in logs, IPs only in memory for abuse limits, the rate-limit budget charged only after the signature verifies (C4).
- **Feedback** is an operator service: two routes, an optional signed `Report`, bodies sealed like deliveries when they may carry deal details, the operator's own log line attached by Request-Id, deduplication, a status lifecycle; reports land in a private store first; filing public issues stays manual (review §8).
- **Telemetry MVP:** about 14 aggregate metrics from what the operator already sees (per-route rate, errors and latency; problems by type; 429s; Durable Object quota usage; journal size; judge calls; the deal funnel by stage and time per stage; prepare-to-submit conversion; first-try success), and a 7-day request log without bodies, IPs or `Authorization` (review §9). Publishing any of it waits for Rafa.
- **Schema v0.9** carries the protocol-level items together: ADR-0025's funding schemes and token addresses, `allowedTokens` optional (D38), `chainId` as a number in status, the MIME allowlist moving to adjudicator capability (D31, C8), the fee on receipts (C3) and the `not_implemented` problem type.
- **Feedback key (Rafa, 2026-11-02):** a report is sealed to the operator's own encryption key, the one the operator publishes in discovery. Before submitting, the agent is told plainly that it is choosing to share the report, and any deal details in it, with that operator; sharing is the agent's choice (D35, D40), and a report with no deal details needs no sealing. No separate maintainers' key.
- **Open for Rafa:** whether weekly aggregates are published (a status or stats page).
  - *2026-11-03, Rafa:* deferred ("this doesn't seem like something we need to sort right now"). The T-031 aggregates stay internal to the operator, with no public page or endpoint; to be revisited after real usage (backlog).

## D40. Privacy is each deal's choice; the tagline is "Programmatic Escrow and Arbitration"

**Updated 2026-11-03 (Rafa):** "Call it "Crow" for now as it's easier to read in docs, but the webpage uses the logomark ’crow". The README, `docs/` and `site/llms.txt` write Crow; the escrow.stream pages and the brand files keep ’crow. Holdback stays the protocol's name and EIP-712 domain. Trademark clearance with counsel is pending (Rafa, 2026-11-03: "Keep Crow, see attorney").

**Updated 2026-11-02 (Rafa, PR 98):** the tagline is "Programmatic Escrow and Arbitration" ("’crow. Programmatic Escrow and Arbitration"), replacing "Escrow for AI Agents" below. The rest of D40 stands.

**Decided 2026-11-02 by Rafa.** The site's tagline drops "Private": "’crow. Escrow for AI Agents", and the intro reads "a programmatic and verifiably neutral escrow service for AI agents". The API lets each deal choose private or public according to the agents' preferences and needs (the signed `disclosure.level`: `private`, `judgment` or `public`, ADR-0020, ADR-0024), and more pieces become privacy-capable over time (sealed judgment records, private amounts, private settlement venues). This refines D34 and D39: the protocol offers privacy as an option the parties choose, with no level imposed by the operator, and the brand does not promise more privacy than the current build delivers.

## D41. The public demo settles on Sepolia (ADR-0028)

**Decided 2026-11-03 by Rafa** ("the public demo to settle on Sepolia"); the design is ADR-0028 (Proposed), after a research pass the same day (`docs/research/2026-11-03-sepolia-demo-settlement.md`). Rafa may overrule any line of the design.

- **What changes for an agent.** The money in every demo deal sits in HoldbackRules and CPP's escrow on Ethereum Sepolia, checkable on Etherscan; each money step waits for a block, so a test deal takes about a minute instead of 4 s; the EIP-712 domain names chain 11155111 and the rules contract; the token identifier is the test token's address (ADR-0025); the buyer funds with the token's own ERC-3009 signature, which prepare hands out. Test tokens only: the deal token is tUSDC (D42), open-mint and worth nothing.
- **What does not.** The API, the one-command test deal and its single approval, and the hard rules: the operators' relayer keys pay gas and relay signed messages, never author them; the keys are Sepolia-only Worker secrets. Gas is part of the operator fee (D33, amended the same day).
- **Rollback.** A `SETTLEMENT` flag per Worker (`sim` or `sepolia`) picks the world; the SimChain world stays untouched, so setting the flag back is one deploy.
- **Staged.** drand proofs for fallback and appeal decisions (until then a silent primary ends in the default outcome), direct transactions in the operators' view, an in-flight row per relayer lane, and the schema v0.9 items (T-033).
- **Asks for Rafa (outside the repository).** Sepolia ETH for the relayer's funding lane: done (1.94 Sepolia ETH on 2026-11-03, measured by the coordinating session). Workers Paid: in place since 2026-11-02 (Rafa, 2026-11-03).

| Option | Effect |
| --- | --- |
| Keep SimChain | No change; the custody claim stays unverifiable from outside |
| Sepolia, one Durable Object, relayer lanes (chosen) | Real custody on a public chain, same API, about a minute per deal; the two nodes stay one process |
| Sepolia, one Durable Object per node | Independent indexes, but the pre-funding stages would need gossip between nodes; later |

## D42. The first wave is USDC only, funded through a USD to USDC on-ramp

**Decided 2026-11-03 by Rafa:** "For the first wave of the service, lets assume USDC only, and USD to USDC onboarding rail." Then: "Then push ERC20, ETH and dynamic extension of asset in escrow to later in the roadmap"; "park it for later in a roadmap module about assets". His reason: "This prevents the complexity of asset conversion during onboarding." One asset end to end (USD in, USDC held, USDC paid out) means no swaps, quotes or price risk at onboarding or at settlement, and fees and gas are quoted in the unit the deal uses.

- **The service accepts USDC only.** The operators' token allowlist and the demo club's rulebook narrow to USDC; clubs may narrow (ADR-0015). The protocol and the contracts stay token-agnostic (D31): the signed terms already name the token.
- **Funding is a USD to USDC on-ramp,** the funding service of ADR-0026 narrowed to one path. Test mode only (a Stripe key must be `sk_test_…`; keys from the environment only). It is the next item in Phase 5 (`docs/tasks/T-214-usd-usdc-onramp.md`), not part of the Sepolia cutover.
- **D38's "any ERC-20, WETH or ETH" is deferred** to an Assets module later in the roadmap (`docs/plan.md`, Phase 6), with dynamically extending which assets an escrow can hold.
- **The Sepolia demo's token is Crow Test USDC (tUSDC),** our own open-mint test token with USDC's ERC-3009 interface (`contracts/script/TestUSDC.sol`), not Circle's Sepolia USDC. Measured on Sepolia: Circle's USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) is an upgradeable proxy with an owner, a master minter, a pauser and a blacklister, and has both ERC-3009 entry points; only Circle's faucet can mint it, behind a CAPTCHA and a rate limit, so every demo grant would come from a treasury Rafa refills by hand, and a blacklist could freeze a demo hold. tUSDC has no admin, the faucet mints it, and it keeps USDC's interface, so moving to Circle's USDC (with the on-ramp, or on mainnet) is a token address and domain change. It is named and labelled as a test token everywhere, never as plain "USDC". SimChain keeps tUSD.

| Option | Effect |
| --- | --- |
| Any ERC-20, WETH or ETH now (D38) | Conversion at onboarding and settlement; fees in several units |
| USDC only, USD to USDC on-ramp (chosen) | One unit end to end; other assets later in an Assets module |
| Sepolia demo on Circle's USDC | The real token, but a hand-filled treasury and an issuer that can freeze a hold |
| Sepolia demo on tUSDC (chosen) | Unlimited faucet, no admin, same interface; not the real token, stated plainly |

## D43. An overturn pays from the bond on chain now, and only the losing party appeals

**Decided 2026-11-03 by Rafa,** who asked to "fix the contracts to address" the contract review's two high findings (`docs/reviews/2026-11-03-contract-review.md` §8). This entry covers the first: I-8, no overturn payout. It moves from Phase 4 into T-212 (item 9), together with the appeal-slot fix it depends on (L-7, item 7). The second high, binding decisions to the delivery, is T-212 item 3 and gets its own entry. Rafa may overrule any line.

- **The overturn payout.** When a party appeal overturns the first decision, the first-instance decider's bond pays the wronged party the price: the buyer after an overturned accept, the seller after an overturned reject. That bond has been encumbered for exactly the price since its decision (guaranteed mode, ADR-0007), so the payout always has cover. The appeal bond goes back to the appellant. SimChain (`payFromBond`) and the formal model's `DecideAppeal` already did this; the contract now matches them. The rules-only `HoldbackBonds.slash` makes the payment, and the adapter reports its `BondSlashed` event as SimChain's `bond.slashed`.
- **Only the losing party appeals (L-7).** That is the buyer after an accept and the seller after a reject; the other party's appeal is refused (`InvalidMessage` on chain, `invalid_terms` in core). Outcomes are binary, so the favoured party has nothing to appeal for. With one slot per deal, its free appeal would shut the losing party out and so block the payout.
- **Still Phase 4:** the appeal fee, a minimum appeal bond, default compensation from bonds, backers and coverage ratios. A zero-bond appeal by the losing party still extends the decider's bond lock by `appealDecideSec` (L-3).
- **The live demo** keeps the deployed contracts until a redeploy, which is gated on Rafa. On Sepolia, fallback and appeal adjudicators also cannot prove their drand seed yet, so no appeal decides there.

| Option | Effect |
| --- | --- |
| Keep the payout in Phase 4 | Appeals move no money on chain; litmus test 3's "appeals are backed by the bond" stays unmet and blocks mainnet |
| Pay from the first decider's bond now, only the losing party appeals (chosen) | Matches SimChain and the formal model; +258 bytes, 332 under EIP-170 |
| Pay now, one appeal slot per party | Same payout, more state and code; a favoured party's appeal has nothing to win |

## D44. Decisions, early accepts and judgment records name the delivery they settle (ADR-0029)

**Decided 2026-11-03 under "autonomy inside the repo", after a Fable max-effort research pass (ADR-0029's draft); Rafa may overrule any line.** This is the second high finding of the contract review (§8) that D43 left to its own entry, and T-212 item 3. A seller who signed two deliveries for one attempt could settle a decision or an early accept about one body with the other, so the chain named a delivery nobody judged or opened. Rafa asked for the fix in the contracts.

- **Option A of ADR-0029.** `EarlyAccept` and `Decision` gain `deliveryHash` (the delivery's EIP-712 struct hash) after `attempt`; the contract stores the posted delivery's hash in `deliveryHashOf` and refuses, at every role and stage, a signature that names another; `mutualSettle` after a delivery must name the posted one, as core already required. The judgment record carries the hash too, and `recordHash` covers it.
- **Versions.** Schema v0.9, EIP-712 domain 0.7 and `commitment.schemaVersion` "0.7" now, without waiting for T-033; T-033's additive items join v0.9 before the Sepolia redeploy, so there is one redeploy.
- **The reference adjudicator checks what it is handed.** It verifies the seller's signature on the delivery before any judge is called (`invalid_signature`) and names the delivery in its decision and record. Tasks now carry the seller-signed delivery; a party appeal reads it from the first decision's state.
- **The reference adjudicator trusts its fallback and appeal adjudicators** (`trustedAdjudicators`). Since D43, an overturn pays the price from the first decider's bond, so one actor as buyer, seller and appeal adjudicator could name Crow's adjudicator as primary, take its honest accept, file a zero-bond appeal and overturn it through its own appeal adjudicator. The service declines such an offer (`invalid_terms`, D29). Unset, it trusts only itself; each demo and test world's three adjudicators trust each other.
- **Cost (measured):** `HoldbackRules` 24,313 bytes, 263 under EIP-170 (+69), no cut needed; one storage slot per deal, about +22,000 gas on the call that lands the delivery (forge figures in T-212).
- **Still gated on Rafa:** the Sepolia redeploy and the Worker switch (ADR-0029 §8).

| Option | Effect |
| --- | --- |
| A. Message field, stored hash, record field (chosen) | The signature, the chain, the key and the record name one delivery; the appeal judges the same body; domain bump, one slot per deal, a redeploy |
| B. Message field, no storage | Self-consistent decisions, but the judged delivery is never tied to the posted one; more gas on every later decision |
| C. Record only, contract unchanged | No redeploy; the early-accept record, the chain-only buyer and the appeal path stay unprotected |
