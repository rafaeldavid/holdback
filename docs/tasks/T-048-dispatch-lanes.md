# T-048: Dispatch and lane ownership: task lint, the tick and claims

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-036 merged (`/start-task`, `/merge-pr`); T-041 (records feed the architect); T-044 (tiers); T-047 (the switch reader and the metrics line)
- **Paths this task may touch:** `scripts/ops/task-lint.mjs` (new), `scripts/ops/tick.mjs` (new), `tests/agent-ops/task-lint.test.ts` (new), `tests/agent-ops/tick.test.ts` (new), `agent-ops/pipeline.md` (Dispatch and Concurrency sections), `docs/tasks/_template.md` (an optional "Origin" field), `docs/tasks/T-048-dispatch-lanes.md`
- **Human gate:** no. Wiring the tick to run on merges and on a schedule is T-050's step.
- **Status:** todo
- **Agent/session:** —

## Intent

Let a script, not a model, decide which task is ready to start, and keep parallel lanes from colliding.

- Inputs: task files, git branches, open PRs, the switches, the limits and budgets in `ops.yaml`.
- Outputs: a list of tasks to start (or, in a dry run, what it would start and why not), claims as pushed `t-<id>-<slug>` branches, and one metrics line per run.
- Non-goals: starting sessions (that is `/start-task`, T-036), running on a trigger (T-050).

## Context

- `agent-ops/pipeline.md` (Pipeline stages 1 and 2, Dispatch, Concurrency and its single-writer table), `agent-ops/ops.yaml` (`tick`, `wip`, `budgets_usd`, `single_writer`, `branch_update`).
- Why a stateless script: a long-running coordinator stopped at the weekly token limit on 2026-11-01 (measured, `docs/log/2026-11-01.md`).
- Why a branch claim: CI runs only on pushes to `main` and on PRs (measured, `.github/workflows/ci.yml`), so pushing a branch starts no CI run.

## Acceptance criteria

- [ ] `task-lint.mjs <task file>` checks: every listed path exists or is marked new; no open PR or claimed task touches the same paths; each acceptance criterion names a command; a single-writer file (`docs/log/*`, `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, shared config) appears only in a task of its owning role or lane. One failing case per check.
- [ ] `tick.mjs` rebuilds its state from git and GitHub on each run and exits. It starts a task only when the switches are on, the task is `todo`, its dependencies have merged, no `t-<id>-*` branch exists, its paths are disjoint from open PRs and claims, and the limits and the daily budget allow it. Each condition has a refusal test, run against a fake git and GitHub state.
- [ ] `--dry-run` is the default; it prints the plan and writes the metrics line, and pushes nothing.
- [ ] A claim is a pushed branch whose first commit sets the task's Status to `in progress`; a rejected push means another session holds the task. A claim with no push for 24 hours is reported for release (the dry run lists it; a real run deletes the branch and reopens the task).
- [ ] A task whose Origin is untrusted input and whose paths reach tier 2 or tier 3 waits until its file carries Rafa's approval line. PRs from forks are never dispatched. A task that fails review three times is marked `needs-human`.
- [ ] `pnpm verify` passes; a dry run on the real repository's state is pasted in Evidence (measured).

## Out of scope

- Budgets per token (T-047 decides the spend source), a long-running coordinator.

## Evidence

## Decisions

## Handoff
