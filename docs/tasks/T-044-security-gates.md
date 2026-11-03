# T-044: Security gates: risk tiers, guardrails, the shell guard and the deny list

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-034 merged (`scripts/ci/affected.mjs` and the `changes` job); T-040 (the tier table in `ops.yaml`); T-036 merged (its pre-commit gitleaks hook covers P4's local half)
- **Paths this task may touch:** `scripts/ci/guardrails.mjs` (new), `scripts/ci/tiers.mjs` (new), `scripts/hooks/bash-guard.sh` (new), `.github/CODEOWNERS` (exists; add the tier 3 paths), `agent-ops/settings.deny.json` (new: the proposed deny additions), `agent-ops/workflows/ci.yml` (new, inert: the proposed `ci.yml` with the trusted checkout, which T-050 moves in), `agent-ops/workflows/approval.yml` (new, inert), `agent-ops/ops.yaml` (`tiers`, `guardrails`, `deny_additions`; after T-040), `agent-ops/gates.md` (the tier table and the State column), `tests/agent-ops/guardrails.test.ts` (new), `tests/agent-ops/bash-guard.test.ts` (new), `docs/team.md` (Rules and checks rows), `docs/tasks/T-044-security-gates.md`
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
- [ ] The tier table in `ops.yaml` and `gates.md` adds the files that define the gates, and the code that holds secrets at run time:
  - **Tier 3.** These files decide what runs, what passes, or who is reviewed. Each would otherwise be tier 1 and auto-merge:
    - the pipeline's own code: `scripts/ci/**` (including `affected.mjs`, `guardrails.mjs`, `tiers.mjs`, `flakes.mjs`), `scripts/ops/**`, `scripts/hooks/**` and `scripts/dev-env/**`;
    - the build and test configuration: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig*.json`, `vitest.config.*`, `eslint.config.*`, `scripts/verify.ts` and `scripts/validate-spec.mjs`;
    - the gitleaks configuration, `gitleaks.toml` and `.gitleaks.toml`, which gitleaks-action loads from the root (documented);
    - `docs/testing.md`, whose Known flakes list authorizes reruns, and `docs/team.md`, which holds the Rules and checks.
  - **At least tier 2:**
    - `packages/testkit/`, which runs `pnpm snap`;
    - the code a deploy or export session runs with secrets: `apps/demo-cloud/**`, `apps/site/**`, `apps/early-access/**` and `site/build.mjs`. A tier 1 change there could serve or log a Worker secret at the next deploy.

  More tier 3 paths mean more PRs that wait for Rafa. The cost is accepted, because each of these files can switch a gate off.
- [ ] `guardrails.mjs <pr or diff>` reports these findings, each shown on a fixture diff:
  - **Fails the PR:**
    - a changed path outside the task's listed paths;
    - a `spec/schemas/` change without a new ADR and a version bump.
  - **Raises the PR to tier 3:**
    - a deleted or edited `attack.*` or `neutrality.*` fixture;
    - a raised test timeout;
    - a new admin selector;
    - a task file that gains or edits an approval line from Rafa or its `Origin` field. Task files are tier 0, so without this rule any agent could write Rafa's approval itself;
    - an ADR whose Status changes to Accepted. Rafa accepts ADRs (`.claude/agents/architect.md`), and without this rule a tier 2 PR could do it automatically.

  It runs locally and in tests only until T-050 step 5 adds it to the `check` job.
- [ ] A PR must never run its own copy of the gates, nor share a runner with them. This task writes the proposed `ci.yml` at `agent-ops/workflows/ci.yml`, and T-050 step 5 moves it in. Rafa pushes that move, since the agents have no Workflows permission. The proposed file adds two jobs, `gates` and `changes`. Each of them:
  - checks out only `main`, once;
  - installs nothing from the PR, runs none of the PR's files, and uses no cache, since a PR run can save a poisoned cache under `main`'s key;
  - reads the PR's file list, reviews and timeline from the API.

  `gates` runs `guardrails.mjs` and `tiers.mjs`, and `changes` runs `affected.mjs`; `check` needs both. Otherwise a test in the PR could rewrite the gate scripts, their dependencies or the tool cache on the same runner before they run, or one tier 1 PR could delete an attack fixture together with the rule that flags it. A test reads the proposed file and checks that `gates` and `changes` each have a single checkout with `ref: main`, no `cache:` and no step that runs PR code.
- [ ] The checks about reviews live in their own status, `approval`, never in `check`.
  - **Why separate:** `check` sits in the `main` ruleset, which nobody can bypass, and review starts only once CI passes. A review check inside `check` would deadlock every PR. It would also block Rafa's merge through his bypass of `required-review` when no reviewer can run.
  - **Where it runs:** this task writes a small workflow, `agent-ops/workflows/approval.yml`, which T-050 step 5 moves in. It runs on `pull_request` (types `opened`, `synchronize`, `reopened` and `edited`, so a retarget recomputes it) and `pull_request_review`, checks out only `main`, runs no PR code, and reads reviews from the API. An approval therefore re-runs only this check, not the whole CI.
  - **Who requires it:** the `required-review` ruleset (T-050 step 2), whose bypass is Rafa's.
  - **What it checks depends on the author:**
    - **`crow-agents[bot]` or `dependabot[bot]`:** the approving review on the head commit must be by `crow-review[bot]` or `rafaeldavid`. Without this, `crow-agents` could approve a PR that `crow-review` opened. Dependabot's changes are to tier 3 manifests, so Rafa reviews them anyway.
    - **`rafaeldavid`:** nothing beyond the rulesets. GitHub never lets him approve his own PR, and his bypass is his decision. So a PR he authors passes `approval` with no review, and when no reviewer can run, he is never locked out.
    - **Anyone else:** it fails.
  - **A PR that guardrails raised to tier 3** also needs an approving review by Rafa on its head commit, unless he authored it. That holds even when none of its paths is in CODEOWNERS: a task file, an ADR's Status line or an attack fixture is not a tier 3 path, so code-owner review alone would not stop it.

  Tested with a fake reviews API: no review, a review on an older commit, a review by the author, a review on the head, and a PR Rafa authored.
- [ ] Guardrails read a PR's allowed paths from its task file on `main`, never from the PR. A PR that widens its own task's paths would otherwise pass its own scope check.
- [ ] `bash-guard.sh` reads the tool input JSON on stdin and exits 2 with a one-line reason for each pattern in `isolation.bash_guard_blocks` (`cd` outside the root, heredoc and redirect writes, `sed -i`, interpreter one-liners, command substitution, `xargs`, `eval`, `find -exec`, `/private/tmp`, `~/`, polling loops), and exits 0 for the literal commands in `CLAUDE.md`'s verify list. `pnpm vitest run tests/agent-ops/bash-guard.test.ts` covers both sets. The hook is not wired into `.claude/settings.json` here.
- [ ] `agent-ops/settings.deny.json` lists the P6 additions in settings syntax, for T-050 to install in T-039's managed settings and each role's home template:
  - `gh api:*` wholesale, with a read-only wrapper for the GET calls agents need. Narrower patterns miss `-X PUT`, `--method=PUT`, and the implicit POST of `-f key=value`.
  - `gh auth token:*`, `gh repo edit`, `gh secret`, `gh ruleset`, `gh variable`, and `gh pr merge` for every role but `tick`;
  - `wrangler`, `npx wrangler:*` and `pnpm demo-cloud:*` for build roles;
  - pushes to `main`;
  - every `git push` form that rewrites or deletes a ref, beyond today's `--force` and `-f` prefixes: a `+ref` refspec, a `:ref` refspec, `--delete` and `-d`, `--mirror`, `--force-with-lease` and `--force-if-includes`. Without these, an agent could delete or rewrite another agent's `t-*` claim.

  `bash-guard.sh` refuses the same forms, with a test for each. The file says plainly that a deny rule is not a security boundary (Claude Code docs). The boundary is each role's narrowed token and Unix user (T-039); the deny list only catches honest mistakes. It also says the list fits option B only: on A, opening a PR needs `gh api` POST.
- [ ] `.github/CODEOWNERS` names Rafa for every tier 3 path. It changes nothing until the `tier3-review` ruleset requires code-owner review (T-050). The file's three existing tier 2 entries (`spec/`, `docs/decisions/`, `contracts/`) would then need Rafa's review too. T-050 step 2 asks him whether they stay; this task leaves them as they are and records the question in Handoff.
- [ ] A test checks that every tier 3 path in `ops.yaml` has a matching CODEOWNERS line, and that the file parses. A syntax error silently drops the owners after it (documented).
- [ ] `docs/team.md` Rules and checks gains a row for each new check, marked "not wired until T-050". `pnpm verify` and CI pass.

## Out of scope

- Dependency review beyond `--frozen-lockfile` (P7 stays as is), secret scanning changes (gitleaks is required already).

## Evidence

## Decisions

## Handoff
