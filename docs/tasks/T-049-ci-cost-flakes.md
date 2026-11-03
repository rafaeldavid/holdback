# T-049: CI cost and flake control for parallel lanes

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-034, T-035 and T-036 merged; T-048 (the tick pauses a lane)
- **Paths this task may touch:** `docs/testing.md` (the Known flakes section), `scripts/ci/flakes.mjs` (new), `scripts/ci/rerun-guard.mjs` (new), `tests/flakes.test.ts` (new), `.claude/commands/merge-pr.md` (the retry step reads `scripts/ci/flakes.mjs`), `scripts/ops/tick.mjs` and `tests/agent-ops/tick.test.ts` (the lane pause only; after T-048), `agent-ops/gates.md` (CI cost and flake control; after T-046), `docs/tasks/T-049-ci-cost-flakes.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Keep CI fast and honest once several lanes push at once: a flake gets one retry only if it is listed, every listed flake has a fix task and an expiry, and a lane that keeps flaking stops taking work.

The flake list and its parser live under `scripts/ci/`, not `scripts/ops/`. They are useful before activation, and `/merge-pr` reads them, which T-040's inert-pipeline test allows only outside `scripts/ops/`.

This task adds only what T-034 to T-036 do not already cover. Already covered, not repeated here:

- T-034: the forge build cache, job-level path filters with `check` and `gitleaks` still reporting, TLC only when `formal/**` changes, `pnpm verify --affected`, `cancel-in-progress`.
- T-035: the receipt stall fixed at its root, a 30-second default test timeout.
- T-036: `/merge-pr` with one retry for a known flake, no polling loops, the pre-commit gitleaks hook.

## Context

- `agent-ops/gates.md` "CI cost and flake control" and its baseline: 4.5 to 6.5 minutes per PR, 11.5 to 14.5 minutes per push to `main`, the gas test stalled in 2 of 24 PR runs on 2026-11-02 (measured, `docs/reviews/2026-11-02-dev-velocity.md`).
- GitHub's limit of 20 concurrent jobs; a full run uses 9 (inferred). The repository is public, so minutes are free; wall-clock time is the cost.

## Acceptance criteria

- [ ] `docs/testing.md` has a "Known flakes" list; each entry names the test, its file, a fix task ID, the date added and an expiry 14 days later. `flakes.mjs` parses it, and `pnpm vitest run tests/flakes.test.ts` fails on an entry without a fix task or past its expiry.
- [ ] `/merge-pr` reruns a failed test once only if it is listed and not expired; a second failure counts as real; an unlisted failure is never rerun. Shown on recorded logs.
- [ ] The rule binds outside `/merge-pr` too, in two places:
  - **The minter.** The agents' tokens are narrowed to Actions read (T-039 step 3), so on option B a rerun goes through `minter`'s `rerun <run-id>`. That command applies this list before it uses an Actions-write token it never hands out.
  - **CI.** A guard script, `scripts/ci/rerun-guard.mjs`, covers reruns started by anyone else, and by every session on option A. It reads `github.run_attempt`. On an attempt above 1, it passes only if every failure in the earlier attempts is a listed, unexpired flake, and only once per flake. T-050 step 5 adds it to `check`. Each rerun is also recorded in the tick's metrics line, so a deleted run log still leaves a trace. Tested on recorded run histories.
- [ ] A listed flake that fails more than twice in a day opens a P1 `flake` record (through T-041's CI-signal writer) and pauses dispatch in its lane until the record closes. Tested with the tick's fake state.
- [ ] Evidence records the measured PR critical path and queue time after T-034, which sets whether `wip.implementers` can rise from three to five.

## Out of scope

- Anything T-034, T-035 or T-036 already does; paid runners.

## Evidence

## Decisions

## Handoff
