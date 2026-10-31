# Review: Holdback against escrow theory and incumbent practice

Date: October 30, 2026. Reviewer: architecture review (Fable), read-only. Requested by Rafa: check the architecture against escrow theory and current manual and bank solutions, so Holdback mirrors proven practice and improves on it with machine-speed automation, neutrality and privacy best practice.

## Scope and method

- Read at `main` 34fdea5: `CLAUDE.md`, `docs/*.md`, ADR-0001 to ADR-0022, `docs/decisions-today.md` (D1 to D19), `spec/schemas`, `packages/core/src/state.ts`, `docs/research/prior-art.md`. Also the unmerged schema v0.5 branch (`origin/d-schema-v0.5`). ADR-0019 (mutual settlement) and ADR-0020 (privacy) merged while this review ran; the review reads the merged text. The open question "can either party trigger adjudicator review" was decided as D19 during the review and is treated as decided.
- Sources were fetched on October 30, 2026. Labels follow `docs/research/prior-art.md`: **measured** (the primary text or repo file was read), **inferred** (derived, or cited from a search snippet or memory where a host refused automated fetch), **guessed** (weak evidence). The source list gives each source's status.

## 1. Executive summary

**Where Holdback mirrors established practice well** (measured unless noted):

- The hold is a textbook escrow: a third party holds money until a specified event or a prescribed condition (California Financial Code §17003). Holdback's third party is a rules contract with no discretion and no admin keys (ADR-0002, ADR-0003).
- Deterministic checks are the letter-of-credit idea of documentary compliance: a closed set of declarative tests, decided before any judgment (UCP 600 Art. 14; `commitment.schema.json`, `DeterministicCheck`, seven types).
- Mutual settlement (ADR-0019) is the joint written instruction that is the standard release path in bank and M&A escrow, and the 2-of-3 of crypto escrow.
- The two-sided hold is delivery versus payment for digital work (PFMI Principle 12; ADR-0012), in the line of optimistic fair exchange (Asokan, Shoup and Waidner).
- Bonded adjudicators, a bonded appeal to a different adjudicator and a default outcome paid from bonds mirror surety practice and arbitration, with a liveness guarantee incumbents lack.
- ADR-0020 mirrors bank secrecy, need-to-know disclosure and view-key audit, without the freeze banks have.

**Where it improves.** Speed (seconds against inspection and dispute windows of days to months), neutrality (no party holds or redirects the funds, where Escrow.com holds them and Stripe offers no escrow), a pinned cross-family panel instead of one evaluator address or a human case manager, and capital behind every decision. Section 4 gives the comparisons and their limits.

**Where it deviates with risk.**

1. "Final" means something different in each settlement mode and is nowhere defined as a property agents can read (F1).
2. Fees do not follow the event: an overturned adjudicator keeps its fee and a winning appellant still pays the appeal fee (F3).
3. The adjudicator judges the goods, not documents. That inverts the letter-of-credit independence principle, and it is the root of plaintext exposure (residual 6) and of 100% capital per commitment (F2).
4. Phase 1 admits only the `public` disclosure level, so the demo shows the model ADR-0020 was written to replace (F4).

**What is missing that incumbents treat as essential.** A retention and erasure rule (BSA five years against GDPR storage limitation), a named reporting entity and a stated posture for the open rulebook (F4), a published statement of holdings and a scheduled reconciliation (F6, F7), and any recourse for the agent's principal once the agent has signed (F8). None breaks a litmus test. Each is a decision or a fix in section 5.

## 2. Mapping table

