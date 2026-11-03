# Judgment report, provable inference and auto-tuning (T-308 research pass)

- **Date:** 2026-11-03. **Status:** research; feeds ADR-0027 (Proposed). No code, schema or fixture changed.
- **Method:** a Fable max-effort pass read Anthropic's FlashProve post, technical report and repository (v0.16.0), provider docs, the TEE.fail paper site, the comparison literature and this repository. The lead session re-read the FlashProve README and `docs/what-is-not-hidden.md` through `gh api` to check the load-bearing claims. The PR 115 reviews followed: the `reviewer` role (Opus 5.5) re-checked 23 repo citations and the FlashProve claims, and a red team (Sonnet 5.5) attacked the remedies. Their corrections are folded in and marked. Labels: **measured** (read in a primary source or the repo, cited), **inferred** (reasoned from measured facts), **guessed**. All web sources accessed 2026-11-03.
- **Question** (`docs/backlog.md`, the T-308 row under Judgment defenses): can the adjudicator (1) report its whole judgment, (2) prove the pinned models produced it, as in FlashProve, and (3) tune itself from outcomes, without breaking the three litmus tests?

## Answer in brief

1. **FlashProve cannot prove a ’crow judge today.** It proves one model (Llama 4 Maverick's text transformer) in a 1,024-token window that holds the prompt and the reply together, greedy decoding only, and it is an unmaintained, unaudited research artifact. A judge's fixed prompt template alone takes over 40% of that window, and its data can be 25 times the window.
2. **Adopt the shape now and the prover later.**
   - Each registry seat gets an attestation kind.
   - The policy names how many attested seats the parties want (default 0).
   - Proofs are post hoc, sealed, and never gate settlement.
   - A missing proof is the adjudicator's fault, never the buyer's burden. Plain absence costs a fixed penalty from the adjudicator's own stake; every other proof problem is evidence; the merits are never re-tried.
3. **Proofs never replace families.** A proof answers "which model answered" (residual 8). Family diversity answers correlated error (T8). An all-proven panel today would be single-family.
4. **The Anthropic seats cannot be proven with FlashProve today.**
   - Claude takes no sampling parameters.
   - No weight commitment exists.
   - The reasoning Claude returns is a summary written by a different model.

   That holds until Anthropic publishes a commitment and serves greedy integer inference, or signs its responses.
5. **The report is mostly already there.** The live panel returns no reasoning text: DeepSeek's thinking is off and Claude's thinking display is omitted. The report adds the raw outputs and the per-stage detail. Every free-text field that can quote the work must follow the hold, and that includes fields in today's record.
6. **Tuning loops propose, a gate promotes.** The 40-case calibration set cannot measure the 2% false-accept gate it is meant to enforce.

## 1. What FlashProve proves

| Property | What the source says | Label |
| --- | --- | --- |
| Status | "A research artifact: not maintained, not accepting contributions." Version 0.16.0, Apache 2.0. "No independent security audit" | measured: [README](https://github.com/anthropics/FlashProve), `guide/what-is-proved.md` |
| Authorship | The technical paper "was AI-generated, and we did not review it in detail"; the GPU prover and C++ verifier are AI-generated from Lean and not proved equivalent | measured: [technical report](https://www.anthropic.com/document/flashprove-technical-report) §7 |
| Models | "The only model defined is Llama 4 Maverick's text transformer." Another architecture "would need a new definition, new scales, and a new soundness argument" | measured: `docs/model.md`, `docs/operators-duties.md` |
| Window | 1,024 tokens: prompt, then reply, then filler. "The page does not describe a method for replies longer than that" | measured: [technical report](https://www.anthropic.com/document/flashprove-technical-report) §6; `docs/verifying.md` |
| Decoding | Greedy only: the vLLM integration "is for greedy replies (temperature 0): sampled replies get no proof". The proof covers an integer version of the weights (12-bit), which "approximates the floating-point model and is not equal to it" | measured: `docs/operators-duties.md:15`; `docs/model.md:10` |
| Weaker policy | Under "clipped gap", 28 of 32 replies with one token swapped for the second choice still passed | measured: `docs/results.md` |
| Speed | One H100 80 GB, about 300 GB host RAM: a batch of 24 requests in about 223 s, "110 tokens per second" counting all window tokens; 39.1 tokens/s counting reply tokens only, measured under the looser clipped-gap policy; one request alone 58 s. About 72 times the GPU time of FP8 prefill | measured: report §6; `guide/performance.md` |
| Proof and check | 18.78 MB per request; verification 17 s on 24 threads (36 to 44 s on a shared VM), 3.5 GB RAM, no weights | measured: report §6 |
| Timing | Post hoc: replies are served first, proofs are made later "via recomputation using the finished transcript". It "only ensures tampering will be detected" | measured: report appendix |
| Commitment | Made by the weight holder with a secret seed, so not recomputable from the weights; "No theorem ties a commitment to one set of public files or one policy"; the verifier must get the ID from a trusted party, out of band | measured: `guide/what-is-proved.md`; `docs/operators-duties.md` |
| Public weights | `-public-weights` reads the seed from a file and "nothing is claimed to be hidden". No client can tell such a commitment from an ordinary one | measured: `docs/what-is-not-hidden.md` |
| Binds | Prompt token IDs, reply token IDs, the committed integer model. Not: tokenization, output length, the policy, or whether the reply a client got is the one proven. Freshness needs a nonce in the prompt | measured: `guide/what-is-proved.md`, `docs/limits.md` |
| Privacy | "A proof file is as sensitive as its request" | measured: `docs/what-is-not-hidden.md` |
| Claude | No Claude weights or commitment are released. A separate internal prototype "signs our inference traffic and recomputes inference on a trusted server" | measured: blog, footnote 3 |

**The backlog row overstates it.** "Mixture-of-experts models only" is one model shape; DeepSeek V4, Qwen3, gpt-oss and Kimi K2 are MoEs FlashProve does not define (inferred from `docs/model.md` and their Hugging Face configs). "Contexts up to 1,024 tokens" is prompt plus reply plus padding. "110 tokens/s" counts window tokens; per reply token it is 39.1, and that under the clipped-gap policy. "A proof can cover the reasoning" holds only inside the window and never for Claude (§5).

**Inferred, untested:** with `-public-weights` and a published seed file, anyone holding the public weights could rerun the commitment and compare IDs, which would make a registry entry checkable without trusting its publisher. No test or theorem covers this.

## 2. Fitting a judge into the window

- **Today's prompt** (measured):
  - the fixed first-instance template, 1,746 characters with its placeholders unfilled (`packages/judgment/src/prompt.ts:20-44`), which is about 440 tokens at 4 characters a token (inferred: no Llama tokenizer was run);
  - then the agreed terms as JSON;
  - then up to `DEFAULT_MAX_DATA_CHARS = 100_000` characters of spotlighted data (`prompt.ts:59`).

  The live output cap is 8,192 tokens, reasoning included (`apps/adjudicator/src/providers/live.ts:19-24`). A 60,000-token deliverable has been judged live (`live.ts:96`).
- **It cannot fit** (inferred): template plus terms is 700 to 900 tokens before any data or reply; a full sample is about 25,000 tokens.
- **Splitting into checked windows is unsound for this pipeline** (inferred). A verdict is a function of the whole sample; verdicts on fragments are different claims and need a new aggregation rule. Criteria that span rows (duplicates, coverage, consistency) cannot be judged in a fragment. A two-stage design (an unproven reader, then a proven verdict) proves only the stage that was never in doubt. Cost: each window repeats the template and terms and must hold the verdict, leaving under 100 tokens of data, so a three-judge first instance needs about 1,000 proofs, 19 GB and 2.5 hours of prover time.
- **Recommendation:** do not split. Wait for a prover whose window holds the rendered prompt plus the verdict (8k to 32k tokens today), which the authors list as future work (measured: blog). The prompt is already recomputable: `inputHash` covers the full rendered prompt, and the boundary and canary nonces derive from the revealed seed (measured: `packages/judgment/src/panel.ts:72`), so a later prover or re-executor can rebuild the exact prompt from the plaintext.

## 3. Who proves, and why it cannot halt settlement

- **The weight holder proves** (measured: report appendix; the secret key directory needs a dedicated machine, "which rules out a rented one", `guide/serving.md:26`). For a closed model only the lab can prove. For open weights, the adjudicator running `providerPrivacy: local` judges can (inferred).
- **Settlement never reads a proof** (inferred from the post-hoc design and ADR-0007). Release, refund, fallback and default all happen without one, so a prover that refuses or dies stops nothing. A proof is a duty of the adjudicator under its bound policy, like key release (T19).
- **Open-weight seats have substitutable provers** (inferred): anyone holding the plaintext and the public weights can re-run a deterministic seat and check the reply. The buyer holds the plaintext after release; the appeal adjudicator gets the key when it takes over (ADR-0024 §5).
- **On chain or on the public log: a hash and a pointer only.** Proofs are large and as sensitive as the deliverable, so they belong sealed with the record (inferred). If the root is recorded on the settlement layer (submittable by anyone, the escape hatch), "no proof by the deadline" becomes a fact settlement can check, and an operator cannot hide an honest adjudicator's proofs (inferred; raised in review).
- **A deadline:** proofs are due a policy-set time after the decision, counted on settlement's own clock. The parties set the value (D31), and an adjudicator declines a window its prover cannot meet (inferred).

## 4. A missing proof, D28 and the bond

- **D28's burden is about the work** (measured: `docs/decisions-today.md`, D28): an appealing buyer must show the work fails the terms, unless a party gamed the judgment. A proof is not about the work. It is the adjudicator performing the policy the commitment binds by `policyHash`. So a missing proof is the adjudicator's fault, like a missed key release or a missed deadline (inferred).
- **The decision stands** (inferred). In `guaranteed_on_decision` "the payee's money is final at the decision; an overturn pays from the bond" (measured: ADR-0007, Finality). Invalidating a decision for a missing proof would give a prover outage a stop button.
- **The research pass first recommended a fresh hearing** (inferred). On that view an unproven decision earns no presumption, because no party agreed to an unproven judgment, which is D28's own exception. The appeal would decide as after an escalation (D27a, D27b), and the primary's bond would pay any reversal.
- **Review found that remedy can be gamed** (inferred). FlashProve warns that "even an honest prover may fail to convince the verifier", and the integer model's match with float inference "does not cover adversarially designed prompts" (measured: report §7). Both parties shape the prompt: the seller writes the delivery, the buyer the rubric. A party that could make a proof fail would then win split appeals and default outcomes against honest work.
- **A free appeal fails too** (red team, inferred). It sits outside the 100% coverage encumbrance. One provider outage gives every open deal's loser a free option, and a merits ground can be stacked onto the proof ground.
- **ADR-0027 separates the duty from the merits, and pays only on plain absence** (after two review rounds).
  - Each decision states how many attested seats it seated (`attestedSeatsSeated`, recomputable from the seed). If that is above 0 and no proof root is stored on the settlement layer by the deadline, anyone may trigger a timeout. It pays a party-chosen `proofMissPenalty` to the losing party, from the decider's own junior tranche.
  - Nothing else pays: a failing proof, an abstained attested seat, a rotated measurement, a re-execution outside tolerance. Each is evidence for an ordinary appeal, for the mislabeled-model ground and for a court.
  - The merits are never re-tried, so D28 and D27c are unchanged.
- **Why not pay on a failing proof** (red team round 2, inferred). A seller can make a judge abstain with one injected URL (the existing `attack.injection-filter-abstain-appeal-default`). A seller can also craft a delivery an honest prover cannot prove. Paying on either rewards the party that caused it. The timeout therefore catches absence, not faking. A root that does not verify is a signed, attributable claim, which is evidence.
- **Why only the junior tranche** (red team round 2, inferred). From the whole bond, a shell adjudicator with a 10% first-loss share and a colluding party could sign a penalty ten times its stake. They would then move backers' money on a timer, with no panel and no appeal adjudicator. From the junior tranche, they move only the adjudicator's own stake. A rulebook may also cap the penalty.

## 5. The closed-model seat

- **Facts** (measured): Claude Sonnet 5.5 "Sampling parameters return an error" ([migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)); the live adapter sends none (`live.ts:79-87`). Claude's thinking text is a summary, and "Summarization is processed by a different model"; `display` defaults to omitted; no setting returns the raw chain of thought ([Thinking docs](https://platform.claude.com/docs/en/build-with-claude/thinking)). No lab publishes a weight commitment or signs responses.
- **So** (inferred): an Anthropic seat cannot be greedy, cannot be served as an integer model and has no commitment. It stays unattested until Anthropic ships signed or recomputed inference (its prototype, blog footnote 3).
- **Open-weight MoE families exist** (measured: Hugging Face model API): DeepSeek-V4-Pro (MIT, 6 experts per token), Qwen3-235B-A22B (Apache-2.0), gpt-oss-120b (Apache-2.0), Kimi K2 (modified MIT), Llama 4 Maverick (Meta licence). Only Maverick is provable today. The DeepSeek API names are aliases, not snapshots (measured: `docs/decisions/registry-log.md:21`). A `local` DeepSeek seat would be pinnable by the published weights' hash (inferred).
- **Options:** (a) open-weight proven families when a prover covers them: the end state; (b) provider-signed responses: none offered; (c) TEE-attested closed inference: none offered; (d) proven seats weigh more: rejected, it lets one proven family dominate (T8); (e) **a per-seat attestation kind and a party-chosen minimum of attested seats: recommended**, default 0.

## 6. The full report

- **What exists** (measured): the signed record already holds every check, the screen signals, each seat's status, `inputHash`, verdict, evidence strings (up to 12 × 300 characters), rationale (600) and the aggregation (`spec/schemas/judgment.schema.json`, `judge-verdict.schema.json`). The live panel produces no reasoning text: Anthropic calls send no `display`; DeepSeek calls send `thinking: { type: 'disabled' }` (`live.ts:87,99`). Turning DeepSeek thinking on costs budget: at 2,048 tokens `deepseek-flash` "spent the whole budget reasoning" (measured: registry log).
- **What the report adds:** each seat's raw output as returned (including any reasoning, labeled full or summary), the filter's reason when it abstains a judge, the reader's features and the sample the judges saw.
- **Its work-quoting part must follow the hold** (inferred). D26 gives both parties the same record, but "the work itself still follows the hold" (measured: D26). On a refund the seller keeps the work, so a buyer who received the full report would get pieces of it for free (T9). So the report splits:
  - a record part of typed fields only, for both parties;
  - a work part with every free-text field that can quote the work: raw outputs, verdict strings, check details, the reader's features. It is encrypted under a key derived from the work's content key. The judges' sample is the work itself, so it is not stored; it is recomputed from the plaintext and the seed (reviewer round 3).

  Screen-signal details and aggregate reasons carry fixed labels, IDs and counts, and stay in the record part (measured: `packages/judgment/src/screen.ts:3`, "Signal details never quote the deliverable"; reviewer round 2).
- **The record already has this exposure, and a buyer can engineer it** (red team, inferred from reading `packages/judgment/src/checks/`). Check details can carry the deliverable's JSON property names and CSV headers. A buyer can write evidence-anchored criteria ("quote the rows that violate c3"), arrange a failing one and take the refund. At `judgment` and `public` the record is readable by anyone. ADR-0027 applies the same split to the existing record, which is open question 1 for Rafa. Today, on a refund, the buyer gets (inferred from the schema caps and ADR-0024's "Buyer and seller always"):
  - per judge, up to 4,500 characters of verdict strings (12 × 300 evidence, 300 injection evidence, 600 rationale);
  - per check, a 300-character detail.
- **It is data, never instruction**, for every reader (ADR-0021, T22): the reasoning is derived from untrusted deliverables and will quote injections.
- **Appeal judges never see it: confirmed.** The appeal template says judges "decide afresh and are not told the first decision" (measured: `prompt.ts:48-52`). Reasons: it would relay an injection, anchor the appeal (T8), and D28 asks the appeal to judge the work, not the reasoning (inferred). The appeal adjudicator's code may read the report and proofs to verify them; its judges may not.
- **Releasing reasoning after the decision helps a gaming seller little** (inferred): the pinned models, the template and the policy are public, so a seller can already probe the judges offline; the seed-dependent parts change per deal. The defenses stay the secret seed, the screen, no re-roll and `maxSubmissions`. With `maxSubmissions` above 1, reports should be released only after the last attempt (red team).
- **Attested seats make that probing exact** (red team, inferred). Open weights, deterministic decoding and a public template let a seller optimize a delivery white-box against the exact seat, so an attested configuration needs its own red-team run.

## 7. Safe tuning loops

- **Goodhart, four ways** (measured: [Manheim and Garrabrant 2018](https://arxiv.org/abs/1803.04585)). Regressional: selecting on calibration score picks up calibration noise. Extremal: thresholds tuned on synthetic cleaning cases break on real deliveries. Causal: appeal outcomes come from the appeal adjudicator the parties chose, which is not ground truth. Adversarial: sellers craft deliveries and file appeals to move thresholds (mapping inferred).
- **Static red-team sets overfit.** NIST CAISI: new attacks raised hijack success from 11% to 81% (measured: [NIST](https://www.nist.gov/node/1872381)). "The Attacker Moves Second" bypassed 12 defenses at above 90% for most, which had reported near-zero (measured: [arXiv 2510.09023](https://arxiv.org/abs/2510.09023)).
- **The gate cannot see its own threshold** (inferred). The promotion rule allows 2% false accepts on about 40 cases, about 15 of them rejects (measured: `docs/judgment-and-defenses.md`, Calibration). One false accept in 15 is 6.7%, so the gate means zero in 15, whose exact 95% upper bound is about 18% (the rule of three gives 20%). A 2% bound needs about 150 reject cases with zero false accepts. The set must grow by an order of magnitude, or the gate must be stated as "zero in n" with n published.
- **Appeal poisoning** (inferred). An overturn costs an attacker the appeal fee plus a 5% bond (measured: `fixtures/clubs/data-services-v1.yaml`), and a colluding seller and appeal bench can make overturns cheaply. So appeal outcomes are alerts for a person, never part of the loop's objective.
- **Selection overfits the gate** (red team, computed). A candidate whose true false-accept rate is 3% shows zero in 150 about 1% of the time. Tested 100 times against one set, some such candidate passes about 65% of the time. The gate must run once, on the one candidate the loop nominates, on a set never used in selection.
- **The other gates need their own n** (red team, computed). Zero false rejects in about 60 accept cases bounds the rate at 5%. Twenty red-team cases bound auto-accepts only at about 14%. Clustered cases from a few generators make each effective n smaller.
- **The tuner is an instruction position** (red team, inferred). A loop that proposes prompts from failure cases reads deliveries that fooled the judges, and one can address the proposer. So the loop gets typed aggregates only, and the approver reads the candidate's diff.
- **Guards:**
  - a private held-out set whose generators are also held back;
  - the gate in a protected path with a human code owner;
  - an approver's key the loop does not hold;
  - a capped step per release and capped drift from a person-signed baseline;
  - a list of untunable invariants;
  - promotion as a new `policyHash` or `registryHash`, so open deals never change;
  - every bound registry kept callable until its last deal closes;
  - a published log of aggregates only (ADR-0020 §4).

  Pinning holds: it is per commitment by hash, not frozen over time.

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

`todo.` until a kind is built (`docs/testing.md`). Balances follow the demo club: price 2,000, fee 50, appeal fee 25, appeal bond 100, adjudicator bonds 25,000. The proof-miss penalty is written P (a policy term, paid from the decider's junior tranche). Most rows were proposed by the two red-team rounds on PR 115.

| Fixture | Scenario | End state |
| --- | --- | --- |
| `neutrality.prover-offline-after-accept` | Two attested seats seated; the primary accepts; no root by the proof deadline; nobody appeals | Released at the decision. Anyone triggers the proof-miss timeout; P moves from the primary's junior tranche to the buyer |
| `neutrality.prover-offline-after-reject` | The primary rejects after a panel; no root by the deadline | Refunded at the decision; the timeout pays P to the seller |
| `neutrality.prover-offline-fallback-decides` | The primary is silent; the fallback decides and posts no root | The same rule on the fallback's junior tranche, reserved when it took the case |
| `neutrality.operator-refuses-proof-bundle` | Every operator refuses to relay the `ProofBundle` | The decider submits it to the settlement layer directly; the root is stored; no penalty |
| `neutrality.attested-provider-offline-at-call` | The only attested seat's host is down when the panel runs; two unattested seats pass | Released at the decision; the seat abstains and is not replaced; the decider posts a root with an abstention leaf; no penalty, no fallback, no default |
| `neutrality.attestation-measurement-rotated` | The host changes its enclave image after agreement | Seats recorded unattested; decisions unaffected; no penalty |
| `neutrality.proof-verifier-stalled` | An oversized bundle; the appeal adjudicator cannot verify within the entry's caps | Recorded as evidence with the verifier's transcript hash; the merits appeal runs as usual; no penalty |
| `attack.proof-fails-verification` | The primary ran a cheaper model; its proof fails, and a re-execution is outside tolerance | An ordinary appeal on the mislabeled-model ground; the panel rejects the work; the reversal pays 2,000 from the primary's bond |
| `attack.proof-garbage-root-evades-timeout` | The decider posts a random root | No timeout; the root is a signed claim that does not verify, which is evidence; the appeal is the only remedy |
| `attack.proof-miss-on-short-circuit-reject` | `minAttestedSeats` 1, P 500; a required check fails; no panel | Refunded; `attestedSeatsSeated` is 0, so no penalty moves; the primary keeps 25,050 |
| `attack.proof-miss-penalty-drains-senior` | Pool 25,000, of which 2,500 is junior; P 20,000; no root | Acceptance refused: `junior - reservedJunior` is below P, or P exceeds the rulebook cap; backers untouched |
| `attack.proof-miss-reserve-released-early` | `proofWindowSec` runs past `appealDecideBy` | The reserve is held to the proof deadline, and the timeout pays in full |
| `attack.seller-induces-attested-abstention` | An injected URL makes the attested seat abstain by filter | First instance escalates (`aggregate.ts:188`); an escalation carries no proof duty, so no penalty to the seller |
| `attack.junior-reserve-consumed-by-overturn` | Junior 2,500; two open deals with P 1,000 each; an overturn of 2,000 on a third; then both timeouts | Ring-fenced: the overturn takes 500 junior and 1,500 senior; both losers get 1,000 |
| `attack.false-attested-count` | The decider signs `attestedSeatsSeated` 0 on a panel that seated one attested seat | No timeout; in any appeal the adjudicator recomputes the panel, finds the count false, and P is paid as if absent |
| `attack.second-decider-free-rides-first-root` | The primary posts its root; the appeal adjudicator decides with one attested seat seated and posts nothing | Roots are stored per role, so the timeout pays P from the appeal adjudicator's reserve |
| `attack.proof-miss-same-block-race` | The bundle and the trigger land in one block at the deadline | The bundle counts; no P moves |
| `attack.seller-crafts-unprovable-delivery` | The seller's delivery makes an honest proof fail; the primary rejects; the seller appeals; the panel splits | Refunded stands (D27c); the seller forfeits its bond 100 and fee 25; no penalty |
| `attack.proof-ground-honest-accept-judge-noise` | Twin of `honest-seller-survives-judge-noise-on-appeal`, with no root posted | Released stands: buyer 7,950 plus P, seller 2,000; the primary pays P from its junior tranche and nothing more |
| `attack.proof-replay-across-deals` | A bundle from another deal | Rejected: the bundle binds the commitment ID, role, attempt and record hash, and the nonces derive from the seed |
| `attack.prover-stalls-settlement` | The primary withholds its decision "until the proof is ready" past `judgeBy` | The fallback decides; proving never extends a deadline |
| `attack.attested-seat-reroll` | A sampled `enclave` seat called twice; the second reply is recorded | Refused by the deterministic-decoding rule, or caught as a duplicate `inputHash` |
| `attack.minattested-pins-the-panel` | `minAttestedSeats` equals the number of attested entries | The adjudicator declines the policy at acceptance |
| `attack.record-quotes-work-after-refund` | A JSON delivery whose extra property name is a canary, plus evidence-anchored criteria; the work fails | The buyer's copy of the record holds no substring of the rows or the canary |
| `attack.tuner-reads-injected-failure-case` | A delivery tells the proposer to add a trigger phrase to the template | The loop's inputs hold no deliverable text; the approver's diff review rejects the trigger |
| `attack.tuner-multi-candidate-selection` | 100 candidates at a true 3% false accept against one 150-case set | Rejected: the gate runs once, on a fresh set |
| `attack.appeal-poisoning-invariance` | The loop runs twice with different appeal data and the same calibration | Identical candidates |
| `error.coverage-exceeded-by-proof-cost` | The decider's unencumbered junior tranche is below P | Acceptance refused |
| `error.proof-window-shorter-than-prover-latency` | `proofWindowSec` 1 with a large P | The adjudicator declines at acceptance (D29); the operator warned at prepare; nothing held |

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
