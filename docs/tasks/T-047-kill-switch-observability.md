# T-047: The kill switch and observability

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-040; T-045 (the verdicts the footer lists); T-046 (the recall and agreement data the daily figures use); T-036 merged (`/daily-log`)
- **Paths this task may touch:** `scripts/ops/switch.mjs` (new), `scripts/ops/stop.mjs` (new), `scripts/ops/alarms.mjs` (new), `scripts/ops/footer.mjs` (new), `scripts/ops/figures.mjs` (new), `scripts/ops/budget.mjs` (new), `agent-ops/hooks/` (new, inert until T-050), `agent-ops/schemas/tick-metrics.schema.json` (new), `agent-ops/README.md` (Kill switch and Observability sections), `tests/agent-ops/switch.test.ts` (new), `tests/agent-ops/observability.test.ts` (new), `docs/tasks/T-047-kill-switch-observability.md`
- **Human gate:** no to build. Running `stop.mjs` for real deletes remote branches and cancels auto-merges, so it is Rafa's action. On Claude Code cloud the proxy refuses branch deletions, so `stop.mjs` runs from option B or from Rafa's laptop.
- **Status:** todo
- **Agent/session:** —

## Intent

Make the pipeline easy to stop and easy to watch before anything can start it.

- Pause: the tick starts nothing new while a pause holds. Stop: every session stops, every pending auto-merge is cancelled, every claim is deleted. Sever: Rafa revokes the agents' identity and sets spend caps to zero (his step, in T-039's checklist).
- Observability: a footer on every PR, one metrics line per tick, a daily summary of pipeline figures, and four alarms that pause dispatch.
- Non-goals: the tick itself (T-048), product telemetry (T-031, T-042).

## Context

- `agent-ops/README.md` (Kill switch, Observability), `agent-ops/ops.yaml` (`switches`, `kill_switch`, `observability`).
- The known gap: a running session does not recheck the switch, so one more push can land after a stop.

## Acceptance criteria

- [ ] `switch.mjs` reports on only when `agent-ops/STATUS`'s first line is exactly `active`, the repository variable `AGENT_OPS` is exactly `on`, no pause file exists and no alarm is open. Any read error, missing file or other value reads as off. One test per failure mode, with a fake `gh`.
- [ ] Decide and record where a pause lives. `reports/agent-ops/HALT` is local to one clone, but sessions run in separate sandboxes, so the pause needs a place every session and every alarm can reach and only Rafa can clear (for example an open issue with a reserved label). Recorded in Decisions with the reason.
- [ ] `stop.mjs` defaults to a dry run that lists the claims, auto-merges and sessions it would stop; it acts only with `--confirm`, and `agent-ops/README.md` says that Rafa runs it.
- [ ] `alarms.mjs` opens an alarm for each of the four conditions: `main` red for 30 minutes, more than half the day's cross-family reviews blocking, spend at the daily cap, a gitleaks hit on an agent branch. Each is shown firing on fixture data.
- [ ] `footer.mjs` builds and checks the PR footer: the model per role, sessions, reruns, each family's verdict, the tier and the budget used. Run on a PR without a complete footer, it exits non-zero (tested). It joins CI only at T-050 step 5.
- [ ] A session that exceeds its tier's budget from `ops.yaml` stops and writes a handoff. Decide the mechanism (for example a hook that reads the session's cost and ends it), build it, and show it stopping a scripted session.
- [ ] `tick-metrics.schema.json` defines the per-tick line in `reports/agent-ops/metrics.jsonl`: tasks ready, claimed, started and refused, with a reason for each refusal.
- [ ] `figures.mjs` computes the daily pipeline figures (lead time, first-pass approval rate, CI pass rate and reruns, cross-family block, abstention and agreement rates, canary recall, hours waiting on Rafa, spend) for `/daily-log` (T-036). It reads no product telemetry. Its spend figure comes from the pipeline's own token tallies (the usage each session and each `xreview` call reports), never from billing data. Its outputs, the daily log and the PR footer, are public, so no billing figure may reach them (`docs/costs.md`, PR 141).
- [ ] The daily log is not an instruction channel. `CLAUDE.md` tells every new session to start from the newest log's "Next steps", so these rules hold:
  - the daily-log job writes only figures computed from schema-checked inputs (`tick-metrics.schema.json` and the review logs);
  - it never quotes CI output, PR text or a session's words;
  - only the architect or Rafa writes "Next steps".

  A test feeds the job a CI log that holds a fake "Next steps" block, and the block does not appear in the output.

## Out of scope

- Phone or chat delivery of alarms (a later choice for Rafa), dashboards.

## Evidence

## Decisions

## Handoff
