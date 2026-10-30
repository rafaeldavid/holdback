# T-001: Monorepo scaffold, CI, schema validation, guardrails

- **Lane:** infra
- **Phase:** 0
- **Depends on:** —
- **Paths this task may touch:** root config, `.github/`, `.claude/settings.json`, `packages/*/package.json` stubs, `apps/*/package.json` stubs
- **Human gate:** no
- **Status:** done
- **Agent/session:** kickoff session (implementer)

## Intent

Create the pnpm workspace and the layout in `docs/architecture.md` (Repository layout), with empty packages that build.

Restatement: set up an empty pnpm/TypeScript monorepo with the eight packages from the architecture layout, each building but holding no domain code. Wire the checks that enforce hard rules before any code exists: strict typecheck, ESLint bans on `eval`/`new Function` and on `number` in money code, Ajv validation of `spec/examples`, gitleaks, and the `.env` read deny. CI runs all of them. Inputs: architecture layout, ADR-0011, the Rules and checks table. Output: a green skeleton. Non-goals: domain types, the snap runner (T-005), the demo (T-013).

## Context

- `docs/architecture.md` §Repository layout; ADR-0011; `docs/team.md` §Rules and checks.

## Acceptance criteria

- [x] `pnpm install && pnpm typecheck && pnpm test` pass on a clean clone (measured).
- [x] CI workflow runs typecheck, lint, test, `snap` (placeholder), gitleaks, and Ajv validation of `spec/examples/*` against `spec/schemas/*`. (Green on GitHub: see PR checks.)
- [x] ESLint bans `eval`/`new Function` repo-wide and `number` arithmetic in `packages/core/src/money` (rule stub is fine; real rule in T-004).
- [x] `.claude/settings.json` deny rules for `.env*` verified by attempting a read in a session (record result).
- [x] `CLAUDE.md` Commands section reflects the real scripts.

## Out of scope

- Any domain code.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **Clean clone (measured):** tracked plus new files copied to an empty directory; `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint` pass; `pnpm test` 2/2 passed; `pnpm validate:spec` 11/11 examples valid; `pnpm snap` prints the placeholder and exits 0.
- **Lint guardrails (measured):** a scratch file with `eval(s)` and `new Function(...)` in `packages/judgment/src` produced `no-eval` and `no-new-func` errors; `const fee: number = 0.5` in `packages/core/src/money` produced the "Money must not use number" error, and `const fee = 0.5` the fractional-literal error. A string `"0.5"` is not flagged. Scratch files removed.
- **`.env` deny (measured):** with a placeholder `.env` in the worktree, the Read tool returned "File is in a directory that is denied by your permission settings." File removed; `.env*` is also gitignored (except `.env.example`).
- **Schema negative case (measured):** `TokenAmount` rejects `"2050.5"` and accepts `"2050000000"` (unit test).
- **CI on GitHub:** see the PR's checks (measured once they run).

## Decisions

- **TypeScript 6.0, not 7.** `pnpm add typescript` resolved 7.0.2; typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`, so TypeScript is pinned to `~6.0` (6.0.3). Revisit when typescript-eslint supports 7.
- **pnpm 12.16.1** via corepack, recorded in `packageManager`; CI reads it through `pnpm/action-setup`.
- **Spec validation lives in `scripts/spec.mjs`**, shared by `pnpm validate:spec` (CI step) and `tests/spec.test.ts` (so `pnpm test` also fails on a broken example).
- **`snap` and `demo` are placeholder scripts** that print which task implements them and exit 0, so CI and `/verify` have a stable command name now.
- **Schema gate:** `.github/CODEOWNERS` assigns `/spec/`, `/docs/decisions/` and `/contracts/` to @rafaeldavid. It is only enforced if branch protection requires code-owner review (a repository setting; not changed here).
- **Worktree location:** worktrees live in `.worktrees/` inside the repo (excluded via `.git/info/exclude`), not `../holdback-T-xxx` as `docs/team.md` says, at Rafa's request to keep the project in one folder. `docs/team.md` still needs updating (infra lane, T-011).

## Handoff

- Done: workspace, eight empty packages, root scripts, ESLint rules, spec validation, CI with gitleaks, CODEOWNERS, settings allow-list additions (`pnpm validate:*`, `pnpm build`), CLAUDE.md commands.
- Not done: branch protection (needs Rafa; repository setting). The money lint rule is a stub; T-004 replaces it with the branded `TokenAmount` type.
- Next: T-004 and T-005 can start from this branch once merged. T-011 builds `pnpm verify` on these scripts.
