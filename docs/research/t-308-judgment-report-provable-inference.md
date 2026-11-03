# Judgment report, provable inference and auto-tuning (T-308 research pass)

- **Date:** 2026-11-03. **Status:** research; feeds ADR-0027 (Proposed). No code, schema or fixture changed.
- **Method:** a Fable max-effort pass read Anthropic's FlashProve post, technical report and repository (v0.16.0), provider docs, the TEE.fail paper site, the comparison literature and this repository. The lead session re-read the FlashProve README and `docs/what-is-not-hidden.md` through `gh api` to check the load-bearing claims. Labels: **measured** (read in a primary source or the repo, cited), **inferred** (reasoned from measured facts), **guessed**. All web sources accessed 2026-11-03.
- **Question** (`docs/backlog.md`, the T-308 row under Judgment defenses): can the adjudicator (1) report its whole judgment, (2) prove the pinned models produced it, as in FlashProve, and (3) tune itself from outcomes, without breaking the three litmus tests?

## Answer in brief

1. **FlashProve cannot prove a ’crow judge today.** It proves one model (Llama 4 Maverick's text transformer) in a 1,024-token window that holds the prompt and the reply together, greedy decoding only, and it is an unmaintained, unaudited research artifact. A judge's fixed prompt template alone takes over 40% of that window, and its data can be 25 times the window.
2. **Adopt the shape now and the prover later.** Each registry seat gets an attestation kind; the policy names how many attested seats the parties want (default 0); proofs are post hoc, sealed, and never gate settlement; a missing proof is the adjudicator's fault, never the buyer's burden.
3. **Proofs never replace families.** A proof answers "which model answered" (residual 8). Family diversity answers correlated error (T8). An all-proven panel today would be single-family.
4. **The Anthropic seats can never be proven** with FlashProve: Claude takes no sampling parameters, no weight commitment exists, and the reasoning Claude returns is a summary written by a different model.
5. **The report is mostly already there.** The live panel returns no reasoning text (DeepSeek thinking is off; Claude's thinking display is omitted). What the report adds is the raw outputs and the per-stage detail, and its work-quoting parts must follow the hold.
6. **Tuning loops propose, a gate promotes.** The 40-case calibration set cannot measure the 2% false-accept gate it is meant to enforce.

## 1. What FlashProve proves

| Property | What the source says | Label |
| --- | --- | --- |
| Status | "A research artifact: not maintained, not accepting contributions." Version 0.16.0, Apache 2.0. "No independent security audit." The technical paper "was AI-generated, and we did not review it in detail"; the GPU prover and C++ verifier are AI-generated from Lean and not proved equivalent | measured: [README](https://github.com/anthropics/FlashProve), `guide/what-is-proved.md`, [blog](https://www.anthropic.com/research/provable-inference) |
| Models | "The only model defined is Llama 4 Maverick's text transformer." Another architecture "would need a new definition, new scales, and a new soundness argument" | measured: `docs/model.md`, `docs/operators-duties.md` |
| Window | 1,024 tokens: prompt, then reply, then filler. "The page does not describe a method for replies longer than that" | measured: [technical report](https://www.anthropic.com/document/flashprove-technical-report) §6; `docs/verifying.md` |
| Decoding | "Only greedy replies (temperature 0) get proofs." The proof covers an integer version of the weights (12-bit), which "approximates the floating-point model and is not equal to it" | measured: `docs/operators-duties.md`; report §6 to §7 |
| Weaker policy | Under "clipped gap", 28 of 32 replies with one token swapped for the second choice still passed | measured: `docs/results.md` |
| Speed | One H100 80 GB, about 300 GB host RAM: a batch of 24 requests in about 223 s, "110 tokens per second" counting all window tokens; 39.1 tokens/s counting checked tokens; one request alone 58 s. About 72 times the GPU time of FP8 prefill | measured: report §6; `guide/performance.md` |
| Proof and check | 18.78 MB per request; verification 17 s on 24 threads (36 to 44 s on a shared VM), 3.5 GB RAM, no weights | measured: report §6 |
| Timing | Post hoc: replies are served first, proofs are made later "via recomputation using the finished transcript". It "only ensures tampering will be detected" | measured: report appendix |
| Commitment | Made by the weight holder with a secret seed, so not recomputable from the weights; "No theorem ties a commitment to one set of public files or one policy"; the verifier must get the ID from a trusted party, out of band | measured: `guide/what-is-proved.md`; `docs/operators-duties.md` |
| Public weights | `-public-weights` reads the seed from a file and "nothing is claimed to be hidden". No client can tell such a commitment from an ordinary one | measured: `docs/what-is-not-hidden.md` |
| Binds | Prompt token IDs, reply token IDs, the committed integer model. Not: tokenization, output length, the policy, or whether the reply a client got is the one proven. Freshness needs a nonce in the prompt | measured: `guide/what-is-proved.md`, `docs/limits.md` |
| Privacy | "A proof file is as sensitive as its request" | measured: `docs/what-is-not-hidden.md` |
| Claude | No Claude weights or commitment are released. A separate internal prototype "signs our inference traffic and recomputes inference on a trusted server" | measured: blog, footnote 3 |

**The backlog row overstates it.** "Mixture-of-experts models only" is one model shape; DeepSeek V4, Qwen3, gpt-oss and Kimi K2 are MoEs FlashProve does not define (inferred from `docs/model.md` and their Hugging Face configs). "Contexts up to 1,024 tokens" is prompt plus reply plus padding. "110 tokens/s" counts window tokens; per checked token it is 39.1. "A proof can cover the reasoning" holds only inside the window and never for Claude (§5).

**Inferred, untested:** with `-public-weights` and a published seed file, anyone holding the public weights could rerun the commitment and compare IDs, which would make a registry entry checkable without trusting its publisher. No test or theorem covers this.

## 2. Fitting a judge into the window

- **Today's prompt** (measured): the fixed first-instance template is 1,746 characters with its placeholders unfilled, about 440 tokens at 4 characters a token (`packages/judgment/src/prompt.ts:20-44`); then the agreed terms as JSON; then up to `DEFAULT_MAX_DATA_CHARS = 100_000` characters of spotlighted data (`prompt.ts:59`). The live output cap is 8,192 tokens, reasoning included (`apps/adjudicator/src/providers/live.ts:19-21`). A 60,000-token deliverable has been judged live (`live.ts:96`).
- **It cannot fit** (inferred): template plus terms is 700 to 900 tokens before any data or reply; a full sample is about 25,000 tokens.
- **Splitting into checked windows is unsound for this pipeline** (inferred). A verdict is a function of the whole sample; verdicts on fragments are different claims and need a new aggregation rule. Criteria that span rows (duplicates, coverage, consistency) cannot be judged in a fragment. A two-stage design (an unproven reader, then a proven verdict) proves only the stage that was never in doubt. Cost: about 75 proofs, 12 minutes of prover time and 1.4 GB of proofs per three-judge first instance.
- **Recommendation:** do not split. Wait for a prover whose window holds the rendered prompt plus the verdict (8k to 32k tokens today), which the authors list as future work (measured: blog). The prompt is already recomputable: `inputHash` covers the full rendered prompt, and the boundary and canary nonces derive from the revealed seed (measured: `packages/judgment/src/panel.ts:72`), so a later prover or re-executor can rebuild the exact prompt from the plaintext.

## 3. Who proves, and why it cannot halt settlement

- **The weight holder proves** (measured: report appendix; the secret key directory needs a dedicated machine, "Rented hardware is ruled out"). For a closed model only the lab can prove. For open weights, the adjudicator running `providerPrivacy: local` judges can (inferred).
- **Settlement never reads a proof** (inferred from the post-hoc design and ADR-0007). Release, refund, fallback and default all happen without one, so a prover that refuses or dies stops nothing. A proof is a duty of the adjudicator under its bound policy, like key release (T19).
- **Open-weight seats have substitutable provers** (inferred): anyone holding the plaintext and the public weights can re-run a deterministic seat and check the reply. The buyer holds the plaintext after release; the appeal adjudicator gets the key when it takes over (ADR-0024 §5).
- **On chain or on the public log: a hash and a pointer only.** Proofs are large and as sensitive as the deliverable, so they belong sealed with the record (inferred).
- **A deadline:** proofs are due a policy-set time after the decision, short enough that the losing party can still appeal on a missing proof (inferred; the parties set the value, D31).

## 4. A missing proof, D28 and the bond

- **D28's burden is about the work** (measured: `docs/decisions-today.md`, D28): an appealing buyer must show the work fails the terms, unless a party gamed the judgment. A proof is not about the work. It is the adjudicator performing the policy the commitment binds by `policyHash`. So a missing proof is the adjudicator's fault, like a missed key release or a missed deadline (inferred).
- **The decision stands** (inferred). In `guaranteed_on_decision` "the payee's money is final at the decision; an overturn pays from the bond" (measured: ADR-0007, Finality). Invalidating a decision for a missing proof would give a prover outage a stop button.
- **The losing party gets a fresh hearing** (inferred). An unproven decision earns no presumption: no party agreed to an unproven judgment, which is D28's own exception. The appeal decides as after an escalation (D27a, D27b), and the primary's bond pays any reversal. Symmetric: the buyer appeals an unproven accept, the seller an unproven reject.
- **A failing proof** counts only after the appeal adjudicator re-verifies it, since an honest proof can be rejected on the checker's side (measured: `docs/verifying.md`). Then it is evidence of a mislabeled model, an existing appeal ground (measured: `docs/architecture.md:133`).
- **Collusion check** (inferred): an adjudicator that withholds proofs to help one party pays that party from its own first-loss bond. That is a transfer, not a gain, and it is bounded like T18.

## 5. The closed-model seat

- **Facts** (measured): Claude Sonnet 5.5 "Sampling parameters return an error" ([migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)); the live adapter sends none (`live.ts:79-87`). Claude's thinking text is a summary, and "Summarization is processed by a different model"; `display` defaults to omitted; no setting returns the raw chain of thought ([Thinking docs](https://platform.claude.com/docs/en/build-with-claude/thinking)). No lab publishes a weight commitment or signs responses.
- **So** (inferred): an Anthropic seat cannot be greedy, cannot be served as an integer model and has no commitment. It stays unattested until Anthropic ships signed or recomputed inference (its prototype, blog footnote 3).
- **Open-weight MoE families exist** (measured: Hugging Face model API): DeepSeek-V4-Pro (MIT, 6 experts per token), Qwen3-235B-A22B (Apache-2.0), gpt-oss-120b (Apache-2.0), Kimi K2 (modified MIT), Llama 4 Maverick (Meta licence). Only Maverick is provable today. A `local` DeepSeek seat is pinnable by weight hash, which the API alias is not (measured: `docs/decisions/registry-log.md`).
- **Options:** (a) open-weight proven families when a prover covers them: the end state; (b) provider-signed responses: none offered; (c) TEE-attested closed inference: none offered; (d) proven seats weigh more: rejected, it lets one proven family dominate (T8); (e) **a per-seat attestation kind and a party-chosen minimum of attested seats: recommended**, default 0.

## 6. The full report

- **What exists** (measured): the signed record already holds every check, the screen signals, each seat's status, `inputHash`, verdict, evidence strings (up to 12 × 300 characters), rationale (600) and the aggregation (`spec/schemas/judgment.schema.json`, `judge-verdict.schema.json`). The live panel produces no reasoning text: Anthropic calls send no `display`; DeepSeek calls send `thinking: { type: 'disabled' }` (`live.ts:87,99`). Turning DeepSeek thinking on costs budget: at 2,048 tokens `deepseek-flash` "spent the whole budget reasoning" (measured: registry log).
- **What the report adds:** each seat's raw output as returned (including any reasoning, labeled full or summary), the filter's reason when it abstains a judge, the reader's features and the sample the judges saw.
- **It must follow the hold** (inferred). D26 gives both parties the same record, but "the work itself still follows the hold" (measured: D26). Raw outputs and reasoning quote the work. On a refund the seller keeps the work, so a buyer who received the full report would get pieces of it for free (T9). Existing exposure: the evidence strings and rationale already reach the buyer on a refund, at most 4,500 characters per judge (12 × 300 evidence, 300 injection evidence, 600 rationale; inferred from the schema caps and ADR-0024's "Buyer and seller always").
- **It is data, never instruction**, for every reader (ADR-0021, T22): the reasoning is derived from untrusted deliverables and will quote injections.
- **Appeal judges never see it: confirmed.** The appeal template says judges "decide afresh and are not told the first decision" (measured: `prompt.ts:48-52`). Reasons: it would relay an injection, anchor the appeal (T8), and D28 asks the appeal to judge the work, not the reasoning (inferred). The appeal adjudicator's code may read the report and proofs to verify them; its judges may not.
- **Releasing reasoning after the decision helps a gaming seller little** (inferred): the pinned models, the template and the policy are public, so a seller can already probe the judges offline; the seed-dependent parts change per deal. The defenses stay the secret seed, the screen, no re-roll and `maxSubmissions`.

## 7. Safe tuning loops

- **Goodhart, four ways** (measured: [Manheim and Garrabrant 2018](https://arxiv.org/abs/1803.04585)). Regressional: selecting on calibration score picks up calibration noise. Extremal: thresholds tuned on synthetic cleaning cases break on real deliveries. Causal: appeal outcomes come from the appeal adjudicator the parties chose, which is not ground truth. Adversarial: sellers craft deliveries and file appeals to move thresholds (mapping inferred).
- **Static red-team sets overfit.** NIST CAISI: new attacks raised hijack success from 11% to 81% (measured: [NIST](https://www.nist.gov/node/1872381)). "The Attacker Moves Second" bypassed 12 defenses at above 90% for most, which had reported near-zero (measured: [arXiv 2510.09023](https://arxiv.org/abs/2510.09023)).
- **The gate cannot see its own threshold** (inferred). The promotion rule allows 2% false accepts on about 40 cases, about 15 of them rejects (measured: `docs/judgment-and-defenses.md`, Calibration). One false accept in 15 is 6.7%, so the gate means zero in 15, whose 95% upper bound is about 18%. The set must grow by an order of magnitude, or the gate must be stated as "zero in n" with n published.
- **Appeal poisoning** (inferred). An overturn costs an attacker the appeal fee plus a 5% bond (measured: `fixtures/clubs/data-services-v1.yaml`), and a colluding seller and appeal bench can make overturns cheaply. So appeal outcomes are alerts for a person, never part of the loop's objective.
- **Guards:** a private held-out set regenerated from the seeded generators with fresh seeds per release and never committed; the gate in code the loop cannot edit; a capped step per release; promotion as a new `policyHash` or `registryHash`, so open deals never change; a published log of aggregates only (ADR-0020 §4). Pinning holds: it is per commitment by hash, not frozen over time.

## 8. Alternatives compared

| Scheme | Proves | Trusts | Cost | Closed models | Fit |
| --- | --- | --- | --- | --- | --- |
| zkSNARK (FlashProve) | This committed integer model produced these tokens from these tokens | Hash-based crypto; the commitment's publisher; an unaudited verifier | About 72× GPU time; 18.78 MB per request; 17 to 44 s to check; 1,024-token window; one model (measured, §1) | None | Post hoc, never gates settlement. The target, not yet usable |
| TEE attestation with signed receipts | A measured stack on attested hardware produced this output; the model only if the weights hash is in the measurement | Intel, AMD or NVIDIA keys and the host's physical custody. [TEE.fail](https://tee.fail/): a sub-$1,000 DDR5 interposer forged TDX quotes; NVIDIA GPU attestation is not bound to the CVM and can be relayed (measured) | Near inference cost. Offered for open weights by Venice, Phala, NEAR AI (measured: their docs) | None offered | A priced option (ADR-0014 §4) with the TEE.fail caveat (ADR-0020 §5) |
| Provider-signed responses | The provider asserts model, input and output | The provider | Negligible | Would cover them; none offered. [IETF receipts draft](https://datatracker.ietf.org/doc/draft-chueayen-attestation-receipts/) says it does not prove the model ran (measured) | Turns residual 8 into "the lab lied", which is court-grade evidence (D26) |
| Re-execution by a plaintext holder | The pinned open weights on this engine reproduce these tokens | An equivalent engine. Batch-invariant kernels gave 1,000 of 1,000 identical temperature-0 completions ([Thinking Machines](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)); Token-DiFR detects 4-bit quantization at AUC above 0.999 within 300 tokens ([arXiv 2511.20621](https://arxiv.org/abs/2511.20621)) (measured) | One forward pass per check; 1.6 to 2× engine slowdown for determinism | None | **The practical interim for `local` seats.** Anyone with the plaintext can check; fits D32 |
| Optimistic fraud proofs (opML, Verde) | Correct unless challenged, if one re-executor is honest ([arXiv 2502.19405](https://arxiv.org/abs/2502.19405)) | A referee and bit-reproducible operators | Low; a challenge window | None | A new actor and deadline; ’crow's appeal already is the optimistic layer |
| Sampling proofs (TOPLOC, PoSP) | TOPLOC: activation fingerprints, 258 bytes per 32 tokens, empirical ([arXiv 2501.16007](https://arxiv.org/abs/2501.16007)) | A reference run; PoSP needs staked validators | Small | None | TOPLOC is a cheap fingerprint a `local` seat can publish |

## 9. Fixtures to write when built

`todo.` until a prover or re-executor exists (`docs/testing.md`). Balances follow the demo club (price 2,000, fee 50, appeal fee 25, appeal bond 100, adjudicator bonds 25,000).

| Fixture | Scenario | End state |
| --- | --- | --- |
| `neutrality.prover-offline-after-accept` | Two attested seats; the primary accepts; its prover never posts by the proof deadline; nobody appeals | Released at the decision; seats recorded unproven; no money moves for the missing proof |
| `neutrality.prover-offline-buyer-appeals` | As above; the buyer appeals on the missing proof; the appeal panel passes | Released stands; the appellant's bond is returned and its appeal fee reimbursed from the primary's bond |
| `neutrality.prover-offline-after-reject` | The primary rejects; no proofs; the seller appeals; the appeal panel fails the work | Refunded stands; the seller's appeal costs paid from the primary's bond |
| `neutrality.prover-offline-fallback-decides` | The primary is silent; the fallback decides and its prover is offline | The same rule on the fallback's bond |
| `neutrality.closed-seat-unattested` | Anthropic seats `none`, DeepSeek seats `tee`; the receipt service is down after a served call | That seat is unproven; the decision rule is unchanged |
| `attack.proof-fails-verification` | The primary ran a cheaper model under the pinned name; the appeal adjudicator's verifier rejects its proof | Fresh hearing; a reversal pays 2,000 from the primary's bond |
| `attack.proof-replay-across-deals` | A proof from another deal with the same template and rows | Fails: the nonces derive from the seed, so the token IDs differ |
| `attack.prover-stalls-settlement` | The primary withholds its decision "until the proof is ready" past `judgeBy` | The fallback decides; proving never extends a deadline |
| `attack.appeal-poisoning-tunes-threshold` | A seller files losing appeals across deals | The loop's candidate does not cross the gate; rejected in the log |
| `attack.report-quotes-work-after-refund` | The rubric fails; the full report quotes rows | The buyer's part of the report holds no work-quoting text |

## Sources

- Anthropic, "Provable inference", 2026-11-02: https://www.anthropic.com/research/provable-inference
- FlashProve technical report, November 2026: https://www.anthropic.com/document/flashprove-technical-report
- FlashProve repository v0.16.0 and its `docs/` and `guide/` pages: https://github.com/anthropics/FlashProve
- Anthropic docs: Thinking, https://platform.claude.com/docs/en/build-with-claude/thinking; Claude Sonnet 5.5 migration guide, https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
- DeepSeek, Thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
- Hugging Face model API: DeepSeek-V4-Pro, Qwen3-235B-A22B-Instruct-2507, gpt-oss-120b, Kimi-K2-Instruct (https://huggingface.co/api/models/…)
- TEE.fail (IEEE S&P '26): https://tee.fail/
- Venice, https://docs.venice.ai/guides/features/tee-e2ee-models.md; Phala, https://docs.phala.com/phala-cloud/confidential-ai/verify/verify-attestation; NEAR AI, https://docs.near.ai/cloud/private-inference
- IETF draft-chueayen-attestation-receipts-05 (individual, 2026-10-25): https://datatracker.ietf.org/doc/draft-chueayen-attestation-receipts/
- Thinking Machines, "Defeating Nondeterminism in LLM Inference", 2025-09-10: https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- Karvonen et al., "DiFR", arXiv 2511.20621; TOPLOC, arXiv 2501.16007; Proof of Sampling, arXiv 2405.00295; opML, arXiv 2401.17555; Verde, arXiv 2502.19405; zkLLM, arXiv 2404.16109
- Manheim and Garrabrant, arXiv 1803.04585; NIST CAISI, https://www.nist.gov/node/1872381; Nasr, Carlini et al., arXiv 2510.09023
- The full findings, with every claim labeled and line-cited: the research pass's working file is not committed; this note keeps its load-bearing claims.