| Established concept or practice | Holdback equivalent | Status | Evidence |
| --- | --- | --- | --- |
| Escrow: a third party holds until a condition is met (Cal. Fin. Code §17003) | Rules contract or SimChain holds price plus fee until decision, consent or timeout (ADR-0002, ADR-0003; `state.ts`) | Mirrors | measured |
| Escrow agent acts only on instructions and answers for negligence (SEC exhibit §1.4(e)) | Rules contract acts only on decision, consent or timeout; adjudicator answers through its bond (ADR-0007) | Improves | measured |
| Trust account kept separate from the agent's funds (§17409); PFMI P14, P16 | One `TokenStore` per rules contract with per-payment accounting; separate bond escrow; tranches (prior-art Q1; ADR-0014) | Partial | measured |
| Joint written instructions as the release path (exhibit §1.4(c)); negotiation first (Escrow.com; ODR para 19) | `MutualSettlement`, co-signed, any split, any funded undecided state (ADR-0019) | Mirrors | measured |
| Interpleader when parties disagree (FRCP 22; 28 U.S.C. §1335; exhibit §1.4(d)) | No stall: the adjudicator decides; the default outcome refunds the buyer and pays the seller from bonds (ADR-0007, D5) | Deviates; better liveness | measured |
| Indemnity escrow and earn-out: funds held against later claims over months (M&A; median escrow about 10% of deal value) | Single-shot commitment; no milestones or partial delivery until v0.2 (`todo.milestone-delivery`) | Missing (planned) | measured; M&A figure inferred |
| Inspection period and tacit acceptance (Escrow.com 1 to 30 days; Upwork 14 days) | `optimistic` mode with `disputeBy` and tacit acceptance; `EarlyAccept` (ADR-0015) | Mirrors | measured; Upwork inferred |
| Documentary compliance: banks deal with documents, not goods (UCP 600 Art. 5, 14) | Deterministic checks, seven declarative types; a required failure rejects without a panel (ADR-0006) | Mirrors the checks; deviates on independence | measured |
| Examination limit of five banking days (UCP 600 Art. 14(b)) | `judgeBy`, `fallbackBy`; demo defaults 120 s each (architecture.md:252-258) | Improves | measured |
| One notice of refusal listing each discrepancy (UCP 600 Art. 16(c)) | One signed judgment record with per-check results and `aggregate.reasons` (`judgment.schema.json`) | Mirrors | measured |
| Waiver of discrepancies by the applicant (UCP 600 Art. 16(b)) | None: a required check failure refunds at once; `maxSubmissions = 1` (`state.ts:244`) | Missing | measured; Art. 16(b) inferred |
| DvP: one leg settles if and only if the other does (PFMI P12) | Content key released in the same step as payment in guaranteed mode (ADR-0012) | Mirrors | measured |
| Settlement finality: define the point; irrevocable and unconditional (PFMI P8) | Per mode: at decision, at window close, at `disputeBy`; not stated or exposed (F1) | Partial | measured |
| Participant-default rules and loss waterfall (PFMI P13) | 100% coverage gate, encumbrance, junior then senior (ADR-0007; ADR-0014 §2a) | Mirrors | measured |
| Operational risk; resume within two hours (PFMI P17) | Deadlines, fallback, default; windows sized for forced inclusion; no recovery objective | Partial | measured |
| Public disclosure of rules (PFMI P23) | Rulebook, policy and registry hashes bound; `GET /v1/clubs/{id}`, `/v1/adjudicators` (ADR-0016, ADR-0017) | Improves | measured |
| Performance bond; surety investigates both sides; principal indemnifies (40 U.S.C. §3131; surety practice) | Bond pays the wronged party; appeal adjudicator investigates; junior tranche is first loss (ADR-0007, ADR-0014) | Mirrors | measured; surety page is vendor text |
| Costs borne in principle by the unsuccessful party (UNCITRAL Art. 42(1)) | Appeal bond returned on overturn; fees are not (architecture.md:199-207) | Deviates | measured |
| Appointment and challenge of arbitrators (UNCITRAL Art. 8, 12, 13) | Parties name three adjudicators; primary accepts before funding; affiliation self-declared; no challenge after agreement | Partial | measured |
| Interim measures (UNCITRAL Art. 26) | None; the hold is the interim measure; no freeze by design (ADR-0001) | Deviates by design | inferred |
| ODR stages: negotiation, facilitated settlement, final stage (ODR paras 18 to 21) | Mutual settlement, then adjudication; no facilitated stage | Partial | measured |
| Chargeback: issuer-side recourse, consumer-dispute category (Visa Category 13) | Party appeal within `appealWindowSec`; nothing after `appealDecideBy`; principal has no standing | Missing by design | measured |
| Platform holds (Stripe: no escrow; PayPal up to 21 days) | Custody on a neutral settlement layer; rails only as ramps (ADR-0002) | Improves | measured; PayPal inferred |
| Bank secrecy, GLBA notices, SAR confidentiality, PCI scope reduction | Public skeleton, private body, disclosure as a signed term, view keys (ADR-0020); Phase 1 `public` only | Mirrors in design; Phase 1 deviates | measured |
| KYC and Travel Rule at transfer (31 CFR 1010.410(f), $3,000) | Non-goal in v0.1 (PRD:73); edges are clubs and ramps (ADR-0020 §6) | Missing, deferred | measured |
| Record retention of five years (31 CFR 1010.430(d)); GDPR erasure (Art. 17) | Hash-chained log; no retention or erasure rule | Missing | measured |
| 2-of-3 crypto escrow; Kleros settlement proposals | ADR-0019: the parties agree, or the third key decides | Mirrors | measured |
| Optimistic oracle: proposer and disputer bonds, liveness window (UMA) | `optimistic` mode dispute bond and `disputeBy` (ADR-0015) | Mirrors | measured |
| Single evaluator, no dispute resolution (ERC-8183) | Panel, fallback, appeal, default | Improves | measured |
| Operator-controlled capture; payer reclaim after expiry (Commerce Payments Protocol) | Rules contract as operator; permissionless timeouts (ADR-0003) | Improves | measured |

