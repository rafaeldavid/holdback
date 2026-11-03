# T-048: Dispatch and lane ownership: task lint, briefs, the tick and claims

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-036 merged (`/start-task`, `/merge-pr`); T-041 (records and `Origin`); T-044 (tiers, the approval-line guardrail); T-047 (the switch reader, the metrics line, the budget stop)
- **Paths this task may touch:** `scripts/ops/task-lint.mjs` (new), `scripts/ops/brief.mjs` (new), `scripts/ops/tick.mjs` (new), `scripts/ops/start-session.mjs` (new), `tests/agent-ops/task-lint.test.ts` (new), `tests/agent-ops/brief.test.ts` (new), `tests/agent-ops/tick.test.ts` (new), `docs/tasks/_template.md` (an optional "Origin" field), `docs/tasks/T-048-dispatch-lanes.md`
- **Human gate:** no. Wiring the tick to triggers and a schedule is T-050 step 6.
- **Status:** todo
- **Agent/session:** —

## Intent

Let a script, not a model, decide which task is ready to start. Give each session a brief that carries no injected text. Keep parallel lanes from colliding.

- **Inputs:** task files, git branches, open PRs, the switches, and the limits and budgets in `ops.yaml`.
- **Outputs:**
  - a list of tasks to start, or, in a dry run, what it would start and why not;
  - claims, as pushed `t-<id>-<slug>` branches;
  - briefs;
  - one metrics line per run.
- **Where the tick runs:** decide it here and record the reason. The design proposes a stateless script on option B, run by a Haiku session or a plain process under the `tick` user. It resets the role's home with `/opt/crow/reset-home` (T-039), then starts each session as that role's user, with `claude -p`, in its own worktree. On option A it cannot delete stale claims, because the proxy refuses branch deletions.
- Non-goals: running on triggers (T-050), a long-running coordinator.

## Context

- `agent-ops/pipeline.md` (stages 1 to 3, Dispatch, Concurrency and its single-writer table), `agent-ops/gates.md` (P2), `agent-ops/ops.yaml` (`tick`, `wip`, `budgets_usd`, `single_writer`, `branch_update`). PR 112, not merged yet.
- Why a stateless script: a long-running coordinator stopped at the weekly token limit on 2026-11-01 (measured, `docs/log/2026-11-01.md`).
- Why a branch claim: CI runs only on pushes to `main` and on PRs (measured, `.github/workflows/ci.yml`), so pushing a branch starts no CI run.

## Acceptance criteria

- [ ] `task-lint.mjs <task file>` checks each of these, with one failing case per check:
  - every listed path exists or is marked new;
  - no open PR or claimed task touches the same paths;
  - each acceptance criterion names a command;
  - a single-writer file (`docs/log/*`, `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, shared config) appears only in a task of its owning lane, or with a note naming its owner's route, such as "(architect, through `/record-decision`)".
- [ ] `brief.mjs <task>` builds a session brief from the task file's fields only: Intent, paths, acceptance criteria, lane, human gate. It covers threat P2 as follows:
  - Text that an agent wrote (Handoff, Evidence, review findings) enters a brief only inside a fenced block marked as data.
  - It never carries a PR body or comment.
  - The model comes from `modelFor` (T-040).
  - A verifier's brief says it returns verdicts as text and writes no file. The implementer's brief says to add those verdicts to Evidence as a quoted block naming the verifier's session.
- [ ] For a tier 2 task, the tick first starts the fixture-author, and starts the implementer only after the failing tests are committed on the claim branch.
- [ ] `tick.mjs` rebuilds its state from git and GitHub on each run, and exits. It starts a task only when all of these hold, with a refusal test for each, run against a fake git and GitHub state:
  - the switches are on;
  - the task is `todo`, and its dependencies have merged;
  - no `t-<id>-*` branch exists;
  - its paths are disjoint from open PRs and claims;
  - the work-in-progress limits allow it, including at most `wip.prs_in_ci` (2) PRs waiting on CI;
  - the daily budget allows it.
- [ ] `--dry-run` is the default. It prints the plan and writes the metrics line, and pushes nothing.
- [ ] A claim is a pushed branch whose first commit sets the task's Status to `in progress`. A rejected push means another session holds the task. A claim with no push for 24 hours is reported for release: the dry run lists it, and a real run on option B deletes the branch and reopens the task.
- [ ] A task with `Origin: untrusted` waits until its file carries Rafa's approval line. Until T-050 step 10, that holds whatever the task's tier; after it, only for tier 2 and tier 3.
  - The tick checks the line itself, not only its presence. Through the API, it finds the PR that merged the commit adding the line. It accepts the line only if that PR has an approving review by Rafa on its head commit, or the commit is verified and authored by `rafaeldavid`.
  - PRs from forks are never dispatched.
  - A task that fails review three times is marked `needs-human`.
- [ ] The lander merges a PR only once `crow-review` has approved its head commit (T-039), and T-050's `main` ruleset requires the same. A builder session cannot stand in for the reviewer.
- [ ] `start-session.mjs` starts one session for a planned task, in its own worktree, with the brief and the model. Shown with a dry run that prints the command.
- [ ] `pnpm verify` passes. A dry run on the real repository's state is pasted in Evidence (measured).

## Out of scope

- Token metering (T-047 decides the spend source), a long-running coordinator.

## Evidence

## Decisions

## Handoff
