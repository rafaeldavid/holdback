# T-309: Evaluate Airbender as a proving backend for judgment

- **Lane:** research
- **Phase:** 3 (later, with T-308)
- **Depends on:** ADR-0027 (Proposed) and its research note `docs/research/t-308-judgment-report-provable-inference.md`
- **Paths this task may touch:** `docs/research/t-309-airbender-proving.md` (new), `docs/tasks/T-309-airbender-proving.md`, `docs/backlog.md` (the T-308 row only), `reports/scratch/t-309/` (spike code and logs, not committed). Any spike code worth keeping goes in a follow-up task.
- **Human gate:** no for desk research, local CPU runs and a local chain (anvil); yes for paid compute and for any public-network transaction.
  - Renting a GPU or any other paid compute waits for Rafa (real money, outside the repository). The local machine is Apple silicon, and the GPU prover appears to need CUDA (inferred), so every GPU figure needs this gate.
  - So does any transaction on a public network, Sepolia included: a funded key and a deploy both reach outside the repository (CLAUDE.md).
- **Status:** todo
- **Agent/session:** —

## Intent

Find out whether Airbender can serve as the proving backend for ADR-0027's attestation and report work, and for which stages of the judgment pipeline. Airbender is an open-source RISC-V zkVM with a GPU prover. ADR-0027 assumed a bespoke inference prover like FlashProve. A general zkVM proves any program compiled to RISC-V, so it may fit the deterministic stages first and model inference only later.

- **Inputs:** Airbender's repository and docs, FlashProve's published figures (the T-308 research note §1), and the judgment pipeline in `packages/judgment/`.
- **Output:** a research note with measured numbers where feasible, and a recommendation that answers ADR-0027's open questions or amends its §2 and §5.
- **Non-goals:** any production change, schema change or integration, and any deployment.

## Context

- **Raised by** Rafa, 2026-11-03, after Anthropic's provable-inference post: investigate Airbender for proving inference.
- **What Airbender is** (measured, 2026-11-03, `github.com/matter-labs/zksync-airbender`):
  - the repository description is "RISC-V prover system for ZKsync OS";
  - the README lists RISC-V circuits, a simulator, and witness generation, proof creation and verification;
  - it has docs on GPU acceleration;
  - it is dual-licensed, Apache-2.0 or MIT;
  - `audits/` holds one audit report (August 2025);
  - the tags run to `v0.6.0-rc.2` (2026-08-13), beside `dev-v0.8.x` tags;
  - the last commit on `main` is from 2026-04-23.
- **The SNARK wrapper** for on-chain verification is a separate repository, `github.com/matter-labs/zkos-wrapper` (MIT): it "takes the zkos proof (in json format), and returns the snark proof" (measured, its README). Airbender's `docs/end_to_end.md` says that step "works only if you have over 150GB of RAM" (line 63), and that its example uses "'fake' CRS - for production use cases, you should pass `--trusted-setup-file`" (line 84) (measured, 2026-11-03).

  Everything else here about Airbender and the wrapper is a question, not a fact.
- **ADR-0027:**
  - §2: attestation kinds, of which `zk` is a proof bound to a weight commitment;
  - §3: proofs are post hoc and stored as a root;
  - §4: a missing proof costs a fixed penalty;
  - §5: no prover integration now; revisit when a maintained, audited prover covers the rendered prompt plus the verdict, 8,000 to 32,000 tokens.
- **FlashProve's figures for comparison** (T-308 research note §1, measured from its report):
  - about 110 window tokens per second on one H100 (39.1 reply tokens per second under the looser policy);
  - 18.78 MB per proof, verified in 17 s on 24 CPU threads;
  - one model shape and a 1,024-token window;
  - not maintained, with "no independent security audit". That audit is the bar ADR-0027 §5 sets.
- **The deterministic stages** are intake, the deterministic checks, the screen's heuristics (screen v0) and aggregation (`docs/judgment-and-defenses.md`, stages 0, 1, 2 and 5). They are TypeScript today (`packages/judgment/src/`). Aggregation is pinned by version (`agg-3`) and table-tested. The screen's planned classifier model call (T-303; `screen.ts:2-3`) is model inference, so it belongs under question 1.
- **Neutrality:** ADR-0027 proposes a prover row for `docs/neutrality.md`, which has none yet. Its Consequences name the prover fixtures, such as `neutrality.prover-offline-after-accept` and `neutrality.operator-refuses-proof-bundle`.

