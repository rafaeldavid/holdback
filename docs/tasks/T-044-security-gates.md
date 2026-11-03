# T-044: Security gates: risk tiers, guardrails, the shell guard and the deny list

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-034 merged (`scripts/ci/affected.mjs` and the `changes` job); T-040 (the tier table in `ops.yaml`); T-036 merged (its pre-commit gitleaks hook covers P4's local half)
- **Paths this task may touch:** `scripts/ci/guardrails.mjs` (new), `scripts/ci/tiers.mjs` (new), `scripts/hooks/bash-guard.sh` (new), `.github/CODEOWNERS` (new), `agent-ops/settings.deny.json` (new: the proposed deny additions), `agent-ops/gates.md` (the State column), `tests/agent-ops/guardrails.test.ts` (new), `tests/agent-ops/bash-guard.test.ts` (new), `docs/team.md` (Rules and checks rows), `docs/tasks/T-044-security-gates.md`
- **Human gate:** no. The two settings that enforce tier 3 (a separate identity for the agents and a required code-owner review) are Rafa's, in T-039 and T-050.
- **Status:** todo
- **Agent/session:** —

## Intent

Build the automated checks behind threats P4 to P7 and P12 so that a pull request's risk tier, not an agent's judgment, decides what it needs before merge.

- Inputs: a pull request's changed paths and its task file.
- Outputs: the PR's tier (0 to 3), guardrail findings, a shell guard that turns prompt-triggering or escalating commands into tool errors, and the deny list that activation adds.
- Non-goals: the cross-family check (T-045), switching enforcement on (T-050).

## Context

- `agent-ops/gates.md` (Risk tiers; Threats and controls P4 to P7, P12), `agent-ops/pipeline.md` (Concurrency: the shell guard's patterns), `agent-ops/ops.yaml` (`tiers`, `guardrails`, `deny_additions`, `isolation.bash_guard_blocks`).
- `docs/reviews/2026-11-02-dev-velocity.md` §2.2: never add `paths:` to `on.pull_request`, and keep `check` and `gitleaks` reporting.
- PR 112's README rule: nothing in `.github/` reads `agent-ops/` before activation. So guardrails reach CI only at T-050 step 5, and T-040's inert-pipeline test enforces that.

## Acceptance criteria

- [ ] `tiers.mjs` maps a list of paths to a tier from `ops.yaml`; a PR takes its highest path's tier; an unmatched path is tier 1; `*.expect.md` counts as code. One test case per row of the tier table.
- [ ] `guardrails.mjs <pr or diff>` reports these findings, each shown on a fixture diff:
  - **Fails the PR:**
    - a changed path outside the task's listed paths;
    - a `spec/schemas/` change without a new ADR and a version bump.
  - **Raises the PR to tier 3:**
    - a deleted or edited `attack.*` or `neutrality.*` fixture;
    - a raised test timeout;
    - a new admin selector;
    - a task file that gains or edits an approval line from Rafa or its `Origin` field. Task files are tier 0, so without this rule any agent could write Rafa's approval itself.
  - **Fails the commit:** a commit with the trailer `Agent-Role: verifier` that changes anything but its task's Evidence section. The verifier's brief (T-048) adds the trailer.

  It runs locally and in tests only. T-050 step 5 adds it to the `check` job.
- [ ] `bash-guard.sh` reads the tool input JSON on stdin and exits 2 with a one-line reason for each pattern in `isolation.bash_guard_blocks` (`cd` outside the root, heredoc and redirect writes, `sed -i`, interpreter one-liners, command substitution, `xargs`, `eval`, `find -exec`, `/private/tmp`, `~/`, polling loops), and exits 0 for the literal commands in `CLAUDE.md`'s verify list. `pnpm vitest run tests/agent-ops/bash-guard.test.ts` covers both sets. The hook is not wired into `.claude/settings.json` here.
- [ ] `agent-ops/settings.deny.json` lists the P6 additions (`wrangler`, `gh api --method`, `gh repo edit`, `gh secret`, `gh ruleset`, `gh pr merge --admin`, pushes to `main`) in `.claude/settings.json` syntax, ready for T-050 to merge in. It says that denying `gh api --method` also blocks opening PRs through REST, which is how Claude Code cloud sessions must do it. So the deny list fits option B only, where `gh pr create` works with the App's token.
- [ ] `.github/CODEOWNERS` names Rafa for every tier 3 path. It changes nothing until the `tier3-review` ruleset requires code-owner review (T-050).
- [ ] `docs/team.md` Rules and checks gains a row for each new check, marked "not wired until T-050". `pnpm verify` and CI pass.

## Out of scope

- Dependency review beyond `--frozen-lockfile` (P7 stays as is), secret scanning changes (gitleaks is required already).

## Evidence

## Decisions

## Handoff