## 3. Findings by severity

Each finding gives the practice and its source, what Holdback does, the gap or risk, a recommendation, and whether it needs a decision or is a fix.

### F1. High. "Final" is undefined as a property agents can read

- **Practice.** PFMI Principle 8 asks an FMI to define clearly the point at which settlement is final, and treats a payment as final when it is irrevocable and unconditional (measured, PFMI text). Card capture is not final for the merchant until the dispute window closes (Visa categories measured; the time limit inferred).
- **Holdback.** In `guaranteed_on_decision` the decision moves the money, and an overturn moves bond money, not escrow money (architecture.md, Commitment state machine; postings at 205-206). `Released` is therefore irrevocable for the seller at the decision, and a wronged buyer is made whole from the bond. In `settle_after_window` funds move at window close. In `optimistic` mode release is final at `disputeBy`, after which no adjudicator call is possible (ADR-0015 §3). Early acceptance and mutual settlement are final at once. A `Released` state carries an `appeal` sub-state until `appealBy` (`state.ts:288-295`), and no schema field says when a state became irrevocable.
- **Gap.** The design is sound: finality with indemnity, as a card network lets the merchant keep funds while the issuer pays. But nothing names it. An SDK consumer that reads `appeal: none, appealBy: ...` on a `Released` commitment may treat the payment as reversible. In Phase 2 "final" also depends on chain inclusion (`holding` then `held`, NFR-2), which the docs do not tie to the mode.
- **Recommendation.** Add a Finality section to `docs/architecture.md` with a per-mode table: escrow finality point, adjudicator liability window, key finality, chain inclusion. Expose `finalAt` and `contestableUntil` on `commitment-state` and receipts. State it on the demo's closing slide.
- **Decision.** Schema change: candidate D-item, an ADR amending ADR-0007 and ADR-0015 with schema v0.6.

### F2. High. Judging the goods inverts the independence principle

- **Practice.** UCP 600 Art. 4(a) makes a credit a separate transaction from the sale it finances. Art. 5: "Banks deal with documents and not with goods, services or performance." Art. 14(b) gives a bank at most five banking days after presentation (measured, ICC library text). Strict compliance keeps the bank's risk small and its fee low.
- **Holdback.** Deterministic checks are the documents. Everything the checks cannot decide goes to a panel that reads the plaintext (architecture.md:139-153; ADR-0012). That is why residual 6 exists, why each guaranteed commitment encumbers 100% of price (ADR-0007), and why the panel needs injection defenses at all.
- **Gap.** A choice, not a flaw: unverifiable work needs someone to look at it, and incumbents hand that to humans over weeks. The risk is that the tradeoff is unstated, so the demo audience hears "neutral escrow" and later learns an adjudicator read the data. Confidentiality is uncompensated: no bond claim covers a leak.
- **Recommendation.** State in the PRD that Holdback deliberately inverts the independence principle, and that checkability pricing (ADR-0014 §3) prices it. Put confidential-compute execution of deterministic checks on the Phase 3 or later plan, so checks-only commitments (empty rubric) can settle without any party reading plaintext; that restores the letter-of-credit model for the strongest tier. ADR-0020's `policy.providerPrivacy` already covers the model side.
- **Decision.** Plan and doc fix now; a later ADR for confidential checks.

