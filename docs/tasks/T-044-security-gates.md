# T-044: Security gates: risk tiers, guardrails, the shell guard and the deny list

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-034 merged (`scripts/ci/affected.mjs` and the `changes` job); T-040 (the tier table in `ops.yaml`); T-036 merged (its pre-commit gitleaks hook covers P4's local half)
- **Paths this task may touch:** `scripts/ci/guardrails.mjs` (new), `scripts/ci/tiers.mjs` (new), `scripts/hooks/bash-guard.sh` (new), `.github/CODEOWNERS` (exists; add the tier 3 paths), `agent-ops/settings.deny.json` (new: the proposed deny additions), `agent-ops/ops.yaml` (`tiers`, `guardrails`, `deny_additions`; after T-040), `agent-ops/gates.md` (the tier table and the State column), `tests/agent-ops/guardrails.test.ts` (new), `tests/agent-ops/bash-guard.test.ts` (new), `docs/team.md` (Rules and checks rows), `docs/tasks/T-044-security-gates.md`
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
- PR 108's three review rounds found gaps that PR 112 does not cover (read them with `git fetch origin pull/108/head`; head `35a8921`, its parent `3956390`):
  - files that define the gates sit in tier 0 or 1, so they would auto-merge;
  - today's CODEOWNERS entries become binding once code-owner review is required;
  - the force-push deny rules match by prefix only;
  - an agent can accept its own ADR.

  The criteria below fold them in.
- `.github/CODEOWNERS` today names Rafa for `spec/`, `docs/decisions/` and `contracts/` (measured). These are tier 2 paths.

## Acceptance criteria

- [ ] `tiers.mjs` maps a list of paths to a tier from `ops.yaml`. A PR takes its highest path's tier, an unmatched path is tier 1, and `*.expect.md` counts as code. One test case per row of the tier table.
- [ ] The tier table in `ops.yaml` and `gates.md` adds the files that define the gates:
  - **Tier 3:**
    - `scripts/ci/affected.mjs`, which decides which CI jobs run;
    - `scripts/ci/guardrails.mjs`, `scripts/ci/tiers.mjs` and `scripts/ci/flakes.mjs`;
    - `docs/testing.md`, whose Known flakes list authorizes reruns;
    - `docs/team.md`, which holds the Rules and checks;
    - `eslint.config.js`, `vitest.config.ts`, `scripts/verify.ts` and `scripts/validate-spec.mjs`;
    - `package.json` when its `scripts` change (other `package.json` changes are tier 2, with the lockfile).
  - **At least tier 2:** `packages/testkit/`, which runs `pnpm snap`.
- [ ] `guardrails.mjs <pr or diff>` reports these findings, each shown on a fixture diff:
  - **Fails the PR:**
    - a changed path outside the task's listed paths;
    - a `spec/schemas/` change without a new ADR and a version bump.
  - **Raises the PR to tier 3:**
    - a deleted or edited `attack.*` or `neutrality.*` fixture;
    - a raised test timeout;
    - a new admin selector;
    - a task file that gains or edits an approval line from Rafa or its `Origin` field. Task files are tier 0, so without this rule any agent could write Rafa's approval itself;
    - an ADR whose Status changes to Accepted. Rafa accepts ADRs (`.claude/agents/architect.md`), and without this rule a tier 2 PR could do it automatically;
    - a `package.json` change to `scripts`.
  It runs locally and in tests only. T-050 step 5 adds it to the `check` job.
- [ ] A PR that guardrails raises to tier 3 needs Rafa's approval even when none of its paths is in CODEOWNERS. A task file, an ADR's Status line or an attack fixture is not a tier 3 path, so code-owner review alone would not stop it. In enforce mode, guardrails fails `check` on a raised PR until an approving review by Rafa exists on the PR's head commit, read from the reviews API. T-050 step 5 adds a `pull_request_review` trigger, so his approval re-runs the check. Tested with a fake reviews API: no review, a review on an older commit, and a review on the head.
- [ ] `bash-guard.sh` reads the tool input JSON on stdin and exits 2 with a one-line reason for each pattern in `isolation.bash_guard_blocks` (`cd` outside the root, heredoc and redirect writes, `sed -i`, interpreter one-liners, command substitution, `xargs`, `eval`, `find -exec`, `/private/tmp`, `~/`, polling loops), and exits 0 for the literal commands in `CLAUDE.md`'s verify list. `pnpm vitest run tests/agent-ops/bash-guard.test.ts` covers both sets. The hook is not wired into `.claude/settings.json` here.
- [ ] `agent-ops/settings.deny.json` lists the P6 additions in `.claude/settings.json` syntax, ready for T-050 to merge in:
  - `wrangler`, `gh api --method`, `gh repo edit`, `gh secret`, `gh ruleset`, `gh pr merge --admin`, and pushes to `main`;
  - every `git push` form that rewrites or deletes a ref, beyond today's `--force` and `-f` prefixes: a `+ref` refspec, a `:ref` refspec, `--delete` and `-d`, `--mirror`, `--force-with-lease` and `--force-if-includes`. Without these, an agent could delete or rewrite another agent's `t-*` claim.

  `bash-guard.sh` refuses the same forms, with a test for each. It says that denying `gh api --method` also blocks opening PRs through REST, which is how Claude Code cloud sessions must do it. So the deny list fits option B only, where `gh pr create` works with the App's token.
- [ ] `.github/CODEOWNERS` names Rafa for every tier 3 path. It changes nothing until the `tier3-review` ruleset requires code-owner review (T-050). The file's three existing tier 2 entries (`spec/`, `docs/decisions/`, `contracts/`) would then need Rafa's review too. T-050 step 2 asks him whether they stay; this task leaves them as they are and records the question in Handoff.
- [ ] `docs/team.md` Rules and checks gains a row for each new check, marked "not wired until T-050". `pnpm verify` and CI pass.

## Out of scope

- Dependency review beyond `--frozen-lockfile` (P7 stays as is), secret scanning changes (gitleaks is required already).

## Evidence

## Decisions

## Handoff
