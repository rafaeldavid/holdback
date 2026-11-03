# Running it: dispatch, CI, observability, kill switch, activation

Numbers labelled (m) measured, (i) inferred, (g) guessed. CI figures are from `docs/reviews/2026-11-02-dev-velocity.md` unless noted.

## Dispatch

`tick` is a stateless script: each run re-derives state from git and GitHub, then exits. It runs after every merge to `main` and every CI completion, with a 20-minute cron as the fallback for a missed event. Its runner is a Haiku 5.5 session told only to run the script and launch the sessions it prints; no model decides what is ready.

1. Kill switch: `AGENT_OPS` is `on` and `STATUS` is `active`, else exit.
2. Ready: task files on `main` with `Status: todo` whose dependencies have merged PRs (done is derived from merges, dev-velocity §2.9).
3. In flight: `t-*` branches on origin and open PRs.
4. Capacity: the limits in `teams.md`, the budgets in `pipeline.yaml`, and any lane paused by a flake.
5. Claim and launch, with a brief built from the task file's fields only.

A long-running coordinator was rejected: it carries stale context between decisions, and a missed event strands its work.

## CI cost and flakes

| | Today | After T-034 and T-035 (i) |
| --- | --- | --- |
| PR critical path | 4.5–6.5 min, any PR, docs included: the contracts job (151 s submodule checkout, 118 s via-IR compile) (m) | 1.5–2 min code, about 1 min docs |
| push to `main` | 11.5–14.5 min, of which 684 s TLC liveness (m) | TLC only when `formal/**` changes |
| flakes | gas-per-deal stall in 2 of 24 PR runs; one cost a 2 h 13 min wait (m) | root-caused, not timed out |
| pace | 34 PRs merged 2026-11-02 to 2026-11-03 08:23 UTC (m, `gh`) | — |

Rules:

- T-034 (path filters, caches), T-035 (receipt stall) and T-036 (`/merge-pr`, hooks) are activation preconditions. Without them three implementers queue behind a 6-minute contracts job they did not touch.
- **One rerun**, only for a test on the known-flakes list in `docs/testing.md` (none exists yet, m). Each entry names an owner task and expires after 14 days. An unlisted failure is never rerun.
- A listed flake firing more than twice a day pauses dispatch on its lane's paths and opens a P1 task in the test lane.
- A timeout is a hang detector, never a fix: raising one (PR 84, 180 s to 420 s) only reports the stall later.
- `pnpm verify --affected` locally, full `pnpm verify` once before the PR, one full verify per machine.
- `concurrency` cancels superseded runs of the same PR (T-034).

## Budgets

Per-class USD caps and a daily cap, in `pipeline.yaml` (guessed; nothing in the repo meters tokens yet). Over budget: the session stops with a handoff and the task returns to the planner. The tick refuses to launch past the daily cap.

## Observability

- **Per PR**, a footer the lander checks: model IDs per role, sessions, reruns, verdict per family, class, budget used.
- **Per tick**, one line to `reports/agent-ops/metrics.jsonl` (`reports/` is git-ignored, m): ready, claimed, launched, refused and why.
- **Daily**, the daily-log job writes the measured summary into `docs/log/<date>.md`: lead time, first-pass PASS rate, CI pass rate, reruns, cross-family block and abstention rates, disagreements, hours waiting on a human gate, spend.
- **Design map** gains an Ops panel from the same data (`/map`).

Alarms stop dispatch while their condition holds, and the daily log reports them: `main` red for 30 min; cross-family block rate above 50% in a day; spend at the daily cap; a gitleaks hit on a bot branch.

## Kill switch

Fail-closed: a switch that cannot be read is off.

| Level | Effect | Who |
| --- | --- | --- |
| stop-dispatch | no new claims; in-flight sessions finish their step and hand off | Rafa sets repository variable `AGENT_OPS` to anything but `on`; or an alarm |
| halt | stop every session, `gh pr merge --disable-auto` on every bot PR, delete claims | Rafa |
| revoke | revoke the bot token | Rafa |

The authoritative switch is outside the repo (the variable and the token), because a switch inside it is writable by the agents it stops. `agent-ops/STATUS` must also say `active`; changing it is an R3 PR. Both must hold.

## Activation

Not active. In order, each a separate decision:

1. Isolated environment with the scoped tokens in `config/keys-dev-env.template` (waiting on Rafa since 2026-11-01, m). Nothing runs on Rafa's Mac.
2. A bot GitHub identity; CODEOWNERS for every R3 path, code-owner review required, the bot not an owner (P5). Auto-merge and branch deletion on merge are already on (m).
3. T-034, T-035, T-036 merged; a known-flakes list in `docs/testing.md`.
4. Agent permissions: reviewer and verifier lose Write, Edit, push and `gh` mutations; the P6 deny list; `gh pr merge` for the lander only.
5. The triage harness with both schemas and a test feeding every `attack.*` payload to triage (record valid or dropped, canary absent). The feedback notice names the triage model provider (a site change: Rafa's gate, D35).
6. The cross-family harness on the existing provider adapter, with its own spend limit; a pinned GPT-family model for phase exits.
7. A cross-family review of this design, aimed at who can merge R3 and every path from intake or diff text to a session with Bash.
8. Shadow week: the tick runs with `--dry-run` and prints what it would launch; Rafa dispatches by hand; planner task files are compared with hand-written ones.
9. One lane at WIP 1, then WIP 3 with cross-family gates.
10. Rafa sets `STATUS` to `active` and `AGENT_OPS` to `on`.