### F3. High. Fees do not follow the event

- **Practice.** UNCITRAL Arbitration Rules Art. 42(1): costs are in principle borne by the unsuccessful party, with discretion to apportion (measured). The SEC escrow exhibit makes the loser of an interpleader pay the agent's costs (measured). Escrow.com makes the parties pay the arbitrator (measured).
- **Holdback.** Postings (architecture.md:199-207, measured): the first-instance fee goes to the deciding adjudicator on release and on refund; on overturn only the price moves from the bond and the appeal bond returns; the appeal fee goes to the appeal adjudicator in every case; an upheld appeal forfeits the appellant's bond to the adjudicator.
- **Gap.** A wronged party is made whole for price but not for the two fees. An overturned adjudicator keeps the fee it earned by being wrong, which blunts ADR-0014's quality incentive. A correct appeal is never free, so a careless adjudicator can impose a cost on the party it wronged.
- **Recommendation.** On overturn, debit the overturned adjudicator's pool for the first-instance fee and the appeal fee and credit the appellant (two postings, junior first, rounding per ADR-0022). Leave uphold and default as they are; the default already returns the fee to the buyer (line 208).
- **Decision.** Fix within the ADR-0007 and ADR-0014 postings and T-006. No schema change. Rafa should sign off, because it changes incentives.

### F4. Medium-high. Privacy and compliance: what ADR-0020 leaves open

- **Practice.** Bank records stay private and are disclosed on need to know: GLBA notice and opt-out; SAR confidentiality (31 CFR 1020.320(e)); PCI tokenization, which keeps card numbers out of scope; five-year retention (31 CFR 1010.430(d)); and the Travel Rule, which moves originator and beneficiary data between institutions for transfers of $3,000 or more, never publicly (31 CFR 1010.410(f)). All measured; FATF Recommendation 16 for VASPs inferred. GDPR adds data minimisation, storage limitation and erasure (Art. 5(1)(c), 5(1)(e), 17, measured). The EPRS study on blockchain and GDPR calls "immutable" misleading and treats erasure against append-only storage as the central tension (measured).
- **Holdback.** ADR-0020 adopts a public skeleton, a private body under per-commitment record keys, keys only on takeover, disclosure as a signed term with a rulebook minimum, aggregate signals for backers, view keys for auditors, and compliance at the edges without a freeze (measured). This mirrors the bank pattern well and improves on it by removing the freeze.
- **Gaps (measured absences).** (a) Phase 1 admits `public` only, so the demo shows full disclosure. (b) No retention or erasure rule exists for off-chain bodies, judgment records or operator indexes; "retention" appears only as provider zero data retention. (c) The reporting entity is undefined: ADR-0020 §6 says a club operator or an operator node files the reports it owes, but operators are permissionless relays with no identity data, and the open rulebook (FR-4) has no admitting institution. A commitment under the open rulebook, funded directly in stablecoin, has no KYC edge at all. (d) The skeleton still publishes price, payout addresses and the three adjudicators (residual 9), and amounts stay public on an EVM chain (ADR-0020 §8).
- **Recommendation.** Amend ADR-0020: a rulebook `retention` for bodies and records (default five years, mirroring the BSA) with an erasure procedure that deletes off-chain plaintext and keeps hashes; name the admitting club as the reporting entity, and state that the open rulebook has none and relies on ramp and token edges only; decide whether Phase 1 admits `judgment` so the demo can show the privacy model; schedule bucketed amounts.
- **Decision.** D16 amendment (ADR-0020). The open-rulebook statement is a doc fix in `docs/neutrality.md`.

### F5. Medium. No interpleader, by design; the default outcome is capped

- **Practice.** When the parties disagree and no joint instruction arrives, the escrow agent interpleads them and deposits the funds with a court (FRCP 22; 28 U.S.C. §1335; exhibit §1.4(d)). Escrow.com gives 14 days of negotiation, then arbitration, and may cancel and refund the buyer if no arbitration starts. All measured.
- **Holdback.** It never stalls. The adjudicator decides; if none decides, anyone triggers the default: refund the buyer and compensate the seller from the defaulting adjudicators' bonds, up to the bond (ADR-0007, D5; postings 208-209; `state.ts:423-427`). In optimistic mode the default is release (ADR-0015 §4).
- **Gap.** Liveness beats interpleader, and the cost falls on the adjudicators who failed, not on the parties. But compensation is capped by bonds that the fallback and appeal adjudicators reserve only on takeover (ADR-0016 §1), so a shortfall is possible, and no fixture records it.
- **Recommendation.** Add `todo.default-bond-shortfall`; write "no interpleader" into `docs/neutrality.md` as a deliberate choice; keep mutual settlement as the party-driven exit before default.
- **Decision.** Fix only.

