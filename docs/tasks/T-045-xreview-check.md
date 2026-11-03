# T-045: The cross-family review check (`xreview`)

- **Lane:** infra (reuses the judgment lane's provider client, read-only)
- **Phase:** 10
- **Depends on:** T-040 (pinned second-family models); T-044 (tiers)
- **Paths this task may touch:** `agent-ops/schemas/review-verdict.schema.json` (hardened), `scripts/ops/xreview.mjs` (new), `agent-ops/prompts/xreview.md` (new), `agent-ops/workflows/xreview.yml` (new, inert), `tests/agent-ops/xreview.test.ts` (new), `agent-ops/gates.md` (the State column and the three preconditions; after T-044), `docs/tasks/T-045-xreview-check.md`
- **Human gate:** yes for the `--live` runs only. Rafa gives one session a capped DeepSeek key and approves the spend, as for T-028 (T-039 step 15). No for building with the scripted provider. Putting the key in a GitHub Environment and making `xreview` a required check are Rafa's (T-050, step 2).
- **Status:** todo
- **Agent/session:** —

## Intent

Give every tier 2 and tier 3 pull request a blind review from a model outside the Anthropic family, posted as a status that no agent can forge (threats P3, P9, P10).

The status is unforgeable only under three preconditions:

1. The agents' GitHub identity has no Workflows permission (T-039 step 3). Otherwise a branch push could add an `on: push` workflow that posts `xreview`, `check` or `gitleaks` as passing and reads repository secrets.
2. The review keys live in a GitHub Environment whose deployment branches are limited to `main`, not in repository secrets (T-050 step 2). A `pull_request_target` run takes the base branch's ref, so it passes that limit (inferred).
3. "Allow GitHub Actions to create and approve pull requests" stays off (T-039 step 4).

- Input: the PR's diff from the GitHub API, its task's acceptance criteria and the three litmus tests. Not the PR's self-assessment, not the other review.
- Output: a `ReviewVerdict` (`agent-ops/schemas/review-verdict.schema.json`) and a commit status `xreview`.
- Non-goals: milestone reviews such as phase exits and ADR critiques (T-046); running any code from the PR.

## Context

- `agent-ops/gates.md` ("Cross-family review in CI", the disagreement rules), `agent-ops/teams.md` (second-family reviewer), `agent-ops/ops.yaml` (`xreview_ci`, `blocking_finding`, `never`).
- `apps/adjudicator/src/providers/live.ts`: the OpenAI-compatible client the live judges use for DeepSeek, with `onUsage`.
- `docs/reviews/2026-11-02-dev-velocity.md` §2.2: a required check that never reports blocks every PR.

## Acceptance criteria

- [ ] The `ReviewVerdict` schema is hardened, so that a non-Anthropic model's output can never become a command. In PR 112, `claim` and `reproduce` are free text, and the verifier runs the reproduction. Under Ajv 2020-12 strict, the hardened schema refuses each bypass sample:
  - `reproduce` is a repository path that must exist at the diff's SHA (checked by `xreview.mjs`), never a command;
  - `claim` is ASCII with no `/`, no `scheme:`, no `www.`, no brackets and no backticks;
  - `path` and `reproduce` cannot start with `/` or contain `..` or `.env`;
  - a PASS cannot carry a blocking finding;
  - ISSUES needs at least one finding;
  - the `litmus` enum keeps PR 112's `security` value.

  PR 108's tested version is the starting point, and its 20 bypass samples become this task's tests. Read it with `git fetch origin pull/108/head`, then `git show 3956390:agent-ops/schemas/review-verdict.schema.json`.
- [ ] `xreview.mjs <pr>` builds the request from the diff as data between random delimiters with a canary token, sends it with no tools through `live.ts`, and accepts the answer only if it matches the schema. Anything else is an abstention, which counts as ISSUES.
- [ ] A finding blocks only if it names a path and line, the rule or litmus test it breaks, and a reproduction; other findings are written as suggestions for intake.
- [ ] The same diff SHA always returns its first verdict (cached by SHA); a new review needs a new diff. Tested.
- [ ] A diff goes to DeepSeek only after the PR head's `gitleaks` check has passed, so a leaked secret never reaches a third party. Until then, the status reads pending. The workflow also runs on `workflow_run` when the CI workflow completes, which also runs from `main`. So the review starts once gitleaks has passed, and a required check never stays pending.
- [ ] Each verdict appends one line to `reports/review-agreement.jsonl`: the family, the model, the diff SHA, each finding's severity and, once known, its outcome. T-046 reads it.
- [ ] The tier comes from the full list of changed files. `xreview.mjs` paginates `GET /pulls/{n}/files` and compares the count with the PR's `changed_files`; a mismatch, or the compare API's 300-file truncation, counts as tier 3.
- [ ] A changed base cannot carry an old verdict. The workflow also runs on the `edited` activity type, because a base change is an edit and does not fire `synchronize` (documented). `xreview.mjs` posts success only when the PR's base is `main`, and it computes the diff against that base at run time. Otherwise an agent could get a docs-only verdict on a PR into a side branch, then retarget it at `main` with a tier 2 change underneath.
- [ ] Tiers 0 and 1 get a passing status at once. When DeepSeek fails, the GPT fallback reviews; when both fail, the status fails with "needs Rafa".
- [ ] `agent-ops/workflows/xreview.yml` lives outside `.github/workflows/`, so it cannot run; T-050 moves it. A test reads the file and checks each of these properties:
  - it runs on `pull_request_target` (types `opened`, `synchronize`, `reopened` and `edited`) and on `workflow_run` of the CI workflow, for same-repository branches only;
  - it checks out the base branch only and reads the diff from the API;
  - it takes its keys from the `xreview` Environment;
  - it has `contents: read`, `pull-requests: read`, `checks: read` and `statuses: write`, and nothing else;
  - it runs one review at a time and stops at 30 calls a day.
- [ ] Tests run with a scripted provider and no keys. After Rafa's go-ahead, `--live` on three past PRs records the verdicts and the cost (measured) in Evidence.

## Out of scope

- Any comment-based approval (every agent shares one account today, so any agent could post one).

## Evidence

## Decisions

## Handoff
