# T-034: Faster CI and local verify: run only what a diff affects

- **Lane:** infra
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `.github/workflows/`, `scripts/ci/`, `scripts/verify.ts`, `scripts/design-map.mjs` (2.9 only), `tests/design-map.test.ts`, `vitest.config.*`, `package.json` (scripts), `docs/team.md` (Rules and checks rows for CI), `docs/operations.md`, `docs/tasks/T-034-ci-speed.md`
- **Human gate:** no (repository settings such as auto-merge stay Rafa's)
- **Status:** todo
- **Agent/session:** —

## Intent

Cut the PR cycle from 4.5 to 6.5 minutes (docs PRs included) to what a change actually needs, without weakening any safety suite on main. Source: `docs/reviews/2026-11-02-dev-velocity.md` §2.1, 2.2, 2.4, 2.5, 2.8, 2.9.

## Acceptance criteria

- [ ] 2.1: cache the contracts submodule tree and the forge build (`contracts/out`, cache) in the `contracts` job, keyed on submodule SHAs, `foundry.toml` and `contracts/src/**`; measured before/after step times in Evidence.
- [ ] 2.2: a `changes` job with job-level filters (never `on.pull_request.paths`); `gitleaks` unconditional; `check` passes only when every needed job succeeded or was skipped by a successful `changes` job; `concurrency` cancels superseded runs; a `docs` job for docs-only PRs (design-map test reads `docs/plan.md`); a `site` job running `node site/build.mjs && node site/check.mjs`. Shown on a docs-only PR and a contracts PR. Push to main still runs everything.
- [ ] 2.4: TLC on PRs only when `formal/**` (or the files the model mirrors) change; full liveness on push to main as today.
- [ ] 2.5: `pnpm verify --affected` sharing `scripts/ci/affected.mjs` with CI (forge only when contracts change; vitest `--changed` with `forceRerunTriggers` for shared config); plain `pnpm verify` still runs everything.
- [ ] 2.9: the design map derives a task's "done" from its merged PR, so no status-only PR is needed (keep reading the Status line when present).
- [ ] The ruleset's required contexts `check` and `gitleaks` report success on a docs-only PR (measured), and a failing test still fails `check`.

## Evidence

## Decisions

## Handoff
