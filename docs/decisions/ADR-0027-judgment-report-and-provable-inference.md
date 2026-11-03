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
  - ADR-0014 §2a (the proof-miss penalty is paid from the junior tranche only, outside the usual loss order) and §4 (attestation as a priced option gets its shape);
  - ADR-0020 §5 (attestation kinds sit beside `providerPrivacy`, under a different name);
  - ADR-0020 §3 (the `judgment` level publishes typed fields; a co-signed `Publish` can add the judges' text);
  - ADR-0024 §2 (free text in the judgment record follows the work's key) and §8 (the settlement view carries the proof terms in the clear);
  - D26's record rule, by treating judge text that can quote the work as part of the work (open question 1). The code already holds this intent for the screen: "the judgment record is published before the buyer has paid, so it must not leak the work" (`packages/judgment/src/screen.ts:3-4`).

## Context

Measured unless marked.

- **Residual 8.** Model identity is disclosed, not proven: "an adjudicator could run a cheaper model under a pinned name. Bounded by the bond, appeals and calibration" (`docs/neutrality.md`). The commitment binds `registryHash` and `policyHash`. Each verdict records `promptTemplateHash` and `inputHash`, the SHA-256 of the full rendered prompt (ADR-0006). The boundary and canary nonces derive from the revealed seed (`packages/judgment/src/panel.ts:72`), so anyone holding the plaintext can rebuild each judge's exact prompt.
- **FlashProve** (Anthropic, 2026-11-02, Apache 2.0) proves that a committed model produced a reply from a prompt, checkable on a CPU without the weights.
  - **Scope today:** one model (Llama 4 Maverick's text transformer), a 1,024-token window that holds prompt and reply together, and greedy decoding on an integer version of the weights.
  - **Cost:** about 72 times the GPU time of FP8 prefill, and an 18.78 MB proof per request that verifies in 17 to 44 s.
  - **Timing:** it proves after the fact.
  - **Maturity:** it is "a research artifact: not maintained", with "no independent security audit", and "even an honest prover may fail to convince the verifier" (technical report §7).
  - **Handling:** a proof "is as sensitive as its request". The weight commitment is seeded and must reach verifiers from a trusted party (research note §1).
- **A judge does not fit the window** (inferred from these sizes). The fixed template is 1,746 characters before anything is filled in, and the data runs up to 100,000 characters (`packages/judgment/src/prompt.ts:20-59`). Splitting a judgment into windows would change what each judge decides (inferred, research note §2).
- **The live panel's Anthropic seats cannot be proven today.** Claude rejects sampling parameters, no weight commitment exists, and its thinking text is a summary written by a different model (Anthropic docs; `apps/adjudicator/src/providers/live.ts:79-87`). The research found no lab that signs responses for customers, and TEE-attested inference for open weights only (Venice, Phala, NEAR AI), with the TEE.fail caveat (ADR-0020 §5). These are inferred from a survey: an absence found, not proven.
- **Re-execution can check open weights** (inferred from two external results, research note §8). Batch-invariant kernels made 1,000 of 1,000 temperature-0 completions identical on one stack. Token-DiFR detects a 4-bit substitute within 300 tokens.
- **The record is most of the report already.** The signed judgment record holds every check, the screen signals, each seat's status and verdict, and the aggregation (`spec/schemas/judgment.schema.json`). The live panel returns no reasoning text: Anthropic's thinking display is omitted and DeepSeek's thinking is disabled (`live.ts:87,99`).
- **The record reaches both parties, and its free text can quote the work** (D26; ADR-0024 §2, judgment records sealed to "Buyer and seller always"; at `judgment` and `public` the record is readable by anyone, ADR-0020 §3). The quoting fields:
  - check details (300 characters each), which can carry the deliverable's own JSON property names and CSV headers (`packages/judgment/src/checks/json-schema.ts:84`, `checks/index.ts:164`);
  - per verdict, up to 12 × 300 characters of evidence, 300 of injection evidence and 600 of rationale.

  Screen-signal details and aggregate reasons do not quote the work: they carry fixed labels, IDs and counts (`screen.ts:3`, `aggregate.ts`).

  A buyer can write evidence-anchored criteria, arrange a failing one and take the refund with the quoted rows (red-team F3, inferred). D26 says "the work itself still follows the hold".
- **The promotion gate cannot measure its own threshold** (inferred). It allows 2% false accepts on a calibration set of about 40 cases, about 15 of them rejects (`docs/judgment-and-defenses.md`). The exact 95% upper bound for zero false accepts in 15 is about 18%.
- **D28 and ADR-0007 constrain every remedy.** D28: agreed terms bind; after an accept, the appealing buyer must show the work fails the terms, unless a party gamed the judgment. ADR-0007: finality at the decision, an overturn pays from the bond, and bond is encumbered per guaranteed commitment.

## Decision (proposed)

### 1. Free text that can quote the work follows the hold; the report is one sealed artifact in two parts

- **The rule, in the report and in the existing record alike.**
  - *Record part:* typed fields only, sealed to both parties (D26). The schema enforces it: closed enums and reason codes, integers, hashes, party-authored IDs, row-index arrays with `maxItems`, and `additionalProperties: false`, so no free text can sit in the clear. The fields:
    - each check's pass or fail and counts;
    - the screen's `flagged`, its signal kinds and counts, and its details as reason codes with typed parameters;
    - each seat's status, `overall`, `injectionSuspected`, scores, filter reason code, latency and attestation;
    - the aggregation's counts, outcome, and reasons as reason codes with typed parameters.

    D27 and D28 rest on these as typed, observable facts.
  - *Work part:* every free-text field drawn from the work. That covers each seat's raw output (with any reasoning labeled `full` or `summary`), verdict evidence, injection evidence and rationale, check details, and the reader's features. The sample the judges saw is not stored: it is the work itself, and anyone holding the plaintext recomputes it from the seed (`packages/judgment/src/sample.ts:1-11`).
  - *Key:* the work part is encrypted under a key derived from the work's content key (ADR-0012), so a party reads it exactly when it can read the work. The seller always can; the buyer once the key is released; a fallback or appeal adjudicator when it takes over. This needs no new key path (inferred).
- **The report.** The adjudicator writes one per judgment, hashed into the signed record as `reportHash`. The verdict keeps its capped rationale, since the cap is a defense (T15). The rationale now sits in the work part.
- **Sealed at every disclosure level.** The protocol never publishes the work part. At `judgment` and `public` the record shows scores and reason codes, not quotes. Parties who want the judges' text public co-sign a `Publish` whose `disclosure` body carries the work-part key (ADR-0024 §3). That key opens the judges' text, which quotes parts of the work, but not the whole work. A party choosing `judgment` for precedent keeps its choice, and publishing those quotes is the parties' joint act (ADR-0015, D40). A party may also publish its own copy (D35). Backers get aggregates only (ADR-0020 §4).
- **Report timing.** With `maxSubmissions` above 1 (Phase 4), the adjudicator releases reports after the commitment's last decision, so a seller cannot read attempt one's judges before attempt two.
- **A missing or undecryptable report** is an ordinary appeal ground, like a missing or wrong key (T19), with no penalty attached.
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
  - Each entry lists the measurements or keys it accepts, with a validity window, all inside `registryHash`. A provider that rotates them after agreement leaves the open deals' seats unattested, never re-drawn; that is evidence, not a payment (§4).
  - Whether a host is the adjudicator's affiliate is self-declared, as affiliation is in ADR-0007. The mislabeled-model ground is the backstop.
- **Attested seats decode deterministically.** A receipt for one of several sampled calls would let the adjudicator choose among replies, which is a re-roll. Fetching a receipt is never a retry.
- **The policy gains four fields,** which the parties choose in the terms as they choose the panel (D36):
  - `minAttestedSeats` (default 0), applied to each instance's panel;
  - `attestedKinds`;
  - `proofWindowSec`;
  - `proofMissPenalty`.

  A club may set a floor on `minAttestedSeats` (ADR-0015). ’crow's default panel stays as it is, all `none`.
- **Families come first.** Attestation never relaxes `minFamilies`, the cross-family accept rule or any other panel rule. A proof answers who answered (residual 8); families answer correlated error (T8).
- **When the adjudicator declines a policy (D29):**
  - the registry cannot seat both minimums;
  - the attested entries are no more than `minAttestedSeats`, so the attested seats would be the same for every seed (T5). Where the seed can vary them only a little, the operator warns (advisory);
  - the named fallback and appeal adjudicators cannot seat attested judges.
- **At the call, a missing judge abstains as today and is not replaced**, which would be a re-draw. An attested seat that abstains, or is served without its attestation, is recorded as such (§4). The decision proceeds as usual.
- The judgment record gains, per seat, `attestation` (the kind) and `outputHash` (SHA-256 of the reply as returned).

### 3. Proofs are post hoc; settlement stores their presence and waits for none

- **The decision states the duty.** Each decision message carries `attestedSeatsSeated`: the number of attested seats the panel seated. It is 0 when no panel ran, as on a required-check reject or an empty-rubric accept. Anyone can recompute the panel from the revealed seed (ADR-0006). A false count is therefore an attributable lie in a signed message, and a ground for a "policy or panel violation" appeal.
- **The bundle.** Whenever `attestedSeatsSeated > 0`, the decider signs a `ProofBundle` (EIP-712) within `proofWindowSec`, even if every attested seat abstained. It binds:
  - the commitment ID, role, attempt and the decision's record hash, with a nonce and an expiry, so a root never carries to another decision;
  - a root with one leaf per seated attested seat: `{inputHash, outputHash, evidence hash}`, or an abstention leaf;
  - a sealed pointer.
- **Presence, not content.** Anyone may submit the bundle to the settlement layer, which stores the root beside the commitment's state word (ADR-0024 §8), one slot per decision role (first instance, fallback, appeal), emits `proofs.posted`, and changes no commitment state. A later decider cannot rely on an earlier decider's root. An operator that refuses to relay it is bypassed through the escape hatch (ADR-0005). Settlement reads no proof content: it stores a root, set only by the decider's signature.
- **The terms it needs travel in the clear.** The settlement view (ADR-0024 §8) gains `proofWindowSec` and `proofMissPenalty`, since the contract sees only `policyHash`. This changes the view's EIP-712 struct and its version. The proof deadline runs on settlement's own clock, from when it applied the decision; the record's `decidedAt` is not read. A root stored at or before the deadline counts, and the timeout opens strictly after it, so a bundle and a trigger in the same block resolve for the bundle.
- **The proofs** travel sealed with the work part, because a proof is as sensitive as its request.
- **Settlement waits for no proof.** Release, refund, fallback and default happen as today. Proving never extends a deadline (`attack.prover-stalls-settlement`).
- **A proof or re-execution never produces a new verdict.** A mismatch is evidence, and the appeal panel judges afresh. Nothing is re-rolled.
- **Who can check.** The party a decision goes against always holds the plaintext: after an accept, the buyer has the key; after a reject, the seller has the work. So the party that cares can check before it appeals (D32).
- **Verifiers run sandboxed,** with no keys and no network. Each registry entry caps proof size and verification time. Any finding about a proof carries the hash of the verifier's transcript, so it is evidence (D26).
- **Proof windows are the parties' to set (D31).** Settlement can process any value, 0 included. An adjudicator declines terms its prover cannot meet within its stated proving time plus an inclusion margin, and windows longer than it will hold a reserve for (D29, D32). The operator warns (advisory) when the window ends after the appeal window or leaves no time for forced inclusion (residual 2).

### 4. A missing proof costs a fixed amount from the decider's own stake; nothing else moves money

- **The duty and the merits are separate.** A missing proof does not show the work is bad, so a missed duty earns a bounded, priced payment and the outcome is never re-tried. D28 and D27c are unchanged.
- **The timeout catches absence, not faking.** If `attestedSeatsSeated > 0` and no root is stored by the proof deadline, anyone may trigger the proof-miss timeout. It pays `proofMissPenalty` (P) to the party the decision went against.
  - No duty, and so no penalty, follows a decision with no attested seat seated, or an escalation, which went against no one. A decider with a dead prover could escalate to avoid P, at the parties' cost in time. That is recorded and counts against its public record, and it is bounded like any escalation (ADR-0007).
  - This is a fact settlement checks from its own storage, at every instance. "The decider" is whoever signed the decision: the primary, the fallback, or the appeal adjudicator for its own decision.
  - The timeout relies on an honest `attestedSeatsSeated`. A decider that signs a false 0 to dodge it has signed something anyone can disprove by recomputing the panel. In any appeal, the appeal adjudicator may find the count false, and P is then paid as if absent. No party can cause a false count, so paying on that finding rewards no one who gamed it.
- **P comes only from the decider's junior tranche,** its own first-loss stake (ADR-0014 §2a), never from backers.
  - The parties choose P (D31), and a rulebook may cap it as a share of the price (ADR-0015).
  - Whenever `proofMissPenalty > 0`, each decider reserves P in a separate `reservedJunior` counter: the first-instance decider at acceptance, and a fallback or appeal adjudicator when it takes the case. The gate adds `junior - reservedJunior >= P` to the price rule (`error.coverage-exceeded`).
  - The reserve is ring-fenced: price payouts do not draw reserved junior, so senior takes price losses earlier by at most the open reserves, which pool terms disclose to backers (ADR-0014 §2a). The alternative, paying `min(P, junior)` best-effort, keeps the loss order but leaves P unenforceable once junior runs out.
  - A rulebook cap on P at the first-loss share of the price keeps that shift within what backers already accept per deal (inferred). An adjudicator that cannot reserve P cannot take the case, as with the coverage gate today (ADR-0007). A high P can therefore push a case to the default outcome at takeover, which the parties weigh when they set it (D32).
  - The reserve is held until the later of `appealDecideBy` and the proof deadline. It is released at once when the decider's deadline passes without its decision, when it escalates, or when its decision seats no attested seat. A correlated outage across deals then draws only on reserves already held.
  - A decider and a colluding party can move only the decider's own stake.
- **Everything else is evidence, never a payment.** This covers a root whose proofs fail, cannot be fetched or decrypted, or exceed the entry's caps; an attested seat that abstained or was served without its attestation; and a re-execution outside tolerance.
  - Each is recorded and counts against the adjudicator's public record (ADR-0014 §1).
  - Each can support an ordinary appeal, and, with independent evidence of a different model, the existing mislabeled-model ground (`docs/architecture.md:133`) and any bad-faith penalty the rulebook names.
  - A posted root that does not verify is a signed, attributable claim, which is evidence for a court (D26).
  - The reason: a party can cause each of these. A seller can make a judge abstain with one injected URL (`attack.injection-filter-abstain-appeal-default`). FlashProve warns that "even an honest prover may fail to convince the verifier" and that its integer model's match "does not cover adversarially designed prompts". Paying on them would reward whoever caused them.
- **Re-execution is a tolerance test** (Token-DiFR style) on the named hardware class, never a single mismatching token.
- **Postings.**
  - In `guaranteed_on_decision`, money moved at the decision, and P adds to whatever the appeal does under today's rules: upheld or silent, the first decision stands; overturned, the decider's bond pays the price as today.
  - In `settle_after_window`, P is paid with the final settlement.
  - `docs/architecture.md` gets this table.
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
  - A nomination the gate rejects retires the set it was tested on, so sequential nominations cannot leak the set one bit at a time.
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
9. **Every proof problem is evidence only.** It is recorded and counts against the adjudicator's public record (ADR-0014 §1), with no contract change. This is the simplest option (D26, D32). §4 adopts it for every proof problem a party can cause: a failing proof, an abstention, a rotated measurement. It keeps one payment for plain absence, because otherwise parties who chose attestation would get nothing enforceable for it.
10. **Also pay the penalty on a `failed` proof or an attested abstention, through the appeal adjudicator's finding.** This was the second draft. Rejected: a seller can make a judge abstain with one injected URL, or craft a delivery an honest prover cannot prove, so the payment would reward the party that caused the failure.
11. **Let the loop promote its own candidates when its metrics pass.** Fully automatic, but it invites all four Goodhart failures, and an attacker who can move the metric moves the policy.

## Consequences

- **Residual 9 grows slightly:** `proofWindowSec`, `proofMissPenalty`, `attestedSeatsSeated` and the proof roots join the public skeleton.
- **Residual 8 narrows for attested seats and is unchanged for `none` seats**, including the default panel. A posted root that does not verify is caught only by evidence, not by settlement: the timeout catches absence, not faking.
- **`docs/neutrality.md` gains a prover row:**
  - **Can:** post or withhold proofs.
  - **Cannot:** stop or delay settlement, extend a deadline, change a verdict, or move anything beyond its own reserved penalty.
  - **How the deal still completes:** the decision stands, and anyone may trigger the proof-miss timeout.
- **Neutrality fixtures** (research note §9). Each starts as `todo.` until a kind is built:
  - `neutrality.prover-offline-after-accept`;
  - `neutrality.prover-offline-after-reject`;
  - `neutrality.prover-offline-fallback-decides`;
  - `neutrality.operator-refuses-proof-bundle`;
  - `neutrality.attested-provider-offline-at-call`;
  - `neutrality.attestation-measurement-rotated`;
  - `neutrality.proof-verifier-stalled`.
- **Attack and error fixtures:**
  - `attack.proof-fails-verification`;
  - `attack.proof-garbage-root-evades-timeout`;
  - `attack.proof-miss-on-short-circuit-reject`;
  - `attack.proof-miss-penalty-drains-senior`;
  - `attack.proof-miss-reserve-released-early`;
  - `attack.junior-reserve-consumed-by-overturn`;
  - `attack.false-attested-count`;
  - `attack.second-decider-free-rides-first-root`;
  - `attack.proof-miss-same-block-race`;
  - `attack.seller-induces-attested-abstention`;
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
  - `error.proof-window-shorter-than-prover-latency`.
- **Schema, next version:**
  - registry entry: `attestation` (kind, anchor, accepted measurements or keys, validity window, size and time caps) and request settings;
  - policy: `minAttestedSeats`, `attestedKinds`, `proofWindowSec` and `proofMissPenalty`; rulebook: a floor on `minAttestedSeats` and a cap on `proofMissPenalty`;
  - decision message: `attestedSeatsSeated`;
  - judgment record: typed and sealed-text parts, `reportHash`, and per seat `attestation` and `outputHash`;
  - a `ProofBundle` message, a `proofs.posted` event and a proof-miss timeout;
  - the settlement view: `proofWindowSec` and `proofMissPenalty` in the clear, which bumps its EIP-712 version;
  - an appeal ground kind, since `grounds` is free text today (`spec/schemas/appeal.schema.json`).

  Every policy hash changes, and so every commitment ID in the fixtures changes, as with `agg-3`.
- **The record split is the one part worth building before any attestation.** It changes today's records, the SDK's record reader and what the `judgment` disclosure level shows (reason codes and scores, not quotes). This is the backlog row "Verdict evidence can quote the work to a refunded buyer".
- **Rules contract:**
  - it stores a proof root in the commitment's word without changing commitment state;
  - it gains one permissionless timeout, paid from a reserve in each decider's junior tranche;
  - `formal/Holdback.tla` adds the timeout, and safety must still show no transition moves funds without a signature, decision or timeout.

  This is a Phase 2 contract change, reviewed with T-206's checklist.
- **Panel selection becomes a two-constraint draw** (families and attested seats) with its own property test, replacing today's greedy walk where the two constraints interact (`panel.ts:44-61`).
- **Request settings move from code to the registry entry.** This changes `registryHash`, and it is worth doing even without attestation: today two adjudicators publishing the same registry can call the same model differently.
- **One §6 control needs a repository setting.** The protected path for the gate needs branch protection with code-owner review, and repository settings wait for Rafa (CLAUDE.md).
- **Calibration grows first** (T-301), to the counts in §6, and the gate text in `docs/judgment-and-defenses.md` changes to counts.
- **The demo is unchanged.** Nothing here is built before Phase 3 calibration (T-301, T-305).

## Litmus tests

- **Neutrality: passes.**
  - Settlement reads no proof content and waits for none, so a prover that refuses or goes offline stops nothing.
  - A missing proof moves only the decider's own reserved stake, only by a permissionless timeout, and only on a fact settlement stores. Backers' capital never pays it.
  - The root reaches settlement through the escape hatch, so no operator can make an honest decider look as if it posted nothing.
  - Attestation anchors sit outside the adjudicator.
  - Tuning has no central tuner, and each release binds only the commitments signed under it.
- **The hold: passes and is tightened.**
  - No new money path moves funds without a decision, a timeout or a reserve held in advance; finality and settle-once hold.
  - Free text that can quote the work, in the report and in the record, now follows the work's key. A refunded buyer gets no verbatim text of the work through the judgment (`attack.record-quotes-work-after-refund`).
  - Pass or fail and counts on buyer-chosen checks still say something about the work. The seller sees those checks before it signs (D32).
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
3. **What should a missed proof cost?** Recommended: a fixed `proofMissPenalty` that the parties choose, with three conditions (§4):
   - it is paid automatically to the losing party, only for plain absence;
   - it comes from the decider's own junior stake;
   - the merits are never re-tried, and every other proof problem is evidence only.

   The rejected options were a fresh hearing (alternative 4), a free appeal (alternative 5) and paying on failures a party can cause (alternative 10).
4. **Who promotes a tuned release, and should overturned appeals feed the loop?** Recommended:
   - a gate the loop cannot edit, run once on a held-out set, plus a named approver who reads the diff;
   - overturned appeals as alerts only;
   - no loop before calibration meets the §6 counts.

## What would change this decision

- A lab that signs or recomputes its inference for customers: the Anthropic seats could become `signed`.
- A maintained, audited prover with judge-sized windows for a second open-weight family: `zk` seats become practical, and a fully proven two-family panel becomes possible.
- An enclave break that forges receipts remotely, with no physical access: drop `enclave` as a kind.
- A proof that an honest prover always convinces the verifier (completeness, proven): the penalty could then be paired with a stronger remedy on the merits.
