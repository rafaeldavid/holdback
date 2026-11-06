# T-036: Coordinator commands for repeat work

- **Lane:** infra
- **Phase:** 10 (moved from Phase 2 on 2026-11-06, D53: not needed for stable EVM operations on Sepolia; it starts when Rafa starts Phase 10)
- **Depends on:** T-034 for `/merge-pr`'s use of the new CI shape (can start in parallel)
- **Paths this task may touch:** `.claude/commands/`, `.claude/agents/` (brief templates only), `scripts/` (new helper scripts), `docs/team.md`, `docs/operations.md`, `CLAUDE.md` (the command list only), `docs/tasks/T-036-coordinator-commands.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Turn the coordinator's repeated steps into commands and scripts (`docs/reviews/2026-11-02-dev-velocity.md` §1): `/merge-pr` (wait for CI without polling loops, one retry for a listed flake, merge commit, cleanup, map refresh, task done), `/start-task`, a session-start brief script, `/deploy-demo` (with the schema-bump world reset and live checks), `/deploy-site`, `/review-pr`, `/record-decision`, `/daily-log`, and the two hooks (block polling loops; pre-commit gitleaks). Align `task.md` and `docs/team.md` on worktrees made by the Agent tool.

## Acceptance criteria

- [ ] Each command file states its trigger, steps and stop conditions, and respects the gates (deploys follow `docs/operations.md`; repository settings, publishing and real money stay Rafa's).
- [ ] `/merge-pr` uses GitHub auto-merge (enabled on the repository 2026-11-02, with branch deletion after merge) under three rules it enforces: arm it only after the reviewer's PASS; never on a PR from a fork; never on a PR that touches `.github/` (such a PR could rewrite the `check` job; it is reviewed and merged by hand). The ruleset requires `check` and `gitleaks`.
- [ ] Helper scripts (`scripts/brief.mjs`, `scripts/task-done.mjs`, `scripts/decision.mjs`, `scripts/log-skeleton.mjs`) with tests where they compute anything.
- [ ] Hooks configured in `.claude/settings.json` and proven to fire (per the update-config procedure), or documented as needing a new session.
- [ ] Used once each on real work in this repo (Evidence lists the PR or run).

## Evidence

## Decisions

## Handoff
