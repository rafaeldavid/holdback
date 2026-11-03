# T-040: Agent-ops config loader and the model mix

- **Lane:** infra
- **Phase:** 9
- **Depends on:** PR 112 merged (the `agent-ops/` design on main); Rafa starts Phase 9
- **Paths this task may touch:** `scripts/ops/config.mjs` (new), `tests/agent-ops/config.test.ts` (new), `tests/agent-ops-inactive.test.ts` (new), `agent-ops/ops.yaml` (`models`, `roles`, and the `feedback_requests` rates), `agent-ops/teams.md`, `agent-ops/pipeline.md` (the rate table only), `package.json` and `pnpm-lock.yaml` (`yaml` as a root dev dependency), `docs/decisions-today.md` (architect, through `/record-decision`: the GPT fallback pin), `docs/tasks/T-040-agent-ops-config-model-mix.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Make `agent-ops/ops.yaml` the one place every later Phase 9 script reads its models, roles, tiers, limits and budgets from, and prove that the pipeline stays inert while `agent-ops/STATUS` reads `inactive`.

- Input: `agent-ops/ops.yaml` and `agent-ops/teams.md` from PR 112.
- Output: a loader that parses and validates the file, a pinned model for every role, and a test that fails if anything starts running the pipeline before activation.
- Non-goals: the scripts that use the config (T-041 onward), any switch reading (T-047), any change to how sessions run today. The reviewer's model depends on the author's, so one `model:` line per agent file cannot express it; the model is chosen when a session starts.

## Context

- `agent-ops/teams.md` (roles, models, rules), `agent-ops/ops.yaml` (`models`, `roles`, `wip`, `budgets_usd`, `tiers`).
- `CLAUDE.md` hard rule "Pinned models": no `latest`, no aliases. `config/judges-live.yaml` records DeepSeek's alias with the call date, because DeepSeek publishes no snapshots.
- D31 (parametrize, don't restrict): limits and budgets are parameters, not constants in code. `CLAUDE.md`, hard rule "Money": rates are integers, in basis points or as a numerator and denominator. `ops.yaml` writes the feedback-request rates as decimals (`rate: 0.10`).
- `yaml` is declared only in `apps/adjudicator/package.json`, and the root has no hoisted copy (measured), so a root script needs it as a root dev dependency, at the same version range.
- PR 112's README rule: no file in `.claude/` or `.github/` reads `agent-ops/` until activation.

## Acceptance criteria

- [ ] `scripts/ops/config.mjs` loads `agent-ops/ops.yaml` and refuses it, naming the field, when:
  - a model ID is missing, empty or ends in `latest`;
  - a role names a model the `models` map lacks;
  - for any author model, the reviewer model equals it;
  - the second family's `family` is `claude`;
  - a `wip` or `budgets_usd` value is not a non-negative integer;
  - any rate is not an integer number of basis points.

  `pnpm vitest run tests/agent-ops/config.test.ts` covers each refusal.
- [ ] The feedback-request rates in `ops.yaml` and `pipeline.md` become basis points: `rate_bps: 1000`, `10000` and `2500`.
- [ ] The GPT-family fallback is pinned to a dated model ID after a research pass. The architect records it with `/record-decision`, and `models.second_family.fallback.model` is no longer `null`.
- [ ] `config.mjs` exports `modelFor(role, { tier, authorModel })`, which returns the pinned ID `teams.md` gives the role, and never the author's model:
  - Opus for tier 2 implementers;
  - Opus to review Sonnet's work;
  - Fable to review Opus's work;
  - Opus to review Fable's work, the architect's tasks and ADRs (`teams.md` names no reviewer for them; this task adds the row). `config.test.ts` covers every row of the `teams.md` table. The `.claude/agents/*.md` files stay without a `model:` line, so sessions run as they do today until T-050 points `/start-task` and `/review-pr` (T-036) at `modelFor`.
- [ ] `tests/agent-ops-inactive.test.ts` passes while `agent-ops/STATUS` reads `inactive`. It fails if any of these hold:
  - a workflow under `.github/workflows/`, or a setting, command or agent file under `.claude/`, names a path under `agent-ops/`, `scripts/ops/`, or `scripts/ci/guardrails.mjs` (`.github/CODEOWNERS` may list `agent-ops/` as an owned path);
  - `.claude/settings.json` has a hook that runs `scripts/hooks/bash-guard.sh`;
  - a `schedule` trigger in any workflow runs agent ops.

  T-036's own hooks stay allowed. The test shows a case for each, built on fixture copies of the files.
- [ ] `pnpm verify` passes.

## Out of scope

- Reading `AGENT_OPS` or the HALT file (T-047). Removing Write and Edit from the reviewer and verifier (T-050, step 4). Metering tokens (T-047).

## Evidence

## Decisions

## Handoff
