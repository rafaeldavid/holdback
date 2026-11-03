# T-050: Activate agent ops, one step at a time, on Rafa's go-ahead

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-039 to T-049 merged
- **Paths this task may touch:** `agent-ops/STATUS`, `agent-ops/ops.yaml` (`status`, `wip`), `agent-ops/workflows/` and `.github/workflows/` (moving `xreview.yml`, the guardrails and footer steps, the tick's triggers), `.claude/settings.json` (the deny additions, the shell-guard and budget-stop hooks), `.claude/commands/` (moved in from `agent-ops/commands/`; `start-task.md` and `review-pr.md` pointed at `brief.mjs`), `.claude/agents/reviewer.md` and `.claude/agents/verifier.md` (tools only), `scripts/ci/guardrails.mjs` (warn to enforce), `tests/agent-ops-inactive.test.ts`, `docs/team.md`, `CLAUDE.md` ("Working as a team of agents"), `docs/decisions/ADR-0010-agent-team-workflow.md` (an amendment), `docs/decisions-today.md` (architect, through `/record-decision`), `docs/testing.md`, `docs/tasks/T-050-activate-agent-ops.md`
- **Human gate:** **yes, at every step.** Each step changes the pipeline's own rules or reaches outside the repository. Before a step runs, Rafa's go-ahead for it is written in the Handoff section with the date and his words. Approval of one step does not cover the next.
- **Status:** todo
- **Agent/session:** —

## Intent

Switch the pipeline on in stages, each one reversible, so that one lane proves its output is verifiable before three lanes run (`docs/team.md`, principle 1).

- Input: every Phase 9 task merged, and the isolated environment from T-039 passing its smoke test on option B (the agents' own identity).
- Output: `agent-ops/STATUS` reads `active`, the repository variable `AGENT_OPS` is `on`, and `docs/team.md` points to `agent-ops/` as the process.
- Rollback, at any step: Rafa sets `AGENT_OPS` to `off`, and the tick fails closed. Then he reverts that step's PR.

The agents have no Workflows permission (T-039 step 3), so every change to `.github/workflows/` below is a PR that Rafa pushes and merges.

## Context

- `agent-ops/README.md` (Activation, Kill switch), `agent-ops/gates.md`, `agent-ops/teams.md` (PR 112).
- ADR-0010 (agent-team workflow): the pipeline changes how work flows, so this task amends it.
- T-045's three preconditions for an unforgeable `xreview` status.

## Steps

### 1. The environment
- **Who:** Rafa and agents (T-039).
- **Time:** see T-039.
- **What:** The isolated environment on option B, with the `crow-agents` App, passes its smoke test.
- **Done when:** T-039 is done.

### 2. Review keys and tier 3 review
- **Who:** Rafa (settings and secrets); an agent prepares the workflow PR.
- **Time:** 30 min.
- **What:**
  1. Under Settings, then Environments, create `xreview`, with Deployment branches set to Selected branches: `main`. Add the capped DeepSeek and GPT keys there, not as repository secrets.
  2. Push and merge the PR that moves `xreview.yml` into `.github/workflows/`.
  3. In the `main` ruleset, require the `xreview` check.
  4. Create a second ruleset, `tier3-review`, targeting `main`. It turns on "Require a pull request before merging" with "Require review from Code Owners". Its bypass list holds the Repository admin role in "For pull requests only" mode, so Rafa's own tier 3 PRs can merge. On a personal repository the admin role is Rafa alone, and `crow-agents` has Write, not admin (inferred, as are the option names).

  The `main` ruleset keeps no bypass, so `check`, `gitleaks` and `xreview` stay required for everyone.

  Before turning on code-owner review, Rafa decides whether CODEOWNERS keeps its three tier 2 entries (`spec/`, `docs/decisions/`, `contracts/`). If they stay, every PR on those paths waits for his review too (T-044).
- **Done when:** `xreview` reports on a test PR. A tier 3 PR from `crow-agents` waits for Rafa's review. A tier 3 PR of Rafa's merges with `check` green.

### 3. Faster CI
- **Who:** agents.
- **Time:** in those tasks.
- **What:** T-034, T-035, T-036 and T-049 are merged, and the Known flakes list exists.
- **Done when:** each of those task files reads Status done.

### 4. Tool limits
- **Who:** an agent writes the PR; Rafa merges it (tier 3).
- **Time:** 15 min to review.
- **What:**
  - Remove Write and Edit from the reviewer.
  - The verifier keeps Edit, and T-044's verifier-commit guardrail fails a verifier commit that changes anything but the task's Evidence section. The design lists both "verifier loses Edit" and "Edit for Evidence only"; this resolves it.
  - Merge `agent-ops/settings.deny.json` into `.claude/settings.json`.
  - Wire `scripts/hooks/bash-guard.sh` as a PreToolUse hook.
- **Done when:** a new session shows the hook firing on `sed -i` and the deny list refusing `wrangler`.

### 5. Enforcement
- **Who:** Rafa pushes the workflow PR; an agent writes it.
- **Time:** 10 min to review.
- **What:**
  - Add the guardrails step to the `check` job in enforce mode, and the footer check from T-047.
  - Move `agent-ops/commands/*.md` (triage, milestone review, PR red team) into `.claude/commands/`, and wire T-047's budget-stop hook from `agent-ops/hooks/` in `.claude/settings.json`.
  - Point `/start-task` and `/review-pr` at `scripts/ops/brief.mjs` and `modelFor`.
  - Run the quarantine tests in CI.
  - Turn `tests/agent-ops-inactive.test.ts` into a test of the active wiring.
- **Done when:** CI fails a fixture PR that touches a path outside its task, and one without a complete footer.

### 6. Triggers
- **Who:** Rafa approves; an agent writes the PR or the schedule.
- **Time:** 20 min.
- **What:**
  - Wire the tick where T-048 decided it runs: on each merge to `main`, on each CI completion, and on a 20-minute schedule.
  - Wire the daily-log job, the alarms, and the telemetry and feedback exports (T-041, T-042), each with `--dry-run` until step 9.

  A schedule is standing configuration, so it needs Rafa's go-ahead.
- **Done when:** one dry run of each appears in `reports/agent-ops/metrics.jsonl` or the day's log.

### 7. Telemetry and feedback
- **Who:** Rafa (settings, deploy); agents (code).
- **Time:** 30 min.
- **What:** T-042 and T-043 are merged. Rafa turns on Cloudflare Web Analytics for escrow.stream and decides on a social reader. The demo is redeployed with T-043.
- **Done when:** `signals.mjs` reads each enabled source.

### 8. Shadow week
- **Who:** agents run it; Rafa reviews the summary.
- **Time:** 7 days; 30 min of Rafa's time.
- **What:** The tick runs with `--dry-run` for seven days while Rafa starts tasks by hand. Compare the architect's task files with hand-written ones, and calibrate the telemetry and feedback thresholds.
- **Done when:** a shadow-week report is in `docs/reviews/`, with the measured drop rate, false records and calibrated thresholds.

### 9. Switch on with one lane
- **Who:** Rafa.
- **Time:** 10 min.
- **What:**
  1. Merge a tier 3 PR that sets `wip.implementers: 1` in `ops.yaml`.
  2. Merge a tier 3 PR that sets `agent-ops/STATUS` to `active`.
  3. Set the repository variable `AGENT_OPS` to `on` (Settings, Secrets and variables, Actions, Variables).

  The README lists the switch as the last step, but the one-lane run needs it on.
- **Done when:** the tick starts a task on its own, and its PR carries a complete footer.

### 10. Three lanes
- **Who:** Rafa merges; an agent writes the PR.
- **Time:** 5 min.
- **What:** After 10 PRs merge in the single lane without a revert (threshold guessed), raise `wip.implementers` to 3.
- **Done when:** three lanes run, and the daily log shows the pipeline figures.

Also at step 9:
- amend ADR-0010;
- point `docs/team.md` and `CLAUDE.md` at `agent-ops/`;
- keep the Rules and checks table only in `docs/team.md`.

## Acceptance criteria

- [ ] Each step above has Rafa's go-ahead recorded in Handoff before it runs, and its "Done when" result recorded in Evidence (measured).
- [ ] `node scripts/ops/switch.mjs` reports on, and `node scripts/ops/tick.mjs --dry-run` shows the expected plan, before step 9's first real run.
- [ ] The kill switch is tested live once after step 9: Rafa sets `AGENT_OPS` to `off`, and the next tick starts nothing (measured).

## Out of scope

- More than three lanes (a later decision from measured CI queueing), mainnet anything.

## Evidence

## Decisions

## Handoff
