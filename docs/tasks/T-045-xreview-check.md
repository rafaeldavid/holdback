# T-045: The cross-family review check (`xreview`)

- **Lane:** infra (reuses the judgment lane's provider client, read-only)
- **Phase:** 9
- **Depends on:** T-040 (pinned second-family models); T-044 (tiers)
- **Paths this task may touch:** `scripts/ops/xreview.mjs` (new), `agent-ops/prompts/xreview.md` (new), `agent-ops/workflows/xreview.yml` (new, inert), `tests/agent-ops/xreview.test.ts` (new), `agent-ops/gates.md` (the State column), `docs/tasks/T-045-xreview-check.md`
- **Human gate:** no to build. The DeepSeek key as an Actions secret and making `xreview` a required check are Rafa's (T-050, step 2).
- **Status:** todo
- **Agent/session:** —

## Intent

Give every tier 2 and tier 3 pull request a blind review from a model outside the Anthropic family, posted as a status that no agent can forge (threats P3, P9, P10).

- Input: the PR's diff from the GitHub API, its task's acceptance criteria and the three litmus tests. Not the PR's self-assessment, not the other review.
- Output: a `ReviewVerdict` (`agent-ops/schemas/review-verdict.schema.json`) and a commit status `xreview`.
- Non-goals: milestone reviews such as phase exits and ADR critiques (T-046); running any code from the PR.

## Context

- `agent-ops/gates.md` ("Cross-family review in CI", the disagreement rules), `agent-ops/teams.md` (second-family reviewer), `agent-ops/ops.yaml` (`xreview_ci`, `blocking_finding`, `never`).
- `apps/adjudicator/src/providers/live.ts`: the OpenAI-compatible client the live judges use for DeepSeek, with `onUsage`.
- `docs/reviews/2026-11-02-dev-velocity.md` §2.2: a required check that never reports blocks every PR.

## Acceptance criteria

- [ ] `xreview.mjs <pr>` builds the request from the diff as data between random delimiters with a canary token, sends it with no tools through `live.ts`, and accepts the answer only if it matches the schema; anything else is an abstention, which counts as ISSUES.
- [ ] A finding blocks only if it names a path and line, the rule or litmus test it breaks, and a reproduction; other findings are written as suggestions for intake.
- [ ] The same diff SHA always returns its first verdict (cached by SHA); a new review needs a new diff. Tested.
- [ ] Tiers 0 and 1 get a passing status at once. When DeepSeek fails, the GPT fallback reviews; when both fail, the status fails with "needs Rafa".
- [ ] `agent-ops/workflows/xreview.yml` runs on `pull_request_target` for same-repository branches only, checks out the base branch only, reads the diff from the API, has `contents: read`, `pull-requests: read` and `statuses: write` and nothing else, runs one review at a time, and stops at 30 calls a day. It lives outside `.github/workflows/` so it cannot run; T-050 moves it. A test reads the file and checks each of these properties.
- [ ] Tests run with a scripted provider and no keys; `--live` on three past PRs records the verdicts and the cost (measured) in Evidence.

## Out of scope

- Any comment-based approval (every agent shares one account today, so any agent could post one).

## Evidence

## Decisions

## Handoff
