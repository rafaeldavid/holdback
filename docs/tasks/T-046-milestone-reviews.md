# T-046: Red-team and cross-family reviews at milestones

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-045
- **Paths this task may touch:** `scripts/ops/milestone.mjs` (new), `scripts/ops/review-agreement.mjs` (new), `scripts/ops/canary.mjs` (new), `agent-ops/commands/milestone-review.md` (new, inert until T-050), `agent-ops/commands/red-team-pr.md` (new, inert until T-050), `tests/agent-ops/milestone.test.ts` (new), `agent-ops/gates.md` (the State column; after T-045), `docs/tasks/T-046-milestone-reviews.md`
- **Human gate:** yes for live runs with DeepSeek or GPT keys: the phase-exit red team and the measured canary recall. Rafa gives one session capped keys and approves the spend, as for T-028 (T-039 step 15). No for building with scripted providers. The external audit before mainnet stays Rafa's (D4).
- **Status:** todo
- **Agent/session:** —

## Intent

Run the reviews in `agent-ops/gates.md` that go beyond one PR's `xreview`, so Claude models never review a milestone alone, and measure whether the reviews catch anything.

- **Per-PR red team:** a tier 2 PR that touches judgment, settlement, contracts or the operator gets a red-team pass (the `red-teamer` role) before merge.
- **Milestones:**
  - a schema version change;
  - a change to `config/judges-live.yaml`;
  - an ADR sent to Rafa;
  - a phase marked done in `docs/plan.md`;
  - a deploy Rafa approved.
- **Outputs:**
  - the reviews the milestone table names, each with its effect (blocking or advisory);
  - the agreement metric over `reports/review-agreement.jsonl`, which T-045 writes;
  - a monthly canary recall per family.
- Non-goals: per-PR `xreview` (T-045), fixing what the reviews find.

## Context

- `agent-ops/gates.md` ("Cross-family adversarial reviews": the milestone table, the disagreement rules, the four controls on correlated error). `agent-ops/ops.yaml` (`milestones`, `disagreement`, `review_theater`). PR 112, not merged yet.
- T-206 ran its passes with Anthropic models only, because no other provider's key was reachable from a session (PR 128). The live runs here therefore need Rafa's keys.

## Acceptance criteria

- [ ] `milestone.mjs` detects each milestone from a diff or event, and names the reviewers and the effect from `ops.yaml`. One test case per table row, plus the per-PR red-team rule.
- [ ] `agent-ops/commands/red-team-pr.md` briefs the `red-teamer` on a tier 2 PR's diff and its task, and records PASS or findings. A blocking finding needs a file and line, the rule it breaks and a reproduction, as in T-045.
- [ ] `agent-ops/commands/milestone-review.md` runs the phase-exit red team. Fable 5.1, DeepSeek and the pinned GPT model each run every `attack.*` and `neutrality.*` fixture and propose new attacks as fixture drafts in a PR. The phase cannot be marked done while a blocking finding is open.
- [ ] An ADR critique from DeepSeek is attached to the ADR as an advisory section for Rafa. A pre-deploy review covers the diff since the last deploy.
- [ ] Disagreements follow the design's rules, each tested on a scripted case:
  - the verifier runs the reproduction once, and only through the repository's own runners (`pnpm vitest run <path>`, or `pnpm snap <name>` for a fixture), with the path from T-045's hardened schema. It never runs a finding's text as a shell command;
  - a reproduced finding blocks;
  - an unreproduced one becomes a backlog row;
  - two refuted findings from one family, or two abstentions, on one PR go to Rafa;
  - there is no vote across families and no rerun for a different verdict.
- [ ] `review-agreement.mjs` reads `reports/review-agreement.jsonl` and flags a family that agrees with the self-assessment more than 95% of the time over 20 PRs. The thresholds come from `ops.yaml`.
- [ ] `canary.mjs` plants known defects in a local throwaway branch, which it never pushes, runs each family's reviewer on the diff, and records recall per family. A scripted run is tested. One live run after Rafa's go-ahead is recorded in Evidence (measured).

## Out of scope

- Choosing a GPT model (T-040), an external audit.

## Evidence

## Decisions

## Handoff