### F6. Medium. Segregation is by accounting, not by account

- **Practice.** California escrow money sits in a designated trust account kept separate, distinct and apart from the agent's funds (§17409, measured). PFMI P16 asks an FMI to safeguard participants' assets and to minimise delay in access (measured).
- **Holdback.** All holds under one rules contract pool into one `TokenStore` with per-payment accounting (prior-art.md Q1, measured). Bonds live in a separate bond escrow (ADR-0003). Backer stakes pool per adjudicator in junior and senior tranches with a reserved counter (ADR-0014 §2a). Invariants: conservation, no negative balances, settle-once, encumbrance never counted twice, rounding never creates a unit (architecture.md, Hold and settlement postings).
- **Gap.** Code-enforced segregation is stronger than a trust designation in one way (no agent can commingle) and weaker in another (one contract bug exposes every hold). No per-escrow or per-pool statement is published for backers or examiners.
- **Recommendation.** Document "segregation by accounting"; add Foundry invariants in T-203; publish a per-pool statement on `GET /v1/adjudicators/{address}` (tranche balances are already planned in the v0.5 API doc); consider per-club rules-contract deployments as a blast-radius option.
- **Decision.** Fix; per-club deployment is a later option.

### F7. Medium. Reconciliation and audit are tools, not duties

- **Practice.** Regulated custodians reconcile client money daily (FCA CASS 7, inferred; the page is not machine-readable) and disclose their rules and basic data (PFMI P23, measured). Licensed escrow agents file audit reports (Cal. Fin. Code, cited in ADR-0020).
- **Holdback.** A hash-chained log, operator receipts, `pnpm replay` that rebuilds state and checks it against the settlement layer (architecture.md:245-250), `GET /v1/audit/verify` (api.md:70), head lag in `/v1/status` (ADR-0017 §6), and property tests on conservation. Good building blocks.
- **Gap.** Replay is a developer command. No operator publishes a signed reconciliation, no ramp reconciliation (fiat in against tokens minted) is planned for Phase 5, and there is no retention rule (F4).
- **Recommendation.** Make replay a periodic operator job that emits a signed attestation (head sequence and hash, totals by account class). Add a Phase 5 fixture that reconciles on-ramp receipts with minted tokens.
- **Decision.** Fix (T-007, Phase 5).

### F8. Medium. The agent's principal has no recourse once the agent signs

- **Practice.** Consumer rails give the human a channel after the fact: Visa consumer disputes (Category 13, measured); Amazon's A-to-z claim after contacting the seller and waiting 48 hours, within 90 days of the last possible delivery date (measured); eBay's 30-day window with step-in after 3 business days (measured); Upwork's 14-day review before automatic release (inferred).
- **Holdback.** The agent is the party. The mandate is the standing approval, and per-payment approval was rejected (ADR-0017, Not adopted). Appeals, disputes and settlements are signed by the party address (`appeal.schema.json`; `state.ts:325-327`). Windows are short by design. After `appealDecideBy` nothing reopens (residual 7).
- **Gap.** If an agent key is compromised, or an agent is wrong within scope, the principal can revoke future commitments (FR-3) but cannot appeal, dispute, settle or accept on a live one. Scope caps bound the loss (T13); they give no recourse.
- **Recommendation.** Give the mandate signer standing: the principal may sign `Appeal`, `Dispute`, `MutualSettlement` and `EarlyAccept` for its agent, verified against the mandate. Keep windows as party choices. State plainly that Holdback has no post-finality chargeback.
- **Decision.** Candidate D-item (message schemas).

### F9. Medium-low. The bond is a surety with a narrow claim list

