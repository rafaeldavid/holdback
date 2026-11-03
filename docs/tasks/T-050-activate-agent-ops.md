# T-050: Activate agent ops, one step at a time, on Rafa's go-ahead

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-039 to T-049 merged; T-031 and T-032 merged
- **Paths this task may touch:** `agent-ops/STATUS`, `agent-ops/ops.yaml` (`status`, `wip`), `agent-ops/workflows/` and `.github/workflows/` (moving `xreview.yml`; the tick's triggers), `.claude/settings.json` (the deny additions and the shell-guard hook), `.claude/agents/reviewer.md` and `.claude/agents/verifier.md` (tools only), `scripts/ci/guardrails.mjs` (warn to enforce), `tests/agent-ops-inactive.test.ts`, `docs/team.md`, `CLAUDE.md` ("Working as a team of agents"), `docs/decisions/ADR-0010-agent-team-workflow.md` (an amendment), `docs/decisions-today.md`, `docs/testing.md`, `docs/tasks/T-050-activate-agent-ops.md`
- **Human gate:** **yes, at every step.** Each step changes the pipeline's own rules or reaches outside the repository. Before a step runs, Rafa's go-ahead for that step is written in the Handoff section below with the date and his words. Approval of one step does not cover the next.
- **Status:** todo
- **Agent/session:** —

## Intent

Switch the pipeline on in stages, each one reversible, so that one lane proves its output is verifiable before three lanes run (`docs/team.md` principle 1).

- Input: every Phase 9 task merged, and the isolated environment from T-039 passing its smoke test.
- Output: `agent-ops/STATUS` reads `active`, the repository variable `AGENT_OPS` is `on`, and `docs/team.md` points to `agent-ops/` as the process.
- Rollback at any step: Rafa sets `AGENT_OPS` to `off` (the tick fails closed), then reverts that step's PR.

## Context

- `agent-ops/README.md` (Activation, Kill switch), `agent-ops/gates.md`, `agent-ops/teams.md`.
- ADR-0010 (agent-team workflow): the pipeline changes how work flows, so this task amends it.

## Steps

| # | Step | Who | Time | Done when |
| --- | --- | --- | --- | --- |
| 1 | The isolated environment and the agents' own GitHub identity are set up and pass the smoke test. | Rafa and agents (T-039) | See T-039 | T-039 is done. |
| 2 | Add a spend-capped DeepSeek key, and the pinned GPT key, as Actions secrets. Move `xreview.yml` into `.github/workflows/` (an agent's PR; Rafa merges, tier 3). In the `main` ruleset, require the `xreview` check and code-owner review. Code-owner review works only if the agents push as their own GitHub identity (T-039): GitHub does not let an author approve their own PR, so while agents push as Rafa, a required review would block every tier 3 PR. | Rafa (secrets, ruleset); agent (the PR) | 20 min | `xreview` reports on a test PR, and a tier 3 PR waits for Rafa's review. |
| 3 | T-034, T-035, T-036 and T-049 are merged and the Known flakes list exists. | Agents | 0 (already merged) | `gh pr list --state merged` shows the PRs. |
| 4 | Remove Write and Edit from the reviewer. The verifier keeps Edit, and guardrails fail a verifier commit that changes anything but the task's Evidence section (the design lists both "verifier loses Edit" and "Edit for Evidence only"; this resolves it). Merge `agent-ops/settings.deny.json` into `.claude/settings.json` and wire `scripts/hooks/bash-guard.sh` as a PreToolUse hook. | Agent (PR); Rafa merges | 15 min to review | A new session shows the hook firing on `sed -i` and the deny list refusing `wrangler`. |
| 5 | Switch guardrails from warn to enforce; run the quarantine tests in CI; turn `tests/agent-ops-inactive.test.ts` into a test of the active wiring. | Agent (PR); Rafa merges | 10 min to review | CI fails a fixture PR that touches a path outside its task. |
| 6 | Telemetry and feedback: T-042 and T-043 merged; Rafa turns on Cloudflare Web Analytics for escrow.stream and decides on a social reader; the demo is redeployed with T-043. | Rafa (settings, deploy); agents (code) | 30 min | `signals.mjs` reads each enabled source. |
| 7 | Shadow week: the tick runs with `--dry-run` for seven days while Rafa starts tasks by hand. Compare the architect's task files with hand-written ones; calibrate the telemetry and feedback thresholds. | Agents run it; Rafa reviews the summary | 7 days; 30 min of Rafa's time | A shadow-week report in `docs/reviews/` with the measured drop rate, false records and calibrated thresholds. |
| 8 | Switch on with one lane: `wip.implementers: 1` in `ops.yaml` (tier 3 PR), `agent-ops/STATUS` set to `active` (tier 3 PR), then Rafa sets the repository variable `AGENT_OPS` to `on` (Settings, Secrets and variables, Actions, Variables). The README lists the switch as the last step, but the one-lane run needs it on. | Rafa | 10 min | The tick starts a task on its own and the PR carries a complete footer. |
| 9 | After 10 PRs merge in the single lane without a revert (threshold guessed), raise `wip.implementers` to 3 with the cross-family gates on. | Rafa merges; agent writes the PR | 5 min | Three lanes run; the daily log shows the pipeline figures. |

Also, at step 8: amend ADR-0010, point `docs/team.md` and `CLAUDE.md` at `agent-ops/`, and keep the Rules and checks table only in `docs/team.md`.

## Acceptance criteria

- [ ] Each step above has Rafa's go-ahead recorded in Handoff before it runs, and its "Done when" result recorded in Evidence (measured).
- [ ] `node scripts/ops/switch.mjs` reports on, and `node scripts/ops/tick.mjs --dry-run` shows the expected plan, before step 8's first real run.
- [ ] The kill switch is tested live once after step 8: Rafa sets `AGENT_OPS` to `off`, and the next tick starts nothing (measured).

## Out of scope

- More than three lanes (a later decision from measured CI queueing), mainnet anything.

## Evidence

## Decisions

## Handoff
