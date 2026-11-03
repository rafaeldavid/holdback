# T-049: CI cost and flake control for parallel lanes

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-034, T-035 and T-036 merged; T-048 (the tick pauses a lane)
- **Paths this task may touch:** `docs/testing.md` (the Known flakes section), `scripts/ops/flakes.mjs` (new), `tests/agent-ops/flakes.test.ts` (new), `.claude/commands/merge-pr.md` (the retry step reads `flakes.mjs`), `agent-ops/gates.md` (CI cost and flake control), `docs/tasks/T-049-ci-cost-flakes.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Keep CI fast and honest once several lanes push at once: a flake gets one retry only if it is listed, every listed flake has a fix task and an expiry, and a lane that keeps flaking stops taking work.

This task adds only what T-034 to T-036 do not already cover. Already covered, not repeated here:

- T-034: the forge build cache, job-level path filters with `check` and `gitleaks` still reporting, TLC only when `formal/**` changes, `pnpm verify --affected`, `cancel-in-progress`.
- T-035: the receipt stall fixed at its root, a 30-second default test timeout.
- T-036: `/merge-pr` with one retry for a known flake, no polling loops, the pre-commit gitleaks hook.

## Context

- `agent-ops/gates.md` "CI cost and flake control" and its baseline: 4.5 to 6.5 minutes per PR, 11.5 to 14.5 minutes per push to `main`, the gas test stalled in 2 of 24 PR runs on 2026-11-02 (measured, `docs/reviews/2026-11-02-dev-velocity.md`).
- GitHub's limit of 20 concurrent jobs; a full run uses 9 (inferred). The repository is public, so minutes are free; wall-clock time is the cost.

## Acceptance criteria

- [ ] `docs/testing.md` has a "Known flakes" list; each entry names the test, its file, a fix task ID, the date added and an expiry 14 days later. `flakes.mjs` parses it, and `pnpm vitest run tests/agent-ops/flakes.test.ts` fails on an entry without a fix task or past its expiry.
- [ ] `/merge-pr` reruns a failed test once only if it is listed and not expired; a second failure counts as real; an unlisted failure is never rerun. Shown on recorded logs.
- [ ] A listed flake that fails more than twice in a day opens a P1 `flake` record (through T-041's CI-signal writer) and pauses dispatch in its lane until the record closes. Tested with the tick's fake state.
- [ ] The tick holds at most two PRs waiting on CI, from `ops.yaml` `wip.prs_in_ci`.
- [ ] Evidence records the measured PR critical path and queue time after T-034, which sets whether `wip.implementers` can rise from three to five.

## Out of scope

- Anything T-034, T-035 or T-036 already does; paid runners.

## Evidence

## Decisions

## Handoff