- **Practice.** Public works above $100,000 need performance and payment bonds (40 U.S.C. §3131, measured). A surety investigates a claim on documentation from both claimant and principal, and the principal must reimburse the surety (measured, vendor page).
- **Holdback.** The adjudicator's bond pays the wronged party on overturn and the seller on default; the appeal adjudicator is the investigator; the junior tranche is the principal's indemnity and backers are reinsurers (ADR-0007, ADR-0014 §2a). This mirrors surety well.
- **Gap.** Claims exist only for wrong outcome, missing or wrong key, policy or panel violation and mislabeled model (architecture.md, Appeal row). A plaintext leak (residual 6) or a decision that is late but not missed has no claim. The penal sum is the price; fees and consequential loss are excluded, and this is not stated.
- **Recommendation.** Name the penal sum and the excluded harms in `docs/architecture.md`; keep the claim list closed.
- **Decision.** Doc fix.

### F10. Low-medium. Appointment, challenge and the missing middle stage

- **Practice.** UNCITRAL Rules: a list procedure for appointment (Art. 8), challenge for justifiable doubts within 15 days (Art. 12, 13), interim measures (Art. 26), final and binding awards (Art. 34(2)), equal cost deposits (Art. 43). ODR Technical Notes: negotiation, facilitated settlement, then a final stage (paras 18 to 21), under fairness, transparency, due process and accountability (para 7). All measured.
- **Holdback.** Parties name three adjudicators at agreement and the primary accepts before funding (ADR-0016 §1); affiliation is self-declared (ADR-0007); the hold pre-funds fees, like Art. 43 deposits; appeal decisions are final (residual 7); D19 settles who may call. There is no challenge after agreement and no facilitated-settlement stage.
- **Gap.** An adjudicator that becomes affiliated or compromised after agreement cannot be challenged, only appealed. Parties who disagree go straight from negotiation to a binding panel.
- **Recommendation.** After Phase 1, consider a party-signed `AdjudicatorChallenge` before `judgeBy` that routes to the fallback at the challenger's cost, alongside D19's `consentWindowSec`, and an adjudicator policy option to publish a non-binding proposal before deciding.
- **Decision.** Candidate ADRs after Phase 1.

### F11. Low. No waiver of discrepancies

- **Practice.** Under UCP 600 Art. 16(b) an issuing bank may ask the applicant to waive discrepancies before refusing (inferred; Art. 16(c) measured).
- **Holdback.** A required check failure refunds at once in guaranteed mode and `maxSubmissions = 1` (`state.ts:244`). Mutual settlement is allowed in `Delivered`, but a deterministic reject executes before any party can act.
- **Recommendation.** A rulebook `waiverWindowSec` (default 0) during which a deterministic reject is held for a buyer `EarlyAccept` or a `MutualSettlement`. Or rely on resubmission with `settle_after_window` in Phase 4.
- **Decision.** Candidate rulebook option; ADR-0019 amendment.

### F12. Low. Operational risk has deadlines but no recovery objective

- **Practice.** PFMI P17 expects an FMI to resume operations within two hours of a disruptive event (measured).
- **Holdback.** Every step has a deadline and an anyone-callable fallback or default; windows are sized for forced inclusion (architecture.md:252-258); missed deadlines are a public signal (ADR-0014 §1).
- **Recommendation.** Publish p95 decision latency and missed-deadline rate in adjudicator discovery (api.md:58 already lists public quality signals), and give window-sizing guidance per chain in Phase 2.
- **Decision.** Fix.

## 4. What Holdback improves on incumbents, with honest limits

