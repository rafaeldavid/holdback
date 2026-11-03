# T-042: The usage-telemetry lane: signal rules that open records without a model

- **Lane:** infra (reads the api lane's aggregates)
- **Phase:** 9
- **Depends on:** T-041 (the record writer and the shared intake folder); T-039 (the deploy side where figures live). T-031's API aggregates merged in PR 118.
- **Paths this task may touch:** `apps/demo-cloud/scripts/telemetry-export.ts` (new), `scripts/ops/signals.mjs` (new), `tests/agent-ops/signals.test.ts` (new), `agent-ops/ops.yaml` (`telemetry` thresholds only), `agent-ops/pipeline.md` (Usage telemetry section), `docs/operations.md` (the export runbook), `docs/tasks/T-042-telemetry-lane.md`
- **Human gate:** yes for three things only:
  - adding a read permission for Workers Logs to the `crow-deploy` token (the exact permission name is recorded by this task);
  - turning on Cloudflare Web Analytics for escrow.stream;
  - any account a social reader needs.

  No for the rules and the API and onchain sources.
- **Status:** todo
- **Agent/session:** —

## Intent

Let usage, not only opinions, open work: a rule over aggregates writes a `TriageRecord` with a `signal` name when a measure crosses its threshold.

- **Inputs:**
  - T-031's hour and day lines;
  - public settlement events on Sepolia (T-213), read through a public RPC;
  - Web Analytics stage counts, once Rafa enables them;
  - social mention counts, once Rafa approves a reader.
- **Where the figures live:** T-031 writes its lines to Workers Logs, which keeps them 3 days on the Free plan and 7 on Paid (measured, `docs/operations.md`). Nothing serves them. So an export on the deploy side copies the day lines to `reports/telemetry/` (git-ignored) at least every two days.
- **Where the rules run:** also on the deploy side. Only records, which carry no figures, cross to the build side through the intake folder.
- **Output:** records with `source` set to `api`, `onchain`, `web` or `social`, and a `signal` field.
- Non-goals: collecting new telemetry (T-031 owns it), publishing any figure (Rafa decides, D39), reading social post text (that goes through T-041's quarantine), the feedback-request rules (T-043).

## Context

- `agent-ops/pipeline.md` "Usage telemetry": each source's owner, cadence, rule and retention. `agent-ops/ops.yaml` `telemetry`.
- D35, D39, D40, ADR-0024 §1: aggregates only, no deal content, no identities. Threat P11.
- `docs/tasks/T-031-telemetry-mvp.md`: the hour and day line formats, and why Workers Logs rather than Analytics Engine.
- The gas baseline: 395,831 per happy-path deal on anvil (T-202, measured). Recalibrate it on Sepolia from the export before the rule runs.

## Acceptance criteria

- [ ] `telemetry-export.ts` reads the `telemetry: "hour"` and `"day"` lines from Workers Logs through Cloudflare's API with the deploy token, and appends them to `reports/telemetry/` without duplicates. It never reads the request log's lines into the repository. Tested on a recorded response. `docs/operations.md` names the permission it needs and how often to run it.
- [ ] Every rule in the pipeline's telemetry table is a named signal in `signals.mjs`, with its threshold read from `ops.yaml` (D31: parameters, not constants). Ratio thresholds are integers in basis points (hard rule: no floats).
- [ ] `pnpm vitest run tests/agent-ops/signals.test.ts` shows each rule firing on a fixture series that crosses its threshold, and staying silent on one that does not.
- [ ] An onchain event sequence that the state machine in `packages/core` forbids opens a P0 `security` record. Checked by a test with a forged sequence.
- [ ] A test shows that no record, and no tracked file in the repository, contains a figure from the input series.
- [ ] Neither script sends anything to a model provider: no import of a provider client, checked by a test.

## Out of scope

- A dashboard, any public stats page, alert delivery to a phone (T-047 covers alarms).

## Evidence

## Decisions

## Handoff
