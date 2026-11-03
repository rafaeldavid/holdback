# T-040: Agent-ops config loader and the model mix

- **Lane:** infra
- **Phase:** 9
- **Depends on:** PR 112 merged (the `agent-ops/` design on main); Rafa starts Phase 9
- **Paths this task may touch:** `scripts/ops/config.mjs` (new), `tests/agent-ops/config.test.ts` (new), `tests/agent-ops-inactive.test.ts` (new), `agent-ops/ops.yaml` (`models` and `roles` only), `agent-ops/teams.md`, `docs/decisions-today.md` (the GPT fallback pin), `docs/tasks/T-040-agent-ops-config-model-mix.md`
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
- D31 (parametrize, don't restrict): limits and budgets are parameters, not constants in code.
- The `yaml` package is already a dependency of `apps/adjudicator`; reuse it rather than adding one.

## Acceptance criteria

- [ ] `scripts/ops/config.mjs` loads `agent-ops/ops.yaml` and refuses it, naming the field, when: a model ID is missing, empty or ends in `latest`; a role names a model the `models` map lacks; for any author model, the reviewer model equals it; the second family's `family` is `claude`; a `wip` or `budgets_usd` value is not a non-negative integer. `pnpm vitest run tests/agent-ops/config.test.ts` covers each refusal.
- [ ] The GPT-family fallback is pinned to a dated model ID after a research pass, recorded as a decision in `docs/decisions-today.md`; `models.second_family.fallback.model` is no longer `null`.
- [ ] `config.mjs` exports `modelFor(role, { tier, authorModel })`, which returns the pinned ID `teams.md` gives the role: Opus for tier 2 implementers, Opus to review Sonnet's work, Fable to review Opus's work, never the author's model. `config.test.ts` covers every row of the `teams.md` table. The `.claude/agents/*.md` files stay without a `model:` line, so sessions run as they do today until T-050 points `/start-task` and `/review-pr` (T-036) at `modelFor`.
- [ ] `tests/agent-ops-inactive.test.ts` passes while `agent-ops/STATUS` reads `inactive` and fails if any of these hold: a file in `.github/workflows/` runs anything under `scripts/ops/`; `.claude/settings.json` has a hook that runs anything under `scripts/ops/` or `scripts/hooks/`; a `schedule` trigger in any workflow names agent ops. Shown by a test case for each, built on fixture copies of the files.
- [ ] `pnpm verify` passes.

## Out of scope

- Reading `AGENT_OPS` or the HALT file (T-047). Removing Write and Edit from the reviewer and verifier (T-050, step 4). Metering tokens (T-047).

## Evidence

## Decisions

## Handoff
