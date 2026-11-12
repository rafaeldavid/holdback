# Decisions D1–D56

Status: D1–D9 decided October 30, 2026, after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`); the options are kept as the record. D10 to D24 decided October 30 and 31, 2026, each after an independent research pass. D25 to D36 decided October 31 and November 1, 2026, D37 to D40 on November 1 and 2, D41 to D44 on November 3, D45 to D49 on November 4, D50 to D52 on November 5, D53 to D55 on November 6, and D56 on November 10 (Rafa's principles and research-backed choices; D4 was updated on November 1 to target Ethereum mainnet via Sepolia, and marked decided by D41 on November 4). Newer entries are appended at the end. Owner: Rafa. Each decision has options, a recommendation and the ADR it settles.

Still open (2026-11-06): ADR-0025, Proposed, to be decided with T-033's schema bump, in Phase 6 since D53 (schemas 0.9 and 0.10 shipped without it); ADR-0027, Proposed (T-308: judgment report, verifiable inference, tuning releases; four open questions, none needed before Phase 3); the ADR-0023 amendment on fee bundling, Proposed (D37); and dispute clauses as selectable terms, deferred until after the demo (D29).

Shortened on 2026-11-11: D40, D42, D45, D52, D53, D54 and D56, and one passage under D4, state the decision only. The maintainers keep the full text of each privately (`docs/private-materials.md`).

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

**Decided 2026-11-03 by D41:** Ethereum Sepolia, where the public demo settles (ADR-0028).

**Note 2026-11-04 (T-216 planning):** this entry still read "deferred" after the 2026-11-01 update below had named the target: Ethereum mainnet, built and tested on a local chain, then on Sepolia. D41 settled the testnet on 2026-11-03: the reviewed contracts are deployed on Sepolia (T-206, PR 150) and the public demo settles there (T-213). The fixed 0.7 contracts replaced them on 2026-11-04 (PR 169). The question the recommendation left open, account abstraction and paymasters, is answered for the demo without either: the operators' relayer lanes pay the gas and recover it in the operator fee (ADR-0028 §3, D33 as amended). A paymaster for agents stays in Phase 5. Base Sepolia and ZKsync Sepolia were not taken.

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

**Privacy option, parked 2026-11-03.** A private, permissioned chain was evaluated twice, first as the chain that holds the money (not adopted, ADR-0004) and then as a place to run a deal's private content while the assets stay in the Ethereum escrow (T-208, parked). The full text is kept privately (`docs/private-materials.md`).

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
| C. A private-chain fragment per escrow (T-208) | Content off every operator; private settlement not shipped; about 460k L1 gas per batch proof; new sequencer actor; spike after T-206, can sit on top of B |
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

**Decided 2026-11-02 by Rafa.** Each deal chooses private or public through the signed `disclosure.level` (`private`, `judgment` or `public`; ADR-0020, ADR-0024), and no operator imposes a level. This refines D34 and D39.

- **Privacy is an option the parties choose.** More parts become privacy-capable over time: sealed judgment records, private amounts and private settlement venues. The site promises no more privacy than the current build delivers.
- **The tagline** was "Programmatic Escrow and Arbitration" from 2026-11-02. D56 replaced it on 2026-11-10 with "Verifiable settlement for AI commerce". The privacy part of D40 stands.
- **Names (2026-11-03).** The README, `docs/` and `site/llms.txt` write Crow, and the site uses the logomark ’crow. Holdback stays the protocol's name and EIP-712 domain.

The full text is kept privately (`docs/private-materials.md`).

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

**Decided 2026-11-03 by Rafa.** The first funding wave accepts USDC only: the operators' token allowlist and the demo club's rulebook narrow to USDC (ADR-0015). The protocol and the contracts stay token-agnostic (D31), because the signed terms already name the token.

- **One asset end to end** means no swaps, quotes or price risk at funding or at settlement, and fees and gas are quoted in the unit the deal uses. Funding from USD is the funding service of ADR-0026 narrowed to one path, in test mode only.
- **Other assets wait.** D38's "any ERC-20, WETH or ETH" comes with a later assets module.
- **The Sepolia demo's token is Crow Test USDC (tUSDC),** our own open-mint test token with USDC's ERC-3009 interface (`contracts/script/TestUSDC.sol`), not Circle's Sepolia USDC. Measured on Sepolia: Circle's USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) is an upgradeable proxy with an owner, a master minter, a pauser and a blacklister, and has both ERC-3009 entry points; only its issuer's faucet can mint it, and a blacklist could freeze a demo hold. tUSDC has no admin, the faucet mints it, and it keeps USDC's interface, so moving to Circle's USDC is a token address and domain change. It is named and labelled as a test token everywhere, never as plain "USDC". SimChain keeps tUSD.

The full text is kept privately (`docs/private-materials.md`).

## D43. An overturn pays from the bond on chain now, and only the losing party appeals

**Decided 2026-11-03 by Rafa,** who asked to "fix the contracts to address" the contract review's two high findings (`docs/reviews/2026-11-03-contract-review.md` §8). This entry covers the first: I-8, no overturn payout. It moves from Phase 4 into T-212 (item 9), together with the appeal-slot fix it depends on (L-7, item 7). The second high, binding decisions to the delivery, is T-212 item 3 and gets its own entry. Rafa may overrule any line.

- **The overturn payout.** When a party appeal overturns the first decision, the first-instance decider's bond pays the wronged party the price: the buyer after an overturned accept, the seller after an overturned reject. That bond has been encumbered for exactly the price since its decision (guaranteed mode, ADR-0007), so the payout always has cover. The appeal bond goes back to the appellant. SimChain (`payFromBond`) and the formal model's `DecideAppeal` already did this; the contract now matches them. The rules-only `HoldbackBonds.slash` makes the payment, and the adapter reports its `BondSlashed` event as SimChain's `bond.slashed`, with exactly SimChain's payload (`event.schema.json`'s `BondMovement` is closed, so it carries no chain fields; schema v0.9 may add them to every closed payload, T-212 item 3's PR).
- **Only the losing party appeals (L-7).** That is the buyer after an accept and the seller after a reject; the other party's appeal is refused (`InvalidMessage` on chain, `invalid_terms` in core and at prepare). An overturn of a decision in a party's favour would pay the other party from the bond and, since H-2, releases no key to a refunded buyer, so the favoured party has nothing left to win. With one slot per deal, its free appeal would shut the losing party out and so block the payout. The formal model's `FileAppeal` is narrowed the same way.
- **Free appeals now have a price at stake.** The contract checks no minimum appeal bond and collects no appeal fee, so the losing party risks nothing and can win the price from the decider's bond. The bound is the appeal adjudicator itself: honest judges uphold a correct decision, and the primary consents to the appeal adjudicator the terms name (the reference adjudicator will decline untrusted ones, T-212 item 3's PR). A minimum appeal bond (a rate in the terms, which needs an ADR and a version bump) is Phase 4 and **blocks mainnet**, and so does the appeal adjudicator's own coverage (T-212 item 5; L-5 re-rated medium, review §8 follow-up). On the Sepolia demo the tokens are worthless and the appeal adjudicators are the demo's own.
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

## D45. The founder console signs in with passkeys and refreshes every hour

**Decided 2026-11-04 by Rafa.** The founders' console sits on its own host behind an access proxy, and scheduled pushes reach it with service tokens that can only push.

The full text is kept privately (`docs/private-materials.md`).

## D46. Agents register their own adjudicators through the API; round 1 includes mutual settlement and overturns through the API

**Decided 2026-11-04 by Rafa**, answering round 1's scope questions (T-216): "mutual settlement is important in the basic build, API should facilitate overturned appeals". Asked whether to plan adjudicator registration through the API, he answered "Yes, plan it". On funding the round's keys: "feels like we need a master address that funds all the rest". The design below follows a Fable max-effort research pass the same day (`docs/research/2026-11-04-adjudicator-registration.md`); Rafa may overrule any line.

- **Round 1 (T-216).**
  - A mutual settlement is one of its scenarios.
  - Overturned appeals run through the public API. The round registers its own adjudicator, names it primary, and has it decide wrongly by script; a demo appeal adjudicator then overturns, and the first decider's bond pays the wronged party (D43).
  - The same self-registered adjudicator is the round's silent adjudicator: it accepts and never decides, so the fallback and default paths run on a real offline adjudicator.
  - The round's keys derive from one secret, and only its master address is funded by Rafa (`examples/e2e-keys.ts`).
- **Registration (T-221, ADR-0030 to come).** Crow's three adjudicators stay the defaults; naming others is advanced use of the protocol, outside Crow's recommendation. `POST /v1/adjudicators` takes a self-signed EIP-712 `AdjudicatorRegistration`. Operators verify it, store one per address, and serve it with its signature and with the bond read from `HoldbackBonds`. The adjudicator deposits its bond on chain from its own key.
  - Schema 0.10, additive; the EIP-712 domain stays 0.7.
  - The reference adjudicator's trust rule (D44) extends to the fallback role: it serves as fallback only under a trusted appeal adjudicator. Without that, registration opens a second path to D44's attack.
- **Later, with T-212's mainnet redeploy:** a gasless bond deposit and appeal bond, by ERC-3009 authorization. Until then a bond and an appellant's approval need the agent's own Sepolia ETH.
- **Rafa's answers on T-221 (2026-11-04).**
  - One message carries the key.
  - The demo's adjudicators register the same way.
  - Registrations are never removed: "show status of last used for each registration (don't remove but be transparent alongside other metrics)".
  - "crow's adjudicators are default and custom selection is advanced usage of protocol (outside of recommendation by crow etc.)".
  - The gasless bond: "build later".
  - Registrations without a bond are listed: "just be clear that they don't".
- **A bond rule, added by Rafa.** "crow should warn users if choosing an adjudicator without bond and should reject adjudicator selection at protocol level if contract specifies bond payout but adjudicator has no bond".
  - **The warning** is advisory, from the operator (T-221).
  - **For the primary, the refusal already holds:** its acceptance needs unencumbered bond for the price, and funding encumbers it.
  - **For the fallback it is new.** It is a check at selection, a read with no lock (M-3), in core and the contract in one change, with the next contract redeploy. Core cannot go first: the EVM adapter throws when core refuses what the contract accepts. Until then, operators refuse to relay such terms (T-221), and the direct path stays open. Its design is an ADR after a research pass (backlog).
  - **What it buys:** unpaid payouts are already impossible (funding reverts for an unbonded primary, and an unbonded fallback cannot decide), so it turns "the deal goes to the default outcome" into "refused before funding".
  - **What it cannot do:** with no lock, it cannot promise the fallback still has its bond at takeover.
  - **What it costs:** it is an exception to D31 and D32, since a bondless fallback is neither malformed nor unprocessable. On chain, funding depends on a bond the named fallback controls, which it can withdraw without having signed anything. A `neutrality.*` fixture must show that nothing is locked and the parties can offer again.
- **Punted to the backlog:** serving the posted seller-signed delivery to a deal's own adjudicators. Rafa: "let's punt on the read thing, since I don't understand it and pick it up later from the backlog". The row is under API in `docs/backlog.md`.

| Option | Effect |
| --- | --- |
| Registration through the API, smallest honest form plus three additions (chosen) | The protocol's first property becomes true on the demo; overturns and silent adjudicators are real; an ADR and an additive schema bump; about one task |
| A labelled test adjudicator inside the demo | About a day less; tests no outside adjudicator, so the API path Rafa asked for stays untested |
| An on-chain registry now | A deploy and gas per registration, for no round-1 gain; Phase 4 |

## D47. Crow runs a standing test seller on the Sepolia test environment (T-222)

**Decided 2026-11-04 under "autonomy inside the repo", after a Fable max-effort research pass (`docs/research/2026-11-04-test-counterparties.md`); Rafa may overrule any line.** Rafa asked: "For the test environment, feels like we should have a standing buyer / seller test identity that people can do test escrow with no?" Today `try.mjs` plays both sides of a deal with fresh keys, so a visitor never deals with another party.

- **Seller first.** Crow's test seller is a party, not a feature of the operators. It runs as its own Worker, `crow-test-agents`, uses the operators' public API like any agent, and signs only what it prepared and checked itself (`examples/agent.ts`, `examples/verify.ts`). The operators grant it nothing they would not grant any agent. The test buyer is a later slice (backlog).
- **What it sells.** One item: `try.mjs`'s dataset, 3 rows of `customer_id,email` for 25 tUSDC under the checks `cols`, `rows` and `uniq`, checks-only, public terms. D31 binds the protocol, not a party, so a fixed catalog is the seller's choice. A proposal for the same dataset at another price or with other checks gets the catalog terms as a counter-offer; a proposal for other work is refused with a reason.
- **A refund on request.** A buyer whose proposal carries `"test": {"outcome": "refund"}` gets 2 rows, which fail the `rows` check, so the decision refunds the price. The buyer loses the adjudication fee and the operator fee (5.71 tUSDC of test tokens today) and gets no key. The intake page, its card and the status say so.
- **Where it lives.** An intake page at `https://escrow.stream/agents/test-seller` on a Worker route beside the site, following the "Agent intake" convention in `site/llms.txt`: the sealed proposal on Crow, the pointer and the sealed key to the intake, the commitment ID back through the status token. `agents.escrow.stream` is the fallback host if the route misbehaves.
- **One standing address.** The seller keeps one address and one intake key, both derived from one Sepolia-only secret, `TEST_AGENTS_SEED`. The page lists the address, a deliberate departure from the convention's "lists no Crow address": a public test seller needs no unlinkability, and the buyer can check `terms.seller` against it. The seller calls the faucet only when it holds no live mandate.
- **The visitor's path.** The pinned command in `llms.txt` runs `node try.mjs --seller https://escrow.stream/agents/test-seller`: the same bundle, now playing only the buyer. `--outcome refund` asks for the refund. When the test seller is down or busy, `try.mjs` says so and plays both sides itself. That differs from the research note, which proposed stopping by default: one approved command should always finish a deal, and the printed line keeps the switch visible.
- **Bounded loss (D26).** At most 3 requests per visitor IP address (an IPv6 /64) an hour and 10 a day, 20 offers an hour and 100 a day in all, and 10 in progress at once. Unfunded offers count; requests whose proposal does not open do not, so junk cannot use up the shared caps. A deal closes at its deadlines whatever happens on Crow, so a stalled one cannot hold a slot. Windows: the offer expires after 1,800 s, funding closes at 2,400 s and delivery at 3,600 s, all counted from the offer; judging windows are 60 s. If the seller stalls after funding, the buyer reclaims its hold at `deliverBy`, at most an hour after the offer.
- **Gas.** The test agents hold no Sepolia ETH and send no transaction. The operators' relayer pays for each deal as it does for `try.mjs`: 1,636,242 gas per deal plus the buyer's faucet mint (measured), one mint fewer than a `try.mjs` deal. At the day cap that is about 0.19 Sepolia ETH a day at 1 gwei (arithmetic).
- **Litmus tests.** A party only: no protocol step, schema field or contract line changes. The hold and judgment are untouched; the refund is a real failed check. A stalled seller is the existing `neutrality.seller-withholds-delivery` case.
- **Open for Rafa.** The faucet does not renew an expired mandate, so a standing address stops offering after 30 days unless the world resets first. The one-line fix is in `apps/demo-cloud/src/world.ts`, the operator lane; until it ships, rotating the secret (`seed.mjs --replace`) is the stopgap.
  - *2026-11-04, T-223:* T-223 (PR 191) changed the faucet to sign a fresh 30-day mandate at every grant, which replaces the address's earlier one, whether or not it has expired. Renewing only an expired one would leave the seller degraded for about 2 hours every 30 days, because it asks 2 hours early (inferred). The fix reaches the live demo when Rafa deploys the operators; until then the stopgap stands.

