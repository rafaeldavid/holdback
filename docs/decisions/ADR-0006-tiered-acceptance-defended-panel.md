# ADR-0006: Tiered acceptance and a defended multi-model panel

- **Status:** Accepted, 2026-10-30. Amended after the Phase 0 adversarial review (`docs/reviews/2026-10-30-phase0-interrogate.md`).
- **Date:** 2026-10-30

## Decision

Acceptance runs in tiers:
1. Declarative deterministic checks.
2. A panel of pinned models, at least two families, chosen by commit-reveal, for whatever the checks cannot decide.
3. An appeal to a different adjudicator with a larger panel.

The mandatory defenses and their tests are listed in `docs/judgment-and-defenses.md`. Acceptance checks never execute code from commitments or deliverables.

**Registry binding.** Each commitment binds the hash of the judge registry its panel is drawn from (`adjudication.registryHash`, schema v0.2). The panel is a seeded shuffle of that registry's active entries, so no one, including Holdback's maintainers, can change which models judge after both parties sign. Each adjudicator may publish its own registry, subject to the pinning and family rules.

**Policy binding.** Each commitment also binds `adjudication.policyHash`: the keccak256 of the RFC 8785 canonical JSON of the primary adjudicator's `policy` object. That object fixes the panel parameters, the SHA-256 of the first-instance and appeal prompt templates, the aggregation rule version and the screen version. The adjudicator cannot change its prompt or decision rule after both parties sign. Each verdict records `promptTemplateHash`, which must match the bound policy, and `inputHash`, the SHA-256 of the full rendered prompt, which anyone holding the plaintext can recompute. Schema v0.3.

**What is proven and what is disclosed.** The commitment proves which models had to judge and under which prompt and rules. The judgment record discloses which models did judge and with which inputs, signed by the adjudicator. Nothing yet proves that a response came from the model named: no major provider signs responses (`docs/research/compute-native.md`, R3). Until provider-signed responses or attested confidential compute exist, a mislabeled model is an appeal ground backed by the bond, and the gap is residual control point 8 in `docs/neutrality.md`.

**Screen report (ADR-0021).** The screen protects the judges. Its signals are part of the signed judgment record, and the SDK must surface them to the buyer's agent with a normalized view of the work by default. When the rubric is empty, a flagged screen does not change the decision; aggregation appends the reason "screen flagged; see screen.signals". Parties who want hidden characters to reject can require the declarative check `hidden_characters_max`. Escalation on high-risk signals waits for a Phase 3 `screenPolicy` option.

**Escalation.** An escalated case goes to the appeal adjudicator with no first decision and no appellant bond. If the appeal adjudicator misses its deadline, the default outcome applies (ADR-0007).

## Rationale

- Systems that work without trust between parties check delivery inside settlement. Deterministic checks are our version of that.
- Model judgment moves with model versions: a Kleros study found Opus 4.7 → 4.8 changed 11 of 99 outcomes (Kluwer Arbitration Blog, July 22, 2026). Pinning and family diversity follow from this.
- Prompt injection success rises sharply under adaptive attack: from 11% to 81% in NIST CAISI tests. Untrusted-data handling and a screen follow from this.

## Consequences

- At least two model-provider accounts are needed in live mode.
- The schema changes bump every schema `$id`: v0.2 for `registryHash`, v0.3 for `policyHash` and the split prompt hashes.
- CI uses recorded verdicts.
- Model quality is measured in calibration runs, not in CI.