## Questions

1. **Inference.** Can a general zkVM prove judge-model inference at usable cost and latency, against FlashProve's figures? Measure on a small open-weight model if feasible (for example a model under 1B parameters, a few hundred tokens), and record:
   - proving time and hardware;
   - proof size;
   - verification time;
   - whether the result scales to a judge-sized model or only to a toy.

   State the extrapolation as inferred, never as measured.
2. **The deterministic stages.** The likelier near-term fit: prove the checks, the screen's heuristics and aggregation, which are cheap and deterministic, so the judgment record carries proofs for everything except model inference. Answer:
   - what a proof adds over re-running the code. The party a decision goes against already holds the plaintext and can re-run the stages itself (ADR-0027 §3, §5 `reproducible`; D32 prefers the simpler fix);
   - whether the proofs hide the witness (zero knowledge). If they do not, a proof cannot avoid revealing the plaintext;
   - where such a proof would live, since ADR-0027 §2 defines `zk` per judge seat only: in the record, in the `ProofBundle`, or as a new stage-level kind;
   - what porting to a RISC-V guest costs (Rust, or another language Airbender supports), and how the guest stays equivalent to the TypeScript (the same table-driven tests, a differential test);
   - proving cost per judgment on one real fixture, for example `happy-path` or a 10 MB CSV at the size cap;
   - how such a proof would bind to `policyHash`, `aggregationVersion`, the checks in the terms, and the plaintext hash, without revealing the plaintext.
3. **On-chain verification.** Can an Airbender proof be verified by a contract on a local chain (anvil)? No transaction goes to any public network without Rafa (see the gate).
   - What does one verification cost in gas?
   - What does the wrapping step (`zkos-wrapper`) need for production? Which trusted-setup file it takes and who produced it (the example uses a "fake" CRS), and whether its 150 GB memory floor puts it beyond the parties that would need to re-prove.
   - How does that compare with off-chain verification, FlashProve's model?
   - ADR-0027 stores only a root on chain, so say whether on-chain verification would add anything the timeout or an appeal needs.
4. **Pinning and neutrality.**
   - How to pin a prover version, the guest program and the verifier: a reproducible build and a verification key hash a registry entry or policy could carry.
   - Who can produce a proof: anyone holding the plaintext, or only the adjudicator.
   - Which of ADR-0027's prover fixtures an Airbender prover needs, and whether an on-chain verifier adds a new one (for example a verifier contract that is never deployed, or is deployed in a different version).
5. **Licence and maturity**, for Airbender and for `zkos-wrapper`: licence terms; release cadence and stability (the `v0.6.0-rc`, `v0.5` and `dev-v0.8` tags, and the last commit date); each audit's scope and findings; maintenance status; supported hardware.

## Acceptance criteria

- [ ] `docs/research/t-309-airbender-proving.md` answers questions 1 to 5. Every number is labeled measured (with the command, commit and hardware), inferred or guessed, and every external claim cites a primary source with its access date.
- [ ] Question 2 has at least one measured proving run of a deterministic stage on local hardware, or states plainly why none was feasible.
- [ ] A recommendation for ADR-0027: adopt for the deterministic stages, adopt for inference, revisit later, or reject. It names the ADR sections to amend, without editing the ADR in this task.
- [ ] No production code, schema, fixture or contract changes. Spike code stays in `reports/scratch/t-309/`.
- [ ] A context-briefed `reviewer` pass, then the Evidence and Handoff sections below.

## Out of scope

- Integrating any prover, and any schema change (that follows an accepted ADR amendment).
- Paid compute without Rafa's go-ahead.
- Judging which proving vendor is better in general. The question is fit for this pipeline.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.

If the recommendation changes ADR-0027, the amendment is a follow-up: an ADR change recorded in `docs/decisions-today.md`, which Rafa can overrule.
