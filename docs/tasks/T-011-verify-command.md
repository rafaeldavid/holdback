# T-011: `/verify` command, feature map, PR template

- **Lane:** infra
- **Phase:** 0
- **Depends on:** T-005
- **Paths this task may touch:** `.claude/commands/verify.md`, `scripts/verify.ts`, `docs/feature-map.md`, `.github/pull_request_template.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** kickoff session (implementer)

## Intent

Give every agent one command that runs the product and collects evidence, and a feature map tying user-facing beats to fixtures.

Restatement: give every agent one command, `pnpm verify`, that runs all checks and the product and leaves a readable report, so evidence in task files and PRs comes from the same place. Add a feature map from demo beats to fixtures to packages, and a PR template that asks for that evidence plus the litmus tests. Inputs: T-001 scripts, `docs/demo.md`, `docs/plan.md` scenario index. Non-goals: implementing `snap` or `demo` (T-005, T-013); `verify` reports them as placeholders until then.

## Context

- `docs/team.md`; `docs/demo.md`; pstack's verification practice (make results observable; label claims).

## Acceptance criteria

- [x] `pnpm verify` runs typecheck, tests, snap, demo (recorded) and writes `reports/verify-<branch>.md` with pass/fail per step and snapshot diffs. (snap and demo report `placeholder` until T-005 and T-013.)
- [x] `docs/feature-map.md`: each demo beat → fixtures → packages.
- [x] PR template with acceptance checklist, evidence (measured/inferred/guessed), contract checklist, risks. (Superseded by Rafa's choice of pstack's format: the acceptance checklist stays in the task file, evidence goes under Verification, and risks and human gates go under Blast Radius.)

## Out of scope

- Product code.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **`pnpm verify` on this branch (measured):** typecheck pass (915 ms), lint pass (1136 ms), test pass (1620 ms), spec pass (223 ms), snap placeholder, demo placeholder; exit 0; report written to `reports/verify-t-011-verify-command.md`.
- **Failure path (measured):** with a deliberate type error in `packages/sdk/src`, the report showed `Result: FAIL (typecheck)`, the other steps still ran, and the command exited 1. Error file removed.
- **Feature map:** fixture names taken from the `docs/plan.md` scenario index (inferred complete; T-010 will confirm).

## Decisions

- **Runs every step after a failure,** so one report shows everything; exit 1 if any step failed.
- **`placeholder` is its own status,** detected from the marker printed by `scripts/placeholder.mjs`, and is never counted as a pass.
- **`scripts/verify.ts` runs with Node 22's built-in type stripping** (no tsx dependency). It is linted but outside the `tsc -b` project.
- **Lint and spec validation added as steps** beyond the task's list (typecheck, test, snap, demo), since CI runs them too.
- **Snapshot diffs** are `git diff HEAD -- fixtures/**/*.expect.md`, which covers uncommitted `pnpm snap --update` output.
- **PR template format:** Rafa chose pstack's opening-a-pr format (Why, What changed, Scope, Tradeoffs, Blast Radius, Verification) over the kit's checklist template. Claim labels stay, inside Verification, because `CLAUDE.md` requires them.
- **Out-of-path edits:** `docs/team.md` (worktree path now `.worktrees/`, PR template reference), `CLAUDE.md` (`pnpm verify` line), `.gitignore` (`.worktrees/`), `package.json` (`verify` script).

## Handoff

- Done: verify script, report, feature map, PR template, `/verify` command doc.
- Not done: T-005 must make `pnpm snap` print a per-fixture pass/fail list; verify will then show it in the output tail. Consider parsing it into the report table then.
- Stacked on T-001 (branch `t-001-monorepo-scaffold`); merge T-001 first.
