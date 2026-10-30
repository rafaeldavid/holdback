# T-001: Monorepo scaffold, CI, schema validation, guardrails

- **Lane:** infra
- **Phase:** 0
- **Depends on:** —
- **Paths this task may touch:** root config, `.github/`, `.claude/settings.json`, `packages/*/package.json` stubs, `apps/*/package.json` stubs
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Create the pnpm workspace and the layout in `docs/architecture.md` (Repository layout), with empty packages that build.

Restate this in your own words in this section before writing code.

## Context

- `docs/architecture.md` §Repository layout; ADR-0011; `docs/team.md` §Rules and checks.

## Acceptance criteria

- [ ] `pnpm install && pnpm typecheck && pnpm test` pass on a clean clone (measured).
- [ ] CI workflow runs typecheck, lint, test, `snap` (placeholder), gitleaks, and Ajv validation of `spec/examples/*` against `spec/schemas/*`.
- [ ] ESLint bans `eval`/`new Function` repo-wide and `number` arithmetic in `packages/core/src/money` (rule stub is fine; real rule in T-004).
- [ ] `.claude/settings.json` deny rules for `.env*` verified by attempting a read in a session (record result).
- [ ] `CLAUDE.md` Commands section reflects the real scripts.

## Out of scope

- Any domain code.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
