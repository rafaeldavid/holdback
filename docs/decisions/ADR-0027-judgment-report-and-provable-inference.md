# ADR-0027: Judgment report, verifiable inference and tuning releases

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** T-308 (`docs/plan.md`, Phase 3; the row in `docs/backlog.md` under Judgment defenses), added by Rafa on 2026-11-03 after Anthropic published FlashProve. Research: `docs/research/t-308-judgment-report-provable-inference.md` (Fable, max effort, the same day).
- **Changes (when accepted and built):** the next schema version (registry entry, policy, judgment record, a new `ProofBundle` message and `proofs.posted` event, an appeal ground); the rules contract (appeal costs on a proof ground); `docs/judgment-and-defenses.md`; `docs/neutrality.md` (a prover row, residual 8); `docs/backlog.md`. Nothing is built in this pass.
- **Amends:** ADR-0006 ("What is proven and what is disclosed"); ADR-0014 §4 (attestation as a priced option gets its shape); ADR-0020 §5 (`tee` stays one kind among several).

## Context

Measured unless marked.

- **Residual 8.** Model identity is disclosed, not proven: "an adjudicator could run a cheaper model under a pinned name. Bounded by the bond, appeals and calibration" (`docs/neutrality.md`). The commitment binds `registryHash` and `policyHash`; each verdict records `promptTemplateHash` and `inputHash`, the SHA-256 of the full rendered prompt (ADR-0006). The boundary and canary nonces derive from the revealed seed (`packages/judgment/src/panel.ts:72`), so anyone holding the plaintext can rebuild each judge's exact prompt.
- **FlashProve** (Anthropic, 2026-11-02, Apache 2.0) proves that a committed model produced a reply from a prompt, checkable on a CPU without the weights. Today it covers one model (Llama 4 Maverick's text transformer), a 1,024-token window that holds prompt and reply together, and greedy decoding on an integer version of the weights. It takes about 72 times the GPU time of inference, makes an 18.78 MB proof per request that verifies in 17 to 44 s, proves after the fact, and is "a research artifact: not maintained" with "no independent security audit". A proof "is as sensitive as its request". The weight commitment is seeded and must reach verifiers from a trusted party (research note §1).
- **A judge does not fit the window.** The fixed template is 1,746 characters before anything is filled in, and the data runs up to 100,000 characters (`packages/judgment/src/prompt.ts:20-59`). Splitting a judgment into windows changes what each judge decides (research note §2).
- **The live panel's Anthropic seats cannot be proven.** Claude rejects sampling parameters, no weight commitment exists, and its thinking text is a summary written by a different model (Anthropic docs; `apps/adjudicator/src/providers/live.ts:79-87`). No lab signs responses. TEE-attested inference exists for open weights only (Venice, Phala, NEAR AI), with the TEE.fail caveat (ADR-0020 §5).
- **Re-execution works for open weights.** Batch-invariant kernels made 1,000 of 1,000 temperature-0 completions identical, and Token-DiFR detects a 4-bit substitute within 300 tokens (research note §8).
- **The record is most of the report already.** The signed judgment record holds every check, the screen signals, each seat's status and verdict, and the aggregation (`spec/schemas/judgment.schema.json`). The live panel returns no reasoning text: Anthropic's thinking display is omitted and DeepSeek's thinking is disabled (`live.ts:87,99`).
- **The record reaches both parties; the work follows the hold** (D26; ADR-0024 §2: judgment records sealed to "Buyer and seller always"). Raw judge outputs quote the work.
- **The promotion gate cannot measure its own threshold.** It allows 2% false accepts on a calibration set of about 40 cases, about 15 of them rejects (`docs/judgment-and-defenses.md`). Zero false accepts in 15 has a 95% upper bound near 18% (inferred, rule of three).
- **Every decision rests on D28** (agreed terms bind; after an accept the appealing buyer must show the work fails the terms, unless a party gamed the judgment) **and on ADR-0007** (finality at the decision; an overturn pays from the bond).

## Decision (proposed)

### 1. The judgment report: one sealed artifact in two parts

- The adjudicator writes a report per judgment, hashed into the signed record as `reportHash`. The verdict keeps its capped rationale; the cap is a defense (T15).
- **Record part, to both parties at the decision (D26).** Each check and its detail, the screen signals, each seat's status, scores, filter reason, latency and attestation, the reader's typed features, and the aggregation inputs and outcome.
- **Work part, following the hold.** Each seat's raw output as returned, with any reasoning labeled `full` or `summary`, and the sample the judges saw. It is encrypted under a key derived from the work's content key (ADR-0012), so a party reads it exactly when it can read the work: the seller always, the buyer once the key is released, and a fallback or appeal adjudicator when it takes over (inferred: this needs no new key path).
- **Sealed at every disclosure level**, including `judgment` and `public`; a party may publish its own copy (D35). Backers get aggregates only (ADR-0020 §4).
- **Data, never instruction**, for every reader, like the screen report (ADR-0021, T22): every text field is `x-holdback-untrusted`.
- **Appeal judges never receive it.** The appeal template already has them "decide afresh" (`prompt.ts:48-52`). The appeal adjudicator's code may read the report and proofs to verify them; its judges may not.
- **Reasoning is a seat setting, not a promise.** Each registry entry fixes its request settings (decoding, output cap, reasoning on or off), which live in code today (`live.ts`), so the binding covers the exact call and a re-execution or proof checks that call. A seat that returns a summary is recorded as a summary.

### 2. Attestation is a per-seat fact, and its minimum is the parties' choice

- Each registry entry gains `attestation.kind`, one of:
  - `none` (today's seats);
  - `signed` (the provider signs model, input and output);
  - `tee` (an attested enclave signs a receipt whose measurement names the weights);
  - `reproducible` (pinned open weights on a named deterministic engine; anyone holding the plaintext and the weights can re-run the call);
  - `zk` (a proof bound to a weight commitment).

  Each kind carries its reference: the provider's key, the measurement, the weights hash and engine, or the commitment ID with its public files.
- The policy gains `minAttestedSeats` (default 0), `attestedKinds` (which kinds count) and `proofWindowSec`. The parties choose them in the terms as they choose the panel (D36). ’crow's default panel stays as it is, all `none`.
- **Families come first.** Attestation never relaxes `minFamilies`, the cross-family accept rule, or any other panel rule. A proof answers who answered (residual 8). Families answer correlated error (T8). A policy whose registry cannot seat both minimums is unsatisfiable, and the adjudicator declines it at acceptance (D29).
- The judgment record gains, per seat, `attestation` (the kind) and `outputHash` (SHA-256 of the reply as returned).

### 3. Proofs are post hoc and never gate settlement

- The adjudicator posts a signed `ProofBundle` within `proofWindowSec` of the decision: a root over each attested seat's `{inputHash, outputHash, evidence hash}` and a sealed pointer. The event `proofs.posted` carries the root and pointer; the proofs travel sealed with the work part of the report, because a proof is as sensitive as its request.
- **Settlement reads no proof and waits for none.** Release, refund, fallback and default happen as today. Proving never extends a deadline (`attack.prover-stalls-settlement`).
- **A proof or re-execution never produces a new verdict.** A mismatch is evidence for an appeal, and the appeal panel judges afresh. Nothing is re-rolled.
- An operator may warn (D31, advisory) when `proofWindowSec` ends after the appeal window, since a missing proof could then not be appealed.

### 4. A missing or failing proof is the adjudicator's fault

- Each attested seat ends `proven`, `unproven` (no evidence by the proof deadline) or `failed` (a re-verification by the appeal adjudicator rejected it; a first `NO` may be the checker's own fault).
- **The decision stands** (ADR-0007, finality). A missing proof does not show the work is bad, and invalidating the decision would give a prover outage a stop button.
- **The losing party may appeal on the ground "proof missing or failed"**, as the buyer of an unproven accept or the seller of an unproven reject. The first decision earns no presumption. No party agreed to an unproven judgment, so this is D28's exception, widened from "a party games the judgment" to "the adjudicator fails a duty its bound policy names". The appeal decides as after an escalation (D27a, D27b). If it cannot decide, the default outcome applies with the primary as the defaulting adjudicator. Money already paid stays paid, and any difference is paid from the primary's bond, as an overturn.
- **The primary's bond carries the appeal's cost** whatever the appeal finds: the appellant's bond is returned and its appeal fee reimbursed.
- **A `failed` seat** is evidence of a mislabeled model, an existing ground (`docs/architecture.md:133`), with the same hearing and any bad-faith penalty the rulebook names.
- **The appeal adjudicator's own proofs** have no instance after them (residual 7). A missing one is recorded, counts against its public record (ADR-0014 §1) and is evidence (D26).
- A seat with `attestation: none` has no proof duty.

### 5. No prover integration now; interim kinds first

- **Do not integrate FlashProve, and never split a judgment into proof windows.** Revisit when a maintained, audited prover covers the rendered prompt plus the verdict (8,000 to 32,000 tokens at today's budgets) for an open-weight family usable as a judge.
- **Interim kinds, as priced options (ADR-0014 §4):** `reproducible` for `local` open-weight seats, which any plaintext holder can check (D32: the party that cares runs the check); `tee` for attested open-weight providers, with the TEE.fail caveat; `signed` when a lab offers it.
- **A `zk` registry entry should carry a commitment others can recompute** where the weights are public (FlashProve's `-public-weights` with a published seed; inferred and untested), so no one has to trust the entry's publisher.
- The Anthropic seats stay `none` until Anthropic signs or recomputes its inference.

### 6. Tuning ships as releases; a gate the loop cannot edit promotes

- Each adjudicator may run a loop that proposes candidate registries and policies (model mix, thresholds, prompts, aggregation, sampling) from calibration runs (T-301), red-team results and audits. There is no central tuner.
- **Promotion is outside the loop.** The gate (today 2% false accept, 5% false reject, zero red-team accepts) runs in code the loop cannot edit, on a private held-out set regenerated from the seeded generators with fresh seeds per release and never committed. A named approver who is not the loop signs the log entry. T-305's workflow and `docs/decisions/registry-log.md` extend to policy releases.
- **The gate states counts, not rates:** "0 false accepts in n reject cases", with n published. No loop runs before n reaches about 150 reject cases, the smallest set whose 95% upper bound on zero false accepts is 2% (inferred, rule of three).
- **Appeal outcomes are alerts for a person, never part of the loop's objective** (appeal poisoning). Each release moves a capped step: one notch per threshold, or one template change.
- **Releases bind by hash.** A release is a new `policyHash` or `registryHash`; open deals never change. Pinned model IDs and no re-roll hold. The published log carries aggregates only.

## Alternatives considered

1. **Wait and decide nothing until a prover fits a judge.** The cheapest choice. Parties who want attested seats today (`tee`, `reproducible`) have no way to ask for them, and when a prover arrives the missing-proof rule would be designed under time pressure.
2. **Integrate FlashProve now on a Maverick seat, splitting judgments into 1,024-token windows.** Rejected. Verdicts on fragments are different claims and need a new aggregation rule. Criteria that span rows cannot be judged in a fragment. It costs about 1.4 GB of proofs per first instance and seats a single provable family. The prover is unmaintained and unaudited.
3. **Make a decision valid only once proven.** Strong on paper, but the prover gets a stop button over settlement, which fails the neutrality test. It also reopens finality (ADR-0007).
4. **Let proven seats weigh more, or let an all-proven panel waive the family rule.** Rejected. Today that panel would be single-family. A proof does not fix model error, and correlated error (T8) returns.
5. **Make attestation mandatory on every seat.** It would exclude the Anthropic seats and the default panel, and it takes a choice from the parties without a neutrality reason (ADR-0015).
6. **Give both parties, or the public, the full report.** It would leak the work to a refunded buyer (T9), and publishing it relays any injection the reasoning quotes.
7. **Let the loop promote its own candidates when its metrics pass.** It is fully automatic, but it invites all four Goodhart failures, and an attacker who can move the metric (cheap appeals) moves the policy.

## Consequences

- **Residual 8 narrows for attested seats and is unchanged for `none` seats**, including the default panel. `docs/neutrality.md` gains a prover row:
  - **Can:** post or withhold proofs.
  - **Cannot:** stop or delay settlement, extend a deadline, or change a verdict.
  - **How the deal still completes:** the decision stands, and the losing party gets a fresh hearing paid from the primary's bond.
  - **Fixtures:** `neutrality.prover-offline-after-accept`, `neutrality.prover-offline-buyer-appeals`, `neutrality.prover-offline-after-reject`, `neutrality.prover-offline-fallback-decides` and `neutrality.closed-seat-unattested`. Each starts as `todo.` until a kind is built (research note §9).
- **Attack fixtures:** `attack.proof-fails-verification`, `attack.proof-replay-across-deals`, `attack.prover-stalls-settlement`, `attack.appeal-poisoning-tunes-threshold`, `attack.report-quotes-work-after-refund`.
- **Schema, next version:**
  - registry entry: `attestation`, request settings;
  - policy: `minAttestedSeats`, `attestedKinds`, `proofWindowSec`;
  - judgment record: `reportHash`, and per seat `attestation` and `outputHash`;
  - `ProofBundle` message and `proofs.posted` event;
  - an appeal ground kind, since `grounds` is free text today (`spec/schemas/appeal.schema.json`).

  Every policy hash changes, and so every commitment ID in the fixtures, as with `agg-3`.
- **Rules contract:** an appeal decision on a proof ground carries the primary's bond paying the appellant's costs. This is a Phase 2 contract change, reviewed with T-206's checklist.
- **Request settings move from code to the registry entry.** This changes `registryHash` and is worth doing even without attestation: today two adjudicators publishing the same registry can call the same model differently.
- **Calibration grows first.** T-301's set must reach about 150 reject cases before any tuning loop runs, and the gate text in `docs/judgment-and-defenses.md` changes to counts.
- **The demo is unchanged.** Nothing here is built before Phase 3 calibration (T-301, T-305).
- **Found in passing, outside this ADR:** today the evidence strings and rationale already reach a refunded buyer, at most 4,500 characters per judge, and they may quote the work. The report's work part (§1) fixes this for the report, not for the verdict. Backlog row added.

## Litmus tests

- **Neutrality: passes.** Settlement reads no proof, so a prover that refuses or goes offline stops nothing (the prover row and its fixtures). For open-weight seats any plaintext holder can re-check, so no single prover is required. Tuning has no central tuner, and each release binds only the commitments signed under it.
- **The hold: passes and is tightened.** No new money path moves funds without a decision or timeout; finality holds; the report's work part and the proofs follow the work's key, so a refunded buyer gets no work through the report.
- **Defended multi-model judgment: passes and is strengthened.**
  - Deterministic checks still run first.
  - The two-family rule is untouched and comes before attestation.
  - Pinned IDs and no re-roll hold: a proof or re-execution never yields a new verdict.
  - Judge output still matches the verdict schema.
  - Deliverables stay untrusted, and the report is data for every reader.
  - The bond backs the new appeal ground.
  - Residual 8 closes seat by seat as attestation kinds arrive.

## Open questions for Rafa

1. **Should attestation ever relax the two-family rule?** An all-proven panel is single-family today. Recommended: never (§2).
2. **Should a missing proof widen D28's exception to the adjudicator's own failures**, so the losing party gets a fresh hearing paid from the primary's bond? Recommended: yes (§4).
3. **Who promotes a tuned release?** The options are a gate the loop cannot edit plus a named approver, or the gate alone. Recommended: gate plus approver, and no loop until calibration reaches about 150 reject cases (§6).

## What would change this decision

- A lab that signs or recomputes its inference for customers: the Anthropic seats could become `signed`.
- A maintained, audited prover with judge-sized windows for a second open-weight family: `zk` seats become practical, and a fully proven two-family panel becomes possible.
- A TEE break that forges receipts remotely, with no physical access: drop `tee` as a kind.