- **Speed.** Milliseconds on SimChain, against Escrow.com's 1 to 30 day inspection period plus two 14-day dispute stages (measured), Upwork's 14-day review (inferred), eBay's 30 days and Amazon's 90 (measured). Limit: Phase 2 speed is bounded by chain inclusion and forced-inclusion margins; the demo's 120-second windows are rulebook minimums, not physics.
- **Neutrality.** No actor can stop or redirect settlement, and each actor has a fixture. Escrow.com holds the funds and may cancel and refund; Stripe's manual-payouts page says it supports neither escrow services nor escrow accounts (ADR-0002 cites the English wording); the Commerce Payments Protocol operator alone decides capture (all measured). Limit: residuals 1 to 11, including collusion bounded only by coverage and appeal, and legal process.
- **Defended multi-model judgment.** Pinned models from two families, commit-reveal or beacon seeds, a bound policy and registry, injection defenses, against one evaluator address (ERC-8183) or human case managers. Limit: model identity is self-reported (residual 8); calibration is unmeasured until Phase 3; the panel reads plaintext (F2).
- **Two-sided hold.** Delivery versus payment for digital work; no incumbent holds the work. Limit: atomic only in guaranteed mode; a wrong key is an appeal ground, not a contract check (ADR-0012).
- **Capital behind judgment.** The wronged party is paid from the adjudicator's bond, with junior first loss and permissionless backers; escrow agents answer only for negligence and arbitration costs fall on the parties. Limit: no loss data (PRD assumption 4); 100% coverage is capital-heavy; backers arrive in Phase 4; fees do not yet follow the event (F3).
- **Economics.** The hold removes holdup on both sides: the buyer cannot keep delivered work and refuse to pay, and the seller cannot keep payment and refuse to deliver. Bonds are hostages against adjudicator moral hazard in Williamson's sense (inferred; `docs/research/notes/theory_law.md` lists the source as unverified). Adverse selection among adjudicators is met by fees priced from measured error and audit sampling (ADR-0014), and among sellers by deterministic checks and the per-attempt fee. Limit: those measurements do not exist yet.
- **Consent first.** Mutual settlement and early acceptance put the parties' agreement before the neutral party, as Kleros, Bitcoin 2-of-3 escrow and the ODR notes do (measured).

## 5. Recommended next decisions and fixes, in order

1. **Fix F3** (fees follow the event) in the postings, ADR-0007 and ADR-0014, before T-006 hard-codes them. Needs Rafa's sign-off on incentives.
2. **Decide F1** (finality per mode; `finalAt` and `contestableUntil`): one ADR amending ADR-0007 and ADR-0015, schema v0.6. Cheap now, expensive after T-007.
3. **Amend ADR-0020** (F4): retention and erasure, the reporting entity, the open-rulebook posture, and whether Phase 1 admits `judgment`.
4. **Decide F8** (principal standing on appeals, disputes, settlements and early acceptance).
5. **Doc fixes** for F2, F5, F6, F9: independence principle stated and priced; no interpleader; segregation by accounting; penal sum and excluded harms. Fixture `todo.default-bond-shortfall`.
6. **Fix F7 and F12**: reconciliation attestation in T-007; ramp reconciliation in Phase 5; latency signals in discovery.
7. **After Phase 1**: F10 (challenge and facilitated proposal), F11 (waiver window), D19's consent window, and confidential-compute checks for the independence principle.

## Sources

Status: **read** means the page or extracted PDF text was read on October 30, 2026; **refused** means the host blocked automated fetch and the claim is inferred from a search snippet or memory.

