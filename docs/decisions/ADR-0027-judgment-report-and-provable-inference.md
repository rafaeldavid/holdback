# ADR-0027: Judgment report, verifiable inference and tuning releases

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** T-308 (`docs/plan.md`, Phase 3; the row in `docs/backlog.md` under Judgment defenses), added by Rafa on 2026-11-03 after Anthropic published FlashProve. Research: `docs/research/t-308-judgment-report-provable-inference.md` (Fable, max effort, the same day). Reviewed by the `reviewer` role (Opus 5.5) and a red team (Sonnet 5.5) on PR 115; this text includes their fixes.
- **Changes (when accepted and built):**
  - the next schema version: registry entry, policy, rulebook, judgment record, a new `ProofBundle` message, `proofs.posted` event and proof-miss timeout;
  - the rules contract: it records proof roots, adds one permissionless timeout, and extends the encumbrance;
  - `docs/judgment-and-defenses.md`, `docs/neutrality.md` (a prover row, residuals 7 and 8), `docs/architecture.md` (postings) and `docs/backlog.md`.

  Nothing is built in this pass.
- **Would amend:**
  - ADR-0006 ("What is proven and what is disclosed");
  - ADR-0007 (encumbrance);
  - ADR-0014 §4 (attestation as a priced option gets its shape);
  - ADR-0020 §5 (attestation kinds sit beside `providerPrivacy`, under a different name);
  - ADR-0024 §2 (free text in the judgment record follows the work's key);
  - D26's record rule, by treating judge text that can quote the work as part of the work (open question 1).

## Context

Measured unless marked.

- **Residual 8.** Model identity is disclosed, not proven: "an adjudicator could run a cheaper model under a pinned name. Bounded by the bond, appeals and calibration" (`docs/neutrality.md`). The commitment binds `registryHash` and `policyHash`. Each verdict records `promptTemplateHash` and `inputHash`, the SHA-256 of the full rendered prompt (ADR-0006). The boundary and canary nonces derive from the revealed seed (`packages/judgment/src/panel.ts:72`), so anyone holding the plaintext can rebuild each judge's exact prompt.
- **FlashProve** (Anthropic, 2026-11-02, Apache 2.0) proves that a committed model produced a reply from a prompt, checkable on a CPU without the weights.
  - **Scope today:** one model (Llama 4 Maverick's text transformer), a 1,024-token window that holds prompt and reply together, and greedy decoding on an integer version of the weights.
  - **Cost:** about 72 times the GPU time of FP8 prefill, and an 18.78 MB proof per request that verifies in 17 to 44 s.
  - **Timing:** it proves after the fact.
  - **Maturity:** it is "a research artifact: not maintained", with "no independent security audit", and "even an honest prover may fail to convince the verifier" (technical report §7).
  - **Handling:** a proof "is as sensitive as its request". The weight commitment is seeded and must reach verifiers from a trusted party (research note §1).
- **A judge does not fit the window.** The fixed template is 1,746 characters before anything is filled in, and the data runs up to 100,000 characters (`packages/judgment/src/prompt.ts:20-59`). Splitting a judgment into windows would change what each judge decides (inferred, research note §2).
- **The live panel's Anthropic seats cannot be proven today.** Claude rejects sampling parameters, no weight commitment exists, and its thinking text is a summary written by a different model (Anthropic docs; `apps/adjudicator/src/providers/live.ts:79-87`). The research found no lab that signs responses for customers, and TEE-attested inference for open weights only (Venice, Phala, NEAR AI), with the TEE.fail caveat (ADR-0020 §5). These are inferred from a survey: an absence found, not proven.
- **Re-execution can check open weights** (inferred from two external results, research note §8). Batch-invariant kernels made 1,000 of 1,000 temperature-0 completions identical on one stack. Token-DiFR detects a 4-bit substitute within 300 tokens.
- **The record is most of the report already.** The signed judgment record holds every check, the screen signals, each seat's status and verdict, and the aggregation (`spec/schemas/judgment.schema.json`). The live panel returns no reasoning text: Anthropic's thinking display is omitted and DeepSeek's thinking is disabled (`live.ts:87,99`).
- **The record reaches both parties, and its free text can quote the work** (D26; ADR-0024 §2, judgment records sealed to "Buyer and seller always"; at `judgment` and `public` the record is readable by anyone, ADR-0020 §1). The quoting fields:
  - check and screen-signal details (300 characters each), which can carry the deliverable's own JSON property names and CSV headers (inferred from reading `packages/judgment/src/checks/`);
  - aggregate reasons (200);
  - per verdict, up to 12 × 300 characters of evidence, 300 of injection evidence and 600 of rationale.

  A buyer can write evidence-anchored criteria, arrange a failing one and take the refund with the quoted rows (red-team F3, inferred). D26 says "the work itself still follows the hold".
- **The promotion gate cannot measure its own threshold** (inferred). It allows 2% false accepts on a calibration set of about 40 cases, about 15 of them rejects (`docs/judgment-and-defenses.md`). The exact 95% upper bound for zero false accepts in 15 is about 18%.
- **D28 and ADR-0007 constrain every remedy.** D28: agreed terms bind; after an accept, the appealing buyer must show the work fails the terms, unless a party gamed the judgment. ADR-0007: finality at the decision, an overturn pays from the bond, and bond is encumbered per guaranteed commitment.

## Decision (proposed)

### 1. Free text that can quote the work follows the hold; the report is one sealed artifact in two parts

- **The rule, in the report and in the existing record alike.**
  - *Record part:* typed fields only, sealed to both parties (D26). That means enums, integers, hashes, row indices and closed reason codes: each check's pass or fail and counts, the screen's signal kinds and counts, each seat's status, scores, filter reason code, latency and attestation, and the aggregation's counts and outcome.
  - *Work part:* every free-text field drawn from the work. That covers each seat's raw output (with any reasoning labeled `full` or `summary`), verdict evidence, injection evidence and rationale, check and screen-signal details, aggregate reasons that quote a detail, the reader's features, and the sample the judges saw.
  - *Key:* the work part is encrypted under a key derived from the work's content key (ADR-0012), so a party reads it exactly when it can read the work. The seller always can; the buyer once the key is released; a fallback or appeal adjudicator when it takes over. This needs no new key path (inferred).
- **The report.** The adjudicator writes one per judgment, hashed into the signed record as `reportHash`. The verdict keeps its capped rationale, since the cap is a defense (T15). The rationale now sits in the work part.
- **Sealed at every disclosure level.** The protocol never publishes the work part; a party may publish its own copy (D35). Backers get aggregates only (ADR-0020 §4).
- **Report timing.** With `maxSubmissions` above 1 (Phase 4), the adjudicator releases reports after the commitment's last decision, so a seller cannot read attempt one's judges before attempt two.
- **A missing or undecryptable report** is an appeal ground, like a missing or wrong key (T19).
- **Data, never instruction**, for every reader, like the screen report (ADR-0021, T22): every text field is `x-holdback-untrusted`. No model reads the report.
  - Appeal judges never receive it. The appeal template already has them "decide afresh" (`prompt.ts:48-52`), and anyone holding the plaintext can check that by recomputing each appeal verdict's `inputHash`.
  - The appeal adjudicator's code may read the report and proofs only to compare bytes, verify proofs and re-execute.
- **Reasoning is a seat setting, not a promise.** Each registry entry fixes its request settings: decoding, output cap, and reasoning on or off. These live in code today (`live.ts`). Fixing them in the entry means the binding covers the exact call, and a re-execution or proof checks that call. A seat that returns a summary is recorded as a summary.

### 2. Attestation is a per-seat fact with an independent anchor, and its minimum is the parties' choice

- Each registry entry gains `attestation.kind`, one of:
  - `none` (today's seats);
  - `signed` (the provider signs model, input and output);
  - `enclave` (an attested enclave signs a receipt whose measurement names the weights; named apart from `providerPrivacy: tee`, which is about who sees the work);
  - `reproducible` (pinned open weights on a named engine and hardware class; anyone holding the plaintext and the weights can re-run the call);
  - `zk` (a proof bound to a weight commitment).
- **The anchor must be outside the adjudicator's control**, or the seat counts as `none`.
  - `signed`: a key the provider itself publishes.
  - `enclave`: a hardware vendor's root plus measurements the host publishes. If the adjudicator hosts the enclave, the seat counts as `none`: TEE.fail needs only physical access.
  - `reproducible`: a weights hash the model's publisher states.
  - `zk`: a commitment ID with the hashes of its public files and its proof-policy file. The judge is served on the committed integer model itself, and only exact-match proofs count; under the looser clipped-gap policy 28 of 32 one-token swaps passed (research note §1).
  - Each entry lists the measurements or keys it accepts, with a validity window, all inside `registryHash`. A provider that rotates them after agreement leaves the open deals' seats unproven, never re-drawn (§4).
- **Attested seats decode deterministically.** A receipt for one of several sampled calls would let the adjudicator choose among replies, which is a re-roll. Fetching a receipt is never a retry.
- **The policy gains three fields,** which the parties choose in the terms as they choose the panel (D36):
  - `minAttestedSeats` (default 0), applied to each instance's panel;
  - `attestedKinds`;
  - `proofWindowSec`.

  A club may set a floor on `minAttestedSeats` (ADR-0015). ’crow's default panel stays as it is, all `none`.
- **Families come first.** Attestation never relaxes `minFamilies`, the cross-family accept rule or any other panel rule. A proof answers who answered (residual 8); families answer correlated error (T8).
- **When the adjudicator declines a policy (D29):**
  - the registry cannot seat both minimums;
  - the attested entries are no more than `minAttestedSeats`, so the attested seats would be the same for every seed (T5);
  - the named fallback and appeal adjudicators cannot seat attested judges.
- **At the call, a missing judge abstains as today and is not replaced**, which would be a re-draw. An attested seat that abstains, or that is served without its attestation, counts as unproven (§4). The decision proceeds as usual.
- The judgment record gains, per seat, `attestation` (the kind) and `outputHash` (SHA-256 of the reply as returned).

### 3. Proofs are post hoc; settlement records their presence and waits for none

- **The bundle.** The decider signs a `ProofBundle` (EIP-712) within `proofWindowSec` of its decision. It carries a root over each attested seat's `{inputHash, outputHash, evidence hash}` and a sealed pointer.
- **Presence, not content.** Anyone may submit the bundle to the settlement layer, which records the root as the event `proofs.posted` and changes no state. An operator that refuses to relay it is bypassed through the escape hatch (ADR-0005). Settlement reads no proof content: it records a root, set only by the decider's signature.
- **The proofs** travel sealed with the work part, because a proof is as sensitive as its request.
- **Settlement waits for no proof.** Release, refund, fallback and default happen as today. Proving never extends a deadline (`attack.prover-stalls-settlement`).
- **A proof or re-execution never produces a new verdict.** A mismatch is evidence, and the appeal panel judges afresh. Nothing is re-rolled.
- **Who can check.** The party a decision goes against always holds the plaintext: after an accept, the buyer has the key; after a reject, the seller has the work. So the party that cares can check before it appeals (D32).
- **Verifiers run sandboxed,** with no keys and no network. Each registry entry caps proof size and verification time. A bundle over the caps is the producer's failure.
- **Proof windows.** `proofWindowSec = 0` with `minAttestedSeats > 0` asks for a post-hoc proof at the instant of the decision, which is self-contradictory, so it is refused (D31). The operator warns (advisory) when the window ends after the appeal window, or leaves no time for forced inclusion (residual 2).

### 4. A missed proof costs a fixed, reserved amount; it never re-tries the merits

- **The duty and the merits are separate.** A missing proof does not show the work is bad, and a party can try to make an honest proof fail (FlashProve warns of it). So a missed duty earns a bounded, priced payment, and the outcome is not re-tried. D28 and D27c are unchanged.
- **The policy names `proofMissPenalty`,** a token amount the parties choose (D31). It is reserved at acceptance. The decider's encumbrance per guaranteed commitment becomes the price plus the penalty when `minAttestedSeats > 0` (ADR-0007; `error.coverage-exceeded`), so a correlated outage across deals draws only on reserves already held.
- **Seat states:**
  - **`proven`.**
  - **`unproven`:** no root by `decidedAt + proofWindowSec`, or an attested seat that abstained or was served without its attestation. After the deadline, anyone may trigger the proof-miss timeout, which pays the penalty from the decider's bond to the party the decision went against. This is a settlement fact and works at every instance, the appeal included.
  - **`failed`:** a root was recorded, but at the hearing the proofs fail, cannot be fetched or decrypted, or exceed the entry's caps. Only the appeal adjudicator's signed finding in an appeal establishes it, after verifying on its own clean setup. The appeal itself is ordinary, with the appellant's bond at risk; the finding adds the penalty, paid once per decision. At the last instance there is no one to find it (residual 7): it is recorded, and it is evidence (D26).
- **Postings,** in `guaranteed_on_decision`, where money moved at the decision:
  - unproven, no appeal: the decision stands, and the penalty goes to the losing party;
  - appeal upheld, or the appeal adjudicator silent: the first decision stands, and the appellant's bond and fee follow today's rules;
  - appeal overturned: an overturn as today, with the decider's bond paying the price to the wronged party.

  The penalty adds to whichever applies. In `settle_after_window` nothing has moved at the decision, and the penalty is paid with the final settlement. `docs/architecture.md` gets this table.
- **"The decider"** is whoever made the first-instance decision: the primary, or the fallback when it decided.
- **The mislabeled-model ground is unchanged** (`docs/architecture.md:133`). Independent evidence of a different model, such as a re-execution of a `reproducible` seat outside the entry's tolerance, supports an ordinary appeal and any bad-faith penalty the rulebook names. A re-execution check is a tolerance test (Token-DiFR style) on the named hardware class, never a single mismatching token. A flaky check therefore never moves money on its own.
- A seat with `attestation: none` has no proof duty.

### 5. No prover integration now; interim kinds first

- **Do not integrate FlashProve, and never split a judgment into proof windows.** Revisit when a maintained, audited prover covers the rendered prompt plus the verdict for an open-weight family usable as a judge. At today's budgets that is 8,000 to 32,000 tokens.
- **Interim kinds, as priced options (ADR-0014 §4):**
  - `reproducible` for open-weight seats, which any plaintext holder can check (D32: the party that cares runs the check);
  - `enclave` for attested open-weight hosts, with the TEE.fail caveat;
  - `signed` when a lab offers it.
- **A `zk` entry should carry a commitment others can recompute** where the weights are public, so no one has to trust the entry's publisher. FlashProve's `-public-weights` with a published seed may allow this; that is inferred and untested.
- **Attested seats are easier to attack white-box.** Their weights are public, their decoding is deterministic and the template is public, so a seller can optimize a delivery offline against the exact seat. The seed-derived nonces and criteria order vary per deal, which helps only partly (inferred). An adjudicator therefore runs its red-team set against the exact attested configuration before offering it. Attestation buys identity assurance, not robustness.
- The Anthropic seats stay `none` until Anthropic signs or recomputes its inference for customers, as its internal prototype does.

### 6. Tuning ships as releases; a gate the loop cannot edit promotes

- **Scope.** This section binds ’crow's own adjudicator. For any other adjudicator it is a practice to disclose in its policy log, which the parties weigh when they choose it (ADR-0015). The protocol cannot see an adjudicator's loop; it binds the result by hash.
- **The loop proposes.** Candidates cover the model mix, thresholds, prompts, aggregation and sampling. The loop reads typed aggregates from calibration runs (T-301) and red-team results, never deliverable text: a delivery that fooled the judges could address a model in the loop, so the tuner is an instruction position like any other. It reads audits only under a rulebook that opts into them (ADR-0014, D35). There is no central tuner.
- **Promotion is outside the loop.**
  - The gate runs once, on the one candidate the loop nominates, on a private held-out set never used in selection. Testing many candidates against one set would pass a bad one by chance.
  - Its generators are held back from the repository as well, and refreshed by a person. Real cases enter only with both parties' consent.
  - The gate's code, its sets and the logs are a protected path with a human code owner. A named approver who is not the loop reads the candidate's diff and signs the log entry with a key the loop does not hold.
  - T-305's workflow and `docs/decisions/registry-log.md` extend to policy releases.
- **The gate states counts, not rates, with n published.**
  - False accepts: 0 in at least about 150 reject cases (exact 95% bound 2%).
  - False rejects: 0 in at least about 60 accept cases (5%).
  - The red-team set needs its own n.
  - Cases from a few generators are clustered, so these are floors (inferred).
  - No loop runs before the calibration set meets them.
- **Untunable invariants:** `minFamilies`, the cross-family accept rule, the D27 clauses, screen escalation, pinning, no re-roll, the verdict schema and the rationale cap. A release moves a capped step (one notch per threshold, or one template change), and cumulative drift is capped against a person-signed baseline.
- **Appeal outcomes are alerts for a person, never part of the loop's objective.** An overturn costs an attacker only a fee and a 5% bond (appeal poisoning). The fee formula's FAR and FRR also take appeal outcomes (`docs/judgment-and-defenses.md`, Fee pricing), which is a separate path to review. The T-308 row listed overturned appeals as a loop input; this is open question 4.
- **Releases bind by hash and keep their dependencies alive.**
  - A release is a new `policyHash` or `registryHash`, so open deals never change. Pinned model IDs and no re-roll hold.
  - Every bound registry and template stays callable until the last commitment under it passes `appealDecideBy`. Retiring a model sooner strands open deals into the fallback and the default.
  - The published log carries aggregates only.

## Alternatives considered

1. **Wait and decide nothing until a prover fits a judge.** The cheapest choice. Parties who want attested seats today (`enclave`, `reproducible`) have no way to ask, and the record's free-text exposure stays open.
2. **Integrate FlashProve now on a Maverick seat and split judgments into 1,024-token windows.** Rejected.
   - Verdicts on fragments are different claims, and criteria that span rows cannot be judged in one.
   - With the template and terms repeated in every window, a three-judge first instance costs about 1,000 proofs, 19 GB and 2.5 hours of prover time (inferred).
   - It seats a single provable family, and the prover is unmaintained and unaudited.
3. **Make a decision valid only once proven.** It gives the prover a stop button over settlement, which fails the neutrality test, and it reopens finality (ADR-0007).
4. **An unproven decision loses its presumption: a fresh hearing, as after an escalation.** This was the research pass's first recommendation. The red team replayed `honest-seller-survives-judge-noise-on-appeal` under it: one false `injectionSuspected` overturned an honest five-of-five accept, and a split paid the seller in full from the bond. Rejected.
5. **A free ordinary appeal paid from the decider's bond.** Rejected. It sits outside the encumbrance, gives every loser a free option after one provider outage, and invites stacking a merits ground onto a proof ground.
6. **Let proven seats weigh more, or let an all-proven panel waive the family rule.** Rejected. Today that panel would be single-family, a proof does not fix model error, and correlated error (T8) returns.
7. **Make attestation mandatory on every seat.** It would exclude the Anthropic seats and the default panel. It also takes a choice away from the parties without a neutrality reason (ADR-0015).
8. **Keep the record's free text readable by both parties, and seal only the new report.** That is D26 as written. A refunded buyer keeps the quoted rows, and a buyer can arrange it with evidence-anchored criteria. Open question 1.
9. **Let the loop promote its own candidates when its metrics pass.** Fully automatic, but it invites all four Goodhart failures, and an attacker who can move the metric moves the policy.

## Consequences

- **Residual 8 narrows for attested seats and is unchanged for `none` seats**, including the default panel. It does not close for `failed` at the last instance (residual 7).
- **`docs/neutrality.md` gains a prover row:**
  - **Can:** post or withhold proofs.
  - **Cannot:** stop or delay settlement, extend a deadline, change a verdict, or move more than the reserved penalty.
  - **How the deal still completes:** the decision stands, and anyone may trigger the proof-miss timeout.
- **Neutrality fixtures** (research note §9). Each starts as `todo.` until a kind is built:
  - `neutrality.prover-offline-after-accept`;
  - `neutrality.prover-offline-after-reject`;
  - `neutrality.prover-offline-fallback-decides`;
  - `neutrality.operator-refuses-proof-bundle`;
  - `neutrality.attested-provider-offline-at-call`;
  - `neutrality.attestation-measurement-rotated`;
  - `neutrality.appeal-adjudicator-offline-proof-ground`;
  - `neutrality.proof-verifier-stalled`.
- **Attack and error fixtures:**
  - `attack.proof-fails-verification`;
  - `attack.proof-garbage-root`;
  - `attack.proof-replay-across-deals`;
  - `attack.prover-stalls-settlement`;
  - `attack.seller-crafts-unprovable-delivery`;
  - `attack.proof-ground-honest-accept-judge-noise`;
  - `attack.attested-seat-reroll`;
  - `attack.minattested-pins-the-panel`;
  - `attack.record-quotes-work-after-refund`;
  - `attack.tuner-reads-injected-failure-case`;
  - `attack.tuner-multi-candidate-selection`;
  - `attack.appeal-poisoning-invariance`;
  - `error.coverage-exceeded-by-proof-cost`;
  - `error.proof-window-out-of-range`.
- **Schema, next version:**
  - registry entry: `attestation` (kind, anchor, accepted measurements or keys, validity window, size and time caps) and request settings;
  - policy: `minAttestedSeats`, `attestedKinds`, `proofWindowSec` and `proofMissPenalty`; rulebook: a floor on `minAttestedSeats`;
  - judgment record: typed and sealed-text parts, `reportHash`, and per seat `attestation` and `outputHash`;
  - a `ProofBundle` message, a `proofs.posted` event and a proof-miss timeout;
  - an appeal ground kind, since `grounds` is free text today (`spec/schemas/appeal.schema.json`).

  Every policy hash changes, and so every commitment ID in the fixtures changes, as with `agg-3`.
- **The record split is the one part worth building before any attestation.** It changes today's records, the SDK's record reader and what the `judgment` disclosure level shows (reason codes and scores, not quotes). This is the backlog row "Verdict evidence can quote the work to a refunded buyer".
- **Rules contract:**
  - it records proof roots without changing state;
  - it gains one permissionless timeout, paid from a reserve held at acceptance;
  - `formal/Holdback.tla` adds the timeout, and safety must still show no transition moves funds without a signature, decision or timeout.

  This is a Phase 2 contract change, reviewed with T-206's checklist.
- **Panel selection becomes a two-constraint draw** (families and attested seats) with its own property test, replacing today's greedy walk where the two constraints interact (`panel.ts:44-61`).
- **Request settings move from code to the registry entry.** This changes `registryHash`, and it is worth doing even without attestation: today two adjudicators publishing the same registry can call the same model differently.
- **Calibration grows first** (T-301), to the counts in §6, and the gate text in `docs/judgment-and-defenses.md` changes to counts.
- **The demo is unchanged.** Nothing here is built before Phase 3 calibration (T-301, T-305).

## Litmus tests

- **Neutrality: passes.**
  - Settlement reads no proof content and waits for none, so a prover that refuses or goes offline stops nothing. A missing proof moves only the reserved penalty, and only by a permissionless timeout.
  - The root reaches settlement through the escape hatch, so no operator can make an honest decider look unproven.
  - Attestation anchors sit outside the adjudicator.
  - Tuning has no central tuner, and each release binds only the commitments signed under it.
- **The hold: passes and is tightened.**
  - No new money path moves funds without a decision, a timeout or a reserve held at acceptance; finality and settle-once hold.
  - Free text that can quote the work, in the report and in the record, now follows the work's key, so a refunded buyer gets none of the work through the judgment (`attack.record-quotes-work-after-refund`).
- **Defended multi-model judgment: passes.**
  - Deterministic checks still run first.
  - The two-family rule is untouched and comes before attestation.
  - Pinned IDs and no re-roll hold: attested seats decode deterministically, a missing judge is never replaced, and a proof or re-execution never yields a new verdict.
  - Judge output still matches the verdict schema.
  - Deliverables stay untrusted, for the judges, the report's readers, the verifier and the tuner.
  - D28's burden is unchanged.
  - Identity assurance improves seat by seat as attestation kinds arrive. Robustness does not improve by itself: attested seats are open to white-box attack and are red-teamed in their exact configuration.

## Open questions for Rafa

1. **Should free text in the judgment record that can quote the work follow the hold, as the work does under D26?** This includes verdict evidence and rationale today. The `judgment` level would then publish scores and reason codes, not quotes. Recommended: yes (§1).
2. **Should attestation ever relax the two-family rule?** An all-proven panel is single-family today. Recommended: never (§2).
3. **What should a missed proof cost?** Recommended: a fixed, reserved `proofMissPenalty` that the parties choose, paid automatically to the losing party, with the merits never re-tried (§4). The rejected options were a fresh hearing (alternative 4) and a free appeal (alternative 5).
4. **Who promotes a tuned release, and should overturned appeals feed the loop?** Recommended:
   - a gate the loop cannot edit, run once on a held-out set, plus a named approver who reads the diff;
   - overturned appeals as alerts only;
   - no loop before calibration meets the §6 counts.

## What would change this decision

- A lab that signs or recomputes its inference for customers: the Anthropic seats could become `signed`.
- A maintained, audited prover with judge-sized windows for a second open-weight family: `zk` seats become practical, and a fully proven two-family panel becomes possible.
- An enclave break that forges receipts remotely, with no physical access: drop `enclave` as a kind.
- A proof that an honest prover always convinces the verifier (completeness, proven): the penalty could then be paired with a stronger remedy on the merits.
