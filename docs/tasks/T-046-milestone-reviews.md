# T-046: Cross-family adversarial reviews at milestones

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-045
- **Paths this task may touch:** `scripts/ops/milestone.mjs` (new), `scripts/ops/review-agreement.mjs` (new), `scripts/ops/canary.mjs` (new), `.claude/commands/milestone-review.md` (new), `tests/agent-ops/milestone.test.ts` (new), `agent-ops/gates.md` (the State column), `docs/tasks/T-046-milestone-reviews.md`
- **Human gate:** no. The external audit before mainnet stays Rafa's (D4).
- **Status:** todo
- **Agent/session:** —

## Intent

Run the milestone reviews in `agent-ops/gates.md` so Claude models never review a milestone alone, and measure whether the reviews catch anything.

- Inputs: a milestone event (a schema version change, a change to `config/judges-live.yaml`, an ADR sent to Rafa, a phase marked done in `docs/plan.md`, a deploy Rafa approved).
- Outputs: the reviews the milestone table names, with their effect (blocking or advisory); an agreement log; a monthly canary recall per family.
- Non-goals: per-PR review (T-045), fixing what the reviews find.

## Context

- `agent-ops/gates.md` ("Cross-family adversarial reviews": the milestone table, the disagreement rules, the four controls on correlated error). `agent-ops/ops.yaml` (`milestones`, `disagreement`, `review_theater`).
- T-206 already ran two blind reviews from different families (`docs/tasks/T-206-contract-review.md`).

## Acceptance criteria

- [ ] `milestone.mjs` detects each milestone from a diff or event and names the reviewers and the effect from `ops.yaml`. One test case per table row.
- [ ] `/milestone-review` runs the phase-exit red team: Fable 5.1, DeepSeek and the pinned GPT model each run every `attack.*` and `neutrality.*` fixture and propose new attacks as fixture drafts in a PR. The phase cannot be marked done while a blocking finding is open.
- [ ] An ADR critique from DeepSeek is attached to the ADR as an advisory section for Rafa; a pre-deploy review covers the diff since the last deploy.
- [ ] Disagreements follow the rules: the verifier runs the reproduction once; a reproduced finding blocks; an unreproduced one becomes a backlog row; two refuted findings from one family, or two abstentions, on one PR go to Rafa. No vote across families, no rerun for a different verdict. Tested on scripted cases.
- [ ] `review-agreement.mjs` reads `reports/review-agreement.jsonl` and flags a family that agrees with the self-assessment more than 95% of the time over 20 PRs (thresholds from `ops.yaml`).
- [ ] `canary.mjs` plants known defects in a local throwaway branch, which it never pushes, runs each family's reviewer on the diff, and records recall per family. One run recorded in Evidence (measured).

## Out of scope

- Choosing a GPT model (T-040), an external audit.

## Evidence

## Decisions

## Handoff
