# T-309: Evaluate Airbender as a proving backend for judgment

- **Lane:** research
- **Phase:** 3 (later, with T-308)
- **Depends on:** ADR-0027 (Proposed) and its research note `docs/research/t-308-judgment-report-provable-inference.md`
- **Paths this task may touch:** `docs/research/t-309-airbender-proving.md` (new), `docs/tasks/T-309-airbender-proving.md`, `docs/backlog.md` (the T-308 row only), `reports/scratch/t-309/` (spike code and logs, not committed). Any spike code worth keeping goes in a follow-up task.
- **Human gate:** no for desk research and runs on local hardware. Renting a GPU or any other paid compute waits for Rafa (real money, outside the repository).
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
  - "RISC-V compilation and proving tools": RISC-V circuits, a simulator, witness generation, proof creation and verification;
  - docs on GPU acceleration;
  - dual-licensed Apache-2.0 or MIT;
  - one audit report in `audits/` (August 2025);
  - releases tagged up to `v0.5.2` (2025-12-19), with `dev-v0.8.x` tags.

  Everything else about it here is a question, not a fact.
- **ADR-0027:**
  - §2: attestation kinds, of which `zk` is a proof bound to a weight commitment;
  - §3: proofs are post hoc and stored as a root;
  - §4: a missing proof costs a fixed penalty;
  - §5: no prover integration now; revisit when a maintained, audited prover covers the rendered prompt plus the verdict, 8,000 to 32,000 tokens.
- **FlashProve's figures for comparison** (T-308 research note §1, measured from its report):
  - about 110 window tokens per second on one H100 (39.1 reply tokens per second under the looser policy);
  - 18.78 MB per proof, verified in 17 s on 24 CPU threads;
  - one model shape and a 1,024-token window;
  - not maintained.
- **The deterministic stages** are intake, deterministic checks, screen and aggregation (`docs/judgment-and-defenses.md`, stages 0 to 2 and 5). They are TypeScript today (`packages/judgment/src/`). Aggregation is pinned by version (`agg-3`) and table-tested.
- **Neutrality:** a prover is an actor in `docs/neutrality.md`. ADR-0027 proposes its control-point row and fixtures, such as `neutrality.prover-offline-after-accept` and `neutrality.operator-refuses-proof-bundle`.

## Questions

1. **Inference.** Can a general zkVM prove judge-model inference at usable cost and latency, against FlashProve's figures? Measure on a small open-weight model if feasible (for example a model under 1B parameters, a few hundred tokens), and record:
   - proving time and hardware;
   - proof size;
   - verification time;
   - whether the result scales to a judge-sized model or only to a toy.

   State the extrapolation as inferred, never as measured.
2. **The deterministic stages.** The likelier near-term fit: prove checks, screen and aggregation, which are cheap and deterministic, so the judgment record carries proofs for everything except model inference. Answer:
   - what porting to a RISC-V guest costs (Rust, or another language Airbender supports), and how the guest stays equivalent to the TypeScript (the same table-driven tests, a differential test);
   - proving cost per judgment on one real fixture, for example `happy-path` or a 10 MB CSV at the size cap;
   - how such a proof would bind to `policyHash`, `aggregationVersion`, the checks in the terms, and the plaintext hash, without revealing the plaintext.
3. **On-chain verification.** Can an Airbender proof be verified by a contract on a local chain or Sepolia?
   - What does one verification cost in gas, and is there a wrapping step (a final SNARK) with its own setup or trust assumptions?
   - How does that compare with off-chain verification, FlashProve's model?
   - ADR-0027 stores only a root on chain, so say whether on-chain verification would add anything the timeout or an appeal needs.
4. **Pinning and neutrality.**
   - How to pin a prover version, the guest program and the verifier: a reproducible build and a verification key hash a registry entry or policy could carry.
   - Who can produce a proof: anyone holding the plaintext, or only the adjudicator.
   - Name the `neutrality.*` fixture for a prover that refuses or goes offline, consistent with ADR-0027 §4.
5. **Licence and maturity.** Licence terms; release cadence and stability (the mixed `v0.5` and `dev-v0.8` tags); the audit's scope and findings; maintenance status; supported hardware.

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
