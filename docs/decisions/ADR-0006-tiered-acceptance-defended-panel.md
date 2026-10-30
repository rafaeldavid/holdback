# ADR-0006: Tiered acceptance and a defended multi-model panel

- **Status:** Proposed. Default unless Rafa objects.
- **Date:** 2026-10-30

## Decision

Acceptance runs in tiers:
1. Declarative deterministic checks.
2. A panel of pinned models, at least two families, chosen by commit-reveal, for whatever the checks cannot decide.
3. An appeal to a different adjudicator with a larger panel.

The mandatory defenses and their tests are listed in `docs/judgment-and-defenses.md`. Acceptance checks never execute code from commitments or deliverables.

## Rationale

- Systems that work without trust between parties check delivery inside settlement. Deterministic checks are our version of that.
- Model judgment moves with model versions: a Kleros study found Opus 4.7 → 4.8 changed 11 of 99 outcomes (Kluwer Arbitration Blog, July 22, 2026). Pinning and family diversity follow from this.
- Prompt injection success rises sharply under adaptive attack: from 11% to 81% in NIST CAISI tests. Untrusted-data handling and a screen follow from this.

## Consequences

- At least two model-provider accounts are needed in live mode.
- CI uses recorded verdicts.
- Model quality is measured in calibration runs, not in CI.