| Option | Effect |
| --- | --- |
| Standing test seller, sealed intake, `try.mjs --seller` (chosen) | A visitor's agent deals with another party in one approved command; no protocol change; one Worker to deploy |
| A seller and a buyer at once | The visitor can also sell; about twice the work before anything ships |
| Keep self-play only | Nothing to run; a visitor never sees two parties |

## D48. Appeal bonds move by a relayed token permit; agents never need Sepolia ETH to appeal (T-224)

**Decided 2026-11-04 under "autonomy inside the repo", after a Fable max-effort research pass (`docs/research/2026-11-04-visitor-gas.md`); Rafa may overrule any line.** Rafa asked for the plan: "Yes, plan it", to my proposal of a way for new visitors to appeal without their own Sepolia ETH. Today `llms.txt` says an appeal on Sepolia needs the appellant's own test ETH. The reason: `HoldbackBonds.takeAppealBond` pulls the bond with `transferFrom`, so the appellant must first send its own `approve` transaction. Every other step a visitor takes is relayed and free (measured).

- **The permit.** On a chain world, `POST /v1/prepare/appeal` returns a second slot, `bondPermit.signature`. It is an EIP-2612 `Permit` with owner the appellant, spender HoldbackBonds, value the appeal bond, nonce the token's nonce for the appellant and deadline `appealBy`. It is signed under the token's own EIP-712 domain, the one the funding and the operator fee already use. The appellant signs it beside the `Appeal` and sends both in one body. tUSDC (Solady's ERC20) and Circle's USDC (FiatToken v2 and later) both implement `permit`, so the path is the same on mainnet (measured for tUSDC; inferred for USDC from its published source).
- **The relay.** The operator relays `permit` and `fileAppeal` together in one Multicall3 call, as it relays the operator fee with the funding (ADR-0023's EVM amendment).
  - It reads the appellant's allowance to the vault first. When that already covers the bond, it files the appeal alone.
  - A permit by itself can only set an allowance to the vault. Only `fileAppeal` can spend it, and only on the appellant's own signed appeal, so the operator relays and never authors.
  - A refused relay leaves both signed messages valid for another operator or a direct call.
- **Gas and the fee.**
  - The deal's lane pays about 0.4 to 0.6 million gas per appeal on Sepolia. That is inferred from anvil's 73,884 gas for the permit and 108,396 for `fileAppeal`, times Sepolia's measured 2.1 to 3.2 factor, and is a quarter to a third of a deal's 1,636,242.
  - Appeals stay free of the operator fee on the demo (ADR-0023 §5). The fixed per-deal quote absorbs the cost (D33 as amended). T-215's live quote may add an appeal part, as an operator parameter, before mainnet.
- **No contract change.** HoldbackRules keeps its 263 bytes of headroom under the contract size limit (measured).
  - The gasless adjudicator bond (`depositWithAuthorization` and a signed `withdraw`, in HoldbackBonds only) stays with T-212's mainnet redeploy, as D46 decided. This entry closes the appeal half of that backlog row.
  - Until the redeploy, an outside adjudicator bonds from its own key, and `llms.txt` says so.
- **Not chosen: a gas drip.**
  - Sepolia ETH is scarce and traded, so a faucet drip without a CAPTCHA is farmable: about 0.6 Sepolia ETH a day at the faucet's 600 grants, enough to empty the funding lane in about three days (inferred).
  - A drip puts a chain transaction back in front of the agent, and none of it carries to mainnet.
  - The backlog row for an escape-hatch drip stays as it is, Rafa's call.
- **Schema.** The change is additive: an `AllowancePermit` definition and an `AppealRequest`, which is an `Appeal` plus an optional `bondPermit`. It rides T-221's 0.10 if both reach the same deploy, else ships as 0.11. The EIP-712 domain stays 0.7, because `Permit` is the token's type, not Holdback's.
- **The defaults for the research's open questions** (Rafa may overrule each):
  1. one version bump, as above;
  2. appeals stay free on the demo;
  3. the drip row stays as it is;
  4. the zero-bond appeal is recorded below and its fix stays with T-212;
  5. `llms.txt` pins the `bonds` address with T-220.
- **Residual, recorded.** The contract accepts a zero appeal bond, so an agent that writes `bond: 0` into its own `Appeal` already appeals with no allowance (measured from the contract). The deterrent exists only for the rulebook's bond, and this entry makes that bond postable by anyone. The fix is a minimum appeal bond in the signed terms (T-212, before mainnet, D43). On the demo the tokens are worthless and the appeal adjudicators are Crow's.
- **Litmus tests.**
  - Neutrality holds: a refusing operator leaves both signatures valid, and `neutrality.operator-refuses-appeal-relay` will show a direct filing.
  - The hold is untouched.
  - Judgment is untouched: appeals stay backed by the adjudicator's bond.

| Option | Effect |
| --- | --- |
| A gas drip from the funding lane | Demo only; farmable; the agent still sends its own transaction; nothing carries to mainnet |
| A relayed EIP-2612 permit (chosen) | One more typed-data slot; no contract change; the same on USDC; about a third of a deal's gas per appeal |
| ERC-3009 authorization into HoldbackBonds | Right for the adjudicator's bond, at T-212's redeploy; for appeals it costs a redeploy and HoldbackRules bytes for nothing the permit doesn't give |
| EIP-7702 or an ERC-4337 paymaster | Wallet machinery in the agent's path and a third party in the write path; Phase 5 |
| A zero appeal bond on the demo | Free appeals, a fresh world, and a protocol that misrepresents itself; mainnet needs a minimum bond anyway |

## D49. One long-lived demo world; a new world only for a new rules contract

**Decided 2026-11-04 by Rafa** ("Yes, keep the world"), when asked whether T-220 should keep today's Sepolia world or start a fresh one. His reason: "ideally we build the way to monitor the API so doubtful we want fresh worlds consistently". The findings come from a Fable max-effort research pass the same day (`docs/research/2026-11-04-one-world.md`); Rafa may overrule any line.

- **T-220 keeps `holdback-public-demo-sepolia-2026-11-04`.** The demo club's rulebook changes in place to name drand quicknet, and the demo adjudicators keep their keys and their 25,000 tUSDC bonds.
  - A stored deal keeps the rulebook it was offered under (`Book.club`) and moves on from its book (measured).
  - An offer still bound to the old hash is refused with `rulebook_unknown`, which tells the agent to read the club again (measured).
- **What changes in place:** rulebooks, additive schema versions (0.10 is one), Worker code, judge registries and fees. The Sepolia world replays nothing on open, so the rule "a schema bump resets the public world" in `docs/operations.md` was SimChain's, and it retires (measured).
- **A new world only for a new rules contract,** or another chain. A redeploy changes the EIP-712 domain that every signature is checked under, and creates a new bond vault; the world refuses to open against another rules address (measured). One world over two contracts would put a settlement facade in the money path: days of work (inferred), not before mainnet.
- **History when a world does change:**
  - the chain holds every funded step;
  - the old world's storage is never deleted, and a rollback serves it;
  - `docs/operations.md` records the names, addresses, versions and the open deals' timeouts.
  A read-only archive route for old worlds goes to the backlog until a redeploy is planned.
- **The defaults for the research's open questions** (Rafa may overrule each):
  1. a world key seed (`WORLD_SECRET`), so a new world keeps the demo adjudicators' addresses, becomes a small task before the next redeploy, not part of T-220;
  2. the archive route stays in the backlog;
  3. there is no grace window for offers bound to the old rulebook hash;
  4. T-220 waits for T-219 and ships all four in one deploy, as Rafa chose for question 5 of T-216;
  5. the 0.6 vault's 75,000 test tUSDC and the old addresses' Sepolia ETH (about 0.015) stay where they are.
- **Litmus tests.** Unchanged. The world is the operators' view, and settlement is on chain. Keeping the world keeps the API's history of each deal, which is what monitoring needs.

| Option | Effect |
| --- | --- |
| Keep the world; change the rulebook in place (chosen) | No new keys or bonds, and no break in history; old deals keep their rulebook; a stale offer gets 422 with the fix in the problem |
| A fresh world per rulebook or schema change (T-220's draft) | Three new bonds (about 1.12 million gas and 0.015 Sepolia ETH); the API forgets every deal, its ciphertexts and its records; monitoring restarts |
| One world over several rules contracts | Days of adapter and operator work in the money path, for a testnet demo |

## D50. A deal left behind the chain is security hardening; it does not block T-220's deploy (T-227)

**Decided 2026-11-05 by Rafa**, when asked whether residual 13 in `docs/neutrality.md` (a direct step the operators cannot read) must be fixed before T-220's deploy, as T-218's red-teamer recommended. He asked: "is this only a demo and not a mainnet problem? Or is this a mainnet security issue? If so, let's add to security hardening, since we're assuming honest actors at the moment." The findings come from T-218's review and red team (PR 185, 2026-11-04); no new research pass ran. Rafa may overrule any line.

- **It is a mainnet issue (inferred).** The gap is in the operator node's code, the chain sync and the adjudicators' schedule, not in the Sepolia setup. Mainnet operators would run the same code.
- **The attack.** A stranger, or a party to the deal, resends a copied signed step through a contract that transforms its calldata. The contract takes it, but the operators' view cannot rebuild it, so their book falls behind `dealOf`. The operators' adjudicators read the book, so they do not act on that deal, and it ends by its timeouts (its default outcome). It costs the griefer only gas.
- **What still holds.** The funds stay under the contract's terms. The parties and other adjudicators can still submit to the contract directly (ADR-0005), and the state read shows the contract's stage with a notice.
- **Two of the five cases are gaps for real use:** a step from a contract signer (ERC-1271, a Safe or a smart account), and two signed steps for one deal in one transaction. Honest agents with contract wallets or batched calls will hit them. The other three are attacks (T-227 lists all five).
- **Placement.** T-227 in Phase 11, Security hardening, after T-225. It must land before mainnet. It touches relays and adjudication, so it needs `reviewer` and `red-teamer` passes. T-220 deploys without it, because the demo assumes honest parties until the basic demo works (`docs/backlog.md`, Rafa, 2026-10-30).
- **The proposed fix** (T-218's reviewers): the adjudicators read `dealOf`'s stage, and a relay path records the receipt without stepping the core mirror. No contract change is expected (inferred).
- **Litmus tests.**
  - Neutrality holds in the protocol's sense: the deal settles by its terms, and nobody moves funds outside them. In practice it weakens until T-227 lands: anyone can silence the operators' adjudicators on one deal for the cost of gas.
  - The hold is untouched.
  - Judgment is untouched; the operators' adjudicators skip the deal, as an offline adjudicator would.

| Option | Effect |
| --- | --- |
| Fix before T-220's deploy (T-218's red-teamer) | No demo deal can be griefed into its default outcome; round 1 waits for a task with a red team |
| Phase 11, before mainnet (chosen) | T-220 deploys now; until T-227 lands, anyone can push a demo deal to its timeouts for the cost of gas |
| Keep it in the backlog | Nothing scheduled; mainnet could ship with the gap |

## D51. One-Click Escrow: one approval per honest deal at published terms (T-229)

**Decided 2026-11-05 by Rafa:** "One-Click Escrow is what we're looking for. Buyer puts up contract or Seller and, assuming an honest good contract with no price negotiation, it should go through seamlessly if agent has access to funds." Then, the same day: "ship the two One-Click changes (trim llms.txt, and copy the command with the prompt)." Rafa may overrule any line.

- **The goal.** An honest deal at published terms, with no price negotiation, goes through with one approval from the user. Either side can start it, the buyer or the seller, as long as the agent has access to funds.
- **The metric.** User approvals per honest deal at published terms, started by either side, when the agent has funds. The target is 1. The time to Released is tracked beside it.
- **Measured on 2026-11-05: 4 approvals** [measured]. A fresh Claude Code 2.1.318, default permissions, no allowlist, given the homepage prompt, asked for 4 approvals in each of 2 runs and reached Released in about 93 s. The 4 were a fetch of `llms.txt`, a second download of `try.mjs` to read it, a search of that copy, and the one command (T-229, Evidence).
- **The first step (T-229).** The homepage's copy button copies a prompt that carries the one command, and `llms.txt`'s "Try it" stops inviting a fetch of `try.mjs` first. The SHA-256 pin and the source on GitHub stay as the trust anchors. Live since 2026-11-05, 15:58 UTC (crow-site `4f049eb5`).
- **Measured after the deploy, 2026-11-05: 1 approval** [measured]. The same harness, given the new homepage prompt, asked for 1 approval in each of 2 runs ("allow once" and "always allow"), with no chat approval, and both deals ended Released with Crow's test seller, 79.2 s and 106.2 s after the start. The one approval was the command itself. The target is met for a deal the buyer starts (T-229, Evidence).
- **The next gap.** A visitor's agent that starts as the seller needs a standing test buyer, the second slice of Crow's test counterparties (T-222, `docs/backlog.md`).
- **Litmus tests.** Untouched: the change is the site's text and its copy button. The command still refuses any `try.mjs` whose SHA-256 differs from the one it carries.

| Option | Effect |
| --- | --- |
| Copy the command with the prompt; trim "Try it" (chosen) | 1 approval measured per deal after the deploy; the visible page still shows no command |
| Show the command on the page again (T-037's first design) | One approval too, but Rafa chose a page with only the short line on 2026-11-04 |
| Keep the link-only prompt | 4 approvals measured per deal |

## D52. Crow Control builds twice a day in Berlin time and skips a run with nothing new

**Decided 2026-11-05 by Rafa.** The founders' console builds on a schedule, twice a day, and a scheduled run with nothing new ends early. This replaces D45's hourly refresh. The console is a founders' tool outside the protocol, so the litmus tests are untouched.

The full text is kept privately (`docs/private-materials.md`).

## D53. Finish stable EVM operations first; other Phase 2 work moves to later phases

**Decided 2026-11-06 by Rafa.** Phase 2 finishes stable EVM operations on Sepolia first, and every other open Phase 2 task moves to a later phase. The decision orders work and changes no contract, schema, defense or API.

- **Stable EVM operations means four things:**
  - round 1 green on the live Sepolia demo: every in-scope scenario passes against one deployment (T-216);
  - T-221's leftovers: a red-team pass on the review's fixes, a cross-family review, and the CI line for the anvil end to end;
  - the maintainer's read of the contract review, and the hardening the next contract redeploy needs (T-206, T-212);
  - anything else in Phase 2 that a stable demo on Sepolia needs.
- **Phase 2 keeps four open tasks:** T-206, T-212, T-216 and T-221. D54 moved T-212 and T-221 the same day.
- **Six tasks moved to later phases:**
  - T-207, private deals, to Phase 8;
  - T-034, faster CI, to Phase 9;
  - T-036, the coordinator commands, to Phase 10;
  - T-224, appeal bonds by a relayed permit, to Phase 5. Round 1's appeals run without it, with the appellant's own Sepolia ETH (T-216, scenarios 6 and 7);
  - T-016b, the testkit follow-ups, to Phase 3. Round 1 tests appeals, early accept and mutual settlement live on Sepolia;
  - T-033, schema v0.9's additive items, to Phase 6. It is not done (measured on origin/main, 2026-11-06): `FundingAuthorization.scheme` is still `erc3009` or `permit2`, `allowedTokens` is still required, `operator-status.chainId` is still a string, and ADR-0025 is still Proposed. The demo has funded through ERC-3009 on Sepolia since 2026-11-03 without it.
- **Three tasks it proposed exist since 2026-11-06:**
  - the operators send due timeouts on their own, so an abandoned deal settles with no caller (T-231, live since 19:01 UTC);
  - a low-balance warning for the relayer's funding lane (D54, item 5); the full alarm stays in T-054;
  - the read-after-write audit, a sweep of the product's own chain reads after a write (T-232; D54, item 6).

The full text is kept privately (`docs/private-materials.md`).

## D54. Phase 2 walkthrough (Rafa, 2026-11-06)

**Decided 2026-11-06 by Rafa:** scenario 11 counts as covered, T-212 moves to Phase 11 and T-221 to Phase 4, the read-after-write audit is queued as T-232, a low-balance warning for the relayer's funding lane comes now, and Phase 2 has seven exit criteria. The items accept evidence already recorded, order work and set Phase 2's exit. They change no contract, schema, defense or API.

1. **Scenario 11, a restart between broadcast and receipt, counts as covered.** The evidence:
   - T-219's offline tests: the world stopped after each money transaction's broadcast, and each restarted world applied it (T-219 Evidence, the cutover case), in 5 runs [the cases documented in T-219; the run count as the coordinator session reported it];
   - T-220's Sepolia fork rehearsal, in which a restart applied a transaction already broadcast [documented, T-220 Evidence, step 7];
   - T-228's live deploy on 2026-11-05, which restarted both operators [documented, T-228 Evidence];
   - the live run of 2026-11-06 (`reports/e2e-round-1/2026-11-06T093347Z/` in the round-1 checkout): 12 of 13 checks passed [measured]. The failed check needs holdback-op1's redeploy to land within about 12 s, one Sepolia block, between the broadcast and the receipt. The redeploy by hand took 67 s [as the coordinator session reported it], so holdback-op1 applied the receipt before it restarted: the delivery's own request answered 200 Delivered [measured, the run's `11.json`]. The other checks held: the restart came during the pause, a retry got the mined result, both operators served the delivery as holdback-op1's relay, and the deal ended Released with the buyer's key served.

   The live redesign moves to Phase 3 as row T-310: for example, hold the relayed transaction out of a block, so the redeploy has minutes.
2. **T-212, contract hardening, moves to Phase 11.** Its open items 1, 2, 4, 5, 6 and 8 become the contract redeploy before mainnet. That redeploy also carries the other contract changes that wait for one: T-225's drand hardening, T-227's contract part and T-221's contract-side bond refusal. A contract change means a new demo world (D49), so Phase 2 closes on Sepolia without a redeploy.
3. **T-221's leftovers wait** until the reference adjudicator is stable. The leftovers are a red-team pass on the review's fixes, a cross-family review, and the CI line for `apps/demo-cloud/src/registration.anvil.test.ts`. T-221 moves to Phase 4, paused: outside adjudicators bring their own bonds, and that phase puts the registry, bonds, coverage and appeals on the contract. Its slices 1 and 2 stay live as they are (PRs 184 and 202, deployed with T-220).
4. **T-206, the contract review, gets no further open-ended review.** It closed the same day on the maintainer's read of the one-page brief and his three confirmations, which PR 227 (`edc8311`) recorded.
5. **A low-balance warning for the relayer's funding lane comes now,** in the founders' console. The full alarm stays in T-054.
6. **The read-after-write audit is queued** as T-232 in Phase 2. It finds every chain read right after a write that a lagging public RPC server could answer, across the operators, the adjudicator, the faucet, the test seller, `try.mjs` and the examples, and pins or retries each one, with a lint or test check if one is feasible.
7. **Phase 2's exit criteria,** written into `docs/plan.md` under Phase 2:
   1. round 1: every scenario passes live on Sepolia, scenario 11 by the coverage in item 1, with finality clean on every run;
   2. the join-on-chain-delivery fix is deployed, and scenario 8 passes on rerun;
   3. operator-sent timeouts are deployed;
   4. the read-after-write audit (T-232) is done, with its fixes merged;
   5. T-206 is closed, with Rafa's read of the brief and his three confirmations recorded;
   6. gas per deal is recorded, as D4 requires (T-066's metrics measure about 1.26 million gas for a deal's own transactions);
   7. no High or Critical finding is open in Phase 2's code.

   Out of Phase 2 by these decisions: T-212 (Phase 11), the scenario 11 redesign (Phase 3, T-310) and T-221 (Phase 4).

- **Where round 1 stood** on 2026-11-06 (measured from the run records): 15 of 16 scenarios had passed live, the last scenario 8 at 15:35 UTC with 25 of 25 checks (run `2026-11-06T152621Z`), and 11 counts by coverage. Before that pass, the round's buyer and seller closed the deal of scenario 8's earlier run with a direct `mutualSettle` in [`0x092d…2c58`](https://sepolia.etherscan.io/tx/0x092d7e8ae4a45ac09cec8c6665f7a5e868e0ebe2fdf2f91815f90f80952a9c58).

The full text is kept privately (`docs/private-materials.md`).

## D55. Round 1's live passes count across operator builds

**Decided 2026-11-06 by Rafa:** "Accept passes as is". The coordinator session asked whether Phase 2 should close with one full rerun of round 1 on the final operator build. Rafa declined the rerun. Each scenario's live pass counts on whichever build it ran, and Phase 2 needs no rerun. No research pass ran: the decision accepts evidence already recorded and changes no design. Rafa may overrule it.

- **The rule it settles.** T-216's own pass rule asks for every scenario to pass against one deployment and one set of Worker versions, with a rerun of whatever a later fix touches (T-216, How the round runs). Every pass ran on one deployment, HoldbackRules `0xF38287e5…7cFA` [measured: each run's `summary.md`]. The operator builds differed.
- **The three builds the passes ran on** [documented: each run's times against the deploy times in `docs/operations.md`; no run record names its build]:
  - T-220's, holdback-op1 `1d8a029c` and holdback-op2 `a042aae3`, live from 2026-11-05 11:04 UTC: run `2026-11-05T132524Z`, which passed 1, 2, 3a and 6;
  - T-228's, holdback-op1 `ba7a2ad9` and holdback-op2 `7826e3ce`, live from 2026-11-05 15:29 UTC: runs `2026-11-05T190711Z` and `2026-11-05T193705Z`, `2026-11-06T070341Z` and `2026-11-06T093347Z`, which together passed every scenario but 8 and 11 (11 counts by its coverage);
  - T-230's, holdback-op1 `8bcda43c` and holdback-op2 `7e4d3fa5`, live from 2026-11-06 12:19 UTC: run `2026-11-06T152621Z`, which passed 8 with the join-on-chain-delivery fix.
- **T-231's build went live after all of them.** holdback-op1 `066f1b18` and holdback-op2 `21cbbc0b` have served since 2026-11-06 19:01 UTC, and the last pass ended at 15:35 UTC. That build sends due timeouts from the operators, which 3a, 3b, 3c, 3d, 4, 5a and 8's second deal wait for [inferred from T-231's intent]. No round 1 run has used it.
- **T-216's one-build rule gives way to D54's first exit criterion as worded:** every scenario passes live on Sepolia, scenario 11 by its coverage (D54, item 1), with finality clean on every run. Round 1 meets it: 15 of 16 scenarios passed live, and the finality re-read on 2026-11-06 from 21:03 to 21:05 UTC found all 153 deal transactions recorded in the 8 runs in their recorded blocks [measured: T-216 Evidence, "Round 1's tally and finality"].
- **What follows.** T-216 is done once its report shows every run (PR 241), and Phase 2's first exit criterion is met under D55. T-231's timeouts and T-232's read fixes rest on their own tasks' evidence; no round 1 rerun waits for them.
- **Litmus tests.** Untouched: the decision accepts recorded evidence and changes no contract, schema, defense or API.

| Option | Effect |
| --- | --- |
| Accept passes as is (chosen) | T-216 closes now; the report names the build behind each pass; no rerun of round 1 for Phase 2 |
| One full rerun on the final build | Every scenario on one build, T-231's included; waits for T-232's deploy, then about 1.5 hours of Rafa's terminal [guessed in T-216's Handoff] |
| Rerun only what later builds touch | 3a, 3b, 3c, 3d, 4, 5a and 8 again; still waits for T-232's deploy |

## D56. The tagline is "Verifiable settlement for AI commerce", on a landing page from Rafa's mock (T-312)

**Decided 2026-11-10 by Rafa.** The tagline is "Verifiable settlement for AI commerce". It replaces D40's "Programmatic Escrow and Arbitration" on the site, in `site/llms.txt` and in the README's first line.

- **The page keeps what agents need:** the One-Click Escrow Try line (D51) and a link to `/llms.txt`. The rest of the agent guide in `llms.txt` is unchanged.
- **D40's privacy part stands:** each deal chooses its disclosure level, and the site promises no more privacy than the build delivers.
- **Litmus tests.** Untouched: the decision changes copy and the landing page only, and no contract, schema, defense or API.

The full text is kept privately (`docs/private-materials.md`).

## D57. Phase one ships without party appeals and bonds (ADR-0031)

**Decided 2026-11-11 by Rafa.** Asked "Should phase one ship without party appeals and bonds (cut SC-7)?", he answered: "Yes, cut them". Phase one is the next deployment of the contracts: the one an external audit reads and a first pilot uses, on a testnet. The design is ADR-0031 (Proposed), which records this cut beside the others of the phase-one scope. Rafa may overrule any line of it.

- **What it means.** The first decision by the primary or the fallback adjudicator is final on chain. `HoldbackBonds.sol` leaves the phase-one contracts, with `fileAppeal`, `expireAppeal` and the appeal state. The appeal adjudicator stays for escalations only. No signed type and no file in `spec/schemas/` changes; SimChain keeps appeals and bonds as the full protocol's reference.
- **Why.** Rafa's standard for the contracts, the same day: "it's better to have a limited scope for an initial phase of the product than perfectly complete and universal design contracts that open up to risks." Half of the open contract findings sit in the appeal and bond code, both mainnet blockers among them (L-3 and L-5, `docs/audit/known-issues.md`). The cut closes them by removing the code.
- **Litmus tests.** The decision sets aside one line of litmus test 3 for phase one: "Appeals are backed by the adjudicator's bond". A wrong first decision has no remedy on chain. The loss is bounded by one deal's price and fee, and the recourse is the signed record and the law (D26). What protects a party instead is its choice of the three adjudicators, the fallback and the default outcome (ADR-0031, "Litmus tests"). Neutrality and the hold pass. The sentence in `CLAUDE.md` is Rafa's edit; ADR-0031 proposes its wording.
- **What it amends for the phase-one contracts:** ADR-0007's bonds and overturn payout, ADR-0016's bond gate at funding and its appeal state, and D43's overturn payout on chain. The deployed Sepolia contracts keep all three until the redeploy, which is Rafa's.
- **Four more answers from Rafa on 2026-11-11,** recorded in ADR-0031:
  - **Contract signers stay.** He refused the cut to plain-key signatures: "Keep multisig compatibility and smart-contract ownership. The cost is too high for composability with other protocols." He clarified: "I mean smart-contract operators and multisig adjudicators etc." A multisig or any contract can be a party or an adjudicator.
  - **A cut feature's events leave with it.** Asked "Where a cut removes a feature, may its events go with it?", he answered: "Agree". It is the one exception to the rule that events are never removed, and it covers only the events of a feature he has cut. `HoldbackBonds.sol` goes with its seven events, and `AppealFiled` and `AppealClosed` leave the rules contract.
  - **The on-chain beacon proof stays for now.** His words: "the on-chain beacon proof stays for now, if that is the industry standard and what uniswap uses." The condition does not hold as worded, and he has been told: Uniswap's contracts use no randomness beacon, and verifying a drand round on chain is sound but not an industry standard [from memory, not checked today]. The proof stays for another reason: with no appeal, it is the only thing on chain that stops a fallback or an appeal adjudicator from choosing its panel. The question comes back with the choice of chain.
  - **The settlement for late work stays.** Today the contract lets both parties settle in `Held` for a delivery that was never posted and release its key in the same transaction as the payment; a cut would have removed it. Asked "Keep the path that settles late work and releases the key in the same transaction?", he answered: "Yes, keep it". His reason, earlier the same day: "we should measure how many actually use the timebounds stricly vs. who settles anyways." Without the path the money can still move by agreement, but the key changes hands off chain and one party trusts the other. Core (`packages/core/src/state.ts:516-518`), ADR-0019 and the formal model refuse the path today and must change to allow it; until core does, nobody can use it through the API.
- **Still open for Rafa:** the points under "What waits on Rafa" in ADR-0031, the sentence in `CLAUDE.md` first.
- **Research pass:** T-342 read the contracts, the ADRs each cut touches and the schemas, and a red team attacked the cuts. It found no Critical issue: no cut lets a party take held funds or leaves a deal stuck. Its 2 High findings are the price of this decision: a wrong first decision is final and unpaid, and a party must trust all three adjudicators it names. The findings and the answers are in ADR-0031.

| Option | Effect |
| --- | --- |
| Ship party appeals and bonds, with their fixes | A minimum appeal bond in the signed terms, a bond for the appeal adjudicator and a schema version, in a contract 263 bytes under the size limit; all of it in the audit |
| Cut both for phase one (chosen) | The first decision is final; eight open findings stop applying; one line of litmus test 3 is set aside |
| Cut appeals, keep bonds | A bond with nothing to pay: on chain a bond moves only when an appeal overturns a decision |

## D58. Rafa's answers to ADR-0031's open points: the offer's expiry off chain, a zero price allowed, the strict rules, third-party payouts cut with a planned return, a payout address for the seller and a refund address for the buyer

**Decided 2026-11-11 by Rafa,** in the coordinating session, after ADR-0031 first merged with its open points. ADR-0031 stays Proposed and now records each answer; Rafa may overrule any line. Items 1 to 4 change no signed type and no file in `spec/schemas/`. Item 5 does, and gets its own ADR and schema version.

1. **An unfunded offer's expiry is not recorded on chain (SC-6).** Rafa: "I don't think we need to send that message because the expiry date will be hit anyways so it will simply show expired?" Then, on the explanation: "ok for question 1 I agree with your explanation and no ping from our side is necessary."
   - `expireOffer` and the `Expired` stage leave the phase-one contracts. The operators mark an unfunded offer expired by their own clock and send no transaction. `reclaim` still emits `JobExpired`.
   - The fact he asked about: an expired offer cannot be revived. Funding after `offerExpiresAt` reverts whether or not the expiry was recorded. A new expiry date is a new commitment ID and needs three new signatures: the seller's terms, the primary adjudicator's acceptance and the buyer's agreement.
2. **A zero price stays allowed.** Asked "Should we allow a deal with a price of zero?", Rafa: "Yes. There may be other terms and assets related so we need to assume the contract itself can have a zero token value but other considerations like a state from an oracle in the future."
   - The phase-one contracts do not refuse a zero price, and the branches for it stay. A separate task writes their tests. The other refusals of that cut stand: deadlines out of order, `maxSubmissions` other than 1, and an escalation decision window of 0.
   - ADR-0031 had named the refusal as a new limit that D31 does not cover. D31 holds: an amount the encoding can represent is the parties' to choose.
3. **The two stricter rules are agreed.** Rafa: "Question 3: Agree with your strict rules."
   - The acceptance's signed `bondReserved` must be 0 on chain. The plan had recommended leaving it unchecked.
   - The five deadlines are checked in strict order, `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, as `packages/core` checks them.
4. **Payouts to a third address are cut for phase one, with a planned return (SC-3).** Rafa's first reaction: "I do feel like Buyer and Seller should be able to agree to send the funds to any arbitrary address per their contract." The planning session then read the path as low risk, since the same kind of capture pays the adjudicator's fee on every reject, and recommended keeping it. Rafa decided: "Fine cut it for now, but make sure it's in the roadmap. It's very important because they may need to send the funds to another third party as part of the contract. Maybe the better design is that upon contract the seller has one address that is their counterparty and has another address related to receivable, and the receivable address can be changed with both party agreement to an arbitrary address if needed?"
   - A phase-one mutual settlement pays the buyer and the seller only. D23 is deferred, not dropped.
   - The `Paid` event leaves with the feature, under his rule that a cut feature's events go with it (D57).
   - The return is planned work that starts after the phase-one contracts are frozen: funds to a third address by agreement, through a receivable address in the terms that both parties can change. A new field in the terms needs its own ADR and a schema version.
5. **Each party receives its money at an address apart from the address that signs, in phase one.** The seller's side first. Rafa: "The contract Seller (as in agree-er) should not be the same address as the asset payout address. So that does need to get fixed in the contract architecture if it isn't already the case". It is not the case today: the escrow pays the address that signs the terms and the delivery (`HoldbackRules.sol:176`, `:206`).
   - Decided in principle, not designed here. The payout address and the signing address are separate fields in the signed terms, and the address is part of the commit that is frozen and audited.
   - The two may be equal. Asked "Must the seller's two addresses be different, or may they be the same?", Rafa: "They can be different, but can default to the same upon initial set-up if that is easiest for an agent. LIke when you input delivery address and then credit card address". The contract does not refuse equal addresses. When a seller sets no payout address, the reference adapter uses its signing address and says so in one line at start-up; it does not stop.
   - It adds a field to `CommitmentTerms`, so every commitment ID moves. Its own ADR follows, with a schema version, a new EIP-712 domain version and new hash vectors.
   - It softens item 4 at once: a seller that must pay a third party names that party's address as its payout address when it signs. Changing the address after signing, by both parties' agreement, is the part planned for after the freeze.
   - **The buyer gets a refund address too, against the recommendation.** Put to him as "A separate refund address for the buyer. The suggestion is no, not in the first version.", Rafa: "Yes, this should be part of the initial design." So phase one's signed terms carry a payout address for the seller and a refund address for the buyer, each apart from the address that signs; each may equal it, and the tooling defaults to it when none is set.
   - The buyer's side is not designed. Today the escrow refunds its payer, the buyer's signing address (`HoldbackRules.sol:175`), so a refund address changes who is named as payer and may touch the vendored escrow. The same ADR settles it.
6. **A deal must hold at least one base unit, as price or as fee.** A deal with price 0 and fee 0 cannot be funded, because the escrow refuses to hold nothing (`AuthCaptureEscrow.sol:179`), while core funds it today. Told "A deal where nobody pays anything, not even the judge, doesn't need an escrow yet.", Rafa answered: "Agree".
   - It is a stated phase-one limit. The contract is unchanged; core, the prepare routes and the docs are to say the same, so an agent gets a clear answer before funding.
   - Under D31 this refuses only what settlement cannot process. A price of 0 with a fee above 0 stays allowed (item 2).
7. **No scope point is open.** What waits on Rafa is the sentence in `CLAUDE.md` for litmus test 3 (D57), and the design of the two addresses when their ADR is written.

- **Litmus tests.** Neutrality: unchanged by items 1 to 3; item 4 narrows the fifth outcome of `docs/neutrality.md` to a split between the buyer and the seller, as ADR-0031 already recorded; item 5 puts the payout address in the terms every party signs, so no one party can redirect funds. The hold: unchanged; no answer moves funds differently from ADR-0031's record, a zero price keeps the branches the contract has today, and item 5's own ADR tests its design. Defended judgment: untouched.
- **Research pass:** the planning session's read of the fee-slot path and of the zero-price branches, and T-342's read behind ADR-0031.

**Amended 2026-11-11 (item 5, the buyer's side; Rafa may overrule).** What item 5 calls the buyer's refund address is a payment address.
- **Why.** The vendored escrow returns held funds only to the address that funded the hold: its void and the buyer's own reclaim both pay the payer, and only the payer can reclaim (`AuthCaptureEscrow.sol:304-316`, `:323-340`). So phase one cannot refund a buyer at an address that did not pay.
- **Rafa, on that explanation:** "Yes means the buyer gets a signing address and a payment address."
- **Decided in principle.** The phase-one signed terms carry a payment address for the buyer, apart from the address that signs. It funds the hold and receives every refund. It may equal the signing address, and the tooling leaves the two equal by default.
- **Not in phase one:** a refund to an address other than the one that paid. His rule: "If it Coinbase's code can't, then skip and make sure it's in the roadmap". It returns with the planned work on sending funds to a third address (item 4).
- **Still to come:** the design, in the same ADR as the seller's payout address, with a schema version. ADR-0031's section 11 names it and designs nothing.

## D59. The beacon rounds for escalation and fallback leave a margin of 29 s (ADR-0032)

**Proposed 2026-11-11 by T-348,** after a research pass and a red-team pass. ADR-0032 is Proposed; Rafa may overrule any line. It answers finding X-1 of the drand verifier's review (Medium), the fallback's round of the private hardening task T-225, and finding F-2 of the state model. The contract refinement plan's package R8 builds it.

- **One rule for both panels.** The seed comes from `roundAt(lastChoice + BEACON_MARGIN) + 1`: the first drand round after the last moment a choice can still be made, plus a margin fixed at deploy. For an escalation, `lastChoice` is the escalation's block time. For the fallback it is `judgeBy − 1`, the last second a primary's decision can carry.
- **The margin is 29 s on Ethereum mainnet and on Sepolia,** two and a half 12 s slots. The round is published 31 s after a mainnet block's time and 30 s after a Sepolia block's [inferred from drand's published genesis and period and the chains' genesis times; the phases measured on three headers of each chain]. The local chain and SimChain keep 0, so no simulated round moves. Ethereum mainnet is the chain of the mainnet test (Rafa, 2026-11-11, relayed by the coordinating session: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard"); an L2 gets its own margin by the same method.
- **The smallest escalation window that can be decided rises from 13 s to 37 s** on both chains. It stays a stated limit: the operator's prepare route warns below it, and the contract refuses only a window of 0 (D31). A fallback window of 43 s on mainnet, or 44 s on Sepolia, is always decidable.
- **What stays possible.** A validator operator that proposes three slots in a row, and colludes with a party to the deal, can still learn the seed before the escalation is fixed. Such runs come up about 2.8 times a day for an entity with 7.31% of the stake and once in five days at 3% [measured: 7,200 slots a day times the share cubed]. A seller that times its delivery can aim an escalation at one, for one known draw of the panel and then one blind. Accepted for phase one: it needs an operator of that size to collude over one deal and withhold three blocks in public view, the loss is bounded by one deal, and the late blocks are evidence (D26). A threshold of drand's nodes can too, as already recorded. A chain with one sequencer leaves the seed open to that sequencer, which is a question for the choice of an L2.
- **Rafa's call:** the number of slots the margin covers. One slot (17 s, a 25 s window) and three (41 s, a 49 s window) are in ADR-0032's section 4, with the runs per day each leaves.
- **The red team** found no Critical or High issue: 1 Medium, 6 Low, 6 Info, each answered in ADR-0032's section 12. The Medium: the adjudicator service has its own copy of the round rule, which the build must change with the contract and core.
- **Litmus tests.** Neutrality: the block proposer's power over a panel's seed narrows from any proposer to one with three slots in a row; no new actor can stop a deal. The hold: no deadline moves. Defended judgment: strengthened; nobody who chooses when to act can know the panel first.
- **What it changes when built:** `HoldbackRules.sol` (one immutable, one function, two lines of `decide`, one event value), core's `beaconRoundFor`, the adjudicator service's `roundFor`, the live world's wake-up times, and one advisory warning. No signed type and no file in `spec/schemas/`. It needs the redeploy, which is Rafa's.
- **Research pass:** drand's chain info, the consensus specifications' timing constants and fork-choice rule for late blocks, measured block headers, and one `red-teamer` pass (ADR-0032, section 12).

## D60. The signed terms name a payment address for the buyer and a payout address for the seller (ADR-0033)

**Proposed 2026-11-11 by T-350,** after a research pass and a red-team pass. It designs what Rafa decided the same day (D58 item 5 and its amendment). ADR-0033 is Proposed; Rafa may overrule any line. Nothing is built: the contract package and the two tooling packages build from the ADR.

- **Two fields join `CommitmentTerms`,** right after `seller`: `buyerPaymentAddress` and `sellerPayoutAddress`, each an `address`, both required. `buyer` and `seller` stay the addresses that sign. Rafa: "The contract Seller (as in agree-er) should not be the same address as the asset payout address. So that does need to get fixed in the contract architecture if it isn't already the case". For the buyer: "Yes, this should be part of the initial design.", then "Yes means the buyer gets a signing address and a payment address."
- **The contract pays only those two.** The payment address becomes the escrow's payer: it funds the hold and receives every refund (a reject, a reclaim, a default, the fee on an early accept, the buyer's share of a settlement). The payout address becomes the escrow's receiver: it receives the price on an accept and an early accept, and the seller's share of a settlement. A settlement's payouts name those two addresses. A signing address that differs from them receives nothing. One event joins, `SettlementAddresses`, and no existing event changes.
- **The contract compares neither address with anything.** Rafa: "They can be different, but can default to the same upon initial set-up if that is easiest for an agent. LIke when you input delivery address and then credit card address". With none set, the seller adapter, the buyer signer and the prepare routes use the signing address and say so in one line. A zero address, one of the deployment's own contracts or one of the deal's adjudicators gets an advisory warning, never a refusal (D31).
- **The payment address signs the funding and the operator fee, and nothing else.** Each is an ERC-3009 authorization bound to one deal by its nonce, so a payment address cannot be made to fund a deal it did not sign for. The test token accepts a contract wallet's signature [measured by reading `contracts/script/TestUSDC.sol:92`; the test is the contract package's]. The payment address trusts the buyer's signing key with one deal's hold, and no more.
- **A party's own address comes from its own configuration only.** Today the address that is paid is the address that signs, so no author of the terms can redirect a payment. From this change on a substituted field would, so each client rebuilds the terms and refuses another address, and the holder of the payment address rebuilds the funding's nonce before it signs.
- **A per-deal signing key no longer holds funds.** A standing address pays and is refunded, the mandate or the `Delegation` stays on the signing key, and the refund sweep that the buyer signer deferred is no longer needed. Rafa, on the buyer's tooling: "Do all of it now."
- **Left out of phase one:** a refund to an address other than the payer, payouts to a third address in a settlement, and changing the seller's address after signing. Rafa: "If it Coinbase's code can't, then skip and make sure it's in the roadmap". The two fields are enough for all three: each can return as a signed message beside the terms, with new contract code and a redeploy, and without another change to the signed terms.
- **Versions.** Schema v0.11; the EIP-712 domain and `commitment.schemaVersion` move from 0.7 to 0.8. Every commitment ID, signature, hash vector and recording moves once, and the recordings are re-seated with the script ADR-0029 used.
- **The red team** found no Critical or High issue: 2 Medium, 5 Low, 9 Info, each answered in ADR-0033's section 12. The Mediums: on the full protocol an appeal bond stays with the address that signs the appeal, and the adapter's sync of a deal funded or settled by a direct transaction must read the two new addresses, or that deal falls behind the operators' view.
- **Litmus tests.** Neutrality: both addresses are in the terms every party signs, and neither new address can stop a funded deal. The hold: no new transfer in Crow's code; the reclaim on the escrow after its expiry now belongs to the payment address. Defended judgment: untouched.
- **Rafa's open points,** none of which blocks the build: the two names, the new event, whether ADR-0031's schema candidate (`appealWindowSec` of 0) rides in v0.11, the pilot's payment address, and the Sepolia redeploy.
- **Research pass:** T-350's read of the contracts at `5a90dc5`, the vendored escrow at `6b0a5ef` and the test token, and one `red-teamer` pass (ADR-0033, section 12).

## D61. What the mainnet test on Ethereum mainnet requires and costs, the gate of 39 conditions before it, and Base as the recommended L2 for later (ADR-0034)

**Proposed 2026-11-11 by T-351,** after a research pass (`docs/research/2026-11-11-settlement-chain.md`), a reviewer's check of ten facts and a red-team pass. ADR-0034 is Proposed; Rafa may overrule any line. It does not decide which chain comes first: Rafa did. It brings D4 back with numbers, as D4 asked. **Hard rule 1 stands: nothing here deploys anything, and only Rafa changes the rule.**

- **The chain of the test is Ethereum mainnet, by Rafa's decision** of 2026-11-11: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard" (D59). Nothing there blocks the test:
  - no single party can delay a deal: any block proposer can include a step;
  - one deal's three transactions cost about USD 0.21 at the base fee of 2026-11-11, 0.23 gwei, against the earlier estimate of about USD 18.68 (`docs/plan.md`, at 2026-11-05's prices, on Sepolia's gas) [measured: 448,160 gas on the local EVM, the price by read-only call]. At 1% of the price for gas, the smallest deal that makes sense is about USD 20 today and about USD 240 at the month's sampled peak;
  - the EIP-2537 precompiles are live on mainnet since 2025-05-07, and the drand verifier's code returns a real round's value there under the Fusaka fork, at 219,232 gas a transaction [measured by read-only call];
  - native USDC has ERC-3009, and contract signers work.
- **What it costs.**
  - A deal takes about 45 s: three 12 s slots, and no shipped or scheduled fork shortens the slot. **Settling in seconds waits for the L2 step.**
  - The escrow is not on Ethereum mainnet yet [measured at the two published addresses]. Replaying Coinbase's two creation transactions puts its exact code at the same addresses as on Base, so Crow needs no build of its own [measured by a read-only call; the runtime match is inferred].
  - Sepolia has run the next fork since 2026-10-06 and mainnet has no date for it, so Sepolia's gas and slot timing do not carry.
  - A public mempool: a pending accept shows the buyer its key before the payment lands, and a stranger can wrap a copied step so that the operators lose sight of a deal. The gate has a line for each.
- **For the later L2 step, Base is recommended and Arbitrum One is the runner-up.** The choice stays Rafa's.
  - It makes a block every 200 ms since 2026-11-05 [documented and measured].
  - Its fee is about USD 0.006 a deal [measured].
  - It alone has the audited escrow deployed and in use: `AuthCaptureEscrow` version 1.1.0 at `0xf96815976523E00e65Be8f34cA5e64b4f41EB19c`, whose verified source equals the vendored file byte for byte [measured]. The address in the vendored README, `0xBdEA…0cff`, is version 1.0.0 and must not be used.
  - Its costs: one sequencer, whose first confirmation is its own word and whose censored step can stay unresolved for up to 12 hours, two halts in June 2026, upgrades with no delay, one node client, and block times that lagged real time by about two hours after a halt.
- **The verifier is not a constraint.** Its code passes on Ethereum, Base, Arbitrum One, OP Mainnet, Unichain, Monad, Linea and Arc, and refuses on Polygon PoS and Avalanche C-Chain [measured]. The on-chain beacon proof stays (ADR-0031 had left it to the choice of chain).
- **The gate, written for Ethereum mainnet.** 39 conditions in six groups: the rule and the switch, the chain, the contracts, the operators, outside the code, and one for the L2 step. Each names who checks it and how. Five came from the red team: the accept's timing, no verdict from a scripted judge, every outcome on a mainnet fork against real USDC, how the test ends, and mainnet keys kept apart from development sessions. Its inputs are the pilot plan's thirteen conditions, the verifier review's G-1 to G-10 and ADR-0032's BR-1 to BR-10.
- **What Rafa would change to lift the rule:** the sentence in `CLAUDE.md`, its row in `docs/team.md`, then the guards in code by a reviewed pull request, his written approval per deploy, and the money itself from keys he holds.
- **Open points for later, each with a recommendation; none waits on Rafa now.** Rafa, 2026-11-11: "We can deal with this later, as we need to first finalize all the testnet work and align the entire product components to the new contract set."
  - The cap: 100.00 USDC a deal and 500.00 USDC outstanding in total. The contract has no cap, so it holds only through the relayers, the adjudicators' acceptance and the balance of the test's wallets.
  - The conditions a capped test needs: 31 in full, 5 in a reduced form, 2 as Rafa's call (how independent the roles are, and legal advice), 1 not applicable.
  - Whether the beacon's margin covers two slots (ADR-0032).
  - The change to hard rule 1: keep the rule and add one exception that names the chain ID, the token, the cap and what ends it.
  - The L2, and a Base Sepolia deployment to measure it once the testnet work is aligned.
- **The reviewer** confirmed nine of ten facts it chose and found one wrong, a fallback deal's gas (698,528 gas, not 562,648), now corrected. **The red team** found no Critical issue: 6 High, 9 Medium, 8 Low, 2 Info, each answered in ADR-0034's section 13. Its Highs: the pending accept, the wrapped step, a cap that held only in the relayers, the escrow replay, a path for a session to deploy, and no gate line on the judgment.
- **Litmus tests.** Neutrality: Ethereum adds no chain actor; real USDC makes the issuer a live actor, and on an L2 the sequencer becomes a named control point before the chain is used. The hold: the gate proves which escrow code holds the money; a pending accept that shows the key is a new, stated residual. Defended judgment: the on-chain proof stays, and the gate forbids a verdict from a scripted judge; on an L2 the beacon's margin does not bind the sequencer, which is stated.
- **Research pass:** seven `web-fetch` lookups of published sources and read-only calls to public RPC endpoints on 2026-11-11; no transaction was sent.

## D62. Rafa's answers to ADR-0033's open points: the field names are final, the new event stays, and schema v0.11 allows an appeal window of 0 that phase one requires

**Decided 2026-11-11 and 2026-11-12 by Rafa,** in the coordinating session. After a walk-through of the first three open points of ADR-0033 (D60) he said: "Accept all three". Two of the three were put to him as the ADR states them, and they are decided by those words. The third was put to him the wrong way round, so it was asked again, and he decided it on 2026-11-12: "Yes, contract too". ADR-0033 stays Proposed and records each; Rafa may overrule any line.

1. **The field names are final:** `buyerPaymentAddress` and `sellerPayoutAddress`. He was told that a rename after the contract package merges would be another change to the signed terms.
2. **The new event stays:** `SettlementAddresses`, emitted once per deal when it is funded. His standing rule is that events are kept, for tracing, telemetry and monitoring. He was given the cost, about 1,900 gas per deal [inferred from the gas schedule; the contract package measures].
3. **Schema v0.11 allows `timing.appealWindowSec` of 0, and a phase-one deployment refuses any other value: in the contract, in core and in the prepare routes.** This is the candidate ADR-0031 section 8 point 3 left for the next schema version. Phase one has no party appeal, so a window above 0 states a promise nothing honours.
   - **How it was decided.** On 2026-11-11 he was asked the reverse: "Refusing an appeal window of zero ... the format could refuse it." The schema already refuses zero (`spec/schemas/commitment.schema.json:307-310`, `minimum: 1`), so that answer decided nothing. On 2026-11-12 the coordinating session gave him the candidate as ADR-0031 writes it and the choice of where to enforce it: the contract, core and the prepare routes, or core and the prepare routes only. Rafa: "Yes, contract too".
   - **Why the contract too.** ADR-0031's reason for `bondReserved`: terms the contract takes and core refuses would leave a deal sent straight to the contract behind the operators' view.
   - **D31.** The deployment refuses only a value it cannot honour, as it refuses `maxSubmissions` other than 1. SimChain's full protocol keeps appeals and each club's own minimum window.
   - **Order of the build.** The contract cannot require 0 while the schema still requires at least 1, so the contract's check lands in the same change as v0.11, not before it. The club rulebook's own minimum for this window is at least 1 today (`spec/schemas/club.schema.json:85-88`), and the building task settles that in the same version (ADR-0033 section 2b).
   - **It amends** ADR-0031 section 8 point 3: from v0.11 the field is enforced on a phase-one deployment, as 0, and no longer "signed, not read".

- **Still open, and his:** which address is the pilot's payment address, and the Sepolia redeploy. Neither blocks the contract package.
- **Litmus tests.** Unchanged from D60: no answer here moves funds or changes who signs. Point 3 makes the signed terms of a phase-one deal say what the deployment does.

## D63. The beacon margin of 29 s stands on Ethereum mainnet and on Sepolia (ADR-0032)

**Decided 2026-11-12 by Rafa,** in the coordinating session, relayed to T-348. It answers the one point D59 left to him: how many slots the margin covers. The coordinating session recommended keeping 29 s, two and a half slots, and he answered: "that is OK as long as there's a valid reason". ADR-0032 stays Proposed and records the answer in its section 4; Rafa may overrule any line.

- **The margin:** `BEACON_MARGIN` is 29 s on Ethereum mainnet and on Sepolia, for the escalation's round and the fallback's. The smallest escalation window that can be decided stays 37 s.
- **The reason, in two sentences.** With two slots of margin, learning the round before committing takes a validator operator that proposes three slots in a row and colludes with a party to that deal: about 2.8 such runs a day at 7.31% of the stake. One slot would need only two in a row, about 38 runs a day at the same share; three slots would need four, about 0.2 runs a day, and would raise the smallest decidable escalation window from 37 s to 49 s for every deal.
- **The numbers** are ADR-0032's [measured: 7,200 slots a day times the stake share raised to the run's length; the 7.31% is the largest single custodian on one dashboard, read 2026-11-11].
- **What does not change:** the rule, the gate lines and the residuals of ADR-0032. Gate line BR-6 still measures the runs on mainnet before a deploy there, and the margin can be raised then, before the deploy fixes it.
- **Litmus tests.** Unchanged from D59.

## D65. A deal is judged under the policy it bound, on every later build (ADR-0036)

**Proposed 2026-11-12 by T-373,** after T-367 (PR 386) found that an operator deploy that changes the screen leaves a deal accepted before it without a judge. ADR-0036 is Proposed; Rafa may overrule any line. Nothing is built.

- **The finding holds** [measured: a scratch test at `e1e8df2`, run and not committed]. After such a deploy the primary, the fallback and the appeal adjudicator each refuse the deal with `policy_mismatch`, no judge is called, and the deal ends Refunded through its default outcome. A change of either template, of the aggregation version or of the judge registry does the same. A rollback does it in reverse.
- **What a build keeps.** Every screen version, template pair, aggregation version and registry a released build ever registered, selected by the deal's bound policy. It accepts only its current default as primary. Retiring a version is a reviewed change that shows no open deal binds it.
- **A version with a known weakness.** The adjudicator still judges an open deal under its bound policy (D28). It withdraws a version only when running it would break a hard rule or endanger the adjudicator itself; it then declines in public at once and never substitutes another version.
- **Who carries which version.** The primary carries every policy it signed an acceptance for; a fallback or appeal adjudicator carries what it said it would take. Crow's three ship in one build.
- **The deploy guard.** `pnpm demo-cloud:deploy` refuses a deploy after which an open deal the live build can judge could not be judged, with one override for a recorded withdrawal. A new version ships in two deploys: carried first, the default later, so a rollback is always safe.
- **A deal the build cannot judge.** The public state read names the adjudicator, the reason, what follows and when, from the first pass and for the primary too.
- **The proof.** The fixture `neutrality.deploy-changes-policy`, and `neutrality.deploy-changes-registry`.
- **Litmus tests.** Neutrality: it closes a gap; a deploy no longer removes an open deal's judges, and the maintainers' row in `docs/neutrality.md` becomes true for the judging code. The hold: unchanged. Defended judgment: models stay pinned by the bound registry, nothing is re-rolled, and a decision's `policyHash` is the policy that ran.
- **What it changes when built:** `packages/judgment`, `apps/adjudicator`, `packages/testkit`, `apps/demo-cloud` and `scripts/deploy-lib.mjs`. No contract, schema, signed type or API route.
- **Until then:** a deploy that changes a version or a registry goes out only when no open deal binds the outgoing policy. PR 386's deploy is the first.