1. CPMI-IOSCO, Principles for Financial Market Infrastructures, April 2012. https://www.bis.org/cpmi/info_pfmi.htm (read) and https://www.bis.org/publications/principles-financial-market-infrastructures.pdf (text extracted, read).
2. ICC, UCP 600, ICC Digital Library. https://library.iccwbo.org/content/tfb/RULES/tfb-ucp600-rules.htm (read: Art. 4, 5, 14(b), 14(d), 16(c); Art. 16(b) not re-read).
3. Asokan, Shoup and Waidner, "Optimistic fair exchange of digital signatures," IEEE JSAC 18(4), 2000; Eurocrypt 1998. https://www.shoup.net/papers/ (index read; paper not re-read).
4. UNCITRAL Arbitration Rules (2013 text). https://uncitral.un.org/en/texts/arbitration/contractualtexts/arbitration (index read; PDF text extracted, read).
5. UNCITRAL Technical Notes on Online Dispute Resolution (2016). https://uncitral.un.org/sites/uncitral.un.org/files/media-documents/uncitral/en/v1700382_english_technical_notes_on_odr.pdf (text extracted, read).
6. FRCP 22, https://www.law.cornell.edu/rules/frcp/rule_22 (read); 28 U.S.C. §1335, https://www.law.cornell.edu/uscode/text/28/1335 (read).
7. California Financial Code §17003 and §17409. https://california.public.law/codes/ca_fin_code_section_17003 and https://california.public.law/codes/ca_fin_code_section_17409 (read).
8. Sale Agreement, American Service Insurance Company and 150 Northwest Point LLC, April 5, 2012, Exhibit 10.8 to an Atlas Financial Holdings 10-Q. https://www.sec.gov/Archives/edgar/data/0001539894/000153989412000043/exhibit108purchaseandsale.htm (read).
9. FCA Handbook, CASS 7. https://www.handbook.fca.org.uk/handbook/CASS/7/ (refused: script-rendered page returned no text).
10. 40 U.S.C. §3131 (Miller Act). https://www.law.cornell.edu/uscode/text/40/3131 (read).
11. Old Republic Surety, "Understanding the claim process for bonds vs. insurance." https://www.orsurety.com/blog/understanding-the-claim-process-for-bonds-vs.-insurance (read; vendor).
12. Escrow.com: https://www.escrow.com/what-is-escrow, https://www.escrow.com/inspection-period, https://www.escrow.com/learn-more/how-escrow-works/escrow-dispute, https://www.escrow.com/escrow-licenses (read).
13. Upwork Help, fixed-price review and release. https://support.upwork.com/hc/en-us/articles/17974824831507 (refused).
14. Amazon A-to-z Guarantee help text. https://digprjsurvey.amazon.com/csad/help/node/GQ37ZCNECJKTFYQV (read; Amazon-domain mirror, amazon.com refused).
15. eBay Money Back Guarantee policy. https://www.ebay.com/help/policies/ebay-money-back-guarantee-policy/ebay-money-back-guarantee-policy?id=4210 (read).
16. Visa, Dispute Management Guide for Merchants. https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchants-dispute-management-guidelines.pdf (text extracted, read: categories 10 to 13; the 120-day limit is not in the guide and is inferred).
17. Stripe Docs, separate charges and transfers, and manual payouts. https://docs.stripe.com/connect/separate-charges-and-transfers and https://docs.stripe.com/connect/manual-payouts (read; served in German).
18. PayPal Help, payment holds. https://www.paypal.com/smarthelp/article/faq3289 (refused).
19. Open Banking Limited, Variable Recurring Payments. https://www.openbanking.org.uk/variable-recurring-payments-vrps/ and https://standards.openbanking.org.uk/customer-experience-guidelines/payment-initiation-services/vrp-payments-with-an-sca-exemption/v3-1-8 (read).
20. FTC, Gramm-Leach-Bliley Act. https://www.ftc.gov/business-guidance/privacy-security/gramm-leach-bliley-act (read).
21. PCI SSC, Tokenization Guidelines Information Supplement, August 2011. https://listings.pcisecuritystandards.org/documents/Tokenization_Guidelines_Info_Supplement.pdf (text extracted, read).
22. 31 CFR 1010.410, 1010.430 and 1020.320 (Cornell LII). https://www.law.cornell.edu/cfr/text/31/1010.410, https://www.law.cornell.edu/cfr/text/31/1010.430, https://www.law.cornell.edu/cfr/text/31/1020.320 (read).
23. FATF, virtual assets and the travel rule. https://www.fatf-gafi.org/en/topics/virtual-assets.html (refused).
24. GDPR Art. 5 and 17. https://gdpr-info.eu/art-5-gdpr/ and https://gdpr-info.eu/art-17-gdpr/ (read; third-party text, not EUR-Lex).
25. European Parliamentary Research Service, "Blockchain and the General Data Protection Regulation," 2019. https://www.europarl.europa.eu/RegData/etudes/STUD/2019/634445/EPRS_STU(2019)634445_EN.pdf (text extracted, read).
26. Kleros Escrow documentation. https://docs.kleros.io/products/escrow (read).
27. UMA, "How does UMA's Oracle work?" https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work (read).
28. ERC-8183: Agentic Commerce (draft). https://eips.ethereum.org/EIPS/eip-8183 (read).
29. base/commerce-payments: README, docs/Security.md, docs/operations/Capture.md. https://github.com/base/commerce-payments (read).
30. SRS Acquiom, M&A escrow statistics. https://www.srsacquiom.com/our-insights/ma-escrows-statistics/ (read; no figures on the page; the 10% median comes from a law-firm summary of the 2026 study found by search, inferred).
31. Repo research notes relied on: `docs/research/notes/fiat_payments.md` §6 (card-network and Reg E/Z treatment of agent payments; secondary sources) and `docs/research/notes/theory_law.md` §2 (commitment economics; classics listed there as unverified).
